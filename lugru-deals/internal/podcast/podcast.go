// Package podcast liest die Podcast-Charts von Apple je Kategorie und die
// RSS-Feeds der Podcasts, um neue Folgen zu finden.
//
// Apple bietet beides ohne Schlüssel an: die Charts als JSON
// (itunes.apple.com/de/rss/toppodcasts/…/genre=…/json) und je Podcast die
// Adresse seines Feeds (itunes.apple.com/lookup?id=…).
package podcast

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Kategorien sind die Genres der deutschen Podcast-Charts bei Apple.
var Kategorien = []struct {
	ID   int
	Name string
}{
	{1321, "Wirtschaft"}, {1318, "Technologie"}, {1489, "Nachrichten & Politik"}, {1488, "True Crime"},
	{1303, "Comedy"}, {1545, "Sport"}, {1533, "Wissenschaft"}, {1512, "Gesundheit & Fitness"},
	{1324, "Gesellschaft & Kultur"}, {1487, "Geschichte"}, {1304, "Bildung"}, {1502, "Freizeit"},
	{1309, "Film & Fernsehen"}, {1310, "Musik"}, {1305, "Kinder & Familie"},
}

// KategorieName liefert den Namen zu einer Genre-ID.
func KategorieName(id int) string {
	for _, k := range Kategorien {
		if k.ID == id {
			return k.Name
		}
	}
	return "Kategorie " + strconv.Itoa(id)
}

// Podcast ist ein Eintrag der Charts.
type Podcast struct {
	ID    string
	Name  string
	Autor string
	Bild  string
	Link  string
}

// Folge ist eine Folge aus dem Feed.
type Folge struct {
	ID      string
	Titel   string
	Link    string
	Zeit    time.Time
	Dauer   string
	Podcast string
}

type Client struct {
	HTTP *http.Client
	// AppleURL ersetzt itunes.apple.com in Tests.
	AppleURL string
}

func (c Client) apple() string {
	if c.AppleURL != "" {
		return c.AppleURL
	}
	return "https://itunes.apple.com"
}

func (c Client) hole(ctx context.Context, ziel string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ziel, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; LugruDeals/1.0)")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 16<<20))
}

// Charts liefert die Top-n-Podcasts einer Kategorie in Deutschland.
func (c Client) Charts(ctx context.Context, genre, n int) ([]Podcast, error) {
	roh, err := c.hole(ctx, fmt.Sprintf("%s/de/rss/toppodcasts/limit=%d/genre=%d/json", c.apple(), n, genre))
	if err != nil {
		return nil, fmt.Errorf("Apple-Charts: %w", err)
	}
	return LiesCharts(roh)
}

func LiesCharts(roh []byte) ([]Podcast, error) {
	type label struct {
		Label string `json:"label"`
	}
	var r struct {
		Feed struct {
			Eintraege []struct {
				Name  label   `json:"im:name"`
				Autor label   `json:"im:artist"`
				Bild  []label `json:"im:image"`
				ID    struct {
					Label string `json:"label"`
					Attr  struct {
						ID string `json:"im:id"`
					} `json:"attributes"`
				} `json:"id"`
			} `json:"entry"`
		} `json:"feed"`
	}
	if err := json.Unmarshal(roh, &r); err != nil {
		return nil, fmt.Errorf("Apple-Charts nicht lesbar: %w", err)
	}
	var out []Podcast
	for _, e := range r.Feed.Eintraege {
		p := Podcast{ID: e.ID.Attr.ID, Name: e.Name.Label, Autor: e.Autor.Label, Link: e.ID.Label}
		if len(e.Bild) > 0 {
			p.Bild = e.Bild[len(e.Bild)-1].Label
		}
		if p.ID != "" {
			out = append(out, p)
		}
	}
	return out, nil
}

var appleID = regexp.MustCompile(`(?:^|/id|[?&]id=)(\d{6,12})\b`)

// AppleID liest die ID aus einem Link wie podcasts.apple.com/de/podcast/…/id1200361736.
func AppleID(roh string) (string, bool) {
	m := appleID.FindStringSubmatch(strings.TrimSpace(roh))
	if m == nil {
		return "", false
	}
	return m[1], true
}

// FeedAdresse sucht die Adresse des RSS-Feeds zu einer Apple-ID.
func (c Client) FeedAdresse(ctx context.Context, id string) (string, string, error) {
	roh, err := c.hole(ctx, c.apple()+"/lookup?entity=podcast&id="+url.QueryEscape(id))
	if err != nil {
		return "", "", fmt.Errorf("Apple-Suche: %w", err)
	}
	var r struct {
		Ergebnisse []struct {
			Feed string `json:"feedUrl"`
			Name string `json:"collectionName"`
		} `json:"results"`
	}
	if err := json.Unmarshal(roh, &r); err != nil || len(r.Ergebnisse) == 0 || r.Ergebnisse[0].Feed == "" {
		return "", "", fmt.Errorf("Apple kennt zu %s keinen Feed", id)
	}
	return r.Ergebnisse[0].Feed, r.Ergebnisse[0].Name, nil
}

// Folgen liest die neuesten Folgen eines Feeds.
func (c Client) Folgen(ctx context.Context, feed string) ([]Folge, error) {
	u, err := url.Parse(feed)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("keine gültige Feed-Adresse")
	}
	roh, err := c.hole(ctx, feed)
	if err != nil {
		return nil, fmt.Errorf("Feed: %w", err)
	}
	return LiesFolgen(roh)
}

func LiesFolgen(roh []byte) ([]Folge, error) {
	var r struct {
		Kanal struct {
			Titel string `xml:"title"`
			Items []struct {
				Titel string `xml:"title"`
				Link  string `xml:"link"`
				GUID  string `xml:"guid"`
				Datum string `xml:"pubDate"`
				Dauer string `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd duration"`
				Datei struct {
					URL string `xml:"url,attr"`
				} `xml:"enclosure"`
			} `xml:"item"`
		} `xml:"channel"`
	}
	d := xml.NewDecoder(strings.NewReader(string(roh)))
	d.Strict = false
	if err := d.Decode(&r); err != nil {
		return nil, fmt.Errorf("Feed nicht lesbar: %w", err)
	}
	var out []Folge
	for _, it := range r.Kanal.Items {
		f := Folge{Titel: strings.TrimSpace(it.Titel), Link: strings.TrimSpace(it.Link), Podcast: strings.TrimSpace(r.Kanal.Titel),
			Dauer: dauerText(it.Dauer)}
		f.ID = strings.TrimSpace(it.GUID)
		if f.ID == "" {
			f.ID = it.Datei.URL
		}
		if f.ID == "" {
			f.ID = f.Titel
		}
		for _, form := range []string{time.RFC1123Z, time.RFC1123, "Mon, 2 Jan 2006 15:04:05 -0700", "Mon, 2 Jan 2006 15:04:05 MST"} {
			if t, err := time.Parse(form, strings.TrimSpace(it.Datum)); err == nil {
				f.Zeit = t
				break
			}
		}
		if f.Titel != "" {
			out = append(out, f)
		}
	}
	return out, nil
}

// dauerText macht aus „00:32:29" oder „1949" (Sekunden) „32 Min.".
func dauerText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	sek := 0
	if strings.Contains(s, ":") {
		for _, t := range strings.Split(s, ":") {
			n, err := strconv.Atoi(t)
			if err != nil {
				return ""
			}
			sek = sek*60 + n
		}
	} else if n, err := strconv.Atoi(s); err == nil {
		sek = n
	} else {
		return ""
	}
	if sek >= 3600 {
		return fmt.Sprintf("%d Std. %d Min.", sek/3600, sek%3600/60)
	}
	return fmt.Sprintf("%d Min.", (sek+30)/60)
}
