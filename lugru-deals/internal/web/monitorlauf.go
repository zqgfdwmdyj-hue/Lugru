// Der Shop-Monitor: beobachtet Produkte bei billiger.de und postet einen
// Deal, sobald ein Shop (OTTO, Kaufland, MediaMarkt …) ihn günstig genug
// führt.
//
// Ein Treffer läuft durch genau dieselben Schritte wie ein Deal von Hand:
// Formular füllen, Keepa einlesen (keepaEinlesen), rechnen und den Post bauen
// (baueDeal), posten und in der Historie ablegen (posten). Der Post sieht
// darum aus wie jeder andere — dieselbe Vorlage, derselbe Chart, dieselben
// Reaktionen und Affiliate-Tags.
//
// In welche Channels ein Treffer geht, legen die Regeln fest: jede Regel
// nennt einen Channel und Mindestwerte für Marge, Gewinn und Verkäufe. Ein
// Treffer geht in jeden Channel, dessen Regel er erfüllt; erfüllt er keine,
// wird er nur protokolliert.
package web

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

const (
	// monitorTakt ist, wie oft nachgesehen wird, ob ein Produkt fällig ist.
	monitorTakt = 5 * time.Second
	// monitorPause liegt zwischen zwei Abrufen bei billiger.de — höflich
	// bleiben, sonst sperrt billiger.de den Server.
	monitorPause = 2 * time.Second
	// monitorMindestIntervall ist die kürzeste erlaubte Prüfzeit je Produkt.
	monitorMindestIntervall = 15 * time.Second
)

// monitorBericht ist das Ergebnis einer Prüfung.
type monitorBericht struct {
	Status string
	// Angebot ist das günstigste passende Angebot, falls es eines gibt.
	Angebot *billiger.Angebot
	// Bewertet: Keepa wurde gefragt und Gewinn und Marge sind bekannt.
	Bewertet bool
	Gewinn   money.Cents
	Marge    float64
	Sales    int
	// Channels sind die Channels, in die der Treffer geht (oder beim Test
	// ginge).
	Channels []store.Channel
	Gepostet bool
	// Karte und ChartURL sind die Vorschau des Posts beim Test.
	Karte    kartenVorschau
	ChartURL string

	// asin ist die ASIN, die bei der Bewertung benutzt wurde.
	asin string
}

// StarteMonitor prüft im Hintergrund die fälligen Produkte, solange der
// Monitor in den Einstellungen eingeschaltet ist.
func (srv *Server) StarteMonitor(ctx context.Context) {
	go func() {
		takt := time.NewTicker(monitorTakt)
		defer takt.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-takt.C:
			}
			if srv.store.Einstellung(store.SchluesselMonitorAktiv) != "1" {
				continue
			}
			srv.monitorNebenquellen(ctx)
			faellig, err := srv.store.MonitorFaelligJe(srv.prioIntervall, time.Now())
			if err != nil {
				log.Printf("Monitor: %v", err)
				continue
			}
			for i, p := range faellig {
				if ctx.Err() != nil {
					return
				}
				if i > 0 && !warteKurz(ctx, monitorPause) {
					return
				}
				b := srv.monitorPruefe(ctx, p, false)
				if b.Gepostet {
					log.Printf("Monitor: %s — %s", p.Name, b.Status)
				}
			}
		}
	}()
}

func warteKurz(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func (srv *Server) monitorIntervall() time.Duration {
	d := time.Duration(srv.store.EinstellungZahl(store.SchluesselMonitorIntervall)) * time.Second
	if d < monitorMindestIntervall {
		d = monitorMindestIntervall
	}
	return d
}

// prioIntervall ist die Prüfzeit eines Produkts nach seiner Prio-Stufe.
func (srv *Server) prioIntervall(p store.MonitorProdukt) time.Duration {
	sek := 0
	switch p.Prio {
	case store.PrioHoch:
		sek = srv.store.EinstellungZahl(store.SchluesselMonitorHochSek)
	case store.PrioNiedrig:
		sek = srv.store.EinstellungZahl(store.SchluesselMonitorNiedrigSek)
	default:
		return srv.monitorIntervall()
	}
	d := time.Duration(sek) * time.Second
	if d < monitorMindestIntervall {
		d = monitorMindestIntervall
	}
	return d
}

func (srv *Server) monitorSperre() time.Duration {
	return time.Duration(srv.store.EinstellungZahl(store.SchluesselMonitorSperre)) * time.Minute
}

// postSperre ist, wie lange ein geposteter Deal nur dann erneut kommt, wenn
// er günstiger wird. Bei der Amazon-ASIN-Liste sind das sieben Tage: dort
// gibt es nur bei echten Preissenkungen einen Ping.
func (srv *Server) postSperre(p store.MonitorProdukt) time.Duration {
	s := srv.monitorSperre()
	if p.IstAmazonQuelle() && s < 7*24*time.Hour {
		s = 7 * 24 * time.Hour
	}
	return s
}

// bewertetSchluessel merkt sich je Verkaufsweg den zuletzt bewerteten
// Einkauf: ist er unverändert, wird innerhalb der Sperrzeit nicht neu
// gerechnet (und Keepa nicht neu gefragt).
func bewertetSchluessel(p store.MonitorProdukt, a billiger.Angebot) string {
	return store.BewertetPraefix(p.ID) + p.Modus + ":" + a.Shop + ":" + a.Gesamt.String()
}

func (srv *Server) monitorClient() *http.Client {
	if srv.monitorHTTP != nil {
		return srv.monitorHTTP
	}
	return srv.http
}

// bestesAngebot liefert das günstigste Angebot (mit Versand), das zu den
// Vorgaben des Produkts passt.
//
// maxTage ist die längste erlaubte Lieferzeit (0 = keine Grenze). Sagt der
// Text bei billiger.de nichts Verwertbares, zählt ein Angebot mit grünem
// Symbol („lieferbar") trotzdem, eines mit gelbem nicht — dort ist offen,
// wie lange es dauert.
func bestesAngebot(p store.MonitorProdukt, angebote []billiger.Angebot, maxTage int, jetzt time.Time) (billiger.Angebot, bool) {
	var best billiger.Angebot
	gefunden := false
	for _, a := range angebote {
		if !store.ShopPasst(p.Shops, a.Shop) {
			continue
		}
		if a.Status != billiger.Lieferbar && !(p.AuchVerzoegert && a.Status == billiger.Verzoegert) {
			continue
		}
		if maxTage > 0 {
			tage, bekannt := billiger.MaxLiefertage(a.Lieferzeit, jetzt)
			if (bekannt && tage > maxTage) || (!bekannt && a.Status != billiger.Lieferbar) {
				continue
			}
		}
		if !gefunden || a.Effektiv() < best.Effektiv() {
			best, gefunden = a, true
		}
	}
	return best, gefunden
}

// monitorPruefe prüft ein Produkt einmal. test=true bewertet immer neu und
// zeigt den Post nur als Vorschau, statt ihn zu senden; protokolliert wird
// dabei kein Treffer.
func (srv *Server) monitorPruefe(ctx context.Context, p store.MonitorProdukt, test bool) monitorBericht {
	srv.monitorMu.Lock()
	defer srv.monitorMu.Unlock()

	jetzt := time.Now()
	var b monitorBericht
	var name, ean, asin string
	var bester billiger.Angebot
	var besterDa bool
	defer func() {
		shop, cent := "", money.Cents(0)
		if besterDa {
			shop, cent = bester.Shop, bester.Gesamt
		}
		// Auch ein Test hält fest, was er gefunden hat — Name, EAN und ASIN
		// stehen danach in der Liste, ohne dass erst gepostet werden muss.
		_ = srv.store.MonitorGeprueft(p.ID, jetzt, b.Status, shop, cent, name, ean, asin)
	}()

	liste, err := billiger.Hole(ctx, srv.monitorClient(), p.URL)
	liste.Angebote = srv.rabatteAnwenden(liste.Angebote)
	if err != nil {
		b.Status = "Fehler: " + sicherFehlertext(err.Error())
		if !test {
			srv.adminMelden(ctx, "billiger", "⚠️ Monitor: billiger.de antwortet nicht wie erwartet ("+p.Name+"): "+sicherFehlertext(err.Error()))
		}
		return b
	}
	name, ean = liste.Name, liste.EAN
	if p.Name == "" {
		p.Name = liste.Name
	}
	if p.EAN == "" {
		p.EAN = liste.EAN
	}
	srv.ankaufAnwenden(&p)

	maxTage := srv.store.EinstellungZahl(store.SchluesselMonitorMaxTage)
	if !test {
		srv.ausverkauftPruefen(ctx, p, liste.Angebote, maxTage, jetzt)
	}

	bester, besterDa = bestesAngebot(p, liste.Angebote, maxTage, jetzt)
	if !besterDa {
		b.Status = fmt.Sprintf("kein passendes Angebot (%d Angebote, keines aus den gewählten Shops mit passender Lieferzeit)", len(liste.Angebote))
		return b
	}
	if !test {
		_ = srv.store.MonitorPreisMerken(p.ID, bester.Gesamt, bester.Shop, jetzt)
		srv.preissturzPruefen(ctx, p, liste, bester, jetzt)
	}
	b = srv.monitorAngebotAlle(ctx, p, liste, bester, test, jetzt)
	if b.Angebot == nil {
		b.Angebot = &bester
	}
	asin = b.asin
	return b
}

// monitorAngebot bewertet das günstigste passende Angebot eines Produkts und
// postet es, wenn es die Vorgaben erfüllt — gleich, ob es von billiger.de
// oder von mydealz stammt.
func (srv *Server) monitorAngebot(ctx context.Context, p store.MonitorProdukt, liste billiger.Preisliste, bester billiger.Angebot, test bool, jetzt time.Time) monitorBericht {
	var b monitorBericht
	b.Angebot = &bester
	if grenze := srv.wecker(p); grenze > 0 && bester.Effektiv() > grenze {
		art := "Höchstpreis"
		if p.IstAnkauf() {
			art = "Preiswecker"
		}
		b.Status = fmt.Sprintf("günstigstes: %s bei %s — über dem %s %s", bester.Effektiv().Euro(), bester.Shop, art, grenze.Euro())
		return b
	}

	if p.IstEbay() {
		if err := srv.ebayAnwenden(ctx, &p, liste); err != nil {
			b.Status = sicherFehlertext(err.Error())
			if !test {
				srv.adminMelden(ctx, "ebay", "⚠️ Monitor: eBay-Preis nicht ermittelbar ("+p.Name+"): "+b.Status)
			}
			return b
		}
	}
	if p.IstFestpreis() {
		srv.monitorAnkauf(ctx, p, liste, bester, test, jetzt, &b)
		return b
	}

	// Ohne ASIN kein Keepa und kein Verkaufslink: über die EAN suchen.
	maerkte := srv.monitorMaerkte(p)
	asin := p.ASIN
	if asin == "" {
		ean := liste.EAN
		if ean == "" {
			ean = p.EAN
		}
		gefunden, err := srv.asinZuEAN(ctx, ean, maerkte[0])
		if err != nil {
			b.Status = "ASIN nicht gefunden (EAN " + ean + "): " + sicherFehlertext(err.Error()) + " — bitte von Hand eintragen"
			return b
		}
		asin = gefunden
	}
	b.asin = asin
	sperre := srv.monitorSperre()
	if !test {
		// Dasselbe Angebot wurde eben schon bewertet: Keepa nicht erneut
		// fragen. Nach Ablauf der Sperre wird neu bewertet — der
		// Verkaufspreis bei Amazon kann sich inzwischen geändert haben.
		if srv.store.SchonGemeldet(bewertetSchluessel(p, bester), jetzt.Add(-sperre)) {
			b.Status = fmt.Sprintf("unverändert: %s bei %s", bester.Gesamt.Euro(), bester.Shop)
			return b
		}
		// Schon gepostet und seitdem nicht günstiger geworden.
		if g, ok := srv.store.MonitorZuletztGepostet(p.ID, p.Modus, jetzt.Add(-srv.postSperre(p))); ok && bester.Gesamt >= g.Gesamt {
			b.Status = fmt.Sprintf("schon gepostet (%s bei %s am %s)", g.Gesamt.Euro(), g.Shop, g.Zeit.Local().Format("02.01. 15:04"))
			_ = srv.store.Gemeldet(bewertetSchluessel(p, bester), jetzt)
			_ = srv.store.MonitorBewertet(p.ID, bester.Shop, bester.Gesamt, jetzt)
			return b
		}
	}

	werte := monitorFormularWerte(p, liste, bester, asin, maerkte, srv.store.Einstellung(store.SchluesselMonitorPoster))
	var zusatz []string
	if direkt := srv.shopLink(bester, liste.URL); direkt != "" {
		zusatz = append(zusatz, "🛒 [Direkt zu "+linkText(bester.Shop)+"]("+direkt+")")
	}
	if z := srv.preisZeile(p, bester.Gesamt, jetzt); z != "" {
		zusatz = append(zusatz, z)
	}
	if len(zusatz) > 0 {
		werte.Set("zusatz", strings.Join(zusatz, "\n"))
	}
	f := formularLesen(formularAnfrage(werte))
	d := dealSeite{Formular: f}
	if fehler := srv.keepaEinlesen(ctx, &d, false); len(fehler) > 0 && len(fehler) == len(d.Formular.Maerkte) {
		b.Status = "Keepa: " + strings.Join(fehler, " · ")
		if !test {
			srv.adminMelden(ctx, "keepa", "⚠️ Monitor: Keepa liefert nichts ("+p.Name+"): "+strings.Join(fehler, " · "))
		}
		return b
	}
	f = d.Formular

	erg, err := srv.baueDeal(f)
	if err != nil {
		b.Status = "nicht berechenbar: " + sicherFehlertext(err.Error())
		srv.monitorProtokoll(p, f.Titel, bester, b, false, "")
		return b
	}
	leit := erg.Leit()
	b.Bewertet = true
	b.Gewinn, b.Marge, b.Sales = leit.Ergebnis.Gewinn, leit.Ergebnis.MargeProzent, leit.Sales
	b.Channels = srv.monitorChannels(p, bester.Shop, b)
	if !test {
		_ = srv.store.Gemeldet(bewertetSchluessel(p, bester), jetzt)
		_ = srv.store.MonitorBewertet(p.ID, bester.Shop, bester.Gesamt, jetzt)
	}

	kennzahlen := fmt.Sprintf("%s bei %s · Gewinn %s · Marge %s · %d Verkäufe",
		bester.Gesamt.Euro(), bester.Shop, b.Gewinn.Euro(), prozent(b.Marge, 1), b.Sales)
	if len(b.Channels) == 0 {
		b.Status = "keine Regel passt: " + kennzahlen
		if !test {
			srv.monitorProtokoll(p, f.Titel, bester, b, false, b.Status)
		}
		if test {
			srv.monitorVorschau(&b, f, erg)
		}
		return b
	}

	f.ChannelID = b.Channels[0].ID
	f.WeitereChannels = nil
	for _, c := range b.Channels[1:] {
		f.WeitereChannels = append(f.WeitereChannels, c.ID)
	}
	erg, err = srv.baueDeal(f)
	if err != nil {
		b.Status = "nicht berechenbar: " + sicherFehlertext(err.Error())
		return b
	}

	if test {
		srv.monitorVorschau(&b, f, erg)
		b.Status = "würde gepostet in " + channelNamen(b.Channels) + ": " + kennzahlen
		return b
	}

	// Ohne Chart wird trotzdem gepostet: der Monitor kann nicht nachfragen,
	// und ein Deal ohne Chart ist besser als keiner.
	png, chartErr := srv.holeCharts(ctx, f.ASIN, leit.Ziel.KeepaDomain, f.VerkaufsLinie)
	if chartErr != nil {
		png = nil
	}
	ausgang, err := srv.posten(ctx, f, erg, png, eingabenZumMerken(werte).Encode())
	if err != nil {
		b.Status = sicherFehlertext(err.Error())
		srv.monitorProtokoll(p, f.Titel, bester, b, false, b.Status)
		srv.adminMelden(ctx, "discord", "⚠️ Monitor: Deal nicht gepostet ("+p.Name+"): "+b.Status)
		return b
	}
	_ = srv.store.MonitorPostMerken(store.MonitorPost{ProduktID: p.ID, Shop: bester.Shop, Gesamt: bester.Gesamt, DealID: ausgang.HauptID, GepostetAm: jetzt,
		Kategorie: p.Kategorie, Gewinn: b.Gewinn, Titel: f.Titel})
	b.Gepostet = true
	b.Status = "gepostet in " + strings.Join(ausgang.GepostetIn, ", ") + ": " + kennzahlen
	if len(ausgang.Fehlgeschlagen) > 0 {
		b.Status += " · nicht gepostet: " + strings.Join(ausgang.Fehlgeschlagen, " · ")
	}
	srv.monitorProtokoll(p, f.Titel, bester, b, true, b.Status, ausgang.HauptID)
	return b
}

func (srv *Server) monitorVorschau(b *monitorBericht, f dealFormular, erg dealErgebnis) {
	b.ChartURL = f.chartURL(string(f.Leitmarkt))
	b.Karte = kartenVorschauAus(erg.Text, b.ChartURL)
}

func (srv *Server) monitorProtokoll(p store.MonitorProdukt, titel string, a billiger.Angebot, b monitorBericht, gepostet bool, ergebnis string, dealID ...int64) {
	if titel == "" {
		titel = p.Name
	}
	t := store.MonitorTreffer{
		ProduktID: p.ID, Titel: titel, Shop: a.Shop, Gesamt: a.Gesamt,
		Gewinn: b.Gewinn, MargeProzent: b.Marge, Sales: b.Sales,
		Gepostet: gepostet, Ergebnis: ergebnis, Modus: p.Modus,
	}
	if ergebnis == "" {
		t.Ergebnis = b.Status
	}
	if len(dealID) > 0 {
		t.DealID = dealID[0]
	}
	_ = srv.store.MonitorTrefferAnlegen(t)
}

// monitorMaerkte sind die Zielmärkte des Produkts, sonst die Standardmärkte.
func (srv *Server) monitorMaerkte(p store.MonitorProdukt) []marketplace.Marketplace {
	m := marketplace.CodesAusListe(p.Maerkte)
	if len(m) == 0 {
		m = marketplace.CodesAusListe(srv.store.Einstellung(store.SchluesselZielmarkt))
	}
	if len(m) == 0 {
		m = marketplace.All()[:1]
	}
	return m
}

// monitorFormularWerte füllt das Funnel-Formular so, wie es jemand von Hand
// ausfüllen würde: Einkaufslink ist die Preisliste bei billiger.de, der
// Einkaufspreis ist der Preis mit Versand, und die Notiz nennt den Shop.
func monitorFormularWerte(p store.MonitorProdukt, liste billiger.Preisliste, a billiger.Angebot, asin string, maerkte []marketplace.Marketplace, poster string) url.Values {
	notiz := "bei " + a.Shop
	if a.Versand > 0 {
		notiz += " (inkl. " + a.Versand.Euro() + " Versand)"
	}
	if a.Rabatt > 0 {
		notiz += " · Shop-Preis " + a.Gesamt.Euro() + ", abzgl. " + a.RabattText
	}
	if a.Code != "" {
		notiz += " · Code: " + a.Code
	}
	// Bei langer Lieferzeit gehört sie in den Post — wer kauft, soll es wissen.
	if a.Status == billiger.Verzoegert && a.Lieferzeit != "" {
		notiz += " · Lieferzeit: " + a.Lieferzeit
	}
	w := url.Values{
		"einkaufslink":    {liste.URL},
		"link_bestaetigt": {liste.URL},
		"quell_url":       {liste.URL},
		"asin":            {asin},
		"quellmarkt":      {string(marketplace.DE)},
		"ek":              {a.Effektiv().String()},
		"ek_art":          {"brutto"},
		"ek_notiz":        {notiz},
		"steuersatz":      {"normal"},
		"poster":          {poster},
		"leitmarkt":       {string(maerkte[0].Code)},
	}
	for _, m := range maerkte {
		w.Add("zielmarkt", string(m.Code))
	}
	return w
}

// formularAnfrage verpackt Formularwerte in eine Anfrage, damit sie durch
// formularLesen laufen — dieselbe Prüfung wie bei jeder Eingabe im Browser.
func formularAnfrage(w url.Values) *http.Request {
	r, _ := http.NewRequest(http.MethodPost, "/", nil)
	r.Form, r.PostForm = w, w
	return r
}

// monitorChannels wählt die Channels, deren Regel der Treffer erfüllt — in
// der Reihenfolge der Regeln, jeden nur einmal. Defekte Channels fallen weg.
func (srv *Server) monitorChannels(p store.MonitorProdukt, shop string, b monitorBericht) []store.Channel {
	regeln, err := srv.store.MonitorRegeln()
	if err != nil {
		return nil
	}
	var out []store.Channel
	gesehen := map[int64]bool{}
	for _, r := range regeln {
		if !regelPasst(r, p, shop, b) || gesehen[r.ChannelID] {
			continue
		}
		c, err := srv.store.Channel(r.ChannelID)
		if err != nil || c.Defekt {
			continue
		}
		gesehen[r.ChannelID] = true
		out = append(out, c)
	}
	return out
}

func regelPasst(r store.MonitorRegel, p store.MonitorProdukt, shop string, b monitorBericht) bool {
	modus := store.ModusAmazon
	if p.IstFestpreis() {
		modus = p.Modus
	}
	return r.Aktiv &&
		(r.ProduktID == 0 || r.ProduktID == p.ID) &&
		(r.Modus == "" || r.Modus == modus) &&
		(strings.TrimSpace(r.Kategorie) == "" || strings.EqualFold(strings.TrimSpace(r.Kategorie), strings.TrimSpace(p.Kategorie))) &&
		b.Marge >= r.MinMarge &&
		b.Gewinn >= r.MinGewinn &&
		// Ankauf und eBay haben keine Verkaufszahl — die Schwelle gilt nur für Amazon.
		(p.IstFestpreis() || b.Sales >= r.MinSales) &&
		store.ShopPasst(r.Shops, shop)
}

func channelNamen(cs []store.Channel) string {
	namen := make([]string, len(cs))
	for i, c := range cs {
		namen[i] = "#" + c.Name
	}
	return strings.Join(namen, ", ")
}

// asinZuEAN sucht die ASIN zu einer EAN bei Keepa, auf dem Leitmarkt.
func (srv *Server) asinZuEAN(ctx context.Context, ean string, m marketplace.Marketplace) (string, error) {
	if strings.TrimSpace(ean) == "" {
		return "", errors.New("billiger.de nennt keine EAN")
	}
	schluessel := srv.keepaKeyAufloesen()
	if schluessel == "" {
		return "", errors.New("kein Keepa-API-Key hinterlegt")
	}
	c := *srv.keepa
	c.Key = schluessel
	a, roh, err := c.ProduktZuCode(ctx, ean, m.KeepaDomain)
	if err != nil {
		if errors.Is(err, keepa.ErrNichtGefunden) {
			return "", errors.New("Keepa kennt die EAN nicht")
		}
		return "", err
	}
	srv.merkeToken(a.TokensLeft, a.TokensConsumed)
	if !asinMuster.MatchString(a.Produkt.ASIN) {
		return "", errors.New("Keepa lieferte keine gültige ASIN")
	}
	// Die Antwort ist eine vollständige Produktantwort: gleich in den Cache,
	// dann kostet das anschließende Einlesen kein zweites Token.
	_ = srv.store.CacheSchreiben(a.Produkt.ASIN, m.KeepaDomain, roh)
	return a.Produkt.ASIN, nil
}

func idAusPfad(r *http.Request) int64 {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id
}

// modusName ist der Verkaufsweg, wie er im Status steht.
func modusName(m string) string {
	switch m {
	case store.ModusAnkauf:
		return "Ankauf"
	case store.ModusEbay:
		return "eBay"
	}
	return "Amazon"
}

// monitorAngebotAlle bewertet ein Angebot für jeden Verkaufsweg des
// Produkts einzeln — Amazon, Ankauf und eBay können alle angehakt sein, ohne
// dass das Produkt mehrfach angelegt werden muss. Jeder Weg hat seine eigene
// Sperre und seine eigenen Regeln (Regel-Art).
func (srv *Server) monitorAngebotAlle(ctx context.Context, p store.MonitorProdukt, liste billiger.Preisliste, bester billiger.Angebot, test bool, jetzt time.Time) monitorBericht {
	modi := p.Modi()
	if len(modi) == 1 {
		p.Modus = modi[0]
		return srv.monitorAngebot(ctx, p, liste, bester, test, jetzt)
	}
	var gesamt monitorBericht
	var status []string
	haupt := -1
	for i, m := range modi {
		pm := p
		pm.Modus = m
		b := srv.monitorAngebot(ctx, pm, liste, bester, test, jetzt)
		status = append(status, modusName(m)+": "+b.Status)
		// Für Anzeige und Test zählt der erste Weg, der gepostet wurde
		// oder würde — sonst der erste überhaupt.
		if haupt < 0 || (len(b.Channels) > 0 && len(gesamt.Channels) == 0) {
			haupt = i
			gepostet := gesamt.Gepostet
			gesamt = b
			gesamt.Gepostet = gepostet
		}
		gesamt.Gepostet = gesamt.Gepostet || b.Gepostet
		if gesamt.asin == "" {
			gesamt.asin = b.asin
		}
	}
	gesamt.Status = strings.Join(status, " · ")
	return gesamt
}
