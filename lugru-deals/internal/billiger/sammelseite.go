package billiger

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Eine Sammelseite (…/baseproducts/…) führt alle Varianten eines Produkts
// zusammen — bei der PS5 etwa Digital, Disc, Pro und die Bundles. Für den
// Monitor taugt sie nicht: ein Ankaufspreis gilt für genau eine Variante, und
// das günstigste Angebot der Sammelseite wäre oft eine andere. Stattdessen
// liefert Varianten die einzelnen Produktseiten darauf zur Auswahl.

var (
	sammelMuster  = regexp.MustCompile(`^/baseproducts/\d+[-a-z0-9]*$`)
	variantMuster = regexp.MustCompile(`href="(?:https://www\.billiger\.de)?(/(?:products|pricelist)/(\d+)-([a-z0-9-]+))[?#"]`)
)

// Variante ist eine Produktseite auf einer Sammelseite.
type Variante struct {
	Name string
	URL  string
}

// IstSammelseite sagt, ob roh ein Link auf eine Sammelseite bei billiger.de ist.
func IstSammelseite(roh string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(roh))
	if err != nil || strings.TrimPrefix(strings.ToLower(u.Host), "www.") != "billiger.de" || !sammelMuster.MatchString(u.Path) {
		return "", false
	}
	return "https://www.billiger.de" + u.Path, true
}

// HoleVarianten lädt eine Sammelseite und liefert ihre Varianten.
func HoleVarianten(ctx context.Context, hc *http.Client, link string) ([]Variante, error) {
	ziel, ok := IstSammelseite(link)
	if !ok {
		return nil, ErrKeinLink
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
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("billiger.de: HTTP %d", resp.StatusCode)
	}
	roh, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	return Varianten(string(roh), ziel), nil
}

// Varianten sucht die Produktseiten auf einer Sammelseite. Der Name kommt aus
// dem Link selbst („sony-playstation-5-slim-disc-edition"), denn der steht
// bei jeder Variante gleich da, egal wie die Seite sie sonst beschriftet.
// Nur Seiten, deren Name mit dem der Sammelseite beginnt, zählen — Zubehör
// und „ähnliche Produkte" fallen so weg.
func Varianten(seite, sammelURL string) []Variante {
	stamm := ""
	if u, err := url.Parse(sammelURL); err == nil {
		teile := strings.SplitN(strings.TrimPrefix(u.Path, "/baseproducts/"), "-", 2)
		if len(teile) == 2 {
			stamm = teile[1]
		}
	}
	var out []Variante
	gesehen := map[string]bool{}
	for _, m := range variantMuster.FindAllStringSubmatch(seite, -1) {
		if gesehen[m[2]] || (stamm != "" && !strings.HasPrefix(m[3], stamm)) {
			continue
		}
		gesehen[m[2]] = true
		out = append(out, Variante{Name: slugName(m[3]), URL: "https://www.billiger.de" + m[1]})
	}
	return out
}

func slugName(slug string) string {
	w := strings.Split(slug, "-")
	for i, s := range w {
		if s != "" {
			w[i] = strings.ToUpper(s[:1]) + s[1:]
		}
	}
	return strings.Join(w, " ")
}
