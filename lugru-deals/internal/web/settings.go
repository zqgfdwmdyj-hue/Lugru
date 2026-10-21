package web

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type ustZeile struct {
	Code marketplace.Code
	Wert string
	// Ermaessigt ist der ermäßigte Satz desselben Landes.
	Ermaessigt string
}

type einstellungenDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	Vorschau  kartenVorschau
	Abgleich  abgleichStand
	Telegram  telegramAnzeige

	Maerkte []marketplace.Marketplace
	USt     []ustZeile
	Werte   map[string]string

	// Channels mit Häkchen, ob sie B2B-Deals führen.
	B2BWahl []b2bWahl
}

type b2bWahl struct {
	ID    int64
	Name  string
	Aktiv bool
}

func (srv *Server) einstellungenDaten() einstellungenDaten {
	alle := srv.store.AlleEinstellungen()

	var ust []ustZeile
	for _, m := range marketplace.All() {
		ust = append(ust, ustZeile{Code: m.Code, Wert: alle[store.SchluesselUStPrefix+string(m.Code)],
			Ermaessigt: alle[store.SchluesselUStErmPrefix+string(m.Code)]})
	}

	var b2b []b2bWahl
	alleChannels, _ := srv.store.Channels()
	aktiv, _ := srv.store.B2BChannels()
	for _, c := range alleChannels {
		w := b2bWahl{ID: c.ID, Name: c.Name}
		for _, a := range aktiv {
			w.Aktiv = w.Aktiv || a.ID == c.ID
		}
		b2b = append(b2b, w)
	}

	return einstellungenDaten{
		B2BWahl:  b2b,
		Telegram: srv.telegramAnzeige(),
		Abgleich: srv.abgleichStand().MitSeite("einstellungen"),
		Titel:    "Einstellungen",
		Maerkte:  marketplace.All(),
		USt:      ust,
		Werte: map[string]string{
			"keepaKey":      alle[store.SchluesselKeepaKey],
			"vorlage":       alle[store.SchluesselVorlage],
			"provision":     alle[store.SchluesselProvision],
			"fba":           alle[store.SchluesselFBA],
			"margenBasis":   alle[store.SchluesselMargenBasis],
			"zielmarkt":     alle[store.SchluesselZielmarkt],
			"lagerland":     alle[store.SchluesselLagerland],
			"efnZuschlag":   alle[store.SchluesselEFNZuschlag],
			"chartTage":     alle[store.SchluesselChartTage],
			"chartTageKurz": alle[store.SchluesselChartTageKurz],
			"chartBreite":   alle[store.SchluesselChartBreite],
			"chartHoehe":    alle[store.SchluesselChartHoehe],
			"chartRang":     alle[store.SchluesselChartSalesRank],
			"chartBuyBox":   alle[store.SchluesselChartBuyBox],
			"chartAmazon":   alle[store.SchluesselChartAmazon],
			"chartNeu":      alle[store.SchluesselChartNeu],
			"chartFBA":      alle[store.SchluesselChartFBA],
			"cacheMinuten":  alle[store.SchluesselCacheMinuten],

			"botToken":            alle[store.SchluesselBotToken],
			"reaktionGekauft":     alle[store.SchluesselReaktionGekauft],
			"reaktionWeg":         alle[store.SchluesselReaktionWeg],
			"reaktionVorbelegen":  alle[store.SchluesselReaktionVorlegen],
			"reaktionSchwelle":    alle[store.SchluesselReaktionSchwelle],
			"reaktionSchwelleB2B": alle[store.SchluesselReaktionSchwelleB2B],
			"reaktionAuto":        alle[store.SchluesselReaktionAuto],
			"telegramToken":       alle[store.SchluesselTelegramToken],
			"telegramChat":        alle[store.SchluesselTelegramChat],
			"telegramAktiv":       alle[store.SchluesselTelegramAktiv],
			"poster":              alle[store.SchluesselPoster],
			"stueckStandard":      alle[store.SchluesselStueckStandard],
		},
	}
}

// StandardMarkt sagt, ob ein Markt in den Standard-Zielmärkten steht — für
// die Vorlage, die nicht suchen kann.
func (d einstellungenDaten) StandardMarkt(c marketplace.Code) bool {
	for _, m := range marketplace.CodesAusListe(d.Werte["zielmarkt"]) {
		if m.Code == c {
			return true
		}
	}
	return false
}

func (srv *Server) zeigeEinstellungen(w http.ResponseWriter, r *http.Request) {
	d := srv.einstellungenDaten()
	d.Vorschau = beispielKarte(d.Werte["vorlage"])
	d.Meldung = r.URL.Query().Get("meldung")
	d.Fehler = r.URL.Query().Get("fehler")
	srv.rendere(w, "einstellungen", d)
}

// pruefeVorlage lehnt sowohl syntaktisch kaputte als auch leere Vorlagen ab.
//
// post.Pruefe allein reicht nicht: eine leere Vorlage rendert klaglos zu ""
// und wäre damit "gültig", würde aber jeden künftigen Post zu einer leeren
// Discord-Nachricht machen. Das ist für den Betrieb genauso unbrauchbar wie
// ein Template-Fehler und muss genauso abgelehnt werden.
// Eine leere Vorlage ist ausdrücklich erlaubt: sie steht für die
// Standardvorlage (post.VorlageOderStandard) und postet darum nie eine leere
// Nachricht.
func pruefeVorlage(vorlage string) error {
	if strings.TrimSpace(vorlage) == "" {
		return nil
	}
	return post.Pruefe(vorlage)
}

// speichereEinstellungen übernimmt alle gesendeten Felder.
//
// Die Post-Vorlage wird vorher gerendert; schlägt das fehl, bleibt die
// bisherige aktiv. Eine kaputte Vorlage darf nie in den Betrieb gelangen.
func (srv *Server) speichereEinstellungen(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		srv.fehler(w, http.StatusBadRequest, "Formular nicht lesbar")
		return
	}

	d := srv.einstellungenDaten()

	// r.PostForm.Has statt eines Leerstring-Vergleichs: nur wenn das Feld
	// überhaupt im Formular steckt, wird die Vorlage angefasst. Ein leerer,
	// aber gesendeter Wert zählt als Änderung und muss geprüft werden — sonst
	// könnte ein geleertes Textfeld die Vorlage unbemerkt auf "" setzen, denn
	// die generische Speicherschleife unten kennt den Unterschied zwischen
	// "Feld nicht gesendet" und "Feld auf leer gesetzt" nicht.
	if r.PostForm.Has(store.SchluesselVorlage) {
		vorlage := r.PostForm.Get(store.SchluesselVorlage)
		if err := pruefeVorlage(vorlage); err != nil {
			d.Fehler = "Vorlage nicht gespeichert: " + err.Error()
			d.Vorschau = beispielKarte(d.Werte["vorlage"])
			srv.rendere(w, "einstellungen", d)
			return
		}
	}

	// Die Standard-Zielmärkte kommen als mehrere Kästchen desselben Namens.
	// Die generische Schleife unten nähme nur den ersten Wert und verlöre
	// jeden weiteren — darum hier zusammengefasst und aus r.PostForm
	// entfernt, damit die Schleife sie nicht ein zweites Mal überschreibt.
	if r.PostForm.Has(store.SchluesselZielmarkt) {
		var codes []string
		for _, m := range marketplace.Codes(r.PostForm[store.SchluesselZielmarkt]) {
			codes = append(codes, string(m.Code))
		}
		// Kein angehaktes Kästchen wäre ein Zustand, aus dem der Funnel nicht
		// herauskäme: Schritt 2 böte nichts Vorgewähltes. Abgelehnt wie eine
		// leere Vorlage, statt ihn zu speichern.
		if len(codes) == 0 {
			d.Fehler = "Mindestens ein Standard-Zielmarkt muss angehakt sein."
			d.Vorschau = beispielKarte(d.Werte["vorlage"])
			srv.rendere(w, "einstellungen", d)
			return
		}
		if err := srv.store.SetzeEinstellung(store.SchluesselZielmarkt, strings.Join(codes, ",")); err != nil {
			srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
			return
		}
		delete(r.PostForm, store.SchluesselZielmarkt)
	}

	// Chart-Kurven: nicht angehakte Checkboxen werden nicht gesendet.
	if r.PostForm.Has("chart.kurven") {
		kurven := []string{
			store.SchluesselChartSalesRank,
			store.SchluesselChartBuyBox,
			store.SchluesselChartAmazon,
			store.SchluesselChartNeu,
			store.SchluesselChartFBA,
		}
		for _, schluessel := range kurven {
			wert := "0"
			if r.PostForm.Has(schluessel) {
				wert = "1"
			}
			if err := srv.store.SetzeEinstellung(schluessel, wert); err != nil {
				srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
				return
			}
			delete(r.PostForm, schluessel)
		}
		delete(r.PostForm, "chart.kurven")
	}

	// Die beiden Kästchen der Reaktionen: wie bei den Chart-Kurven sendet
	// ein nicht angehaktes gar nichts.
	if r.PostForm.Has("telegram.felder") {
		wert := "0"
		if r.PostForm.Has(store.SchluesselTelegramAktiv) {
			wert = "1"
		}
		if err := srv.store.SetzeEinstellung(store.SchluesselTelegramAktiv, wert); err != nil {
			srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
			return
		}
		delete(r.PostForm, store.SchluesselTelegramAktiv)
		delete(r.PostForm, "telegram.felder")
	}

	// B2B-Channels: die angehakten IDs mit Komma. Keins angehakt heißt
	// ausdrücklich keiner — nicht die Vorgabe "auto".
	if r.PostForm.Has("statistik.b2b_felder") {
		var ids []string
		for _, id := range r.PostForm["statistik.b2b_channel"] {
			if _, err := strconv.ParseInt(id, 10, 64); err == nil {
				ids = append(ids, id)
			}
		}
		if err := srv.store.SetzeEinstellung(store.SchluesselB2BChannels, strings.Join(ids, ",")); err != nil {
			srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
			return
		}
		delete(r.PostForm, "statistik.b2b_channel")
		delete(r.PostForm, "statistik.b2b_felder")
	}

	if r.PostForm.Has("reaktion.felder") {
		for _, schluessel := range []string{store.SchluesselReaktionVorlegen, store.SchluesselReaktionAuto} {
			wert := "0"
			if r.PostForm.Has(schluessel) {
				wert = "1"
			}
			if err := srv.store.SetzeEinstellung(schluessel, wert); err != nil {
				srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
				return
			}
			delete(r.PostForm, schluessel)
		}
		delete(r.PostForm, "reaktion.felder")
	}

	for schluessel, werte := range r.PostForm {
		if len(werte) > 0 {
			if err := srv.store.SetzeEinstellung(schluessel, werte[0]); err != nil {
				srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
				return
			}
		}
	}

	d = srv.einstellungenDaten()
	d.Meldung = "Gespeichert."
	d.Vorschau = beispielKarte(d.Werte["vorlage"])
	srv.rendere(w, "einstellungen", d)
}

// vorschauVorlage baut den Beispielpost neu, während im Textfeld getippt
// wird.
func (srv *Server) vorschauVorlage(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	srv.rendere(w, "kartenvorschau", beispielKarte(r.PostForm.Get(store.SchluesselVorlage)))
}

// beispielDaten füttern die Vorschau, solange kein echter Deal geladen ist.
func beispielDaten() post.Daten {
	return post.Daten{
		Titel: "Makita HR2630", ASIN: "B01636IZ0G", Mention: "@everyone",
		EKHost: "amazon.es", EKUrl: "https://www.amazon.es/dp/B01636IZ0G",
		EK: "130,56 €", EKNotiz: "Brutto inkl. Versand (3er cart)", MaxMenge: "3",
		VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G", Zielmarkt: "DE",
		Sales:  "40",
		Gewinn: "26,70 €", Marge: "12,9 %", MargeGerundet: "13 %",
		// Zwei Märkte, davon einer mit Pan-EU-Vergleich: die Vorschau soll
		// beide Zweige der Vorlage zeigen, nicht nur den einfachen.
		Maerkte: []post.MarktDaten{
			{Code: "DE", VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G",
				Sales: "40", Gewinn: "26,70 €", Marge: "12,9 %", MargeGerundet: "13 %"},
			{Code: "IT", VK: "189,00 €", VKUrl: "https://www.amazon.it/dp/B01636IZ0G",
				Sales: "12", Gewinn: "3,20 €", Marge: "1,7 %", MargeGerundet: "2 %",
				GewinnPanEU: "14,28 €", MargePanEU: "7,6 %"},
		},
		AOUrl: "https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G",
		PPUrl: "https://profitpath.app/redirect?storefront=de&query=B01636IZ0G&pg_buy_region=es&pg_buy=130.56&pg_sell=207.49",
	}
}

// beispielKarte zeigt den Post, den die Vorlage mit Beispielzahlen ergibt.
//
// Ein Fehler in der Vorlage wird nicht verschluckt, sondern steht als Text
// da: wer eine geschweifte Klammer vergisst, soll es hier sehen und nicht
// erst, wenn ein Deal nicht hinausgeht.
func beispielKarte(vorlage string) kartenVorschau {
	text, err := post.Render(post.VorlageOderStandard(vorlage), beispielDaten())
	if err != nil {
		text = "⚠️ " + err.Error()
	}
	return kartenVorschauAus(text, "")
}
