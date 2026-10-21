package web

import (
	"context"
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

// billigerSeite ist eine Preisliste im Format von billiger.de mit drei
// Angeboten: ebay (lieferbar, am günstigsten), Kaufland (lange Lieferzeit)
// und OTTO (lieferbar).
const billigerSeite = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Makita HR2630","gtin13":"0088381088543"}</script>
</head><body>
<div class="p-4" data-offer-row data-offer-id="1" data-shop-id="1"><div class="order-1 w-full" title="Makita">Makita</div>
<img alt="Shop ebay.de" src="x.png"><span class="text-2xl" data-price >99,00 €*</span><span class="block">ab 0,00 € Versand</span>
<span class="block font-bold"> 99,00 € Gesamt </span>
<i style="--icon:url(/static/img/icons/availability.svg)" class=" text-green-500 mask-center"></i> Lieferzeit: 1-3 Werktage</div>
<div class="p-4" data-offer-row data-offer-id="2" data-shop-id="2"><div class="order-1 w-full" title="Makita">Makita</div>
<img alt="Shop Kaufland.de" src="x.png"><span class="text-2xl" data-price >110,00 €*</span><span class="block">ab 0,00 € Versand</span>
<span class="block font-bold"> 110,00 € Gesamt </span>
<i style="--icon:url(/static/img/icons/availability.svg)" class=" text-amber-400 mask-center"></i> Lieferzeit: 5-7 Werktage</div>
<div class="p-4" data-offer-row data-offer-id="3" data-shop-id="3"><div class="order-1 w-full" title="Makita">Makita</div>
<img alt="Shop OTTO" src="x.png"><span class="text-2xl" data-price >125,57 €*</span><span class="block">ab 4,99 € Versand</span>
<span class="block font-bold"> 130,56 € Gesamt </span>
<i style="--icon:url(/static/img/icons/availability.svg)" class=" text-green-500 mask-center"></i> Lieferzeit: lieferbar - in 2-3 Werktagen bei dir</div>
</body></html>`

// zumTestserver leitet jede Anfrage an einen Testserver um.
type zumTestserver struct{ ziel *url.URL }

func (z zumTestserver) RoundTrip(r *http.Request) (*http.Response, error) {
	r2 := r.Clone(r.Context())
	r2.URL.Scheme, r2.URL.Host, r2.Host = z.ziel.Scheme, z.ziel.Host, z.ziel.Host
	return http.DefaultTransport.RoundTrip(r2)
}

type monitorAufbau struct {
	srv       *Server
	s         *store.Store
	produktID int64
	hoch      int64
	normal    int64

	mu        sync.Mutex
	gesendet  map[string][]string
	keepaCode []string
}

func (a *monitorAufbau) posts(kanal string) []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.gesendet[kanal]...)
}

func neuerMonitorAufbau(t *testing.T, shops string) *monitorAufbau {
	t.Helper()
	srv, s := testServer(t)
	a := &monitorAufbau{srv: srv, s: s, gesendet: map[string][]string{}}

	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatal(err)
	}
	kp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/graphimage") {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nTESTBILD"))
			return
		}
		// Mitschreiben, ob Keepa nach der EAN gefragt wurde.
		if c := r.URL.Query().Get("code"); c != "" {
			a.mu.Lock()
			a.keepaCode = append(a.keepaCode, c)
			a.mu.Unlock()
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(roh)
	}))
	t.Cleanup(kp.Close)
	srv.keepa.BasisURL = kp.URL
	srv.keepa.Key = "test"

	bs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(billigerSeite))
	}))
	t.Cleanup(bs.Close)
	ziel, _ := url.Parse(bs.URL)
	srv.monitorHTTP = &http.Client{Transport: zumTestserver{ziel}}

	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roh, _ := readAll(r)
		a.mu.Lock()
		a.gesendet[r.URL.Path] = append(a.gesendet[r.URL.Path], roh)
		a.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"777","channel_id":"42"}`))
	}))
	t.Cleanup(dc.Close)

	a.hoch, _ = s.ChannelAnlegen(store.Channel{Name: "high-margin", WebhookURL: dc.URL + "/hoch"})
	a.normal, _ = s.ChannelAnlegen(store.Channel{Name: "shop-deals", WebhookURL: dc.URL + "/normal"})

	a.produktID, err = s.MonitorProduktAnlegen(store.MonitorProdukt{
		URL: "https://www.billiger.de/pricelist/123-makita", Maerkte: "DE", Shops: shops, Aktiv: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func (a *monitorAufbau) produkt(t *testing.T) store.MonitorProdukt {
	t.Helper()
	p, err := a.s.MonitorProdukt(a.produktID)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMonitorPostetNachRegeln(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO, Kaufland")
	// Eine Regel, die der Deal nicht erfüllt, und eine, die er erfüllt.
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.hoch, MinMarge: 50, Aktiv: true})
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, MinMarge: 5, Aktiv: true})

	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	// Kaufland liefert erst in einer Woche, ebay steht nicht in der
	// Shopliste: übrig bleibt OTTO mit Versand.
	if b.Angebot == nil || b.Angebot.Shop != "OTTO" || b.Angebot.Gesamt != 13056 {
		t.Fatalf("Angebot = %+v", b.Angebot)
	}
	if len(a.posts("/hoch")) != 0 {
		t.Error("in den High-Margin-Channel gepostet, obwohl die Marge nicht reicht")
	}
	posts := a.posts("/normal")
	if len(posts) != 1 {
		t.Fatalf("%d Posts im Channel shop-deals, will 1", len(posts))
	}
	if !strings.Contains(posts[0], "bei OTTO") || !strings.Contains(posts[0], "billiger.de") {
		t.Errorf("Post nennt Shop oder Quelle nicht: %s", posts[0])
	}
	if len(a.keepaCode) == 0 || a.keepaCode[0] != "0088381088543" {
		t.Errorf("Keepa nicht über die EAN gefragt: %v", a.keepaCode)
	}

	p := a.produkt(t)
	if p.ASIN != "B01636IZ0G" || p.EAN != "0088381088543" || p.Name != "Makita HR2630" {
		t.Errorf("Produkt nicht ergänzt: %+v", p)
	}

	// Genau derselbe Post wie von Hand: in der Historie, mit dem
	// Einkaufspreis inklusive Versand.
	ds, _ := a.s.Deals(store.DealFilter{Limit: 10})
	if len(ds) != 1 || ds[0].EKCent != 13056 || ds[0].ChannelName != "shop-deals" || ds[0].DiscordNachrichtID != "777" {
		t.Fatalf("Historie = %+v", ds)
	}
	if ds[0].GewinnCent != b.Gewinn || b.Gewinn <= 0 {
		t.Errorf("Gewinn in der Historie = %d, im Monitor %d", ds[0].GewinnCent, b.Gewinn)
	}

	treffer, _ := a.s.MonitorLetzteTreffer(10)
	if len(treffer) != 1 || !treffer[0].Gepostet || treffer[0].DealID == 0 {
		t.Errorf("Protokoll = %+v", treffer)
	}

	// Gleich noch einmal: dasselbe Angebot wird nicht noch einmal bewertet
	// und nicht noch einmal gepostet.
	b = a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if b.Gepostet || !strings.HasPrefix(b.Status, "unverändert") {
		t.Errorf("zweite Prüfung: %+v", b)
	}
	if n := len(a.posts("/normal")); n != 1 {
		t.Errorf("%d Posts nach der zweiten Prüfung, will 1", n)
	}
}

func TestMonitorTestPostetNicht(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Aktiv: true})

	w := hole(t, a.srv, http.MethodPost, "/monitor/produkte/"+itoa(a.produktID)+"/testen", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status %d", w.Code)
	}
	koerper := w.Body.String()
	if !strings.Contains(koerper, "würde gepostet in #shop-deals") || !strings.Contains(koerper, "discord-beschreibung") {
		t.Errorf("Test zeigt weder Ergebnis noch Vorschau: %s", koerper)
	}
	if len(a.posts("/normal")) != 0 {
		t.Error("der Test hat gepostet")
	}
	if ds, _ := a.s.Deals(store.DealFilter{Limit: 10}); len(ds) != 0 {
		t.Error("der Test hat einen Deal gespeichert")
	}
}

func TestMonitorOhneRegelProtokolliertNur(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.hoch, MinMarge: 90, Aktiv: true})

	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if b.Gepostet || !strings.HasPrefix(b.Status, "keine Regel passt") {
		t.Fatalf("b = %+v", b)
	}
	// Ohne Shopliste zählt auch ebay — das günstigste lieferbare Angebot.
	if b.Angebot.Shop != "ebay.de" {
		t.Errorf("Shop = %q", b.Angebot.Shop)
	}
	if treffer, _ := a.s.MonitorLetzteTreffer(10); len(treffer) != 1 || treffer[0].Gepostet {
		t.Errorf("Protokoll = %+v", treffer)
	}
}

func TestMonitorHoechstpreis(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	p := a.produkt(t)
	p.MaxEK = 12000
	_ = a.s.MonitorProduktAendern(p)
	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if b.Bewertet || !strings.Contains(b.Status, "über dem Höchstpreis") {
		t.Errorf("b = %+v", b)
	}
	if len(a.keepaCode) != 0 {
		t.Error("Keepa trotz Höchstpreis gefragt")
	}
}

func TestMonitorGuenstigerPostetErneut(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Aktiv: true})
	// Ein früherer Post zu einem höheren Preis liegt in der Sperrzeit.
	_ = a.s.MonitorTrefferAnlegen(store.MonitorTreffer{ProduktID: a.produktID, Shop: "OTTO", Gesamt: 14000, Gepostet: true, Zeit: time.Now().Add(-time.Minute)})
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); !b.Gepostet {
		t.Errorf("günstiger, aber nicht gepostet: %s", b.Status)
	}

	b := neuerMonitorAufbau(t, "OTTO")
	_, _ = b.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: b.normal, Aktiv: true})
	_ = b.s.MonitorTrefferAnlegen(store.MonitorTreffer{ProduktID: b.produktID, Shop: "OTTO", Gesamt: 13000, Gepostet: true, Zeit: time.Now().Add(-time.Minute)})
	if erg := b.srv.monitorPruefe(context.Background(), b.produkt(t), false); erg.Gepostet || !strings.HasPrefix(erg.Status, "schon gepostet") {
		t.Errorf("teurer als der letzte Post, trotzdem: %s", erg.Status)
	}
}

func TestMonitorSeiteUndFormulare(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "otto-deals", WebhookURL: "https://discord.com/api/webhooks/1/x"})

	w := hole(t, srv, http.MethodPost, "/monitor/produkte", url.Values{
		"url": {"https://www.billiger.de/pricelist/4028692061-wd?uds=abc"}, "max_ek": {"399,99"},
		"shops": {"OTTO, Kaufland"}, "zielmarkt": {"DE", "FR"},
	}.Encode())
	if !strings.Contains(w.Body.String(), "Produkt angelegt") {
		t.Fatalf("Anlegen: %s", w.Body.String())
	}
	ps, _ := s.MonitorProdukte()
	if len(ps) != 1 || ps[0].URL != "https://www.billiger.de/pricelist/4028692061-wd" || ps[0].MaxEK != 39999 || ps[0].Maerkte != "DE,FR" {
		t.Fatalf("Produkt = %+v", ps)
	}

	w = hole(t, srv, http.MethodPost, "/monitor/produkte", url.Values{"url": {"https://www.otto.de/p/123"}}.Encode())
	if !strings.Contains(w.Body.String(), "billiger.de") || !strings.Contains(w.Body.String(), `class="fehler"`) {
		t.Errorf("fremder Link nicht abgelehnt")
	}

	w = hole(t, srv, http.MethodPost, "/monitor/regeln", url.Values{
		"channel_id": {itoa(cid)}, "min_marge": {"12,5 %"}, "min_gewinn": {"10"}, "min_sales": {"20"},
	}.Encode())
	if !strings.Contains(w.Body.String(), "Regel angelegt") {
		t.Fatalf("Regel: %s", w.Body.String())
	}
	rs, _ := s.MonitorRegeln()
	if len(rs) != 1 || rs[0].MinMarge != 12.5 || rs[0].MinGewinn != 1000 || rs[0].MinSales != 20 {
		t.Errorf("Regel = %+v", rs)
	}

	w = hole(t, srv, http.MethodPost, "/monitor/einstellungen", url.Values{"aktiv": {"1"}, "intervall": {"5"}, "sperre": {"60"}}.Encode())
	if !strings.Contains(w.Body.String(), "mindestens 15") {
		t.Error("zu kurzes Intervall angenommen")
	}
	w = hole(t, srv, http.MethodPost, "/monitor/einstellungen", url.Values{"aktiv": {"1"}, "intervall": {"30"}, "sperre": {"60"}}.Encode())
	if s.Einstellung(store.SchluesselMonitorAktiv) != "1" || s.Einstellung(store.SchluesselMonitorIntervall) != "30" {
		t.Error("Einstellungen nicht gespeichert")
	}

	w = hole(t, srv, http.MethodGet, "/monitor", "")
	for _, soll := range []string{"Shop-Monitor", "#otto-deals", "Marge 12,5 %", `class="aktiv">Monitor`} {
		if !strings.Contains(w.Body.String(), soll) {
			t.Errorf("Seite ohne %q", soll)
		}
	}
}

func TestMonitorAnkaufPostetOhneKeepa(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	p := a.produkt(t)
	p.Modus, p.Ankauf, p.Kategorie, p.Hinweis = store.ModusAnkauf, 14000, "Konsolen", "145 € ab 6 Stk"
	p.MaxEK = 13300
	_ = a.s.MonitorProduktAendern(p)
	// Eine Regel nur für Amazon-Deals, eine für Ankauf in der Kategorie.
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.hoch, Modus: store.ModusAmazon, Aktiv: true})
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Modus: store.ModusAnkauf, Kategorie: "konsolen", MinMarge: 5, MinSales: 999, Aktiv: true})

	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	if b.Gewinn != 944 {
		t.Errorf("Gewinn = %d, will 944 (140,00 − 130,56)", b.Gewinn)
	}
	if len(a.posts("/hoch")) != 0 {
		t.Error("Ankauf in den Amazon-Channel gepostet")
	}
	posts := a.posts("/normal")
	if len(posts) != 1 {
		t.Fatalf("%d Posts, will 1", len(posts))
	}
	for _, soll := range []string{"🤝 Ankauf: 140,00 €", "💰 EK: 130,56 € (inkl. 4,99 € Versand)", "🤑 Gewinn: 9,44 € / 6,7 % Marge", "145 € ab 6 Stk", "[OTTO](https://www.billiger.de/pricelist/123-makita)"} {
		if !strings.Contains(posts[0], soll) {
			t.Errorf("Post ohne %q: %s", soll, posts[0])
		}
	}
	if len(a.keepaCode) != 0 {
		t.Error("im Ankaufs-Modus Keepa gefragt")
	}
	if ds, _ := a.s.Deals(store.DealFilter{Limit: 10}); len(ds) != 0 {
		t.Error("Ankauf in der Amazon-Historie gelandet")
	}

	// Danach dasselbe Angebot: kein zweiter Post.
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); b.Gepostet {
		t.Error("zweimal gepostet")
	}
}

func TestMonitorAnkaufUeberPreiswecker(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Aktiv: true})
	p := a.produkt(t)
	p.Modus, p.Ankauf, p.MaxEK = store.ModusAnkauf, 13500, 12825
	_ = a.s.MonitorProduktAendern(p)
	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if b.Gepostet || !strings.Contains(b.Status, "über dem Preiswecker") {
		t.Errorf("b = %+v", b)
	}
}

func TestMonitorAnkaufFormularSetztPreiswecker(t *testing.T) {
	srv, s := testServer(t)
	w := hole(t, srv, http.MethodPost, "/monitor/produkte", url.Values{
		"url": {"https://www.billiger.de/pricelist/1-ps5-pro"}, "modus": {"ankauf"}, "ankauf": {"1175"},
		"kategorie": {"Konsolen"},
	}.Encode())
	if !strings.Contains(w.Body.String(), "Produkt angelegt") {
		t.Fatalf("%s", w.Body.String())
	}
	ps, _ := s.MonitorProdukte()
	if len(ps) != 1 || !ps[0].IstAnkauf() || ps[0].Ankauf != 117500 || ps[0].MaxEK != 111625 {
		t.Errorf("Produkt = %+v", ps)
	}
	w = hole(t, srv, http.MethodPost, "/monitor/produkte", url.Values{
		"url": {"https://www.billiger.de/pricelist/2-x"}, "modus": {"ankauf"},
	}.Encode())
	if !strings.Contains(w.Body.String(), "Ankaufspreis Pflicht") {
		t.Error("Ankauf ohne Preis angenommen")
	}
}
