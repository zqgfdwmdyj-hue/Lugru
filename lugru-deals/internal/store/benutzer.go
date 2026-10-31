package store

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// Benutzer ist ein weiterer Zugang neben dem Admin. Poster ist der Name aus
// der Poster-Liste, der nach der Anmeldung vorausgewählt wird.
type Benutzer struct {
	Name   string
	Poster string
}

// pbkdf2Runden ist bewusst hoch: ein gestohlener Hash soll sich nicht in
// vertretbarer Zeit zurückrechnen lassen.
const pbkdf2Runden = 210_000

func passwortHash(passwort string, salz []byte) (string, error) {
	k, err := pbkdf2.Key(sha256.New, passwort, salz, pbkdf2Runden, 32)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(k), nil
}

// BenutzerListe liefert alle weiteren Benutzer, nach Namen sortiert.
func (s *Store) BenutzerListe() ([]Benutzer, error) {
	rows, err := s.db.Query(`SELECT name, poster FROM benutzer ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Benutzer
	for rows.Next() {
		var b Benutzer
		if err := rows.Scan(&b.Name, &b.Poster); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// BenutzerSpeichern legt einen Benutzer an oder ändert ihn. Ein leeres
// Passwort lässt das bisherige stehen; ein neuer Benutzer braucht eins.
func (s *Store) BenutzerSpeichern(name, passwort, poster string) error {
	name = strings.TrimSpace(name)
	if name == "" || strings.ContainsAny(name, ":.") {
		return errors.New("Benutzername fehlt oder enthält „:“ bzw. „.“")
	}
	if passwort == "" {
		res, err := s.db.Exec(`UPDATE benutzer SET poster = ? WHERE name = ?`, poster, name)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return fmt.Errorf("Für den neuen Benutzer %s fehlt das Passwort", name)
		}
		return nil
	}
	if len(passwort) < 8 {
		return errors.New("Das Passwort braucht mindestens 8 Zeichen")
	}
	salz := make([]byte, 16)
	if _, err := rand.Read(salz); err != nil {
		return err
	}
	hash, err := passwortHash(passwort, salz)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO benutzer (name, hash, salz, poster) VALUES (?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET hash = excluded.hash, salz = excluded.salz, poster = excluded.poster`,
		name, hash, hex.EncodeToString(salz), poster)
	return err
}

// BenutzerLoeschen entfernt einen Benutzer; seine Sitzungen werden damit
// ungültig.
func (s *Store) BenutzerLoeschen(name string) error {
	_, err := s.db.Exec(`DELETE FROM benutzer WHERE name = ?`, name)
	return err
}

// BenutzerPruefen prüft Name und Passwort. Der Name kommt so zurück, wie er
// gespeichert ist (Groß-/Kleinschreibung).
func (s *Store) BenutzerPruefen(name, passwort string) (Benutzer, bool) {
	var b Benutzer
	var hash, salzHex string
	err := s.db.QueryRow(`SELECT name, poster, hash, salz FROM benutzer WHERE name = ?`, strings.TrimSpace(name)).
		Scan(&b.Name, &b.Poster, &hash, &salzHex)
	if err != nil {
		return Benutzer{}, false
	}
	salz, err := hex.DecodeString(salzHex)
	if err != nil {
		return Benutzer{}, false
	}
	ist, err := passwortHash(passwort, salz)
	if err != nil || subtle.ConstantTimeCompare([]byte(ist), []byte(hash)) != 1 {
		return Benutzer{}, false
	}
	return b, true
}

// BenutzerSitzung liefert Benutzer und Sitzungsschlüssel. Der Schlüssel
// hängt am Passwort-Hash: ein neues Passwort meldet alle Geräte ab.
func (s *Store) BenutzerSitzung(name string) (Benutzer, []byte, bool) {
	var b Benutzer
	var hash string
	err := s.db.QueryRow(`SELECT name, poster, hash FROM benutzer WHERE name = ?`, name).Scan(&b.Name, &b.Poster, &hash)
	if errors.Is(err, sql.ErrNoRows) || err != nil {
		return Benutzer{}, nil, false
	}
	k := sha256.Sum256([]byte("lugru-sitzung|" + b.Name + "|" + hash))
	return b, k[:], true
}
