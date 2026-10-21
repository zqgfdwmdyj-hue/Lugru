package mydealz

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Leasing sind die Kennzahlen eines Leasing-Deals, so wie sie bei mydealz im
// Titel oder in der Beschreibung stehen: „285€ pro Monat | 24 Mo. | LF 0,53".
type Leasing struct {
	// Faktor ist der Leasingfaktor (Rate geteilt durch Listenpreis × 100);
	// unter etwa 0,5 gilt ein Angebot als sehr gut. 0 = unbekannt.
	Faktor float64
	// Gesamtkostenfaktor rechnet Überführung und Zulassung mit ein; 0 = unbekannt.
	Gesamtkostenfaktor float64
	Rate               money.Cents
	Monate             int
	// Art ist "privat", "gewerbe" oder leer.
	Art string
}

var (
	lfVor        = regexp.MustCompile(`(?i)\b(?:LF|Leasingfaktor|L-Faktor)\s*(?:von|:|=)?\s*(\d[.,]\d{1,2})`)
	lfNach       = regexp.MustCompile(`(?i)\b(\d[.,]\d{1,2})\s*LF\b`)
	gkfMuster    = regexp.MustCompile(`(?i)\b(?:GKF|GF|Gesamtkostenfaktor)\s*(?:von|:|=)?\s*(\d[.,]\d{1,2})`)
	rateMuster   = regexp.MustCompile(`(?i)(\d[\d.]*(?:,\d{1,2})?)\s*(?:€|eur)\s*(?:/\s*(?:M|Mon\.?|Monat)\b|pro\s+Monat|mtl\.?|monatlich|im\s+Monat)`)
	monateMuster = regexp.MustCompile(`(?i)\b(\d{2})\s*(?:Mo\.?|Mon\.?|Monate)\b`)
)

func zahl(s string) float64 {
	f, _ := strconv.ParseFloat(strings.ReplaceAll(s, ",", "."), 64)
	return f
}

// LiesLeasing sucht die Kennzahlen zuerst im Titel, dann in der Beschreibung.
// Ein Leasingfaktor unter 0,05 ist ein Tippfehler oder ein Sonderfall
// (Prämie) und zählt nicht.
func LiesLeasing(d Deal) Leasing {
	var l Leasing
	for _, text := range []string{d.Titel, d.Text} {
		if l.Faktor == 0 {
			for _, m := range append(lfVor.FindAllStringSubmatch(text, -1), lfNach.FindAllStringSubmatch(text, -1)...) {
				if f := zahl(m[1]); f >= 0.05 && f < 5 {
					l.Faktor = f
					break
				}
			}
		}
		if l.Gesamtkostenfaktor == 0 {
			if m := gkfMuster.FindStringSubmatch(text); m != nil {
				l.Gesamtkostenfaktor = zahl(m[1])
			}
		}
		if l.Rate == 0 {
			if m := rateMuster.FindStringSubmatch(text); m != nil {
				l.Rate, _ = money.Parse(m[1])
			}
		}
		if l.Monate == 0 {
			if m := monateMuster.FindStringSubmatch(text); m != nil {
				l.Monate, _ = strconv.Atoi(m[1])
			}
		}
	}
	t := strings.ToLower(d.Titel)
	switch {
	case strings.Contains(t, "privatleasing") || strings.Contains(t, "[privat") || strings.Contains(t, "(privat"):
		l.Art = "privat"
	case strings.Contains(t, "gewerbe"):
		l.Art = "gewerbe"
	}
	return l
}
