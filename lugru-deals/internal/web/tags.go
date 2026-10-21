package web

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type tagDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	Maerkte   []marketplace.Marketplace
	Tags      []store.AffiliateTag
}

// tagMuster ist die erlaubte Form einer PartnerNet-Tracking-ID.
//
// Der Zeichensatz ist nicht bloß Ordnungsliebe: der Wert durchquert zwei
// Kontexte und muss in beiden stumm sein. In der Query der Produktseite
// fehlen ihm & ? # % und /, im Markdown-Link des Discord-Posts —
// "[Amazon.DE](hier steht der Link)" — fehlen ihm ( ) < > " und das
// Leerzeichen. Es ist dieselbe Sorge, die markdownGrenzen in
// marketplace/input.go für Fremdshop-Links behandelt, nur an der Quelle
// abgefangen statt hinterher entschärft.
var tagMuster = regexp.MustCompile(`^[A-Za-z0-9_-]{1,50}$`)

func (srv *Server) tagDaten() tagDaten {
	d := tagDaten{Titel: "Tags", Maerkte: marketplace.All(), TokenText: srv.tokenText()}
	tags, err := srv.store.Tags()
	if err != nil {
		d.Fehler = "Tags nicht lesbar: " + err.Error()
		return d
	}
	d.Tags = tags
	return d
}

func (srv *Server) zeigeTags(w http.ResponseWriter, r *http.Request) {
	srv.rendere(w, "tags", srv.tagDaten())
}

// speichereTag legt einen Tag an oder ändert einen bestehenden.
//
// Das Standard-Häkchen läuft auch hier über store.TagStandardSetzen und nicht
// über die Spalte im UPDATE: es gibt genau einen Weg zu diesem Zustand, und
// nur der räumt den bisherigen Standard des Marktes ab.
func (srv *Server) speichereTag(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		srv.fehler(w, http.StatusBadRequest, "Formular nicht lesbar")
		return
	}

	t := store.AffiliateTag{
		Name:  strings.TrimSpace(r.PostForm.Get("name")),
		Tag:   strings.TrimSpace(r.PostForm.Get("tag")),
		Markt: strings.ToUpper(strings.TrimSpace(r.PostForm.Get("markt"))),
	}
	_, marktBekannt := marketplace.ByCode(marketplace.Code(t.Markt))

	d := srv.tagDaten()
	switch {
	case t.Name == "" || t.Tag == "":
		d.Fehler = "Name und Tag sind Pflicht."
		srv.rendere(w, "tags", d)
		return
	case !tagMuster.MatchString(t.Tag):
		d.Fehler = "Der Tag darf nur Buchstaben, Ziffern, Bindestrich und Unterstrich enthalten."
		srv.rendere(w, "tags", d)
		return
	case !marktBekannt:
		// Der Markt kommt aus einem Auswahlfeld, aber ein Auswahlfeld ist
		// keine Prüfung: eine von Hand gebaute Anfrage kann jeden Wert
		// senden. Ein Tag für einen Markt, den marketplace nicht kennt, wäre
		// im Funnel unerreichbar und stünde nur als Karteileiche in der
		// Liste.
		d.Fehler = "Unbekannter Marktplatz."
		srv.rendere(w, "tags", d)
		return
	}

	id, err := strconv.ParseInt(r.PostForm.Get("id"), 10, 64)
	if err == nil && id != 0 {
		t.ID = id
		err = srv.store.TagAendern(t)
	} else {
		id, err = srv.store.TagAnlegen(t)
	}
	if err != nil {
		d.Fehler = "Speichern fehlgeschlagen: " + err.Error()
		srv.rendere(w, "tags", d)
		return
	}

	if r.PostForm.Get("standard") != "" {
		if err := srv.store.TagStandardSetzen(id); err != nil {
			d = srv.tagDaten()
			d.Fehler = "Gespeichert, aber nicht als Standard gesetzt: " + err.Error()
			srv.rendere(w, "tags", d)
			return
		}
	}

	d = srv.tagDaten()
	d.Meldung = "Gespeichert."
	srv.rendere(w, "tags", d)
}

func (srv *Server) standardTag(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Tag-ID")
		return
	}
	d := srv.tagDaten()
	if err := srv.store.TagStandardSetzen(id); err != nil {
		d.Fehler = "Standard nicht setzbar: " + err.Error()
	} else {
		d = srv.tagDaten()
		d.Meldung = "Standard gesetzt."
	}
	srv.rendere(w, "tags", d)
}

func (srv *Server) loescheTag(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Tag-ID")
		return
	}
	d := srv.tagDaten()
	if err := srv.store.TagLoeschen(id); err != nil {
		d.Fehler = "Löschen fehlgeschlagen: " + err.Error()
	} else {
		d = srv.tagDaten()
		// Der Markt steht danach ohne Standard da. Das ist kein Fehler —
		// Schritt 4 weist im Funnel darauf hin und lässt trotzdem posten.
		d.Meldung = "Tag gelöscht. Bereits gepostete Deals bleiben unverändert."
	}
	srv.rendere(w, "tags", d)
}
