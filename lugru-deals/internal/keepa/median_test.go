package keepa

import "testing"

func TestMedianZeitgewichtet(t *testing.T) {
	faelle := []struct {
		name    string
		punkte  []Punkt
		bis     int
		willOK  bool
		willVal int64
	}{
		{
			name:   "leer",
			punkte: nil, bis: 100, willOK: false,
		},
		{
			name:   "ein einziger Punkt",
			punkte: []Punkt{{0, 20000}},
			bis:    100, willOK: true, willVal: 20000,
		},
		{
			// 10000 hielt 90 Minuten, 90000 nur 10. Der Median muss 10000
			// sein — ein ungewichteter Median läge bei 50000.
			name:   "kurzer Ausreisser darf nicht durchschlagen",
			punkte: []Punkt{{0, 10000}, {90, 90000}},
			bis:    100, willOK: true, willVal: 10000,
		},
		{
			name:   "drei gleich lange Abschnitte",
			punkte: []Punkt{{0, 10000}, {10, 30000}, {20, 20000}},
			bis:    30, willOK: true, willVal: 20000,
		},
		{
			name:   "Reihenfolge der Preise ist egal",
			punkte: []Punkt{{0, 30000}, {10, 10000}, {20, 20000}},
			bis:    30, willOK: true, willVal: 20000,
		},
		{
			name:   "Punkte ohne Dauer werden uebersprungen",
			punkte: []Punkt{{0, 10000}, {0, 99999}, {10, 20000}},
			bis:    20, willOK: true, willVal: 20000,
		},
		{
			// Ungerade Gesamtdauer (3 Minuten): 100 haelt nur Minute 0 (1 von
			// 3), 200 haelt Minuten 1 und 2 (2 von 3) - also die Mehrheit.
			// floor(3/2)=1 wuerde die Schwelle schon nach der ersten Spanne
			// als erreicht melden und faelschlich 100 liefern.
			name:   "ungerade Gesamtdauer, 1 von 3 gegen 2 von 3",
			punkte: []Punkt{{0, 100}, {1, 200}},
			bis:    3, willOK: true, willVal: 200,
		},
		{
			// Ungerade Gesamtdauer (11 Minuten): 10000 haelt 5 von 11 Minuten,
			// 90000 haelt 6 von 11 - die Mehrheit. floor(11/2)=5 wuerde nach
			// der ersten Spanne (lauf=5) schon "Haelfte erreicht" melden.
			name:   "ungerade Gesamtdauer, 5 von 11 gegen 6 von 11",
			punkte: []Punkt{{0, 10000}, {5, 90000}},
			bis:    11, willOK: true, willVal: 90000,
		},
		{
			name:   "bisMinute vor dem ersten Punkt",
			punkte: []Punkt{{100, 20000}},
			bis:    50, willOK: false,
		},
	}

	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			got := MedianZeitgewichtet(f.punkte, f.bis)
			if got.OK != f.willOK {
				t.Fatalf("OK = %v, will %v", got.OK, f.willOK)
			}
			if f.willOK && int64(got.Cents) != f.willVal {
				t.Errorf("Cents = %d, will %d", got.Cents, f.willVal)
			}
		})
	}
}

func TestMedianUnterscheidetSichVomDurchschnitt(t *testing.T) {
	// Realistischer Fall: langer stabiler Preis, kurzer Preissturz.
	punkte := []Punkt{{0, 20000}, {800, 5000}, {820, 20000}}
	got := MedianZeitgewichtet(punkte, 1000)
	if !got.OK || got.Cents != 20000 {
		t.Errorf("Median = %+v, will {20000 true} — der Preissturz hielt nur 2 %% der Zeit", got)
	}
}
