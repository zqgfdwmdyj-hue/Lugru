package billiger

import (
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// Suche findet Produktseiten zu einem Suchbegriff, in der Reihenfolge der
// Seite; SortiereTreffer ordnet sie danach.
// billiger.de antwortet auf eine Suche mal mit einer Trefferliste, mal mit
// einer Kategorieseite — beide werden gelesen.
func Suche(ctx context.Context, hc *http.Client, begriff string) ([]Variante, error) {
	ziel := "https://www.billiger.de/search?searchstring=" + url.QueryEscape(strings.TrimSpace(begriff))
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
	return Treffer(string(roh)), nil
}

var trefferMuster = regexp.MustCompile(`href="(?:https://www\.billiger\.de)?(/(?:products|pricelist)/(\d+)-([a-z0-9-]+))[?#"][^>]*>`)
var titelNah = regexp.MustCompile(`title="([^"]{4,200})"`)

// Treffer liest die Produktseiten einer Such- oder Kategorieseite.
func Treffer(seite string) []Variante {
	var out []Variante
	gesehen := map[string]bool{}
	for _, k := range LiesKategorie(seite) {
		if strings.HasPrefix(k.Objekt, "product:") && !gesehen[k.Objekt[8:]] {
			gesehen[k.Objekt[8:]] = true
			out = append(out, Variante{Name: k.Name, URL: k.URL})
		}
	}
	for _, m := range trefferMuster.FindAllStringSubmatchIndex(seite, -1) {
		id := seite[m[4]:m[5]]
		if gesehen[id] {
			continue
		}
		gesehen[id] = true
		name := slugName(seite[m[6]:m[7]])
		ende := m[1] + 600
		if ende > len(seite) {
			ende = len(seite)
		}
		if t := titelNah.FindStringSubmatch(seite[m[0]:ende]); t != nil {
			name = html.UnescapeString(t[1])
		}
		out = append(out, Variante{Name: name, URL: "https://www.billiger.de" + seite[m[2]:m[3]]})
	}
	return out
}

func suchWoerter(s string) map[string]bool {
	w := map[string]bool{}
	for _, t := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		w[t] = true
	}
	return w
}

// zubehoer sind Wörter, die einen Treffer als Zubehör verraten — es sei
// denn, sie stehen auch im Suchbegriff.
var zubehoer = []string{"lüfter", "gehäuselüfter", "controller", "kabel", "stromkabel", "halterung", "wandhalterung",
	"hülle", "case", "ständer", "standfuß", "kamera", "laufwerk", "ladestation", "mount", "adapter", "netzteil", "tasche"}

// SortiereTreffer ordnet nach Übereinstimmung mit dem Suchbegriff: Anteil
// der Suchwörter im Namen, Abzug für Zubehör, Vorrang für eine Modellnummer
// aus extra (etwa „Modell CT2K16G56C46S5" aus der Notiz), bei Gleichstand der
// kürzere Name.
func SortiereTreffer(t []Variante, begriff string, extra ...string) []Variante {
	such := suchWoerter(begriff)
	var modelle []string
	for _, e := range extra {
		for w := range suchWoerter(e) {
			// Modellnummern mischen Buchstaben und Ziffern und sind lang.
			if len(w) >= 6 && strings.IndexFunc(w, unicode.IsDigit) >= 0 && strings.IndexFunc(w, unicode.IsLetter) >= 0 {
				modelle = append(modelle, w)
			}
		}
	}
	wert := func(v Variante) float64 {
		n := suchWoerter(v.Name)
		x := -float64(len(n)) * 0.001
		if len(such) > 0 {
			treffer := 0
			for w := range such {
				if n[w] {
					treffer++
				}
			}
			x += float64(treffer) / float64(len(such))
		}
		for _, z := range zubehoer {
			if n[z] && !such[z] {
				x -= 0.5
			}
		}
		for _, m := range modelle {
			if n[m] {
				x += 2
			}
		}
		return x
	}
	sort.SliceStable(t, func(i, j int) bool { return wert(t[i]) > wert(t[j]) })
	return t
}
