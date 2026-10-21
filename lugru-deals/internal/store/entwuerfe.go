package store

import (
	"database/sql"
	"fmt"
	"time"
)

// Entwurf ist ein halb fertiger Deal.
//
// Formular ist das ganze Funnel-Formular in URL-Kodierung. Der Store deutet
// es nicht: was darin steht, prüft der Funnel beim Öffnen genauso wie jede
// andere Eingabe aus dem Browser.
type Entwurf struct {
	ID            int64
	ASIN          string
	Titel         string
	Schritt       int
	Formular      string
	GespeichertAm time.Time
}

// EntwurfSpeichern legt einen Entwurf an oder überschreibt ihn, wenn ID
// gesetzt ist und es ihn noch gibt. Zurück kommt die ID des Entwurfs.
func (s *Store) EntwurfSpeichern(e Entwurf) (int64, error) {
	jetzt := time.Now().UTC().Format(zeitLayout)
	if e.ID != 0 {
		erg, err := s.db.Exec(`
			UPDATE entwuerfe SET asin = ?, titel = ?, schritt = ?, formular = ?, gespeichert_am = ?
			WHERE id = ?`, e.ASIN, e.Titel, e.Schritt, e.Formular, jetzt, e.ID)
		if err != nil {
			return 0, fmt.Errorf("store: Entwurf nicht speicherbar: %w", err)
		}
		if n, _ := erg.RowsAffected(); n > 0 {
			return e.ID, nil
		}
		// Inzwischen gelöscht: dann eben als neuer Entwurf.
	}
	erg, err := s.db.Exec(`
		INSERT INTO entwuerfe (asin, titel, schritt, formular, gespeichert_am)
		VALUES (?, ?, ?, ?, ?)`, e.ASIN, e.Titel, e.Schritt, e.Formular, jetzt)
	if err != nil {
		return 0, fmt.Errorf("store: Entwurf nicht speicherbar: %w", err)
	}
	return erg.LastInsertId()
}

// Entwuerfe liefert alle Entwürfe, der zuletzt gespeicherte zuerst.
func (s *Store) Entwuerfe() ([]Entwurf, error) {
	zeilen, err := s.db.Query(`
		SELECT id, asin, titel, schritt, formular, gespeichert_am
		FROM entwuerfe ORDER BY gespeichert_am DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("store: Entwürfe nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	var out []Entwurf
	for zeilen.Next() {
		e, err := scanEntwurf(zeilen)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, zeilen.Err()
}

func (s *Store) Entwurf(id int64) (Entwurf, error) {
	return scanEntwurf(s.db.QueryRow(`
		SELECT id, asin, titel, schritt, formular, gespeichert_am
		FROM entwuerfe WHERE id = ?`, id))
}

func (s *Store) EntwurfLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM entwuerfe WHERE id = ?`, id)
	return err
}

func scanEntwurf(z scanner) (Entwurf, error) {
	var e Entwurf
	var am string
	if err := z.Scan(&e.ID, &e.ASIN, &e.Titel, &e.Schritt, &e.Formular, &am); err != nil {
		if err == sql.ErrNoRows {
			return Entwurf{}, err
		}
		return Entwurf{}, fmt.Errorf("store: Entwurf nicht lesbar: %w", err)
	}
	e.GespeichertAm, _ = time.Parse(time.RFC3339Nano, am)
	return e, nil
}
