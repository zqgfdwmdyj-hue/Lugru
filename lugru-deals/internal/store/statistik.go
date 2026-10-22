package store

import (
	"database/sql"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// StatistikZeile ist eine Gruppe von Deals mit ihren Summen.
//
// Gewinn und Marge sind die des Leitmarkts, dieselben Zahlen, die in der
// Historienzeile stehen. Es ist der Gewinn, den die Posts versprochen haben,
// nicht der, der tatsächlich gemacht wurde: was gekauft und verkauft wurde,
// weiß das Programm nicht.
type StatistikZeile struct {
	Gruppe       string
	Anzahl       int
	Ausverkauft  int
	Gewinn       money.Cents
	MargeSchnitt float64

	// Kaeufe ist die Summe der ✅-Reaktionen, MitKauf die Zahl der Deals,
	// unter denen mindestens eine steht.
	Kaeufe  int
	MitKauf int

	// GewinnKaeufe ist der Gewinn je Deal mal seine ✅ — grob, was die
	// Käufer zusammen verdient haben, bei einem Stück je Kauf.
	GewinnKaeufe money.Cents
}

// Statistik fasst die Deals im Zeitraum zusammen: insgesamt, je Monat, je
// Channel und je Zielmarkt (Leitmarkt). Gelöschte Posts zählen nicht mit —
// sie sind aus Discord verschwunden, meist weil sie ein Fehler waren.
//
// Von und Bis dürfen der Nullwert sein und begrenzen dann nicht.
type Statistik struct {
	Gesamt  StatistikZeile
	Monate  []StatistikZeile
	Channel []StatistikZeile
	Maerkte []StatistikZeile

	// Poster ist die Aufteilung nach dem, der gepostet hat ("" = unbekannt).
	Poster []StatistikZeile

	// Gruppen sind die Gruppen der Channels (etwa je Discord-Server).
	// Gruppe "" steht für Channels ohne Gruppe.
	Gruppen []StatistikZeile

	// Reaktionen ist die Übersicht, wie auf die Posts reagiert wurde.
	Reaktionen ReaktionsUebersicht

	// Quellen sind die Einkaufsquellen: der Shop bei einem Fremdshop, sonst
	// "amazon.<land>".
	Quellen []StatistikZeile

	// Dauerbrenner sind Artikel, die mehr als einmal gepostet wurden.
	Dauerbrenner []Dauerbrenner

	// TopKaeufe sind die Deals mit den meisten ✅, höchstens zehn.
	TopKaeufe []Deal

	// TopGewinn sind die Deals mit dem höchsten Gewinn, höchstens fünf.
	TopGewinn []Deal

	// Erster und Letzter sind der früheste und der jüngste Post im
	// Zeitraum; Nullwert, wenn es keinen gibt.
	Erster, Letzter time.Time

	// Menge ist der Gewinn mit Cart-Limit (siehe mengenGewinn).
	Menge MengenGewinn
}

// MengenGewinn ist der Gewinn, wenn man von jedem Deal so viel kauft, wie
// das Cart-Limit erlaubt — ohne Cart-Limit die Standard-Stückzahl. B2B-Deals
// bleiben draußen: dort gehen Mengen in die Tausende, und das Ergebnis
// hätte mit dem, was ein Mitglied kauft, nichts mehr zu tun. B2B ist, was
// in einem B2B-Channel gepostet wurde (siehe B2BChannels).
type MengenGewinn struct {
	Gewinn   money.Cents
	Deals    int // gezählte Deals (ohne B2B)
	MitLimit int // davon mit Cart-Limit
	B2B      int // weggelassene B2B-Deals
	Standard int // Stück je Deal ohne Cart-Limit
	// B2BChannels sind die Namen der Channels, deren Deals als B2B gelten.
	B2BChannels []string
}

// Dauerbrenner ist ein Artikel, der öfter gepostet wurde.
type Dauerbrenner struct {
	ASIN  string
	Titel string
	// LetzterDeal ist der jüngste Post des Artikels — von ihm aus wird
	// erneut gepostet.
	LetzterDeal  int64
	Anzahl       int
	Kaeufe       int
	MargeSchnitt float64
	ZuletztAm    time.Time
}

// Statistik fasst zusammen; gruppe leer heißt alle Gruppen.
//
// Ein Deal, der in mehrere Channels ging, ist für alle Gruppen zusammen nur
// ein Deal: gelesen wird dann aus deals_verbund, wo die weiteren Posts in
// ihrem Hauptpost aufgehen (siehe verbundAnlegen). Je Gruppe zählt jeder
// Post für sich — dort steht er ja.
//
// wo beginnt darum mit der Tabelle: jede Abfrage hier lautet
// "FROM "+wo.
func (s *Store) Statistik(von, bis time.Time, gruppe string) (Statistik, error) {
	tabelle := `deals_verbund`
	if gruppe != "" {
		tabelle = `deals`
	}
	wo := tabelle + ` WHERE status <> '` + StatusGeloescht + `'`
	var args []any
	if gruppe != "" {
		wo += ` AND gruppe = ?`
		args = append(args, gruppe)
	}
	if !von.IsZero() {
		wo += ` AND gepostet_am >= ?`
		args = append(args, von.UTC().Format(zeitLayout))
	}
	if !bis.IsZero() {
		wo += ` AND gepostet_am <= ?`
		args = append(args, bis.UTC().Format(zeitLayout))
	}

	var st Statistik
	gesamt, err := s.statistikGruppen(`'gesamt'`, wo, args)
	if err != nil {
		return st, err
	}
	if len(gesamt) > 0 {
		st.Gesamt = gesamt[0]
	}
	// Der Monat aus dem UTC-Zeitstempel: an einem Monatsende kurz vor
	// Mitternacht fällt ein Deal damit höchstens eine Stunde früher in den
	// nächsten Monat. Für einen Rückblick genau genug.
	if st.Monate, err = s.statistikGruppen(`substr(gepostet_am, 1, 7)`, wo, args); err != nil {
		return st, err
	}
	if st.Channel, err = s.statistikGruppen(`channel_name`, wo, args); err != nil {
		return st, err
	}
	if st.Maerkte, err = s.statistikGruppen(`zielmarkt`, wo, args); err != nil {
		return st, err
	}
	if st.Poster, err = s.statistikGruppen(`poster`, wo, args); err != nil {
		return st, err
	}
	if st.Gruppen, err = s.statistikGruppen(`gruppe`, wo, args); err != nil {
		return st, err
	}
	if st.Reaktionen, err = s.reaktionsUebersicht(wo, args); err != nil {
		return st, err
	}
	if st.Quellen, err = s.statistikQuellen(wo, args); err != nil {
		return st, err
	}
	if st.Dauerbrenner, err = s.dauerbrenner(wo, args); err != nil {
		return st, err
	}
	if st.TopKaeufe, err = s.topKaeufe(wo, args); err != nil {
		return st, err
	}
	if st.TopGewinn, err = s.dealsNach(wo, args,
		` AND COALESCE(eff_gewinn_cent, gewinn_cent) > 0 ORDER BY COALESCE(eff_gewinn_cent, gewinn_cent) DESC LIMIT 5`); err != nil {
		return st, err
	}
	if st.Menge, err = s.mengenGewinn(wo, args); err != nil {
		return st, err
	}
	var erster, letzter string
	if err := s.db.QueryRow(`SELECT COALESCE(MIN(gepostet_am), ''), COALESCE(MAX(gepostet_am), '') FROM `+wo, args...).
		Scan(&erster, &letzter); err != nil {
		return st, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
	}
	st.Erster, _ = time.Parse(time.RFC3339Nano, erster)
	st.Letzter, _ = time.Parse(time.RFC3339Nano, letzter)
	return st, nil
}

// statistikQuellen gruppiert nach Einkaufsquelle. Der Shop steckt bei einem
// Fremdshop im Einkaufslink und wird darum hier in Go und nicht in SQL
// herausgelöst.
func (s *Store) statistikQuellen(wo string, args []any) ([]StatistikZeile, error) {
	zeilen, err := s.db.Query(`
		SELECT quellmarkt, quell_url, lieferant, status, COALESCE(eff_gewinn_cent, gewinn_cent),
		       COALESCE(eff_marge_prozent, marge_prozent), kaeufe
		FROM `+wo, args...)
	if err != nil {
		return nil, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	gruppen := map[string]*StatistikZeile{}
	margen := map[string]float64{}
	var reihenfolge []string
	for zeilen.Next() {
		var markt, link, lieferant, status string
		var gewinn int64
		var marge float64
		var kaeufe int
		if err := zeilen.Scan(&markt, &link, &lieferant, &status, &gewinn, &marge, &kaeufe); err != nil {
			return nil, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
		}
		name := einkaufsquelle(markt, link)
		if lieferant != "" {
			name = lieferant
		}
		g, da := gruppen[name]
		if !da {
			g = &StatistikZeile{Gruppe: name}
			gruppen[name] = g
			reihenfolge = append(reihenfolge, name)
		}
		g.Anzahl++
		g.Gewinn += money.Cents(gewinn)
		margen[name] += marge
		g.Kaeufe += kaeufe
		if kaeufe > 0 {
			g.MitKauf++
		}
		if status == StatusAusverkauft {
			g.Ausverkauft++
		}
	}
	if err := zeilen.Err(); err != nil {
		return nil, err
	}

	out := make([]StatistikZeile, 0, len(gruppen))
	for _, name := range reihenfolge {
		g := gruppen[name]
		g.MargeSchnitt = margen[name] / float64(g.Anzahl)
		out = append(out, *g)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Anzahl != out[j].Anzahl {
			return out[i].Anzahl > out[j].Anzahl
		}
		return out[i].Gruppe < out[j].Gruppe
	})
	return out, nil
}

// einkaufsquelle benennt, wo eingekauft wurde: der Host eines Fremdshops
// ohne "www.", sonst "amazon.<land>".
func einkaufsquelle(markt, link string) string {
	if link != "" {
		if u, err := url.Parse(link); err == nil && u.Hostname() != "" {
			return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
		}
	}
	return "amazon." + strings.ToLower(markt)
}

// dauerbrenner sind Artikel mit mehr als einem Post. SQLite liefert bei
// MAX() in einer Gruppe die übrigen Spalten aus genau der Zeile mit dem
// Höchstwert — Titel und ID stammen damit vom jüngsten Post.
func (s *Store) dauerbrenner(wo string, args []any) ([]Dauerbrenner, error) {
	zeilen, err := s.db.Query(`
		SELECT asin, titel, id, MAX(gepostet_am), COUNT(*), SUM(kaeufe), AVG(COALESCE(eff_marge_prozent, marge_prozent))
		FROM `+wo+` AND asin <> ''
		GROUP BY asin HAVING COUNT(*) > 1
		ORDER BY COUNT(*) DESC, SUM(kaeufe) DESC, MAX(gepostet_am) DESC
		LIMIT 20`, args...)
	if err != nil {
		return nil, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	var out []Dauerbrenner
	for zeilen.Next() {
		var d Dauerbrenner
		var am string
		if err := zeilen.Scan(&d.ASIN, &d.Titel, &d.LetzterDeal, &am, &d.Anzahl, &d.Kaeufe, &d.MargeSchnitt); err != nil {
			return nil, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
		}
		d.ZuletztAm, _ = time.Parse(time.RFC3339Nano, am)
		out = append(out, d)
	}
	return out, zeilen.Err()
}

func (s *Store) topKaeufe(wo string, args []any) ([]Deal, error) {
	return s.dealsNach(wo, args, ` AND kaeufe > 0 ORDER BY kaeufe DESC, gepostet_am DESC LIMIT 10`)
}

// dealsNach liest Deals im Zeitraum; rest ist eine feste Bedingung samt
// Sortierung aus diesem Paket, nie ein Wert von außen.
func (s *Store) dealsNach(wo string, args []any, rest string) ([]Deal, error) {
	zeilen, err := s.db.Query(`SELECT `+dealSpalten+` FROM `+wo+rest, args...)
	if err != nil {
		return nil, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
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

// statistikGruppen gruppiert nach einem Ausdruck. Der Ausdruck ist
// ausschließlich eine der Konstanten aus Statistik, nie ein Wert von außen.
//
// Der Alias heißt bewusst nicht "gruppe": so heißt eine Spalte von deals,
// und SQLite gruppierte dann nach der Spalte statt nach dem Ausdruck.
func (s *Store) statistikGruppen(ausdruck, wo string, args []any) ([]StatistikZeile, error) {
	ordnung := `anzahl DESC, schluessel`
	if ausdruck == `substr(gepostet_am, 1, 7)` {
		ordnung = `schluessel DESC`
	}
	zeilen, err := s.db.Query(`
		SELECT `+ausdruck+` AS schluessel, COUNT(*) AS anzahl,
		       SUM(CASE WHEN status = '`+StatusAusverkauft+`' THEN 1 ELSE 0 END),
		       COALESCE(SUM(COALESCE(eff_gewinn_cent, gewinn_cent)), 0),
		       COALESCE(AVG(COALESCE(eff_marge_prozent, marge_prozent)), 0),
		       COALESCE(SUM(kaeufe), 0), SUM(CASE WHEN kaeufe > 0 THEN 1 ELSE 0 END),
		       COALESCE(SUM(COALESCE(eff_gewinn_cent, gewinn_cent) * kaeufe), 0)
		FROM `+wo+`
		GROUP BY schluessel HAVING COUNT(*) > 0
		ORDER BY `+ordnung, args...)
	if err != nil {
		return nil, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	var out []StatistikZeile
	for zeilen.Next() {
		var z StatistikZeile
		var gewinn, gewinnKaeufe int64
		if err := zeilen.Scan(&z.Gruppe, &z.Anzahl, &z.Ausverkauft, &gewinn, &z.MargeSchnitt,
			&z.Kaeufe, &z.MitKauf, &gewinnKaeufe); err != nil {
			return nil, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
		}
		z.Gewinn = money.Cents(gewinn)
		z.GewinnKaeufe = money.Cents(gewinnKaeufe)
		out = append(out, z)
	}
	return out, zeilen.Err()
}

// ReaktionsUebersicht zählt, wie auf die Posts reagiert wurde. Gezählt
// werden nur Posts, deren Reaktionen schon einmal abgerufen wurden.
type ReaktionsUebersicht struct {
	Abgerufen    int // Posts mit abgerufenen Reaktionen
	NichtAbgeruf int // Posts, deren Reaktionen noch nie abgerufen wurden

	MitKauf      int // mindestens ein ✅
	NurWeg       int // kein ✅, aber mindestens ein ❌
	OhneReaktion int // weder ✅ noch ❌

	Kaeufe int // Summe aller ✅
	Weg    int // Summe aller ❌

	// Liste sind die jüngsten abgerufenen Posts mit ihren Reaktionen,
	// höchstens 50.
	Liste []Deal
}

func (s *Store) reaktionsUebersicht(wo string, args []any) (ReaktionsUebersicht, error) {
	var r ReaktionsUebersicht
	err := s.db.QueryRow(`
		SELECT
		  COALESCE(SUM(CASE WHEN reaktionen_am <> '' THEN 1 ELSE 0 END), 0),
		  COALESCE(SUM(CASE WHEN reaktionen_am = '' THEN 1 ELSE 0 END), 0),
		  COALESCE(SUM(CASE WHEN reaktionen_am <> '' AND kaeufe > 0 THEN 1 ELSE 0 END), 0),
		  COALESCE(SUM(CASE WHEN reaktionen_am <> '' AND kaeufe = 0 AND nicht_verfuegbar > 0 THEN 1 ELSE 0 END), 0),
		  COALESCE(SUM(CASE WHEN reaktionen_am <> '' AND kaeufe = 0 AND nicht_verfuegbar = 0 THEN 1 ELSE 0 END), 0),
		  COALESCE(SUM(kaeufe), 0), COALESCE(SUM(nicht_verfuegbar), 0)
		FROM `+wo, args...).Scan(&r.Abgerufen, &r.NichtAbgeruf, &r.MitKauf, &r.NurWeg,
		&r.OhneReaktion, &r.Kaeufe, &r.Weg)
	if err != nil {
		return r, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
	}

	zeilen, err := s.db.Query(`SELECT `+dealSpalten+` FROM `+wo+
		` AND reaktionen_am <> '' ORDER BY gepostet_am DESC LIMIT 50`, args...)
	if err != nil {
		return r, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
	}
	defer zeilen.Close()
	for zeilen.Next() {
		d, err := scanDeal(zeilen)
		if err != nil {
			return r, err
		}
		r.Liste = append(r.Liste, d)
	}
	return r, zeilen.Err()
}

// B2BChannels liefert die Channels, deren Deals als B2B gelten: die in den
// Einstellungen angehakten, oder — solange dort nichts gespeichert ist —
// jeder Channel mit "b2b" im Namen.
func (s *Store) B2BChannels() ([]Channel, error) {
	alle, err := s.Channels()
	if err != nil {
		return nil, err
	}
	wert := s.Einstellung(SchluesselB2BChannels)
	gewaehlt := map[string]bool{}
	for _, id := range strings.Split(wert, ",") {
		gewaehlt[strings.TrimSpace(id)] = true
	}
	var out []Channel
	for _, c := range alle {
		if wert == "auto" && strings.Contains(strings.ToLower(c.Name), "b2b") ||
			gewaehlt[strconv.FormatInt(c.ID, 10)] {
			out = append(out, c)
		}
	}
	return out, nil
}

// b2bBedingung ist die SQL-Bedingung "Deal ist B2B": gepostet in einem der
// B2B-Channels.
func b2bBedingung(channels []Channel) (string, []any) {
	if len(channels) == 0 {
		return `(0)`, nil
	}
	platz := make([]string, len(channels))
	args := make([]any, len(channels))
	for i, c := range channels {
		platz[i], args[i] = "?", c.ID
	}
	return `(channel_id IN (` + strings.Join(platz, ",") + `))`, args
}

func (s *Store) mengenGewinn(wo string, args []any) (MengenGewinn, error) {
	m := MengenGewinn{Standard: s.EinstellungZahl(SchluesselStueckStandard)}
	if m.Standard < 1 {
		m.Standard = 1
	}
	b2bChannels, err := s.B2BChannels()
	if err != nil {
		return m, fmt.Errorf("store: Channels nicht lesbar: %w", err)
	}
	for _, c := range b2bChannels {
		m.B2BChannels = append(m.B2BChannels, c.Name)
	}
	b2b, b2bArgs := b2bBedingung(b2bChannels)
	// Die Parameter stehen in der Reihenfolge, in der ihre Platzhalter im
	// Text vorkommen: B2B-Bedingung, Stückzahl, B2B-Bedingung zweimal, dann
	// der Filter aus wo.
	var alle []any
	alle = append(alle, b2bArgs...)
	alle = append(alle, m.Standard)
	alle = append(alle, b2bArgs...)
	alle = append(alle, b2bArgs...)
	alle = append(alle, args...)
	var gewinn int64
	var gesamt int
	if err := s.db.QueryRow(`
		SELECT COALESCE(SUM(CASE WHEN NOT `+b2b+` THEN COALESCE(eff_gewinn_cent, gewinn_cent) *
		         (CASE WHEN max_menge > 0 THEN max_menge ELSE ? END) ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN NOT `+b2b+` THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN NOT `+b2b+` AND max_menge > 0 THEN 1 ELSE 0 END), 0),
		       COUNT(*)
		FROM `+wo, alle...).Scan(&gewinn, &m.Deals, &m.MitLimit, &gesamt); err != nil {
		return m, fmt.Errorf("store: Statistik nicht lesbar: %w", err)
	}
	m.Gewinn = money.Cents(gewinn)
	m.B2B = gesamt - m.Deals
	return m, nil
}

// verbundAnlegen legt die Sicht deals_verbund neu an: alle Hauptposts
// (haupt_id = 0) mit allen Spalten von deals, die Reaktionen ihrer weiteren
// Posts dazugezählt. Die Spalten werden aus der Tabelle gelesen, damit die
// Sicht jede spätere Spalte mitführt; darum läuft das nach den Ergänzungen
// bei jedem Start.
func (s *Store) verbundAnlegen() error {
	zeilen, err := s.db.Query(`PRAGMA table_info(deals)`)
	if err != nil {
		return err
	}
	var spalten []string
	for zeilen.Next() {
		var cid, notnull, pk int
		var name, typ string
		var vorgabe sql.NullString
		if err := zeilen.Scan(&cid, &name, &typ, &notnull, &vorgabe, &pk); err != nil {
			zeilen.Close()
			return err
		}
		switch name {
		case "kaeufe", "nicht_verfuegbar":
			spalten = append(spalten, `d.`+name+` + COALESCE((SELECT SUM(w.`+name+`) FROM deals w
				WHERE w.haupt_id = d.id AND w.status <> '`+StatusGeloescht+`'), 0) AS `+name)
		default:
			spalten = append(spalten, `d.`+name)
		}
	}
	zeilen.Close()
	// Ohne Index durchsucht jede Zeile der Sicht die ganze Tabelle nach
	// ihren weiteren Posts — bei ein paar tausend Deals hängt die Statistik
	// dann minutenlang.
	if _, err := s.db.Exec(`CREATE INDEX IF NOT EXISTS deals_haupt_id ON deals(haupt_id)`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DROP VIEW IF EXISTS deals_verbund`); err != nil {
		return err
	}
	_, err = s.db.Exec(`CREATE VIEW deals_verbund AS SELECT ` + strings.Join(spalten, ", ") +
		` FROM deals d WHERE d.haupt_id = 0`)
	return err
}
