package keepa

import (
	"errors"
	"fmt"
	"os"
	"testing"
	"time"
)

func fixture(t *testing.T) Antwort {
	t.Helper()
	roh, err := os.ReadFile("testdata/produkt.json")
	if err != nil {
		t.Fatalf("Fixture nicht lesbar: %v", err)
	}
	a, err := ParseAntwort(roh)
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	return a
}

func TestStammdaten(t *testing.T) {
	p := fixture(t).Produkt
	if p.ASIN != "B01636IZ0G" {
		t.Errorf("ASIN = %q", p.ASIN)
	}
	if p.Marke != "Makita" {
		t.Errorf("Marke = %q, will Makita", p.Marke)
	}
	if p.Modell != "HR2630" {
		t.Errorf("Modell = %q, will HR2630", p.Modell)
	}
	if p.Titel == "" {
		t.Error("Titel ist leer")
	}
	if p.BildKennung != "71bYHZQrjxL.jpg" {
		t.Errorf("BildKennung = %q, will 71bYHZQrjxL.jpg", p.BildKennung)
	}
}

func TestPreiseUndMinusEins(t *testing.T) {
	p := fixture(t).Produkt

	if !p.BuyBoxAvg90.OK || p.BuyBoxAvg90.Cents != 20749 {
		t.Errorf("BuyBoxAvg90 = %+v, will {20749 true}", p.BuyBoxAvg90)
	}
	if !p.BuyBoxAktuell.OK || p.BuyBoxAktuell.Cents != 21286 {
		t.Errorf("BuyBoxAktuell = %+v, will {21286 true}", p.BuyBoxAktuell)
	}
	if !p.AmazonAktuell.OK || p.AmazonAktuell.Cents != 21498 {
		t.Errorf("AmazonAktuell = %+v, will {21498 true}", p.AmazonAktuell)
	}
	if !p.FBA.OK || p.FBA.Cents != 864 {
		t.Errorf("FBA = %+v, will {864 true}", p.FBA)
	}
}

func TestMinusEinsWirdNichtZuNull(t *testing.T) {
	roh := []byte(`{"tokensLeft":5,"products":[{"asin":"X","title":"t",
	  "stats":{"current":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
	           "avg90":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]}}]}`)
	a, err := ParseAntwort(roh)
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	for name, pr := range map[string]Price{
		"BuyBoxAvg90":   a.Produkt.BuyBoxAvg90,
		"BuyBoxAktuell": a.Produkt.BuyBoxAktuell,
		"AmazonAktuell": a.Produkt.AmazonAktuell,
		"FBA":           a.Produkt.FBA,
	} {
		if pr.OK {
			t.Errorf("%s.OK = true bei -1, will false", name)
		}
		if pr.Cents != 0 {
			t.Errorf("%s.Cents = %d, will 0 bei nicht gesetztem Wert", name, pr.Cents)
		}
	}
}

func TestBuyBoxVerlaufIstDreiergruppig(t *testing.T) {
	v := fixture(t).Produkt.BuyBoxVerlauf

	// Vier Dreiergruppen im Fixture, eine davon ohne Angebot (-1) -> drei Punkte.
	if len(v) != 3 {
		t.Fatalf("BuyBoxVerlauf hat %d Punkte, will 3 (der -1-Eintrag fällt weg): %+v", len(v), v)
	}
	will := []Punkt{
		{Minute: 7000000, Gesamt: 18500},       // 18500 + 0 Versand
		{Minute: 7002880, Gesamt: 19900 + 495}, // Preis plus Versand
		{Minute: 7004320, Gesamt: 21286},       // Versand -1 zählt als 0
	}
	for i, w := range will {
		if v[i] != w {
			t.Errorf("Punkt %d = %+v, will %+v", i, v[i], w)
		}
	}
}

func TestSalesQuelle(t *testing.T) {
	p := fixture(t).Produkt
	n, q := p.Sales()
	if n != 40 || q != SalesMonthlySold {
		t.Errorf("Sales() = (%d, %v), will (40, SalesMonthlySold)", n, q)
	}

	p.MonthlySold = 0
	n, q = p.Sales()
	if n != 37 || q != SalesRankDrops {
		t.Errorf("ohne monthlySold: Sales() = (%d, %v), will (37, SalesRankDrops)", n, q)
	}

	p.RankDrops30 = -1
	n, q = p.Sales()
	if n != 0 || q != SalesKeine {
		t.Errorf("ohne beides: Sales() = (%d, %v), will (0, SalesKeine)", n, q)
	}
}

func TestTokenFelder(t *testing.T) {
	a := fixture(t)
	if a.TokensLeft != 1183 {
		t.Errorf("TokensLeft = %d, will 1183", a.TokensLeft)
	}
	if a.TokensConsumed != 1 {
		t.Errorf("TokensConsumed = %d, will 1", a.TokensConsumed)
	}
	if a.RefillIn != 42*time.Second {
		t.Errorf("RefillIn = %v, will 42s", a.RefillIn)
	}
}

func TestLeereProduktliste(t *testing.T) {
	_, err := ParseAntwort([]byte(`{"tokensLeft":5,"products":[]}`))
	if !errors.Is(err, ErrNichtGefunden) {
		t.Errorf("will ErrNichtGefunden, bekam %v", err)
	}
}

func TestProvisionFehlt(t *testing.T) {
	a, err := ParseAntwort([]byte(`{"products":[{"asin":"X","title":"t"}]}`))
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	if a.Produkt.ProvisionProzent != nil {
		t.Errorf("ProvisionProzent = %v, will nil", *a.Produkt.ProvisionProzent)
	}
}

func TestParseAntwortLiestBildKennung(t *testing.T) {
	roh := []byte(`{"products":[{"asin":"B000","imagesCSV":"41Ny6ILlHnL.jpg,51QeQxxJ8ZL.jpg"}]}`)
	a, err := ParseAntwort(roh)
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	if a.Produkt.BildKennung != "41Ny6ILlHnL.jpg" {
		t.Errorf("BildKennung = %q, erwartet %q", a.Produkt.BildKennung, "41Ny6ILlHnL.jpg")
	}
}

// Keepa liefert imagesCSV nicht zu jedem Produkt. Das darf die übrigen Felder
// nicht kosten und keine erfundene Kennung erzeugen.
func TestParseAntwortOhneImagesCSV(t *testing.T) {
	roh := []byte(`{"products":[{"asin":"B000","title":"Ding"}]}`)
	a, err := ParseAntwort(roh)
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	if a.Produkt.BildKennung != "" {
		t.Errorf("BildKennung = %q, erwartet leer", a.Produkt.BildKennung)
	}
	if a.Produkt.Titel != "Ding" {
		t.Errorf("Titel = %q, erwartet %q", a.Produkt.Titel, "Ding")
	}
}

func TestPaketmasse(t *testing.T) {
	m := fixture(t).Produkt.Masse
	if m.LaengeMM != 400 || m.BreiteMM != 105 || m.HoeheMM != 320 {
		t.Errorf("Kanten = %d/%d/%d mm, will 400/105/320", m.LaengeMM, m.BreiteMM, m.HoeheMM)
	}
	// Das Paketgewicht, nicht itemWeight (3100 g): die Verpackung wiegt mit.
	if m.GewichtG != 4200 {
		t.Errorf("GewichtG = %d, will 4200 — packageWeight, nicht itemWeight", m.GewichtG)
	}
	if !m.Vollstaendig() {
		t.Error("Vollstaendig() = false, will true")
	}
}

func TestFehlendeMasseWerdenNull(t *testing.T) {
	// Keepa schreibt für Unbekanntes -1 oder 0. Beides muss hier zu 0
	// werden, sonst ergäbe -1 mm eine Kante, die in jede Klasse passt.
	roh := []byte(`{"products":[{"asin":"B0","packageLength":-1,"packageWidth":0,` +
		`"packageHeight":-1,"packageWeight":-1}]}`)
	a, err := ParseAntwort(roh)
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	m := a.Produkt.Masse
	if m.LaengeMM != 0 || m.BreiteMM != 0 || m.HoeheMM != 0 || m.GewichtG != 0 {
		t.Errorf("Masse = %+v, will überall 0", m)
	}
	if m.Vollstaendig() {
		t.Error("Vollstaendig() = true, will false")
	}
}

func TestVerkaufsverlaufOhneBuyBox(t *testing.T) {
	roh := `{"products":[{"asin":"B1","csv":[[100, 50000, 200, -1, 300, 52000],null,null,null,null,null,null,null,null,null,[150, 49000, 250, 51000]]}]}`
	a, err := ParseAntwort([]byte(roh))
	if err != nil {
		t.Fatal(err)
	}
	got := a.Produkt.Verkaufsverlauf()
	want := []Punkt{{100, 50000}, {150, 49000}, {250, 51000}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
