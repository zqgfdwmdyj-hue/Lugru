package store

import (
	"testing"
	"time"
)

func TestMonitorProdukte(t *testing.T) {
	s := oeffneTest(t)
	id, err := s.MonitorProduktAnlegen(MonitorProdukt{URL: "https://www.billiger.de/pricelist/1-x", Shops: "OTTO, Kaufland", MaxEK: 39999, Aktiv: true, ASIN: "b0abc12345"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.MonitorProduktAnlegen(MonitorProdukt{URL: "https://www.billiger.de/pricelist/1-x"}); err == nil {
		t.Error("dieselbe URL zweimal angelegt")
	}
	// Ein weiterer Verkaufsweg wird am vorhandenen Produkt angehakt, nicht
	// als zweites Produkt angelegt.
	if _, err := s.MonitorProduktAnlegen(MonitorProdukt{URL: "https://www.billiger.de/pricelist/1-x", Modus: ModusAnkauf, Ankauf: 100}); err == nil {
		t.Error("dieselbe URL als Ankauf doppelt angelegt")
	}
	if v, ok := s.MonitorProduktZuURL("https://www.billiger.de/pricelist/1-x"); !ok || v.ID != id {
		t.Errorf("MonitorProduktZuURL: %+v %v", v, ok)
	}
	if got := ModiNormal("ebay, amazon,quatsch", "ankauf"); got != "amazon,ankauf,ebay" {
		t.Errorf("ModiNormal = %q", got)
	}
	p, err := s.MonitorProdukt(id)
	if err != nil {
		t.Fatal(err)
	}
	if p.ASIN != "B0ABC12345" || p.MaxEK != 39999 || !p.Aktiv {
		t.Errorf("p = %+v", p)
	}

	// Name, EAN und ASIN werden nur ergänzt, nie überschrieben.
	jetzt := time.Now()
	if err := s.MonitorGeprueft(id, jetzt, "ok", "OTTO", 35000, "PS5", "711719", "B0ANDERS00"); err != nil {
		t.Fatal(err)
	}
	p, _ = s.MonitorProdukt(id)
	if p.Name != "PS5" || p.EAN != "711719" || p.ASIN != "B0ABC12345" || p.BesterShop != "OTTO" {
		t.Errorf("nach Prüfung: %+v", p)
	}

	if f, _ := s.MonitorFaellig(time.Minute, jetzt.Add(30*time.Second)); len(f) != 0 {
		t.Errorf("zu früh fällig: %d", len(f))
	}
	if f, _ := s.MonitorFaellig(time.Minute, jetzt.Add(2*time.Minute)); len(f) != 1 {
		t.Errorf("nicht fällig: %d", len(f))
	}
	_ = s.MonitorProduktAktiv(id, false)
	if f, _ := s.MonitorFaellig(time.Minute, jetzt.Add(2*time.Minute)); len(f) != 0 {
		t.Error("inaktives Produkt fällig")
	}

	if err := s.MonitorBewertet(id, "OTTO", 35000, jetzt); err != nil {
		t.Fatal(err)
	}
	p, _ = s.MonitorProdukt(id)
	if p.BewertetShop != "OTTO" || p.BewertetCent != 35000 {
		t.Errorf("bewertet: %+v", p)
	}
	p.Shops = "OTTO"
	if err := s.MonitorProduktAendern(p); err != nil {
		t.Fatal(err)
	}
	p, _ = s.MonitorProdukt(id)
	if p.BewertetShop != "" {
		t.Error("Ändern hat den bewerteten Einkauf nicht vergessen")
	}
}

func TestMonitorRegelnUndTreffer(t *testing.T) {
	s := oeffneTest(t)
	pid, _ := s.MonitorProduktAnlegen(MonitorProdukt{URL: "u", Aktiv: true})
	if _, err := s.MonitorRegelAnlegen(MonitorRegel{ChannelID: 4, ProduktID: pid, MinMarge: 15, Aktiv: true}); err != nil {
		t.Fatal(err)
	}
	r, _ := s.MonitorRegeln()
	if len(r) != 1 || r[0].MinMarge != 15 || r[0].ChannelID != 4 {
		t.Fatalf("Regeln = %+v", r)
	}

	vorher := time.Now().Add(-time.Hour)
	if _, ok := s.MonitorZuletztGepostet(pid, "", vorher); ok {
		t.Error("ohne Treffer gepostet")
	}
	_ = s.MonitorTrefferAnlegen(MonitorTreffer{ProduktID: pid, Shop: "OTTO", Gesamt: 100, Ergebnis: "unter Schwelle"})
	if _, ok := s.MonitorZuletztGepostet(pid, "", vorher); ok {
		t.Error("ungeposteter Treffer zählt als gepostet")
	}
	_ = s.MonitorTrefferAnlegen(MonitorTreffer{ProduktID: pid, Shop: "OTTO", Gesamt: 90, Gepostet: true})
	if g, ok := s.MonitorZuletztGepostet(pid, "", vorher); !ok || g.Gesamt != 90 {
		t.Errorf("zuletzt gepostet = %+v, %v", g, ok)
	}
	if l, _ := s.MonitorLetzteTreffer(10); len(l) != 2 || !l[0].Gepostet {
		t.Errorf("Treffer = %+v", l)
	}

	if err := s.MonitorProduktLoeschen(pid); err != nil {
		t.Fatal(err)
	}
	if r, _ := s.MonitorRegeln(); len(r) != 0 {
		t.Error("Regel des gelöschten Produkts übrig")
	}
}

func TestShopPasst(t *testing.T) {
	for _, f := range []struct {
		liste, shop string
		will        bool
	}{
		{"", "OTTO", true},
		{"otto", "OTTO", true},
		{"Kaufland, OTTO", "Kaufland.de", true},
		{"kaufland\nmediamarkt", "Cyberport", false},
		{"MediaMarkt, Saturn", "Media Markt Online Shop", true},
		{"media-markt", "Media Markt Online Shop", true},
		{"saturn", "Saturn Online Shop", true},
	} {
		if got := ShopPasst(f.liste, f.shop); got != f.will {
			t.Errorf("ShopPasst(%q, %q) = %v", f.liste, f.shop, got)
		}
	}
}
