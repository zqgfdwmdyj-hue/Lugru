package spotify

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSpotify(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/token":
			id, geheim, _ := r.BasicAuth()
			if id != "id" || geheim != "geheim" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":3600}`))
		case "/v1/search":
			_, _ = w.Write([]byte(`{"shows":{"items":[{"id":"falsch","name":"Mordlust Fanpodcast"},{"id":"AAAAAAAAAAAAAAAAAAAAAA","name":"Mordlust"}]}}`))
		case "/v1/shows/AAAAAAAAAAAAAAAAAAAAAA/episodes":
			if r.Header.Get("Authorization") != "Bearer tok" || r.URL.Query().Get("market") != "DE" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"items":[{"id":"e1","name":"#256 Gefahr im Verzug","release_date":"2026-10-21","duration_ms":4140000,
				"external_urls":{"spotify":"https://open.spotify.com/episode/e1"}}]}`))
		case "/v1/shows/AAAAAAAAAAAAAAAAAAAAAA":
			_, _ = w.Write([]byte(`{"name":"Mordlust"}`))
		}
	}))
	defer ts.Close()
	c := NeuerClient("id", "geheim", ts.Client())
	c.APIURL, c.AccountsURL = ts.URL, ts.URL

	id, err := c.SucheShow(context.Background(), "MORDLUST")
	if err != nil || id != "AAAAAAAAAAAAAAAAAAAAAA" {
		t.Fatalf("Show = %q, %v", id, err)
	}
	link, err := c.FolgeFinden(context.Background(), id, "#256 Gefahr im Verzug")
	if err != nil || link != "https://open.spotify.com/episode/e1" {
		t.Errorf("Folge = %q, %v", link, err)
	}
	fs, _ := c.Folgen(context.Background(), id, 10)
	if len(fs) != 1 || fs[0].Datum.IsZero() || fs[0].Dauer.Minutes() != 69 {
		t.Errorf("Folgen = %+v", fs)
	}
	if n, _ := c.ShowName(context.Background(), id); n != "Mordlust" {
		t.Errorf("Name = %q", n)
	}
	if _, err := NeuerClient("", "", ts.Client()).Folgen(context.Background(), id, 1); err != ErrKeinZugang {
		t.Errorf("ohne Zugang: %v", err)
	}
}

func TestShowID(t *testing.T) {
	for roh, will := range map[string]string{
		"https://open.spotify.com/show/6ffQTE1hp2dpmzW8w0iYxu?si=abc":  "6ffQTE1hp2dpmzW8w0iYxu",
		"https://open.spotify.com/intl-de/show/6ffQTE1hp2dpmzW8w0iYxu": "6ffQTE1hp2dpmzW8w0iYxu",
		"spotify:show:6ffQTE1hp2dpmzW8w0iYxu":                          "6ffQTE1hp2dpmzW8w0iYxu",
	} {
		if got, ok := ShowID(roh); !ok || got != will {
			t.Errorf("%q → %q", roh, got)
		}
	}
	if _, ok := ShowID("https://podcasts.apple.com/de/podcast/x/id123456"); ok {
		t.Error("Apple-Link als Spotify erkannt")
	}
}
