package altpost

import (
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
)

// Der Post aus dem Screenshot, so wie Discord seinen Text liefert.
const handPost = "🛒 Logitech MX Creative Console, Programmierbares Tastenfeld @everyone\n" +
	"🏬 [mediamarkt.de](<https://www.mediamarkt.de/de/product/_logitech-mx-creative-console-123.html>)\n" +
	"🏬 [saturn.de](https://www.saturn.de/de/product/_logitech-123.html)\n" +
	"💰 EK: 99.99 € Brutto inkl. Versand\n" +
	"💸 VK: 164.99 €  [Amazon.DE](https://www.amazon.de/dp/B0DFQXJ3N7?tag=x)\n" +
	"ℹ️ Amazon.DE: 50+ Verkäufe\n" +
	"🤑 Gewinn: 30.9 € / 19 % Marge\n" +
	"📊 [ArbitrageOne Export](https://app.arbitrageone.de/analyze?asin=B0DFQXJ3N7)"

func TestHandPost(t *testing.T) {
	d, ok := Lies(handPost)
	if !ok {
		t.Fatal("nicht erkannt")
	}
	will := Deal{
		Titel: "Logitech MX Creative Console, Programmierbares Tastenfeld", ASIN: "B0DFQXJ3N7",
		Quellmarkt: "DE", QuellURL: "https://www.mediamarkt.de/de/product/_logitech-mx-creative-console-123.html",
		Zielmarkt: "DE", EKCent: 9999, EKNotiz: "Brutto inkl. Versand", VKCent: 16499, Sales: 50,
		GewinnCent: 3090, Marge: 19,
	}
	if d != will {
		t.Errorf("\n got %+v\nwill %+v", d, will)
	}
}

// Was das Tool selbst postet, liest der Import wieder genauso.
func TestToolPostRundreise(t *testing.T) {
	daten := post.Daten{
		Titel: "Makita HR2630", ASIN: "B01636IZ0G", Mention: "<@&1469225443986116610>",
		EKHost: "amazon.es", EKUrl: "https://www.amazon.es/dp/B01636IZ0G",
		EK: "1.130,56 €", EKNotiz: "Brutto inkl. Versand (3er cart)", MaxMenge: "3",
		VK: "1.207,49 €", VKUrl: "https://www.amazon.fr/dp/B01636IZ0G", Zielmarkt: "FR",
		Sales: "40", Gewinn: "-5,77 €", Marge: "-19,2 %", MargeGerundet: "-19 %",
		GewinnPanEU: "5,12 €", MargePanEU: "17,1 %",
		AOUrl: "https://app.arbitrageone.de/analyze?asin=B01636IZ0G",
	}
	text, err := post.Render(post.StandardVorlage, daten)
	if err != nil {
		t.Fatal(err)
	}
	d, ok := Lies(text)
	if !ok {
		t.Fatalf("nicht erkannt:\n%s", text)
	}
	if d.Titel != "Makita HR2630" || d.ASIN != "B01636IZ0G" || d.Quellmarkt != "ES" || d.QuellURL != "" ||
		d.Zielmarkt != "FR" || d.EKCent != 113056 || d.VKCent != 120749 || d.GewinnCent != -577 ||
		d.Marge != -19.2 || d.Sales != 40 || d.MaxMenge != 3 ||
		!d.PanEU || d.PanEUGewinnCent != 512 || d.PanEUMarge != 17.1 {
		t.Errorf("gelesen: %+v\naus:\n%s", d, text)
	}
}

func TestAusverkauftUndNetto(t *testing.T) {
	text := "❌ **AUSVERKAUFT** ❌\n~~🛒 Lego 42115 @here~~\n~~🏬 Metro~~\n~~💰 EK: 250 € Netto~~\n" +
		"~~💸 VK: 399,00 €  [Amazon.IT](https://www.amazon.it/dp/B07ZLQ4WMV)~~\n~~🤑 Gewinn: 41,20 € / 10,3 % Marge~~"
	d, ok := Lies(text)
	if !ok {
		t.Fatal("nicht erkannt")
	}
	if !d.Ausverkauft || d.Titel != "Lego 42115" || d.Lieferant != "Metro" || !d.EKNetto || d.EKCent != 25000 ||
		d.Zielmarkt != "IT" || d.ASIN != "B07ZLQ4WMV" || d.GewinnCent != 4120 || d.Marge != 10.3 {
		t.Errorf("%+v", d)
	}
}

func TestKeinDeal(t *testing.T) {
	for _, text := range []string{
		"Hat jemand noch Versandkartons übrig?",
		"🛒 Logitech MX\n💰 EK: 99 €", // ohne Gewinn
		"",
	} {
		if _, ok := Lies(text); ok {
			t.Errorf("als Deal erkannt: %q", text)
		}
	}
}

func TestZahlen(t *testing.T) {
	for ein, will := range map[string]float64{
		"99,99": 99.99, "99.99": 99.99, "1.299,99": 1299.99, "1,299.99": 1299.99,
		"30.9": 30.9, "1.299": 1299, "−5,77": -5.77, "- 5,77": -5.77, "250": 250, "12,5": 12.5,
	} {
		if f, ok := zahl(ein); !ok || f != will {
			t.Errorf("zahl(%q) = %v, will %v", ein, f, will)
		}
	}
}

// "7.848" beim Gewinn ist bei einem VK von 39 € kein Tausenderpunkt, und
// eine Marge über 100 % gibt es nicht — sie wird aus Gewinn und VK
// nachgerechnet. Die ASIN aus der Titelzeile verschwindet aus dem Titel.
func TestUnplausibleZahlen(t *testing.T) {
	text := "🛒 Moschino Fresh Couture Gold EDP 50 ml B0CXYZ1234 @everyone\n" +
		"💰 EK: 25,50 €\n" +
		"💸 VK: 39,00 € [Amazon.DE](https://www.amazon.de/dp/B0CXYZ1234)\n" +
		"🤑 Gewinn: 7.848 € / 80110038380 % Marge"
	d, ok := Lies(text)
	if !ok {
		t.Fatal("nicht erkannt")
	}
	if d.GewinnCent != 785 || d.Marge != 20.1 || d.Titel != "Moschino Fresh Couture Gold EDP 50 ml" || d.ASIN != "B0CXYZ1234" {
		t.Errorf("%+v", d)
	}
}

func TestPanEUOhneMargeUndMehrdeutig(t *testing.T) {
	text := "🛒 PAN EU Listerine 3er Pack B000QXH4PK @everyone\n" +
		"💰 EK: 9,99 €\n" +
		"💸 VK: 18,50 € [Amazon.DE](https://www.amazon.de/dp/B000QXH4PK)\n" +
		"🤑 Gewinn: -2,10 € / -11 % Marge\n" +
		"🇪🇺 Pan EU: 5.047 €"
	d, ok := Lies(text)
	if !ok {
		t.Fatal("nicht erkannt")
	}
	if !d.PanEU || d.PanEUGewinnCent != 505 || d.PanEUMarge != 27.3 || d.GewinnCent != -210 || d.Marge != -11 {
		t.Errorf("%+v", d)
	}
	// Ein echter Tausenderbetrag bleibt einer, wenn er zum VK passt.
	d, _ = Lies("🛒 Sony TV\n💰 EK: 1.100 €\n💸 VK: 1.899 €\n🤑 Gewinn: 1.050 € / 55 % Marge")
	if d.GewinnCent != 105000 || d.VKCent != 189900 || d.EKCent != 110000 {
		t.Errorf("Tausender: %+v", d)
	}
}

// Ein Gewinn, der in keiner Lesart zum VK passt, macht den Post unlesbar.
func TestGewinnGroesserAlsVK(t *testing.T) {
	if _, ok := Lies("🛒 Artikel\n💸 VK: 20 €\n🤑 Gewinn: 500 € / 10 % Marge"); ok {
		t.Error("als Deal erkannt")
	}
}
