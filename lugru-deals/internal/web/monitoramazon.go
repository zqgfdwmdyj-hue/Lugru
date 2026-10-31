package web

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Die Amazon-ASIN-Liste: Einkauf bei Amazon statt bei den Shops von
// billiger.de. Je ASIN und Einkaufsmarkt liest der Monitor bei Keepa den
// günstigsten Neupreis (Amazon selbst, FBA- oder Händlerangebot) und
// bewertet ihn wie jedes andere Angebot — gegen Amazon auf den Zielmärkten,
// einen Ankauf oder eBay, je nach angehakten Verkaufswegen.
//
// Keepa kostet ein Token je ASIN und Markt und Prüfung. Darum hat die Liste
// ihr eigenes, langes Intervall, die fälligen ASINs werden je Markt in
// Stapeln zu 100 geholt und in den Keepa-Cache gelegt (die Bewertung liest
// dann nur noch aus dem Cache), und ist das Kontingent leer, pausiert die
// Liste, bis Keepa wieder Token hat.

const asinListeMax = 2000

func (srv *Server) amazonMinuten() int {
	n := srv.store.EinstellungZahl(store.SchluesselMonitorAmazonMin)
	if n < 5 {
		n = 5
	}
	return n
}

// amazonIntervall ist die Prüfzeit einer ASIN nach ihrer Prio.
func (srv *Server) amazonIntervall(p store.MonitorProdukt) time.Duration {
	d := time.Duration(srv.amazonMinuten()) * time.Minute
	switch p.Prio {
	case store.PrioHoch:
		return d / 2
	case store.PrioNiedrig:
		return d * 2
	}
	return d
}

// amazonShop ist der Shopname eines Amazon-Angebots, etwa „Amazon.fr“.
func amazonShop(m marketplace.Marketplace) string { return "Amazon." + m.TLD }

// amazonMarktAusShop erkennt am Shopnamen ein Amazon-Angebot.
func amazonMarktAusShop(shop string) (marketplace.Marketplace, bool) {
	for _, m := range marketplace.All() {
		if strings.EqualFold(shop, amazonShop(m)) {
			return m, true
		}
	}
	return marketplace.Marketplace{}, false
}

// amazonAbfrageMaerkte sind alle Märkte, die eine ASIN bei Keepa braucht:
// die Einkaufsmärkte und, mit dem Verkaufsweg Amazon, die Zielmärkte.
func (srv *Server) amazonAbfrageMaerkte(p store.MonitorProdukt) []marketplace.Marketplace {
	codes := strings.Split(p.Einkauf, ",")
	if p.IstAmazon() {
		for _, m := range srv.monitorMaerkte(p) {
			codes = append(codes, string(m.Code))
		}
	}
	return marketplace.Codes(codes)
}

// keepaPause sagt, ob die ASIN-Liste gerade auf Token wartet.
func (srv *Server) keepaPause() (time.Duration, bool) {
	srv.tokenMu.Lock()
	defer srv.tokenMu.Unlock()
	rest := time.Until(srv.keepaPauseBis)
	return rest, rest > 0
}

func (srv *Server) keepaPausieren(err error) bool {
	var leer keepa.ErrTokensErschoepft
	if !errors.As(err, &leer) {
		return false
	}
	warte := leer.RefillIn
	if !leer.Bekannt || warte < time.Minute {
		warte = time.Minute
	}
	srv.tokenMu.Lock()
	srv.keepaPauseBis = time.Now().Add(warte)
	srv.tokenMu.Unlock()
	return true
}

func (srv *Server) merkeRate(rate int) {
	if rate <= 0 {
		return
	}
	srv.tokenMu.Lock()
	srv.tokenRate = rate
	srv.tokenMu.Unlock()
}

// amazonVorladen holt die fälligen ASINs je Markt in Stapeln und legt sie in
// den Keepa-Cache. Was dort noch frisch genug liegt, wird nicht neu geholt.
func (srv *Server) amazonVorladen(ctx context.Context, faellig []store.MonitorProdukt) {
	if _, pause := srv.keepaPause(); pause {
		return
	}
	schluessel := srv.keepaKeyAufloesen()
	if schluessel == "" {
		return
	}
	frisch := time.Duration(srv.amazonMinuten()) * time.Minute / 2
	jeMarkt := map[int][]string{}
	gesehen := map[string]bool{}
	for _, p := range faellig {
		if !p.IstAmazonQuelle() || p.ASIN == "" {
			continue
		}
		for _, m := range srv.amazonAbfrageMaerkte(p) {
			k := fmt.Sprintf("%d|%s", m.KeepaDomain, p.ASIN)
			if gesehen[k] {
				continue
			}
			gesehen[k] = true
			if _, da := srv.store.CacheLesen(p.ASIN, m.KeepaDomain, frisch); da {
				continue
			}
			jeMarkt[m.KeepaDomain] = append(jeMarkt[m.KeepaDomain], p.ASIN)
		}
	}
	c := *srv.keepa
	c.Key = schluessel
	for domain, asins := range jeMarkt {
		for start := 0; start < len(asins); start += keepa.MaxJeAbfrage {
			ende := min(start+keepa.MaxJeAbfrage, len(asins))
			st, err := c.Produkte(ctx, asins[start:ende], domain)
			if err != nil {
				if srv.keepaPausieren(err) {
					srv.adminMelden(ctx, "keepa", "⏸️ ASIN-Liste: Keepa-Token aufgebraucht — sie pausiert, bis neue da sind. Intervall verlängern oder weniger ASINs/Märkte?")
					return
				}
				srv.adminMelden(ctx, "keepa", "⚠️ ASIN-Liste: Keepa antwortet nicht: "+sicherFehlertext(err.Error()))
				return
			}
			srv.merkeToken(st.TokensLeft, st.TokensConsumed)
			srv.merkeRate(st.RefillRate)
			for i, p := range st.Produkte {
				_ = srv.store.CacheSchreiben(p.ASIN, domain, st.Einzeln[i])
			}
		}
	}
}

// amazonProdukt liest eine ASIN aus dem Cache (so frisch wie das Intervall)
// oder fragt Keepa einzeln, solange die Liste nicht pausiert.
func (srv *Server) amazonProdukt(ctx context.Context, asin string, m marketplace.Marketplace) (keepa.Product, error) {
	if roh, da := srv.store.CacheLesen(asin, m.KeepaDomain, time.Duration(srv.amazonMinuten())*time.Minute); da {
		if a, err := keepa.ParseAntwort(roh); err == nil {
			return a.Produkt, nil
		}
	}
	if rest, pause := srv.keepaPause(); pause {
		return keepa.Product{}, fmt.Errorf("wartet auf Keepa-Token (noch %s)", rest.Round(time.Second))
	}
	return srv.holeProduktCtx(ctx, asin, m, true)
}

// amazonListe baut aus den Einkaufsmärkten einer ASIN eine Preisliste wie
// die von billiger.de: je Markt ein Angebot zum günstigsten Neupreis.
func (srv *Server) amazonListe(ctx context.Context, p store.MonitorProdukt) (billiger.Preisliste, error) {
	var liste billiger.Preisliste
	var fehler []string
	for _, m := range marketplace.CodesAusListe(p.Einkauf) {
		prod, err := srv.amazonProdukt(ctx, p.ASIN, m)
		if err != nil {
			fehler = append(fehler, "amazon."+m.TLD+": "+sicherFehlertext(err.Error()))
			continue
		}
		if liste.URL == "" {
			liste.URL = m.ProductURL(p.ASIN)
		}
		if liste.Name == "" {
			liste.Name = prod.Titel
		}
		if liste.EAN == "" && len(prod.EANs) > 0 {
			liste.EAN = prod.EANs[0]
		}
		ek, wer := prod.Einkaufspreis()
		if !ek.OK {
			continue
		}
		liste.Angebote = append(liste.Angebote, billiger.Angebot{
			ID: string(m.Code), Shop: amazonShop(m), Titel: wer,
			Preis: ek.Cents, Gesamt: ek.Cents, Status: billiger.Lieferbar,
		})
	}
	if len(liste.Angebote) == 0 {
		if len(fehler) > 0 {
			return liste, errors.New(strings.Join(fehler, " · "))
		}
		return liste, errors.New("kein Neuangebot auf den Einkaufsmärkten")
	}
	return liste, nil
}

// asinMusterText findet ASINs in einer eingefügten Liste oder einem
// Keepa-Export (CSV): B0 und acht Zeichen.
var asinMusterText = regexp.MustCompile(`\bB0[0-9A-Z]{8}\b`)

func asinsAus(text string) []string {
	var out []string
	gesehen := map[string]bool{}
	for _, a := range asinMusterText.FindAllString(strings.ToUpper(text), -1) {
		if !gesehen[a] {
			gesehen[a] = true
			out = append(out, a)
		}
	}
	return out
}

// amazonTokenBedarf schätzt den Keepa-Verbrauch der aktiven ASIN-Liste in
// Token je Minute.
func (srv *Server) amazonTokenBedarf(produkte []store.MonitorProdukt) float64 {
	bedarf := 0.0
	for _, p := range produkte {
		if !p.Aktiv || !p.IstAmazonQuelle() {
			continue
		}
		bedarf += float64(len(srv.amazonAbfrageMaerkte(p))) / srv.amazonIntervall(p).Minutes()
	}
	return bedarf
}

func tokenText(bedarf float64) string {
	if bedarf < 10 {
		return strings.Replace(strconv.FormatFloat(bedarf, 'f', 1, 64), ".", ",", 1)
	}
	return strconv.Itoa(int(bedarf + 0.5))
}

// speichereAsinListe legt die ASINs einer eingefügten oder hochgeladenen
// Liste an, auf Wunsch samt Regel (Channel und Mindestmarge).
func (srv *Server) speichereAsinListe(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		_ = r.ParseForm()
	}
	text := r.PostForm.Get("asins")
	if f, _, err := r.FormFile("datei"); err == nil {
		roh, _ := io.ReadAll(io.LimitReader(f, 8<<20))
		f.Close()
		text += "\n" + string(roh)
	}
	asins := asinsAus(text)
	if len(asins) == 0 {
		srv.monitorMeldung(w, "", "Keine ASIN gefunden — eine je Zeile (B0…) oder ein Keepa-Export als CSV.")
		return
	}
	if len(asins) > asinListeMax {
		srv.monitorMeldung(w, "", fmt.Sprintf("%d ASINs sind zu viele auf einmal — höchstens %d.", len(asins), asinListeMax))
		return
	}
	var einkauf []string
	for _, m := range marketplace.Codes(r.PostForm["einkauf"]) {
		einkauf = append(einkauf, string(m.Code))
	}
	if len(einkauf) == 0 {
		srv.monitorMeldung(w, "", "Bitte mindestens einen Amazon-Markt für den Einkauf anhaken.")
		return
	}
	kategorie := strings.TrimSpace(r.PostForm.Get("kategorie"))
	if kategorie == "" {
		kategorie = "ASIN-Liste"
	}
	vorlage := store.MonitorProdukt{
		Einkauf: strings.Join(einkauf, ","), Maerkte: maerkteAusFormular(r),
		Modus: store.ModiNormal(r.PostForm["modus"]...), Kategorie: kategorie, Prio: r.PostForm.Get("prio"),
		AuchVerzoegert: true, Aktiv: true,
	}
	if ankauf, err := betragOderNull(r.PostForm.Get("ankauf")); err == nil {
		vorlage.Ankauf = ankauf
	}

	var regelText string
	if channelID, _ := strconv.ParseInt(r.PostForm.Get("channel_id"), 10, 64); channelID > 0 {
		if _, err := srv.store.Channel(channelID); err != nil {
			srv.monitorMeldung(w, "", "Den gewählten Channel gibt es nicht.")
			return
		}
		marge, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(r.PostForm.Get("min_marge")), ",", "."), 64)
		if err != nil {
			marge = 0
		}
		gewinn, _ := betragOderNull(r.PostForm.Get("min_gewinn"))
		if _, err := srv.store.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: channelID, Kategorie: kategorie,
			MinMarge: marge, MinGewinn: gewinn, Aktiv: true, Name: kategorie}); err != nil {
			srv.monitorMeldung(w, "", "Regel nicht gespeichert: "+sicherFehlertext(err.Error()))
			return
		}
		regelText = fmt.Sprintf(" Regel angelegt: Kategorie „%s“ ab %s Marge.", kategorie, prozent(marge, 1))
	}

	neu, schon := 0, 0
	for _, asin := range asins {
		p := vorlage
		p.ASIN, p.URL = asin, "https://www.amazon.de/dp/"+asin
		if _, ok := srv.store.MonitorProduktZuURL(p.URL); ok {
			schon++
			continue
		}
		if _, err := srv.store.MonitorProduktAnlegen(p); err != nil {
			srv.monitorMeldung(w, "", "Nicht alle gespeichert: "+sicherFehlertext(err.Error()))
			return
		}
		neu++
	}
	alle, _ := srv.store.MonitorProdukte()
	meldung := fmt.Sprintf("%d ASINs angelegt", neu)
	if schon > 0 {
		meldung += fmt.Sprintf(", %d waren schon da", schon)
	}
	meldung += fmt.Sprintf(". Die ASIN-Liste braucht jetzt etwa %s Keepa-Token je Minute.", tokenText(srv.amazonTokenBedarf(alle))) + regelText
	srv.monitorMeldung(w, meldung, "")
}

// einkaufsText nennt im Post, wo und bei wem eingekauft wird.
func einkaufsText(a billiger.Angebot) string {
	if a.Titel == "" {
		return "bei " + a.Shop
	}
	return "bei " + a.Shop + " (" + a.Titel + ")"
}
