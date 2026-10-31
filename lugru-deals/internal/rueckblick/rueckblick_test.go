package rueckblick

import (
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/calc"
	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

func TestAuswertenEinbruchUndErholung(t *testing.T) {
	post := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	tag := func(n int) int { return Minute(post.AddDate(0, 0, n)) }
	verlauf := []keepa.Punkt{
		{Minute: tag(-5), Gesamt: 50000}, // galt beim Post
		{Minute: tag(10), Gesamt: 40000}, // Einbruch
		{Minute: tag(20), Gesamt: 42000},
		{Minute: tag(60), Gesamt: 49000}, // erholt (≥ 97 %)
		{Minute: tag(100), Gesamt: 51000},
	}
	e := Auswerten(verlauf, post, post.AddDate(0, 0, 120), 50000)
	if !e.Daten || !e.Gefallen || !e.Volle30 || !e.Volle90 {
		t.Fatalf("%+v", e)
	}
	if e.VKTief != 40000 || !e.TiefAm.Equal(Zeit(tag(10))) {
		t.Errorf("Tief %v am %v", e.VKTief, e.TiefAm)
	}
	if !e.ErholtAm.Equal(Zeit(tag(60))) {
		t.Errorf("erholt am %v", e.ErholtAm)
	}
	// Erste 30 Tage: 10 Tage 500 €, 10 Tage 400 €, 10 Tage 420 € → Median 420 €.
	if e.VK30 != 42000 {
		t.Errorf("VK30 %v", e.VK30)
	}
	if e.VKJetzt != 51000 {
		t.Errorf("jetzt %v", e.VKJetzt)
	}
}

func TestAuswertenOhneDaten(t *testing.T) {
	post := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	if e := Auswerten(nil, post, post.AddDate(0, 1, 0), 1000); e.Daten {
		t.Fatal("ohne Verlauf keine Daten")
	}
}

func TestAuswertenStabil(t *testing.T) {
	post := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	e := Auswerten([]keepa.Punkt{{Minute: Minute(post) - 10, Gesamt: 30000}, {Minute: Minute(post.AddDate(0, 0, 3)), Gesamt: 29000}},
		post, post.AddDate(0, 0, 10), 30000)
	if e.Gefallen || !e.ErholtAm.IsZero() || e.Volle30 {
		t.Fatalf("%+v", e)
	}
}

// Gewinn muss dasselbe liefern wie eine komplette Neuberechnung.
func TestGewinnWieCalc(t *testing.T) {
	ein := calc.Eingabe{EK: 30000, VKBrutto: 45000, QuellUStPermille: 190, ZielUStPermille: 200, ProvisionProzent: 8, FBA: 450}
	alt := calc.Rechne(ein)
	ein.VKBrutto = 39999
	neu := calc.Rechne(ein)
	if g := Gewinn(alt.Gewinn, 45000, 39999, 200, 8); absDiff(g, neu.Gewinn) > 1 {
		t.Errorf("Gewinn %v, calc %v", g, neu.Gewinn)
	}
}

func absDiff(a, b money.Cents) money.Cents {
	if a > b {
		return a - b
	}
	return b - a
}
