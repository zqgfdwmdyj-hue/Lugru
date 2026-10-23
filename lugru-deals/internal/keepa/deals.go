package keepa

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Keepas „Browsing Deals“: statt jede ASIN einzeln zu fragen, liefert Keepa
// die Artikel, deren Preis zuletzt gefallen ist — bis zu 150 je Abfrage,
// gefiltert nach Markt, Preisart, Rabatt, Preis, Verkaufsrang, Kategorie und
// Titel. Keepa hält eine Abfrage 120 Sekunden vor; öfter fragen bringt
// nichts.

// Preisarten, nach denen Keepa Deals sucht (CsvType).
const (
	DealAmazon    = 0  // Amazon selbst
	DealNeu       = 1  // günstigstes Neuangebot (ohne Versand)
	DealWarehouse = 9  // Amazon Warehouse
	DealNeuFBA    = 10 // günstigstes FBA-Angebot
)

// DealAnfrage ist eine Suche nach Preisstürzen.
type DealAnfrage struct {
	Domain    int
	Preisart  int
	MinRabatt int // Prozent, mindestens 10
	// Zeitraum: 0 = letzte 24 Stunden, 1 = Woche, 2 = Monat, 3 = 90 Tage.
	Zeitraum     int
	MinPreis     money.Cents
	MaxPreis     money.Cents
	MaxRang      int // 0 = keine Grenze
	Suchbegriff  string
	Kategorien   []int64
	Ausschluesse []int64
	Seite        int
}

type dealJSON struct {
	Page              int     `json:"page"`
	DomainID          int     `json:"domainId"`
	PriceTypes        []int   `json:"priceTypes"`
	DateRange         int     `json:"dateRange"`
	DeltaPercentRange []int   `json:"deltaPercentRange"`
	CurrentRange      []int   `json:"currentRange,omitempty"`
	SalesRankRange    []int   `json:"salesRankRange,omitempty"`
	TitleSearch       string  `json:"titleSearch,omitempty"`
	IncludeCategories []int64 `json:"includeCategories,omitempty"`
	ExcludeCategories []int64 `json:"excludeCategories,omitempty"`
	IsRangeEnabled    bool    `json:"isRangeEnabled"`
	IsFilterEnabled   bool    `json:"isFilterEnabled"`
	FilterErotic      bool    `json:"filterErotic"`
	SingleVariation   bool    `json:"singleVariation"`
	SortType          int     `json:"sortType"`
}

// JSON baut den Körper der Anfrage. Neueste Deals zuerst, je Artikel nur
// eine Variante (sonst kommen Listings mit Hunderten Varianten mehrfach).
func (a DealAnfrage) JSON() []byte {
	rabatt := a.MinRabatt
	if rabatt < 10 {
		rabatt = 10
	}
	d := dealJSON{
		Page: a.Seite, DomainID: a.Domain, PriceTypes: []int{a.Preisart}, DateRange: a.Zeitraum,
		DeltaPercentRange: []int{rabatt, 100}, TitleSearch: strings.TrimSpace(a.Suchbegriff),
		IncludeCategories: a.Kategorien, ExcludeCategories: a.Ausschluesse,
		IsRangeEnabled: true, IsFilterEnabled: true, FilterErotic: true, SingleVariation: true, SortType: 1,
	}
	if a.MinPreis > 0 || a.MaxPreis > 0 {
		hoch := int(a.MaxPreis)
		if hoch <= 0 {
			hoch = 100000000
		}
		d.CurrentRange = []int{int(a.MinPreis), hoch}
	}
	if a.MaxRang > 0 {
		d.SalesRankRange = []int{0, a.MaxRang}
	}
	roh, _ := json.Marshal(d)
	return roh
}

// Deal ist ein Artikel mit einem Preissturz.
type Deal struct {
	ASIN  string
	Titel string
	// Preis ist der aktuelle Preis der gesuchten Preisart, Schnitt der
	// Durchschnitt im gewählten Zeitraum, Rabatt der Abstand in Prozent.
	Preis   money.Cents
	Schnitt money.Cents
	Rabatt  int
	Rang    int
	Bild    string
	// Seit ist, seit wann der Preis gilt.
	Seit time.Time
}

// DealErgebnis ist eine Seite Deals samt Kontingentstand.
type DealErgebnis struct {
	Deals          []Deal
	TokensLeft     int
	TokensConsumed int
	RefillRate     int
}

// Deals fragt Keepa nach Preisstürzen.
func (c *Client) Deals(ctx context.Context, a DealAnfrage) (DealErgebnis, error) {
	koerper, err := c.senden(ctx, "deal", nil, a.JSON())
	if err != nil {
		return DealErgebnis{}, err
	}
	return LiesDeals(koerper, a.Preisart, a.Zeitraum)
}

// LiesDeals wertet die Antwort der Deal-Abfrage aus.
func LiesDeals(koerper []byte, preisart, zeitraum int) (DealErgebnis, error) {
	var r struct {
		TokensLeft     int        `json:"tokensLeft"`
		TokensConsumed int        `json:"tokensConsumed"`
		RefillRate     int        `json:"refillRate"`
		Error          *rohFehler `json:"error"`
		Deals          *struct {
			DR []struct {
				ASIN         string  `json:"asin"`
				Title        string  `json:"title"`
				Current      []int   `json:"current"`
				Avg          [][]int `json:"avg"`
				DeltaPercent [][]int `json:"deltaPercent"`
				Image        []int   `json:"image"`
				CurrentSince []int   `json:"currentSince"`
			} `json:"dr"`
		} `json:"deals"`
	}
	if err := json.Unmarshal(koerper, &r); err != nil {
		return DealErgebnis{}, fmt.Errorf("keepa: Deal-Antwort nicht lesbar: %w", err)
	}
	if r.Error != nil && r.Error.Type != "" {
		return DealErgebnis{}, fmt.Errorf("keepa: %s: %s", r.Error.Type, r.Error.Message)
	}
	erg := DealErgebnis{TokensLeft: r.TokensLeft, TokensConsumed: r.TokensConsumed, RefillRate: r.RefillRate}
	if r.Deals == nil {
		return erg, nil
	}
	wert := func(reihe []int, i int) int {
		if i >= 0 && i < len(reihe) {
			return reihe[i]
		}
		return -1
	}
	for _, d := range r.Deals.DR {
		preis := wert(d.Current, preisart)
		if d.ASIN == "" || preis <= 0 {
			continue
		}
		dl := Deal{ASIN: d.ASIN, Titel: strings.TrimSpace(d.Title), Preis: money.Cents(preis), Rang: wert(d.Current, 3)}
		// avg und deltaPercent: erste Stufe Zeitraum, zweite Preisart.
		if zeitraum >= 0 && zeitraum < len(d.Avg) {
			if s := wert(d.Avg[zeitraum], preisart); s > 0 {
				dl.Schnitt = money.Cents(s)
			}
		}
		if zeitraum >= 0 && zeitraum < len(d.DeltaPercent) {
			dl.Rabatt = wert(d.DeltaPercent[zeitraum], preisart)
			if dl.Rabatt < 0 {
				dl.Rabatt = -dl.Rabatt
			}
		}
		if len(d.Image) > 0 {
			b := make([]byte, 0, len(d.Image))
			for _, z := range d.Image {
				b = append(b, byte(z))
			}
			dl.Bild = string(b)
		}
		if m := wert(d.CurrentSince, preisart); m > 0 {
			dl.Seit = time.Unix(int64(m+21564000)*60, 0)
		}
		erg.Deals = append(erg.Deals, dl)
	}
	return erg, nil
}
