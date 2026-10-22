package web

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/rueckblick"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Der Rückblick gleicht gepostete Deals mit dem späteren Buy-Box-Verlauf bei
// Keepa ab: war der versprochene Gewinn realistisch, ist der Preis
// eingebrochen, und wann hat er sich erholt? Keepa kostet ein Token je
// Artikel und Markt; darum läuft der Abgleich nur auf Knopfdruck, nennt
// vorher die Zahl der Token und merkt sich jedes Ergebnis.

// rueckblickNeuNach ist, wie alt ein Abgleich werden darf, bevor ihn der
// nächste Lauf erneuert — bei frischen Deals ändert sich der Verlauf noch.
const rueckblickNeuNach = 7 * 24 * time.Hour

type rueckblickStand struct {
	Laeuft         bool
	Fertig, Gesamt int
	Meldung        string
}

type rueckblickZeile struct {
	ID                   int64
	Datum, Titel, ASIN   string
	Link, Markt          string
	Channel              string
	B2B                  bool
	VK, Gewinn, Marge    string
	Tief, TiefInfo       string
	VK30, VK30Info       string
	Gewinn30, Klasse30   string
	Jetzt, JetztInfo     string
	Erholt, ErholtKlasse string
	Bewertung, Klasse    string
	Hinweis              string
	sortWert             money.Cents
	art                  string
}

type rueckblickDaten struct {
	Titel, TokenText string
	Fehler, Meldung  string
	Von, Bis, Nur    string
	// Art ist "b2b", "standard" oder leer für alle Deals.
	Art        string
	ArtWahl    []gruppenWahl
	B2BDeals   int
	Sortierung string
	Zeitraeume []zeitraum
	Filter     []gruppenWahl

	Stand rueckblickStand
	// Offen sind die Artikel, die noch (oder wieder) abzugleichen sind —
	// so viele Keepa-Token kostet der nächste Lauf höchstens.
	Offen int

	Anzahl, Geprueft, OhneDaten          int
	Realistisch, Weniger, Verlust        int
	Gefallen, Erholt, NichtErholt        int
	ErholtTage                           string
	GewinnVersprochen, GewinnRealistisch string
	KlasseRealistisch                    string
	Quote                                string
	Zeilen                               []rueckblickZeile
}

// rueckblickZeitraeume sind einzelne Monate in der Vergangenheit — „alle
// Deals von vor sechs Monaten“ — und das letzte Jahr am Stück.
func rueckblickZeitraeume(von, bis string) []zeitraum {
	heute := time.Now()
	monat := time.Date(heute.Year(), heute.Month(), 1, 0, 0, 0, 0, time.Local)
	tag := func(t time.Time) string { return t.Format("2006-01-02") }
	var out []zeitraum
	for _, n := range []int{1, 3, 6, 9, 12} {
		anfang := monat.AddDate(0, -n, 0)
		name := "vor " + strconv.Itoa(n) + " Monaten"
		if n == 1 {
			name = "letzter Monat"
		}
		out = append(out, zeitraum{Name: name + " (" + monatsnamen[anfang.Month()-1][:3] + ")", Von: tag(anfang), Bis: tag(anfang.AddDate(0, 1, -1))})
	}
	out = append(out, zeitraum{Name: "letzte 12 Monate", Von: tag(monat.AddDate(-1, 0, 0)), Bis: tag(heute)})
	out = append(out, zeitraum{Name: "alles"})
	for i := range out {
		out[i].Aktiv = out[i].Von == von && out[i].Bis == bis
	}
	return out
}

func (srv *Server) zeigeRueckblick(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	d := rueckblickDaten{Titel: "Statistik", TokenText: srv.tokenText(), Von: q.Get("von"), Bis: q.Get("bis"),
		Nur: q.Get("nur"), Art: q.Get("art"), Sortierung: q.Get("sortierung"), Meldung: q.Get("meldung")}
	if !q.Has("von") && !q.Has("bis") {
		// Ohne Auswahl: der Monat vor sechs Monaten.
		z := rueckblickZeitraeume("", "")[2]
		d.Von, d.Bis = z.Von, z.Bis
	}
	d.Zeitraeume = rueckblickZeitraeume(d.Von, d.Bis)
	srv.rueckblickMu.Lock()
	d.Stand = srv.rueckblickLauf
	srv.rueckblickMu.Unlock()

	von, bis, fehler := statistikZeitraum(d.Von, d.Bis)
	if fehler != "" {
		d.Fehler = fehler
	}
	deals, err := srv.store.RueckblickDeals(von, bis)
	if err != nil {
		d.Fehler = sicherFehlertext(err.Error())
		srv.rendere(w, "rueckblick", d)
		return
	}
	bl, _ := srv.store.Rueckblicke()
	b2b, _ := srv.store.RueckblickB2B()
	for _, deal := range deals {
		if b2b[deal.ID] {
			d.B2BDeals++
		}
	}
	deals = nachArt(deals, b2b, d.Art)
	jetzt := time.Now()
	d.Offen = len(rueckblickOffen(deals, bl, jetzt))

	var summeV, summeR money.Cents
	var tage, erholtMitTagen int
	for _, deal := range deals {
		z := rueckblickZeileAus(deal, bl, jetzt)
		z.B2B = b2b[deal.ID]
		d.Anzahl++
		switch z.art {
		case "offen":
		case "keine":
			d.OhneDaten++
		default:
			d.Geprueft++
			summeV += deal.EffGewinnCent
			summeR += z.sortWert + deal.EffGewinnCent
			switch z.art {
			case "realistisch":
				d.Realistisch++
			case "weniger":
				d.Weniger++
			case "verlust":
				d.Verlust++
			}
			if b := bl[deal.ID]; b.Daten && b.VKTief*100 < deal.VKCent*95 {
				d.Gefallen++
				if b.ErholtAm.IsZero() {
					d.NichtErholt++
				} else {
					d.Erholt++
					tage += tageZwischen(deal.GepostetAm, b.ErholtAm)
					erholtMitTagen++
				}
			}
		}
		if rueckblickPasst(d.Nur, z, bl[deal.ID], deal) {
			d.Zeilen = append(d.Zeilen, z)
		}
	}
	if erholtMitTagen > 0 {
		d.ErholtTage = strconv.Itoa(tage/erholtMitTagen) + " Tage"
	}
	d.GewinnVersprochen, d.GewinnRealistisch = summeV.Euro(), summeR.Euro()
	d.KlasseRealistisch = zahlklasse(float64(summeR))
	if d.Geprueft > 0 {
		d.Quote = prozent(float64(d.Realistisch)*100/float64(d.Geprueft), 0)
	}
	if d.Sortierung == "schlecht" {
		sort.SliceStable(d.Zeilen, func(i, j int) bool { return d.Zeilen[i].sortWert < d.Zeilen[j].sortWert })
	}
	for _, f := range []struct{ name, wert string }{{"alle", ""}, {"✅ realistisch", "realistisch"},
		{"⚠️ weniger Gewinn", "weniger"}, {"❌ Verlust", "verlust"}, {"📉 eingebrochen", "gefallen"}, {"nicht erholt", "nichterholt"}} {
		d.Filter = append(d.Filter, gruppenWahl{Name: f.name, Wert: f.wert, Aktiv: f.wert == d.Nur})
	}
	for _, a := range []struct{ name, wert string }{{"alle Deals", ""}, {"nur B2B", "b2b"}, {"ohne B2B", "standard"}} {
		d.ArtWahl = append(d.ArtWahl, gruppenWahl{Name: a.name, Wert: a.wert, Aktiv: a.wert == d.Art})
	}
	srv.rendere(w, "rueckblick", d)
}

func rueckblickPasst(nur string, z rueckblickZeile, b store.Rueckblick, deal store.Deal) bool {
	gefallen := b.Daten && b.VKTief*100 < deal.VKCent*95
	switch nur {
	case "":
		return true
	case "gefallen":
		return gefallen
	case "nichterholt":
		return gefallen && b.ErholtAm.IsZero()
	default:
		return z.art == nur
	}
}

func veraenderung(neu, alt money.Cents) string {
	if alt <= 0 {
		return ""
	}
	p := (float64(neu) - float64(alt)) * 100 / float64(alt)
	s := prozent(p, 0)
	if p >= 0.5 {
		s = "+" + s
	}
	return s
}

func rueckblickZeileAus(deal store.Deal, bl map[int64]store.Rueckblick, jetzt time.Time) rueckblickZeile {
	m, _ := marketplace.ByCode(marketplace.Code(deal.Zielmarkt))
	z := rueckblickZeile{
		ID: deal.ID, Datum: deal.GepostetAm.Local().Format("02.01.2006"), Titel: deal.Titel, ASIN: deal.ASIN,
		Markt: deal.Zielmarkt, Channel: deal.ChannelName, VK: deal.VKCent.Euro(), Gewinn: deal.EffGewinnCent.Euro(), Marge: prozent(deal.EffMargeProzent, 1),
		art: "offen", Bewertung: "noch nicht abgeglichen", Klasse: "neutral",
	}
	if m.Host != "" {
		z.Link = m.ProductURL(deal.ASIN)
	}
	b, da := bl[deal.ID]
	if !da {
		return z
	}
	if !b.Daten {
		z.art, z.Bewertung = "keine", "keine Keepa-Daten"
		z.Hinweis = b.Fehler
		return z
	}
	g := func(vk money.Cents) money.Cents {
		return rueckblick.Gewinn(deal.EffGewinnCent, deal.VKCent, vk, m.VATPermille, deal.ProvisionProzent)
	}
	z.Tief, z.TiefInfo = b.VKTief.Euro(), veraenderung(b.VKTief, deal.VKCent)+" · "+b.TiefAm.Local().Format("02.01.06")
	z.VK30, z.VK30Info = b.VK30.Euro(), veraenderung(b.VK30, deal.VKCent)
	g30 := g(b.VK30)
	z.Gewinn30, z.Klasse30 = g30.Euro(), zahlklasse(float64(g30))
	z.Jetzt, z.JetztInfo = b.VKJetzt.Euro(), veraenderung(b.VKJetzt, deal.VKCent)
	z.sortWert = g30 - deal.EffGewinnCent
	switch {
	case b.VKTief*100 >= deal.VKCent*95:
		z.Erholt, z.ErholtKlasse = "nie gefallen", "positiv"
	case b.ErholtAm.IsZero():
		z.Erholt, z.ErholtKlasse = "nicht erholt", "negativ"
	default:
		z.Erholt, z.ErholtKlasse = "nach "+strconv.Itoa(tageZwischen(deal.GepostetAm, b.ErholtAm))+" Tagen", "neutral"
	}
	switch {
	case g30 <= 0:
		z.art, z.Bewertung, z.Klasse = "verlust", "❌ Verlust", "negativ"
	case deal.EffGewinnCent <= 0 || g30*100 >= deal.EffGewinnCent*80:
		z.art, z.Bewertung, z.Klasse = "realistisch", "✅ realistisch", "positiv"
	default:
		z.art, z.Bewertung, z.Klasse = "weniger", "⚠️ weniger Gewinn", "akzent"
	}
	if alter := jetzt.Sub(deal.GepostetAm); alter < 30*24*time.Hour {
		z.Hinweis = "erst " + strconv.Itoa(tageZwischen(deal.GepostetAm, jetzt)) + " Tage her — vorläufig"
	}
	return z
}

type rueckblickGruppe struct {
	asin  string
	markt marketplace.Marketplace
	deals []store.Deal
}

// rueckblickOffen sind die Artikel (je ASIN und Markt), zu denen mindestens
// ein Deal noch keinen oder einen veralteten Abgleich hat.
func rueckblickOffen(deals []store.Deal, bl map[int64]store.Rueckblick, jetzt time.Time) []rueckblickGruppe {
	idx := map[string]int{}
	var out []rueckblickGruppe
	for _, d := range deals {
		m, ok := marketplace.ByCode(marketplace.Code(d.Zielmarkt))
		if !ok {
			continue
		}
		b, da := bl[d.ID]
		// Ein Abgleich mehr als ein Jahr nach dem Post ändert sich kaum noch.
		fertig := da && (jetzt.Sub(b.GeprueftAm) < rueckblickNeuNach || b.GeprueftAm.Sub(d.GepostetAm) > 365*24*time.Hour)
		if fertig {
			continue
		}
		k := d.ASIN + "|" + string(m.Code)
		i, da := idx[k]
		if !da {
			i = len(out)
			idx[k] = i
			out = append(out, rueckblickGruppe{asin: d.ASIN, markt: m})
		}
		out[i].deals = append(out[i].deals, d)
	}
	return out
}

func (srv *Server) starteRueckblick(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	von, bis, art := r.PostForm.Get("von"), r.PostForm.Get("bis"), r.PostForm.Get("art")
	zurueck := "/statistik/rueckblick?" + url.Values{"von": {von}, "bis": {bis}, "art": {art}}.Encode()
	vonT, bisT, fehler := statistikZeitraum(von, bis)
	if fehler != "" {
		http.Redirect(w, r, zurueck, http.StatusSeeOther)
		return
	}
	deals, err := srv.store.RueckblickDeals(vonT, bisT)
	if err != nil {
		http.Redirect(w, r, zurueck, http.StatusSeeOther)
		return
	}
	bl, _ := srv.store.Rueckblicke()
	b2b, _ := srv.store.RueckblickB2B()
	offen := rueckblickOffen(nachArt(deals, b2b, art), bl, time.Now())

	srv.rueckblickMu.Lock()
	if srv.rueckblickLauf.Laeuft || len(offen) == 0 {
		srv.rueckblickMu.Unlock()
		http.Redirect(w, r, zurueck, http.StatusSeeOther)
		return
	}
	srv.rueckblickLauf = rueckblickStand{Laeuft: true, Gesamt: len(offen)}
	srv.rueckblickMu.Unlock()

	go srv.rueckblickAbgleichen(offen)
	http.Redirect(w, r, zurueck, http.StatusSeeOther)
}

// rueckblickAbgleichen holt je Artikel einmal den Verlauf bei Keepa und
// wertet ihn für jeden Deal des Artikels aus. Ist das Kontingent leer oder
// Keepa nicht erreichbar, hört der Lauf auf; was fertig ist, bleibt.
func (srv *Server) rueckblickAbgleichen(gruppen []rueckblickGruppe) {
	meldung := ""
	fertig := 0
	for _, g := range gruppen {
		ctx, abbruch := context.WithTimeout(context.Background(), time.Minute)
		p, err := srv.holeProduktCtx(ctx, g.asin, g.markt, false)
		abbruch()
		jetzt := time.Now()
		if err != nil {
			if !strings.Contains(err.Error(), "kennt die ASIN") {
				meldung = "Abgleich unterbrochen: " + sicherFehlertext(err.Error())
				break
			}
			for _, d := range g.deals {
				_ = srv.store.RueckblickSpeichern(store.Rueckblick{DealID: d.ID, GeprueftAm: jetzt, Fehler: "Keepa kennt die ASIN nicht"})
			}
		} else {
			for _, d := range g.deals {
				e := rueckblick.Auswerten(p.BuyBoxVerlauf, d.GepostetAm, jetzt, d.VKCent)
				_ = srv.store.RueckblickSpeichern(store.Rueckblick{
					DealID: d.ID, GeprueftAm: jetzt, Daten: e.Daten,
					VKJetzt: e.VKJetzt, VKTief: e.VKTief, TiefAm: e.TiefAm, VK30: e.VK30, VK90: e.VK90, ErholtAm: e.ErholtAm,
				})
			}
		}
		fertig++
		srv.rueckblickMu.Lock()
		srv.rueckblickLauf.Fertig = fertig
		srv.rueckblickMu.Unlock()
	}
	if meldung == "" {
		meldung = "Abgleich fertig: " + strconv.Itoa(fertig) + " Artikel bei Keepa geprüft."
	}
	srv.rueckblickMu.Lock()
	srv.rueckblickLauf = rueckblickStand{Fertig: fertig, Gesamt: len(gruppen), Meldung: meldung}
	srv.rueckblickMu.Unlock()
}

// tageZwischen sind die vollen Tage von a bis b, gerundet — eine
// Zeitumstellung dazwischen macht aus 80 Tagen sonst 79.
func tageZwischen(a, b time.Time) int { return int(math.Round(b.Sub(a).Hours() / 24)) }

// nachArt lässt nur B2B-Deals ("b2b"), nur die übrigen ("standard") oder
// alle (leer) durch.
func nachArt(deals []store.Deal, b2b map[int64]bool, art string) []store.Deal {
	if art != "b2b" && art != "standard" {
		return deals
	}
	var out []store.Deal
	for _, d := range deals {
		if (art == "b2b") == b2b[d.ID] {
			out = append(out, d)
		}
	}
	return out
}
