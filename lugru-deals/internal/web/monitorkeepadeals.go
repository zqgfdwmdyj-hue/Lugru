package web

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Keepa-Preisstürze: statt jede ASIN abzufragen, fragt der Monitor Keepa
// regelmäßig, welche Artikel gerade im Preis gefallen sind (bis zu 150 je
// Abfrage, wenige Token). Jeder neue Preissturz wird als ASIN mit Einkauf
// auf diesem Markt durchgerechnet — mit denselben Regeln, Sperren und Posts
// wie die ASIN-Liste.

// keepaSucheMinuten: Keepa hält eine Deal-Abfrage 120 Sekunden vor.
const keepaSucheMinMinuten = 2

func (srv *Server) keepaSuchenPruefen(ctx context.Context, jetzt time.Time) {
	suchen, err := srv.store.KeepaSuchen()
	if err != nil || len(suchen) == 0 {
		return
	}
	if _, pause := srv.keepaPause(); pause {
		return
	}
	schluessel := srv.keepaKeyAufloesen()
	if schluessel == "" {
		return
	}
	for _, k := range suchen {
		minuten := max(k.Minuten, keepaSucheMinMinuten)
		if !k.Aktiv || jetzt.Sub(k.GeprueftAm) < time.Duration(minuten)*time.Minute {
			continue
		}
		srv.keepaSuchePruefen(ctx, k, schluessel, jetzt)
		if _, pause := srv.keepaPause(); pause {
			return
		}
	}
}

func idListe(s string) []int64 {
	var out []int64
	for _, t := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == ';' || r == '\n' }) {
		if n, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64); err == nil && n > 0 {
			out = append(out, n)
		}
	}
	return out
}

func (srv *Server) keepaSuchePruefen(ctx context.Context, k store.KeepaSuche, schluessel string, jetzt time.Time) {
	m, ok := marketplace.ByCode(marketplace.Code(k.Markt))
	if !ok {
		_ = srv.store.KeepaSucheGeprueft(k.ID, jetzt, "unbekannter Markt")
		return
	}
	c := *srv.keepa
	c.Key = schluessel
	erg, err := c.Deals(ctx, keepa.DealAnfrage{
		Domain: m.KeepaDomain, Preisart: k.Preisart, MinRabatt: k.MinRabatt, Zeitraum: k.Zeitraum,
		MinPreis: k.MinPreis, MaxPreis: k.MaxPreis, MaxRang: k.MaxRang, Suchbegriff: k.Suchbegriff,
		Kategorien: idListe(k.Kategorien), Ausschluesse: idListe(k.Ausschluss),
	})
	if err != nil {
		if srv.keepaPausieren(err) {
			_ = srv.store.KeepaSucheGeprueft(k.ID, jetzt, "Keepa-Token aufgebraucht — wartet")
			return
		}
		_ = srv.store.KeepaSucheGeprueft(k.ID, jetzt, "Fehler: "+sicherFehlertext(err.Error()))
		srv.adminMelden(ctx, "keepa", "⚠️ Keepa-Preisstürze „"+k.Name+"“: "+sicherFehlertext(err.Error()))
		return
	}
	srv.merkeToken(erg.TokensLeft, erg.TokensConsumed)
	srv.merkeRate(erg.RefillRate)

	geprueft, gepostet := 0, 0
	maxJeLauf := k.MaxJeLauf
	if maxJeLauf <= 0 {
		maxJeLauf = 20
	}
	for _, d := range erg.Deals {
		if geprueft >= maxJeLauf {
			break
		}
		// Denselben Preissturz (ASIN und Preis) nur einmal durchrechnen.
		gemerkt := fmt.Sprintf("kdeal:%d:%s:%d", k.ID, d.ASIN, d.Preis)
		if srv.store.SchonGemeldet(gemerkt, jetzt.AddDate(0, 0, -7)) {
			continue
		}
		_ = srv.store.Gemeldet(gemerkt, jetzt)
		p, ok := srv.store.MonitorProduktZuURL("https://www.amazon.de/dp/" + d.ASIN)
		if !ok {
			neu := store.MonitorProdukt{
				Name: d.Titel, URL: "https://www.amazon.de/dp/" + d.ASIN, ASIN: d.ASIN, Einkauf: string(m.Code),
				Maerkte: k.Maerkte, Modus: k.Modus, Kategorie: k.Name, Herkunft: store.HerkunftKeepaDeal,
				AuchVerzoegert: true,
			}
			id, err := srv.store.MonitorProduktAnlegen(neu)
			if err != nil {
				continue
			}
			neu.ID = id
			p = neu
		}
		geprueft++
		if b := srv.monitorPruefe(ctx, p, false); b.Gepostet {
			gepostet++
		}
		if _, pause := srv.keepaPause(); pause {
			break
		}
	}
	status := fmt.Sprintf("%d Preisstürze bei Keepa, %d neu durchgerechnet", len(erg.Deals), geprueft)
	if gepostet > 0 {
		status += fmt.Sprintf(", %d gepostet", gepostet)
	}
	status += fmt.Sprintf(" · %d Token", erg.TokensConsumed)
	_ = srv.store.KeepaSucheGeprueft(k.ID, jetzt, status)
}

// ---------------------------------------------------------------- Seite

type keepaSucheAnzeige struct {
	store.KeepaSuche
	PreisartText string
	ZeitraumText string
	FilterText   string
	Geprueft     string
}

var preisartNamen = map[int]string{keepa.DealAmazon: "Amazon", keepa.DealNeu: "Neu (alle)", keepa.DealNeuFBA: "FBA-Angebot", keepa.DealWarehouse: "Warehouse"}
var zeitraumNamen = []string{"24 Stunden", "7 Tage", "31 Tage", "90 Tage"}

func (srv *Server) keepaSuchenAnzeigen() []keepaSucheAnzeige {
	ks, _ := srv.store.KeepaSuchen()
	var out []keepaSucheAnzeige
	for _, k := range ks {
		a := keepaSucheAnzeige{KeepaSuche: k, PreisartText: preisartNamen[k.Preisart]}
		if k.Zeitraum >= 0 && k.Zeitraum < len(zeitraumNamen) {
			a.ZeitraumText = zeitraumNamen[k.Zeitraum]
		}
		var f []string
		f = append(f, fmt.Sprintf("ab %d %%", k.MinRabatt))
		if k.MinPreis > 0 || k.MaxPreis > 0 {
			f = append(f, k.MinPreis.Euro()+"–"+k.MaxPreis.Euro())
		}
		if k.MaxRang > 0 {
			f = append(f, "Rang bis "+strconv.Itoa(k.MaxRang))
		}
		if k.Suchbegriff != "" {
			f = append(f, "„"+k.Suchbegriff+"“")
		}
		if k.Kategorien != "" {
			f = append(f, "Kategorien "+k.Kategorien)
		}
		a.FilterText = strings.Join(f, " · ")
		if !k.GeprueftAm.IsZero() {
			a.Geprueft = k.GeprueftAm.Local().Format("02.01. 15:04")
		}
		out = append(out, a)
	}
	return out
}

func (srv *Server) speichereKeepaSuche(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	zahl := func(feld string, vorgabe int) int {
		n, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get(feld)))
		if err != nil {
			return vorgabe
		}
		return n
	}
	m, ok := marketplace.ByCode(marketplace.Code(r.PostForm.Get("markt")))
	if !ok {
		srv.monitorMeldung(w, "", "Bitte einen Markt wählen.")
		return
	}
	k := store.KeepaSuche{
		Name: r.PostForm.Get("name"), Markt: string(m.Code), Preisart: zahl("preisart", keepa.DealAmazon),
		MinRabatt: zahl("min_rabatt", 20), Zeitraum: zahl("zeitraum", 0), MaxRang: zahl("max_rang", 0),
		Suchbegriff: r.PostForm.Get("suchbegriff"), Kategorien: strings.TrimSpace(r.PostForm.Get("kategorien")),
		Ausschluss: strings.TrimSpace(r.PostForm.Get("ausschluss")), Maerkte: maerkteAusFormular(r),
		Modus: store.ModiNormal(r.PostForm["modus"]...), Minuten: zahl("minuten", 5), MaxJeLauf: zahl("max_je_lauf", 20),
		Aktiv: true,
	}
	if _, ok := preisartNamen[k.Preisart]; !ok {
		k.Preisart = keepa.DealAmazon
	}
	if k.Zeitraum < 0 || k.Zeitraum > 3 {
		k.Zeitraum = 0
	}
	if k.MinRabatt < 10 {
		srv.monitorMeldung(w, "", "Keepa sucht erst ab 10 % Preissturz.")
		return
	}
	if k.Minuten < keepaSucheMinMinuten {
		srv.monitorMeldung(w, "", "Öfter als alle 2 Minuten bringt nichts — Keepa hält die Antwort 2 Minuten vor.")
		return
	}
	var err error
	if k.MinPreis, err = betragOderNull(r.PostForm.Get("min_preis")); err != nil {
		srv.monitorMeldung(w, "", "Mindestpreis: kein gültiger Betrag.")
		return
	}
	if k.MaxPreis, err = betragOderNull(r.PostForm.Get("max_preis")); err != nil {
		srv.monitorMeldung(w, "", "Höchstpreis: kein gültiger Betrag.")
		return
	}
	if strings.TrimSpace(k.Name) == "" {
		k.Name = "Preisstürze " + string(m.Code)
	}
	if _, err := srv.store.KeepaSucheAnlegen(k); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	meldung := "Keepa-Suche „" + k.Name + "“ angelegt."
	if channelID, _ := strconv.ParseInt(r.PostForm.Get("channel_id"), 10, 64); channelID > 0 {
		marge, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(r.PostForm.Get("min_marge")), ",", "."), 64)
		gewinn, _ := betragOderNull(r.PostForm.Get("min_gewinn"))
		if _, err := srv.store.MonitorRegelAnlegen(store.MonitorRegel{ChannelID: channelID, Kategorie: k.Name,
			MinMarge: marge, MinGewinn: gewinn, MinSales: zahl("min_sales", 0), Aktiv: true, Name: k.Name}); err == nil {
			meldung += " Regel angelegt: Kategorie „" + k.Name + "“ ab " + prozent(marge, 1) + " Marge."
		}
	} else {
		meldung += " Ohne Regel wird nichts gepostet — unter „Regeln“ eine für Kategorie „" + k.Name + "“ anlegen."
	}
	srv.monitorMeldung(w, meldung, "")
}

func (srv *Server) schalteKeepaSuche(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	_ = srv.store.KeepaSucheAktiv(idAusPfad(r), r.PostForm.Get("aktiv") == "1")
	srv.monitorMeldung(w, "Gespeichert.", "")
}

func (srv *Server) loescheKeepaSuche(w http.ResponseWriter, r *http.Request) {
	_ = srv.store.KeepaSucheLoeschen(idAusPfad(r))
	srv.monitorMeldung(w, "Keepa-Suche gelöscht.", "")
}
