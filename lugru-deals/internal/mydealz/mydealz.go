// Package mydealz liest den RSS-Feed der neuen Deals bei mydealz.de.
//
// Neue Deals stehen dort oft Minuten, bevor sie bei billiger.de auftauchen.
// Der Feed nennt je Deal Titel, Link, Händler und Preis — mehr braucht der
// Monitor nicht, um einen Deal einem beobachteten Produkt zuzuordnen.
package mydealz

import (
	"context"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// FeedURL ist der Feed der neuesten Deals.
const FeedURL = "https://www.mydealz.de/rss/deals"

// Deal ist ein Eintrag im Feed.
type Deal struct {
	Titel    string
	Link     string
	Haendler string
	// Preis ist 0, wenn der Feed keinen nennt.
	Preis money.Cents
	// Zeit ist die Veröffentlichung, Nullwert wenn unbekannt.
	Zeit time.Time
	// Kategorie ist die Kategorie bei mydealz, etwa „Urlaub & Reisen".
	Kategorie string
	// Bild ist das Vorschaubild, leer ohne.
	Bild string
	// Text ist die Beschreibung ohne HTML.
	Text string
	// Temperatur ist die Beliebtheit („177°"); nur der Trending-Feed nennt
	// sie, sonst 0 und TemperaturBekannt false.
	Temperatur        int
	TemperaturBekannt bool
}

type rss struct {
	Items []struct {
		Titel        string `xml:"title"`
		Link         string `xml:"link"`
		Datum        string `xml:"pubDate"`
		Kategorie    string `xml:"category"`
		Beschreibung string `xml:"description"`
		Bild         struct {
			URL string `xml:"url,attr"`
		} `xml:"http://search.yahoo.com/mrss/ content"`
		Haendler struct {
			Name  string `xml:"name,attr"`
			Preis string `xml:"price,attr"`
		} `xml:"http://www.pepper.com/rss merchant"`
	} `xml:"channel>item"`
}

// Lies wertet den Feed aus.
func Lies(roh []byte) ([]Deal, error) {
	var r rss
	if err := xml.Unmarshal(roh, &r); err != nil {
		return nil, fmt.Errorf("mydealz: Feed nicht lesbar: %w", err)
	}
	var out []Deal
	for _, it := range r.Items {
		d := Deal{Titel: strings.TrimSpace(it.Titel), Link: strings.TrimSpace(it.Link), Haendler: strings.TrimSpace(it.Haendler.Name)}
		if p, err := money.Parse(it.Haendler.Preis); err == nil {
			d.Preis = p
		}
		if t, err := time.Parse(time.RFC1123Z, strings.TrimSpace(it.Datum)); err == nil {
			d.Zeit = t
		}
		d.Kategorie = strings.TrimSpace(it.Kategorie)
		d.Bild = strings.TrimSpace(it.Bild.URL)
		d.Text = ohneHTML(it.Beschreibung)
		if m := temperaturMuster.FindStringSubmatch(d.Titel); m != nil {
			d.Temperatur, _ = strconv.Atoi(m[1])
			if m[0][0] == '-' {
				d.Temperatur = -d.Temperatur
			}
			d.TemperaturBekannt = true
			d.Titel = strings.TrimSpace(d.Titel[len(m[0]):])
		}
		if d.Link != "" {
			out = append(out, d)
		}
	}
	return out, nil
}

// Hole lädt den Feed.
func Hole(ctx context.Context, hc *http.Client, url string) ([]Deal, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "de-DE,de;q=0.9")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mydealz nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mydealz: HTTP %d", resp.StatusCode)
	}
	roh, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	return Lies(roh)
}

var (
	trenner          = regexp.MustCompile(`[^\p{L}\p{N}]+`)
	temperaturMuster = regexp.MustCompile(`^-?(\d{1,5})°\s*-\s*`)
	tagMuster        = regexp.MustCompile(`<[^>]+>`)
	leerMuster       = regexp.MustCompile(`\s+`)
)

func ohneHTML(s string) string {
	s = tagMuster.ReplaceAllString(s, " ")
	return strings.TrimSpace(leerMuster.ReplaceAllString(html.UnescapeString(s), " "))
}

// woerter zerlegt einen Text in kleingeschriebene Wörter. Zahl und Buchstabe
// werden dabei getrennt („ps5" → „ps", „5"), damit „PS5" und „PS 5" gleich
// aussehen.
func woerter(s string) []string {
	var out []string
	for _, w := range trenner.Split(strings.ToLower(s), -1) {
		var teil []rune
		for i, r := range w {
			if i > 0 && len(teil) > 0 && unicode.IsDigit(r) != unicode.IsDigit(teil[len(teil)-1]) {
				out = append(out, string(teil))
				teil = teil[:0]
			}
			teil = append(teil, r)
		}
		if len(teil) > 0 {
			out = append(out, string(teil))
		}
	}
	return out
}

// Passt sagt, ob der Titel zu einem der Stichworte passt. Stichworte sind
// durch Komma oder Zeilenumbruch getrennt; ein Stichwort passt, wenn jedes
// seiner Wörter im Titel vorkommt. Ein Wort mit „-" davor darf nicht
// vorkommen: „ps5 pro, -controller" — so fallen Zubehör-Deals weg.
func Passt(titel, stichworte string) bool {
	im := map[string]bool{}
	for _, w := range woerter(titel) {
		im[w] = true
	}
	var verboten []string
	var positiv []string
	for _, s := range strings.FieldsFunc(stichworte, func(r rune) bool { return r == ',' || r == '\n' || r == ';' }) {
		s = strings.TrimSpace(s)
		if strings.HasPrefix(s, "-") {
			verboten = append(verboten, woerter(s)...)
		} else if s != "" {
			positiv = append(positiv, s)
		}
	}
	for _, v := range verboten {
		if im[v] {
			return false
		}
	}
	for _, s := range positiv {
		ws := woerter(s)
		alle := len(ws) > 0
		for _, w := range ws {
			if !im[w] {
				alle = false
				break
			}
		}
		if alle {
			return true
		}
	}
	return false
}
