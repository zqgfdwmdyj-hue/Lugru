// Package rueckblick wertet aus, wie sich der Verkaufspreis eines Deals nach
// dem Post entwickelt hat — aus dem Buy-Box-Verlauf von Keepa.
//
// Die Frage dahinter: war der Gewinn, den der Post versprochen hat,
// realistisch? Wer den Artikel gekauft hat, verkauft ihn nicht am Tag des
// Posts, sondern in den Wochen danach. Darum zählt der Median der ersten
// 30 Tage als „realistischer Verkaufspreis“, nicht der Preis eines einzelnen
// Tages.
package rueckblick

import (
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// keepaNull ist der Beginn der Keepa-Zeit (2011-01-01) in Unix-Minuten.
const keepaNull = 21564000

// Minute ist ein Zeitpunkt in Keepa-Minuten.
func Minute(t time.Time) int { return int(t.Unix()/60) - keepaNull }

// Zeit macht aus Keepa-Minuten wieder einen Zeitpunkt.
func Zeit(minute int) time.Time { return time.Unix(int64(minute+keepaNull)*60, 0).UTC() }

// Schwellen: ein Preis gilt als gefallen, wenn er mehr als 5 % unter dem
// damaligen Verkaufspreis lag, und als erholt, sobald er wieder höchstens
// 3 % darunter liegt — kleine Schwankungen der Buy Box sind kein Einbruch.
const (
	gefallenAb = 95
	erholtAb   = 97
)

// Ergebnis ist der Verlauf nach dem Post, verdichtet.
type Ergebnis struct {
	Daten            bool
	VKJetzt, VKTief  money.Cents
	TiefAm           time.Time
	VK30, VK90       money.Cents
	Gefallen         bool
	ErholtAm         time.Time
	Volle30, Volle90 bool
}

// Auswerten verdichtet den Verlauf ab gepostet bis jetzt. vk ist der
// Verkaufspreis, mit dem der Post gerechnet hat.
func Auswerten(verlauf []keepa.Punkt, gepostet, jetzt time.Time, vk money.Cents) Ergebnis {
	pm, jm := Minute(gepostet), Minute(jetzt)
	// Der Preis, der beim Post galt, beginnt die Reihe; danach jeder
	// spätere Punkt.
	var reihe []keepa.Punkt
	for _, p := range verlauf {
		if p.Minute <= pm {
			reihe = []keepa.Punkt{{Minute: pm, Gesamt: p.Gesamt}}
			continue
		}
		if p.Minute > jm {
			break
		}
		reihe = append(reihe, p)
	}
	var e Ergebnis
	if len(reihe) == 0 {
		return e
	}
	e.Daten = true
	e.VKJetzt = reihe[len(reihe)-1].Gesamt
	tief := 0
	for i, p := range reihe {
		if p.Gesamt < reihe[tief].Gesamt {
			tief = i
		}
	}
	e.VKTief, e.TiefAm = reihe[tief].Gesamt, Zeit(reihe[tief].Minute)

	const tag = 24 * 60
	e.Volle30, e.Volle90 = jm-pm >= 30*tag, jm-pm >= 90*tag
	e.VK30 = median(reihe, min(pm+30*tag, jm))
	e.VK90 = median(reihe, min(pm+90*tag, jm))

	if vk > 0 && e.VKTief*100 < vk*gefallenAb {
		e.Gefallen = true
		for _, p := range reihe[tief+1:] {
			if p.Gesamt*100 >= vk*erholtAb {
				e.ErholtAm = Zeit(p.Minute)
				break
			}
		}
	}
	return e
}

// median ist der zeitgewichtete Median der Reihe bis bisMinute.
func median(reihe []keepa.Punkt, bisMinute int) money.Cents {
	var teil []keepa.Punkt
	for _, p := range reihe {
		if p.Minute >= bisMinute && len(teil) > 0 {
			break
		}
		teil = append(teil, p)
	}
	m := keepa.MedianZeitgewichtet(teil, bisMinute)
	if !m.OK {
		return teil[len(teil)-1].Gesamt
	}
	return m.Cents
}

// Gewinn rechnet den Gewinn eines Deals auf einen anderen Verkaufspreis um.
// Der Gewinn hängt linear vom Verkaufspreis ab: netto kommt der Preis ohne
// Umsatzsteuer des Zielmarkts an, die Provision geht vom Bruttopreis ab
// (siehe calc.Rechne). Einkauf und FBA-Gebühr bleiben, wie sie waren.
func Gewinn(gewinn, vk, neuerVK money.Cents, zielUStPermille int, provisionProzent float64) money.Cents {
	diff := float64(neuerVK - vk)
	anteil := 1000/float64(1000+zielUStPermille) - provisionProzent/100
	return gewinn + money.Cents(roundHalf(diff*anteil))
}

func roundHalf(f float64) int64 {
	if f < 0 {
		return -int64(-f + 0.5)
	}
	return int64(f + 0.5)
}
