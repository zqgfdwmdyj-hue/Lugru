package web

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Tageszusammenfassung und Auswertung der Monitor-Posts.

// kaeufeVon liefert die ✅ eines Posts: bei Amazon-Deals aus der Historie
// (dort zählt der Reaktions-Abgleich), sonst aus dem Post selbst.
func (srv *Server) kaeufeVon(p store.MonitorPost) int {
	if p.DealID != 0 {
		return srv.store.DealKaeufe(p.DealID)
	}
	return p.Kaeufe
}

// ---------------------------------------------------------------- Tag

// tageszeit liest „20:00" in Stunden und Minuten; Vorgabe 20 Uhr.
func tageszeit(s string) (int, int) {
	teile := strings.SplitN(strings.TrimSpace(s), ":", 2)
	h, err1 := strconv.Atoi(teile[0])
	m := 0
	var err2 error
	if len(teile) == 2 {
		m, err2 = strconv.Atoi(teile[1])
	}
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 20, 0
	}
	return h, m
}

// tageszusammenfassung postet einmal am Tag zur eingestellten Uhrzeit die
// besten Deals der letzten 24 Stunden.
func (srv *Server) tageszusammenfassung(ctx context.Context, jetzt time.Time) {
	id := int64(srv.store.EinstellungZahl(store.SchluesselMonitorTagChannel))
	if id == 0 {
		return
	}
	lokal := jetzt.Local()
	h, m := tageszeit(srv.store.Einstellung(store.SchluesselMonitorTagZeit))
	faellig := time.Date(lokal.Year(), lokal.Month(), lokal.Day(), h, m, 0, 0, lokal.Location())
	schluessel := "tag:" + lokal.Format("2006-01-02")
	if lokal.Before(faellig) || srv.store.SchonGemeldet(schluessel, jetzt.Add(-20*time.Hour)) {
		return
	}
	_ = srv.store.Gemeldet(schluessel, jetzt)
	c, err := srv.store.Channel(id)
	if err != nil {
		return
	}
	text := srv.tagText(jetzt)
	if text == "" {
		return
	}
	if _, err := discord.SendeMitWiederholung(ctx, srv.http, c.WebhookURL, discord.Nachricht{
		Inhalt: text, Mention: discord.MentionTyp(c.MentionTyp), RollenID: c.RollenID,
	}); err != nil && !errors.Is(err, context.Canceled) {
		srv.adminMelden(ctx, "discord", "⚠️ Tageszusammenfassung nicht gepostet: "+sicherFehlertext(err.Error()))
	}
}

// tagText baut die Zusammenfassung; leer, wenn es keinen Deal gab.
func (srv *Server) tagText(jetzt time.Time) string {
	posts, err := srv.store.MonitorPostsSeit(jetzt.Add(-24 * time.Hour))
	if err != nil || len(posts) == 0 {
		return ""
	}
	sort.SliceStable(posts, func(i, j int) bool { return posts[i].Gewinn > posts[j].Gewinn })
	var summe money.Cents
	kaeufe := 0
	for _, p := range posts {
		summe += p.Gewinn
		kaeufe += srv.kaeufeVon(p)
	}
	z := []string{"📋 **Deals des Tages** — " + jetzt.Local().Format("02.01.2006")}
	for i, p := range posts {
		if i == 5 {
			break
		}
		titel := p.Titel
		if titel == "" {
			titel = "Deal"
		}
		zeile := fmt.Sprintf("%d. %s — %s Gewinn je Stück (%s, %s)", i+1, titel, p.Gewinn.Euro(), strings.TrimSuffix(p.Shop, mydealzZusatz), p.Gesamt.Euro())
		if !p.AusverkauftAm.IsZero() {
			zeile += " · ausverkauft"
		}
		z = append(z, zeile)
	}
	z = append(z, fmt.Sprintf("📈 %d Deals · zusammen %s Gewinn je Stück · ✅ %d Käufe", len(posts), summe.Euro(), kaeufe))
	return strings.Join(z, "\n")
}

// ---------------------------------------------------------------- Käufe

const kaeufeAlle = 15 * time.Minute

// kaeufeAbgleichen liest die ✅ unter den Ankaufs- und eBay-Posts der
// letzten drei Tage — die Amazon-Deals erledigt der Reaktions-Abgleich der
// Historie schon.
func (srv *Server) kaeufeAbgleichen(ctx context.Context, jetzt time.Time) {
	if jetzt.Sub(srv.kaeufeZuletzt) < kaeufeAlle {
		return
	}
	srv.kaeufeZuletzt = jetzt
	token := srv.store.Einstellung(store.SchluesselBotToken)
	if token == "" {
		return
	}
	posts, err := srv.store.MonitorPostsSeit(jetzt.Add(-72 * time.Hour))
	if err != nil {
		return
	}
	bot := srv.bot(token)
	gekauft := discord.EmojiAus(srv.store.Einstellung(store.SchluesselReaktionGekauft))
	for _, p := range posts {
		if p.DealID != 0 || p.KanalID == "" || p.NachrichtID == "" || ctx.Err() != nil {
			continue
		}
		rs, err := bot.Reaktionen(ctx, p.KanalID, p.NachrichtID)
		if err != nil {
			continue
		}
		_ = srv.store.MonitorPostKaeufe(p.ID, discord.Zaehle(rs, gekauft))
	}
}

// ---------------------------------------------------------------- Auswertung

// auswertungZeile ist eine Gruppe der Auswertung.
type auswertungZeile struct {
	Name       string
	Deals      int
	Kaeufe     int
	Gewinn     money.Cents
	GewinnText string
	Quote      string
}

type auswertung struct {
	Tage       int
	Deals      int
	Kaeufe     int
	GewinnText string
	NachShop   []auswertungZeile
	NachKat    []auswertungZeile
	NachStunde []auswertungZeile
}

func (srv *Server) auswertung(jetzt time.Time, tage int) auswertung {
	a := auswertung{Tage: tage}
	posts, err := srv.store.MonitorPostsSeit(jetzt.AddDate(0, 0, -tage))
	if err != nil {
		return a
	}
	shop, kat, stunde := map[string]*auswertungZeile{}, map[string]*auswertungZeile{}, map[string]*auswertungZeile{}
	zaehle := func(m map[string]*auswertungZeile, name string, k int, g money.Cents) {
		z := m[name]
		if z == nil {
			z = &auswertungZeile{Name: name}
			m[name] = z
		}
		z.Deals++
		z.Kaeufe += k
		z.Gewinn += g
	}
	var summe money.Cents
	for _, p := range posts {
		k := srv.kaeufeVon(p)
		a.Deals++
		a.Kaeufe += k
		summe += p.Gewinn
		zaehle(shop, strings.TrimSuffix(p.Shop, mydealzZusatz), k, p.Gewinn)
		kategorie := p.Kategorie
		if kategorie == "" {
			kategorie = "ohne Kategorie"
		}
		zaehle(kat, kategorie, k, p.Gewinn)
		h := p.GepostetAm.Local().Hour()
		zaehle(stunde, fmt.Sprintf("%02d–%02d Uhr", h/3*3, h/3*3+3), k, p.Gewinn)
	}
	a.GewinnText = summe.Euro()
	liste := func(m map[string]*auswertungZeile, nachName bool) []auswertungZeile {
		var out []auswertungZeile
		for _, z := range m {
			z.GewinnText = z.Gewinn.Euro()
			z.Quote = strconv.Itoa(z.Kaeufe*100/z.Deals) + " %"
			out = append(out, *z)
		}
		sort.Slice(out, func(i, j int) bool {
			if nachName {
				return out[i].Name < out[j].Name
			}
			if out[i].Kaeufe != out[j].Kaeufe {
				return out[i].Kaeufe > out[j].Kaeufe
			}
			return out[i].Deals > out[j].Deals
		})
		return out
	}
	a.NachShop, a.NachKat, a.NachStunde = liste(shop, false), liste(kat, false), liste(stunde, true)
	return a
}

// auswertungTabelle verpackt Titel und Zeilen für die Vorlage.
func auswertungTabelle(titel string, zeilen []auswertungZeile) map[string]any {
	return map[string]any{"Titel": titel, "Zeilen": zeilen}
}
