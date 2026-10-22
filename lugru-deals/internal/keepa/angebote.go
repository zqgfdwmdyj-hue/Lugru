package keepa

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Angebot ist ein aktuelles Neu-Angebot eines Händlers auf einem Marktplatz.
//
// Ein eigenes Feld für das Kauflimit kennt die Keepa-API nicht. Keepa
// ermittelt den Bestand, indem es den Artikel in den Warenkorb legt — gilt
// ein Limit pro Kunde, landet genau dieses Limit als Bestand in stockCSV.
// Bestand ist darum "Bestand oder Kauflimit", und die Oberfläche sagt das
// auch so.
type Angebot struct {
	VerkaeuferID string
	Amazon       bool
	FBA          bool
	Prime        bool
	Gesamt       money.Cents // Preis plus Versand
	Bestand      int         // -1: unbekannt
	Mindestmenge int         // 0: keine
}

// Angebote holt die aktuellen Angebote samt Bestand.
//
// Das kostet deutlich mehr als eine gewöhnliche Abfrage: 6 Token je Seite
// mit bis zu zehn Angeboten (mindestens 5) und 2 Token für den Bestand. Der
// Aufruf erfolgt darum nur auf ausdrücklichen Wunsch und wird nicht im
// Keepa-Cache abgelegt, der für Produktabfragen ohne Angebote gedacht ist.
func (c *Client) Angebote(ctx context.Context, asin string, domain int) ([]Angebot, Antwort, error) {
	koerper, err := c.abfrage(ctx, url.Values{
		"domain":           {strconv.Itoa(domain)},
		"asin":             {asin},
		"offers":           {"20"},
		"stock":            {"1"},
		"only-live-offers": {"1"},
		"days":             {"7"},
	})
	if err != nil {
		return nil, Antwort{}, err
	}
	return ParseAngebote(koerper)
}

type rohAngebote struct {
	TokensLeft     int `json:"tokensLeft"`
	TokensConsumed int `json:"tokensConsumed"`
	Products       []struct {
		Offers []struct {
			SellerID    string `json:"sellerId"`
			Condition   int    `json:"condition"`
			IsAmazon    bool   `json:"isAmazon"`
			IsFBA       bool   `json:"isFBA"`
			IsPrime     bool   `json:"isPrime"`
			OfferCSV    []int  `json:"offerCSV"`
			StockCSV    []int  `json:"stockCSV"`
			MinOrderQty int    `json:"minOrderQty"`
		} `json:"offers"`
	} `json:"products"`
	Error *rohFehler `json:"error"`
}

// ParseAngebote liest die Neu-Angebote aus einer Antwort mit offers und
// stock, das günstigste zuerst.
func ParseAngebote(roh []byte) ([]Angebot, Antwort, error) {
	var r rohAngebote
	if err := json.Unmarshal(roh, &r); err != nil {
		return nil, Antwort{}, fmt.Errorf("keepa: Antwort nicht lesbar: %w", err)
	}
	if r.Error != nil && r.Error.Type != "" {
		return nil, Antwort{}, fmt.Errorf("keepa: %s: %s", r.Error.Type, r.Error.Message)
	}
	if len(r.Products) == 0 {
		return nil, Antwort{}, ErrNichtGefunden
	}
	a := Antwort{TokensLeft: r.TokensLeft, TokensConsumed: r.TokensConsumed}

	var liste []Angebot
	for _, o := range r.Products[0].Offers {
		// Nur Neuware (condition 1), und nur mit bekanntem aktuellen Preis:
		// die letzten beiden Werte von offerCSV sind Preis und Versand.
		n := len(o.OfferCSV)
		if o.Condition != 1 || n < 3 || o.OfferCSV[n-2] < 0 {
			continue
		}
		gesamt := o.OfferCSV[n-2]
		if v := o.OfferCSV[n-1]; v > 0 {
			gesamt += v
		}
		bestand := -1
		if m := len(o.StockCSV); m >= 2 && o.StockCSV[m-1] >= 0 {
			bestand = o.StockCSV[m-1]
		}
		liste = append(liste, Angebot{
			VerkaeuferID: o.SellerID, Amazon: o.IsAmazon, FBA: o.IsFBA, Prime: o.IsPrime,
			Gesamt: money.Cents(gesamt), Bestand: bestand, Mindestmenge: o.MinOrderQty,
		})
	}
	sort.SliceStable(liste, func(i, j int) bool { return liste[i].Gesamt < liste[j].Gesamt })
	return liste, a, nil
}
