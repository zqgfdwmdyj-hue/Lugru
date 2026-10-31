package web

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Wer einen Deal gepostet hat, wählt man in Schritt 4. Die Liste steht in
// den Einstellungen, eine Person je Zeile: "ludwig" oder "ludwig=1234…"
// mit der Discord-User-ID — dann steht im Post eine echte Erwähnung, die
// man anklicken kann (ohne jemanden anzupingen).

type posterEintrag struct {
	Name string
	ID   string
}

// posterCookie merkt sich im Browser, wer zuletzt gepostet hat — jeder von
// euch hat so sich selbst vorausgewählt.
const posterCookie = "lugru_poster"

var discordIDMuster = regexp.MustCompile(`^\d{5,25}$`)

func (srv *Server) posterListe() []posterEintrag {
	var out []posterEintrag
	for _, zeile := range strings.Split(srv.store.Einstellung(store.SchluesselPoster), "\n") {
		name, id, _ := strings.Cut(strings.TrimSpace(zeile), "=")
		name = strings.TrimPrefix(strings.TrimSpace(name), "@")
		id = strings.Trim(strings.TrimSpace(id), "<@!>")
		if name == "" {
			continue
		}
		if !discordIDMuster.MatchString(id) {
			id = ""
		}
		out = append(out, posterEintrag{Name: name, ID: id})
	}
	return out
}

// poster sucht einen Namen in der Liste. Unbekannte Namen gibt es nicht —
// ein verstecktes Feld aus dem Browser darf niemanden erfinden.
func (srv *Server) poster(name string) (posterEintrag, bool) {
	for _, p := range srv.posterListe() {
		if strings.EqualFold(p.Name, name) {
			return p, true
		}
	}
	return posterEintrag{}, false
}

// posterText ist die Angabe im Post: die Discord-Erwähnung, wenn eine ID
// hinterlegt ist, sonst "@name" als Text.
func (p posterEintrag) posterText() string {
	if p.ID != "" {
		return "<@" + p.ID + ">"
	}
	return "@" + p.Name
}

// posterVorwahl ist der Poster, der im Deal vorausgewählt ist: der des
// angemeldeten Benutzers, sonst der zuletzt in diesem Browser gewählte.
func posterVorwahl(r *http.Request) string {
	if wer, ok := angemeldet(r); ok && wer.Poster != "" {
		return wer.Poster
	}
	return posterAusCookie(r)
}

func posterAusCookie(r *http.Request) string {
	if c, err := r.Cookie(posterCookie); err == nil {
		return c.Value
	}
	return ""
}

func merkePoster(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: posterCookie, Value: name, Path: "/",
		Expires: time.Now().AddDate(2, 0, 0), HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
}
