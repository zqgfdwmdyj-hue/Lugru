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
