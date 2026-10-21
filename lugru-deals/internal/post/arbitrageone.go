package post

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// AOParameter sind die Werte, die ArbitrageOne aus dem Deal übernimmt.
type AOParameter struct {
	ASIN             string
	VKBrutto         money.Cents
	EKBrutto         money.Cents
	EKNettoBerechnet money.Cents // im Brutto-Modus 0
	Sales            int
	Zielmarkt        marketplace.Code
	QuellURL         string
}

// ArbitrageOneURL baut den Analyse-Link.
//
// Die Reihenfolge der Parameter entspricht dem vom Nutzer gelieferten Original
// und wird darum von Hand zusammengesetzt statt über url.Values, das
// alphabetisch sortieren würde. Alle Beträge mit Dezimalpunkt — Kommas
// versteht ArbitrageOne nicht.
func ArbitrageOneURL(p AOParameter) string {
	var b strings.Builder
	b.WriteString("https://app.arbitrageone.de/analyze")

	// Im Netto-Modus stellt ArbitrageOne seinen Schalter auf "netto" und
	// liest source_price als Nettopreis — dort muss darum der Nettopreis
	// stehen, sonst rechnet es mit dem Bruttobetrag als Netto weiter.
	ek := p.EKBrutto
	if p.EKNettoBerechnet != 0 {
		ek = p.EKNettoBerechnet
	}
	paare := [][2]string{
		{"via", "fbaresell"},
		{"asin", p.ASIN},
		{"sell_price", p.VKBrutto.Dot()},
		{"source_price", ek.Dot()},
	}
	if p.EKNettoBerechnet != 0 {
		paare = append(paare, [2]string{"source_price_calculated_net", p.EKNettoBerechnet.Dot()})
	}
	paare = append(paare, [][2]string{
		{"estimated_sales", strconv.Itoa(p.Sales)},
		{"target_marketplace", string(p.Zielmarkt)},
		{"source_url", p.QuellURL},
	}...)
	for i, paar := range paare {
		if i == 0 {
			b.WriteByte('?')
		} else {
			b.WriteByte('&')
		}
		b.WriteString(paar[0])
		b.WriteByte('=')
		b.WriteString(url.QueryEscape(paar[1]))
	}
	return b.String()
}
