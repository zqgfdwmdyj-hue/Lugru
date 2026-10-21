package web

import (
	"html/template"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/bild"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type historieZeile struct {
	store.Deal
	EK     string
	VK     string
	Gewinn string
	Marge  string
	Datum  string

	// Die beiden Bildadressen werden hier fertig gebaut, weil
	// html/template nicht rechnen kann — dieselbe Überlegung wie bei
	// VorherigeSeite weiter unten. Beide sind leer, wenn der Deal keine
	// oder eine unbrauchbare Kennung trägt; die Vorlage zeigt dann gar
	// kein Bild, statt ein leeres src auszuliefern.
	BildKlein string
	BildGross string

	// Die Klassen für die farbigen Chips entstehen hier und nicht in der
	// Vorlage: html/template kann nicht vergleichen, dieselbe Überlegung
	// wie bei den Bildadressen darüber.
	GewinnKlasse string
	MargeKlasse  string

	// GewinnEFN ist der Gewinn über EFN, falls die Zeile mit Pan-EU rechnet.
	GewinnEFN string

	// Reaktionen sagt, ob die Reaktionen schon einmal gelesen wurden;
	// Ausverkauft vorschlagen, ob so viele "nicht mehr verfügbar" darunter
	// stehen, dass der Deal wohl vorbei ist.
	Reaktionen           bool
	AusverkauftVorschlag bool

	// Maerkte sind die Zielmärkte dieses Posts. Leer bei jedem Deal, der vor
	// dieser Spalte gepostet wurde — die Vorlage zeigt dann gar keine
	// Markttabelle statt einer leeren.
	Maerkte []historieMarkt
}

// historieMarkt ist ein Zielmarkt in der aufgeklappten Ansicht eines Deals.
//
// Alle Felder sind fertig formatiert, wie bei historieZeile und aus demselben
// Grund: html/template kann nicht rechnen und nicht formatieren.
type historieMarkt struct {
	Code      string
	Leitmarkt bool

	VK        string
	Sales     string
	Provision string
	FBA       string
	Gewinn    string
	Marge     string

	// Leer, wo es den Vergleich nicht gab. Die Vorlage fragt mit {{if}}
	// danach; ein "0,00 €" stünde sonst als Aussage da, die niemand
	// gerechnet hat.
	FBAPanEU    string
	GewinnPanEU string
	MargePanEU  string

	// Quellen sagt, woher die Zahlen dieses Marktes stammten. Beim
	// Nachlesen eines alten Posts ist das oft die eigentliche Frage.
	Quellen string
}

// zahlklasse ordnet einen Betrag einer der drei Chip-Farben zu.
//
// Die Null bekommt bewusst eine eigene Klasse statt in "positiv" zu fallen:
// ein Deal, der genau nichts abwirft, ist weder Gewinn noch Verlust, und ein
// grüner Chip auf 0,00 € wäre eine Aussage, die die Zahl nicht hergibt.
//
// Die Farbe kommt zum Vorzeichen hinzu und ersetzt es nicht — der Betrag
// bleibt mit Minus lesbar, auch für alle, die Grün und Rot schlecht
// auseinanderhalten.
func zahlklasse(wert float64) string {
	switch {
	case wert > 0:
		return "positiv"
	case wert < 0:
		return "negativ"
	default:
		return "neutral"
	}
}

// Kantenlängen der beiden Bildfassungen. Das Thumbnail wird mit 40 px
// angezeigt, aber in 160 px geladen, damit es auf hochauflösenden Schirmen
// nicht verwaschen aussieht.
const (
	bildKanteKlein = 160
	bildKanteGross = 500
)

type historieDaten struct {
	Titel     string
	TokenText string
	Fehler    string
	Meldung   string
	Suche     string
	ChannelID int64
	Channels  []store.Channel

	// Die weiteren Filter, so wie sie im Formular stehen.
	Von, Bis           string
	MargeMin, MargeMax string
	Status             string
	Gruppe             string
	Gruppen            []string
	Poster             string
	PosterListe        []posterEintrag

	// Filter ist die Abfrage ohne Seitenzahl, fertig kodiert — als
	// Rücksprung der Knöpfe an jedem Deal. FilterURL ist dasselbe für die
	// Blätter-Links: als template.URL, sonst maskierte html/template die &
	// und = darin. Sicher, weil historieRuecksprung nur bekannte Felder
	// übernimmt und url.Values.Encode jeden Wert kodiert.
	Filter    string
	FilterURL template.URL

	// Die eingestellten Reaktionen, wie sie in der Liste erscheinen, und
	// der Stand des Abgleichs.
	EmojiGekauft, EmojiWeg string
	Abgleich               abgleichStand
	Zeilen                 []historieZeile
	Anzahl                 int
	Seite                  int
	MehrDa                 bool

	// html/template kann nicht rechnen, darum werden die Nachbarseiten hier
	// vorbereitet.
	VorherigeSeite int
	NaechsteSeite  int
}

const historieProSeite = 50

// historieFilterFelder sind die Abfrageparameter der Historie außer der
// Seitenzahl.
var historieFilterFelder = []string{"suche", "channel", "gruppe", "poster", "von", "bis", "marge_min", "marge_max", "status"}

func (srv *Server) zeigeHistorie(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	seite, _ := strconv.Atoi(q.Get("seite"))
	if seite < 1 {
		seite = 1
	}
	channelID, _ := strconv.ParseInt(q.Get("channel"), 10, 64)

	filter := store.DealFilter{
		Suche:     q.Get("suche"),
		ChannelID: channelID,
		Status:    q.Get("status"),
		Gruppe:    q.Get("gruppe"),
		Poster:    q.Get("poster"),
		Limit:     historieProSeite,
		Offset:    (seite - 1) * historieProSeite,
	}

	// Unlesbare Filterwerte werden gemeldet und nicht angewendet — ein
	// stillschweigend ignorierter Filter zeigte mehr Deals, als der Nutzer
	// zu sehen glaubt.
	var fehler []string
	if v := q.Get("von"); v != "" {
		if t, err := time.ParseInLocation("2006-01-02", v, time.Local); err == nil {
			filter.Von = t
		} else {
			fehler = append(fehler, "Datum „von“ nicht lesbar")
		}
	}
	if v := q.Get("bis"); v != "" {
		if t, err := time.ParseInLocation("2006-01-02", v, time.Local); err == nil {
			// Bis einschließlich: der ganze Tag zählt mit.
			filter.Bis = t.AddDate(0, 0, 1).Add(-time.Nanosecond)
		} else {
			fehler = append(fehler, "Datum „bis“ nicht lesbar")
		}
	}
	for _, g := range []struct {
		feld, name string
		ziel       **float64
	}{
		{"marge_min", "Marge ab", &filter.MargeMin},
		{"marge_max", "Marge bis", &filter.MargeMax},
	} {
		v := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(q.Get(g.feld)), "%"))
		if v == "" {
			continue
		}
		f, err := strconv.ParseFloat(strings.ReplaceAll(v, ",", "."), 64)
		if err != nil {
			fehler = append(fehler, g.name+" ist keine Zahl")
			continue
		}
		*g.ziel = &f
	}

	channels, _ := srv.store.Channels()
	d := historieDaten{
		Titel:          "Historie",
		Suche:          filter.Suche,
		ChannelID:      channelID,
		Channels:       channels,
		Von:            q.Get("von"),
		Bis:            q.Get("bis"),
		MargeMin:       q.Get("marge_min"),
		MargeMax:       q.Get("marge_max"),
		Status:         q.Get("status"),
		Filter:         historieRuecksprung(r.URL.RawQuery).Encode(),
		Meldung:        q.Get("meldung"),
		Fehler:         strings.Join(append(fehler, q["fehler"]...), " · "),
		Seite:          seite,
		VorherigeSeite: seite - 1,
		NaechsteSeite:  seite + 1,
		TokenText:      srv.tokenText(),
	}

	d.FilterURL = template.URL(d.Filter)
	d.Gruppe = filter.Gruppe
	d.Gruppen, _ = srv.store.Gruppen()
	d.Poster = filter.Poster
	d.PosterListe = srv.posterListe()
	d.EmojiGekauft = emojiAnzeige(srv.store.Einstellung(store.SchluesselReaktionGekauft))
	d.EmojiWeg = emojiAnzeige(srv.store.Einstellung(store.SchluesselReaktionWeg))
	d.Abgleich = srv.abgleichStand().MitSeite("historie")
	schwelleFuer := srv.ausverkauftSchwelle()

	deals, err := srv.store.Deals(filter)
	if err != nil {
		// sicherFehlertext ist auch hier Pflicht: eine Datenbank-Fehlermeldung
		// ist nicht von vornherein harmlos, und die in diesem Projekt
		// etablierte Verteidigungslinie (siehe channels.go) gilt für jeden
		// Fehlertext, der auf einer Seite landet — nicht nur für die, von
		// denen bekannt ist, dass sie ein Geheimnis enthalten könnten.
		d.Fehler = "Historie nicht lesbar: " + sicherFehlertext(err.Error())
		srv.rendere(w, "historie", d)
		return
	}
	d.Anzahl, _ = srv.store.DealsAnzahl(filter)
	d.MehrDa = filter.Offset+len(deals) < d.Anzahl

	for _, deal := range deals {
		d.Zeilen = append(d.Zeilen, historieZeile{
			Deal:      deal,
			EK:        deal.EKCent.Euro(),
			VK:        deal.VKCent.Euro(),
			Gewinn:    deal.EffGewinnCent.Euro(),
			GewinnEFN: deal.GewinnCent.Euro() + " / " + prozent(deal.MargeProzent, 1),
			Marge:     prozent(deal.EffMargeProzent, 1),
			Datum:     deal.GepostetAm.Local().Format("02.01.2006 15:04"),

			BildKlein: bild.URL(deal.BildKennung, bildKanteKlein),
			BildGross: bild.URL(deal.BildKennung, bildKanteGross),

			GewinnKlasse: zahlklasse(float64(deal.EffGewinnCent)),
			MargeKlasse:  zahlklasse(deal.EffMargeProzent),

			Reaktionen: !deal.ReaktionenAm.IsZero(),
			AusverkauftVorschlag: schwelleFuer(deal.ChannelID) > 0 && deal.NichtVerfuegbar >= schwelleFuer(deal.ChannelID) &&
				deal.Status == store.StatusAktiv,
		})
	}

	// Eine Abfrage für die ganze Seite statt einer je Zeile: die Historie
	// zeigt fünfzig Deals gleichzeitig, und fünfzig Abfragen wären fünfzig
	// Sperren auf derselben einen SQLite-Verbindung.
	ids := make([]int64, 0, len(d.Zeilen))
	for _, z := range d.Zeilen {
		ids = append(ids, z.ID)
	}
	nachMarkt, err := srv.store.DealMaerkte(ids)
	if err != nil {
		// Die Märkte sind Beiwerk; die Historie selbst ist die Hauptsache.
		// Ein Fehler hier darf die Liste nicht verschlucken.
		d.Fehler = sicherFehlertext(err.Error())
	}
	for i := range d.Zeilen {
		for _, m := range nachMarkt[d.Zeilen[i].ID] {
			hm := historieMarkt{
				Code: m.Markt, Leitmarkt: m.Leitmarkt,
				VK: m.VKCent.Euro(), Sales: strconv.Itoa(m.Sales),
				Provision: zahlText(m.ProvisionProzent) + " %",
				FBA:       m.FBACent.Euro(),
				Gewinn:    m.GewinnCent.Euro(),
				Marge:     prozent(m.MargeProzent, 1),
				Quellen: "VK " + m.VKQuelle + " · Sales " + m.SalesQuelle +
					" · Provision " + m.ProvisionQuelle + " · FBA " + m.FBAQuelle,
			}
			if m.PanEU != nil {
				hm.FBAPanEU = m.PanEU.FBACent.Euro()
				hm.GewinnPanEU = m.PanEU.GewinnCent.Euro()
				hm.MargePanEU = prozent(m.PanEU.MargeProzent, 1)
			}
			d.Zeilen[i].Maerkte = append(d.Zeilen[i].Maerkte, hm)
		}
	}

	srv.rendere(w, "historie", d)
}

// zeigeHistorieChart liefert ein archiviertes Bild aus.
//
// Der Dateiname stammt aus der Datenbank, wird von ChartLesen aber trotzdem
// geprüft — hier kommt er über die URL wieder herein und darf nicht aus dem
// Chart-Ordner herausführen. Bei einem Fehler wird bewusst keine Einzelheit
// aus err zurückgegeben (weder "ungültiger Name" noch ein Dateisystempfad),
// nur ein generisches 404 — sonst würde je nach Fehlerart der volle Pfad
// oder die Ordnerstruktur nach außen sichtbar.
func (srv *Server) zeigeHistorieChart(w http.ResponseWriter, r *http.Request) {
	png, err := srv.store.ChartLesen(r.PathValue("datei"))
	if err != nil {
		http.Error(w, "Chart nicht gefunden", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(png)
}

// emojiAnzeige zeigt ein eingestelltes Emoji: das Zeichen selbst, bei einem
// Server-Emoji dessen Name in Doppelpunkten.
func emojiAnzeige(eingabe string) string {
	e := discord.EmojiAus(eingabe)
	if e.ID != "" {
		return ":" + e.Name + ":"
	}
	return e.Name
}
