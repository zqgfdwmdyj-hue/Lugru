package billiger

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// KlickLink löst den Weiterleitungs-Schlüssel eines Angebots (Angebot.Klick)
// über billiger.de in einen Link zum Shop auf.
//
// Der Schlüssel ist verschlüsselt; billiger.de öffnet ihn selbst, wenn der
// Browser ihn per POST an /redirect schickt, und antwortet mit einer
// Weiterleitung über seinen Klick-Zähler zum Shop (OTTO, Kaufland …). Dieser
// Link trägt das Tagesdatum und läuft ab — darum wird er erst beim Klick
// geholt, nie im Post gespeichert.
func KlickLink(ctx context.Context, hc *http.Client, schluessel string) (string, error) {
	schluessel = strings.TrimSpace(schluessel)
	if schluessel == "" {
		return "", errors.New("kein Klick-Schlüssel")
	}
	form := url.Values{"target": {schluessel}, "searchStatisticsData": {""}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://www.billiger.de/redirect", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for k, v := range kopfzeilen {
		req.Header.Set(k, v)
	}
	// Die Weiterleitung nicht folgen — gebraucht wird nur ihr Ziel.
	c := *hc
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := c.Do(req)
	if err != nil {
		return "", fmt.Errorf("billiger.de nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther && resp.StatusCode != http.StatusFound && resp.StatusCode != http.StatusMovedPermanently {
		return "", fmt.Errorf("billiger.de: Weiterleitung abgelehnt (HTTP %d) — Angebot weg?", resp.StatusCode)
	}
	ziel, err := url.Parse(resp.Header.Get("Location"))
	if err != nil || ziel.Scheme != "https" || ziel.Host == "" {
		return "", fmt.Errorf("billiger.de: unerwartete Weiterleitung")
	}
	return ziel.String(), nil
}
