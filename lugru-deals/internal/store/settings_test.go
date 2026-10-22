package store

import (
	"path/filepath"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
)

func TestVorgabewerte(t *testing.T) {
	s := temp(t)
	faelle := map[string]string{
		SchluesselMargenBasis:      "brutto",
		SchluesselProvision:        "15",
		SchluesselZielmarkt:        "DE",
		SchluesselChartTage:        "90",
		SchluesselChartBreite:      "800",
		SchluesselChartHoehe:       "350",
		SchluesselCacheMinuten:     "30",
		SchluesselUStPrefix + "DE": "190",
		SchluesselUStPrefix + "ES": "210",
		SchluesselUStPrefix + "FR": "200",
		SchluesselUStPrefix + "IT": "220",
	}
	for schluessel, will := range faelle {
		if got := s.Einstellung(schluessel); got != will {
			t.Errorf("Einstellung(%q) = %q, will %q", schluessel, got, will)
		}
	}
}

func TestFBAHatKeinenVorgabewert(t *testing.T) {
	s := temp(t)
	// Eine geratene FBA-Gebuehr wuerde eine falsche Gewinnzahl in den Post
	// schreiben. Lieber leer lassen und den Nutzer tippen lassen.
	if got := s.Einstellung(SchluesselFBA); got != "" {
		t.Errorf("Einstellung(FBA) = %q, will leer", got)
	}
}

// Die Vorlage ist die optionale Notiz in der Discord-Karte, seit das
// Programm den Post selbst baut. Sie startet leer: eine vorbelegte Notiz
// stünde in jedem Deal, ohne dass jemand sie geschrieben hätte.
func TestVorlageStartetLeer(t *testing.T) {
	s := temp(t)
	if got := s.Einstellung(SchluesselVorlage); got != "" {
		t.Errorf("Vorlage = %q, will leer", got)
	}
}

// Wer eine der beiden Standardvorlagen unverändert in der Datenbank stehen
// hat, hat sie nie angefasst. Open leert sie: der Post ist inzwischen eine
// Karte, die das Programm selbst baut, und die alte Vorlage als Notiz darin
// nennte jeden Deal ein zweites Mal.
func TestOpenLeertNieAngefassteVorlage(t *testing.T) {
	for _, vorlage := range []string{post.AlteStandardVorlage, post.StandardVorlage} {
		dir := t.TempDir()
		pfad := filepath.Join(dir, "test.db")

		s1, err := Open(pfad, filepath.Join(dir, "charts"))
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		if err := s1.SetzeEinstellung(SchluesselVorlage, vorlage); err != nil {
			t.Fatalf("SetzeEinstellung: %v", err)
		}
		s1.Close()

		s2, err := Open(pfad, filepath.Join(dir, "charts"))
		if err != nil {
			t.Fatalf("zweites Open: %v", err)
		}
		if got := s2.Einstellung(SchluesselVorlage); got != "" {
			t.Errorf("die nie angefasste Vorlage steht noch da:\n%s", got)
		}
		s2.Close()
	}
}

// Eine selbst angepasste Vorlage ist Eigentum des Nutzers und bleibt beim
// Start unberührt — auch wenn sie .Maerkte nicht kennt.
func TestOpenLaesstAngepassteVorlageStehen(t *testing.T) {
	dir := t.TempDir()
	pfad := filepath.Join(dir, "test.db")
	eigene := post.AlteStandardVorlage + "\nMeine Zeile"

	s1, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := s1.SetzeEinstellung(SchluesselVorlage, eigene); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}
	s1.Close()

	s2, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("zweites Open: %v", err)
	}
	defer s2.Close()
	if got := s2.Einstellung(SchluesselVorlage); got != eigene {
		t.Errorf("die angepasste Vorlage wurde verändert:\n%s", got)
	}
}

func TestSetzenUndLesen(t *testing.T) {
	s := temp(t)
	if err := s.SetzeEinstellung(SchluesselProvision, "12,5"); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}
	if got := s.Einstellung(SchluesselProvision); got != "12,5" {
		t.Errorf("Einstellung = %q, will 12,5", got)
	}
}

func TestUeberschreiben(t *testing.T) {
	s := temp(t)
	s.SetzeEinstellung("k", "a")
	s.SetzeEinstellung("k", "b")
	if got := s.Einstellung("k"); got != "b" {
		t.Errorf("Einstellung = %q, will b", got)
	}
}

func TestEinstellungZahl(t *testing.T) {
	s := temp(t)
	if got := s.EinstellungZahl(SchluesselChartTage); got != 90 {
		t.Errorf("EinstellungZahl(ChartTage) = %d, will 90", got)
	}
	s.SetzeEinstellung("kaputt", "keine zahl")
	if got := s.EinstellungZahl("kaputt"); got != 0 {
		t.Errorf("EinstellungZahl bei Unsinn = %d, will 0", got)
	}
}

func TestAlleEinstellungen(t *testing.T) {
	s := temp(t)
	alle := s.AlleEinstellungen()
	if alle[SchluesselZielmarkt] != "DE" {
		t.Errorf("AlleEinstellungen enthält Zielmarkt %q, will DE", alle[SchluesselZielmarkt])
	}
	if _, da := alle[SchluesselVorlage]; !da {
		t.Error("AlleEinstellungen enthält die Vorlage nicht")
	}
}
