package web

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Die Seite „Monitor": Produkte, Regeln und das Protokoll des Shop-Monitors
// (siehe monitorlauf.go).

type monitorProduktAnzeige struct {
	store.MonitorProdukt
	// Anzeige ist der Name, oder der Link, solange es keinen gibt.
	Anzeige    string
	MaxEKText  string
	AnkaufText string
	Geprueft   string
	BesterText string
}

type monitorRegelAnzeige struct {
	store.MonitorRegel
	ChannelName   string
	ProduktName   string
	MinGewinnText string
	MinMargeText  string
}

type monitorTrefferAnzeige struct {
	store.MonitorTreffer
	ZeitText   string
	GesamtText string
	GewinnText string
	MargeText  string
}

type monitorDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string

	Aktiv       bool
	Intervall   int
	Sperre      int
	MaxTage     int
	Poster      string
	PosterListe []posterEintrag

	Produkte   []monitorProduktAnzeige
	Kategorien []string
	Regeln     []monitorRegelAnzeige
	Treffer    []monitorTrefferAnzeige
	Channels   []store.Channel
	Maerkte    []marketplace.Marketplace

	// Test ist das Ergebnis des Knopfs „Testen", nil ohne Test.
	Test      *monitorBericht
	TestName  string
	TestCount int
}

func (srv *Server) monitorDaten() monitorDaten {
	d := monitorDaten{
		Titel:       "Monitor",
		TokenText:   srv.tokenText(),
		Aktiv:       srv.store.Einstellung(store.SchluesselMonitorAktiv) == "1",
		Intervall:   srv.store.EinstellungZahl(store.SchluesselMonitorIntervall),
		Sperre:      srv.store.EinstellungZahl(store.SchluesselMonitorSperre),
		MaxTage:     srv.store.EinstellungZahl(store.SchluesselMonitorMaxTage),
		Poster:      srv.store.Einstellung(store.SchluesselMonitorPoster),
		PosterListe: srv.posterListe(),
		Maerkte:     marketplace.All(),
	}
	d.Channels, _ = srv.store.Channels()
	kanalName := map[int64]string{}
	for _, c := range d.Channels {
		kanalName[c.ID] = c.Name
	}

	produkte, err := srv.store.MonitorProdukte()
	if err != nil {
		d.Fehler = "Monitor-Produkte nicht lesbar: " + sicherFehlertext(err.Error())
	}
	produktName := map[int64]string{}
	for _, p := range produkte {
		a := monitorProduktAnzeige{MonitorProdukt: p}
		if p.MaxEK > 0 {
			a.MaxEKText = p.MaxEK.String()
		}
		if p.Ankauf > 0 {
			a.AnkaufText = p.Ankauf.String()
		}
		if !p.GeprueftAm.IsZero() {
			a.Geprueft = p.GeprueftAm.Local().Format("02.01. 15:04:05")
		}
		if p.BesterShop != "" {
			a.BesterText = p.BesterCent.Euro() + " bei " + p.BesterShop
		}
		a.Anzeige = p.Name
		if a.Anzeige == "" {
			a.Anzeige = p.URL
		}
		produktName[p.ID] = a.Anzeige
		if k := strings.TrimSpace(p.Kategorie); k != "" && !enthaelt(d.Kategorien, k) {
			d.Kategorien = append(d.Kategorien, k)
		}
		d.Produkte = append(d.Produkte, a)
	}

	regeln, _ := srv.store.MonitorRegeln()
	for _, r := range regeln {
		a := monitorRegelAnzeige{MonitorRegel: r, ChannelName: kanalName[r.ChannelID], ProduktName: "alle Produkte"}
		if a.ChannelName == "" {
			a.ChannelName = "(gelöschter Channel)"
		}
		if r.ProduktID != 0 {
			a.ProduktName = produktName[r.ProduktID]
		}
		if r.MinGewinn > 0 {
			a.MinGewinnText = r.MinGewinn.Euro()
		}
		if r.MinMarge > 0 {
			a.MinMargeText = prozent(r.MinMarge, 1)
		}
		d.Regeln = append(d.Regeln, a)
	}

	treffer, _ := srv.store.MonitorLetzteTreffer(30)
	for _, t := range treffer {
		d.Treffer = append(d.Treffer, monitorTrefferAnzeige{
			MonitorTreffer: t,
			ZeitText:       t.Zeit.Local().Format("02.01. 15:04"),
			GesamtText:     t.Gesamt.Euro(),
			GewinnText:     t.Gewinn.Euro(),
			MargeText:      prozent(t.MargeProzent, 1),
		})
	}
	return d
}

func enthaelt(liste []string, s string) bool {
	for _, e := range liste {
		if strings.EqualFold(e, s) {
			return true
		}
	}
	return false
}

// enthaeltCode sagt der Vorlage, ob ein Marktkürzel in einer Liste mit Komma
// steht.
func enthaeltCode(liste, code string) bool {
	for _, c := range strings.Split(liste, ",") {
		if strings.EqualFold(strings.TrimSpace(c), code) {
			return true
		}
	}
	return false
}

func (srv *Server) zeigeMonitor(w http.ResponseWriter, r *http.Request) {
	srv.rendere(w, "monitor", srv.monitorDaten())
}

func (srv *Server) monitorMeldung(w http.ResponseWriter, meldung, fehler string) {
	d := srv.monitorDaten()
	d.Meldung, d.Fehler = meldung, fehler
	srv.rendere(w, "monitor", d)
}

// betragOderNull liest einen optionalen Betrag: leer heißt 0.
func betragOderNull(s string) (money.Cents, error) {
	if strings.TrimSpace(s) == "" {
		return 0, nil
	}
	return money.Parse(s)
}

// ankaufFelder liest Modus, Ankaufspreis, Preiswecker, Hinweis und Kategorie.
// Fehlt im Ankaufs-Modus der Preiswecker, gilt 95 % des Ankaufspreises —
// also 5 % Marge, so wie ihr ihn bisher setzt.
func ankaufFelder(r *http.Request, p *store.MonitorProdukt) string {
	p.Modus = store.ModusAmazon
	if r.PostForm.Get("modus") == store.ModusAnkauf {
		p.Modus = store.ModusAnkauf
	}
	p.Hinweis = r.PostForm.Get("hinweis")
	p.Kategorie = r.PostForm.Get("kategorie")
	ankauf, err := betragOderNull(r.PostForm.Get("ankauf"))
	if err != nil || ankauf < 0 {
		return "Ankaufspreis: kein gültiger Betrag."
	}
	p.Ankauf = ankauf
	if p.IstAnkauf() {
		if p.Ankauf == 0 {
			return "Im Modus Ankauf ist der Ankaufspreis Pflicht."
		}
		if p.MaxEK == 0 {
			p.MaxEK = money.Cents(int64(p.Ankauf) * 95 / 100)
		}
		if p.MaxEK > p.Ankauf {
			return "Der Preiswecker liegt über dem Ankaufspreis — so gäbe es nur Verlust-Deals."
		}
	}
	return ""
}

// maerkteAusFormular liest die angehakten Zielmärkte als Liste mit Komma.
func maerkteAusFormular(r *http.Request) string {
	var codes []string
	for _, m := range marketplace.Codes(r.PostForm["zielmarkt"]) {
		codes = append(codes, string(m.Code))
	}
	return strings.Join(codes, ",")
}

func (srv *Server) speichereMonitorProdukt(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	link, err := billiger.NormalisiereURL(r.PostForm.Get("url"))
	if err != nil {
		srv.monitorMeldung(w, "", err.Error())
		return
	}
	maxEK, err := betragOderNull(r.PostForm.Get("max_ek"))
	if err != nil || maxEK < 0 {
		srv.monitorMeldung(w, "", "Höchstpreis: kein gültiger Betrag.")
		return
	}
	asin := strings.ToUpper(strings.TrimSpace(r.PostForm.Get("asin")))
	if asin != "" && !asinMuster.MatchString(asin) {
		srv.monitorMeldung(w, "", "Die ASIN hat zehn Zeichen, etwa B0CHSBV9CN — oder leer lassen, dann sucht der Monitor sie über die EAN.")
		return
	}
	neu := store.MonitorProdukt{
		Name: r.PostForm.Get("name"), URL: link, ASIN: asin,
		Maerkte: maerkteAusFormular(r), MaxEK: maxEK,
		Shops: r.PostForm.Get("shops"), AuchVerzoegert: r.PostForm.Get("auch_verzoegert") == "1",
		Aktiv: true,
	}
	if f := ankaufFelder(r, &neu); f != "" {
		srv.monitorMeldung(w, "", f)
		return
	}
	_, err = srv.store.MonitorProduktAnlegen(neu)
	if err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Produkt angelegt. Mit „Testen“ siehst du sofort, was der Monitor daraus machen würde.", "")
}

func (srv *Server) aendereMonitorProdukt(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	p, err := srv.store.MonitorProdukt(idAusPfad(r))
	if err != nil {
		srv.monitorMeldung(w, "", "Produkt nicht gefunden.")
		return
	}
	maxEK, err := betragOderNull(r.PostForm.Get("max_ek"))
	if err != nil || maxEK < 0 {
		srv.monitorMeldung(w, "", "Höchstpreis: kein gültiger Betrag.")
		return
	}
	asin := strings.ToUpper(strings.TrimSpace(r.PostForm.Get("asin")))
	if asin != "" && !asinMuster.MatchString(asin) {
		srv.monitorMeldung(w, "", "Die ASIN hat zehn Zeichen, etwa B0CHSBV9CN.")
		return
	}
	p.Name, p.ASIN, p.MaxEK = r.PostForm.Get("name"), asin, maxEK
	p.Maerkte = maerkteAusFormular(r)
	p.Shops = r.PostForm.Get("shops")
	p.AuchVerzoegert = r.PostForm.Get("auch_verzoegert") == "1"
	if f := ankaufFelder(r, &p); f != "" {
		srv.monitorMeldung(w, "", f)
		return
	}
	if err := srv.store.MonitorProduktAendern(p); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Gespeichert.", "")
}

func (srv *Server) schalteMonitorProdukt(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	_ = srv.store.MonitorProduktAktiv(idAusPfad(r), r.PostForm.Get("aktiv") == "1")
	srv.monitorMeldung(w, "Gespeichert.", "")
}

func (srv *Server) loescheMonitorProdukt(w http.ResponseWriter, r *http.Request) {
	if err := srv.store.MonitorProduktLoeschen(idAusPfad(r)); err != nil {
		srv.monitorMeldung(w, "", "Löschen fehlgeschlagen: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Produkt gelöscht.", "")
}

// testeMonitorProdukt prüft ein Produkt sofort, postet aber nicht: es zeigt
// den Post, der hinausginge, und die Channels, in die er ginge.
func (srv *Server) testeMonitorProdukt(w http.ResponseWriter, r *http.Request) {
	p, err := srv.store.MonitorProdukt(idAusPfad(r))
	if err != nil {
		srv.monitorMeldung(w, "", "Produkt nicht gefunden.")
		return
	}
	b := srv.monitorPruefe(r.Context(), p, true)
	d := srv.monitorDaten()
	d.Test = &b
	d.TestName = p.Name
	if d.TestName == "" {
		d.TestName = p.URL
	}
	srv.rendere(w, "monitor", d)
}

func (srv *Server) speichereMonitorRegel(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	channelID, _ := strconv.ParseInt(r.PostForm.Get("channel_id"), 10, 64)
	if _, err := srv.store.Channel(channelID); err != nil || channelID == 0 {
		srv.monitorMeldung(w, "", "Bitte einen Channel wählen.")
		return
	}
	produktID, _ := strconv.ParseInt(r.PostForm.Get("produkt_id"), 10, 64)
	minGewinn, err := betragOderNull(r.PostForm.Get("min_gewinn"))
	if err != nil {
		srv.monitorMeldung(w, "", "Mindestgewinn: kein gültiger Betrag.")
		return
	}
	minMarge := 0.0
	if s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(r.PostForm.Get("min_marge")), "%")); s != "" {
		minMarge, err = strconv.ParseFloat(strings.ReplaceAll(s, ",", "."), 64)
		if err != nil {
			srv.monitorMeldung(w, "", "Mindestmarge: keine Zahl.")
			return
		}
	}
	minSales := 0
	if s := strings.TrimSpace(r.PostForm.Get("min_sales")); s != "" {
		minSales, err = strconv.Atoi(s)
		if err != nil || minSales < 0 {
			srv.monitorMeldung(w, "", "Mindestverkäufe: keine ganze Zahl.")
			return
		}
	}
	if _, err := srv.store.MonitorRegelAnlegen(store.MonitorRegel{
		Name: r.PostForm.Get("name"), ChannelID: channelID, ProduktID: produktID,
		MinMarge: minMarge, MinGewinn: minGewinn, MinSales: minSales,
		Shops: r.PostForm.Get("shops"), Aktiv: true,
		Modus:     modusFilter(r.PostForm.Get("modus")),
		Kategorie: r.PostForm.Get("kategorie"),
	}); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Regel angelegt.", "")
}

func modusFilter(m string) string {
	if m == store.ModusAmazon || m == store.ModusAnkauf {
		return m
	}
	return ""
}

func (srv *Server) schalteMonitorRegel(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	_ = srv.store.MonitorRegelAktiv(idAusPfad(r), r.PostForm.Get("aktiv") == "1")
	srv.monitorMeldung(w, "Gespeichert.", "")
}

func (srv *Server) loescheMonitorRegel(w http.ResponseWriter, r *http.Request) {
	_ = srv.store.MonitorRegelLoeschen(idAusPfad(r))
	srv.monitorMeldung(w, "Regel gelöscht.", "")
}

func (srv *Server) speichereMonitorEinstellungen(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	intervall, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("intervall")))
	if err != nil || intervall < int(monitorMindestIntervall.Seconds()) {
		srv.monitorMeldung(w, "", "Prüfintervall: mindestens "+strconv.Itoa(int(monitorMindestIntervall.Seconds()))+" Sekunden.")
		return
	}
	sperre, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("sperre")))
	if err != nil || sperre < 0 {
		srv.monitorMeldung(w, "", "Sperrzeit: keine ganze Zahl.")
		return
	}
	maxTage, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("max_tage")))
	if err != nil || maxTage < 0 {
		srv.monitorMeldung(w, "", "Max. Lieferzeit: keine ganze Zahl (0 heißt keine Grenze).")
		return
	}
	poster := strings.TrimSpace(r.PostForm.Get("poster"))
	if _, ok := srv.poster(poster); poster != "" && !ok {
		poster = ""
	}
	aktiv := "0"
	if r.PostForm.Get("aktiv") == "1" {
		aktiv = "1"
	}
	for k, v := range map[string]string{
		store.SchluesselMonitorAktiv:     aktiv,
		store.SchluesselMonitorIntervall: strconv.Itoa(intervall),
		store.SchluesselMonitorSperre:    strconv.Itoa(sperre),
		store.SchluesselMonitorMaxTage:   strconv.Itoa(maxTage),
		store.SchluesselMonitorPoster:    poster,
	} {
		if err := srv.store.SetzeEinstellung(k, v); err != nil {
			srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
			return
		}
	}
	if aktiv == "1" {
		srv.monitorMeldung(w, "Gespeichert — der Monitor läuft.", "")
		return
	}
	srv.monitorMeldung(w, "Gespeichert — der Monitor ist aus.", "")
}
