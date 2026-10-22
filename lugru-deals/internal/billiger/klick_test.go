package billiger

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestKlickLink(t *testing.T) {
	var gesehen string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Method != http.MethodPost || r.URL.Path != "/redirect" {
			http.NotFound(w, r)
			return
		}
		gesehen = r.PostForm.Get("target")
		if gesehen == "kaputt" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Location", "https://cmodul.solutenetwork.com/common/modules/api/cmodul?mid=1&ts=20261021")
		w.WriteHeader(http.StatusSeeOther)
	}))
	defer ts.Close()
	hc := &http.Client{Transport: umleiten{ziel: ts.URL}}
	ziel, err := KlickLink(context.Background(), hc, "abc123")
	if err != nil || ziel != "https://cmodul.solutenetwork.com/common/modules/api/cmodul?mid=1&ts=20261021" || gesehen != "abc123" {
		t.Errorf("%q, %v, gesehen %q", ziel, err, gesehen)
	}
	if _, err := KlickLink(context.Background(), hc, "kaputt"); err == nil {
		t.Error("ungültiger Schlüssel ohne Fehler")
	}
}

func TestKlickSchluesselImAngebot(t *testing.T) {
	roh, _ := os.ReadFile("testdata/preisliste.html")
	p, _ := Lies(string(roh))
	for _, a := range p.Angebote {
		if len(a.Klick) < 40 {
			t.Errorf("%s ohne Klick-Schlüssel", a.Shop)
		}
	}
}
