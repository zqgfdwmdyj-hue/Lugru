package web

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// statistikZeile ist eine Gruppe, fertig formatiert — html/template kann
// weder rechnen noch formatieren.
type statistikZeile struct {
	Name         string
	Anzahl       int
	Ausverkauft  int
	Gewinn       string
	Marge        string
	GewinnKlasse string
	// Balken ist die Anzahl im Verhältnis zur größten Gruppe der Tabelle,
	// in Prozent — für den Balken hinter der Zahl.
	Balken int

	// Kaeufe sind die ✅ unter den Posts; Kaufquote der Anteil der Deals,
	// unter denen mindestens eines steht.
	Kaeufe    int
	Kaufquote string
}

type dauerbrennerZeile struct {
	ASIN        string
	Titel       string
	LetzterDeal int64
	Anzahl      int
	Kaeufe      int
	Marge       string
	Zuletzt     string
}

type topKaufZeile struct {
	ID     int64
	ASIN   string
	Titel  string
	Datum  string
	Kaeufe int
	Gewinn string
	Marge  string
	Status string
}

type statistikDaten struct {
	Titel     string
	TokenText string
	Fehler    string
	Meldung   string

	Von, Bis string
	// Zeitraeume sind die Schnellwahl über dem Formular.
	Zeitraeume []zeitraum

	Gesamt   statistikZeile
	Tabellen []statistikTabelleDaten

	// Reaktionen sagt, ob ein Bot eingerichtet ist — erst dann gibt es
	// Käufe zu zeigen.
	Reaktionen   bool
	Abgleich     abgleichStand
	EmojiGekauft string
	EmojiWeg     string
	Dauerbrenner []dauerbrennerZeile
	TopKaeufe    []topKaufZeile

	// Gruppe ist die gewählte Gruppe, leer für alle. GruppenWahl sind die
	// Reiter darüber — nur gefüllt, wenn es überhaupt Gruppen gibt.
	Gruppe      string
	GruppenWahl []gruppenWahl

	// Rueckmeldung ist die Übersicht der Reaktionen.
	Rueckmeldung reaktionsDaten

	// PosterDiagramm sind die Balken „Wer hat wie viel gepostet“, leer,
	// solange noch kein Deal einen Poster hat.
	PosterDiagramm  []posterBalken
	PosterUnbekannt bool

	// Menge ist der Gewinn mit Cart-Limit, fertig formatiert.
	Menge mengenAnzeige
}

type mengenAnzeige struct {
	Gewinn   string
	Klasse   string
	Deals    int
	MitLimit int
	B2B      int
	Standard int
	// B2BChannels sind die Namen der B2B-Channels, mit Komma.
	B2BChannels string
}

// posterBalken ist ein Balken im Diagramm „Posts je Poster“.
type posterBalken struct {
	Name   string
	Anzahl int
	// Balken ist die Länge im Verhältnis zum fleißigsten Poster, Anteil
	// der Anteil an allen Posts im Zeitraum — beides in Prozent.
	Balken    int
	Anteil    int
	Gewinn    string
	Kaeufe    int
	Unbekannt bool
}

type gruppenWahl struct {
	Name  string
	Wert  string
	Aktiv bool
}

// reaktionsDaten ist die Übersicht, wie auf die Posts reagiert wurde.
type reaktionsDaten struct {
	Zeigen       bool
	Abgerufen    int
	NichtAbgeruf int
	MitKauf      int
	NurWeg       int
	OhneReaktion int
	Kaeufe       int
	Weg          int
	// Die Anteile an den abgerufenen Posts, für die Balken.
	AnteilMitKauf, AnteilNurWeg, AnteilOhne int
	Liste                                   []reaktionsZeile
}

type reaktionsZeile struct {
	ID       int64
	Titel    string
	ASIN     string
	Datum    string
	Channel  string
	Kaeufe   int
	Weg      int
	Ergebnis string
	Klasse   string
	Status   string
}

type statistikTabelleDaten struct {
	Titel      string
	Zeilen     []statistikZeile
	Reaktionen bool
}

type zeitraum struct {
	Name     string
	Von, Bis string
	Aktiv    bool
}

var monatsnamen = [...]string{"Januar", "Februar", "März", "April", "Mai", "Juni",
	"Juli", "August", "September", "Oktober", "November", "Dezember"}

func (srv *Server) zeigeStatistik(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	d := statistikDaten{
		Titel:        "Statistik",
		TokenText:    srv.tokenText(),
		Von:          q.Get("von"),
		Bis:          q.Get("bis"),
		Abgleich:     srv.abgleichStand().MitSeite("statistik"),
		EmojiGekauft: emojiAnzeige(srv.store.Einstellung(store.SchluesselReaktionGekauft)),
		EmojiWeg:     emojiAnzeige(srv.store.Einstellung(store.SchluesselReaktionWeg)),
		Gruppe:       q.Get("gruppe"),
	}
	d.Von = standardVon(q, d.Von)
	if gruppen, _ := srv.store.Gruppen(); len(gruppen) > 0 {
		d.GruppenWahl = append(d.GruppenWahl, gruppenWahl{Name: "Alle", Aktiv: d.Gruppe == ""})
		for _, g := range gruppen {
			d.GruppenWahl = append(d.GruppenWahl, gruppenWahl{Name: g, Wert: g, Aktiv: g == d.Gruppe})
		}
	}
	d.Reaktionen = d.Abgleich.Aktiv
	if f := q.Get("fehler"); f != "" {
		d.Fehler = f
	}
	d.Meldung = q.Get("meldung")

	von, bis, fehler := statistikZeitraum(d.Von, d.Bis)
	if fehler != "" {
		d.Fehler = fehler
	}

	d.Zeitraeume = zeitraeume(d.Von, d.Bis)

	st, err := srv.store.Statistik(von, bis, d.Gruppe)
	if err != nil {
		d.Fehler = sicherFehlertext(err.Error())
		srv.rendere(w, "statistik", d)
		return
	}

	d.Gesamt = statistikFormat(st.Gesamt, 0)
	d.Menge = mengenAnzeige{
		Gewinn: st.Menge.Gewinn.Euro(), Klasse: zahlklasse(float64(st.Menge.Gewinn)),
		Deals: st.Menge.Deals, MitLimit: st.Menge.MitLimit, B2B: st.Menge.B2B, Standard: st.Menge.Standard,
		B2BChannels: "#" + strings.Join(st.Menge.B2BChannels, ", #"),
	}
	if len(st.Menge.B2BChannels) == 0 {
		d.Menge.B2BChannels = ""
	}
	if st.Gesamt.Anzahl > 0 {
		d.Tabellen = []statistikTabelleDaten{
			{Titel: "Je Monat", Zeilen: statistikTabelle(st.Monate, func(g string) string {
				t, err := time.Parse("2006-01", g)
				if err != nil {
					return g
				}
				return monatsnamen[t.Month()-1] + " " + strconv.Itoa(t.Year())
			})},
			{Titel: "Je Gruppe", Zeilen: statistikTabelle(st.Gruppen, func(g string) string {
				if g == "" {
					return "ohne Gruppe"
				}
				return g
			})},
			{Titel: "Je Poster", Zeilen: statistikTabelle(st.Poster, func(g string) string {
				if g == "" {
					return "unbekannt"
				}
				return "@" + g
			})},
			{Titel: "Je Channel", Zeilen: statistikTabelle(st.Channel, func(g string) string { return "#" + g })},
			{Titel: "Je Zielmarkt (Leitmarkt)", Zeilen: statistikTabelle(st.Maerkte, func(g string) string { return "Amazon." + g })},
			{Titel: "Einkaufsquellen", Zeilen: statistikTabelle(st.Quellen, func(g string) string { return g })},
		}
	}
	// "Je Poster" nur, wenn überhaupt schon jemand eingetragen ist.
	mitPoster := false
	for _, z := range st.Poster {
		mitPoster = mitPoster || z.Gruppe != ""
	}
	if mitPoster {
		d.PosterDiagramm = posterDiagramm(st.Poster, st.Gesamt.Anzahl)
		d.PosterUnbekannt = d.PosterDiagramm[len(d.PosterDiagramm)-1].Unbekannt
	}
	if !mitPoster {
		for i := range d.Tabellen {
			if d.Tabellen[i].Titel == "Je Poster" {
				d.Tabellen = append(d.Tabellen[:i], d.Tabellen[i+1:]...)
				break
			}
		}
	}
	// "Je Gruppe" nur, wenn es mehr als eine Gruppe zu vergleichen gibt.
	if d.Gruppe != "" || len(st.Gruppen) < 2 {
		for i := range d.Tabellen {
			if d.Tabellen[i].Titel == "Je Gruppe" {
				d.Tabellen = append(d.Tabellen[:i], d.Tabellen[i+1:]...)
				break
			}
		}
	}
	for i := range d.Tabellen {
		d.Tabellen[i].Reaktionen = d.Reaktionen
	}
	d.Rueckmeldung = rueckmeldungAus(st.Reaktionen, d.Reaktionen)
	for _, b := range st.Dauerbrenner {
		d.Dauerbrenner = append(d.Dauerbrenner, dauerbrennerZeile{
			ASIN: b.ASIN, Titel: b.Titel, LetzterDeal: b.LetzterDeal,
			Anzahl: b.Anzahl, Kaeufe: b.Kaeufe, Marge: prozent(b.MargeSchnitt, 1),
			Zuletzt: b.ZuletztAm.Local().Format("02.01.2006"),
		})
	}
	for _, t := range st.TopKaeufe {
		d.TopKaeufe = append(d.TopKaeufe, topKaufZeile{
			ID: t.ID, ASIN: t.ASIN, Titel: t.Titel,
			Datum: t.GepostetAm.Local().Format("02.01.2006"), Kaeufe: t.Kaeufe,
			Gewinn: t.EffGewinnCent.Euro(), Marge: prozent(t.EffMargeProzent, 1), Status: t.Status,
		})
	}

	srv.rendere(w, "statistik", d)
}

func statistikTabelle(zeilen []store.StatistikZeile, name func(string) string) []statistikZeile {
	groesste := 0
	for _, z := range zeilen {
		groesste = max(groesste, z.Anzahl)
	}
	out := make([]statistikZeile, 0, len(zeilen))
	for _, z := range zeilen {
		f := statistikFormat(z, groesste)
		f.Name = name(z.Gruppe)
		out = append(out, f)
	}
	return out
}

func statistikFormat(z store.StatistikZeile, groesste int) statistikZeile {
	f := statistikZeile{
		Name:         z.Gruppe,
		Anzahl:       z.Anzahl,
		Ausverkauft:  z.Ausverkauft,
		Gewinn:       z.Gewinn.Euro(),
		Marge:        prozent(z.MargeSchnitt, 1),
		GewinnKlasse: zahlklasse(float64(z.Gewinn)),
	}
	if groesste > 0 {
		f.Balken = z.Anzahl * 100 / groesste
	}
	f.Kaeufe = z.Kaeufe
	if z.Anzahl > 0 {
		f.Kaufquote = prozent(float64(z.MitKauf)*100/float64(z.Anzahl), 0)
	}
	return f
}

func rueckmeldungAus(r store.ReaktionsUebersicht, botAktiv bool) reaktionsDaten {
	d := reaktionsDaten{
		Zeigen:    botAktiv || r.Abgerufen > 0,
		Abgerufen: r.Abgerufen, NichtAbgeruf: r.NichtAbgeruf,
		MitKauf: r.MitKauf, NurWeg: r.NurWeg, OhneReaktion: r.OhneReaktion,
		Kaeufe: r.Kaeufe, Weg: r.Weg,
	}
	if r.Abgerufen > 0 {
		d.AnteilMitKauf = r.MitKauf * 100 / r.Abgerufen
		d.AnteilNurWeg = r.NurWeg * 100 / r.Abgerufen
		d.AnteilOhne = 100 - d.AnteilMitKauf - d.AnteilNurWeg
	}
	for _, deal := range r.Liste {
		z := reaktionsZeile{
			ID: deal.ID, Titel: deal.Titel, ASIN: deal.ASIN,
			Datum: deal.GepostetAm.Local().Format("02.01.2006"), Channel: deal.ChannelName,
			Kaeufe: deal.Kaeufe, Weg: deal.NichtVerfuegbar, Status: deal.Status,
		}
		switch {
		case deal.Kaeufe > 0:
			z.Ergebnis, z.Klasse = "gekauft", "positiv"
		case deal.NichtVerfuegbar > 0:
			z.Ergebnis, z.Klasse = "nicht gekauft, nicht mehr verfügbar", "negativ"
		default:
			z.Ergebnis, z.Klasse = "keine Reaktion", "neutral"
		}
		d.Liste = append(d.Liste, z)
	}
	return d
}

// posterDiagramm macht aus der Tabelle je Poster die Balken. Deals ohne
// Poster (vor der Einführung gepostet) stehen als „unbekannt“ am Ende.
func posterDiagramm(zeilen []store.StatistikZeile, gesamt int) []posterBalken {
	groesste := 0
	for _, z := range zeilen {
		groesste = max(groesste, z.Anzahl)
	}
	var out, unbekannt []posterBalken
	for _, z := range zeilen {
		b := posterBalken{Name: "@" + z.Gruppe, Anzahl: z.Anzahl, Gewinn: z.Gewinn.Euro(), Kaeufe: z.Kaeufe}
		if groesste > 0 {
			b.Balken = z.Anzahl * 100 / groesste
		}
		if gesamt > 0 {
			b.Anteil = (z.Anzahl*100 + gesamt/2) / gesamt
		}
		if z.Gruppe == "" {
			b.Name, b.Unbekannt = "unbekannt", true
			unbekannt = append(unbekannt, b)
			continue
		}
		out = append(out, b)
	}
	return append(out, unbekannt...)
}

// statistikZeitraum liest von und bis (JJJJ-MM-TT). bis gilt einschließlich
// des ganzen Tages; leer begrenzt nicht.
func statistikZeitraum(vonText, bisText string) (von, bis time.Time, fehler string) {
	if vonText != "" {
		t, err := time.ParseInLocation("2006-01-02", vonText, time.Local)
		if err != nil {
			fehler = "Datum „von“ nicht lesbar"
		}
		von = t
	}
	if bisText != "" {
		t, err := time.ParseInLocation("2006-01-02", bisText, time.Local)
		if err != nil {
			fehler = "Datum „bis“ nicht lesbar"
		} else {
			bis = t.AddDate(0, 0, 1).Add(-time.Nanosecond)
		}
	}
	return von, bis, fehler
}

// zeitraeume ist die Schnellwahl über der Statistik; aktiv ist der, der
// genau von und bis entspricht.
func zeitraeume(von, bis string) []zeitraum {
	heute := time.Now()
	monatsAnfang := time.Date(heute.Year(), heute.Month(), 1, 0, 0, 0, 0, time.Local)
	tag := func(t time.Time) string { return t.Format("2006-01-02") }
	var out []zeitraum
	for _, z := range []zeitraum{
		{Name: "Dieser Monat", Von: tag(monatsAnfang)},
		{Name: "Letzter Monat", Von: tag(monatsAnfang.AddDate(0, -1, 0)), Bis: tag(monatsAnfang.AddDate(0, 0, -1))},
		{Name: "Letzte 3 Monate", Von: tag(monatsAnfang.AddDate(0, -2, 0))},
		{Name: "Dieses Jahr", Von: tag(time.Date(heute.Year(), 1, 1, 0, 0, 0, 0, time.Local))},
		{Name: "Alles"},
	} {
		z.Aktiv = z.Von == von && z.Bis == bis
		out = append(out, z)
	}
	return out
}

// standardVon ist der Beginn des laufenden Monats, wenn die Adresse gar
// keinen Zeitraum nennt — ein Klick auf "Statistik" zeigt so den aktuellen
// Monat und rechnet nicht jedes Mal alles durch. "Alles" schickt von und
// bis ausdrücklich leer mit und bleibt damit alles.
func standardVon(q url.Values, von string) string {
	if q.Has("von") || q.Has("bis") {
		return von
	}
	heute := time.Now()
	return time.Date(heute.Year(), heute.Month(), 1, 0, 0, 0, 0, time.Local).Format("2006-01-02")
}
