package keepa

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestProduktZuCode(t *testing.T) {
	roh, err := os.ReadFile("testdata/produkt.json")
	if err != nil {
		t.Fatal(err)
	}
	var q map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q = map[string]string{"code": r.URL.Query().Get("code"), "asin": r.URL.Query().Get("asin"), "domain": r.URL.Query().Get("domain")}
		_, _ = w.Write(roh)
	}))
	defer srv.Close()
	c := NeuerClient("geheim")
	c.BasisURL = srv.URL
	a, _, err := c.ProduktZuCode(context.Background(), " 0718037891378 ", 3)
	if err != nil {
		t.Fatal(err)
	}
	if a.Produkt.ASIN != "B01636IZ0G" {
		t.Errorf("ASIN = %q", a.Produkt.ASIN)
	}
	if q["code"] != "0718037891378" || q["asin"] != "" || q["domain"] != "3" {
		t.Errorf("Parameter = %v", q)
	}
	if _, _, err := c.ProduktZuCode(context.Background(), "", 3); !errors.Is(err, ErrNichtGefunden) {
		t.Errorf("leerer Code: %v", err)
	}
}
