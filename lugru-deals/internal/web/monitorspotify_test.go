package web

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestSpotifyBeiPodcasts(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	var mu sync.Mutex
	rss := `<rss><channel><title>Mordlust</title>
<item><title>Alt</title><guid>r1</guid><link>https://example.de/r1</link><pubDate>Mon, 19 Oct 2026 05:00:00 +0000</pubDate></item></channel></rss>`
	spotifyFolgen := `{"items":[{"id":"s1","name":"Alt exklusiv","release_date":"2026-10-19","duration_ms":600000}]}`
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/feed.xml":
			_, _ = w.Write([]byte(rss))
		case "/api/token":
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":3600}`))
		case "/v1/search":
			_, _ = w.Write([]byte(`{"shows":{"items":[{"id":"MORDLUSTxxxxxxxxxxxxxx","name":"Mordlust"}]}}`))
		case "/v1/shows/MORDLUSTxxxxxxxxxxxxxx/episodes":
			_, _ = w.Write([]byte(`{"items":[{"id":"m2","name":"Neue Folge","release_date":"2026-10-21","duration_ms":3600000,"external_urls":{"spotify":"https://open.spotify.com/episode/m2"}}]}`))
		case "/v1/shows/EXKLUSIVxxxxxxxxxxxxxx":
			_, _ = w.Write([]byte(`{"name":"Exklusiv-Podcast"}`))
		case "/v1/shows/EXKLUSIVxxxxxxxxxxxxxx/episodes":
			_, _ = w.Write([]byte(spotifyFolgen))
		}
	}))
	defer ts.Close()
	a.srv.monitorHTTP = ts.Client()
	a.srv.http = ts.Client()
	a.srv.spotifyBasisURL = ts.URL
	_ = a.s.SetzeEinstellung(store.SchluesselSpotifyID, "id")
	_ = a.s.SetzeEinstellung(store.SchluesselSpotifySecret, "geheim")

	// Discord läuft im Test über denselben Client; die Webhooks zeigen auf
	// den Aufbau-Server, der unabhängig davon antwortet.
	hole(t, a.srv, http.MethodPost, "/monitor/podcasts", url.Values{"podcast": {ts.URL + "/feed.xml"}, "name": {"Mordlust"}, "channel_id": {itoa(a.normal)}}.Encode())
	w := hole(t, a.srv, http.MethodPost, "/monitor/podcasts", url.Values{"podcast": {"https://open.spotify.com/show/EXKLUSIVxxxxxxxxxxxxxx?si=1"}, "channel_id": {itoa(a.hoch)}}.Encode())
	if !strings.Contains(w.Body.String(), "Exklusiv-Podcast") {
		t.Fatalf("Spotify-Podcast nicht angelegt: %s", w.Body.String())
	}

	jetzt := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	a.srv.podcastsPruefen(context.Background(), jetzt)
	mu.Lock()
	rss = strings.Replace(rss, "<item>", `<item><title>Neue Folge</title><guid>r2</guid><link>https://example.de/r2</link><pubDate>Wed, 21 Oct 2026 05:00:00 +0000</pubDate></item><item>`, 1)
	spotifyFolgen = `{"items":[{"id":"s2","name":"Exklusiv Neu","release_date":"2026-10-21","duration_ms":1500000,"external_urls":{"spotify":"https://open.spotify.com/episode/s2"}},
		{"id":"s1","name":"Alt exklusiv","release_date":"2026-10-19","duration_ms":600000}]}`
	mu.Unlock()
	a.srv.podcastsPruefen(context.Background(), jetzt.Add(31*time.Minute))

	normal := a.posts("/normal")
	if len(normal) != 1 || !strings.Contains(normal[0], "🎧 [Auf Spotify hören](https://open.spotify.com/episode/m2)") || !strings.Contains(normal[0], "https://example.de/r2") {
		t.Fatalf("RSS-Post = %v", normal)
	}
	exklusiv := a.posts("/hoch")
	if len(exklusiv) != 1 || !strings.Contains(exklusiv[0], "Neue Folge: Exklusiv-Podcast") || !strings.Contains(exklusiv[0], "**Exklusiv Neu**") ||
		!strings.Contains(exklusiv[0], "25 Min.") || !strings.Contains(exklusiv[0], "open.spotify.com/episode/s2") {
		t.Fatalf("Spotify-Post = %v", exklusiv)
	}
}
