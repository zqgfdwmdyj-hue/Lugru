package billiger

import "testing"

func TestSortiereTreffer(t *testing.T) {
	v := []Variante{
		{Name: "PlayStation 5 Pro Gehäuselüfter"},
		{Name: "Razer Wolverine V2 Pro Controller Weiß PlayStation 5"},
		{Name: "Sony PlayStation 5 Pro (PS5 Pro)"},
	}
	if got := SortiereTreffer(v, "PlayStation 5 Pro")[0].Name; got != "Sony PlayStation 5 Pro (PS5 Pro)" {
		t.Errorf("vorn: %q", got)
	}
	r := []Variante{
		{Name: "Crucial DDR5-5600 32GB Kit (2x16GB) DIMM CL46 CT2K16G56C46U5"},
		{Name: "Crucial DDR5-5600 32GB Kit (2x16GB) SO-DIMM CL46 CT2K16G56C46S5"},
	}
	if got := SortiereTreffer(r, "Crucial DDR5 32GB 5600 CL46", "Modell CT2K16G56C46S5")[0].Name; got != "Crucial DDR5-5600 32GB Kit (2x16GB) SO-DIMM CL46 CT2K16G56C46S5" {
		t.Errorf("Modell nicht bevorzugt: %q", got)
	}
}

func TestTrefferAusSuchseite(t *testing.T) {
	seite := `<a href="/products/5073354969-sony-playstation-5-pro-ps5-pro" class="x" title="Sony PlayStation 5 Pro (PS5 Pro)">
<a href="/products/5073354969-sony-playstation-5-pro-ps5-pro#offers">doppelt</a>
<a href="/pricelist/1-starlink-mini-kit?uds=1">x</a>`
	tr := Treffer(seite)
	if len(tr) != 2 || tr[0].Name != "Sony PlayStation 5 Pro (PS5 Pro)" || tr[1].URL != "https://www.billiger.de/pricelist/1-starlink-mini-kit" {
		t.Errorf("Treffer = %+v", tr)
	}
}
