package web

import (
	"net/http"
	"strconv"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Das Werbebild fasst die Statistik für Instagram, TikTok und Co. zusammen.
// Gezeichnet wird es im Browser auf einem Canvas: dieselbe Fläche ist
// Vorschau und Download, Texte und Format lassen sich ohne neue Anfrage
// ändern, und der Server braucht keine eigene Schrift- und Bildtechnik.
// Von hier kommen nur die Zahlen.

// bildDaten sind die Zahlen für das Werbebild, als JSON in die Seite
// geschrieben. Beträge in Cent, damit der Browser selbst formatiert.
type bildDaten struct {
	Zeitraum   string  `json:"zeitraum"`
	Deals      int     `json:"deals"`
	GewinnCent int64   `json:"gewinnCent"`
	Marge      float64 `json:"marge"`
	Reaktionen bool    `json:"reaktionen"`
	Kaeufe     int     `json:"kaeufe"`
	MitKauf    int     `json:"mitKauf"` // Prozent der Deals mit mind. einem Kauf
	KaeufeCent int64   `json:"kaeufeCent"`
	// MengeCent ist der Gewinn mit Cart-Limit ohne B2B, MengeStueck die
	// Stückzahl für Deals ohne Cart-Limit.
	MengeCent   int64        `json:"mengeCent"`
	MengeStueck int          `json:"mengeStueck"`
	Top         []bildDeal   `json:"top"`
	Emoji       string       `json:"emoji"`
	Poster      []bildPoster `json:"poster"`

	// Für die ausführliche Discord-Auswertung: meistgekaufte Deals,
	// Einkaufsquellen und Zielmärkte.
	TopKaeufe []bildDeal   `json:"topKaeufe"`
	Quellen   []bildAnzahl `json:"quellen"`
	Maerkte   []bildAnzahl `json:"maerkte"`
}

type bildAnzahl struct {
	Name   string `json:"name"`
	Anzahl int    `json:"anzahl"`
}

type bildDeal struct {
	Titel      string  `json:"titel"`
	GewinnCent int64   `json:"gewinnCent"`
	Marge      float64 `json:"marge"`
	PanEU      bool    `json:"panEU"`
	Poster     string  `json:"poster"`
	Kaeufe     int     `json:"kaeufe"`
}

type bildPoster struct {
	Name       string `json:"name"`
	Anzahl     int    `json:"anzahl"`
	GewinnCent int64  `json:"gewinnCent"`
	Kaeufe     int    `json:"kaeufe"`
}

type statistikBildSeite struct {
	Titel     string
	TokenText string
	Fehler    string

	Von, Bis    string
	Gruppe      string
	Zeitraeume  []zeitraum
	GruppenWahl []gruppenWahl

	Daten bildDaten
}

func (srv *Server) zeigeStatistikBild(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	d := statistikBildSeite{
		Titel:     "Statistik",
		TokenText: srv.tokenText(),
		Von:       q.Get("von"),
		Bis:       q.Get("bis"),
		Gruppe:    q.Get("gruppe"),
	}
	d.Von = standardVon(q, d.Von)
	d.Zeitraeume = zeitraeume(d.Von, d.Bis)
	if gruppen, _ := srv.store.Gruppen(); len(gruppen) > 0 {
		d.GruppenWahl = append(d.GruppenWahl, gruppenWahl{Name: "Alle", Aktiv: d.Gruppe == ""})
		for _, g := range gruppen {
			d.GruppenWahl = append(d.GruppenWahl, gruppenWahl{Name: g, Wert: g, Aktiv: g == d.Gruppe})
		}
	}

	von, bis, fehler := statistikZeitraum(d.Von, d.Bis)
	d.Fehler = fehler
	st, err := srv.store.Statistik(von, bis, d.Gruppe)
	if err != nil {
		d.Fehler = sicherFehlertext(err.Error())
	}

	g := st.Gesamt
	d.Daten = bildDaten{
		Zeitraum:    zeitraumText(von, bis, st.Erster, st.Letzter),
		Deals:       g.Anzahl,
		GewinnCent:  int64(g.Gewinn),
		Marge:       g.MargeSchnitt,
		Reaktionen:  srv.store.Einstellung(store.SchluesselBotToken) != "",
		Kaeufe:      g.Kaeufe,
		KaeufeCent:  int64(g.GewinnKaeufe),
		MengeCent:   int64(st.Menge.Gewinn),
		MengeStueck: st.Menge.Standard,
		Emoji:       emojiAnzeige(srv.store.Einstellung(store.SchluesselReaktionGekauft)),
		Top:         []bildDeal{},
		Poster:      []bildPoster{},
	}
	if g.Anzahl > 0 {
		d.Daten.MitKauf = (g.MitKauf*100 + g.Anzahl/2) / g.Anzahl
	}
	alsBild := func(t store.Deal) bildDeal {
		return bildDeal{
			Titel: t.Titel, GewinnCent: int64(t.EffGewinnCent), Marge: t.EffMargeProzent, PanEU: t.PanEU,
			Poster: t.Poster, Kaeufe: t.Kaeufe,
		}
	}
	for _, t := range st.TopGewinn {
		d.Daten.Top = append(d.Daten.Top, alsBild(t))
	}
	d.Daten.TopKaeufe = []bildDeal{}
	for i, t := range st.TopKaeufe {
		if i < 5 {
			d.Daten.TopKaeufe = append(d.Daten.TopKaeufe, alsBild(t))
		}
	}
	for _, p := range st.Poster {
		if p.Gruppe != "" {
			d.Daten.Poster = append(d.Daten.Poster, bildPoster{Name: "@" + p.Gruppe, Anzahl: p.Anzahl,
				GewinnCent: int64(p.Gewinn), Kaeufe: p.Kaeufe})
		}
	}
	d.Daten.Quellen, d.Daten.Maerkte = []bildAnzahl{}, []bildAnzahl{}
	for i, q := range st.Quellen {
		if i < 6 {
			d.Daten.Quellen = append(d.Daten.Quellen, bildAnzahl{Name: q.Gruppe, Anzahl: q.Anzahl})
		}
	}
	for _, m := range st.Maerkte {
		d.Daten.Maerkte = append(d.Daten.Maerkte, bildAnzahl{Name: "Amazon." + m.Gruppe, Anzahl: m.Anzahl})
	}
	srv.rendere(w, "statistikbild", d)
}

// zeitraumText beschreibt den Zeitraum des Bildes in Monaten: "September
// 2026", "August – September 2026" oder "Dezember 2025 – Januar 2026".
// Grenzen aus dem Filter gehen vor, sonst gelten der erste und der letzte
// Post; ein bis in der Zukunft endet heute.
func zeitraumText(von, bis, erster, letzter time.Time) string {
	anfang, ende := erster, letzter
	if !von.IsZero() {
		anfang = von
	}
	if !bis.IsZero() {
		ende = bis
	}
	if heute := time.Now(); ende.IsZero() || ende.After(heute) {
		ende = heute
	}
	if anfang.IsZero() {
		anfang = ende
	}
	anfang, ende = anfang.Local(), ende.Local()
	monat := func(t time.Time) string { return monatsnamen[t.Month()-1] }
	jahr := func(t time.Time) string { return strconv.Itoa(t.Year()) }
	switch {
	case anfang.Year() == ende.Year() && anfang.Month() == ende.Month():
		return monat(ende) + " " + jahr(ende)
	case anfang.Year() == ende.Year():
		return monat(anfang) + " – " + monat(ende) + " " + jahr(ende)
	default:
		return monat(anfang) + " " + jahr(anfang) + " – " + monat(ende) + " " + jahr(ende)
	}
}
