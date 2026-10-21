package keepa

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestProduktErfolg(t *testing.T) {
	roh, err := os.ReadFile("testdata/produkt.json")
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}

	var gesehen *http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gesehen = r
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	a, roh2, err := c.Produkt(context.Background(), "B01636IZ0G", 3)
	if err != nil {
		t.Fatalf("Produkt: %v", err)
	}
	// Der Cache in internal/store speichert genau diesen Rückgabewert
	// unverändert weg (siehe web.holeProdukt) und liest ihn später über
	// ParseAntwort zurück — ohne den unveränderten Rohkörper bliebe der
	// Keepa-Cache wirkungslos (siehe I4 im Abschluss-Review).
	if string(roh2) != string(roh) {
		t.Errorf("roher Antwortkörper weicht von der Fixture ab: %q", roh2)
	}
	if a.Produkt.ASIN != "B01636IZ0G" {
		t.Errorf("ASIN = %q", a.Produkt.ASIN)
	}
	if a.TokensLeft != 1183 {
		t.Errorf("TokensLeft = %d, will 1183", a.TokensLeft)
	}

	q := gesehen.URL.Query()
	for schluessel, will := range map[string]string{
		"key": "geheim", "asin": "B01636IZ0G", "domain": "3",
		"stats": "90", "history": "1",
	} {
		if got := q.Get(schluessel); got != will {
			t.Errorf("Parameter %s = %q, will %q", schluessel, got, will)
		}
	}
}

// TestProduktTokensErschoepft deckt alle drei Formen ab, in denen ein 429
// antworten kann: mit einer verwertbaren Wartezeit, mit der Fehlerseite eines
// vorgeschalteten Systems (kein JSON) und mit leerem Koerper. In den letzten
// beiden Faellen bleibt Bekannt false statt eine Wartezeit von null
// vorzutaeuschen — die Fehlerklassifizierung selbst aendert sich dabei nie:
// alle drei Faelle sind und bleiben ErrTokensErschoepft.
func TestProduktTokensErschoepft(t *testing.T) {
	faelle := []struct {
		name        string
		koerper     string
		willBekannt bool
		willRefill  time.Duration
	}{
		{
			name:        "gueltiges JSON mit refillIn",
			koerper:     `{"tokensLeft":0,"refillIn":120000,"error":{"type":"NOT_ENOUGH_TOKEN","message":"Insufficient tokens"}}`,
			willBekannt: true,
			willRefill:  2 * time.Minute,
		},
		{
			name:        "HTML statt JSON, z.B. eine WAF- oder CDN-Fehlerseite",
			koerper:     `<html><body>502 Bad Gateway</body></html>`,
			willBekannt: false,
		},
		{
			name:        "leerer Koerper",
			koerper:     ``,
			willBekannt: false,
		},
	}

	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(f.koerper))
			}))
			defer srv.Close()

			c := NeuerClient("geheim")
			c.BasisURL = srv.URL

			_, _, err := c.Produkt(context.Background(), "B01636IZ0G", 3)
			var erschoepft ErrTokensErschoepft
			if !errors.As(err, &erschoepft) {
				t.Fatalf("will ErrTokensErschoepft, bekam %v", err)
			}
			if erschoepft.Bekannt != f.willBekannt {
				t.Errorf("Bekannt = %v, will %v", erschoepft.Bekannt, f.willBekannt)
			}
			if f.willBekannt && erschoepft.RefillIn != f.willRefill {
				t.Errorf("RefillIn = %v, will %v", erschoepft.RefillIn, f.willRefill)
			}
		})
	}
}

func TestProduktNichtGefunden(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"tokensLeft":10,"tokensConsumed":1,"products":[]}`))
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	if _, _, err := c.Produkt(context.Background(), "B0XXXXXXXX", 3); !errors.Is(err, ErrNichtGefunden) {
		t.Errorf("will ErrNichtGefunden, bekam %v", err)
	}
}

func TestProduktServerfehler(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	if _, _, err := c.Produkt(context.Background(), "B01636IZ0G", 3); err == nil {
		t.Error("Fehler erwartet, kam keiner")
	}
}
