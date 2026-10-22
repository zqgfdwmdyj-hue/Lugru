package store

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Die Tarifstaffel liegt in zwei Tabellen: fba_klassen hält die Grenzen,
// fba_gebuehren den Betrag je Klasse, Zielmarkt und Versandweg. Zusammen sind
// sie Amazons beide Tarifübersichten, abgetippt — Zeilen sind Klassen, Spalten
// sind Länder.
//
// Getrennt gehalten, weil die Grenzen für alle Märkte und beide Wege dieselben
// sind und die Beträge nicht. Stünden sie zusammen in einer Tabelle, gäbe es je
// Spalte eine eigene Antwort auf die Frage, was ein Standardpaket ist.

// TarifKlassen liefert die Staffel in Prüfreihenfolge: kleinste Klasse zuerst.
//
// Diese Reihenfolge ist die halbe Rechnung. fba.Waehle nimmt die erste Klasse,
// in die ein Paket passt, und ein Brief passt auch in jedes Paket — stünde die
// Staffel andersherum, zahlte jeder Brief Paketpreis. Sortiert wird deshalb
// hier, an genau einer Stelle, und nicht noch einmal im aufrufenden Code.
func (s *Store) TarifKlassen() ([]fba.Klasse, error) {
	zeilen, err := s.db.Query(`
		SELECT id, sortierung, bezeichnung,
		       max_laenge_mm, max_breite_mm, max_hoehe_mm, max_gewicht_g
		FROM fba_klassen
		ORDER BY sortierung, id`)
	if err != nil {
		return nil, fmt.Errorf("store: Tarifklassen nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	var alle []fba.Klasse
	for zeilen.Next() {
		var k fba.Klasse
		if err := zeilen.Scan(&k.ID, &k.Sortierung, &k.Bezeichnung,
			&k.MaxLaengeMM, &k.MaxBreiteMM, &k.MaxHoeheMM, &k.MaxGewichtG); err != nil {
			return nil, err
		}
		alle = append(alle, k)
	}
	return alle, zeilen.Err()
}

// TarifKlasseAnlegen legt eine Zeile der Staffel an.
func (s *Store) TarifKlasseAnlegen(k fba.Klasse) (int64, error) {
	erg, err := s.db.Exec(`
		INSERT INTO fba_klassen
		    (sortierung, bezeichnung, max_laenge_mm, max_breite_mm, max_hoehe_mm, max_gewicht_g)
		VALUES (?, ?, ?, ?, ?, ?)`,
		k.Sortierung, k.Bezeichnung, k.MaxLaengeMM, k.MaxBreiteMM, k.MaxHoeheMM, k.MaxGewichtG)
	if err != nil {
		return 0, fmt.Errorf("store: Tarifklasse nicht anlegbar: %w", err)
	}
	return erg.LastInsertId()
}

// TarifKlasseLoeschen entfernt eine Zeile samt ihrer Gebühren — um die kümmert
// sich ON DELETE CASCADE im Schema.
func (s *Store) TarifKlasseLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM fba_klassen WHERE id = ?`, id)
	return err
}

// TarifGebuehr liefert den Betrag dieser Klasse für diesen Zielmarkt auf
// diesem Versandweg.
//
// Der zweite Rückgabewert unterscheidet „nicht eingetragen" von „0,00 €". Das
// ist kein Feinschliff: ein fehlender Betrag muss die Vorbelegung beim
// bisherigen Verhalten belassen, während eine eingetragene Null tatsächlich
// null bedeutet.
func (s *Store) TarifGebuehr(klasseID int64, markt string, weg fba.Weg) (fba.Gebuehr, bool, error) {
	var cent, frei, proKg int64
	err := s.db.QueryRow(`
		SELECT cent, frei_gewicht_g, cent_pro_kg FROM fba_gebuehren
		WHERE klasse_id = ? AND markt = ? AND weg = ?`,
		klasseID, markt, string(weg)).Scan(&cent, &frei, &proKg)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return fba.Gebuehr{}, false, nil
	case err != nil:
		return fba.Gebuehr{}, false, fmt.Errorf("store: Tarifgebühr nicht lesbar: %w", err)
	}
	return fba.Gebuehr{
		Cent: money.Cents(cent), FreiGewichtG: int(frei), CentProKg: money.Cents(proKg),
	}, true, nil
}

// TarifGebuehren liefert alle Beträge eines Versandwegs, nach Klasse und Markt
// geordnet — für die Tarifseite, die die ganze Tabelle auf einmal zeigt.
func (s *Store) TarifGebuehren(weg fba.Weg) (map[int64]map[string]fba.Gebuehr, error) {
	zeilen, err := s.db.Query(`
		SELECT klasse_id, markt, cent, frei_gewicht_g, cent_pro_kg
		FROM fba_gebuehren WHERE weg = ?`, string(weg))
	if err != nil {
		return nil, fmt.Errorf("store: Tarifgebühren nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	alle := map[int64]map[string]fba.Gebuehr{}
	for zeilen.Next() {
		var id, cent, frei, proKg int64
		var markt string
		if err := zeilen.Scan(&id, &markt, &cent, &frei, &proKg); err != nil {
			return nil, err
		}
		if alle[id] == nil {
			alle[id] = map[string]fba.Gebuehr{}
		}
		alle[id][markt] = fba.Gebuehr{
			Cent: money.Cents(cent), FreiGewichtG: int(frei), CentProKg: money.Cents(proKg),
		}
	}
	return alle, zeilen.Err()
}

// TarifGebuehrSetzen trägt einen Betrag ein oder überschreibt ihn.
func (s *Store) TarifGebuehrSetzen(klasseID int64, markt string, weg fba.Weg, g fba.Gebuehr) error {
	_, err := s.db.Exec(`
		INSERT INTO fba_gebuehren (klasse_id, markt, weg, cent, frei_gewicht_g, cent_pro_kg)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(klasse_id, markt, weg) DO UPDATE SET
		    cent           = excluded.cent,
		    frei_gewicht_g = excluded.frei_gewicht_g,
		    cent_pro_kg    = excluded.cent_pro_kg`,
		klasseID, markt, string(weg), int64(g.Cent), int64(g.FreiGewichtG), int64(g.CentProKg))
	if err != nil {
		return fmt.Errorf("store: Tarifgebühr nicht speicherbar: %w", err)
	}
	return nil
}

// TarifGebuehrEintrag ist eine geplante Änderung an einem Betrag: setzen oder
// löschen. Löschen heißt „nicht eingetragen" und ist etwas anderes als der
// Betrag 0,00 € — siehe TarifGebuehr.
type TarifGebuehrEintrag struct {
	KlasseID int64
	Markt    string
	Weg      fba.Weg
	Gebuehr  fba.Gebuehr
	Loeschen bool
}

// TarifTabelleSchreiben übernimmt Klassen und Beträge in einem Zug.
//
// Alles oder nichts, und zwar aus einem handfesten Grund: die Tarifseite wird
// als ganze Tabelle gespeichert, und wer sie abschickt, hat womöglich in
// dreißig Zeilen etwas geändert. Schrieb der Handler Zeile für Zeile, stand
// nach einem Tippfehler in Zeile 20 die halbe Tabelle im neuen und die andere
// Hälfte im alten Zustand — und beides zusammen rechnete ab sofort echte
// Deals. Die Prüfung gehört darum vollständig vor den ersten Schreibzugriff,
// und der Rest in eine Transaktion (R2).
func (s *Store) TarifTabelleSchreiben(klassen []fba.Klasse, gebuehren []TarifGebuehrEintrag) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: Tarife nicht speicherbar: %w", err)
	}
	defer tx.Rollback()

	for _, k := range klassen {
		if _, err := tx.Exec(`
			UPDATE fba_klassen
			SET sortierung = ?, bezeichnung = ?,
			    max_laenge_mm = ?, max_breite_mm = ?, max_hoehe_mm = ?, max_gewicht_g = ?
			WHERE id = ?`,
			k.Sortierung, k.Bezeichnung, k.MaxLaengeMM, k.MaxBreiteMM, k.MaxHoeheMM,
			k.MaxGewichtG, k.ID); err != nil {
			return fmt.Errorf("store: Tarifklasse nicht speicherbar: %w", err)
		}
	}

	for _, e := range gebuehren {
		if e.Loeschen {
			if _, err := tx.Exec(
				`DELETE FROM fba_gebuehren WHERE klasse_id = ? AND markt = ? AND weg = ?`,
				e.KlasseID, e.Markt, string(e.Weg)); err != nil {
				return fmt.Errorf("store: Tarifgebühr nicht löschbar: %w", err)
			}
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO fba_gebuehren (klasse_id, markt, weg, cent, frei_gewicht_g, cent_pro_kg)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(klasse_id, markt, weg) DO UPDATE SET
			    cent           = excluded.cent,
			    frei_gewicht_g = excluded.frei_gewicht_g,
			    cent_pro_kg    = excluded.cent_pro_kg`,
			e.KlasseID, e.Markt, string(e.Weg), int64(e.Gebuehr.Cent),
			int64(e.Gebuehr.FreiGewichtG), int64(e.Gebuehr.CentProKg)); err != nil {
			return fmt.Errorf("store: Tarifgebühr nicht speicherbar: %w", err)
		}
	}
	return tx.Commit()
}
