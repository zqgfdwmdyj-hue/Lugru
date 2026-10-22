package billiger

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

func TestLiesPreisliste(t *testing.T) {
	roh, err := os.ReadFile("testdata/preisliste.html")
	if err != nil {
		t.Fatal(err)
	}
	p, err := Lies(string(roh))
	if err != nil {
		t.Fatal(err)
	}
	if p.EAN != "0718037891378" {
		t.Errorf("EAN = %q", p.EAN)
	}
	if p.Name != "Western Digital Black SN850X 4 TB M.2 WDS400T2X0E" {
		t.Errorf("Name = %q", p.Name)
	}
	if len(p.Angebote) != 6 {
		t.Fatalf("%d Angebote, erwartet 6", len(p.Angebote))
	}
	erstes := p.Angebote[0]
	if erstes.Shop != "computeruniverse.net" || erstes.Preis != 61599 || erstes.Versand != 699 || erstes.Gesamt != 62298 {
		t.Errorf("erstes Angebot = %+v", erstes)
	}
	if erstes.Status != Lieferbar {
		t.Errorf("Status = %q", erstes.Status)
	}

	nachShop := map[string]Angebot{}
	for _, a := range p.Angebote {
		nachShop[a.Shop] = a
	}
	if k := nachShop["Kaufland.de"]; k.Gesamt != 64900 || k.Versand != 0 {
		t.Errorf("Kaufland = %+v", k)
	}
	if o := nachShop["OTTO"]; o.Gesamt != 94923 || o.Status != Lieferbar {
		t.Errorf("OTTO = %+v", o)
	}
	if pr := nachShop["Proshop.de"]; pr.Status != Verzoegert || pr.Lieferzeit != "5-7 Werktage" {
		t.Errorf("Proshop = %+v", pr)
	}
}

func TestLiesOhneAngebote(t *testing.T) {
	if _, err := Lies("<html><body>Wartung</body></html>"); !errors.Is(err, ErrKeineAngebote) {
		t.Errorf("err = %v", err)
	}
}

func TestNormalisiereURL(t *testing.T) {
	for roh, erwartet := range map[string]string{
		"https://www.billiger.de/pricelist/4028692061-western-digital?uds=abc#x": "https://www.billiger.de/pricelist/4028692061-western-digital",
		"https://billiger.de/products/5154110999-wd-black":                       "https://www.billiger.de/products/5154110999-wd-black",
	} {
		if got, err := NormalisiereURL(roh); err != nil || got != erwartet {
			t.Errorf("%s → %q, %v", roh, got, err)
		}
	}
	for _, roh := range []string{"", "https://www.idealo.de/preisvergleich/1.html", "https://www.billiger.de/search?q=x", "https://evil.de/billiger.de/pricelist/1"} {
		if _, err := NormalisiereURL(roh); err == nil {
			t.Errorf("%q sollte abgelehnt werden", roh)
		}
	}
}

func TestHoleBlockiert(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer ts.Close()
	hc := ts.Client()
	hc.Transport = umleiten{ziel: ts.URL}
	if _, err := Hole(context.Background(), hc, "https://www.billiger.de/pricelist/1-x"); !errors.Is(err, ErrBlockiert) {
		t.Errorf("err = %v", err)
	}
}

func TestHoleLiest(t *testing.T) {
	roh, _ := os.ReadFile("testdata/preisliste.html")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("ohne User-Agent")
		}
		_, _ = w.Write(roh)
	}))
	defer ts.Close()
	hc := &http.Client{Transport: umleiten{ziel: ts.URL}}
	p, err := Hole(context.Background(), hc, "https://www.billiger.de/pricelist/4028692061-x?uds=1")
	if err != nil {
		t.Fatal(err)
	}
	if p.URL != "https://www.billiger.de/pricelist/4028692061-x" || p.Angebote[0].Gesamt != money.Cents(62298) {
		t.Errorf("p = %+v", p)
	}
}

// umleiten schickt jede Anfrage an den Testserver.
type umleiten struct{ ziel string }

func (u umleiten) RoundTrip(r *http.Request) (*http.Response, error) {
	r2 := r.Clone(r.Context())
	neu, _ := http.NewRequest(r.Method, u.ziel+r.URL.Path, nil)
	r2.URL = neu.URL
	r2.Host = neu.URL.Host
	return http.DefaultTransport.RoundTrip(r2)
}
