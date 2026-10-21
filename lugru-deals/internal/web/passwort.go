package web

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
)

// MitPasswort schützt die ganze Oberfläche mit Benutzername und Passwort
// (HTTP Basic Auth), sobald ein Passwort gesetzt ist. Ohne Passwort bleibt
// alles offen — am eigenen PC unter 127.0.0.1 ist das in Ordnung, auf einem
// Server im Netz nicht: dort könnte sonst jeder, der die Adresse kennt,
// in eure Channels posten und die Schlüssel in den Einstellungen lesen.
//
// Der Browser fragt einmal nach den Zugangsdaten und merkt sie sich.
func MitPasswort(h http.Handler, benutzer, passwort string) http.Handler {
	if passwort == "" {
		return h
	}
	if benutzer == "" {
		benutzer = "lugru"
	}
	// Verglichen werden Hashes gleicher Länge in konstanter Zeit: so verrät
	// weder die Länge noch die Antwortzeit etwas über das Passwort.
	sollB, sollP := sha256.Sum256([]byte(benutzer)), sha256.Sum256([]byte(passwort))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, p, ok := r.BasicAuth()
		istB, istP := sha256.Sum256([]byte(b)), sha256.Sum256([]byte(p))
		if !ok || subtle.ConstantTimeCompare(istB[:], sollB[:])&subtle.ConstantTimeCompare(istP[:], sollP[:]) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="Lugru Deals", charset="UTF-8"`)
			http.Error(w, "Anmeldung nötig", http.StatusUnauthorized)
			return
		}
		h.ServeHTTP(w, r)
	})
}
