package ebay

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const antwort = `{"itemSummaries":[
 {"title":"PS5 Pro neu","itemWebUrl":"https://www.ebay.de/itm/3","price":{"value":"799.00","currency":"EUR"},"shippingOptions":[{"shippingCost":{"value":"0.00"}}]},
 {"title":"PS5 Pro OVP","itemWebUrl":"https://www.ebay.de/itm/1","price":{"value":"749.00","currency":"EUR"},"shippingOptions":[{"shippingCost":{"value":"6.99"}}]},
 {"title":"PS5 Pro","itemWebUrl":"https://www.ebay.de/itm/2","price":{"value":"770.00","currency":"EUR"}},
 {"title":"fremd","price":{"value":"10.00","currency":"USD"}}
]}`

func TestSucheUndMarktpreis(t *testing.T) {
	var auth, markt, gtin string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/identity/v1/oauth2/token":
			id, geheim, _ := r.BasicAuth()
			if id != "app" || geheim != "cert" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":7200}`))
		case "/buy/browse/v1/item_summary/search":
			auth, markt, gtin = r.Header.Get("Authorization"), r.Header.Get("X-EBAY-C-MARKETPLACE-ID"), r.URL.Query().Get("gtin")
			_, _ = w.Write([]byte(antwort))
		}
	}))
	defer ts.Close()
	c := NeuerClient("app", "cert", ts.Client())
	c.BasisURL = ts.URL
	as, err := c.Suche(context.Background(), "0711719595908")
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tok" || markt != "EBAY_DE" || gtin != "0711719595908" {
		t.Errorf("Anfrage: %q %q %q", auth, markt, gtin)
	}
	if len(as) != 3 || as[0].Gesamt() != 75599 || as[1].Gesamt() != 77000 {
		t.Fatalf("Angebote = %+v", as)
	}
	if vk, n := Marktpreis(as, 5); vk != 77000 || n != 3 {
		t.Errorf("Marktpreis = %d aus %d", vk, n)
	}
	if e := Erloes(77000, 11, 35, 500); e != 77000-8470-35-500 {
		t.Errorf("Erlös = %d", e)
	}

	ohne := NeuerClient("", "", ts.Client())
	if _, err := ohne.Suche(context.Background(), "1"); err != ErrKeinZugang {
		t.Errorf("ohne Zugang: %v", err)
	}
}

func TestTokenVomSellerSystem(t *testing.T) {
	var gesehen string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/public/lugru-deals/ebay-token":
			gesehen = r.Header.Get("Authorization")
			if gesehen != "Bearer richtig" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"access_token":"vomSeller","expires_in":1800,"env":"production"}`))
		case "/buy/browse/v1/item_summary/search":
			if r.Header.Get("Authorization") != "Bearer vomSeller" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(antwort))
		}
	}))
	defer ts.Close()
	c := NeuerClient("", "", ts.Client())
	c.BasisURL = ts.URL
	c.Seller = &Seller{URL: ts.URL + "/", Schluessel: "richtig"}
	if as, err := c.Suche(context.Background(), "1"); err != nil || len(as) != 3 {
		t.Fatalf("%v %d", err, len(as))
	}
	falsch := NeuerClient("", "", ts.Client())
	falsch.BasisURL = ts.URL
	falsch.Seller = &Seller{URL: ts.URL, Schluessel: "falsch"}
	if _, err := falsch.Suche(context.Background(), "1"); err == nil || !strings.Contains(err.Error(), "Verbindungsschlüssel falsch") {
		t.Errorf("falscher Schlüssel: %v", err)
	}
}
