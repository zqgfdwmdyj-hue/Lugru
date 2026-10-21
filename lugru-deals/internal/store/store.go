// Package store hält Channels, Deals, Einstellungen und den Keepa-Cache in
// einer SQLite-Datei neben dem Programm.
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // reines Go, damit CGO_ENABLED=0 möglich bleibt
)

type Store struct {
	db          *sql.DB
	chartOrdner string
}

// schema wird bei jedem Start ausgeführt. Alle Anweisungen sind
// wiederholbar, damit kein Migrationszähler nötig ist.
const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    webhook_url TEXT    NOT NULL,
    mention_typ TEXT    NOT NULL DEFAULT 'keine',
    rollen_id   TEXT    NOT NULL DEFAULT '',
    defekt      INTEGER NOT NULL DEFAULT 0,
    angelegt_am TEXT    NOT NULL,
    gruppe      TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS deals (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    asin                 TEXT    NOT NULL,
    titel                TEXT    NOT NULL,
    quellmarkt           TEXT    NOT NULL,
    quell_url            TEXT    NOT NULL DEFAULT '',
    zielmarkt            TEXT    NOT NULL,
    ek_cent              INTEGER NOT NULL,
    ek_notiz             TEXT    NOT NULL DEFAULT '',
    ek_art               TEXT    NOT NULL DEFAULT 'brutto',
    vk_cent              INTEGER NOT NULL,
    vk_quelle            TEXT    NOT NULL DEFAULT '',
    sales                INTEGER NOT NULL DEFAULT 0,
    sales_quelle         TEXT    NOT NULL DEFAULT '',
    provision_prozent    REAL    NOT NULL DEFAULT 0,
    provision_quelle     TEXT    NOT NULL DEFAULT '',
    fba_cent             INTEGER NOT NULL DEFAULT 0,
    fba_quelle           TEXT    NOT NULL DEFAULT '',
    ust_modus            TEXT    NOT NULL DEFAULT 'netto',
    gewinn_cent          INTEGER NOT NULL DEFAULT 0,
    marge_prozent        REAL    NOT NULL DEFAULT 0,
    channel_id           INTEGER NOT NULL,
    channel_name         TEXT    NOT NULL,
    nachricht_text       TEXT    NOT NULL,
    chart_datei          TEXT    NOT NULL DEFAULT '',
    bild_kennung         TEXT    NOT NULL DEFAULT '',
    discord_nachricht_id TEXT    NOT NULL DEFAULT '',
    gepostet_am          TEXT    NOT NULL,
    max_menge            INTEGER NOT NULL DEFAULT 0,
    status               TEXT    NOT NULL DEFAULT '',
    discord_kanal_id     TEXT    NOT NULL DEFAULT '',
    kaeufe               INTEGER NOT NULL DEFAULT 0,
    nicht_verfuegbar     INTEGER NOT NULL DEFAULT 0,
    reaktionen_am        TEXT    NOT NULL DEFAULT '',
    gruppe               TEXT    NOT NULL DEFAULT '',
    steuersatz           TEXT    NOT NULL DEFAULT '',
    eff_gewinn_cent      INTEGER,
    eff_marge_prozent    REAL,
    pan_eu               INTEGER NOT NULL DEFAULT 0,
    poster               TEXT    NOT NULL DEFAULT '',
    lieferant            TEXT    NOT NULL DEFAULT '',
    importiert           INTEGER NOT NULL DEFAULT 0,
    haupt_id             INTEGER NOT NULL DEFAULT 0,
    formular             TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_deals_asin      ON deals(asin);
CREATE INDEX IF NOT EXISTS idx_deals_gepostet  ON deals(gepostet_am DESC);

-- Die Zielmärkte eines Deals. Die deals-Zeile selbst trägt weiterhin die
-- Zahlen des Leitmarkts — alte Zeilen und jede bestehende Auswertung bleiben
-- damit vergleichbar, und ein Deal mit einem Markt sieht dort aus wie immer.
--
-- Eine Zeile je Markt in deals wäre die andere Möglichkeit gewesen und die
-- falsche: derselbe Nachrichtentext stünde viermal in der Datenbank und
-- derselbe Artikel viermal in der Historienliste, obwohl es ein Post ist.
--
-- Die drei paneu-Spalten sind NULL, wo es den Vergleich nicht gibt — beim
-- Ziel im Lagerland etwa gibt es keinen zweiten Versandweg. Eine 0 stünde
-- dort als Aussage da, die niemand gerechnet hat.
--
-- ON DELETE CASCADE wie bei fba_gebuehren: eine gelöschte Deal-Zeile darf
-- keine Marktzeilen hinterlassen, die auf nichts mehr zeigen.
CREATE TABLE IF NOT EXISTS deal_maerkte (
    deal_id             INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    markt               TEXT    NOT NULL,
    leitmarkt           INTEGER NOT NULL DEFAULT 0,
    vk_cent             INTEGER NOT NULL DEFAULT 0,
    vk_quelle           TEXT    NOT NULL DEFAULT '',
    sales               INTEGER NOT NULL DEFAULT 0,
    sales_quelle        TEXT    NOT NULL DEFAULT '',
    provision_prozent   REAL    NOT NULL DEFAULT 0,
    provision_quelle    TEXT    NOT NULL DEFAULT '',
    fba_cent            INTEGER NOT NULL DEFAULT 0,
    fba_quelle          TEXT    NOT NULL DEFAULT '',
    gewinn_cent         INTEGER NOT NULL DEFAULT 0,
    marge_prozent       REAL    NOT NULL DEFAULT 0,
    paneu_fba_cent      INTEGER,
    paneu_gewinn_cent   INTEGER,
    paneu_marge_prozent REAL,
    PRIMARY KEY (deal_id, markt)
);

CREATE TABLE IF NOT EXISTS affiliate_tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    tag         TEXT    NOT NULL,
    markt       TEXT    NOT NULL,
    standard    INTEGER NOT NULL DEFAULT 0,
    angelegt_am TEXT    NOT NULL
);

-- Höchstens ein Standard je Markt, zugesagt von der Datenbank statt nur
-- gehofft im Code. TagStandardSetzen räumt darum erst ab und setzt dann;
-- andersherum stünden kurzzeitig zwei Standards da und der Index schlüge zu.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_standard
    ON affiliate_tags(markt) WHERE standard = 1;

-- Die Tarifstaffel: Zeilen sind Größenklassen, Spalten sind Märkte — so wie
-- Amazons Tarifübersicht selbst gebaut ist. Die Grenzen einer Klasse stehen
-- darum genau einmal da und nicht je Markt erneut; sonst gäbe es mehrere
-- Antworten auf die Frage, was ein Standardpaket ist.
CREATE TABLE IF NOT EXISTS fba_klassen (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sortierung    INTEGER NOT NULL DEFAULT 0,
    bezeichnung   TEXT    NOT NULL,
    max_laenge_mm INTEGER NOT NULL DEFAULT 0,
    max_breite_mm INTEGER NOT NULL DEFAULT 0,
    max_hoehe_mm  INTEGER NOT NULL DEFAULT 0,
    max_gewicht_g INTEGER NOT NULL DEFAULT 0
);

-- weg trennt die beiden Tarifübersichten, die Amazon führt: "lokal" für Ware,
-- die im Zielland liegt, "efn" für Ware, die von anderswo kommt. Beide stehen
-- nebeneinander, weil sich das Lagerland ändern kann und dann die jeweils
-- andere Spalte gilt — nicht ein anderer Wert in derselben.
--
-- frei_gewicht_g und cent_pro_kg bilden die zweite Zeile ab, die die Übersicht
-- für die Übergrößen führt: "0,36 € je zusätzlichem Kilogramm" über einem
-- Grundgewicht. Beide auf 0 heißt reiner Festbetrag.
--
-- ON DELETE CASCADE statt Aufräumen im Code: eine gelöschte Klasse darf keine
-- Gebühren hinterlassen, die auf nichts mehr zeigen. PRAGMA foreign_keys = ON
-- steht oben.
CREATE TABLE IF NOT EXISTS fba_gebuehren (
    klasse_id      INTEGER NOT NULL REFERENCES fba_klassen(id) ON DELETE CASCADE,
    markt          TEXT    NOT NULL,
    weg            TEXT    NOT NULL,
    cent           INTEGER NOT NULL,
    frei_gewicht_g INTEGER NOT NULL DEFAULT 0,
    cent_pro_kg    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (klasse_id, markt, weg)
);

-- Halb fertige Deals. formular ist das ganze Funnel-Formular, so wie der
-- Browser es sendet (application/x-www-form-urlencoded): der Funnel trägt
-- seinen Zustand ohnehin vollständig im Formular, und genau das wird hier
-- zur Seite gelegt. titel und asin stehen daneben nur für die Liste.
CREATE TABLE IF NOT EXISTS entwuerfe (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    asin            TEXT    NOT NULL DEFAULT '',
    titel           TEXT    NOT NULL DEFAULT '',
    schritt         INTEGER NOT NULL DEFAULT 1,
    formular        TEXT    NOT NULL,
    gespeichert_am  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS keepa_cache (
    asin         TEXT    NOT NULL,
    domain_id    INTEGER NOT NULL,
    geholt_am    TEXT    NOT NULL,
    antwort_json BLOB    NOT NULL,
    PRIMARY KEY (asin, domain_id)
);

-- Der Shop-Monitor (siehe internal/web/monitor.go): Produkte, die bei
-- billiger.de beobachtet werden, die Regeln, nach denen ein Treffer in
-- welchen Channel geht, und das Protokoll der Treffer.
--
-- Je Produkt steht der zuletzt bewertete Einkauf (bewertet_shop,
-- bewertet_cent) dabei: solange sich das günstigste Angebot nicht ändert,
-- wird Keepa nicht erneut gefragt — ein Abruf kostet Token, und der Monitor
-- prüft im Minutentakt.
CREATE TABLE IF NOT EXISTS monitor_produkte (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL DEFAULT '',
    url            TEXT    NOT NULL,
    ean            TEXT    NOT NULL DEFAULT '',
    asin           TEXT    NOT NULL DEFAULT '',
    maerkte        TEXT    NOT NULL DEFAULT '',
    max_ek_cent    INTEGER NOT NULL DEFAULT 0,
    shops          TEXT    NOT NULL DEFAULT '',
    auch_verzoegert INTEGER NOT NULL DEFAULT 0,
    aktiv          INTEGER NOT NULL DEFAULT 1,
    angelegt_am    TEXT    NOT NULL,
    geprueft_am    TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT '',
    bester_shop    TEXT    NOT NULL DEFAULT '',
    bester_cent    INTEGER NOT NULL DEFAULT 0,
    bewertet_shop  TEXT    NOT NULL DEFAULT '',
    bewertet_cent  INTEGER NOT NULL DEFAULT 0,
    bewertet_am    TEXT    NOT NULL DEFAULT '',
    modus          TEXT    NOT NULL DEFAULT 'amazon',
    ankauf_cent    INTEGER NOT NULL DEFAULT 0,
    hinweis        TEXT    NOT NULL DEFAULT '',
    kategorie      TEXT    NOT NULL DEFAULT '',
    prio           TEXT    NOT NULL DEFAULT 'normal',
    stichworte     TEXT    NOT NULL DEFAULT '',
    notiz          TEXT    NOT NULL DEFAULT ''
);

-- produkt_id 0 heißt: die Regel gilt für jedes Produkt. shops leer heißt:
-- für jeden Shop. Ein Treffer geht in jeden Channel, dessen Regel passt.
CREATE TABLE IF NOT EXISTS monitor_regeln (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL DEFAULT '',
    channel_id      INTEGER NOT NULL,
    produkt_id      INTEGER NOT NULL DEFAULT 0,
    min_marge       REAL    NOT NULL DEFAULT 0,
    min_gewinn_cent INTEGER NOT NULL DEFAULT 0,
    min_sales       INTEGER NOT NULL DEFAULT 0,
    shops           TEXT    NOT NULL DEFAULT '',
    aktiv           INTEGER NOT NULL DEFAULT 1,
    angelegt_am     TEXT    NOT NULL,
    modus           TEXT    NOT NULL DEFAULT '',
    kategorie       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS monitor_treffer (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    produkt_id    INTEGER NOT NULL,
    titel         TEXT    NOT NULL DEFAULT '',
    shop          TEXT    NOT NULL DEFAULT '',
    gesamt_cent   INTEGER NOT NULL DEFAULT 0,
    gewinn_cent   INTEGER NOT NULL DEFAULT 0,
    marge_prozent REAL    NOT NULL DEFAULT 0,
    sales         INTEGER NOT NULL DEFAULT 0,
    gepostet      INTEGER NOT NULL DEFAULT 0,
    ergebnis      TEXT    NOT NULL DEFAULT '',
    deal_id       INTEGER NOT NULL DEFAULT 0,
    zeit          TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitor_treffer ON monitor_treffer(produkt_id, zeit DESC);

-- Preisverlauf je Monitor-Produkt: das günstigste passende Angebot, sobald
-- es sich ändert, sonst höchstens einmal je Stunde. Daraus kommen der
-- Tiefstpreis im Post und der Preisfehler-Alarm.
CREATE TABLE IF NOT EXISTS monitor_preise (
    produkt_id INTEGER NOT NULL,
    zeit       TEXT    NOT NULL,
    cent       INTEGER NOT NULL,
    shop       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_monitor_preise ON monitor_preise(produkt_id, zeit DESC);

-- Jeder Post des Monitors in Discord, damit er als ausverkauft markiert
-- werden kann, sobald das Angebot verschwindet. Amazon-Deals verweisen auf
-- ihre Zeile in deals (deal_id), Ankaufs-Posts tragen Text und Nachricht
-- selbst.
CREATE TABLE IF NOT EXISTS monitor_posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    produkt_id     INTEGER NOT NULL,
    shop           TEXT    NOT NULL DEFAULT '',
    gesamt_cent    INTEGER NOT NULL DEFAULT 0,
    deal_id        INTEGER NOT NULL DEFAULT 0,
    channel_id     INTEGER NOT NULL DEFAULT 0,
    nachricht_id   TEXT    NOT NULL DEFAULT '',
    text           TEXT    NOT NULL DEFAULT '',
    gepostet_am    TEXT    NOT NULL,
    ausverkauft_am TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_monitor_posts ON monitor_posts(produkt_id, gepostet_am DESC);

-- Ankäufer je Produkt mit Staffel: preis_cent gilt ab ab_stueck Stück. Die
-- Namen stehen nur hier, nie im Post.
CREATE TABLE IF NOT EXISTS monitor_ankaeufer (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    produkt_id INTEGER NOT NULL,
    name       TEXT    NOT NULL DEFAULT '',
    preis_cent INTEGER NOT NULL,
    ab_stueck  INTEGER NOT NULL DEFAULT 1,
    notiz      TEXT    NOT NULL DEFAULT ''
);

-- Kategorie-Scan: ganze Kategorieseiten bei billiger.de, und je Produkt
-- darauf der Preisverlauf, um Preisstürze zu erkennen.
CREATE TABLE IF NOT EXISTS monitor_kategorien (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL DEFAULT '',
    url         TEXT    NOT NULL,
    aktiv       INTEGER NOT NULL DEFAULT 1,
    geprueft_am TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS monitor_kategorie_preise (
    objekt TEXT    NOT NULL,
    zeit   TEXT    NOT NULL,
    cent   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitor_kategorie_preise ON monitor_kategorie_preise(objekt, zeit DESC);

-- Was schon gemeldet wurde (Preisstürze, mydealz-Deals, Admin-Hinweise),
-- damit nichts zweimal kommt.
-- Kurzlinks für den direkten Weg zum Shop: /go/<kurz> holt beim Klick über
-- billiger.de eine frische Weiterleitung (siehe billiger.KlickLink); geht
-- das nicht, führt er auf ersatz, die Seite bei billiger.de.
CREATE TABLE IF NOT EXISTS monitor_links (
    kurz        TEXT PRIMARY KEY,
    schluessel  TEXT NOT NULL,
    ersatz      TEXT NOT NULL,
    angelegt_am TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_links ON monitor_links(schluessel);

CREATE TABLE IF NOT EXISTS monitor_gemeldet (
    schluessel TEXT PRIMARY KEY,
    zeit       TEXT NOT NULL
);
`

// Open öffnet die Datenbank und legt Schema und Chart-Ordner an, falls sie
// fehlen.
func Open(dbPfad, chartOrdner string) (*Store, error) {
	if verz := filepath.Dir(dbPfad); verz != "" {
		if err := os.MkdirAll(verz, 0o755); err != nil {
			return nil, fmt.Errorf("store: Verzeichnis nicht anlegbar: %w", err)
		}
	}
	if err := os.MkdirAll(chartOrdner, 0o755); err != nil {
		return nil, fmt.Errorf("store: Chart-Ordner nicht anlegbar: %w", err)
	}

	db, err := sql.Open("sqlite", dbPfad+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("store: Datenbank nicht zu öffnen: %w", err)
	}
	// SQLite verträgt keine parallelen Schreiber; ein Verbindung reicht für
	// eine Einzelplatzanwendung und erspart Sperrfehler.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: Schema nicht anlegbar: %w", err)
	}
	for _, e := range ergaenzungen {
		if err := spalteErgaenzen(db, e.tabelle, e.spalte, e.definition); err != nil {
			db.Close()
			return nil, err
		}
	}

	s := &Store{db: db, chartOrdner: chartOrdner}

	// Eine gespeicherte, aber nie veränderte Post-Vorlage aus der Zeit vor
	// den Marktzeilen bekommt die neue Form. Ein Fehler dabei ist kein
	// Grund, den Start abzubrechen: post.Render hängt die weiteren Märkte
	// notfalls selbst an, nur eben in der alten dreizeiligen Form.
	_ = s.vorlageNachziehen()

	// Gewinn und Marge für die Auswertung bestimmen, wo das noch fehlt —
	// bei allen Deals aus der Zeit vor dieser Spalte.
	_ = s.dealsBewerten(0)

	// Cart-Limits, die nur in der EK-Notiz stehen ("3er cart"), in die
	// Spalte max_menge übernehmen.
	_ = s.mengenAusNotizen()

	// Die Sicht für die Statistik über alle Gruppen, siehe verbundAnlegen.
	if err := s.verbundAnlegen(); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: Sicht deals_verbund nicht anlegbar: %w", err)
	}

	// Die Tarifstaffel einmalig befüllen. Ein Fehler dabei ist kein Grund,
	// den Start abzubrechen: ohne Staffel rechnet das Programm wie zuvor
	// über Keepas Gebühr, und die Tarifseite lässt sie von Hand anlegen.
	_ = s.tarifeBestuecken()

	return s, nil
}

// ergaenzungen sind Spalten, die nach der ersten Auslieferung dazugekommen
// sind. In schema oben stehen sie ebenfalls — für eine frisch angelegte
// Datenbank genügt das. Eine bereits vorhandene Datei bekommt eine neue
// Spalte aber niemals durch CREATE TABLE IF NOT EXISTS: die Anweisung tut
// dort schlicht nichts. Darum hier zusätzlich als ALTER TABLE.
var ergaenzungen = []struct{ tabelle, spalte, definition string }{
	// Der Einkaufslink eines Fremdshops. Bei einem Amazon-Einkauf bleibt er
	// leer, weil sich die Produktseite dort aus Quellmarkt und ASIN ergibt.
	{"deals", "quell_url", `TEXT NOT NULL DEFAULT ''`},
	// Ob der Einkaufspreis netto oder brutto eingegeben wurde. Alte Zeilen
	// stammen aus der Zeit vor dem Schalter, in der ausschließlich brutto
	// eingegeben werden konnte — der Vorgabewert sagt also die Wahrheit.
	{"deals", "ek_art", `TEXT NOT NULL DEFAULT 'brutto'`},
	// Der Dateiname des Amazon-Produktbildes. Leer bei jedem Deal, der vor
	// dieser Spalte gepostet wurde, und bei jedem Produkt, zu dem Keepa kein
	// Bild kennt — die Historie zeigt dann wie bisher nur den Titel.
	{"deals", "bild_kennung", `TEXT NOT NULL DEFAULT ''`},
	// Höchstmenge je Bestellung (Cart-Limit). 0 heißt: nicht angegeben.
	{"deals", "max_menge", `INTEGER NOT NULL DEFAULT 0`},
	// Was nach dem Posten mit dem Post geschah: leer (aktiv),
	// "ausverkauft" oder "geloescht". Alte Zeilen sind aktiv.
	{"deals", "status", `TEXT NOT NULL DEFAULT ''`},
	// Der Channel (oder Thread) der Discord-Nachricht — der Bot braucht ihn,
	// um die Reaktionen zu lesen. Leer bei alten Deals; der Abgleich holt ihn
	// dann über die Webhook-Adresse nach.
	{"deals", "discord_kanal_id", `TEXT NOT NULL DEFAULT ''`},
	// Die Reaktionen unter dem Post: ✅ (gekauft) und ❌ (nicht mehr
	// verfügbar), ohne die vorbelegte Reaktion des Bots. reaktionen_am ist
	// der letzte Abgleich, leer wenn es noch keinen gab.
	{"deals", "kaeufe", `INTEGER NOT NULL DEFAULT 0`},
	{"deals", "nicht_verfuegbar", `INTEGER NOT NULL DEFAULT 0`},
	{"deals", "reaktionen_am", `TEXT NOT NULL DEFAULT ''`},
	// Die Gruppe (etwa ein Discord-Server), zu der ein Channel gehört. Die
	// Statistik lässt sich danach trennen. Am Deal steht sie zusätzlich,
	// damit sie das Löschen eines Channels überlebt — wie channel_name.
	{"channels", "gruppe", `TEXT NOT NULL DEFAULT ''`},
	{"deals", "gruppe", `TEXT NOT NULL DEFAULT ''`},
	// "ermaessigt", wenn der Deal mit dem ermäßigten Umsatzsteuersatz
	// gerechnet wurde (etwa 7 % statt 19 %); leer für den normalen.
	{"deals", "steuersatz", `TEXT NOT NULL DEFAULT ''`},
	// Gewinn und Marge, mit denen Historie und Statistik rechnen: die des
	// besseren Versandwegs. Ist Pan-EU (Ware liegt im Zielland) besser als
	// EFN, sind es die Pan-EU-Zahlen und pan_eu steht auf 1 — ein
	// Pan-EU-Deal soll dort nicht mit dem EFN-Verlust auftauchen.
	// NULL heißt: noch nicht bestimmt; dealsBewerten holt das nach.
	{"deals", "eff_gewinn_cent", `INTEGER`},
	{"deals", "eff_marge_prozent", `REAL`},
	{"deals", "pan_eu", `INTEGER NOT NULL DEFAULT 0`},
	// Wer den Deal gepostet hat (Name aus der Einstellung deal.poster).
	{"deals", "poster", `TEXT NOT NULL DEFAULT ''`},
	// Lieferant eines Einkaufs ohne Link (Großhandel).
	{"deals", "lieferant", `TEXT NOT NULL DEFAULT ''`},
	// Aus einem alten Discord-Post eingelesen.
	{"deals", "importiert", `INTEGER NOT NULL DEFAULT 0`},
	// Bei einem Deal in mehreren Channels: der Hauptpost (0 = selbst einer).
	{"deals", "haupt_id", `INTEGER NOT NULL DEFAULT 0`},
	// Die Eingaben beim Posten, für "Erneut posten".
	{"deals", "formular", `TEXT NOT NULL DEFAULT ''`},
	// Der Ankaufs-Modus des Shop-Monitors (siehe store/monitor.go).
	{"monitor_produkte", "modus", `TEXT NOT NULL DEFAULT 'amazon'`},
	{"monitor_produkte", "ankauf_cent", `INTEGER NOT NULL DEFAULT 0`},
	{"monitor_produkte", "hinweis", `TEXT NOT NULL DEFAULT ''`},
	{"monitor_produkte", "kategorie", `TEXT NOT NULL DEFAULT ''`},
	{"monitor_regeln", "modus", `TEXT NOT NULL DEFAULT ''`},
	{"monitor_regeln", "kategorie", `TEXT NOT NULL DEFAULT ''`},
	// Prio-Stufe, Stichworte für mydealz und eine interne Notiz.
	{"monitor_produkte", "prio", `TEXT NOT NULL DEFAULT 'normal'`},
	{"monitor_produkte", "stichworte", `TEXT NOT NULL DEFAULT ''`},
	{"monitor_produkte", "notiz", `TEXT NOT NULL DEFAULT ''`},
}

// spalteErgaenzen hängt eine Spalte an, falls sie noch fehlt.
//
// SQLite kennt kein "ADD COLUMN IF NOT EXISTS", darum die Abfrage über
// PRAGMA table_info. Wiederholbar wie alles in schema: beim zweiten Start
// findet die Prüfung die Spalte und tut nichts. Ein Migrationszähler bleibt
// damit weiterhin entbehrlich.
func spalteErgaenzen(db *sql.DB, tabelle, spalte, definition string) error {
	zeilen, err := db.Query(`SELECT name FROM pragma_table_info(?)`, tabelle)
	if err != nil {
		return fmt.Errorf("store: Spalten von %s nicht lesbar: %w", tabelle, err)
	}
	defer zeilen.Close()

	for zeilen.Next() {
		var name string
		if err := zeilen.Scan(&name); err != nil {
			return fmt.Errorf("store: Spalten von %s nicht lesbar: %w", tabelle, err)
		}
		if name == spalte {
			return nil
		}
	}
	if err := zeilen.Err(); err != nil {
		return fmt.Errorf("store: Spalten von %s nicht lesbar: %w", tabelle, err)
	}

	// Bezeichner lassen sich in SQLite nicht als Parameter binden; tabelle,
	// spalte und definition sind ausschließlich die Konstanten aus
	// ergaenzungen, nie Werte von außen.
	if _, err := db.Exec(`ALTER TABLE ` + tabelle + ` ADD COLUMN ` + spalte + ` ` + definition); err != nil {
		return fmt.Errorf("store: Spalte %s.%s nicht anlegbar: %w", tabelle, spalte, err)
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }
