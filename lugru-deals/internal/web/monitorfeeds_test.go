package web

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/mydealz"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestFeedQuelle(t *testing.T) {
	for roh, will := range map[string]string{
		"auto-leasing":                         "https://www.mydealz.de/rss/gruppe/auto-leasing",
		"https://www.mydealz.de/gruppe/reisen": "https://www.mydealz.de/rss/gruppe/reisen",
		"https://www.mydealz.de/rss/trending":  "https://www.mydealz.de/rss/trending",
		"hot":                                  "https://www.mydealz.de/rss/trending",
		" Elektronik ":                         "https://www.mydealz.de/rss/gruppe/elektronik",
	} {
		if got, err := feedQuelle(roh); err != nil || got != will {
			t.Errorf("%q → %q, %v", roh, got, err)
		}
	}
	for _, roh := range []string{"", "https://evil.de/gruppe/x", "rei sen", "../x?y"} {
		if _, err := feedQuelle(roh); err == nil {
			t.Errorf("%q angenommen", roh)
		}
	}
}

func TestFeedPasst(t *testing.T) {
	lf := func(f float64, art string) mydealz.Leasing { return mydealz.Leasing{Faktor: f, Art: art, Rate: 25000} }
	leasing := store.DealFeed{Art: store.FeedLeasing, MaxLF: 0.5, LeasingArt: "privat"}
	if !feedPasst(leasing, mydealz.Deal{}, lf(0.45, "privat")) {
		t.Error("LF 0,45 privat abgelehnt")
	}
	if feedPasst(leasing, mydealz.Deal{}, lf(0.53, "privat")) || feedPasst(leasing, mydealz.Deal{}, lf(0.4, "gewerbe")) || feedPasst(leasing, mydealz.Deal{}, lf(0, "privat")) {
		t.Error("zu hoher LF, Gewerbe oder unbekannter LF angenommen")
	}
	hot := store.DealFeed{MinTemp: 300}
	if feedPasst(hot, mydealz.Deal{Temperatur: 250, TemperaturBekannt: true}, mydealz.Leasing{}) || !feedPasst(hot, mydealz.Deal{Temperatur: 400, TemperaturBekannt: true}, mydealz.Leasing{}) {
		t.Error("Temperatur-Filter falsch")
	}
	reisen := store.DealFeed{Art: store.FeedReisen, Stichworte: "-kreuzfahrt"}
	if feedPasst(reisen, mydealz.Deal{Titel: "AIDA Kreuzfahrt Mittelmeer"}, mydealz.Leasing{}) || !feedPasst(reisen, mydealz.Deal{Titel: "Flüge nach Bali"}, mydealz.Leasing{}) {
		t.Error("Ausschluss-Stichwort falsch")
	}
}

func TestLeasingFeedPostet(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	roh, _ := os.ReadFile("../mydealz/testdata/leasing.xml")
	a.setzeSeite("/rss/gruppe/auto-leasing", string(roh))

	w := hole(t, a.srv, http.MethodPost, "/monitor/feeds", url.Values{"channel_id": {itoa(a.normal)}, "vorlage": {"leasing"}}.Encode())
	if !strings.Contains(w.Body.String(), "Auto-Leasing") {
		t.Fatalf("Anlegen: %s", w.Body.String())
	}
	jetzt := time.Now()
	// Erster Abruf: nur merken.
	a.srv.feedsPruefen(context.Background(), jetzt)
	if n := len(a.posts("/normal")); n != 0 {
		t.Fatalf("%d Posts beim ersten Abruf", n)
	}
	// Ein neuer Deal kommt dazu (LF 0,45, privat).
	neu := strings.Replace(string(roh), "<item>", `<item><title><![CDATA[[Privatleasing] Cupra Formentor VZ | 265€/M | 24Mo | 0,45LF]]></title><link>https://www.mydealz.de/deals/cupra-9</link><pepper:merchant name="LeasingMarkt" price="7.840€"/></item><item>`, 1)
	a.setzeSeite("/rss/gruppe/auto-leasing", neu)
	a.srv.feedsPruefen(context.Background(), jetzt.Add(3*time.Minute))
	posts := a.posts("/normal")
	if len(posts) != 1 {
		t.Fatalf("%d Posts, will 1", len(posts))
	}
	for _, soll := range []string{"🚗 [Privatleasing] Cupra Formentor", "265,00 € mtl.", "LF 0,45", "Privatleasing", "LeasingMarkt", "https://www.mydealz.de/deals/cupra-9"} {
		if !strings.Contains(posts[0], soll) {
			t.Errorf("Post ohne %q: %s", soll, posts[0])
		}
	}
}

// Ein Trending-Deal steht schon mit 177° im Feed und wird erst später heiß
// genug — dann muss er noch gepostet werden, und zwar nur einmal je Channel.
func TestTrendingDealWirdSpaeterHeiss(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	roh, _ := os.ReadFile("../mydealz/testdata/trending.xml")
	a.setzeSeite("/rss/trending", string(roh))

	hole(t, a.srv, http.MethodPost, "/monitor/feeds", url.Values{"channel_id": {itoa(a.normal)}, "vorlage": {"eigen"}}.Encode())
	w := hole(t, a.srv, http.MethodPost, "/monitor/feeds", url.Values{"channel_id": {itoa(a.normal)}, "vorlage": {"eigen"}}.Encode())
	if !strings.Contains(w.Body.String(), "gibt es in dem Channel schon") {
		t.Fatalf("doppelter Feed angelegt: %s", w.Body.String())
	}
	jetzt := time.Now()
	a.srv.feedsPruefen(context.Background(), jetzt)
	if n := len(a.posts("/normal")); n != 0 {
		t.Fatalf("%d Posts beim ersten Abruf", n)
	}
	heiss := strings.Replace(string(roh), "177° - Direktflüge", "231° - Direktflüge", 1)
	a.setzeSeite("/rss/trending", heiss)
	a.srv.feedsPruefen(context.Background(), jetzt.Add(3*time.Minute))
	a.srv.feedsPruefen(context.Background(), jetzt.Add(6*time.Minute))
	posts := a.posts("/normal")
	if len(posts) != 1 || !strings.Contains(posts[0], "Seychellen") {
		t.Fatalf("Posts: %q", posts)
	}
}
