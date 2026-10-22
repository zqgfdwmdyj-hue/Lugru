package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestRabattFuer(t *testing.T) {
	regeln := []store.ShopRabatt{
		{Shop: "OTTO", Cashback: 3},
		{Shop: "OTTO", Fest: 1000, Ab: 10000, Notiz: "Neukunden"},
		{Shop: "MediaMarkt", Cashback: 2, Fest: 500},
	}
	// Bei OTTO zählt der größere der beiden Rabatte: 10 € statt 3 %.
	if r, text := rabattFuer(regeln, "OTTO", 13056); r != 1000 || !strings.Contains(text, "Gutschein") || !strings.Contains(text, "Neukunden") {
		t.Errorf("OTTO = %d %q", r, text)
	}
	// Unter dem Mindestwert nur Cashback.
	if r, _ := rabattFuer(regeln, "OTTO", 5000); r != 150 {
		t.Errorf("OTTO klein = %d", r)
	}
	// Beides zusammen in einem Eintrag.
	if r, _ := rabattFuer(regeln, "Media Markt Online Shop", 10000); r != 700 {
		t.Errorf("MediaMarkt = %d", r)
	}
	if r, _ := rabattFuer(regeln, "Cyberport", 10000); r != 0 {
		t.Errorf("Cyberport = %d", r)
	}
}

func TestCashbackMachtDenDeal(t *testing.T) {
	a := ankaufAufbau(t)
	// Ohne Rabatt liegt OTTO (130,56 €) über dem Wecker von 125 €.
	p := a.produkt(t)
	p.MaxEK = 12500
	_ = a.s.MonitorProduktAendern(p)
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); b.Gepostet {
		t.Fatal("ohne Rabatt gepostet")
	}
	_ = a.s.ShopRabattAnlegen(store.ShopRabatt{Shop: "OTTO", Cashback: 5, Notiz: "über Shoop"})
	p = a.produkt(t)
	p.GeprueftAm = time.Time{}
	b := a.srv.monitorPruefe(context.Background(), p, false)
	if !b.Gepostet {
		t.Fatalf("mit 5 %% Cashback nicht gepostet: %s", b.Status)
	}
	post := a.posts("/normal")[0]
	for _, soll := range []string{"💰 EK: 130,56 €", "💸 abzgl. 5,0 % Cashback (6,52 €) — über Shoop → effektiv 124,04 €", "Gewinn: 15,96 €"} {
		if !strings.Contains(post, soll) {
			t.Errorf("Post ohne %q: %s", soll, post)
		}
	}
}

func TestGutscheincodeImMydealzPost(t *testing.T) {
	a := ankaufAufbau(t)
	p := a.produkt(t)
	p.Stichworte = "makita hr2630"
	_ = a.s.MonitorProduktAendern(p)
	feed := strings.ReplaceAll(mydealzFeed, "PUBDATE", time.Now().Format(time.RFC1123Z))
	feed = strings.Replace(feed, "<link>https://www.mydealz.de/deals/makita-1</link>",
		"<link>https://www.mydealz.de/deals/makita-1</link><description><![CDATA[Mit dem Code BOHR15 im Warenkorb]]></description>", 1)
	a.setzeSeite("/rss/deals", feed)
	a.srv.mydealzFeed = "https://www.mydealz.de/rss/deals"
	a.srv.mydealzPruefen(context.Background(), time.Now())
	posts := a.posts("/normal")
	if len(posts) != 1 || !strings.Contains(posts[0], "🎟️ Code: BOHR15") {
		t.Fatalf("Posts = %v", posts)
	}
}

func TestEbayModus(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	es := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/identity/v1/oauth2/token":
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":7200}`))
		case "/buy/browse/v1/item_summary/search":
			_, _ = w.Write([]byte(`{"itemSummaries":[
				{"title":"a","price":{"value":"169.00","currency":"EUR"}},
				{"title":"b","price":{"value":"175.00","currency":"EUR"},"shippingOptions":[{"shippingCost":{"value":"5.00"}}]},
				{"title":"c","price":{"value":"190.00","currency":"EUR"}}]}`))
		}
	}))
	defer es.Close()
	a.srv.ebayBasisURL = es.URL
	_ = a.s.SetzeEinstellung(store.SchluesselEbayAppID, "app")
	_ = a.s.SetzeEinstellung(store.SchluesselEbayCertID, "cert")
	_ = a.s.SetzeEinstellung(store.SchluesselEbayVersand, "4,50")
	p := a.produkt(t)
	p.Modus = store.ModusEbay
	_ = a.s.MonitorProduktAendern(p)
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.hoch, Modus: store.ModusAnkauf, Aktiv: true})
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Modus: store.ModusEbay, MinGewinn: 1000, Aktiv: true})

	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	// Median 180 € − 11 % − 0,35 € − 4,50 € Versand = 155,35 €; EK 130,56 €.
	if b.Gewinn != 2479 {
		t.Errorf("Gewinn = %d, will 2479", b.Gewinn)
	}
	if len(a.posts("/hoch")) != 0 {
		t.Error("eBay-Deal in den Ankauf-Channel gepostet")
	}
	post := a.posts("/normal")[0]
	for _, soll := range []string{"🏷️ eBay: 180,00 € (Median der 3 günstigsten neuen Angebote)", "🧾 nach eBay-Gebühren: 155,35 €", "ebay.de/sch/i.html?_nkw=0088381088543"} {
		if !strings.Contains(post, soll) {
			t.Errorf("Post ohne %q: %s", soll, post)
		}
	}
	if len(a.keepaCode) != 0 {
		t.Error("eBay-Modus fragt Keepa")
	}
}

func TestTageszusammenfassung(t *testing.T) {
	a := ankaufAufbau(t)
	_ = a.s.AnkaeuferAnlegen(store.Ankaeufer{ProduktID: a.produktID, Preis: 14000})
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorTagChannel, itoa(a.hoch))
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorTagZeit, "20:00")
	jetzt := time.Now().Local()
	vorher := time.Date(jetzt.Year(), jetzt.Month(), jetzt.Day(), 19, 59, 0, 0, jetzt.Location())
	nachher := vorher.Add(2 * time.Minute)
	a.srv.tageszusammenfassung(context.Background(), vorher)
	if len(a.posts("/hoch")) != 0 {
		t.Fatal("vor 20 Uhr gepostet")
	}
	a.srv.tageszusammenfassung(context.Background(), nachher)
	a.srv.tageszusammenfassung(context.Background(), nachher.Add(time.Hour))
	m := a.posts("/hoch")
	if len(m) != 1 || !strings.Contains(m[0], "Deals des Tages") || !strings.Contains(m[0], "1. Makita — 9,44 € Gewinn je Stück (OTTO, 130,56 €)") {
		t.Fatalf("Zusammenfassung = %v", m)
	}
}

func TestAuswertung(t *testing.T) {
	srv, s := testServer(t)
	jetzt := time.Now()
	for _, p := range []store.MonitorPost{
		{Shop: "OTTO", Kategorie: "Konsolen", Gewinn: 5000, Kaeufe: 3, GepostetAm: jetzt.Add(-time.Hour)},
		{Shop: "OTTO", Kategorie: "Konsolen", Gewinn: 2000, Kaeufe: 1, GepostetAm: jetzt.Add(-2 * time.Hour)},
		{Shop: "MediaMarkt (via mydealz)", Kategorie: "", Gewinn: 1000, GepostetAm: jetzt.Add(-3 * time.Hour)},
		{Shop: "Alt", Gewinn: 99999, GepostetAm: jetzt.AddDate(0, 0, -40)},
	} {
		_ = s.MonitorPostMerken(p)
	}
	// Die ✅ kommen später über den Abgleich.
	ps, _ := s.MonitorPostsSeit(jetzt.AddDate(0, 0, -1))
	for _, p := range ps {
		if p.Gewinn == 5000 {
			_ = s.MonitorPostKaeufe(p.ID, 3)
		}
		if p.Gewinn == 2000 {
			_ = s.MonitorPostKaeufe(p.ID, 1)
		}
	}
	a := srv.auswertung(jetzt, 30)
	if a.Deals != 3 || a.Kaeufe != 4 || a.GewinnText != "80,00 €" {
		t.Errorf("Summe = %+v", a)
	}
	if len(a.NachShop) != 2 || a.NachShop[0].Name != "OTTO" || a.NachShop[0].Quote != "200 %" || a.NachShop[1].Name != "MediaMarkt" {
		t.Errorf("Shops = %+v", a.NachShop)
	}
	w := hole(t, srv, http.MethodGet, "/monitor", "")
	if !strings.Contains(w.Body.String(), "Auswertung der letzten 30 Tage") || !strings.Contains(w.Body.String(), "<td>Konsolen</td>") {
		t.Error("Auswertung fehlt auf der Seite")
	}
}

func TestEbaySchluesselBleibtGeheim(t *testing.T) {
	srv, s := testServer(t)
	_ = s.SetzeEinstellung(store.SchluesselEbayCertID, "geheim123")
	hole(t, srv, http.MethodPost, "/monitor/einstellungen", url.Values{
		"intervall": {"60"}, "sperre": {"60"}, "max_tage": {"7"}, "ebay_app_id": {"neu"}, "ebay_cert_id": {""},
	}.Encode())
	if s.Einstellung(store.SchluesselEbayCertID) != "geheim123" || s.Einstellung(store.SchluesselEbayAppID) != "neu" {
		t.Error("leeres Geheimnisfeld hat den Schlüssel überschrieben")
	}
	if strings.Contains(hole(t, srv, http.MethodGet, "/monitor", "").Body.String(), "geheim123") {
		t.Error("Cert ID steht auf der Seite")
	}
}

var _ = billiger.Angebot{}
