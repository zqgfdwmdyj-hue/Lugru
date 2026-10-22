package keepa

import (
	"sort"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// MedianZeitgewichtet liefert den Preis, oberhalb und unterhalb dessen jeweils
// die Hälfte der beobachteten Zeit lag.
//
// Jeder Punkt gilt bis zum nächsten, der letzte bis bisMinute. Die Gewichtung
// nach Dauer ist entscheidend: Keepas eigener avg90 ist laut Dokumentation ein
// gewichteter Mittelwert, und ein ungewichteter Median wäre damit nicht
// vergleichbar — ein Preis, der zwei Stunden galt, zählte dann so viel wie
// einer, der zwei Monate stand.
//
// punkte muss chronologisch nach Minute aufsteigend sortiert sein: die Dauer
// eines Punkts wird aus der Minute des jeweils nächsten Punkts abgeleitet,
// unsortierte Eingabe ergäbe also stillschweigend falsche Abschnitte. Task 4s
// buyBoxVerlauf liefert die Punkte immer schon in dieser Reihenfolge, daher
// prüft diese Funktion die Sortierung nicht selbst.
func MedianZeitgewichtet(punkte []Punkt, bisMinute int) Price {
	type spanne struct {
		gesamt money.Cents
		dauer  int
	}

	var spannen []spanne
	gesamtdauer := 0
	for i, p := range punkte {
		ende := bisMinute
		if i+1 < len(punkte) {
			ende = punkte[i+1].Minute
		}
		dauer := ende - p.Minute
		if dauer <= 0 {
			continue
		}
		spannen = append(spannen, spanne{p.Gesamt, dauer})
		gesamtdauer += dauer
	}
	if gesamtdauer == 0 {
		return Price{}
	}

	sort.Slice(spannen, func(i, j int) bool { return spannen[i].gesamt < spannen[j].gesamt })

	// Vergleich als 2*lauf >= gesamtdauer statt lauf >= gesamtdauer/2: Die
	// ganzzahlige Division würde bei ungerader Gesamtdauer nach unten runden
	// und die Schwelle einen Abschnitt zu früh auslösen — der zurückgegebene
	// Preis hätte dann nur eine Minderheit der Zeit gegolten. Die letzte
	// Spanne muss per Konstruktion mindestens die Hälfte tragen (lauf erreicht
	// dort gesamtdauer), ihr return ist also der reguläre Schleifenausgang und
	// keine unerreichbare Absicherung.
	lauf := 0
	for _, s := range spannen[:len(spannen)-1] {
		lauf += s.dauer
		if 2*lauf >= gesamtdauer {
			return Price{Cents: s.gesamt, OK: true}
		}
	}
	return Price{Cents: spannen[len(spannen)-1].gesamt, OK: true}
}
