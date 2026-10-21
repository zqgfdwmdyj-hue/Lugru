package keepa

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

var ErrKeinPNG = errors.New("keepa: Antwort ist kein PNG")

// ChartOptionen steuern das Preisverlaufsbild.
type ChartOptionen struct {
	Tage      int
	Breite    int
	Hoehe     int
	SalesRank bool
	BuyBox    bool
	Amazon    bool
	Neu       bool
	FBA       bool
}

// StandardChart zeigt 90 Tage mit Buy-Box-Kurve — also der Reihe, aus der der
// VK-Vorschlag stammt. Ohne sie ließe sich der genannte VK nicht am Bild
// ablesen.
var StandardChart = ChartOptionen{
	Tage: 90, Breite: 800, Hoehe: 350,
	SalesRank: true, BuyBox: true, Amazon: true, Neu: true, FBA: true,
}

// ChartURL baut die Adresse des Preisverlaufsbildes.
//
// Dieser Endpunkt braucht weder Key noch Token. Er ist allerdings nicht
// dokumentiert — falls Keepa ihn schließt, ist der Umstieg auf das
// token-pflichtige api.keepa.com/graphimage der Ersatzweg.
func (c *Client) ChartURL(asin, chartDomain string, o ChartOptionen) string {
	q := url.Values{
		"asin":   {asin},
		"domain": {chartDomain},
		"range":  {strconv.Itoa(o.Tage)},
		"width":  {strconv.Itoa(o.Breite)},
		"height": {strconv.Itoa(o.Hoehe)},
	}
	if o.SalesRank {
		q.Set("salesrank", "1")
	}
	if o.BuyBox {
		q.Set("bb", "1")
	}
	if o.Amazon {
		q.Set("amazon", "1")
	}
	if o.Neu {
		q.Set("new", "1")
	}
	if o.FBA {
		q.Set("fba", "1")
	}
	return c.ChartBasisURL + "/pricehistory.png?" + q.Encode()
}

// GraphImageURL baut die offizielle Keepa-Graphimage-Adresse.
// Anders als graph.keepa.com verwendet dieser Endpunkt die numerische KeepaDomain
// und kann auch den Verkaufsrang im Chart darstellen.
func (c *Client) GraphImageURL(asin string, keepaDomain int, o ChartOptionen) string {
	q := url.Values{
		"key":    {c.Key},
		"asin":   {asin},
		"domain": {strconv.Itoa(keepaDomain)},
		"range":  {strconv.Itoa(o.Tage)},
		"width":  {strconv.Itoa(o.Breite)},
		"height": {strconv.Itoa(o.Hoehe)},
	}
	if o.SalesRank {
		q.Set("salesrank", "1")
	}
	if o.BuyBox {
		q.Set("bb", "1")
	}
	if o.Amazon {
		q.Set("amazon", "1")
	}
	if o.Neu {
		q.Set("new", "1")
	}
	if o.FBA {
		q.Set("fba", "1")
	}
	return c.BasisURL + "/graphimage?" + q.Encode()
}

// Chart holt das Bild als Bytes, damit es als Datei-Anhang mitgesendet und
// lokal archiviert werden kann. Verlinken käme nicht in Frage: alte Posts
// würden leer, sobald Keepa die Adresse ändert.
func (c *Client) Chart(ctx context.Context, asin string, keepaDomain int, o ChartOptionen) ([]byte, error) {
	return c.holeBild(ctx, c.GraphImageURL(asin, keepaDomain, o))
}

func (c *Client) holeBild(ctx context.Context, adresse string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, adresse, nil)
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: Anfrage nicht baubar: %w", ohneKey(err))
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: nicht erreichbar: %w", ohneKey(err))
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("keepa-chart: HTTP %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "image/png") {
		return nil, fmt.Errorf("%w (Content-Type %q)", ErrKeinPNG, ct)
	}

	daten, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: Bild nicht lesbar: %w", err)
	}
	if !bytes.HasPrefix(daten, []byte("\x89PNG\r\n\x1a\n")) {
		return nil, ErrKeinPNG
	}
	return daten, nil
}

// verkaufsGelb ist die Farbe, in der die Linie "Monatlich verkauft"
// angefordert wird — Keepas eigene Vorgabe. An ihr erkennt VerkaufsChart,
// dass wirklich ein Graph kam.
const verkaufsGelb = "f6d500"

// ErrKeineVerkaufsdaten: Keepa lieferte keinen Graphen mit der Linie
// "Monatlich verkauft" — weil es für den Artikel keine gibt, oder weil
// Keepa die Anfrage abgelehnt hat (das kommt als Bild mit "Invalid
// request", nicht als HTTP-Fehler).
var ErrKeineVerkaufsdaten = errors.New("keepa-chart: keine Verkaufsdaten im Bild")

// VerkaufsChartURL ist der Graph "Monatlich verkauft" für sich. In Keepas
// graphimage gehört die Linie zum Rang-Graphen und lässt sich nicht mit den
// Preis-Kurven in einer Anfrage verbinden — sie kommt darum als eigenes
// Bild unter den Preisverlauf.
func (c *Client) VerkaufsChartURL(asin string, keepaDomain, tage, breite, hoehe int) string {
	q := url.Values{
		"key":          {c.Key},
		"asin":         {asin},
		"domain":       {strconv.Itoa(keepaDomain)},
		"range":        {strconv.Itoa(tage)},
		"width":        {strconv.Itoa(breite)},
		"height":       {strconv.Itoa(hoehe)},
		"monthlysold":  {"1"},
		"cMonthlysold": {verkaufsGelb},
		"title":        {"0"},
	}
	return c.BasisURL + "/graphimage?" + q.Encode()
}

// VerkaufsChart holt den Graphen "Monatlich verkauft". Ohne die gelbe Linie
// im Bild gilt er als nicht geliefert (ErrKeineVerkaufsdaten).
func (c *Client) VerkaufsChart(ctx context.Context, asin string, keepaDomain, tage, breite, hoehe int) ([]byte, error) {
	roh, err := c.holeBild(ctx, c.VerkaufsChartURL(asin, keepaDomain, tage, breite, hoehe))
	if err != nil {
		return nil, err
	}
	if !hatGelb(roh) {
		return nil, ErrKeineVerkaufsdaten
	}
	return roh, nil
}

// hatGelb sagt, ob genug Pixel in der Farbe der Verkaufslinie vorkommen —
// ein paar Dutzend, damit ein gelber Fleck im Fehlerbild nicht reicht.
func hatGelb(roh []byte) bool {
	b, err := png.Decode(bytes.NewReader(roh))
	if err != nil {
		return false
	}
	n := 0
	r := b.Bounds()
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			rr, gg, bb, _ := b.At(x, y).RGBA()
			// f6d500 mit etwas Spielraum für Kantenglättung.
			if rr>>8 > 0xd8 && gg>>8 > 0xb8 && gg>>8 < 0xe8 && bb>>8 < 0x50 {
				n++
				if n >= 40 {
					return true
				}
			}
		}
	}
	return false
}
