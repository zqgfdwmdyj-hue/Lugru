package web

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// MitPasswort schützt die ganze Oberfläche mit Benutzername und Passwort,
// sobald ein Passwort gesetzt ist. Ohne Passwort bleibt alles offen — am
// eigenen PC unter 127.0.0.1 ist das in Ordnung, auf einem Server im Netz
// nicht: dort könnte sonst jeder, der die Adresse kennt, in eure Channels
// posten und die Schlüssel in den Einstellungen lesen.
//
// Angemeldet wird auf der Seite /anmelden. Danach trägt der Browser ein
// Sitzungs-Cookie; mit „Angemeldet bleiben" hält es 90 Tage, sonst bis der
// Browser geschlossen wird (höchstens 12 Stunden). Das Cookie ist mit einem
// Schlüssel aus Benutzer und Passwort signiert: wer das Passwort ändert,
// meldet damit alle Geräte ab. Benutzername und Passwort im Kopf der Anfrage
// (HTTP Basic Auth) gelten weiterhin, etwa für Skripte.
//
// Der Zugang aus LUGRU_BENUTZER/LUGRU_PASSWORT ist der Admin. Weitere
// Benutzer legt der Admin unter /benutzer an (gespeichert in st). Wer
// angemeldet ist, steht danach im Kontext der Anfrage (siehe angemeldet).
func MitPasswort(h http.Handler, benutzer, passwort string, st *store.Store) http.Handler {
	if passwort == "" {
		return h
	}
	if benutzer == "" {
		benutzer = "lugru"
	}
	a := anmeldung{
		sollB:      sha256.Sum256([]byte(benutzer)),
		sollP:      sha256.Sum256([]byte(passwort)),
		schluessel: sha256.Sum256([]byte("lugru-sitzung|" + benutzer + "|" + passwort)),
		adminName:  benutzer,
		st:         st,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/static/") || r.URL.Path == "/favicon.ico" || strings.HasPrefix(r.URL.Path, "/go/"):
			// Schrift, Stil und Icon braucht schon die Anmeldeseite; /go/
			// sind die Shop-Links in den Posts, die eure Mitglieder öffnen.
			h.ServeHTTP(w, r)
		case r.URL.Path == "/anmelden":
			a.anmelden(w, r)
		case r.URL.Path == "/abmelden":
			http.SetCookie(w, &http.Cookie{Name: sitzungsCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
			http.Redirect(w, r, "/anmelden", http.StatusSeeOther)
		default:
			if wer := a.sitzung(r, time.Now()); wer != nil {
				h.ServeHTTP(w, mitAnmeldung(r, *wer))
				return
			}
			if b, p, ok := r.BasicAuth(); ok {
				if wer, ok := a.pruefe(b, p); ok {
					h.ServeHTTP(w, mitAnmeldung(r, wer))
					return
				}
				w.Header().Set("WWW-Authenticate", `Basic realm="Lugru Deals", charset="UTF-8"`)
				http.Error(w, "Anmeldung nötig", http.StatusUnauthorized)
				return
			}
			ziel := "/anmelden?weiter=" + url.QueryEscape(r.URL.RequestURI())
			// Eine htmx-Anfrage würde die Anmeldeseite nur in einen
			// Seitenteil einsetzen — sie bekommt stattdessen die Anweisung,
			// die ganze Seite zu wechseln.
			if r.Header.Get("HX-Request") != "" {
				w.Header().Set("HX-Redirect", ziel)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				ziel = "/anmelden"
			}
			http.Redirect(w, r, ziel, http.StatusSeeOther)
		}
	})
}

const (
	sitzungsCookie = "lugru_sitzung"
	sitzungLang    = 90 * 24 * time.Hour
	sitzungKurz    = 12 * time.Hour
)

type anmeldung struct {
	sollB, sollP, schluessel [32]byte
	adminName                string
	st                       *store.Store
}

// Angemeldet beschreibt, wer die Anfrage stellt.
type Angemeldet struct {
	Name   string
	Poster string // vorausgewählter Poster, leer für keinen
	Admin  bool
}

type anmeldeSchluessel struct{}

func mitAnmeldung(r *http.Request, wer Angemeldet) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), anmeldeSchluessel{}, wer))
}

// angemeldet liefert, wer angemeldet ist. ok ist false, wenn die
// Oberfläche ohne Passwort läuft — dann gibt es niemanden zu erkennen.
func angemeldet(r *http.Request) (Angemeldet, bool) {
	wer, ok := r.Context().Value(anmeldeSchluessel{}).(Angemeldet)
	return wer, ok
}

// istAdmin: ohne Anmeldung (Betrieb ohne Passwort) darf jeder alles.
func istAdmin(r *http.Request) bool {
	wer, ok := angemeldet(r)
	return !ok || wer.Admin
}

func (a anmeldung) admin() Angemeldet {
	wer := Angemeldet{Name: a.adminName, Admin: true}
	if a.st != nil {
		wer.Poster = a.st.Einstellung(store.SchluesselAdminPoster)
	}
	return wer
}

// pruefe nimmt erst den Admin, dann die weiteren Benutzer.
func (a anmeldung) pruefe(b, p string) (Angemeldet, bool) {
	if a.zugangRichtig(b, p) {
		return a.admin(), true
	}
	if a.st == nil || strings.EqualFold(strings.TrimSpace(b), a.adminName) {
		return Angemeldet{}, false
	}
	if bn, ok := a.st.BenutzerPruefen(b, p); ok {
		return Angemeldet{Name: bn.Name, Poster: bn.Poster}, true
	}
	return Angemeldet{}, false
}

// zugangRichtig vergleicht Hashes gleicher Länge in konstanter Zeit: so
// verrät weder die Länge noch die Antwortzeit etwas über das Passwort.
func (a anmeldung) zugangRichtig(b, p string) bool {
	istB, istP := sha256.Sum256([]byte(b)), sha256.Sum256([]byte(p))
	return subtle.ConstantTimeCompare(istB[:], a.sollB[:])&subtle.ConstantTimeCompare(istP[:], a.sollP[:]) == 1
}

// sitzungWert ist "<Ablauf als Unix-Zeit>.<Signatur>" für den Admin — so
// bleiben die Cookies von vor den weiteren Benutzern gültig — und
// "<Name>:<Ablauf>.<Signatur>" für einen weiteren Benutzer, signiert mit
// dessen eigenem Schlüssel.
func (a anmeldung) sitzungWert(wer Angemeldet, ablauf time.Time) string {
	s := strconv.FormatInt(ablauf.Unix(), 10)
	schluessel := a.schluessel[:]
	if !wer.Admin {
		_, k, ok := a.st.BenutzerSitzung(wer.Name)
		if !ok {
			return ""
		}
		schluessel = k
		s = url.QueryEscape(wer.Name) + ":" + s
	}
	m := hmac.New(sha256.New, schluessel)
	m.Write([]byte(s))
	return s + "." + hex.EncodeToString(m.Sum(nil))
}

// sitzung liefert, wem das Sitzungs-Cookie gehört — nil, wenn es fehlt,
// abgelaufen oder gefälscht ist.
func (a anmeldung) sitzung(r *http.Request, jetzt time.Time) *Angemeldet {
	c, err := r.Cookie(sitzungsCookie)
	if err != nil {
		return nil
	}
	inhalt, sig, ok := strings.Cut(c.Value, ".")
	if !ok {
		return nil
	}
	schluessel, wer, zeit := a.schluessel[:], a.admin(), inhalt
	if name, z, mitName := strings.Cut(inhalt, ":"); mitName {
		n, err := url.QueryUnescape(name)
		if err != nil || a.st == nil {
			return nil
		}
		bn, k, ok := a.st.BenutzerSitzung(n)
		if !ok {
			return nil
		}
		schluessel, wer, zeit = k, Angemeldet{Name: bn.Name, Poster: bn.Poster}, z
	}
	ablauf, err := strconv.ParseInt(zeit, 10, 64)
	if err != nil || jetzt.Unix() > ablauf {
		return nil
	}
	m := hmac.New(sha256.New, schluessel)
	m.Write([]byte(inhalt))
	if !hmac.Equal([]byte(sig), []byte(hex.EncodeToString(m.Sum(nil)))) {
		return nil
	}
	return &wer
}

// weiterZiel lässt nur einen Pfad auf dieser Seite zu — kein Sprung auf
// eine fremde Adresse über den Parameter weiter.
func weiterZiel(roh string) string {
	if !strings.HasPrefix(roh, "/") || strings.HasPrefix(roh, "//") || strings.HasPrefix(roh, "/\\") ||
		strings.HasPrefix(roh, "/anmelden") || strings.HasPrefix(roh, "/abmelden") {
		return "/"
	}
	return roh
}

func (a anmeldung) anmelden(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	weiter := weiterZiel(r.Form.Get("weiter"))
	fehler := ""
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method == http.MethodPost {
		if wer, ok := a.pruefe(r.PostForm.Get("benutzer"), r.PostForm.Get("passwort")); ok {
			c := &http.Cookie{Name: sitzungsCookie, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil}
			if r.PostForm.Get("bleiben") == "1" {
				c.Value = a.sitzungWert(wer, time.Now().Add(sitzungLang))
				c.MaxAge = int(sitzungLang.Seconds())
			} else {
				c.Value = a.sitzungWert(wer, time.Now().Add(sitzungKurz))
			}
			http.SetCookie(w, c)
			http.Redirect(w, r, weiter, http.StatusSeeOther)
			return
		}
		fehler = "Benutzer oder Passwort falsch."
		w.WriteHeader(http.StatusUnauthorized)
	}
	_ = anmeldeSeite.Execute(w, struct{ Weiter, Fehler string }{weiter, fehler})
}

var anmeldeSeite = template.Must(template.New("anmelden").Parse(`<!doctype html>
<html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anmelden · Lugru Deals</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
<link rel="manifest" href="/static/manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="Lugru Deals">
<meta name="apple-mobile-web-app-capable" content="yes">
</head><body>
<main style="max-width:28rem;box-sizing:border-box;margin-top:3rem">
<h1>Lugru Deals</h1>
{{if .Fehler}}<p class="fehler">{{.Fehler}}</p>{{end}}
<form method="post" action="/anmelden" class="karte">
  <input type="hidden" name="weiter" value="{{.Weiter}}">
  <label>Benutzer <input name="benutzer" autocomplete="username" autocapitalize="none" required></label>
  <label>Passwort <input name="passwort" type="password" autocomplete="current-password" required></label>
  <label><input type="checkbox" name="bleiben" value="1" checked> Angemeldet bleiben (90 Tage)</label>
  <button type="submit" class="primaer">Anmelden</button>
</form>
</main>
</body></html>`))
