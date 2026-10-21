package store

import (
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Weitere Einstellungen: Tageszusammenfassung und eBay.
const (
	// Channel und Uhrzeit ("20:00") der Tageszusammenfassung; 0 = aus.
	SchluesselMonitorTagChannel = "monitor.tag_channel"
	SchluesselMonitorTagZeit    = "monitor.tag_zeit"
	// Shop-Rabatte einrechnen ("1" = an).
	SchluesselMonitorRabatte = "monitor.rabatte"
	// eBay-Zugang (Browse API, Client-Credentials) und Gebühren.
	SchluesselEbayAppID      = "ebay.app_id"
	SchluesselEbayCertID     = "ebay.cert_id"
	SchluesselEbayGebuehr    = "ebay.gebuehr_prozent"
	SchluesselEbayGebuehrFix = "ebay.gebuehr_fix"
	SchluesselEbayVersand    = "ebay.versand"
)

func init() {
	vorgaben[SchluesselMonitorTagChannel] = "0"
	vorgaben[SchluesselMonitorTagZeit] = "20:00"
	vorgaben[SchluesselMonitorRabatte] = "1"
	vorgaben[SchluesselEbayAppID] = ""
	vorgaben[SchluesselEbayCertID] = ""
	// Verkaufsprovision in den meisten Kategorien plus fester Anteil je
	// Bestellung (Stand der Gebührenübersicht für private und gewerbliche
	// Verkäufer; anpassbar).
	vorgaben[SchluesselEbayGebuehr] = "11"
	vorgaben[SchluesselEbayGebuehrFix] = "0,35"
	vorgaben[SchluesselEbayVersand] = "0"
}

// ---------------------------------------------------------------- Shop-Rabatte

// ShopRabatt senkt den Einkaufspreis bei einem Shop.
type ShopRabatt struct {
	ID       int64
	Shop     string
	Cashback float64
	Fest     money.Cents
	Ab       money.Cents
	Notiz    string
}

func (s *Store) ShopRabattAnlegen(r ShopRabatt) error {
	_, err := s.db.Exec(`INSERT INTO monitor_shoprabatte (shop, cashback, fest_cent, ab_cent, notiz) VALUES (?, ?, ?, ?, ?)`,
		strings.TrimSpace(r.Shop), r.Cashback, int64(r.Fest), int64(r.Ab), strings.TrimSpace(r.Notiz))
	return err
}

func (s *Store) ShopRabattLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM monitor_shoprabatte WHERE id = ?`, id)
	return err
}

func (s *Store) ShopRabatte() ([]ShopRabatt, error) {
	zeilen, err := s.db.Query(`SELECT id, shop, cashback, fest_cent, ab_cent, notiz FROM monitor_shoprabatte ORDER BY shop COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []ShopRabatt
	for zeilen.Next() {
		var r ShopRabatt
		if err := zeilen.Scan(&r.ID, &r.Shop, &r.Cashback, &r.Fest, &r.Ab, &r.Notiz); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, zeilen.Err()
}

// ---------------------------------------------------------------- Auswertung

// MonitorPostsSeit liefert die Deal-Posts des Monitors seit seit (ohne
// Preissturz-Meldungen, die tragen keinen Gewinn).
func (s *Store) MonitorPostsSeit(seit time.Time) ([]MonitorPost, error) {
	zeilen, err := s.db.Query(`SELECT id, produkt_id, shop, gesamt_cent, deal_id, channel_id, nachricht_id, gepostet_am, ausverkauft_am,
			kanal_id, kaeufe, kategorie, gewinn_cent, titel
		FROM monitor_posts WHERE gepostet_am >= ? AND text NOT LIKE '⚠️ Preissturz%' ORDER BY gepostet_am`, zeitText(seit))
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []MonitorPost
	for zeilen.Next() {
		var p MonitorPost
		var am, aus string
		if err := zeilen.Scan(&p.ID, &p.ProduktID, &p.Shop, &p.Gesamt, &p.DealID, &p.ChannelID, &p.NachrichtID, &am, &aus,
			&p.KanalID, &p.Kaeufe, &p.Kategorie, &p.Gewinn, &p.Titel); err != nil {
			return nil, err
		}
		p.GepostetAm, _ = time.Parse(time.RFC3339, am)
		p.AusverkauftAm, _ = time.Parse(time.RFC3339, aus)
		out = append(out, p)
	}
	return out, zeilen.Err()
}

func (s *Store) MonitorPostKaeufe(id int64, kaeufe int) error {
	_, err := s.db.Exec(`UPDATE monitor_posts SET kaeufe = ? WHERE id = ?`, kaeufe, id)
	return err
}

// DealKaeufe liefert die ✅ eines Amazon-Deals über alle seine Channels.
func (s *Store) DealKaeufe(hauptID int64) int {
	var n int
	_ = s.db.QueryRow(`SELECT COALESCE(SUM(kaeufe), 0) FROM deals WHERE id = ? OR haupt_id = ?`, hauptID, hauptID).Scan(&n)
	return n
}
