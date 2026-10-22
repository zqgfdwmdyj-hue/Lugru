package web

import (
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/calc"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
)

// rechnungBlock ist ein Abschnitt der Aufschlüsselung in Schritt 3.
//
// Die Aufschlüsselung entsteht hier in Go und nicht in der Vorlage:
// html/template kann nicht rechnen, und jede Zeile, die eine Vorlage sich
// selbst zusammenrechnet, wäre eine zweite Stelle, an der eine Zahl
// entstehen könnte, die von calc nie geprüft wurde. Alle Werte hier stammen
// aus genau einem calc.Ergebnis.
type rechnungBlock struct {
	Titel  string
	Zeilen []rechnungZeile
}

// rechnungZeile ist eine Zeile der Aufschlüsselung.
//
// Die Beträge stehen ohne Vorzeichen da; was mit ihnen geschieht, sagt das
// Zeichen links davor ("−", "+", "=" oder gar keines) — wie auf einem
// Kassenbon, der sich von oben nach unten mitlesen lässt.
type rechnungZeile struct {
	Zeichen     string
	Bezeichnung string
	Wert        string
	Betonung    bool

	// Klasse färbt den Betrag einer Ergebniszeile: "positiv", "negativ"
	// oder "neutral" (siehe zahlklasse). Leer bei allen Zeilen, deren Zahl
	// kein Ergebnis ist — ein grüner Einkaufspreis behauptete etwas, das
	// keine Rechnung hergibt.
	Klasse string
}

// Art ordnet die Zeile nach ihrem Rechenzeichen ein, damit das Stylesheet
// Abzüge, Zuschläge und Summen unterschiedlich färben kann, ohne den Text
// der Zelle zu kennen: "abzug", "zuschlag", "summe" oder leer.
func (z rechnungZeile) Art() string {
	switch z.Zeichen {
	case "−":
		return "abzug"
	case "+":
		return "zuschlag"
	case "=":
		return "summe"
	}
	return ""
}

// rechnungBloecke schlüsselt einen Zielmarkt eines Deals auf: erst der
// Einkauf, dann der Verkauf, dann das, was übrig bleibt.
//
// Der Markt wird ausdrücklich übergeben statt aus e gegriffen: ein Deal hat
// mehrere, und der Kassenbon gilt immer genau einem.
func rechnungBloecke(e dealErgebnis, m marktErgebnis) []rechnungBlock {
	erg := m.Ergebnis
	ekUSt := erg.EKBrutto - erg.EKNetto

	einkauf := rechnungBlock{Titel: "Einkauf bei " + e.QuellHost}
	if e.EKArt == calc.EKAlsNetto {
		// Netto eingegeben: die Umsatzsteuer kommt oben drauf, statt
		// herausgerechnet zu werden. Die Zeilen folgen der Rechenrichtung.
		einkauf.Zeilen = []rechnungZeile{
			{Bezeichnung: "Einkaufspreis netto (eingegeben)", Wert: erg.EKNetto.Euro()},
			{Zeichen: "+", Bezeichnung: "Umsatzsteuer " + ustText(e.Quell.Code, e.QuellUStPermille), Wert: ekUSt.Euro()},
			{Zeichen: "=", Bezeichnung: "Einkaufspreis brutto", Wert: erg.EKBrutto.Euro()},
		}
	} else {
		einkauf.Zeilen = []rechnungZeile{
			{Bezeichnung: "Einkaufspreis brutto (eingegeben)", Wert: erg.EKBrutto.Euro()},
			{Zeichen: "−", Bezeichnung: "Vorsteuer " + ustText(e.Quell.Code, e.QuellUStPermille), Wert: ekUSt.Euro()},
			{Zeichen: "=", Bezeichnung: "Einkaufspreis netto", Wert: erg.EKNetto.Euro()},
		}
	}

	verkauf := rechnungBlock{
		Titel: "Verkauf über Amazon." + string(m.Ziel.Code),
		Zeilen: []rechnungZeile{
			{Bezeichnung: "Verkaufspreis brutto", Wert: m.VKBrutto.Euro()},
			{Zeichen: "−", Bezeichnung: "Umsatzsteuer " + ustText(m.Ziel.Code, m.ZielUStPermille),
				Wert: (m.VKBrutto - erg.VKNetto).Euro()},
			{Zeichen: "=", Bezeichnung: "Verkaufserlös netto", Wert: erg.VKNetto.Euro()},
		},
	}

	// Welche der beiden Einkaufsgrößen den Gewinn drückt, hängt allein daran,
	// ob die Vorsteuer abziehbar ist — genau die Frage, die der Schalter
	// "Vorsteuer nicht abziehbar" in Schritt 2 stellt. Die Zeile benennt das
	// ausdrücklich, damit niemand die Zahl mit der Zeile darüber verwechselt.
	ekBezeichnung, ekWert := "Einkauf netto", erg.EKNetto
	if e.UStModus == calc.Brutto {
		ekBezeichnung, ekWert = "Einkauf brutto (Vorsteuer nicht abziehbar)", erg.EKBrutto
	}

	margenBezug := "auf VK brutto"
	if e.MargenBasis == calc.AufNetto {
		margenBezug = "auf VK netto"
	}

	ergebnis := rechnungBlock{
		Titel: "Ergebnis",
		Zeilen: []rechnungZeile{
			{Bezeichnung: "Verkaufserlös netto", Wert: erg.VKNetto.Euro()},
			// Die Basis steht ausdrücklich dabei: die Zeile darüber nennt den
			// Nettoerlös, die Gebühr bemisst sich aber am Bruttopreis (so
			// rechnet Amazon ab). Ohne den Zusatz sieht die Aufschlüsselung
			// für jeden, der nachrechnet, nach einem Fehler aus.
			{Zeichen: "−", Bezeichnung: "Provision " + zahlText(m.Provision) + " % (auf VK brutto)", Wert: erg.Provision.Euro()},
			{Zeichen: "−", Bezeichnung: "FBA-Gebühr", Wert: m.FBA.Euro()},
			{Zeichen: "−", Bezeichnung: ekBezeichnung, Wert: ekWert.Euro()},
			{Zeichen: "=", Bezeichnung: "Gewinn", Wert: erg.Gewinn.Euro(), Betonung: true,
				Klasse: zahlklasse(float64(erg.Gewinn))},
			// Die Marge färbt nach Schwelle und nicht nach Vorzeichen — hier
			// wie in der Übersicht. Dieselbe Zahl darf nicht an zwei Stellen
			// zwei Farben tragen; wer die Karte aufklappt, vergleicht sie
			// unweigerlich mit dem Chip, aus dem er kommt.
			{Bezeichnung: "Marge (" + margenBezug + ")", Wert: prozent(erg.MargeProzent, 1), Betonung: true,
				Klasse: margenklasse(erg.MargeProzent)},
		},
	}

	bloecke := []rechnungBlock{einkauf, verkauf, ergebnis}

	// Der Vergleich steht als eigener Block hinten, nicht als Zeile im
	// Ergebnis: er gehört nicht zu dieser Rechnung, sondern ist eine zweite,
	// vollständige Rechnung mit einer anderen Gebühr. Ihn zwischen die
	// Zeilen des Kassenbons zu setzen, hieße zwei Ergebnisse zu einem zu
	// verrühren.
	if m.PanEU != nil {
		bloecke = append(bloecke, rechnungBlock{
			Titel: "Zum Vergleich: mit Bestand in " + string(m.Ziel.Code) + " (Pan-EU)",
			Zeilen: []rechnungZeile{
				// Beide Gebühren stehen nebeneinander: oben die des Deals,
				// hier Amazons lokaler Tarif. Sie können aus verschiedenen
				// Quellen stammen — die obere darf von Hand gesetzt sein —,
				// und dann wäre eine bloße Differenz irreführend.
				{Zeichen: "−", Bezeichnung: "FBA-Gebühr lokal (statt " + m.FBA.Euro() + ")", Wert: m.PanEUGebuehr.Euro()},
				{Zeichen: "=", Bezeichnung: "Gewinn", Wert: m.PanEU.Gewinn.Euro(), Betonung: true,
					Klasse: zahlklasse(float64(m.PanEU.Gewinn))},
				{Bezeichnung: "Marge (" + margenBezug + ")", Wert: prozent(m.PanEU.MargeProzent, 1),
					Klasse: margenklasse(m.PanEU.MargeProzent)},
				{Bezeichnung: "Unterschied je Einheit", Wert: (m.PanEU.Gewinn - erg.Gewinn).Euro(),
					Klasse: zahlklasse(float64(m.PanEU.Gewinn - erg.Gewinn))},
			},
		})
	}

	return bloecke
}

// marktErgebnisZeile ist eine Zeile der Ergebnisübersicht in Schritt 3 und 4:
// ein Zielmarkt mit allem, was über ihn zu sagen ist.
//
// Zeilen sind die Märkte und nicht die Größen: die Frage, welcher Markt trägt,
// liest sich so von oben nach unten. Andersherum wuchs die Übersicht mit jedem
// weiteren Markt nach rechts aus dem Bild.
//
// Bloecke trägt die vollständige Aufschlüsselung genau dieses Marktes mit —
// sie steht hinter dem Taschenrechner am Zeilenende. Jede Zeile bringt ihre
// eigene mit: der frühere einzelne Kassenbon unter der Übersicht zeigte immer
// nur einen Markt, und welcher es war, musste ein Klick und eine zweite
// Anfrage klären.
type marktErgebnisZeile struct {
	Code      string
	Leitmarkt bool

	// UStSatz ist der Steuersatz des Zielmarktes ("19 %"), ohne Länderkürzel:
	// in welchem Land man ist, sagt die Zeile schon.
	UStSatz string

	Sales       string
	SalesKlasse string
	VK          string

	FBA    string
	Gewinn string
	Marge  string

	// ROI ist der Gewinn auf das bezogen, was tatsächlich im Artikel steckt —
	// netto, und brutto, wo die Vorsteuer nicht abziehbar ist. Dieselbe Größe
	// also, die im Kassenbon den Gewinn drückt, und keine zweite Wahrheit.
	ROI string

	// Bloecke ist der Kassenbon dieses Marktes: Einkauf, Verkauf, Ergebnis
	// und, wo es ihn gibt, der Pan-EU-Vergleich.
	Bloecke []rechnungBlock

	// Die drei Pan-EU-Felder sind leer, wo es den Vergleich nicht gibt. Die
	// Vorlage fragt mit {{if}} danach; ein "0,00 €" stünde sonst als Aussage
	// da, die niemand gerechnet hat.
	FBAPanEU    string
	GewinnPanEU string
	MargePanEU  string

	// Die Chip-Farben zu Gewinn und Marge. Der Gewinn färbt nach Vorzeichen
	// (zahlklasse), die Marge nach Schwelle (margenklasse).
	// Die Pan-EU-Klassen bleiben leer, wo es den Vergleich nicht gibt.
	GewinnKlasse      string
	MargeKlasse       string
	GewinnPanEUKlasse string
	MargePanEUKlasse  string
}

// RechnerKlasse färbt den Taschenrechner am Zeilenende: grün, wo etwas übrig
// bleibt, rot, wo nicht. Die Farbe beantwortet die Frage schon, bevor jemand
// die Rechnung dahinter aufklappt.
func (z marktErgebnisZeile) RechnerKlasse() string {
	if z.GewinnKlasse == "negativ" {
		return "schlecht"
	}
	return "gut"
}

// ergebnisUebersicht baut die Zeilen der Übersicht — je Zielmarkt eine, jede
// mit ihrer eigenen vollständigen Aufschlüsselung.
func ergebnisUebersicht(e dealErgebnis) []marktErgebnisZeile {
	zeilen := make([]marktErgebnisZeile, 0, len(e.Maerkte))
	for _, m := range e.Maerkte {
		z := marktErgebnisZeile{
			Code:      string(m.Ziel.Code),
			Leitmarkt: m.Leitmarkt,
			UStSatz:   ustSatz(m.ZielUStPermille),
			Sales:     salesText(m),
			VK:        m.VKBrutto.Euro(),
			FBA:       m.FBA.Euro(),
			Gewinn:    m.Ergebnis.Gewinn.Euro(),
			Marge:     prozent(m.Ergebnis.MargeProzent, 1),
			ROI:       roiText(e, m),
			Bloecke:   rechnungBloecke(e, m),

			SalesKlasse:  salesklasse(m),
			GewinnKlasse: zahlklasse(float64(m.Ergebnis.Gewinn)),
			MargeKlasse:  margenklasse(m.Ergebnis.MargeProzent),
		}
		if m.PanEU != nil {
			z.FBAPanEU = m.PanEUGebuehr.Euro()
			z.GewinnPanEU = m.PanEU.Gewinn.Euro()
			z.MargePanEU = prozent(m.PanEU.MargeProzent, 1)
			z.GewinnPanEUKlasse = zahlklasse(float64(m.PanEU.Gewinn))
			z.MargePanEUKlasse = zahlklasse(m.PanEU.MargeProzent)
		}
		zeilen = append(zeilen, z)
	}
	return zeilen
}

// ustText schreibt einen Satz in Promille als Prozentangabe mit Länderkürzel:
// 210 -> "ES 21 %", 195 -> "DE 19,5 %".
func ustText(land marketplace.Code, permille int) string {
	return string(land) + " " + ustSatz(permille)
}

// ustSatz ist dasselbe ohne Länderkürzel: 210 -> "21 %", 195 -> "19,5 %".
// In der Marktübersicht steht das Land schon in derselben Zelle.
func ustSatz(permille int) string {
	zahl := strconv.Itoa(permille / 10)
	if rest := permille % 10; rest != 0 {
		zahl += "," + strconv.Itoa(rest)
	}
	return zahl + " %"
}

// margenklasse färbt die Marge nach Schwelle statt nach Vorzeichen.
//
// Die Schwellen selbst stehen in calc und nicht hier: die Discord-Karte
// färbt ihren Rand nach denselben, und derselbe Deal darf nicht an zwei
// Stellen verschieden bewertet aussehen.
func margenklasse(prozent float64) string {
	switch calc.MargenStufe(prozent) {
	case calc.StufeGut:
		return "positiv"
	case calc.StufeMittel:
		return "mittel"
	default:
		return "negativ"
	}
}

// salesText ist die Verkaufszahl, wie sie in der Spalte steht. Ohne Angabe
// ein Strich: "0" wäre die Aussage, dass sich der Artikel nicht verkauft —
// und die hat niemand getroffen.
func salesText(m marktErgebnis) string {
	if !m.SalesBekannt {
		return "—"
	}
	return strconv.Itoa(m.Sales)
}

// salesklasse hebt die beiden Enden hervor: gar keine Verkäufe sind ein
// Warnzeichen, viele ein Argument. Dazwischen bleibt die Zahl unbunt — sonst
// wäre die Spalte durchgehend eingefärbt und damit wieder nichtssagend. Eine
// fehlende Angabe färbt gar nicht: sie sagt nichts über den Artikel.
func salesklasse(m marktErgebnis) string {
	switch {
	case !m.SalesBekannt:
		return "neutral"
	case m.Sales <= 0:
		return "negativ"
	case m.Sales >= 100:
		return "akzent"
	default:
		return "neutral"
	}
}

// roiText ist der Gewinn bezogen auf den Einsatz: den Einkauf netto, und
// brutto dort, wo die Vorsteuer nicht abziehbar ist. Genau die Größe also,
// die im Kassenbon eine Zeile darüber den Gewinn drückt.
//
// Ohne Einsatz gibt es kein Verhältnis: ein Einkauf zu 0,00 € ergäbe eine
// Division durch null, und "unendlich" ist keine Kennzahl, mit der sich
// entscheiden lässt. Dann bleibt das Feld leer.
func roiText(e dealErgebnis, m marktErgebnis) string {
	einsatz := m.Ergebnis.EKNetto
	if e.UStModus == calc.Brutto {
		einsatz = m.Ergebnis.EKBrutto
	}
	if einsatz == 0 {
		return ""
	}
	return prozent(float64(m.Ergebnis.Gewinn)/float64(einsatz)*100, 1)
}

// zahlText schreibt eine Zahl ohne überflüssige Nullen und mit deutschem
// Komma: 15 -> "15", 8.5 -> "8,5".
func zahlText(v float64) string {
	return strings.Replace(strconv.FormatFloat(v, 'f', -1, 64), ".", ",", 1)
}
