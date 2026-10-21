package web

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Ergänzungen des Shop-Monitors: Ankäufer mit Staffeln, Preisverlauf,
// Preissturz-Alarm, automatisches „ausverkauft" und Meldungen an euch.

// ---------------------------------------------------------------- Ankäufer

// ankaufAnwenden setzt den Ankaufspreis aus den Ankäufern des Produkts:
// der beste Preis für ein einzelnes Stück. Ohne Ankäufer bleibt der von Hand
// eingetragene Preis.
func (srv *Server) ankaufAnwenden(p *store.MonitorProdukt) {
	if !p.IstAnkauf() {
		return
	}
	alle, err := srv.store.AnkaeuferAlle()
	if err != nil {
		return
	}
	if best, ok := einzelPreis(alle[p.ID]); ok {
		p.Ankauf = best
	}
}

func einzelPreis(as []store.Ankaeufer) (money.Cents, bool) {
	var best money.Cents
	for _, a := range as {
		if a.AbStueck <= 1 && a.Preis > best {
			best = a.Preis
		}
	}
	return best, best > 0
}

// staffelText nennt die Mengenpreise über dem Einzelpreis, ohne Namen:
// „ab 4 Stk 645,00 € · ab 6 Stk 1.180,00 €".
func (srv *Server) staffelText(p store.MonitorProdukt) string {
	alle, err := srv.store.AnkaeuferAlle()
	if err != nil {
		return ""
	}
	besteJe := map[int]money.Cents{}
	for _, a := range alle[p.ID] {
		if a.AbStueck > 1 && a.Preis > p.Ankauf && a.Preis > besteJe[a.AbStueck] {
			besteJe[a.AbStueck] = a.Preis
		}
	}
	var mengen []int
	for m := range besteJe {
		mengen = append(mengen, m)
	}
	sort.Ints(mengen)
	var teile []string
	for _, m := range mengen {
		teile = append(teile, "ab "+strconv.Itoa(m)+" Stk "+besteJe[m].Euro())
	}
	return strings.Join(teile, " · ")
}

// wecker ist die Grenze, bis zu der ein Angebot zählt: der eingetragene
// Höchstpreis bzw. Preiswecker, im Ankaufs-Modus ohne Eintrag 95 % des
// Ankaufspreises.
func (srv *Server) wecker(p store.MonitorProdukt) money.Cents {
	if p.MaxEK > 0 {
		return p.MaxEK
	}
	if p.IstAnkauf() && p.Ankauf > 0 {
		return money.Cents(int64(p.Ankauf) * 95 / 100)
	}
	return 0
}

// ---------------------------------------------------------------- Preisverlauf

// preisZeile sagt im Post, wie gut der Preis ist: „Tiefster Preis seit
// 12 Tagen" oder der Schnitt der letzten sieben Tage. Leer, solange der
// Monitor weniger als einen Tag Verlauf hat.
func (srv *Server) preisZeile(p store.MonitorProdukt, cent money.Cents, jetzt time.Time) string {
	st, err := srv.store.MonitorPreisStand(p.ID, jetzt.AddDate(0, 0, -30), jetzt)
	if err != nil || st.Anzahl < 2 || jetzt.Sub(st.ErsterAm) < 24*time.Hour {
		return ""
	}
	if cent <= st.Tiefst {
		tage := int(jetzt.Sub(st.ErsterAm).Hours() / 24)
		return fmt.Sprintf("📉 Tiefster Preis seit %d Tagen", tage)
	}
	st7, err := srv.store.MonitorPreisStand(p.ID, jetzt.AddDate(0, 0, -7), jetzt)
	if err != nil || st7.Anzahl == 0 {
		return ""
	}
	return "📊 Ø 7 Tage: " + st7.Schnitt.Euro()
}

// ---------------------------------------------------------------- Ausverkauft

// ausverkauftPruefen markiert die Posts eines Produkts der letzten drei Tage
// als ausverkauft, sobald ihr Shop das Angebot nicht mehr zum geposteten
// Preis führt (mit zwei Prozent Spielraum für Versand-Schwankungen).
func (srv *Server) ausverkauftPruefen(ctx context.Context, p store.MonitorProdukt, angebote []billiger.Angebot, maxTage int, jetzt time.Time) {
	if srv.store.Einstellung(store.SchluesselMonitorAusverkauft) != "1" {
		return
	}
	posts, err := srv.store.MonitorOffenePosts(p.ID, jetzt.Add(-72*time.Hour))
	if err != nil || len(posts) == 0 {
		return
	}
	for _, post := range posts {
		// mydealz-Deals lassen sich bei billiger.de nicht nachsehen.
		if strings.HasSuffix(post.Shop, mydealzZusatz) {
			continue
		}
		nurShop := p
		nurShop.Shops = post.Shop
		a, ok := bestesAngebot(nurShop, angebote, maxTage, jetzt)
		if ok && a.Gesamt*100 <= post.Gesamt*102 {
			continue
		}
		if err := srv.postAusverkauft(ctx, post); err != nil {
			srv.adminMelden(ctx, "ausverkauft", "⚠️ Monitor: Post nicht als ausverkauft markiert ("+p.Name+"): "+sicherFehlertext(err.Error()))
			continue
		}
		_ = srv.store.MonitorPostAusverkauft(post.ID, jetzt)
	}
}

func (srv *Server) postAusverkauft(ctx context.Context, post store.MonitorPost) error {
	if post.DealID != 0 {
		deals, err := srv.store.DealsZuHaupt(post.DealID)
		if err != nil {
			return err
		}
		for _, d := range deals {
			if d.Status != store.StatusAktiv {
				continue
			}
			if err := srv.setzePostStatus(ctx, d, store.StatusAusverkauft); err != nil {
				return err
			}
		}
		return nil
	}
	if post.NachrichtID == "" {
		return nil
	}
	c, err := srv.store.Channel(post.ChannelID)
	if err != nil {
		return errors.New("Channel gibt es nicht mehr")
	}
	return discord.Bearbeite(ctx, srv.http, c.WebhookURL, post.NachrichtID, ausverkauftText(post.Text))
}

// ---------------------------------------------------------------- Preissturz

func (srv *Server) sturzChannel() (store.Channel, bool) {
	id := int64(srv.store.EinstellungZahl(store.SchluesselMonitorSturzChannel))
	if id == 0 {
		return store.Channel{}, false
	}
	c, err := srv.store.Channel(id)
	return c, err == nil && !c.Defekt
}

// sturzProzent ist, wie weit ein Preis unter dem 7-Tage-Schnitt liegt; ok
// nur, wenn es genug Verlauf gibt (drei Preise über mindestens einen Tag).
func sturzProzent(st store.PreisStand, cent money.Cents, jetzt time.Time) (float64, bool) {
	if st.Anzahl < 3 || jetzt.Sub(st.ErsterAm) < 24*time.Hour || st.Schnitt <= 0 {
		return 0, false
	}
	return float64(st.Schnitt-cent) * 100 / float64(st.Schnitt), true
}

// preissturzPruefen meldet ein Produkt im Preissturz-Channel, wenn es
// deutlich unter seinem 7-Tage-Schnitt liegt — unabhängig vom Preiswecker.
func (srv *Server) preissturzPruefen(ctx context.Context, p store.MonitorProdukt, liste billiger.Preisliste, a billiger.Angebot, jetzt time.Time) {
	c, ok := srv.sturzChannel()
	if !ok {
		return
	}
	st, err := srv.store.MonitorPreisStand(p.ID, jetzt.AddDate(0, 0, -7), jetzt)
	if err != nil {
		return
	}
	prozentUnter, ok := sturzProzent(st, a.Gesamt, jetzt)
	if !ok || prozentUnter < float64(srv.store.EinstellungZahl(store.SchluesselMonitorSturzProzent)) {
		return
	}
	schluessel := fmt.Sprintf("sturz:%d:%s:%d", p.ID, a.Shop, a.Gesamt)
	if srv.store.SchonGemeldet(schluessel, jetzt.Add(-24*time.Hour)) {
		return
	}
	name := p.Name
	if name == "" {
		name = liste.Name
	}
	z := []string{
		strings.TrimSpace("⚠️ Preissturz: " + name + " " + mentionText(c.ID, srv)),
		"🏬 [" + linkText(a.Shop) + "](" + erstesNichtLeer(srv.shopLink(a, liste.URL), liste.URL) + ")",
		fmt.Sprintf("💰 %s — %s unter Ø 7 Tage (%s)", a.Gesamt.Euro(), prozent(prozentUnter, 0), st.Schnitt.Euro()),
	}
	if p.IstAnkauf() && p.Ankauf > 0 {
		g, m := ankaufZahlen(p.Ankauf, a.Gesamt)
		z = append(z, "🤝 Ankauf: "+p.Ankauf.Euro()+" · Gewinn "+g.Euro()+" / "+prozent(m, 1))
	}
	if liste.EAN != "" {
		z = append(z, "🔢 EAN: "+liste.EAN)
	}
	text := strings.Join(z, "\n")
	g, err := discord.SendeMitWiederholung(ctx, srv.http, c.WebhookURL, discord.Nachricht{
		Inhalt: text, Mention: discord.MentionTyp(c.MentionTyp), RollenID: c.RollenID,
	})
	if err != nil {
		srv.adminMelden(ctx, "discord", "⚠️ Monitor: Preissturz nicht gepostet ("+name+"): "+sicherFehlertext(err.Error()))
		return
	}
	_ = srv.store.Gemeldet(schluessel, jetzt)
	_ = srv.store.MonitorPostMerken(store.MonitorPost{ProduktID: p.ID, Shop: a.Shop, Gesamt: a.Gesamt,
		ChannelID: c.ID, NachrichtID: g.NachrichtID, Text: text, GepostetAm: jetzt})
	srv.monitorProtokoll(p, name, a, monitorBericht{}, true, "Preissturz gemeldet in #"+c.Name+": "+prozent(prozentUnter, 0)+" unter Ø 7 Tage")
}

// ---------------------------------------------------------------- Admin

// adminMelden schickt euch eine Meldung in den Admin-Channel — dieselbe Art
// (art) höchstens einmal je Stunde, damit ein länger dauernder Fehler den
// Channel nicht flutet.
func (srv *Server) adminMelden(ctx context.Context, art, text string) {
	id := int64(srv.store.EinstellungZahl(store.SchluesselMonitorAdminChannel))
	if id == 0 {
		return
	}
	jetzt := time.Now()
	schluessel := "admin:" + art
	if srv.store.SchonGemeldet(schluessel, jetzt.Add(-time.Hour)) {
		return
	}
	c, err := srv.store.Channel(id)
	if err != nil {
		return
	}
	if _, err := discord.SendeMitWiederholung(ctx, srv.http, c.WebhookURL, discord.Nachricht{Inhalt: text, Mention: discord.MentionKeine}); err == nil {
		_ = srv.store.Gemeldet(schluessel, jetzt)
	}
}

func erstesNichtLeer(werte ...string) string {
	for _, w := range werte {
		if w != "" {
			return w
		}
	}
	return ""
}
