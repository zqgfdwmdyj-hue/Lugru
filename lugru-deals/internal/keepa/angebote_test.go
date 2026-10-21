package keepa

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const angeboteJSON = `{"tokensLeft": 90, "tokensConsumed": 8, "products": [{"asin": "B0TEST0001", "offers": [
 {"sellerId": "A1GANOXEL", "condition": 1, "isPrime": true, "isFBA": true, "offerCSV": [7000000, 6200, 0, 7100000, 5958, 0], "stockCSV": [7000000, 10, 7100000, 3]},
 {"sellerId": "A3JWKAKR8XB7XF", "condition": 1, "isAmazon": true, "isPrime": true, "offerCSV": [7100000, 6490, 0], "stockCSV": [7100000, 30]},
 {"sellerId": "A2GEBRAUCHT", "condition": 2, "offerCSV": [7100000, 3000, 0]},
 {"sellerId": "A2OHNEBESTAND", "condition": 1, "offerCSV": [7100000, 5500, 499]}
]}]}`

func TestAngeboteMitBestand(t *testing.T) {
	var anfrage string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		anfrage = r.URL.RawQuery
		w.Write([]byte(angeboteJSON))
	}))
	defer srv.Close()
	c := NeuerClient("k")
	c.BasisURL = srv.URL

	liste, a, err := c.Angebote(context.Background(), "B0TEST0001", 3)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"offers=20", "stock=1", "only-live-offers=1"} {
		if !strings.Contains(anfrage, p) {
			t.Errorf("Anfrage ohne %s: %s", p, anfrage)
		}
	}
	if a.TokensConsumed != 8 {
		t.Errorf("Token: %d", a.TokensConsumed)
	}
	if len(liste) != 3 {
		t.Fatalf("erwartet 3 Neu-Angebote, bekommen %d: %+v", len(liste), liste)
	}
	// Günstigstes zuerst, Versand eingerechnet: 55,00 + 4,99 = 59,99 > 59,58.
	if liste[0].VerkaeuferID != "A1GANOXEL" || liste[0].Gesamt != 5958 || liste[0].Bestand != 3 || !liste[0].FBA {
		t.Errorf("erstes Angebot: %+v", liste[0])
	}
	if liste[1].Gesamt != 5999 || liste[1].Bestand != -1 {
		t.Errorf("zweites Angebot: %+v", liste[1])
	}
	if !liste[2].Amazon || liste[2].Bestand != 30 {
		t.Errorf("Amazon-Angebot: %+v", liste[2])
	}
}
