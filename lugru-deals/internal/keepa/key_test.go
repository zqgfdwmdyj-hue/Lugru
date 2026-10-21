package keepa

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestKeyNieInFehlermeldung deckt für den Keepa-API-Key dieselbe Leck-Klasse
// ab, die internal/discord bereits für die Webhook-URL absichert (siehe dort
// ohneWebhookURL in webhook.go): Produkt schickt den Key als Query-Parameter
// "key=..." mit, und sowohl http.NewRequestWithContext als auch
// http.Client.Do melden einen Fehler als *url.Error, dessen Error()-Text die
// komplette Anfrage-URL im Klartext zitiert. Jeder Testfall baut einen
// Client mit einem gut wiedererkennbaren Key, ruft Produkt oder Chart auf
// und prüft, dass dieser Key in der zurückgegebenen Fehlermeldung nirgends
// auftaucht — unabhängig davon, an welcher Stelle die Anfrage scheitert.
func TestKeyNieInFehlermeldung(t *testing.T) {
	const key = "GEHEIMER_KEEPA_KEY_123"

	faelle := []struct {
		name string
		lauf func(c *Client) error
	}{
		{
			// Genau der Fall aus dem Bugreport: ein nicht erreichbarer Host
			// lässt hc.Do einen *url.Error mit der vollen Anfrage-URL
			// (samt key=...) melden. ".invalid" ist laut RFC 2606 als
			// TLD reserviert, die nirgends aufgelöst werden kann — der
			// Test verlässt damit nie die eigene Maschine, ganz gleich ob
			// die Auflösung lokal oder erst beim Resolver scheitert.
			name: "unerreichbarer Host (DNS-Fehler)",
			lauf: func(c *Client) error {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				c.BasisURL = "http://keepa-testhost.invalid"
				_, _, err := c.Produkt(ctx, "B01636IZ0G", 3)
				return err
			},
		},
		{
			// Ein Steuerzeichen macht die zusammengesetzte URL für
			// url.Parse unlesbar, bevor überhaupt eine Verbindung
			// aufgebaut wird — http.NewRequestWithContext scheitert direkt
			// mit einem *url.Error, dessen .URL-Feld ebenfalls die volle,
			// noch ungeparste Anfrage-URL samt Key enthält.
			name: "Anfrage nicht baubar (Steuerzeichen in der URL)",
			lauf: func(c *Client) error {
				c.BasisURL = "http://x\x7f"
				_, _, err := c.Produkt(context.Background(), "B01636IZ0G", 3)
				return err
			},
		},
		{
			name: "429 mit unlesbarem Koerper",
			lauf: func(c *Client) error {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusTooManyRequests)
					w.Write([]byte(`<html><body>502 Bad Gateway</body></html>`))
				}))
				defer srv.Close()
				c.BasisURL = srv.URL
				_, _, err := c.Produkt(context.Background(), "B01636IZ0G", 3)
				return err
			},
		},
		{
			name: "404 / leere Produktliste",
			lauf: func(c *Client) error {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Write([]byte(`{"tokensLeft":10,"tokensConsumed":1,"products":[]}`))
				}))
				defer srv.Close()
				c.BasisURL = srv.URL
				_, _, err := c.Produkt(context.Background(), "B0XXXXXXXX", 3)
				return err
			},
		},
		{
			name: "500",
			lauf: func(c *Client) error {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusInternalServerError)
				}))
				defer srv.Close()
				c.BasisURL = srv.URL
				_, _, err := c.Produkt(context.Background(), "B01636IZ0G", 3)
				return err
			},
		},
		{
			// Der Chart-Endpunkt kennt heute keinen Key (siehe chart.go),
			// trägt aber ASIN und Marktplatz in der URL. Dieser Fall
			// sichert ab, dass Chart denselben Schutz anwendet wie Produkt
			// — nicht weil hier heute etwas Geheimes stünde, sondern damit
			// eine künftige, token-pflichtige Chart-Variante nicht
			// unbemerkt zur Regression wird.
			name: "Chart-Antwort ist kein PNG",
			lauf: func(c *Client) error {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "text/html")
					w.Write([]byte("<html>Wartungsarbeiten</html>"))
				}))
				defer srv.Close()
				c.BasisURL = srv.URL
				_, err := c.Chart(context.Background(), "B01636IZ0G", 3, StandardChart)
				return err
			},
		},
	}

	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			c := NeuerClient(key)
			err := f.lauf(c)
			if err == nil {
				t.Fatal("Fehler erwartet, kam keiner")
			}
			if strings.Contains(err.Error(), key) {
				t.Errorf("Fehlermeldung verrät den Key im Klartext: %v", err)
			}
		})
	}
}
