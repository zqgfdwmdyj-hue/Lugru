package store

import (
	"os"
	"strings"
	"testing"
)

func TestChartSpeichernUndLesen(t *testing.T) {
	s := temp(t)
	png := []byte("\x89PNG\r\n\x1a\nDATEN")

	datei, err := s.ChartSpeichern("B01636IZ0G", png)
	if err != nil {
		t.Fatalf("ChartSpeichern: %v", err)
	}
	if !strings.HasPrefix(datei, "B01636IZ0G-") || !strings.HasSuffix(datei, ".png") {
		t.Errorf("Dateiname = %q, will B01636IZ0G-<zeitstempel>.png", datei)
	}

	got, err := s.ChartLesen(datei)
	if err != nil {
		t.Fatalf("ChartLesen: %v", err)
	}
	if string(got) != string(png) {
		t.Error("Inhalt weicht ab")
	}

	if _, err := os.Stat(s.ChartPfad(datei)); err != nil {
		t.Errorf("Datei liegt nicht auf der Platte: %v", err)
	}
}

// TestChartNamenKollidierenNicht erzeugt viele Charts für dieselbe ASIN
// hintereinander und verlangt, dass jeder Dateiname einzigartig bleibt. Ein
// einzelnes Paar hätte den früheren Millisekunden-Bug (siehe ChartSpeichern)
// nicht zuverlässig aufgedeckt — die manuelle Untersuchung brauchte
// Tausende Wiederholungen, um die Kollisionsrate sichtbar zu machen. Diese
// Schleife ist die dauerhafte, im Testlauf mitgeführte Fassung davon.
func TestChartNamenKollidierenNicht(t *testing.T) {
	s := temp(t)
	png := []byte("\x89PNG\r\n\x1a\n")

	const durchlaeufe = 500
	namen := make(map[string]struct{}, durchlaeufe)
	for i := 0; i < durchlaeufe; i++ {
		datei, err := s.ChartSpeichern("B01636IZ0G", png)
		if err != nil {
			t.Fatalf("ChartSpeichern (Durchlauf %d): %v", i, err)
		}
		if _, dopplung := namen[datei]; dopplung {
			t.Fatalf("Kollision nach %d Durchläufen: Name %q wurde zweimal vergeben", i+1, datei)
		}
		namen[datei] = struct{}{}
	}
}

func TestChartLesenLaesstNichtAusbrechen(t *testing.T) {
	s := temp(t)
	// Ein Dateiname aus der Datenbank darf nie aus dem Chart-Ordner führen.
	for _, boese := range []string{"../../etc/passwd", "/etc/passwd", "..\\..\\windows\\system.ini"} {
		if _, err := s.ChartLesen(boese); err == nil {
			t.Errorf("ChartLesen(%q) lieferte Daten statt eines Fehlers", boese)
		}
	}
}
