package store

import (
	"fmt"
	"time"
)

// AffiliateTag ist eine PartnerNet-Tracking-ID mitsamt dem Marktplatz, für
// den sie ausgestellt wurde.
//
// Die Bindung an einen Markt ist kein Ordnungsmerkmal, sondern der Kern der
// Sache: ein Tag verdient nur dort, wofür er gilt. Ein DE-Tag an einem
// amazon.es-Link ist kein kleiner Schönheitsfehler, sondern schlicht
// wirkungslos.
type AffiliateTag struct {
	ID    int64
	Name  string // freie Bezeichnung, "Hauptkonto DE"
	Tag   string // der echte Tag, "beispiel-21"
	Markt string // Länderkürzel, "DE"
	// Standard markiert den Tag, der im Funnel vorausgewählt wird. Je Markt
	// trägt ihn höchstens einer — dafür sorgt idx_tag_standard.
	Standard   bool
	AngelegtAm time.Time
}

// TagAnlegen legt einen Tag an. Standard bleibt dabei immer aus: der Weg
// dorthin führt ausschließlich über TagStandardSetzen, damit es für diesen
// Zustand nur eine Stelle gibt, die ihn herstellen kann.
func (s *Store) TagAnlegen(t AffiliateTag) (int64, error) {
	erg, err := s.db.Exec(`
		INSERT INTO affiliate_tags (name, tag, markt, standard, angelegt_am)
		VALUES (?, ?, ?, 0, ?)`,
		t.Name, t.Tag, t.Markt, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return 0, fmt.Errorf("store: Tag nicht anlegbar: %w", err)
	}
	return erg.LastInsertId()
}

// TagAendern übernimmt Name, Tag und Markt.
//
// Das Standard-Häkchen bleibt stehen, solange der Markt derselbe bleibt —
// eine Namenskorrektur darf den Standard eines Marktes nicht abräumen. Beim
// Marktwechsel fällt es dagegen weg: ein Standard gilt immer für ein
// bestimmtes Land, und ihn mitwandern zu lassen ergäbe stillschweigend eine
// Zuordnung, die niemand getroffen hat. Gesetzt wird er auch danach nur über
// TagStandardSetzen — siehe TagAnlegen.
func (s *Store) TagAendern(t AffiliateTag) error {
	_, err := s.db.Exec(`
		UPDATE affiliate_tags
		SET name = ?, tag = ?, markt = ?, standard = CASE WHEN markt = ? THEN standard ELSE 0 END
		WHERE id = ?`,
		t.Name, t.Tag, t.Markt, t.Markt, t.ID)
	return err
}

func (s *Store) TagLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM affiliate_tags WHERE id = ?`, id)
	return err
}

// TagStandardSetzen macht diesen Tag zum Standard seines Marktes.
//
// Beide Anweisungen laufen in einer Transaktion und in genau dieser
// Reihenfolge: erst den bisherigen Standard des Marktes abräumen, dann den
// neuen setzen. Umgekehrt gäbe es einen Moment mit zwei Standards, und
// idx_tag_standard würde den Vorgang ablehnen.
func (s *Store) TagStandardSetzen(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: Standard nicht setzbar: %w", err)
	}
	defer tx.Rollback()

	var markt string
	if err := tx.QueryRow(`SELECT markt FROM affiliate_tags WHERE id = ?`, id).Scan(&markt); err != nil {
		return fmt.Errorf("store: Tag %d nicht gefunden: %w", id, err)
	}
	if _, err := tx.Exec(`UPDATE affiliate_tags SET standard = 0 WHERE markt = ?`, markt); err != nil {
		return fmt.Errorf("store: bisherigen Standard nicht abräumbar: %w", err)
	}
	if _, err := tx.Exec(`UPDATE affiliate_tags SET standard = 1 WHERE id = ?`, id); err != nil {
		return fmt.Errorf("store: Standard nicht setzbar: %w", err)
	}
	return tx.Commit()
}

const tagSpalten = `id, name, tag, markt, standard, angelegt_am`

func (s *Store) Tag(id int64) (AffiliateTag, error) {
	zeile := s.db.QueryRow(`SELECT `+tagSpalten+` FROM affiliate_tags WHERE id = ?`, id)
	return scanTag(zeile)
}

// Tags liefert alle Tags, nach Markt und darin nach Namen.
func (s *Store) Tags() ([]AffiliateTag, error) {
	return s.tagsAbfragen(`SELECT ` + tagSpalten + ` FROM affiliate_tags
		ORDER BY markt, name COLLATE NOCASE`)
}

// TagsFuerMarkt liefert die Tags eines Marktplatzes, nach Namen.
func (s *Store) TagsFuerMarkt(markt string) ([]AffiliateTag, error) {
	return s.tagsAbfragen(`SELECT `+tagSpalten+` FROM affiliate_tags
		WHERE markt = ? ORDER BY name COLLATE NOCASE`, markt)
}

// StandardTag liefert den vorausgewählten Tag eines Marktes. ok ist false,
// wenn für den Markt keiner gesetzt ist — der Funnel zeigt dann seinen
// Hinweis, statt einen fremden Tag zu raten.
func (s *Store) StandardTag(markt string) (AffiliateTag, bool) {
	zeile := s.db.QueryRow(`SELECT `+tagSpalten+` FROM affiliate_tags
		WHERE markt = ? AND standard = 1`, markt)
	// Ein Markt ohne Standard ist ein zulässiger Zustand, kein Zwischenfall —
	// sql.ErrNoRows ist hier der Normalfall und braucht keine eigene
	// Behandlung, weil ok=false ihn bereits vollständig beschreibt.
	t, err := scanTag(zeile)
	if err != nil {
		return AffiliateTag{}, false
	}
	return t, true
}

func (s *Store) tagsAbfragen(abfrage string, args ...any) ([]AffiliateTag, error) {
	zeilen, err := s.db.Query(abfrage, args...)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()

	var out []AffiliateTag
	for zeilen.Next() {
		t, err := scanTag(zeilen)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, zeilen.Err()
}

func scanTag(z scanner) (AffiliateTag, error) {
	var t AffiliateTag
	var standard int
	var angelegt string
	if err := z.Scan(&t.ID, &t.Name, &t.Tag, &t.Markt, &standard, &angelegt); err != nil {
		return AffiliateTag{}, err
	}
	t.Standard = standard != 0
	t.AngelegtAm, _ = time.Parse(time.RFC3339, angelegt)
	return t, nil
}
