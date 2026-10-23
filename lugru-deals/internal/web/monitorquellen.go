package web

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/mydealz"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Die Nebenquellen des Monitors: der Feed neuer Deals bei mydealz und die
// Kategorieseiten bei billiger.de. Beide laufen im selben Takt wie die
// Produkte, aber seltener.

const (
	mydealzAlle   = time.Minute
	mydealzAlter  = 2 * time.Hour
	kategorieAlle = 10 * time.Minute
	// mydealzZusatz hängt am Shopnamen eines Angebots aus mydealz, damit
	// Posts und Protokoll die Quelle zeigen.
	mydealzZusatz = " (via mydealz)"
)

// monitorNebenquellen prüft mydealz und die fälligen Kategorien.
func (srv *Server) monitorNebenquellen(ctx context.Context) {
	jetzt := time.Now()
	if srv.store.Einstellung(store.SchluesselMonitorMydealz) == "1" && jetzt.Sub(srv.mydealzZuletzt) >= mydealzAlle {
		srv.mydealzZuletzt = jetzt
		srv.mydealzPruefen(ctx, jetzt)
	}
	srv.feedsPruefen(ctx, jetzt)
	srv.tageszusammenfassung(ctx, jetzt)
	srv.podcastsPruefen(ctx, jetzt)
	srv.keepaSuchenPruefen(ctx, jetzt)
	srv.kaeufeAbgleichen(ctx, jetzt)
	ks, err := srv.store.Kategorien()
	if err != nil {
		return
	}
	for _, k := range ks {
		if k.Aktiv && jetzt.Sub(k.GeprueftAm) >= kategorieAlle {
			srv.kategoriePruefen(ctx, k, jetzt)
		}
	}
}

func (srv *Server) mydealzURL() string {
	if srv.mydealzFeed != "" {
		return srv.mydealzFeed
	}
	return mydealz.FeedURL
}

// mydealzPruefen ordnet neue mydealz-Deals den Produkten mit Stichworten zu
// und bewertet sie wie ein Angebot von billiger.de.
func (srv *Server) mydealzPruefen(ctx context.Context, jetzt time.Time) {
	deals, err := mydealz.Hole(ctx, srv.monitorClient(), srv.mydealzURL())
	if err != nil {
		srv.adminMelden(ctx, "mydealz", "⚠️ Monitor: mydealz nicht lesbar: "+sicherFehlertext(err.Error()))
		return
	}
	produkte, err := srv.store.MonitorProdukte()
	if err != nil {
		return
	}
	for _, d := range deals {
		schluessel := "mydealz:" + d.Link
		if srv.store.SchonGemeldet(schluessel, jetzt.AddDate(0, 0, -30)) {
			continue
		}
		_ = srv.store.Gemeldet(schluessel, jetzt)
		if d.Preis <= 0 || (!d.Zeit.IsZero() && jetzt.Sub(d.Zeit) > mydealzAlter) {
			continue
		}
		for _, p := range produkte {
			stichworte := strings.TrimSpace(p.Stichworte)
			if stichworte == "" && p.Name != "" {
				stichworte = stichworteAus(p.Name)
			}
			if !p.Aktiv || stichworte == "" || !mydealz.Passt(d.Titel, stichworte) {
				continue
			}
			srv.mydealzBewerten(ctx, p, d, jetzt)
		}
	}
}

func (srv *Server) mydealzBewerten(ctx context.Context, p store.MonitorProdukt, d mydealz.Deal, jetzt time.Time) monitorBericht {
	srv.monitorMu.Lock()
	defer srv.monitorMu.Unlock()
	srv.ankaufAnwenden(&p)
	haendler := d.Haendler
	if haendler == "" {
		haendler = "mydealz"
	}
	liste := billiger.Preisliste{URL: d.Link, Name: p.Name, EAN: p.EAN}
	a := billiger.Angebot{Shop: haendler + mydealzZusatz, Titel: d.Titel, Preis: d.Preis, Gesamt: d.Preis, Status: billiger.Lieferbar, Code: d.Code}
	a = srv.rabatteAnwenden([]billiger.Angebot{a})[0]
	b := srv.monitorAngebotAlle(ctx, p, liste, a, false, jetzt)
	if !b.Gepostet && !b.Bewertet {
		srv.monitorProtokoll(p, d.Titel, a, b, false, "mydealz: "+b.Status)
	}
	return b
}

// kategoriePruefen liest eine Kategorieseite und meldet Produkte, die weit
// unter ihrem eigenen 7-Tage-Schnitt liegen, im Preissturz-Channel.
func (srv *Server) kategoriePruefen(ctx context.Context, k store.MonitorKategorie, jetzt time.Time) {
	kacheln, err := billiger.HoleKategorie(ctx, srv.monitorClient(), k.URL)
	if err != nil {
		_ = srv.store.KategorieGeprueft(k.ID, jetzt, "Fehler: "+sicherFehlertext(err.Error()))
		srv.adminMelden(ctx, "kategorie", "⚠️ Monitor: Kategorie „"+k.Name+"“ nicht lesbar: "+sicherFehlertext(err.Error()))
		return
	}
	c, kanal := srv.sturzChannel()
	schwelle := float64(srv.store.EinstellungZahl(store.SchluesselMonitorSturzProzent))
	gemeldet := 0
	for _, kachel := range kacheln {
		_ = srv.store.KategoriePreisMerken(kachel.Objekt, kachel.Preis, jetzt)
		if !kanal {
			continue
		}
		st, err := srv.store.KategoriePreisStand(kachel.Objekt, jetzt.AddDate(0, 0, -7), jetzt)
		if err != nil {
			continue
		}
		unter, ok := sturzProzent(st, kachel.Preis, jetzt)
		if !ok || unter < schwelle {
			continue
		}
		schluessel := fmt.Sprintf("kat:%s:%d", kachel.Objekt, kachel.Preis)
		if srv.store.SchonGemeldet(schluessel, jetzt.Add(-24*time.Hour)) {
			continue
		}
		text := strings.Join([]string{
			strings.TrimSpace("📉 Preissturz (" + k.Name + "): " + kachel.Name + " " + mentionText(c.ID, srv)),
			fmt.Sprintf("💰 ab %s — %s unter Ø 7 Tage (%s)", kachel.Preis.Euro(), prozent(unter, 0), st.Schnitt.Euro()),
			"🔗 [Angebote bei billiger.de](" + kachel.URL + ")",
		}, "\n")
		if _, err := discord.SendeMitWiederholung(ctx, srv.http, c.WebhookURL, discord.Nachricht{
			Inhalt: text, Mention: discord.MentionTyp(c.MentionTyp), RollenID: c.RollenID,
		}); err != nil {
			srv.adminMelden(ctx, "discord", "⚠️ Monitor: Preissturz nicht gepostet ("+kachel.Name+"): "+sicherFehlertext(err.Error()))
			continue
		}
		_ = srv.store.Gemeldet(schluessel, jetzt)
		gemeldet++
	}
	status := fmt.Sprintf("%d Produkte gelesen", len(kacheln))
	if gemeldet > 0 {
		status += fmt.Sprintf(", %d Preisstürze gemeldet", gemeldet)
	}
	if !kanal {
		status += " — kein Preissturz-Channel gewählt, es wird nur aufgezeichnet"
	}
	_ = srv.store.KategorieGeprueft(k.ID, jetzt, status)
}
