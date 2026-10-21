// Package post erzeugt den Text, der bei Discord landet.
package post

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"text/template"
)

// MaxLaenge ist Discords Grenze für den Nachrichtentext.
const MaxLaenge = 2000

var ErrZuLang = errors.New("post: Nachricht überschreitet 2000 Zeichen")

// Daten sind die Platzhalter der Vorlage. Alle Felder sind bereits fertig
// formatierte Zeichenketten — die Vorlage soll nicht rechnen oder formatieren
// müssen, damit ein Tippfehler darin nie eine falsche Zahl erzeugen kann.
type Daten struct {
	Titel   string
	ASIN    string
	Mention string

	EKHost string
	EKUrl  string
	// WeitereEK sind zusätzliche Einkaufsquellen; jede bekommt eine eigene
	// 🏬-Zeile unter der ersten.
	WeitereEK []EKLink
	EK        string
	EKNotiz   string

	// MaxMenge ist die Höchstmenge je Bestellung (Cart-Limit) als Zahl,
	// leer wenn keine angegeben ist. Die Vorlage fragt mit {{if}} danach.
	MaxMenge string

	// Zusatz sind freie Zeilen des Posters, etwa "⏳ ETA: 2 Wochen" oder
	// "📦 MOQ: 50 Stück" bei B2B. Sie stehen unter dem Einkaufspreis.
	Zusatz string

	// Poster ist, wer den Deal gepostet hat, fertig für den Post ("@ludwig"
	// oder eine Discord-Erwähnung "<@123>"); leer, wenn niemand gewählt ist.
	Poster string

	VK        string
	VKUrl     string
	Zielmarkt string

	Sales string

	Gewinn        string
	Marge         string // eine Nachkommastelle, etwa "15,3 %"
	MargeGerundet string // ganzzahlig, etwa "15 %"

	// GewinnPanEU und MargePanEU sind derselbe Deal mit der lokalen
	// Versandgebühr des Zielmarkts — also so, wie er für jemanden ausfällt,
	// der dort Bestand liegen hat. Der Unterschied ist erheblich: je nach
	// Größenklasse kostet der Versand aus dem Lagerland das Zwei- bis
	// Fünffache.
	//
	// Beide sind leer, wenn sich der Vergleich nicht bestimmen lässt — beim
	// Ziel im Lagerland etwa gibt es gar keinen zweiten Weg. Die Vorlage
	// fragt darum mit {{if}} danach; eine leere Zahl darf nie als 0,00 €
	// im Post landen.
	GewinnPanEU string
	MargePanEU  string

	// Maerkte sind alle Zielmärkte des Deals, in der Reihenfolge, in der sie
	// gewählt wurden. Die Felder darüber (Zielmarkt, VK, VKUrl, Sales,
	// Gewinn, Marge, MargeGerundet, GewinnPanEU, MargePanEU) tragen daneben
	// weiterhin die Zahlen des Leitmarkts und bleiben ausdrücklich erhalten:
	// Render läuft mit missingkey=error, und ein entferntes Feld ließe jede
	// gespeicherte Vorlage schlagartig nicht mehr rendern. Die Vorlage ist
	// eine Einstellung — sie bekommt eine Änderung an StandardVorlage nie mit.
	Maerkte []MarktDaten

	AOUrl string
	PPUrl string
}

// MarktDaten ist ein Zielmarkt im Post. Wie bei Daten sind alle Felder
// bereits fertig formatierte Zeichenketten — die Vorlage soll nicht rechnen
// müssen, damit ein Tippfehler darin nie eine falsche Zahl erzeugen kann.
//
// GewinnPanEU und MargePanEU sind leer, wo es den Vergleich nicht gibt: beim
// Ziel im Lagerland etwa gibt es keinen zweiten Versandweg. Die Vorlage fragt
// mit {{if}} danach; eine leere Zahl darf nie als 0,00 € im Post landen.
type MarktDaten struct {
	Code  string
	VK    string
	VKUrl string
	Sales string

	Gewinn        string
	Marge         string
	MargeGerundet string

	GewinnPanEU string
	MargePanEU  string
}

// PanEUZeile ist die Zeile des Pan-EU-Vergleichs, einzeln benannt, weil die
// Einstellungsseite sie zum Kopieren anbietet: eine bereits gespeicherte
// Vorlage bekommt eine Änderung an StandardVorlage nicht mit, und niemand
// soll sie aus dem Quelltext abschreiben müssen.
//
// Das {{if}} gehört dazu und ist nicht bloß Vorsicht: ohne es stünde bei
// jedem Deal ins Lagerland eine leere Zeile mit "/ Marge" im Post.
const PanEUZeile = "{{if .GewinnPanEU}}🇪🇺 mit Pan-EU: {{.GewinnPanEU}} / {{.MargePanEU}} Marge\n{{end}}"

// MaxMengeZeile ist die Zeile mit dem Cart-Limit, einzeln benannt aus
// demselben Grund wie PanEUZeile. Nennt eine gespeicherte Vorlage
// .MaxMenge nicht, setzt Render die Zeile selbst unter den Einkaufspreis
// (siehe mitMaxMenge).
const MaxMengeZeile = "{{if .MaxMenge}}📦 Max. {{.MaxMenge}} Stück pro Bestellung\n{{end}}"

// MaerkteZeilen ist der Block, der je Zielmarkt eine Zeile schreibt. Wie
// PanEUZeile wird er einzeln benannt, weil die Einstellungsseite ihn zum
// Kopieren anbietet: eine bereits gespeicherte Vorlage bekommt eine Änderung
// an StandardVorlage nicht mit, und niemand soll sie aus dem Quelltext
// abschreiben müssen.
//
// Das innere {{if}} gehört dazu: ein Markt im Lagerland hat keinen Pan-EU-
// Vergleich, und ohne die Bedingung stünde bei ihm ein "Pan-EU  / " ohne Zahl.
const MaerkteZeilen = "{{range .Maerkte}}💸 [Amazon.{{.Code}}]({{.VKUrl}}): {{.VK}} · " +
	"{{.Sales}} Verk. · 🤑 {{.Gewinn}} / {{.Marge}}" +
	"{{if .GewinnPanEU}} · 🇪🇺 Pan-EU {{.GewinnPanEU}} / {{.MargePanEU}}{{end}}\n{{end}}"

// AlteStandardVorlage ist StandardVorlage, wie sie vor den Marktzeilen
// aussah. Genau diese Zeichenkette liegt in der Datenbank jedes Nutzers, der
// die Einstellungen damals einmal gespeichert hat, ohne die Vorlage selbst
// anzufassen. Der Store tauscht sie beim Start gegen StandardVorlage — eine
// nie veränderte Vorlage soll die neue Form bekommen, ohne dass jemand den
// Block von Hand einfügen muss. Eine tatsächlich angepasste Vorlage bleibt
// unberührt; für sie sorgt Render selbst dafür, dass kein Markt verloren geht.
const AlteStandardVorlage = "🛒 {{.Titel}} {{.ASIN}} {{.Mention}}\n" +
	"🏬 [{{.EKHost}}]({{.EKUrl}})\n" +
	"💰 EK: {{.EK}} {{.EKNotiz}}\n" +
	"💸 VK: {{.VK}}  [Amazon.{{.Zielmarkt}}]({{.VKUrl}})\n" +
	"ℹ️ Amazon.{{.Zielmarkt}}: {{.Sales}} Verkäufe\n" +
	"🤑 Gewinn: {{.Gewinn}} / {{.Marge}} Marge\n" +
	PanEUZeile +
	":bar_chart: [ArbitrageOne Export]({{.AOUrl}})"

// StandardVorlage greift für jeden, der die Vorlage nie gespeichert oder
// geleert hat.
//
// Der Aufbau ist der Post, wie er im Channel stehen soll: Titel mit der
// Erwähnung am Zeilenende, darunter Einkauf, Verkauf, Verkäufe und Gewinn des
// Leitmarkts, dann die Analyse-Links. Weitere Zielmärkte hängt Render von
// selbst unten an (siehe weitereMaerkte).
const StandardVorlage = "🛒 {{.Titel}} {{.Mention}}\n" +
	"🏬 [{{.EKHost}}]({{.EKUrl}})\n" +
	"💰 EK: {{.EK}} {{.EKNotiz}}\n" +
	MaxMengeZeile +
	"💸 VK: {{.VK}}  [Amazon.{{.Zielmarkt}}]({{.VKUrl}})\n" +
	"ℹ️ Amazon.{{.Zielmarkt}}: {{.Sales}} Verkäufe\n" +
	"🤑 Gewinn: {{.Gewinn}} / {{.Marge}} Marge\n" +
	PanEUZeile +
	":bar_chart: [ArbitrageOne Export]({{.AOUrl}})\n" +
	":chart_with_upwards_trend: [ProfitPath Analyse]({{.PPUrl}})"

// VorlageOderStandard liefert die gespeicherte Vorlage oder, wenn keine
// gespeichert ist, StandardVorlage. Eine leere Vorlage hieße einen leeren
// Post.
func VorlageOderStandard(gespeichert string) string {
	if strings.TrimSpace(gespeichert) == "" {
		return StandardVorlage
	}
	return gespeichert
}

// Render setzt die Vorlage mit echten Werten zusammen.
//
// Bewusst text/template statt html/template: das Ziel ist Discord-Markdown,
// und die HTML-Variante würde & und Klammern zu Entitäten verstümmeln.
//
// Kennt die Vorlage .Maerkte nicht, sind aber mehrere Zielmärkte gewählt,
// hängt Render die Zeilen der weiteren Märkte unten an (siehe
// weitereMaerkte). Eine ältere, selbst angepasste Vorlage nennt sonst
// stillschweigend nur den Leitmarkt — und im Discord-Post fehlte der halbe
// Deal, obwohl Schritt 3 jeden Markt durchgerechnet hat.
func Render(vorlage string, d Daten) (string, error) {
	text, err := rendere(vorlage, d)
	if err != nil {
		return "", err
	}
	text = mitErwaehnung(text, vorlage, d.Mention)
	if text, err = mitMaxMenge(text, vorlage, d); err != nil {
		return "", err
	}
	text = mitWeiterenEK(text, vorlage, d)
	text = mitZusatz(text, vorlage, d)
	text = mitASIN(text, d.ASIN)
	if weitere := weitereMaerkte(vorlage, d); len(weitere) > 0 {
		zeilen, err := rendere(MaerkteZeilen, Daten{Maerkte: weitere})
		if err != nil {
			return "", err
		}
		text += "\n" + strings.TrimSuffix(zeilen, "\n")
	}

	// Wer gepostet hat, steht direkt unter dem Titel, vor dem Einkaufslink.
	// Eine Vorlage, die .Poster selbst nennt, bestimmt den Platz.
	if d.Poster != "" && !strings.Contains(vorlage, ".Poster") {
		titel, rest, mehr := strings.Cut(text, "\n")
		text = titel + "\n👤 Deal von " + d.Poster
		if mehr {
			text += "\n" + rest
		}
	}

	// Ein Link ohne Ziel — etwa der Einkauf beim Großhandel ohne Link —
	// steht als schlichter Text da statt als "[Metro]()".
	text = leererLink.ReplaceAllString(text, "$1")

	if len([]rune(text)) > MaxLaenge {
		return "", fmt.Errorf("%w (%d Zeichen)", ErrZuLang, len([]rune(text)))
	}
	return text, nil
}

// mitErwaehnung hängt die Erwähnung ans Ende der ersten Zeile (des Titels),
// wenn die Vorlage einen Titel, aber kein {{.Mention}} enthält. Ohne sie pingte ein
// Deal in einem @everyone-Channel niemanden an.
func mitErwaehnung(text, vorlage, mention string) string {
	if mention == "" || strings.Contains(vorlage, ".Mention") || !strings.Contains(vorlage, ".Titel") {
		return text
	}
	erste, rest, mehr := strings.Cut(text, "\n")
	erste = strings.TrimRight(erste, " ") + " " + mention
	if !mehr {
		return erste
	}
	return erste + "\n" + rest
}

// mitMaxMenge setzt die Cart-Limit-Zeile unter den Einkaufspreis, wenn die
// Vorlage .MaxMenge nicht selbst verwendet. Ohne das käme ein Cart-Limit bei
// jeder älteren, selbst geschriebenen Vorlage nie im Post an.
//
// Gesucht wird die erste Zeile, die den Einkaufspreis nennt; fehlt sie,
// steht die Zeile unter dem Titel.
func mitMaxMenge(text, vorlage string, d Daten) (string, error) {
	if d.MaxMenge == "" || strings.Contains(vorlage, ".MaxMenge") {
		return text, nil
	}
	zeile, err := rendere(MaxMengeZeile, d)
	if err != nil {
		return "", err
	}
	zeilen := strings.Split(text, "\n")
	nach := 0
	for i, z := range zeilen {
		if d.EK != "" && strings.Contains(z, d.EK) {
			nach = i
			break
		}
	}
	zeilen = append(zeilen[:nach+1], append([]string{strings.TrimSuffix(zeile, "\n")}, zeilen[nach+1:]...)...)
	return strings.Join(zeilen, "\n"), nil
}

func rendere(vorlage string, d Daten) (string, error) {
	t, err := template.New("post").Option("missingkey=error").Parse(vorlage)
	if err != nil {
		return "", fmt.Errorf("post: Vorlage nicht lesbar: %w", err)
	}

	var b strings.Builder
	if err := t.Execute(&b, d); err != nil {
		return "", fmt.Errorf("post: Vorlage nicht anwendbar: %w", err)
	}
	return b.String(), nil
}

// weitereMaerkte liefert die Märkte, die eine Vorlage ohne .Maerkte nicht
// von sich aus nennt: alle außer dem Leitmarkt, dessen Zahlen die flachen
// Felder tragen und den die alte Vorlage darum schon zeigt.
//
// Leer, sobald die Vorlage .Maerkte selbst verwendet — dann bestimmt sie
// allein, wie die Märkte erscheinen, und nichts wird doppelt genannt. Leer
// auch bei nur einem Markt: der ist der Leitmarkt und steht bereits da.
//
// strings.Contains statt die Vorlage zu parsen: gesucht wird, ob sie das
// Feld überhaupt erwähnt, und dafür reicht der Name. Ein falscher Treffer
// (etwa ".Maerkte" in einem Kommentar) lässt die Zeilen bloß ausbleiben —
// die Vorschau in Schritt 4 zeigt ohnehin, was hinausgeht.
func weitereMaerkte(vorlage string, d Daten) []MarktDaten {
	if len(d.Maerkte) < 2 || strings.Contains(vorlage, ".Maerkte") {
		return nil
	}
	weitere := make([]MarktDaten, 0, len(d.Maerkte)-1)
	for _, m := range d.Maerkte {
		if m.Code == d.Zielmarkt {
			continue
		}
		weitere = append(weitere, m)
	}
	return weitere
}

// Pruefe stellt fest, ob eine Vorlage benutzbar ist, indem sie mit
// Beispieldaten gerendert wird. Die Einstellungsseite ruft das vor dem
// Speichern auf, damit eine kaputte Vorlage nie aktiv werden kann.
func Pruefe(vorlage string) error {
	_, err := Render(vorlage, beispiel)
	return err
}

var beispiel = Daten{
	Titel: "Beispielartikel", ASIN: "B000000000", Mention: "@everyone",
	EKHost: "amazon.es", EKUrl: "https://www.amazon.es/dp/B000000000",
	EK: "100,00 €", EKNotiz: "Brutto inkl. Versand", MaxMenge: "3",
	VK: "150,00 €", VKUrl: "https://www.amazon.de/dp/B000000000", Zielmarkt: "DE",
	Sales:  "40",
	Gewinn: "20,00 €", Marge: "13,3 %", MargeGerundet: "13 %",
	GewinnPanEU: "31,08 €", MargePanEU: "20,7 %",
	// Zwei Märkte, davon einer mit und einer ohne Vergleich: nur so läuft
	// Pruefe durch beide Zweige des {{if}} in MaerkteZeilen.
	Maerkte: []MarktDaten{
		{Code: "DE", VK: "150,00 €", VKUrl: "https://www.amazon.de/dp/B000000000",
			Sales: "40", Gewinn: "20,00 €", Marge: "13,3 %", MargeGerundet: "13 %"},
		{Code: "IT", VK: "155,00 €", VKUrl: "https://www.amazon.it/dp/B000000000",
			Sales: "12", Gewinn: "8,40 €", Marge: "5,4 %", MargeGerundet: "5 %",
			GewinnPanEU: "19,48 €", MargePanEU: "12,6 %"},
	},
	AOUrl: "https://app.arbitrageone.de/analyze?via=fbaresell",
	PPUrl: "https://profitpath.app/redirect?storefront=de&query=B000000000",
}

var leererLink = regexp.MustCompile(`\[([^\]]*)\]\(\s*\)`)

// mitZusatz setzt die freien Zeilen unter den Einkaufspreis und, falls da,
// unter die Cart-Limit-Zeile. Eine Vorlage, die .Zusatz selbst nennt,
// bestimmt den Platz; fehlt die EK-Zeile, stehen sie unter dem Titel.
func mitZusatz(text, vorlage string, d Daten) string {
	var neu []string
	for _, z := range strings.Split(strings.ReplaceAll(d.Zusatz, "\r", ""), "\n") {
		if z = strings.TrimSpace(z); z != "" {
			neu = append(neu, z)
		}
	}
	if len(neu) == 0 || strings.Contains(vorlage, ".Zusatz") {
		return text
	}
	zeilen := strings.Split(text, "\n")
	nach := 0
	for i, z := range zeilen {
		if d.EK != "" && strings.Contains(z, d.EK) {
			nach = i
			if i+1 < len(zeilen) && strings.Contains(zeilen[i+1], "Max. "+d.MaxMenge+" Stück") {
				nach = i + 1
			}
			break
		}
	}
	zeilen = append(zeilen[:nach+1], append(neu, zeilen[nach+1:]...)...)
	return strings.Join(zeilen, "\n")
}

// mitASIN setzt eine eigene Zeile mit der ASIN in den Post, damit man in
// Discord danach suchen kann — im Link findet Discords Suche sie nicht
// zuverlässig. Die Zeile steht über den Analyse-Links (ArbitrageOne,
// ProfitPath), ohne die am Ende — aber vor den Zeilen weiterer Märkte,
// die Render danach anhängt.
//
// Maßgeblich ist, ob die ASIN im Post lesbar dasteht, nicht ob die Vorlage
// .ASIN nennt: eine Vorlage kann sie nur in einem Link verwenden, und dann
// fehlte die Zeile genau dort, wo sie gebraucht wird. Ein Teilstück ohne
// Zeilenumbruch (etwa nur .MargeGerundet) bleibt, wie es ist.
func mitASIN(text, asin string) string {
	if asin == "" || !strings.Contains(text, "\n") {
		return text
	}
	sichtbar := linkZiel.ReplaceAllString(text, "")
	sichtbar = nackteURL.ReplaceAllString(sichtbar, "")
	if strings.Contains(strings.ToUpper(sichtbar), strings.ToUpper(asin)) {
		return text
	}
	zeile := "🔢 ASIN: " + asin
	zeilen := strings.Split(text, "\n")
	for i, z := range zeilen {
		k := strings.ToLower(z)
		if i > 0 && (strings.Contains(k, "arbitrageone") || strings.Contains(k, "profitpath")) {
			zeilen = append(zeilen[:i], append([]string{zeile}, zeilen[i:]...)...)
			return strings.Join(zeilen, "\n")
		}
	}
	return text + "\n" + zeile
}

var (
	// linkZiel ist der Adressteil eines Markdown-Links: "(https://…)".
	linkZiel = regexp.MustCompile(`\]\(<?[^)]*>?\)`)
	// nackteURL ist eine Adresse ohne Linktext.
	nackteURL = regexp.MustCompile(`<?https?://\S+>?`)
)

// EKLink ist eine weitere Einkaufsquelle.
type EKLink struct {
	Host string
	URL  string
}

// mitWeiterenEK setzt die weiteren Einkaufsquellen unter die erste, im
// selben Format. Fehlt die erste im Text, stehen sie unter dem Titel; eine
// Vorlage, die .WeitereEK selbst nennt, bestimmt den Platz.
func mitWeiterenEK(text, vorlage string, d Daten) string {
	if len(d.WeitereEK) == 0 || strings.Contains(vorlage, ".WeitereEK") {
		return text
	}
	var neu []string
	for _, l := range d.WeitereEK {
		neu = append(neu, "🏬 ["+l.Host+"]("+l.URL+")")
	}
	zeilen := strings.Split(text, "\n")
	nach := 0
	for i, z := range zeilen {
		if d.EKUrl != "" && strings.Contains(z, d.EKUrl) {
			nach = i
			break
		}
	}
	zeilen = append(zeilen[:nach+1], append(neu, zeilen[nach+1:]...)...)
	return strings.Join(zeilen, "\n")
}
