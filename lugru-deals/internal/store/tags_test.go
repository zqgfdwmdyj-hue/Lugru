package store

import "testing"

func TestTagRunde(t *testing.T) {
	s := temp(t)

	id, err := s.TagAnlegen(AffiliateTag{Name: "Hauptkonto DE", Tag: "beispiel-21", Markt: "DE"})
	if err != nil {
		t.Fatalf("TagAnlegen: %v", err)
	}
	if id == 0 {
		t.Fatal("TagAnlegen lieferte ID 0")
	}

	tg, err := s.Tag(id)
	if err != nil {
		t.Fatalf("Tag: %v", err)
	}
	if tg.Name != "Hauptkonto DE" || tg.Tag != "beispiel-21" || tg.Markt != "DE" {
		t.Errorf("Tag = %+v", tg)
	}
	if tg.Standard {
		t.Error("frisch angelegter Tag ist Standard, will false")
	}
	if tg.AngelegtAm.IsZero() {
		t.Error("AngelegtAm ist nicht gesetzt")
	}

	tg.Name = "Zweitkonto DE"
	tg.Tag = "zweit-21"
	if err := s.TagAendern(tg); err != nil {
		t.Fatalf("TagAendern: %v", err)
	}
	if tg2, _ := s.Tag(id); tg2.Name != "Zweitkonto DE" || tg2.Tag != "zweit-21" {
		t.Errorf("nach Ändern: %+v", tg2)
	}

	if err := s.TagLoeschen(id); err != nil {
		t.Fatalf("TagLoeschen: %v", err)
	}
	if _, err := s.Tag(id); err == nil {
		t.Error("Tag nach dem Löschen noch lesbar")
	}
}

// TestTagStandardBleibtImMarkt hält die Kernzusage fest: höchstens ein
// Standard je Markt, und das Setzen im einen Markt lässt den anderen in Ruhe.
func TestTagStandardBleibtImMarkt(t *testing.T) {
	s := temp(t)

	de1, _ := s.TagAnlegen(AffiliateTag{Name: "DE eins", Tag: "de-eins-21", Markt: "DE"})
	de2, _ := s.TagAnlegen(AffiliateTag{Name: "DE zwei", Tag: "de-zwei-21", Markt: "DE"})
	es1, _ := s.TagAnlegen(AffiliateTag{Name: "ES eins", Tag: "es-eins-21", Markt: "ES"})

	if _, ok := s.StandardTag("DE"); ok {
		t.Error("StandardTag(DE) meldet ok, obwohl noch keiner gesetzt ist")
	}

	if err := s.TagStandardSetzen(de1); err != nil {
		t.Fatalf("TagStandardSetzen(de1): %v", err)
	}
	if err := s.TagStandardSetzen(es1); err != nil {
		t.Fatalf("TagStandardSetzen(es1): %v", err)
	}

	got, ok := s.StandardTag("DE")
	if !ok || got.ID != de1 {
		t.Errorf("StandardTag(DE) = %+v, ok=%v, will ID %d", got, ok, de1)
	}

	// Der zweite DE-Tag übernimmt; der erste verliert das Häkchen, ES nicht.
	if err := s.TagStandardSetzen(de2); err != nil {
		t.Fatalf("TagStandardSetzen(de2): %v", err)
	}
	got, ok = s.StandardTag("DE")
	if !ok || got.ID != de2 {
		t.Errorf("StandardTag(DE) = %+v, ok=%v, will ID %d", got, ok, de2)
	}
	if alt, _ := s.Tag(de1); alt.Standard {
		t.Error("der bisherige DE-Standard trägt das Häkchen noch")
	}
	if es, ok := s.StandardTag("ES"); !ok || es.ID != es1 {
		t.Errorf("StandardTag(ES) = %+v, ok=%v — ES darf von einer DE-Änderung nicht berührt werden", es, ok)
	}
}

func TestTagsFuerMarkt(t *testing.T) {
	s := temp(t)
	s.TagAnlegen(AffiliateTag{Name: "zweiter", Tag: "b-21", Markt: "DE"})
	s.TagAnlegen(AffiliateTag{Name: "erster", Tag: "a-21", Markt: "DE"})
	s.TagAnlegen(AffiliateTag{Name: "spanisch", Tag: "c-21", Markt: "ES"})

	de, err := s.TagsFuerMarkt("DE")
	if err != nil {
		t.Fatalf("TagsFuerMarkt: %v", err)
	}
	if len(de) != 2 {
		t.Fatalf("TagsFuerMarkt(DE) hat %d Einträge, will 2", len(de))
	}
	if de[0].Name != "erster" || de[1].Name != "zweiter" {
		t.Errorf("nicht nach Namen sortiert: %q, %q", de[0].Name, de[1].Name)
	}

	alle, err := s.Tags()
	if err != nil {
		t.Fatalf("Tags: %v", err)
	}
	if len(alle) != 3 {
		t.Errorf("Tags() hat %d Einträge, will 3", len(alle))
	}
}

// TestTagAendernLaesstStandardInRuhe sichert, dass es genau einen Weg zum
// Standard gibt. Ginge er auch über TagAendern, könnte ein Formular ohne
// Häkchen den Standard eines Marktes stillschweigend abräumen.
func TestTagAendernLaesstStandardInRuhe(t *testing.T) {
	s := temp(t)
	id, _ := s.TagAnlegen(AffiliateTag{Name: "DE", Tag: "de-21", Markt: "DE"})
	if err := s.TagStandardSetzen(id); err != nil {
		t.Fatalf("TagStandardSetzen: %v", err)
	}

	tg, _ := s.Tag(id)
	tg.Standard = false
	tg.Name = "DE neu"
	if err := s.TagAendern(tg); err != nil {
		t.Fatalf("TagAendern: %v", err)
	}

	if nach, _ := s.Tag(id); !nach.Standard || nach.Name != "DE neu" {
		t.Errorf("nach Ändern: %+v — Standard muss stehen bleiben, Name sich ändern", nach)
	}
}

// Ein Marktwechsel darf das Standard-Häkchen nicht mitnehmen.
//
// Sonst würde aus dem Standard für DE stillschweigend der Standard für ES —
// eine Zuordnung, die niemand getroffen hat, und im Funnel bekäme jeder
// ES-Deal einen Tag angehängt, den nie jemand für ES bestimmt hat. Hat ES
// bereits einen Standard, hielte der Unique-Index zwar dagegen, aber das
// Ergebnis wäre nur eine unverständliche Fehlermeldung statt eines sauberen
// Zustands.
func TestMarktwechselNimmtDenStandardNichtMit(t *testing.T) {
	s := temp(t)
	id := tagMitStandard(t, s, "Wandert", "wander-21", "DE")

	tg, _ := s.Tag(id)
	tg.Markt = "ES"
	if err := s.TagAendern(tg); err != nil {
		t.Fatalf("TagAendern: %v", err)
	}

	nach, _ := s.Tag(id)
	if nach.Markt != "ES" {
		t.Errorf("Markt = %q, will ES", nach.Markt)
	}
	if nach.Standard {
		t.Error("der Tag ist nach dem Marktwechsel Standard für ES, ohne dass das jemand bestimmt hat")
	}
	if _, ok := s.StandardTag("DE"); ok {
		t.Error("DE hat noch einen Standard, obwohl der Tag den Markt verlassen hat")
	}
}

// Wechselt der Markt nicht, bleibt der Standard selbstverständlich stehen —
// sonst könnte eine Namenskorrektur den Standard eines Marktes abräumen.
func TestAendernOhneMarktwechselHaeltDenStandard(t *testing.T) {
	s := temp(t)
	id := tagMitStandard(t, s, "Bleibt", "bleib-21", "DE")

	tg, _ := s.Tag(id)
	tg.Name = "Bleibt trotzdem"
	if err := s.TagAendern(tg); err != nil {
		t.Fatalf("TagAendern: %v", err)
	}

	if nach, _ := s.Tag(id); !nach.Standard {
		t.Error("Standard verloren, obwohl der Markt derselbe blieb")
	}
}

func tagMitStandard(t *testing.T, s *Store, name, tag, markt string) int64 {
	t.Helper()
	id, err := s.TagAnlegen(AffiliateTag{Name: name, Tag: tag, Markt: markt})
	if err != nil {
		t.Fatalf("TagAnlegen: %v", err)
	}
	if err := s.TagStandardSetzen(id); err != nil {
		t.Fatalf("TagStandardSetzen: %v", err)
	}
	return id
}
