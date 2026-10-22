package web

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/podcast"
	"github.com/trinkfreunde/lugru-deal-discord/internal/spotify"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Spotify bei den Podcasts: Spotify-Links in den Posts und Podcasts, die
// direkt von Spotify gelesen werden (auch Spotify-exklusive).

const spotifyPraefix = "spotify:show:"

type spotifyGemerkt struct {
	mu     sync.Mutex
	client *spotify.Client
	schl   string
	// shows merkt sich je Podcast-Name die Spotify-ID ("" = nicht gefunden),
	// damit nicht jede Folge eine Suche kostet.
	shows map[string]spotifyShow
}

type spotifyShow struct {
	id   string
	zeit time.Time
}

func (srv *Server) spotifyClient() *spotify.Client {
	id, geheim := srv.store.Einstellung(store.SchluesselSpotifyID), srv.store.Einstellung(store.SchluesselSpotifySecret)
	srv.spotifyCache.mu.Lock()
	defer srv.spotifyCache.mu.Unlock()
	if srv.spotifyCache.client == nil || srv.spotifyCache.schl != id+"|"+geheim {
		c := spotify.NeuerClient(id, geheim, srv.http)
		if srv.spotifyBasisURL != "" {
			c.APIURL, c.AccountsURL = srv.spotifyBasisURL, srv.spotifyBasisURL
		}
		srv.spotifyCache.client, srv.spotifyCache.schl = c, id+"|"+geheim
		srv.spotifyCache.shows = map[string]spotifyShow{}
	}
	return srv.spotifyCache.client
}

// spotifyLinkZu sucht die Folge eines (RSS-)Podcasts bei Spotify; leer, wenn
// kein Zugang hinterlegt ist oder sie dort nicht eindeutig zu finden ist.
func (srv *Server) spotifyLinkZu(ctx context.Context, f podcast.Folge) string {
	c := srv.spotifyClient()
	if !c.Bereit() || f.Podcast == "" {
		return ""
	}
	srv.spotifyCache.mu.Lock()
	show, ok := srv.spotifyCache.shows[f.Podcast]
	srv.spotifyCache.mu.Unlock()
	if !ok || time.Since(show.zeit) > 24*time.Hour {
		id, err := c.SucheShow(ctx, f.Podcast)
		if err != nil {
			return ""
		}
		show = spotifyShow{id: id, zeit: time.Now()}
		srv.spotifyCache.mu.Lock()
		srv.spotifyCache.shows[f.Podcast] = show
		srv.spotifyCache.mu.Unlock()
	}
	if show.id == "" {
		return ""
	}
	link, err := c.FolgeFinden(ctx, show.id, f.Titel)
	if err != nil {
		return ""
	}
	return link
}

// spotifyFolgen liest die Folgen eines Spotify-Podcasts als podcast.Folge.
func (srv *Server) spotifyFolgen(ctx context.Context, feed, name string) ([]podcast.Folge, error) {
	id := strings.TrimPrefix(feed, spotifyPraefix)
	fs, err := srv.spotifyClient().Folgen(ctx, id, 10)
	if err != nil {
		return nil, err
	}
	var out []podcast.Folge
	for _, f := range fs {
		dauer := ""
		if m := int(f.Dauer.Minutes() + 0.5); m >= 60 {
			dauer = fmt.Sprintf("%d Std. %d Min.", m/60, m%60)
		} else if m > 0 {
			dauer = fmt.Sprintf("%d Min.", m)
		}
		out = append(out, podcast.Folge{ID: f.ID, Titel: f.Titel, Link: f.Link, Zeit: f.Datum, Dauer: dauer, Podcast: name})
	}
	return out, nil
}
