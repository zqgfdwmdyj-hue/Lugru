package store

import (
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Arten von Deal-Feeds; sie bestimmen das Aussehen des Posts und welche
// Filter gelten.
const (
	FeedAllgemein = "allgemein"
	FeedReisen    = "reisen"
	FeedLeasing   = "leasing"
)

// DealFeed ist eine Gruppe bei mydealz, gefiltert, mit Ziel-Channel.
type DealFeed struct {
	ID   int64
	Name string
	Art  string
	// Quelle ist die Adresse des RSS-Feeds bei mydealz.
	Quelle    string
	ChannelID int64
	// Stichworte filtern den Titel (siehe mydealz.Passt); leer heißt alle.
	Stichworte string
	// MaxPreis 0 heißt ohne Grenze.
	MaxPreis money.Cents
	// MinTemp verlangt so viel „Grad" Beliebtheit; nur der Trending-Feed
	// nennt sie. 0 heißt ohne.
	MinTemp int
	// MaxLF und LeasingArt ("privat", "gewerbe" oder leer) gelten für Leasing.
	MaxLF      float64
	LeasingArt string
	Aktiv      bool
	GeprueftAm time.Time
	Status     string
}

func feedArt(a string) string {
	switch a {
	case FeedReisen, FeedLeasing:
		return a
	}
	return FeedAllgemein
}

func (s *Store) FeedAnlegen(f DealFeed) error {
	_, err := s.db.Exec(`INSERT INTO monitor_feeds (name, art, quelle, channel_id, stichworte, max_preis, min_temp, max_lf, leasing_art, aktiv)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		strings.TrimSpace(f.Name), feedArt(f.Art), f.Quelle, f.ChannelID, strings.TrimSpace(f.Stichworte),
		int64(f.MaxPreis), f.MinTemp, f.MaxLF, f.LeasingArt)
	return err
}

func (s *Store) FeedAktiv(id int64, aktiv bool) error {
	_, err := s.db.Exec(`UPDATE monitor_feeds SET aktiv = ? WHERE id = ?`, jaNein(aktiv), id)
	return err
}

func (s *Store) FeedLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM monitor_feeds WHERE id = ?`, id)
	return err
}

func (s *Store) FeedGeprueft(id int64, zeit time.Time, status string) error {
	_, err := s.db.Exec(`UPDATE monitor_feeds SET geprueft_am = ?, status = ? WHERE id = ?`, zeitText(zeit), status, id)
	return err
}

func (s *Store) Feeds() ([]DealFeed, error) {
	zeilen, err := s.db.Query(`SELECT id, name, art, quelle, channel_id, stichworte, max_preis, min_temp, max_lf, leasing_art, aktiv, geprueft_am, status
		FROM monitor_feeds ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []DealFeed
	for zeilen.Next() {
		var f DealFeed
		var aktiv int
		var am string
		if err := zeilen.Scan(&f.ID, &f.Name, &f.Art, &f.Quelle, &f.ChannelID, &f.Stichworte, &f.MaxPreis, &f.MinTemp, &f.MaxLF,
			&f.LeasingArt, &aktiv, &am, &f.Status); err != nil {
			return nil, err
		}
		f.Aktiv = aktiv != 0
		f.GeprueftAm, _ = time.Parse(time.RFC3339, am)
		out = append(out, f)
	}
	return out, zeilen.Err()
}
