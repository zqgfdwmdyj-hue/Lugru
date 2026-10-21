package marketplace

import (
	"errors"
	"strings"
	"testing"
)

func TestParseEinkaufslinkAmazon(t *testing.T) {
	faelle := []struct {
		ein        string
		willASIN   string
		willQuelle *Code // nil = kein erkennbarer Amazon-Markt
	}{
		{"https://www.amazon.es/dp/B01636IZ0G", "B01636IZ0G", codeP(ES)},
		{"https://www.amazon.de/dp/B01636IZ0G", "B01636IZ0G", codeP(DE)},
		{"https://amazon.it/dp/B01636IZ0G", "B01636IZ0G", codeP(IT)},
		{"https://www.amazon.fr/gp/product/B01636IZ0G", "B01636IZ0G", codeP(FR)},
		{"https://www.amazon.es/gp/aw/d/B01636IZ0G", "B01636IZ0G", codeP(ES)},
		{"https://www.amazon.es/dp/B01636IZ0G?th=1&psc=1", "B01636IZ0G", codeP(ES)},
		{"https://www.amazon.es/Makita-HR2630/dp/B01636IZ0G/ref=sr_1_1", "B01636IZ0G", codeP(ES)},
		{"  https://www.amazon.es/dp/B01636IZ0G  ", "B01636IZ0G", codeP(ES)},
		{"www.amazon.es/dp/B01636IZ0G", "B01636IZ0G", codeP(ES)},
		{"B01636IZ0G", "B01636IZ0G", nil},
		{"  b01636iz0g  ", "B01636IZ0G", nil},
	}
	for _, f := range faelle {
		got, err := ParseEinkaufslink(f.ein)
		if err != nil {
			t.Errorf("ParseEinkaufslink(%q): unerwarteter Fehler %v", f.ein, err)
			continue
		}
		if got.ASIN != f.willASIN {
			t.Errorf("ParseEinkaufslink(%q).ASIN = %q, will %q", f.ein, got.ASIN, f.willASIN)
		}
		if got.Extern() {
			t.Errorf("ParseEinkaufslink(%q) gilt als Fremdshop, ist aber Amazon", f.ein)
		}
		switch {
		case f.willQuelle == nil && got.Markt != nil:
			t.Errorf("ParseEinkaufslink(%q).Markt = %s, will nil", f.ein, got.Markt.Code)
		case f.willQuelle != nil && got.Markt == nil:
			t.Errorf("ParseEinkaufslink(%q).Markt = nil, will %s", f.ein, *f.willQuelle)
		case f.willQuelle != nil && got.Markt.Code != *f.willQuelle:
			t.Errorf("ParseEinkaufslink(%q).Markt = %s, will %s", f.ein, got.Markt.Code, *f.willQuelle)
		}
	}
}

// TestParseEinkaufslinkAmazonOhneASIN deckt den Link ab, der zwar zu einem
// bekannten Marktplatz führt, aber auf keine Produktseite: die ASIN fehlt
// dann und der Funnel fragt sie nach, statt die Eingabe abzulehnen.
func TestParseEinkaufslinkAmazonOhneASIN(t *testing.T) {
	got, err := ParseEinkaufslink("https://www.amazon.de/s?k=makita")
	if err != nil {
		t.Fatalf("unerwarteter Fehler: %v", err)
	}
	if got.ASIN != "" {
		t.Errorf("ASIN = %q, will leer", got.ASIN)
	}
	if got.Markt == nil || got.Markt.Code != DE {
		t.Errorf("Markt = %v, will DE", got.Markt)
	}
}

// TestParseEinkaufslinkFremdshop ist der neue zweite Weg in den Funnel: ein
// Einkaufslink muss nicht zu Amazon führen. Verkauft wird trotzdem bei
// Amazon, darum bleibt die ASIN offen und wird nachgefragt.
func TestParseEinkaufslinkFremdshop(t *testing.T) {
	faelle := []struct {
		ein      string
		willHost string
		willASIN string
	}{
		{"https://www.mediamarkt.de/de/product/_makita-hr2630-2745899.html", "mediamarkt.de", ""},
		{"https://shop.example.org/artikel/12345", "shop.example.org", ""},
		{"mediamarkt.de/de/product/x", "mediamarkt.de", ""},
		// Ein Amazon-Marktplatz ohne eigene Zeile in der Tabelle zählt
		// ebenfalls als Fremdshop — seine ASIN steht aber im Pfad und wird
		// mitgenommen, statt sie unnötig zu erfragen.
		{"https://www.amazon.co.uk/dp/B01636IZ0G", "amazon.co.uk", "B01636IZ0G"},
	}
	for _, f := range faelle {
		got, err := ParseEinkaufslink(f.ein)
		if err != nil {
			t.Errorf("ParseEinkaufslink(%q): unerwarteter Fehler %v", f.ein, err)
			continue
		}
		if !got.Extern() {
			t.Errorf("ParseEinkaufslink(%q) gilt nicht als Fremdshop", f.ein)
		}
		if got.Host != f.willHost {
			t.Errorf("ParseEinkaufslink(%q).Host = %q, will %q", f.ein, got.Host, f.willHost)
		}
		if got.ASIN != f.willASIN {
			t.Errorf("ParseEinkaufslink(%q).ASIN = %q, will %q", f.ein, got.ASIN, f.willASIN)
		}
		if got.Markt != nil {
			t.Errorf("ParseEinkaufslink(%q).Markt = %s, will nil — ein Fremdshop ist kein Amazon-Marktplatz", f.ein, got.Markt.Code)
		}
		if got.URL == "" {
			t.Errorf("ParseEinkaufslink(%q).URL ist leer — der Link landet so nie im Post", f.ein)
		}
	}
}

func TestParseEinkaufslinkFehler(t *testing.T) {
	if _, err := ParseEinkaufslink("   "); !errors.Is(err, ErrKeineEingabe) {
		t.Errorf("leere Eingabe: will ErrKeineEingabe, bekam %v", err)
	}
	for _, ein := range []string{"kein link", "B0163", "hallo", "javascript:alert(1)", "ftp://shop.de/x"} {
		if q, err := ParseEinkaufslink(ein); err == nil {
			t.Errorf("ParseEinkaufslink(%q): Fehler erwartet, kam %+v", ein, q)
		}
	}
}

// TestLandZuHost prüft den Vorschlag für das Einkaufsland eines Fremdshops.
// Er bestimmt allein den Umsatzsteuersatz des Einkaufs.
func TestLandZuHost(t *testing.T) {
	for host, will := range map[string]Code{
		"mediamarkt.de": DE, "fnac.fr": FR, "unieuro.it": IT, "pccomponentes.es": ES,
	} {
		m, ok := LandZuHost(host)
		if !ok || m.Code != will {
			t.Errorf("LandZuHost(%q) = %v/%v, will %s", host, m.Code, ok, will)
		}
	}
	for _, host := range []string{"shop.example.org", "example.com", "ohnepunkt", ""} {
		if m, ok := LandZuHost(host); ok {
			t.Errorf("LandZuHost(%q) = %s, will kein Vorschlag", host, m.Code)
		}
	}
}

func codeP(c Code) *Code { return &c }

// TestFremdePfadnummerIstKeineASIN: die ASIN-Erkennung im Pfad gilt seit dem
// Funnel für jeden Shop. Ohne Segmentgrenze zählte der Anfang einer längeren
// Nummer als ASIN — aus der gewöhnlichen 13-stelligen Artikelnummer
// /product/1234567890123 wurde die erfundene ASIN "1234567890", und der
// Funnel lief ohne Rückfrage mit einer Kennung weiter, die niemand
// eingegeben hat.
func TestFremdePfadnummerIstKeineASIN(t *testing.T) {
	for _, ein := range []string{
		"https://shop.example.de/product/1234567890123",
		"https://shop.example.de/product/B01636IZ0GX",
		"https://www.amazon.de/dp/1234567890123",
	} {
		got, err := ParseEinkaufslink(ein)
		if err != nil {
			t.Errorf("ParseEinkaufslink(%q): unerwarteter Fehler %v", ein, err)
			continue
		}
		if got.ASIN != "" {
			t.Errorf("ParseEinkaufslink(%q).ASIN = %q — der Anfang einer längeren Nummer ist keine ASIN", ein, got.ASIN)
		}
	}

	// Die Amazon-eigene Linkform behält ihre ASIN, auch mit Anhang dahinter.
	for _, ein := range []string{
		"https://www.amazon.de/dp/B01636IZ0G/ref=sr_1_1",
		"https://www.amazon.co.uk/dp/B01636IZ0G",
	} {
		got, err := ParseEinkaufslink(ein)
		if err != nil || got.ASIN != "B01636IZ0G" {
			t.Errorf("ParseEinkaufslink(%q) = %q/%v, will B01636IZ0G", ein, got.ASIN, err)
		}
	}

	// "/product/" ist die Form, die auch beliebige Fremdshops benutzen —
	// dort steht deren eigene Artikelnummer, bei Amazon dagegen die ASIN.
	amazon, _ := ParseEinkaufslink("https://www.amazon.de/product/B01636IZ0G")
	if amazon.ASIN != "B01636IZ0G" {
		t.Errorf("auf einem Amazon-Host bleibt /product/ eine ASIN-Form, bekam %q", amazon.ASIN)
	}
	fremd, _ := ParseEinkaufslink("https://shop.example.de/product/B01636IZ0G")
	if fremd.ASIN != "" {
		t.Errorf("auf einem Fremdshop ist /product/%s keine ASIN, sondern dessen Artikelnummer", fremd.ASIN)
	}
}

// TestLinkVerlaesstDenMarkdownLinkNicht deckt die Grenze ab, an der der Link
// im Discord-Post steht: "[Shop](hier)". Eine schließende Klammer im Link
// beendet ihn dort vorzeitig, und was danach kommt, steht als eigener Text —
// bis hin zu einem zweiten, scheinbar mitempfohlenen Link. Schema- und
// Hostprüfung fangen das nicht, der Link ist ja gültig.
func TestLinkVerlaesstDenMarkdownLinkNicht(t *testing.T) {
	for _, ein := range []string{
		"https://shop.example/product?x=)[FAKE](https://boese.example)",
		"https://shop.example/pro(duct)/x",
		"https://shop.example/x#)[a](b)",
		"https://www.amazon.de/dp/B01636IZ0G?x=)[FAKE](https://boese.example)",
	} {
		got, err := ParseEinkaufslink(ein)
		if err != nil {
			t.Errorf("ParseEinkaufslink(%q): unerwarteter Fehler %v", ein, err)
			continue
		}
		if strings.ContainsAny(got.URL, "()<> ") {
			t.Errorf("ParseEinkaufslink(%q).URL = %q — Klammern und Leerzeichen müssen prozentkodiert sein, sonst bricht der Link aus dem Markdown-Link aus", ein, got.URL)
		}
	}

	// Ein harmloser Link bleibt unverändert.
	got, err := ParseEinkaufslink("https://shop.example/de/product/12345.html?farbe=blau")
	if err != nil {
		t.Fatalf("unerwarteter Fehler: %v", err)
	}
	if got.URL != "https://shop.example/de/product/12345.html?farbe=blau" {
		t.Errorf("URL = %q — ein unverfänglicher Link darf nicht umgeschrieben werden", got.URL)
	}
}
