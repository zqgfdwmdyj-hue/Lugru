package web

import (
	"net/http"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Benutzer: der Admin (Anmeldung aus LUGRU_BENUTZER/LUGRU_PASSWORT) legt
// hier weitere Zugänge an. Jeder Zugang hat einen Poster, der nach der
// Anmeldung im Deal vorausgewählt ist.

type benutzerSeite struct {
	Titel, TokenText, Meldung, Fehler string

	Erlaubt      bool // nur der Admin verwaltet Benutzer
	OhnePasswort bool // ohne LUGRU_PASSWORT gibt es keine Anmeldung
	Ich          string
	AdminName    string
	AdminPoster  string
	Benutzer     []store.Benutzer
	Poster       []posterEintrag
}

func (srv *Server) benutzerDaten(r *http.Request) benutzerSeite {
	d := benutzerSeite{Titel: "Benutzer", TokenText: srv.tokenText(), Erlaubt: istAdmin(r),
		AdminPoster: srv.store.Einstellung(store.SchluesselAdminPoster), Poster: srv.posterListe()}
	if wer, ok := angemeldet(r); ok {
		d.Ich = wer.Name
		if wer.Admin {
			d.AdminName = wer.Name
		}
	} else {
		d.OhnePasswort = true
	}
	d.Benutzer, _ = srv.store.BenutzerListe()
	return d
}

func (srv *Server) zeigeBenutzer(w http.ResponseWriter, r *http.Request) {
	srv.rendere(w, "benutzer", srv.benutzerDaten(r))
}

// speichereBenutzer legt an, ändert Passwort oder Poster, oder setzt den
// Poster des Admins (name leer, admin=1).
func (srv *Server) speichereBenutzer(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.benutzerDaten(r)
	if !d.Erlaubt {
		w.WriteHeader(http.StatusForbidden)
		srv.rendere(w, "benutzer", d)
		return
	}
	poster := strings.TrimSpace(r.PostForm.Get("poster"))
	if poster != "" {
		if p, ok := srv.poster(poster); ok {
			poster = p.Name
		} else {
			poster = ""
		}
	}
	name := strings.TrimSpace(r.PostForm.Get("name"))
	switch {
	case r.PostForm.Get("admin") == "1":
		if err := srv.store.SetzeEinstellung(store.SchluesselAdminPoster, poster); err != nil {
			d.Fehler = "Nicht gespeichert: " + err.Error()
		}
	case d.AdminName != "" && strings.EqualFold(name, d.AdminName):
		d.Fehler = "So heißt schon der Admin — bitte einen anderen Namen wählen."
	default:
		if err := srv.store.BenutzerSpeichern(name, r.PostForm.Get("passwort"), poster); err != nil {
			d.Fehler = err.Error() + "."
		}
	}
	if d.Fehler != "" {
		w.WriteHeader(http.StatusBadRequest)
		srv.rendere(w, "benutzer", d)
		return
	}
	http.Redirect(w, r, "/benutzer?gespeichert=1", http.StatusSeeOther)
}

func (srv *Server) loescheBenutzer(w http.ResponseWriter, r *http.Request) {
	if !istAdmin(r) {
		srv.fehler(w, http.StatusForbidden, "Benutzer verwaltet nur der Admin.")
		return
	}
	_ = srv.store.BenutzerLoeschen(r.PathValue("name"))
	http.Redirect(w, r, "/benutzer", http.StatusSeeOther)
}
