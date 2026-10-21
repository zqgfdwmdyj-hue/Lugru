package web

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// staffelLeeren räumt die Startbestückung ab, die store.Open anlegt.
func staffelLeeren(t *testing.T, s *store.Store) {
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

func neueKlasse() url.Values {
	return url.Values{
		"bez":        {"Standardpaket bis 1,4 kg"},
		"sortierung": {"2"},
		"laenge":     {"45"},
		"breite":     {"34"},
		"hoehe":      {"26"},
		"gewicht":    {"1400"},
	}
}

func TestTarifseiteBeschriftetJedeSpalteMitIhremWeg(t *testing.T) {
	srv, s := testServer(t)
	if err := s.SetzeEinstellung(store.SchluesselLagerland, "DE"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/tarife", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	koerper := w.Body.String()

	// Jeder Markt hat eine Spalte — auch das Lagerland, dort aber mit dem
	// lokalen Tarif statt dem des Versandnetzwerks.
	for _, muss := range []string{
		"<th>DE €<br><small>lokal</small></th>",
		"<th>FR €<br><small>efn</small></th>",
		"<th>IT €<br><small>efn</small></th>",
		"<th>ES €<br><small>efn</small></th>",
	} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Spaltenkopf %q fehlt", muss)
		}
	}
}

func TestTarifseiteFolgtDemLagerland(t *testing.T) {
	// Zieht das Lager nach Italien, dreht sich die Zuordnung um: IT wird
	// lokal, DE wird ein EFN-Ziel.
	srv, s := testServer(t)
	if err := s.SetzeEinstellung(store.SchluesselLagerland, "IT"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}

	koerper := hole(t, srv, http.MethodGet, "/tarife", "").Body.String()
	if !strings.Contains(koerper, "<th>IT €<br><small>lokal</small></th>") {
		t.Error("IT ist nicht als lokal beschriftet")
	}
	if !strings.Contains(koerper, "<th>DE €<br><small>efn</small></th>") {
		t.Error("DE ist nicht als EFN-Ziel beschriftet")
	}
}

func TestKlasseAnlegenRechnetZentimeterInMillimeter(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)

	f := neueKlasse()
	f.Set("hoehe", "2,5") // ein Brief: Kommazahl aus der Tarifübersicht
	w := hole(t, srv, http.MethodPost, "/tarife/neu", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	alle, err := s.TarifKlassen()
	if err != nil || len(alle) != 1 {
		t.Fatalf("Klassen = %v, err = %v — will genau eine", alle, err)
	}
	k := alle[0]
	if k.MaxLaengeMM != 450 || k.MaxBreiteMM != 340 || k.MaxHoeheMM != 25 {
		t.Errorf("Kanten = %d/%d/%d mm, will 450/340/25", k.MaxLaengeMM, k.MaxBreiteMM, k.MaxHoeheMM)
	}
	if k.MaxGewichtG != 1400 {
		t.Errorf("MaxGewichtG = %d, will 1400", k.MaxGewichtG)
	}
	if k.Sortierung != 2 {
		t.Errorf("Sortierung = %d, will 2", k.Sortierung)
	}
}

func TestKlasseOhneGrenzeWirdAbgelehnt(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)

	f := neueKlasse()
	f.Set("gewicht", "")
	w := hole(t, srv, http.MethodPost, "/tarife/neu", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "Gewicht") {
		t.Errorf("kein Hinweis auf das Gewicht:\n%s", w.Body.String())
	}
	if alle, _ := s.TarifKlassen(); len(alle) != 0 {
		t.Errorf("%d Klassen angelegt, will 0 — eine offene Grenze passt nie", len(alle))
	}
}

func TestTabelleSpeichernTraegtBetraegeEinUndLeertSie(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)
	id, err := s.TarifKlasseAnlegen(fba.Klasse{
		Sortierung: 1, Bezeichnung: "Standard",
		MaxLaengeMM: 450, MaxBreiteMM: 340, MaxHoeheMM: 260, MaxGewichtG: 11900,
	})
	if err != nil {
		t.Fatalf("Anlegen: %v", err)
	}
	nr := strconv.FormatInt(id, 10)

	f := url.Values{
		"lagerland": {"DE"},
		"bez." + nr: {"Standard"}, "sortierung." + nr: {"1"},
		"laenge." + nr: {"45"}, "breite." + nr: {"34"},
		"hoehe." + nr: {"26"}, "gewicht." + nr: {"11900"},
		"geb." + nr + ".IT": {"6,89"},
		"geb." + nr + ".FR": {""},
	}
	if w := hole(t, srv, http.MethodPost, "/tarife", f.Encode()); w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	g, da, _ := s.TarifGebuehr(id, "IT", fba.EFN)
	if !da || g.Cent != 689 {
		t.Errorf("IT = %d, da = %v — will 689, true", g.Cent, da)
	}
	// Ein leeres Feld heißt "nicht eingetragen", nicht "0,00 €".
	if _, da, _ := s.TarifGebuehr(id, "FR", fba.EFN); da {
		t.Error("FR hat einen Betrag, will keinen")
	}
}

// tarifStaffel legt zwei Klassen an: einen Brief und ein Päckchen. Nur das
// Päckchen bekommt einen italienischen Preis.
func tarifStaffel(t *testing.T, s *store.Store) {
	t.Helper()
	brief, err := s.TarifKlasseAnlegen(fba.Klasse{
		Sortierung: 1, Bezeichnung: "Brief",
		MaxLaengeMM: 330, MaxBreiteMM: 230, MaxHoeheMM: 25, MaxGewichtG: 460,
	})
	if err != nil {
		t.Fatalf("Anlegen: %v", err)
	}
	paeckchen, err := s.TarifKlasseAnlegen(fba.Klasse{
		Sortierung: 2, Bezeichnung: "Päckchen",
		MaxLaengeMM: 350, MaxBreiteMM: 250, MaxHoeheMM: 120, MaxGewichtG: 3900,
	})
	if err != nil {
		t.Fatalf("Anlegen: %v", err)
	}
	if err := s.TarifGebuehrSetzen(paeckchen, "IT", fba.EFN, fba.Gebuehr{Cent: 689}); err != nil {
		t.Fatalf("Setzen: %v", err)
	}
	_ = brief // absichtlich ohne italienischen Preis
}

func TestEFNGebuehrTrifftDiePassendeKlasse(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)
	tarifStaffel(t, s)

	// 1,2 kg: fällt am Brief vorbei ins Päckchen. Dazu der Zuschlag je
	// Einheit aus den Einstellungen, Vorgabe 0,26 €.
	cent, klasse, ok := srv.tarifGebuehr(marketplace.IT,
		fba.Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 100, GewichtG: 1200})
	if !ok {
		t.Fatal("kein Treffer, will den Päckchenpreis")
	}
	if cent != 689+26 || klasse != "Päckchen" {
		t.Errorf("cent = %d, Klasse = %q — will 715 (689 + 0,26 € Zuschlag) und \"Päckchen\"", cent, klasse)
	}
}

func TestZuschlagJeEinheitKommtObendrauf(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)
	tarifStaffel(t, s)
	m := fba.Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 100, GewichtG: 1200}

	// Wer am Central Europe Program teilnimmt, trägt 0 ein — dann gilt die
	// Staffel unverändert.
	if err := s.SetzeEinstellung(store.SchluesselEFNZuschlag, "0"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}
	if cent, _, _ := srv.tarifGebuehr(marketplace.IT, m); cent != 689 {
		t.Errorf("cent = %d, will 689 ohne Zuschlag", cent)
	}

	if err := s.SetzeEinstellung(store.SchluesselEFNZuschlag, "0,26"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}
	if cent, _, _ := srv.tarifGebuehr(marketplace.IT, m); cent != 715 {
		t.Errorf("cent = %d, will 715", cent)
	}

	// Ein vertippter Zuschlag darf keine Gebühr erfinden.
	if err := s.SetzeEinstellung(store.SchluesselEFNZuschlag, "abc"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}
	if cent, _, _ := srv.tarifGebuehr(marketplace.IT, m); cent != 689 {
		t.Errorf("cent = %d, will 689 — Unlesbares zählt als null", cent)
	}
}

func TestKilogrammStaffelWirktInDerVorbelegung(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)
	if err := s.SetzeEinstellung(store.SchluesselEFNZuschlag, "0"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}
	id, err := s.TarifKlasseAnlegen(fba.Klasse{
		Sortierung: 1, Bezeichnung: "Kleine Übergröße",
		MaxLaengeMM: 610, MaxBreiteMM: 460, MaxHoeheMM: 460, MaxGewichtG: 1760,
	})
	if err != nil {
		t.Fatalf("Anlegen: %v", err)
	}
	if err := s.TarifGebuehrSetzen(id, "IT", fba.EFN, fba.Gebuehr{Cent: 1768, FreiGewichtG: 760, CentProKg: 36}); err != nil {
		t.Fatalf("Setzen: %v", err)
	}

	// 1,5 kg: 740 g über dem Grundgewicht, also ein angefangenes Kilogramm.
	cent, _, ok := srv.tarifGebuehr(marketplace.IT,
		fba.Masse{LaengeMM: 600, BreiteMM: 450, HoeheMM: 450, GewichtG: 1500})
	if !ok || cent != 1768+36 {
		t.Errorf("cent = %d, ok = %v — will 1804", cent, ok)
	}
}

func TestKlasseOhnePreisRutschtNichtInDieNaechstgroessere(t *testing.T) {
	// Der Kern der Sache: der Brief trifft, hat aber keinen IT-Preis. Dann
	// gibt es keinen EFN-Tarif — und nicht etwa den Päckchenpreis. Sonst
	// zahlte ein Brief still Päckchengebühr.
	srv, s := testServer(t)
	staffelLeeren(t, s)
	tarifStaffel(t, s)

	if cent, klasse, ok := srv.tarifGebuehr(marketplace.IT,
		fba.Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 20, GewichtG: 300}); ok {
		t.Errorf("Treffer %q zu %d, will keinen — dem Brief fehlt der IT-Preis", klasse, cent)
	}
}

func TestEFNGebuehrGiltNichtFuersLagerland(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)
	tarifStaffel(t, s)
	// Selbst ein eingetragener DE-Betrag darf nicht greifen.
	alle, err := s.TarifKlassen()
	if err != nil || len(alle) < 2 {
		t.Fatalf("Klassen = %v, err = %v", alle, err)
	}
	if err := s.TarifGebuehrSetzen(alle[1].ID, "DE", fba.EFN, fba.Gebuehr{Cent: 544}); err != nil {
		t.Fatalf("Setzen: %v", err)
	}

	if _, _, ok := srv.tarifGebuehr(marketplace.DE,
		fba.Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 100, GewichtG: 1200}); ok {
		t.Error("Treffer für DE, will keinen — dorthin gibt es keinen EFN-Versand")
	}
}

func TestEFNGebuehrOhneMasseUndOhneStaffel(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)

	// Leere Staffel: der Zustand direkt nach dem Upgrade.
	if _, _, ok := srv.tarifGebuehr(marketplace.IT,
		fba.Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 100, GewichtG: 1200}); ok {
		t.Error("Treffer bei leerer Staffel, will keinen")
	}

	tarifStaffel(t, s)
	// Keepa kennt die Maße nicht.
	if _, _, ok := srv.tarifGebuehr(marketplace.IT, fba.Masse{}); ok {
		t.Error("Treffer ohne Maße, will keinen")
	}
}

func TestZentimeterSchreibtZurueck(t *testing.T) {
	for mm, will := range map[int]string{330: "33", 25: "2,5", 450: "45", 5: "0,5"} {
		if got := zentimeter(mm); got != will {
			t.Errorf("zentimeter(%d) = %q, will %q", mm, got, will)
		}
	}
}

func TestGrammNimmtTausenderpunktAberKeinKomma(t *testing.T) {
	if g, err := gramm("1.400"); err != nil || g != 1400 {
		t.Errorf("gramm(\"1.400\") = %d, %v — will 1400, nil", g, err)
	}
	// "1,4" wäre in Kilogramm gedacht und ergäbe stillschweigend 1 g statt
	// 1400 g. Das muss auffallen.
	if _, err := gramm("1,4"); err == nil {
		t.Error("gramm(\"1,4\") ohne Fehler — ein als Kilogramm gemeintes Komma muss auffallen")
	}
}

// Die Rangfolge der Vorbelegung ist der Kern dieser Änderung: ins Ausland
// führt die Staffel, im Lagerland führt Keepa.
func TestVorbelegungFolgtDemVersandweg(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)
	if err := s.SetzeEinstellung(store.SchluesselEFNZuschlag, "0"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}

	id, err := s.TarifKlasseAnlegen(fba.Klasse{
		Sortierung: 1, Bezeichnung: "Standardpaket",
		MaxLaengeMM: 450, MaxBreiteMM: 340, MaxHoeheMM: 260, MaxGewichtG: 11900,
	})
	if err != nil {
		t.Fatalf("Anlegen: %v", err)
	}
	if err := s.TarifGebuehrSetzen(id, "IT", fba.EFN, fba.Gebuehr{Cent: 1043}); err != nil {
		t.Fatalf("Setzen: %v", err)
	}
	if err := s.TarifGebuehrSetzen(id, "DE", fba.Lokal, fba.Gebuehr{Cent: 367}); err != nil {
		t.Fatalf("Setzen: %v", err)
	}

	produkt := keepa.Product{
		FBA:   keepa.Price{Cents: 864, OK: true},
		Masse: fba.Masse{LaengeMM: 400, BreiteMM: 320, HoeheMM: 105, GewichtG: 4200},
	}

	// Ziel IT: Keepa nennt die italienische *lokale* Gebühr, gebraucht wird
	// der EFN-Tarif. Die Staffel gewinnt.
	//
	// uebernehmeArtikel geht voran, so wie in ladeDeal: die Paketmaße sind
	// eine Eigenschaft des Pakets und werden über alle Märkte aufgelöst,
	// bevor die erste Gebühr geschlagen wird. Ohne den ersten Durchgang wüsste
	// uebernehmeKeepa hier von keinen Maßen und fände keine Größenklasse.
	it, _ := marketplace.ByCode(marketplace.IT)
	d := srv.seitenGeruest(schrittRechnung)
	mitLeitmarkt(&d.Formular, marketplace.IT)
	srv.uebernehmeArtikel(&d, it, produkt)
	srv.uebernehmeKeepa(&d, it, produkt)
	if d.Formular.Leit().FBA != "10,43" {
		t.Errorf("IT: FBA = %q, will \"10,43\" — der EFN-Tarif schlägt Keepa", d.Formular.Leit().FBA)
	}
	if !strings.HasPrefix(d.Formular.Leit().FBAQuelle, "EFN-Tarif") {
		t.Errorf("IT: Quelle = %q, will EFN-Tarif", d.Formular.Leit().FBAQuelle)
	}

	// Ziel DE: hier ist Keepas Zahl genau die gesuchte, und sie stammt aus
	// Amazons eigener Einstufung. Keepa gewinnt.
	de, _ := marketplace.ByCode(marketplace.DE)
	d = srv.seitenGeruest(schrittRechnung)
	mitLeitmarkt(&d.Formular, marketplace.DE)
	srv.uebernehmeArtikel(&d, de, produkt)
	srv.uebernehmeKeepa(&d, de, produkt)
	if d.Formular.Leit().FBA != "8,64" {
		t.Errorf("DE: FBA = %q, will \"8,64\" — im Lagerland führt Keepa", d.Formular.Leit().FBA)
	}
	if d.Formular.Leit().FBAQuelle != "keepa" {
		t.Errorf("DE: Quelle = %q, will \"keepa\"", d.Formular.Leit().FBAQuelle)
	}

	// Ziel DE ohne Keepa-Gebühr: jetzt fängt die Staffel auf.
	ohne := produkt
	ohne.FBA = keepa.Price{}
	d = srv.seitenGeruest(schrittRechnung)
	mitLeitmarkt(&d.Formular, marketplace.DE)
	srv.uebernehmeArtikel(&d, de, ohne)
	srv.uebernehmeKeepa(&d, de, ohne)
	if d.Formular.Leit().FBA != "3,67" {
		t.Errorf("DE ohne Keepa: FBA = %q, will \"3,67\" — der lokale Tarif fängt auf", d.Formular.Leit().FBA)
	}
	if !strings.HasPrefix(d.Formular.Leit().FBAQuelle, "lokaler Tarif") {
		t.Errorf("DE ohne Keepa: Quelle = %q, will lokaler Tarif", d.Formular.Leit().FBAQuelle)
	}
}

// mitLeitmarkt stellt ein Formular auf genau einen Zielmarkt um — die Lage,
// die aus Schritt 2 kommt, wenn dort ein Markt gewählt wurde. Die
// marktabhängigen Werte bleiben dabei bewusst leer: es ist ein anderer
// Markt, und die Zahlen des vorigen gelten für ihn nicht.
func mitLeitmarkt(f *dealFormular, c marketplace.Code) {
	f.Maerkte = []marktFormular{{Code: c}}
	f.Leitmarkt = c
}

// panEUAufbau legt einen DE→ES-Deal an, wie er aus dem Funnel käme: 6er-Träger
// im Standardpaket, Zielmarkt ES, Maße aus Keepa.
func panEUAufbau(t *testing.T, s *store.Store) dealFormular {
	t.Helper()
	return dealFormular{
		ASIN: "B01636IZ0G", Quellmarkt: "DE",
		Leitmarkt: marketplace.ES,
		Maerkte: []marktFormular{{
			Code: marketplace.ES, VK: "89,99",
			Provision: "15", FBA: "18,32", Sales: "40",
		}},
		EK: "40,00", EKArt: "brutto",
		Masse: fba.Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 250, GewichtG: 6000},
	}
}

// aufDeutschesZiel verschiebt denselben Deal auf den Zielmarkt DE — dort
// liegt die Ware schon, also gibt es keinen zweiten Versandweg. Die Zahlen
// des Marktes reisen mit, weil allein der Markt zur Debatte steht.
func aufDeutschesZiel(f dealFormular) dealFormular {
	f.Maerkte[0].Code = marketplace.DE
	f.Leitmarkt = marketplace.DE
	return f
}

func TestPanEUVergleichBeiZielImAusland(t *testing.T) {
	srv, s := testServer(t)

	erg, err := srv.rechneDeal(panEUAufbau(t, s))
	if err != nil {
		t.Fatalf("rechneDeal: %v", err)
	}
	m := erg.Leit()
	if m.PanEU == nil {
		t.Fatal("kein Pan-EU-Vergleich, will einen")
	}

	// Startbestückung: Standardpaket ≤ 8,9 kg kostet über EFN 18,06 € plus
	// 0,26 € Zuschlag, lokal in ES 7,24 €.
	if m.PanEUGebuehr != 724 {
		t.Errorf("PanEUGebuehr = %d, will 724", m.PanEUGebuehr)
	}
	// Nur die Gebühr unterscheidet sich, also unterscheidet sich der Gewinn
	// um genau denselben Betrag.
	if got := m.PanEU.Gewinn - m.Ergebnis.Gewinn; got != m.FBA-m.PanEUGebuehr {
		t.Errorf("Gewinnunterschied = %d, will %d", got, m.FBA-m.PanEUGebuehr)
	}
	if m.PanEU.Gewinn <= m.Ergebnis.Gewinn {
		t.Error("Pan-EU ist nicht besser — bei lokaler Gebühr muss es das sein")
	}
}

func TestKeinPanEUVergleichImLagerland(t *testing.T) {
	// Nach DE gibt es keinen zweiten Weg: die Ware liegt schon dort.
	srv, s := testServer(t)
	f := aufDeutschesZiel(panEUAufbau(t, s))

	erg, err := srv.rechneDeal(f)
	if err != nil {
		t.Fatalf("rechneDeal: %v", err)
	}
	if m := erg.Leit(); m.PanEU != nil {
		t.Errorf("Pan-EU-Vergleich vorhanden (%+v), will keinen", m.PanEU)
	}
}

func TestKeinPanEUVergleichOhneMasse(t *testing.T) {
	// Ohne Maße gibt es keine Klasse und damit keine zwei Tarife.
	srv, s := testServer(t)
	f := panEUAufbau(t, s)
	f.Masse = fba.Masse{}

	erg, err := srv.rechneDeal(f)
	if err != nil {
		t.Fatalf("rechneDeal: %v", err)
	}
	if m := erg.Leit(); m.PanEU != nil {
		t.Error("Pan-EU-Vergleich ohne Maße, will keinen")
	}
}

func TestPostZeigtPanEUNurWennEsIhnGibt(t *testing.T) {
	srv, s := testServer(t)

	mit, err := srv.baueDeal(panEUAufbau(t, s))
	if err != nil {
		t.Fatalf("baueDeal: %v", err)
	}
	if !strings.Contains(mit.Text, "Pan-EU") {
		t.Errorf("Post nennt Pan-EU nicht:\n%s", mit.Text)
	}

	f := aufDeutschesZiel(panEUAufbau(t, s))
	ohne, err := srv.baueDeal(f)
	if err != nil {
		t.Fatalf("baueDeal: %v", err)
	}
	if strings.Contains(ohne.Text, "Pan-EU") {
		t.Errorf("Post nennt Pan-EU beim Ziel im Lagerland:\n%s", ohne.Text)
	}
}

// --- Regressionen aus dem Review von PR #6 ---

func TestR1PanEUNimmtDenLokalenTarifNichtDieHandeingabe(t *testing.T) {
	// Wird die Gebühr von Hand korrigiert, darf der Vergleich nicht aus ihr
	// abgeleitet werden: bei EFN 18,32 €, lokal 7,24 € und einer Eingabe von
	// 12,00 € kämen über die Differenz 0,92 € heraus — eine erfundene Zahl,
	// die anschließend im Post stünde.
	srv, s := testServer(t)
	f := panEUAufbau(t, s)
	f.Maerkte[0].FBA = "12,00"

	erg, err := srv.rechneDeal(f)
	if err != nil {
		t.Fatalf("rechneDeal: %v", err)
	}
	m := erg.Leit()
	if m.PanEU == nil {
		t.Fatal("kein Pan-EU-Vergleich, will einen")
	}
	if m.PanEUGebuehr != 724 {
		t.Errorf("PanEUGebuehr = %d, will 724 — der lokale Tarif, nicht 12,00 € minus Differenz", m.PanEUGebuehr)
	}
}

func TestR2UngueltigeTabelleSpeichertNichts(t *testing.T) {
	srv, s := testServer(t)
	staffelLeeren(t, s)

	ids := make([]string, 0, 2)
	for _, bez := range []string{"Erste", "Zweite"} {
		id, err := s.TarifKlasseAnlegen(fba.Klasse{
			Sortierung: len(ids) + 1, Bezeichnung: bez,
			MaxLaengeMM: 450, MaxBreiteMM: 340, MaxHoeheMM: 260, MaxGewichtG: 11900,
		})
		if err != nil {
			t.Fatalf("Anlegen: %v", err)
		}
		if err := s.TarifGebuehrSetzen(id, "DE", fba.Lokal, fba.Gebuehr{Cent: 207}); err != nil {
			t.Fatalf("Setzen: %v", err)
		}
		ids = append(ids, strconv.FormatInt(id, 10))
	}

	f := url.Values{"lagerland": {"DE"}}
	for i, id := range ids {
		f.Set("bez."+id, "Klasse")
		f.Set("sortierung."+id, strconv.Itoa(i+1))
		f.Set("laenge."+id, "45")
		f.Set("breite."+id, "34")
		f.Set("hoehe."+id, "26")
		f.Set("gewicht."+id, "11900")
		f.Set("geb."+id+".FR", "")
		f.Set("geb."+id+".IT", "")
		f.Set("geb."+id+".ES", "")
	}
	// Erste Zelle gültig, zweite kaputt: die erste darf trotzdem nicht
	// geschrieben werden.
	f.Set("geb."+ids[0]+".DE", "9,99")
	f.Set("geb."+ids[1]+".DE", "kaputt")

	w := hole(t, srv, http.MethodPost, "/tarife", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "kein Betrag") {
		t.Errorf("kein Validierungsfehler in der Antwort:\n%s", w.Body.String())
	}

	id, _ := strconv.ParseInt(ids[0], 10, 64)
	g, da, _ := s.TarifGebuehr(id, "DE", fba.Lokal)
	if !da || g.Cent != 207 {
		t.Errorf("erste Gebühr = %d (da = %v), will unverändert 207", g.Cent, da)
	}
	// Die Eingaben bleiben zur Korrektur stehen.
	if !strings.Contains(w.Body.String(), `value="9,99"`) {
		t.Error("die abgeschickten Werte sind verloren")
	}
}

func TestR3VeraltetesLagerlandWirdAbgelehnt(t *testing.T) {
	// Die Tabelle wurde für DE gebaut, das Lagerland steht inzwischen auf IT:
	// die angezeigten IT-EFN-Beträge dürfen nicht als IT-lokal landen.
	srv, s := testServer(t)
	if err := s.SetzeEinstellung(store.SchluesselLagerland, "IT"); err != nil {
		t.Fatalf("Einstellung: %v", err)
	}
	alle, _ := s.TarifKlassen()
	if len(alle) == 0 {
		t.Fatal("leere Staffel")
	}
	vorher, _, _ := s.TarifGebuehr(alle[0].ID, "IT", fba.Lokal)

	nr := strconv.FormatInt(alle[0].ID, 10)
	f := url.Values{
		"lagerland": {"DE"}, // veraltet
		"bez." + nr: {"Leichter Umschlag ≤ 20 g"}, "sortierung." + nr: {"1"},
		"laenge." + nr: {"33"}, "breite." + nr: {"23"},
		"hoehe." + nr: {"2,5"}, "gewicht." + nr: {"20"},
		"geb." + nr + ".IT": {"5,08"},
	}
	w := hole(t, srv, http.MethodPost, "/tarife", f.Encode())
	if !strings.Contains(w.Body.String(), "Lagerland") {
		t.Errorf("kein Hinweis auf das Lagerland:\n%s", w.Body.String())
	}

	nachher, _, _ := s.TarifGebuehr(alle[0].ID, "IT", fba.Lokal)
	if nachher.Cent != vorher.Cent {
		t.Errorf("IT-lokal = %d, war %d — nichts hätte geschrieben werden dürfen", nachher.Cent, vorher.Cent)
	}
}

func TestR5MasseWerdenMitDenKeepaWertenGeleert(t *testing.T) {
	// Scheitert der Abruf für eine neue ASIN, dürfen die Maße des vorherigen
	// Artikels nicht stehen bleiben — sonst rechnet der Pan-EU-Vergleich mit
	// dessen Größenklasse weiter.
	f := dealFormular{
		Titel: "Alt", BildKennung: "abc.jpg",
		Leitmarkt: marketplace.ES,
		Maerkte:   []marktFormular{{Code: marketplace.ES, FBA: "8,64"}},
		Masse:     fba.Masse{LaengeMM: 300, BreiteMM: 200, HoeheMM: 250, GewichtG: 6000},
	}
	f.keepaWerteLeeren()
	if f.Masse != (fba.Masse{}) {
		t.Errorf("Masse = %+v, will leer", f.Masse)
	}
	// Die Gebühr hängt am selben Artikel und muss denselben Weg gehen — seit
	// sie im Markt steht, räumt keepaWerteLeeren dort und nicht mehr flach im
	// Formular ab.
	if f.Leit().FBA != "" {
		t.Errorf("FBA = %q, will leer", f.Leit().FBA)
	}
}
