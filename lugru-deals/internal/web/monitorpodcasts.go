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
	"github.com/trinkfreunde/lugru-deal-discord/internal/podcast"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Podcasts: neue Folgen der Top-Podcasts einer Kategorie (Apple-Charts
// Deutschland) oder eines einzelnen Podcasts, gepostet in einen Channel.

const (
	podcastAlle = 30 * time.Minute
	// podcastAlter: ältere Folgen werden nie gepostet — etwa wenn ein
	// Podcast neu in die Charts kommt.
	podcastAlter  = 48 * time.Hour
	podcastJeLauf = 10
)

func (srv *Server) podcastClient() podcast.Client {
	return podcast.Client{HTTP: srv.monitorClient(), AppleURL: srv.appleBasisURL}
}

// podcastFeeds liefert die Feeds einer Quelle: den eigenen oder die der
// Top-Podcasts ihrer Kategorie.
func (srv *Server) podcastFeeds(ctx context.Context, q store.PodcastQuelle) ([]string, error) {
	if q.Genre == 0 {
		return []string{q.Feed}, nil
	}
	c := srv.podcastClient()
	charts, err := c.Charts(ctx, q.Genre, q.Anzahl)
	if err != nil {
		return nil, err
	}
	var feeds []string
	for _, p := range charts {
		feed, ok := srv.store.PodcastFeed(p.ID)
		if !ok {
			var name string
			if feed, name, err = c.FeedAdresse(ctx, p.ID); err != nil {
				continue
			}
			_ = srv.store.PodcastFeedMerken(p.ID, feed, name)
		}
		feeds = append(feeds, feed)
	}
	return feeds, nil
}

func (srv *Server) podcastsPruefen(ctx context.Context, jetzt time.Time) {
	qs, err := srv.store.Podcasts()
	if err != nil {
		return
	}
	for _, q := range qs {
		if q.Aktiv && jetzt.Sub(q.GeprueftAm) >= podcastAlle {
			srv.podcastPruefen(ctx, q, jetzt)
		}
	}
}

// podcastPruefen postet die neuen Folgen einer Quelle. Einen Feed, den sie
// zum ersten Mal sieht, merkt sie sich nur — sonst käme beim Anlegen oder bei
// einem Neuling in den Charts eine Flut alter Folgen.
func (srv *Server) podcastPruefen(ctx context.Context, q store.PodcastQuelle, jetzt time.Time) {
	feeds, err := srv.podcastFeeds(ctx, q)
	if err != nil {
		_ = srv.store.PodcastGeprueft(q.ID, jetzt, "Fehler: "+sicherFehlertext(err.Error()))
		return
	}
	c, err := srv.store.Channel(q.ChannelID)
	if err != nil {
		_ = srv.store.PodcastGeprueft(q.ID, jetzt, "Channel gibt es nicht mehr")
		return
	}
	client := srv.podcastClient()
	gepostet, fehler := 0, 0
	for _, feed := range feeds {
		folgen, err := client.Folgen(ctx, feed)
		if err != nil {
			fehler++
			continue
		}
		bekannt := srv.store.SchonGemeldet(fmt.Sprintf("podfeed:%d:%s", q.ID, feed), jetzt.AddDate(-1, 0, 0))
		_ = srv.store.Gemeldet(fmt.Sprintf("podfeed:%d:%s", q.ID, feed), jetzt)
		for _, f := range folgen {
			schluessel := fmt.Sprintf("pod:%d:%s:%s", q.ID, feed, f.ID)
			if srv.store.SchonGemeldet(schluessel, jetzt.AddDate(0, 0, -29)) {
				continue
			}
			_ = srv.store.Gemeldet(schluessel, jetzt)
			if !bekannt || (!f.Zeit.IsZero() && jetzt.Sub(f.Zeit) > podcastAlter) || gepostet >= podcastJeLauf {
				continue
			}
			if _, err := discord.SendeMitWiederholung(ctx, srv.http, c.WebhookURL, discord.Nachricht{
				Inhalt: srv.folgeText(q, f, c.ID), Mention: discord.MentionTyp(c.MentionTyp), RollenID: c.RollenID,
			}); err != nil {
				if errors.Is(err, discord.ErrWebhookTot) {
					_ = srv.store.ChannelDefekt(c.ID, true)
				}
				srv.adminMelden(ctx, "discord", "⚠️ Podcasts „"+q.Name+"“: nicht gepostet: "+sicherFehlertext(err.Error()))
				break
			}
			gepostet++
		}
	}
	status := fmt.Sprintf("%d Podcasts gelesen", len(feeds)-fehler)
	if gepostet > 0 {
		status += fmt.Sprintf(", %d neue Folgen gepostet", gepostet)
	}
	if fehler > 0 {
		status += fmt.Sprintf(", %d Feeds nicht lesbar", fehler)
	}
	_ = srv.store.PodcastGeprueft(q.ID, jetzt, status)
}

func (srv *Server) folgeText(q store.PodcastQuelle, f podcast.Folge, channelID int64) string {
	z := []string{strings.TrimSpace("🎙️ Neue Folge: " + f.Podcast + " " + mentionText(channelID, srv)), "**" + f.Titel + "**"}
	var info []string
	if f.Dauer != "" {
		info = append(info, "⏱️ "+f.Dauer)
	}
	if q.Genre != 0 {
		info = append(info, "📂 "+podcast.KategorieName(q.Genre))
	}
	if len(info) > 0 {
		z = append(z, strings.Join(info, " · "))
	}
	if f.Link != "" {
		z = append(z, "🔗 "+f.Link)
	}
	return strings.Join(z, "\n")
}

// ---------------------------------------------------------------- Seite

type podcastAnzeige struct {
	store.PodcastQuelle
	ChannelName string
	Quelle      string
}

func (srv *Server) podcastAnzeigen(kanalName map[int64]string) []podcastAnzeige {
	qs, _ := srv.store.Podcasts()
	var out []podcastAnzeige
	for _, q := range qs {
		a := podcastAnzeige{PodcastQuelle: q, ChannelName: kanalName[q.ChannelID], Quelle: q.Feed}
		if q.Genre != 0 {
			a.Quelle = "Top " + strconv.Itoa(q.Anzahl) + " " + podcast.KategorieName(q.Genre)
		}
		out = append(out, a)
	}
	return out
}

func (srv *Server) speicherePodcast(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	channelID, _ := strconv.ParseInt(r.PostForm.Get("channel_id"), 10, 64)
	if _, err := srv.store.Channel(channelID); err != nil {
		srv.monitorMeldung(w, "", "Bitte einen Channel wählen.")
		return
	}
	q := store.PodcastQuelle{ChannelID: channelID, Name: r.PostForm.Get("name")}
	if quelle := strings.TrimSpace(r.PostForm.Get("podcast")); quelle != "" {
		if id, ok := podcast.AppleID(quelle); ok {
			feed, name, err := srv.podcastClient().FeedAdresse(r.Context(), id)
			if err != nil {
				srv.monitorMeldung(w, "", sicherFehlertext(err.Error()))
				return
			}
			q.Feed = feed
			if q.Name == "" {
				q.Name = name
			}
		} else if u, err := url.Parse(quelle); err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" {
			q.Feed = quelle
		} else {
			srv.monitorMeldung(w, "", "Bitte einen Link von Apple Podcasts (…/id123…) oder die Adresse des RSS-Feeds angeben.")
			return
		}
		if q.Name == "" {
			q.Name = q.Feed
		}
	} else {
		q.Genre, _ = strconv.Atoi(r.PostForm.Get("genre"))
		q.Anzahl, _ = strconv.Atoi(r.PostForm.Get("anzahl"))
		if q.Genre == 0 {
			srv.monitorMeldung(w, "", "Bitte eine Kategorie wählen oder einen Podcast angeben.")
			return
		}
		if q.Anzahl < 1 || q.Anzahl > 25 {
			q.Anzahl = 10
		}
		if q.Name == "" {
			q.Name = podcast.KategorieName(q.Genre)
		}
	}
	if err := srv.store.PodcastAnlegen(q); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Podcasts „"+q.Name+"“ angelegt. Beim ersten Abruf merkt er sich die vorhandenen Folgen, danach kommt jede neue.", "")
}

func (srv *Server) schaltePodcast(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	_ = srv.store.PodcastAktiv(idAusPfad(r), r.PostForm.Get("aktiv") == "1")
	srv.monitorMeldung(w, "Gespeichert.", "")
}

func (srv *Server) loeschePodcast(w http.ResponseWriter, r *http.Request) {
	_ = srv.store.PodcastLoeschen(idAusPfad(r))
	srv.monitorMeldung(w, "Gelöscht.", "")
}
