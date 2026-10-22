package store

import (
	"database/sql"
	"errors"
	"time"
)

// CacheLesen liefert eine gespeicherte Keepa-Antwort, falls sie jünger als
// maxAlter ist. Erspart Token bei Tippfehlern im Formular, beim Zurückgehen
// im Browser und beim zweiten Anlauf.
func (s *Store) CacheLesen(asin string, domain int, maxAlter time.Duration) ([]byte, bool) {
	var geholt string
	var roh []byte

	err := s.db.QueryRow(
		`SELECT geholt_am, antwort_json FROM keepa_cache WHERE asin = ? AND domain_id = ?`,
		asin, domain).Scan(&geholt, &roh)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, false
		}
		return nil, false
	}

	zeit, err := time.Parse(time.RFC3339Nano, geholt)
	if err != nil {
		return nil, false
	}
	if time.Since(zeit) > maxAlter {
		return nil, false
	}
	return roh, true
}

func (s *Store) CacheSchreiben(asin string, domain int, roh []byte) error {
	_, err := s.db.Exec(`
		INSERT INTO keepa_cache (asin, domain_id, geholt_am, antwort_json)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(asin, domain_id) DO UPDATE
		SET geholt_am = excluded.geholt_am, antwort_json = excluded.antwort_json`,
		asin, domain, time.Now().UTC().Format(zeitLayout), roh)
	return err
}
