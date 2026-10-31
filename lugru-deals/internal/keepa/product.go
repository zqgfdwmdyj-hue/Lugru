// Package keepa spricht mit der Keepa-API und wandelt deren Antworten in
// Werte um, mit denen der Rest des Programms rechnen kann.
package keepa

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/bild"
	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Spaltenindizes der csv-Reihen. Die Nummerierung stammt aus Keepas CsvType.
const (
	csvAmazon         = 0  // Paare: Zeit, Preis
	csvNeuFBA         = 10 // Paare: Zeit, Preis (günstigstes FBA-Angebot)
	csvNeuFBM         = 7  // Dreiergruppen: Zeit, Preis, Versand (günstigster Händlerversand)
	csvBuyBoxShipping = 18 // Dreiergruppen: Zeit, Preis, Versand
)

var ErrNichtGefunden = errors.New("keepa: kein Produkt zu dieser ASIN")

// Price ist ein Betrag, der auch fehlen kann. Keepa liefert -1 für „kein
// Wert"; ohne OK darf der Betrag in keine Rechnung fließen.
type Price struct {
	Cents money.Cents
	OK    bool
}

// Punkt ist ein Zeitpunkt des Buy-Box-Verlaufs. Gesamt enthält Preis plus
// Versandkosten, weil nur diese Summe mit dem Verkaufserlös vergleichbar ist.
type Punkt struct {
	Minute int // Keepa-Zeit in Minuten
	Gesamt money.Cents
}

// SalesQuelle hält fest, woher die Verkaufszahl stammt. Die Oberfläche zeigt
// das an, damit eine Schätzung nie für eine gemessene Zahl gehalten wird.
type SalesQuelle int

const (
	SalesMonthlySold SalesQuelle = iota // Amazons "im letzten Monat gekauft"
	SalesRankDrops                      // Keepa-Schätzung aus Rangsprüngen
	SalesKeine
)

type Product struct {
	ASIN   string
	Titel  string
	Marke  string
	Modell string

	// BildKennung ist der Dateiname des Hauptbildes, nicht die volle
	// Adresse. Die baut internal/bild erst beim Anzeigen — so lässt sich
	// die Bildgröße ändern, ohne gespeicherte Deals anzufassen.
	BildKennung string

	BuyBoxAvg90   Price
	BuyBoxAktuell Price
	AmazonAktuell Price
	FBA           Price

	// NeuFBAAktuell ist das günstigste neue FBA-Angebot, NeuFBMAktuell das
	// günstigste neue Angebot mit Händlerversand (inklusive Versand).
	// AmazonFBAAvg90 ist der niedrigere der beiden Ø-90-Tage-Preise von
	// Amazon selbst und dem günstigsten FBA-Angebot — ohne Buy-Box-Daten
	// (die kosten bei Keepa extra) der beste Ersatz für die Buy Box.
	NeuFBAAktuell  Price
	NeuFBMAktuell  Price
	AmazonFBAAvg90 Price

	// EANs sind die EANs, die Keepa zum Artikel kennt.
	EANs []string

	// Masse sind die Paketmaße, aus denen sich die EFN-Größenklasse
	// bestimmt (siehe internal/fba). Keepa nennt für Unbekanntes -1 oder 0;
	// beides wird hier zu 0, damit der Rest des Programms nur einen Fall
	// für "fehlt" kennt.
	//
	// Bewusst nur das Paketgewicht, nie ersatzweise itemWeight: das ist das
	// Gewicht des Artikels ohne Verpackung und läge damit systematisch zu
	// niedrig. Eine zu kleine Klasse ergäbe eine zu kleine Gebühr und einen
	// Deal, der besser aussieht als er ist — genau der Fehler, den die
	// Staffel vermeiden soll.
	Masse fba.Masse

	BuyBoxVerlauf []Punkt

	// AmazonVerlauf und FBAVerlauf sind der Preis von Amazon selbst und das
	// günstigste FBA-Angebot. Anders als die Buy Box liefert Keepa beide
	// ohne Aufpreis (die Buy-Box-Reihe kostet zwei Token extra).
	AmazonVerlauf []Punkt
	FBAVerlauf    []Punkt

	MonthlySold      int
	RankDrops30      int
	ProvisionProzent *float64
}

// Sales liefert die Verkaufszahl und ihre Herkunft.
func (p Product) Sales() (int, SalesQuelle) {
	if p.MonthlySold > 0 {
		return p.MonthlySold, SalesMonthlySold
	}
	if p.RankDrops30 > 0 {
		return p.RankDrops30, SalesRankDrops
	}
	return 0, SalesKeine
}

// Antwort bündelt Produkt und Kontingentstand einer Abfrage.
type Antwort struct {
	Produkt        Product
	TokensLeft     int
	TokensConsumed int
	RefillIn       time.Duration
	// RefillRate sind die Token, die je Minute nachkommen.
	RefillRate int
}

type rohAntwort struct {
	TokensLeft     int          `json:"tokensLeft"`
	TokensConsumed int          `json:"tokensConsumed"`
	RefillIn       int          `json:"refillIn"` // Millisekunden
	RefillRate     int          `json:"refillRate"`
	Products       []rohProdukt `json:"products"`
	Error          *rohFehler   `json:"error"`
}

type rohFehler struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type rohProdukt struct {
	ASIN                  string   `json:"asin"`
	Title                 string   `json:"title"`
	Brand                 string   `json:"brand"`
	Model                 string   `json:"model"`
	ImagesCSV             string   `json:"imagesCSV"`
	EANList               []string `json:"eanList"`
	MonthlySold           int      `json:"monthlySold"`
	ReferralFeePercentage *float64 `json:"referralFeePercentage"`
	FBAFees               *struct {
		PickAndPackFee int `json:"pickAndPackFee"`
	} `json:"fbaFees"`
	PackageLength int     `json:"packageLength"` // Millimeter
	PackageWidth  int     `json:"packageWidth"`
	PackageHeight int     `json:"packageHeight"`
	PackageWeight int     `json:"packageWeight"` // Gramm
	CSV           [][]int `json:"csv"`
	Stats         *struct {
		Current          []int `json:"current"`
		Avg90            []int `json:"avg90"`
		SalesRankDrops30 int   `json:"salesRankDrops30"`
	} `json:"stats"`
}

// ParseAntwort wandelt den Antwortkörper der Produkt-API um.
func ParseAntwort(roh []byte) (Antwort, error) {
	var r rohAntwort
	if err := json.Unmarshal(roh, &r); err != nil {
		return Antwort{}, fmt.Errorf("keepa: Antwort nicht lesbar: %w", err)
	}
	if r.Error != nil && r.Error.Type != "" {
		return Antwort{}, fmt.Errorf("keepa: %s: %s", r.Error.Type, r.Error.Message)
	}
	if len(r.Products) == 0 {
		return Antwort{}, ErrNichtGefunden
	}

	return Antwort{
		Produkt:        produktAus(r.Products[0]),
		TokensLeft:     r.TokensLeft,
		TokensConsumed: r.TokensConsumed,
		RefillIn:       time.Duration(r.RefillIn) * time.Millisecond,
		RefillRate:     r.RefillRate,
	}, nil
}

func produktAus(rp rohProdukt) Product {
	p := Product{
		ASIN:             rp.ASIN,
		Titel:            rp.Title,
		Marke:            rp.Brand,
		Modell:           rp.Model,
		BildKennung:      bild.KennungAusCSV(rp.ImagesCSV),
		MonthlySold:      rp.MonthlySold,
		RankDrops30:      -1,
		ProvisionProzent: rp.ReferralFeePercentage,
		BuyBoxVerlauf:    buyBoxVerlauf(rp.CSV),
		AmazonVerlauf:    paarVerlauf(rp.CSV, csvAmazon),
		FBAVerlauf:       paarVerlauf(rp.CSV, csvNeuFBA),
		Masse: fba.Masse{
			LaengeMM: mass(rp.PackageLength),
			BreiteMM: mass(rp.PackageWidth),
			HoeheMM:  mass(rp.PackageHeight),
			GewichtG: mass(rp.PackageWeight),
		},
	}
	if rp.FBAFees != nil {
		p.FBA = preis(rp.FBAFees.PickAndPackFee)
	}
	if rp.Stats != nil {
		p.RankDrops30 = rp.Stats.SalesRankDrops30
		p.BuyBoxAvg90 = ausReihe(rp.Stats.Avg90, csvBuyBoxShipping)
		p.BuyBoxAktuell = ausReihe(rp.Stats.Current, csvBuyBoxShipping)
		p.AmazonAktuell = ausReihe(rp.Stats.Current, csvAmazon)
		p.NeuFBAAktuell = ausReihe(rp.Stats.Current, csvNeuFBA)
		p.NeuFBMAktuell = ausReihe(rp.Stats.Current, csvNeuFBM)
		p.AmazonFBAAvg90 = niedriger(ausReihe(rp.Stats.Avg90, csvAmazon), ausReihe(rp.Stats.Avg90, csvNeuFBA))
	}
	for _, e := range rp.EANList {
		if e = strings.TrimSpace(e); e != "" {
			p.EANs = append(p.EANs, e)
		}
	}
	return p
}

// niedriger ist der kleinere zweier Preise; fehlt einer, gilt der andere.
func niedriger(a, b Price) Price {
	switch {
	case !a.OK:
		return b
	case !b.OK:
		return a
	case b.Cents < a.Cents:
		return b
	}
	return a
}

// Einkaufspreis ist der günstigste Preis, zu dem man den Artikel gerade neu
// kaufen kann: bei Amazon selbst, beim günstigsten FBA-Händler oder beim
// günstigsten Händler mit eigenem Versand (inklusive Versand).
func (p Product) Einkaufspreis() (Price, string) {
	best, wer := Price{}, ""
	for _, k := range []struct {
		p   Price
		wer string
	}{{p.AmazonAktuell, "Amazon"}, {p.NeuFBAAktuell, "FBA-Händler"}, {p.NeuFBMAktuell, "Händler"}} {
		if k.p.OK && k.p.Cents > 0 && (!best.OK || k.p.Cents < best.Cents) {
			best, wer = k.p, k.wer
		}
	}
	return best, wer
}

// mass macht aus Keepas Ganzzahl ein Maß. Keepa schreibt für "nicht
// vorhanden" mal -1, mal 0 (siehe die Feldbeschreibung: "0 or -1 if not
// available"); hier wird beides zu 0, damit fba.Masse.Vollstaendig nur einen
// Fall prüfen muss.
func mass(v int) int {
	if v < 0 {
		return 0
	}
	return v
}

// preis macht aus Keepas Ganzzahl einen Betrag. Negative Werte bedeuten
// „kein Wert" und werden nicht zu 0 € verfälscht.
func preis(v int) Price {
	if v < 0 {
		return Price{}
	}
	return Price{Cents: money.Cents(v), OK: true}
}

func ausReihe(reihe []int, index int) Price {
	if index >= len(reihe) {
		return Price{}
	}
	return preis(reihe[index])
}

// buyBoxVerlauf liest csv[18].
//
// Diese Reihe führt Versandkosten mit und hat deshalb Dreiergruppen
// (Zeit, Preis, Versand) statt der sonst üblichen Paare. Wer hier mit
// Schrittweite 2 läuft, bekommt stillschweigend Unsinn.
func buyBoxVerlauf(csv [][]int) []Punkt {
	if csvBuyBoxShipping >= len(csv) {
		return nil
	}
	roh := csv[csvBuyBoxShipping]

	var punkte []Punkt
	for i := 0; i+2 < len(roh); i += 3 {
		minute, p, versand := roh[i], roh[i+1], roh[i+2]
		if p < 0 {
			continue // zu diesem Zeitpunkt gab es keine Buy Box
		}
		if versand < 0 {
			versand = 0 // unbekannte Versandkosten nicht als Rabatt verrechnen
		}
		punkte = append(punkte, Punkt{Minute: minute, Gesamt: money.Cents(p + versand)})
	}
	return punkte
}

// paarVerlauf liest eine Reihe aus Paaren (Zeit, Preis). Ein negativer
// Preis heißt „kein Angebot“ und bleibt als Lücke (OK false) erhalten,
// damit ein ausverkaufter Zeitraum nicht den letzten Preis weiterführt.
func paarVerlauf(csv [][]int, index int) []Punkt {
	if index >= len(csv) {
		return nil
	}
	roh := csv[index]
	var punkte []Punkt
	for i := 0; i+1 < len(roh); i += 2 {
		p := roh[i+1]
		if p < 0 {
			p = -1
		}
		punkte = append(punkte, Punkt{Minute: roh[i], Gesamt: money.Cents(p)})
	}
	return punkte
}

// Verkaufsverlauf ist der Preis, zu dem sich der Artikel verkaufen ließ: der
// Buy-Box-Verlauf, wenn Keepa ihn geliefert hat, sonst zu jedem Zeitpunkt
// der niedrigere von Amazon-Preis und günstigstem FBA-Angebot — gegen
// diese beiden tritt ein FBA-Verkäufer an, und aus ihnen ergibt sich meist
// die Buy Box.
func (p Product) Verkaufsverlauf() []Punkt {
	if len(p.BuyBoxVerlauf) > 0 {
		return p.BuyBoxVerlauf
	}
	type ereignis struct {
		minute int
		reihe  int
		preis  money.Cents
	}
	var alle []ereignis
	for r, reihe := range [][]Punkt{p.AmazonVerlauf, p.FBAVerlauf} {
		for _, pt := range reihe {
			alle = append(alle, ereignis{pt.Minute, r, pt.Gesamt})
		}
	}
	sort.SliceStable(alle, func(i, j int) bool { return alle[i].minute < alle[j].minute })
	stand := [2]money.Cents{-1, -1}
	var out []Punkt
	for i, e := range alle {
		stand[e.reihe] = e.preis
		if i+1 < len(alle) && alle[i+1].minute == e.minute {
			continue
		}
		best := money.Cents(-1)
		for _, v := range stand {
			if v >= 0 && (best < 0 || v < best) {
				best = v
			}
		}
		if best < 0 {
			continue
		}
		if n := len(out); n > 0 && out[n-1].Gesamt == best {
			continue
		}
		out = append(out, Punkt{Minute: e.minute, Gesamt: best})
	}
	return out
}
