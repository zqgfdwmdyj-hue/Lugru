package store

import (
	"fmt"
	"strings"
	"time"
)

type Channel struct {
	ID         int64
	Name       string
	WebhookURL string
	MentionTyp string // "keine", "everyone", "here", "rolle"
	RollenID   string
	Defekt     bool
	AngelegtAm time.Time

	// Gruppe fasst Channels zusammen, etwa alle eines Discord-Servers.
	// Leer heißt: keiner Gruppe zugeordnet.
	Gruppe string
}

func (s *Store) ChannelAnlegen(c Channel) (int64, error) {
	if c.MentionTyp == "" {
		c.MentionTyp = "keine"
	}
	erg, err := s.db.Exec(`
		INSERT INTO channels (name, webhook_url, mention_typ, rollen_id, defekt, angelegt_am, gruppe)
		VALUES (?, ?, ?, ?, 0, ?, ?)`,
		c.Name, c.WebhookURL, c.MentionTyp, c.RollenID, time.Now().UTC().Format(time.RFC3339),
		strings.TrimSpace(c.Gruppe))
	if err != nil {
		return 0, fmt.Errorf("store: Channel nicht anlegbar: %w", err)
	}
	return erg.LastInsertId()
}

func (s *Store) ChannelAendern(c Channel) error {
	_, err := s.db.Exec(`
		UPDATE channels SET name = ?, webhook_url = ?, mention_typ = ?, rollen_id = ?
		WHERE id = ?`,
		c.Name, c.WebhookURL, c.MentionTyp, c.RollenID, c.ID)
	return err
}

// ChannelGruppeSetzen ordnet einen Channel einer Gruppe zu — und alle Deals,
// die über ihn gepostet wurden, gleich mit. So lässt sich eine Gruppe auch
// nachträglich vergeben, und die Statistik stimmt rückwirkend.
func (s *Store) ChannelGruppeSetzen(id int64, gruppe string) error {
	gruppe = strings.TrimSpace(gruppe)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE channels SET gruppe = ? WHERE id = ?`, gruppe, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE deals SET gruppe = ? WHERE channel_id = ?`, gruppe, id); err != nil {
		return err
	}
	return tx.Commit()
}

// ChannelMentionSetzen ändert, wen ein Channel beim Posten erwähnt.
func (s *Store) ChannelMentionSetzen(id int64, typ, rollenID string) error {
	_, err := s.db.Exec(`UPDATE channels SET mention_typ = ?, rollen_id = ? WHERE id = ?`,
		typ, strings.TrimSpace(rollenID), id)
	return err
}

// Gruppen liefert alle vergebenen Gruppen, aus Channels und Deals, sortiert.
func (s *Store) Gruppen() ([]string, error) {
	zeilen, err := s.db.Query(`
		SELECT gruppe FROM channels WHERE gruppe <> ''
		UNION SELECT gruppe FROM deals WHERE gruppe <> ''
		ORDER BY 1 COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []string
	for zeilen.Next() {
		var g string
		if err := zeilen.Scan(&g); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, zeilen.Err()
}

func (s *Store) ChannelDefekt(id int64, defekt bool) error {
	wert := 0
	if defekt {
		wert = 1
	}
	_, err := s.db.Exec(`UPDATE channels SET defekt = ? WHERE id = ?`, wert, id)
	return err
}

func (s *Store) ChannelLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM channels WHERE id = ?`, id)
	return err
}

const channelSpalten = `id, name, webhook_url, mention_typ, rollen_id, defekt, angelegt_am, gruppe`

func (s *Store) Channel(id int64) (Channel, error) {
	zeile := s.db.QueryRow(`SELECT `+channelSpalten+` FROM channels WHERE id = ?`, id)
	return scanChannel(zeile)
}

func (s *Store) Channels() ([]Channel, error) {
	zeilen, err := s.db.Query(`SELECT ` + channelSpalten + ` FROM channels ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()

	var out []Channel
	for zeilen.Next() {
		c, err := scanChannel(zeilen)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, zeilen.Err()
}

type scanner interface{ Scan(...any) error }

func scanChannel(z scanner) (Channel, error) {
	var c Channel
	var defekt int
	var angelegt string
	if err := z.Scan(&c.ID, &c.Name, &c.WebhookURL, &c.MentionTyp, &c.RollenID, &defekt, &angelegt, &c.Gruppe); err != nil {
		return Channel{}, err
	}
	c.Defekt = defekt != 0
	c.AngelegtAm, _ = time.Parse(time.RFC3339, angelegt)
	return c, nil
}
