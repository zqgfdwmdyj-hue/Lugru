package fba

import "testing"

// klassen ist eine kleine Staffel in der Form, in der sie aus der Datenbank
// kommt: nach Sortierung geordnet, von der kleinsten zur größten. Die Zahlen
// sind erfunden — geprüft wird die Wahl, nicht Amazons Tarif.
func klassen() []Klasse {
	return []Klasse{
		{ID: 1, Sortierung: 1, Bezeichnung: "Brief", MaxLaengeMM: 330, MaxBreiteMM: 230, MaxHoeheMM: 25, MaxGewichtG: 460},
		{ID: 2, Sortierung: 2, Bezeichnung: "Päckchen", MaxLaengeMM: 350, MaxBreiteMM: 250, MaxHoeheMM: 120, MaxGewichtG: 3900},
		{ID: 3, Sortierung: 3, Bezeichnung: "Standard", MaxLaengeMM: 450, MaxBreiteMM: 340, MaxHoeheMM: 260, MaxGewichtG: 11900},
	}
}

func TestWaehleNimmtDieErstePassende(t *testing.T) {
	// Ein Brief passt auch in Päckchen und Standard. Gewinnen muss die
	// erste Zeile der Staffel, sonst zahlt jeder Brief Paketpreis.
	k, ok := Waehle(klassen(), Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 20, GewichtG: 300})
	if !ok {
		t.Fatal("kein Treffer, will Brief")
	}
	if k.Bezeichnung != "Brief" {
		t.Errorf("Klasse = %q, will \"Brief\"", k.Bezeichnung)
	}
}

func TestWaehleSteigtBeiUeberschrittenemGewichtAuf(t *testing.T) {
	// Maße wie ein Brief, aber 500 g: Brief scheidet aus, Päckchen nimmt es.
	k, ok := Waehle(klassen(), Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 20, GewichtG: 500})
	if !ok {
		t.Fatal("kein Treffer, will Päckchen")
	}
	if k.Bezeichnung != "Päckchen" {
		t.Errorf("Klasse = %q, will \"Päckchen\" — 500 g sprengen den Brief", k.Bezeichnung)
	}
}

func TestPasstVergleichtDerGroesseNachNichtDerReihenfolgeNach(t *testing.T) {
	// 400 × 50 × 300 mm liegt quer: die zweite eingegebene Zahl (50) ist
	// kleiner als die dritte (300). Sortiert man nicht, wird 300 gegen die
	// Höhengrenze 260 geprüft und das Paket fällt aus der Klasse, in die es
	// gehört.
	quer := Masse{LaengeMM: 400, BreiteMM: 50, HoeheMM: 300, GewichtG: 2000}
	gerade := Masse{LaengeMM: 400, BreiteMM: 300, HoeheMM: 50, GewichtG: 2000}

	kq, okq := Waehle(klassen(), quer)
	kg, okg := Waehle(klassen(), gerade)

	if !okq || !okg {
		t.Fatalf("Treffer quer = %v, gerade = %v — beide wollen Standard", okq, okg)
	}
	if kq.Bezeichnung != "Standard" || kg.Bezeichnung != "Standard" {
		t.Errorf("quer = %q, gerade = %q, beide wollen \"Standard\"", kq.Bezeichnung, kg.Bezeichnung)
	}
}

func TestWaehleOhneTrefferWennZuGross(t *testing.T) {
	if k, ok := Waehle(klassen(), Masse{LaengeMM: 900, BreiteMM: 600, HoeheMM: 400, GewichtG: 20000}); ok {
		t.Errorf("Treffer %q, will keinen — Sperrgut steht nicht in der Staffel", k.Bezeichnung)
	}
}

func TestWaehleOhneTrefferBeiLeererStaffel(t *testing.T) {
	// Der Zustand direkt nach dem Upgrade: die Tarife sind noch nicht
	// eingetragen. Es darf keine Zahl entstehen.
	if _, ok := Waehle(nil, Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 20, GewichtG: 300}); ok {
		t.Error("Treffer in leerer Staffel, will keinen")
	}
}

func TestUnvollstaendigeMasseTreffenNie(t *testing.T) {
	faelle := map[string]Masse{
		"ohne Gewicht": {LaengeMM: 300, BreiteMM: 200, HoeheMM: 20},
		"ohne Höhe":    {LaengeMM: 300, BreiteMM: 200, GewichtG: 300},
		"gar nichts":   {},
	}
	for name, m := range faelle {
		t.Run(name, func(t *testing.T) {
			if m.Vollstaendig() {
				t.Fatal("Vollstaendig() = true, will false")
			}
			if k, ok := Waehle(klassen(), m); ok {
				t.Errorf("Treffer %q, will keinen — ohne Maße keine Klasse", k.Bezeichnung)
			}
		})
	}
}

func TestUnvollstaendigeKlasseFaengtNichtsAuf(t *testing.T) {
	// Eine Zeile, bei der ein Feld leer geblieben ist. Sie darf nicht
	// stillschweigend jedes Paket schlucken — das wäre eine erfundene
	// Gebühr für alles.
	luecke := []Klasse{{ID: 9, Bezeichnung: "halb eingetragen", MaxLaengeMM: 450, MaxBreiteMM: 340, MaxGewichtG: 11900}}
	if k, ok := Waehle(luecke, Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 20, GewichtG: 300}); ok {
		t.Errorf("Treffer %q, will keinen — die Höhengrenze fehlt", k.Bezeichnung)
	}
}

func TestGrenzenSindEinschliesslich(t *testing.T) {
	// Genau auf der Grenze gehört noch in die Klasse: Amazons Tabelle sagt
	// "bis 460 g", nicht "unter 460 g".
	k, ok := Waehle(klassen(), Masse{LaengeMM: 330, BreiteMM: 230, HoeheMM: 25, GewichtG: 460})
	if !ok {
		t.Fatal("kein Treffer, will Brief — die Grenze selbst zählt noch dazu")
	}
	if k.Bezeichnung != "Brief" {
		t.Errorf("Klasse = %q, will \"Brief\"", k.Bezeichnung)
	}
}

func TestBetragOhneStaffelIstDerFestbetrag(t *testing.T) {
	g := Gebuehr{Cent: 1043}
	if got := g.Betrag(Masse{GewichtG: 9000}); got != 1043 {
		t.Errorf("Betrag = %d, will 1043 — ohne Staffel zählt nur der Festbetrag", got)
	}
}

func TestBetragRechnetAngefangeneKilogrammDazu(t *testing.T) {
	// Kleine Übergröße aus der Tarifübersicht: 17,68 € bis 760 g,
	// darüber 0,36 € je zusätzlichem Kilogramm.
	g := Gebuehr{Cent: 1768, FreiGewichtG: 760, CentProKg: 36}

	faelle := map[int]int{
		760:  1768,        // genau auf der Grenze: noch nichts dazu
		761:  1768 + 36,   // ein angefangenes Kilogramm
		1760: 1768 + 36,   // genau ein Kilogramm darüber
		1761: 1768 + 2*36, // das zweite fängt an
		3760: 1768 + 3*36,
	}
	for gewicht, will := range faelle {
		if got := g.Betrag(Masse{GewichtG: gewicht}); int(got) != will {
			t.Errorf("Betrag bei %d g = %d, will %d", gewicht, got, will)
		}
	}
}
