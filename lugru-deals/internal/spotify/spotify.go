// Package spotify fragt die Web-API von Spotify nach Podcasts und Folgen —
// für Spotify-Links in den Podcast-Posts und für Podcasts, die es nur bei
// Spotify gibt.
//
// Zugang: Client ID und Client Secret einer kostenlosen App aus
// developer.spotify.com, Anmeldung per Client-Credentials. Das Token gilt
// eine Stunde und wird zwischengespeichert.
package spotify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

type Client struct {
	ID, Secret string
	HTTP       *http.Client
	// In Tests überschrieben.
	APIURL, AccountsURL string

	mu     sync.Mutex
	token  string
	ablauf time.Time
}

func NeuerClient(id, secret string, hc *http.Client) *Client {
	return &Client{ID: strings.TrimSpace(id), Secret: strings.TrimSpace(secret), HTTP: hc,
		APIURL: "https://api.spotify.com", AccountsURL: "https://accounts.spotify.com"}
}

var ErrKeinZugang = errors.New("Spotify: kein Zugang hinterlegt (Client ID und Client Secret unter Monitor → Einstellungen)")

// Bereit sagt, ob Zugangsdaten hinterlegt sind.
func (c *Client) Bereit() bool { return c.ID != "" && c.Secret != "" }

// Folge ist eine Folge bei Spotify.
type Folge struct {
	ID    string
	Titel string
	Datum time.Time
	Dauer time.Duration
	Link  string
}

func (c *Client) holeToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.ablauf) {
		return c.token, nil
	}
	if !c.Bereit() {
		return "", ErrKeinZugang
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.AccountsURL+"/api/token",
		strings.NewReader(url.Values{"grant_type": {"client_credentials"}}.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(c.ID, c.Secret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("Spotify nicht erreichbar: %w", ohneURL(err))
	}
	defer resp.Body.Close()
	roh, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Spotify lehnt die Anmeldung ab (HTTP %d) — Client ID und Secret prüfen", resp.StatusCode)
	}
	var t struct {
		Token    string `json:"access_token"`
		Sekunden int    `json:"expires_in"`
	}
	if json.Unmarshal(roh, &t) != nil || t.Token == "" {
		return "", errors.New("Spotify: Anmeldung ohne Token")
	}
	c.token, c.ablauf = t.Token, time.Now().Add(time.Duration(t.Sekunden)*time.Second-2*time.Minute)
	return c.token, nil
}

func (c *Client) hole(ctx context.Context, pfad string, q url.Values, ziel any) error {
	token, err := c.holeToken(ctx)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.APIURL+pfad+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("Spotify nicht erreichbar: %w", ohneURL(err))
	}
	defer resp.Body.Close()
	roh, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == http.StatusUnauthorized {
		c.mu.Lock()
		c.token = ""
		c.mu.Unlock()
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Spotify: HTTP %d", resp.StatusCode)
	}
	return json.Unmarshal(roh, ziel)
}

var showMuster = regexp.MustCompile(`(?:open\.spotify\.com/(?:intl-[a-z]+/)?show/|spotify:show:)([A-Za-z0-9]{22})`)

// ShowID liest die ID aus einem Link wie open.spotify.com/show/…
func ShowID(roh string) (string, bool) {
	m := showMuster.FindStringSubmatch(strings.TrimSpace(roh))
	if m == nil {
		return "", false
	}
	return m[1], true
}

// ShowName liefert den Namen eines Podcasts.
func (c *Client) ShowName(ctx context.Context, id string) (string, error) {
	var r struct {
		Name string `json:"name"`
	}
	if err := c.hole(ctx, "/v1/shows/"+url.PathEscape(id), url.Values{"market": {"DE"}}, &r); err != nil {
		return "", err
	}
	return r.Name, nil
}

// Folgen liefert die neuesten Folgen eines Podcasts.
func (c *Client) Folgen(ctx context.Context, id string, n int) ([]Folge, error) {
	var r struct {
		Items []struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Datum   string `json:"release_date"`
			Dauer   int64  `json:"duration_ms"`
			Externe struct {
				Spotify string `json:"spotify"`
			} `json:"external_urls"`
		} `json:"items"`
	}
	if err := c.hole(ctx, "/v1/shows/"+url.PathEscape(id)+"/episodes", url.Values{"market": {"DE"}, "limit": {fmt.Sprint(n)}}, &r); err != nil {
		return nil, err
	}
	var out []Folge
	for _, it := range r.Items {
		if it.ID == "" {
			continue
		}
		f := Folge{ID: it.ID, Titel: it.Name, Dauer: time.Duration(it.Dauer) * time.Millisecond, Link: it.Externe.Spotify}
		f.Datum, _ = time.Parse("2006-01-02", it.Datum)
		if f.Link == "" {
			f.Link = "https://open.spotify.com/episode/" + it.ID
		}
		out = append(out, f)
	}
	return out, nil
}

// SucheShow findet einen Podcast über seinen Namen; nur ein Treffer mit
// (bis auf Groß- und Satzzeichen) gleichem Namen zählt — ein falscher Link
// wäre schlimmer als keiner.
func (c *Client) SucheShow(ctx context.Context, name string) (string, error) {
	var r struct {
		Shows struct {
			Items []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"items"`
		} `json:"shows"`
	}
	if err := c.hole(ctx, "/v1/search", url.Values{"q": {name}, "type": {"show"}, "market": {"DE"}, "limit": {"5"}}, &r); err != nil {
		return "", err
	}
	for _, it := range r.Shows.Items {
		if Gleich(it.Name, name) {
			return it.ID, nil
		}
	}
	return "", nil
}

// FolgeFinden sucht unter den neuesten Folgen eines Podcasts die mit dem
// gleichen Titel.
func (c *Client) FolgeFinden(ctx context.Context, showID, titel string) (string, error) {
	fs, err := c.Folgen(ctx, showID, 20)
	if err != nil {
		return "", err
	}
	for _, f := range fs {
		if Gleich(f.Titel, titel) {
			return f.Link, nil
		}
	}
	return "", nil
}

// Gleich vergleicht Namen ohne Groß- und Kleinschreibung, Satzzeichen und
// Leerraum.
func Gleich(a, b string) bool {
	norm := func(s string) string {
		var sb strings.Builder
		for _, r := range strings.ToLower(s) {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				sb.WriteRune(r)
			}
		}
		return sb.String()
	}
	na := norm(a)
	return na != "" && na == norm(b)
}

func ohneURL(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) && uerr.Err != nil {
		return uerr.Err
	}
	return err
}
