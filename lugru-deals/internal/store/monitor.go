package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Einstellungen des Shop-Monitors.
const (
	// SchluesselMonitorAktiv schaltet den ganzen Monitor ein ("1") oder aus.
	SchluesselMonitorAktiv = "monitor.aktiv"
	// SchluesselMonitorIntervall ist, wie oft jedes Produkt geprüft wird, in
	// Sekunden.
	SchluesselMonitorIntervall = "monitor.intervall_sekunden"
	// SchluesselMonitorSperre ist, wie lange derselbe Deal nicht noch einmal
	// gepostet wird, in Minuten — außer er wird günstiger.
	SchluesselMonitorSperre = "monitor.sperre_minuten"
	// SchluesselMonitorPoster ist der Name, der bei Monitor-Deals als Poster
	// steht (einer aus deal.poster, leer für keinen).
	SchluesselMonitorPoster = "monitor.poster"
	// SchluesselMonitorMaxTage ist die längste Lieferzeit in Tagen, die ein
	// Angebot haben darf; 0 heißt: keine Grenze.
	SchluesselMonitorMaxTage = "monitor.max_liefertage"
)

func init() {
	vorgaben[SchluesselMonitorAktiv] = "0"
	vorgaben[SchluesselMonitorIntervall] = "60"
	vorgaben[SchluesselMonitorSperre] = "360"
	vorgaben[SchluesselMonitorPoster] = ""
	vorgaben[SchluesselMonitorMaxTage] = "7"
}

// MonitorProdukt ist ein Produkt, das bei billiger.de beobachtet wird.
type MonitorProdukt struct {
	ID   int64
	Name string
	URL  string
	EAN  string
	// ASIN ist der Artikel bei Amazon. Leer, bis der Monitor sie über die
	// EAN bei Keepa gefunden hat oder sie von Hand eingetragen wurde.
	ASIN string
	// Maerkte sind die Zielmärkte als Liste mit Komma, der erste ist der
	// Leitmarkt. Leer heißt: die Standard-Zielmärkte aus den Einstellungen.
	Maerkte string
	// MaxEK ist der höchste Einkaufspreis inklusive Versand; 0 heißt: keiner.
	MaxEK money.Cents
	// Shops sind die Shops, deren Angebote zählen, als Liste mit Komma oder
	// Zeilenumbruch. Leer heißt: alle.
	Shops string
	// AuchVerzoegert lässt auch Angebote zu, die erst in einer Woche oder
	// später liefern (gelbes Symbol bei billiger.de).
	AuchVerzoegert bool
	Aktiv          bool
	AngelegtAm     time.Time

	GeprueftAm time.Time
	Status     string
	BesterShop string
	BesterCent money.Cents

	BewertetShop string
	BewertetCent money.Cents
	BewertetAm   time.Time

	// Modus sind die Verkaufswege, gegen die gerechnet wird, als Liste mit
	// Komma: ModusAmazon (Verkaufspreis bei Amazon über Keepa), ModusAnkauf
	// (fester Ankaufspreis) und ModusEbay (Marktpreis bei eBay). Ein Produkt
	// kann mehrere zugleich haben; jeder wird für sich bewertet und gepostet.
	// Mit Ankauf ist MaxEK der Preiswecker.
	Modus  string
	Ankauf money.Cents
	// Hinweis steht im Ankaufs-Post, etwa „1180 € ab 6 Stk“.
	Hinweis string
	// Kategorie ist frei, etwa „Konsolen“ — Regeln können danach wählen.
	Kategorie string
	// Prio ist PrioHoch, PrioNormal oder PrioNiedrig: wie oft geprüft wird.
	Prio string
	// Stichworte erkennen das Produkt in mydealz-Deals: eine Zeile oder ein
	// Komma je Stichwort, ein Stichwort passt, wenn alle seine Wörter im
	// Titel stehen („ps5 pro" passt auf „Sony PlayStation 5 Pro … PS5 Pro").
	Stichworte string
	// Notiz ist nur für euch, etwa die Ankäufer aus dem Listen-Import.
	Notiz string

	// Einkauf sind die Amazon-Märkte, auf denen eingekauft wird, als Liste
	// mit Komma („DE,FR,IT,ES“). Leer heißt: Einkauf bei den Shops von
	// billiger.de (URL ist dann die Preisliste). Sonst ist URL die
	// Produktseite bei Amazon und die Preise kommen von Keepa.
	Einkauf string

	// Herkunft ist HerkunftKeepaDeal, wenn die Keepa-Suche nach Preisstürzen
	// das Produkt angelegt hat; leer bei allem, was von Hand kam.
	Herkunft string

	// Nur während einer Prüfung im Modus eBay gesetzt, nicht gespeichert:
	// Marktpreis, aus wie vielen Angeboten er stammt, und die Suche bei eBay.
	EbayVK     money.Cents
	EbayAnzahl int
	EbayLink   string
}

// Prio-Stufen der Monitor-Produkte.
const (
	PrioHoch    = "hoch"
	PrioNormal  = "normal"
	PrioNiedrig = "niedrig"
)

func prioOderNormal(p string) string {
	switch p {
	case PrioHoch, PrioNiedrig:
		return p
	}
	return PrioNormal
}

// Die beiden Arten von Monitor-Produkten.
const (
	ModusAmazon = "amazon"
	ModusAnkauf = "ankauf"
	// ModusEbay rechnet gegen den Marktpreis bei eBay (siehe internal/ebay).
	ModusEbay = "ebay"
)

// AlleModi sind die Verkaufswege in fester Reihenfolge.
var AlleModi = []string{ModusAmazon, ModusAnkauf, ModusEbay}

// ModiNormal macht aus einer Liste von Verkaufswegen (mit Komma) die
// geordnete Liste ohne Doppelte und Unbekanntes; leer heißt Amazon.
func ModiNormal(roh ...string) string {
	gewaehlt := map[string]bool{}
	for _, r := range roh {
		for _, m := range strings.Split(r, ",") {
			gewaehlt[strings.TrimSpace(strings.ToLower(m))] = true
		}
	}
	var out []string
	for _, m := range AlleModi {
		if gewaehlt[m] {
			out = append(out, m)
		}
	}
	if len(out) == 0 {
		return ModusAmazon
	}
	return strings.Join(out, ",")
}

func modusOderAmazon(m string) string { return ModiNormal(m) }

// Modi sind die Verkaufswege des Produkts.
func (p MonitorProdukt) Modi() []string { return strings.Split(ModiNormal(p.Modus), ",") }

func (p MonitorProdukt) hatModus(m string) bool {
	for _, x := range p.Modi() {
		if x == m {
			return true
		}
	}
	return false
}

// IstAmazon sagt, ob gegen den Verkaufspreis bei Amazon gerechnet wird.
func (p MonitorProdukt) IstAmazon() bool { return p.hatModus(ModusAmazon) }

// IstAnkauf sagt, ob gegen einen Ankaufspreis gerechnet wird.
func (p MonitorProdukt) IstAnkauf() bool { return p.hatModus(ModusAnkauf) }

// IstEbay sagt, ob gegen den eBay-Preis gerechnet wird.
func (p MonitorProdukt) IstEbay() bool { return p.hatModus(ModusEbay) }

// IstFestpreis: Ankauf und eBay rechnen beide gegen einen festen Erlös statt
// über Keepa und posten im selben Format. Gilt nur für eine Prüfung mit
// genau einem Verkaufsweg — so läuft jede Bewertung (siehe Modi).
func (p MonitorProdukt) IstFestpreis() bool { return p.Modus == ModusAnkauf || p.Modus == ModusEbay }

// IstAmazonQuelle sagt, ob bei Amazon eingekauft wird statt bei den Shops
// von billiger.de.
func (p MonitorProdukt) IstAmazonQuelle() bool { return strings.TrimSpace(p.Einkauf) != "" }

// ShopListe liefert die Shops als bereinigte Liste.
func ShopListe(roh string) []string {
	var out []string
	for _, s := range strings.FieldsFunc(roh, func(r rune) bool { return r == ',' || r == '\n' || r == ';' }) {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// ShopPasst meldet, ob shop in der Liste steht. Verglichen wird ohne Groß-
// und Kleinschreibung, ohne Leerzeichen und Satzzeichen und als Teilwort: "otto" passt auf "OTTO", "kaufland"
// auf "Kaufland.de". Eine leere Liste lässt jeden Shop zu.
func ShopPasst(liste, shop string) bool {
	eintraege := ShopListe(liste)
	if len(eintraege) == 0 {
		return true
	}
	shop = shopSchluessel(shop)
	for _, e := range eintraege {
		if k := shopSchluessel(e); k != "" && strings.Contains(shop, k) {
			return true
		}
	}
	return false
}

// shopSchluessel macht Shopnamen vergleichbar: klein, ohne Leerzeichen,
// Bindestriche und Punkte. billiger.de schreibt „Media Markt Online Shop“,
// eingetragen wird eher „MediaMarkt“ oder „media-markt“.
func shopSchluessel(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if r == ' ' || r == '-' || r == '.' || r == '_' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

const monitorProduktSpalten = `id, name, url, ean, asin, maerkte, max_ek_cent, shops, auch_verzoegert, aktiv,
	angelegt_am, geprueft_am, status, bester_shop, bester_cent, bewertet_shop, bewertet_cent, bewertet_am,
	modus, ankauf_cent, hinweis, kategorie, prio, stichworte, notiz, einkauf, herkunft`

func scanMonitorProdukt(z scanner) (MonitorProdukt, error) {
	var p MonitorProdukt
	var verz, aktiv int
	var angelegt, geprueft, bewertet string
	if err := z.Scan(&p.ID, &p.Name, &p.URL, &p.EAN, &p.ASIN, &p.Maerkte, &p.MaxEK, &p.Shops, &verz, &aktiv,
		&angelegt, &geprueft, &p.Status, &p.BesterShop, &p.BesterCent, &p.BewertetShop, &p.BewertetCent, &bewertet,
		&p.Modus, &p.Ankauf, &p.Hinweis, &p.Kategorie, &p.Prio, &p.Stichworte, &p.Notiz, &p.Einkauf, &p.Herkunft); err != nil {
		return MonitorProdukt{}, err
	}
	p.AuchVerzoegert, p.Aktiv = verz != 0, aktiv != 0
	p.AngelegtAm, _ = time.Parse(time.RFC3339, angelegt)
	p.GeprueftAm, _ = time.Parse(time.RFC3339, geprueft)
	p.BewertetAm, _ = time.Parse(time.RFC3339, bewertet)
	return p, nil
}

func jaNein(b bool) int {
	if b {
		return 1
	}
	return 0
}

// MonitorProduktAnlegen legt ein Produkt an; dieselbe URL gibt es je Art
// (Amazon, Ankauf) nur einmal.
func (s *Store) MonitorProduktAnlegen(p MonitorProdukt) (int64, error) {
	var vorhanden int64
	// Jedes Produkt gibt es einmal; weitere Verkaufswege werden dort
	// angehakt statt doppelt angelegt.
	err := s.db.QueryRow(`SELECT id FROM monitor_produkte WHERE url = ?`, p.URL).Scan(&vorhanden)
	if err == nil {
		return 0, fmt.Errorf("dieses Produkt wird schon beobachtet — weitere Verkaufswege bitte dort unter „Bearbeiten“ anhaken")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	erg, err := s.db.Exec(`
		INSERT INTO monitor_produkte (name, url, ean, asin, maerkte, max_ek_cent, shops, auch_verzoegert, aktiv, angelegt_am,
			modus, ankauf_cent, hinweis, kategorie, prio, stichworte, notiz, einkauf, herkunft)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		strings.TrimSpace(p.Name), p.URL, strings.TrimSpace(p.EAN), strings.ToUpper(strings.TrimSpace(p.ASIN)),
		p.Maerkte, int64(p.MaxEK), strings.TrimSpace(p.Shops), jaNein(p.AuchVerzoegert), jaNein(p.Aktiv),
		time.Now().UTC().Format(time.RFC3339),
		modusOderAmazon(p.Modus), int64(p.Ankauf), strings.TrimSpace(p.Hinweis), strings.TrimSpace(p.Kategorie),
		prioOderNormal(p.Prio), strings.TrimSpace(p.Stichworte), strings.TrimSpace(p.Notiz), strings.TrimSpace(p.Einkauf), p.Herkunft)
	if err != nil {
		return 0, fmt.Errorf("store: Monitor-Produkt nicht anlegbar: %w", err)
	}
	return erg.LastInsertId()
}

// MonitorProduktAendern speichert die Felder, die sich auf der Seite ändern
// lassen. Ändern sich Shops, Höchstpreis, Märkte oder ASIN, wird der zuletzt
// bewertete Einkauf vergessen — das nächste Angebot wird dann neu bewertet.
func (s *Store) MonitorProduktAendern(p MonitorProdukt) error {
	_, err := s.db.Exec(`
		UPDATE monitor_produkte SET name = ?, asin = ?, maerkte = ?, max_ek_cent = ?, shops = ?, auch_verzoegert = ?,
			modus = ?, ankauf_cent = ?, hinweis = ?, kategorie = ?, prio = ?, stichworte = ?, notiz = ?, einkauf = ?,
			bewertet_shop = '', bewertet_cent = 0, bewertet_am = ''
		WHERE id = ?`,
		strings.TrimSpace(p.Name), strings.ToUpper(strings.TrimSpace(p.ASIN)), p.Maerkte, int64(p.MaxEK),
		strings.TrimSpace(p.Shops), jaNein(p.AuchVerzoegert),
		modusOderAmazon(p.Modus), int64(p.Ankauf), strings.TrimSpace(p.Hinweis), strings.TrimSpace(p.Kategorie),
		prioOderNormal(p.Prio), strings.TrimSpace(p.Stichworte), strings.TrimSpace(p.Notiz), strings.TrimSpace(p.Einkauf), p.ID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM monitor_gemeldet WHERE schluessel LIKE ?`, BewertetPraefix(p.ID)+"%")
	return err
}

// BewertetPraefix beginnt die Schlüssel, unter denen sich der Monitor je
// Verkaufsweg den zuletzt bewerteten Einkauf merkt (siehe Gemeldet).
func BewertetPraefix(id int64) string { return fmt.Sprintf("bewertet:%d:", id) }

func (s *Store) MonitorProduktAktiv(id int64, aktiv bool) error {
	_, err := s.db.Exec(`UPDATE monitor_produkte SET aktiv = ? WHERE id = ?`, jaNein(aktiv), id)
	return err
}

// MonitorProduktLoeschen löscht das Produkt, seine eigenen Regeln und sein
// Protokoll.
func (s *Store) MonitorProduktLoeschen(id int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM monitor_regeln WHERE produkt_id = ?`,
		`DELETE FROM monitor_treffer WHERE produkt_id = ?`,
		`DELETE FROM monitor_produkte WHERE id = ?`,
	} {
		if _, err := tx.Exec(q, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) MonitorProdukt(id int64) (MonitorProdukt, error) {
	return scanMonitorProdukt(s.db.QueryRow(`SELECT `+monitorProduktSpalten+` FROM monitor_produkte WHERE id = ?`, id))
}

func (s *Store) MonitorProdukte() ([]MonitorProdukt, error) {
	zeilen, err := s.db.Query(`SELECT ` + monitorProduktSpalten + ` FROM monitor_produkte ORDER BY aktiv DESC, name COLLATE NOCASE, id`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []MonitorProdukt
	for zeilen.Next() {
		p, err := scanMonitorProdukt(zeilen)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, zeilen.Err()
}

// MonitorFaellig liefert die aktiven Produkte, die zuletzt vor mehr als
// intervall geprüft wurden — das am längsten ungeprüfte zuerst.
func (s *Store) MonitorFaellig(intervall time.Duration, jetzt time.Time) ([]MonitorProdukt, error) {
	return s.MonitorFaelligJe(func(MonitorProdukt) time.Duration { return intervall }, jetzt)
}

// MonitorFaelligJe ist MonitorFaellig mit einem Intervall je Produkt (Prio).
func (s *Store) MonitorFaelligJe(intervall func(MonitorProdukt) time.Duration, jetzt time.Time) ([]MonitorProdukt, error) {
	alle, err := s.MonitorProdukte()
	if err != nil {
		return nil, err
	}
	var out []MonitorProdukt
	for _, p := range alle {
		if p.Aktiv && (p.GeprueftAm.IsZero() || jetzt.Sub(p.GeprueftAm) >= intervall(p)) {
			out = append(out, p)
		}
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].GeprueftAm.Before(out[j-1].GeprueftAm); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, nil
}

// MonitorGeprueft hält das Ergebnis einer Prüfung fest. name, ean und asin
// werden nur gesetzt, wo sie bisher leer sind — eine von Hand eingetragene
// ASIN überschreibt der Monitor nie.
func (s *Store) MonitorGeprueft(id int64, zeit time.Time, status, besterShop string, besterCent money.Cents, name, ean, asin string) error {
	_, err := s.db.Exec(`
		UPDATE monitor_produkte SET geprueft_am = ?, status = ?, bester_shop = ?, bester_cent = ?,
			name = CASE WHEN name = '' THEN ? ELSE name END,
			ean  = CASE WHEN ean  = '' THEN ? ELSE ean  END,
			asin = CASE WHEN asin = '' THEN ? ELSE asin END
		WHERE id = ?`,
		zeit.UTC().Format(time.RFC3339), status, besterShop, int64(besterCent), name, ean, asin, id)
	return err
}

// MonitorBewertet merkt sich den Einkauf, der zuletzt bei Keepa bewertet
// wurde.
func (s *Store) MonitorBewertet(id int64, shop string, cent money.Cents, zeit time.Time) error {
	_, err := s.db.Exec(`UPDATE monitor_produkte SET bewertet_shop = ?, bewertet_cent = ?, bewertet_am = ? WHERE id = ?`,
		shop, int64(cent), zeit.UTC().Format(time.RFC3339), id)
	return err
}

// MonitorRegel legt fest, welcher Treffer in welchen Channel geht.
type MonitorRegel struct {
	ID        int64
	Name      string
	ChannelID int64
	// ProduktID 0 heißt: für jedes Produkt.
	ProduktID  int64
	MinMarge   float64
	MinGewinn  money.Cents
	MinSales   int
	Shops      string
	Aktiv      bool
	AngelegtAm time.Time
	// Modus leer heißt: für beide Arten; sonst ModusAmazon oder ModusAnkauf.
	Modus string
	// Kategorie leer heißt: jede; sonst nur Produkte dieser Kategorie.
	Kategorie string
}

func (s *Store) MonitorRegelAnlegen(r MonitorRegel) (int64, error) {
	erg, err := s.db.Exec(`
		INSERT INTO monitor_regeln (name, channel_id, produkt_id, min_marge, min_gewinn_cent, min_sales, shops, aktiv, angelegt_am, modus, kategorie)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		strings.TrimSpace(r.Name), r.ChannelID, r.ProduktID, r.MinMarge, int64(r.MinGewinn), r.MinSales,
		strings.TrimSpace(r.Shops), jaNein(r.Aktiv), time.Now().UTC().Format(time.RFC3339),
		strings.TrimSpace(r.Modus), strings.TrimSpace(r.Kategorie))
	if err != nil {
		return 0, fmt.Errorf("store: Regel nicht anlegbar: %w", err)
	}
	return erg.LastInsertId()
}

func (s *Store) MonitorRegelAktiv(id int64, aktiv bool) error {
	_, err := s.db.Exec(`UPDATE monitor_regeln SET aktiv = ? WHERE id = ?`, jaNein(aktiv), id)
	return err
}

func (s *Store) MonitorRegelLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM monitor_regeln WHERE id = ?`, id)
	return err
}

func (s *Store) MonitorRegeln() ([]MonitorRegel, error) {
	zeilen, err := s.db.Query(`SELECT id, name, channel_id, produkt_id, min_marge, min_gewinn_cent, min_sales, shops, aktiv, angelegt_am,
		modus, kategorie FROM monitor_regeln ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []MonitorRegel
	for zeilen.Next() {
		var r MonitorRegel
		var aktiv int
		var angelegt string
		if err := zeilen.Scan(&r.ID, &r.Name, &r.ChannelID, &r.ProduktID, &r.MinMarge, &r.MinGewinn, &r.MinSales, &r.Shops, &aktiv, &angelegt,
			&r.Modus, &r.Kategorie); err != nil {
			return nil, err
		}
		r.Aktiv = aktiv != 0
		r.AngelegtAm, _ = time.Parse(time.RFC3339, angelegt)
		out = append(out, r)
	}
	return out, zeilen.Err()
}

// MonitorTreffer ist ein bewertetes Angebot — gepostet oder nicht.
type MonitorTreffer struct {
	ID           int64
	ProduktID    int64
	Titel        string
	Shop         string
	Gesamt       money.Cents
	Gewinn       money.Cents
	MargeProzent float64
	Sales        int
	Gepostet     bool
	Ergebnis     string
	DealID       int64
	Zeit         time.Time
	// Modus ist der Verkaufsweg, mit dem bewertet wurde.
	Modus string
}

func (s *Store) MonitorTrefferAnlegen(t MonitorTreffer) error {
	if t.Zeit.IsZero() {
		t.Zeit = time.Now()
	}
	_, err := s.db.Exec(`
		INSERT INTO monitor_treffer (produkt_id, titel, shop, gesamt_cent, gewinn_cent, marge_prozent, sales, gepostet, ergebnis, deal_id, zeit, modus)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ProduktID, t.Titel, t.Shop, int64(t.Gesamt), int64(t.Gewinn), t.MargeProzent, t.Sales, jaNein(t.Gepostet),
		t.Ergebnis, t.DealID, t.Zeit.UTC().Format(time.RFC3339), t.Modus)
	if err != nil {
		return err
	}
	// Das Protokoll wächst nicht ohne Ende: je Produkt bleiben die letzten 200.
	_, _ = s.db.Exec(`DELETE FROM monitor_treffer WHERE produkt_id = ? AND id NOT IN
		(SELECT id FROM monitor_treffer WHERE produkt_id = ? ORDER BY id DESC LIMIT 200)`, t.ProduktID, t.ProduktID)
	return nil
}

// MonitorLetzteTreffer liefert die neuesten Treffer über alle Produkte.
func (s *Store) MonitorLetzteTreffer(n int) ([]MonitorTreffer, error) {
	zeilen, err := s.db.Query(`SELECT id, produkt_id, titel, shop, gesamt_cent, gewinn_cent, marge_prozent, sales, gepostet, ergebnis, deal_id, zeit
		FROM monitor_treffer ORDER BY id DESC LIMIT ?`, n)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	var out []MonitorTreffer
	for zeilen.Next() {
		var t MonitorTreffer
		var gepostet int
		var zeit string
		if err := zeilen.Scan(&t.ID, &t.ProduktID, &t.Titel, &t.Shop, &t.Gesamt, &t.Gewinn, &t.MargeProzent, &t.Sales,
			&gepostet, &t.Ergebnis, &t.DealID, &zeit); err != nil {
			return nil, err
		}
		t.Gepostet = gepostet != 0
		t.Zeit, _ = time.Parse(time.RFC3339, zeit)
		out = append(out, t)
	}
	return out, zeilen.Err()
}

// MonitorZuletztGepostet liefert den letzten geposteten Deal eines Produkts
// seit seit. Preissturz-Meldungen zählen nicht: sie gehen in einen eigenen
// Channel und dürfen den eigentlichen Deal nicht sperren.
//
// modus ist der Verkaufsweg: ein Ankaufs-Post sperrt keinen Amazon-Post
// desselben Produkts. Ältere Einträge ohne Verkaufsweg zählen für jeden.
func (s *Store) MonitorZuletztGepostet(produktID int64, modus string, seit time.Time) (MonitorTreffer, bool) {
	var t MonitorTreffer
	var zeit string
	err := s.db.QueryRow(`SELECT shop, gesamt_cent, zeit FROM monitor_treffer
		WHERE produkt_id = ? AND gepostet = 1 AND zeit >= ? AND ergebnis NOT LIKE 'Preissturz%' AND (modus = ? OR modus = '')
		ORDER BY id DESC LIMIT 1`,
		produktID, seit.UTC().Format(time.RFC3339), modus).Scan(&t.Shop, &t.Gesamt, &zeit)
	if err != nil {
		return MonitorTreffer{}, false
	}
	t.Zeit, _ = time.Parse(time.RFC3339, zeit)
	return t, true
}

// MonitorProduktZuURL liefert das Produkt mit dieser Preisliste bzw.
// Amazon-Seite, falls es schon beobachtet wird.
func (s *Store) MonitorProduktZuURL(url string) (MonitorProdukt, bool) {
	p, err := scanMonitorProdukt(s.db.QueryRow(`SELECT `+monitorProduktSpalten+` FROM monitor_produkte WHERE url = ? ORDER BY id LIMIT 1`, url))
	return p, err == nil
}
