package store

import (
	"database/sql"
	"errors"
	"strconv"

	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
)

// Schlüssel der Einstellungen. Die USt-Sätze hängen das Länderkürzel an das
// Präfix an, etwa "ust.DE".
const (
	SchluesselKeepaKey    = "keepa.api_key"
	SchluesselVorlage     = "post.vorlage"
	SchluesselMargenBasis = "calc.margen_basis" // "brutto" oder "netto"
	SchluesselUStPrefix   = "ust."
	// SchluesselUStErmPrefix ist der ermäßigte Satz je Land, etwa
	// "ust_erm.DE" (7 % in Deutschland).
	SchluesselUStErmPrefix   = "ust_erm."
	SchluesselProvision      = "calc.standard_provision"
	SchluesselFBA            = "calc.standard_fba"
	SchluesselZielmarkt      = "deal.standard_zielmarkt"
	SchluesselLagerland      = "versand.lagerland"
	SchluesselEFNZuschlag    = "versand.zuschlag_pro_einheit"
	SchluesselChartTage      = "chart.tage"
	SchluesselChartBreite    = "chart.breite"
	SchluesselChartHoehe     = "chart.hoehe"
	SchluesselChartSalesRank = "chart.salesrank"
	SchluesselChartBuyBox    = "chart.buybox"
	SchluesselChartAmazon    = "chart.amazon"
	SchluesselChartNeu       = "chart.neu"
	SchluesselChartFBA       = "chart.fba"
	SchluesselChartTageKurz  = "chart.tage_kurz"

	// Der Discord-Bot, der die Reaktionen unter den Posts liest.
	SchluesselBotToken         = "discord.bot_token"
	SchluesselReaktionGekauft  = "reaktion.gekauft"
	SchluesselReaktionWeg      = "reaktion.weg"
	SchluesselReaktionVorlegen = "reaktion.vorbelegen"
	SchluesselReaktionSchwelle = "reaktion.schwelle"
	SchluesselReaktionAuto     = "reaktion.automatisch"
	// SchluesselReaktionSchwelleB2B ist die Schwelle in den B2B-Channels —
	// dort ist ein Deal meist mit dem ersten ❌ weg.
	SchluesselReaktionSchwelleB2B = "reaktion.schwelle_b2b"

	// Telegram: jeder gepostete Deal geht zusätzlich an diesen Chat.
	SchluesselTelegramToken = "telegram.token"
	SchluesselTelegramChat  = "telegram.chat"
	SchluesselTelegramAktiv = "telegram.aktiv"

	// SchluesselPoster sind die Leute, die Deals posten — einer je Zeile,
	// "Name" oder "Name=Discord-User-ID". Mit ID wird der Name im Post zur
	// echten Discord-Erwähnung (ohne Ping).
	SchluesselPoster = "deal.poster"

	// SchluesselStueckStandard ist die Stückzahl je Deal für den Gewinn mit
	// Cart-Limit, wenn der Deal kein Cart-Limit nennt.
	SchluesselStueckStandard = "statistik.stueck_standard"
	// SchluesselB2BChannels sind die Channels mit B2B-Deals, als Liste von
	// Channel-IDs mit Komma. "auto" (Vorgabe) heißt: jeder Channel mit
	// "b2b" im Namen. B2B-Deals zählen beim Gewinn mit Cart-Limit nicht mit.
	SchluesselB2BChannels  = "statistik.b2b_channels"
	SchluesselCacheMinuten = "keepa.cache_minuten"
)

// vorgaben greifen, solange nichts gespeichert wurde.
//
// SchluesselFBA fehlt hier bewusst: eine geratene FBA-Gebühr würde eine
// falsche Gewinnzahl in den Post schreiben. Lieber leer lassen und den
// Nutzer zum Eintippen zwingen.
var vorgaben = map[string]string{
	SchluesselKeepaKey: "",
	// Leer steht für post.StandardVorlage (siehe post.VorlageOderStandard).
	SchluesselVorlage:     "",
	SchluesselMargenBasis: "brutto",
	SchluesselProvision:   "15",
	// Eine Liste, nicht ein Markt: verkauft wird oft auf mehreren
	// Marktplätzen zugleich. Der erste Eintrag ist der Leitmarkt.
	SchluesselZielmarkt: "DE",
	SchluesselLagerland: "DE",
	// Fußnote 4 der Tarifübersicht: wer am Central Europe Program nicht
	// teilnimmt, zahlt je Einheit aus einem deutschen Logistikzentrum 0,26 €
	// mehr. Der häufigere Fall, darum die Vorgabe — wer teilnimmt, trägt 0 ein.
	SchluesselEFNZuschlag: "0,26",
	SchluesselChartTage:   "90",
	// Der zweite Chart unter dem ersten, mit kürzerem Zeitraum. 0 schaltet
	// ihn ab.
	SchluesselChartTageKurz:    "30",
	SchluesselChartBreite:      "800",
	SchluesselChartHoehe:       "350",
	SchluesselChartSalesRank:   "1",
	SchluesselChartBuyBox:      "1",
	SchluesselChartAmazon:      "1",
	SchluesselChartNeu:         "1",
	SchluesselChartFBA:         "1",
	SchluesselCacheMinuten:     "30",
	SchluesselBotToken:         "",
	SchluesselReaktionGekauft:  "✅",
	SchluesselReaktionWeg:      "❌",
	SchluesselReaktionVorlegen: "1",
	// Ab so vielen ❌ schlägt die Historie vor, den Deal als ausverkauft zu
	// markieren. 0 schaltet den Vorschlag ab.
	SchluesselReaktionSchwelle: "3",
	// Automatisch markieren ist aus: der Post wird dabei in Discord
	// geändert, und das soll niemand unbemerkt einschalten.
	SchluesselReaktionAuto:        "0",
	SchluesselReaktionSchwelleB2B: "1",
	SchluesselTelegramToken:       "",
	SchluesselTelegramChat:        "",
	SchluesselTelegramAktiv:       "0",
	SchluesselPoster:              "ludwig\nk95\nmarkah",
	SchluesselStueckStandard:      "6",
	SchluesselB2BChannels:         "auto",
	SchluesselUStPrefix + "DE":    "190",
	SchluesselUStPrefix + "FR":    "200",
	SchluesselUStPrefix + "IT":    "220",
	SchluesselUStPrefix + "ES":    "210",
	// Die ermäßigten Sätze, die für die meisten ermäßigten Waren gelten
	// (Lebensmittel, Bücher …). Sonderfälle wie 4 % in Italien und Spanien
	// lassen sich hier anpassen.
	SchluesselUStErmPrefix + "DE": "70",
	SchluesselUStErmPrefix + "FR": "55",
	SchluesselUStErmPrefix + "IT": "100",
	SchluesselUStErmPrefix + "ES": "100",
}

// Einstellung liefert den gespeicherten Wert oder den Vorgabewert.
func (s *Store) Einstellung(schluessel string) string {
	var wert string
	err := s.db.QueryRow(
		`SELECT wert FROM einstellungen WHERE schluessel = ?`, schluessel,
	).Scan(&wert)
	if err == nil {
		return wert
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return vorgaben[schluessel]
	}
	return vorgaben[schluessel]
}

// EinstellungZahl liest eine ganzzahlige Einstellung. Unlesbare Werte ergeben
// 0, damit ein Tippfehler die Anwendung nicht anhält.
func (s *Store) EinstellungZahl(schluessel string) int {
	n, err := strconv.Atoi(s.Einstellung(schluessel))
	if err != nil {
		return 0
	}
	return n
}

// vorlageNachziehen leert eine nie angefasste Vorlage.
//
// Eine leere Vorlage steht für post.StandardVorlage. Wer die Standardvorlage
// unverändert in der Datenbank stehen hat, bekommt so jede künftige
// Änderung daran mit, statt auf einer alten Fassung sitzen zu bleiben.
//
// Nur bei wörtlicher Übereinstimmung mit einer der Standardvorlagen: wer
// sich eine eigene geschrieben hat, behält sie. Wiederholbar wie alles in
// Open: nach dem ersten Lauf trifft die Bedingung nicht mehr zu.
func (s *Store) vorlageNachziehen() error {
	_, err := s.db.Exec(`
		UPDATE einstellungen SET wert = ''
		WHERE schluessel = ? AND wert IN (?, ?)`,
		SchluesselVorlage, post.StandardVorlage, post.AlteStandardVorlage)
	return err
}

func (s *Store) SetzeEinstellung(schluessel, wert string) error {
	_, err := s.db.Exec(`
		INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
		ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`,
		schluessel, wert)
	return err
}

// AlleEinstellungen liefert Vorgaben und gespeicherte Werte zusammengeführt.
func (s *Store) AlleEinstellungen() map[string]string {
	alle := make(map[string]string, len(vorgaben))
	for k, v := range vorgaben {
		alle[k] = v
	}

	zeilen, err := s.db.Query(`SELECT schluessel, wert FROM einstellungen`)
	if err != nil {
		return alle
	}
	defer zeilen.Close()

	for zeilen.Next() {
		var k, v string
		if err := zeilen.Scan(&k, &v); err == nil {
			alle[k] = v
		}
	}
	return alle
}
