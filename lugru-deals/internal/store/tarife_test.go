package store

import (
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// staffelLeeren räumt die Startbestückung ab. Open legt sie an, und die
// Tests hier prüfen das Verhalten der Tabelle, nicht Amazons Tarif.
func staffelLeeren(t *testing.T, s *Store) {
	t.Helper()
	alle, err := s.TarifKlassen()
	if err != nil {
		t.Fatalf("TarifKlassen: %v", err)
	}
	for _, k := range alle {
		if err := s.TarifKlasseLoeschen(k.ID); err != nil {
			t.Fatalf("Löschen: %v", err)
		}
	}
}

func klasse(bez string, sortierung, gewicht int) fba.Klasse {
	return fba.Klasse{
		Sortierung: sortierung, Bezeichnung: bez,
		MaxLaengeMM: 450, MaxBreiteMM: 340, MaxHoeheMM: 260, MaxGewichtG: gewicht,
	}
}

func TestTarifKlassenKommenInPruefreihenfolge(t *testing.T) {
	s := temp(t)
	staffelLeeren(t, s)
	// Absichtlich verkehrt herum angelegt: die Reihenfolge muss aus der
	// Sortierung kommen, nicht aus der Anlagereihenfolge.
	if _, err := s.TarifKlasseAnlegen(klasse("Standard", 3, 11900)); err != nil {
		t.Fatalf("Anlegen: %v", err)
	}
	if _, err := s.TarifKlasseAnlegen(klasse("Brief", 1, 460)); err != nil {
		t.Fatalf("Anlegen: %v", err)
	}
	if _, err := s.TarifKlasseAnlegen(klasse("Päckchen", 2, 3900)); err != nil {
		t.Fatalf("Anlegen: %v", err)
	}

	alle, err := s.TarifKlassen()
	if err != nil {
		t.Fatalf("TarifKlassen: %v", err)
	}
	will := []string{"Brief", "Päckchen", "Standard"}
	if len(alle) != len(will) {
		t.Fatalf("%d Klassen, will %d", len(alle), len(will))
	}
	for i, w := range will {
		if alle[i].Bezeichnung != w {
			t.Errorf("Klasse %d = %q, will %q", i, alle[i].Bezeichnung, w)
		}
	}
}

func TestEFNGebuehrUnterscheidetFehltVonNull(t *testing.T) {
	s := temp(t)
	staffelLeeren(t, s)
	id, err := s.TarifKlasseAnlegen(klasse("Standard", 1, 11900))
	if err != nil {
		t.Fatalf("Anlegen: %v", err)
	}

	if _, da, err := s.TarifGebuehr(id, "IT", fba.EFN); err != nil || da {
		t.Errorf("vor dem Eintragen: da = %v, err = %v — will false, nil", da, err)
	}

	// Eine eingetragene Null ist ein Betrag, kein fehlender Eintrag.
	if err := s.TarifGebuehrSetzen(id, "IT", fba.EFN, fba.Gebuehr{}); err != nil {
		t.Fatalf("Setzen: %v", err)
	}
	g, da, err := s.TarifGebuehr(id, "IT", fba.EFN)
	if err != nil || !da || g.Cent != 0 {
		t.Errorf("nach dem Eintragen von 0: cent = %d, da = %v, err = %v — will 0, true, nil", g.Cent, da, err)
	}

	if err := s.TarifTabelleSchreiben(nil, []TarifGebuehrEintrag{
		{KlasseID: id, Markt: "IT", Weg: fba.EFN, Loeschen: true},
	}); err != nil {
		t.Fatalf("Löschen: %v", err)
	}
	if _, da, _ := s.TarifGebuehr(id, "IT", fba.EFN); da {
		t.Error("nach dem Löschen: da = true, will false")
	}
}

func TestTarifGebuehrSetzenUeberschreibt(t *testing.T) {
	s := temp(t)
	staffelLeeren(t, s)
	id, _ := s.TarifKlasseAnlegen(klasse("Standard", 1, 11900))

	for _, wert := range []int{544, 689} {
		if err := s.TarifGebuehrSetzen(id, "IT", fba.EFN, fba.Gebuehr{Cent: money.Cents(wert)}); err != nil {
			t.Fatalf("Setzen %d: %v", wert, err)
		}
	}
	g, da, _ := s.TarifGebuehr(id, "IT", fba.EFN)
	if !da || int(g.Cent) != 689 {
		t.Errorf("cent = %d, da = %v — will 689, true", g.Cent, da)
	}
}

func TestTarifGebuehrenSindJeMarktGetrennt(t *testing.T) {
	s := temp(t)
	staffelLeeren(t, s)
	id, _ := s.TarifKlasseAnlegen(klasse("Standard", 1, 11900))
	_ = s.TarifGebuehrSetzen(id, "IT", fba.EFN, fba.Gebuehr{Cent: 689})
	_ = s.TarifGebuehrSetzen(id, "FR", fba.EFN, fba.Gebuehr{Cent: 612})

	alle, err := s.TarifGebuehren(fba.EFN)
	if err != nil {
		t.Fatalf("TarifGebuehren: %v", err)
	}
	if int(alle[id]["IT"].Cent) != 689 || int(alle[id]["FR"].Cent) != 612 {
		t.Errorf("Beträge = %v, will IT 689 und FR 612", alle[id])
	}
	if _, da := alle[id]["ES"]; da {
		t.Error("ES hat einen Betrag, will keinen")
	}
}

func TestTarifKlasseLoeschenNimmtDieGebuehrenMit(t *testing.T) {
	// Ohne ON DELETE CASCADE blieben Gebühren stehen, die auf nichts mehr
	// zeigen — und eine neue Klasse mit derselben id erbte sie.
	s := temp(t)
	staffelLeeren(t, s)
	id, _ := s.TarifKlasseAnlegen(klasse("Standard", 1, 11900))
	_ = s.TarifGebuehrSetzen(id, "IT", fba.EFN, fba.Gebuehr{Cent: 689})

	if err := s.TarifKlasseLoeschen(id); err != nil {
		t.Fatalf("Löschen: %v", err)
	}

	var anzahl int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM fba_gebuehren`).Scan(&anzahl); err != nil {
		t.Fatalf("Zählen: %v", err)
	}
	if anzahl != 0 {
		t.Errorf("%d verwaiste Gebühren, will 0", anzahl)
	}
}

func TestTarifKlasseAendernLaesstGebuehrenStehen(t *testing.T) {
	s := temp(t)
	staffelLeeren(t, s)
	id, _ := s.TarifKlasseAnlegen(klasse("Standrad", 1, 11900))
	_ = s.TarifGebuehrSetzen(id, "IT", fba.EFN, fba.Gebuehr{Cent: 689})

	k := klasse("Standard", 1, 12000) // Tippfehler berichtigt, Grenze angepasst
	k.ID = id
	if err := s.TarifTabelleSchreiben([]fba.Klasse{k}, nil); err != nil {
		t.Fatalf("Ändern: %v", err)
	}

	g, da, _ := s.TarifGebuehr(id, "IT", fba.EFN)
	if !da || int(g.Cent) != 689 {
		t.Errorf("cent = %d, da = %v — will 689, true: eine Namenskorrektur darf keine Beträge löschen", g.Cent, da)
	}
	alle, _ := s.TarifKlassen()
	if len(alle) != 1 || alle[0].Bezeichnung != "Standard" || alle[0].MaxGewichtG != 12000 {
		t.Errorf("Klasse = %+v, will Standard mit 12000 g", alle)
	}
}

func TestStartbestueckungLiegtNachOpenBereit(t *testing.T) {
	s := temp(t)

	alle, err := s.TarifKlassen()
	if err != nil {
		t.Fatalf("TarifKlassen: %v", err)
	}
	if len(alle) != len(tarifStartstaffel) {
		t.Fatalf("%d Klassen, will %d", len(alle), len(tarifStartstaffel))
	}

	var standard fba.Klasse
	for _, k := range alle {
		if k.Bezeichnung == "Standardpaket ≤ 1,4 kg" {
			standard = k
		}
	}
	if standard.ID == 0 {
		t.Fatal("Klasse \"Standardpaket ≤ 1,4 kg\" fehlt")
	}
	if standard.MaxLaengeMM != 450 || standard.MaxBreiteMM != 340 || standard.MaxHoeheMM != 260 {
		t.Errorf("Grenzen = %d/%d/%d mm, will 450/340/260",
			standard.MaxLaengeMM, standard.MaxBreiteMM, standard.MaxHoeheMM)
	}

	// EFN: Amazon führt FR, IT und ES in einer Spalte — überall 10,43 €.
	for _, markt := range []string{"FR", "IT", "ES"} {
		g, da, _ := s.TarifGebuehr(standard.ID, markt, fba.EFN)
		if !da || g.Cent != 1043 {
			t.Errorf("EFN %s = %d, da = %v — will 1043, true", markt, g.Cent, da)
		}
	}
	// Nach DE gibt es keinen EFN-Versand.
	if _, da, _ := s.TarifGebuehr(standard.ID, "DE", fba.EFN); da {
		t.Error("DE hat einen EFN-Betrag, will keinen")
	}

	// Lokal: hier hat jedes Land seine eigene Spalte, die Beträge gehen
	// auseinander — und liegen deutlich unter den EFN-Tarifen.
	lokal := map[string]int{"DE": 367, "FR": 641, "IT": 526, "ES": 485}
	for markt, will := range lokal {
		g, da, _ := s.TarifGebuehr(standard.ID, markt, fba.Lokal)
		if !da || int(g.Cent) != will {
			t.Errorf("lokal %s = %d, da = %v — will %d, true", markt, g.Cent, da, will)
		}
	}
}

func TestStartbestueckungTraegtDieKilogrammStaffel(t *testing.T) {
	s := temp(t)
	alle, _ := s.TarifKlassen()

	var uebergroesse fba.Klasse
	for _, k := range alle {
		if k.Bezeichnung == "Kleine Übergröße" {
			uebergroesse = k
		}
	}
	if uebergroesse.ID == 0 {
		t.Fatal("Klasse \"Kleine Übergröße\" fehlt")
	}

	// EFN-Übersicht: 17,68 € bis 760 g, darüber 0,36 € je zusätzlichem Kilogramm.
	g, da, _ := s.TarifGebuehr(uebergroesse.ID, "IT", fba.EFN)
	if !da || g.Cent != 1768 || g.FreiGewichtG != 760 || g.CentProKg != 36 {
		t.Errorf("EFN IT = %+v, da = %v — will 1768 / 760 g / 36", g, da)
	}

	// Lokale Übersicht, Spalte DE: 4,30 € bis 760 g, darüber 0,18 €.
	g, da, _ = s.TarifGebuehr(uebergroesse.ID, "DE", fba.Lokal)
	if !da || g.Cent != 430 || g.FreiGewichtG != 760 || g.CentProKg != 18 {
		t.Errorf("lokal DE = %+v, da = %v — will 430 / 760 g / 18", g, da)
	}
}

func TestFestbetragsklassenTragenKeineKilogrammStaffel(t *testing.T) {
	// Ein Grundgewicht ohne Zuschlag je Kilogramm bewirkt nichts und wäre
	// eine Angabe, die es in der Tarifübersicht nicht gibt.
	s := temp(t)
	alle, _ := s.TarifKlassen()

	for _, k := range alle {
		if k.Bezeichnung != "Standardpaket ≤ 1,4 kg" {
			continue
		}
		g, _, _ := s.TarifGebuehr(k.ID, "IT", fba.EFN)
		if g.FreiGewichtG != 0 || g.CentProKg != 0 {
			t.Errorf("Gebühr = %+v, will ohne Kilogramm-Staffel", g)
		}
	}
}

func TestStartbestueckungLaeuftNichtZweimal(t *testing.T) {
	// Wer die Staffel bewusst leert, soll sie nicht beim nächsten Start
	// zurückbekommen: eine Erstbefüllung ist keine Zwangsbefüllung.
	s := temp(t)
	staffelLeeren(t, s)

	if err := s.tarifeBestuecken(); err != nil {
		t.Fatalf("tarifeBestuecken: %v", err)
	}
	if alle, _ := s.TarifKlassen(); len(alle) != 0 {
		t.Errorf("%d Klassen wieder da, will 0", len(alle))
	}
}

func TestR4SonderuebergroesseFindetKeineKlasse(t *testing.T) {
	// Die letzte Klasse trug 9999 mm und 999 kg als Ersatzgrenzen und fing
	// damit auch den ausdrücklich nicht unterstützten Fall auf: über 31,5 kg
	// oder mit einer Kante über 175 cm. Weil die Staffel Vorrang vor Keepa
	// hat, wurde dieser nicht belegte Tarif zur Vorbelegung.
	s := temp(t)
	klassen, err := s.TarifKlassen()
	if err != nil {
		t.Fatalf("TarifKlassen: %v", err)
	}

	fuerAlle := map[string]fba.Masse{
		"Kante über 175 cm": {LaengeMM: 2000, BreiteMM: 500, HoeheMM: 500, GewichtG: 20000},
		"über 31,5 kg":      {LaengeMM: 1000, BreiteMM: 500, HoeheMM: 500, GewichtG: 40000},
	}
	for name, m := range fuerAlle {
		t.Run(name, func(t *testing.T) {
			if k, ok := fba.Waehle(klassen, m); ok {
				t.Errorf("Treffer %q, will keinen — Sonderübergröße wird nicht unterstützt", k.Bezeichnung)
			}
		})
	}

	// Was innerhalb der Grenzen liegt, muss weiterhin greifen.
	drin := map[string]string{
		"Sperrige Übergröße": "", "Schwere Übergröße": "",
	}
	for _, m := range []fba.Masse{
		{LaengeMM: 1300, BreiteMM: 700, HoeheMM: 700, GewichtG: 20000},
		{LaengeMM: 1000, BreiteMM: 550, HoeheMM: 550, GewichtG: 25000},
	} {
		k, ok := fba.Waehle(klassen, m)
		if !ok {
			t.Fatalf("kein Treffer für %+v", m)
		}
		if _, erwartet := drin[k.Bezeichnung]; !erwartet {
			t.Errorf("Klasse = %q, will eine der Übergrößen", k.Bezeichnung)
		}
	}
}
