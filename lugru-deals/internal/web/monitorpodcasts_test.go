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

func TestPodcastKategorie(t *testing.T) {
	a := neuerMonitorAufbau(t, "")
	var mu sync.Mutex
	folgen := `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Alles auf Aktien</title>
<item><title>Alte Folge</title><guid>a1</guid><link>https://example.de/a1</link><pubDate>Mon, 19 Oct 2026 05:00:00 +0000</pubDate></item>
</channel></rss>`
	as := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case strings.Contains(r.URL.Path, "/toppodcasts/"):
			if !strings.Contains(r.URL.Path, "genre=1321") || !strings.Contains(r.URL.Path, "limit=5") {
				t.Errorf("Charts-Pfad %s", r.URL.Path)
			}
			_, _ = w.Write([]byte(`{"feed":{"entry":[{"im:name":{"label":"Alles auf Aktien"},"id":{"label":"https://x","attributes":{"im:id":"111111"}}}]}}`))
		case r.URL.Path == "/lookup":
			_, _ = w.Write([]byte(`{"results":[{"feedUrl":"` + "http://" + r.Host + `/feed.xml","collectionName":"Alles auf Aktien"}]}`))
		case r.URL.Path == "/feed.xml":
			_, _ = w.Write([]byte(folgen))
		}
	}))
	defer as.Close()
	a.srv.appleBasisURL = as.URL
	a.srv.monitorHTTP = as.Client()

	w := hole(t, a.srv, http.MethodPost, "/monitor/podcasts", url.Values{"genre": {"1321"}, "anzahl": {"5"}, "channel_id": {itoa(a.normal)}}.Encode())
	if !strings.Contains(w.Body.String(), "Wirtschaft") {
		t.Fatalf("Anlegen: %s", w.Body.String())
	}
	jetzt := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	a.srv.podcastsPruefen(context.Background(), jetzt)
	if n := len(a.posts("/normal")); n != 0 {
		t.Fatalf("%d Posts beim ersten Abruf", n)
	}
	mu.Lock()
	folgen = strings.Replace(folgen, "<item>", `<item><title>Nvidia vor den Zahlen</title><guid>a2</guid><link>https://example.de/a2</link>
<pubDate>Wed, 21 Oct 2026 05:00:00 +0000</pubDate><itunes:duration>00:21:40</itunes:duration></item><item>`, 1)
	mu.Unlock()
	a.srv.podcastsPruefen(context.Background(), jetzt.Add(31*time.Minute))
	posts := a.posts("/normal")
	if len(posts) != 1 {
		t.Fatalf("%d Posts, will 1", len(posts))
	}
	for _, soll := range []string{"🎙️ Neue Folge: Alles auf Aktien", "**Nvidia vor den Zahlen**", "22 Min.", "📂 Wirtschaft", "https://example.de/a2"} {
		if !strings.Contains(posts[0], soll) {
			t.Errorf("Post ohne %q: %s", soll, posts[0])
		}
	}
	qs, _ := a.s.Podcasts()
	if len(qs) != 1 || !strings.Contains(qs[0].Status, "1 neue Folgen") {
		t.Errorf("Status = %+v", qs)
	}
	_ = store.PodcastQuelle{}
}
