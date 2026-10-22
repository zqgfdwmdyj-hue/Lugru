package store

import (
	"testing"
	"time"
)

func beispielDeal(channelID int64, asin, notiz string) Deal {
	return Deal{
		ASIN: asin, Titel: "Makita HR2630",
		Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, EKNotiz: notiz,
		VKCent: 20749, VKQuelle: "avg90",
		Sales: 40, SalesQuelle: "monthlySold",
		ProvisionProzent: 15, ProvisionQuelle: "keepa",
		FBACent: 864, FBAQuelle: "keepa",
		UStModus: "netto", GewinnCent: 3167, MargeProzent: 15.26,
		ChannelID: channelID, ChannelName: "deals-vip",
		NachrichtText:      "🛒 Makita HR2630 B01636IZ0G",
		ChartDatei:         asin + "-20260905-120000.png",
		DiscordNachrichtID: "999",
	}
}

// TestDealRunde prüft, dass ALLE Felder eines Deal den Schreib-/Lesezyklus
// überstehen — nicht nur ein paar Stichproben. Jedes Feld bekommt einen
// eigenen, wiedererkennbaren Wert (jede *_quelle einen anderen String, jedes
// Geldfeld einen anderen Betrag, beide Marktplätze unterschiedliche Codes),
// damit eine künftige Vertauschung in dealSpalten/scanDeal auffällt, statt
// sich hinter zwei gleichartigen Werten zu verstecken. Die Spaltenreihenfolge
// wurde bislang nur von Hand geprüft — das hier ist der automatisierte
// Wächter dafür.
func TestDealRunde(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "deals-vip", WebhookURL: "https://x/1"})

	will := Deal{
		ASIN:       "B0ASINWERT1",
		Titel:      "Titel-Wert",
		Quellmarkt: "ES",
		Zielmarkt:  "DE",

		EKCent:  11111,
		EKNotiz: "EK-Notiz-Wert",

		VKCent:   22222,
		VKQuelle: "VK-Quelle-Wert",

		Sales:       33,
		SalesQuelle: "Sales-Quelle-Wert",

		ProvisionProzent: 14.5,
		ProvisionQuelle:  "Provision-Quelle-Wert",

		FBACent:   44444,
		FBAQuelle: "FBA-Quelle-Wert",

		UStModus:     "brutto",
		GewinnCent:   55555,
		MargeProzent: 27.75,

		ChannelID:   cid,
		ChannelName: "Channel-Name-Wert",

		NachrichtText:      "Nachricht-Text-Wert",
		ChartDatei:         "Chart-Datei-Wert.png",
		DiscordNachrichtID: "Discord-Nachricht-ID-Wert",
		GepostetAm:         time.Date(2026, 3, 14, 9, 26, 53, 123456789, time.UTC),
	}

	id, err := s.DealAnlegen(will)
	if err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	d, err := s.Deal(id)
	if err != nil {
		t.Fatalf("Deal: %v", err)
	}

	if d.ID != id {
		t.Errorf("ID = %d, will %d", d.ID, id)
	}
	if d.ASIN != will.ASIN {
		t.Errorf("ASIN = %q, will %q", d.ASIN, will.ASIN)
	}
	if d.Titel != will.Titel {
		t.Errorf("Titel = %q, will %q", d.Titel, will.Titel)
	}
	if d.Quellmarkt != will.Quellmarkt {
		t.Errorf("Quellmarkt = %q, will %q", d.Quellmarkt, will.Quellmarkt)
	}
	if d.Zielmarkt != will.Zielmarkt {
		t.Errorf("Zielmarkt = %q, will %q", d.Zielmarkt, will.Zielmarkt)
	}
	if d.EKCent != will.EKCent {
		t.Errorf("EKCent = %d, will %d", d.EKCent, will.EKCent)
	}
	if d.EKNotiz != will.EKNotiz {
		t.Errorf("EKNotiz = %q, will %q", d.EKNotiz, will.EKNotiz)
	}
	if d.VKCent != will.VKCent {
		t.Errorf("VKCent = %d, will %d", d.VKCent, will.VKCent)
	}
	if d.VKQuelle != will.VKQuelle {
		t.Errorf("VKQuelle = %q, will %q", d.VKQuelle, will.VKQuelle)
	}
	if d.Sales != will.Sales {
		t.Errorf("Sales = %d, will %d", d.Sales, will.Sales)
	}
	if d.SalesQuelle != will.SalesQuelle {
		t.Errorf("SalesQuelle = %q, will %q", d.SalesQuelle, will.SalesQuelle)
	}
	if d.ProvisionProzent != will.ProvisionProzent {
		t.Errorf("ProvisionProzent = %v, will %v", d.ProvisionProzent, will.ProvisionProzent)
	}
	if d.ProvisionQuelle != will.ProvisionQuelle {
		t.Errorf("ProvisionQuelle = %q, will %q", d.ProvisionQuelle, will.ProvisionQuelle)
	}
	if d.FBACent != will.FBACent {
		t.Errorf("FBACent = %d, will %d", d.FBACent, will.FBACent)
	}
	if d.FBAQuelle != will.FBAQuelle {
		t.Errorf("FBAQuelle = %q, will %q", d.FBAQuelle, will.FBAQuelle)
	}
	if d.UStModus != will.UStModus {
		t.Errorf("UStModus = %q, will %q", d.UStModus, will.UStModus)
	}
	if d.GewinnCent != will.GewinnCent {
		t.Errorf("GewinnCent = %d, will %d", d.GewinnCent, will.GewinnCent)
	}
	if d.MargeProzent != will.MargeProzent {
		t.Errorf("MargeProzent = %v, will %v", d.MargeProzent, will.MargeProzent)
	}
	if d.ChannelID != will.ChannelID {
		t.Errorf("ChannelID = %d, will %d", d.ChannelID, will.ChannelID)
	}
	if d.ChannelName != will.ChannelName {
		t.Errorf("ChannelName = %q, will %q", d.ChannelName, will.ChannelName)
	}
	if d.NachrichtText != will.NachrichtText {
		t.Errorf("NachrichtText = %q, will %q", d.NachrichtText, will.NachrichtText)
	}
	if d.ChartDatei != will.ChartDatei {
		t.Errorf("ChartDatei = %q, will %q", d.ChartDatei, will.ChartDatei)
	}
	if d.DiscordNachrichtID != will.DiscordNachrichtID {
		t.Errorf("DiscordNachrichtID = %q, will %q", d.DiscordNachrichtID, will.DiscordNachrichtID)
	}
	if !d.GepostetAm.Equal(will.GepostetAm) {
		t.Errorf("GepostetAm = %v, will %v", d.GepostetAm, will.GepostetAm)
	}
}

// TestGepostetAmSekundengrenze belegt Important-Finding 1: time.RFC3339Nano
// kürzt den Sekundenbruchteil, und bei exakt 0 ns verschwindet er ganz. Da
// SQLite gepostet_am als Zeichenkette sortiert/filtert und 'Z' (0x5A) nach
// '.' (0x2E) steht, kehrt das sowohl "ORDER BY gepostet_am DESC" als auch
// den Von-Filter an der vollen-Sekunde-Grenze um. Ein Deal mit Bruchteil
// (chronologisch später) muss trotzdem vor einem Deal mit exakt 0 ns
// (chronologisch früher) einsortiert werden, und ein Von-Filter genau auf
// der vollen Sekunde darf den Bruchteil-Deal derselben Sekunde nicht
// verlieren. Mit time.RFC3339Nano schlägt dieser Test fehl; mit zeitLayout
// (fester Nachkommastellen-Breite) besteht er.
func TestGepostetAmSekundengrenze(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})

	sekunde := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)

	null := beispielDeal(cid, "B0NULLNS000", "n")
	null.GepostetAm = sekunde // exakt 0 ns
	if _, err := s.DealAnlegen(null); err != nil {
		t.Fatalf("DealAnlegen(null): %v", err)
	}

	bruch := beispielDeal(cid, "B0BRUCHNS00", "n")
	bruch.GepostetAm = sekunde.Add(500 * time.Millisecond) // dieselbe Sekunde, mit Bruchteil
	if _, err := s.DealAnlegen(bruch); err != nil {
		t.Fatalf("DealAnlegen(bruch): %v", err)
	}

	// Reihenfolge: der chronologisch spätere (mit Bruchteil) muss zuerst
	// kommen — "neueste zuerst".
	ds, err := s.Deals(DealFilter{Limit: 50})
	if err != nil {
		t.Fatalf("Deals: %v", err)
	}
	if len(ds) != 2 || ds[0].ASIN != "B0BRUCHNS00" || ds[1].ASIN != "B0NULLNS000" {
		t.Errorf("Reihenfolge an der Sekundengrenze falsch, will [B0BRUCHNS00 B0NULLNS000]: %+v", ds)
	}

	// Ein Von-Filter genau auf der Sekundengrenze (0 ns) muss den
	// Bruchteil-Eintrag derselben Sekunde einschließen.
	gefiltert, err := s.Deals(DealFilter{Von: sekunde, Limit: 50})
	if err != nil {
		t.Fatalf("Deals(Von): %v", err)
	}
	if len(gefiltert) != 2 {
		t.Errorf("Von-Filter an der Sekundengrenze = %d Treffer, will 2: %+v", len(gefiltert), gefiltert)
	}
	var bruchGefunden bool
	for _, d := range gefiltert {
		if d.ASIN == "B0BRUCHNS00" {
			bruchGefunden = true
		}
	}
	if !bruchGefunden {
		t.Errorf("Von-Filter an der Sekundengrenze verliert den Bruchteil-Eintrag: %+v", gefiltert)
	}
}

func TestHistorieUeberlebtGeloeschtenChannel(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "deals-vip", WebhookURL: "https://x/1"})
	id, _ := s.DealAnlegen(beispielDeal(cid, "B01636IZ0G", "n"))

	if err := s.ChannelLoeschen(cid); err != nil {
		t.Fatalf("ChannelLoeschen: %v", err)
	}

	d, err := s.Deal(id)
	if err != nil {
		t.Fatalf("Deal nach Channel-Löschung: %v", err)
	}
	if d.ChannelName != "deals-vip" {
		t.Errorf("ChannelName = %q — der Name wird mitgespeichert, damit die Historie das überlebt", d.ChannelName)
	}
}

func TestDealsSuche(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(beispielDeal(cid, "B01636IZ0G", "n"))

	zweiter := beispielDeal(cid, "B0OTHER123", "n")
	zweiter.Titel = "Bosch GBH"
	s.DealAnlegen(zweiter)

	faelle := []struct {
		suche string
		will  int
	}{
		{"", 2},
		{"B01636IZ0G", 1},
		{"b01636iz0g", 1},
		{"Bosch", 1},
		{"Makita", 1},
		{"gibtsnicht", 0},
	}
	for _, f := range faelle {
		ds, err := s.Deals(DealFilter{Suche: f.suche, Limit: 50})
		if err != nil {
			t.Fatalf("Deals(%q): %v", f.suche, err)
		}
		if len(ds) != f.will {
			t.Errorf("Deals(%q) = %d Treffer, will %d", f.suche, len(ds), f.will)
		}
	}
}

func TestDealsNeuesteZuerst(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})

	alt := beispielDeal(cid, "B0ALT000000", "n")
	alt.GepostetAm = time.Now().Add(-48 * time.Hour)
	s.DealAnlegen(alt)

	neu := beispielDeal(cid, "B0NEU000000", "n")
	neu.GepostetAm = time.Now()
	s.DealAnlegen(neu)

	ds, err := s.Deals(DealFilter{Limit: 50})
	if err != nil {
		t.Fatalf("Deals: %v", err)
	}
	if len(ds) != 2 || ds[0].ASIN != "B0NEU000000" {
		t.Errorf("Reihenfolge falsch: %v", ds)
	}
}

func TestEKNotizen(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(beispielDeal(cid, "B0A0000000", "Brutto inkl. Versand"))
	s.DealAnlegen(beispielDeal(cid, "B0B0000000", "Brutto inkl. Versand (3er cart)"))
	s.DealAnlegen(beispielDeal(cid, "B0C0000000", "Brutto inkl. Versand"))

	notizen, err := s.EKNotizen()
	if err != nil {
		t.Fatalf("EKNotizen: %v", err)
	}
	if len(notizen) != 2 {
		t.Errorf("%d Notizen, will 2 (ohne Dopplung): %v", len(notizen), notizen)
	}
}

func TestDealsAnzahl(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(beispielDeal(cid, "B0A0000000", "n"))
	s.DealAnlegen(beispielDeal(cid, "B0B0000000", "n"))

	n, err := s.DealsAnzahl(DealFilter{})
	if err != nil {
		t.Fatalf("DealsAnzahl: %v", err)
	}
	if n != 2 {
		t.Errorf("DealsAnzahl = %d, will 2", n)
	}
}

func TestDealBildKennungUeberlebtDieRunde(t *testing.T) {
	s := temp(t)
	if _, err := s.DealAnlegen(Deal{
		ASIN: "B000BILD", Titel: "Mit Bild", ChannelID: 1, ChannelName: "test",
		BildKennung: "41Ny6ILlHnL.jpg",
	}); err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	deals, err := s.Deals(DealFilter{})
	if err != nil {
		t.Fatalf("Deals: %v", err)
	}
	if len(deals) != 1 {
		t.Fatalf("%d Deals, erwartet 1", len(deals))
	}
	if deals[0].BildKennung != "41Ny6ILlHnL.jpg" {
		t.Errorf("BildKennung = %q, erwartet %q", deals[0].BildKennung, "41Ny6ILlHnL.jpg")
	}
}

// Deals ohne Bild sind der Normalfall für alles, was vor dieser Änderung
// gepostet wurde. Sie müssen mit leerer Kennung lesbar bleiben.
func TestDealOhneBildKennung(t *testing.T) {
	s := temp(t)
	if _, err := s.DealAnlegen(Deal{ASIN: "B000OHNE", ChannelID: 1}); err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}
	d, err := s.Deal(1)
	if err != nil {
		t.Fatalf("Deal: %v", err)
	}
	if d.BildKennung != "" {
		t.Errorf("BildKennung = %q, erwartet leer", d.BildKennung)
	}
}

// beispielDealFuerMaerkte ist die Deal-Zeile für die Markt-Tests unten — hier
// nur als benannter Ausgangspunkt für die Marktzeilen. Ein eigener Name statt
// beispielDeal(...), weil dieser Deal (anders als beispielDeal) keinen
// eigenen Channel und kein variables ASIN braucht.
func beispielDealFuerMaerkte() Deal {
	return Deal{
		ASIN: "B01636IZ0G", Titel: "Makita HR2630",
		Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, EKArt: "brutto",
		VKCent: 20749, VKQuelle: "avg90",
		Sales: 40, SalesQuelle: "monthlySold",
		ProvisionProzent: 15, ProvisionQuelle: "keepa",
		FBACent: 864, FBAQuelle: "keepa",
		UStModus: "netto", GewinnCent: 2670, MargeProzent: 12.9,
		ChannelID: 1, ChannelName: "deals",
		NachrichtText: "Text",
	}
}

func TestDealAnlegenSpeichertDieMaerkte(t *testing.T) {
	s := temp(t)

	d := beispielDealFuerMaerkte()
	d.Maerkte = []DealMarkt{
		{Markt: "DE", Leitmarkt: true, VKCent: 20749, VKQuelle: "avg90",
			Sales: 40, SalesQuelle: "monthlySold",
			ProvisionProzent: 15, ProvisionQuelle: "keepa",
			FBACent: 864, FBAQuelle: "keepa",
			GewinnCent: 2670, MargeProzent: 12.9},
		{Markt: "IT", VKCent: 18900, VKQuelle: "avg90",
			Sales: 12, SalesQuelle: "monthlySold",
			ProvisionProzent: 15, ProvisionQuelle: "keepa",
			FBACent: 1806, FBAQuelle: "EFN-Tarif · Standardpaket",
			GewinnCent: 320, MargeProzent: 1.7,
			PanEU: &DealMarktPanEU{FBACent: 577, GewinnCent: 1548, MargeProzent: 8.2}},
	}

	id, err := s.DealAnlegen(d)
	if err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	nach, err := s.DealMaerkte([]int64{id})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	maerkte := nach[id]
	if len(maerkte) != 2 {
		t.Fatalf("%d Märkte gespeichert, will 2: %+v", len(maerkte), maerkte)
	}
	if maerkte[0].Markt != "DE" || !maerkte[0].Leitmarkt {
		t.Errorf("erster Markt = %+v, will DE als Leitmarkt", maerkte[0])
	}
	if maerkte[1].PanEU == nil || maerkte[1].PanEU.GewinnCent != 1548 {
		t.Errorf("Pan-EU von IT = %+v, will Gewinn 1548", maerkte[1].PanEU)
	}
	// Der Markt im Lagerland hat keinen zweiten Versandweg. Eine 0 stünde
	// dort als Aussage da, die niemand gerechnet hat.
	if maerkte[0].PanEU != nil {
		t.Errorf("DE hat einen Pan-EU-Vergleich: %+v", maerkte[0].PanEU)
	}
}

func TestDealAnlegenOhneMaerkteBleibtWieBisher(t *testing.T) {
	s := temp(t)

	id, err := s.DealAnlegen(beispielDealFuerMaerkte())
	if err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}
	gelesen, err := s.Deal(id)
	if err != nil || gelesen.GewinnCent != 2670 {
		t.Fatalf("Deal(%d) = %+v, %v", id, gelesen, err)
	}
	nach, err := s.DealMaerkte([]int64{id})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	if len(nach[id]) != 0 {
		t.Errorf("%d Marktzeilen ohne Märkte", len(nach[id]))
	}
}

// Ein Fehler beim Schreiben der Märkte darf keinen Deal hinterlassen, dessen
// gespeicherter Post vier Märkte nennt und dessen Datenbank einen kennt.
func TestDealAnlegenRolltBeiKaputterMarktzeileZurueck(t *testing.T) {
	s := temp(t)

	d := beispielDealFuerMaerkte()
	d.Maerkte = []DealMarkt{
		{Markt: "DE", Leitmarkt: true, GewinnCent: 2670},
		{Markt: "DE", GewinnCent: 999}, // verletzt PRIMARY KEY (deal_id, markt)
	}

	if _, err := s.DealAnlegen(d); err == nil {
		t.Fatal("DealAnlegen hat den doppelten Markt angenommen")
	}

	n, err := s.DealsAnzahl(DealFilter{})
	if err != nil {
		t.Fatalf("DealsAnzahl: %v", err)
	}
	if n != 0 {
		t.Errorf("%d Deals nach dem Fehlschlag, will 0 — die Transaktion hat nicht zurückgerollt", n)
	}
}
