// Package billiger liest die Preisliste eines Produkts bei billiger.de.
//
// billiger.de führt die Angebote vieler Shops (OTTO, Kaufland, MediaMarkt,
// Cyberport …) auf einer Seite, und anders als die Shops selbst liefert es
// diese Seite auch an Server aus, ohne sie hinter einer Bot-Abwehr zu
// verstecken. Eine öffentliche API gibt es nicht: gelesen wird, was die Seite
// jedem Browser ausliefert — die schema.org-Daten (Name, EAN, Bild) und die
// Angebotszeilen mit Shop, Preis, Versand, Gesamtpreis und Lieferzeit.
//
// Ändert billiger.de das Seitenformat, liefert Lies keine Angebote mehr und
// sagt das mit ErrKeineAngebote — der Monitor meldet das dann sichtbar, statt
// still nichts zu finden.
package billiger

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Lieferstatus ist die Farbe des Lieferzeit-Symbols in der Angebotszeile.
type Lieferstatus string

const (
	// Lieferbar ist das grüne Symbol: sofort oder in wenigen Werktagen.
	Lieferbar Lieferstatus = "lieferbar"
	// Verzoegert ist das gelbe Symbol: lieferbar, aber erst in einer Woche
	// oder später.
	Verzoegert Lieferstatus = "verzoegert"
	// Unbekannt ist alles andere, auch "nicht lieferbar".
	Unbekannt Lieferstatus = "unbekannt"
)

// Angebot ist eine Zeile der Preisliste.
type Angebot struct {
	ID    string
	Shop  string
	Titel string
	// Preis ist der Artikelpreis ohne Versand, Gesamt der Preis mit dem
	// günstigsten Versand. Fehlt die Gesamtangabe, ist Gesamt = Preis +
	// Versand.
	Preis   money.Cents
	Versand money.Cents
	Gesamt  money.Cents

	Lieferzeit string
	Status     Lieferstatus
}

// Preisliste ist eine Produktseite mit allen gelesenen Angeboten, nach
// Gesamtpreis aufsteigend so, wie billiger.de sie zeigt.
type Preisliste struct {
	URL      string
	Name     string
	EAN      string
	Bild     string
	Angebote []Angebot
}

var (
	ErrKeineAngebote = errors.New("billiger.de: keine Angebote auf der Seite gefunden — Seitenformat geändert?")
	ErrKeinLink      = errors.New("bitte einen Link zu einer Produktseite bei billiger.de angeben (…/pricelist/… oder …/products/…)")
	ErrBlockiert     = errors.New("billiger.de hat die Anfrage abgelehnt (Bot-Schutz)")
)

// pfadMuster erkennt die beiden Arten von Produktseiten.
var pfadMuster = regexp.MustCompile(`^/(pricelist|products)/\d+[-a-z0-9]*$`)

// NormalisiereURL prüft einen eingefügten Link und liefert ihn ohne
// Suchparameter (uds=… ist eine Sitzungskennung) und ohne Anker zurück.
func NormalisiereURL(roh string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(roh))
	if err != nil || u.Host == "" {
		return "", ErrKeinLink
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	if host != "billiger.de" {
		return "", ErrKeinLink
	}
	if !pfadMuster.MatchString(u.Path) {
		return "", ErrKeinLink
	}
	return "https://www.billiger.de" + u.Path, nil
}

// Kopfzeilen eines gewöhnlichen Browsers. Ohne sie antwortet billiger.de mit
// einer Fehlerseite.
var kopfzeilen = map[string]string{
	"User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
	"Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "de-DE,de;q=0.9",
}

// Hole lädt eine Preisliste und liest sie.
func Hole(ctx context.Context, hc *http.Client, link string) (Preisliste, error) {
	ziel, err := NormalisiereURL(link)
	if err != nil {
		return Preisliste{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ziel, nil)
	if err != nil {
		return Preisliste{}, err
	}
	for k, v := range kopfzeilen {
		req.Header.Set(k, v)
	}
	resp, err := hc.Do(req)
	if err != nil {
		return Preisliste{}, fmt.Errorf("billiger.de nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		return Preisliste{}, ErrBlockiert
	case resp.StatusCode == http.StatusNotFound:
		return Preisliste{}, errors.New("billiger.de: Produktseite gibt es nicht (mehr)")
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return Preisliste{}, fmt.Errorf("billiger.de: HTTP %d", resp.StatusCode)
	}
	roh, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return Preisliste{}, fmt.Errorf("billiger.de: Seite nicht lesbar: %w", err)
	}
	p, err := Lies(string(roh))
	p.URL = ziel
	return p, err
}

var (
	ldMuster = regexp.MustCompile(`(?s)<script[^>]*application/ld\+json[^>]*>(.*?)</script>`)

	// Jede Angebotszeile beginnt mit einem Element, das data-offer-row trägt.
	zeilenStart   = regexp.MustCompile(`<div[^>]*\bdata-offer-row\b[^>]*>`)
	offerID       = regexp.MustCompile(`data-offer-id="(\d+)"`)
	shopMuster    = regexp.MustCompile(`alt="Shop ([^"]+)"`)
	titelMuster   = regexp.MustCompile(`<div class="order-1[^"]*"[^>]*title="([^"]*)"`)
	preisMuster   = regexp.MustCompile(`data-price\s*>\s*([\d.,]+)\s*€`)
	versandMuster = regexp.MustCompile(`(?:ab\s+)?([\d.,]+)\s*€\s*Versand`)
	gesamtMuster  = regexp.MustCompile(`([\d.,]+)\s*€\s*Gesamt`)
	lieferMuster  = regexp.MustCompile(`Lieferzeit:\s*([^<]+)`)
	statusMuster  = regexp.MustCompile(`icons/availability\.svg\)"\s*class="\s*(text-[a-z]+-\d+)`)
)

// Lies wertet den HTML-Text einer Preisliste aus.
func Lies(seite string) (Preisliste, error) {
	var p Preisliste
	for _, m := range ldMuster.FindAllStringSubmatch(seite, -1) {
		var prod struct {
			Type  any    `json:"@type"`
			Name  string `json:"name"`
			GTIN  string `json:"gtin13"`
			GTIN8 string `json:"gtin8"`
			GTINx string `json:"gtin"`
			Image any    `json:"image"`
		}
		if json.Unmarshal([]byte(m[1]), &prod) != nil || fmt.Sprint(prod.Type) != "Product" {
			continue
		}
		if p.Name == "" {
			p.Name = prod.Name
		}
		if p.EAN == "" {
			p.EAN = erstesNichtLeer(prod.GTIN, prod.GTINx, prod.GTIN8)
		}
		if p.Bild == "" {
			switch b := prod.Image.(type) {
			case string:
				p.Bild = b
			case []any:
				if len(b) > 0 {
					p.Bild, _ = b[0].(string)
				}
			}
		}
	}

	starts := zeilenStart.FindAllStringIndex(seite, -1)
	for i, s := range starts {
		ende := len(seite)
		if i+1 < len(starts) {
			ende = starts[i+1][0]
		}
		if a, ok := liesZeile(seite[s[0]:ende]); ok {
			p.Angebote = append(p.Angebote, a)
		}
	}
	if len(p.Angebote) == 0 {
		return p, ErrKeineAngebote
	}
	return p, nil
}

func liesZeile(z string) (Angebot, bool) {
	var a Angebot
	if m := offerID.FindStringSubmatch(z); m != nil {
		a.ID = m[1]
	}
	m := shopMuster.FindStringSubmatch(z)
	if m == nil {
		return a, false
	}
	a.Shop = html.UnescapeString(strings.TrimSpace(m[1]))
	if m := titelMuster.FindStringSubmatch(z); m != nil {
		a.Titel = html.UnescapeString(strings.TrimSpace(m[1]))
	}
	m = preisMuster.FindStringSubmatch(z)
	if m == nil {
		return a, false
	}
	preis, err := money.Parse(m[1])
	if err != nil {
		return a, false
	}
	a.Preis = preis
	if m := versandMuster.FindStringSubmatch(z); m != nil {
		if v, err := money.Parse(m[1]); err == nil {
			a.Versand = v
		}
	}
	a.Gesamt = a.Preis + a.Versand
	if m := gesamtMuster.FindStringSubmatch(z); m != nil {
		if g, err := money.Parse(m[1]); err == nil && g >= a.Preis {
			a.Gesamt = g
		}
	}
	if m := lieferMuster.FindStringSubmatch(z); m != nil {
		a.Lieferzeit = strings.TrimSpace(html.UnescapeString(m[1]))
	}
	a.Status = Unbekannt
	if m := statusMuster.FindStringSubmatch(z); m != nil {
		switch {
		case strings.HasPrefix(m[1], "text-green"):
			a.Status = Lieferbar
		case strings.HasPrefix(m[1], "text-amber"), strings.HasPrefix(m[1], "text-yellow"):
			a.Status = Verzoegert
		}
	}
	return a, true
}

func erstesNichtLeer(werte ...string) string {
	for _, w := range werte {
		if w = strings.TrimSpace(w); w != "" {
			return w
		}
	}
	return ""
}
