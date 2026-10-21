package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

// temp legt einen Store in einem Testverzeichnis an.
func temp(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"), filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestOpenLegtSchemaAn(t *testing.T) {
	s := temp(t)
	for _, tabelle := range []string{"einstellungen", "channels", "deals", "keepa_cache"} {
		var name string
		err := s.db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tabelle,
		).Scan(&name)
		if err != nil {
			t.Errorf("Tabelle %q fehlt: %v", tabelle, err)
		}
	}
}

func TestOpenIstWiederholbar(t *testing.T) {
	dir := t.TempDir()
	pfad := filepath.Join(dir, "test.db")

	s1, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("erstes Open: %v", err)
	}
	if err := s1.SetzeEinstellung("probe", "wert"); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}
	s1.Close()

	s2, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("zweites Open: %v", err)
	}
	defer s2.Close()

	if got := s2.Einstellung("probe"); got != "wert" {
		t.Errorf("Einstellung nach Neuöffnen = %q, will \"wert\"", got)
	}
}

// TestOpenErgaenztFehlendeSpalten deckt die einzige Stelle ab, an der
// "CREATE TABLE IF NOT EXISTS" nicht ausreicht: eine Datenbank, die schon
// existiert. Die Anweisung tut dort nichts, eine neue Spalte im Schema-Text
// erreicht die Datei also nie — genau so entstünde beim nächsten Update ein
// "no such column"-Fehler auf jedem Rechner, auf dem schon einmal gepostet
// wurde.
//
// Der Test baut darum die deals-Tabelle absichtlich im alten Zustand (ohne
// quell_url, ek_art und bild_kennung) und lässt Open darüber laufen.
func TestOpenErgaenztFehlendeSpalten(t *testing.T) {
	dir := t.TempDir()
	pfad := filepath.Join(dir, "test.db")

	alt, err := sql.Open("sqlite", pfad)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := alt.Exec(`
		CREATE TABLE deals (
		    id          INTEGER PRIMARY KEY AUTOINCREMENT,
		    asin        TEXT NOT NULL,
		    quellmarkt  TEXT NOT NULL,
		    gepostet_am TEXT NOT NULL DEFAULT ''
		)`); err != nil {
		t.Fatalf("alte Tabelle: %v", err)
	}
	if _, err := alt.Exec(`INSERT INTO deals (asin, quellmarkt) VALUES ('B01636IZ0G', 'ES')`); err != nil {
		t.Fatalf("alte Zeile: %v", err)
	}
	alt.Close()

	s, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("Open über einer bestehenden Datenbank: %v", err)
	}
	defer s.Close()

	for _, spalte := range []string{"quell_url", "ek_art", "bild_kennung"} {
		var n int
		if err := s.db.QueryRow(
			`SELECT COUNT(*) FROM pragma_table_info('deals') WHERE name = ?`, spalte,
		).Scan(&n); err != nil {
			t.Fatalf("pragma_table_info: %v", err)
		}
		if n != 1 {
			t.Errorf("Spalte %q fehlt nach Open weiterhin", spalte)
		}
	}

	// Die bestehende Zeile überlebt und bekommt die Vorgabewerte — "brutto"
	// sagt bei einem alten Deal die Wahrheit: einen Netto-Schalter gab es
	// damals nicht.
	var quellURL, ekArt string
	if err := s.db.QueryRow(`SELECT quell_url, ek_art FROM deals WHERE asin = 'B01636IZ0G'`).
		Scan(&quellURL, &ekArt); err != nil {
		t.Fatalf("alte Zeile nicht mehr lesbar: %v", err)
	}
	if quellURL != "" || ekArt != "brutto" {
		t.Errorf("alte Zeile hat quell_url=%q, ek_art=%q, will \"\" und \"brutto\"", quellURL, ekArt)
	}

	// Wiederholbar wie alles im Schema: ein zweites Open darf nicht an einem
	// doppelten ALTER TABLE scheitern.
	s2, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("zweites Open: %v", err)
	}
	s2.Close()
}

// spalteErgaenzen ist der einzige Teil des Schemas, der nicht von sich aus
// wiederholbar ist: SQLite kennt kein ADD COLUMN IF NOT EXISTS. Diese beiden
// Tests halten fest, dass der Helfer beides leistet — die Spalte nachrüsten
// und den zweiten Aufruf durchgehen lassen.
func TestOpenRuestetBildSpalteNach(t *testing.T) {
	dir := t.TempDir()
	pfad := filepath.Join(dir, "alt.db")

	// Eine Datenbank im alten Stand: das vollständige schema, aber ohne die
	// nachgereichten Spalten — genau das, was auf einer Festplatte liegt,
	// die vor dieser Änderung zuletzt gestartet wurde.
	db, err := sql.Open("sqlite", pfad)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	if _, err := db.Exec(ohneSpalte(schema, "bild_kennung")); err != nil {
		t.Fatalf("altes Schema: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO deals
		(asin, titel, quellmarkt, zielmarkt, ek_cent, vk_cent,
		 channel_id, channel_name, nachricht_text, gepostet_am)
		VALUES ('B000ALT','Altes Ding','DE','DE',100,200,1,'alt','Text','2026-01-01T00:00:00.000000000Z')`); err != nil {
		t.Fatalf("Altdatensatz: %v", err)
	}
	db.Close()

	s, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("Open auf altem Schema: %v", err)
	}
	defer s.Close()

	var kennung string
	if err := s.db.QueryRow(
		`SELECT bild_kennung FROM deals WHERE asin = 'B000ALT'`).Scan(&kennung); err != nil {
		t.Fatalf("Spalte bild_kennung fehlt oder Altdatensatz verloren: %v", err)
	}
	if kennung != "" {
		t.Errorf("Altdatensatz hat bild_kennung = %q, erwartet leer", kennung)
	}
}

func TestSpalteErgaenzenIstWiederholbar(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE t (id INTEGER)`); err != nil {
		t.Fatalf("Tabelle: %v", err)
	}

	for i := range 2 {
		if err := spalteErgaenzen(db, "t", "neu", "TEXT NOT NULL DEFAULT ''"); err != nil {
			t.Fatalf("Aufruf %d: %v", i+1, err)
		}
	}
}

// Ein echter Fehler darf nicht verschluckt werden, sonst würde ein
// Schemaproblem beim Start lautlos verschwinden und erst viel später als
// unerklärlicher Lesefehler auftauchen.
func TestSpalteErgaenzenMeldetEchteFehler(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	if err := spalteErgaenzen(db, "gibtesnicht", "neu", "TEXT"); err == nil {
		t.Error("spalteErgaenzen auf fehlender Tabelle = nil, erwartet Fehler")
	}
}

// Alle ausgelieferten Schemastände müssen dieselben Scanner bedienen können,
// unabhängig von der physischen Reihenfolge der nachgerüsteten Spalten.
func TestOpenIntegriertFunnelUndBildSchema(t *testing.T) {
	for _, stand := range []string{"ursprung", "funnel", "bilder"} {
		t.Run(stand, func(t *testing.T) {
			dir := t.TempDir()
			pfad := filepath.Join(dir, "alt.db")
			altSchema := schema
			for _, spalte := range []string{"quell_url", "ek_art", "bild_kennung"} {
				if (stand == "funnel" && spalte != "bild_kennung") || (stand == "bilder" && spalte == "bild_kennung") {
					continue
				}
				var zeilen []string
				for _, zeile := range strings.Split(altSchema, "\n") {
					if !strings.HasPrefix(strings.TrimSpace(zeile), spalte+" ") {
						zeilen = append(zeilen, zeile)
					}
				}
				altSchema = strings.Join(zeilen, "\n")
			}
			db, err := sql.Open("sqlite", pfad)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(altSchema); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO deals (asin,titel,quellmarkt,zielmarkt,ek_cent,vk_cent,channel_id,channel_name,nachricht_text,gepostet_am)
    VALUES ('B01636IZ0G','Alt','ES','DE',100,200,1,'c','Text','2026-01-01T00:00:00.000000000Z')`); err != nil {
				t.Fatal(err)
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				s, err := Open(pfad, filepath.Join(dir, "charts"))
				if err != nil {
					t.Fatal(err)
				}
				d, err := s.Deal(1)
				if err != nil {
					t.Fatal(err)
				}
				if d.EKArt != "brutto" || d.QuellURL != "" || d.BildKennung != "" || d.Titel != "Alt" {
					t.Fatalf("Altdatensatz verändert: %+v", d)
				}
				neu := Deal{ASIN: "B01636IZ0G", Titel: "Neu", QuellURL: "https://shop.example/artikel", EKArt: "netto", BildKennung: "71bYHZQrjxL.jpg", EKCent: 11900, VKCent: 20000}
				id, err := s.DealAnlegen(neu)
				if err != nil {
					t.Fatal(err)
				}
				ds, err := s.Deals(DealFilter{})
				if err != nil {
					t.Fatal(err)
				}
				if ds[0].ID != id || ds[0].QuellURL != neu.QuellURL || ds[0].EKArt != neu.EKArt || ds[0].BildKennung != neu.BildKennung || ds[0].EKCent != neu.EKCent {
					t.Fatalf("Scanner verliert integrierte Felder: %+v", ds[0])
				}
				if err := s.Close(); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

// ohneSpalte streicht eine Spaltendefinition aus dem Schematext und baut so
// einen früheren Auslieferungsstand nach. Über den Zeilenanfang statt über
// einen exakten Zeilenvergleich: sonst greift das Streichen nach der ersten
// Umformatierung des Schemas nicht mehr, und der Test bestünde, ohne den
// Nachrüstweg je zu berühren.
func ohneSpalte(schema, spalte string) string {
	var zeilen []string
	for _, zeile := range strings.Split(schema, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(zeile), spalte+" ") {
			zeilen = append(zeilen, zeile)
		}
	}
	return strings.Join(zeilen, "\n")
}
