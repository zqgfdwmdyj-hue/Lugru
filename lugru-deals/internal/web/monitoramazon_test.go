package web

import (
	"context"
	"encoding/json"
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

// keepaMitPreis liefert das Fixture-Produkt; auf amazon.fr (domain 4) mit
// dem angegebenen Amazon-Preis als günstigstem Neupreis.
func keepaMitPreis(t *testing.T, frPreis int) []byte {
	t.Helper()
	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatal(err)
	}
	var d map[string]any
	_ = json.Unmarshal(roh, &d)
	p := d["products"].([]any)[0].(map[string]any)
	cur := p["stats"].(map[string]any)["current"].([]any)
	cur[0], cur[1] = frPreis, frPreis
	out, _ := json.Marshal(d)
	return out
}

func TestAsinListeEinkaufBeiAmazon(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	_ = a.s.MonitorProduktLoeschen(a.produktID)
	fixtureDE, _ := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	var mu sync.Mutex
	anfragen := map[string]int{}
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if strings.HasSuffix(r.URL.Path, "/graphimage") {
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nTESTBILD"))
			return
		}
		mu.Lock()
		anfragen[q.Get("domain")]++
		mu.Unlock()
		if q.Get("domain") == "4" {
			_, _ = w.Write(keepaMitPreis(t, 12000))
			return
		}
		_, _ = w.Write(fixtureDE)
	}))
	defer ks.Close()
	a.srv.keepa.BasisURL = ks.URL

	w := hole(t, a.srv, http.MethodPost, "/monitor/asins", url.Values{
		"asins": {"Liste:\nB01636IZ0G\nb01636iz0g doppelt"}, "einkauf": {"FR"}, "zielmarkt": {"DE"},
		"modus": {"amazon"}, "channel_id": {itoa(a.normal)}, "min_marge": {"10"},
	}.Encode())
	body := w.Body.String()
	if !strings.Contains(body, "1 ASINs angelegt") || !strings.Contains(body, "Regel angelegt") {
		t.Fatalf("Anlegen: %s", body)
	}
	ps, _ := a.s.MonitorProdukte()
	if len(ps) != 1 || !ps[0].IstAmazonQuelle() || ps[0].Einkauf != "FR" || ps[0].Kategorie != "ASIN-Liste" {
		t.Fatalf("Produkte: %+v", ps)
	}
	// FR und DE je ein Token, alle 60 Minuten: 2/60 ≈ 0,0 je Minute.
	if !strings.Contains(body, "etwa 0,0 Keepa-Token je Minute") {
		t.Errorf("Bedarf fehlt: %s", body)
	}

	faellig, _ := a.s.MonitorFaelligJe(a.srv.prioIntervall, time.Now())
	a.srv.amazonVorladen(context.Background(), faellig)
	if anfragen["4"] != 1 || anfragen["3"] != 1 {
		t.Fatalf("Keepa-Anfragen beim Vorladen: %v", anfragen)
	}
	b := a.srv.monitorPruefe(context.Background(), ps[0], false)
	if !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	if anfragen["4"] != 1 || anfragen["3"] != 1 {
		t.Errorf("Bewertung fragt Keepa erneut statt aus dem Cache: %v", anfragen)
	}
	posts := a.posts("/normal")
	if len(posts) != 1 || !strings.Contains(posts[0], "amazon.fr") {
		t.Fatalf("Post: %v", posts)
	}
	ds, _ := a.s.Deals(store.DealFilter{Limit: 5})
	if len(ds) != 1 || ds[0].Quellmarkt != "FR" || ds[0].EKCent != 12000 {
		t.Fatalf("Historie: %+v", ds)
	}

	// Gleicher Preis: kein neuer Post. Günstiger: neuer Post.
	p, _ := a.s.MonitorProdukt(ps[0].ID)
	if b := a.srv.monitorPruefe(context.Background(), p, false); b.Gepostet {
		t.Fatalf("gleicher Preis erneut gepostet: %s", b.Status)
	}
	_ = a.s.CacheSchreiben("B01636IZ0G", 4, keepaMitPreis(t, 11000))
	p, _ = a.s.MonitorProdukt(ps[0].ID)
	if b := a.srv.monitorPruefe(context.Background(), p, false); !b.Gepostet {
		t.Fatalf("Preissenkung nicht gepostet: %s", b.Status)
	}
	if n := len(a.posts("/normal")); n != 2 {
		t.Errorf("%d Posts, will 2", n)
	}
	seite := hole(t, a.srv, http.MethodGet, "/monitor", "").Body.String()
	if !strings.Contains(seite, "Amazon-ASIN-Liste") || !strings.Contains(seite, "Einkauf Amazon FR") {
		t.Error("ASIN-Liste fehlt auf der Seite")
	}
}
