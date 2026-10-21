package post

import (
	"errors"
	"strings"
	"testing"
)

func referenzDaten() Daten {
	return Daten{
		Titel:         "Makita HR2630",
		ASIN:          "B01636IZ0G",
		Mention:       "@everyone",
		EKHost:        "amazon.es",
		EKUrl:         "https://www.amazon.es/dp/B01636IZ0G",
		EK:            "130,56 €",
		EKNotiz:       "Brutto inkl. Versand (3er cart)",
		VK:            "207,49 €",
		VKUrl:         "https://www.amazon.de/dp/B01636IZ0G",
		Zielmarkt:     "DE",
		Sales:         "40",
		Gewinn:        "31,67 €",
		Marge:         "15,3 %",
		MargeGerundet: "15 %",
		// Ein einzelner Markt, in den flachen Feldern und in .Maerkte
		// gleichlautend — genau das liefert baueDeal für einen Leitmarkt
		// ohne weitere Zielmärkte.
		Maerkte: []MarktDaten{
			{Code: "DE", VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G",
				Sales: "40", Gewinn: "31,67 €", Marge: "15,3 %", MargeGerundet: "15 %"},
		},
		AOUrl: "https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G",
		PPUrl: "https://profitpath.app/redirect?storefront=de&query=B01636IZ0G&pg_buy_region=es&pg_buy=130.56&pg_sell=207.49",
	}
}

func TestRenderStandardVorlage(t *testing.T) {
	got, err := Render(StandardVorlage, referenzDaten())
	if err != nil {
		t.Fatalf("Render: %v", err)
	}

	will := strings.Join([]string{
		"🛒 Makita HR2630 @everyone",
		"🏬 [amazon.es](https://www.amazon.es/dp/B01636IZ0G)",
		"💰 EK: 130,56 € Brutto inkl. Versand (3er cart)",
		"💸 VK: 207,49 €  [Amazon.DE](https://www.amazon.de/dp/B01636IZ0G)",
		"ℹ️ Amazon.DE: 40 Verkäufe",
		"🤑 Gewinn: 31,67 € / 15,3 % Marge",
		"🔢 ASIN: B01636IZ0G",
		":bar_chart: [ArbitrageOne Export](https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G)",
		":chart_with_upwards_trend: [ProfitPath Analyse](https://profitpath.app/redirect?storefront=de&query=B01636IZ0G&pg_buy_region=es&pg_buy=130.56&pg_sell=207.49)",
	}, "\n")

	if got != will {
		t.Errorf("Post falsch\n got:\n%s\n\nwill:\n%s", got, will)
	}
}

func TestRenderEscapedNicht(t *testing.T) {
	// html/template wuerde aus & ein &amp; machen und die Links zerstoeren.
	got, err := Render("{{.AOUrl}}", referenzDaten())
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if strings.Contains(got, "&amp;") {
		t.Errorf("Ausgabe ist HTML-escaped: %q — es muss text/template sein", got)
	}
}

func TestPruefeErkenntKaputteVorlagen(t *testing.T) {
	for _, vorlage := range []string{
		"{{.Titel",                 // Klammer nicht geschlossen
		"{{.GibtEsNicht}}",         // unbekanntes Feld
		"{{range .Titel}}x{{end}}", // Feld ist kein Bereich
	} {
		if err := Pruefe(vorlage); err == nil {
			t.Errorf("Pruefe(%q): Fehler erwartet, kam keiner", vorlage)
		}
	}
}

func TestPruefeAkzeptiertStandardvorlage(t *testing.T) {
	if err := Pruefe(StandardVorlage); err != nil {
		t.Errorf("Pruefe(StandardVorlage) = %v, will nil", err)
	}
}

func TestRenderZuLang(t *testing.T) {
	d := referenzDaten()
	d.Titel = strings.Repeat("x", MaxLaenge+1)
	if _, err := Render(StandardVorlage, d); !errors.Is(err, ErrZuLang) {
		t.Errorf("will ErrZuLang, bekam %v", err)
	}
}

func TestMargeGerundetVerfuegbar(t *testing.T) {
	got, err := Render("{{.MargeGerundet}}", referenzDaten())
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if got != "15 %" {
		t.Errorf("MargeGerundet = %q, will \"15 %%\"", got)
	}
}

// alteVorlage ist die StandardVorlage, wie sie vor der Mehrmarkt-Änderung
// aussah. Genau diese Zeichenkette steht in der Datenbank jedes Nutzers, der
// die Vorlage einmal gespeichert hat — sie muss unverändert rendern.
//
// Bewusst als eigener Wortlaut geführt und nicht bloß als Verweis auf
// AlteStandardVorlage: der Store tauscht genau diese Zeichenkette beim Start
// aus, und TestAlteStandardVorlageIstDerAlteWortlaut hält fest, dass die
// Konstante nie stillschweigend von dem abweicht, was tatsächlich in den
// Datenbanken liegt.
const alteVorlage = "🛒 {{.Titel}} {{.ASIN}} {{.Mention}}\n" +
	"🏬 [{{.EKHost}}]({{.EKUrl}})\n" +
	"💰 EK: {{.EK}} {{.EKNotiz}}\n" +
	"💸 VK: {{.VK}}  [Amazon.{{.Zielmarkt}}]({{.VKUrl}})\n" +
	"ℹ️ Amazon.{{.Zielmarkt}}: {{.Sales}} Verkäufe\n" +
	"🤑 Gewinn: {{.Gewinn}} / {{.Marge}} Marge\n" +
	"{{if .GewinnPanEU}}🇪🇺 mit Pan-EU: {{.GewinnPanEU}} / {{.MargePanEU}} Marge\n{{end}}" +
	":bar_chart: [ArbitrageOne Export]({{.AOUrl}})"

func TestAlteStandardVorlageIstDerAlteWortlaut(t *testing.T) {
	if AlteStandardVorlage != alteVorlage {
		t.Errorf("AlteStandardVorlage weicht vom alten Wortlaut ab — der Store fände die gespeicherte Vorlage nicht mehr:\n got:\n%s\n\nwill:\n%s", AlteStandardVorlage, alteVorlage)
	}
}

func TestAlteVorlageRendertWeiterUndZeigtDenLeitmarkt(t *testing.T) {
	d := beispiel
	d.Zielmarkt, d.VK, d.Gewinn, d.Marge = "DE", "207,49 €", "26,70 €", "12,9 %"
	d.Maerkte = []MarktDaten{
		{Code: "DE", VK: "207,49 €", Sales: "40", Gewinn: "26,70 €", Marge: "12,9 %"},
		{Code: "IT", VK: "189,00 €", Sales: "12", Gewinn: "3,20 €", Marge: "1,7 %"},
	}

	text, err := Render(alteVorlage, d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !strings.Contains(text, "Amazon.DE") || !strings.Contains(text, "26,70 €") {
		t.Errorf("Leitmarkt fehlt:\n%s", text)
	}
	// Der zweite Markt steht trotzdem drin: die alte Vorlage kennt .Maerkte
	// nicht, darum hängt Render seine Zeile unten an. Vorher fehlte er im
	// Discord-Post ganz, obwohl er gewählt und gerechnet war.
	if !strings.Contains(text, "Amazon.IT") || !strings.Contains(text, "189,00 €") || !strings.Contains(text, "3,20 €") {
		t.Errorf("alte Vorlage verschweigt den zweiten Markt:\n%s", text)
	}
	// Angehängt, nicht eingeschoben: die Vorlage bleibt bis zu ihrer letzten
	// Zeile so, wie der Nutzer sie gespeichert hat.
	if !strings.HasSuffix(text, "\n💸 Amazon.IT: 189,00 € · 12 Verk. · 🤑 3,20 € / 1,7 %") {
		t.Errorf("die Zeile des zweiten Markts steht nicht am Ende:\n%s", text)
	}
	// Der Leitmarkt wird nicht ein zweites Mal genannt — die alte Vorlage
	// zeigt ihn über die flachen Felder ja schon.
	if strings.Count(text, "Amazon.DE") != 2 { // "VK: … [Amazon.DE]" und "ℹ️ Amazon.DE:"
		t.Errorf("der Leitmarkt erscheint %d-mal statt 2-mal:\n%s", strings.Count(text, "Amazon.DE"), text)
	}
}

// Bei einem einzigen Markt gibt es nichts anzuhängen: er ist der Leitmarkt,
// und den nennt die alte Vorlage bereits. Ein angehängtes Duplikat wäre
// ein Rückschritt für jeden, der nur auf einem Markt verkauft.
func TestAlteVorlageBleibtBeiEinemMarktUnveraendert(t *testing.T) {
	d := referenzDaten()
	text, err := Render(alteVorlage, d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !strings.HasSuffix(text, "[ArbitrageOne Export](https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G)") {
		t.Errorf("bei einem Markt wurde etwas angehängt:\n%s", text)
	}
}

// Eine Vorlage, die .Maerkte selbst verwendet, bestimmt allein, wie die
// Märkte erscheinen — Render darf ihr nichts nachschieben, sonst stünde
// jeder Markt zweimal im Post.
func TestVorlageMitMaerkteBekommtNichtsAngehaengt(t *testing.T) {
	d := beispiel
	vorlage := "🛒 {{.Titel}} {{.Mention}}\n" + MaerkteZeilen + "ENDE"
	text, err := Render(vorlage, d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if n := strings.Count(text, "Amazon.IT"); n != 1 {
		t.Errorf("Amazon.IT erscheint %d-mal statt einmal:\n%s", n, text)
	}
	// Nur die ASIN-Zeile kommt dazu, keine Marktzeilen.
	if !strings.HasSuffix(text, "ENDE\n🔢 ASIN: "+d.ASIN) {
		t.Errorf("an eine Vorlage mit .Maerkte wurde etwas angehängt:\n%s", text)
	}
}

// Die Standardvorlage nennt nur den Leitmarkt; weitere Zielmärkte hängt
// Render unten an.
func TestStandardVorlageHaengtWeitereMaerkteAn(t *testing.T) {
	text, err := Render(StandardVorlage, beispiel)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !strings.HasSuffix(text, "🇪🇺 Pan-EU 19,48 € / 12,6 %") {
		t.Errorf("Amazon.IT fehlt am Ende:\n%s", text)
	}
}

// Die Erwähnung steht am Ende der Titelzeile, auch wenn die Vorlage sie
// nicht nennt — sonst pingte der Post niemanden an.
func TestErwaehnungAmEndeDerTitelzeile(t *testing.T) {
	text, err := Render("🛒 {{.Titel}}\n💰 EK: {{.EK}}", beispiel)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if erste, _, _ := strings.Cut(text, "\n"); erste != "🛒 Beispielartikel @everyone" {
		t.Errorf("Titelzeile = %q", erste)
	}
}

func TestLeereVorlageIstStandard(t *testing.T) {
	if VorlageOderStandard("  ") != StandardVorlage {
		t.Error("leere Vorlage ergibt nicht die Standardvorlage")
	}
	if VorlageOderStandard("x") != "x" {
		t.Error("gespeicherte Vorlage wurde ersetzt")
	}
}

// Ohne Leitmarkt in den flachen Feldern (Zielmarkt leer) hängt Render alle
// Märkte an — lieber einer doppelt als einer verloren.
func TestOhneZielmarktWerdenAlleMaerkteAngehaengt(t *testing.T) {
	d := beispiel
	d.Zielmarkt = ""
	text, err := Render("{{.Titel}}", d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, muss := range []string{"Amazon.DE", "Amazon.IT"} {
		if !strings.Contains(text, muss) {
			t.Errorf("%q fehlt:\n%s", muss, text)
		}
	}
}

// Die 2000-Zeichen-Grenze gilt für den fertigen Text samt angehängter
// Zeilen, nicht nur für die Vorlage allein.
func TestZuLangGiltMitAngehaengtenMaerkten(t *testing.T) {
	d := beispiel
	d.Titel = strings.Repeat("x", MaxLaenge-20)
	if _, err := Render("{{.Titel}}", d); !errors.Is(err, ErrZuLang) {
		t.Errorf("err = %v, will ErrZuLang", err)
	}
}

// Geprüft wird MaerkteZeilen für sich, nicht StandardVorlage: StandardVorlage
// baut inzwischen selbst auf MaerkteZeilen auf (siehe TestRenderStandardVorlage
// für den Referenzfall), ein Fehler in der Zeilenbildung soll aber genau hier
// sichtbar werden, statt in der Vorlage unterzugehen.
func TestMaerkteZeilenZeigenJedenMarktEinmal(t *testing.T) {
	d := beispiel
	d.Maerkte = []MarktDaten{
		{Code: "DE", VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G",
			Sales: "40", Gewinn: "26,70 €", Marge: "12,9 %"},
		{Code: "IT", VK: "189,00 €", VKUrl: "https://www.amazon.it/dp/B01636IZ0G",
			Sales: "12", Gewinn: "3,20 €", Marge: "1,7 %",
			GewinnPanEU: "14,28 €", MargePanEU: "7,6 %"},
	}

	text, err := Render(MaerkteZeilen, d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, muss := range []string{
		"Amazon.DE", "207,49 €", "40", "26,70 €", "12,9 %",
		"Amazon.IT", "189,00 €", "12", "3,20 €", "1,7 %", "14,28 €", "7,6 %",
	} {
		if !strings.Contains(text, muss) {
			t.Errorf("Post enthält %q nicht:\n%s", muss, text)
		}
	}
	// Der Markt ohne Vergleich darf keine leere Pan-EU-Angabe tragen. Ein
	// "Pan-EU  / " im Post wäre eine Zeile ohne Zahl.
	if n := strings.Count(text, "Pan-EU"); n != 1 {
		t.Errorf("Pan-EU steht %dmal im Post, will genau einmal:\n%s", n, text)
	}
}

func TestMaerkteZeilenMitEinemMarktBleibenEinzeilig(t *testing.T) {
	d := beispiel
	d.Maerkte = []MarktDaten{
		{Code: "DE", VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G",
			Sales: "40", Gewinn: "26,70 €", Marge: "12,9 %"},
	}

	text, err := Render(MaerkteZeilen, d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if n := strings.Count(text, "Amazon."); n != 1 {
		t.Errorf("%d Marktzeilen, will genau eine:\n%s", n, text)
	}
}

func TestStandardVorlageNenntJedenMarkt(t *testing.T) {
	d := beispiel
	text, err := Render(StandardVorlage, d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, muss := range []string{"Amazon.DE", "Amazon.IT"} {
		if !strings.Contains(text, muss) {
			t.Errorf("Vorgabe nennt %q nicht:\n%s", muss, text)
		}
	}
}

func TestMaxMengeInStandardVorlage(t *testing.T) {
	d := referenzDaten()
	d.MaxMenge = "3"
	text, err := Render(StandardVorlage, d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !strings.Contains(text, "💰 EK: 130,56 € Brutto inkl. Versand (3er cart)\n📦 Max. 3 Stück pro Bestellung\n💸 VK:") {
		t.Errorf("Cart-Limit fehlt unter dem EK:\n%s", text)
	}

	d.MaxMenge = ""
	text, _ = Render(StandardVorlage, d)
	if strings.Contains(text, "📦") {
		t.Errorf("Cart-Limit-Zeile ohne Wert:\n%s", text)
	}
}

// Eine eigene Vorlage ohne .MaxMenge bekommt die Zeile unter den EK gesetzt.
func TestMaxMengeInEigenerVorlage(t *testing.T) {
	d := referenzDaten()
	d.MaxMenge = "2"
	text, err := Render("🛒 {{.Titel}} {{.Mention}}\n💰 EK: {{.EK}}\n🤑 {{.Gewinn}}", d)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	will := "🛒 Makita HR2630 @everyone\n💰 EK: 130,56 €\n📦 Max. 2 Stück pro Bestellung\n🤑 31,67 €\n🔢 ASIN: B01636IZ0G"
	if text != will {
		t.Errorf("got:\n%s\nwill:\n%s", text, will)
	}
}

func TestPosterStehtUnterDemTitel(t *testing.T) {
	d := beispiel
	d.Poster = "@ludwig"
	text, err := Render(StandardVorlage, d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(text, "🛒 Beispielartikel @everyone\n👤 Deal von @ludwig\n🏬 [amazon.es]") {
		t.Errorf("Poster nicht zwischen Titel und Einkaufslink:\n%s", text)
	}
	d.Poster = ""
	if text, _ := Render(StandardVorlage, d); strings.Contains(text, "👤") {
		t.Errorf("Poster-Zeile ohne Poster")
	}
}

func TestZusatzZeilenUnterDemEK(t *testing.T) {
	d := referenzDaten()
	d.MaxMenge = "3"
	d.Zusatz = "⏳ ETA: 2–3 Wochen\r\n\n📦 MOQ: 50 Stück  "
	text, err := Render(StandardVorlage, d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "📦 Max. 3 Stück pro Bestellung\n⏳ ETA: 2–3 Wochen\n📦 MOQ: 50 Stück\n💸 VK:") {
		t.Errorf("Zusatz nicht unter EK und Cart-Limit:\n%s", text)
	}
}

// Nennt eine eigene Vorlage die ASIN nur im Link, fehlt sie im lesbaren
// Text — die Zeile kommt trotzdem. Steht sie lesbar da, nicht doppelt.
func TestASINZeileUnabhaengigVonDerVorlage(t *testing.T) {
	d := referenzDaten()
	nurImLink := "🛒 {{.Titel}}\n💸 VK: {{.VK}} [Amazon](https://www.amazon.de/dp/{{.ASIN}})\n🤑 {{.Gewinn}}"
	text, err := Render(nurImLink, d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(text, "\n🔢 ASIN: B01636IZ0G") {
		t.Errorf("ASIN-Zeile fehlt:\n%s", text)
	}
	lesbar := "🛒 {{.Titel}} ({{.ASIN}})\n🤑 {{.Gewinn}}"
	text, _ = Render(lesbar, d)
	if strings.Count(text, "B01636IZ0G") != 1 {
		t.Errorf("ASIN doppelt:\n%s", text)
	}
}
