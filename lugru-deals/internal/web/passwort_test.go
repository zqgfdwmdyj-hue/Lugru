package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestMitPasswort(t *testing.T) {
	innen := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })

	offen := MitPasswort(innen, "", "", nil)
	w := httptest.NewRecorder()
	offen.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != http.StatusOK {
		t.Errorf("ohne Passwort: %d", w.Code)
	}

	geschuetzt := MitPasswort(innen, "", "geheim", nil)
	for _, fall := range []struct {
		b, p string
		mit  bool
		will int
	}{
		// Ohne Zugangsdaten geht es zur Anmeldeseite.
		{"", "", false, http.StatusSeeOther},
		{"lugru", "falsch", true, http.StatusUnauthorized},
		{"anders", "geheim", true, http.StatusUnauthorized},
		{"lugru", "geheim", true, http.StatusOK},
	} {
		r := httptest.NewRequest(http.MethodGet, "/historie", nil)
		if fall.mit {
			r.SetBasicAuth(fall.b, fall.p)
		}
		w := httptest.NewRecorder()
		geschuetzt.ServeHTTP(w, r)
		if w.Code != fall.will {
			t.Errorf("%q/%q: %d, will %d", fall.b, fall.p, w.Code, fall.will)
		}
	}
}

func anmeldenMit(t *testing.T, h http.Handler, werte url.Values) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/anmelden", strings.NewReader(werte.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestAnmeldenUndAngemeldetBleiben(t *testing.T) {
	innen := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	h := MitPasswort(innen, "team", "geheim", nil)

	// Ohne Anmeldung: Weiterleitung mit Rücksprungziel.
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/monitor", nil))
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/anmelden?weiter=%2Fmonitor" {
		t.Fatalf("ohne Anmeldung: %d %s", w.Code, w.Header().Get("Location"))
	}

	if w := anmeldenMit(t, h, url.Values{"benutzer": {"team"}, "passwort": {"falsch"}}); w.Code != http.StatusUnauthorized || len(w.Result().Cookies()) != 0 {
		t.Errorf("falsches Passwort: %d", w.Code)
	}

	w = anmeldenMit(t, h, url.Values{"benutzer": {"team"}, "passwort": {"geheim"}, "bleiben": {"1"}, "weiter": {"/monitor"}})
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/monitor" {
		t.Fatalf("Anmeldung: %d %s", w.Code, w.Header().Get("Location"))
	}
	cs := w.Result().Cookies()
	if len(cs) != 1 || cs[0].MaxAge < 89*24*3600 || !cs[0].HttpOnly {
		t.Fatalf("Cookie = %+v", cs)
	}

	r := httptest.NewRequest(http.MethodGet, "/monitor", nil)
	r.AddCookie(cs[0])
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("mit Cookie: %d", w.Code)
	}

	// Ein verändertes Cookie (späterer Ablauf) gilt nicht.
	gefaelscht := *cs[0]
	gefaelscht.Value = "9999999999" + gefaelscht.Value[strings.Index(gefaelscht.Value, "."):]
	r = httptest.NewRequest(http.MethodGet, "/monitor", nil)
	r.AddCookie(&gefaelscht)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code == http.StatusOK {
		t.Error("gefälschtes Cookie angenommen")
	}

	// Ein anderes Passwort meldet alle ab.
	h2 := MitPasswort(innen, "team", "neu", nil)
	r = httptest.NewRequest(http.MethodGet, "/monitor", nil)
	r.AddCookie(cs[0])
	w = httptest.NewRecorder()
	h2.ServeHTTP(w, r)
	if w.Code == http.StatusOK {
		t.Error("Cookie gilt nach Passwortwechsel weiter")
	}

	// Ohne „Angemeldet bleiben": Sitzungs-Cookie ohne Max-Age.
	w = anmeldenMit(t, h, url.Values{"benutzer": {"team"}, "passwort": {"geheim"}})
	if cs := w.Result().Cookies(); len(cs) != 1 || cs[0].MaxAge != 0 {
		t.Errorf("kurze Sitzung: %+v", cs)
	}
}

func TestSitzungLaeuftAb(t *testing.T) {
	a := anmeldung{schluessel: [32]byte{1}}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.AddCookie(&http.Cookie{Name: sitzungsCookie, Value: a.sitzungWert(Angemeldet{Admin: true}, time.Now().Add(time.Hour))})
	if a.sitzung(r, time.Now()) == nil {
		t.Error("gültige Sitzung abgelehnt")
	}
	if a.sitzung(r, time.Now().Add(2*time.Hour)) != nil {
		t.Error("abgelaufene Sitzung angenommen")
	}
}

func TestWeiterZielBleibtAufDerSeite(t *testing.T) {
	for roh, will := range map[string]string{
		"/monitor":             "/monitor",
		"//evil.example":       "/",
		"https://evil.example": "/",
		"/\\evil.example":      "/",
		"/anmelden":            "/",
	} {
		if got := weiterZiel(roh); got != will {
			t.Errorf("%q → %q", roh, got)
		}
	}
}

func TestHtmxOhneAnmeldungWechseltDieSeite(t *testing.T) {
	h := MitPasswort(http.NotFoundHandler(), "", "geheim", nil)
	r := httptest.NewRequest(http.MethodPost, "/deal/laden", nil)
	r.Header.Set("HX-Request", "true")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized || !strings.HasPrefix(w.Header().Get("HX-Redirect"), "/anmelden") {
		t.Errorf("%d %q", w.Code, w.Header().Get("HX-Redirect"))
	}
}
