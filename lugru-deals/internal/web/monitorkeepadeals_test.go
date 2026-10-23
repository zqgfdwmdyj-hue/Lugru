package web

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestKeepaPreisstuerzePosten(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	_ = a.s.MonitorProduktLoeschen(a.produktID)
	fixtureDE, _ := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	var mu sync.Mutex
	dealAbfragen, produktAbfragen := 0, 0
	var letzteDealAnfrage string
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case strings.HasSuffix(r.URL.Path, "/graphimage"):
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nTESTBILD"))
		case strings.HasSuffix(r.URL.Path, "/deal"):
			dealAbfragen++
			roh, _ := io.ReadAll(r.Body)
			letzteDealAnfrage = string(roh)
			fmt.Fprint(w, `{"tokensLeft": 80, "tokensConsumed": 5, "refillRate": 20, "deals": {"dr": [
				{"asin": "B01636IZ0G", "title": "Makita HR2630", "current": [12000, 12000, -1, 900], "avg": [[17000]], "deltaPercent": [[-29]]}],
				"categoryIds": [80084031, 11961464031], "categoryNames": ["Baumarkt", "Fashion"], "categoryCount": [1, 0]}}`)
		default:
			produktAbfragen++
			if r.URL.Query().Get("domain") == "4" {
				_, _ = w.Write(keepaMitPreis(t, 12000))
				return
			}
			_, _ = w.Write(fixtureDE)
		}
	}))
	defer ks.Close()
	a.srv.keepa.BasisURL = ks.URL

	w := hole(t, a.srv, http.MethodPost, "/monitor/keepa", url.Values{
		"name": {"Stürze FR"}, "markt": {"FR"}, "preisart": {"0"}, "min_rabatt": {"20"}, "zeitraum": {"0"},
		"zielmarkt": {"DE"}, "modus": {"amazon"}, "minuten": {"5"}, "max_je_lauf": {"20"},
		"channel_id": {itoa(a.normal)}, "min_marge": {"10"},
	}.Encode())
	if !strings.Contains(w.Body.String(), "Keepa-Suche „Stürze FR“ angelegt") || !strings.Contains(w.Body.String(), "Regel angelegt") {
		t.Fatalf("Anlegen: %s", w.Body.String())
	}

	jetzt := time.Now()
	a.srv.keepaSuchenPruefen(context.Background(), jetzt)
	if dealAbfragen != 1 {
		t.Fatalf("%d Deal-Abfragen", dealAbfragen)
	}
	posts := a.posts("/normal")
	if len(posts) != 1 || !strings.Contains(posts[0], "amazon.fr") {
		t.Fatalf("Posts: %v", posts)
	}
	ks2, _ := a.s.KeepaSuchen()
	if !strings.Contains(ks2[0].Status, "1 Preisstürze bei Keepa, 1 neu durchgerechnet, 1 gepostet") {
		t.Errorf("Status: %s", ks2[0].Status)
	}
	// Das Produkt steht nicht in den Listen der Seite.
	ps, _ := a.s.MonitorProdukte()
	if len(ps) != 1 || ps[0].Herkunft != store.HerkunftKeepaDeal || ps[0].Aktiv {
		t.Fatalf("Produkte: %+v", ps)
	}

	// Zu früh: keine Abfrage. Danach derselbe Preissturz: nicht noch einmal.
	a.srv.keepaSuchenPruefen(context.Background(), jetzt.Add(time.Minute))
	if dealAbfragen != 1 {
		t.Errorf("vor Ablauf des Intervalls erneut gefragt")
	}
	vorher := produktAbfragen
	a.srv.keepaSuchenPruefen(context.Background(), jetzt.Add(6*time.Minute))
	if dealAbfragen != 2 || produktAbfragen != vorher || len(a.posts("/normal")) != 1 {
		t.Errorf("derselbe Preissturz erneut gerechnet: Deals %d, Produkte %d→%d, Posts %d", dealAbfragen, vorher, produktAbfragen, len(a.posts("/normal")))
	}
	seite := hole(t, a.srv, http.MethodGet, "/monitor", "").Body.String()
	if !strings.Contains(seite, "Keepa-Preisstürze") || !strings.Contains(seite, "Bisher 1 Artikel durchgerechnet") {
		t.Error("Abschnitt fehlt")
	}
	// Die Kategorien kamen mit der Abfrage; „Fashion“ ausblenden.
	if !strings.Contains(seite, `data-name="Fashion"`) {
		t.Fatal("Kategorie Fashion nicht zur Wahl")
	}
	hole(t, a.srv, http.MethodPost, fmt.Sprintf("/monitor/keepa/%d/ausschluss", ks2[0].ID), url.Values{"ausschluss_id": {"11961464031"}}.Encode())
	a.srv.keepaSuchenPruefen(context.Background(), jetzt.Add(12*time.Minute))
	if !strings.Contains(letzteDealAnfrage, `"excludeCategories":[11961464031]`) {
		t.Errorf("Ausschluss nicht gesendet: %s", letzteDealAnfrage)
	}
	ks3, _ := a.s.KeepaSuchen()
	if !strings.Contains(ks3[0].Status, "Preisstürze") {
		t.Errorf("Status: %s", ks3[0].Status)
	}
	if seite := hole(t, a.srv, http.MethodGet, "/monitor", "").Body.String(); !strings.Contains(seite, "ohne Fashion") {
		t.Error("ausgeblendete Kategorie nicht beim Namen genannt")
	}
}
