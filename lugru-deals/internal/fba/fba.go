// Package fba wählt zu einem Paket die Größenklasse aus Amazons
// Tarifübersicht.
//
// Wie internal/calc ist das Paket frei von Netzwerk, Datenbank und Vorlagen:
// aus vier Zahlen und einer Liste wird eine Klasse, und das muss ohne Aufbau
// einer Umgebung prüfbar sein.
//
// Die Klassen selbst stehen nicht hier, sondern in der Datenbank. Amazons
// Tarifübersicht ändert sich mehrmals im Jahr — Grenzen wie Beträge. Eine
// hier eingebaute Tabelle wäre am Tag ihrer Fertigstellung veraltet und
// würde falsche Zahlen mit der Autorität von Programmcode ausstatten.
package fba

import (
	"sort"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Weg ist der Versandweg, für den ein Betrag gilt. Amazon führt dafür zwei
// getrennte Tarifübersichten, und sie unterscheiden sich erheblich: der
// EFN-Tarif liegt je nach Klasse beim Anderthalb- bis Dreieinhalbfachen des
// lokalen.
//
// Welcher gilt, hängt nicht am Produkt, sondern daran, ob die Ware im
// Zielland liegt. Genau eine dieser beiden Antworten ist je Zielmarkt
// erreichbar — deshalb steht der Weg an der Gebühr und nicht an der Klasse.
type Weg string

const (
	// Lokal ist der Tarif für Ware, die im Zielland liegt: lokaler oder
	// paneuropäischer Versand.
	Lokal Weg = "lokal"
	// EFN ist der Tarif für Ware, die aus einem anderen Land kommt.
	EFN Weg = "efn"
)

// Klasse ist eine Zeile der Tarifübersicht: eine Größenklasse mit ihren
// Grenzen. Was sie in einem bestimmten Zielmarkt kostet, steht nicht hier —
// die Grenzen gelten für alle Märkte, die Beträge nicht.
type Klasse struct {
	ID          int64
	Sortierung  int
	Bezeichnung string

	// Die drei Kantengrenzen in Millimeter. Welche davon "Länge" heißt, ist
	// gleichgültig: verglichen wird der Größe nach, siehe Passt.
	MaxLaengeMM int
	MaxBreiteMM int
	MaxHoeheMM  int

	MaxGewichtG int
}

// Masse sind die Maße eines Pakets, wie Keepa sie liefert: drei Kanten in
// Millimeter, das Gewicht in Gramm.
type Masse struct {
	LaengeMM int
	BreiteMM int
	HoeheMM  int
	GewichtG int
}

// Vollstaendig sagt, ob alle vier Zahlen vorliegen.
//
// Keepa nennt für unbekannte Maße -1 oder 0; internal/keepa macht daraus
// einheitlich 0. Ein Paket ohne vollständige Maße bekommt keine Klasse —
// aus drei bekannten Kanten und unbekanntem Gewicht ließe sich zwar eine
// raten, aber eine geratene Klasse ist eine geratene Gebühr.
func (m Masse) Vollstaendig() bool {
	return m.LaengeMM > 0 && m.BreiteMM > 0 && m.HoeheMM > 0 && m.GewichtG > 0
}

// Passt sagt, ob das Paket in diese Klasse fällt.
//
// Verglichen wird nach Amazons eigener Regel: längste Kante gegen längste
// Grenze, mittlere gegen mittlere, kürzeste gegen kürzeste. Ein Paket von
// 40 × 5 × 30 cm passt darum in eine Klasse "45 × 34 × 26", obwohl seine
// zweite Zahl größer ist als deren zweite — es liegt eben quer. Wer die
// Werte in Eingabereihenfolge vergliche, sortierte dieses Paket
// stillschweigend eine Klasse zu hoch ein.
//
// Eine Klasse mit einer Grenze von 0 oder weniger passt nie. Das ist kein
// "unbegrenzt", sondern eine unvollständig eingetragene Zeile — und die darf
// nicht unversehens zum Auffangbecken für jedes Paket werden. Wer eine
// Klasse ohne obere Schranke braucht, trägt eine hinreichend große Zahl ein.
func (k Klasse) Passt(m Masse) bool {
	if !m.Vollstaendig() {
		return false
	}
	if k.MaxLaengeMM <= 0 || k.MaxBreiteMM <= 0 || k.MaxHoeheMM <= 0 || k.MaxGewichtG <= 0 {
		return false
	}
	if m.GewichtG > k.MaxGewichtG {
		return false
	}

	paket := absteigend(m.LaengeMM, m.BreiteMM, m.HoeheMM)
	grenze := absteigend(k.MaxLaengeMM, k.MaxBreiteMM, k.MaxHoeheMM)
	for i := range paket {
		if paket[i] > grenze[i] {
			return false
		}
	}
	return true
}

// Waehle liefert die erste Klasse, in die das Paket passt.
//
// "Erste" heißt: in der übergebenen Reihenfolge. Die Klassen tragen dafür
// eine Sortierung, und der Aufrufer liefert sie danach geordnet — von der
// kleinsten zur größten. Sortierte man hier selbst, gäbe es zwei Stellen,
// die über die Reihenfolge entscheiden.
//
// Ohne Treffer ist der zweite Rückgabewert false. Dann bleibt es beim
// bisherigen Verhalten des Aufrufers; erfunden wird nichts.
func Waehle(klassen []Klasse, m Masse) (Klasse, bool) {
	for _, k := range klassen {
		if k.Passt(m) {
			return k, true
		}
	}
	return Klasse{}, false
}

func absteigend(a, b, c int) [3]int {
	s := [3]int{a, b, c}
	sort.Sort(sort.Reverse(sort.IntSlice(s[:])))
	return s
}

// Gebuehr ist der Betrag, den eine Klasse in einem Zielmarkt kostet.
//
// Amazons Tarifübersicht führt für die Übergrößen zwei Zeilen je Klasse: einen
// Grundbetrag bis zu einem Gewicht und darüber einen Zuschlag „je zusätzlichem
// Kilogramm". Beides steht hier zusammen, weil es ein Preis ist und nicht zwei
// — eine zweite Zeile in der Staffel wäre eine Klasse, die es nicht gibt.
//
// FreiGewichtG oder CentProKg auf null heißt: reiner Festbetrag. So sind die
// Umschlag- und Paketklassen eingetragen, und so bleibt der Normalfall
// einfach.
type Gebuehr struct {
	Cent         money.Cents
	FreiGewichtG int
	CentProKg    money.Cents
}

// Betrag rechnet den Preis für ein bestimmtes Paket aus.
//
// Aufgerundet wird auf angefangene Kilogramm — „je zusätzlichem Kilogramm"
// meint bei Amazon jedes angefangene, nicht jedes volle. Abgerundet ergäbe
// sich eine zu niedrige Gebühr, und zu niedrig ist hier die gefährliche
// Richtung: sie lässt einen Deal besser aussehen, als er ist.
func (g Gebuehr) Betrag(m Masse) money.Cents {
	if g.CentProKg <= 0 || g.FreiGewichtG <= 0 || m.GewichtG <= g.FreiGewichtG {
		return g.Cent
	}
	ueber := m.GewichtG - g.FreiGewichtG
	kg := (ueber + 999) / 1000
	return g.Cent + money.Cents(kg)*g.CentProKg
}
