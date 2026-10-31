package keepa

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDealsAbfrage(t *testing.T) {
	var methode string
	var gesendet map[string]any
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methode = r.Method + " " + r.URL.Path + " key=" + r.URL.Query().Get("key")
		roh, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(roh, &gesendet)
		fmt.Fprint(w, `{"tokensLeft": 90, "tokensConsumed": 5, "refillRate": 20, "deals": {"dr": [
			{"asin": "B0AAAAAAA1", "title": "Konsole ", "current": [19999, 21000, -1, 150],
			 "avg": [[25000, 26000]], "deltaPercent": [[-20, -19]], "image": [54,49,46,106,112,103], "currentSince": [100000]},
			{"asin": "B0AAAAAAA2", "title": "kein Amazon-Preis", "current": [-1, 5000]}
		]}}`)
	}))
	defer ks.Close()
	c := NeuerClient("geheim")
	c.BasisURL = ks.URL
	erg, err := c.Deals(context.Background(), DealAnfrage{Domain: 3, Preisart: DealAmazon, MinRabatt: 5, MaxRang: 20000, MaxPreis: 50000})
	if err != nil {
		t.Fatal(err)
	}
	if methode != "POST /deal key=geheim" {
		t.Errorf("Anfrage: %s", methode)
	}
	if fmt.Sprint(gesendet["deltaPercentRange"]) != "[10 100]" || fmt.Sprint(gesendet["salesRankRange"]) != "[0 20000]" ||
		fmt.Sprint(gesendet["currentRange"]) != "[0 50000]" || gesendet["singleVariation"] != true {
		t.Errorf("gesendet: %v", gesendet)
	}
	if len(erg.Deals) != 1 || erg.TokensConsumed != 5 || erg.RefillRate != 20 {
		t.Fatalf("%+v", erg)
	}
	d := erg.Deals[0]
	if d.ASIN != "B0AAAAAAA1" || d.Preis != 19999 || d.Schnitt != 25000 || d.Rabatt != 20 || d.Rang != 150 || d.Bild != "61.jpg" || d.Titel != "Konsole" {
		t.Errorf("Deal: %+v", d)
	}
}

func TestHauptkategorien(t *testing.T) {
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/category" || r.URL.Query().Get("category") != "0" || r.URL.Query().Get("domain") != "3" {
			t.Errorf("Anfrage %s", r.URL)
		}
		fmt.Fprint(w, `{"tokensLeft": 9, "categories": {"186606": {"catId": 186606, "name": "Bücher"}, "562066": {"catId": 562066, "name": "Elektronik & Foto"}}}`)
	}))
	defer ks.Close()
	c := NeuerClient("k")
	c.BasisURL = ks.URL
	got, rest, err := c.Hauptkategorien(context.Background(), 3)
	if err != nil || rest != 9 || len(got) != 2 || got[0].Name != "Bücher" || got[1].ID != 562066 {
		t.Fatalf("%v %d %+v", err, rest, got)
	}
}
