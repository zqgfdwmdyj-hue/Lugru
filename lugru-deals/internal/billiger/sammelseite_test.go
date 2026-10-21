package billiger

import "testing"

func TestVarianten(t *testing.T) {
	seite := `<a href="/products/4717608960-sony-playstation-5-slim-disc-edition">Disc</a>
<a href="https://www.billiger.de/products/4718879898-sony-playstation-5-slim-digital-edition?x=1">Digital</a>
<a href="/products/4717608960-sony-playstation-5-slim-disc-edition#offers">doppelt</a>
<a href="/pricelist/4726405867-sony-disc-laufwerk-fuer-ps5">Zubehör</a>`
	v := Varianten(seite, "https://www.billiger.de/baseproducts/79784-sony-playstation-5")
	if len(v) != 2 {
		t.Fatalf("%d Varianten: %+v", len(v), v)
	}
	if v[0].URL != "https://www.billiger.de/products/4717608960-sony-playstation-5-slim-disc-edition" || v[0].Name != "Sony Playstation 5 Slim Disc Edition" {
		t.Errorf("v[0] = %+v", v[0])
	}
	if _, ok := IstSammelseite("https://www.billiger.de/baseproducts/79784-sony-playstation-5#offers"); !ok {
		t.Error("Sammelseite nicht erkannt")
	}
	if _, ok := IstSammelseite("https://www.billiger.de/products/1-x"); ok {
		t.Error("Produktseite als Sammelseite erkannt")
	}
}
