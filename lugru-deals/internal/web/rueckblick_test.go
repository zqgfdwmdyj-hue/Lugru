package web

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/rueckblick"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestRueckblickGleichtMitKeepaAb(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "x"
	post := time.Now().AddDate(0, -6, 0)
	m := func(tage int) int { return rueckblick.Minute(post.AddDate(0, 0, tage)) }
	var anfragen atomic.Int32
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		anfragen.Add(1)
		fmt.Fprintf(w, `{"tokensLeft": 99, "tokensConsumed": 1, "products": [{"asin": %q, "title": "Konsole",
			"csv": [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,
			[%d, 50000, 0, %d, 38000, 0, %d, 41000, 0, %d, 49500, 0]]}]}`,
			r.URL.Query().Get("asin"), m(-3), m(5), m(15), m(80))
	}))
	defer ks.Close()
	srv.keepa.BasisURL = ks.URL

	anlegen := func(asin string, gewinn int64) int64 {
		id, err := s.DealAnlegen(store.Deal{ASIN: asin, Titel: "Konsole " + asin, Quellmarkt: "DE", Zielmarkt: "DE",
			EKCent: 40000, VKCent: 50000, ProvisionProzent: 8, GewinnCent: 0, ChannelID: 1, ChannelName: "deals",
			NachrichtText: "x", GepostetAm: post})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	anlegen("B000000001", 0)
	anlegen("B000000001", 0) // derselbe Artikel — nur eine Keepa-Anfrage
	anlegen("B000000002", 0)

	tag := post.Format("2006-01-02")
	w := hole(t, srv, http.MethodGet, "/statistik/rueckblick?von="+tag+"&bis="+tag, "")
	if !strings.Contains(w.Body.String(), "2 Keepa-Token") {
		t.Fatalf("Token-Hinweis fehlt: %s", w.Body.String())
	}
	hole(t, srv, http.MethodPost, "/statistik/rueckblick/abgleichen", url.Values{"von": {tag}, "bis": {tag}}.Encode())
	for i := 0; i < 100; i++ {
		srv.rueckblickMu.Lock()
		laeuft := srv.rueckblickLauf.Laeuft
		srv.rueckblickMu.Unlock()
		if !laeuft {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if n := anfragen.Load(); n != 2 {
		t.Errorf("%d Keepa-Anfragen, will 2", n)
	}
	w = hole(t, srv, http.MethodGet, "/statistik/rueckblick?von="+tag+"&bis="+tag, "")
	body := w.Body.String()
	for _, soll := range []string{"Abgleich fertig", "380,00 €", "nach 80 Tagen", "Alle Deals im Zeitraum sind abgeglichen"} {
		if !strings.Contains(body, soll) {
			t.Errorf("Seite ohne %q", soll)
		}
	}
	if strings.Contains(body, "noch nicht abgeglichen") {
		t.Error("Deals nicht abgeglichen")
	}
}

func TestRueckblickMitB2B(t *testing.T) {
	srv, s := testServer(t)
	if err := s.SetzeEinstellung(store.SchluesselB2BChannels, "auto"); err != nil {
		t.Fatal(err)
	}
	normal, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: "https://x/1"})
	b2b, _ := s.ChannelAnlegen(store.Channel{Name: "b2b-deals", WebhookURL: "https://x/2"})
	post := time.Now().AddDate(0, -6, 0)
	for _, c := range []struct {
		titel string
		id    int64
	}{{"Normaler Deal", normal}, {"Palette Großhandel", b2b}} {
		if _, err := s.DealAnlegen(store.Deal{ASIN: "B00000000X", Titel: c.titel, Quellmarkt: "DE", Zielmarkt: "DE",
			EKCent: 100, VKCent: 200, ChannelID: c.id, ChannelName: "c", NachrichtText: "x", GepostetAm: post}); err != nil {
			t.Fatal(err)
		}
	}
	tag := post.Format("2006-01-02")
	alle := hole(t, srv, http.MethodGet, "/statistik/rueckblick?von="+tag+"&bis="+tag, "").Body.String()
	if !strings.Contains(alle, "Normaler Deal") || !strings.Contains(alle, "Palette Großhandel") || !strings.Contains(alle, "davon 1 B2B") {
		t.Fatalf("alle Deals: %s", alle)
	}
	nurB2B := hole(t, srv, http.MethodGet, "/statistik/rueckblick?von="+tag+"&bis="+tag+"&art=b2b", "").Body.String()
	if strings.Contains(nurB2B, "Normaler Deal") || !strings.Contains(nurB2B, "Palette Großhandel") {
		t.Fatal("Filter „nur B2B“ greift nicht")
	}
}

// Abgleiche ohne Daten und ohne Grund (aus der Zeit, als nur die
// Buy-Box-Reihe gelesen wurde) werden nachgeholt, alle anderen nicht.
func TestRueckblickOffenHoltLeereNach(t *testing.T) {
	jetzt := time.Now()
	deals := []store.Deal{{ID: 1, ASIN: "A", Zielmarkt: "DE"}, {ID: 2, ASIN: "B", Zielmarkt: "DE"}, {ID: 3, ASIN: "C", Zielmarkt: "DE"}}
	bl := map[int64]store.Rueckblick{
		1: {DealID: 1, GeprueftAm: jetzt},
		2: {DealID: 2, GeprueftAm: jetzt, Daten: true},
		3: {DealID: 3, GeprueftAm: jetzt, Fehler: "Keepa kennt die ASIN nicht"},
	}
	offen := rueckblickOffen(deals, bl, jetzt)
	if len(offen) != 1 || offen[0].asin != "A" {
		t.Fatalf("offen: %+v", offen)
	}
}
