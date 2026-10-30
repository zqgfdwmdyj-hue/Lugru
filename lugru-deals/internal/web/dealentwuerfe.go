package web

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Entwürfe und "erneut posten" nutzen dieselbe Eigenschaft des Funnels: sein
// ganzer Zustand steht im Formular. Ein Entwurf ist darum schlicht das
// Formular, zur Seite gelegt; ein alter Deal wird zu einem Formular
// zurückgebaut. Geöffnet wird beides über die gewöhnlichen Handler (siehe
// alsGanzeSeite) — ein geöffneter Deal wird so genau wie ein neu
// eingegebener geprüft.

// entwurfStatus füttert das Fragment "entwurf-status": die ID des Entwurfs,
// zu dem das Formular gehört, und die Rückmeldung nach dem Speichern.
type entwurfStatus struct {
	ID      int64
	Meldung string
	Fehler  string
}

// Status ist das Fragment für den Funnel-Schritt. Methode statt Feld, damit
// die Vorlage es aus dealSeite heraus ohne weitere Daten bauen kann.
func (d dealSeite) Status() entwurfStatus {
	return entwurfStatus{ID: d.Formular.EntwurfID}
}

// speichereEntwurf legt das Formular des gerade offenen Schritts zur Seite.
//
// Geantwortet wird nur mit dem Statusfragment, nicht mit dem ganzen Schritt:
// Schritt 3 trägt Anzeige, die nicht im Formular steht (die Preisvorschläge
// aus Keepa), und ein neu gerenderter Schritt verlöre sie. Das Fragment trägt
// zugleich die ID des Entwurfs, damit ein zweites Speichern denselben
// Entwurf überschreibt statt einen weiteren anzulegen.
func (srv *Server) speichereEntwurf(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	f := formularLesen(r)

	schritt, _ := strconv.Atoi(r.PostForm.Get("entwurf_schritt"))
	if schritt < schrittQuelle || schritt > schrittVorschau {
		schritt = schrittQuelle
	}

	// Die Steuerfelder des Speicherns selbst gehören nicht in den Entwurf.
	werte := url.Values{}
	for k, v := range r.PostForm {
		switch k {
		case "entwurf_schritt", "entwurf_id", "neu_laden", "zurueck", "ohne_chart":
			continue
		}
		werte[k] = v
	}

	titel := strings.TrimSpace(f.Titel)
	if titel == "" {
		titel = f.Einkaufslink
	}
	id, err := srv.store.EntwurfSpeichern(store.Entwurf{
		ID: f.EntwurfID, ASIN: f.ASIN, Titel: titel, Schritt: schritt,
		Formular: werte.Encode(),
	})
	if err != nil {
		srv.rendere(w, "entwurf-status", entwurfStatus{ID: f.EntwurfID,
			Fehler: "Entwurf nicht gespeichert: " + sicherFehlertext(err.Error())})
		return
	}
	srv.rendere(w, "entwurf-status", entwurfStatus{ID: id,
		Meldung: "Entwurf gespeichert (" + time.Now().Format("15:04") + ")."})
}

// oeffneEntwurf setzt den Funnel beim Schritt fort, in dem der Entwurf
// gespeichert wurde.
//
// Schritt 3 geht über den Rückweg aus Schritt 4 (zurueck=1): die Zahlen im
// Entwurf bleiben stehen, nur die Preisvorschläge kommen neu aus Keepa
// (oder aus dem Zwischenspeicher).
func (srv *Server) oeffneEntwurf(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	e, err := srv.store.Entwurf(id)
	if err != nil {
		srv.fehler(w, http.StatusNotFound, "Entwurf nicht gefunden.")
		return
	}
	werte, err := url.ParseQuery(e.Formular)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "Entwurf nicht lesbar.")
		return
	}
	werte.Set("entwurf_id", strconv.FormatInt(e.ID, 10))

	switch e.Schritt {
	case schrittEinkauf:
		srv.alsGanzeSeite(w, r, werte, srv.preisDeal)
	case schrittRechnung:
		werte.Set("zurueck", "1")
		srv.alsGanzeSeite(w, r, werte, srv.ladeDeal)
	case schrittVorschau:
		srv.alsGanzeSeite(w, r, werte, srv.vorschauDeal)
	default:
		srv.alsGanzeSeite(w, r, werte, srv.starteDeal)
	}
}

func (srv *Server) loescheEntwurf(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	_ = srv.store.EntwurfLoeschen(id)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// entwurfZeile ist ein Entwurf in der Liste unter Schritt 1.
type entwurfZeile struct {
	ID      int64
	Titel   string
	ASIN    string
	Schritt string
	Datum   string
}

var schrittNamen = map[int]string{
	schrittQuelle:   "Einkaufslink",
	schrittEinkauf:  "Einkauf & Ziel",
	schrittRechnung: "Berechnung",
	schrittVorschau: "Vorschau",
}

func (srv *Server) entwurfListe() []entwurfZeile {
	alle, _ := srv.store.Entwuerfe()
	out := make([]entwurfZeile, 0, len(alle))
	for _, e := range alle {
		out = append(out, entwurfZeile{
			ID: e.ID, Titel: e.Titel, ASIN: e.ASIN,
			Schritt: schrittNamen[e.Schritt],
			Datum:   e.GespeichertAm.Local().Format("02.01.2006 15:04"),
		})
	}
	return out
}

// erneutPosten öffnet einen alten Deal als neuen, in Schritt 2.
//
// Übernommen wird alles, was der Deal selbst festlegt: Einkauf, Notiz,
// Cart-Limit, Zielmärkte, Leitmarkt und Channel. Die Preise und Zahlen der
// Märkte kommen dagegen frisch aus Keepa, sobald Schritt 2 weitergeht — genau
// dafür wird ein Deal ja neu gepostet. Der Einkaufspreis steht als
// Bruttobetrag da, so wie er gespeichert ist, und lässt sich vor dem Weiter
// anpassen.
func (srv *Server) erneutPosten(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	deal, err := srv.store.Deal(id)
	if err != nil {
		srv.fehler(w, http.StatusNotFound, "Deal nicht gefunden.")
		return
	}

	// Mit dem Tool gepostet: genau die Eingaben von damals, netto bleibt
	// netto, Zusatzzeilen und weitere Links kommen mit. Nur die Zahlen der
	// Zielmärkte lädt Schritt 3 frisch aus Keepa — dafür postet man neu.
	if deal.Formular != "" {
		if werte, err := url.ParseQuery(deal.Formular); err == nil {
			werte = eingabenZumMerken(werte)
			srv.vorherigeVKs(deal, werte)
			srv.alsGanzeSeite(w, r, werte, srv.preisDeal)
			return
		}
	}

	werte := url.Values{}
	if deal.Lieferant != "" {
		// Einkauf ohne Link: Schritt 1 bekommt ASIN, Land und Lieferant
		// statt eines Links.
		werte.Set("ohne_link", "1")
		werte.Set("ohne_link_gesehen", "1")
		werte.Set("lieferant", deal.Lieferant)
	}
	link := deal.QuellURL
	if link == "" {
		if m, ok := marketplace.ByCode(marketplace.Code(deal.Quellmarkt)); ok {
			link = m.ProductURL(deal.ASIN)
		} else {
			link = deal.ASIN
		}
	}
	werte.Set("einkaufslink", link)
	werte.Set("link_bestaetigt", link)
	werte.Set("asin", deal.ASIN)
	werte.Set("quellmarkt", deal.Quellmarkt)
	werte.Set("quell_url", deal.QuellURL)
	werte.Set("ek", deal.EKCent.String())
	werte.Set("ek_art", "brutto")
	// Netto eingegeben: den Nettopreis zurückrechnen, damit Schritt 2
	// wieder netto zeigt — gespeichert ist nur der Bruttobetrag.
	if deal.EKArt == "netto" {
		if ust := srv.ustFuer(marketplace.Code(deal.Quellmarkt), deal.Steuersatz); ust > 0 {
			netto := (int64(deal.EKCent)*1000 + int64(1000+ust)/2) / int64(1000+ust)
			werte.Set("ek", money.Cents(netto).String())
			werte.Set("ek_art", "netto")
		}
	}
	werte.Set("ek_notiz", deal.EKNotiz)
	if deal.Steuersatz == "ermaessigt" {
		werte.Set("steuersatz", "ermaessigt")
	}
	if deal.MaxMenge > 0 {
		werte.Set("max_menge", strconv.Itoa(deal.MaxMenge))
	}
	werte.Set("channel_id", strconv.FormatInt(deal.ChannelID, 10))
	werte.Set("leitmarkt", deal.Zielmarkt)

	maerkte, _ := srv.store.DealMaerkte([]int64{deal.ID})
	if ms := maerkte[deal.ID]; len(ms) > 0 {
		for _, m := range ms {
			werte.Add("zielmarkt", m.Markt)
		}
	} else {
		werte.Add("zielmarkt", deal.Zielmarkt)
	}
	srv.vorherigeVKs(deal, werte)

	srv.alsGanzeSeite(w, r, werte, srv.preisDeal)
}

// vorherigeVKs trägt je Markt den Verkaufspreis ein, mit dem der Deal
// gepostet wurde, sofern die Eingaben keinen eigenen mitbringen. Quelle
// "vorher" übersteht wie "manuell" das frische Laden aus Keepa; die
// aktuellen Keepa-Preise stehen daneben zur Auswahl.
func (srv *Server) vorherigeVKs(deal store.Deal, werte url.Values) {
	vks := map[string]money.Cents{deal.Zielmarkt: deal.VKCent}
	maerkte, _ := srv.store.DealMaerkte([]int64{deal.ID})
	for _, m := range maerkte[deal.ID] {
		vks[m.Markt] = m.VKCent
	}
	for markt, vk := range vks {
		if vk <= 0 || markt == "" || strings.TrimSpace(werte.Get("vk."+markt)) != "" {
			continue
		}
		werte.Set("vk."+markt, vk.String())
		werte.Set("vk_quelle."+markt, "vorher")
	}
}

// eingabenZumMerken sind die Formularwerte, die "Erneut posten" wieder
// einfüllt: alles außer den Zahlen der Zielmärkte (die kommen frisch aus
// Keepa), den Werten von Hand für Gewinn und Marge (die galten dem alten
// Preis) und dem, was nur zum einen Post gehörte.
func eingabenZumMerken(werte url.Values) url.Values {
	out := url.Values{}
	for k, v := range werte {
		basis, markt, _ := strings.Cut(k, ".")
		// Von Hand gesetzte Zahlen eines Marktes kommen mit, Keepa-Werte nicht.
		switch basis {
		case "vk", "sales", "provision", "fba":
			if q := werte.Get(basis + "_quelle." + markt); q == "manuell" || q == "vorher" {
				out[k] = append([]string(nil), v...)
			}
			continue
		case "vk_quelle", "sales_quelle", "provision_quelle", "fba_quelle":
			if q := werte.Get(k); q == "manuell" || q == "vorher" {
				out[k] = append([]string(nil), v...)
			}
			continue
		}
		switch basis {
		case "vk_wahl", "zielmarge", "masse_l", "masse_b", "masse_h", "masse_g",
			"gewinn_manuell", "marge_manuell", "gewinn_paneu_manuell", "marge_paneu_manuell",
			"entwurf_id", "entwurf_schritt", "ohne_chart", "zurueck", "neu_laden",
			"poster":
			continue
		}
		out[k] = append([]string(nil), v...)
	}
	return out
}
