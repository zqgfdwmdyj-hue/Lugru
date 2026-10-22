// Die Rechnung des Deal-Funnels: aus dem Formular wird ein Ergebnis und aus
// dem Ergebnis der Post-Text. Getrennt von den Handlern in deal.go, weil hier
// die Zahlen entstehen, die am Ende veröffentlicht werden — sie sollen ohne
// HTTP-Umgebung im Blick zu behalten sein.
package web

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/calc"
	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// marktErgebnis ist ein Zielmarkt eines Deals, durchgerechnet.
type marktErgebnis struct {
	Ziel      marketplace.Marketplace
	Leitmarkt bool

	Ergebnis calc.Ergebnis

	VKBrutto money.Cents
	FBA      money.Cents
	// Sales ist die Verkaufszahl des Marktes, SalesBekannt sagt, ob sie
	// überhaupt angegeben war. Zwei Felder statt einer verabredeten Zahl:
	// "keine Angabe" und "null Verkäufe" sind zwei verschiedene Aussagen,
	// und die zweite ist ein Warnzeichen, das die erste nicht rechtfertigt.
	Sales        int
	SalesBekannt bool
	// SalesPlus: die Zahl wurde als Mindestwert eingegeben ("50+").
	SalesPlus bool

	Provision float64

	ZielUStPermille int

	// PanEU ist derselbe Markt noch einmal, gerechnet mit der lokalen
	// Versandgebühr statt der des Versandnetzwerks — also so, wie er für
	// jemanden ausfiele, der dort Bestand liegen hat.
	//
	// nil, wenn er sich nicht bestimmen lässt: bei einem Ziel im Lagerland
	// (dort gibt es keinen zweiten Weg), ohne Maße von Keepa, ohne passende
	// Klasse oder wenn der Staffel einer der beiden Tarife fehlt. Eine halbe
	// Vergleichszahl wäre schlimmer als keine.
	PanEU        *calc.Ergebnis
	PanEUGebuehr money.Cents

	ChartURL string
}

// dealErgebnis ist ein durchgerechneter Deal: die Einkaufsseite einmal, die
// Verkaufsseite je Zielmarkt.
//
// Es trägt neben dem Ergebnis auch die Größen mit, aus denen es entstanden
// ist — die Aufschlüsselung in Schritt 3 zeigt sie Zeile für Zeile, und ohne
// sie ließe sie sich nicht ohne zweite, womöglich abweichende Rechnung bauen.
// Bei den marktabhängigen Größen steht dieser Grund jetzt an marktErgebnis;
// die Aussage gilt unverändert, sie ist nur mitgewandert.
type dealErgebnis struct {
	// Text ist der Post, genau so, wie er an Discord geht und in der
	// Historie landet.
	Text string

	// MaxMenge ist das geprüfte Cart-Limit, 0 für keines.
	MaxMenge int

	Quell     marketplace.Marketplace
	QuellHost string // Fremdshop-Host oder "amazon.es"
	QuellURL  string // Einkaufslink, immer gefüllt
	Extern    bool

	Channel store.Channel

	EKArt            calc.EKArt
	UStModus         calc.USt
	QuellUStPermille int
	MargenBasis      calc.Basis

	// Maerkte sind die Zielmärkte in Auswahlreihenfolge, mindestens einer:
	// rechneDeal bricht vorher ab, wenn keiner gewählt ist.
	Maerkte []marktErgebnis
}

// Markt sucht einen Zielmarkt im Ergebnis.
func (e dealErgebnis) Markt(c marketplace.Code) (marktErgebnis, bool) {
	for _, m := range e.Maerkte {
		if m.Ziel.Code == c {
			return m, true
		}
	}
	return marktErgebnis{}, false
}

// Leit liefert den Leitmarkt. Ohne Märkte der Nullwert — dieselbe Regel wie
// bei dealFormular.Leit, und aus demselben Grund.
func (e dealErgebnis) Leit() marktErgebnis {
	for _, m := range e.Maerkte {
		if m.Leitmarkt {
			return m
		}
	}
	if len(e.Maerkte) > 0 {
		return e.Maerkte[0]
	}
	return marktErgebnis{}
}

// asinMuster ist dieselbe Form, die marketplace.ParseEinkaufslink bereits auf
// dem Eingabepfad durchsetzt (siehe dort nackteASIN). formularLesen liest die
// ASIN dagegen ungeprüft aus dem Formular — nur getrimmt und großgeschrieben
// — und sendeDeal reicht sie unmittelbar an store.ChartSpeichern weiter, das
// daraus per filepath.Join einen Dateinamen baut. Ohne diese Prüfung könnte
// eine von Hand gebaute Anfrage mit z. B. "asin=../../../SOMEWHERE" aus dem
// Chart-Ordner ausbrechen (M8 im Abschluss-Review).
var asinMuster = regexp.MustCompile(`^[A-Z0-9]{10}$`)

// rechneDeal wertet die Zahlen eines Deals aus, ohne den Post-Text zu bauen.
//
// Schritt 3 rechnet bei jedem Tastendruck neu, und dabei darf nichts
// scheitern, was mit der Rechnung nichts zu tun hat: der Artikelname darf
// noch leer sein und die Verkaufszahl noch fehlen, ohne dass die
// Aufschlüsselung verschwindet. Alles, was ausschließlich im Post landet,
// prüft darum erst baueDeal.
func (srv *Server) rechneDeal(f dealFormular) (dealErgebnis, error) {
	if !asinMuster.MatchString(f.ASIN) {
		return dealErgebnis{}, fmt.Errorf("ungültige ASIN %q", f.ASIN)
	}

	quell, ok := marketplace.ByCode(marketplace.Code(f.Quellmarkt))
	if !ok {
		return dealErgebnis{}, fmt.Errorf("unbekanntes Einkaufsland %q", f.Quellmarkt)
	}
	if len(f.Maerkte) == 0 {
		return dealErgebnis{}, errors.New("Bitte mindestens einen Zielmarktplatz wählen")
	}

	ek, err := money.Parse(f.EK)
	if err != nil {
		return dealErgebnis{}, fmt.Errorf("Einkaufspreis: %w", err)
	}

	ustModus := calc.Netto
	if f.UStModus == "brutto" {
		ustModus = calc.Brutto
	}
	ekArt := calc.EKAlsBrutto
	if f.EKArt == "netto" {
		ekArt = calc.EKAlsNetto
	}
	basis := calc.AufBrutto
	if srv.store.Einstellung(store.SchluesselMargenBasis) == "netto" {
		basis = calc.AufNetto
	}
	quellUSt := srv.ustFuer(quell.Code, f.Steuersatz)

	// Die Einkaufsseite gilt für alle Märkte gleich. Sie wird einmal
	// zusammengestellt und je Markt um die Verkaufsseite ergänzt — als Wert
	// übergeben, damit keine Schleifenrunde die nächste beeinflusst.
	grund := calc.Eingabe{
		EK:               ek,
		EKArt:            ekArt,
		QuellUStPermille: quellUSt,
		UStModus:         ustModus,
		MargenBasis:      basis,
	}

	erg := dealErgebnis{
		Quell: quell, EKArt: ekArt,
		UStModus: ustModus, QuellUStPermille: quellUSt, MargenBasis: basis,
	}
	for _, mf := range f.Maerkte {
		me, err := srv.rechneMarkt(f, mf, grund)
		if err != nil {
			// Der Markt steht vorn im Fehler. Ohne ihn stünde in Schritt 3
			// "Verkaufspreis: kein gültiger Betrag" über vier Spalten, ohne
			// zu sagen, welche gemeint ist.
			return dealErgebnis{}, fmt.Errorf("Amazon.%s — %w", mf.Code, err)
		}
		me.Leitmarkt = mf.Code == f.Leitmarkt
		erg.Maerkte = append(erg.Maerkte, me)
	}

	// Beim Einkauf über einen Fremdshop steht der Link selbst im Post; nur
	// bei Amazon lässt er sich aus Markt und ASIN bauen.
	//
	// Geprüft wird er auch hier noch einmal, obwohl Schritt 1 ihn bereits
	// geprüft hat: formularLesen liest das Feld ungeprüft aus dem Formular,
	// und von hier führt der Wert unmittelbar in den Discord-Post — also in
	// fremdes Markdown, das keine Vorlage dieses Programms mehr entschärfen
	// kann (M8 im Abschluss-Review).
	erg.QuellHost = strings.TrimPrefix(quell.Host, "www.")
	erg.QuellURL = quell.ProductURL(f.ASIN)
	erg.Extern = f.QuellURL != ""
	if f.OhneLink {
		// Großhandel: kein Link, der Name des Lieferanten steht als Text im
		// Post. Extern, weil es kein Amazon-Einkauf ist — der Einkaufslink
		// bekommt damit auch keinen Affiliate-Tag angehängt.
		erg.QuellHost, erg.QuellURL, erg.Extern = lieferantAnzeige(f.Lieferant), "", true
		return erg, nil
	}
	if erg.Extern {
		host, link, err := fremdQuelle(f.QuellURL)
		if err != nil {
			return dealErgebnis{}, fmt.Errorf("Einkaufslink: %w", err)
		}
		erg.QuellHost, erg.QuellURL = host, link
	}
	return erg, nil
}

// vkFuerZielMarge sucht centgenau den kleinsten Verkaufspreis, der die
// gewünschte Marge mit derselben calc.Rechne-Logik wie die normale
// Dealberechnung erreicht.
func vkFuerZielMarge(grund calc.Eingabe, zielMarge float64) (money.Cents, error) {
	if math.IsNaN(zielMarge) || math.IsInf(zielMarge, 0) || zielMarge <= -100 || zielMarge >= 100 {
		return 0, fmt.Errorf("Ziel-Marge muss größer als -100 und kleiner als 100 sein")
	}

	var letzter money.Cents = 10000000 // 100.000,00 €
	grund.VKBrutto = letzter
	if calc.Rechne(grund).MargeProzent < zielMarge {
		return 0, fmt.Errorf("Ziel-Marge %.2f %% ist mit einem Verkaufspreis bis 100.000,00 € nicht erreichbar", zielMarge)
	}

	links, rechts := money.Cents(0), letzter
	for links < rechts {
		mitte := links + (rechts-links)/2
		grund.VKBrutto = mitte
		if calc.Rechne(grund).MargeProzent >= zielMarge {
			rechts = mitte
		} else {
			links = mitte + 1
		}
	}
	return links, nil
}

// rechneMarkt wertet einen einzelnen Zielmarkt aus. grund trägt die
// Einkaufsseite und wird als Wert übergeben; die Verkaufsseite kommt hier
// dazu.
func (srv *Server) rechneMarkt(f dealFormular, mf marktFormular, grund calc.Eingabe) (marktErgebnis, error) {
	// mf.Code stammt aus marketplace.Codes und ist damit bereits bestätigt;
	// die Prüfung steht trotzdem da, weil rechneMarkt für sich allein
	// einstehen soll.
	ziel, ok := marketplace.ByCode(mf.Code)
	if !ok {
		return marktErgebnis{}, fmt.Errorf("unbekannter Zielmarktplatz %q", mf.Code)
	}

	vk, err := money.Parse(mf.VK)
	if err != nil {
		return marktErgebnis{}, fmt.Errorf("Verkaufspreis: %w", err)
	}

	// Die FBA-Gebühr darf leer sein und zählt dann als 0 — sie hat bewusst
	// keinen geratenen Vorgabewert.
	var gebuehr money.Cents
	if strings.TrimSpace(mf.FBA) != "" {
		if gebuehr, err = money.Parse(mf.FBA); err != nil {
			return marktErgebnis{}, fmt.Errorf("FBA-Gebühr: %w", err)
		}
	}

	provision, err := strconv.ParseFloat(strings.Replace(strings.TrimSpace(mf.Provision), ",", ".", 1), 64)
	if err != nil {
		return marktErgebnis{}, fmt.Errorf("Provision: %q ist keine Zahl", mf.Provision)
	}

	// Die Verkaufszahl geht in keine Zeile der Rechnung ein, steht aber in
	// der Übersicht — sie wird darum hier gelesen und nicht erst beim Bauen
	// des Posts. Anders als Preis und Provision darf sie fehlen: wer das
	// Feld zum Ändern leert, soll nicht zusehen müssen, wie die ganze
	// Aufschlüsselung verschwindet. Was sich nicht lesen lässt, gilt als
	// "nicht angegeben" und wird nie stillschweigend zu 0 — fürs Posten
	// verlangt baueDeal weiterhin eine Zahl.
	// "50+" wie bei Amazons Badge: gerechnet wird mit 50, im Post steht
	// "50+".
	sales, salesBekannt := 0, false
	salesText := strings.TrimSpace(mf.Sales)
	salesPlus := strings.HasSuffix(salesText, "+")
	if n, err := strconv.Atoi(strings.TrimSpace(strings.TrimSuffix(salesText, "+"))); err == nil {
		sales, salesBekannt = n, true
	}

	zielUSt := srv.ustFuer(ziel.Code, f.Steuersatz)
	grund.ZielUStPermille = zielUSt
	grund.ProvisionProzent = provision
	grund.FBA = gebuehr

	// Eine optionale Ziel-Marge bestimmt den notwendigen Verkaufspreis.
	if strings.TrimSpace(mf.ZielMarge) != "" {
		zielMarge, err := strconv.ParseFloat(strings.Replace(strings.TrimSpace(mf.ZielMarge), ",", ".", 1), 64)
		if err != nil {
			return marktErgebnis{}, fmt.Errorf("Ziel-Marge: %q ist keine Zahl", mf.ZielMarge)
		}
		vk, err = vkFuerZielMarge(grund, zielMarge)
		if err != nil {
			return marktErgebnis{}, err
		}
	}

	grund.VKBrutto = vk

	me := marktErgebnis{
		Ziel:     ziel,
		Ergebnis: calc.Rechne(grund),
		VKBrutto: vk, FBA: gebuehr, Sales: sales, SalesBekannt: salesBekannt, SalesPlus: salesPlus, Provision: provision,
		ZielUStPermille: zielUSt,
		ChartURL:        f.chartURL(string(ziel.Code)),
	}

	// Dieselbe Rechnung ein zweites Mal, mit der lokalen Gebühr des
	// Zielmarkts: das ist der Gewinn für jemanden, der dort Bestand liegen
	// hat statt aus dem Lagerland zu liefern.
	//
	// Eingesetzt wird der lokale Tarif unmittelbar — nicht die eingetragene
	// Gebühr abzüglich der Differenz beider Tarife. Der Abzug stimmte nur,
	// solange im Feld exakt der EFN-Tabellenpreis steht; nach einer Korrektur
	// von Hand ergäbe er eine erfundene Zahl, und die stünde anschließend im
	// Post. Von Hand einzugreifen ist aber ausdrücklich vorgesehen (R1).
	//
	// Gerechnet wird über calc.Rechne und nicht über die Differenz der
	// Gebühren, obwohl das kürzer wäre: Marge und Gewinn sollen aus derselben
	// Funktion kommen wie die Hauptzahlen — eine zweite Formel wäre eine
	// zweite Wahrheit, die irgendwann abweicht.
	if lokal, ok := srv.lokalerTarif(ziel.Code, f.Masse); ok {
		grund.FBA = lokal
		zweite := calc.Rechne(grund)
		me.PanEU, me.PanEUGebuehr = &zweite, lokal
	}
	return me, nil
}

// vkTag löst den Affiliate-Tag des Verkaufslinks auf.
//
// Vier Zustände, in dieser Reihenfolge:
//
//	Feld nicht gesendet                Standard-Tag des Zielmarkts
//	tag.<MARKT> = 0                    kein Tag (ausdrückliche Wahl in Schritt 4)
//	tag.<MARKT> zeigt auf den Ziel-Tag  dieser Tag
//	tag.<MARKT> zeigt woanders hin      Standard-Tag des Zielmarkts
//
// Der letzte Fall ist kein Angriff, sondern Alltag: wer aus Schritt 4
// zurückgeht und in Schritt 2 den Zielmarkt wechselt, trägt eine Tag-ID des
// alten Marktes mit. Sie still auf den Standard des neuen Marktes fallen zu
// lassen ist richtiger, als einen DE-Tag an einen amazon.es-Link zu hängen —
// dort verdient er nichts, und niemand würde es dem Link ansehen.
//
// Gefragt wird der Eintrag genau des Marktes, um dessen Link es geht. Ist er
// gar nicht gewählt, gilt dessen Standard-Tag: derselbe Ausgang wie bei einem
// nicht mitgeschickten Feld, denn genau das ist er dann auch.
//
// Vorschau und Versand gehen beide hier durch, damit im Discord genau der
// Tag landet, den die Vorschau gezeigt hat.
func (srv *Server) vkTag(f dealFormular, ziel marketplace.Code) (store.AffiliateTag, bool) {
	if m, da := f.Markt(ziel); da && m.TagGesetzt {
		if m.TagID == 0 {
			return store.AffiliateTag{}, false
		}
		if t, err := srv.store.Tag(m.TagID); err == nil && t.Markt == string(ziel) {
			return t, true
		}
	}
	return srv.store.StandardTag(string(ziel))
}

// baueDeal rechnet und rendert.
//
// Vorschau und Senden gehen beide hier durch, damit der Text im Discord
// garantiert derselbe ist, den die Vorschau gezeigt hat.
func (srv *Server) baueDeal(f dealFormular) (dealErgebnis, error) {
	erg, err := srv.rechneDeal(f)
	if err != nil {
		return dealErgebnis{}, err
	}

	// Für den Post ist die Verkaufszahl Pflicht: "Amazon.DE: 0 Verkäufe"
	// wäre eine falsche, veröffentlichte Aussage über den Artikel. Der Markt
	// steht vorn, wie bei den Rechenfehlern.
	for _, m := range erg.Maerkte {
		if !m.SalesBekannt {
			mf, _ := f.Markt(m.Ziel.Code)
			return dealErgebnis{}, fmt.Errorf("Amazon.%s — Verkäufe: %q ist keine Zahl",
				m.Ziel.Code, mf.Sales)
		}
	}

	maxMenge, err := maxMengeZahl(f.MaxMenge)
	if err != nil {
		return dealErgebnis{}, err
	}
	erg.MaxMenge = maxMenge

	if err := erg.mitHandwerten(f); err != nil {
		return dealErgebnis{}, err
	}
	weitereEK, err := f.weitereEK()
	if err != nil {
		return dealErgebnis{}, err
	}

	leit := erg.Leit()

	// Im Brutto-Modus bleibt der Parameter 0, so wie im ursprünglich
	// kopierten ArbitrageOne-Link.
	var ekNetto money.Cents
	if f.EKArt == "netto" {
		ekNetto = leit.Ergebnis.EKNetto
	}

	// Der Einkaufslink bekommt den Standard-Tag seines eigenen Marktes: ein
	// Tag verdient nur dort, wofür er ausgestellt wurde, und Einkaufs- und
	// Zielmarkt sind hier regelmäßig verschiedene Länder. Bei einem
	// Fremdshop bleibt der Link unberührt — auch bei amazon.co.uk, das in
	// marketplace.tabelle nicht steht und darum als Fremdshop zählt.
	ekUrl := erg.QuellURL
	if !erg.Extern {
		ekTagWert := ""
		if t, ok := srv.store.StandardTag(string(erg.Quell.Code)); ok {
			ekTagWert = t.Tag
		}
		ekUrl = erg.Quell.ProductURLMitTag(f.ASIN, ekTagWert)
	}

	daten := post.Daten{
		Titel:     f.Titel,
		ASIN:      f.ASIN,
		Mention:   mentionText(f.ChannelID, srv),
		EKHost:    erg.QuellHost,
		EKUrl:     ekUrl,
		WeitereEK: weitereEK,
		// Im Post steht der Preis so, wie er eingegeben wurde: brutto, oder
		// bei einer Netto-Eingabe netto — bei B2B ist das der Preis, den
		// ein Käufer auf der Rechnung sieht. "netto" steht dann dabei,
		// außer die Notiz sagt es schon.
		EK:      ekImPost(f, leit.Ergebnis),
		EKNotiz: f.EKNotiz,
		Zusatz:  f.Zusatz,
		Poster: func() string {
			if p, ok := srv.poster(f.Poster); ok {
				return p.posterText()
			}
			return ""
		}(),
		MaxMenge: func() string {
			if maxMenge == 0 {
				return ""
			}
			return strconv.Itoa(maxMenge)
		}(),
		AOUrl: post.ArbitrageOneURL(post.AOParameter{
			ASIN: f.ASIN, VKBrutto: leit.VKBrutto, EKBrutto: leit.Ergebnis.EKBrutto,
			EKNettoBerechnet: ekNetto,
			Sales:            leit.Sales, Zielmarkt: leit.Ziel.Code, QuellURL: erg.QuellURL,
		}),
		PPUrl: post.ProfitPathURL(post.PPParameter{
			ASIN: f.ASIN, VKBrutto: leit.VKBrutto, EKBrutto: leit.Ergebnis.EKBrutto,
			Zielmarkt: leit.Ziel.Code, Quellmarkt: erg.Quell.Code,
		}),
	}

	// Die Affiliate-Tags werden ausschließlich hier eingesetzt, nie in
	// erg.QuellURL. Dasselbe Feld speist auch den ArbitrageOne-Parameter
	// source_url, das versteckte Formularfeld quell_url und die gleichnamige
	// Spalte der Historie — ein dort eingebauter Tag sickerte in alle drei
	// durch: in ein Analysewerkzeug, das ihn nicht braucht, und in
	// gespeicherte Daten, die eine Bezugsquelle festhalten sollen, keine
	// Provisionszuordnung.
	for _, m := range erg.Maerkte {
		vkTagWert := ""
		if t, ok := srv.vkTag(f, m.Ziel.Code); ok {
			vkTagWert = t.Tag
		}
		md := post.MarktDaten{
			Code:          string(m.Ziel.Code),
			VK:            m.VKBrutto.Euro(),
			VKUrl:         m.Ziel.ProductURLMitTag(f.ASIN, vkTagWert),
			Sales:         salesAnzeige(m),
			Gewinn:        m.Ergebnis.Gewinn.Euro(),
			Marge:         prozent(m.Ergebnis.MargeProzent, 1),
			MargeGerundet: prozent(m.Ergebnis.MargeProzent, 0),
		}
		// Leer, wo es den Vergleich nicht gibt — die Vorlage fragt mit
		// {{if}} danach. Ein "0,00 €" stünde sonst als Aussage da, die
		// niemand gerechnet hat.
		if m.PanEU != nil {
			md.GewinnPanEU = m.PanEU.Gewinn.Euro()
			md.MargePanEU = prozent(m.PanEU.MargeProzent, 1)
		}
		daten.Maerkte = append(daten.Maerkte, md)

		// Die alten, flachen Felder tragen den Leitmarkt: eine gespeicherte
		// Vorlage kennt .Maerkte nicht, und Render läuft mit
		// missingkey=error — ohne sie renderte sie gar nicht mehr.
		if m.Leitmarkt {
			daten.Zielmarkt = md.Code
			daten.VK, daten.VKUrl, daten.Sales = md.VK, md.VKUrl, md.Sales
			daten.Gewinn, daten.Marge, daten.MargeGerundet = md.Gewinn, md.Marge, md.MargeGerundet
			daten.GewinnPanEU, daten.MargePanEU = md.GewinnPanEU, md.MargePanEU
		}
	}

	// Die gespeicherte Vorlage ist der ganze Post; ohne gespeicherte gilt
	// die Standardvorlage.
	text, err := post.Render(post.VorlageOderStandard(srv.store.Einstellung(store.SchluesselVorlage)), daten)
	if err != nil {
		return dealErgebnis{}, err
	}
	erg.Text = text

	if f.ChannelID != 0 {
		erg.Channel, _ = srv.store.Channel(f.ChannelID)
	}
	return erg, nil
}

// fremdQuelle prüft einen Einkaufslink und liefert den Host, unter dem er im
// Post erscheint, und den Link selbst.
func fremdQuelle(roh string) (host, link string, err error) {
	q, err := marketplace.ParseEinkaufslink(roh)
	switch {
	case err != nil:
		return "", "", err
	case q.URL == "":
		// Eine nackte ASIN ist kein Einkaufslink.
		return "", "", marketplace.ErrKeinLink
	default:
		// Host und Link kommen beide aus ParseEinkaufslink, nie aus dem
		// Rohwert des Formulars: nur so trägt auch dieser Weg die
		// Entschärfung für den Markdown-Linkkontext des Posts. Ein
		// Amazon-Link im Feld für den Fremdshop ist dabei kein Fehler, bloß
		// kein Fremdshop.
		return q.Host, q.URL, nil
	}
}

// quellHostAnzeige liefert den Host, der den Einkauf benennt: den Fremdshop
// oder den Amazon-Markt, bei dem eingekauft wird. Rein für die Anzeige im
// Funnel — im Post steht derselbe Host, dort baut ihn aber rechneDeal aus
// demselben Formular, damit Anzeige und Post nicht auseinanderlaufen können.
// lieferantAnzeige ist der Einkauf ohne Link, so wie er im Post steht.
func lieferantAnzeige(lieferant string) string {
	if lieferant == "" {
		return "Großhandel"
	}
	return lieferant
}

func quellHostAnzeige(f dealFormular) string {
	if f.OhneLink {
		return lieferantAnzeige(f.Lieferant)
	}
	if f.QuellURL != "" {
		host, _, err := fremdQuelle(f.QuellURL)
		if err != nil {
			return ""
		}
		return host
	}
	if m, ok := marketplace.ByCode(marketplace.Code(f.Quellmarkt)); ok {
		return strings.TrimPrefix(m.Host, "www.")
	}
	return ""
}

func (srv *Server) ustPermille(c marketplace.Code) int {
	if n := srv.store.EinstellungZahl(store.SchluesselUStPrefix + string(c)); n > 0 {
		return n
	}
	m, _ := marketplace.ByCode(c)
	return m.VATPermille
}

// ustFuer liefert den Satz passend zum Steuersatz des Deals: den normalen
// oder den ermäßigten des Landes.
func (srv *Server) ustFuer(c marketplace.Code, steuersatz string) int {
	if steuersatz == "ermaessigt" {
		if n := srv.store.EinstellungZahl(store.SchluesselUStErmPrefix + string(c)); n > 0 {
			return n
		}
	}
	return srv.ustPermille(c)
}

// prozent formatiert mit deutschem Komma: 15.26 -> "15,3 %" bzw. "15 %".
func prozent(v float64, stellen int) string {
	var s string
	if stellen == 0 {
		s = strconv.Itoa(int(math.Round(v)))
	} else {
		s = strconv.FormatFloat(v, 'f', stellen, 64)
	}
	return strings.Replace(s, ".", ",", 1) + " %"
}

func mentionText(channelID int64, srv *Server) string {
	if channelID == 0 {
		return ""
	}
	c, err := srv.store.Channel(channelID)
	if err != nil {
		return ""
	}
	switch c.MentionTyp {
	case "everyone":
		return "@everyone"
	case "here":
		return "@here"
	case "rolle":
		if c.RollenID != "" {
			return "<@&" + c.RollenID + ">"
		}
	}
	return ""
}

// tarifGebuehr sucht zu einem Paket den Versandtarif des Zielmarkts.
//
// Welche der beiden Tarifübersichten gilt, entscheidet wegFuer: liegt die Ware
// im Zielland, der lokale Tarif, sonst der des Europäischen Versandnetzwerks.
// Der Unterschied ist kein Detail — je nach Klasse liegt der EFN-Tarif beim
// Anderthalb- bis Dreieinhalbfachen des lokalen.
//
// Kein Treffer heißt: die Maße fehlen, das Paket passt in keine eingetragene
// Klasse, oder die getroffene Klasse hat für diesen Markt und Weg keinen
// Betrag. In allen drei Fällen bleibt es beim bisherigen Verhalten des
// Aufrufers.
//
// Der letzte Fall ist der heikle, und die Reihenfolge hier ist seine Antwort:
// gewählt wird über *alle* Klassen, erst danach wird der Betrag nachgeschlagen.
// Ließe man Klassen ohne Betrag schon bei der Wahl weg, rutschte ein Brief, für
// den nur der italienische Preis fehlt, in die nächstgrößere Klasse und zahlte
// Päckchenpreis — ein Fehler, der teurer aussieht als er ist und niemandem
// auffiele.
func (srv *Server) tarifGebuehr(ziel marketplace.Code, m fba.Masse) (money.Cents, string, bool) {
	if ziel == "" {
		return 0, "", false
	}
	klassen, err := srv.store.TarifKlassen()
	if err != nil || len(klassen) == 0 {
		return 0, "", false
	}
	k, ok := fba.Waehle(klassen, m)
	if !ok {
		return 0, "", false
	}
	g, da, err := srv.store.TarifGebuehr(k.ID, string(ziel), srv.wegFuer(ziel))
	if err != nil || !da {
		return 0, "", false
	}
	return g.Betrag(m) + srv.zuschlagJeEinheit(), k.Bezeichnung, true
}

// zuschlagJeEinheit ist die zusätzliche Versandgebühr aus Fußnote 4 beider
// Tarifübersichten: wer Lagerbestand in Deutschland hat und am Central Europe
// Program nicht teilnimmt, zahlt je versandter Einheit 0,26 € mehr.
//
// Sie steht in den Einstellungen und nicht in der Staffel, weil sie genau das
// ist: ein Aufschlag auf jede Zeile beider Übersichten — nachgerechnet liegt
// deren Spalte "Nur DE" in jeder Zeile exakt 0,26 € über der CEP-Spalte, und
// ein Aufschlag ist kein zweiter Tarif. Wer am Programm teilnimmt, trägt 0 ein.
//
// Sie gilt für Sendungen aus deutschen Logistikzentren. Liegt die Ware
// anderswo, gehört hier eine 0 hin; das steht so an der Einstellung, und ein
// Ländervergleich im Code wäre eine stille Annahme mehr.
//
// Unlesbares zählt als null. Ein vertippter Zuschlag darf keine Gebühr
// erfinden — er fällt dann weg, und das ist im Formular zu sehen.
func (srv *Server) zuschlagJeEinheit() money.Cents {
	cent, err := money.Parse(srv.store.Einstellung(store.SchluesselEFNZuschlag))
	if err != nil || cent < 0 {
		return 0
	}
	return cent
}

// rechnungFuellen rechnet den Deal und legt die Übersicht in die Seite: je
// Zielmarkt eine Zeile, jede mit ihrer eigenen Aufschlüsselung.
//
// Entweder Zahlen oder eine Meldung, nie beides — dieselbe Regel wie zuvor.
// Ein halb gefüllter Vergleich neben einem Fehler wäre die schlechtere Hälfte
// von beidem.
func (srv *Server) rechnungFuellen(d *dealSeite) {
	d.Ergebnisse, d.RechenFehler = nil, ""

	erg, err := srv.rechneDeal(d.Formular)
	if err != nil {
		d.RechenFehler = sicherFehlertext(err.Error())
		return
	}
	d.Ergebnisse = ergebnisUebersicht(erg)
}

// lokalerTarif ist die Versandgebühr, die im Zielmarkt gälte, läge die Ware
// dort — also der Gewinnvergleich für Pan-EU oder lokalen Bestand.
//
// Der Zuschlag je Einheit kommt hier bewusst nicht dazu: er gilt für
// Sendungen aus deutschen Logistikzentren, und aus lokalem Bestand geht die
// Sendung dort gar nicht los.
//
// Kein Ergebnis heißt: das Ziel ist das Lagerland selbst (dann gibt es keinen
// zweiten Weg), die Maße fehlen, keine Klasse passt, oder der Staffel fehlt
// der lokale Tarif dieses Marktes.
func (srv *Server) lokalerTarif(ziel marketplace.Code, m fba.Masse) (money.Cents, bool) {
	if ziel == "" || ziel == srv.lagerland() {
		return 0, false
	}
	klassen, err := srv.store.TarifKlassen()
	if err != nil {
		return 0, false
	}
	k, ok := fba.Waehle(klassen, m)
	if !ok {
		return 0, false
	}
	g, da, err := srv.store.TarifGebuehr(k.ID, string(ziel), fba.Lokal)
	if err != nil || !da {
		return 0, false
	}
	return g.Betrag(m), true
}

// tarifQuelle beschriftet die Herkunft der vorbelegten Gebühr. Sie steht im
// Formular neben dem Feld und wandert in die Historie — dort soll später noch
// ablesbar sein, welche der beiden Tarifübersichten gerechnet wurde.
func tarifQuelle(weg fba.Weg, klasse string) string {
	name := "lokaler Tarif"
	if weg == fba.EFN {
		name = "EFN-Tarif"
	}
	return name + " · " + klasse
}

// mitHandwerten setzt Gewinn und Marge des Leitmarkts auf die Werte aus
// Schritt 4, wenn dort welche stehen. Der Rest der Rechnung bleibt, wie er
// ist; ersetzt wird nur, was im Post und in der Historie steht.
func (e *dealErgebnis) mitHandwerten(f dealFormular) error {
	if f.GewinnManuell == "" && f.MargeManuell == "" && f.GewinnPanEUManuell == "" && f.MargePanEUManuell == "" {
		return nil
	}
	betrag := func(s, was string) (money.Cents, error) {
		g, err := money.Parse(s)
		if err != nil {
			return 0, fmt.Errorf("%s (von Hand): %q ist kein Betrag", was, s)
		}
		return g, nil
	}
	prozentWert := func(s, was string) (float64, error) {
		m, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSuffix(strings.TrimSpace(s), "%"), ",", "."), 64)
		if err != nil {
			return 0, fmt.Errorf("%s (von Hand): %q ist keine Zahl", was, s)
		}
		return m, nil
	}
	for i := range e.Maerkte {
		if !e.Maerkte[i].Leitmarkt && len(e.Maerkte) > 1 {
			continue
		}
		m := &e.Maerkte[i]
		if f.GewinnManuell != "" {
			g, err := betrag(f.GewinnManuell, "Gewinn")
			if err != nil {
				return err
			}
			m.Ergebnis.Gewinn = g
		}
		if f.MargeManuell != "" {
			p, err := prozentWert(f.MargeManuell, "Marge")
			if err != nil {
				return err
			}
			m.Ergebnis.MargeProzent = p
		}
		// Pan-EU von Hand: auch wenn das Tool keinen Pan-EU-Vergleich
		// gerechnet hat — dann steht die Pan-EU-Zeile mit diesen Werten im
		// Post.
		if f.GewinnPanEUManuell != "" || f.MargePanEUManuell != "" {
			if m.PanEU == nil {
				m.PanEU = &calc.Ergebnis{}
			} else {
				kopie := *m.PanEU
				m.PanEU = &kopie
			}
			if f.GewinnPanEUManuell != "" {
				g, err := betrag(f.GewinnPanEUManuell, "Pan-EU-Gewinn")
				if err != nil {
					return err
				}
				m.PanEU.Gewinn = g
			}
			if f.MargePanEUManuell != "" {
				p, err := prozentWert(f.MargePanEUManuell, "Pan-EU-Marge")
				if err != nil {
					return err
				}
				m.PanEU.MargeProzent = p
			}
		}
		return nil
	}
	return nil
}

// ekImPost ist der Einkaufspreis für den Post: brutto, oder nach einer
// Netto-Eingabe der Nettopreis mit dem Zusatz "netto".
func ekImPost(f dealFormular, e calc.Ergebnis) string {
	if f.EKArt != "netto" {
		return e.EKBrutto.Euro()
	}
	if strings.Contains(strings.ToLower(f.EKNotiz), "netto") {
		return e.EKNetto.Euro()
	}
	return e.EKNetto.Euro() + " netto"
}

// salesAnzeige ist die Verkaufszahl für den Post, mit "+" bei einem
// Mindestwert.
func salesAnzeige(m marktErgebnis) string {
	if m.SalesPlus {
		return strconv.Itoa(m.Sales) + "+"
	}
	return strconv.Itoa(m.Sales)
}
