package billiger

import (
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Eine Kategorieseite bei billiger.de (…/show/kategorie/14083.htm) listet
// viele Produkte mit ihrem günstigsten Preis. Jede Kachel trägt einen
// Merken-Knopf mit Kennung, Name und Preis in Cent — daraus liest der
// Kategorie-Scan, ohne jede Produktseite einzeln abzurufen.

// Kachel ist ein Produkt auf einer Kategorieseite.
type Kachel struct {
	// Objekt ist "product:123" oder "baseproduct:456".
	Objekt string
	Name   string
	Preis  money.Cents
	URL    string
}

var (
	kategorieMuster = regexp.MustCompile(`^/show/kategorie/\d+\.htm$`)
	merkenMuster    = regexp.MustCompile(`(?s)<button[^>]*data-wishlist-button[^>]*>`)
	attrMuster      = regexp.MustCompile(`data-(object-id|object-type|name|price)="([^"]*)"`)
)

// NormalisiereKategorie prüft einen Kategorie-Link; Filter (?filter=…)
// bleiben erhalten, sie grenzen die Kategorie ein.
func NormalisiereKategorie(roh string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(roh))
	if err != nil || strings.TrimPrefix(strings.ToLower(u.Host), "www.") != "billiger.de" || !kategorieMuster.MatchString(u.Path) {
		return "", fmt.Errorf("bitte einen Link zu einer Kategorie bei billiger.de angeben (…/show/kategorie/….htm)")
	}
	ziel := "https://www.billiger.de" + u.Path
	if u.RawQuery != "" {
		ziel += "?" + u.RawQuery
	}
	return ziel, nil
}

// LiesKategorie liest die Kacheln einer Kategorieseite.
func LiesKategorie(seite string) []Kachel {
	var out []Kachel
	gesehen := map[string]bool{}
	treffer := merkenMuster.FindAllStringIndex(seite, -1)
	for i, t := range treffer {
		werte := map[string]string{}
		for _, a := range attrMuster.FindAllStringSubmatch(seite[t[0]:t[1]], -1) {
			werte[a[1]] = html.UnescapeString(a[2])
		}
		id, typ := werte["object-id"], werte["object-type"]
		cent, err := strconv.ParseInt(werte["price"], 10, 64)
		if id == "" || typ == "" || err != nil || cent <= 0 {
			continue
		}
		k := Kachel{Objekt: typ + ":" + id, Name: strings.TrimSpace(werte["name"]), Preis: money.Cents(cent)}
		if gesehen[k.Objekt] {
			continue
		}
		gesehen[k.Objekt] = true
		// Der Link der Kachel folgt dem Knopf; gesucht wird bis zur nächsten
		// Kachel.
		ende := len(seite)
		if i+1 < len(treffer) {
			ende = treffer[i+1][0]
		}
		pfad := map[string]string{"product": "products", "baseproduct": "baseproducts"}[typ]
		if pfad != "" {
			linkMuster := regexp.MustCompile(`href="(/(?:` + pfad + `|pricelist)/` + regexp.QuoteMeta(id) + `-[a-z0-9-]*)`)
			if m := linkMuster.FindStringSubmatch(seite[t[1]:ende]); m != nil {
				k.URL = "https://www.billiger.de" + m[1]
			} else {
				k.URL = "https://www.billiger.de/" + pfad + "/" + id
			}
		}
		out = append(out, k)
	}
	return out
}

// HoleKategorie lädt eine Kategorieseite und liest ihre Kacheln.
func HoleKategorie(ctx context.Context, hc *http.Client, link string) ([]Kachel, error) {
	ziel, err := NormalisiereKategorie(link)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ziel, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range kopfzeilen {
		req.Header.Set(k, v)
	}
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("billiger.de nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrBlockiert
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("billiger.de: HTTP %d", resp.StatusCode)
	}
	roh, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	k := LiesKategorie(string(roh))
	if len(k) == 0 {
		return nil, fmt.Errorf("billiger.de: keine Produkte auf der Kategorieseite gefunden — Seitenformat geändert?")
	}
	return k, nil
}
