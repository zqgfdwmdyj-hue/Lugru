package web

import (
	"encoding/json"
	"fmt"
	"html"
	"html/template"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// keepaServer liefert die Fixture aus dem keepa-Paket aus.
func keepaServer(t *testing.T) *httptest.Server {
	t.Helper()
	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/pricehistory.png") || strings.HasSuffix(r.URL.Path, "/graphimage") {
			w.Header().Set("Content-Type", "image/png")
			w.Write([]byte("\x89PNG\r\n\x1a\nTESTBILD"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// referenzFormular sind die Werte des Makita-Deals aus der Spec.
func referenzFormular(channelID int64) url.Values {
	return url.Values{
		"einkaufslink":        {"https://www.amazon.es/dp/B01636IZ0G"},
		"asin":                {"B01636IZ0G"},
		"quellmarkt":          {"ES"},
		"quell_url":           {""},
		"zielmarkt":           {"DE"},
		"leitmarkt":           {"DE"},
		"titel":               {"Makita HR2630"},
		"vk.DE":               {"207,49"},
		"vk_quelle.DE":        {"avg90"},
		"ek":                  {"130,56"},
		"ek_art":              {"brutto"},
		"ek_notiz":            {"Brutto inkl. Versand (3er cart)"},
		"sales.DE":            {"40"},
		"sales_quelle.DE":     {"monthlySold"},
		"provision.DE":        {"15"},
		"provision_quelle.DE": {"keepa"},
		"fba.DE":              {"8,64"},
		"fba_quelle.DE":       {"keepa"},
		"ust_modus":           {"netto"},
		"channel_id":          {itoa(channelID)},
	}
}

// schritt2Werte sind die Felder, die Schritt 2 des Funnels an /deal/laden
// schickt: der Einkauf steht fest, der Zielmarktplatz ist gewählt, die
// Keepa-Werte fehlen noch. Genau das ist die Ausgangslage für Schritt 3.
func schritt2Werte() url.Values {
	return url.Values{
		"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"},
		"asin":         {"B01636IZ0G"},
		"quellmarkt":   {"ES"},
		"quell_url":    {""},
		"zielmarkt":    {"DE"},
		"leitmarkt":    {"DE"},
		"ek":           {"130,56"},
		"ek_art":       {"brutto"},
	}
}

// schritt2Kennung erkennt Schritt 2 an der id seines Formulars. Am Namen
// eines Feldes ließe sich der Schritt nicht festmachen: dieselben Namen
// stehen in jedem Schritt als verborgene Felder in der Ausgabe, dort tragen
// sie nur den Zustand weiter.
const schritt2Kennung = `<form id="deal-schritt2"`

func mitFeld(v url.Values, schluessel, wert string) url.Values {
	kopie := url.Values{}
	for k, w := range v {
		kopie[k] = append([]string(nil), w...)
	}
	kopie.Set(schluessel, wert)
	return kopie
}

// mitMarktFeld setzt ein marktabhängiges Feld ("vk" auf "DE" wird "vk.DE").
// Eigener Helfer statt mitFeld mit zusammengebautem Namen: welcher Markt
// gemeint ist, soll an der Aufrufstelle stehen und nicht in einer
// Zeichenkettenverkettung untergehen.
func mitMarktFeld(v url.Values, feld, markt, wert string) url.Values {
	return mitFeld(v, feld+"."+markt, wert)
}

func TestVorschauRechnetReferenzfall(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: "https://x/1", MentionTyp: "everyone",
	})

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	koerper := w.Body.String()
	for _, muss := range []string{"26,70", "12,9", "Makita HR2630", "B01636IZ0G", "@everyone"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Vorschau enthält %q nicht:\n%s", muss, koerper)
		}
	}
}

// Der Post nannte bisher nur den Leitmarkt (Amazon.DE). Mit zwei gewählten
// Zielmärkten muss er beide nennen, samt ihrer je eigenen Zahlen — sonst
// stünde im Discord-Post eine Zusage über Italien, die niemand gerechnet hat.
func TestVorschauNenntJedenMarkt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: "https://x/1", MentionTyp: "everyone",
	})

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	koerper := w.Body.String()

	// Geprüft wird der Post-Text selbst (vorschauMuster), nicht die ganze
	// Seite: Schritt 4 rendert daneben die Marktvergleichstabelle (ein <th>
	// je Markt, "Amazon.IT" eingeschlossen) und spiegelt jedes Formularfeld
	// als verborgenes Element ("189,00" steht dort schon als
	// value="vk.IT"). Gegen den ganzen Körper zu prüfen bliebe also grün,
	// selbst wenn baueDeal nur noch den Leitmarkt in daten.Maerkte aufnähme —
	// genau die Lücke, die TestSchritt4TraegtJedenMarktMitSeinenEigenenZahlen
	// mit demselben Muster schon für die verborgenen Zahlenfelder schließt.
	posttext := vorschauMuster.FindString(koerper)
	if posttext == "" {
		t.Fatalf("keine Vorschau im Körper:\n%s", koerper)
	}
	for _, muss := range []string{"Amazon.DE", "Amazon.IT", "26,70", "189,00"} {
		if !strings.Contains(posttext, muss) {
			t.Errorf("Post-Text enthält %q nicht:\n%s", muss, posttext)
		}
	}
}

// baueDeal prüft die Verkaufszahl jetzt für jeden Markt, nicht mehr nur für
// den Leitmarkt — das ist der wichtigste Punkt dieser Aufgabe: ohne die
// Prüfung stünde bei einer kaputten Zahl in einem Nicht-Leitmarkt eine
// erfundene "0 Verkäufe" im veröffentlichten Post, über einen Markt, den
// niemand nachgerechnet hat. Der Markt steht darum vorn im Fehler, wie beim
// Verkaufspreis in TestBerechnungNenntDenMarktImFehler.
func TestVorschauVerweigertUnlesbareVerkaeufeAuchImNichtLeitmarkt(t *testing.T) {
	srv, _ := testServer(t)

	v := zweiMaerkte()
	v.Set("sales.IT", "keine Zahl")

	koerper := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode()).Body.String()

	// "IT" allein im ganzen Körper wäre bereits durch das gespiegelte
	// verborgene Feld name="zielmarkt" value="IT" erfüllt (siehe
	// verborgen-maerkte in deal.html) — das bewiese nicht, dass der
	// Fehlertext selbst den Markt nennt. Geprüft wird darum der
	// Fehlerkasten für sich, und zwar auf den vollen Marktnamen
	// "Amazon.IT", nicht nur das Kürzel.
	fehlerbox := fehlerMuster.FindString(koerper)
	if fehlerbox == "" {
		t.Fatalf("kein Fehlerkasten in der Antwort:\n%s", koerper)
	}
	if !strings.Contains(fehlerbox, "Amazon.IT") || !strings.Contains(fehlerbox, "Verkäufe") {
		t.Errorf("Fehlerkasten nennt Markt und Größe nicht:\n%s", fehlerbox)
	}
	if strings.Contains(koerper, "0 Verkäufe") {
		t.Errorf("eine unlesbare Verkaufszahl wurde stillschweigend zu 0 — das wäre eine erfundene Aussage im Post:\n%s", koerper)
	}
}

// alteVorlage ist StandardVorlage, wie sie vor der Mehrmarkt-Änderung
// aussah — Wortlaut aus internal/post/render_test.go (dort als alteVorlage
// dokumentiert). Genau diese Zeichenkette liegt in der Datenbank jedes
// Nutzers, der die Vorlage einmal gespeichert hat.
const alteVorlage = "🛒 {{.Titel}} {{.ASIN}} {{.Mention}}\n" +
	"🏬 [{{.EKHost}}]({{.EKUrl}})\n" +
	"💰 EK: {{.EK}} {{.EKNotiz}}\n" +
	"💸 VK: {{.VK}}  [Amazon.{{.Zielmarkt}}]({{.VKUrl}})\n" +
	"ℹ️ Amazon.{{.Zielmarkt}}: {{.Sales}} Verkäufe\n" +
	"🤑 Gewinn: {{.Gewinn}} / {{.Marge}} Marge\n" +
	"{{if .GewinnPanEU}}🇪🇺 mit Pan-EU: {{.GewinnPanEU}} / {{.MargePanEU}} Marge\n{{end}}" +
	":bar_chart: [ArbitrageOne Export]({{.AOUrl}})"

// baueDeal füllt neben daten.Maerkte auch die alten, flachen Felder von
// post.Daten (Zielmarkt, VK, VKUrl, Sales, Gewinn, Marge, MargeGerundet,
// GewinnPanEU, MargePanEU) mit den Zahlen des Leitmarkts — einzig dafür,
// damit eine gespeicherte, ältere Vorlage weiter rendert (post.Render läuft
// mit missingkey=error, siehe dort). Ohne diese Felder bräche der Post für
// jeden ab, der die alte Vorlage übernommen hat.
//
// Anders als TestAlteVorlageRendertWeiterUndZeigtDenLeitmarkt im
// post-Paket baut dieser Test post.Daten nicht von Hand: der handgebaute
// Weg prüft nur Render, nicht baueDeal — und genau baueDeal ist die
// Stelle, die die flachen Felder heute füllt. Geprüft wird darum ein
// echter Zwei-Markt-Deal durch den echten /deal/vorschau-Handler, mit der
// alten Vorlage als gespeicherter Einstellung.
func TestAlteGespeicherteVorlageZeigtWeiterhinDenLeitmarkt(t *testing.T) {
	srv, s := testServer(t)
	if err := s.SetzeEinstellung(store.SchluesselVorlage, alteVorlage); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}

	koerper := hole(t, srv, http.MethodPost, "/deal/vorschau", zweiMaerkte().Encode()).Body.String()

	posttext := vorschauMuster.FindString(koerper)
	if posttext == "" {
		t.Fatalf("keine Vorschau im Körper — eine gespeicherte alte Vorlage würde ohne die flachen Leitmarktfelder gar nicht mehr rendern (missingkey=error):\n%s", koerper)
	}
	// "40 Verkäufe" statt bloß "40": eine nackte "40" stünde auch im
	// AOUrl-Parameter estimated_sales=40, der unabhängig von den flachen
	// Feldern aus leit.Sales gebaut wird (siehe AOParameter.Sales in
	// baueDeal) — ein Treffer dort allein bewiese also nicht, dass
	// daten.Sales selbst gefüllt ist.
	for _, muss := range []string{"207,49", "40 Verkäufe", "26,70"} {
		if !strings.Contains(posttext, muss) {
			t.Errorf("die alte Vorlage zeigt den Leitmarkt nicht mehr vollständig — %q fehlt:\n%s", muss, posttext)
		}
	}
	// Und den zweiten Markt dazu: post.Render hängt ihn an, weil die alte
	// Vorlage .Maerkte nicht kennt. Vorher fehlte er im Discord-Post ganz,
	// obwohl er gewählt und in Schritt 3 gerechnet war.
	for _, muss := range []string{"Amazon.IT", "189,00"} {
		if !strings.Contains(posttext, muss) {
			t.Errorf("die alte Vorlage verschweigt den zweiten Markt — %q fehlt:\n%s", muss, posttext)
		}
	}
}

// Der Brutto-Modus ist entfallen (Reverse Charge, siehe formularLesen). Der
// Test prüft jetzt die Gegenrichtung: ein von Hand mitgeschicktes
// ust_modus=brutto darf die Rechnung nicht mehr verändern. Früher wurden
// daraus 4,04 € Gewinn statt der 26,70 € des Referenzfalls.
func TestMitgeschicktesUStModusWirdIgnoriert(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	f := referenzFormular(cid)
	f.Set("ust_modus", "brutto")

	koerper := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	if strings.Contains(koerper, "4,04") {
		t.Errorf("ust_modus=brutto wirkt weiterhin auf die Rechnung:\n%s", koerper)
	}
	if !strings.Contains(koerper, "26,70") {
		t.Errorf("der Referenzgewinn 26,70 € fehlt:\n%s", koerper)
	}
}

func TestLadenFuelltFormular(t *testing.T) {
	srv, s := testServer(t)
	// holeProdukt lehnt jeden Keepa-Aufruf ohne hinterlegten Key ab (siehe
	// dortiger Kommentar) — testServer liefert einen Client mit leerem Key,
	// darum muss der Test selbst einen setzen, sonst bricht er ab, bevor er
	// die Fixture überhaupt erreicht.
	srv.keepa.Key = "testkey"
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	koerper := w.Body.String()
	for _, muss := range []string{
		"B01636IZ0G",
		"Makita", // Titel aus Keepa
		"207,49", // avg90 Buy Box
		"40",     // monthlySold
		"15",     // Provision aus Keepa
		"8,64",   // FBA aus Keepa
	} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Formular enthält %q nicht:\n%s", muss, koerper)
		}
	}
	if !strings.Contains(koerper, "ES") {
		t.Error("der aus der URL erkannte Quellmarkt ES fehlt")
	}
}

func TestLadenZeigtHerkunftDerWerte(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden",
		schritt2Werte().Encode())

	// SalesHinweis attribuiert monthlySold ausdrücklich als "Keepa · ..." —
	// das ist die Herkunftsangabe, um die es hier geht. (Ohne den Key-Fix
	// oben bestand die Gefahr, dass dieser Test nur zufällig grün war, weil
	// bereits die Fehlermeldung "Kein Keepa-API-Key hinterlegt" das Wort
	// "Keepa" enthält, ohne dass je echte Herkunftsdaten geladen wurden.)
	if !strings.Contains(w.Body.String(), "Keepa · monthlySold") {
		t.Errorf("die Herkunftsangabe „Keepa · monthlySold\" fehlt — geschätzte und gemessene Werte müssen unterscheidbar sein:\n%s", w.Body.String())
	}
}

func TestSchritt1MitUnbekannterEingabe(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodPost, "/deal/preis", url.Values{"einkaufslink": {"kein link"}}.Encode())
	koerper := strings.ToLower(w.Body.String())
	if !strings.Contains(koerper, "asin") {
		t.Errorf("Fehlermeldung nennt die ASIN nicht:\n%s", w.Body.String())
	}
	if !strings.Contains(koerper, `name="einkaufslink"`) {
		t.Errorf("nach einer unlesbaren Eingabe fehlt das Eingabefeld — es gäbe keinen Weg zurück:\n%s", w.Body.String())
	}
}

func TestSendenSpeichertNurBeiErfolg(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	// Webhook antwortet mit 404 — der Deal darf nicht in der Historie landen.
	tot := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer tot.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "kaputt", WebhookURL: tot.URL})

	hole(t, srv, http.MethodPost, "/deal/senden", referenzFormular(cid).Encode())

	n, err := s.DealsAnzahl(store.DealFilter{})
	if err != nil {
		t.Fatalf("DealsAnzahl: %v", err)
	}
	if n != 0 {
		t.Errorf("%d Deals gespeichert, will 0 — ein fehlgeschlagener Post darf nicht als gepostet gelten", n)
	}

	c, _ := s.Channel(cid)
	if !c.Defekt {
		t.Error("der Channel wurde nach 404 nicht als defekt markiert")
	}
}

func TestSendenSpeichertBeiErfolg(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	var gesendet string
	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roh, _ := readAll(r)
		gesendet = roh
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"555"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: dc.URL, MentionTyp: "everyone",
	})

	w := hole(t, srv, http.MethodPost, "/deal/senden", referenzFormular(cid).Encode())
	if w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	ds, err := s.Deals(store.DealFilter{Limit: 10})
	if err != nil {
		t.Fatalf("Deals: %v", err)
	}
	if len(ds) != 1 {
		t.Fatalf("%d Deals, will 1", len(ds))
	}

	d := ds[0]
	if d.GewinnCent != 2670 {
		t.Errorf("GewinnCent = %d, will 2670", d.GewinnCent)
	}
	if d.ChannelName != "deals-vip" {
		t.Errorf("ChannelName = %q", d.ChannelName)
	}
	if d.DiscordNachrichtID != "555" {
		t.Errorf("DiscordNachrichtID = %q, will 555", d.DiscordNachrichtID)
	}
	if d.ChartDatei == "" {
		t.Error("ChartDatei ist leer — der Chart wurde nicht archiviert")
	}
	if _, err := s.ChartLesen(d.ChartDatei); err != nil {
		t.Errorf("Chart nicht lesbar: %v", err)
	}
	if !strings.Contains(gesendet, "TESTBILD") {
		t.Error("das Chart-PNG wurde nicht mitgesendet")
	}
}

// Der Ein-Markt-Fall (referenzFormular, nur DE) ist der in der Praxis
// häufigste und zugleich die Messlatte der Spec — und TestPostenSpeichertJedenMarkt
// sowie TestPostenSpeichertQuellenUndPanEUJeMarkt prüfen beide nur über
// zweiMaerkte(). Ohne diesen Test bliebe eine Regression unentdeckt, die
// sendeDeal bei genau einem gewählten Markt gar keine Marktzeile mehr
// schreiben ließe — die ganze Suite bliebe grün, weil kein anderer Test den
// Ein-Markt-Pfad je über die Datenbank prüft.
func TestPostenSpeichertGenauEinenMarktBeiEinemZielmarkt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: discordAttrappe(t).URL})

	f := referenzFormular(cid)
	f.Set("ohne_chart", "1")

	w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	deals, err := s.Deals(store.DealFilter{})
	if err != nil || len(deals) != 1 {
		t.Fatalf("Deals = %v, %v — will genau einen", deals, err)
	}

	maerkte, err := s.DealMaerkte([]int64{deals[0].ID})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	zeilen := maerkte[deals[0].ID]
	if len(zeilen) != 1 {
		t.Fatalf("%d Marktzeilen, will genau 1", len(zeilen))
	}

	m := zeilen[0]
	if m.Markt != "DE" {
		t.Errorf("Markt = %q, will DE", m.Markt)
	}
	if !m.Leitmarkt {
		t.Error("Leitmarkt = false, will true — bei einem Markt ist er zwangsläufig der Leitmarkt")
	}
	if m.GewinnCent != 2670 {
		t.Errorf("GewinnCent = %d, will 2670 (Referenzgewinn 26,70 €)", m.GewinnCent)
	}
}

// Ein Post nennt zwei Zielmärkte (zweiMaerkte). Die Historie muss trotzdem
// bei einer einzigen Deal-Zeile und einem einzigen Chart bleiben — sie
// gehören dem Leitmarkt — und daneben für jeden gewählten Markt eine eigene
// Zeile in deal_maerkte anlegen. Ohne das säße nach dieser Aufgabe immer noch
// nur der Leitmarkt in der Datenbank, obwohl der Post längst mehrere Märkte
// nennt.
func TestPostenSpeichertJedenMarkt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: discordAttrappe(t).URL})

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))
	v.Set("ohne_chart", "1")

	w := hole(t, srv, http.MethodPost, "/deal/senden", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	deals, err := s.Deals(store.DealFilter{})
	if err != nil || len(deals) != 1 {
		t.Fatalf("Deals = %v, %v — will genau einen", deals, err)
	}
	// Ein Post, eine Zeile: der Nachrichtentext steht einmal in der
	// Datenbank, nicht je Markt erneut.
	if deals[0].Zielmarkt != "DE" {
		t.Errorf("Zielmarkt = %q, will den Leitmarkt DE", deals[0].Zielmarkt)
	}

	maerkte, err := s.DealMaerkte([]int64{deals[0].ID})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	if len(maerkte[deals[0].ID]) != 2 {
		t.Fatalf("%d Marktzeilen, will 2", len(maerkte[deals[0].ID]))
	}
}

// Zwei Fallstricke, die TestPostenSpeichertJedenMarkt allein nicht sieht,
// weil er nur die Anzahl der Marktzeilen prüft:
//
//   - die Quellen (VKQuelle, SalesQuelle, ...) stehen im Formular, nicht im
//     Ergebnis — erg.Maerkte kennt sie gar nicht. Ein Zugriff, der sie dort
//     trotzdem sucht, ließe die Spalten leer statt sie über
//     d.Formular.Markt(...) nachzuschlagen.
//   - der Pan-EU-Zeiger darf nur gesetzt werden, wo es den Vergleich gibt.
//     DE ist hier das Lagerland — dort gibt es keinen zweiten Versandweg —,
//     IT hat Maße und liegt im Ausland und bekommt darum einen.
//
// Ohne Maße im Formular hätte auch IT keinen Pan-EU-Vergleich (siehe
// TestKeinPanEUVergleichOhneMasse) — die Maße werden hier eigens gesetzt,
// damit der Vergleich überhaupt entsteht und sich prüfen lässt.
func TestPostenSpeichertQuellenUndPanEUJeMarkt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: discordAttrappe(t).URL})

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))
	v.Set("ohne_chart", "1")
	// 6 kg im Standardpaket ≤ 8,9 kg (siehe TestPanEUVergleichBeiZielImAusland) —
	// damit bekommt IT (Ausland, kein Lagerland) einen Pan-EU-Vergleich.
	v.Set("masse_l", "300")
	v.Set("masse_b", "200")
	v.Set("masse_h", "250")
	v.Set("masse_g", "6000")

	w := hole(t, srv, http.MethodPost, "/deal/senden", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	deals, err := s.Deals(store.DealFilter{})
	if err != nil || len(deals) != 1 {
		t.Fatalf("Deals = %v, %v — will genau einen", deals, err)
	}
	maerkte, err := s.DealMaerkte([]int64{deals[0].ID})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	zeilen := maerkte[deals[0].ID]
	if len(zeilen) != 2 {
		t.Fatalf("%d Marktzeilen, will 2", len(zeilen))
	}

	var de, it *store.DealMarkt
	for i := range zeilen {
		switch zeilen[i].Markt {
		case "DE":
			de = &zeilen[i]
		case "IT":
			it = &zeilen[i]
		}
	}
	if de == nil || it == nil {
		t.Fatalf("DE oder IT fehlt unter den Marktzeilen: %+v", zeilen)
	}

	// Die Quellen kommen aus dem Formular (siehe zweiMaerkte), nicht aus dem
	// Ergebnis — dort gibt es sie nicht.
	if it.VKQuelle != "avg90" {
		t.Errorf("IT VKQuelle = %q, will %q", it.VKQuelle, "avg90")
	}
	if it.SalesQuelle != "monthlySold" {
		t.Errorf("IT SalesQuelle = %q, will %q", it.SalesQuelle, "monthlySold")
	}
	if it.ProvisionQuelle != "keepa" {
		t.Errorf("IT ProvisionQuelle = %q, will %q", it.ProvisionQuelle, "keepa")
	}
	if it.FBAQuelle != "EFN-Tarif · Standardpaket" {
		t.Errorf("IT FBAQuelle = %q, will %q", it.FBAQuelle, "EFN-Tarif · Standardpaket")
	}

	// DE ist das Lagerland: kein zweiter Versandweg, also kein Vergleich.
	// Eine 0 stünde dort als Aussage da, die niemand gerechnet hat.
	if de.PanEU != nil {
		t.Errorf("DE.PanEU = %+v, will nil (Lagerland)", de.PanEU)
	}
	// IT liegt im Ausland und hat Maße: der Vergleich existiert und trägt
	// den lokalen Tarif der Klasse "Standardpaket ≤ 8,9 kg" (541 Cent für IT).
	if it.PanEU == nil {
		t.Fatal("IT.PanEU = nil, will einen Pan-EU-Vergleich")
	}
	if it.PanEU.FBACent != 541 {
		t.Errorf("IT.PanEU.FBACent = %d, will 541", it.PanEU.FBACent)
	}
}

func TestSendenOhneChannelAbgelehnt(t *testing.T) {
	srv, s := testServer(t)

	f := referenzFormular(0)
	f.Set("channel_id", "0")
	hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())

	if n, _ := s.DealsAnzahl(store.DealFilter{}); n != 0 {
		t.Error("Deal ohne Channel wurde gespeichert")
	}
}

func TestVorschauUndSendenErzeugenDenselbenText(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: dc.URL, MentionTyp: "everyone"})
	f := referenzFormular(cid)

	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())

	ds, _ := s.Deals(store.DealFilter{Limit: 1})
	if len(ds) != 1 {
		t.Fatal("kein Deal gespeichert")
	}
	// Der gepostete Text muss Zeile für Zeile in der Vorschau gestanden
	// haben. Verglichen wird der sichtbare Text, nicht das Markup: die
	// Vorschau setzt Markdown-Links als <a> und Discords Kurzformen als
	// Emoji, und ein Vergleich gegen das rohe HTML prüfte die Darstellung
	// statt des Inhalts.
	sichtbar := nurText(vorschauMuster.FindString(vorschau))
	for _, zeile := range strings.Split(ds[0].NachrichtText, "\n") {
		if zeile == "" {
			continue
		}
		zeile = emojiKurzformen.Replace(mdLinkMuster.ReplaceAllString(zeile, "$1"))
		if !strings.Contains(sichtbar, zeile) {
			t.Errorf("Zeile stand nicht in der Vorschau: %q\n%s", zeile, sichtbar)
		}
	}
}

func readAll(r *http.Request) (string, error) {
	b, err := io.ReadAll(r.Body)
	return string(b), err
}

func htmlEscape(s string) string { return template.HTMLEscapeString(s) }

// Die folgenden Tests gehen über den Task-Brief hinaus (siehe Bericht). Sie
// sichern vier Punkte ab, die eine Review vor diesem Task ausdrücklich für
// diese Seite verlangt hat und die von den Brief-Tests oben nicht geprüft
// werden.

// TestBaueDealLehntUngueltigeVerkaeufeAb sichert, dass eine nicht lesbare
// Verkaufszahl denselben Weg geht wie ein nicht lesbarer Einkaufspreis oder
// eine nicht lesbare Provision: ein Fehler, keine stillschweigende 0. Ohne
// das würde "ℹ️ Amazon.DE: 0 Verkäufe" veröffentlicht, obwohl niemand diese
// Zahl je gemessen oder eingegeben hat.
func TestBaueDealLehntUngueltigeVerkaeufeAb(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	f := referenzFormular(cid)
	f.Set("sales.DE", "ganzviele")

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode())
	koerper := w.Body.String()
	if !strings.Contains(strings.ToLower(koerper), "verkäufe") {
		t.Errorf("Fehlermeldung nennt die ungültigen Verkäufe nicht:\n%s", koerper)
	}
	if strings.Contains(koerper, "0 Verkäufe") {
		t.Error("eine ungültige Verkaufszahl wurde still zu 0 — das darf nie veröffentlicht werden")
	}
}

// TestLadenBeiUnbekannterKeepaWartezeitNieNull deckt keepa.ErrTokensErschoepft
// mit Bekannt=false ab: RefillIn ist dann der Nullwert 0, der aber niemals
// als "0s" ausgegeben werden darf — das läse sich wie eine Einladung zum
// sofortigen Retry, obwohl Keepa schlicht keine verwertbare Wartezeit
// genannt hat (z. B. weil eine WAF vor Keepa eine eigene Fehlerseite ohne
// JSON ausliefert).
func TestLadenBeiUnbekannterKeepaWartezeitNieNull(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "x" // ein Key muss hinterlegt sein, sonst greift der Kontingent-Check gar nicht erst
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte("<html>502 Bad Gateway</html>")) // kein JSON, kein refillIn -> Bekannt=false
	}))
	defer ks.Close()
	srv.keepa.BasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden",
		schritt2Werte().Encode())

	koerper := w.Body.String()
	if strings.Contains(koerper, "0s") {
		t.Errorf("unbekannte Wartezeit wird als 0s angezeigt — das lädt zum sofortigen Retry ein:\n%s", koerper)
	}
	if !strings.Contains(strings.ToLower(koerper), "unbekannt") {
		t.Errorf("die Meldung nennt die unbekannte Wartezeit nicht als unbekannt:\n%s", koerper)
	}
}

// keepaServerMitAbweichenderProvision liefert dieselbe Fixture wie
// keepaServer, aber mit einer Provision, die vom konfigurierten Standardwert
// (15 %, siehe store.vorgaben) abweicht. Nur mit einem abweichenden Wert
// lässt sich beweisen, dass baueDeal wirklich die aus Keepa gelesene
// Provision verwendet: mit der unveränderten Fixture (zufällig ebenfalls
// 15 %) wäre ein stiller Rückfall auf den Standardwert unsichtbar, weil
// beide Werte übereinstimmen.
func keepaServerMitAbweichenderProvision(t *testing.T, provision float64) *httptest.Server {
	t.Helper()
	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	angepasst := strings.Replace(string(roh), `"referralFeePercentage": 15.0,`,
		fmt.Sprintf(`"referralFeePercentage": %v,`, provision), 1)
	if angepasst == string(roh) {
		t.Fatal("referralFeePercentage nicht in der Fixture gefunden — der Test misst nichts")
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(angepasst))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// TestProvisionAusKeepaErreichtDieRechnung ist der in der Aufgabe verlangte
// Beweis, dass keepa.Product.ProvisionProzent tatsächlich bei calc ankommt,
// statt dass der konfigurierte Standardwert (zufällig ebenfalls 15 %)
// unbemerkt durchrutscht.
func TestProvisionAusKeepaErreichtDieRechnung(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServerMitAbweichenderProvision(t, 10)
	srv.keepa.BasisURL = ks.URL
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden",
		schritt2Werte().Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `value="10"`) {
		t.Fatalf("die von Keepa gelieferte Provision (10) steht nicht im Formular:\n%s", w.Body.String())
	}

	// Mit dieser Provision und ansonsten denselben Zahlen wie im Referenzfall
	// (TestVorschauRechnetReferenzfall: 26,70 € bei 15 % Provision) ergibt
	// sich zwingend ein anderer Gewinn. Zeigt die Vorschau weiterhin
	// 26,70 €, wurde die aus Keepa geladene Provision stillschweigend durch
	// den (zufällig gleich hohen) Standardwert ersetzt.
	f := referenzFormular(cid)
	f.Set("provision.DE", "10")
	f.Set("provision_quelle.DE", "keepa")

	vw := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode())
	if vw.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", vw.Code, vw.Body.String())
	}
	if strings.Contains(vw.Body.String(), "26,70") {
		t.Error("Vorschau zeigt weiterhin 26,70 € (den Gewinn bei 15 % Provision) — die Provision aus Keepa wurde ignoriert")
	}
	if !strings.Contains(vw.Body.String(), "37,07") {
		t.Errorf("Vorschau zeigt nicht den bei 10%% Provision erwarteten Gewinn 37,07 €:\n%s", vw.Body.String())
	}
}

// TestLadenVerraetNieDenKeepaKey deckt für den Keepa-API-Key dieselbe
// Leck-Klasse ab, die channels_test.go bereits für die Discord-Webhook-URL
// absichert (siehe dort TestChannelTestenNetzwerkfehlerZeigtWebhookNieImKlartext):
// Client.Produkt reicht bei einem Transportfehler einen *url.Error durch,
// dessen Error()-Text die komplette angefragte URL zitiert — bei Keepa steht
// der API-Key als Query-Parameter "key=..." darin. holeProdukts default-Zweig
// wrappt diesen Fehler unverändert; ladeDeal muss ihn vor dem Rendern
// scrubben. Ziel ist ein geschlossener lokaler Port: die Verbindung wird vom
// eigenen Betriebssystem sofort mit ECONNREFUSED abgelehnt, es findet kein
// echter Netzwerkzugriff über die Loopback-Schnittstelle hinaus statt.
func TestLadenVerraetNieDenKeepaKey(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "geheimerkeepakey123"
	srv.keepa.BasisURL = "http://127.0.0.1:1"
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden",
		schritt2Werte().Encode())

	if strings.Contains(w.Body.String(), "geheimerkeepakey123") {
		t.Errorf("die Fehlermeldung verrät den Keepa-API-Key im Klartext:\n%s", w.Body.String())
	}
}

// Strukturelle Lücke, die C1 der Review offengelegt hat: Kein Test in diesem
// Paket fuhr je die gerenderte Vorlage zusammen mit htmx — jeder Test oben
// postet handgebaute url.Values direkt an einen Handler und überspringt damit
// genau die Schicht (das Template selbst), in der hx-include="closest
// .spalten form" den Posten-Knopf lahmgelegt hat. Der folgende Test schließt
// diese Lücke.

var (
	// hxIncludeMuster findet jeden hx-include-Attributwert im gerenderten HTML.
	hxIncludeMuster = regexp.MustCompile(`hx-include="([^"]*)"`)
	// idSelektorMuster erkennt einen reinen #id-Selektor. "closest .spalten
	// form", "next form" oder jeder andere DOM-relative Selektor fällt bewusst
	// durch: solche Selektoren hängen von der Verschachtelung im DOM ab, statt
	// eindeutig ein Element zu benennen — genau das hat den Bug verursacht.
	idSelektorMuster = regexp.MustCompile(`^#[A-Za-z][\w-]*$`)
	// Die beiden Formulare, an denen der Funnel hängt: das Vorschau-Formular
	// von Schritt 4, das den Deal sendet, und das Formular von Schritt 3, aus
	// dem die Aufschlüsselung live gerechnet wird. Kein HTML-Parser, wie im
	// ganzen Paket — <form> lässt sich in HTML nicht verschachteln, darum ist
	// das erste </form> nach dem Start-Tag zuverlässig das eigene.
	sendenFormularMuster = regexp.MustCompile(`(?is)<form[^>]*hx-post="/deal/senden"[^>]*>.*?</form>`)
	// Die Deal-Karte selbst, ohne die Formularfelder drumherum. Sie ist das
	// einzige <section> dieser Oberfläche und enthält selbst keines — nur
	// darum grenzt ein Muster bis zum ersten </section> sie zuverlässig ab.
	// Mit <div> ginge das nicht: die Karte hat verschachtelte Ebenen, und
	// html/template entfernt HTML-Kommentare, sodass auch ein Ende-Zeichen
	// im Markup nicht durchkäme.
	mdLinkMuster              = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	vorschauMuster            = regexp.MustCompile(`(?is)<section class="discord">.*?</section>`)
	berechnungsFormularMuster = regexp.MustCompile(`(?is)<form[^>]*hx-post="/deal/berechnung"[^>]*>.*?</form>`)
	// Der Fehlerkasten selbst, ohne die verborgenen Formularfelder drumherum
	// — dieselbe Überlegung wie bei vorschauMuster: die verborgenen Felder
	// spiegeln den gewählten Zielmarkt ("IT") ohnehin, ein Treffer irgendwo
	// im Körper bewiese also nicht, dass der Markt auch im Fehlertext selbst
	// steht.
	fehlerMuster = regexp.MustCompile(`(?is)<p class="fehler">.*?</p>`)
)

// TestPostenFormularTraegtAlleFelder schützt vor genau der Fehlerklasse, die
// den Posten-Knopf schon einmal lahmgelegt hat (deal.html trug
// hx-include="closest .spalten form"; Element.closest() startet an dem
// Element selbst, auf dem es aufgerufen wird, und das Posten-Formular ist
// selbst ein "form" innerhalb von ".spalten" — closest traf sich also immer
// selbst und lieferte ein leeres hx-include, nie das Datenformular daneben).
//
// Kein Handler-Test in diesem Paket kann diese Fehlerklasse entdecken: ein
// falscher Selektor ist syntaktisch gültiges HTML, das ParseFS anstandslos
// einliest, und für jede Prüfung, die wie die Tests oben nur nach
// Textbausteinen im gerenderten Körper sucht, ist es ein völlig
// unauffälliges Attribut — der Körper sieht in beiden Fällen identisch aus.
// Der Fehler entsteht erst zur Laufzeit im Browser, und der läuft hier
// nicht.
//
// Dieser Test braucht trotzdem keinen Browser: er liest die von den echten
// Handlern erzeugte HTML-Ausgabe und prüft ihre eigene Konsistenz als reinen
// Text. Seit dem Funnel trägt das Vorschau-Formular alle Felder selbst, ein
// hx-include ist also gar nicht mehr nötig — kommt trotzdem eines zurück,
// muss es ein reiner #id-Selektor sein und sein Ziel muss existieren.
// Geprüft wird am Ende das, worauf es ankommt: dass jedes Feld, das sendeDeal
// liest und in die Historie schreibt, den Weg zum Server auch findet.
func TestPostenFormularTraegtAlleFelder(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode()).Body.String()

	formular := sendenFormularMuster.FindString(vorschau)
	if formular == "" {
		t.Fatalf("kein Formular mit hx-post=\"/deal/senden\" in Schritt 4 gefunden:\n%s", vorschau)
	}

	quellen := formular
	for _, m := range hxIncludeMuster.FindAllStringSubmatch(formular, -1) {
		selektor := m[1]
		if !idSelektorMuster.MatchString(selektor) {
			t.Fatalf("hx-include=%q ist kein reiner #id-Selektor — DOM-relative Selektoren wie „closest ...“ hängen von der Verschachtelung ab und haben genau diesen Bug verursacht", selektor)
		}
		element, ok := elementMitID(vorschau, strings.TrimPrefix(selektor, "#"))
		if !ok {
			t.Fatalf("hx-include=%q verweist auf eine id, die in der gerenderten Ausgabe nicht vorkommt", selektor)
		}
		quellen += "\n" + element
	}

	// Alles, was sendeDeal aus dem Formular liest — die Zahlen des Deals
	// ebenso wie die Herkunftsangaben, die in der Historie stehen.
	// leitmarkt steht hier neben zielmarkt, weil beide getrennt gebraucht
	// werden: die Liste sagt, welche Märkte gewählt sind, der Leitmarkt,
	// welcher von ihnen gerechnet und gespeichert wird. Ginge er verloren,
	// rückte still der erste gewählte nach — ein anderer Deal als der
	// gezeigte.
	for _, feld := range []string{
		"asin", "quellmarkt", "quell_url", "zielmarkt", "leitmarkt", "titel",
		"ek", "ek_art", "ek_notiz",
		"vk.DE", "vk_quelle.DE", "sales.DE", "sales_quelle.DE",
		"provision.DE", "provision_quelle.DE", "fba.DE", "fba_quelle.DE", "channel_id",
	} {
		if !strings.Contains(quellen, `name="`+feld+`"`) {
			t.Errorf("das Posten-Formular sendet kein Feld name=%q — sendeDeal liest es und bekäme den leeren Wert", feld)
		}
	}
}

// TestBerechnungsFormularTraegtAlleRechenfelder ist dasselbe Argument für den
// Live-Teil von Schritt 3: die Aufschlüsselung rechnet mit dem, was das
// Formular an /deal/berechnung schickt. Fehlte dort ein verborgenes Feld —
// etwa der in Schritt 2 eingegebene Einkaufspreis —, zeigte die Seite
// stillschweigend die Rechnung eines anderen Deals, ohne dass irgendein
// Handler-Test das bemerken würde.
func TestBerechnungsFormularTraegtAlleRechenfelder(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	schritt3 := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode()).Body.String()

	formular := berechnungsFormularMuster.FindString(schritt3)
	if formular == "" {
		t.Fatalf("kein Formular mit hx-post=\"/deal/berechnung\" in Schritt 3 gefunden:\n%s", schritt3)
	}
	for _, feld := range []string{
		"asin", "quellmarkt", "zielmarkt", "leitmarkt", "ek", "ek_art",
		"vk.DE", "provision.DE", "fba.DE",
	} {
		if !strings.Contains(formular, `name="`+feld+`"`) {
			t.Errorf("das Formular von Schritt 3 sendet kein Feld name=%q — die Aufschlüsselung rechnete damit ohne diesen Wert", feld)
		}
	}
	if !strings.Contains(formular, `hx-target="#rechnung"`) {
		t.Error("das Formular von Schritt 3 tauscht nicht #rechnung aus — dann ersetzt die Antwort das Formular selbst, statt daneben mitzurechnen")
	}
}

// elementMitID sucht per einfacher String-Suche (bewusst kein HTML-Parser und
// keine zusätzliche Abhängigkeit, siehe Aufgabenbeschreibung) das Element,
// dessen öffnendes Tag id="id" trägt, und liefert dessen vollständiges HTML
// bis zum passenden schließenden Tag. Das reicht für dieses Paket, weil hier
// keine zwei Elemente mit gleichem Tag-Namen ineinander verschachtelt sind
// (insbesondere keine verschachtelten <form>-Elemente — die sind in HTML
// ohnehin ungültig).
func elementMitID(html, id string) (string, bool) {
	pos := strings.Index(html, `id="`+id+`"`)
	if pos < 0 {
		return "", false
	}
	start := strings.LastIndex(html[:pos], "<")
	if start < 0 {
		return "", false
	}

	rest := html[start+1:]
	tagEnde := strings.IndexAny(rest, " \t\n>")
	if tagEnde < 0 {
		return "", false
	}
	tag := rest[:tagEnde]

	oeffnungSchluss := strings.Index(html[pos:], ">")
	if oeffnungSchluss < 0 {
		return "", false
	}
	inhaltStart := pos + oeffnungSchluss + 1

	schlussTag := "</" + tag
	schlussPos := strings.Index(html[inhaltStart:], schlussTag)
	if schlussPos < 0 {
		// Kein eigenes Schluss-Tag (z. B. <input id="...">) — das Element ist
		// das Tag selbst.
		return html[start:inhaltStart], true
	}
	schlussStart := inhaltStart + schlussPos
	schlussEnde := strings.Index(html[schlussStart:], ">")
	if schlussEnde < 0 {
		return "", false
	}
	return html[start : schlussStart+schlussEnde+1], true
}

// Die folgenden Tests stammen aus der Abschluss-Review (2026-09-05): jeder
// deckt einen Befund ab, der von keinem der Tests oben entdeckt wurde, weil
// sie alle handgebaute Formularwerte direkt an einen Handler posten und
// damit genau die Schicht überspringen, in der diese Befunde lagen — die
// gerenderte Vorlage und ihre Verdrahtung mit htmx. Siehe die Kennungen
// (C1, I2 …) im Abschlussbericht.

// TestKeepaKeySpeichernWirktOhneNeustart deckt C1 ab: main.go las den
// Keepa-Key früher nur einmal beim Start in srv.keepa.Key ein. Ein danach in
// den Einstellungen gespeicherter Key blieb bis zum Neustart wirkungslos,
// weil holeProdukt seine Prüfung ebenfalls gegen den zu diesem Zeitpunkt
// bereits veralteten Wert führte. Dieser Test speichert den Key über den
// echten /einstellungen-Handler und lädt danach — im selben Serverprozess,
// ohne jeden Neustart — denselben Deal über eine gefälschte
// Keepa-Gegenstelle.
//
// Die Gegenstelle prüft den Query-Parameter "key" ausdrücklich und liefert
// nur bei genau dem gespeicherten Wert die Fixture, sonst HTTP 400 — wie
// die echte Keepa-API bei einem leeren oder falschen Key. Eine Fixture, die
// den Key ignoriert (wie keepaServer in den Tests oben), würde die alte,
// kaputte Zwei-Quellen-Prüfung nicht entlarven: die schaltet nach dem
// Speichern jeder beliebigen Einstellung durch, während srv.keepa.Key selbst
// leer bliebe — mit einer Fixture ohne Key-Prüfung sähe das nach Erfolg aus,
// obwohl der Key den Client nie erreicht hätte.
func TestKeepaKeySpeichernWirktOhneNeustart(t *testing.T) {
	srv, _ := testServer(t)
	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "TESTKEY123" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	defer ks.Close()
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	eingabe := schritt2Werte().Encode()

	// Ausgangslage wie im Bugreport: ohne hinterlegten Key schlägt das Laden
	// mit einer klaren Meldung fehl, nicht mit einem rohen HTTP-Fehler von
	// Keepa.
	vor := hole(t, srv, http.MethodPost, "/deal/laden", eingabe)
	if !strings.Contains(vor.Body.String(), "Kein Keepa-API-Key hinterlegt") {
		t.Fatalf("Ausgangslage stimmt nicht — ohne Key sollte das Laden mit \"Kein Keepa-API-Key hinterlegt\" scheitern:\n%s", vor.Body.String())
	}

	// Der Key wird über denselben Handler gespeichert, den auch die
	// Einstellungsseite im Browser benutzt — kein Zugriff am Server vorbei.
	if w := hole(t, srv, http.MethodPost, "/einstellungen",
		url.Values{"keepa.api_key": {"TESTKEY123"}}.Encode()); w.Code >= 400 {
		t.Fatalf("Einstellungen speichern: Status = %d: %s", w.Code, w.Body.String())
	}

	// Derselbe *Server, keine neue Instanz und kein neuer Prozess: nur so
	// beweist dieser Test etwas über C1.
	nach := hole(t, srv, http.MethodPost, "/deal/laden", eingabe)
	koerper := nach.Body.String()
	if strings.Contains(koerper, "Kein Keepa-API-Key hinterlegt") {
		t.Errorf("nach dem Speichern des Keys schlägt das Laden weiterhin mit \"Kein Keepa-API-Key hinterlegt\" fehl — der Key erreicht den laufenden Client nicht ohne Neustart:\n%s", koerper)
	}
	if !strings.Contains(koerper, "Makita") {
		t.Errorf("nach dem Speichern des Keys sollte das Produkt von der (gefälschten) Keepa-Gegenstelle geladen werden — dies scheitert, wenn srv.keepa.Key weiterhin leer beim Aufruf ankommt:\n%s", koerper)
	}
}

// TestLadenBeiKeepaFehlerZeigtFormularMitFeldern deckt I2 ab: jeder
// Fehlerpfad in holeProdukt lieferte früher srv.fehler — einen einzelnen
// <p class="fehler">, ganz ohne ein einziges Eingabefeld —, obwohl die
// Fehlertexte selbst ausdrücklich Handeingabe versprechen ("Die Felder
// lassen sich von Hand ausfüllen"). Fehlender Key ist der einfachste Weg,
// diesen Pfad ohne Netzwerkzugriff zu erreichen.
func TestLadenBeiKeepaFehlerZeigtFormularMitFeldern(t *testing.T) {
	srv, s := testServer(t)
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden",
		schritt2Werte().Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, `<p class="fehler">`) {
		t.Fatalf("die Fehlermeldung fehlt:\n%s", koerper)
	}
	// channel_id fehlt hier bewusst: der Channel wird erst in Schritt 4
	// gewählt. Geprüft wird, was Schritt 3 selbst zum Ausfüllen anbieten
	// muss — die Zahlen des Deals.
	for _, feld := range []string{"asin", "titel", "vk.DE", "ek", "sales.DE", "provision.DE", "fba.DE"} {
		if !strings.Contains(koerper, `name="`+feld+`"`) {
			t.Errorf("nach einem Keepa-Fehler fehlt das Eingabefeld %q — die Meldung verspricht Handeingabe, aber es gibt kein Formular dafür:\n%s", feld, koerper)
		}
	}
	if !strings.Contains(koerper, `value="B01636IZ0G"`) {
		t.Error("die bereits bekannte ASIN ist im Formular nicht vorbelegt")
	}
	if strings.Count(koerper, "standardwert") < 2 {
		t.Errorf("Provision und FBA sollten mit den konfigurierten Standardwerten vorbelegt sein (Herkunft \"standardwert\"):\n%s", koerper)
	}
}

// gelesenesFeldMuster findet jeden fest benannten Formularfeldnamen, den ein
// Handler in deal.go über r.PostForm liest.
//
// Die Indexform r.PostForm["zielmarkt"] steht bewusst daneben: sie ist der
// einzige Weg, ein mehrfach gesendetes Feld vollständig zu lesen, und ohne
// sie fiele genau die Marktliste aus der Prüfung — das Feld, um das es in
// dieser Änderung geht.
var gelesenesFeldMuster = regexp.MustCompile(`r\.PostForm(?:\.(?:Get|Has)\(|\[)"([a-z_]+)"`)

// geleseneFeldfamilieMuster findet die marktabhängigen Felder, deren Name
// erst zur Laufzeit entsteht: r.PostForm.Get("vk." + s). Erfasst wird die
// Familie "vk." — welches Kürzel dahinter steht, ist Sache von
// marketplace.Codes und keine Frage an die Vorlage.
var geleseneFeldfamilieMuster = regexp.MustCompile(`r\.PostForm\.(?:Get|Has)\("([a-z_]+\.)"\s*\+`)

// emittierteFeldfamilieMuster ist die Gegenseite in der Vorlage:
// name="vk.{{...}}" gehört zur selben Familie "vk.". Ein fest geschriebenes
// name="vk.DE" fiele hier durch — und soll es auch: ein einzelnes,
// hartkodiertes Marktkürzel in der Vorlage wäre genau der Rückfall, gegen
// den das Suffix gebaut ist.
var emittierteFeldfamilieMuster = regexp.MustCompile(`^([a-z_]+\.)\{\{`)

// formElementMuster findet vollständige Start-Tags von <input>, <select>,
// <textarea> und <button> — den einzigen Elementen, deren name-Attribut ein
// Browser beim Absenden eines Formulars mitschickt.
var formElementMuster = regexp.MustCompile(`(?i)<(?:input|select|textarea|button)\b[^>]*>`)
var nameAttrMuster = regexp.MustCompile(`\bname="([^"]*)"`)

// TestDealFormularUndHandlerFelderStimmenUeberein erweitert den in
// TestHxIncludeVerweistAufEchtesFormular begonnenen Ansatz — die Konsistenz
// der Vorlage selbst prüfen, statt nur Handler mit handgebauten Werten zu
// füttern — auf die gesamte Formularfeld-Landschaft von
// deal.go/deal.html: Jedes Feld, das ein Handler über r.PostForm liest, muss
// von irgendeiner Vorlage tatsächlich gerendert werden, sonst bleibt es für
// immer leer — genau das war neu_laden vor I4 und ohne_chart vor I3.
// Umgekehrt darf keine Vorlage ein Feld senden, das kein Handler kennt — das
// wäre eine Kontrolle ohne jede Wirkung. Dieser Test schließt damit die ganze
// Fehlerklasse, statt nur die drei bereits gefundenen Fälle.
//
// vk_wahl ist die einzige bewusste Ausnahme: die Auswahlknöpfe für den
// Verkaufspreis tragen laut Kommentar in deal.html absichtlich einen eigenen
// name — nur damit der Browser sie als zusammengehörige Radio-Gruppe
// behandelt —, ihr Wert wird ausschließlich über das onchange dieser Knöpfe
// in das echte Feld "vk.<MARKT>" kopiert und nie vom Server gelesen. Seit die
// Tabelle in Schritt 3 je Markt eine eigene Gruppe braucht (sonst höbe ein
// Klick in Italien die Wahl in Deutschland auf), trägt auch der Name der
// Knöpfe selbst das Marktkürzel — aus der Einzelausnahme "vk_wahl" wird
// damit die Familienausnahme "vk_wahl.".
//
// Seit die marktabhängigen Felder ihr Kürzel im Namen tragen, sind beide
// Seiten dynamisch: der Handler liest r.PostForm.Get("vk." + s), die Vorlage
// rendert name="vk.{{$leit.Code}}". Verglichen werden darum Feldfamilien —
// beide Seiten liefern "vk.", und die festen Namen (asin, ek, zielmarkt,
// leitmarkt …) bleiben unverändert Teil derselben Prüfung. Nur so misst
// dieser Test die neue Landschaft überhaupt noch; ein Muster, das an den
// dynamischen Namen vorbeigeht, täuschte Sicherheit vor.
func TestDealFormularUndHandlerFelderStimmenUeberein(t *testing.T) {
	// Gelesen wird die ganze Funnel-Quelle, nicht eine Datei: der Name
	// "deal.go" war hier immer nur ein Stellvertreter für "der Code, der das
	// Formular liest", und der steht seit dem Schnitt in drei Dateien. Ein
	// Muster statt einer Liste, damit eine vierte Datei nicht wieder
	// stillschweigend aus der Prüfung fällt — genau die Lücke, gegen die
	// dieser Test gebaut ist.
	quellen, err := filepath.Glob("deal*.go")
	if err != nil {
		t.Fatalf("Funnel-Quellen nicht auflistbar: %v", err)
	}
	var handlerQuelle []byte
	for _, pfad := range quellen {
		if strings.HasSuffix(pfad, "_test.go") {
			continue
		}
		roh, err := os.ReadFile(pfad)
		if err != nil {
			t.Fatalf("%s nicht lesbar: %v", pfad, err)
		}
		handlerQuelle = append(handlerQuelle, roh...)
	}
	if len(handlerQuelle) == 0 {
		t.Fatal("keine Funnel-Quelldatei gefunden — das Muster misst nichts mehr")
	}
	vorlagenQuelle, err := os.ReadFile(filepath.Join("templates", "deal.html"))
	if err != nil {
		t.Fatalf("deal.html nicht lesbar: %v", err)
	}

	gelesen := map[string]bool{}
	for _, m := range gelesenesFeldMuster.FindAllSubmatch(handlerQuelle, -1) {
		gelesen[string(m[1])] = true
	}
	if len(gelesen) == 0 {
		t.Fatal("kein einziges r.PostForm.Get/Has-Feld im Funnel-Code gefunden — das Muster misst nichts mehr, vermutlich hat sich der Code-Stil geändert")
	}
	// Die marktabhängigen Felder landen als Familie in derselben Menge wie
	// die festen Namen: gelesen wird "vk." + Kürzel, gerendert
	// name="vk.{{...}}" — beide Seiten kennen nur die Familie, und genau die
	// wird verglichen.
	familien := 0
	for _, m := range geleseneFeldfamilieMuster.FindAllSubmatch(handlerQuelle, -1) {
		gelesen[string(m[1])] = true
		familien++
	}
	if familien == 0 {
		t.Fatal("keine einzige marktabhängige Feldfamilie (r.PostForm.Get(\"vk.\" + …)) im Funnel-Code gefunden — das Muster misst an dieser Stelle nichts mehr")
	}

	emittiert := map[string]bool{}
	emittierteFamilien := 0
	for _, tag := range formElementMuster.FindAllString(string(vorlagenQuelle), -1) {
		m := nameAttrMuster.FindStringSubmatch(tag)
		if m == nil || m[1] == "" {
			continue
		}
		if f := emittierteFeldfamilieMuster.FindStringSubmatch(m[1]); f != nil {
			emittiert[f[1]] = true
			emittierteFamilien++
			continue
		}
		emittiert[m[1]] = true
	}
	if len(emittiert) == 0 {
		t.Fatal("kein einziges name=\"...\" in deal.html gefunden — das Muster misst nichts mehr, vermutlich hat sich der Vorlagen-Stil geändert")
	}
	if emittierteFamilien == 0 {
		t.Fatal("kein einziges name=\"vk.{{…}}\"-Feld in deal.html gefunden — das Muster misst an dieser Stelle nichts mehr")
	}

	// Bewusste Ausnahme, siehe Funktionskommentar. Der Schlüssel trägt den
	// Punkt: vk_wahl.{{$c}} in deal.html matched über
	// emittierteFeldfamilieMuster als Familie "vk_wahl.", nicht als fester
	// Name "vk_wahl" — ohne den Punkt hier fände die Prüfung unten die
	// Familie nicht und meldete die Knöpfe zu Recht als Kontrolle ohne
	// Wirkung.
	ohneLeserErlaubt := map[string]bool{"vk_wahl.": true}

	for feld := range gelesen {
		if !emittiert[feld] {
			t.Errorf("ein Handler liest r.PostForm %q, aber keine Vorlage in deal.html rendert ein Element mit name=%q — dieses Feld kann nie befüllt werden", feld, feld)
		}
	}
	for feld := range emittiert {
		if !gelesen[feld] && !ohneLeserErlaubt[feld] {
			t.Errorf("deal.html rendert ein Element mit name=%q, aber kein Handler im Funnel-Code liest dieses Feld — eine Kontrolle ohne jede Wirkung", feld)
		}
	}
}

// TestManuelleEingabeSetztQuelleAufManuell deckt den ersten Teil von I5 ab:
// sales, provision und fba müssen bei Handeingabe genau wie vk ihre
// *_quelle auf "manuell" zurücksetzen. Ein reiner Handler-Test kann das
// nicht prüfen — er postet Formularwerte direkt und überspringt damit den
// Browser-JavaScript-Code (oninput), der diesen Rücksetz-Effekt überhaupt
// erst auslöst (siehe die ausführliche Begründung bei
// TestHxIncludeVerweistAufEchtesFormular oben). Diese Prüfung liest darum,
// wie dort, die gerenderte Ausgabe direkt auf das erwartete Attribut.
func TestManuelleEingabeSetztQuelleAufManuell(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden",
		schritt2Werte().Encode())
	koerper := w.Body.String()

	// Seit dem Marktsuffix trägt das Quellenfeld einen Punkt im Namen und
	// ist damit als Eigenschaft (this.form.vk_quelle) nicht mehr
	// erreichbar — geprüft wird darum die Klammerform. Das ist derselbe
	// Rücksetz-Effekt, nur anders geschrieben; fiele er weg, behauptete die
	// Historie nach einer Handeingabe weiterhin "keepa".
	for _, feld := range []string{"vk", "sales", "provision", "fba"} {
		erwartet := `oninput="this.form['` + feld + `_quelle.DE'].value='manuell'`
		if !strings.Contains(koerper, erwartet) {
			t.Errorf("Feld %q setzt seine Quelle bei Handeingabe nicht auf \"manuell\" zurück — erwartetes Attribut fehlt (%s):\n%s", feld, erwartet, koerper)
		}
	}
}

// TestGespeicherterDealHatNieLeeresUStModus deckt den zweiten Teil von I5
// ab: die USt-Checkbox trägt value="brutto" und sendet im unmarkierten
// (Netto-)Fall — Standard-HTML-Verhalten für Checkboxen — gar nichts. Ohne
// Normalisierung landete praktisch jeder Netto-Deal, die große Mehrheit,
// mit leerem UStModus in der Historie ("Vorsteuer " ganz ohne Angabe).
func TestGespeicherterDealHatNieLeeresUStModus(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: dc.URL})

	f := referenzFormular(cid)
	f.Del("ust_modus") // so, wie es eine unmarkierte Checkbox sendet: gar nichts.

	w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())
	if w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	ds, err := s.Deals(store.DealFilter{Limit: 1})
	if err != nil || len(ds) != 1 {
		t.Fatalf("Deals: %v (%d Treffer)", err, len(ds))
	}
	if ds[0].UStModus != "netto" {
		t.Errorf("UStModus = %q, will \"netto\" — ein leerer Wert erzeugt in der Historie \"Vorsteuer \" ganz ohne Angabe", ds[0].UStModus)
	}
	// Die Normalisierung darf das Rechenergebnis nicht verändern: ""
	// und "netto" behandelt calc.Rechne ohnehin identisch.
	if ds[0].GewinnCent != 2670 {
		t.Errorf("GewinnCent = %d, will weiterhin 2670 (26,70 €) — die Normalisierung darf den Referenzfall nicht verändern", ds[0].GewinnCent)
	}
}

// TestHoleProduktNutztCacheInnerhalbDesFensters deckt I4 ab: eine zweite
// Anfrage für dieselbe ASIN auf demselben Marktplatz darf innerhalb des in
// den Einstellungen konfigurierten Zeitfensters kein zweites Mal bei Keepa
// anfragen und damit kein zweites Token verbrauchen — genau das verspricht
// die Einstellung "Keepa-Cache in Minuten", die vor diesem Fix von niemandem
// gelesen wurde, weil store.CacheSchreiben keinen einzigen Aufrufer hatte.
func TestHoleProduktNutztCacheInnerhalbDesFensters(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "testkey"

	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	var aufrufe int32
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&aufrufe, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	defer ks.Close()
	srv.keepa.BasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	f := schritt2Werte().Encode()
	hole(t, srv, http.MethodPost, "/deal/laden", f)
	w := hole(t, srv, http.MethodPost, "/deal/laden", f)

	if n := atomic.LoadInt32(&aufrufe); n != 1 {
		t.Errorf("Keepa wurde %d Mal angefragt, will 1 — der zweite Aufruf innerhalb des Cache-Fensters hätte aus dem Zwischenspeicher bedient werden müssen", n)
	}
	if !strings.Contains(w.Body.String(), "Makita") {
		t.Errorf("der aus dem Cache bediente Aufruf lieferte kein Produkt:\n%s", w.Body.String())
	}
}

// TestNeuLadenUmgehtCache deckt die zweite Hälfte von I4 ab: der
// "Neu laden"-Knopf muss den Zwischenspeicher bewusst umgehen können.
func TestNeuLadenUmgehtCache(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "testkey"

	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	var aufrufe int32
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&aufrufe, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	defer ks.Close()
	srv.keepa.BasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	hole(t, srv, http.MethodPost, "/deal/laden",
		schritt2Werte().Encode())
	hole(t, srv, http.MethodPost, "/deal/laden",
		mitFeld(schritt2Werte(), "neu_laden", "1").Encode())

	if n := atomic.LoadInt32(&aufrufe); n != 2 {
		t.Errorf("Keepa wurde %d Mal angefragt, will 2 — neu_laden=1 hätte den Cache umgehen müssen", n)
	}
}

// TestOhneChartKontrolleErmoeglichtSenden deckt I3 ab: schlägt der
// Chart-Abruf fehl, muss die Oberfläche tatsächlich eine Möglichkeit bieten,
// trotzdem zu posten. Vorher nannte die Fehlermeldung einen Knopf, den keine
// Vorlage je gerendert hat, und r.PostForm.Get("ohne_chart") blieb für immer
// leer — ein Post war während einer Chart-Störung endgültig blockiert.
func TestOhneChartKontrolleErmoeglichtSenden(t *testing.T) {
	srv, s := testServer(t)

	kaputterChart := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer kaputterChart.Close()
	srv.keepa.BasisURL = kaputterChart.URL

	var empfangen string
	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roh, _ := readAll(r)
		empfangen = roh
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: dc.URL})
	f := referenzFormular(cid)

	// Ohne ohne_chart: das Posten muss abgelehnt werden, aber die Antwort
	// muss die Kontrolle enthalten, die ohne_chart=1 setzt.
	w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())
	koerper := w.Body.String()
	if !strings.Contains(koerper, `name="ohne_chart"`) {
		t.Fatalf("nach einem Chart-Fehlschlag fehlt die Kontrolle, die ohne_chart=1 setzt — der im Fehlertext versprochene Ausweg ist unerreichbar:\n%s", koerper)
	}
	if n, _ := s.DealsAnzahl(store.DealFilter{}); n != 0 {
		t.Error("trotz Chart-Fehlschlag ohne ohne_chart wurde bereits ein Deal gespeichert")
	}

	// Mit ohne_chart=1 — wie es die neue Kontrolle beim Absenden mitschickt
	// — muss der Post durchgehen.
	f.Set("ohne_chart", "1")
	w2 := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())
	if w2.Code >= 400 {
		t.Fatalf("Senden mit ohne_chart=1: Status = %d: %s", w2.Code, w2.Body.String())
	}
	if n, _ := s.DealsAnzahl(store.DealFilter{}); n != 1 {
		t.Error("mit ohne_chart=1 wurde kein Deal gespeichert")
	}
	if empfangen == "" {
		t.Fatal("Discord hat trotz ohne_chart=1 keine Nutzlast empfangen")
	}
}

// TestSendenErfolgLiefertFragmentUndRefresh deckt I6 ab: der Posten-Knopf
// zielt mit hx-target="#vorschau" auf ein Fragment. Vor diesem Fix rendete
// ein erfolgreicher Versand die komplette "deal"-Vorlage — ein ganzes
// <!doctype html>-Dokument mit eigener Kopfzeile und einem zweiten
// #formular — in dieses Fragment hinein, während das links stehende
// Formular unverändert mit seinen alten Werten stehen blieb und zu einem
// zweiten, doppelten Post einlud.
func TestSendenErfolgLiefertFragmentUndRefresh(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals-vip", WebhookURL: dc.URL})
	w := hole(t, srv, http.MethodPost, "/deal/senden", referenzFormular(cid).Encode())
	if w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	if got := w.Header().Get("HX-Refresh"); got != "true" {
		t.Errorf("HX-Refresh = %q, will \"true\" — ohne den Header bleibt die alte, ausgefüllte Vorschau stehen und lädt zu einem doppelten Post ein", got)
	}
	koerper := w.Body.String()
	if strings.Contains(strings.ToLower(koerper), "<!doctype") {
		t.Errorf("die Antwort enthält ein komplettes Dokument statt eines Fragments:\n%s", koerper)
	}
	if strings.Contains(koerper, `id="formular"`) {
		t.Errorf("die Antwort enthält ein zweites #formular — die komplette \"deal\"-Vorlage wurde in die Vorschau gerendert:\n%s", koerper)
	}
	if !strings.Contains(koerper, "deals-vip") {
		t.Errorf("die Erfolgsmeldung nennt den Channel nicht:\n%s", koerper)
	}
}

// TestBaueDealLehntUngueltigeASINAb deckt M8 ab: formularLesen trimmt und
// großschreibt die ASIN nur, ohne ihre Form zu prüfen, und baueDeal reicht
// sie unverändert an store.ChartSpeichern weiter, das daraus per
// filepath.Join einen Dateinamen baut. Eine von Hand gebaute Anfrage mit
// z. B. asin=../../../SOMEWHERE dürfte also nie so weit kommen.
func TestBaueDealLehntUngueltigeASINAb(t *testing.T) {
	srv, s := testServer(t)

	var discordAufrufe int32
	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&discordAufrufe, 1)
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: dc.URL})

	f := referenzFormular(cid)
	f.Set("asin", "../../../SOMEWHERE")

	w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())
	koerper := w.Body.String()
	if !strings.Contains(strings.ToLower(koerper), "asin") {
		t.Errorf("Fehlermeldung nennt die ungültige ASIN nicht:\n%s", koerper)
	}
	if n, _ := s.DealsAnzahl(store.DealFilter{}); n != 0 {
		t.Error("trotz ungültiger ASIN wurde ein Deal gespeichert")
	}
	// Wenn Discord nie kontaktiert wurde, ist store.ChartSpeichern — das
	// zeitlich danach läuft — erst recht nie mit dieser ASIN aufgerufen
	// worden.
	if atomic.LoadInt32(&discordAufrufe) != 0 {
		t.Error("Discord wurde trotz ungültiger ASIN kontaktiert — baueDeal hätte vorher abbrechen müssen")
	}
}

// TestLadenGleichzeitigOhneDatenrennenAmKeepaKey deckt ein Datenrennen ab,
// das der C1-Fix (siehe TestKeepaKeySpeichernWirktOhneNeustart oben) selbst
// eingeführt hat: aktualisiereKeepaKey schrieb bei jeder Anfrage
// unsynchronisiert in srv.keepa.Key, während Produkt() (internal/keepa)
// genau dieses Feld beim Bau der Anfrage-URL liest — beides schlichte
// Feldzugriffe auf einen *keepa.Client, der serverweit geteilt und von
// net/http für jede Anfrage in einer eigenen Goroutine bedient wird. Vor dem
// C1-Fix wurde Key einmalig vor dem ersten Accept() geschrieben und blieb
// danach unverändert — von Natur aus rennenfrei. Seit dem C1-Fix schreibt
// jede Anfrage erneut. Zwei nahezu gleichzeitige POST /deal/laden — ein
// Doppelklick, zwei geöffnete Browser-Tabs — reichen, damit `go test -race`
// einen Schreib-/Lesekonflikt meldet.
//
// Der Key wird bewusst über den echten /einstellungen-Handler gespeichert,
// nicht direkt an srv.keepa.Key gesetzt: nur der Einstellungs-Zweig von
// aktualisiereKeepaKey schrieb unter dem alten Code bei jeder einzelnen
// Anfrage erneut in srv.keepa.Key — ein direkt am Client hinterlegter Key
// hätte diesen Zweig nie erreicht und das Rennen nicht ausgelöst.
func TestLadenGleichzeitigOhneDatenrennenAmKeepaKey(t *testing.T) {
	srv, _ := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	if w := hole(t, srv, http.MethodPost, "/einstellungen",
		url.Values{"keepa.api_key": {"TESTKEY123"}}.Encode()); w.Code >= 400 {
		t.Fatalf("Einstellungen speichern: Status = %d: %s", w.Code, w.Body.String())
	}

	eingabe := schritt2Werte().Encode()

	// t.Errorf ist im Gegensatz zu t.Fatalf aus mehreren Goroutinen
	// gleichzeitig aufrufbar; wg.Wait() stellt sicher, dass alle Aufrufe
	// abgeschlossen sind, bevor die Testfunktion zurückkehrt.
	const nebenlaeufig = 20
	var wg sync.WaitGroup
	wg.Add(nebenlaeufig)
	for i := 0; i < nebenlaeufig; i++ {
		go func() {
			defer wg.Done()
			w := hole(t, srv, http.MethodPost, "/deal/laden", eingabe)
			if w.Code != http.StatusOK {
				t.Errorf("Status = %d: %s", w.Code, w.Body.String())
			}
		}()
	}
	wg.Wait()
}

// ---------------------------------------------------------------------------
// Der Funnel: vier Schritte, von denen jeder nur das abfragt, was der nächste
// braucht. Die folgenden Tests gehen ihn Schritt für Schritt durch — über
// dieselben Routen, die auch die Vorlagen benutzen.

// TestFunnelSchritt1ErkenntAmazonLink: aus einem Amazon-Produktlink stehen
// ASIN und Einkaufsland fest, es gibt also nichts nachzufragen — Schritt 2
// kommt sofort.
func TestFunnelSchritt1ErkenntAmazonLink(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"}}.Encode())

	koerper := w.Body.String()
	if !strings.Contains(koerper, schritt2Kennung) {
		t.Fatalf("Schritt 2 wurde nicht erreicht:\n%s", koerper)
	}
	for _, muss := range []string{`name="ek_art"`, `name="zielmarkt"`, `value="B01636IZ0G"`, `value="ES"`} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Schritt 2 enthält %q nicht:\n%s", muss, koerper)
		}
	}
}

// TestFunnelFremdshopFragtNachASIN ist der Kern der Erweiterung: ein
// Einkaufslink muss nicht zu Amazon führen. Der Link eines fremden Shops
// nennt aber keine ASIN, und ohne die gibt es weder Keepa-Daten noch einen
// Verkaufslink — also wird sie nachgefragt, statt die Eingabe abzulehnen.
func TestFunnelFremdshopFragtNachASIN(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.mediamarkt.de/de/product/_makita-2745899.html"}}.Encode())

	koerper := w.Body.String()
	if !strings.Contains(koerper, `<input name="asin"`) {
		t.Fatalf("nach einem Fremdshop-Link fehlt das ASIN-Feld:\n%s", koerper)
	}
	if !strings.Contains(koerper, "mediamarkt.de") {
		t.Errorf("die Rückfrage nennt den erkannten Shop nicht:\n%s", koerper)
	}
	if strings.Contains(koerper, schritt2Kennung) {
		t.Error("Schritt 2 wurde gezeigt, obwohl die ASIN noch fehlt")
	}
}

// TestFunnelFremdshopMitASINErreichtSchritt2 setzt die Rückfrage fort: mit
// der nachgetragenen ASIN geht es weiter, und der Fremdshop-Link wird als
// verborgenes Feld mitgetragen — er ist der Einkaufslink, der später im Post
// steht.
func TestFunnelFremdshopMitASINErreichtSchritt2(t *testing.T) {
	srv, _ := testServer(t)
	// So, wie es der Browser sendet: link_bestaetigt trägt den Link, für den
	// die ASIN eingetragen wurde (siehe schritt1 in deal.html).
	w := hole(t, srv, http.MethodPost, "/deal/preis", url.Values{
		"einkaufslink":    {"https://www.mediamarkt.de/de/product/_makita-2745899.html"},
		"link_bestaetigt": {"https://www.mediamarkt.de/de/product/_makita-2745899.html"},
		"asin":            {"B01636IZ0G"},
		"quellmarkt":      {"DE"},
	}.Encode())

	koerper := w.Body.String()
	if !strings.Contains(koerper, schritt2Kennung) {
		t.Fatalf("Schritt 2 wurde nicht erreicht:\n%s", koerper)
	}
	if !strings.Contains(koerper, `name="quell_url" value="https://www.mediamarkt.de/de/product/_makita-2745899.html"`) {
		t.Errorf("der Fremdshop-Link wird nicht weitergetragen:\n%s", koerper)
	}
	// Das Einkaufsland kommt aus der Endung des Shops und legt allein den
	// Umsatzsteuersatz fest.
	if !strings.Contains(koerper, `name="quellmarkt" value="DE"`) {
		t.Errorf("aus mediamarkt.de wurde kein Einkaufsland DE vorgeschlagen:\n%s", koerper)
	}
}

// TestFunnelNackteASINFragtNachLand: ohne Link ist zwar der Artikel bekannt,
// aber nicht, wo eingekauft wird — und damit nicht, welcher
// Umsatzsteuersatz gilt.
func TestFunnelNackteASINFragtNachLand(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"B01636IZ0G"}}.Encode())

	koerper := w.Body.String()
	if !strings.Contains(koerper, `<select name="quellmarkt"`) {
		t.Fatalf("nach einer nackten ASIN fehlt die Auswahl des Einkaufslands:\n%s", koerper)
	}
	if strings.Contains(koerper, schritt2Kennung) {
		t.Error("Schritt 2 wurde gezeigt, obwohl das Einkaufsland noch fehlt")
	}

	// Mit gewähltem und abgeschicktem Land geht es weiter.
	weiter := hole(t, srv, http.MethodPost, "/deal/preis", url.Values{
		"einkaufslink":    {"B01636IZ0G"},
		"link_bestaetigt": {"B01636IZ0G"},
		"quellmarkt":      {"ES"},
	}.Encode())
	if !strings.Contains(weiter.Body.String(), schritt2Kennung) {
		t.Errorf("mit gewähltem Einkaufsland wird Schritt 2 nicht erreicht:\n%s", weiter.Body.String())
	}
}

// TestFunnelSchritt2VerlangtEinkaufspreis: ohne Einkaufspreis gibt es nichts
// zu rechnen, und ein Keepa-Token wird dafür auch nicht verbraucht.
func TestFunnelSchritt2VerlangtEinkaufspreis(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey"
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	f := mitFeld(schritt2Werte(), "ek", "")
	w := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode())

	koerper := w.Body.String()
	if !strings.Contains(koerper, `class="fehler"`) {
		t.Fatalf("ein fehlender Einkaufspreis wird nicht beanstandet:\n%s", koerper)
	}
	if !strings.Contains(koerper, schritt2Kennung) {
		t.Errorf("nach der Beanstandung wird nicht Schritt 2 zum Nachtragen gezeigt:\n%s", koerper)
	}
}

// TestBerechnungSchluesseltDenReferenzfallAuf prüft den Live-Teil von
// Schritt 3: die Aufschlüsselung nennt jeden Zwischenschritt, aus dem der
// Gewinn entsteht — nicht nur das Ergebnis. Die Zahlen sind die des
// Referenzfalls aus der Spec (Makita HR2630, ES -> DE).
func TestBerechnungSchluesseltDenReferenzfallAuf(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", referenzFormular(0).Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	koerper := w.Body.String()
	for _, muss := range []struct{ wert, wofuer string }{
		{"130,56 €", "Einkaufspreis brutto"},
		{"22,66 €", "Vorsteuer ES 21 %"},
		{"107,90 €", "Einkaufspreis netto"},
		{"207,49 €", "Verkaufspreis brutto"},
		{"33,13 €", "Umsatzsteuer DE 19 %"},
		{"174,36 €", "Verkaufserlös netto"},
		{"31,12 €", "Provision"},
		{"Provision 15 % (auf VK brutto)", "Basis der Provision"},
		{"8,64 €", "FBA-Gebühr"},
		{"26,70 €", "Gewinn"},
		{"12,9 %", "Marge"},
	} {
		if !strings.Contains(koerper, muss.wert) {
			t.Errorf("die Aufschlüsselung nennt %s (%s) nicht:\n%s", muss.wofuer, muss.wert, koerper)
		}
	}
	if !strings.Contains(koerper, "ES 21 %") || !strings.Contains(koerper, "DE 19 %") {
		t.Errorf("die Aufschlüsselung nennt die Umsatzsteuersätze nicht:\n%s", koerper)
	}
}

// TestBerechnungBrauchtKeineVerkaufszahl: die Verkaufszahl steht im Post,
// geht aber in keine einzige Zeile der Rechnung ein. Sie darf die
// Aufschlüsselung darum nicht blockieren — sonst verschwände die Rechnung,
// sobald jemand das Feld zum Ändern leert. Für den Post selbst bleibt sie
// Pflicht (siehe TestBaueDealLehntUngueltigeVerkaeufeAb).
func TestBerechnungBrauchtKeineVerkaufszahl(t *testing.T) {
	srv, _ := testServer(t)

	f := mitMarktFeld(referenzFormular(0), "sales", "DE", "")
	w := hole(t, srv, http.MethodPost, "/deal/berechnung", f.Encode())

	koerper := w.Body.String()
	if !strings.Contains(koerper, "26,70 €") {
		t.Errorf("ohne Verkaufszahl fehlt die Aufschlüsselung:\n%s", koerper)
	}
	if strings.Contains(koerper, `class="fehler"`) {
		t.Errorf("die fehlende Verkaufszahl wird als Rechenfehler gemeldet:\n%s", koerper)
	}
}

// TestBerechnungMitNettoEingabeRechnetHoch deckt den Schalter aus Schritt 2
// ab: wird der Einkaufspreis netto eingegeben, zeigt die Aufschlüsselung die
// Umsatzsteuer als Aufschlag statt als Abzug — und kommt beim selben Deal
// heraus.
func TestBerechnungMitNettoEingabeRechnetHoch(t *testing.T) {
	srv, _ := testServer(t)

	f := mitFeld(mitFeld(referenzFormular(0), "ek", "107,90"), "ek_art", "netto")
	w := hole(t, srv, http.MethodPost, "/deal/berechnung", f.Encode())

	koerper := w.Body.String()
	for _, muss := range []string{"107,90 €", "22,66 €", "130,56 €", "26,70 €"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("die Aufschlüsselung einer Netto-Eingabe enthält %q nicht:\n%s", muss, koerper)
		}
	}
	if !strings.Contains(koerper, "netto (eingegeben)") {
		t.Errorf("die Aufschlüsselung sagt nicht, dass netto eingegeben wurde:\n%s", koerper)
	}
}

// TestNettoEingabeStehtNettoImPost: nach einer Netto-Eingabe steht der
// Nettopreis im Post, mit "netto" dabei — bei B2B-Deals ist das der Preis,
// um den es geht. Gerechnet wird weiter mit dem Bruttopreis.
func TestNettoEingabeStehtNettoImPost(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	f := mitFeld(mitFeld(mitFeld(referenzFormular(cid), "ek", "107,90"), "ek_art", "netto"), "ek_notiz", "")
	w := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode())

	koerper := w.Body.String()
	if !strings.Contains(koerper, "EK: 107,90 € netto") {
		t.Errorf("der Post nennt nicht den Nettopreis:\n%s", koerper)
	}
}

// TestFremdshopStehtImPost: bei einem Einkauf außerhalb von Amazon muss der
// Post auf den Shop zeigen, aus dem tatsächlich eingekauft wird — nicht auf
// eine Amazon-Seite, die niemand als Einkaufsquelle genannt hat.
func TestFremdshopStehtImPost(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	const link = "https://www.mediamarkt.de/de/product/_makita-2745899.html"
	f := mitFeld(mitFeld(referenzFormular(cid), "quell_url", link), "quellmarkt", "DE")
	f.Set("einkaufslink", link)

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, "mediamarkt.de") {
		t.Errorf("der Post nennt den Fremdshop nicht:\n%s", koerper)
	}
	if strings.Contains(koerper, "🏬 [amazon.de]") {
		t.Errorf("der Post zeigt Amazon als Einkaufsquelle, obwohl woanders eingekauft wird:\n%s", koerper)
	}
}

// TestFremdshopLandetInDerHistorie: der Einkaufslink ist bei einem Fremdshop
// die einzige Angabe, die den Einkauf wiederfindbar macht — aus Land und
// ASIN lässt er sich, anders als bei Amazon, nicht wieder herstellen.
func TestFremdshopLandetInDerHistorie(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer dc.Close()
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: dc.URL})

	const link = "https://www.mediamarkt.de/de/product/_makita-2745899.html"
	f := mitFeld(mitFeld(referenzFormular(cid), "quell_url", link), "quellmarkt", "DE")
	f.Set("ek_art", "netto")
	f.Set("ek", "107,90")

	if w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode()); w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	ds, _ := s.Deals(store.DealFilter{Limit: 1})
	if len(ds) != 1 {
		t.Fatal("kein Deal gespeichert")
	}
	if ds[0].QuellURL != link {
		t.Errorf("QuellURL = %q, will %q", ds[0].QuellURL, link)
	}
	if ds[0].EKArt != "netto" {
		t.Errorf("EKArt = %q, will \"netto\"", ds[0].EKArt)
	}
	// Gespeichert wird immer der Bruttopreis, damit die Historie
	// vergleichbar bleibt: 107,90 € netto sind bei 19 % deutscher USt
	// 128,40 € brutto.
	if ds[0].EKCent != 12840 {
		t.Errorf("EKCent = %d, will 12840 — der hochgerechnete Bruttopreis", ds[0].EKCent)
	}
}

// TestZurueckAusSchritt4BehaeltGeprueftesZurueck: der Weg zurück darf nicht
// alles wegwerfen, was in Schritt 3 von Hand geprüft wurde. Vorwärts aus
// Schritt 2 gilt das Gegenteil — dort kann sich der Zielmarktplatz gerade
// geändert haben, und Provision, FBA und Verkaufspreis gelten immer nur für
// einen bestimmten Markt.
func TestZurueckAusSchritt4BehaeltGeprueftesZurueck(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	f := schritt2Werte()
	f.Set("titel", "Makita von Hand gekürzt")
	f.Set("vk.DE", "199,99")
	f.Set("vk_quelle.DE", "manuell")

	zurueck := hole(t, srv, http.MethodPost, "/deal/laden", mitFeld(f, "zurueck", "1").Encode()).Body.String()
	if !strings.Contains(zurueck, `name="vk.DE" value="199,99"`) {
		t.Errorf("der Weg zurück überschreibt den von Hand gesetzten Verkaufspreis:\n%s", zurueck)
	}
	if !strings.Contains(zurueck, "Makita von Hand gekürzt") {
		t.Errorf("der Weg zurück überschreibt den gekürzten Artikelnamen:\n%s", zurueck)
	}

	// Vorwärts aus Schritt 2: von Hand gesetzte Werte bleiben (sie gelten
	// je Markt, ein anderer Markt bekommt sie nicht), Keepa-Werte und ein
	// nicht von Hand geänderter Name kommen frisch.
	vorwaerts := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String()
	if !strings.Contains(vorwaerts, `name="vk.DE" value="199,99"`) {
		t.Errorf("vorwärts aus Schritt 2 geht der von Hand gesetzte VK verloren:\n%s", vorwaerts)
	}
	f.Set("vk_quelle.DE", "avg90")
	vorwaerts = hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String()
	if !strings.Contains(vorwaerts, `name="vk.DE" value="207,49"`) {
		t.Errorf("vorwärts aus Schritt 2 werden die Keepa-Werte nicht frisch übernommen:\n%s", vorwaerts)
	}
	if strings.Contains(vorwaerts, "Makita von Hand gekürzt") {
		t.Errorf("ein nicht als manuell markierter Name blieb stehen")
	}
	f.Set("titel_manuell", "1")
	f.Set("titel_asin", "B01636IZ0G")
	if v := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String(); !strings.Contains(v, "Makita von Hand gekürzt") {
		t.Errorf("der von Hand gekürzte Name geht vorwärts verloren")
	}
	f.Set("asin", "B000000001")
	if v := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String(); strings.Contains(v, "Makita von Hand gekürzt") {
		t.Errorf("der gekürzte Name blieb bei einer anderen ASIN stehen")
	}
}

// TestFunnelLaeuftDurch geht den ganzen Weg über die vier Routen, die auch
// die Knöpfe der Oberfläche benutzen, und postet am Ende — ohne dass ein
// Schritt einen Wert verliert, den ein späterer braucht.
func TestFunnelLaeuftDurch(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	var gesendet string
	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gesendet, _ = readAll(r)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"42"}`))
	}))
	defer dc.Close()
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: dc.URL})

	// Schritt 1: nur der Link.
	eins := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"}}.Encode()).Body.String()
	if !strings.Contains(eins, schritt2Kennung) {
		t.Fatalf("Schritt 2 nicht erreicht:\n%s", eins)
	}

	// Schritt 2: Einkaufspreis und Zielmarktplatz.
	zwei := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode()).Body.String()
	if !strings.Contains(zwei, "Makita") {
		t.Fatalf("Schritt 3 ohne Keepa-Werte:\n%s", zwei)
	}
	if !strings.Contains(zwei, "26,70 €") {
		t.Errorf("Schritt 3 zeigt die Aufschlüsselung nicht:\n%s", zwei)
	}

	// Schritt 3 -> 4: mit denselben Werten, die das Formular trägt.
	//
	drei := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode()).Body.String()
	if !strings.Contains(nurText(vorschauMuster.FindString(drei)), "Gewinn: 26,70 €") {
		t.Fatalf("Schritt 4 zeigt den Post nicht:\n%s", drei)
	}

	// Schritt 4: senden.
	vier := hole(t, srv, http.MethodPost, "/deal/senden", referenzFormular(cid).Encode())
	if vier.Code >= 400 {
		t.Fatalf("Senden: Status = %d: %s", vier.Code, vier.Body.String())
	}
	if !strings.Contains(gesendet, "26,70") {
		t.Errorf("der gesendete Post enthält den Gewinn nicht:\n%s", gesendet)
	}
	if n, _ := s.DealsAnzahl(store.DealFilter{}); n != 1 {
		t.Errorf("%d Deals in der Historie, will 1", n)
	}
}

// TestErfundenerEinkaufslinkWirdAbgelehnt: quell_url kommt wie jedes andere
// Feld ungeprüft aus dem Formular, führt von dort aber unmittelbar in den
// Discord-Post — also in fremdes Markdown, das keine Vorlage dieses Programms
// mehr entschärfen kann. Eine von Hand gebaute Anfrage darf darum keinen
// "javascript:"-Link durchreichen, genau wie sie keine ausbrechende ASIN
// durchreichen darf (M8 im Abschluss-Review).
func TestErfundenerEinkaufslinkWirdAbgelehnt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	for _, boese := range []string{"javascript:alert(1)", "kein link", "B01636IZ0G"} {
		f := mitFeld(referenzFormular(cid), "quell_url", boese)
		w := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode())
		koerper := w.Body.String()

		if strings.Contains(koerper, htmlEscape(boese)) && !strings.Contains(koerper, `class="fehler"`) {
			t.Errorf("quell_url=%q landet ungeprüft im Post:\n%s", boese, koerper)
		}
		if !strings.Contains(koerper, `class="fehler"`) {
			t.Errorf("quell_url=%q wird nicht beanstandet:\n%s", boese, koerper)
		}
	}
}

// TestSchritt3ZeigtRechenfehlerNebenDenFeldern: fehlt ein Wert, den die
// Rechnung braucht, verschwindet nicht die halbe Seite — die Meldung steht in
// der Aufschlüsselung, die Felder bleiben zum Ausfüllen stehen.
func TestSchritt3ZeigtRechenfehlerNebenDenFeldern(t *testing.T) {
	srv, _ := testServer(t)

	f := mitMarktFeld(referenzFormular(0), "vk", "DE", "")
	w := hole(t, srv, http.MethodPost, "/deal/berechnung", f.Encode())

	koerper := w.Body.String()
	if !strings.Contains(strings.ToLower(koerper), "verkaufspreis") {
		t.Errorf("die Meldung nennt das fehlende Feld nicht:\n%s", koerper)
	}
	if strings.Contains(koerper, "26,70 €") {
		t.Errorf("ohne Verkaufspreis wird trotzdem ein Gewinn gezeigt:\n%s", koerper)
	}
}

// TestKeepaFehlerZeigtNurEineMeldung: ein nicht erreichbares Keepa ist ein
// Fehler des Schritts, kein Rechenfehler. Beide Meldungen stehen an
// verschiedenen Stellen derselben Seite — dieselbe zweimal untereinander wäre
// nur Lärm.
func TestKeepaFehlerZeigtNurEineMeldung(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode())
	koerper := w.Body.String()

	const meldung = "Kein Keepa-API-Key hinterlegt"
	if n := strings.Count(koerper, meldung); n != 1 {
		t.Errorf("die Keepa-Meldung steht %dmal auf der Seite, will genau einmal:\n%s", n, koerper)
	}
}

// TestZurueckAufSchritt1LaesstNachgetragenesAendern: was in Schritt 1 von
// Hand nachgetragen wurde, muss auf dem Weg zurück auch wieder änderbar sein.
// Stünde die nachgetragene ASIN dort nur als verborgenes Feld, führte der Weg
// zurück in eine Sackgasse — der Link ließe sich ändern, der Artikel nicht.
func TestZurueckAufSchritt1LaesstNachgetragenesAendern(t *testing.T) {
	srv, _ := testServer(t)

	fremd := url.Values{
		"einkaufslink": {"https://www.mediamarkt.de/de/product/_makita-2745899.html"},
		"quell_url":    {"https://www.mediamarkt.de/de/product/_makita-2745899.html"},
		"asin":         {"B01636IZ0G"},
		"quellmarkt":   {"DE"},
	}
	w := hole(t, srv, http.MethodPost, "/deal/start", fremd.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, `<input name="asin" value="B01636IZ0G"`) {
		t.Errorf("die nachgetragene ASIN ist auf dem Weg zurück nicht änderbar:\n%s", koerper)
	}
	if !strings.Contains(koerper, `<select name="quellmarkt"`) {
		t.Errorf("das gewählte Einkaufsland ist auf dem Weg zurück nicht änderbar:\n%s", koerper)
	}

	// Bei einem Amazon-Link bestimmt der Link beides — dann gibt es nichts zu
	// fragen, und die Felder bleiben verborgen.
	amazon := url.Values{
		"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"},
		"asin":         {"B01636IZ0G"},
		"quellmarkt":   {"ES"},
	}
	a := hole(t, srv, http.MethodPost, "/deal/start", amazon.Encode()).Body.String()
	if strings.Contains(a, `<select name="quellmarkt"`) {
		t.Errorf("bei einem Amazon-Link wird das Einkaufsland unnötig erfragt:\n%s", a)
	}
}

// ---------------------------------------------------------------------------
// Befunde aus der Review vom 2026-09-06. Jeder Test hier reproduziert einen
// Fall, den keiner der Tests oben entdeckt hat.

// TestFremdshopLinkKannDenPostNichtKapern deckt P1 ab: der Einkaufslink steht
// im Post in einem Markdown-Link ("[Shop](hier)"). Eine schließende Klammer
// im Link beendet ihn dort vorzeitig — der Rest wird zu eigenem Text, und ein
// zweiter Link daneben sieht aus, als hätte ihn der Absender mitgeschickt.
// Der Link kommt von außen (jemand schickt einen "guten Deal"), die
// Schema-Prüfung allein reicht darum nicht.
func TestFremdshopLinkKannDenPostNichtKapern(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	const boese = "https://shop.example/product?x=)[FAKE](https://boese.example)"
	f := mitFeld(mitFeld(referenzFormular(cid), "quell_url", boese), "quellmarkt", "DE")
	f.Set("einkaufslink", boese)

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode())
	koerper := w.Body.String()

	// Geprüft wird der Post selbst, nicht die ganze Seite: in den
	// verborgenen Feldern steht der Rohwert als HTML-Attribut, und dort ist
	// er von html/template maskiert und harmlos.
	posttext := vorschauMuster.FindString(koerper)
	if posttext == "" {
		t.Fatalf("keine Vorschau im Körper:\n%s", koerper)
	}
	if strings.Contains(posttext, htmlEscape("[FAKE](https://boese.example)")) {
		t.Errorf("der eingeschleuste zweite Link steht im Post:\n%s", posttext)
	}
	// Der echte Link muss weiterhin da sein — entschärft, nicht entfernt.
	if !strings.Contains(posttext, "%29") {
		t.Errorf("die Klammer wurde nicht prozentkodiert:\n%s", posttext)
	}
	// Und das Formular trägt ab jetzt die geprüfte Form weiter.
	if strings.Contains(koerper, `name="quell_url" value="https://shop.example/product?x=)`) {
		t.Errorf("das Formular trägt weiterhin den ungeprüften Rohwert:\n%s", koerper)
	}
}

// keepaServerOhneAvg90 liefert die Fixture ohne Ø-90-Tage-Preis: derselbe
// Artikel, aber nur ein aktueller Preis. Genau diese Lage entsteht beim
// Wechsel auf einen Zielmarktplatz, für den Keepa weniger Daten hat.
func keepaServerOhneAvg90(t *testing.T, aktuell int) *httptest.Server {
	t.Helper()
	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	var antwort map[string]any
	if err := json.Unmarshal(roh, &antwort); err != nil {
		t.Fatalf("Fixture nicht lesbar: %v", err)
	}
	produkt := antwort["products"].([]any)[0].(map[string]any)
	stats := produkt["stats"].(map[string]any)

	leer := make([]any, 19)
	for i := range leer {
		leer[i] = -1
	}
	stats["avg90"] = append([]any(nil), leer...)
	jetzt := append([]any(nil), leer...)
	jetzt[18] = aktuell
	stats["current"] = jetzt
	// Ohne Verlauf gibt es auch keinen Median-Kandidaten.
	produkt["csv"] = nil

	angepasst, err := json.Marshal(antwort)
	if err != nil {
		t.Fatalf("Fixture nicht schreibbar: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(angepasst)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// TestFrischerAufrufVerwirftMarktgebundeneWerte deckt P2 ab: der Weg
// Schritt 3 → 2 → anderer Zielmarktplatz trug den alten Verkaufspreis
// weiter. Kennt Keepa für den neuen Markt keinen Ø-90-Tage-Preis, setzte die
// Kandidatenschleife keinen neuen, und der Nachrücker griff nicht, weil ja
// noch der alte Preis im Feld stand — gerechnet wurde mit dem Preis eines
// anderen Marktes.
func TestFrischerAufrufVerwirftMarktgebundeneWerte(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServerOhneAvg90(t, 9900)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	f := schritt2Werte()
	f.Set("vk.DE", "207,49")
	f.Set("vk_quelle.DE", "avg90")
	f.Set("titel", "Titel vom anderen Markt")

	koerper := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String()

	if strings.Contains(koerper, `name="vk.DE" value="207,49"`) {
		t.Errorf("der Verkaufspreis des vorigen Marktes steht weiterhin im Feld:\n%s", koerper)
	}
	if !strings.Contains(koerper, `name="vk.DE" value="99,00"`) {
		t.Errorf("der einzige Preis des neuen Marktes rückt nicht nach:\n%s", koerper)
	}
	if strings.Contains(koerper, "Titel vom anderen Markt") {
		t.Errorf("der Titel des vorigen Aufrufs bleibt stehen:\n%s", koerper)
	}
}

// TestFrischerAufrufOhnePreisLaesstDasFeldLeer: hat Keepa für den neuen Markt
// überhaupt keinen Preis, darf erst recht keiner stehen bleiben — lieber ein
// leeres Feld als die Zahl eines anderen Marktes.
func TestFrischerAufrufOhnePreisLaesstDasFeldLeer(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey"
	ks := keepaServerOhneAvg90(t, -1)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	f := mitMarktFeld(schritt2Werte(), "vk", "DE", "207,49")
	f.Set("vk_quelle.DE", "avg90")

	koerper := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String()
	if strings.Contains(koerper, `name="vk.DE" value="207,49"`) {
		t.Errorf("ohne jeden Preis für den neuen Markt bleibt der alte stehen:\n%s", koerper)
	}
	if !strings.Contains(koerper, `name="vk.DE" value=""`) {
		t.Errorf("das Verkaufspreisfeld ist nicht leer:\n%s", koerper)
	}
}

// TestKeepaFehlerVerwirftAlteWerte: scheitert die Abfrage für den neuen
// Markt, gilt dasselbe — die Zahlen des vorigen Marktes sind damit nicht
// bestätigt, sondern nur noch alt.
func TestKeepaFehlerVerwirftAlteWerte(t *testing.T) {
	srv, _ := testServer(t)

	f := schritt2Werte()
	f.Set("vk.DE", "207,49")
	f.Set("sales.DE", "40")
	f.Set("titel", "Titel vom anderen Markt")

	koerper := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String()

	for _, alt := range []string{`name="vk.DE" value="207,49"`, `name="sales.DE" value="40"`, "Titel vom anderen Markt"} {
		if strings.Contains(koerper, alt) {
			t.Errorf("nach einer gescheiterten Keepa-Abfrage steht %q weiterhin im Formular:\n%s", alt, koerper)
		}
	}
	// Provision und FBA hängen nicht am Abfrageergebnis, sondern an den
	// Einstellungen — die dürfen vorbelegt werden.
	if strings.Count(koerper, "standardwert") < 2 {
		t.Errorf("Provision und FBA sind nicht mit den Standardwerten vorbelegt:\n%s", koerper)
	}
}

// TestGeaenderterLinkFragtNachgetragenesNeu deckt P2 ab: ASIN und
// Einkaufsland, die von Hand nachgetragen wurden, gehören zu genau einem
// Link. Wird der ausgetauscht, sind sie Angaben zu einem anderen Artikel —
// vorher liefen sie stillschweigend mit dem neuen Link weiter.
func TestGeaenderterLinkFragtNachgetragenesNeu(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/preis", url.Values{
		"einkaufslink":    {"https://shop.example/ganz-anderer-artikel"},
		"link_bestaetigt": {"https://www.amazon.es/dp/B01636IZ0G"},
		"asin":            {"B01636IZ0G"},
		"quellmarkt":      {"ES"},
	}.Encode())
	koerper := w.Body.String()

	if strings.Contains(koerper, schritt2Kennung) {
		t.Fatalf("der neue Link läuft mit der ASIN des alten Artikels weiter:\n%s", koerper)
	}
	if !strings.Contains(koerper, `<input name="asin" value=""`) {
		t.Errorf("die ASIN des vorigen Artikels wird nicht verworfen:\n%s", koerper)
	}
	if !strings.Contains(koerper, `<select name="quellmarkt"`) {
		t.Errorf("das Einkaufsland des vorigen Artikels wird nicht neu erfragt:\n%s", koerper)
	}
}

// TestGeratenesEinkaufslandWirdBestaetigt deckt P2 ab: aus der Endung eines
// Shops folgt ein Vorschlag, kein bestätigter Umsatzsteuersatz. Vorher ging
// der Vorschlag als verborgenes Feld direkt in die Rechnung — sichtbar wurde
// er erst, wenn jemand zufällig zurückging.
func TestGeratenesEinkaufslandWirdBestaetigt(t *testing.T) {
	srv, _ := testServer(t)

	// Der Link nennt eine ASIN in Amazon-Form, das Land bleibt geraten.
	const link = "https://shop.example.de/dp/B01636IZ0G"
	erst := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {link}}.Encode()).Body.String()

	if strings.Contains(erst, schritt2Kennung) {
		t.Fatalf("das geratene Einkaufsland geht ungesehen in die Rechnung:\n%s", erst)
	}
	if !strings.Contains(erst, `<select name="quellmarkt"`) {
		t.Fatalf("die Länderauswahl wird nicht angezeigt:\n%s", erst)
	}
	if !gewaehltesLand("DE").MatchString(erst) {
		t.Errorf("der Vorschlag aus der Shop-Endung ist nicht vorausgewählt:\n%s", erst)
	}

	// Bestätigt geht es weiter.
	zweit := hole(t, srv, http.MethodPost, "/deal/preis", url.Values{
		"einkaufslink":    {link},
		"link_bestaetigt": {link},
		"asin":            {"B01636IZ0G"},
		"quellmarkt":      {"DE"},
	}.Encode()).Body.String()
	if !strings.Contains(zweit, schritt2Kennung) {
		t.Errorf("nach der Bestätigung wird Schritt 2 nicht erreicht:\n%s", zweit)
	}
}

// gewaehltesLand baut das Muster für eine vorausgewählte Länderoption. Als
// Muster statt als feste Zeichenkette, weil zwischen value und selected in
// der Vorlage ein Zeilenumbruch samt Einrückung steht — eine reine
// Textsuche würde bei jeder Umformatierung der Vorlage falsch anschlagen.
func gewaehltesLand(code string) *regexp.Regexp {
	return regexp.MustCompile(`(?s)<option value="` + code + `"\s+selected>`)
}

// TestChannelwahlBautDieVorschauNeu deckt P2 ab: die Erwähnung (@everyone,
// @here, eine Rolle) hängt am Channel und steht damit im Text. Schritt 3
// sendet keine channel_id, die erste Vorschau entsteht also ohne Erwähnung —
// gesendet wurde dann aber ein anderer Text als der gezeigte.
func TestChannelwahlBautDieVorschauNeu(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: "https://x/1", MentionTyp: "everyone",
	})

	// So kommt es aus Schritt 3: ohne Channel.
	ohne := referenzFormular(0)
	ohne.Set("channel_id", "0")
	erst := hole(t, srv, http.MethodPost, "/deal/vorschau", ohne.Encode()).Body.String()
	if strings.Contains(erst, "@everyone") {
		t.Fatalf("ohne gewählten Channel darf keine Erwähnung im Text stehen:\n%s", erst)
	}

	// Die Auswahl selbst muss die Vorschau neu bauen — sonst zeigt sie einen
	// Text, den so niemand sendet.
	formular := sendenFormularMuster.FindString(erst)
	if formular == "" {
		t.Fatalf("kein Sende-Formular in Schritt 4:\n%s", erst)
	}
	if !strings.Contains(formular, `<select name="channel_id" hx-post="/deal/vorschau"`) {
		t.Errorf("die Channel-Auswahl baut die Vorschau nicht neu:\n%s", formular)
	}

	// Und mit Channel steht die Erwähnung drin — derselbe Text, den
	// sendeDeal baut.
	zweit := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode()).Body.String()
	if !strings.Contains(zweit, "@everyone") {
		t.Errorf("mit gewähltem Channel fehlt die Erwähnung in der Vorschau:\n%s", zweit)
	}
}

// ---------------------------------------------------------------------------
// Bild-Kennung: der Weg von Keepa über das versteckte Formularfeld bis in die
// Historie.

// discordAttrappe nimmt einen Post an und meldet Erfolg.
func discordAttrappe(t *testing.T) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"555"}`))
	}))
	t.Cleanup(s.Close)
	return s
}

func TestLadenFuelltBildKennung(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey" // sonst lehnt holeProdukt ab, siehe TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	koerper := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode()).Body.String()
	if !strings.Contains(koerper, `name="bild_kennung" value="71bYHZQrjxL.jpg"`) {
		t.Error("das Formular trägt die Bild-Kennung aus Keepa nicht als verstecktes Feld")
	}
}

// Die Kennung gehört zu genau einem Artikel auf genau einem Markt. Auf dem
// Weg Schritt 3 → 2 → anderer Artikel darf sie nicht mitwandern, sonst stünde
// später das Bild des vorherigen Produkts in der Historie — dieselbe
// Fehlerklasse, gegen die keepaWerteLeeren Titel, VK und Sales abräumt.
func TestKeepaWerteLeerenRaeumtDieBildKennungMit(t *testing.T) {
	f := dealFormular{Titel: "Altes Ding", BildKennung: "71bYHZQrjxL.jpg"}
	f.keepaWerteLeeren()
	if f.BildKennung != "" {
		t.Errorf("BildKennung = %q, erwartet leer", f.BildKennung)
	}
}

func TestSendenSpeichertBildKennung(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: discordAttrappe(t).URL})

	f := referenzFormular(cid)
	f.Set("bild_kennung", "71bYHZQrjxL.jpg")
	if w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode()); w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	ds, _ := s.Deals(store.DealFilter{Limit: 10})
	if len(ds) != 1 {
		t.Fatalf("%d Deals, will 1", len(ds))
	}
	if ds[0].BildKennung != "71bYHZQrjxL.jpg" {
		t.Errorf("BildKennung = %q, will 71bYHZQrjxL.jpg", ds[0].BildKennung)
	}
}

// Das Feld ist versteckt, aber es kommt aus dem Browser zurück und landet
// später in einem src-Attribut. Was kein Amazon-Bildname ist, darf gar nicht
// erst gespeichert werden.
func TestSendenVerwirftManipulierteBildKennung(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: discordAttrappe(t).URL})

	f := referenzFormular(cid)
	f.Set("bild_kennung", "//boese.example/verfolger.jpg")
	if w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode()); w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	ds, _ := s.Deals(store.DealFilter{Limit: 10})
	if len(ds) != 1 {
		t.Fatalf("%d Deals, will 1", len(ds))
	}
	if ds[0].BildKennung != "" {
		t.Errorf("BildKennung = %q, erwartet leer", ds[0].BildKennung)
	}
}

// Dasselbe Argument wie in TestBerechnungsFormularTraegtAlleRechenfelder, für
// die Bild-Kennung: Schritt 4 bindet "verborgen-zahlen" ein, und was dort
// nicht steht, ist beim Posten weg. Ein Handler-Test würde das nicht
// bemerken — er schickt die Kennung ja selbst mit.
func TestSchritt4TraegtDieBildKennungWeiter(t *testing.T) {
	srv, _ := testServer(t)
	cid := int64(0)
	f := referenzFormular(cid)
	f.Set("bild_kennung", "71bYHZQrjxL.jpg")

	schritt4 := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	if !strings.Contains(schritt4, `name="bild_kennung" value="71bYHZQrjxL.jpg"`) {
		t.Errorf("Schritt 4 trägt die Bild-Kennung nicht weiter — beim Posten wäre sie verloren:\n%s", schritt4)
	}
	// Genau einmal: zwei Felder gleichen Namens senden zwei Werte, und
	// gelesen wird nur der erste (siehe Kommentar bei den verborgen-Blöcken).
	if n := strings.Count(schritt4, `name="bild_kennung"`); n != 1 {
		t.Errorf("Schritt 4 sendet bild_kennung %d-mal, will genau 1", n)
	}
}

// Der Funnel trägt seit dem Marktsuffix eine Liste, und seit rechneDeal über
// alle Märkte läuft (Task 6), braucht jeder gewählte Markt vollständige,
// gültige Zahlen — auch der zweite: er ist der Sonderfall "Liste mit einem
// Element" und hat keinen eigenen, nachsichtigeren Codepfad. Geprüft wird am
// gerenderten Schritt 4, dass jeder gewählte Markt seine eigenen Zahlen
// mitbekommt und genau einmal: eine laufende Nummer statt des Kürzels hätte
// hier zwei Felder gleichen Namens oder verrutschte Werte erzeugt, und
// beides sähe im Browser wie ein gültiger Deal aus.
func TestSchritt4TraegtJedenMarktMitSeinenEigenenZahlen(t *testing.T) {
	srv, _ := testServer(t)

	f := referenzFormular(0)
	f.Add("zielmarkt", "IT")
	f.Set("vk.IT", "189,00")
	f.Set("fba.IT", "18,06")
	f.Set("provision.IT", "15")
	// baueDeal prüft inzwischen die Verkaufszahl jedes Marktes, nicht mehr
	// nur die des Leitmarkts — ohne sie schlüge der Post fehl, bevor diese
	// Zusicherungen überhaupt geprüft würden.
	f.Set("sales.IT", "12")

	schritt4 := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()

	for _, muss := range []string{
		`name="vk.DE" value="207,49"`, `name="fba.DE" value="8,64"`,
		`name="vk.IT" value="189,00"`, `name="fba.IT" value="18,06"`,
	} {
		if n := strings.Count(schritt4, muss); n != 1 {
			t.Errorf("Schritt 4 sendet %s %d-mal, will genau 1:\n%s", muss, n, schritt4)
		}
	}
	// Beide Märkte reisen mit, nicht nur der gerechnete.
	for _, muss := range []string{`name="zielmarkt" value="DE"`, `name="zielmarkt" value="IT"`} {
		if !strings.Contains(schritt4, muss) {
			t.Errorf("Schritt 4 trägt %s nicht weiter — der Markt fiele beim Posten weg:\n%s", muss, schritt4)
		}
	}
	// rechneDeal rechnet inzwischen jeden Markt einzeln — DE und IT
	// gleichermaßen —, und seit dieser Aufgabe nennt auch der Post-Text
	// beide: der Gewinn des Referenzfalls (Leitmarkt DE) UND der eigene
	// Gewinn des zweiten Marktes, jeder mit seinen eigenen Zahlen.
	//
	// Geprüft wird der Post-Text selbst (vorschauMuster), nicht die ganze
	// Seite: die Übersichtstabelle über den Märkten zeigt beide Zahlen
	// ohnehin schon, unabhängig vom Post — ein Treffer dort allein bewiese
	// nicht, dass baueDeal auch daten.Maerkte füllt.
	posttext := vorschauMuster.FindString(schritt4)
	if posttext == "" {
		t.Fatalf("keine Vorschau im Körper:\n%s", schritt4)
	}
	if !strings.Contains(posttext, "26,70") {
		t.Errorf("der Post-Text rechnet nicht mehr den Leitmarkt:\n%s", posttext)
	}
	if !strings.Contains(posttext, "0,61") {
		t.Errorf("der Post-Text nennt nicht den eigenen Gewinn von Amazon.IT (0,61 €):\n%s", posttext)
	}
}

// Schritt 3 bindet "verborgen-zahlen" nicht ein und führt das Feld darum
// selbst — hier darf es durch die Ergänzung des Blocks nicht doppelt werden.
func TestSchritt3SendetDieBildKennungGenauEinmal(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	schritt3 := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode()).Body.String()
	if n := strings.Count(schritt3, `name="bild_kennung"`); n != 1 {
		t.Errorf("Schritt 3 sendet bild_kennung %d-mal, will genau 1", n)
	}
}

// Schickt tatsächlich gerenderte input-Werte weiter, damit ein verlorenes
// hidden-Feld nicht durch ein von Hand gebautes Testformular verdeckt wird.
func bildFunnelWerte(t *testing.T, koerper, id string) url.Values {
	t.Helper()
	formular, ok := elementMitID(koerper, id)
	if !ok {
		t.Fatalf("Formular %s fehlt", id)
	}
	werte := url.Values{}
	value := regexp.MustCompile(`\bvalue="([^"]*)"`)
	for _, tag := range formElementMuster.FindAllString(formular, -1) {
		if !strings.HasPrefix(tag, "<input") {
			continue
		}
		name, wert := nameAttrMuster.FindStringSubmatch(tag), value.FindStringSubmatch(tag)
		if name != nil && wert != nil {
			werte.Add(name[1], html.UnescapeString(wert[1]))
		}
	}
	if got := werte["bild_kennung"]; len(got) != 1 || got[0] != "71bYHZQrjxL.jpg" {
		t.Fatalf("%s verliert/dupliziert Bildkennung: %v", id, got)
	}
	return werte
}

func TestBildDurchFunnelBisHistorie(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.Key = "testkey"
	ks := keepaServer(t)
	srv.keepa.BasisURL, srv.keepa.BasisURL = ks.URL, ks.URL
	cid, err := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: discordAttrappe(t).URL})
	if err != nil {
		t.Fatal(err)
	}
	f := schritt2Werte()
	const shop = "https://shop.example/artikel"
	f.Set("einkaufslink", shop)
	f.Set("link_bestaetigt", shop)
	f.Set("quell_url", shop)
	f.Set("ek_art", "netto")
	schritt3 := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String()
	zahlen := bildFunnelWerte(t, schritt3, "deal-formular")
	for _, station := range []struct{ route, id string }{{"/deal/preis", "deal-schritt2"}, {"/deal/start", "deal-schritt1"}} {
		bildFunnelWerte(t, hole(t, srv, http.MethodPost, station.route, zahlen.Encode()).Body.String(), station.id)
	}
	schritt4 := hole(t, srv, http.MethodPost, "/deal/vorschau", zahlen.Encode()).Body.String()
	senden := bildFunnelWerte(t, schritt4, "deal-vorschau")
	senden.Set("zurueck", "1")
	bildFunnelWerte(t, hole(t, srv, http.MethodPost, "/deal/laden", senden.Encode()).Body.String(), "deal-formular")
	senden.Del("zurueck")
	senden.Set("channel_id", itoa(cid))
	senden = bildFunnelWerte(t, hole(t, srv, http.MethodPost, "/deal/vorschau", senden.Encode()).Body.String(), "deal-vorschau")
	senden.Set("channel_id", itoa(cid))
	hole(t, srv, http.MethodPost, "/deal/senden", senden.Encode())
	ds, err := s.Deals(store.DealFilter{})
	if err != nil || len(ds) != 1 {
		t.Fatalf("Historie: %v, %v", ds, err)
	}
	if ds[0].BildKennung != "71bYHZQrjxL.jpg" || ds[0].EKArt != "netto" || ds[0].QuellURL != shop || ds[0].EKCent != 15798 {
		t.Fatalf("Funnel-Felder verloren: %+v", ds[0])
	}
	historie := hole(t, srv, http.MethodGet, "/historie", "").Body.String()
	for _, muss := range []string{"71bYHZQrjxL._SL160_.jpg", "71bYHZQrjxL._SL500_.jpg", "EK netto eingegeben", shop, `class="chip `} {
		if !strings.Contains(historie, muss) {
			t.Errorf("Historie verliert %q", muss)
		}
	}
}

func TestFrischerKeepaAufrufVerwirftAltesBild(t *testing.T) {
	for _, antwort := range []string{"ohne-key", "ohne-bild", "neues-bild"} {
		t.Run(antwort, func(t *testing.T) {
			srv, _ := testServer(t)
			erwartet := ""
			if antwort != "ohne-key" {
				srv.keepa.Key = "testkey"
				ks := keepaServer(t)
				if antwort == "ohne-bild" {
					ks = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Write([]byte(`{"products":[{"asin":"B01636IZ0G","title":"Ohne Bild"}]}`))
					}))
					t.Cleanup(ks.Close)
				} else {
					erwartet = "71bYHZQrjxL.jpg"
				}
				srv.keepa.BasisURL = ks.URL
			}
			f := schritt2Werte()
			f.Set("bild_kennung", "altesBild.jpg")
			koerper := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode()).Body.String()
			if strings.Contains(koerper, "altesBild.jpg") || !strings.Contains(koerper, `name="bild_kennung" value="`+erwartet+`"`) {
				t.Fatalf("Bildzustand nach %s falsch", antwort)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Einkaufsseite: keine Vorsteuer-Frage mehr, Preisvorschlag aus Keepa.

// Bei Reverse Charge stellt Amazon einem Geschäftskunden netto — es gibt gar
// keine Vorsteuer, die abziehbar oder nicht abziehbar sein könnte. Die Frage
// entfällt darum ganz; die Kosten sind immer die Nettogröße, also genau das,
// was bisher schon die Vorgabe war.
func TestSchritt2FragtNichtMehrNachVorsteuer(t *testing.T) {
	srv, _ := testServer(t)
	koerper := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"}}.Encode()).Body.String()

	if strings.Contains(koerper, "Vorsteuer nicht abziehbar") {
		t.Error("Schritt 2 fragt weiterhin nach der Vorsteuer")
	}
	if strings.Contains(koerper, `name="ust_modus"`) {
		t.Error("Schritt 2 sendet weiterhin ein ust_modus-Feld")
	}
}

func TestGespeicherterDealIstImmerNetto(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: discordAttrappe(t).URL})

	f := referenzFormular(cid)
	// Selbst wenn jemand den alten Wert von Hand mitschickt, darf er nicht
	// mehr in die Rechnung geraten.
	f.Set("ust_modus", "brutto")
	if w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode()); w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	ds, _ := s.Deals(store.DealFilter{Limit: 10})
	if len(ds) != 1 {
		t.Fatalf("%d Deals, will 1", len(ds))
	}
	if ds[0].UStModus != "netto" {
		t.Errorf("UStModus = %q, will netto", ds[0].UStModus)
	}
}

// Der Einkaufspreis liegt auf dem Quellmarkt, nicht auf dem Zielmarkt. Keepa
// wird dafür eigens für den Quellmarkt abgefragt; der Vorschlag steht brutto
// im Feld, so wie er im Shop steht — brutto ist die Vorgabe.
func TestSchritt2SchlaegtAmazonPreisAusKeepaVor(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	koerper := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"}}.Encode()).Body.String()

	// Amazon aktuell 214,98 € brutto.
	if !strings.Contains(koerper, `value="214,98"`) {
		t.Errorf("Schritt 2 schlägt den Keepa-Preis nicht brutto vor:\n%s", koerper)
	}
	if !strings.Contains(koerper, `value="brutto"
        checked`) || strings.Contains(koerper, `value="netto"
        checked`) {
		t.Error("der Schalter steht nicht auf brutto")
	}
}

// Ein Fremdshop hat keinen Amazon-Preis. Der Abruf muss unterbleiben, statt
// einen Preis vom falschen Markt vorzuschlagen.
func TestSchritt2SchlaegtBeiFremdshopNichtsVor(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey"
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL

	f := url.Values{
		"einkaufslink": {"https://www.mediamarkt.de/de/product/_makita-2745899.html"},
		"asin":         {"B01636IZ0G"}, "quellmarkt": {"DE"},
	}
	f.Set("link_bestaetigt", f.Get("einkaufslink"))
	koerper := hole(t, srv, http.MethodPost, "/deal/preis", f.Encode()).Body.String()

	if strings.Contains(koerper, `value="214,98"`) {
		t.Error("bei einem Fremdshop-Einkauf wird ein Amazon-Preis vorgeschlagen")
	}
}

// Schritt 3 zeigte bisher nur die Eingabefelder des Leitmarkts, obwohl der
// Funnel längst eine Liste von Zielmärkten trägt und jeden einzeln rechnet
// (Task 6). Diese Prüfung deckt die fehlende zweite Spalte auf: gewählt sind
// DE und IT, gerendert werden soll für beide je eine eigene Spalte der
// Eingabetabelle.
func TestSchritt3ZeigtEineSpalteJeMarkt(t *testing.T) {
	srv, _ := testServer(t)
	srv.keepa.Key = "testkey" // siehe Kommentar in TestLadenFuelltFormular
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	v := schritt2Werte()
	v["zielmarkt"] = []string{"DE", "IT"}

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	koerper := w.Body.String()

	for _, feld := range []string{
		`name="vk.DE"`, `name="vk.IT"`,
		`name="sales.DE"`, `name="sales.IT"`,
		`name="provision.DE"`, `name="provision.IT"`,
		`name="fba.DE"`, `name="fba.IT"`,
	} {
		if !strings.Contains(koerper, feld) {
			t.Errorf("Schritt 3 hat kein %s:\n%s", feld, koerper)
		}
	}
}

// ladeDeal fragte bisher nur den Leitmarkt bei Keepa ab — die übrigen Spalten
// aus TestSchritt3ZeigtEineSpalteJeMarkt blieben leer. Diese Prüfung deckt
// auf, dass jeder gewählte Zielmarkt seinen eigenen Keepa-Abruf bekommt.
func TestLadenHoltJedenMarktEinzeln(t *testing.T) {
	srv, _ := testServer(t)
	ks := keepaServer(t)
	srv.keepa.Key = "testkey"
	srv.keepa.BasisURL = ks.URL

	v := schritt2Werte()
	v["zielmarkt"] = []string{"DE", "IT"}

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	koerper := w.Body.String()
	// Beide Spalten sind mit Keepa-Werten vorbelegt, nicht nur die erste.
	if strings.Count(koerper, `value="keepa"`) < 2 {
		t.Errorf("nicht beide Märkte aus Keepa vorbelegt:\n%s", koerper)
	}
}

// Drei brauchbare Märkte sind besser als vier verweigerte: scheitert Keepa
// für einen Markt, tragen die anderen weiter ihre Zahlen und der betroffene
// die Standardwerte samt Hinweis.
func TestLadenUeberlebtEinenFehlschlagJeMarkt(t *testing.T) {
	srv, s := testServer(t)
	// Der Test-Server antwortet nur für die DE-Domain (3); jede andere
	// Domain bekommt einen Serverfehler.
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("domain") != "3" {
			http.Error(w, "kaputt", http.StatusInternalServerError)
			return
		}
		roh, _ := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	t.Cleanup(ks.Close)
	srv.keepa.Key = "testkey"
	srv.keepa.BasisURL = ks.URL
	_ = s.SetzeEinstellung(store.SchluesselProvision, "15")

	v := schritt2Werte()
	v["zielmarkt"] = []string{"DE", "IT"}

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, "Keepa nicht erreicht") {
		t.Errorf("kein Hinweis auf den fehlgeschlagenen Markt:\n%s", koerper)
	}
	// Der Standardwert für die Provision steht in der IT-Spalte.
	if !strings.Contains(koerper, "standardwert") {
		t.Errorf("IT hat keine Standardwerte bekommen:\n%s", koerper)
	}
	// Und DE hat trotzdem echte Keepa-Werte.
	if !strings.Contains(koerper, `value="keepa"`) {
		t.Errorf("DE hat keine Keepa-Werte:\n%s", koerper)
	}
	// Der Fehlertext eines gescheiterten Abrufs kann von einem *url.Error
	// stammen, dessen Anfrage-URL den API-Key als Query-Parameter trägt.
	// Ohne sicherFehlertext stünde er im Klartext auf dieser Seite.
	if strings.Contains(koerper, "key=") {
		t.Errorf("die Seite trägt einen Keepa-Key im Fehlertext:\n%s", koerper)
	}
}

// TestSchritt2BietetJedenMarktAlsKaestchen prüft die Umstellung von Task 10:
// Schritt 2 bot bisher genau ein <select> für den Zielmarkt an, aus dem sich
// nur ein einziger Markt wählen ließ, obwohl der Funnel längst mehrere
// gleichzeitig rechnet und postet (Task 6/8). Jetzt steht dort für jeden
// geführten Markt ein eigenes Kästchen, dazu ein Radio-Knopf für den
// Leitmarkt — den Markt, an dem Artikelname, Bild, Chart und die
// Historienzeile hängen.
func TestSchritt2BietetJedenMarktAlsKaestchen(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"}}.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, `type="checkbox" name="zielmarkt"`) {
		t.Errorf("Schritt 2 hat keine Kästchen:\n%s", koerper)
	}
	if !strings.Contains(koerper, `type="radio" name="leitmarkt"`) {
		t.Errorf("Schritt 2 hat keine Leitmarkt-Wahl:\n%s", koerper)
	}
}

// checktMarkt prüft, ob irgendwo im HTML ein Element mit diesem Wert
// angehakt ist — unabhängig von der Einrückung dazwischen. Ein reiner
// Teilstring-Vergleich wie `value="DE" checked` bräche an der Einrückung
// dieser Vorlage: die Vorlage bricht das Attribut aus Lesbarkeit auf eine
// neue, eingerückte Zeile um (siehe dieselbe Zeilenumbruch-Konvention beim
// bestehenden ek_art-Schalter), und zwischen dem schließenden Anführungszeichen
// und "checked" stehen dann mehrere Leerzeichen statt eines einzigen.
func checktMarkt(html, code string) bool {
	return regexp.MustCompile(`value="` + code + `"\s+checked`).MatchString(html)
}

// TestSchritt2HaktDieStandardMaerkteAn deckt ab, dass die Vorauswahl aus den
// Einstellungen tatsächlich als angehakte Kästchen ankommt, nicht nur als
// Liste im Formular.
//
// Abweichung vom Aufgabenzettel: dort stand diese Prüfung gegen GET "/". Das
// geht nicht — "/" liefert immer Schritt 1 aus (siehe zeigeDeal/"deal" in
// deal.html: "Ein Neuladen der Seite beginnt darum sauber von vorn"), und
// Schritt 1 kennt gar kein Zielmarkt-Kästchen, nur die verborgenen Felder
// aus "verborgen-maerkte". Angehakte Kästchen zeigt frühestens Schritt 2,
// und dorthin führt aus einer frischen Anfrage nur POST /deal/preis (auch
// preisDeal ruft standardMaerkteSetzen auf, siehe deal.go) — genau der Weg,
// den auch TestSchritt2BietetJedenMarktAlsKaestchen oben nimmt. Geprüft wird
// hier also derselbe Übergang, nur mit einer vorab gesetzten Einstellung.
func TestSchritt2HaktDieStandardMaerkteAn(t *testing.T) {
	srv, s := testServer(t)
	if err := s.SetzeEinstellung(store.SchluesselZielmarkt, "DE,IT"); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}

	w := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"}}.Encode())
	koerper := w.Body.String()
	for _, code := range []string{"DE", "IT"} {
		if !checktMarkt(koerper, code) {
			t.Errorf("Schritt 2 hakt %q nicht an:\n%s", code, koerper)
		}
	}
}

// Ohne Zielmarkt gibt es nichts zu laden. Die Rückfrage bleibt in Schritt 2,
// statt in Schritt 3 als Rechenfehler aufzuschlagen.
func TestLadenOhneMarktBleibtInSchritt2(t *testing.T) {
	srv, _ := testServer(t)

	v := schritt2Werte()
	delete(v, "zielmarkt")
	delete(v, "leitmarkt")

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	koerper := w.Body.String()
	if !strings.Contains(koerper, schritt2Kennung) {
		t.Errorf("nicht in Schritt 2 geblieben:\n%s", koerper)
	}
	if !strings.Contains(koerper, "Zielmarktplatz") {
		t.Errorf("keine Rückfrage nach dem Zielmarktplatz:\n%s", koerper)
	}
}

// keepaServerOhneMasseFuer liefert die übliche Fixture, lässt aber für genau
// eine Domain die Paketmaße weg — so, wie Keepa es tut, wenn es sie für einen
// Marktplatz nicht kennt (dort steht dann -1).
func keepaServerOhneMasseFuer(t *testing.T, domain string) *httptest.Server {
	t.Helper()
	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	var antwort map[string]any
	if err := json.Unmarshal(roh, &antwort); err != nil {
		t.Fatalf("Fixture nicht lesbar: %v", err)
	}
	produkt := antwort["products"].([]any)[0].(map[string]any)
	for _, feld := range []string{"packageLength", "packageWidth", "packageHeight", "packageWeight"} {
		if _, da := produkt[feld]; !da {
			t.Fatalf("%s steht nicht in der Fixture — der Test misst nichts", feld)
		}
		produkt[feld] = -1
	}
	ohneMasse, err := json.Marshal(antwort)
	if err != nil {
		t.Fatalf("Fixture nicht schreibbar: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("domain") == domain {
			w.Write(ohneMasse)
			return
		}
		w.Write(roh)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// Die Paketmaße sind eine Eigenschaft des Pakets, nicht des Marktplatzes.
// Kennt Keepa sie für Italien nicht, für Deutschland aber schon, muss Italien
// trotzdem seinen EFN-Tarif bekommen.
//
// Fällt es statt dessen auf Keepas Gebühr zurück, ist das die LOKALE Gebühr
// des Zielmarkts — die für Ware, die dort bereits liegt. Sie beträgt je nach
// Klasse ein Drittel bis zwei Drittel des EFN-Tarifs, und der Deal sähe damit
// viel zu gut aus. Genau diese Fehlerrichtung ist die gefährliche, und genau
// sie ist eingetreten, solange die Gebühr aus den Maßen der jeweiligen
// Keepa-Antwort statt aus den gemeinsamen bestimmt wurde.
func TestFehlendeMasseEinesMarktesNutzenDieDesAnderen(t *testing.T) {
	srv, _ := testServer(t)
	ks := keepaServerOhneMasseFuer(t, "8") // 8 ist Keepas Domain für IT
	srv.keepa.Key = "testkey"
	srv.keepa.BasisURL = ks.URL
	srv.keepa.BasisURL = ks.URL

	v := schritt2Werte()
	v["zielmarkt"] = []string{"DE", "IT"}
	v.Set("leitmarkt", "DE")

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	koerper := w.Body.String()

	quelle := regexp.MustCompile(`name="fba_quelle\.IT" value="([^"]*)"`).FindStringSubmatch(koerper)
	if quelle == nil {
		t.Fatalf("kein fba_quelle.IT im Formular — der Test misst nichts:\n%s", koerper)
	}
	if !strings.Contains(quelle[1], "EFN-Tarif") {
		t.Errorf("IT bekam die Gebühr aus %q statt aus dem EFN-Tarif — die Maße von DE wurden nicht benutzt", quelle[1])
	}
}

// Das Fragment "rechnung" wird in Schritt 3 UND in der Vorschau gerendert.
// Die Knöpfe darin zeigen aber fest auf #rechnung und #deal-formular — beides
// gibt es in Schritt 4 nicht, das Formular heißt dort #deal-vorschau. Ein
// Klick liefe in einen htmx:targetError und täte nichts. Also dürfen sie dort
// gar nicht erst stehen.
func TestSchritt4ZeigtKeineAufschluesselnKnoepfe(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: "https://x/1"})

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, "id=\"deal-vorschau\"") {
		t.Fatalf("nicht in Schritt 4 gelandet — der Test misst nichts:\n%s", koerper)
	}
	if strings.Contains(koerper, `hx-target="#rechnung"`) {
		t.Errorf("Schritt 4 rendert einen Knopf auf #rechnung, das es dort nicht gibt:\n%s", koerper)
	}
}

// Jeder Markt trägt seine eigene Aufschlüsselung hinter dem Taschenrechner
// seiner Zeile. Früher gab es genau einen Kassenbon unter der Übersicht, und
// welcher Markt darin stand, klärten ein Klick und eine zweite Anfrage — wer
// zwei Märkte vergleichen wollte, sah nie beide zugleich.
func TestJederMarktTraegtSeineEigeneRechnung(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", zweiMaerkte().Encode())
	koerper := w.Body.String()

	for _, markt := range []string{"Amazon.DE", "Amazon.IT"} {
		if !strings.Contains(koerper, "Verkauf über "+markt) {
			t.Errorf("die Aufschlüsselung von %s fehlt:\n%s", markt, koerper)
		}
	}
	if strings.Contains(koerper, "aufschlüsseln") {
		t.Errorf("der Knopf zum Umschalten steht noch da, obwohl jede Zeile ihre Rechnung mitbringt:\n%s", koerper)
	}
}

// nurText nimmt einem HTML-Ausschnitt seine Tags. Die Deal-Karte trägt ihre
// Zahlen inzwischen in Fettschrift und ihre Links als <a>; die Prüfungen
// weiter oben fragen aber nach dem, was ein Leser sieht, und das ist der
// Text. Wo es auf ein Linkziel ankommt, prüfen die Tests weiterhin direkt
// auf href — dafür ist diese Funktion nicht gedacht.
func nurText(roh string) string {
	roh = strings.ReplaceAll(roh, "<br>", "\n")
	return html.UnescapeString(htmlTagMuster.ReplaceAllString(roh, ""))
}

var htmlTagMuster = regexp.MustCompile(`(?s)<[^>]*>`)

// Eine Ziel-Marge schlägt den eingetippten VK. Tippt man im VK-Feld, muss
// sie darum weg — sonst rechnet Schritt 4 still mit dem Preis zur Ziel-Marge.
func TestVKEingabeLeertZielMarge(t *testing.T) {
	srv, s := testServer(t)
	srv.keepa.BasisURL = keepaServer(t).URL
	srv.keepa.Key = "k"
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	h := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode()).Body.String()
	if !strings.Contains(h, `this.form[&#39;zielmarge.DE&#39;].value=&#39;&#39;`) &&
		!strings.Contains(h, `this.form['zielmarge.DE'].value=''`) {
		t.Errorf("VK-Feld leert die Ziel-Marge nicht")
	}
}
