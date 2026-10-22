package web

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/podcast"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Die Seite „Monitor": Produkte, Regeln und das Protokoll des Shop-Monitors
// (siehe monitorlauf.go).

type monitorProduktAnzeige struct {
	store.MonitorProdukt
	// Anzeige ist der Name, oder der Link, solange es keinen gibt.
	Anzeige    string
	Ankaeufer  []ankaeuferAnzeige
	WeckerText string
	MaxEKText  string
	AnkaufText string
	Geprueft   string
	BesterText string
	// MarktWahl sind die Zielmärkte, EinkaufWahl die Einkaufsmärkte (nur
	// bei der ASIN-Liste) — je Markt mit Häkchen.
	MarktWahl   []marktWahl
	EinkaufWahl []marktWahl
}

type marktWahl struct {
	Code string
	An   bool
}

type podcastKategorie struct {
	ID   int
	Name string
}

type rabattAnzeige struct {
	store.ShopRabatt
	FestText, AbText, CashbackText string
}

type ankaeuferAnzeige struct {
	store.Ankaeufer
	PreisText string
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
	// ShopAnzahl und AsinAnzahl zählen die Produkte von billiger.de und die
	// der Amazon-ASIN-Liste; AsinBedarf ist deren Keepa-Verbrauch je Minute,
	// KeepaRate was Keepa je Minute nachlädt (0 = noch unbekannt).
	ShopAnzahl    int
	AsinAnzahl    int
	AsinBedarf    string
	KeepaRate     int
	AmazonMinuten int

	PrioHoch       int
	PrioNiedrig    int
	SturzProzent   int
	SturzChannel   int64
	AdminChannel   int64
	Mydealz        bool
	Ausverkauft    bool
	BasisURL       string
	ScanKategorien []store.MonitorKategorie
	Feeds          []feedAnzeige
	Rabatte        []rabattAnzeige
	RabatteAn      bool
	TagChannel     int64
	TagZeit        string
	EbayAppID      string
	EbaySellerURL  string
	SpotifyID      string
	SpotifyDa      bool
	EbaySellerDa   bool
	EbayCertDa     bool
	EbayGebuehr    string
	EbayFix        string
	EbayVersand    string
	Auswertung     auswertung
	Podcasts       []podcastAnzeige
	PodKategorien  []podcastKategorie

	// Import ist die geprüfte Liste vor dem Übernehmen, nil ohne Import.
	Import   []importVorschlag
	Regeln   []monitorRegelAnzeige
	Treffer  []monitorTrefferAnzeige
	Channels []store.Channel
	Maerkte  []marketplace.Marketplace

	// Varianten sind die Produktseiten einer eingefügten Sammelseite, zur
	// Auswahl; Mitnehmen sind die übrigen Eingaben, die dabei erhalten
	// bleiben.
	Varianten []billiger.Variante
	Mitnehmen []feldWert

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

		PrioHoch:     srv.store.EinstellungZahl(store.SchluesselMonitorHochSek),
		PrioNiedrig:  srv.store.EinstellungZahl(store.SchluesselMonitorNiedrigSek),
		SturzProzent: srv.store.EinstellungZahl(store.SchluesselMonitorSturzProzent),
		SturzChannel: int64(srv.store.EinstellungZahl(store.SchluesselMonitorSturzChannel)),
		AdminChannel: int64(srv.store.EinstellungZahl(store.SchluesselMonitorAdminChannel)),
		Mydealz:      srv.store.Einstellung(store.SchluesselMonitorMydealz) == "1",
		Ausverkauft:  srv.store.Einstellung(store.SchluesselMonitorAusverkauft) == "1",
		BasisURL:     srv.store.Einstellung(store.SchluesselMonitorBasisURL),
	}
	d.ScanKategorien, _ = srv.store.Kategorien()
	ankaeufer, _ := srv.store.AnkaeuferAlle()
	d.Channels, _ = srv.store.Channels()
	feedKanal := map[int64]string{}
	for _, c := range d.Channels {
		feedKanal[c.ID] = c.Name
	}
	d.Feeds = srv.feedAnzeigen(feedKanal)
	rs, _ := srv.store.ShopRabatte()
	for _, r := range rs {
		d.Rabatte = append(d.Rabatte, rabattAnzeige{ShopRabatt: r, FestText: r.Fest.Euro(), AbText: r.Ab.Euro(), CashbackText: prozent(r.Cashback, 1)})
	}
	d.RabatteAn = srv.store.Einstellung(store.SchluesselMonitorRabatte) == "1"
	d.TagChannel = int64(srv.store.EinstellungZahl(store.SchluesselMonitorTagChannel))
	d.TagZeit = srv.store.Einstellung(store.SchluesselMonitorTagZeit)
	d.EbayAppID = srv.store.Einstellung(store.SchluesselEbayAppID)
	d.EbaySellerURL = srv.store.Einstellung(store.SchluesselEbaySellerURL)
	d.SpotifyID = srv.store.Einstellung(store.SchluesselSpotifyID)
	d.SpotifyDa = srv.store.Einstellung(store.SchluesselSpotifySecret) != ""
	d.EbaySellerDa = srv.store.Einstellung(store.SchluesselEbaySellerKey) != ""
	d.EbayCertDa = srv.store.Einstellung(store.SchluesselEbayCertID) != ""
	d.EbayGebuehr = srv.store.Einstellung(store.SchluesselEbayGebuehr)
	d.EbayFix = srv.store.Einstellung(store.SchluesselEbayGebuehrFix)
	d.EbayVersand = srv.store.Einstellung(store.SchluesselEbayVersand)
	d.Auswertung = srv.auswertung(time.Now(), 30)
	d.Podcasts = srv.podcastAnzeigen(feedKanal)
	for _, k := range podcast.Kategorien {
		d.PodKategorien = append(d.PodKategorien, podcastKategorie{ID: k.ID, Name: k.Name})
	}
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
		for _, k := range ankaeufer[p.ID] {
			a.Ankaeufer = append(a.Ankaeufer, ankaeuferAnzeige{Ankaeufer: k, PreisText: k.Preis.Euro()})
		}
		eff := p
		if best, ok := einzelPreis(ankaeufer[p.ID]); ok && p.IstAnkauf() {
			eff.Ankauf = best
		}
		if p.IstAnkauf() {
			if wk := srv.wecker(eff); wk > 0 {
				a.WeckerText = wk.Euro()
				if p.MaxEK == 0 {
					a.WeckerText += " (95 %)"
				}
			}
		}
		a.Anzeige = p.Name
		if a.Anzeige == "" {
			a.Anzeige = p.URL
			if p.IstAmazonQuelle() {
				a.Anzeige = p.ASIN + " (Name kommt mit der ersten Prüfung)"
			}
		}
		for _, m := range marketplace.All() {
			a.MarktWahl = append(a.MarktWahl, marktWahl{Code: string(m.Code), An: enthaeltCode(p.Maerkte, string(m.Code))})
			if p.IstAmazonQuelle() {
				a.EinkaufWahl = append(a.EinkaufWahl, marktWahl{Code: string(m.Code), An: enthaeltCode(p.Einkauf, string(m.Code))})
			}
		}
		if p.IstAmazonQuelle() {
			d.AsinAnzahl++
		} else {
			d.ShopAnzahl++
		}
		produktName[p.ID] = a.Anzeige
		if k := strings.TrimSpace(p.Kategorie); k != "" && !enthaelt(d.Kategorien, k) {
			d.Kategorien = append(d.Kategorien, k)
		}
		d.Produkte = append(d.Produkte, a)
	}

	d.AsinBedarf = tokenText(srv.amazonTokenBedarf(produkte))
	d.AmazonMinuten = srv.amazonMinuten()
	srv.tokenMu.Lock()
	d.KeepaRate = srv.tokenRate
	srv.tokenMu.Unlock()

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

type feldWert struct{ Name, Wert string }

// betragOderNull liest einen optionalen Betrag: leer heißt 0.
func betragOderNull(s string) (money.Cents, error) {
	if strings.TrimSpace(s) == "" {
		return 0, nil
	}
	return money.Parse(s)
}

// ankaufFelder liest Modus, Ankaufspreis, Hinweis und Kategorie. Ein leerer
// Preiswecker bleibt leer: dann gilt bei jeder Prüfung 95 % des besten
// Ankaufs (siehe wecker) — er wandert also mit, wenn sich die Ankäufer
// ändern. Ohne Ankaufspreis geht es auch, sobald Ankäufer eingetragen sind.
func ankaufFelder(r *http.Request, p *store.MonitorProdukt) string {
	// Verkaufswege als Häkchen; mehrere zugleich sind erlaubt.
	p.Modus = store.ModiNormal(r.PostForm["modus"]...)
	p.Hinweis = r.PostForm.Get("hinweis")
	p.Kategorie = r.PostForm.Get("kategorie")
	p.Prio = r.PostForm.Get("prio")
	p.Stichworte = r.PostForm.Get("stichworte")
	p.Notiz = r.PostForm.Get("notiz")
	ankauf, err := betragOderNull(r.PostForm.Get("ankauf"))
	if err != nil || ankauf < 0 {
		return "Ankaufspreis: kein gültiger Betrag."
	}
	p.Ankauf = ankauf
	if p.IstAnkauf() && p.Ankauf > 0 && p.MaxEK > p.Ankauf {
		return "Der Preiswecker liegt über dem Ankaufspreis — so gäbe es nur Verlust-Deals."
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
	if sammel, ok := billiger.IstSammelseite(r.PostForm.Get("url")); ok {
		srv.zeigeVarianten(w, r, sammel)
		return
	}
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
	if alt, ok := srv.store.MonitorProduktZuURL(link); ok {
		// Gibt es das Produkt schon, kommt der Verkaufsweg dort dazu.
		alt.Modus = store.ModiNormal(alt.Modus, neu.Modus)
		if neu.Ankauf > 0 {
			alt.Ankauf = neu.Ankauf
		}
		if alt.Hinweis == "" {
			alt.Hinweis = neu.Hinweis
		}
		if err := srv.store.MonitorProduktAendern(alt); err != nil {
			srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
			return
		}
		srv.monitorMeldung(w, "Das Produkt wird schon beobachtet — die Verkaufswege sind dort ergänzt.", "")
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
	if p.IstAmazonQuelle() {
		if asin == "" {
			srv.monitorMeldung(w, "", "Ohne ASIN geht die ASIN-Liste nicht.")
			return
		}
		var einkauf []string
		for _, m := range marketplace.Codes(r.PostForm["einkauf"]) {
			einkauf = append(einkauf, string(m.Code))
		}
		if len(einkauf) == 0 {
			srv.monitorMeldung(w, "", "Bitte mindestens einen Einkaufsmarkt anhaken.")
			return
		}
		p.Einkauf = strings.Join(einkauf, ",")
	}
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
	if m == store.ModusAmazon || m == store.ModusAnkauf || m == store.ModusEbay {
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
	// behalte: ein fehlendes Feld lässt den Wert stehen; ein Geheimnis
	// (geheim=true) auch ein leeres — es wird nie zurück in die Seite
	// geschrieben.
	behalte := func(feld string, geheim bool) string {
		v := strings.TrimSpace(r.PostForm.Get(feld))
		if !r.PostForm.Has(feld) || (geheim && v == "") {
			return "keep"
		}
		return v
	}
	sellerURL := behalte("ebay_seller_url", false)
	if sellerURL != "keep" && sellerURL != "" {
		var ok bool
		if sellerURL, ok = gueltigeBasisURL(sellerURL); !ok {
			srv.monitorMeldung(w, "", "Adresse des Seller-Systems: bitte so angeben: https://seller.example.de")
			return
		}
	}
	tagZeit := "keep"
	if r.PostForm.Has("tag_zeit") {
		h, m := tageszeit(r.PostForm.Get("tag_zeit"))
		tagZeit = fmt.Sprintf("%02d:%02d", h, m)
	}
	basis, ok := gueltigeBasisURL(r.PostForm.Get("basis_url"))
	if !ok {
		srv.monitorMeldung(w, "", "Öffentliche Adresse: bitte so angeben: http://91.99.29.165:8080 oder https://deals.example.de")
		return
	}
	if !r.PostForm.Has("basis_url") {
		basis = "keep"
	}
	poster := strings.TrimSpace(r.PostForm.Get("poster"))
	if _, ok := srv.poster(poster); poster != "" && !ok {
		poster = ""
	}
	aktiv := "0"
	if r.PostForm.Get("aktiv") == "1" {
		aktiv = "1"
	}
	// Fehlt ein Feld (ältere Seite im Browser), bleibt der bisherige Wert.
	zahl := func(feld, schluessel string, min int) (string, bool) {
		if !r.PostForm.Has(feld) {
			return srv.store.Einstellung(schluessel), true
		}
		n, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get(feld)))
		return strconv.Itoa(n), err == nil && n >= min
	}
	hoch, ok1 := zahl("prio_hoch", store.SchluesselMonitorHochSek, int(monitorMindestIntervall.Seconds()))
	niedrig, ok2 := zahl("prio_niedrig", store.SchluesselMonitorNiedrigSek, int(monitorMindestIntervall.Seconds()))
	sturz, ok3 := zahl("sturz_prozent", store.SchluesselMonitorSturzProzent, 1)
	if !ok1 || !ok2 || !ok3 {
		srv.monitorMeldung(w, "", "Prio-Intervalle: mindestens 15 Sekunden; Preissturz: mindestens 1 %.")
		return
	}
	kanal := func(feld string) string {
		if !r.PostForm.Has(feld) {
			return "keep"
		}
		id, _ := strconv.ParseInt(r.PostForm.Get(feld), 10, 64)
		if _, err := srv.store.Channel(id); err != nil {
			return "0"
		}
		return strconv.FormatInt(id, 10)
	}
	// Ohne die neuen Felder (ältere Seite) bleiben auch die Schalter stehen.
	neueFelder := r.PostForm.Has("sturz_prozent")
	an := func(feld string) string {
		if !neueFelder {
			return "keep"
		}
		if r.PostForm.Get(feld) == "1" {
			return "1"
		}
		return "0"
	}
	amazonMin := "keep"
	if r.PostForm.Has("amazon_minuten") {
		n, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("amazon_minuten")))
		if err != nil || n < 5 {
			srv.monitorMeldung(w, "", "ASIN-Liste: höchstens alle 5 Minuten prüfen.")
			return
		}
		amazonMin = strconv.Itoa(n)
	}
	for k, v := range map[string]string{
		store.SchluesselMonitorAmazonMin:    amazonMin,
		store.SchluesselMonitorHochSek:      hoch,
		store.SchluesselMonitorNiedrigSek:   niedrig,
		store.SchluesselMonitorSturzProzent: sturz,
		store.SchluesselMonitorSturzChannel: kanal("sturz_channel"),
		store.SchluesselMonitorAdminChannel: kanal("admin_channel"),
		store.SchluesselMonitorMydealz:      an("mydealz"),
		store.SchluesselMonitorAusverkauft:  an("ausverkauft"),
		store.SchluesselMonitorBasisURL:     basis,
		store.SchluesselMonitorRabatte:      an("rabatte"),
		store.SchluesselMonitorTagChannel:   kanal("tag_channel"),
		store.SchluesselMonitorTagZeit:      tagZeit,
		store.SchluesselEbaySellerURL:       sellerURL,
		store.SchluesselEbaySellerKey:       behalte("ebay_seller_schluessel", true),
		store.SchluesselEbayAppID:           behalte("ebay_app_id", false),
		store.SchluesselSpotifyID:           behalte("spotify_id", false),
		store.SchluesselSpotifySecret:       behalte("spotify_secret", true),
		store.SchluesselEbayCertID:          behalte("ebay_cert_id", true),
		store.SchluesselEbayGebuehr:         behalte("ebay_gebuehr", false),
		store.SchluesselEbayGebuehrFix:      behalte("ebay_fix", false),
		store.SchluesselEbayVersand:         behalte("ebay_versand", false),
		store.SchluesselMonitorAktiv:        aktiv,
		store.SchluesselMonitorIntervall:    strconv.Itoa(intervall),
		store.SchluesselMonitorSperre:       strconv.Itoa(sperre),
		store.SchluesselMonitorMaxTage:      strconv.Itoa(maxTage),
		store.SchluesselMonitorPoster:       poster,
	} {
		if v == "keep" {
			continue
		}
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

// zeigeVarianten antwortet auf eine eingefügte Sammelseite mit ihren
// Varianten: je Variante ein Knopf, der das Produkt mit genau dieser Seite
// und allen übrigen Eingaben anlegt.
func (srv *Server) zeigeVarianten(w http.ResponseWriter, r *http.Request, sammel string) {
	varianten, err := billiger.HoleVarianten(r.Context(), srv.monitorClient(), sammel)
	if err != nil || len(varianten) == 0 {
		meldung := "Das ist eine Sammelseite mit mehreren Varianten. Bitte bei billiger.de die genaue Variante öffnen und deren Link einfügen."
		if err != nil {
			meldung += " (" + sicherFehlertext(err.Error()) + ")"
		}
		srv.monitorMeldung(w, "", meldung)
		return
	}
	d := srv.monitorDaten()
	d.Varianten = varianten
	for name, werte := range r.PostForm {
		if name == "url" {
			continue
		}
		for _, v := range werte {
			d.Mitnehmen = append(d.Mitnehmen, feldWert{name, v})
		}
	}
	srv.rendere(w, "monitor", d)
}
