package post

import (
	"net/url"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
)

func TestArbitrageOneURLReferenzfall(t *testing.T) {
	got := ArbitrageOneURL(AOParameter{
		ASIN:             "B01636IZ0G",
		VKBrutto:         20749,
		EKBrutto:         13056,
		EKNettoBerechnet: 0,
		Sales:            40,
		Zielmarkt:        marketplace.DE,
		QuellURL:         "https://www.amazon.es/dp/B01636IZ0G",
	})

	will := "https://app.arbitrageone.de/analyze" +
		"?via=fbaresell" +
		"&asin=B01636IZ0G" +
		"&sell_price=207.49" +
		"&source_price=130.56" +
		"&estimated_sales=40" +
		"&target_marketplace=DE" +
		"&source_url=https%3A%2F%2Fwww.amazon.es%2Fdp%2FB01636IZ0G"

	if got != will {
		t.Errorf("URL falsch\n got: %s\nwill: %s", got, will)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatalf("URL nicht parsebar: %v", err)
	}
	if _, vorhanden := u.Query()["source_price_calculated_net"]; vorhanden {
		t.Errorf("source_price_calculated_net darf im Brutto-Modus nicht gesetzt sein")
	}
}

func TestArbitrageOneURLNettoModus(t *testing.T) {
	got := ArbitrageOneURL(AOParameter{
		ASIN: "B01636IZ0G", VKBrutto: 20749, EKBrutto: 13056,
		EKNettoBerechnet: 10790, Sales: 40,
		Zielmarkt: marketplace.DE, QuellURL: "https://www.amazon.es/dp/B01636IZ0G",
	})

	u, err := url.Parse(got)
	if err != nil {
		t.Fatalf("URL nicht parsebar: %v", err)
	}
	if v := u.Query().Get("source_price_calculated_net"); v != "107.90" {
		t.Errorf("source_price_calculated_net = %q, will 107.90", v)
	}
	// ArbitrageOne liest source_price im Netto-Modus als Nettopreis.
	if v := u.Query().Get("source_price"); v != "107.90" {
		t.Errorf("source_price = %q, will den Nettopreis 107.90", v)
	}
}

func TestArbitrageOneURLNutztPunkteKeineKommas(t *testing.T) {
	got := ArbitrageOneURL(AOParameter{
		ASIN: "B01636IZ0G", VKBrutto: 20749, EKBrutto: 13056,
		Sales: 40, Zielmarkt: marketplace.DE,
		QuellURL: "https://www.amazon.es/dp/B01636IZ0G",
	})
	u, _ := url.Parse(got)
	for _, schluessel := range []string{"sell_price", "source_price"} {
		v := u.Query().Get(schluessel)
		if v == "" {
			t.Fatalf("%s fehlt", schluessel)
		}
		for _, r := range v {
			if r == ',' {
				t.Errorf("%s = %q enthält ein Komma — ArbitrageOne braucht den Punkt", schluessel, v)
			}
		}
	}
}
