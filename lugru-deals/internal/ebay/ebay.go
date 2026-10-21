// Package ebay fragt die Browse-API von eBay nach den aktuellen Angeboten
// zu einer EAN — als Verkaufspreis für Deals, die auf eBay statt Amazon
// verkauft werden.
//
// Die Seite mit den verkauften Artikeln blockt eBay für Server; die
// offizielle Browse-API kennt nur laufende Angebote. Als Verkaufspreis gilt
// darum der Median der günstigsten neuen Sofort-Kaufen-Angebote in
// Deutschland: so viel zahlen Käufer gerade, ohne dass ein einzelner
// Ausreißer nach unten den Preis bestimmt.
//
// Zugang: ein Schlüsselpaar (App ID und Cert ID) aus dem eBay-Entwicklerkonto,
// Anmeldung per Client-Credentials. Das Token gilt zwei Stunden und wird
// zwischengespeichert.
package ebay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

type Client struct {
	AppID, CertID string
	HTTP          *http.Client
	BasisURL      string // in Tests überschrieben

	// Seller, wenn gesetzt, liefert das Token statt App ID und Cert ID:
	// das Lugru-Seller-System, das die eBay-Schlüssel verwahrt (siehe
	// SellerToken).
	Seller *Seller

	mu     sync.Mutex
	token  string
	ablauf time.Time
}

func NeuerClient(appID, certID string, hc *http.Client) *Client {
	return &Client{AppID: strings.TrimSpace(appID), CertID: strings.TrimSpace(certID), HTTP: hc, BasisURL: "https://api.ebay.com"}
}

// Angebot ist ein laufendes Angebot bei eBay.
type Angebot struct {
	Titel   string
	Preis   money.Cents
	Versand money.Cents
	Link    string
}

// Gesamt ist Preis plus Versand.
func (a Angebot) Gesamt() money.Cents { return a.Preis + a.Versand }

var ErrKeinZugang = errors.New("eBay: kein Zugang hinterlegt (Lugru-Seller-System oder App ID und Cert ID unter Monitor → Einstellungen)")

func (c *Client) holeToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.ablauf) {
		return c.token, nil
	}
	if c.Seller != nil {
		token, gueltig, env, err := c.Seller.token(ctx, c.HTTP)
		if err != nil {
			return "", err
		}
		// Ist das Seller-System auf die eBay-Sandbox eingestellt, gilt das
		// Token nur dort.
		if env == "sandbox" && c.BasisURL == "https://api.ebay.com" {
			c.BasisURL = "https://api.sandbox.ebay.com"
		}
		c.token, c.ablauf = token, time.Now().Add(gueltig-time.Minute)
		return c.token, nil
	}
	if c.AppID == "" || c.CertID == "" {
		return "", ErrKeinZugang
	}
	form := url.Values{"grant_type": {"client_credentials"}, "scope": {"https://api.ebay.com/oauth/api_scope"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BasisURL+"/identity/v1/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(c.AppID, c.CertID)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("eBay nicht erreichbar: %w", ohneURL(err))
	}
	defer resp.Body.Close()
	roh, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("eBay lehnt die Anmeldung ab (HTTP %d) — App ID und Cert ID prüfen", resp.StatusCode)
	}
	var t struct {
		Token    string `json:"access_token"`
		Sekunden int    `json:"expires_in"`
	}
	if err := json.Unmarshal(roh, &t); err != nil || t.Token == "" {
		return "", errors.New("eBay: Anmeldung ohne Token")
	}
	c.token = t.Token
	c.ablauf = time.Now().Add(time.Duration(t.Sekunden)*time.Second - 5*time.Minute)
	return c.token, nil
}

// Suche liefert die neuen Sofort-Kaufen-Angebote zu einer EAN in
// Deutschland, die günstigsten zuerst.
func (c *Client) Suche(ctx context.Context, ean string) ([]Angebot, error) {
	ean = strings.TrimSpace(ean)
	if ean == "" {
		return nil, errors.New("eBay: keine EAN bekannt")
	}
	token, err := c.holeToken(ctx)
	if err != nil {
		return nil, err
	}
	q := url.Values{
		"gtin":   {ean},
		"filter": {"buyingOptions:{FIXED_PRICE},conditionIds:{1000},itemLocationCountry:DE"},
		"sort":   {"price"},
		"limit":  {"20"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BasisURL+"/buy/browse/v1/item_summary/search?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-EBAY-C-MARKETPLACE-ID", "EBAY_DE")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("eBay nicht erreichbar: %w", ohneURL(err))
	}
	defer resp.Body.Close()
	roh, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == http.StatusUnauthorized {
		c.mu.Lock()
		c.token = ""
		c.mu.Unlock()
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("eBay: HTTP %d", resp.StatusCode)
	}
	return LiesSuche(roh)
}

// LiesSuche wertet die Antwort der Suche aus.
func LiesSuche(roh []byte) ([]Angebot, error) {
	var r struct {
		Items []struct {
			Titel string `json:"title"`
			Link  string `json:"itemWebUrl"`
			Preis struct {
				Wert     string `json:"value"`
				Waehrung string `json:"currency"`
			} `json:"price"`
			Versand []struct {
				Kosten struct {
					Wert string `json:"value"`
				} `json:"shippingCost"`
			} `json:"shippingOptions"`
		} `json:"itemSummaries"`
	}
	if err := json.Unmarshal(roh, &r); err != nil {
		return nil, fmt.Errorf("eBay: Antwort nicht lesbar: %w", err)
	}
	var out []Angebot
	for _, it := range r.Items {
		if it.Preis.Waehrung != "" && it.Preis.Waehrung != "EUR" {
			continue
		}
		p, err := money.Parse(it.Preis.Wert)
		if err != nil || p <= 0 {
			continue
		}
		a := Angebot{Titel: it.Titel, Preis: p, Link: it.Link}
		if len(it.Versand) > 0 {
			a.Versand, _ = money.Parse(it.Versand[0].Kosten.Wert)
		}
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Gesamt() < out[j].Gesamt() })
	return out, nil
}

// Marktpreis ist der Median der n günstigsten Angebote (mit Versand).
func Marktpreis(as []Angebot, n int) (money.Cents, int) {
	if len(as) == 0 {
		return 0, 0
	}
	if len(as) < n {
		n = len(as)
	}
	preise := make([]money.Cents, n)
	for i := range preise {
		preise[i] = as[i].Gesamt()
	}
	if n%2 == 1 {
		return preise[n/2], n
	}
	return (preise[n/2-1] + preise[n/2]) / 2, n
}

// Erloes ist, was nach eBay-Gebühren und eigenem Versand übrig bleibt.
func Erloes(vk money.Cents, gebuehrProzent float64, fix, versand money.Cents) money.Cents {
	return vk - money.Cents(float64(vk)*gebuehrProzent/100) - fix - versand
}

func ohneURL(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) && uerr.Err != nil {
		return uerr.Err
	}
	return err
}

// Seller ist das Lugru-Seller-System als Quelle des eBay-Tokens.
type Seller struct {
	// URL ist die Adresse des Seller-Systems, etwa https://seller.example.de.
	URL string
	// Schluessel ist der Verbindungsschlüssel aus Anbindungen → Lugru Deals.
	Schluessel string
}

func (s *Seller) token(ctx context.Context, hc *http.Client) (string, time.Duration, string, error) {
	ziel := strings.TrimRight(strings.TrimSpace(s.URL), "/") + "/api/public/lugru-deals/ebay-token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ziel, nil)
	if err != nil {
		return "", 0, "", errors.New("Seller-System: Adresse ungültig")
	}
	req.Header.Set("Authorization", "Bearer "+s.Schluessel)
	resp, err := hc.Do(req)
	if err != nil {
		return "", 0, "", fmt.Errorf("Seller-System nicht erreichbar: %w", ohneURL(err))
	}
	defer resp.Body.Close()
	roh, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var r struct {
		Token    string `json:"access_token"`
		Sekunden int    `json:"expires_in"`
		Env      string `json:"env"`
		Fehler   string `json:"error"`
	}
	_ = json.Unmarshal(roh, &r)
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return "", 0, "", errors.New("Seller-System: Verbindungsschlüssel falsch (Anbindungen → Lugru Deals)")
	case resp.StatusCode != http.StatusOK || r.Token == "":
		if r.Fehler != "" {
			return "", 0, "", errors.New("Seller-System: " + r.Fehler)
		}
		return "", 0, "", fmt.Errorf("Seller-System: HTTP %d — ist es auf dem neuesten Stand?", resp.StatusCode)
	}
	if r.Sekunden <= 120 {
		r.Sekunden = 1800
	}
	return r.Token, time.Duration(r.Sekunden) * time.Second, r.Env, nil
}
