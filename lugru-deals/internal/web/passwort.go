package web

import (
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
func MitPasswort(h http.Handler, benutzer, passwort string) http.Handler {
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
		case a.sitzungGueltig(r, time.Now()):
			h.ServeHTTP(w, r)
		default:
			if b, p, ok := r.BasicAuth(); ok {
				if a.zugangRichtig(b, p) {
					h.ServeHTTP(w, r)
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
}

// zugangRichtig vergleicht Hashes gleicher Länge in konstanter Zeit: so
// verrät weder die Länge noch die Antwortzeit etwas über das Passwort.
func (a anmeldung) zugangRichtig(b, p string) bool {
	istB, istP := sha256.Sum256([]byte(b)), sha256.Sum256([]byte(p))
	return subtle.ConstantTimeCompare(istB[:], a.sollB[:])&subtle.ConstantTimeCompare(istP[:], a.sollP[:]) == 1
}

// sitzungWert ist "<Ablauf als Unix-Zeit>.<Signatur>".
func (a anmeldung) sitzungWert(ablauf time.Time) string {
	s := strconv.FormatInt(ablauf.Unix(), 10)
	m := hmac.New(sha256.New, a.schluessel[:])
	m.Write([]byte(s))
	return s + "." + hex.EncodeToString(m.Sum(nil))
}

func (a anmeldung) sitzungGueltig(r *http.Request, jetzt time.Time) bool {
	c, err := r.Cookie(sitzungsCookie)
	if err != nil {
		return false
	}
	s, sig, ok := strings.Cut(c.Value, ".")
	if !ok {
		return false
	}
	ablauf, err := strconv.ParseInt(s, 10, 64)
	if err != nil || jetzt.Unix() > ablauf {
		return false
	}
	_, sollSig, _ := strings.Cut(a.sitzungWert(time.Unix(ablauf, 0)), ".")
	return hmac.Equal([]byte(sig), []byte(sollSig))
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
		if a.zugangRichtig(r.PostForm.Get("benutzer"), r.PostForm.Get("passwort")) {
			c := &http.Cookie{Name: sitzungsCookie, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil}
			if r.PostForm.Get("bleiben") == "1" {
				c.Value = a.sitzungWert(time.Now().Add(sitzungLang))
				c.MaxAge = int(sitzungLang.Seconds())
			} else {
				c.Value = a.sitzungWert(time.Now().Add(sitzungKurz))
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
