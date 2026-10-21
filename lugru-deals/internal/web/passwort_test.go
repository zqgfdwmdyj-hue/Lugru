package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMitPasswort(t *testing.T) {
	innen := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })

	offen := MitPasswort(innen, "", "")
	w := httptest.NewRecorder()
	offen.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != http.StatusOK {
		t.Errorf("ohne Passwort: %d", w.Code)
	}

	geschuetzt := MitPasswort(innen, "", "geheim")
	for _, fall := range []struct {
		b, p string
		mit  bool
		will int
	}{
		{"", "", false, http.StatusUnauthorized},
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
