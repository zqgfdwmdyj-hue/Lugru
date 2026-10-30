package web

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/calc"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Der Weg zum Post ist ein Funnel aus vier Schritten. Jeder Schritt fragt
// genau das ab, was der nächste braucht, und trägt alles bisher Gesammelte
// als verborgene Felder weiter:
//
//	1  Einkaufslink      Amazon-Link, Fremdshop-Link oder nackte ASIN;
//	                     was der Link nicht hergibt (ASIN, Einkaufsland),
//	                     wird hier nachgefragt
//	2  Einkauf & Ziel    Einkaufspreis netto oder brutto, Zielmarktplatz
//	3  Berechnung        Keepa-Werte prüfen, Aufschlüsselung rechnet live mit
//	4  Vorschau          fertiger Post, Channel wählen, senden
//
// Der Server hält dabei keinen Entwurf: der ganze Zustand steht im Formular.
// Ein Neuladen der Seite beginnt darum sauber von vorn, und zwei Browserfenster
// stören sich nicht gegenseitig.
const (
	schrittQuelle   = 1
	schrittEinkauf  = 2
	schrittRechnung = 3
	schrittVorschau = 4
)

type dealSeite struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	// Hinweis ist die Rückfrage, die den Funnel nicht bemängelt, sondern
	// weiterführt: eine fehlende ASIN, ein zu bestätigendes Einkaufsland.
	// Fehler bleibt dem vorbehalten, was wirklich falsch ist — sonst steht
	// der halbe normale Ablauf eines Fremdshop-Deals in Rot da.
	Hinweis string

	// SchonGepostet nennt, wann und wo dieselbe ASIN schon gepostet wurde
	// (leer, wenn noch nie). Gezeigt in Schritt 2 und 4.
	SchonGepostet string

	// Schritt ist die Nummer des gerade gezeigten Funnel-Schritts. Die
	// Fortschrittsanzeige oben liest sie, mehr nicht.
	Schritt int

	Maerkte  []marketplace.Marketplace
	Channels []store.Channel
	Notizen  []string

	// TagAuswahl ist je Markt ein Auswahlfeld. Ein Tag verdient nur auf dem
	// Markt, für den er ausgestellt wurde — die Bindung ist eine Regel, keine
	// Empfehlung, und darum bekommt jeder Markt seine eigene Liste.
	TagAuswahl []tagAuswahl

	Formular dealFormular

	// ASINFrage und MarktFrage steuern die Rückfragen in Schritt 1: ein
	// Fremdshop-Link nennt keine ASIN, eine nackte ASIN kein Einkaufsland.
	// Gefragt wird ausdrücklich nur nach dem, was fehlt.
	ASINFrage  bool
	MarktFrage bool
	QuellHost  string

	// Ergebnisse ist die Übersicht in Schritt 3 und 4: eine Zeile je
	// Zielmarkt, und jede trägt die vollständige Aufschlüsselung ihres
	// Marktes mit — sie steht hinter dem Taschenrechner am Zeilenende.
	Ergebnisse []marktErgebnisZeile

	// RechenFehler steht in der Aufschlüsselung selbst, nicht über dem
	// Schritt: er meldet einen Wert, der sich gerade nicht rechnen lässt
	// ("Verkaufspreis: kein gültiger Betrag"), während Fehler dem ganzen
	// Schritt gilt. Zwei getrennte Felder, damit ein Keepa-Fehler nicht
	// zweimal untereinander auf derselben Seite steht.
	RechenFehler string

	// Karte ist der Post, wie Discord ihn zeigen wird — nachgebaut aus genau
	// der Karte, die gesendet wird.
	Karte    kartenVorschau
	ChartURL string

	// PosterAuswahl sind die Leute, die in Schritt 4 zur Wahl stehen.
	PosterAuswahl []posterEintrag

	// Entwuerfe ist die Liste unter Schritt 1 — nur auf der Startseite
	// gefüllt, nicht in den Fragmenten der Schritte.
	Entwuerfe []entwurfZeile

	// Einstieg ist der Schritt, mit dem die ganze Seite ("deal") beginnt:
	// leer für Schritt 1, sonst der Name des Schritt-Fragments. Gesetzt wird
	// er nur, wenn ein Entwurf oder ein alter Deal geöffnet wird — siehe
	// rendereSchritt.
	Einstieg string

	// OhneChartAnbieten lässt die "schritt4"-Vorlage statt des normalen
	// Posten-Knopfs einen Knopf zeigen, der dieselbe Anfrage mit
	// ohne_chart=1 wiederholt. Ohne dieses Feld (siehe I3 im
	// Abschluss-Review) nannte die Fehlermeldung einen Knopf, den keine
	// Vorlage je gerendert hat — ein fehlgeschlagener Chart-Abruf blockierte
	// das Posten endgültig.
	OhneChartAnbieten bool

	// EKHinweis sagt, woher ein vorgeschlagener Einkaufspreis stammt. Leer,
	// wenn er von Hand kommt — dann gibt es nichts zu belegen. Er steht hier
	// und nicht im Markt, weil der Einkauf auf dem QUELLmarkt liegt und
	// damit für alle Zielmärkte derselbe ist — anders als die
	// Vorschlagsliste des Verkaufspreises, die je Markt gilt und darum in
	// marktFormular steht.
	EKHinweis string
}

type kandidat struct {
	Schluessel  string
	Bezeichnung string
	Wert        string
	Gewaehlt    bool
}

func (srv *Server) seitenGeruest(schritt int) dealSeite {
	channels, _ := srv.store.Channels()
	notizen, _ := srv.store.EKNotizen()
	return dealSeite{
		Titel:         "Neuer Deal",
		PosterAuswahl: srv.posterListe(),
		Schritt:       schritt,
		Maerkte:       marketplace.All(),
		Channels:      channels,
		Notizen:       notizen,
		TokenText:     srv.tokenText(),
	}
}

// tagAuswahl ist das Tag-Auswahlfeld eines Marktes in Schritt 4.
type tagAuswahl struct {
	Code string
	Tags []store.AffiliateTag
	// TagID ist der aufgelöste Tag — dieselbe Auflösung, die auch den Link
	// baut (vkTag). Zwei getrennte Rechnungen könnten auseinanderlaufen, und
	// dann zeigte das Feld einen anderen Tag an, als der Post trägt.
	TagID int64
	// OhneTag lässt Schritt 4 den Hinweis zeigen, dass der Verkaufslink
	// dieses Marktes ohne Affiliate-Tag hinausgeht. Der Einkaufslink folgt
	// dem Standard seines eigenen Marktes und wird hier gar nicht abgefragt.
	//
	// Bewusst ein eigenes Feld statt dealSeite.Hinweis: das trägt bereits die
	// Rückfragen des Funnels, und mit mehreren Märkten stünden dort im
	// schlimmsten Fall mehrere fremde Hinweise durcheinander.
	OhneTag bool
}

// fuelleTagAuswahl bestückt je Markt ein Auswahlfeld und legt fest, welcher
// Eintrag darin vorausgewählt ist.
//
// Der aufgelöste Tag wandert dabei zurück ins Formular. Damit trägt die
// nächste Anfrage ihn ausdrücklich mit, statt erneut auf den Standard zu
// fallen — und ein abgewählter Markt korrigiert eine stehengebliebene Tag-ID
// sichtbar im Feld, nicht nur unsichtbar im Link.
func (srv *Server) fuelleTagAuswahl(d *dealSeite) {
	d.TagAuswahl = make([]tagAuswahl, 0, len(d.Formular.Maerkte))
	for i := range d.Formular.Maerkte {
		c := d.Formular.Maerkte[i].Code
		tags, _ := srv.store.TagsFuerMarkt(string(c))

		t, gefunden := srv.vkTag(d.Formular, c)
		// marktZeiger statt Markt(): die aufgelöste Wahl wandert zurück ins
		// Formular, und in eine Kopie geschrieben käme sie dort nie an.
		if m := d.Formular.marktZeiger(c); m != nil {
			m.TagID = t.ID
			m.TagGesetzt = true
		}

		d.TagAuswahl = append(d.TagAuswahl, tagAuswahl{
			Code: string(c), Tags: tags, TagID: t.ID, OhneTag: !gefunden,
		})
	}
}

// standardMaerkteSetzen belegt die Zielmärkte aus der Einstellung vor.
//
// Nur, solange keiner gewählt ist: sobald das Formular Märkte mitträgt, sind
// das die Märkte des laufenden Deals, und eine Vorbelegung darüber wäre eine
// stille Korrektur einer getroffenen Wahl.
//
// Die Einstellung ist eine kommagetrennte Liste, ihr erster Eintrag der
// Leitmarkt. Bleibt nichts übrig — nur bei einer von Hand veränderten
// Datenbank —, gilt der erste geführte Markt, damit Schritt 2 nie ohne
// Vorauswahl dasteht.
func (srv *Server) standardMaerkteSetzen(f *dealFormular) {
	if len(f.Maerkte) > 0 {
		return
	}
	gewaehlt := marketplace.CodesAusListe(srv.store.Einstellung(store.SchluesselZielmarkt))
	if len(gewaehlt) == 0 {
		gewaehlt = marketplace.All()[:1]
	}
	for _, m := range gewaehlt {
		f.Maerkte = append(f.Maerkte, marktFormular{Code: m.Code})
	}
	f.Leitmarkt = leitmarktAufloesen("", f.Maerkte)
}

// ganzeSeiteSchluessel markiert eine Anfrage, deren Schritt als ganze Seite
// statt als Fragment ausgeliefert werden soll.
type ganzeSeiteSchluessel struct{}

// rendereSchritt liefert einen Funnel-Schritt aus: gewöhnlich als Fragment
// für #funnel, beim Öffnen eines Entwurfs oder eines alten Deals als ganze
// Seite mit diesem Schritt darin. Beide Wege laufen durch dieselben
// Handler, damit ein geöffneter Deal genau so geprüft wird wie einer, der
// Schritt für Schritt eingegeben wurde.
func (srv *Server) rendereSchritt(w http.ResponseWriter, r *http.Request, name string, d dealSeite) {
	if name == "schritt2" || name == "schritt4" {
		d.SchonGepostet = srv.schonGepostet(d.Formular.ASIN)
	}
	if r.Context().Value(ganzeSeiteSchluessel{}) != nil {
		d.Einstieg = name
		srv.rendere(w, "deal", d)
		return
	}
	srv.rendere(w, name, d)
}

// alsGanzeSeite führt einen Funnel-Handler mit den gegebenen Formularwerten
// aus und liefert sein Ergebnis als ganze Seite.
func (srv *Server) alsGanzeSeite(w http.ResponseWriter, r *http.Request, werte url.Values, h http.HandlerFunc) {
	r2 := r.Clone(context.WithValue(r.Context(), ganzeSeiteSchluessel{}, true))
	r2.Method = http.MethodPost
	r2.Form = werte
	r2.PostForm = werte
	h(w, r2)
}

// zeigeDeal liefert die ganze Seite mit Schritt 1 aus.
func (srv *Server) zeigeDeal(w http.ResponseWriter, r *http.Request) {
	d := srv.seitenGeruest(schrittQuelle)
	srv.standardMaerkteSetzen(&d.Formular)
	d.Formular.EKArt = "brutto"
	// Vorausgewählt ist, wer angemeldet ist (sonst die letzte Wahl in
	// diesem Browser). Schritt 4 lässt den Poster weiterhin umstellen.
	if p, ok := srv.poster(posterVorwahl(r)); ok {
		d.Formular.Poster = p.Name
	}
	d.Entwuerfe = srv.entwurfListe()
	srv.rendere(w, "deal", d)
}

// starteDeal ist der Weg zurück auf Schritt 1, mit allem bisher Eingegebenen.
//
// Die Rückfragen von vorhin bleiben dabei sichtbar: was der Link nicht selbst
// hergibt — bei einem Fremdshop die ASIN, bei einer nackten ASIN das
// Einkaufsland —, ist von Hand eingetragen worden und muss auf dem Weg zurück
// auch wieder änderbar sein, statt als verborgenes Feld festzustehen.
func (srv *Server) starteDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest(schrittQuelle)
	d.Formular = formularLesen(r)
	d.QuellHost = quellHostAnzeige(d.Formular)

	quelle, err := marketplace.ParseEinkaufslink(d.Formular.Einkaufslink)
	d.ASINFrage = err != nil || quelle.ASIN == ""
	d.MarktFrage = err != nil || quelle.Markt == nil
	srv.rendereSchritt(w, r, "schritt1", d)
}

// preisDeal wertet Schritt 1 aus und zeigt Schritt 2.
//
// Derselbe Handler bedient auch den Zurück-Knopf aus Schritt 3: die
// Auswertung des Links ist wiederholbar und liefert bei unveränderter Eingabe
// dasselbe Ergebnis, ein zweiter Weg zurück wäre also nur eine zweite Stelle,
// die dieselbe Erkennung noch einmal (womöglich anders) macht.
func (srv *Server) preisDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest(schrittQuelle)
	d.Formular = formularLesen(r)

	if d.Formular.OhneLink {
		srv.preisOhneLink(w, r, d)
		return
	}

	quelle, err := marketplace.ParseEinkaufslink(d.Formular.Einkaufslink)
	if err != nil {
		d.Fehler = "Kein Einkaufslink erkannt: " + sicherFehlertext(err.Error()) +
			" — eine Amazon-URL, der Link eines anderen Shops oder eine nackte ASIN."
		srv.rendereSchritt(w, r, "schritt1", d)
		return
	}

	// Von Hand nachgetragene Angaben gehören immer zu genau einem Link.
	// Steht im Feld inzwischen ein anderer, sind sie für einen anderen
	// Artikel eingetragen worden und gelten nicht mehr: sonst liefe der neue
	// Einkaufslink mit der ASIN des alten weiter, womöglich noch mit dem
	// Umsatzsteuersatz eines dritten Landes.
	bestaetigt := d.Formular.LinkBestaetigt == d.Formular.Einkaufslink
	if !bestaetigt {
		d.Formular.ASIN = ""
		d.Formular.Quellmarkt = ""
	}

	// Was im Link steht, sticht das Formular.
	d.Formular.QuellURL = ""
	if quelle.Extern() {
		d.Formular.QuellURL = quelle.URL
	}
	if quelle.ASIN != "" {
		d.Formular.ASIN = quelle.ASIN
	}
	if quelle.Markt != nil {
		d.Formular.Quellmarkt = string(quelle.Markt.Code)
	} else if d.Formular.Quellmarkt == "" && quelle.Extern() {
		// Nur ein Vorschlag aus der Endung des Shops. Bestätigt wird er
		// unten im Formular — eine Shop-Endung belegt nicht, welcher
		// Umsatzsteuersatz für diesen Einkauf tatsächlich gilt.
		if m, ok := marketplace.LandZuHost(quelle.Host); ok {
			d.Formular.Quellmarkt = string(m.Code)
		}
	}
	// Wo sich nichts ableiten lässt (nackte ASIN, Shop ohne Länderendung),
	// ist Deutschland vorausgewählt — der häufigste Fall. Bestätigt wird
	// auch das unten im Formular.
	if d.Formular.Quellmarkt == "" {
		d.Formular.Quellmarkt = "DE"
	}

	d.QuellHost = quellHostAnzeige(d.Formular)

	// Gefragt wird nach allem, was der Link nicht selbst hergibt — er ist die
	// einzige Angabe, die für sich steht.
	asinFehlt := !asinMuster.MatchString(d.Formular.ASIN)
	_, marktBekannt := marketplace.ByCode(marketplace.Code(d.Formular.Quellmarkt))
	d.ASINFrage = quelle.ASIN == "" || asinFehlt
	d.MarktFrage = quelle.Markt == nil

	// Angaben, die nicht aus dem Link stammen, gelten erst als bestätigt,
	// wenn sie einmal sichtbar im Formular gestanden haben und von dort
	// abgeschickt wurden. So geht weder eine nachgetragene ASIN noch ein
	// geratenes Einkaufsland ungesehen in die Rechnung.
	if asinFehlt || !marktBekannt || ((d.ASINFrage || d.MarktFrage) && !bestaetigt) {
		switch {
		case asinFehlt && d.Formular.ASIN != "":
			d.Fehler = "Das ist keine gültige ASIN — zehn Zeichen, Buchstaben und Ziffern."
		case asinFehlt && quelle.Extern():
			d.Hinweis = "Der Link führt zu " + quelle.Host +
				". Verkauft wird bei Amazon — dafür wird die ASIN des Artikels gebraucht."
		case asinFehlt:
			d.Hinweis = "Der Link nennt keine ASIN — bitte eintragen."
		case !marktBekannt:
			d.Hinweis = "Bitte das Einkaufsland wählen. Es legt fest, mit welchem Umsatzsteuersatz der Einkauf gerechnet wird."
		case quelle.Extern() && marketplace.LandZuHostBekannt(quelle.Host):
			d.Hinweis = "Bitte das Einkaufsland bestätigen — geraten ist es aus der Endung von " + d.QuellHost +
				". Es legt fest, mit welchem Umsatzsteuersatz der Einkauf gerechnet wird."
		default:
			d.Hinweis = "Bitte das Einkaufsland bestätigen — vorausgewählt ist Deutschland." +
				" Es legt fest, mit welchem Umsatzsteuersatz der Einkauf gerechnet wird."
		}
		srv.rendereSchritt(w, r, "schritt1", d)
		return
	}

	// Ab hier gehören ASIN und Einkaufsland zu genau diesem Link.
	d.Formular.LinkBestaetigt = d.Formular.Einkaufslink
	srv.standardMaerkteSetzen(&d.Formular)
	d.Schritt = schrittEinkauf
	srv.schlageEinkaufspreisVor(r, &d, quelle)
	srv.rendereSchritt(w, r, "schritt2", d)
}

// schlageEinkaufspreisVor füllt den Einkaufspreis aus Keepa vor.
//
// Der Einkaufspreis liegt auf dem QUELLmarkt, während Schritt 3 Keepa für den
// ZIELmarkt abfragt — das ist eine eigene Abfrage mit eigener Domain und
// eigenem Cache-Eintrag, kein Nebenprodukt der späteren.
//
// Vorgeschlagen wird der Nettobetrag: Keepa nennt Verbraucherpreise
// einschließlich Umsatzsteuer des Landes, Amazon stellt einem
// Geschäftskunden per Reverse Charge aber ohne. Der Schalter steht deshalb
// auf netto, und im Feld steht die Zahl, die auf der Rechnung erscheint.
//
// Fehlschläge sind still: ein Vorschlag ist Bequemlichkeit, kein Ergebnis.
// Ohne Keepa-Key, bei erschöpftem Kontingent oder wenn Amazon den Artikel auf
// diesem Markt gerade nicht selbst führt, bleibt das Feld eben leer und wird
// wie bisher von Hand ausgefüllt. Ein Fehlertext an dieser Stelle würde einen
// Deal blockieren, der ohne den Vorschlag vollständig eingebbar ist.
func (srv *Server) schlageEinkaufspreisVor(r *http.Request, d *dealSeite, quelle marketplace.Einkaufsquelle) {
	// Ein Fremdshop hat keinen Amazon-Preis. Der Quellmarkt ist dort nur der
	// Umsatzsteuersatz des Einkaufs, nicht der Ort, an dem gekauft wird.
	if quelle.Extern() || strings.TrimSpace(d.Formular.EK) != "" {
		return
	}
	markt, ok := marketplace.ByCode(marketplace.Code(d.Formular.Quellmarkt))
	if !ok {
		return
	}

	produkt, err := srv.holeProdukt(r, d.Formular.ASIN, markt)
	if err != nil || !produkt.AmazonAktuell.OK {
		return
	}

	// Vorgeschlagen wird der Bruttopreis, so wie er im Shop steht — brutto
	// ist die Vorgabe, mit der ihr eingebt. Wer netto rechnen will, stellt
	// den Schalter um und trägt den Nettobetrag ein.
	d.Formular.EK = produkt.AmazonAktuell.Cents.String()
	d.Formular.EKArt = "brutto"
	d.EKHinweis = "Keepa · Amazon aktuell auf " + strings.TrimPrefix(markt.Host, "www.") +
		" — brutto (netto wären es " +
		calc.NettoAusBrutto(produkt.AmazonAktuell.Cents, srv.ustPermille(markt.Code)).Euro() + ")"
}

// ladeDeal wertet Schritt 2 aus, holt die ASIN bei Keepa und zeigt Schritt 3.
//
// Der Zurück-Knopf aus Schritt 4 landet ebenfalls hier, dann aber mit
// zurueck=1: die schon geprüften Werte bleiben stehen, statt von Keepa
// überschrieben zu werden.
func (srv *Server) ladeDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest(schrittEinkauf)
	d.Formular = formularLesen(r)
	d.QuellHost = quellHostAnzeige(d.Formular)

	if !asinMuster.MatchString(d.Formular.ASIN) {
		d.Schritt = schrittQuelle
		d.ASINFrage = true
		d.Fehler = "Ohne gültige ASIN geht es nicht weiter."
		srv.rendereSchritt(w, r, "schritt1", d)
		return
	}
	if _, ok := marketplace.ByCode(marketplace.Code(d.Formular.Quellmarkt)); !ok {
		d.Schritt = schrittQuelle
		d.MarktFrage = true
		d.Fehler = "Bitte das Einkaufsland wählen."
		srv.rendereSchritt(w, r, "schritt1", d)
		return
	}

	if len(d.Formular.Maerkte) == 0 {
		d.Fehler = "Bitte mindestens einen Zielmarktplatz wählen."
		srv.rendereSchritt(w, r, "schritt2", d)
		return
	}
	if _, err := money.Parse(d.Formular.EK); err != nil {
		d.Fehler = "Einkaufspreis: " + sicherFehlertext(err.Error())
		srv.rendereSchritt(w, r, "schritt2", d)
		return
	}

	// Vorwärts aus Schritt 2 heißt: frische Keepa-Werte, auch wenn schon
	// welche im Formular stehen — der Zielmarktplatz kann sich gerade
	// geändert haben, und Provision, FBA und Verkaufspreis gelten immer nur
	// für einen bestimmten Markt. Rückwärts aus Schritt 4 bleibt dagegen
	// alles stehen, was schon geprüft wurde.
	frisch := r.PostForm.Get("zurueck") == ""
	if frisch {
		d.Formular.keepaWerteLeeren()
	}

	d.Schritt = schrittRechnung
	d.ChartURL = d.Formular.chartURL(string(d.Formular.Leitmarkt))

	fehler := srv.keepaEinlesen(r.Context(), &d, r.PostForm.Get("neu_laden") != "")
	d.Fehler = strings.Join(fehler, " · ")

	d.TokenText = srv.tokenText()
	srv.rechnungFuellen(&d)
	srv.rendereSchritt(w, r, "schritt3", d)
}

// keepaEinlesen holt den Artikel für jeden gewählten Zielmarkt bei Keepa und
// belegt die Felder des Formulars damit — der Kern von Schritt 3, den auch
// der Shop-Monitor nutzt. Zurück kommen die Fehler je Markt, fertig für die
// Anzeige; ein Markt mit Fehler steht auf den Standardwerten.
func (srv *Server) keepaEinlesen(ctx context.Context, d *dealSeite, neuLaden bool) []string {
	// Je Markt ein Abruf, der Reihe nach. Der Cache liegt auf (asin, domain)
	// und trennt die Märkte damit sauber — der Weg zurück nach Schritt 2 und
	// wieder vor kostet also keine weiteren Token.
	//
	// Ein Fehlschlag hält die anderen Märkte nicht auf: der betroffene fällt
	// auf die Standardwerte zurück und sagt das in seiner Spalte. Drei
	// brauchbare Märkte sind besser als vier verweigerte, und genau dieses
	// Verhalten hatte der Einzelmarkt schon.
	//
	// Zwei Durchgänge, nicht einer: erst holen und die Paketmaße über alle
	// Märkte auflösen, dann die Felder belegen. Die FBA-Gebühr hängt an der
	// Größenklasse und die an den Maßen — nähme der erste Markt seine Gebühr,
	// bevor der letzte seine Maße gemeldet hat, bekäme ein Markt ohne eigene
	// Maße Keepas lokale Gebühr statt des EFN-Tarifs. Die lokale ist die
	// kleinere, der Deal sähe zu gut aus, und veröffentlicht würde er auch.
	var fehler []string
	geholt := make([]struct {
		ziel    marketplace.Marketplace
		produkt keepa.Product
	}, 0, len(d.Formular.Maerkte))

	for _, mf := range d.Formular.Maerkte {
		ziel, ok := marketplace.ByCode(mf.Code)
		if !ok {
			continue
		}
		produkt, err := srv.holeProduktCtx(ctx, d.Formular.ASIN, ziel, neuLaden)
		if err != nil {
			// sicherFehlertext ist hier keine Formsache: holeProdukt reicht
			// im default-Zweig einen Fehler durch, der von einem *url.Error
			// aus einem fehlgeschlagenen HTTP-Aufruf stammen kann — und
			// dessen Anfrage-URL trägt den Keepa-API-Key als Query-Parameter
			// "key=...". Ohne den Scrub stünde er im Klartext auf der Seite,
			// genau die Klasse Leck, gegen die sicherFehlertext bereits in
			// channels.go absichert (siehe dortiger Kommentar).
			fehler = append(fehler, "Amazon."+string(ziel.Code)+": "+sicherFehlertext(err.Error()))
			srv.standardwerteFuer(d, ziel)
			continue
		}
		srv.uebernehmeArtikel(d, ziel, produkt)
		geholt = append(geholt, struct {
			ziel    marketplace.Marketplace
			produkt keepa.Product
		}{ziel, produkt})
	}
	for _, g := range geholt {
		srv.uebernehmeKeepa(d, g.ziel, g.produkt)
	}
	return fehler
}

// standardwerteFuer belegt den Markt, für den Keepa nicht erreichbar war.
// Gefüllt wird nur, was leer ist — der Rückweg aus Schritt 4 bringt bereits
// von Hand geprüfte Zahlen mit, und die sind besser als jeder Standardwert.
func (srv *Server) standardwerteFuer(d *dealSeite, m marketplace.Marketplace) {
	sp := d.Formular.marktZeiger(m.Code)
	if sp == nil {
		return
	}
	if strings.TrimSpace(sp.Provision) == "" {
		sp.Provision = srv.store.Einstellung(store.SchluesselProvision)
		sp.ProvisionQuelle = "standardwert"
	}
	if strings.TrimSpace(sp.FBA) == "" {
		sp.FBA = srv.store.Einstellung(store.SchluesselFBA)
		sp.FBAQuelle = "standardwert"
	}
	if strings.TrimSpace(sp.Sales) == "" {
		sp.SalesQuelle = "manuell"
	}
	sp.SalesHinweis = "Keepa nicht erreicht — bitte eintragen"
}

// uebernehmeKeepa füllt die Spalte eines Marktes aus dem Keepa-Produkt.
//
// Gefüllt wird nur, was leer ist: so überlebt der Weg zurück aus Schritt 4
// die von Hand geprüften Zahlen, während ein frischer Aufruf sie vorher über
// keepaWerteLeeren abgeräumt hat und hier alles neu bekommt. Die
// Kandidatenliste entsteht in beiden Fällen neu — sie ist Anzeige, kein
// Eingabewert.
//
// uebernehmeArtikel übernimmt aus einer Keepa-Antwort, was am Artikel hängt
// und nicht am Markt: Name, Bild und Paketmaße.
//
// Es steht bewusst in einem eigenen Durchgang VOR uebernehmeKeepa. Die
// FBA-Gebühr hängt an der Größenklasse und die Klasse an den Maßen — und Maße
// sind eine Eigenschaft des Pakets, nicht des Marktplatzes. Würden sie
// zusammen mit den Gebühren in einer Schleife aufgelöst, bekäme ein Markt,
// dem Keepa die Maße schuldig bleibt, Keepas lokale Gebühr, obwohl die Maße
// eines anderen Marktes den EFN-Tarif längst hergeben. Die lokale Gebühr ist
// die kleinere — der Deal sähe zu gut aus, und das ist die gefährliche
// Fehlerrichtung.
//
// Übernommen wird vom Leitmarkt, bei den Maßen mit einer Ausnahme: nennt er
// keine, gelten die des ersten Marktes, der welche kennt. Es ist dasselbe
// physische Paket; das ist keine erfundene Zahl, sondern dieselbe aus einer
// anderen Auskunft. Die Regel hängt nicht an der Abrufreihenfolge — ein
// später geladener Leitmarkt sticht die Maße eines früher geladenen Marktes.
func (srv *Server) uebernehmeArtikel(d *dealSeite, m marketplace.Marketplace, produkt keepa.Product) {
	if m.Code == d.Formular.Leitmarkt {
		// Ausnahme von der "nur was leer ist"-Regel: die Kennung wird immer
		// neu gesetzt. Sie ist das einzige Feld hier, das niemand von Hand
		// prüfen kann — es gibt keine sichtbare Eingabe dafür —, also gibt es
		// auch nichts zu erhalten, und sie soll immer zum gerade geladenen
		// Produkt passen.
		d.Formular.BildKennung = gepruefteBildKennung(produkt.BildKennung)
		if strings.TrimSpace(d.Formular.Titel) == "" {
			d.Formular.Titel = produkt.Titel
		}
	}
	if produkt.Masse.Vollstaendig() && (m.Code == d.Formular.Leitmarkt || !d.Formular.Masse.Vollstaendig()) {
		d.Formular.Masse = produkt.Masse
	}
}

// Was am Artikel hängt statt am Markt — Name, Bild und Maße — kommt aus
// uebernehmeArtikel und ist beim Aufruf hier bereits über alle Märkte
// aufgelöst.
func (srv *Server) uebernehmeKeepa(d *dealSeite, m marketplace.Marketplace, produkt keepa.Product) {
	sp := d.Formular.marktZeiger(m.Code)
	if sp == nil {
		return
	}

	// VK-Kandidaten, Ø 90 Tage Buy Box vorausgewählt.
	median := keepa.MedianZeitgewichtet(produkt.BuyBoxVerlauf, letzteMinute(produkt))
	gewaehlterVK := sp.VKQuelle
	for _, k := range []struct {
		schluessel, text string
		p                keepa.Price
	}{
		{"avg90", "Ø 90 Tage Buy Box", produkt.BuyBoxAvg90},
		{"median90", "Median 90 Tage Buy Box", median},
		// Ohne Buy-Box-Daten (die kosten bei Keepa zwei Token extra) ist
		// der niedrigere Ø-Preis von Amazon und FBA-Angebot der beste Ersatz.
		{"avg90fba", "Ø 90 Tage Amazon/FBA", produkt.AmazonFBAAvg90},
		{"aktuell", "Buy Box aktuell", produkt.BuyBoxAktuell},
		{"amazon", "Amazon aktuell", produkt.AmazonAktuell},
	} {
		if !k.p.OK {
			continue
		}
		gewaehlt := k.schluessel == gewaehlterVK || (gewaehlterVK == "" && k.schluessel == "avg90")
		sp.Kandidaten = append(sp.Kandidaten, kandidat{
			Schluessel: k.schluessel, Bezeichnung: k.text,
			Wert: k.p.Cents.String(), Gewaehlt: gewaehlt,
		})
		if gewaehlt && strings.TrimSpace(sp.VK) == "" {
			sp.VK = k.p.Cents.String()
			sp.VKQuelle = k.schluessel
		}
	}
	// Kennt Keepa den vorausgewählten Kandidaten für diesen Markt nicht,
	// rückt der erste vorhandene nach. Ist gar keiner übrig, bleibt das Feld
	// leer — es wird kein Wert erfunden.
	if strings.TrimSpace(sp.VK) == "" && len(sp.Kandidaten) > 0 {
		sp.VK = sp.Kandidaten[0].Wert
		sp.VKQuelle = sp.Kandidaten[0].Schluessel
		sp.Kandidaten[0].Gewaehlt = true
	}

	sales, quelle := produkt.Sales()
	switch quelle {
	case keepa.SalesMonthlySold:
		sp.SalesHinweis = "Keepa · monthlySold (Amazon-Badge)"
	case keepa.SalesRankDrops:
		sp.SalesHinweis = "Keepa · Schätzung aus Rangsprüngen, 30 Tage"
	default:
		sp.SalesHinweis = "Keepa hat keine Verkaufszahl — bitte eintragen"
	}
	if strings.TrimSpace(sp.Sales) == "" && quelle != keepa.SalesKeine {
		// Keine Zahl heißt leeres Feld, nicht 0: Product.Sales liefert für
		// "unbekannt" den Nullwert, und "ℹ️ Amazon.DE: 0 Verkäufe" wäre eine
		// veröffentlichte Aussage, die niemand gemessen hat. Leer lässt
		// baueDeal das Posten verweigern, bis jemand eine Zahl einträgt.
		sp.Sales = strconv.Itoa(sales)
		if quelle == keepa.SalesMonthlySold {
			sp.SalesQuelle = "monthlySold"
		} else {
			sp.SalesQuelle = "rankDrops30"
		}
	}

	if strings.TrimSpace(sp.Provision) == "" {
		if produkt.ProvisionProzent != nil {
			sp.Provision = strconv.FormatFloat(*produkt.ProvisionProzent, 'f', -1, 64)
			sp.ProvisionQuelle = "keepa"
		} else {
			sp.Provision = srv.store.Einstellung(store.SchluesselProvision)
			sp.ProvisionQuelle = "standardwert"
		}
	}

	// Die FBA-Gebühr aus drei möglichen Quellen — und welche zuerst gefragt
	// wird, hängt am Versandweg.
	//
	// **Geht die Ware ins Ausland**, gilt der EFN-Tarif, und Keepa kennt ihn
	// nicht: Keepa nennt je Marktplatz die lokale Gebühr, also die für Ware,
	// die bereits dort liegt. Sie ist je nach Klasse nur ein Drittel bis zwei
	// Drittel des EFN-Tarifs und ließe jeden Auslandsdeal viel zu gut
	// aussehen. Hier führt die Staffel.
	//
	// **Bleibt sie im Lagerland**, ist Keepas Zahl genau die gesuchte — und
	// zwar aus Amazons eigener Einstufung, die Warengruppe und Volumengewicht
	// kennt und damit mehr weiß als die Staffel hier. Dann führt Keepa, und
	// die Staffel fängt nur auf, was Keepa nicht weiß (etwa fehlende Maße).
	//
	// Erfunden wird auf keiner Stufe etwas: bleibt alles leer, steht der
	// Standardwert da, und der ist ohne Eintrag ebenfalls leer.
	if strings.TrimSpace(sp.FBA) == "" {
		weg := srv.wegFuer(m.Code)
		// d.Formular.Masse, nicht produkt.Masse: die Maße sind über alle
		// Märkte aufgelöst (siehe uebernehmeArtikel), und genau darauf beruht
		// die Größenklasse. Die Maße dieser einen Antwort zu nehmen hieße,
		// einen Markt ohne Maße auf Keepas lokale Gebühr fallen zu lassen,
		// obwohl der EFN-Tarif bestimmbar ist.
		cent, klasse, tarif := srv.tarifGebuehr(m.Code, d.Formular.Masse)
		switch {
		case tarif && weg == fba.EFN:
			sp.FBA = cent.String()
			sp.FBAQuelle = tarifQuelle(weg, klasse)
		case produkt.FBA.OK:
			sp.FBA = produkt.FBA.Cents.String()
			sp.FBAQuelle = "keepa"
		case tarif:
			sp.FBA = cent.String()
			sp.FBAQuelle = tarifQuelle(weg, klasse)
		default:
			sp.FBA = srv.store.Einstellung(store.SchluesselFBA)
			sp.FBAQuelle = "standardwert"
		}
	}
}

// berechneDeal liefert nur die Aufschlüsselung — das ist der Live-Teil von
// Schritt 3: jede Änderung an einem Feld schickt das Formular hierher und
// tauscht damit die Rechnung auf derselben Seite aus, ohne sie zu verlassen.
func (srv *Server) berechneDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest(schrittRechnung)
	d.Formular = formularLesen(r)
	srv.rechnungFuellen(&d)
	srv.rendere(w, "rechnung", d)
}

// keepaKeyAufloesen löst den gültigen Keepa-Key neu auf, statt sich auf den
// einmalig beim Start gelesenen Wert zu verlassen (C1 im Abschluss-Review:
// sonst blieb ein frisch in den Einstellungen gespeicherter Key bis zum
// Neustart des Programms wirkungslos, weil main.go ihn nur ein einziges Mal
// in srv.keepa.Key schrieb).
//
// Die Umgebungsvariable KEEPA_API_KEY sticht dauerhaft — genau wie es das
// README für den Docker-Betrieb verspricht. Sonst gilt die zuletzt in den
// Einstellungen gespeicherte. Liefert auch die Einstellung nichts, gilt der
// Key, der aktuell an srv.keepa.Key hinterlegt ist: Tests hinterlegen den
// Key teils direkt am Client, ohne je eine Einstellung zu speichern, und
// sollen dabei funktionieren.
//
// Anders als der ursprüngliche C1-Fix schreibt diese Funktion srv.keepa.Key
// nicht mehr, sondern liefert den aufgelösten Key nur noch als Rückgabewert.
// Der frühere Schreibzugriff war ein Datenrennen: net/http bedient jede
// Anfrage in einer eigenen Goroutine, srv.keepa ist dabei ein einziger,
// serverweit geteilter *keepa.Client, und Produkt() (internal/keepa) liest
// c.Key beim Bau der Anfrage-URL ohne jede Synchronisierung mit diesem
// Schreibzugriff. Zwei nahezu gleichzeitige POST /deal/laden — ein
// Doppelklick, zwei Browser-Tabs — griffen also unsynchronisiert lesend und
// schreibend auf dasselbe string-Feld zu; go test -race meldet das
// zuverlässig (siehe TestLadenGleichzeitigOhneDatenrennenAmKeepaKey in
// deal_test.go). holeProdukt baut aus dem hier gelieferten Key stattdessen
// eine flache, ausschließlich der aufrufenden Anfrage gehörende Kopie des
// Clients — srv.keepa.Key selbst wird nach dem Start nie wieder verändert
// und bleibt damit so nebenläufigkeitssicher wie vor dem C1-Fix.
func (srv *Server) keepaKeyAufloesen() string {
	if srv.envKeepaKey != "" {
		return srv.envKeepaKey
	}
	if v := srv.store.Einstellung(store.SchluesselKeepaKey); v != "" {
		return v
	}
	return srv.keepa.Key
}

// holeProdukt fragt Keepa, nutzt aber zuerst den Zwischenspeicher.
func (srv *Server) holeProdukt(r *http.Request, asin string, ziel marketplace.Marketplace) (keepa.Product, error) {
	return srv.holeProduktCtx(r.Context(), asin, ziel, r.PostForm.Get("neu_laden") != "")
}

// holeProduktCtx ist holeProdukt ohne Anfrage — der Shop-Monitor ruft es aus
// dem Hintergrund. neuLaden umgeht den Zwischenspeicher.
func (srv *Server) holeProduktCtx(ctx context.Context, asin string, ziel marketplace.Marketplace, neuLaden bool) (keepa.Product, error) {
	minuten := srv.store.EinstellungZahl(store.SchluesselCacheMinuten)
	if roh, da := srv.store.CacheLesen(asin, ziel.KeepaDomain,
		time.Duration(minuten)*time.Minute); da && !neuLaden {
		if a, err := keepa.ParseAntwort(roh); err == nil {
			return a.Produkt, nil
		}
	}

	// Der Key wird erst jetzt, unmittelbar vor der Anfrage, aufgelöst — die
	// Prüfung direkt darunter betrachtet also den Key, der tatsächlich
	// benutzt wird, nicht mehr zwei voneinander unabhängige, potenziell
	// widersprüchliche Quellen (siehe C1 im Abschluss-Review).
	schluessel := srv.keepaKeyAufloesen()
	if schluessel == "" {
		return keepa.Product{}, errors.New("Kein Keepa-API-Key hinterlegt — bitte in den Einstellungen eintragen.")
	}

	// srv.keepa ist über alle Handler und damit über alle von net/http pro
	// Anfrage gestarteten Goroutinen hinweg ein einziger, gemeinsam
	// genutzter *keepa.Client. Eine flache Kopie mit dem aufgelösten Key
	// gehört dagegen ausschließlich dieser Anfrage — kein anderer, auch
	// gleichzeitig laufender Aufruf sieht sie oder kann mit ihr
	// kollidieren. Der eingebettete *http.Client und die beiden Basis-URLs
	// werden unverändert mitkopiert (ein *http.Client ist ausdrücklich für
	// nebenläufige Nutzung durch mehrere Goroutinen ausgelegt).
	keepaClient := *srv.keepa
	keepaClient.Key = schluessel

	a, roh, err := keepaClient.Produkt(ctx, asin, ziel.KeepaDomain)
	if err != nil {
		// Ein leeres Kontingent hält auch die ASIN-Liste an.
		srv.keepaPausieren(err)
		return keepa.Product{}, keepaFehler(err, asin, ziel)
	}

	srv.merkeToken(a.TokensLeft, a.TokensConsumed)
	srv.merkeRate(a.RefillRate)
	// Erst mit diesem Schreibzugriff wird der Cache tatsächlich befüllt —
	// vorher las CacheLesen oben immer ins Leere, und jeder Klick auf
	// "Laden" verbrauchte ein Token, obwohl die Einstellung "Keepa-Cache in
	// Minuten" längst existierte (I4 im Abschluss-Review). Ein Fehler beim
	// Schreiben ist kein Grund, das schon erfolgreich geladene Produkt dem
	// Nutzer vorzuenthalten — der nächste Aufruf verbraucht dann eben
	// erneut ein Token.
	_ = srv.store.CacheSchreiben(asin, ziel.KeepaDomain, roh)
	return a.Produkt, nil
}

// vorschauDeal wertet Schritt 3 aus und zeigt Schritt 4: den fertigen Post.
func (srv *Server) vorschauDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest(schrittVorschau)
	d.Formular = formularLesen(r)
	srv.fuelleTagAuswahl(&d)

	erg, err := srv.baueDeal(d.Formular)
	if err != nil {
		d.Fehler = sicherFehlertext(err.Error())
		srv.rendereSchritt(w, r, "schritt4", d)
		return
	}
	d.uebernehmeGeprueft(erg)
	srv.rendereSchritt(w, r, "schritt4", d)
}

// uebernehmeGeprueft füllt Schritt 4 aus dem fertig gerechneten Deal.
//
// Der Einkaufslink wandert dabei in der geprüften Form zurück ins Formular:
// baueDeal nimmt ihn ohnehin nur so, wie ParseEinkaufslink ihn entschärft
// hat, und ab hier trägt ihn auch das Formular so weiter statt in der
// Rohfassung, mit der eine von Hand gebaute Anfrage hereingekommen sein kann.
func (d *dealSeite) uebernehmeGeprueft(erg dealErgebnis) {
	d.ChartURL = erg.Leit().ChartURL
	d.Karte = kartenVorschauAus(erg.Text, d.ChartURL)
	d.Ergebnisse = ergebnisUebersicht(erg)
	if erg.Extern {
		d.Formular.QuellURL = erg.QuellURL
	}
}

// sendeDeal postet und speichert — in dieser Reihenfolge.
//
// Ein Deal landet nur dann in der Historie, wenn Discord das Senden bestätigt
// hat. Lieber ein verlorener Entwurf als ein Eintrag, der fälschlich
// behauptet, gepostet worden zu sein.
func (srv *Server) sendeDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest(schrittVorschau)
	d.Formular = formularLesen(r)
	srv.fuelleTagAuswahl(&d)

	if d.Formular.ChannelID == 0 {
		d.Fehler = "Bitte einen Channel auswählen."
		srv.rendereSchritt(w, r, "schritt4", d)
		return
	}

	erg, err := srv.baueDeal(d.Formular)
	if err != nil {
		d.Fehler = sicherFehlertext(err.Error())
		srv.rendereSchritt(w, r, "schritt4", d)
		return
	}
	d.uebernehmeGeprueft(erg)

	if erg.Channel.ID == 0 {
		d.Fehler = "Der gewählte Channel existiert nicht mehr."
		srv.rendereSchritt(w, r, "schritt4", d)
		return
	}

	// Post und Historie gehören weiterhin einem einzigen Markt — dem
	// Leitmarkt, derselbe Eintrag, den auch uebernehmeGeprueft oben für Chart
	// und Vorschau verwendet hat.
	leitErg := erg.Leit()

	// Der Chart wird jetzt geholt und genau dieses Bild wird gesendet und
	// archiviert — so zeigt die Historie später denselben Stand.
	png, chartErr := srv.holeCharts(r.Context(), d.Formular.ASIN, leitErg.Ziel.KeepaDomain, d.Formular.VerkaufsLinie)
	if chartErr != nil && r.PostForm.Get("ohne_chart") == "" {
		d.Fehler = "Chart nicht ladbar: " + sicherFehlertext(chartErr.Error()) +
			" — mit „Ohne Chart senden\" trotzdem posten."
		// Ohne dieses Feld nannte die Meldung oben einen Knopf, den keine
		// Vorlage je gerendert hat: r.PostForm.Get("ohne_chart") blieb immer
		// leer und ein fehlgeschlagener Chart-Abruf blockierte das Posten
		// endgültig, obwohl das Design genau für diesen Fall einen
		// dokumentierten Ausweg verspricht (I3 im Abschluss-Review).
		d.OhneChartAnbieten = true
		srv.rendereSchritt(w, r, "schritt4", d)
		return
	}

	ausgang, err := srv.posten(r.Context(), d.Formular, erg, png, eingabenZumMerken(r.PostForm).Encode())
	if err != nil {
		d.Fehler = err.Error()
		srv.rendereSchritt(w, r, "schritt4", d)
		return
	}
	gepostetIn, fehlgeschlagen := ausgang.GepostetIn, ausgang.Fehlgeschlagen

	// Der Posten-Knopf zielt mit hx-target="#funnel" auf ein Fragment, kein
	// ganzes Dokument. Die "deal"-Vorlage ist aber ein komplettes
	// <!doctype html>-Dokument samt Kopfzeile und einem eigenen, zweiten
	// #funnel — htmx entfernt <head> und hängt den Rest von <body> in
	// #funnel ein, während das Formular unverändert mit seinen alten Werten
	// stehen bleibt und zu einem zweiten Klick auf Posten einlädt, der
	// denselben Deal ein zweites Mal senden würde (I6 im Abschluss-Review).
	// HX-Refresh: true lässt htmx statt dessen die ganze Seite neu laden —
	// die Startseite kommt danach mit leerem Formular und ohne jede
	// Möglichkeit, denselben POST versehentlich zu wiederholen.
	if p, ok := srv.poster(d.Formular.Poster); ok {
		merkePoster(w, p.Name)
	}
	if len(fehlgeschlagen) > 0 {
		// Statt neu zu laden zur Historie, wo die Meldung stehen bleibt.
		w.Header().Set("HX-Redirect", "/historie?fehler="+urlText("Gepostet in "+
			strings.Join(gepostetIn, ", ")+". Nicht gepostet: "+strings.Join(fehlgeschlagen, " · ")))
		srv.rendere(w, "gepostet", "Teilweise gepostet.")
		return
	}
	w.Header().Set("HX-Refresh", "true")
	srv.rendere(w, "gepostet", "Gepostet in "+strings.Join(gepostetIn, ", ")+".")
}

// postAusgang sagt, wohin ein Deal gegangen ist.
type postAusgang struct {
	HauptID        int64
	GepostetIn     []string
	Fehlgeschlagen []string
}

// posten sendet einen fertig gerechneten Deal an seinen Channel und an die
// weiteren Channels aus f.WeitereChannels und legt jeden Post in der Historie
// ab — der Kern von sendeDeal, den auch der Shop-Monitor nutzt. So sieht ein
// Monitor-Deal genau so aus wie einer, der von Hand gepostet wurde.
//
// Ein Fehler heißt: der erste Post ist nicht hinausgegangen oder nicht
// gespeichert. Scheitert nur ein weiterer Channel, steht das in
// Fehlgeschlagen, denn der erste Post ist dann schon draußen.
//
// formular sind die Eingaben für "Erneut posten" (siehe eingabenZumMerken).
func (srv *Server) posten(ctx context.Context, f dealFormular, erg dealErgebnis, png []byte, formular string) (postAusgang, error) {
	leitErg := erg.Leit()
	chartName := ""
	if len(png) > 0 {
		chartName = f.ASIN + ".png"
	}

	// Ein schlichter Textpost mit dem Chart als Anhang darunter — keine
	// Karte: ein Anhang steht in voller Breite im Channel, ein Bild in einer
	// Karte nur so breit wie die Karte. Die Erwähnung steht im Text am Ende
	// der Titelzeile und pingt dort auch.
	gesendet, err := discord.SendeMitWiederholung(ctx, srv.http, erg.Channel.WebhookURL, discord.Nachricht{
		Inhalt:    erg.Text,
		Mention:   discord.MentionTyp(erg.Channel.MentionTyp),
		RollenID:  erg.Channel.RollenID,
		ChartName: chartName,
		ChartPNG:  png,
	})
	if err != nil {
		if errors.Is(err, discord.ErrWebhookTot) {
			_ = srv.store.ChannelDefekt(erg.Channel.ID, true)
		}
		// sicherFehlertext ist hier Pflicht, nicht Kosmetik: internal/discord
		// bemüht sich zwar, die Webhook-URL nie in einen Fehler zu
		// schreiben, aber dieser zweite, unabhängige Scrub ist die
		// etablierte Verteidigungslinie dieses Projekts (siehe channels.go)
		// und fängt jede URL ab, die trotzdem durchrutscht.
		return postAusgang{}, errors.New("Nicht gesendet: " + sicherFehlertext(err.Error()))
	}
	_ = srv.store.ChannelDefekt(erg.Channel.ID, false)

	// Gepostet ist gepostet: der Entwurf, aus dem der Deal stammt, hat
	// seinen Zweck erfüllt.
	if f.EntwurfID != 0 {
		_ = srv.store.EntwurfLoeschen(f.EntwurfID)
	}

	chartDatei := ""
	if len(png) > 0 {
		chartDatei, _ = srv.store.ChartSpeichern(f.ASIN, png)
	}

	quellURL := ""
	if erg.Extern {
		quellURL = erg.QuellURL
	}
	// Die Herkunftsangaben der Historie gehören zum gerechneten Markt, also
	// zum Leitmarkt — dieselbe Zeile trägt ja auch dessen Gewinn und Marge.
	leit := f.Leit()

	// Die Marktzeilen tragen dieselben Zahlen wie der gesendete Post. Die
	// Quellen ("keepa", "standardwert", "EFN-Tarif · Standardpaket") kommen
	// aus dem Formular — in der Historie soll später ablesbar sein, woher
	// jede Zahl stammte.
	maerkte := make([]store.DealMarkt, 0, len(erg.Maerkte))
	for _, m := range erg.Maerkte {
		mf, _ := f.Markt(m.Ziel.Code)
		dm := store.DealMarkt{
			Markt: string(m.Ziel.Code), Leitmarkt: m.Leitmarkt,
			VKCent: m.VKBrutto, VKQuelle: mf.VKQuelle,
			Sales: m.Sales, SalesQuelle: mf.SalesQuelle,
			ProvisionProzent: m.Provision, ProvisionQuelle: mf.ProvisionQuelle,
			FBACent: m.FBA, FBAQuelle: mf.FBAQuelle,
			GewinnCent: m.Ergebnis.Gewinn, MargeProzent: m.Ergebnis.MargeProzent,
		}
		// Nur wo es den Vergleich gibt. Ein Nullwert stünde sonst als
		// Aussage da, die niemand gerechnet hat.
		if m.PanEU != nil {
			dm.PanEU = &store.DealMarktPanEU{
				FBACent:      m.PanEUGebuehr,
				GewinnCent:   m.PanEU.Gewinn,
				MargeProzent: m.PanEU.MargeProzent,
			}
		}
		maerkte = append(maerkte, dm)
	}

	eintrag := store.Deal{
		ASIN: f.ASIN, Titel: f.Titel,
		Quellmarkt: string(erg.Quell.Code), QuellURL: quellURL,
		Lieferant: func() string {
			if f.OhneLink {
				return lieferantAnzeige(f.Lieferant)
			}
			return ""
		}(),
		Zielmarkt: string(leitErg.Ziel.Code),
		// Gespeichert wird der Bruttopreis, auch nach einer Netto-Eingabe:
		// die Historie soll Zeile für Zeile vergleichbar bleiben, egal wie
		// der Preis eingegeben wurde. Wie er eingegeben wurde, steht in
		// EKArt daneben.
		EKCent: leitErg.Ergebnis.EKBrutto, EKArt: f.EKArt, EKNotiz: f.EKNotiz,
		MaxMenge: erg.MaxMenge,
		Poster: func() string {
			if p, ok := srv.poster(f.Poster); ok {
				return p.Name
			}
			return ""
		}(),
		Steuersatz: func() string {
			if f.Steuersatz == "ermaessigt" {
				return "ermaessigt"
			}
			return ""
		}(),
		VKCent: leitErg.VKBrutto, VKQuelle: leit.VKQuelle,
		Sales: leitErg.Sales, SalesQuelle: leit.SalesQuelle,
		ProvisionProzent: leitErg.Provision, ProvisionQuelle: leit.ProvisionQuelle,
		FBACent: leitErg.FBA, FBAQuelle: leit.FBAQuelle,
		UStModus:   f.UStModus,
		GewinnCent: leitErg.Ergebnis.Gewinn, MargeProzent: leitErg.Ergebnis.MargeProzent,
		ChannelID: erg.Channel.ID, ChannelName: erg.Channel.Name, Gruppe: erg.Channel.Gruppe,
		NachrichtText: erg.Text, ChartDatei: chartDatei,
		BildKennung:        f.BildKennung,
		DiscordNachrichtID: gesendet.NachrichtID,
		DiscordKanalID:     gesendet.KanalID,
		Maerkte:            maerkte,
	}
	eintrag.Formular = formular
	hauptID, err := srv.store.DealAnlegen(eintrag)
	if err != nil {
		return postAusgang{}, errors.New("Gepostet, aber nicht in der Historie gespeichert: " + sicherFehlertext(err.Error()))
	}

	// ✅ und ❌ unter den Post setzen, falls ein Bot eingerichtet ist.
	srv.reaktionenVorbelegen(gesendet.KanalID, gesendet.NachrichtID, erg.Channel.Name)
	// Und derselbe Post zusätzlich an Telegram, falls eingeschaltet — nur
	// einmal, auch wenn der Deal in mehrere Channels geht.
	srv.anTelegram(erg.Text, png)

	// Weitere Channels: derselbe Deal mit demselben Chart, jeweils mit der
	// Erwähnung des Channels. Jeder Post steht für sich in der Historie und
	// verweist auf den ersten; die Statistik über alle Gruppen zählt den
	// Deal so nur einmal. Ein Fehler hier nimmt den ersten Post nicht zurück
	// — er ist ja draußen — und wird darum nach dem Neuladen gemeldet.
	gepostetIn := []string{"#" + erg.Channel.Name}
	var fehlgeschlagen []string
	for _, cid := range f.WeitereChannels {
		f := f
		f.ChannelID = cid
		weiter, err := srv.baueDeal(f)
		if err != nil || weiter.Channel.ID == 0 {
			fehlgeschlagen = append(fehlgeschlagen, "Channel "+itoa(cid)+" gibt es nicht mehr")
			continue
		}
		g, err := discord.SendeMitWiederholung(ctx, srv.http, weiter.Channel.WebhookURL, discord.Nachricht{
			Inhalt: weiter.Text, Mention: discord.MentionTyp(weiter.Channel.MentionTyp),
			RollenID: weiter.Channel.RollenID, ChartName: chartName, ChartPNG: png,
		})
		if err != nil {
			if errors.Is(err, discord.ErrWebhookTot) {
				_ = srv.store.ChannelDefekt(weiter.Channel.ID, true)
			}
			fehlgeschlagen = append(fehlgeschlagen, "#"+weiter.Channel.Name+": "+sicherFehlertext(err.Error()))
			continue
		}
		_ = srv.store.ChannelDefekt(weiter.Channel.ID, false)
		zweit := eintrag
		zweit.HauptID = hauptID
		zweit.ChannelID, zweit.ChannelName, zweit.Gruppe = weiter.Channel.ID, weiter.Channel.Name, weiter.Channel.Gruppe
		zweit.NachrichtText = weiter.Text
		zweit.DiscordNachrichtID, zweit.DiscordKanalID = g.NachrichtID, g.KanalID
		if _, err := srv.store.DealAnlegen(zweit); err != nil {
			fehlgeschlagen = append(fehlgeschlagen, "#"+weiter.Channel.Name+": gepostet, aber nicht gespeichert")
		}
		srv.reaktionenVorbelegen(g.KanalID, g.NachrichtID, weiter.Channel.Name)
		gepostetIn = append(gepostetIn, "#"+weiter.Channel.Name)
	}

	return postAusgang{HauptID: hauptID, GepostetIn: gepostetIn, Fehlgeschlagen: fehlgeschlagen}, nil
}

// zeigeChart reicht das Keepa-Bild für die Vorschau durch, damit die Seite
// keine Fremdadresse laden muss.
func (srv *Server) zeigeChart(w http.ResponseWriter, r *http.Request) {
	asin := strings.ToUpper(r.URL.Query().Get("asin"))
	m, ok := marketplace.ByCode(marketplace.Code(r.URL.Query().Get("markt")))
	if !ok || asin == "" {
		http.Error(w, "asin und markt sind nötig", http.StatusBadRequest)
		return
	}

	png, err := srv.holeCharts(r.Context(), asin, m.KeepaDomain, r.URL.Query().Get("verkauft") == "1")
	if err != nil {
		http.Error(w, "Chart nicht ladbar: "+sicherFehlertext(err.Error()), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Write(png)
}

// holeCharts holt den Preisverlauf und, sofern eingestellt, darunter
// denselben Chart über einen kürzeren Zeitraum (Vorgabe 30 Tage) — beide in
// einem Bild, siehe keepa.Untereinander.
//
// Nur der erste Chart ist Pflicht. Scheitert der kurze, geht der lange
// allein hinaus: ein fehlender Zusatz soll keinen Deal aufhalten.
func (srv *Server) holeCharts(ctx context.Context, asin string, keepaDomain int, verkaufsLinie bool) ([]byte, error) {
	o := srv.chartOptionen()
	lang, err := srv.keepa.Chart(ctx, asin, keepaDomain, o)
	if err != nil {
		return nil, err
	}
	lang = beschriftet(srv.mitVerkaufslinie(ctx, lang, asin, keepaDomain, o, verkaufsLinie), o.Tage)

	tage := srv.store.EinstellungZahl(store.SchluesselChartTageKurz)
	if tage <= 0 || tage == o.Tage {
		return lang, nil
	}
	o.Tage = tage
	kurz, err := srv.keepa.Chart(ctx, asin, keepaDomain, o)
	if err != nil {
		return lang, nil
	}
	kurz = beschriftet(srv.mitVerkaufslinie(ctx, kurz, asin, keepaDomain, o, verkaufsLinie), o.Tage)
	beide, err := keepa.Untereinander(lang, kurz)
	if err != nil {
		return lang, nil
	}
	return beide, nil
}

func (srv *Server) chartOptionen() keepa.ChartOptionen {
	o := keepa.StandardChart
	if n := srv.store.EinstellungZahl(store.SchluesselChartTage); n > 0 {
		o.Tage = n
	}
	if n := srv.store.EinstellungZahl(store.SchluesselChartBreite); n > 0 {
		o.Breite = n
	}
	if n := srv.store.EinstellungZahl(store.SchluesselChartHoehe); n > 0 {
		o.Hoehe = n
	}
	o.SalesRank = srv.store.Einstellung(store.SchluesselChartSalesRank) == "1"
	o.BuyBox = srv.store.Einstellung(store.SchluesselChartBuyBox) == "1"
	o.Amazon = srv.store.Einstellung(store.SchluesselChartAmazon) == "1"
	o.Neu = srv.store.Einstellung(store.SchluesselChartNeu) == "1"
	o.FBA = srv.store.Einstellung(store.SchluesselChartFBA) == "1"
	return o
}

// letzteMinute liefert den Endzeitpunkt für die Mediansspanne.
func letzteMinute(p keepa.Product) int {
	if len(p.BuyBoxVerlauf) == 0 {
		return 0
	}
	return p.BuyBoxVerlauf[len(p.BuyBoxVerlauf)-1].Minute + 1
}

// preisOhneLink ist Schritt 1 für einen Einkauf ohne Link (Großhandel):
// gebraucht werden die ASIN, das Einkaufsland (für die Umsatzsteuer) und
// optional der Name des Lieferanten. Weiter geht es erst, wenn alle drei
// Felder einmal sichtbar im Formular standen.
func (srv *Server) preisOhneLink(w http.ResponseWriter, r *http.Request, d dealSeite) {
	f := &d.Formular
	f.QuellURL = ""
	// Wer die ASIN ins Linkfeld getippt hat, meint sie.
	if f.ASIN == "" && asinMuster.MatchString(strings.ToUpper(strings.TrimSpace(f.Einkaufslink))) {
		f.ASIN = strings.ToUpper(strings.TrimSpace(f.Einkaufslink))
	}
	f.Einkaufslink, f.LinkBestaetigt = "", ""
	if f.Quellmarkt == "" {
		f.Quellmarkt = "DE"
	}
	d.ASINFrage, d.MarktFrage = true, true
	d.QuellHost = quellHostAnzeige(*f)

	_, marktBekannt := marketplace.ByCode(marketplace.Code(f.Quellmarkt))
	gesehen := r.PostForm.Get("ohne_link_gesehen") == "1"
	switch {
	case f.ASIN != "" && !asinMuster.MatchString(f.ASIN):
		d.Fehler = "Das ist keine gültige ASIN — zehn Zeichen, Buchstaben und Ziffern."
	case !asinMuster.MatchString(f.ASIN) || !marktBekannt || !gesehen:
		d.Hinweis = "Einkauf ohne Link: bitte ASIN, Einkaufsland und — wenn ihr wollt — den Lieferanten eintragen."
	default:
		srv.standardMaerkteSetzen(f)
		d.Schritt = schrittEinkauf
		srv.rendereSchritt(w, r, "schritt2", d)
		return
	}
	srv.rendereSchritt(w, r, "schritt1", d)
}

// schonGepostet beschreibt die bisherigen Posts einer ASIN, etwa
// "2× gepostet, zuletzt am 12.09.2026 in #deals (26,70 € / 12,9 %)".
// Gelöschte Posts zählen nicht; ein Deal in mehreren Channels zählt einmal.
func (srv *Server) schonGepostet(asin string) string {
	asin = strings.ToUpper(strings.TrimSpace(asin))
	if !asinMuster.MatchString(asin) {
		return ""
	}
	deals, err := srv.store.Deals(store.DealFilter{Suche: asin})
	if err != nil {
		return ""
	}
	var treffer []store.Deal
	for _, d := range deals {
		if strings.EqualFold(d.ASIN, asin) && d.Status != store.StatusGeloescht && d.HauptID == 0 {
			treffer = append(treffer, d)
		}
	}
	if len(treffer) == 0 {
		return ""
	}
	letzter := treffer[0]
	for _, d := range treffer {
		if d.GepostetAm.After(letzter.GepostetAm) {
			letzter = d
		}
	}
	text := itoa(int64(len(treffer))) + "× gepostet, zuletzt am " + letzter.GepostetAm.Local().Format("02.01.2006") +
		" in #" + letzter.ChannelName + " (" + letzter.EffGewinnCent.Euro() + " / " + prozent(letzter.EffMargeProzent, 1) + ")"
	if letzter.Status == store.StatusAusverkauft {
		text += ", als ausverkauft markiert"
	}
	return text
}

// beschriftet setzt "90 Tage" (oder den eingestellten Zeitraum) über einen
// Chart. Geht das nicht, bleibt der Chart ohne Streifen — ein fehlendes
// Etikett ist kein Grund, den Deal nicht zu posten.
func beschriftet(png []byte, tage int) []byte {
	mit, err := keepa.MitBeschriftung(png, strconv.Itoa(tage)+" Tage")
	if err != nil {
		return png
	}
	return mit
}

// mitVerkaufslinie setzt, wenn gewünscht, den Graphen "Monatlich verkauft"
// desselben Zeitraums unter einen Preis-Chart — in beiden Charts, damit
// niemand im einen sucht, was im anderen fehlt. Liefert Keepa ihn nicht,
// bleibt der Preis-Chart allein: lieber ohne Linie als mit Fehlerbild.
func (srv *Server) mitVerkaufslinie(ctx context.Context, preis []byte, asin string, keepaDomain int, o keepa.ChartOptionen, gewuenscht bool) []byte {
	if !gewuenscht {
		return preis
	}
	hoehe := max(o.Hoehe*45/100, 150)
	verkauf, err := srv.keepa.VerkaufsChart(ctx, asin, keepaDomain, o.Tage, o.Breite, hoehe)
	if err != nil {
		log.Printf("Chart „Monatlich verkauft“ für %s nicht geholt: %v", asin, sicherFehlertext(err.Error()))
		return preis
	}
	beide, err := keepa.Untereinander(preis, verkauf)
	if err != nil {
		return preis
	}
	return beide
}

// keepaFehler übersetzt einen Fehler der Keepa-Abfrage in einen Text für
// die Oberfläche.
func keepaFehler(err error, asin string, ziel marketplace.Marketplace) error {
	var leer keepa.ErrTokensErschoepft
	switch {
	case errors.As(err, &leer):
		// leer.RefillIn ist bei !Bekannt der Nullwert 0 — der darf nie
		// als "0s" ausgegeben werden: das läse sich wie eine Zusage,
		// dass ein sofortiger Retry funktioniert, obwohl Keepa schlicht
		// keine verwertbare Wartezeit genannt hat.
		if !leer.Bekannt {
			return errors.New(
				"Keepa-Kontingent erschöpft, Wartezeit unbekannt — bitte später erneut versuchen. Die Felder lassen sich in der Zwischenzeit von Hand ausfüllen.")
		}
		return fmt.Errorf(
			"Keepa-Kontingent erschöpft. Neue Token in %s. Die Felder lassen sich von Hand ausfüllen.",
			leer.RefillIn.Round(time.Second))
	case errors.Is(err, keepa.ErrNichtGefunden):
		return fmt.Errorf("Keepa kennt die ASIN %s auf amazon.%s nicht.", asin, ziel.TLD)
	default:
		return fmt.Errorf("Keepa nicht erreichbar: %v. Die Felder lassen sich von Hand ausfüllen.", err)
	}
}
