package mydealz

import (
	"os"
	"strings"
	"testing"
)

func TestLies(t *testing.T) {
	roh, err := os.ReadFile("testdata/deals.xml")
	if err != nil {
		t.Fatal(err)
	}
	ds, err := Lies(roh)
	if err != nil {
		t.Fatal(err)
	}
	if len(ds) != 4 {
		t.Fatalf("%d Deals", len(ds))
	}
	if ds[1].Haendler != "Amazon" || ds[1].Preis != 3499 || ds[1].Link == "" || ds[1].Zeit.IsZero() {
		t.Errorf("Deal = %+v", ds[1])
	}
}

func TestPasst(t *testing.T) {
	for _, f := range []struct {
		titel, stichworte string
		will              bool
	}{
		{"Sony PlayStation 5 Pro (PS5 Pro) für 649€ bei MediaMarkt", "ps5 pro", true},
		{"Sony PlayStation 5 Pro für 649€", "ps5 pro, playstation 5 pro", true},
		{"PS5 DualSense Controller Pro", "ps5 pro, -controller, -dualsense", false},
		{"PS5 Slim Digital", "ps5 pro", false},
		{"Starlink Mini Kit für 199€", "starlink mini", true},
		{"RTX5080 Gaming OC", "rtx 5080", true},
		{"irgendwas", "", false},
	} {
		if got := Passt(f.titel, f.stichworte); got != f.will {
			t.Errorf("Passt(%q, %q) = %v", f.titel, f.stichworte, got)
		}
	}
}

func TestLeasingFeed(t *testing.T) {
	roh, _ := os.ReadFile("testdata/leasing.xml")
	ds, err := Lies(roh)
	if err != nil || len(ds) != 3 {
		t.Fatalf("%d Deals, %v", len(ds), err)
	}
	if ds[0].Kategorie == "" || ds[0].Text == "" {
		t.Errorf("Deal = %+v", ds[0])
	}
	l := LiesLeasing(ds[0])
	if l.Faktor != 0.53 || l.Rate != 28500 || l.Monate != 24 || l.Art != "privat" || l.Gesamtkostenfaktor == 0 {
		t.Errorf("Leasing 0 = %+v", l)
	}
	// Im gekürzten Testbeispiel steht der LF nicht mehr, wohl aber der GKF.
	if l := LiesLeasing(ds[2]); l.Art != "gewerbe" || l.Gesamtkostenfaktor != 0.68 || l.Rate != 32700 {
		t.Errorf("Leasing 2 = %+v", l)
	}
	if l := LiesLeasing(Deal{Titel: "[Privatleasing] Cupra Formentor | 265€/M | 10tkm/J | 24Mo | 0,45LF"}); l.Faktor != 0.45 || l.Rate != 26500 {
		t.Errorf("LF nachgestellt = %+v", l)
	}
}

func TestTrendingTemperatur(t *testing.T) {
	roh, _ := os.ReadFile("testdata/trending.xml")
	ds, _ := Lies(roh)
	if len(ds) != 3 || !ds[0].TemperaturBekannt || ds[0].Temperatur != 177 || strings.HasPrefix(ds[0].Titel, "177") {
		t.Errorf("Trending = %+v", ds[0])
	}
}

func TestGutscheincode(t *testing.T) {
	for text, will := range map[string]string{
		"Mit dem Code SPAR10 gibt es 10 € Rabatt":   "SPAR10",
		"Gutscheincode: „HERBST25“ im Warenkorb":    "HERBST25",
		"kein Code notwendig, Preis direkt im Shop": "",
		"Code eingeben und sparen":                  "",
	} {
		if got := gutscheincode(text); got != will {
			t.Errorf("%q → %q, will %q", text, got, will)
		}
	}
}
