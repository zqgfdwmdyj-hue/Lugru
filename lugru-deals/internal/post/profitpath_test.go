package post

import (
	"net/url"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
)

func TestProfitPathURLReferenzfall(t *testing.T) {
	got := ProfitPathURL(PPParameter{
		ASIN:       "B0CVGYNC97",
		VKBrutto:   16412,
		EKBrutto:   11778,
		Zielmarkt:  marketplace.DE,
		Quellmarkt: marketplace.IT,
	})

	will := "https://profitpath.app/redirect" +
		"?storefront=de" +
		"&query=B0CVGYNC97" +
		"&pg_buy_region=it" +
		"&pg_buy=117.78" +
		"&pg_sell=164.12"

	if got != will {
		t.Errorf("URL falsch\n got: %s\nwill: %s", got, will)
	}
}

func TestProfitPathURLNutztPunkteKeineKommas(t *testing.T) {
	got := ProfitPathURL(PPParameter{
		ASIN: "B01636IZ0G", VKBrutto: 20749, EKBrutto: 13056,
		Zielmarkt: marketplace.DE, Quellmarkt: marketplace.ES,
	})
	u, err := url.Parse(got)
	if err != nil {
		t.Fatalf("URL nicht parsebar: %v", err)
	}
	for _, schluessel := range []string{"pg_buy", "pg_sell"} {
		v := u.Query().Get(schluessel)
		if v == "" {
			t.Fatalf("%s fehlt", schluessel)
		}
		for _, r := range v {
			if r == ',' {
				t.Errorf("%s = %q enthält ein Komma — ProfitPath braucht den Punkt", schluessel, v)
			}
		}
	}
}
