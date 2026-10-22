package store

import (
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Rueckblick ist der Abgleich eines geposteten Deals mit dem späteren
// Buy-Box-Verlauf bei Keepa: hat der Verkaufspreis gehalten, ist er
// eingebrochen, und wann hat er sich erholt?
type Rueckblick struct {
	DealID     int64
	GeprueftAm time.Time
	// Daten ist false, wenn Keepa für die Zeit nach dem Post keinen
	// Buy-Box-Preis kennt; Fehler nennt dann gegebenenfalls den Grund.
	Daten bool
	// VKJetzt ist der letzte bekannte Preis, VKTief der tiefste seit dem
	// Post, VK30 und VK90 der zeitgewichtete Median der ersten 30 bzw. 90
	// Tage nach dem Post.
	VKJetzt, VKTief, VK30, VK90 money.Cents
	TiefAm                      time.Time
	// ErholtAm ist der Tag, an dem der Preis nach dem Tief wieder beim
	// damaligen Verkaufspreis lag; Nullwert, wenn nie (oder nie gefallen).
	ErholtAm time.Time
	Fehler   string
}

func rbZeit(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(zeitLayout)
}

func rbZeitAus(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}

// RueckblickSpeichern legt den Abgleich eines Deals ab oder ersetzt ihn.
func (s *Store) RueckblickSpeichern(r Rueckblick) error {
	daten := 0
	if r.Daten {
		daten = 1
	}
	_, err := s.db.Exec(`INSERT INTO deal_rueckblick
		(deal_id, geprueft_am, daten, vk_jetzt, vk_tief, tief_am, vk_30, vk_90, erholt_am, fehler)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(deal_id) DO UPDATE SET geprueft_am = excluded.geprueft_am, daten = excluded.daten,
		vk_jetzt = excluded.vk_jetzt, vk_tief = excluded.vk_tief, tief_am = excluded.tief_am,
		vk_30 = excluded.vk_30, vk_90 = excluded.vk_90, erholt_am = excluded.erholt_am, fehler = excluded.fehler`,
		r.DealID, rbZeit(r.GeprueftAm), daten, int64(r.VKJetzt), int64(r.VKTief), rbZeit(r.TiefAm),
		int64(r.VK30), int64(r.VK90), rbZeit(r.ErholtAm), r.Fehler)
	return err
}

// Rueckblicke liefert alle gespeicherten Abgleiche nach Deal.
func (s *Store) Rueckblicke() (map[int64]Rueckblick, error) {
	zeilen, err := s.db.Query(`SELECT deal_id, geprueft_am, daten, vk_jetzt, vk_tief, tief_am,
		vk_30, vk_90, erholt_am, fehler FROM deal_rueckblick`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	out := map[int64]Rueckblick{}
	for zeilen.Next() {
		var r Rueckblick
		var geprueft, tief, erholt string
		var daten int
		var jetzt, vkTief, vk30, vk90 int64
		if err := zeilen.Scan(&r.DealID, &geprueft, &daten, &jetzt, &vkTief, &tief, &vk30, &vk90, &erholt, &r.Fehler); err != nil {
			return nil, err
		}
		r.GeprueftAm, r.TiefAm, r.ErholtAm = rbZeitAus(geprueft), rbZeitAus(tief), rbZeitAus(erholt)
		r.Daten = daten == 1
		r.VKJetzt, r.VKTief, r.VK30, r.VK90 = money.Cents(jetzt), money.Cents(vkTief), money.Cents(vk30), money.Cents(vk90)
		out[r.DealID] = r
	}
	return out, zeilen.Err()
}

// RueckblickDeals sind die Deals eines Zeitraums für den Rückblick: je
// Deal nur der Hauptpost (ein Deal in drei Channels zählt einmal), ohne
// gelöschte Posts und ohne Deals ohne ASIN, ältester zuerst.
func (s *Store) RueckblickDeals(von, bis time.Time) ([]Deal, error) {
	wo := ` WHERE haupt_id = 0 AND status <> '` + StatusGeloescht + `' AND asin <> ''`
	var args []any
	if !von.IsZero() {
		wo += ` AND gepostet_am >= ?`
		args = append(args, von.UTC().Format(zeitLayout))
	}
	if !bis.IsZero() {
		wo += ` AND gepostet_am <= ?`
		args = append(args, bis.UTC().Format(zeitLayout))
	}
	zeilen, err := s.db.Query(`SELECT `+dealSpalten+` FROM deals`+wo+` ORDER BY gepostet_am, id LIMIT 5000`, args...)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []Deal
	for zeilen.Next() {
		d, err := scanDeal(zeilen)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, zeilen.Err()
}
