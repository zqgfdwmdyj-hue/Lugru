package store

import (
	"strings"
	"time"
)

// PodcastQuelle ist eine Kategorie der Apple-Charts (Genre > 0, die Top
// Anzahl) oder ein einzelner Podcast (Feed gesetzt).
type PodcastQuelle struct {
	ID         int64
	Name       string
	Genre      int
	Anzahl     int
	Feed       string
	ChannelID  int64
	Aktiv      bool
	GeprueftAm time.Time
	Status     string
}

func (s *Store) PodcastAnlegen(p PodcastQuelle) error {
	_, err := s.db.Exec(`INSERT INTO monitor_podcasts (name, genre, anzahl, feed, channel_id, aktiv) VALUES (?, ?, ?, ?, ?, 1)`,
		strings.TrimSpace(p.Name), p.Genre, p.Anzahl, strings.TrimSpace(p.Feed), p.ChannelID)
	return err
}

func (s *Store) PodcastLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM monitor_podcasts WHERE id = ?`, id)
	return err
}

func (s *Store) PodcastAktiv(id int64, aktiv bool) error {
	_, err := s.db.Exec(`UPDATE monitor_podcasts SET aktiv = ? WHERE id = ?`, jaNein(aktiv), id)
	return err
}

func (s *Store) PodcastGeprueft(id int64, zeit time.Time, status string) error {
	_, err := s.db.Exec(`UPDATE monitor_podcasts SET geprueft_am = ?, status = ? WHERE id = ?`, zeitText(zeit), status, id)
	return err
}

func (s *Store) Podcasts() ([]PodcastQuelle, error) {
	zeilen, err := s.db.Query(`SELECT id, name, genre, anzahl, feed, channel_id, aktiv, geprueft_am, status FROM monitor_podcasts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []PodcastQuelle
	for zeilen.Next() {
		var p PodcastQuelle
		var aktiv int
		var am string
		if err := zeilen.Scan(&p.ID, &p.Name, &p.Genre, &p.Anzahl, &p.Feed, &p.ChannelID, &aktiv, &am, &p.Status); err != nil {
			return nil, err
		}
		p.Aktiv = aktiv != 0
		p.GeprueftAm, _ = time.Parse(time.RFC3339, am)
		out = append(out, p)
	}
	return out, zeilen.Err()
}

// PodcastFeed liefert die gemerkte Feed-Adresse zu einer Apple-ID.
func (s *Store) PodcastFeed(appleID string) (string, bool) {
	var feed string
	err := s.db.QueryRow(`SELECT feed FROM podcast_feeds WHERE apple_id = ?`, appleID).Scan(&feed)
	return feed, err == nil
}

func (s *Store) PodcastFeedMerken(appleID, feed, name string) error {
	_, err := s.db.Exec(`INSERT INTO podcast_feeds (apple_id, feed, name) VALUES (?, ?, ?)
		ON CONFLICT(apple_id) DO UPDATE SET feed = excluded.feed, name = excluded.name`, appleID, feed, name)
	return err
}
