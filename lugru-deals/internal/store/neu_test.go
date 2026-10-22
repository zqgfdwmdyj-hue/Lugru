package store

import (
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

func oeffneTest(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "t.db"), filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func testDeal(asin string, marge float64, am time.Time) Deal {
	return Deal{
		ASIN: asin, Titel: "Artikel " + asin, Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 10000, VKCent: 15000, GewinnCent: money.Cents(marge * 100), MargeProzent: marge,
		ChannelID: 1, ChannelName: "deals", NachrichtText: "x", GepostetAm: am,
	}
}

func TestMaxMengeUndStatusWerdenGespeichert(t *testing.T) {
	s := oeffneTest(t)
	d := testDeal("B000000001", 12, time.Now())
	d.MaxMenge = 3
	id, err := s.DealAnlegen(d)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DealStatusSetzen(id, StatusAusverkauft); err != nil {
		t.Fatal(err)
	}
	g, err := s.Deal(id)
	if err != nil {
		t.Fatal(err)
	}
	if g.MaxMenge != 3 || g.Status != StatusAusverkauft {
		t.Errorf("MaxMenge=%d Status=%q", g.MaxMenge, g.Status)
	}
	if err := s.DealStatusSetzen(9999, StatusAktiv); err == nil {
		t.Error("unbekannter Deal ohne Fehler")
	}
}

func TestFilterNachMargeUndStatus(t *testing.T) {
	s := oeffneTest(t)
	jetzt := time.Now()
	for _, d := range []Deal{
		testDeal("B000000001", 5, jetzt),
		testDeal("B000000002", 15, jetzt),
		testDeal("B000000003", 25, jetzt.AddDate(0, -2, 0)),
	} {
		if _, err := s.DealAnlegen(d); err != nil {
			t.Fatal(err)
		}
	}
	ab, bis := 10.0, 20.0
	if n, _ := s.DealsAnzahl(DealFilter{MargeMin: &ab}); n != 2 {
		t.Errorf("Marge ab 10: %d, will 2", n)
	}
	if n, _ := s.DealsAnzahl(DealFilter{MargeMin: &ab, MargeMax: &bis}); n != 1 {
		t.Errorf("Marge 10–20: %d, will 1", n)
	}
	if n, _ := s.DealsAnzahl(DealFilter{Von: jetzt.AddDate(0, -1, 0)}); n != 2 {
		t.Errorf("letzter Monat: %d, will 2", n)
	}

	ds, _ := s.Deals(DealFilter{Suche: "B000000002"})
	_ = s.DealStatusSetzen(ds[0].ID, StatusGeloescht)
	if n, _ := s.DealsAnzahl(DealFilter{Status: "aktiv"}); n != 2 {
		t.Errorf("aktiv: %d, will 2", n)
	}
	if n, _ := s.DealsAnzahl(DealFilter{Status: StatusGeloescht}); n != 1 {
		t.Errorf("gelöscht: %d, will 1", n)
	}
}

func TestStatistikLaesstGeloeschteWeg(t *testing.T) {
	s := oeffneTest(t)
	jetzt := time.Now()
	a, _ := s.DealAnlegen(testDeal("B000000001", 10, jetzt))
	_, _ = s.DealAnlegen(testDeal("B000000002", 20, jetzt))
	c, _ := s.DealAnlegen(testDeal("B000000003", 30, jetzt))
	_ = s.DealStatusSetzen(a, StatusAusverkauft)
	_ = s.DealStatusSetzen(c, StatusGeloescht)

	st, err := s.Statistik(time.Time{}, time.Time{}, "")
	if err != nil {
		t.Fatal(err)
	}
	g := st.Gesamt
	if g.Anzahl != 2 || g.Ausverkauft != 1 || g.Gewinn != 3000 || g.MargeSchnitt != 15 {
		t.Errorf("Gesamt = %+v", g)
	}
	if len(st.Monate) != 1 || len(st.Channel) != 1 || len(st.Maerkte) != 1 {
		t.Errorf("Gruppen: %d Monate, %d Channel, %d Märkte", len(st.Monate), len(st.Channel), len(st.Maerkte))
	}
}

// Die Tabellen gruppieren nach Poster, Zielmarkt, Channel — nicht nach der
// Gruppe des Channels, deren Spalte ebenfalls "gruppe" heißt. Und jede
// Tabelle ergibt zusammen wieder die Gesamtsumme.
func TestStatistikTabellenGruppierenRichtig(t *testing.T) {
	s := oeffneTest(t)
	jetzt := time.Now()
	for i, x := range []struct{ poster, ziel, kanal, gruppe string }{
		{"ludwig", "DE", "a", "Server 1"}, {"ludwig", "ES", "b", "Server 2"},
		{"k95", "DE", "a", "Server 1"}, {"markah", "IT", "b", "Server 2"}, {"ludwig", "DE", "a", "Server 1"},
	} {
		d := testDeal("B00000000"+string(rune('1'+i)), 10+float64(i), jetzt)
		d.Poster, d.Zielmarkt, d.ChannelName, d.Gruppe = x.poster, x.ziel, x.kanal, x.gruppe
		if _, err := s.DealAnlegen(d); err != nil {
			t.Fatal(err)
		}
	}
	st, err := s.Statistik(time.Time{}, time.Time{}, "")
	if err != nil {
		t.Fatal(err)
	}
	zaehle := func(zs []StatistikZeile) map[string]int {
		m := map[string]int{}
		for _, z := range zs {
			m[z.Gruppe] = z.Anzahl
		}
		return m
	}
	if p := zaehle(st.Poster); p["ludwig"] != 3 || p["k95"] != 1 || p["markah"] != 1 {
		t.Errorf("je Poster = %v", p)
	}
	if m := zaehle(st.Maerkte); m["DE"] != 3 || m["ES"] != 1 || m["IT"] != 1 {
		t.Errorf("je Zielmarkt = %v", m)
	}
	if c := zaehle(st.Channel); c["a"] != 3 || c["b"] != 2 {
		t.Errorf("je Channel = %v", c)
	}
	for name, zs := range map[string][]StatistikZeile{
		"Poster": st.Poster, "Märkte": st.Maerkte, "Channel": st.Channel, "Monate": st.Monate,
		"Gruppen": st.Gruppen, "Quellen": st.Quellen,
	} {
		var n int
		var g money.Cents
		for _, z := range zs {
			n += z.Anzahl
			g += z.Gewinn
		}
		if n != st.Gesamt.Anzahl || g != st.Gesamt.Gewinn {
			t.Errorf("%s: %d Deals / %v, gesamt %d / %v", name, n, g, st.Gesamt.Anzahl, st.Gesamt.Gewinn)
		}
	}
}

func TestEntwuerfe(t *testing.T) {
	s := oeffneTest(t)
	id, err := s.EntwurfSpeichern(Entwurf{ASIN: "B000000001", Titel: "A", Schritt: 2, Formular: "asin=B000000001"})
	if err != nil {
		t.Fatal(err)
	}
	// Erneut mit derselben ID: überschreiben, nicht anlegen.
	if id2, _ := s.EntwurfSpeichern(Entwurf{ID: id, Titel: "B", Schritt: 3, Formular: "x=1"}); id2 != id {
		t.Errorf("zweites Speichern legte %d an statt %d zu überschreiben", id2, id)
	}
	alle, _ := s.Entwuerfe()
	if len(alle) != 1 || alle[0].Titel != "B" || alle[0].Schritt != 3 {
		t.Fatalf("Entwürfe = %+v", alle)
	}
	_ = s.EntwurfLoeschen(id)
	// Gelöscht und erneut gespeichert: wird ein neuer Entwurf.
	if id3, _ := s.EntwurfSpeichern(Entwurf{ID: id, Formular: "y=1"}); id3 == 0 || id3 == id {
		t.Errorf("gelöschter Entwurf: ID %d", id3)
	}
}

func TestGruppenUndReaktionsUebersicht(t *testing.T) {
	s := oeffneTest(t)
	c1, _ := s.ChannelAnlegen(Channel{Name: "a", WebhookURL: "x", Gruppe: "Server 1"})
	c2, _ := s.ChannelAnlegen(Channel{Name: "b", WebhookURL: "y"})
	jetzt := time.Now()
	d1 := testDeal("B000000001", 10, jetzt)
	d1.ChannelID, d1.Gruppe = c1, "Server 1"
	d2 := testDeal("B000000002", 20, jetzt)
	d2.ChannelID = c2
	d3 := testDeal("B000000003", 30, jetzt)
	d3.ChannelID = c2
	i1, _ := s.DealAnlegen(d1)
	i2, _ := s.DealAnlegen(d2)
	_, _ = s.DealAnlegen(d3)
	_ = s.DealReaktionenSetzen(i1, 4, 0, jetzt)
	_ = s.DealReaktionenSetzen(i2, 0, 2, jetzt)

	// Nachträglich zugeordnet: die Deals des Channels wandern mit.
	if err := s.ChannelGruppeSetzen(c2, "Server 2"); err != nil {
		t.Fatal(err)
	}
	if g, _ := s.Gruppen(); len(g) != 2 || g[0] != "Server 1" || g[1] != "Server 2" {
		t.Errorf("Gruppen = %v", g)
	}

	st, _ := s.Statistik(time.Time{}, time.Time{}, "Server 2")
	if st.Gesamt.Anzahl != 2 {
		t.Errorf("Server 2: %d Deals", st.Gesamt.Anzahl)
	}
	r := st.Reaktionen
	if r.Abgerufen != 1 || r.NichtAbgeruf != 1 || r.NurWeg != 1 || r.Weg != 2 || len(r.Liste) != 1 {
		t.Errorf("Reaktionen Server 2 = %+v", r)
	}
	alle, _ := s.Statistik(time.Time{}, time.Time{}, "")
	if len(alle.Gruppen) != 2 || alle.Reaktionen.MitKauf != 1 || alle.Reaktionen.Kaeufe != 4 {
		t.Errorf("alle: Gruppen %+v, Reaktionen %+v", alle.Gruppen, alle.Reaktionen)
	}
}

// Ein Deal, der über EFN Verlust macht, über Pan-EU aber Gewinn, zählt in
// der Auswertung mit den Pan-EU-Zahlen.
func TestPanEUDealZaehltMitPanEU(t *testing.T) {
	s := oeffneTest(t)
	d := testDeal("B07PQL649D", -19.2, time.Now())
	d.GewinnCent = -577
	d.Maerkte = []DealMarkt{{Markt: "FR", Leitmarkt: true, GewinnCent: -577, MargeProzent: -19.2,
		PanEU: &DealMarktPanEU{FBACent: 300, GewinnCent: 512, MargeProzent: 17.1}}}
	id, err := s.DealAnlegen(d)
	if err != nil {
		t.Fatal(err)
	}
	normal := testDeal("B000000002", 10, time.Now())
	_, _ = s.DealAnlegen(normal)

	g, _ := s.Deal(id)
	if !g.PanEU || g.EffGewinnCent != 512 || g.EffMargeProzent != 17.1 || g.GewinnCent != -577 {
		t.Errorf("Deal = PanEU %v, eff %d / %v, EFN %d", g.PanEU, g.EffGewinnCent, g.EffMargeProzent, g.GewinnCent)
	}
	st, _ := s.Statistik(time.Time{}, time.Time{}, "")
	if st.Gesamt.Gewinn != 512+1000 {
		t.Errorf("Statistik-Gewinn = %d, will 1512", st.Gesamt.Gewinn)
	}
	ab := 15.0
	if n, _ := s.DealsAnzahl(DealFilter{MargeMin: &ab}); n != 1 {
		t.Errorf("Marge ab 15 %%: %d, will 1 (der Pan-EU-Deal)", n)
	}

	// Alte Deals ohne Bewertung werden beim Start nachgezogen.
	_, _ = s.db.Exec(`UPDATE deals SET eff_gewinn_cent = NULL, eff_marge_prozent = NULL, pan_eu = 0`)
	_ = s.dealsBewerten(0)
	if g, _ := s.Deal(id); !g.PanEU || g.EffGewinnCent != 512 {
		t.Errorf("Nachziehen: %+v", g)
	}
}

func TestMengeAusNotiz(t *testing.T) {
	for notiz, will := range map[string]int{
		"Brutto inkl. Versand (3er cart)": 3, "3er Cart": 3, "Cart 5": 5, "Cart-Limit: 2": 2,
		"max. 4 Stück": 4, "Max 10 pro Kunde": 10, "Brutto inkl. Versand": 0, "": 0, "Limit 8": 8,
	} {
		if n := MengeAusNotiz(notiz); n != will {
			t.Errorf("MengeAusNotiz(%q) = %d, will %d", notiz, n, will)
		}
	}
}

// Gewinn mit Cart-Limit: Gewinn × Cart-Limit, ohne Limit × Standard. Was
// im B2B-Channel steht, bleibt draußen; Fremdshops und Einkauf ohne Link
// zählen normal.
func TestMengenGewinn(t *testing.T) {
	s := oeffneTest(t)
	normal, _ := s.ChannelAnlegen(Channel{Name: "super-low-margin-deals", WebhookURL: "https://discord.com/api/webhooks/1/a"})
	b2b, _ := s.ChannelAnlegen(Channel{Name: "b2b-deals", WebhookURL: "https://discord.com/api/webhooks/2/b"})
	jetzt := time.Now()
	mit := testDeal("B000000001", 10, jetzt) // 10 € Gewinn
	mit.EKNotiz = "Brutto (3er cart)"
	ohne := testDeal("B000000002", 5, jetzt) // 5 €, ohne Limit
	qogita := testDeal("B000000003", 2, jetzt)
	qogita.QuellURL, qogita.MaxMenge = "https://www.qogita.com/products/123", 2
	grosshandel := testDeal("B000000004", 1, jetzt)
	grosshandel.Lieferant, grosshandel.MaxMenge = "Metro", 1
	imB2B := testDeal("B000000005", 50, jetzt)
	for _, d := range []*Deal{&mit, &ohne, &qogita, &grosshandel} {
		d.ChannelID = normal
	}
	imB2B.ChannelID = b2b
	for _, d := range []Deal{mit, ohne, qogita, grosshandel, imB2B} {
		if _, err := s.DealAnlegen(d); err != nil {
			t.Fatal(err)
		}
	}
	st, err := s.Statistik(time.Time{}, time.Time{}, "")
	if err != nil {
		t.Fatal(err)
	}
	m := st.Menge
	// Vorgabe "auto": b2b-deals ist B2B. 10 € × 3 + 5 € × 6 + 2 € × 2 + 1 € × 1 = 65 €
	if m.Gewinn != 6500 || m.Deals != 4 || m.MitLimit != 3 || m.B2B != 1 || m.Standard != 6 ||
		len(m.B2BChannels) != 1 || m.B2BChannels[0] != "b2b-deals" {
		t.Errorf("%+v", m)
	}
	// Ausdrücklich kein B2B-Channel: alles zählt, der B2B-Deal mit 6 Stück.
	_ = s.SetzeEinstellung(SchluesselB2BChannels, "")
	_ = s.SetzeEinstellung(SchluesselStueckStandard, "1")
	st, _ = s.Statistik(time.Time{}, time.Time{}, "")
	if st.Menge.Gewinn != 3000+500+400+100+5000 || st.Menge.B2B != 0 {
		t.Errorf("ohne B2B-Channel: %+v", st.Menge)
	}
	// Der normale Channel von Hand als B2B gewählt.
	_ = s.SetzeEinstellung(SchluesselB2BChannels, itoa(normal))
	st, _ = s.Statistik(time.Time{}, time.Time{}, "")
	if st.Menge.Gewinn != 5000 || st.Menge.B2B != 4 {
		t.Errorf("gewählter Channel: %+v", st.Menge)
	}
}

func itoa(i int64) string { return strconv.FormatInt(i, 10) }

func TestDealInZweiChannels(t *testing.T) {
	s := oeffneTest(t)
	jetzt := time.Now()
	a := testDeal("B000000001", 10, jetzt)
	a.Gruppe, a.ChannelName = "Server A", "deals-a"
	haupt, _ := s.DealAnlegen(a)
	b := a
	b.Gruppe, b.ChannelName, b.HauptID = "Server B", "deals-b", haupt
	zweit, _ := s.DealAnlegen(b)
	_ = s.DealReaktionenSetzen(haupt, 2, 0, jetzt)
	_ = s.DealReaktionenSetzen(zweit, 3, 1, jetzt)

	alle, err := s.Statistik(time.Time{}, time.Time{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if g := alle.Gesamt; g.Anzahl != 1 || g.Gewinn != 1000 || g.Kaeufe != 5 {
		t.Errorf("alle Gruppen: %+v", g)
	}
	if alle.Reaktionen.Weg != 1 {
		t.Errorf("❌ über alle: %d", alle.Reaktionen.Weg)
	}
	nurB, _ := s.Statistik(time.Time{}, time.Time{}, "Server B")
	if g := nurB.Gesamt; g.Anzahl != 1 || g.Kaeufe != 3 {
		t.Errorf("Server B: %+v", g)
	}
	if d, _ := s.Deal(zweit); d.HauptID != haupt {
		t.Errorf("HauptID = %d", d.HauptID)
	}
}
