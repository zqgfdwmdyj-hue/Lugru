package web

import (
	"net/http"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func historieDeal(s *store.Store, cid int64, asin, titel string) {
	s.DealAnlegen(store.Deal{
		ASIN: asin, Titel: titel, Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, VKCent: 20749, GewinnCent: 3167, MargeProzent: 15.26,
		ChannelID: cid, ChannelName: "deals-vip",
		NachrichtText: "🛒 " + titel + " " + asin,
	})
}

func TestHistorieZeigtDeals(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals-vip", WebhookURL: "https://x/1"})
	historieDeal(s, cid, "B01636IZ0G", "Makita HR2630")

	w := hole(t, srv, http.MethodGet, "/historie", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d", w.Code)
	}
	koerper := w.Body.String()
	for _, muss := range []string{"B01636IZ0G", "Makita HR2630", "deals-vip", "31,67"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Historie enthält %q nicht", muss)
		}
	}
}

func TestHistorieSuche(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	historieDeal(s, cid, "B01636IZ0G", "Makita HR2630")
	historieDeal(s, cid, "B0BOSCH1234", "Bosch GBH")

	w := hole(t, srv, http.MethodGet, "/historie?suche=Bosch", "")
	koerper := w.Body.String()
	if !strings.Contains(koerper, "Bosch GBH") {
		t.Error("Treffer fehlt")
	}
	if strings.Contains(koerper, "Makita HR2630") {
		t.Error("Nicht-Treffer wird angezeigt")
	}
}

func TestHistorieLeer(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodGet, "/historie", "")
	if w.Code != http.StatusOK {
		t.Errorf("Status = %d, will 200 auch ohne Deals", w.Code)
	}
}

func TestHistorieChartAusliefern(t *testing.T) {
	srv, s := testServer(t)
	png := []byte("\x89PNG\r\n\x1a\nARCHIV")
	datei, err := s.ChartSpeichern("B01636IZ0G", png)
	if err != nil {
		t.Fatalf("ChartSpeichern: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/historie/chart/"+datei, "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d", w.Code)
	}
	if w.Header().Get("Content-Type") != "image/png" {
		t.Errorf("Content-Type = %q", w.Header().Get("Content-Type"))
	}
	if w.Body.String() != string(png) {
		t.Error("Bildinhalt weicht ab")
	}
}

func TestHistorieChartLaesstNichtAusbrechen(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodGet, "/historie/chart/..%2F..%2Fdeals.db", "")
	if w.Code == http.StatusOK {
		t.Error("ein Pfad aus dem Chart-Ordner heraus wurde ausgeliefert")
	}
}

func TestHistorieZeigtThumbnailUndVergroesserung(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(store.Deal{
		ASIN: "B01636IZ0G", Titel: "Makita HR2630", ChannelID: cid, ChannelName: "c",
		BildKennung: "71bYHZQrjxL.jpg",
	})

	koerper := hole(t, srv, http.MethodGet, "/historie", "").Body.String()
	for _, muss := range []string{
		"https://m.media-amazon.com/images/I/71bYHZQrjxL._SL160_.jpg",
		"https://m.media-amazon.com/images/I/71bYHZQrjxL._SL500_.jpg",
		`class="lupe"`,
		// Ohne fokussierbares Element greift die :focus-within-Regel im
		// Stylesheet nie und die Vergrößerung wäre reine Mausfunktion.
		`tabindex="0"`,
	} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Historie enthält %q nicht", muss)
		}
	}
}

// Alle vor dieser Änderung geposteten Deals haben keine Kennung. Für sie darf
// kein img entstehen — ein leeres src lädt sonst die Seite selbst nach.
func TestHistorieOhneBildKennungZeigtKeinBild(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	historieDeal(s, cid, "B01636IZ0G", "Makita HR2630")

	koerper := hole(t, srv, http.MethodGet, "/historie", "").Body.String()
	if strings.Contains(koerper, `class="lupe"`) {
		t.Error("Historie zeigt eine Lupe, obwohl der Deal keine Bild-Kennung hat")
	}
	if strings.Contains(koerper, "m.media-amazon.com") {
		t.Error("Historie verlinkt Amazon, obwohl der Deal keine Bild-Kennung hat")
	}
}

func TestZahlklasseTrenntPositivNegativNull(t *testing.T) {
	faelle := []struct {
		wert float64
		will string
	}{
		{31.67, "positiv"},
		{0.01, "positiv"},
		{-12.5, "negativ"},
		{-0.01, "negativ"},
		// Ein Nulldeal ist weder Gewinn noch Verlust. Ein grüner Chip auf
		// 0,00 € wäre eine Aussage, die die Zahl nicht hergibt.
		{0, "neutral"},
	}
	for _, f := range faelle {
		if got := zahlklasse(f.wert); got != f.will {
			t.Errorf("zahlklasse(%v) = %q, will %q", f.wert, got, f.will)
		}
	}
}

func TestHistorieZeigtDieMaerkteEinesPosts(t *testing.T) {
	srv, s := testServer(t)

	d := store.Deal{
		ASIN: "B01636IZ0G", Titel: "Makita HR2630",
		Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, EKArt: "brutto", VKCent: 20749,
		Sales: 40, ProvisionProzent: 15, FBACent: 864,
		UStModus: "netto", GewinnCent: 2670, MargeProzent: 12.9,
		ChannelID: 1, ChannelName: "deals", NachrichtText: "Text",
		Maerkte: []store.DealMarkt{
			{Markt: "DE", Leitmarkt: true, VKCent: 20749, Sales: 40,
				ProvisionProzent: 15, FBACent: 864, GewinnCent: 2670, MargeProzent: 12.9},
			{Markt: "IT", VKCent: 18900, Sales: 12,
				ProvisionProzent: 15, FBACent: 1806, GewinnCent: 320, MargeProzent: 1.7,
				PanEU: &store.DealMarktPanEU{FBACent: 577, GewinnCent: 1548, MargeProzent: 8.2}},
		},
	}
	if _, err := s.DealAnlegen(d); err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/historie", "")
	koerper := w.Body.String()
	for _, muss := range []string{"IT", "189,00", "3,20", "15,48"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Historie enthält %q nicht:\n%s", muss, koerper)
		}
	}

	// Der Leitmarkt DE hat in diesem Deal keinen Pan-EU-Vergleich (PanEU ist
	// nil). Seine drei Pan-EU-Spalten müssen leer bleiben, statt ein
	// "0,00 €" zu zeigen, das niemand gerechnet hat — dieselben zwei
	// Zellen stehen nebeneinander nur, wenn beide leer sind.
	if !strings.Contains(koerper, `<td class="zahl"></td><td class="zahl"></td>`) {
		t.Errorf("Pan-EU-Spalten des Leitmarkts sind nicht leer:\n%s", koerper)
	}
}

// Jeder bisherige Deal hat keine Marktzeilen. Die Historie zeigt dann kein
// leeres Aufklappen, sondern gar keines.
func TestHistorieOhneMaerkteZeigtKeineMarkttabelle(t *testing.T) {
	srv, s := testServer(t)
	if _, err := s.DealAnlegen(store.Deal{
		ASIN: "B01636IZ0G", Titel: "Alt", Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, VKCent: 20749, ChannelID: 1, ChannelName: "deals",
		NachrichtText: "Text",
	}); err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/historie", "")
	if strings.Contains(w.Body.String(), "Zielmärkte") {
		t.Errorf("leere Markttabelle bei einem alten Deal:\n%s", w.Body.String())
	}
}

func TestHistorieChiptSpaltenGewinnUndMarge(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(store.Deal{
		ASIN: "B000GUT", Titel: "Guter Deal", ChannelID: cid, ChannelName: "c",
		GewinnCent: 3167, MargeProzent: 15.26,
	})
	s.DealAnlegen(store.Deal{
		ASIN: "B000MIES", Titel: "Verlustdeal", ChannelID: cid, ChannelName: "c",
		GewinnCent: -450, MargeProzent: -3.2,
	})

	koerper := hole(t, srv, http.MethodGet, "/historie", "").Body.String()
	if !strings.Contains(koerper, `class="chip positiv"`) {
		t.Error("der profitable Deal bekommt keinen positiven Chip")
	}
	if !strings.Contains(koerper, `class="chip negativ"`) {
		t.Error("der Verlustdeal bekommt keinen negativen Chip")
	}
}
