package money

import "testing"

func TestParse(t *testing.T) {
	faelle := []struct {
		ein  string
		will Cents
	}{
		{"130,56", 13056},
		{"130.56", 13056},
		{"1.234,56", 123456},
		{"1234,56", 123456},
		{"207,49 €", 20749},
		{" 130,56 ", 13056},
		{"1234", 123400},
		{"0,05", 5},
		{"-12,30", -1230},
		{"8,6", 860},
		// Führendes Plus bleibt gültig (Review-Fund 1).
		{"+130,56", 13056},
		// NBSP als Tausendertrennzeichen, wie in kopierten Preisen üblich
		// (Review-Fund 2).
		{"1 234,56", 123456},
		// Punkt/Komma-Randfälle: der eigentliche Daseinszweck des Pakets,
		// bisher ungetestet (Review-Fund 4).
		{"1.23", 123},     // einzelner Punkt, ≤2 Nachkommastellen → Dezimaltrennzeichen
		{"1.234", 123400}, // einzelner Punkt, 3 Nachkommastellen → Tausendertrenner
		{"130.", 13000},   // null Nachkommastellen, wird akzeptiert
		{"12,", 1200},     // null Nachkommastellen, wird akzeptiert
	}
	for _, f := range faelle {
		got, err := Parse(f.ein)
		if err != nil {
			t.Errorf("Parse(%q): unerwarteter Fehler %v", f.ein, err)
			continue
		}
		if got != f.will {
			t.Errorf("Parse(%q) = %d, will %d", f.ein, got, f.will)
		}
	}
}

func TestParseFehler(t *testing.T) {
	for _, ein := range []string{
		"", "   ", "abc", "12,345", "12,,3",
		// Fehlerhafte Vorzeichen (Review-Fund 1): ein blankes Vorzeichen,
		// ein eingebettetes Vorzeichen im Bruchteil oder ein doppeltes
		// Vorzeichen dürfen keinen (stillschweigend falschen) Betrag liefern.
		"-", "130,-5", "130,+5", "--130,56",
	} {
		if _, err := Parse(ein); err == nil {
			t.Errorf("Parse(%q): Fehler erwartet, kam keiner", ein)
		}
	}
}

func TestFormate(t *testing.T) {
	faelle := []struct {
		c                  Cents
		komma, euro, punkt string
	}{
		{13056, "130,56", "130,56 €", "130.56"},
		{20749, "207,49", "207,49 €", "207.49"},
		{3167, "31,67", "31,67 €", "31.67"},
		{5, "0,05", "0,05 €", "0.05"},
		{0, "0,00", "0,00 €", "0.00"},
		{-1230, "-12,30", "-12,30 €", "-12.30"},
	}
	for _, f := range faelle {
		if got := f.c.String(); got != f.komma {
			t.Errorf("Cents(%d).String() = %q, will %q", f.c, got, f.komma)
		}
		if got := f.c.Euro(); got != f.euro {
			t.Errorf("Cents(%d).Euro() = %q, will %q", f.c, got, f.euro)
		}
		if got := f.c.Dot(); got != f.punkt {
			t.Errorf("Cents(%d).Dot() = %q, will %q", f.c, got, f.punkt)
		}
	}
}
