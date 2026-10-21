package mydealz

import (
	"os"
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
