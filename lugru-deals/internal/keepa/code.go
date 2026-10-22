package keepa

import (
	"context"
	"net/url"
	"strconv"
	"strings"
)

// ProduktZuCode sucht einen Artikel über seine EAN (oder UPC/ISBN) statt über
// die ASIN. Der Monitor kennt aus billiger.de nur die EAN; die ASIN dazu
// liefert Keepa mit derselben Produktanfrage, nur mit dem Parameter code.
//
// Führt Amazon mehrere ASINs zu einer EAN, gilt die erste — Keepa ordnet die
// Treffer selbst. Wer eine andere will, trägt die ASIN im Monitor von Hand ein.
func (c *Client) ProduktZuCode(ctx context.Context, code string, domain int) (Antwort, []byte, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return Antwort{}, nil, ErrNichtGefunden
	}
	koerper, err := c.abfrage(ctx, url.Values{
		"domain":  {strconv.Itoa(domain)},
		"code":    {code},
		"stats":   {"90"},
		"history": {"1"},
	})
	if err != nil {
		return Antwort{}, nil, err
	}
	antwort, err := ParseAntwort(koerper)
	if err != nil {
		return Antwort{}, nil, err
	}
	return antwort, koerper, nil
}
