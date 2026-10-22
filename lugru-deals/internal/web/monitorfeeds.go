package web

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/mydealz"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Deal-Feeds: Gruppen bei mydealz — Reisen, Auto-Leasing, Elektronik, die
// angesagtesten Deals — gefiltert und in einen Channel gepostet. Anders als
// der Shop-Monitor rechnet hier nichts gegen Amazon oder einen Ankauf: es
// geht um Deals zum eigenen Gebrauch, für Urlaub und Auto.

const (
	feedAlle = 2 * time.Minute
	// feedJeLauf begrenzt die Posts je Feed und Abruf, falls ein Filter zu
	// weit gefasst ist.
	feedJeLauf = 10
)

// feedQuelle macht aus einer Eingabe die Adresse des RSS-Feeds: ein Name wie
// „auto-leasing" oder „trending", ein Link auf eine Gruppe
// (mydealz.de/gruppe/reisen) oder ein Link auf einen RSS-Feed.
func feedQuelle(roh string) (string, error) {
	roh = strings.TrimSpace(roh)
	fehler := errors.New("bitte eine Gruppe bei mydealz angeben, etwa „reisen“, „auto-leasing“, „trending“ oder den Link mydealz.de/gruppe/…")
	if roh == "" {
		return "", fehler
	}
	pfad := roh
	if strings.Contains(roh, "://") {
		u, err := url.Parse(roh)
		if err != nil || strings.TrimPrefix(strings.ToLower(u.Host), "www.") != "mydealz.de" {
			return "", fehler
		}
		pfad = strings.Trim(u.Path, "/")
	}
	pfad = strings.Trim(strings.ToLower(pfad), "/")
	switch {
	case strings.HasPrefix(pfad, "rss/"):
		pfad = strings.TrimPrefix(pfad, "rss/")
	case strings.HasPrefix(pfad, "gruppe/"):
	case pfad == "trending" || pfad == "deals" || pfad == "hot":
	default:
		pfad = "gruppe/" + pfad
	}
	if pfad == "hot" {
		pfad = "trending"
	}
	for _, r := range pfad {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '/') {
			return "", fehler
		}
	}
	return "https://www.mydealz.de/rss/" + pfad, nil
}

// feedPasst prüft einen Deal gegen die Filter eines Feeds.
func feedPasst(f store.DealFeed, d mydealz.Deal, l mydealz.Leasing) bool {
	if strings.TrimSpace(f.Stichworte) != "" && !passtOderNurVerbote(d.Titel, f.Stichworte) {
		return false
	}
	if f.MinTemp > 0 && (!d.TemperaturBekannt || d.Temperatur < f.MinTemp) {
		return false
	}
	if f.Art == store.FeedLeasing {
		if f.MaxLF > 0 && (l.Faktor == 0 || l.Faktor > f.MaxLF) {
			return false
		}
		if f.LeasingArt != "" && l.Art != f.LeasingArt {
			return false
		}
		if f.MaxPreis > 0 && (l.Rate == 0 || l.Rate > f.MaxPreis) {
			return false
		}
		return true
	}
	if f.MaxPreis > 0 && d.Preis > f.MaxPreis {
		return false
	}
	return true
}

// passtOderNurVerbote: stehen nur Ausschlüsse da („-kreuzfahrt"), passt
// jeder Titel ohne sie.
func passtOderNurVerbote(titel, stichworte string) bool {
	positiv := false
	for _, s := range strings.FieldsFunc(stichworte, func(r rune) bool { return r == ',' || r == '\n' || r == ';' }) {
		if s = strings.TrimSpace(s); s != "" && !strings.HasPrefix(s, "-") {
			positiv = true
		}
	}
	if !positiv {
		return mydealz.Passt(titel, stichworte+", "+titel)
	}
	return mydealz.Passt(titel, stichworte)
}

// feedText baut den Post.
func (srv *Server) feedText(f store.DealFeed, d mydealz.Deal, l mydealz.Leasing, channelID int64) string {
	zeichen := map[string]string{store.FeedReisen: "✈️", store.FeedLeasing: "🚗"}[f.Art]
	if zeichen == "" {
		zeichen = "🔥"
	}
	z := []string{strings.TrimSpace(zeichen + " " + d.Titel + " " + mentionText(channelID, srv))}
	switch f.Art {
	case store.FeedLeasing:
		var teile []string
		if l.Rate > 0 {
			teile = append(teile, l.Rate.Euro()+" mtl.")
		}
		if l.Monate > 0 {
			teile = append(teile, strconv.Itoa(l.Monate)+" Monate")
		}
		if l.Faktor > 0 {
			teile = append(teile, "LF "+strings.ReplaceAll(strconv.FormatFloat(l.Faktor, 'f', 2, 64), ".", ","))
		}
		if l.Gesamtkostenfaktor > 0 {
			teile = append(teile, "GKF "+strings.ReplaceAll(strconv.FormatFloat(l.Gesamtkostenfaktor, 'f', 2, 64), ".", ","))
		}
		if len(teile) > 0 {
			z = append(z, "💶 "+strings.Join(teile, " · "))
		}
		if l.Art != "" {
			z = append(z, "🏷️ "+map[string]string{"privat": "Privatleasing", "gewerbe": "Gewerbeleasing"}[l.Art])
		}
		if d.Haendler != "" {
			z = append(z, "🏬 "+d.Haendler)
		}
	default:
		zeile := ""
		if d.Preis > 0 {
			zeile = "💰 " + d.Preis.Euro()
		}
		if d.Haendler != "" {
			zeile = strings.TrimSpace(zeile + " bei " + d.Haendler)
			if d.Preis == 0 {
				zeile = "🏬 " + d.Haendler
			}
		}
		if zeile != "" {
			z = append(z, zeile)
		}
		if d.TemperaturBekannt {
			z = append(z, "🌡️ "+strconv.Itoa(d.Temperatur)+"°")
		}
	}
	if d.Code != "" {
		z = append(z, "🎟️ Code: "+d.Code)
	}
	z = append(z, "🔗 "+d.Link)
	return strings.Join(z, "\n")
}

func (srv *Server) feedsPruefen(ctx context.Context, jetzt time.Time) {
	feeds, err := srv.store.Feeds()
	if err != nil {
		return
	}
	geladen := map[string][]mydealz.Deal{}
	for _, f := range feeds {
		if !f.Aktiv || jetzt.Sub(f.GeprueftAm) < feedAlle {
			continue
		}
		srv.feedPruefen(ctx, f, geladen, jetzt)
	}
}

// feedPruefen holt einen Feed (je Adresse nur einmal pro Durchgang) und
// postet die neuen passenden Deals. Beim allerersten Abruf werden die
// vorhandenen Deals nur gemerkt — sonst käme beim Anlegen eine Flut alter
// Posts.
func (srv *Server) feedPruefen(ctx context.Context, f store.DealFeed, geladen map[string][]mydealz.Deal, jetzt time.Time) {
	quelle := f.Quelle
	if srv.mydealzFeed != "" {
		quelle = srv.mydealzFeed
	}
	deals, ok := geladen[quelle]
	if !ok {
		var err error
		deals, err = mydealz.Hole(ctx, srv.monitorClient(), quelle)
		if err != nil {
			_ = srv.store.FeedGeprueft(f.ID, jetzt, "Fehler: "+sicherFehlertext(err.Error()))
			srv.adminMelden(ctx, "feed", "⚠️ Deal-Feed „"+f.Name+"“ nicht lesbar: "+sicherFehlertext(err.Error()))
			return
		}
		geladen[quelle] = deals
	}
	c, err := srv.store.Channel(f.ChannelID)
	if err != nil {
		_ = srv.store.FeedGeprueft(f.ID, jetzt, "Channel gibt es nicht mehr")
		return
	}
	erster := f.GeprueftAm.IsZero()
	gepostet, passend := 0, 0
	for _, d := range deals {
		schluessel := fmt.Sprintf("feed:%d:%s", f.ID, d.Link)
		if srv.store.SchonGemeldet(schluessel, jetzt.AddDate(0, 0, -30)) {
			continue
		}
		_ = srv.store.Gemeldet(schluessel, jetzt)
		l := mydealz.LiesLeasing(d)
		if erster || !feedPasst(f, d, l) {
			continue
		}
		passend++
		if gepostet >= feedJeLauf {
			continue
		}
		if _, err := discord.SendeMitWiederholung(ctx, srv.http, c.WebhookURL, discord.Nachricht{
			Inhalt: srv.feedText(f, d, l, c.ID), Mention: discord.MentionTyp(c.MentionTyp), RollenID: c.RollenID,
		}); err != nil {
			if errors.Is(err, discord.ErrWebhookTot) {
				_ = srv.store.ChannelDefekt(c.ID, true)
			}
			srv.adminMelden(ctx, "discord", "⚠️ Deal-Feed „"+f.Name+"“: nicht gepostet: "+sicherFehlertext(err.Error()))
			break
		}
		gepostet++
	}
	status := fmt.Sprintf("%d Deals gelesen", len(deals))
	switch {
	case erster:
		status += " — beim ersten Abruf nur gemerkt, ab jetzt kommen neue"
	case gepostet > 0:
		status += fmt.Sprintf(", %d gepostet", gepostet)
	}
	if passend > gepostet {
		status += fmt.Sprintf(" (%d weitere passende übersprungen — Filter enger fassen?)", passend-gepostet)
	}
	_ = srv.store.FeedGeprueft(f.ID, jetzt, status)
}

// ---------------------------------------------------------------- Seite

type feedAnzeige struct {
	store.DealFeed
	ChannelName string
	Filter      string
}

func (srv *Server) feedAnzeigen(kanalName map[int64]string) []feedAnzeige {
	fs, _ := srv.store.Feeds()
	var out []feedAnzeige
	for _, f := range fs {
		a := feedAnzeige{DealFeed: f, ChannelName: kanalName[f.ChannelID]}
		var filter []string
		if f.Stichworte != "" {
			filter = append(filter, "Stichworte: "+f.Stichworte)
		}
		if f.MaxPreis > 0 {
			if f.Art == store.FeedLeasing {
				filter = append(filter, "Rate bis "+f.MaxPreis.Euro())
			} else {
				filter = append(filter, "bis "+f.MaxPreis.Euro())
			}
		}
		if f.MinTemp > 0 {
			filter = append(filter, "ab "+strconv.Itoa(f.MinTemp)+"°")
		}
		if f.MaxLF > 0 {
			filter = append(filter, "LF bis "+strings.ReplaceAll(strconv.FormatFloat(f.MaxLF, 'f', -1, 64), ".", ","))
		}
		if f.LeasingArt != "" {
			filter = append(filter, "nur "+f.LeasingArt)
		}
		a.Filter = strings.Join(filter, " · ")
		out = append(out, a)
	}
	return out
}

func (srv *Server) speichereFeed(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	channelID, _ := strconv.ParseInt(r.PostForm.Get("channel_id"), 10, 64)
	if _, err := srv.store.Channel(channelID); err != nil {
		srv.monitorMeldung(w, "", "Bitte einen Channel wählen.")
		return
	}
	f := store.DealFeed{ChannelID: channelID}
	switch r.PostForm.Get("vorlage") {
	case "reisen":
		f.Name, f.Art, f.Quelle = "Reisen", store.FeedReisen, "reisen"
	case "leasing":
		f.Name, f.Art, f.Quelle, f.MaxLF = "Auto-Leasing (LF bis 0,5)", store.FeedLeasing, "auto-leasing", 0.5
	case "eigen":
		f.Name, f.Art, f.Quelle, f.MinTemp = "Eigengebrauch: Hot-Deals ab 200°", store.FeedAllgemein, "trending", 200
	default:
		f.Name, f.Art, f.Quelle = r.PostForm.Get("name"), r.PostForm.Get("art"), r.PostForm.Get("quelle")
		f.Stichworte = r.PostForm.Get("stichworte")
		f.LeasingArt = map[string]string{"privat": "privat", "gewerbe": "gewerbe"}[r.PostForm.Get("leasing_art")]
		var err error
		if f.MaxPreis, err = betragOderNull(r.PostForm.Get("max_preis")); err != nil {
			srv.monitorMeldung(w, "", "Höchstpreis: kein gültiger Betrag.")
			return
		}
		if s := strings.TrimSpace(r.PostForm.Get("min_temp")); s != "" {
			if f.MinTemp, err = strconv.Atoi(s); err != nil {
				srv.monitorMeldung(w, "", "Mindest-Temperatur: keine ganze Zahl.")
				return
			}
		}
		if s := strings.TrimSpace(strings.ReplaceAll(r.PostForm.Get("max_lf"), ",", ".")); s != "" {
			if f.MaxLF, err = strconv.ParseFloat(s, 64); err != nil {
				srv.monitorMeldung(w, "", "Leasingfaktor: keine Zahl.")
				return
			}
		}
	}
	quelle, err := feedQuelle(f.Quelle)
	if err != nil {
		srv.monitorMeldung(w, "", err.Error())
		return
	}
	f.Quelle = quelle
	if strings.TrimSpace(f.Name) == "" {
		f.Name = strings.TrimPrefix(quelle, "https://www.mydealz.de/rss/")
	}
	if err := srv.store.FeedAnlegen(f); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Feed „"+f.Name+"“ angelegt. Beim ersten Abruf merkt er sich die vorhandenen Deals, danach postet er jeden neuen passenden.", "")
}

func (srv *Server) schalteFeed(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	_ = srv.store.FeedAktiv(idAusPfad(r), r.PostForm.Get("aktiv") == "1")
	srv.monitorMeldung(w, "Gespeichert.", "")
}

func (srv *Server) loescheFeed(w http.ResponseWriter, r *http.Request) {
	_ = srv.store.FeedLoeschen(idAusPfad(r))
	srv.monitorMeldung(w, "Feed gelöscht.", "")
}
