package store

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Weitere Einstellungen des Shop-Monitors.
const (
	// Prüfintervalle der Prio-Stufen in Sekunden; „normal" ist
	// SchluesselMonitorIntervall.
	SchluesselMonitorHochSek    = "monitor.prio_hoch_sekunden"
	SchluesselMonitorNiedrigSek = "monitor.prio_niedrig_sekunden"
	// Preisfehler-Alarm: ab so viel Prozent unter dem 7-Tage-Schnitt, in
	// diesen Channel (0 = aus). Derselbe Channel bekommt den Kategorie-Scan.
	SchluesselMonitorSturzProzent = "monitor.preissturz_prozent"
	SchluesselMonitorSturzChannel = "monitor.preissturz_channel"
	// Admin-Channel für Fehler des Monitors (0 = aus).
	SchluesselMonitorAdminChannel = "monitor.admin_channel"
	// mydealz als zweite Quelle ("1" = an).
	SchluesselMonitorMydealz = "monitor.mydealz"
	// Posts automatisch als ausverkauft markieren ("1" = an).
	SchluesselMonitorAusverkauft = "monitor.ausverkauft"
	// Öffentliche Adresse dieses Servers für die direkten Shop-Links,
	// etwa "http://91.99.29.165:8080". Leer: kein direkter Link.
	SchluesselMonitorBasisURL = "monitor.basis_url"
)

func init() {
	vorgaben[SchluesselMonitorHochSek] = "15"
	vorgaben[SchluesselMonitorNiedrigSek] = "300"
	vorgaben[SchluesselMonitorSturzProzent] = "20"
	vorgaben[SchluesselMonitorSturzChannel] = "0"
	vorgaben[SchluesselMonitorAdminChannel] = "0"
	vorgaben[SchluesselMonitorMydealz] = "1"
	vorgaben[SchluesselMonitorAusverkauft] = "1"
	vorgaben[SchluesselMonitorBasisURL] = ""
}

func zeitText(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// ---------------------------------------------------------------- Preise

// MonitorPreisMerken hält den Preis fest, wenn er sich geändert hat oder der
// letzte Eintrag älter als eine Stunde ist.
func (s *Store) MonitorPreisMerken(produktID int64, cent money.Cents, shop string, jetzt time.Time) error {
	var letzt int64
	var zeit string
	err := s.db.QueryRow(`SELECT cent, zeit FROM monitor_preise WHERE produkt_id = ? ORDER BY zeit DESC LIMIT 1`, produktID).Scan(&letzt, &zeit)
	if err == nil {
		t, _ := time.Parse(time.RFC3339, zeit)
		if money.Cents(letzt) == cent && jetzt.Sub(t) < time.Hour {
			return nil
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err := s.db.Exec(`INSERT INTO monitor_preise (produkt_id, zeit, cent, shop) VALUES (?, ?, ?, ?)`,
		produktID, zeitText(jetzt), int64(cent), shop); err != nil {
		return err
	}
	// Älter als 90 Tage braucht niemand.
	_, _ = s.db.Exec(`DELETE FROM monitor_preise WHERE produkt_id = ? AND zeit < ?`, produktID, zeitText(jetzt.AddDate(0, 0, -90)))
	return nil
}

// PreisStand fasst den Verlauf eines Zeitraums zusammen.
type PreisStand struct {
	Anzahl   int
	Tiefst   money.Cents
	Schnitt  money.Cents
	ErsterAm time.Time
}

// MonitorPreisStand liefert Tiefstpreis und Schnitt seit seit. Der Schnitt
// ist zeitgewichtet: ein Preis, der zwei Tage galt, zählt doppelt so viel wie
// einer, der einen Tag galt — sonst verzerrten häufige kurze Schwankungen
// das Bild.
func (s *Store) MonitorPreisStand(produktID int64, seit, jetzt time.Time) (PreisStand, error) {
	return preisStand(s.db, `SELECT zeit, cent FROM monitor_preise WHERE produkt_id = ? AND zeit >= ? ORDER BY zeit`,
		produktID, seit, jetzt)
}

func preisStand(db *sql.DB, abfrage string, schluessel any, seit, jetzt time.Time) (PreisStand, error) {
	zeilen, err := db.Query(abfrage, schluessel, zeitText(seit))
	if err != nil {
		return PreisStand{}, err
	}
	defer zeilen.Close()
	var st PreisStand
	var gewicht, summe float64
	var vorZeit time.Time
	var vorCent money.Cents
	for zeilen.Next() {
		var z string
		var c int64
		if err := zeilen.Scan(&z, &c); err != nil {
			return PreisStand{}, err
		}
		t, _ := time.Parse(time.RFC3339, z)
		if st.Anzahl == 0 {
			st.ErsterAm, st.Tiefst = t, money.Cents(c)
		} else {
			d := t.Sub(vorZeit).Hours()
			gewicht += d
			summe += d * float64(vorCent)
		}
		if money.Cents(c) < st.Tiefst {
			st.Tiefst = money.Cents(c)
		}
		st.Anzahl++
		vorZeit, vorCent = t, money.Cents(c)
	}
	if st.Anzahl > 0 {
		d := jetzt.Sub(vorZeit).Hours()
		gewicht += d
		summe += d * float64(vorCent)
		if gewicht > 0 {
			st.Schnitt = money.Cents(summe / gewicht)
		} else {
			st.Schnitt = vorCent
		}
	}
	return st, zeilen.Err()
}

// ---------------------------------------------------------------- Posts

// MonitorPost ist ein Post des Monitors in Discord.
type MonitorPost struct {
	ID            int64
	ProduktID     int64
	Shop          string
	Gesamt        money.Cents
	DealID        int64
	ChannelID     int64
	NachrichtID   string
	Text          string
	GepostetAm    time.Time
	AusverkauftAm time.Time
}

func (s *Store) MonitorPostMerken(p MonitorPost) error {
	if p.GepostetAm.IsZero() {
		p.GepostetAm = time.Now()
	}
	_, err := s.db.Exec(`INSERT INTO monitor_posts (produkt_id, shop, gesamt_cent, deal_id, channel_id, nachricht_id, text, gepostet_am)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, p.ProduktID, p.Shop, int64(p.Gesamt), p.DealID, p.ChannelID, p.NachrichtID, p.Text, zeitText(p.GepostetAm))
	return err
}

// MonitorOffenePosts liefert die Posts eines Produkts seit seit, die noch
// nicht als ausverkauft markiert sind.
func (s *Store) MonitorOffenePosts(produktID int64, seit time.Time) ([]MonitorPost, error) {
	zeilen, err := s.db.Query(`SELECT id, produkt_id, shop, gesamt_cent, deal_id, channel_id, nachricht_id, text, gepostet_am
		FROM monitor_posts WHERE produkt_id = ? AND ausverkauft_am = '' AND gepostet_am >= ? ORDER BY id`, produktID, zeitText(seit))
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []MonitorPost
	for zeilen.Next() {
		var p MonitorPost
		var am string
		if err := zeilen.Scan(&p.ID, &p.ProduktID, &p.Shop, &p.Gesamt, &p.DealID, &p.ChannelID, &p.NachrichtID, &p.Text, &am); err != nil {
			return nil, err
		}
		p.GepostetAm, _ = time.Parse(time.RFC3339, am)
		out = append(out, p)
	}
	return out, zeilen.Err()
}

func (s *Store) MonitorPostAusverkauft(id int64, zeit time.Time) error {
	_, err := s.db.Exec(`UPDATE monitor_posts SET ausverkauft_am = ? WHERE id = ?`, zeitText(zeit), id)
	return err
}

// DealsZuHaupt liefert einen Deal und alle Posts, die auf ihn verweisen (der
// Deal in weiteren Channels).
func (s *Store) DealsZuHaupt(id int64) ([]Deal, error) {
	zeilen, err := s.db.Query(`SELECT `+dealSpalten+` FROM deals WHERE id = ? OR haupt_id = ? ORDER BY id`, id, id)
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

// ---------------------------------------------------------------- Ankäufer

// Ankaeufer ist ein Ankäufer eines Produkts mit seinem Preis ab einer Menge.
type Ankaeufer struct {
	ID        int64
	ProduktID int64
	Name      string
	Preis     money.Cents
	AbStueck  int
	Notiz     string
}

func (s *Store) AnkaeuferAnlegen(a Ankaeufer) error {
	if a.AbStueck < 1 {
		a.AbStueck = 1
	}
	_, err := s.db.Exec(`INSERT INTO monitor_ankaeufer (produkt_id, name, preis_cent, ab_stueck, notiz) VALUES (?, ?, ?, ?, ?)`,
		a.ProduktID, strings.TrimSpace(a.Name), int64(a.Preis), a.AbStueck, strings.TrimSpace(a.Notiz))
	return err
}

func (s *Store) AnkaeuferLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM monitor_ankaeufer WHERE id = ?`, id)
	return err
}

// AnkaeuferAlle liefert alle Ankäufer, nach Produkt gruppiert.
func (s *Store) AnkaeuferAlle() (map[int64][]Ankaeufer, error) {
	zeilen, err := s.db.Query(`SELECT id, produkt_id, name, preis_cent, ab_stueck, notiz FROM monitor_ankaeufer ORDER BY produkt_id, ab_stueck, preis_cent DESC`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	out := map[int64][]Ankaeufer{}
	for zeilen.Next() {
		var a Ankaeufer
		if err := zeilen.Scan(&a.ID, &a.ProduktID, &a.Name, &a.Preis, &a.AbStueck, &a.Notiz); err != nil {
			return nil, err
		}
		out[a.ProduktID] = append(out[a.ProduktID], a)
	}
	return out, zeilen.Err()
}

// ---------------------------------------------------------------- Kategorien

// MonitorKategorie ist eine Kategorieseite bei billiger.de für den Scan.
type MonitorKategorie struct {
	ID         int64
	Name       string
	URL        string
	Aktiv      bool
	GeprueftAm time.Time
	Status     string
}

func (s *Store) KategorieAnlegen(k MonitorKategorie) error {
	_, err := s.db.Exec(`INSERT INTO monitor_kategorien (name, url, aktiv) VALUES (?, ?, 1)`, strings.TrimSpace(k.Name), k.URL)
	return err
}

func (s *Store) KategorieLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM monitor_kategorien WHERE id = ?`, id)
	return err
}

func (s *Store) KategorieGeprueft(id int64, zeit time.Time, status string) error {
	_, err := s.db.Exec(`UPDATE monitor_kategorien SET geprueft_am = ?, status = ? WHERE id = ?`, zeitText(zeit), status, id)
	return err
}

func (s *Store) Kategorien() ([]MonitorKategorie, error) {
	zeilen, err := s.db.Query(`SELECT id, name, url, aktiv, geprueft_am, status FROM monitor_kategorien ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []MonitorKategorie
	for zeilen.Next() {
		var k MonitorKategorie
		var aktiv int
		var am string
		if err := zeilen.Scan(&k.ID, &k.Name, &k.URL, &aktiv, &am, &k.Status); err != nil {
			return nil, err
		}
		k.Aktiv = aktiv != 0
		k.GeprueftAm, _ = time.Parse(time.RFC3339, am)
		out = append(out, k)
	}
	return out, zeilen.Err()
}

// KategoriePreisMerken hält den Preis eines Produkts einer Kategorieseite
// fest — wie MonitorPreisMerken, nur über eine Kennung von billiger.de.
func (s *Store) KategoriePreisMerken(objekt string, cent money.Cents, jetzt time.Time) error {
	var letzt int64
	var zeit string
	err := s.db.QueryRow(`SELECT cent, zeit FROM monitor_kategorie_preise WHERE objekt = ? ORDER BY zeit DESC LIMIT 1`, objekt).Scan(&letzt, &zeit)
	if err == nil {
		t, _ := time.Parse(time.RFC3339, zeit)
		if money.Cents(letzt) == cent && jetzt.Sub(t) < time.Hour {
			return nil
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO monitor_kategorie_preise (objekt, zeit, cent) VALUES (?, ?, ?)`, objekt, zeitText(jetzt), int64(cent))
	_, _ = s.db.Exec(`DELETE FROM monitor_kategorie_preise WHERE objekt = ? AND zeit < ?`, objekt, zeitText(jetzt.AddDate(0, 0, -30)))
	return err
}

func (s *Store) KategoriePreisStand(objekt string, seit, jetzt time.Time) (PreisStand, error) {
	return preisStand(s.db, `SELECT zeit, cent FROM monitor_kategorie_preise WHERE objekt = ? AND zeit >= ? ORDER BY zeit`,
		objekt, seit, jetzt)
}

// ---------------------------------------------------------------- Gemeldet

// SchonGemeldet sagt, ob schluessel seit seit gemeldet wurde.
func (s *Store) SchonGemeldet(schluessel string, seit time.Time) bool {
	var zeit string
	if err := s.db.QueryRow(`SELECT zeit FROM monitor_gemeldet WHERE schluessel = ?`, schluessel).Scan(&zeit); err != nil {
		return false
	}
	t, _ := time.Parse(time.RFC3339, zeit)
	return !t.Before(seit)
}

func (s *Store) Gemeldet(schluessel string, zeit time.Time) error {
	_, err := s.db.Exec(`INSERT INTO monitor_gemeldet (schluessel, zeit) VALUES (?, ?)
		ON CONFLICT(schluessel) DO UPDATE SET zeit = excluded.zeit`, schluessel, zeitText(zeit))
	_, _ = s.db.Exec(`DELETE FROM monitor_gemeldet WHERE zeit < ?`, zeitText(zeit.AddDate(0, 0, -30)))
	return err
}

// ---------------------------------------------------------------- Kurzlinks

const kurzZeichen = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// MonitorLink liefert den Kurzlink zu einem Klick-Schlüssel und legt ihn an,
// wenn es ihn noch nicht gibt.
func (s *Store) MonitorLink(schluessel, ersatz string) (string, error) {
	var kurz string
	err := s.db.QueryRow(`SELECT kurz FROM monitor_links WHERE schluessel = ?`, schluessel).Scan(&kurz)
	if err == nil {
		return kurz, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	for versuch := 0; versuch < 5; versuch++ {
		kurz = zufall(8)
		_, err = s.db.Exec(`INSERT INTO monitor_links (kurz, schluessel, ersatz, angelegt_am) VALUES (?, ?, ?, ?)`,
			kurz, schluessel, ersatz, zeitText(time.Now()))
		if err == nil {
			// Links älter als 30 Tage braucht niemand mehr.
			_, _ = s.db.Exec(`DELETE FROM monitor_links WHERE angelegt_am < ?`, zeitText(time.Now().AddDate(0, 0, -30)))
			return kurz, nil
		}
	}
	return "", err
}

// MonitorLinkAufloesen liefert Schlüssel und Ersatzseite zu einem Kurzlink.
func (s *Store) MonitorLinkAufloesen(kurz string) (schluessel, ersatz string, ok bool) {
	err := s.db.QueryRow(`SELECT schluessel, ersatz FROM monitor_links WHERE kurz = ?`, kurz).Scan(&schluessel, &ersatz)
	return schluessel, ersatz, err == nil
}

func zufall(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = kurzZeichen[int(b[i])%len(kurzZeichen)]
	}
	return string(b)
}
