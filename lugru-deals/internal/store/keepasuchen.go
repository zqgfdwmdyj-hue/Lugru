package store

import (
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// HerkunftKeepaDeal kennzeichnet Produkte, die eine Keepa-Suche nach
// Preisstürzen angelegt hat. Sie laufen nicht im Intervall mit, sondern
// werden nur geprüft, wenn Keepa einen Preissturz meldet.
const HerkunftKeepaDeal = "keepa-deal"

// KeepaSuche ist eine Suche nach Preisstürzen bei Keepa („Browsing Deals“).
type KeepaSuche struct {
	ID          int64
	Name        string
	Markt       string // Einkaufsmarkt, etwa "DE"
	Preisart    int    // keepa.DealAmazon, DealNeuFBA …
	MinRabatt   int    // Prozent
	Zeitraum    int    // 0 = 24 h, 1 = Woche, 2 = Monat, 3 = 90 Tage
	MinPreis    money.Cents
	MaxPreis    money.Cents
	MaxRang     int
	Suchbegriff string
	Kategorien  string // Keepa-Kategorie-IDs mit Komma
	Ausschluss  string
	Maerkte     string // Zielmärkte, leer = Standard
	Modus       string // Verkaufswege
	Minuten     int
	MaxJeLauf   int
	Aktiv       bool
	GeprueftAm  time.Time
	Status      string
}

const keepaSucheSpalten = `id, name, markt, preisart, min_rabatt, zeitraum, min_preis, max_preis, max_rang,
	suchbegriff, kategorien, ausschluss, maerkte, modus, minuten, max_je_lauf, aktiv, geprueft_am, status`

func (s *Store) KeepaSucheAnlegen(k KeepaSuche) (int64, error) {
	erg, err := s.db.Exec(`INSERT INTO keepa_suchen (name, markt, preisart, min_rabatt, zeitraum, min_preis, max_preis,
		max_rang, suchbegriff, kategorien, ausschluss, maerkte, modus, minuten, max_je_lauf, aktiv, angelegt_am)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		strings.TrimSpace(k.Name), k.Markt, k.Preisart, k.MinRabatt, k.Zeitraum, int64(k.MinPreis), int64(k.MaxPreis),
		k.MaxRang, strings.TrimSpace(k.Suchbegriff), k.Kategorien, k.Ausschluss, k.Maerkte, ModiNormal(k.Modus),
		k.Minuten, k.MaxJeLauf, jaNein(k.Aktiv), time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	return erg.LastInsertId()
}

func (s *Store) KeepaSuchen() ([]KeepaSuche, error) {
	zeilen, err := s.db.Query(`SELECT ` + keepaSucheSpalten + ` FROM keepa_suchen ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []KeepaSuche
	for zeilen.Next() {
		var k KeepaSuche
		var aktiv int
		var geprueft string
		var minP, maxP int64
		if err := zeilen.Scan(&k.ID, &k.Name, &k.Markt, &k.Preisart, &k.MinRabatt, &k.Zeitraum, &minP, &maxP, &k.MaxRang,
			&k.Suchbegriff, &k.Kategorien, &k.Ausschluss, &k.Maerkte, &k.Modus, &k.Minuten, &k.MaxJeLauf, &aktiv,
			&geprueft, &k.Status); err != nil {
			return nil, err
		}
		k.MinPreis, k.MaxPreis, k.Aktiv = money.Cents(minP), money.Cents(maxP), aktiv != 0
		k.GeprueftAm, _ = time.Parse(time.RFC3339, geprueft)
		out = append(out, k)
	}
	return out, zeilen.Err()
}

func (s *Store) KeepaSucheGeprueft(id int64, zeit time.Time, status string) error {
	_, err := s.db.Exec(`UPDATE keepa_suchen SET geprueft_am = ?, status = ? WHERE id = ?`,
		zeit.UTC().Format(time.RFC3339), status, id)
	return err
}

func (s *Store) KeepaSucheAktiv(id int64, aktiv bool) error {
	_, err := s.db.Exec(`UPDATE keepa_suchen SET aktiv = ? WHERE id = ?`, jaNein(aktiv), id)
	return err
}

func (s *Store) KeepaSucheLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM keepa_suchen WHERE id = ?`, id)
	return err
}
