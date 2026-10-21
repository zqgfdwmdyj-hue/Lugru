package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// ankaufAufbau ist ein Ankaufs-Produkt (OTTO, 130,56 € mit Versand) mit
// Ankauf 140 € und einer Regel in den Channel shop-deals.
func ankaufAufbau(t *testing.T) *monitorAufbau {
	t.Helper()
	a := neuerMonitorAufbau(t, "OTTO")
	p := a.produkt(t)
	p.Modus, p.Ankauf, p.Name = store.ModusAnkauf, 14000, "Makita"
	_ = a.s.MonitorProduktAendern(p)
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Aktiv: true})
	return a
}

func TestPrioIntervall(t *testing.T) {
	srv, s := testServer(t)
	_ = s.SetzeEinstellung(store.SchluesselMonitorHochSek, "20")
	_ = s.SetzeEinstellung(store.SchluesselMonitorNiedrigSek, "600")
	if d := srv.prioIntervall(store.MonitorProdukt{Prio: store.PrioHoch}); d != 20*time.Second {
		t.Errorf("hoch = %s", d)
	}
	if d := srv.prioIntervall(store.MonitorProdukt{Prio: store.PrioNiedrig}); d != 10*time.Minute {
		t.Errorf("niedrig = %s", d)
	}
	if d := srv.prioIntervall(store.MonitorProdukt{}); d != time.Minute {
		t.Errorf("normal = %s", d)
	}
}

func TestAnkaeuferStaffelUndWecker(t *testing.T) {
	a := ankaufAufbau(t)
	_ = a.s.AnkaeuferAnlegen(store.Ankaeufer{ProduktID: a.produktID, Name: "Zero4K", Preis: 14500, AbStueck: 1})
	_ = a.s.AnkaeuferAnlegen(store.Ankaeufer{ProduktID: a.produktID, Name: "serix", Preis: 15000, AbStueck: 4})
	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	post := a.posts("/normal")[0]
	for _, soll := range []string{"🤝 Ankauf: 145,00 €", "📦 Mengen: ab 4 Stk 150,00 €"} {
		if !strings.Contains(post, soll) {
			t.Errorf("Post ohne %q: %s", soll, post)
		}
	}
	for _, nie := range []string{"Zero4K", "serix"} {
		if strings.Contains(post, nie) {
			t.Errorf("Ankäufer %q steht im Post", nie)
		}
	}
	// Ohne eingetragenen Wecker: 95 % des besten Einzelpreises.
	p := a.produkt(t)
	a.srv.ankaufAnwenden(&p)
	if w := a.srv.wecker(p); w != 13775 {
		t.Errorf("Wecker = %d, will 13775", w)
	}
}

func TestPreisZeileUndPreissturz(t *testing.T) {
	a := ankaufAufbau(t)
	jetzt := time.Now()
	// Drei Tage lang 200 €, dann 130,56 €: ein Sturz um 35 %.
	for i := 3; i >= 1; i-- {
		_ = a.s.MonitorPreisMerken(a.produktID, 20000, "OTTO", jetzt.Add(-time.Duration(i)*24*time.Hour))
	}
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorSturzChannel, itoa(a.hoch))
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorSturzProzent, "20")

	b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	if post := a.posts("/normal")[0]; !strings.Contains(post, "📉 Tiefster Preis seit 3 Tagen") {
		t.Errorf("Post ohne Tiefstpreis: %s", post)
	}
	sturz := a.posts("/hoch")
	if len(sturz) != 1 || !strings.Contains(sturz[0], "⚠️ Preissturz: Makita") || !strings.Contains(sturz[0], "unter Ø 7 Tage") {
		t.Fatalf("Preissturz = %v", sturz)
	}
	// Derselbe Sturz kommt nicht zweimal.
	p := a.produkt(t)
	p.GeprueftAm = time.Time{}
	a.srv.monitorPruefe(context.Background(), p, false)
	if n := len(a.posts("/hoch")); n != 1 {
		t.Errorf("%d Preissturz-Meldungen, will 1", n)
	}
}

const ohneOtto = `<html><body>
<div class="p-4" data-offer-row data-offer-id="1"><img alt="Shop ebay.de" src="x.png"><span data-price >99,00 €*</span>
<span class="block font-bold"> 99,00 € Gesamt </span>
<i style="--icon:url(/static/img/icons/availability.svg)" class=" text-green-500"></i> Lieferzeit: 1-3 Werktage</div>
</body></html>`

func TestAusverkauftAnkauf(t *testing.T) {
	a := ankaufAufbau(t)
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	// OTTO führt das Angebot nicht mehr.
	a.setzeSeite("/pricelist/123-makita", ohneOtto)
	a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	edits := a.posts("/normal/messages/777")
	if len(edits) != 1 || !strings.Contains(edits[0], "AUSVERKAUFT") {
		t.Fatalf("Bearbeitung = %v", edits)
	}
	// Nur einmal.
	a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	if n := len(a.posts("/normal/messages/777")); n != 1 {
		t.Errorf("%d Bearbeitungen", n)
	}
}

func TestAusverkauftAmazonDeal(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Aktiv: true})
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	a.setzeSeite("/pricelist/123-makita", ohneOtto)
	a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	ds, _ := a.s.Deals(store.DealFilter{Limit: 5})
	if len(ds) != 1 || ds[0].Status != store.StatusAusverkauft {
		t.Errorf("Deal-Status = %+v", ds)
	}
}

func TestAdminMeldungGedrosselt(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorAdminChannel, itoa(a.hoch))
	a.setzeSeite("/pricelist/123-makita", "<html>Wartung</html>")
	a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	a.srv.monitorPruefe(context.Background(), a.produkt(t), false)
	m := a.posts("/hoch")
	if len(m) != 1 || !strings.Contains(m[0], "billiger.de") {
		t.Errorf("Admin-Meldungen = %v", m)
	}
}

const mydealzFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:pepper="http://www.pepper.com/rss"><channel>
<item><pepper:merchant name="MediaMarkt" price="119,00€"/><title><![CDATA[Makita HR2630 Bohrhammer für 119€]]></title>
<link>https://www.mydealz.de/deals/makita-1</link><pubDate>PUBDATE</pubDate></item>
<item><pepper:merchant name="Amazon" price="5€"/><title><![CDATA[Makita Bohrer-Kabel]]></title>
<link>https://www.mydealz.de/deals/kabel-2</link><pubDate>PUBDATE</pubDate></item>
</channel></rss>`

func TestMydealzPostetPassendenDeal(t *testing.T) {
	a := ankaufAufbau(t)
	p := a.produkt(t)
	p.Stichworte = "makita hr2630, -kabel"
	_ = a.s.MonitorProduktAendern(p)
	a.setzeSeite("/rss/deals", strings.ReplaceAll(mydealzFeed, "PUBDATE", time.Now().Format(time.RFC1123Z)))
	a.srv.mydealzFeed = "https://www.mydealz.de/rss/deals"

	a.srv.mydealzPruefen(context.Background(), time.Now())
	posts := a.posts("/normal")
	if len(posts) != 1 || !strings.Contains(posts[0], "MediaMarkt (via mydealz)") || !strings.Contains(posts[0], "https://www.mydealz.de/deals/makita-1") {
		t.Fatalf("Posts = %v", posts)
	}
	// Derselbe Feed noch einmal: nichts Neues.
	a.srv.mydealzPruefen(context.Background(), time.Now())
	if n := len(a.posts("/normal")); n != 1 {
		t.Errorf("%d Posts nach zweitem Lauf", n)
	}
}

func TestKategorieScanMeldetSturz(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorSturzChannel, itoa(a.hoch))
	seite := `<button data-object-id="5073354969" data-object-type="product" data-name="Sony PlayStation 5 Pro" data-price="69999" data-wishlist-button></button>
<a href="/products/5073354969-sony-playstation-5-pro-ps5-pro">x</a>`
	a.setzeSeite("/show/kategorie/14083.htm", seite)
	_ = a.s.KategorieAnlegen(store.MonitorKategorie{Name: "Konsolen", URL: "https://www.billiger.de/show/kategorie/14083.htm"})
	jetzt := time.Now()
	for i := 3; i >= 1; i-- {
		_ = a.s.KategoriePreisMerken("product:5073354969", 99999, jetzt.Add(-time.Duration(i)*24*time.Hour))
	}
	ks, _ := a.s.Kategorien()
	a.srv.kategoriePruefen(context.Background(), ks[0], jetzt)
	m := a.posts("/hoch")
	if len(m) != 1 || !strings.Contains(m[0], "Preissturz (Konsolen): Sony PlayStation 5 Pro") || !strings.Contains(m[0], "products/5073354969") {
		t.Fatalf("Meldungen = %v", m)
	}
	a.srv.kategoriePruefen(context.Background(), ks[0], jetzt.Add(time.Minute))
	if n := len(a.posts("/hoch")); n != 1 {
		t.Errorf("%d Meldungen nach zweitem Lauf", n)
	}
}

func TestImportEndeZuEnde(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	a.setzeSeite("/search", `<a href="/products/77-makita-zubehoer-kabel" title="Makita Zubehör Kabel">
<a href="/products/123-makita-hr2630" title="Makita HR2630 Bohrhammer">`)
	a.setzeSeite("/products/123-makita-hr2630", billigerSeite)

	liste := "Werkzeug\nMakita HR2630 0088381088543\t130\t140 € (Bauhaus-Kalle)\t150 € ab 5 Stk (Kalle)\n"
	w := hole(t, a.srv, http.MethodPost, "/monitor/import", url.Values{"liste": {liste}}.Encode())
	k := w.Body.String()
	if !strings.Contains(k, "Import prüfen") || !strings.Contains(k, "✓ EAN") ||
		!strings.Contains(k, `<option value="https://www.billiger.de/products/123-makita-hr2630" selected>`) {
		t.Fatalf("Prüfseite: %s", k)
	}

	// Die Felder so übernehmen, wie die Seite sie zeigt.
	werte := url.Values{
		"z0_name": {"Makita HR2630"}, "z0_url": {"https://www.billiger.de/products/123-makita-hr2630"},
		"z0_wecker": {"130,00"}, "z0_ankauf": {"140,00"}, "z0_kategorie": {"Werkzeug"}, "z0_prio": {"hoch"},
		"z0_ean": {"0088381088543"}, "z0_stichworte": {"makita hr2630"}, "z0_notiz": {"140 € (Bauhaus-Kalle)"},
		"z0_ankaeufer": {`[{"Name":"Bauhaus-Kalle","Preis":14000,"AbStueck":1},{"Name":"Kalle","Preis":15000,"AbStueck":5}]`},
	}
	w = hole(t, a.srv, http.MethodPost, "/monitor/import/uebernehmen", werte.Encode())
	if !strings.Contains(w.Body.String(), "1 Produkte angelegt") {
		t.Fatalf("Übernehmen: %s", w.Body.String())
	}
	ps, _ := a.s.MonitorProdukte()
	var neu store.MonitorProdukt
	for _, p := range ps {
		if p.URL == "https://www.billiger.de/products/123-makita-hr2630" {
			neu = p
		}
	}
	if !neu.IstAnkauf() || neu.MaxEK != 13000 || neu.Prio != store.PrioHoch || neu.Kategorie != "Werkzeug" {
		t.Errorf("Produkt = %+v", neu)
	}
	ak, _ := a.s.AnkaeuferAlle()
	if len(ak[neu.ID]) != 2 {
		t.Errorf("Ankäufer = %+v", ak[neu.ID])
	}
}

func TestDirekterShopLink(t *testing.T) {
	a := ankaufAufbau(t)
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorBasisURL, "http://91.99.29.165:8080/")
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	post := a.posts("/normal")[0]
	i := strings.Index(post, "http://91.99.29.165:8080/go/")
	if i < 0 || !strings.Contains(post, "[Preisvergleich](https://www.billiger.de/pricelist/123-makita)") {
		t.Fatalf("Post ohne Shop-Link: %s", post)
	}
	kurz := post[i+len("http://91.99.29.165:8080/go/") : i+len("http://91.99.29.165:8080/go/")+8]

	// Der Link geht auch ohne Anmeldung, und zwar zum Shop.
	h := MitPasswort(a.srv.Routen(), "", "geheim")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/go/"+kurz, nil))
	if w.Code != http.StatusFound || w.Header().Get("Location") != "https://cmodul.solutenetwork.com/cmodul?mid=otto" {
		t.Errorf("Weiterleitung: %d %q", w.Code, w.Header().Get("Location"))
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/go/unbekannt", nil))
	if w.Code != http.StatusNotFound {
		t.Errorf("unbekannter Link: %d", w.Code)
	}
}

func TestShopLinkFaelltAufBilligerZurueck(t *testing.T) {
	a := ankaufAufbau(t)
	kurz, _ := a.s.MonitorLink("KAPUTT-abcdefghijklmnopqrstuvwxyz0123456789", "https://www.billiger.de/pricelist/123-makita")
	w := hole(t, a.srv, http.MethodGet, "/go/"+kurz, "")
	if w.Code != http.StatusFound || w.Header().Get("Location") != "https://www.billiger.de/pricelist/123-makita" {
		t.Errorf("Ersatz: %d %q", w.Code, w.Header().Get("Location"))
	}
}

func TestAmazonPostMitDirektlink(t *testing.T) {
	a := neuerMonitorAufbau(t, "OTTO")
	_ = a.s.SetzeEinstellung(store.SchluesselMonitorBasisURL, "https://deals.example.de")
	_, _ = a.s.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: a.normal, Aktiv: true})
	if b := a.srv.monitorPruefe(context.Background(), a.produkt(t), false); !b.Gepostet {
		t.Fatalf("nicht gepostet: %s", b.Status)
	}
	if post := a.posts("/normal")[0]; !strings.Contains(post, "[Direkt zu OTTO](https://deals.example.de/go/") {
		t.Errorf("Amazon-Post ohne Direktlink: %s", post)
	}
}
