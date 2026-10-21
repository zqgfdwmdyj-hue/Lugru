package web

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Der Ankaufs-Modus des Shop-Monitors: verkauft wird nicht bei Amazon,
// sondern direkt an einen Ankäufer zu einem festen Preis. Ein Treffer ist
// darum schlicht „Gesamtpreis bei einem Shop ≤ Preiswecker" — Keepa wird
// nicht gefragt, es kostet also keine Token.
//
// Der Post nennt den Ankaufspreis, aber nie den Ankäufer: die Namen stehen
// nur in der Oberfläche.

// ankaufZahlen rechnet Gewinn je Stück und Marge, bezogen auf den
// Ankaufspreis — so wie der Preiswecker als Anteil am Ankauf gesetzt wird.
func ankaufZahlen(ankauf, ek money.Cents) (money.Cents, float64) {
	gewinn := ankauf - ek
	if ankauf <= 0 {
		return gewinn, 0
	}
	return gewinn, float64(gewinn) * 100 / float64(ankauf)
}

// ankaufText baut den Post. Aufbau und Zeichen folgen der Standardvorlage
// der Amazon-Deals, damit beide im Channel gleich aussehen.
func (srv *Server) ankaufText(p store.MonitorProdukt, liste billiger.Preisliste, a billiger.Angebot, channelID int64) string {
	name := p.Name
	if name == "" {
		name = liste.Name
	}
	gewinn, marge := ankaufZahlen(p.Ankauf, a.Gesamt)
	var z []string
	z = append(z, strings.TrimSpace("🛒 "+name+" "+mentionText(channelID, srv)))
	if pe, ok := srv.poster(srv.store.Einstellung(store.SchluesselMonitorPoster)); ok {
		z = append(z, "👤 Deal von "+pe.posterText())
	}
	z = append(z, "🏬 ["+linkText(a.Shop)+"]("+liste.URL+")")
	ek := "💰 EK: " + a.Gesamt.Euro()
	if a.Versand > 0 {
		ek += " (inkl. " + a.Versand.Euro() + " Versand)"
	}
	z = append(z, ek)
	if a.Lieferzeit != "" {
		l := "🚚 Lieferzeit: " + a.Lieferzeit
		if a.Status == billiger.Verzoegert {
			l = "⏳ Längere Lieferzeit: " + a.Lieferzeit
		}
		z = append(z, l)
	}
	z = append(z, "🤝 Ankauf: "+p.Ankauf.Euro())
	if st := srv.staffelText(p); st != "" {
		z = append(z, "📦 Mengen: "+st)
	}
	z = append(z, "🤑 Gewinn: "+gewinn.Euro()+" / "+prozent(marge, 1)+" Marge")
	if zeile := srv.preisZeile(p, a.Gesamt, time.Now()); zeile != "" {
		z = append(z, zeile)
	}
	if h := strings.TrimSpace(p.Hinweis); h != "" {
		z = append(z, "ℹ️ "+h)
	}
	if liste.EAN != "" {
		z = append(z, "🔢 EAN: "+liste.EAN)
	}
	return strings.Join(z, "\n")
}

// linkText entschärft einen Shopnamen für den Linktext in Markdown.
func linkText(s string) string {
	return strings.NewReplacer("[", "(", "]", ")").Replace(s)
}

func (srv *Server) monitorAnkauf(ctx context.Context, p store.MonitorProdukt, liste billiger.Preisliste, bester billiger.Angebot, test bool, jetzt time.Time, b *monitorBericht) {
	if p.Ankauf <= 0 {
		b.Status = "Ankaufspreis fehlt — bitte eintragen oder einen Ankäufer anlegen"
		return
	}
	b.Bewertet = true
	b.Gewinn, b.Marge = ankaufZahlen(p.Ankauf, bester.Gesamt)
	kennzahlen := fmt.Sprintf("%s bei %s · Ankauf %s · Gewinn %s · Marge %s",
		bester.Gesamt.Euro(), bester.Shop, p.Ankauf.Euro(), b.Gewinn.Euro(), prozent(b.Marge, 1))

	sperre := srv.monitorSperre()
	if !test {
		if p.BewertetShop == bester.Shop && p.BewertetCent == bester.Gesamt && jetzt.Sub(p.BewertetAm) < sperre {
			b.Status = "unverändert: " + kennzahlen
			return
		}
		_ = srv.store.MonitorBewertet(p.ID, bester.Shop, bester.Gesamt, jetzt)
		if g, ok := srv.store.MonitorZuletztGepostet(p.ID, jetzt.Add(-sperre)); ok && bester.Gesamt >= g.Gesamt {
			b.Status = fmt.Sprintf("schon gepostet (%s bei %s um %s)", g.Gesamt.Euro(), g.Shop, g.Zeit.Local().Format("15:04"))
			return
		}
	}

	b.Channels = srv.monitorChannels(p, bester.Shop, *b)
	titel := p.Name
	if titel == "" {
		titel = liste.Name
	}
	if len(b.Channels) == 0 {
		b.Status = "keine Regel passt: " + kennzahlen
		if test {
			b.Karte = kartenVorschauAus(srv.ankaufText(p, liste, bester, 0), "")
		} else {
			srv.monitorProtokoll(p, titel, bester, *b, false, b.Status)
		}
		return
	}
	if test {
		b.Karte = kartenVorschauAus(srv.ankaufText(p, liste, bester, b.Channels[0].ID), "")
		b.Status = "würde gepostet in " + channelNamen(b.Channels) + ": " + kennzahlen
		return
	}

	var gepostet, fehler []string
	telegramGesendet := false
	for _, c := range b.Channels {
		text := srv.ankaufText(p, liste, bester, c.ID)
		g, err := discord.SendeMitWiederholung(ctx, srv.http, c.WebhookURL, discord.Nachricht{
			Inhalt: text, Mention: discord.MentionTyp(c.MentionTyp), RollenID: c.RollenID,
		})
		if err != nil {
			if errors.Is(err, discord.ErrWebhookTot) {
				_ = srv.store.ChannelDefekt(c.ID, true)
			}
			fehler = append(fehler, "#"+c.Name+": "+sicherFehlertext(err.Error()))
			continue
		}
		_ = srv.store.ChannelDefekt(c.ID, false)
		_ = srv.store.MonitorPostMerken(store.MonitorPost{ProduktID: p.ID, Shop: bester.Shop, Gesamt: bester.Gesamt,
			ChannelID: c.ID, NachrichtID: g.NachrichtID, Text: text, GepostetAm: jetzt})
		srv.reaktionenVorbelegen(g.KanalID, g.NachrichtID, c.Name)
		if !telegramGesendet {
			srv.anTelegram(text, nil)
			telegramGesendet = true
		}
		gepostet = append(gepostet, "#"+c.Name)
	}
	if len(gepostet) == 0 {
		b.Status = "nicht gesendet: " + strings.Join(fehler, " · ")
		srv.monitorProtokoll(p, titel, bester, *b, false, b.Status)
		srv.adminMelden(ctx, "discord", "⚠️ Monitor: Ankaufs-Deal nicht gepostet ("+titel+"): "+b.Status)
		return
	}
	b.Gepostet = true
	b.Status = "gepostet in " + strings.Join(gepostet, ", ") + ": " + kennzahlen
	if len(fehler) > 0 {
		b.Status += " · nicht gepostet: " + strings.Join(fehler, " · ")
	}
	srv.monitorProtokoll(p, titel, bester, *b, true, b.Status)
}
