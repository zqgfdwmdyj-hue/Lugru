package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// mitCookie stellt eine Anfrage mit dem Sitzungs-Cookie einer Anmeldung.
func mitCookie(t *testing.T, h http.Handler, c *http.Cookie, methode, pfad string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if form != nil {
		r = httptest.NewRequest(methode, pfad, strings.NewReader(form.Encode()))
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	} else {
		r = httptest.NewRequest(methode, pfad, nil)
	}
	if c != nil {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func sitzungsCookieVon(t *testing.T, h http.Handler, name, passwort string) *http.Cookie {
	t.Helper()
	w := anmeldenMit(t, h, url.Values{"benutzer": {name}, "passwort": {passwort}, "bleiben": {"1"}})
	if w.Code != http.StatusSeeOther {
		t.Fatalf("Anmeldung %s: Status %d", name, w.Code)
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == sitzungsCookie {
			return c
		}
	}
	t.Fatalf("Anmeldung %s: kein Cookie", name)
	return nil
}

// Jeder Benutzer hat nach der Anmeldung seinen eigenen Poster im Deal
// vorausgewählt; der Admin kommt aus LUGRU_BENUTZER/LUGRU_PASSWORT.
func TestBenutzerMitEigenemPoster(t *testing.T) {
	srv, s := testServer(t)
	h := MitPasswort(srv.Routen(), "Ludwig", "admin-passwort", s)
	admin := sitzungsCookieVon(t, h, "Ludwig", "admin-passwort")

	for _, b := range []url.Values{
		{"name": {"Mark"}, "passwort": {"mark-passwort"}, "poster": {"markah"}},
		{"name": {"K95"}, "passwort": {"k95-passwort"}, "poster": {"k95"}},
	} {
		if w := mitCookie(t, h, admin, http.MethodPost, "/benutzer", b); w.Code != http.StatusSeeOther {
			t.Fatalf("Anlegen %s: Status %d\n%s", b.Get("name"), w.Code, w.Body)
		}
	}

	poster := func(c *http.Cookie) string {
		h := mitCookie(t, h, c, http.MethodGet, "/", nil).Body.String()
		i := strings.Index(h, `name="poster" value="`)
		if i < 0 {
			t.Fatalf("kein Poster-Feld:\n%s", h)
		}
		rest := h[i+len(`name="poster" value="`):]
		return rest[:strings.Index(rest, `"`)]
	}
	mark := sitzungsCookieVon(t, h, "mark", "mark-passwort") // Groß-/Kleinschreibung egal
	k95 := sitzungsCookieVon(t, h, "K95", "k95-passwort")
	for c, will := range map[*http.Cookie]string{admin: "ludwig", mark: "markah", k95: "k95"} {
		if got := poster(c); got != will {
			t.Errorf("Poster vorausgewählt: %q, will %q", got, will)
		}
	}

	// Falsches Passwort und der Admin-Name mit Benutzer-Passwort gehen nicht.
	for _, z := range [][2]string{{"Mark", "falsch"}, {"Ludwig", "mark-passwort"}} {
		if w := anmeldenMit(t, h, url.Values{"benutzer": {z[0]}, "passwort": {z[1]}}); w.Code != http.StatusUnauthorized {
			t.Errorf("Anmeldung %v angenommen", z)
		}
	}

	// Nur der Admin verwaltet Benutzer.
	if w := mitCookie(t, h, mark, http.MethodPost, "/benutzer",
		url.Values{"name": {"Fremd"}, "passwort": {"irgendwas123"}}); w.Code != http.StatusForbidden {
		t.Errorf("Mark durfte einen Benutzer anlegen: %d", w.Code)
	}
	if w := mitCookie(t, h, mark, http.MethodPost, "/benutzer/K95/loeschen", url.Values{}); w.Code != http.StatusForbidden {
		t.Errorf("Mark durfte löschen: %d", w.Code)
	}

	// Ein gefälschtes Cookie mit fremdem Namen und der Signatur von Mark gilt nicht.
	_, sig, _ := strings.Cut(mark.Value, ".")
	_, zeit, _ := strings.Cut(strings.Split(mark.Value, ".")[0], ":")
	falsch := &http.Cookie{Name: sitzungsCookie, Value: "K95:" + zeit + "." + sig}
	if w := mitCookie(t, h, falsch, http.MethodGet, "/", nil); w.Code != http.StatusSeeOther {
		t.Errorf("gefälschtes Cookie angenommen: %d", w.Code)
	}

	// Neues Passwort meldet Mark ab, Löschen meldet K95 ab.
	mitCookie(t, h, admin, http.MethodPost, "/benutzer", url.Values{"name": {"Mark"}, "passwort": {"neues-passwort"}, "poster": {"markah"}})
	if w := mitCookie(t, h, mark, http.MethodGet, "/", nil); w.Code != http.StatusSeeOther {
		t.Errorf("Mark nach Passwortwechsel noch angemeldet")
	}
	mitCookie(t, h, admin, http.MethodPost, "/benutzer/K95/loeschen", url.Values{})
	if w := mitCookie(t, h, k95, http.MethodGet, "/", nil); w.Code != http.StatusSeeOther {
		t.Errorf("K95 nach Löschen noch angemeldet")
	}
	// Der Admin bleibt angemeldet und sieht die Liste.
	if h := mitCookie(t, h, admin, http.MethodGet, "/benutzer", nil).Body.String(); !strings.Contains(h, "<b>Mark</b>") || strings.Contains(h, "<b>K95</b>") {
		t.Errorf("Benutzerliste falsch:\n%s", h)
	}
}

func TestBenutzerRegeln(t *testing.T) {
	_, s := testServer(t)
	if err := s.BenutzerSpeichern("Mark", "kurz", ""); err == nil {
		t.Error("zu kurzes Passwort angenommen")
	}
	if err := s.BenutzerSpeichern("Neu", "", "k95"); err == nil {
		t.Error("neuer Benutzer ohne Passwort angenommen")
	}
	if err := s.BenutzerSpeichern("a:b", "langespasswort", ""); err == nil {
		t.Error("Doppelpunkt im Namen angenommen")
	}
	if err := s.BenutzerSpeichern("Mark", "langespasswort", "markah"); err != nil {
		t.Fatal(err)
	}
	// Poster ändern ohne Passwort lässt das Passwort stehen.
	if err := s.BenutzerSpeichern("Mark", "", "k95"); err != nil {
		t.Fatal(err)
	}
	if b, ok := s.BenutzerPruefen("Mark", "langespasswort"); !ok || b.Poster != "k95" {
		t.Errorf("nach Posterwechsel: %+v %v", b, ok)
	}
}
