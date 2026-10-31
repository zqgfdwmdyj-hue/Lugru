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

	// Farbe ist eine der Kanalfarben (siehe Farben), leer heißt: aus dem
	// Namen abgeleitet.
	Farbe string
}

// Farben sind die Kanalfarben der Oberfläche, in fester Reihenfolge.
var Farben = []string{"blau", "gruen", "orange", "rot", "lila", "tuerkis", "pink", "gelb", "grau"}

// FarbeOderAuto liefert die gewählte Farbe oder eine, die sich stabil aus
// dem Namen ergibt — so hat jeder Channel von Anfang an eine eigene.
func (c Channel) FarbeOderAuto() string {
	for _, f := range Farben {
		if c.Farbe == f {
			return f
		}
	}
	return FarbeFuerName(c.Name)
}

// FarbeFuerName leitet eine Farbe aus dem Namen ab; Wörter wie „b2b“,
// „admin“ oder „reisen“ bekommen eine feste.
func FarbeFuerName(name string) string {
	n := strings.ToLower(name)
	for _, k := range []struct{ wort, farbe string }{
		{"admin", "grau"}, {"log", "grau"}, {"b2b", "lila"}, {"ankauf", "orange"},
		{"reise", "tuerkis"}, {"leasing", "tuerkis"}, {"podcast", "pink"}, {"vip", "gelb"},
		{"high", "gruen"}, {"low", "rot"},
	} {
		if strings.Contains(n, k.wort) {
			return k.farbe
		}
	}
	h := 0
	for _, r := range n {
		h = h*31 + int(r)
	}
	if h < 0 {
		h = -h
	}
	return Farben[h%(len(Farben)-1)] // ohne Grau
}

// ChannelFarbeSetzen speichert die Farbe eines Channels (leer = automatisch).
func (s *Store) ChannelFarbeSetzen(id int64, farbe string) error {
	ok := farbe == ""
	for _, f := range Farben {
		ok = ok || f == farbe
	}
	if !ok {
		return fmt.Errorf("unbekannte Farbe %q", farbe)
	}
	_, err := s.db.Exec(`UPDATE channels SET farbe = ? WHERE id = ?`, farbe, id)
	return err
}

// KanalNutzung zählt je Channel die Posts der letzten 30 Tage (Deals und
// Ankaufs-Posts des Monitors) und den letzten Post.
type KanalNutzung struct {
	Posts30 int
	Zuletzt time.Time
}

func (s *Store) KanalNutzungen(seit time.Time) (map[int64]KanalNutzung, error) {
	out := map[int64]KanalNutzung{}
	zeilen, err := s.db.Query(`
		SELECT channel_id, SUM(CASE WHEN gepostet_am >= ? THEN 1 ELSE 0 END), MAX(gepostet_am) FROM (
			SELECT channel_id, gepostet_am FROM deals WHERE status <> 'geloescht'
			UNION ALL SELECT channel_id, gepostet_am FROM monitor_posts WHERE channel_id <> 0
		) GROUP BY channel_id`, seit.UTC().Format(time.RFC3339))
	if err != nil {
		return out, err
	}
	defer zeilen.Close()
	for zeilen.Next() {
		var id int64
		var n int
		var letzt string
		if err := zeilen.Scan(&id, &n, &letzt); err != nil {
			return out, err
		}
		t, err := time.Parse(time.RFC3339Nano, letzt)
		if err != nil {
			t, _ = time.Parse(time.RFC3339, letzt)
		}
		out[id] = KanalNutzung{Posts30: n, Zuletzt: t}
	}
	return out, zeilen.Err()
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

const channelSpalten = `id, name, webhook_url, mention_typ, rollen_id, defekt, angelegt_am, gruppe, farbe`

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
	if err := z.Scan(&c.ID, &c.Name, &c.WebhookURL, &c.MentionTyp, &c.RollenID, &defekt, &angelegt, &c.Gruppe, &c.Farbe); err != nil {
		return Channel{}, err
	}
	c.Defekt = defekt != 0
	c.AngelegtAm, _ = time.Parse(time.RFC3339, angelegt)
	return c, nil
}
