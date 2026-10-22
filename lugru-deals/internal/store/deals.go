package store

import (
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Deal ist ein gesendeter Post samt aller Zahlen, mit denen er gerechnet
// wurde. ChannelName wird bewusst mitgespeichert statt verknüpft: die
// Historie soll das Löschen eines Channels überleben.
type Deal struct {
	ID         int64
	ASIN       string
	Titel      string
	Quellmarkt string
	// QuellURL ist der Einkaufslink eines Fremdshops. Bei einem
	// Amazon-Einkauf bleibt er leer — die Produktseite ergibt sich dort aus
	// Quellmarkt und ASIN, ein zweites Mal gespeichert wäre sie nur eine
	// weitere Stelle, die veralten kann.
	QuellURL  string
	Zielmarkt string

	EKCent money.Cents
	// EKArt hält fest, ob der Einkaufspreis netto oder brutto eingegeben
	// wurde. EKCent selbst ist immer der Bruttopreis, auch nach einer
	// Netto-Eingabe.
	EKArt   string
	EKNotiz string

	VKCent   money.Cents
	VKQuelle string

	Sales       int
	SalesQuelle string

	ProvisionProzent float64
	ProvisionQuelle  string

	FBACent   money.Cents
	FBAQuelle string

	UStModus     string
	GewinnCent   money.Cents
	MargeProzent float64

	ChannelID   int64
	ChannelName string

	NachrichtText string
	ChartDatei    string

	// BildKennung ist der Dateiname des Amazon-Produktbildes, nicht die
	// volle Adresse — internal/bild baut sie erst beim Anzeigen. Leer bei
	// jedem Deal, der vor dieser Spalte gepostet wurde, und bei jedem
	// Produkt, zu dem Keepa kein Bild kennt.
	BildKennung        string
	DiscordNachrichtID string
	GepostetAm         time.Time

	// MaxMenge ist die Höchstmenge je Bestellung (Cart-Limit), 0 wenn
	// keine angegeben wurde.
	MaxMenge int

	// Status sagt, was nach dem Posten mit dem Post geschah: StatusAktiv,
	// StatusAusverkauft oder StatusGeloescht.
	Status string

	// DiscordKanalID ist der Channel (oder Thread) der Nachricht.
	DiscordKanalID string

	// Kaeufe und NichtVerfuegbar zählen die Reaktionen ✅ und ❌ unter dem
	// Post, ohne die vorbelegte des Bots. ReaktionenAm ist der letzte
	// Abgleich; der Nullwert heißt, es gab noch keinen.
	Kaeufe          int
	NichtVerfuegbar int
	ReaktionenAm    time.Time

	// Gruppe ist die Gruppe des Channels beim Posten.
	Gruppe string

	// Steuersatz ist "ermaessigt" oder leer (normaler Satz).
	Steuersatz string

	// EffGewinnCent und EffMargeProzent sind die Zahlen, mit denen
	// Historie und Statistik rechnen: die des besseren Versandwegs. PanEU
	// sagt, dass das der Pan-EU-Weg ist (Ware liegt im Zielland).
	EffGewinnCent   money.Cents
	EffMargeProzent float64
	PanEU           bool

	// Poster ist, wer den Deal gepostet hat; leer bei alten Deals.
	Poster string

	// Lieferant ist bei einem Einkauf ohne Link (Großhandel) der Name des
	// Lieferanten, sonst leer. Gesetzt heißt: es gibt keinen Einkaufslink.
	Lieferant string

	// Importiert heißt: aus einem alten Discord-Post gelesen, nicht mit
	// dem Tool gerechnet.
	Importiert bool

	// HauptID ist bei einem Deal, der zusätzlich in weitere Channels ging,
	// der Deal des ersten Posts; 0 beim ersten Post selbst.
	HauptID int64

	// Formular sind die Eingaben, mit denen gepostet wurde (URL-kodiert) —
	// "Erneut posten" füllt sie wieder ein. Leer bei älteren Deals.
	Formular string

	// Maerkte sind die Zielmärkte dieses Posts. Beim Anlegen mitgegeben,
	// beim Lesen NICHT gefüllt: Deal und Deals liefern die Zeile, die
	// Märkte holt DealMaerkte gesammelt für eine ganze Seite. Sie hier
	// nebenbei nachzuladen ergäbe eine Abfrage je Zeile der Historie.
	Maerkte []DealMarkt
}

// DealMarkt sind die Zahlen eines Deals auf einem seiner Zielmärkte.
//
// Sie stehen neben der deals-Zeile und nicht in ihr: ein Post kann mehrere
// Märkte nennen, hat aber genau einen Text, einen Channel und eine
// Discord-Nachricht.
type DealMarkt struct {
	Markt     string
	Leitmarkt bool

	VKCent   money.Cents
	VKQuelle string

	Sales       int
	SalesQuelle string

	ProvisionProzent float64
	ProvisionQuelle  string

	FBACent   money.Cents
	FBAQuelle string

	GewinnCent   money.Cents
	MargeProzent float64

	// PanEU ist der Vergleich mit Bestand im Zielland. nil, wo es ihn nicht
	// gibt: im Lagerland gibt es keinen zweiten Versandweg, und ohne Maße
	// oder ohne passende Tarifklasse lässt er sich nicht bestimmen. Ein
	// Nullwert stünde sonst als Aussage da, die niemand gerechnet hat —
	// dieselbe Regel wie beim Zeiger in rechneDeal.
	PanEU *DealMarktPanEU
}

// DealMarktPanEU ist derselbe Markt mit der lokalen Versandgebühr.
type DealMarktPanEU struct {
	FBACent      money.Cents
	GewinnCent   money.Cents
	MargeProzent float64
}

// Die Zustände eines geposteten Deals.
const (
	StatusAktiv       = ""
	StatusAusverkauft = "ausverkauft"
	StatusGeloescht   = "geloescht"
)

// DealFilter beschreibt eine Abfrage der Historie.
type DealFilter struct {
	Suche     string
	ChannelID int64
	Von, Bis  time.Time

	// MargeMin und MargeMax begrenzen die Marge des Leitmarkts in Prozent.
	// nil heißt: keine Grenze.
	MargeMin, MargeMax *float64

	// Status filtert nach dem Zustand; "alle" oder leer lässt jeden durch,
	// "aktiv" meint StatusAktiv.
	Status string

	// Gruppe filtert nach der Gruppe des Channels; leer lässt jeden durch.
	Gruppe string

	// Poster filtert nach dem, der gepostet hat; leer lässt jeden durch.
	Poster string

	Limit  int
	Offset int
}

// zeitLayout schreibt Zeitstempel mit fester Breite der Nachkommastellen.
//
// time.RFC3339Nano ("...15:04:05.999999999Z07:00") KÜRZT den Bruchteil:
// nachfolgende Nullen fallen weg, und bei exakt 0 Nanosekunden verschwinden
// Punkt und Bruchteil vollständig. SQLite sortiert und filtert diese Spalte
// als Zeichenkette, und 'Z' (0x5A) steht im Zeichensatz nach '.' (0x2E).
// Damit sortiert "...12:00:00Z" (0 ns) NACH "...12:00:00.5Z" (500 ms) —
// chronologisch falsch herum — und ein Von-Filter mit einer vollen Sekunde
// (">= ...12:00:00Z") lässt genau die Zeilen durchfallen, die im selben
// Sekundenbruchteil später geschrieben wurden. Ein Datumsfilter erzeugt
// immer eine volle Sekunde (0 ns) und wäre also lautlos unvollständig.
//
// Mit fester Breite (0er statt 9er im Layout) bleiben Punkt und alle neun
// Stellen immer erhalten, wodurch die lexikographische mit der
// chronologischen Ordnung übereinstimmt. NICHT auf time.RFC3339Nano
// "vereinfachen" — das bringt genau diesen Fehler zurück. Gilt für jeden
// Schreibzugriff auf deals.gepostet_am, DealFilter.Von/Bis und
// keepa_cache.geholt_am. Lesen bleibt bei time.Parse(time.RFC3339Nano, …):
// das Parsen ist gegenüber der Nachkommastellen-Breite tolerant.
const zeitLayout = "2006-01-02T15:04:05.000000000Z07:00"

// DealAnlegen schreibt den Deal und seine Märkte in einer Transaktion.
//
// Zwei getrennte Schreibzugriffe wären die einfachere Variante und die
// falsche: bricht der zweite ab, bliebe ein Deal stehen, dessen
// gespeicherter Post vier Märkte nennt und dessen Datenbank einen kennt.
func (s *Store) DealAnlegen(d Deal) (int64, error) {
	if d.GepostetAm.IsZero() {
		d.GepostetAm = time.Now()
	}
	if d.MaxMenge == 0 {
		d.MaxMenge = MengeAusNotiz(d.EKNotiz)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}
	// Rollback nach einem erfolgreichen Commit ist ein No-op (sql.ErrTxDone)
	// — das defer darf darum bedingungslos stehen und deckt jeden frühen
	// Rücksprung darunter ab.
	defer tx.Rollback()

	erg, err := tx.Exec(`
		INSERT INTO deals (
			asin, titel, quellmarkt, quell_url, zielmarkt,
			ek_cent, ek_art, ek_notiz, vk_cent, vk_quelle,
			sales, sales_quelle, provision_prozent, provision_quelle,
			fba_cent, fba_quelle, ust_modus, gewinn_cent, marge_prozent,
			channel_id, channel_name, nachricht_text, chart_datei,
			discord_nachricht_id, gepostet_am, bild_kennung, max_menge, status,
			discord_kanal_id, gruppe, steuersatz, poster, lieferant, importiert, haupt_id, formular
		) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?,?)`,
		d.ASIN, d.Titel, d.Quellmarkt, d.QuellURL, d.Zielmarkt,
		int64(d.EKCent), d.EKArt, d.EKNotiz, int64(d.VKCent), d.VKQuelle,
		d.Sales, d.SalesQuelle, d.ProvisionProzent, d.ProvisionQuelle,
		int64(d.FBACent), d.FBAQuelle, d.UStModus, int64(d.GewinnCent), d.MargeProzent,
		d.ChannelID, d.ChannelName, d.NachrichtText, d.ChartDatei,
		d.DiscordNachrichtID, d.GepostetAm.UTC().Format(zeitLayout), d.BildKennung,
		d.MaxMenge, d.Status, d.DiscordKanalID, d.Gruppe, d.Steuersatz, d.Poster, d.Lieferant, d.Importiert, d.HauptID, d.Formular)
	if err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}
	id, err := erg.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}

	for _, m := range d.Maerkte {
		// Die drei Pan-EU-Spalten gehen als NULL hinaus, wo es den Vergleich
		// nicht gibt. sql.NullInt64/NullFloat64 statt 0, weil 0 hier eine
		// gerechnete Zahl wäre und nicht "gibt es nicht".
		var fba, gewinn sql.NullInt64
		var marge sql.NullFloat64
		if m.PanEU != nil {
			fba = sql.NullInt64{Int64: int64(m.PanEU.FBACent), Valid: true}
			gewinn = sql.NullInt64{Int64: int64(m.PanEU.GewinnCent), Valid: true}
			marge = sql.NullFloat64{Float64: m.PanEU.MargeProzent, Valid: true}
		}
		if _, err := tx.Exec(`
			INSERT INTO deal_maerkte (
				deal_id, markt, leitmarkt,
				vk_cent, vk_quelle, sales, sales_quelle,
				provision_prozent, provision_quelle, fba_cent, fba_quelle,
				gewinn_cent, marge_prozent,
				paneu_fba_cent, paneu_gewinn_cent, paneu_marge_prozent
			) VALUES (?,?,?, ?,?,?,?, ?,?,?,?, ?,?, ?,?,?)`,
			id, m.Markt, m.Leitmarkt,
			int64(m.VKCent), m.VKQuelle, m.Sales, m.SalesQuelle,
			m.ProvisionProzent, m.ProvisionQuelle, int64(m.FBACent), m.FBAQuelle,
			int64(m.GewinnCent), m.MargeProzent,
			fba, gewinn, marge); err != nil {
			return 0, fmt.Errorf("store: Markt %s nicht speicherbar: %w", m.Markt, err)
		}
	}

	if _, err := tx.Exec(bewertenSQL+` AND id = ?`, id); err != nil {
		return 0, fmt.Errorf("store: Deal nicht bewertbar: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}
	return id, nil
}

// bewertenSQL setzt Gewinn und Marge für die Auswertung: die Pan-EU-Zahlen
// des Leitmarkts, wenn es sie gibt und sie besser sind, sonst die normalen.
const bewertenSQL = `
	UPDATE deals SET
	  pan_eu = EXISTS (SELECT 1 FROM deal_maerkte m WHERE m.deal_id = deals.id AND m.leitmarkt = 1
	                   AND m.paneu_gewinn_cent IS NOT NULL AND m.paneu_gewinn_cent > deals.gewinn_cent),
	  eff_gewinn_cent = COALESCE((SELECT m.paneu_gewinn_cent FROM deal_maerkte m
	                   WHERE m.deal_id = deals.id AND m.leitmarkt = 1
	                   AND m.paneu_gewinn_cent IS NOT NULL AND m.paneu_gewinn_cent > deals.gewinn_cent), gewinn_cent),
	  eff_marge_prozent = COALESCE((SELECT m.paneu_marge_prozent FROM deal_maerkte m
	                   WHERE m.deal_id = deals.id AND m.leitmarkt = 1
	                   AND m.paneu_gewinn_cent IS NOT NULL AND m.paneu_gewinn_cent > deals.gewinn_cent), marge_prozent)
	WHERE 1 = 1`

// dealsBewerten holt die Bewertung für alle Deals nach, bei denen sie
// fehlt. id 0 heißt alle.
func (s *Store) dealsBewerten(id int64) error {
	if id != 0 {
		_, err := s.db.Exec(bewertenSQL+` AND id = ?`, id)
		return err
	}
	_, err := s.db.Exec(bewertenSQL + ` AND eff_gewinn_cent IS NULL`)
	return err
}

const dealSpalten = `
	id, asin, titel, quellmarkt, quell_url, zielmarkt,
	ek_cent, ek_art, ek_notiz, vk_cent, vk_quelle,
	sales, sales_quelle, provision_prozent, provision_quelle,
	fba_cent, fba_quelle, ust_modus, gewinn_cent, marge_prozent,
	channel_id, channel_name, nachricht_text, chart_datei,
	discord_nachricht_id, gepostet_am, bild_kennung, max_menge, status,
	discord_kanal_id, kaeufe, nicht_verfuegbar, reaktionen_am, gruppe, steuersatz,
	COALESCE(eff_gewinn_cent, gewinn_cent), COALESCE(eff_marge_prozent, marge_prozent), pan_eu, poster, lieferant, importiert, haupt_id, formular`

func (s *Store) Deal(id int64) (Deal, error) {
	return scanDeal(s.db.QueryRow(`SELECT `+dealSpalten+` FROM deals WHERE id = ?`, id))
}

// bedingungen baut die WHERE-Klausel und ihre Parameter.
func (f DealFilter) bedingungen() (string, []any) {
	var teile []string
	var args []any

	if s := strings.TrimSpace(f.Suche); s != "" {
		teile = append(teile, `(asin LIKE ? COLLATE NOCASE OR titel LIKE ? COLLATE NOCASE)`)
		muster := "%" + s + "%"
		args = append(args, muster, muster)
	}
	if f.ChannelID != 0 {
		teile = append(teile, `channel_id = ?`)
		args = append(args, f.ChannelID)
	}
	if !f.Von.IsZero() {
		teile = append(teile, `gepostet_am >= ?`)
		args = append(args, f.Von.UTC().Format(zeitLayout))
	}
	if !f.Bis.IsZero() {
		teile = append(teile, `gepostet_am <= ?`)
		args = append(args, f.Bis.UTC().Format(zeitLayout))
	}
	if f.MargeMin != nil {
		teile = append(teile, `COALESCE(eff_marge_prozent, marge_prozent) >= ?`)
		args = append(args, *f.MargeMin)
	}
	if f.MargeMax != nil {
		teile = append(teile, `COALESCE(eff_marge_prozent, marge_prozent) <= ?`)
		args = append(args, *f.MargeMax)
	}
	if f.Poster != "" {
		teile = append(teile, `poster = ?`)
		args = append(args, f.Poster)
	}
	if f.Gruppe != "" {
		teile = append(teile, `gruppe = ?`)
		args = append(args, f.Gruppe)
	}
	switch f.Status {
	case "", "alle":
	case "aktiv":
		teile = append(teile, `status = ''`)
	default:
		teile = append(teile, `status = ?`)
		args = append(args, f.Status)
	}

	if len(teile) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(teile, " AND "), args
}

func (s *Store) Deals(f DealFilter) ([]Deal, error) {
	wo, args := f.bedingungen()
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}

	abfrage := `SELECT ` + dealSpalten + ` FROM deals` + wo +
		` ORDER BY gepostet_am DESC, id DESC LIMIT ? OFFSET ?`
	args = append(args, limit, f.Offset)

	zeilen, err := s.db.Query(abfrage, args...)
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

func (s *Store) DealsAnzahl(f DealFilter) (int, error) {
	wo, args := f.bedingungen()
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM deals`+wo, args...).Scan(&n)
	return n, err
}

// DealStatusSetzen hält fest, was nach dem Posten mit dem Post geschah.
func (s *Store) DealStatusSetzen(id int64, status string) error {
	erg, err := s.db.Exec(`UPDATE deals SET status = ? WHERE id = ?`, status, id)
	if err != nil {
		return fmt.Errorf("store: Status nicht speicherbar: %w", err)
	}
	if n, _ := erg.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DealKanalSetzen merkt sich den Discord-Channel eines Posts.
func (s *Store) DealKanalSetzen(id int64, kanalID string) error {
	_, err := s.db.Exec(`UPDATE deals SET discord_kanal_id = ? WHERE id = ?`, kanalID, id)
	return err
}

// DealReaktionenSetzen hält den Stand der Reaktionen unter einem Post fest.
func (s *Store) DealReaktionenSetzen(id int64, kaeufe, nichtVerfuegbar int, am time.Time) error {
	_, err := s.db.Exec(`
		UPDATE deals SET kaeufe = ?, nicht_verfuegbar = ?, reaktionen_am = ? WHERE id = ?`,
		kaeufe, nichtVerfuegbar, am.UTC().Format(zeitLayout), id)
	return err
}

// DealsFuerAbgleich liefert die Posts, deren Reaktionen sich noch ändern
// können: seit dem Zeitpunkt gepostet, mit bekannter Discord-Nachricht und
// nicht gelöscht. Die jüngsten zuerst, höchstens limit Stück.
func (s *Store) DealsFuerAbgleich(seit time.Time, limit int) ([]Deal, error) {
	zeilen, err := s.db.Query(`SELECT `+dealSpalten+` FROM deals
		WHERE discord_nachricht_id <> '' AND status <> ? AND gepostet_am >= ?
		ORDER BY gepostet_am DESC LIMIT ?`,
		StatusGeloescht, seit.UTC().Format(zeitLayout), limit)
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

// EKNotizen liefert die bisher benutzten Notizen für die Vorschlagsliste im
// Formular — ohne eigene Pflegetabelle.
func (s *Store) EKNotizen() ([]string, error) {
	zeilen, err := s.db.Query(`
		SELECT DISTINCT ek_notiz FROM deals
		WHERE ek_notiz <> '' ORDER BY ek_notiz COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()

	var out []string
	for zeilen.Next() {
		var n string
		if err := zeilen.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, zeilen.Err()
}

func scanDeal(z scanner) (Deal, error) {
	var d Deal
	var ek, vk, fba, gewinn int64
	var gepostet, reaktionenAm string
	var effGewinn int64

	err := z.Scan(
		&d.ID, &d.ASIN, &d.Titel, &d.Quellmarkt, &d.QuellURL, &d.Zielmarkt,
		&ek, &d.EKArt, &d.EKNotiz, &vk, &d.VKQuelle,
		&d.Sales, &d.SalesQuelle, &d.ProvisionProzent, &d.ProvisionQuelle,
		&fba, &d.FBAQuelle, &d.UStModus, &gewinn, &d.MargeProzent,
		&d.ChannelID, &d.ChannelName, &d.NachrichtText, &d.ChartDatei,
		&d.DiscordNachrichtID, &gepostet, &d.BildKennung, &d.MaxMenge, &d.Status,
		&d.DiscordKanalID, &d.Kaeufe, &d.NichtVerfuegbar, &reaktionenAm, &d.Gruppe, &d.Steuersatz,
		&effGewinn, &d.EffMargeProzent, &d.PanEU, &d.Poster, &d.Lieferant, &d.Importiert, &d.HauptID, &d.Formular)
	if err != nil {
		return Deal{}, err
	}

	d.EKCent = money.Cents(ek)
	d.VKCent = money.Cents(vk)
	d.FBACent = money.Cents(fba)
	d.GewinnCent = money.Cents(gewinn)
	d.EffGewinnCent = money.Cents(effGewinn)
	d.GepostetAm, _ = time.Parse(time.RFC3339Nano, gepostet)
	if reaktionenAm != "" {
		d.ReaktionenAm, _ = time.Parse(time.RFC3339Nano, reaktionenAm)
	}
	return d, nil
}

// DealMaerkte liest die Märkte mehrerer Deals in einem Zug.
//
// Eine Abfrage für die ganze Seite statt einer je Zeile: die Historie zeigt
// fünfzig Deals gleichzeitig, und fünfzig Abfragen wären fünfzig Sperren auf
// derselben einen SQLite-Verbindung.
func (s *Store) DealMaerkte(dealIDs []int64) (map[int64][]DealMarkt, error) {
	out := make(map[int64][]DealMarkt, len(dealIDs))
	if len(dealIDs) == 0 {
		return out, nil
	}

	// Bezeichner und Platzhalter lassen sich in SQLite nicht als Liste
	// binden; die Fragezeichen werden darum gezählt und die Werte einzeln
	// übergeben — kein einziger Wert wandert in die Zeichenkette.
	platzhalter := strings.TrimSuffix(strings.Repeat("?,", len(dealIDs)), ",")
	args := make([]any, len(dealIDs))
	for i, id := range dealIDs {
		args[i] = id
	}

	zeilen, err := s.db.Query(`
		SELECT deal_id, markt, leitmarkt,
		       vk_cent, vk_quelle, sales, sales_quelle,
		       provision_prozent, provision_quelle, fba_cent, fba_quelle,
		       gewinn_cent, marge_prozent,
		       paneu_fba_cent, paneu_gewinn_cent, paneu_marge_prozent
		FROM deal_maerkte
		WHERE deal_id IN (`+platzhalter+`)
		ORDER BY deal_id, leitmarkt DESC, rowid`, args...)
	if err != nil {
		return nil, fmt.Errorf("store: Märkte nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	for zeilen.Next() {
		var dealID int64
		var m DealMarkt
		var vk, fba, gewinn int64
		var pFBA, pGewinn sql.NullInt64
		var pMarge sql.NullFloat64

		if err := zeilen.Scan(&dealID, &m.Markt, &m.Leitmarkt,
			&vk, &m.VKQuelle, &m.Sales, &m.SalesQuelle,
			&m.ProvisionProzent, &m.ProvisionQuelle, &fba, &m.FBAQuelle,
			&gewinn, &m.MargeProzent,
			&pFBA, &pGewinn, &pMarge); err != nil {
			return nil, fmt.Errorf("store: Märkte nicht lesbar: %w", err)
		}
		m.VKCent, m.FBACent, m.GewinnCent = money.Cents(vk), money.Cents(fba), money.Cents(gewinn)
		// Nur wenn alle drei dastehen, gab es den Vergleich. Zwei von drei
		// wären eine halbe Zahl, und die ist schlimmer als keine.
		if pFBA.Valid && pGewinn.Valid && pMarge.Valid {
			m.PanEU = &DealMarktPanEU{
				FBACent:      money.Cents(pFBA.Int64),
				GewinnCent:   money.Cents(pGewinn.Int64),
				MargeProzent: pMarge.Float64,
			}
		}
		out[dealID] = append(out[dealID], m)
	}
	return out, zeilen.Err()
}

// DiscordNachrichtIDs sind alle Discord-Nachrichten, zu denen es schon
// einen Deal gibt — der Import überspringt sie.
func (s *Store) DiscordNachrichtIDs() (map[string]bool, error) {
	zeilen, err := s.db.Query(`SELECT discord_nachricht_id FROM deals WHERE discord_nachricht_id <> ''`)
	if err != nil {
		return nil, fmt.Errorf("store: Deals nicht lesbar: %w", err)
	}
	defer zeilen.Close()
	out := map[string]bool{}
	for zeilen.Next() {
		var id string
		if err := zeilen.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, zeilen.Err()
}

var mengenMuster = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(\d{1,4})\s*er[\s-]*cart`),
	regexp.MustCompile(`(?i)cart[\s-]*(?:limit)?[\s:=-]*(\d{1,4})\b`),
	regexp.MustCompile(`(?i)max\.?\s*(\d{1,4})\s*(?:stk|stück|x|pro|/)`),
	regexp.MustCompile(`(?i)limit[\s:=-]*(\d{1,4})\b`),
}

// MengeAusNotiz liest ein Cart-Limit aus der EK-Notiz: "3er cart",
// "Cart 3", "Cart-Limit: 3", "max. 3 Stück". 0, wenn keins drinsteht.
func MengeAusNotiz(notiz string) int {
	for _, m := range mengenMuster {
		if t := m.FindStringSubmatch(notiz); t != nil {
			if n, err := strconv.Atoi(t[1]); err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

// mengenAusNotizen holt das Cart-Limit aus der EK-Notiz bei allen Deals
// nach, die noch keins haben.
func (s *Store) mengenAusNotizen() error {
	zeilen, err := s.db.Query(`SELECT id, ek_notiz FROM deals WHERE max_menge = 0 AND ek_notiz <> ''`)
	if err != nil {
		return err
	}
	neu := map[int64]int{}
	for zeilen.Next() {
		var id int64
		var notiz string
		if err := zeilen.Scan(&id, &notiz); err != nil {
			zeilen.Close()
			return err
		}
		if n := MengeAusNotiz(notiz); n > 0 {
			neu[id] = n
		}
	}
	zeilen.Close()
	for id, n := range neu {
		if _, err := s.db.Exec(`UPDATE deals SET max_menge = ? WHERE id = ?`, n, id); err != nil {
			return err
		}
	}
	return nil
}

// Eingelesen ist ein aus Discord eingelesener Deal mit seinem Posttext.
type Eingelesen struct {
	ID   int64
	Text string
}

// EingeleseneDeals liefert alle eingelesenen Deals — zum Nachprüfen, wenn
// das Einlesen besser geworden ist.
func (s *Store) EingeleseneDeals() ([]Eingelesen, error) {
	zeilen, err := s.db.Query(`SELECT id, nachricht_text FROM deals WHERE importiert = 1`)
	if err != nil {
		return nil, fmt.Errorf("store: Deals nicht lesbar: %w", err)
	}
	defer zeilen.Close()
	var out []Eingelesen
	for zeilen.Next() {
		var e Eingelesen
		if err := zeilen.Scan(&e.ID, &e.Text); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, zeilen.Err()
}

// Nachgelesen sind die Zahlen eines neu gelesenen Posts.
type Nachgelesen struct {
	Titel, ASIN    string
	EKCent, VKCent money.Cents
	GewinnCent     money.Cents
	MargeProzent   float64
	PanEU          *DealMarktPanEU
}

// EingelesenenKorrigieren ersetzt Titel, ASIN und Zahlen eines
// eingelesenen Deals und bewertet ihn neu. Nur Deals mit importiert = 1 —
// gerechnete Deals des Tools bleiben unberührt.
func (s *Store) EingelesenenKorrigieren(id int64, n Nachgelesen) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE deals SET titel = ?, asin = ?, ek_cent = ?, vk_cent = ?, gewinn_cent = ?, marge_prozent = ?
		WHERE id = ? AND importiert = 1`,
		n.Titel, n.ASIN, int64(n.EKCent), int64(n.VKCent), int64(n.GewinnCent), n.MargeProzent, id); err != nil {
		return err
	}
	var pg sql.NullInt64
	var pm sql.NullFloat64
	if n.PanEU != nil {
		pg = sql.NullInt64{Int64: int64(n.PanEU.GewinnCent), Valid: true}
		pm = sql.NullFloat64{Float64: n.PanEU.MargeProzent, Valid: true}
	}
	if _, err := tx.Exec(`UPDATE deal_maerkte SET vk_cent = ?, gewinn_cent = ?, marge_prozent = ?,
		paneu_gewinn_cent = ?, paneu_marge_prozent = ? WHERE deal_id = ? AND leitmarkt = 1`,
		int64(n.VKCent), int64(n.GewinnCent), n.MargeProzent, pg, pm, id); err != nil {
		return err
	}
	if _, err := tx.Exec(bewertenSQL+` AND id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// DealTextSetzen hält den geänderten Posttext fest — nach dem Bearbeiten
// in Discord. quellURL ersetzt den gespeicherten Einkaufslink, damit die
// Historie den berichtigten Link zeigt.
func (s *Store) DealTextSetzen(id int64, text, quellURL string) error {
	_, err := s.db.Exec(`UPDATE deals SET nachricht_text = ?, quell_url = ? WHERE id = ?`, text, quellURL, id)
	if err != nil {
		return fmt.Errorf("store: Deal nicht änderbar: %w", err)
	}
	return nil
}
