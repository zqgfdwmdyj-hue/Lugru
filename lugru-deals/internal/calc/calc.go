// Package calc rechnet Gewinn und Marge eines Arbitrage-Deals.
//
// Das Paket ist bewusst frei von Netzwerk, Datenbank und Vorlagen: hier steht
// die Zahl, die am Ende im Discord-Post landet, und sie muss ohne Aufbau einer
// Umgebung prüfbar sein.
package calc

import (
	"math"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// USt steuert, ob die Vorsteuer auf den Einkauf abgezogen wird.
type USt int

const (
	// Netto zieht die Vorsteuer des Einkaufslands ab. Standardfall.
	Netto USt = iota
	// Brutto lässt den Einkaufspreis ungekürzt, etwa ohne gültige Rechnung.
	Brutto
)

// Basis legt fest, worauf sich die Marge bezieht.
type Basis int

const (
	// AufBrutto bezieht die Marge auf den Brutto-Verkaufspreis. Reproduziert
	// die Zahlen des bisherigen Google Sheets.
	AufBrutto Basis = iota
	// AufNetto bezieht die Marge auf den Netto-Verkaufserlös.
	AufNetto
)

// EKArt legt fest, wie der eingegebene Einkaufspreis zu lesen ist.
//
// Der Schalter im Formular fragt genau das: "Der eingegebene Preis ist
// netto/brutto". Er ist etwas anderes als USt oben — der beantwortet die
// zweite, davon unabhängige Frage, ob die im Bruttopreis steckende Vorsteuer
// überhaupt abziehbar ist (ohne ordentliche Rechnung ist sie es nicht).
type EKArt int

const (
	// EKAlsBrutto liest den eingegebenen Betrag als Bruttopreis. Standardfall:
	// so steht der Preis im Warenkorb eines Endkundenshops.
	EKAlsBrutto EKArt = iota
	// EKAlsNetto liest den eingegebenen Betrag als Nettopreis, wie ihn eine
	// B2B-Rechnung oder ein Großhändler ausweist. Der Bruttopreis wird daraus
	// mit dem USt-Satz des Einkaufslands hochgerechnet.
	EKAlsNetto
)

// Eingabe sind die Werte eines Deals, wie sie im Formular stehen.
type Eingabe struct {
	// EK ist der Einkaufspreis so, wie er eingegeben wurde — netto oder
	// brutto, je nach EKArt. Das Feld heißt darum bewusst nicht EKBrutto:
	// welche der beiden Größen hier steht, entscheidet allein EKArt.
	EK               money.Cents
	EKArt            EKArt
	VKBrutto         money.Cents
	QuellUStPermille int // 210 entspricht 21,0 %
	ZielUStPermille  int
	ProvisionProzent float64 // 15.0 entspricht 15 %
	FBA              money.Cents
	UStModus         USt
	MargenBasis      Basis
}

// Ergebnis sind die abgeleiteten Werte. Alle Beträge auf Cent gerundet.
//
// EKBrutto und EKNetto stehen immer beide da, gleich welche der beiden
// Größen eingegeben wurde: die Aufschlüsselung im Formular zeigt beide
// Zeilen, und der Discord-Post nennt den Bruttopreis auch dann, wenn netto
// eingegeben wurde.
type Ergebnis struct {
	EKBrutto     money.Cents
	EKNetto      money.Cents
	VKNetto      money.Cents
	Provision    money.Cents
	Gewinn       money.Cents
	MargeProzent float64
}

// Rechne wertet einen Deal aus.
//
// Innerhalb der Funktion wird mit voller Genauigkeit gerechnet und erst am Ende
// auf Cent gerundet. Würde jeder Zwischenschritt gerundet, summierten sich die
// Fehler aus drei Divisionen zu einer sichtbaren Abweichung im Post.
func Rechne(e Eingabe) Ergebnis {
	vkNetto := ohneUSt(float64(e.VKBrutto), e.ZielUStPermille)

	ekBrutto, ekNetto := ekSeiten(float64(e.EK), e.EKArt, e.QuellUStPermille)

	// Der Brutto-Schalter betrifft ausschließlich die Einkaufsseite. Der
	// Verkaufserlös bleibt netto, weil die Umsatzsteuer daraus unabhängig vom
	// Einkauf ans Finanzamt geht.
	//
	// Ohne abziehbare Vorsteuer kostet der Einkauf den vollen Bruttopreis —
	// unabhängig davon, ob er als Netto- oder als Bruttobetrag eingegeben
	// wurde. Genau diese Größe geht darum in den Gewinn ein, nicht der
	// eingegebene Betrag.
	kosten := ekNetto
	if e.UStModus == Brutto {
		kosten = ekBrutto
	}

	// Amazons Verkaufsgebühr bemisst sich am Gesamtbetrag, den der Käufer
	// zahlt — also am Bruttopreis inklusive Umsatzsteuer, nicht am
	// Nettoerlös. Nachgerechnet an echten Settlement-Posten: die
	// Commission-Beträge (nach Herausrechnen der 19 % USt, die Amazon auf
	// die Gebühr selbst fakturiert und die als Vorsteuer abziehbar ist)
	// treffen gegen den Bruttopreis exakt die Kategoriesätze 8 %, 15 % und
	// 20 %; gegen den Nettopreis ergäben sich 9,5 %, 17,9 % und 23,8 % —
	// Sätze, die es bei Amazon nicht gibt.
	//
	// Bis hierher wurde vkNetto als Basis benutzt. Das hat die Gebühr um
	// den Faktor der Ziel-USt zu klein gemacht und damit jeden Deal
	// systematisch zu gut aussehen lassen.
	provision := float64(e.VKBrutto) * e.ProvisionProzent / 100
	gewinn := vkNetto - kosten - provision - float64(e.FBA)

	bezug := float64(e.VKBrutto)
	if e.MargenBasis == AufNetto {
		bezug = vkNetto
	}
	marge := 0.0
	if bezug != 0 {
		marge = gewinn / bezug * 100
	}

	return Ergebnis{
		EKBrutto:     runde(ekBrutto),
		EKNetto:      runde(ekNetto),
		VKNetto:      runde(vkNetto),
		Provision:    runde(provision),
		Gewinn:       runde(gewinn),
		MargeProzent: marge,
	}
}

// ekSeiten leitet aus dem eingegebenen Einkaufspreis beide Größen ab: den
// Bruttopreis, den der Einkauf kostet, und den Nettopreis, der nach Abzug der
// Vorsteuer übrig bleibt. Welche der beiden eingegeben wurde, sagt art; die
// jeweils andere wird mit dem USt-Satz des Einkaufslands umgerechnet.
//
// Gerechnet wird auch hier mit voller Genauigkeit — gerundet wird erst in
// Rechne, aus demselben Grund wie dort.
func ekSeiten(ek float64, art EKArt, ustPermille int) (brutto, netto float64) {
	if art == EKAlsNetto {
		return mitUSt(ek, ustPermille), ek
	}
	return ek, ohneUSt(ek, ustPermille)
}

// ohneUSt rechnet einen Bruttobetrag auf netto herunter. Ein Satz von 0 oder
// weniger lässt den Betrag unverändert, statt durch null zu teilen.
// NettoAusBrutto zieht die Umsatzsteuer aus einem Bruttobetrag.
//
// Exportiert, weil der Keepa-Vorschlag für den Einkaufspreis in Schritt 2
// dieselbe Umrechnung braucht: Keepa nennt Verbraucherpreise inklusive
// Umsatzsteuer des jeweiligen Landes. Ohne diesen Weg brächte die
// Weboberfläche ihre eigene Steuerformel mit — eine zweite Wahrheit, die
// irgendwann von dieser hier abweicht.
func NettoAusBrutto(brutto money.Cents, ustPermille int) money.Cents {
	return runde(ohneUSt(float64(brutto), ustPermille))
}

func ohneUSt(brutto float64, ustPermille int) float64 {
	if ustPermille <= 0 {
		return brutto
	}
	return brutto * 1000 / float64(1000+ustPermille)
}

// mitUSt ist die Umkehrung von ohneUSt: aus einem Nettobetrag wird der
// Bruttobetrag. Ein Satz von 0 oder weniger lässt den Betrag unverändert,
// damit beide Richtungen dieselbe Sonderfallregel haben.
func mitUSt(netto float64, ustPermille int) float64 {
	if ustPermille <= 0 {
		return netto
	}
	return netto * float64(1000+ustPermille) / 1000
}

func runde(f float64) money.Cents { return money.Cents(math.Round(f)) }

// Die Schwellen, ab denen eine Marge als gut beziehungsweise noch tragbar
// gilt — in Prozent.
//
// Marge ist die einzige Kennzahl dieses Programms, die eine Schwelle braucht
// statt bloß ein Vorzeichen: 3 % sind nicht falsch gerechnet, aber auch kein
// Deal — eine einzige Retoure frisst sie. Gewinn und ROI dürfen dagegen nach
// Vorzeichen beurteilt werden, dort ist die Null die einzige interessante
// Grenze.
//
// Die Werte stehen hier und nicht in der Weboberfläche oder im Post, weil
// beide dieselbe Aussage treffen müssen: der Chip in der Marktübersicht und
// die Farbe der Discord-Karte dürfen denselben Deal nicht verschieden
// bewerten.
const (
	MargeGut   = 12.0
	MargeMager = 6.0
)

// Stufe ist die Einordnung einer Marge in gut, mittel oder mager.
type Stufe int

const (
	StufeMager Stufe = iota
	StufeMittel
	StufeGut
)

// MargenStufe ordnet eine Marge ein.
func MargenStufe(prozent float64) Stufe {
	switch {
	case prozent >= MargeGut:
		return StufeGut
	case prozent >= MargeMager:
		return StufeMittel
	default:
		return StufeMager
	}
}
