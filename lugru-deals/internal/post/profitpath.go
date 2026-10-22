package post

import (
	"net/url"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// PPParameter sind die Werte, die ProfitPath aus dem Deal übernimmt.
type PPParameter struct {
	ASIN       string
	VKBrutto   money.Cents
	EKBrutto   money.Cents
	Zielmarkt  marketplace.Code
	Quellmarkt marketplace.Code
}

// ProfitPathURL baut den Analyse-Link.
//
// Die Reihenfolge der Parameter entspricht dem vom Nutzer gelieferten
// Original und wird darum von Hand zusammengesetzt statt über url.Values,
// das alphabetisch sortieren würde. storefront und pg_buy_region erwartet
// ProfitPath klein geschrieben ("de", nicht "DE").
func ProfitPathURL(p PPParameter) string {
	var b strings.Builder
	b.WriteString("https://profitpath.app/redirect")

	paare := [][2]string{
		{"storefront", strings.ToLower(string(p.Zielmarkt))},
		{"query", p.ASIN},
		{"pg_buy_region", strings.ToLower(string(p.Quellmarkt))},
		{"pg_buy", p.EKBrutto.Dot()},
		{"pg_sell", p.VKBrutto.Dot()},
	}
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
