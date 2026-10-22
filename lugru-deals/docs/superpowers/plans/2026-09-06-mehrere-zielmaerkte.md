# Mehrere Zielmarktplätze — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Deal trägt statt eines einzelnen Zielmarkts eine Liste; der Discord-Post nennt je Markt eine Zeile, und für jeden Markt außerhalb des Lagerlands beide Rechnungen — EFN und Pan-EU.

**Architecture:** Der bestehende Funnel trägt die Liste; einen zweiten Codepfad gibt es nicht. Ein Markt ist der Sonderfall „Liste mit einem Element" und rechnet und postet danach exakt wie vorher. Die marktabhängigen Formularfelder bekommen ein Marktsuffix (`vk.IT`), die marktabhängigen Zahlen wandern aus `dealFormular` in ein neues `marktFormular`, und `rechneDeal` läuft über die Liste statt über einen Markt. `internal/calc` bleibt unangetastet.

**Tech Stack:** Go 1.x (kein CGO), `modernc.org/sqlite`, `html/template` + `text/template`, htmx im Frontend, Standardbibliothek-Tests (`testing`).

**Spec:** `docs/superpowers/specs/2026-09-06-mehrere-zielmaerkte-design.md`

## Global Constraints

- Testlauf ist immer `make test` (entspricht `CGO_ENABLED=0 go test ./...`). Nach **jeder** Aufgabe muss der ganze Lauf grün sein, nicht nur die neuen Tests.
- **Ein Deal mit einem Zielmarkt rechnet nach dieser Änderung genau wie vorher.** Das ist die Messlatte. Der Referenzfall aus `deal_test.go` (Makita HR2630, ES→DE, Gewinn 26,70 €, Marge 12,9 %) muss unverändert herauskommen — dieselbe Historienzeile, derselbe Chart, dieselben Zahlen.
- **Die Form des Posts ändert sich dagegen ausdrücklich**, auch bei einem Markt: die neue `StandardVorlage` schreibt je Markt eine Zeile statt drei. Wer eine eigene Vorlage gespeichert hat, behält seine unverändert (siehe Task 2). Ein Test, der den alten Wortlaut der Vorgabe festhält, ist anzupassen — nicht die Konstante.
- Bezeichner, Kommentare, Fehlertexte und Commit-Nachrichten sind **deutsch** — das ist der Stil des ganzen Projekts.
- Kommentare erklären das **Warum**, nie das Was. Wo eine Entscheidung nicht offensichtlich ist, steht der Grund dabei; das ist in diesem Projekt durchgehend so und darf nicht abreißen.
- Beträge sind `money.Cents`, Steuersätze `int` in Promille (190 = 19,0 %), Prozentsätze `float64` (15.0 = 15 %).
- `internal/calc` wird **nicht** angefasst. Jede Rechnung geht durch `calc.Rechne` — eine zweite Formel wäre eine zweite Wahrheit.
- Fehlertexte, die aus einem Keepa-Aufruf stammen können, laufen durch `sicherFehlertext` (der API-Key steckt in der Anfrage-URL).
- Commit-Präfixe wie bisher: `feat(paket,paket)`, `fix(paket)`, `refactor(paket)`, `test(paket)`, `docs`.
- Commit-Nachrichten enden mit:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Dateien

| Datei | Verantwortung |
|---|---|
| `internal/marketplace/marketplace.go` | + `Codes`, `CodesAusListe` — eine Liste Kürzel zu Marktplätzen |
| `internal/post/render.go` | + `MarktDaten`, `Daten.Maerkte`, `MaerkteZeilen`, neue `StandardVorlage` |
| `internal/store/store.go` | + Tabelle `deal_maerkte` im Schema |
| `internal/store/deals.go` | + `DealMarkt`, `Deal.Maerkte`, transaktionales `DealAnlegen`, `DealMaerkte` |
| `internal/web/deal.go` (neu geschnitten) | Handler des Funnels, `dealSeite`, Keepa-Abruf |
| `internal/web/dealformular.go` (neu) | `dealFormular`, `marktFormular`, `formularLesen` |
| `internal/web/dealrechnung.go` (neu) | `dealErgebnis`, `marktErgebnis`, `rechneDeal`, `baueDeal`, Tarif-Helfer |
| `internal/web/rechnung.go` | `rechnungBloecke` je Markt + Ergebnisübersicht |
| `internal/web/templates/deal.html` | Schritt 2 Kästchen, Schritt 3 Tabelle, Schritt 4 Tags je Markt |
| `internal/web/settings.go` + `templates/einstellungen.html` | Standard-Zielmärkte als Liste, `MaerkteZeilen` zum Kopieren |
| `internal/web/history.go` + `templates/historie.html` | Markttabelle je Deal |

---

### Task 1: `marketplace.Codes` — eine Liste Kürzel zu Marktplätzen

**Files:**
- Modify: `internal/marketplace/marketplace.go`
- Test: `internal/marketplace/marketplace_test.go`

**Interfaces:**
- Consumes: `ByCode(Code) (Marketplace, bool)` (vorhanden)
- Produces:
  - `func Codes(roh []string) []Marketplace`
  - `func CodesAusListe(s string) []Marketplace`

- [ ] **Step 1: Write the failing tests**

An `internal/marketplace/marketplace_test.go` anhängen:

```go
func TestCodesLiestBekannteKuerzelInReihenfolge(t *testing.T) {
	got := Codes([]string{"IT", "de", " ES "})

	if len(got) != 3 {
		t.Fatalf("len = %d, will 3: %v", len(got), got)
	}
	for i, will := range []Code{IT, DE, ES} {
		if got[i].Code != will {
			t.Errorf("got[%d].Code = %q, will %q", i, got[i].Code, will)
		}
	}
}

// Die Liste kommt aus einem Formular oder aus einer Einstellung. Beides darf
// keinen Markt erfinden, den es nicht gibt, und keinen doppelt rechnen — ein
// zweimal gesendetes DE ergäbe sonst zwei DE-Spalten mit denselben Zahlen.
func TestCodesUebergehtUnbekannteUndDoppelte(t *testing.T) {
	got := Codes([]string{"DE", "XX", "", "DE", "../etc"})

	if len(got) != 1 || got[0].Code != DE {
		t.Fatalf("Codes = %v, will genau [DE]", got)
	}
}

func TestCodesAusListeTrenntAnKomma(t *testing.T) {
	faelle := []struct {
		roh  string
		will int
	}{
		{"DE,FR,IT,ES", 4},
		{"DE", 1},
		{" DE , IT ", 2},
		{"", 0},
		{"   ", 0},
	}
	for _, f := range faelle {
		if n := len(CodesAusListe(f.roh)); n != f.will {
			t.Errorf("CodesAusListe(%q) hat %d Einträge, will %d", f.roh, n, f.will)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/marketplace/ -run 'TestCodes' -v`
Expected: FAIL — `undefined: Codes`, `undefined: CodesAusListe`

- [ ] **Step 3: Write the implementation**

An `internal/marketplace/marketplace.go` nach `ByCode` anhängen:

```go
// Codes liest eine Liste von Länderkürzeln und liefert die Marktplätze dazu,
// in der Reihenfolge der Eingabe.
//
// Unbekannte Kürzel und Wiederholungen fallen weg. Die Liste kommt aus einem
// Formular oder aus einer Einstellung — beides darf keinen Markt erfinden,
// den es nicht gibt, und keinen doppelt rechnen: ein zweimal gesendetes DE
// ergäbe zwei Spalten mit denselben Zahlen und im Post zwei gleiche Zeilen.
func Codes(roh []string) []Marketplace {
	var out []Marketplace
	gesehen := make(map[Code]bool, len(roh))
	for _, r := range roh {
		m, ok := ByCode(Code(strings.TrimSpace(r)))
		if !ok || gesehen[m.Code] {
			continue
		}
		gesehen[m.Code] = true
		out = append(out, m)
	}
	return out
}

// CodesAusListe liest dieselbe Liste aus einer kommagetrennten Zeichenkette,
// wie sie in der Einstellung deal.standard_zielmarkt steht.
//
// Eine leere Zeichenkette ergibt keine Märkte und nicht einen leeren:
// strings.Split("", ",") liefert [""], und das wäre ein Eintrag, den ByCode
// zwar wegwirft, der aber die Absicht der Funktion verdunkelt.
func CodesAusListe(s string) []Marketplace {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return Codes(strings.Split(s, ","))
}
```

`strings` ist im Paket bereits importiert.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/marketplace/ -v`
Expected: PASS

- [ ] **Step 5: Full suite + commit**

```bash
make test
git add internal/marketplace/marketplace.go internal/marketplace/marketplace_test.go
git commit -m "$(cat <<'MSG'
feat(marketplace): eine Liste Kürzel zu Marktplätzen auflösen

Codes und CodesAusListe lesen, was Formular und Einstellung künftig
tragen: mehrere Zielmärkte statt eines. Unbekannte Kürzel und
Wiederholungen fallen dabei weg — eine Einstellung darf keinen Markt
vorwählen, den es nicht gibt, und ein doppelt gesendetes DE ergäbe zwei
gleiche Zeilen im Post.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `post` — Märkte im Post, alte Vorlagen unberührt

**Files:**
- Modify: `internal/post/render.go`
- Modify: `internal/web/settings.go:135-145` (`beispielDaten`)
- Test: `internal/post/render_test.go`

**Interfaces:**
- Produces:
  - `type MarktDaten struct { Code, VK, VKUrl, Sales, Gewinn, Marge, MargeGerundet, GewinnPanEU, MargePanEU string }`
  - `Daten.Maerkte []MarktDaten`
  - `const MaerkteZeilen string`
  - **`StandardVorlage` bleibt in dieser Aufgabe unverändert.** Sie wird erst in Task 9 getauscht, wo `baueDeal` `.Maerkte` auch füllt. Andersherum stünde zwischen Task 2 und Task 9 eine Vorgabe-Vorlage im Betrieb, die über `{{range .Maerkte}}` auf eine leere Liste läuft — der Post verlöre Verkaufspreis, Verkäufe und Gewinn, und jeder Test, der sie im Posttext sucht, müsste dafür aufgeweicht werden.

- [ ] **Step 1: Write the failing tests**

An `internal/post/render_test.go` anhängen:

```go
// alteVorlage ist die StandardVorlage, wie sie vor der Mehrmarkt-Änderung
// aussah. Genau diese Zeichenkette steht in der Datenbank jedes Nutzers, der
// die Vorlage einmal gespeichert hat — sie muss unverändert rendern.
const alteVorlage = "🛒 {{.Titel}} {{.ASIN}} {{.Mention}}\n" +
	"🏬 [{{.EKHost}}]({{.EKUrl}})\n" +
	"💰 EK: {{.EK}} {{.EKNotiz}}\n" +
	"💸 VK: {{.VK}}  [Amazon.{{.Zielmarkt}}]({{.VKUrl}})\n" +
	"ℹ️ Amazon.{{.Zielmarkt}}: {{.Sales}} Verkäufe\n" +
	"🤑 Gewinn: {{.Gewinn}} / {{.Marge}} Marge\n" +
	"{{if .GewinnPanEU}}🇪🇺 mit Pan-EU: {{.GewinnPanEU}} / {{.MargePanEU}} Marge\n{{end}}" +
	":bar_chart: [ArbitrageOne Export]({{.AOUrl}})"

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
	// Der zweite Markt steht bewusst NICHT drin: die alte Vorlage kennt
	// .Maerkte nicht. Genau dafür gibt es den Hinweis in Schritt 4.
	if strings.Contains(text, "Amazon.IT") {
		t.Errorf("alte Vorlage zeigt plötzlich den zweiten Markt:\n%s", text)
	}
}

// Geprüft wird MaerkteZeilen für sich, nicht StandardVorlage: die Vorgabe
// wird erst in Task 9 getauscht, wenn baueDeal die Märkte auch füllt.
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

// Die Vorgabe bleibt in dieser Aufgabe unverändert und muss es auch bleiben —
// der Test hält das fest, damit der Tausch nicht versehentlich hier passiert.
func TestStandardVorlageBleibtVorerstUnveraendert(t *testing.T) {
	if strings.Contains(StandardVorlage, ".Maerkte") {
		t.Error("StandardVorlage wurde schon hier getauscht — das gehört in die Aufgabe, die .Maerkte auch füllt")
	}
	if err := Pruefe(StandardVorlage); err != nil {
		t.Fatalf("Pruefe(StandardVorlage): %v", err)
	}
}
```

`strings` und `testing` sind in der Datei bereits importiert; falls nicht, ergänzen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/post/ -v`
Expected: FAIL — `d.Maerkte undefined`, `MarktDaten undefined`

- [ ] **Step 3: Write the implementation**

In `internal/post/render.go`: `MarktDaten` und das Feld `Maerkte` ergänzen, `PanEUZeile` durch `MaerkteZeilen` ergänzen (die alte Konstante bleibt — die Einstellungsseite bietet sie weiterhin an), `StandardVorlage` ersetzen und `beispiel` erweitern.

```go
// MarktDaten ist ein Zielmarkt im Post. Wie bei Daten sind alle Felder
// bereits fertig formatierte Zeichenketten — die Vorlage soll nicht rechnen
// müssen, damit ein Tippfehler darin nie eine falsche Zahl erzeugen kann.
//
// GewinnPanEU und MargePanEU sind leer, wo es den Vergleich nicht gibt: beim
// Ziel im Lagerland etwa gibt es keinen zweiten Versandweg. Die Vorlage fragt
// mit {{if}} danach; eine leere Zahl darf nie als 0,00 € im Post landen.
type MarktDaten struct {
	Code  string
	VK    string
	VKUrl string
	Sales string

	Gewinn        string
	Marge         string
	MargeGerundet string

	GewinnPanEU string
	MargePanEU  string
}
```

In `type Daten struct` unter `MargePanEU` anhängen:

```go
	// Maerkte sind alle Zielmärkte des Deals, in der Reihenfolge, in der sie
	// gewählt wurden. Die Felder darüber (Zielmarkt, VK, VKUrl, Sales,
	// Gewinn, Marge, MargeGerundet, GewinnPanEU, MargePanEU) tragen daneben
	// weiterhin die Zahlen des Leitmarkts und bleiben ausdrücklich erhalten:
	// Render läuft mit missingkey=error, und ein entferntes Feld ließe jede
	// gespeicherte Vorlage schlagartig nicht mehr rendern. Die Vorlage ist
	// eine Einstellung — sie bekommt eine Änderung an StandardVorlage nie mit.
	Maerkte []MarktDaten
```

Neue Konstante neben `PanEUZeile`:

```go
// MaerkteZeilen ist der Block, der je Zielmarkt eine Zeile schreibt. Wie
// PanEUZeile wird er einzeln benannt, weil die Einstellungsseite ihn zum
// Kopieren anbietet: eine bereits gespeicherte Vorlage bekommt eine Änderung
// an StandardVorlage nicht mit, und niemand soll sie aus dem Quelltext
// abschreiben müssen.
//
// Das innere {{if}} gehört dazu: ein Markt im Lagerland hat keinen Pan-EU-
// Vergleich, und ohne die Bedingung stünde bei ihm ein "Pan-EU  / " ohne Zahl.
const MaerkteZeilen = "{{range .Maerkte}}💸 [Amazon.{{.Code}}]({{.VKUrl}}): {{.VK}} · " +
	"{{.Sales}} Verk. · 🤑 {{.Gewinn}} / {{.Marge}}" +
	"{{if .GewinnPanEU}} · 🇪🇺 Pan-EU {{.GewinnPanEU}} / {{.MargePanEU}}{{end}}\n{{end}}"

```

`StandardVorlage` bleibt hier **unverändert stehen**. Sie wird in Task 9 getauscht, zusammen mit der Verkabelung, die `.Maerkte` füllt.

`beispiel` bekommt zwei Märkte, damit `Pruefe` die neue Vorlage vollständig durchläuft:

```go
var beispiel = Daten{
	Titel: "Beispielartikel", ASIN: "B000000000", Mention: "@everyone",
	EKHost: "amazon.es", EKUrl: "https://www.amazon.es/dp/B000000000",
	EK: "100,00 €", EKNotiz: "Brutto inkl. Versand",
	VK: "150,00 €", VKUrl: "https://www.amazon.de/dp/B000000000", Zielmarkt: "DE",
	Sales:  "40",
	Gewinn: "20,00 €", Marge: "13,3 %", MargeGerundet: "13 %",
	GewinnPanEU: "31,08 €", MargePanEU: "20,7 %",
	// Zwei Märkte, davon einer mit und einer ohne Vergleich: nur so läuft
	// Pruefe durch beide Zweige des {{if}} in MaerkteZeilen.
	Maerkte: []MarktDaten{
		{Code: "DE", VK: "150,00 €", VKUrl: "https://www.amazon.de/dp/B000000000",
			Sales: "40", Gewinn: "20,00 €", Marge: "13,3 %", MargeGerundet: "13 %"},
		{Code: "IT", VK: "155,00 €", VKUrl: "https://www.amazon.it/dp/B000000000",
			Sales: "12", Gewinn: "8,40 €", Marge: "5,4 %", MargeGerundet: "5 %",
			GewinnPanEU: "19,48 €", MargePanEU: "12,6 %"},
	},
	AOUrl: "https://app.arbitrageone.de/analyze?via=fbaresell",
}
```

- [ ] **Step 4: Beispieldaten der Einstellungsseite mitziehen**

In `internal/web/settings.go`, `beispielDaten()` (Zeile ~135) um dieselben zwei Märkte ergänzen, damit die Live-Vorschau der Vorlage die Marktzeilen zeigt statt sie stumm wegzulassen:

```go
func beispielDaten() post.Daten {
	return post.Daten{
		Titel: "Makita HR2630", ASIN: "B01636IZ0G", Mention: "@everyone",
		EKHost: "amazon.es", EKUrl: "https://www.amazon.es/dp/B01636IZ0G",
		EK: "130,56 €", EKNotiz: "Brutto inkl. Versand (3er cart)",
		VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G", Zielmarkt: "DE",
		Sales:  "40",
		Gewinn: "26,70 €", Marge: "12,9 %", MargeGerundet: "13 %",
		// Zwei Märkte, davon einer mit Pan-EU-Vergleich: die Vorschau soll
		// beide Zweige der Vorlage zeigen, nicht nur den einfachen.
		Maerkte: []post.MarktDaten{
			{Code: "DE", VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G",
				Sales: "40", Gewinn: "26,70 €", Marge: "12,9 %", MargeGerundet: "13 %"},
			{Code: "IT", VK: "189,00 €", VKUrl: "https://www.amazon.it/dp/B01636IZ0G",
				Sales: "12", Gewinn: "3,20 €", Marge: "1,7 %", MargeGerundet: "2 %",
				GewinnPanEU: "14,28 €", MargePanEU: "7,6 %"},
		},
		AOUrl: "https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G",
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/post/ ./internal/web/ ./internal/store/ -v`
Expected: PASS — und zwar **ohne dass ein bestehender Test angefasst werden muss**. Diese Aufgabe fügt nur hinzu; sie ändert an keiner gerenderten Ausgabe etwas. Wird doch ein bestehender Test rot, ist das ein Zeichen, dass zu viel geändert wurde — nicht, dass der Test angepasst gehört.

- [ ] **Step 6: Full suite + commit**

```bash
make test
git add internal/post/render.go internal/post/render_test.go internal/web/settings.go
git commit -m "$(cat <<'MSG'
feat(post,web): je Zielmarkt eine Zeile im Post

Daten trägt jetzt eine Liste von Märkten, und MaerkteZeilen schreibt je
Markt eine Zeile samt Pan-EU-Vergleich, wo es ihn gibt.

Die bisherigen Felder bleiben und tragen den Leitmarkt. Render läuft mit
missingkey=error — ein entferntes Feld ließe jede gespeicherte Vorlage
schlagartig nicht mehr rendern, und die Vorlage ist eine Einstellung, die
eine Änderung am Standard nie mitbekommt. Wie seinerzeit bei PanEUZeile
wird der neue Block darum zum Kopieren angeboten.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: `store` — Tabelle `deal_maerkte`, transaktionales Anlegen

**Files:**
- Modify: `internal/store/store.go` (Konstante `schema`)
- Modify: `internal/store/deals.go`
- Test: `internal/store/deals_test.go`

**Interfaces:**
- Consumes: `money.Cents`
- Produces:
  - `type DealMarkt struct { … }`, `type DealMarktPanEU struct { … }`
  - `Deal.Maerkte []DealMarkt`
  - `func (s *Store) DealAnlegen(d Deal) (int64, error)` — Signatur unverändert, schreibt jetzt auch `d.Maerkte`
  - `func (s *Store) DealMaerkte(dealIDs []int64) (map[int64][]DealMarkt, error)`

- [ ] **Step 1: Write the failing tests**

An `internal/store/deals_test.go` anhängen (die Datei hat bereits einen Helfer, der einen Store in `t.TempDir()` öffnet — den vorhandenen benutzen, keinen zweiten anlegen):

```go
// beispielDeal ist die Deal-Zeile, die die vorhandenen Tests schon anlegen —
// hier nur als benannter Ausgangspunkt für die Marktzeilen.
func beispielDeal() Deal {
	return Deal{
		ASIN: "B01636IZ0G", Titel: "Makita HR2630",
		Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, EKArt: "brutto",
		VKCent: 20749, VKQuelle: "avg90",
		Sales: 40, SalesQuelle: "monthlySold",
		ProvisionProzent: 15, ProvisionQuelle: "keepa",
		FBACent: 864, FBAQuelle: "keepa",
		UStModus: "netto", GewinnCent: 2670, MargeProzent: 12.9,
		ChannelID: 1, ChannelName: "deals",
		NachrichtText: "Text",
	}
}

func TestDealAnlegenSpeichertDieMaerkte(t *testing.T) {
	s := testStore(t)

	d := beispielDeal()
	d.Maerkte = []DealMarkt{
		{Markt: "DE", Leitmarkt: true, VKCent: 20749, VKQuelle: "avg90",
			Sales: 40, SalesQuelle: "monthlySold",
			ProvisionProzent: 15, ProvisionQuelle: "keepa",
			FBACent: 864, FBAQuelle: "keepa",
			GewinnCent: 2670, MargeProzent: 12.9},
		{Markt: "IT", VKCent: 18900, VKQuelle: "avg90",
			Sales: 12, SalesQuelle: "monthlySold",
			ProvisionProzent: 15, ProvisionQuelle: "keepa",
			FBACent: 1806, FBAQuelle: "EFN-Tarif · Standardpaket",
			GewinnCent: 320, MargeProzent: 1.7,
			PanEU: &DealMarktPanEU{FBACent: 577, GewinnCent: 1548, MargeProzent: 8.2}},
	}

	id, err := s.DealAnlegen(d)
	if err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	nach, err := s.DealMaerkte([]int64{id})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	maerkte := nach[id]
	if len(maerkte) != 2 {
		t.Fatalf("%d Märkte gespeichert, will 2: %+v", len(maerkte), maerkte)
	}
	if maerkte[0].Markt != "DE" || !maerkte[0].Leitmarkt {
		t.Errorf("erster Markt = %+v, will DE als Leitmarkt", maerkte[0])
	}
	if maerkte[1].PanEU == nil || maerkte[1].PanEU.GewinnCent != 1548 {
		t.Errorf("Pan-EU von IT = %+v, will Gewinn 1548", maerkte[1].PanEU)
	}
	// Der Markt im Lagerland hat keinen zweiten Versandweg. Eine 0 stünde
	// dort als Aussage da, die niemand gerechnet hat.
	if maerkte[0].PanEU != nil {
		t.Errorf("DE hat einen Pan-EU-Vergleich: %+v", maerkte[0].PanEU)
	}
}

func TestDealAnlegenOhneMaerkteBleibtWieBisher(t *testing.T) {
	s := testStore(t)

	id, err := s.DealAnlegen(beispielDeal())
	if err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}
	gelesen, err := s.Deal(id)
	if err != nil || gelesen.GewinnCent != 2670 {
		t.Fatalf("Deal(%d) = %+v, %v", id, gelesen, err)
	}
	nach, err := s.DealMaerkte([]int64{id})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	if len(nach[id]) != 0 {
		t.Errorf("%d Marktzeilen ohne Märkte", len(nach[id]))
	}
}

// Ein Fehler beim Schreiben der Märkte darf keinen Deal hinterlassen, dessen
// gespeicherter Post vier Märkte nennt und dessen Datenbank einen kennt.
func TestDealAnlegenRolltBeiKaputterMarktzeileZurueck(t *testing.T) {
	s := testStore(t)

	d := beispielDeal()
	d.Maerkte = []DealMarkt{
		{Markt: "DE", Leitmarkt: true, GewinnCent: 2670},
		{Markt: "DE", GewinnCent: 999}, // verletzt PRIMARY KEY (deal_id, markt)
	}

	if _, err := s.DealAnlegen(d); err == nil {
		t.Fatal("DealAnlegen hat den doppelten Markt angenommen")
	}

	n, err := s.DealsAnzahl(DealFilter{})
	if err != nil {
		t.Fatalf("DealsAnzahl: %v", err)
	}
	if n != 0 {
		t.Errorf("%d Deals nach dem Fehlschlag, will 0 — die Transaktion hat nicht zurückgerollt", n)
	}
}
```

Falls in `deals_test.go` noch kein `testStore(t)`-Helfer steht, den vorhandenen aus `store_test.go` verwenden bzw. dort einen anlegen:

```go
func testStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"), filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/store/ -run 'TestDealAnlegen' -v`
Expected: FAIL — `d.Maerkte undefined`, `DealMarkt undefined`, `s.DealMaerkte undefined`

- [ ] **Step 3: Tabelle ins Schema**

In `internal/store/store.go`, in der Konstante `schema` nach dem `deals`-Block und seinen Indizes einfügen:

```sql
-- Die Zielmärkte eines Deals. Die deals-Zeile selbst trägt weiterhin die
-- Zahlen des Leitmarkts — alte Zeilen und jede bestehende Auswertung bleiben
-- damit vergleichbar, und ein Deal mit einem Markt sieht dort aus wie immer.
--
-- Eine Zeile je Markt in deals wäre die andere Möglichkeit gewesen und die
-- falsche: derselbe Nachrichtentext stünde viermal in der Datenbank und
-- derselbe Artikel viermal in der Historienliste, obwohl es ein Post ist.
--
-- Die drei paneu-Spalten sind NULL, wo es den Vergleich nicht gibt — beim
-- Ziel im Lagerland etwa gibt es keinen zweiten Versandweg. Eine 0 stünde
-- dort als Aussage da, die niemand gerechnet hat.
--
-- ON DELETE CASCADE wie bei fba_gebuehren: eine gelöschte Deal-Zeile darf
-- keine Marktzeilen hinterlassen, die auf nichts mehr zeigen.
CREATE TABLE IF NOT EXISTS deal_maerkte (
    deal_id             INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    markt               TEXT    NOT NULL,
    leitmarkt           INTEGER NOT NULL DEFAULT 0,
    vk_cent             INTEGER NOT NULL DEFAULT 0,
    vk_quelle           TEXT    NOT NULL DEFAULT '',
    sales               INTEGER NOT NULL DEFAULT 0,
    sales_quelle        TEXT    NOT NULL DEFAULT '',
    provision_prozent   REAL    NOT NULL DEFAULT 0,
    provision_quelle    TEXT    NOT NULL DEFAULT '',
    fba_cent            INTEGER NOT NULL DEFAULT 0,
    fba_quelle          TEXT    NOT NULL DEFAULT '',
    gewinn_cent         INTEGER NOT NULL DEFAULT 0,
    marge_prozent       REAL    NOT NULL DEFAULT 0,
    paneu_fba_cent      INTEGER,
    paneu_gewinn_cent   INTEGER,
    paneu_marge_prozent REAL,
    PRIMARY KEY (deal_id, markt)
);
```

Kein Eintrag in `ergaenzungen` nötig: das ist eine neue Tabelle, und `CREATE TABLE IF NOT EXISTS` legt sie auch in einer bereits vorhandenen Datei an. `ergaenzungen` gilt nur für neue **Spalten** bestehender Tabellen.

- [ ] **Step 4: Typen und Schreiben**

In `internal/store/deals.go`, oberhalb von `DealFilter`:

```go
// DealMarkt sind die Zahlen eines Deals auf einem seiner Zielmärkte.
//
// Sie stehen neben der deals-Zeile und nicht in ihr: ein Post kann mehrere
// Märkte nennen, hat aber genau einen Text, einen Channel und eine
// Discord-Nachricht.
type DealMarkt struct {
	Markt     string
	Leitmarkt bool

	VKCent   money.Cents
	VKQuelle string

	Sales       int
	SalesQuelle string

	ProvisionProzent float64
	ProvisionQuelle  string

	FBACent   money.Cents
	FBAQuelle string

	GewinnCent   money.Cents
	MargeProzent float64

	// PanEU ist der Vergleich mit Bestand im Zielland. nil, wo es ihn nicht
	// gibt: im Lagerland gibt es keinen zweiten Versandweg, und ohne Maße
	// oder ohne passende Tarifklasse lässt er sich nicht bestimmen. Ein
	// Nullwert stünde sonst als Aussage da, die niemand gerechnet hat —
	// dieselbe Regel wie beim Zeiger in rechneDeal.
	PanEU *DealMarktPanEU
}

// DealMarktPanEU ist derselbe Markt mit der lokalen Versandgebühr.
type DealMarktPanEU struct {
	FBACent      money.Cents
	GewinnCent   money.Cents
	MargeProzent float64
}
```

In `type Deal struct` nach `GepostetAm` anhängen:

```go
	// Maerkte sind die Zielmärkte dieses Posts. Beim Anlegen mitgegeben,
	// beim Lesen NICHT gefüllt: Deal und Deals liefern die Zeile, die
	// Märkte holt DealMaerkte gesammelt für eine ganze Seite. Sie hier
	// nebenbei nachzuladen ergäbe eine Abfrage je Zeile der Historie.
	Maerkte []DealMarkt
```

`DealAnlegen` transaktional machen — die bisherige Funktion **ersetzen**:

```go
// DealAnlegen schreibt den Deal und seine Märkte in einer Transaktion.
//
// Zwei getrennte Schreibzugriffe wären die einfachere Variante und die
// falsche: bricht der zweite ab, bliebe ein Deal stehen, dessen
// gespeicherter Post vier Märkte nennt und dessen Datenbank einen kennt.
func (s *Store) DealAnlegen(d Deal) (int64, error) {
	if d.GepostetAm.IsZero() {
		d.GepostetAm = time.Now()
	}

	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}
	// Rollback nach einem erfolgreichen Commit ist ein No-op (sql.ErrTxDone)
	// — das defer darf darum bedingungslos stehen und deckt jeden frühen
	// Rücksprung darunter ab.
	defer tx.Rollback()

	erg, err := tx.Exec(`
		INSERT INTO deals (
			asin, titel, quellmarkt, quell_url, zielmarkt,
			ek_cent, ek_art, ek_notiz, vk_cent, vk_quelle,
			sales, sales_quelle, provision_prozent, provision_quelle,
			fba_cent, fba_quelle, ust_modus, gewinn_cent, marge_prozent,
			channel_id, channel_name, nachricht_text, chart_datei,
			discord_nachricht_id, gepostet_am, bild_kennung
		) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?)`,
		d.ASIN, d.Titel, d.Quellmarkt, d.QuellURL, d.Zielmarkt,
		int64(d.EKCent), d.EKArt, d.EKNotiz, int64(d.VKCent), d.VKQuelle,
		d.Sales, d.SalesQuelle, d.ProvisionProzent, d.ProvisionQuelle,
		int64(d.FBACent), d.FBAQuelle, d.UStModus, int64(d.GewinnCent), d.MargeProzent,
		d.ChannelID, d.ChannelName, d.NachrichtText, d.ChartDatei,
		d.DiscordNachrichtID, d.GepostetAm.UTC().Format(zeitLayout), d.BildKennung)
	if err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}
	id, err := erg.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}

	for _, m := range d.Maerkte {
		// Die drei Pan-EU-Spalten gehen als NULL hinaus, wo es den Vergleich
		// nicht gibt. sql.NullInt64/NullFloat64 statt 0, weil 0 hier eine
		// gerechnete Zahl wäre und nicht "gibt es nicht".
		var fba, gewinn sql.NullInt64
		var marge sql.NullFloat64
		if m.PanEU != nil {
			fba = sql.NullInt64{Int64: int64(m.PanEU.FBACent), Valid: true}
			gewinn = sql.NullInt64{Int64: int64(m.PanEU.GewinnCent), Valid: true}
			marge = sql.NullFloat64{Float64: m.PanEU.MargeProzent, Valid: true}
		}
		if _, err := tx.Exec(`
			INSERT INTO deal_maerkte (
				deal_id, markt, leitmarkt,
				vk_cent, vk_quelle, sales, sales_quelle,
				provision_prozent, provision_quelle, fba_cent, fba_quelle,
				gewinn_cent, marge_prozent,
				paneu_fba_cent, paneu_gewinn_cent, paneu_marge_prozent
			) VALUES (?,?,?, ?,?,?,?, ?,?,?,?, ?,?, ?,?,?)`,
			id, m.Markt, m.Leitmarkt,
			int64(m.VKCent), m.VKQuelle, m.Sales, m.SalesQuelle,
			m.ProvisionProzent, m.ProvisionQuelle, int64(m.FBACent), m.FBAQuelle,
			int64(m.GewinnCent), m.MargeProzent,
			fba, gewinn, marge); err != nil {
			return 0, fmt.Errorf("store: Markt %s nicht speicherbar: %w", m.Markt, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}
	return id, nil
}
```

`database/sql` ist in `deals.go` noch nicht importiert — `"database/sql"` ergänzen.

- [ ] **Step 5: Lesen**

Ans Ende von `internal/store/deals.go`:

```go
// DealMaerkte liest die Märkte mehrerer Deals in einem Zug.
//
// Eine Abfrage für die ganze Seite statt einer je Zeile: die Historie zeigt
// fünfzig Deals gleichzeitig, und fünfzig Abfragen wären fünfzig Sperren auf
// derselben einen SQLite-Verbindung.
func (s *Store) DealMaerkte(dealIDs []int64) (map[int64][]DealMarkt, error) {
	out := make(map[int64][]DealMarkt, len(dealIDs))
	if len(dealIDs) == 0 {
		return out, nil
	}

	// Bezeichner und Platzhalter lassen sich in SQLite nicht als Liste
	// binden; die Fragezeichen werden darum gezählt und die Werte einzeln
	// übergeben — kein einziger Wert wandert in die Zeichenkette.
	platzhalter := strings.TrimSuffix(strings.Repeat("?,", len(dealIDs)), ",")
	args := make([]any, len(dealIDs))
	for i, id := range dealIDs {
		args[i] = id
	}

	zeilen, err := s.db.Query(`
		SELECT deal_id, markt, leitmarkt,
		       vk_cent, vk_quelle, sales, sales_quelle,
		       provision_prozent, provision_quelle, fba_cent, fba_quelle,
		       gewinn_cent, marge_prozent,
		       paneu_fba_cent, paneu_gewinn_cent, paneu_marge_prozent
		FROM deal_maerkte
		WHERE deal_id IN (`+platzhalter+`)
		ORDER BY deal_id, leitmarkt DESC, rowid`, args...)
	if err != nil {
		return nil, fmt.Errorf("store: Märkte nicht lesbar: %w", err)
	}
	defer zeilen.Close()

	for zeilen.Next() {
		var dealID int64
		var m DealMarkt
		var vk, fba, gewinn int64
		var pFBA, pGewinn sql.NullInt64
		var pMarge sql.NullFloat64

		if err := zeilen.Scan(&dealID, &m.Markt, &m.Leitmarkt,
			&vk, &m.VKQuelle, &m.Sales, &m.SalesQuelle,
			&m.ProvisionProzent, &m.ProvisionQuelle, &fba, &m.FBAQuelle,
			&gewinn, &m.MargeProzent,
			&pFBA, &pGewinn, &pMarge); err != nil {
			return nil, fmt.Errorf("store: Märkte nicht lesbar: %w", err)
		}
		m.VKCent, m.FBACent, m.GewinnCent = money.Cents(vk), money.Cents(fba), money.Cents(gewinn)
		// Nur wenn alle drei dastehen, gab es den Vergleich. Zwei von drei
		// wären eine halbe Zahl, und die ist schlimmer als keine.
		if pFBA.Valid && pGewinn.Valid && pMarge.Valid {
			m.PanEU = &DealMarktPanEU{
				FBACent:      money.Cents(pFBA.Int64),
				GewinnCent:   money.Cents(pGewinn.Int64),
				MargeProzent: pMarge.Float64,
			}
		}
		out[dealID] = append(out[dealID], m)
	}
	return out, zeilen.Err()
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `go test ./internal/store/ -v`
Expected: PASS

- [ ] **Step 7: Full suite + commit**

```bash
make test
git add internal/store/store.go internal/store/deals.go internal/store/deals_test.go
git commit -m "$(cat <<'MSG'
feat(store): Zielmärkte eines Deals neben seiner Zeile

Die deals-Zeile bleibt, wie sie ist, und trägt weiterhin die Zahlen des
Leitmarkts — alte Zeilen und jede bestehende Auswertung bleiben damit
vergleichbar. Die übrigen Märkte stehen daneben in deal_maerkte.

DealAnlegen schreibt beides in einer Transaktion. Zwei getrennte Zugriffe
hinterließen sonst nach einem Abbruch einen Deal, dessen gespeicherter
Post vier Märkte nennt und dessen Datenbank einen kennt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: `internal/web/deal.go` in drei Dateien schneiden

Reines Verschieben. **Keine Zeile Verhalten ändern** — der Zweck ist, dass die folgenden Aufgaben in Dateien arbeiten, die sich am Stück lesen lassen. `deal.go` hat 1529 Zeilen und wüchse sonst deutlich darüber hinaus.

**Files:**
- Modify: `internal/web/deal.go`
- Create: `internal/web/dealformular.go`
- Create: `internal/web/dealrechnung.go`

**Interfaces:**
- Consumes/Produces: nichts Neues. Alle Bezeichner behalten Namen und Signatur; sie wechseln nur die Datei. Go kennt keine Sichtbarkeit je Datei, es ändert sich also nichts an den Aufrufen.

- [ ] **Step 1: Ausgangslage festhalten**

```bash
make test
```
Expected: PASS. Diese Ausgabe ist die Vergleichsgröße für Schritt 4.

- [ ] **Step 2: `dealformular.go` anlegen**

Neue Datei `internal/web/dealformular.go` mit `package web`, den nötigen Importen und diesen aus `deal.go` **ausgeschnittenen** Bezeichnern in dieser Reihenfolge:

- `type dealFormular struct` samt aller Kommentare
- `func formularLesen(r *http.Request) dealFormular`
- `func gepruefteBildKennung(k string) string`
- `func (f *dealFormular) keepaWerteLeeren()`
- `func masszahl(s string) int`

Kopfkommentar der neuen Datei:

```go
// Das Formular des Deal-Funnels: die Rohwerte, wie sie aus dem Browser
// kommen, und ihre Prüfung. Getrennt von den Handlern in deal.go, weil jedes
// Feld hier eine eigene Begründung trägt — was geprüft wird und warum — und
// diese Begründungen zwischen den Handlern untergingen.
package web
```

- [ ] **Step 3: `dealrechnung.go` anlegen**

Neue Datei `internal/web/dealrechnung.go` mit `package web` und diesen aus `deal.go` ausgeschnittenen Bezeichnern:

- `type dealErgebnis struct`
- `var asinMuster`
- `func (srv *Server) rechneDeal(f dealFormular) (dealErgebnis, error)`
- `func (srv *Server) vkTag(f dealFormular, ziel marketplace.Code) (store.AffiliateTag, bool)`
- `func (srv *Server) baueDeal(f dealFormular) (dealErgebnis, error)`
- `func fremdQuelle(roh string) (host, link string, err error)`
- `func quellHostAnzeige(f dealFormular) string`
- `func (srv *Server) ustPermille(c marketplace.Code) int`
- `func prozent(v float64, stellen int) string`
- `func mentionText(channelID int64, srv *Server) string`
- `func (srv *Server) tarifGebuehr(ziel marketplace.Code, m fba.Masse) (money.Cents, string, bool)`
- `func (srv *Server) zuschlagJeEinheit() money.Cents`
- `func (srv *Server) rechnungOderFehler(f dealFormular) ([]rechnungBlock, string)`
- `func (srv *Server) lokalerTarif(ziel marketplace.Code, m fba.Masse) (money.Cents, bool)`
- `func tarifQuelle(weg fba.Weg, klasse string) string`

Kopfkommentar:

```go
// Die Rechnung des Deal-Funnels: aus dem Formular wird ein Ergebnis und aus
// dem Ergebnis der Post-Text. Getrennt von den Handlern in deal.go, weil hier
// die Zahlen entstehen, die am Ende veröffentlicht werden — sie sollen ohne
// HTTP-Umgebung im Blick zu behalten sein.
package web
```

- [ ] **Step 3b: Den dateigekoppelten Test der Verschiebung nachziehen**

`TestDealFormularUndHandlerFelderStimmenUeberein` in `internal/web/deal_test.go` liest die Handler-Quelle über `os.ReadFile("deal.go")` und gleicht per Regex jedes über `r.PostForm` gelesene Feld gegen die `name="…"`-Attribute in `deal.html` ab. Der Dateiname ist dort nur ein Stellvertreter für „der Code des Deal-Funnels" — und `formularLesen`, das praktisch alle diese Aufrufe enthält, zieht gerade um.

Der Test wird darum der Verschiebung nachgezogen, nicht aufgeweicht: er liest künftig **alle** Funnel-Dateien statt einer. Das erweitert seine Zusicherung sogar, statt sie zu schmälern.

```go
	// Gelesen wird die ganze Funnel-Quelle, nicht eine Datei: der Name
	// "deal.go" war hier immer nur ein Stellvertreter für "der Code, der das
	// Formular liest", und der steht seit dem Schnitt in drei Dateien. Ein
	// Muster statt einer Liste, damit eine vierte Datei nicht wieder
	// stillschweigend aus der Prüfung fällt — genau die Lücke, gegen die
	// dieser Test gebaut ist.
	quellen, err := filepath.Glob("deal*.go")
	if err != nil {
		t.Fatalf("Funnel-Quellen nicht auflistbar: %v", err)
	}
	var handlerQuelle []byte
	for _, pfad := range quellen {
		if strings.HasSuffix(pfad, "_test.go") {
			continue
		}
		roh, err := os.ReadFile(pfad)
		if err != nil {
			t.Fatalf("%s nicht lesbar: %v", pfad, err)
		}
		handlerQuelle = append(handlerQuelle, roh...)
	}
	if len(handlerQuelle) == 0 {
		t.Fatal("keine Funnel-Quelldatei gefunden — das Muster misst nichts mehr")
	}
```

Die beiden Fehlertexte im Rumpf nennen weiterhin „deal.go"; sie werden auf „der Funnel-Code" umformuliert, damit sie nicht auf eine Datei zeigen, die nur noch einen Teil trägt.

Das ist die **einzige** erlaubte Teständerung dieser Aufgabe. Jede weitere wäre ein Zeichen, dass mehr als verschoben wurde.

- [ ] **Step 4: Verifizieren, dass sich nichts verhält**

```bash
make test
go vet ./internal/web/
gofmt -l internal/web/
```
Expected: Tests PASS wie in Schritt 1, `go vet` still, `gofmt -l` gibt nichts aus. Ungenutzte Importe in `deal.go` entfernen, fehlende in den neuen Dateien ergänzen.

Zur Gegenprobe, dass wirklich nur verschoben wurde:

```bash
git diff --stat
```
Expected: `deal.go` verliert ungefähr so viele Zeilen, wie die beiden neuen Dateien zusammen gewinnen (die Differenz sind Paketklauseln, Importe und Kopfkommentare).

- [ ] **Step 5: Commit**

```bash
git add internal/web/deal.go internal/web/dealformular.go internal/web/dealrechnung.go internal/web/deal_test.go
git commit -m "$(cat <<'MSG'
refactor(web): deal.go in Handler, Formular und Rechnung schneiden

Reines Verschieben, kein Verhalten geändert. Die Datei hatte 1529 Zeilen
und wächst durch die Mehrmarkt-Änderung deutlich darüber hinaus; der
Schnitt läuft entlang vorhandener Grenzen statt quer durch sie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: `marktFormular` — die marktabhängigen Felder bekommen ein Suffix

Nach dieser Aufgabe trägt das Formular eine Liste, gerechnet wird aber weiterhin nur der Leitmarkt. Das hält die Änderung klein und prüfbar: **der Referenzfall muss unverändert 26,70 € ergeben.**

**Files:**
- Modify: `internal/web/dealformular.go`
- Modify: `internal/web/dealrechnung.go`
- Modify: `internal/web/deal.go`
- Modify: `internal/web/templates/deal.html` (nur die verborgenen Felder und die Feldnamen in Schritt 3)
- Test: `internal/web/deal_test.go`, `internal/web/dealformular_test.go` (neu)

**Interfaces:**
- Consumes: `marketplace.Codes` (Task 1)
- Produces:
  - `type marktFormular struct { Code marketplace.Code; VK, VKQuelle, Sales, SalesQuelle, Provision, ProvisionQuelle, FBA, FBAQuelle string; TagID int64; TagGesetzt bool }`
  - `dealFormular.Leitmarkt marketplace.Code`, `dealFormular.Maerkte []marktFormular`
  - `func (f dealFormular) Markt(c marketplace.Code) (marktFormular, bool)`
  - `func (f dealFormular) Leit() marktFormular`
  - `func leitmarktAufloesen(gewuenscht string, maerkte []marktFormular) marketplace.Code`
  - Formularfelder: `zielmarkt` (mehrfach), `leitmarkt`, `vk.<CODE>`, `vk_quelle.<CODE>`, `sales.<CODE>`, `sales_quelle.<CODE>`, `provision.<CODE>`, `provision_quelle.<CODE>`, `fba.<CODE>`, `fba_quelle.<CODE>`, `tag.<CODE>`

- [ ] **Step 1: Write the failing tests**

Neue Datei `internal/web/dealformular_test.go`:

```go
package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
)

// gelesen baut eine Anfrage aus den Werten und gibt das gelesene Formular
// zurück — formularLesen setzt ein bereits geparstes PostForm voraus.
func gelesen(t *testing.T, v url.Values) dealFormular {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/deal/berechnung", strings.NewReader(v.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if err := r.ParseForm(); err != nil {
		t.Fatalf("ParseForm: %v", err)
	}
	return formularLesen(r)
}

func TestFormularLiestJedenMarktMitSeinenEigenenZahlen(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt":   {"DE", "IT"},
		"leitmarkt":   {"IT"},
		"vk.DE":       {"207,49"},
		"vk_quelle.DE": {"avg90"},
		"vk.IT":       {"189,00"},
		"vk_quelle.IT": {"manuell"},
		"fba.DE":      {"8,64"},
		"fba.IT":      {"18,06"},
	})

	if len(f.Maerkte) != 2 {
		t.Fatalf("%d Märkte gelesen, will 2: %+v", len(f.Maerkte), f.Maerkte)
	}
	if f.Maerkte[0].Code != marketplace.DE || f.Maerkte[0].VK != "207,49" || f.Maerkte[0].FBA != "8,64" {
		t.Errorf("DE = %+v", f.Maerkte[0])
	}
	if f.Maerkte[1].Code != marketplace.IT || f.Maerkte[1].VK != "189,00" || f.Maerkte[1].FBA != "18,06" {
		t.Errorf("IT = %+v", f.Maerkte[1])
	}
	if f.Leitmarkt != marketplace.IT {
		t.Errorf("Leitmarkt = %q, will IT", f.Leitmarkt)
	}
	if f.Leit().VK != "189,00" {
		t.Errorf("Leit().VK = %q, will 189,00", f.Leit().VK)
	}
}

// Wer in Schritt 2 ein Kästchen abhakt, trägt den alten Leitmarkt noch mit.
// Der erste gewählte rückt dann nach — es gibt keinen Zustand ohne
// Leitmarkt, in dem sich weiterrechnen ließe.
func TestLeitmarktRuecktNachWennErNichtMehrGewaehltIst(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt": {"FR", "IT"},
		"leitmarkt": {"DE"},
		"vk.FR":     {"100,00"},
	})

	if f.Leitmarkt != marketplace.FR {
		t.Errorf("Leitmarkt = %q, will FR", f.Leitmarkt)
	}
}

func TestFormularUebergehtUnbekanntenMarkt(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt": {"DE", "XX"},
		"vk.DE":     {"207,49"},
		"vk.XX":     {"999,00"},
	})

	if len(f.Maerkte) != 1 || f.Maerkte[0].Code != marketplace.DE {
		t.Fatalf("Märkte = %+v, will genau [DE]", f.Maerkte)
	}
}

// Ein abgewählter Markt darf seine Werte nicht an den Nachbarn vererben —
// genau der Grund für das Marktsuffix statt einer laufenden Nummer.
func TestFormularVerwechseltDieMaerkteNicht(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt": {"IT"},
		"vk.DE":     {"207,49"},
		"vk.IT":     {"189,00"},
	})

	if len(f.Maerkte) != 1 {
		t.Fatalf("%d Märkte, will 1", len(f.Maerkte))
	}
	if f.Maerkte[0].VK != "189,00" {
		t.Errorf("IT trägt VK %q, will 189,00 — die Werte sind verrutscht", f.Maerkte[0].VK)
	}
}

// Ohne gewählten Markt gibt es nichts zu rechnen. Leit() muss trotzdem einen
// brauchbaren Nullwert liefern, statt in einen Indexfehler zu laufen.
func TestFormularOhneMarktLiefertLeerenLeitmarkt(t *testing.T) {
	f := gelesen(t, url.Values{"asin": {"B01636IZ0G"}})

	if len(f.Maerkte) != 0 {
		t.Fatalf("Märkte = %+v, will leer", f.Maerkte)
	}
	if f.Leitmarkt != "" || f.Leit().VK != "" {
		t.Errorf("Leitmarkt = %q, Leit() = %+v", f.Leitmarkt, f.Leit())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/web/ -run 'TestFormular|TestLeitmarkt' -v`
Expected: FAIL — `f.Maerkte undefined`, `f.Leit undefined`

- [ ] **Step 3: `marktFormular` und das neue `formularLesen`**

In `internal/web/dealformular.go`: aus `dealFormular` die Felder `Zielmarkt`, `VK`, `VKQuelle`, `Sales`, `SalesQuelle`, `Provision`, `ProvisionQuelle`, `FBA`, `FBAQuelle`, `TagID`, `TagGesetzt` **entfernen** und statt dessen ergänzen:

```go
	// Leitmarkt ist der Markt, an dem alles hängt, was es nur einmal geben
	// kann: Artikelname, Produktbild, Chart, der ArbitrageOne-Link und die
	// Zahlen der Historienzeile. Leer, solange kein Markt gewählt ist.
	Leitmarkt marketplace.Code

	// Maerkte sind die gewählten Zielmärkte in Auswahlreihenfolge. Ein Markt
	// ist der Sonderfall "Liste mit einem Element" — es gibt keinen zweiten
	// Codepfad für ihn.
	Maerkte []marktFormular
```

Darunter der neue Typ:

```go
// marktFormular sind die Rohwerte eines einzelnen Zielmarkts, alle als Text.
//
// Diese fünf Größen gelten je Markt und nicht je Deal: Keepa liefert
// Verkaufspreis, Verkaufszahl, Provision und FBA-Gebühr immer für genau eine
// Domain, und ein Affiliate-Tag verdient nur auf dem Markt, für den er
// ausgestellt wurde.
type marktFormular struct {
	Code marketplace.Code

	VK       string
	VKQuelle string

	Sales       string
	SalesQuelle string

	Provision       string
	ProvisionQuelle string

	FBA       string
	FBAQuelle string

	// Kandidaten und SalesHinweis sind Anzeige, keine Eingabe: die
	// Vorschlagsliste für den Verkaufspreis und die Auskunft, woher die
	// Verkaufszahl stammt. Sie stehen hier statt in einer zweiten Liste
	// neben dieser, weil sie zu genau diesem Markt gehören — zwei parallele
	// Listen müssten von Hand synchron gehalten werden, und still
	// auseinanderlaufende Sichten auf dieselben Zahlen sind genau der
	// Fehler, gegen den schon das Marktsuffix gebaut ist.
	Kandidaten   []kandidat
	SalesHinweis string

	// TagID ist der gewählte Affiliate-Tag, 0 für "kein Tag". TagGesetzt
	// sagt, ob das Feld überhaupt mitgeschickt wurde — die beiden Zustände
	// sind nicht dasselbe: eine Anfrage aus Schritt 3 kennt das Auswahlfeld
	// noch gar nicht und soll den Standard des Marktes bekommen, während
	// eine 0 aus Schritt 4 die ausdrückliche Wahl "kein Tag" ist. Ohne die
	// Unterscheidung könnte ein als Standard markierter Tag nie greifen.
	TagID      int64
	TagGesetzt bool
}

// Markt sucht den Eintrag eines Marktes.
func (f dealFormular) Markt(c marketplace.Code) (marktFormular, bool) {
	for _, m := range f.Maerkte {
		if m.Code == c {
			return m, true
		}
	}
	return marktFormular{}, false
}

// Leit liefert den Eintrag des Leitmarkts.
//
// Ohne gewählten Markt kommt der Nullwert zurück und kein Indexfehler: die
// Aufrufer prüfen den Deal ohnehin, und ein Absturz mitten in Schritt 3 wäre
// die schlechteste Art, "bitte einen Markt wählen" zu sagen.
func (f dealFormular) Leit() marktFormular {
	m, _ := f.Markt(f.Leitmarkt)
	return m
}

// leitmarktAufloesen bestimmt den Leitmarkt aus dem Formularfeld.
//
// Steht dort ein Markt, der gar nicht (mehr) gewählt ist, rückt der erste
// gewählte nach. Das ist kein Angriff, sondern Alltag: wer in Schritt 2 ein
// Kästchen abhakt, trägt den alten Leitmarkt in einem verborgenen Feld noch
// mit — dieselbe Überlegung wie bei vkTag und einer stehengebliebenen Tag-ID.
func leitmarktAufloesen(gewuenscht string, maerkte []marktFormular) marketplace.Code {
	if len(maerkte) == 0 {
		return ""
	}
	c := marketplace.Code(strings.ToUpper(strings.TrimSpace(gewuenscht)))
	for _, m := range maerkte {
		if m.Code == c {
			return c
		}
	}
	return maerkte[0].Code
}
```

In `formularLesen` den Block, der `channel_id`, `tag_id`, `ust_modus` und `ek_art` liest, um das Marktlesen ergänzen und die entfernten Felder aus dem Rückgabewert streichen:

```go
	// Die marktabhängigen Felder tragen ihr Marktkürzel als Suffix
	// ("vk.IT"). Eine laufende Nummer wäre die naheliegendere Wahl und die
	// falsche: wer einen Markt abwählt, verschöbe damit jede folgende
	// Nummer, und die Werte erbten still den Nachbarn. Ein Marktkürzel
	// verschiebt sich nicht.
	//
	// Gelesen wird ausschließlich, was zu einem gewählten und von
	// marketplace.Codes bestätigten Markt gehört — ein mitgeschicktes
	// "vk.XX" fällt damit weg, statt einen fünften Markt zu erfinden.
	gewaehlt := marketplace.Codes(r.PostForm["zielmarkt"])
	maerkte := make([]marktFormular, 0, len(gewaehlt))
	for _, m := range gewaehlt {
		s := string(m.Code)
		mf := marktFormular{
			Code:            m.Code,
			VK:              r.PostForm.Get("vk." + s),
			VKQuelle:        r.PostForm.Get("vk_quelle." + s),
			Sales:           r.PostForm.Get("sales." + s),
			SalesQuelle:     r.PostForm.Get("sales_quelle." + s),
			Provision:       r.PostForm.Get("provision." + s),
			ProvisionQuelle: r.PostForm.Get("provision_quelle." + s),
			FBA:             r.PostForm.Get("fba." + s),
			FBAQuelle:       r.PostForm.Get("fba_quelle." + s),
			TagGesetzt:      r.PostForm.Has("tag." + s),
		}
		if mf.TagGesetzt {
			mf.TagID, _ = strconv.ParseInt(r.PostForm.Get("tag."+s), 10, 64)
		}
		maerkte = append(maerkte, mf)
	}
```

und im zurückgegebenen `dealFormular`:

```go
		Maerkte:   maerkte,
		Leitmarkt: leitmarktAufloesen(r.PostForm.Get("leitmarkt"), maerkte),
```

Der bisherige `tagGesetzt`/`tagID`-Block am Kopf von `formularLesen` entfällt (er las das alte, marktlose `tag_id`).

`keepaWerteLeeren` räumt jetzt je Markt:

```go
// keepaWerteLeeren räumt alles weg, was an einem bestimmten Artikel auf einem
// bestimmten Zielmarktplatz hängt.
//
// Der Weg Schritt 3 → 2 → andere Zielmarktplätze trug diese Werte sonst
// einfach weiter: liefert Keepa für den neuen Markt keinen Ø-90-Tage-Preis,
// setzte die Kandidatenschleife keinen neuen — und der Nachrücker griff
// nicht, weil ja noch der alte Preis im Feld stand. Gerechnet wurde dann mit
// dem Verkaufspreis eines anderen Marktes.
//
// Erhalten bleiben sie allein auf dem unveränderten Rückweg aus Schritt 4,
// wo derselbe Artikel und dieselben Märkte gelten und die Zahlen bereits von
// Hand geprüft sind.
func (f *dealFormular) keepaWerteLeeren() {
	f.Titel = ""
	// Auch das Bild hängt am Artikel: bliebe die Kennung stehen, zeigte die
	// Historie später das Produktfoto des vorher eingegebenen Artikels.
	f.BildKennung = ""
	// Die Maße hängen genauso am Artikel wie das Bild. Bleiben sie stehen,
	// während der Keepa-Abruf für die neue ASIN scheitert, rechnet der
	// Pan-EU-Vergleich mit der Größenklasse des vorherigen Produkts weiter —
	// eine Zahl im Post, die zu diesem Artikel nie gemessen wurde (R5).
	f.Masse = fba.Masse{}

	for i := range f.Maerkte {
		f.Maerkte[i].VK, f.Maerkte[i].VKQuelle = "", ""
		f.Maerkte[i].Sales, f.Maerkte[i].SalesQuelle = "", ""
		f.Maerkte[i].Provision, f.Maerkte[i].ProvisionQuelle = "", ""
		f.Maerkte[i].FBA, f.Maerkte[i].FBAQuelle = "", ""
	}
}
```

- [ ] **Step 4: Aufrufer auf `Leit()` umstellen**

Alle Stellen, die die entfernten Felder lasen, greifen vorerst auf den Leitmarkt zu — die Schleife über alle Märkte kommt in Task 6. Zu ändern:

- `dealrechnung.go`, `rechneDeal`: `marketplace.ByCode(marketplace.Code(f.Zielmarkt))` → `marketplace.ByCode(f.Leitmarkt)`; `f.EK` bleibt; `f.VK`/`f.FBA`/`f.Provision` → `f.Leit().VK` usw. Fehlertext bei unbekanntem Ziel: `"Bitte einen Zielmarktplatz wählen."`
- `dealrechnung.go`, `baueDeal`: `f.Sales` → `f.Leit().Sales`
- `dealrechnung.go`, `vkTag(f dealFormular, ziel marketplace.Code)`: liest `f.TagGesetzt`/`f.TagID` → `f.Markt(ziel)` und dessen Felder; existiert der Markt nicht, gilt der Standard-Tag.
- `deal.go`, `uebernehmeKeepa`: schreibt in `d.Formular.VK` usw. → in den Eintrag des Leitmarkts. Dazu ein Helfer in `dealformular.go`:

```go
// marktZeiger liefert den Eintrag eines Marktes zum Schreiben. nil, wenn der
// Markt nicht gewählt ist — die Aufrufer füllen dann nichts, statt einen
// Eintrag zu erfinden, den niemand angehakt hat.
//
// Markt() daneben liefert eine Kopie und ist für alles gedacht, was nur
// liest; dieser Zeiger ist der einzige Weg, in einen Markt zu schreiben.
func (f *dealFormular) marktZeiger(c marketplace.Code) *marktFormular {
	for i := range f.Maerkte {
		if f.Maerkte[i].Code == c {
			return &f.Maerkte[i]
		}
	}
	return nil
}
```

- `deal.go`, `zeigeDeal`: `d.Formular.Zielmarkt = srv.store.Einstellung(...)` → vorerst
  ```go
  for _, m := range marketplace.CodesAusListe(srv.store.Einstellung(store.SchluesselZielmarkt)) {
      d.Formular.Maerkte = append(d.Formular.Maerkte, marktFormular{Code: m.Code})
  }
  d.Formular.Leitmarkt = leitmarktAufloesen("", d.Formular.Maerkte)
  ```
- `deal.go`, `ladeDeal`, `fuelleTagAuswahl`, `sendeDeal`: `f.Zielmarkt` → `f.Leitmarkt`, `erg.Ziel` bleibt zunächst wie es ist.

- [ ] **Step 5: Vorlage auf die neuen Feldnamen**

In `internal/web/templates/deal.html`:

`verborgen-einkauf` verliert das `zielmarkt`-Feld; dafür zwei neue Fragmente:

```
{{define "verborgen-maerkte"}}
  <input type="hidden" name="leitmarkt" value="{{.Formular.Leitmarkt}}">
  {{range .Formular.Maerkte}}<input type="hidden" name="zielmarkt" value="{{.Code}}">
  {{end}}
{{end}}

{{define "verborgen-marktzahlen"}}
  {{range .Formular.Maerkte}}
  <input type="hidden" name="vk.{{.Code}}" value="{{.VK}}">
  <input type="hidden" name="vk_quelle.{{.Code}}" value="{{.VKQuelle}}">
  <input type="hidden" name="sales.{{.Code}}" value="{{.Sales}}">
  <input type="hidden" name="sales_quelle.{{.Code}}" value="{{.SalesQuelle}}">
  <input type="hidden" name="provision.{{.Code}}" value="{{.Provision}}">
  <input type="hidden" name="provision_quelle.{{.Code}}" value="{{.ProvisionQuelle}}">
  <input type="hidden" name="fba.{{.Code}}" value="{{.FBA}}">
  <input type="hidden" name="fba_quelle.{{.Code}}" value="{{.FBAQuelle}}">
  {{end}}
{{end}}
```

`verborgen-zahlen` behält Maße, Bild und Titel und bindet `verborgen-marktzahlen` ein statt der acht flachen Felder. Jeder Schritt, der bisher `verborgen-einkauf` einband, bindet zusätzlich `verborgen-maerkte` ein (Schritte 2, 3 und 4).

In Schritt 3 bleibt vorerst **eine** Spalte, die des Leitmarkts — die Tabelle kommt in Task 7. Die sichtbaren Felder heißen jetzt `vk.{{$leit.Code}}` usw.; dazu am Kopf des Fragments `{{$leit := .Formular.Leit}}`. Die verborgenen `*_quelle`-Felder desselben Marktes dürfen dabei **nicht** doppelt stehen — zwei Elemente gleichen Namens im selben Formular senden zwei Werte, und gelesen würde nur der erste (der Kommentar dazu steht bereits in der Vorlage).

- [ ] **Step 6: Testhelfer und Teststellen umbenennen**

In `internal/web/deal_test.go` (rund 50 Stellen, alle in dieser Datei):

`referenzFormular` und `schritt2Werte` auf die neuen Namen umstellen:

```go
func referenzFormular(channelID int64) url.Values {
	return url.Values{
		"einkaufslink":        {"https://www.amazon.es/dp/B01636IZ0G"},
		"asin":                {"B01636IZ0G"},
		"quellmarkt":          {"ES"},
		"quell_url":           {""},
		"zielmarkt":           {"DE"},
		"leitmarkt":           {"DE"},
		"titel":               {"Makita HR2630"},
		"vk.DE":               {"207,49"},
		"vk_quelle.DE":        {"avg90"},
		"ek":                  {"130,56"},
		"ek_art":              {"brutto"},
		"ek_notiz":            {"Brutto inkl. Versand (3er cart)"},
		"sales.DE":            {"40"},
		"sales_quelle.DE":     {"monthlySold"},
		"provision.DE":        {"15"},
		"provision_quelle.DE": {"keepa"},
		"fba.DE":              {"8,64"},
		"fba_quelle.DE":       {"keepa"},
		"ust_modus":           {"netto"},
		"channel_id":          {itoa(channelID)},
	}
}

func schritt2Werte() url.Values {
	return url.Values{
		"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"},
		"asin":         {"B01636IZ0G"},
		"quellmarkt":   {"ES"},
		"quell_url":    {""},
		"zielmarkt":    {"DE"},
		"leitmarkt":    {"DE"},
		"ek":           {"130,56"},
		"ek_art":       {"brutto"},
	}
}
```

Neuer Helfer neben `mitFeld`, damit die Aufrufstellen lesbar bleiben:

```go
// mitMarktFeld setzt ein marktabhängiges Feld ("vk" auf "DE" wird "vk.DE").
// Eigener Helfer statt mitFeld mit zusammengebautem Namen: welcher Markt
// gemeint ist, soll an der Aufrufstelle stehen und nicht in einer
// Zeichenkettenverkettung untergehen.
func mitMarktFeld(v url.Values, feld, markt, wert string) url.Values {
	return mitFeld(v, feld+"."+markt, wert)
}
```

Dann jede Aufrufstelle umstellen — mechanisch, mit Prüfung je Treffer:

```bash
grep -n 'mitFeld([^,]*, "\(vk\|fba\|provision\|sales\|vk_quelle\|sales_quelle\|provision_quelle\|fba_quelle\|tag_id\)"' internal/web/deal_test.go
```

`mitFeld(v, "vk", "0")` wird zu `mitMarktFeld(v, "vk", "DE", "0")`; `"tag_id"` wird zu `mitMarktFeld(v, "tag", "DE", …)`. Stellen, an denen der Test ausdrücklich einen **anderen** Zielmarkt setzt (`mitFeld(v, "zielmarkt", "IT")`), brauchen zusätzlich `leitmarkt` und die passenden Marktfelder — dort im Zweifel den Test lesen statt blind ersetzen.

- [ ] **Step 6b: Den Feldabgleich-Test auf Marktsuffixe bringen**

`TestDealFormularUndHandlerFelderStimmenUeberein` gleicht jedes über `r.PostForm` gelesene Feld gegen die `name="…"`-Attribute in `deal.html` ab. Beide Seiten werden in dieser Aufgabe dynamisch: der Handler liest `r.PostForm.Get("vk." + s)`, die Vorlage rendert `name="vk.{{$c}}"`. Die bisherigen Muster erfassen weder das eine noch das andere — der Test misst danach an dieser Stelle **nichts mehr**, und genau das ist die Fehlerklasse, gegen die er gebaut ist (`neu_laden` vor I4, `ohne_chart` vor I3).

Er wird darum auf Feldfamilien umgestellt statt aufgeweicht: ein gelesenes `"vk." + s` und ein gerendertes `name="vk.{{$c}}"` zählen beide als die Familie `vk.`, und die beiden Mengen werden wie bisher in beide Richtungen verglichen. Die festen Feldnamen (`asin`, `ek`, `zielmarkt`, `leitmarkt`, …) bleiben unverändert Teil derselben Prüfung.

Konkret heißt das: neben `gelesenesFeldMuster` ein zweites Muster für den Präfix-Fall (`r.PostForm.Get("<name>." + …)`, ebenso `.Has`), und auf der Vorlagenseite ein Muster, das `name="<name>.{{…}}"` auf `<name>.` normalisiert. Beide Seiten landen in denselben beiden Mengen wie die festen Namen.

**Der Test muss nach dieser Aufgabe noch scharf sein.** Prüfe das, indem du ihn kurz von Hand brichst: entferne testweise ein `name="fba.{{$c}}"` aus der Vorlage und überzeuge dich, dass der Test rot wird; mach es rückgängig. Berichte beides. Lässt sich die Schärfe nicht erhalten, STOPP und frag — eine Prüfung, die nichts mehr misst, ist schlechter als keine, weil sie Sicherheit vortäuscht.

- [ ] **Step 7: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS, insbesondere `TestVorschauRechnetReferenzfall` mit unverändert `26,70` und `12,9`.

- [ ] **Step 8: Full suite + commit**

```bash
make test
git add internal/web/
git commit -m "$(cat <<'MSG'
feat(web): die marktabhängigen Felder gehören einem Markt

VK, Verkäufe, Provision, FBA-Gebühr und der Affiliate-Tag wandern aus
dealFormular in ein marktFormular je Zielmarkt; das Formular trägt eine
Liste und einen Leitmarkt.

Die Felder heißen im HTML mit Marktsuffix ("vk.IT"). Eine laufende Nummer
wäre naheliegender und falsch: wer einen Markt abwählt, verschöbe jede
folgende Nummer, und die Werte erbten still den Nachbarn.

Gerechnet wird weiterhin nur der Leitmarkt — der Referenzfall ergibt
unverändert 26,70 € bei 12,9 % Marge. Die Schleife folgt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: `rechneDeal` rechnet jeden Markt

**Files:**
- Modify: `internal/web/dealrechnung.go`
- Modify: `internal/web/rechnung.go`
- Modify: `internal/web/deal.go` (`dealSeite`, `berechneDeal`, `uebernehmeGeprueft`)
- Modify: `internal/web/dealformular.go` (Feld `OffenerMarkt`)
- Modify: `internal/web/templates/deal.html` (nur das Fragment `rechnung`)
- Test: `internal/web/dealrechnung_test.go` (neu)

**Interfaces:**
- Consumes: `dealFormular.Maerkte`, `dealFormular.Leit()` (Task 5); `srv.lokalerTarif`, `calc.Rechne`
- Produces:
  - `type marktErgebnis struct { Ziel marketplace.Marketplace; Leitmarkt bool; Ergebnis calc.Ergebnis; VKBrutto, FBA money.Cents; Sales int; Provision float64; ZielUStPermille int; PanEU *calc.Ergebnis; PanEUGebuehr money.Cents; ChartURL string }`
  - `dealErgebnis.Maerkte []marktErgebnis`, `func (e dealErgebnis) Leit() marktErgebnis`
  - `func rechnungBloecke(e dealErgebnis, m marktErgebnis) []rechnungBlock`
  - `type marktErgebnisZeile struct { Code string; Leitmarkt, Offen bool; FBA, Gewinn, Marge, FBAPanEU, GewinnPanEU, MargePanEU string }`
  - `dealSeite.Ergebnisse []marktErgebnisZeile`, `dealSeite.OffenerMarkt string`
  - `func (srv *Server) rechnungFuellen(d *dealSeite)`
  - Formularfeld `offen`

- [ ] **Step 1: Write the failing tests**

Neue Datei `internal/web/dealrechnung_test.go`:

```go
package web

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// zweiMaerkte ist der Referenzfall, erweitert um Italien: dieselbe Ware,
// derselbe Einkauf, ein zweiter Absatzmarkt.
func zweiMaerkte() url.Values {
	v := referenzFormular(0)
	v["zielmarkt"] = []string{"DE", "IT"}
	v.Set("leitmarkt", "DE")
	v.Set("vk.IT", "189,00")
	v.Set("vk_quelle.IT", "avg90")
	v.Set("sales.IT", "12")
	v.Set("sales_quelle.IT", "monthlySold")
	v.Set("provision.IT", "15")
	v.Set("provision_quelle.IT", "keepa")
	v.Set("fba.IT", "18,06")
	v.Set("fba_quelle.IT", "EFN-Tarif · Standardpaket")
	return v
}

func TestBerechnungZeigtJedenMarktEinzeln(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", zweiMaerkte().Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	koerper := w.Body.String()
	// Der Leitmarkt rechnet unverändert wie im Referenzfall.
	for _, muss := range []string{"DE", "IT", "26,70", "12,9"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Übersicht enthält %q nicht:\n%s", muss, koerper)
		}
	}

	// Und IT rechnet mit SEINEN Zahlen, nicht mit denen von DE. Ohne diese
	// Zusicherung ginge eine Regression durch, die jedem Markt die Zahlen des
	// Leitmarkts gäbe — die Übersicht zeigte dann vier Spalten, und alle
	// stimmten überein. Genau das ist die Überschrift dieser Aufgabe.
	//
	// 189,00 € VK, 22 % IT-USt, 15 % Provision, 18,06 € EFN-Gebühr gegen
	// 130,56 € Einkauf zu 21 % ES-Vorsteuer: 0,61 € bei 0,3 % Marge. Die Zahl
	// steht hier ausgeschrieben und nicht nachgerechnet — eine im Test
	// nachgebaute Formel wäre eine zweite Wahrheit neben calc.Rechne.
	if !strings.Contains(koerper, "0,61") {
		t.Errorf("IT trägt nicht seinen eigenen Gewinn (0,61 €):\n%s", koerper)
	}
}

// Ein Markt mit unlesbarer Zahl nennt sich beim Namen. Ohne das stünde in
// Schritt 3 "Verkaufspreis: kein gültiger Betrag" über vier Spalten, ohne zu
// sagen, welche gemeint ist.
func TestBerechnungNenntDenMarktImFehler(t *testing.T) {
	srv, _ := testServer(t)

	v := zweiMaerkte()
	v.Set("vk.IT", "keine Zahl")

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", v.Encode())
	koerper := w.Body.String()
	if !strings.Contains(koerper, "IT") || !strings.Contains(koerper, "Verkaufspreis") {
		t.Errorf("Fehler nennt Markt und Größe nicht:\n%s", koerper)
	}
}

func TestBerechnungOhneMarktBittetUmEinenMarkt(t *testing.T) {
	srv, _ := testServer(t)

	v := referenzFormular(0)
	delete(v, "zielmarkt")
	delete(v, "leitmarkt")

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", v.Encode())
	if !strings.Contains(w.Body.String(), "Zielmarktplatz") {
		t.Errorf("keine Rückfrage nach dem Zielmarktplatz:\n%s", w.Body.String())
	}
}

// Der ausführliche Kassenbon gehört dem offenen Markt. Ohne das Feld "offen"
// wäre immer der Leitmarkt gemeint, und die anderen Spalten ließen sich nie
// nachrechnen.
func TestBerechnungOeffnetDenGewaehltenMarkt(t *testing.T) {
	srv, _ := testServer(t)

	v := zweiMaerkte()
	v.Set("offen", "IT")

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", v.Encode())
	koerper := w.Body.String()
	if !strings.Contains(koerper, "Verkauf über Amazon.IT") {
		t.Errorf("Kassenbon zeigt nicht Amazon.IT:\n%s", koerper)
	}
	if strings.Contains(koerper, "Verkauf über Amazon.DE") {
		t.Errorf("Kassenbon zeigt zwei Märkte gleichzeitig:\n%s", koerper)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/web/ -run 'TestBerechnung' -v`
Expected: FAIL — bisher rechnet nur der Leitmarkt, IT taucht in der Ausgabe nicht auf.

- [ ] **Step 3: `marktErgebnis` und die Schleife**

In `internal/web/dealrechnung.go`: `dealErgebnis` umbauen — die marktabhängigen Felder (`Ziel`, `VKBrutto`, `FBA`, `Sales`, `Provision`, `ZielUStPermille`, `PanEU`, `PanEUGebuehr`, `ChartURL`, `Ergebnis`) wandern in den neuen Typ:

```go
// marktErgebnis ist ein Zielmarkt eines Deals, durchgerechnet.
type marktErgebnis struct {
	Ziel      marketplace.Marketplace
	Leitmarkt bool

	Ergebnis calc.Ergebnis

	VKBrutto  money.Cents
	FBA       money.Cents
	Sales     int
	Provision float64

	ZielUStPermille int

	// PanEU ist derselbe Markt noch einmal, gerechnet mit der lokalen
	// Versandgebühr statt der des Versandnetzwerks — also so, wie er für
	// jemanden ausfiele, der dort Bestand liegen hat.
	//
	// nil, wenn er sich nicht bestimmen lässt: bei einem Ziel im Lagerland
	// (dort gibt es keinen zweiten Weg), ohne Maße von Keepa, ohne passende
	// Klasse oder wenn der Staffel einer der beiden Tarife fehlt. Eine halbe
	// Vergleichszahl wäre schlimmer als keine.
	PanEU        *calc.Ergebnis
	PanEUGebuehr money.Cents

	ChartURL string
}

// dealErgebnis ist ein durchgerechneter Deal: die Einkaufsseite einmal, die
// Verkaufsseite je Zielmarkt.
//
// Es trägt neben dem Ergebnis auch die Größen mit, aus denen es entstanden
// ist — die Aufschlüsselung in Schritt 3 zeigt sie Zeile für Zeile, und ohne
// sie ließe sie sich nicht ohne zweite, womöglich abweichende Rechnung bauen.
// Bei den marktabhängigen Größen steht dieser Grund jetzt an marktErgebnis;
// die Aussage gilt unverändert, sie ist nur mitgewandert.
type dealErgebnis struct {
	Text string

	Quell     marketplace.Marketplace
	QuellHost string // Fremdshop-Host oder "amazon.es"
	QuellURL  string // Einkaufslink, immer gefüllt
	Extern    bool

	Channel store.Channel

	EKArt            calc.EKArt
	UStModus         calc.USt
	QuellUStPermille int
	MargenBasis      calc.Basis

	// Maerkte sind die Zielmärkte in Auswahlreihenfolge, mindestens einer:
	// rechneDeal bricht vorher ab, wenn keiner gewählt ist.
	Maerkte []marktErgebnis
}

// Markt sucht einen Zielmarkt im Ergebnis.
func (e dealErgebnis) Markt(c marketplace.Code) (marktErgebnis, bool) {
	for _, m := range e.Maerkte {
		if m.Ziel.Code == c {
			return m, true
		}
	}
	return marktErgebnis{}, false
}

// Leit liefert den Leitmarkt. Ohne Märkte der Nullwert — dieselbe Regel wie
// bei dealFormular.Leit, und aus demselben Grund.
func (e dealErgebnis) Leit() marktErgebnis {
	for _, m := range e.Maerkte {
		if m.Leitmarkt {
			return m
		}
	}
	if len(e.Maerkte) > 0 {
		return e.Maerkte[0]
	}
	return marktErgebnis{}
}
```

`rechneDeal` umbauen: der gemeinsame Teil bleibt, die marktabhängige Rechnung wandert in eine Schleife:

```go
func (srv *Server) rechneDeal(f dealFormular) (dealErgebnis, error) {
	if !asinMuster.MatchString(f.ASIN) {
		return dealErgebnis{}, fmt.Errorf("ungültige ASIN %q", f.ASIN)
	}

	quell, ok := marketplace.ByCode(marketplace.Code(f.Quellmarkt))
	if !ok {
		return dealErgebnis{}, fmt.Errorf("unbekanntes Einkaufsland %q", f.Quellmarkt)
	}
	if len(f.Maerkte) == 0 {
		return dealErgebnis{}, errors.New("Bitte mindestens einen Zielmarktplatz wählen")
	}

	ek, err := money.Parse(f.EK)
	if err != nil {
		return dealErgebnis{}, fmt.Errorf("Einkaufspreis: %w", err)
	}

	ustModus := calc.Netto
	if f.UStModus == "brutto" {
		ustModus = calc.Brutto
	}
	ekArt := calc.EKAlsBrutto
	if f.EKArt == "netto" {
		ekArt = calc.EKAlsNetto
	}
	basis := calc.AufBrutto
	if srv.store.Einstellung(store.SchluesselMargenBasis) == "netto" {
		basis = calc.AufNetto
	}
	quellUSt := srv.ustPermille(quell.Code)

	// Die Einkaufsseite gilt für alle Märkte gleich. Sie wird einmal
	// zusammengestellt und je Markt um die Verkaufsseite ergänzt — als Wert
	// übergeben, damit keine Schleifenrunde die nächste beeinflusst.
	grund := calc.Eingabe{
		EK:               ek,
		EKArt:            ekArt,
		QuellUStPermille: quellUSt,
		UStModus:         ustModus,
		MargenBasis:      basis,
	}

	erg := dealErgebnis{
		Quell: quell, EKArt: ekArt,
		UStModus: ustModus, QuellUStPermille: quellUSt, MargenBasis: basis,
	}
	for _, mf := range f.Maerkte {
		me, err := srv.rechneMarkt(f, mf, grund)
		if err != nil {
			// Der Markt steht vorn im Fehler. Ohne ihn stünde in Schritt 3
			// "Verkaufspreis: kein gültiger Betrag" über vier Spalten, ohne
			// zu sagen, welche gemeint ist.
			return dealErgebnis{}, fmt.Errorf("Amazon.%s — %w", mf.Code, err)
		}
		me.Leitmarkt = mf.Code == f.Leitmarkt
		erg.Maerkte = append(erg.Maerkte, me)
	}

	// Beim Einkauf über einen Fremdshop steht der Link selbst im Post; nur
	// bei Amazon lässt er sich aus Markt und ASIN bauen.
	//
	// Geprüft wird er auch hier noch einmal, obwohl Schritt 1 ihn bereits
	// geprüft hat: formularLesen liest das Feld ungeprüft aus dem Formular,
	// und von hier führt der Wert unmittelbar in den Discord-Post — also in
	// fremdes Markdown, das keine Vorlage dieses Programms mehr entschärfen
	// kann (M8 im Abschluss-Review).
	erg.QuellHost = strings.TrimPrefix(quell.Host, "www.")
	erg.QuellURL = quell.ProductURL(f.ASIN)
	erg.Extern = f.QuellURL != ""
	if erg.Extern {
		host, link, err := fremdQuelle(f.QuellURL)
		if err != nil {
			return dealErgebnis{}, fmt.Errorf("Einkaufslink: %w", err)
		}
		erg.QuellHost, erg.QuellURL = host, link
	}
	return erg, nil
}

// rechneMarkt wertet einen einzelnen Zielmarkt aus. grund trägt die
// Einkaufsseite und wird als Wert übergeben; die Verkaufsseite kommt hier
// dazu.
func (srv *Server) rechneMarkt(f dealFormular, mf marktFormular, grund calc.Eingabe) (marktErgebnis, error) {
	// mf.Code stammt aus marketplace.Codes und ist damit bereits bestätigt;
	// die Prüfung steht trotzdem da, weil rechneMarkt für sich allein
	// einstehen soll.
	ziel, ok := marketplace.ByCode(mf.Code)
	if !ok {
		return marktErgebnis{}, fmt.Errorf("unbekannter Zielmarktplatz %q", mf.Code)
	}

	vk, err := money.Parse(mf.VK)
	if err != nil {
		return marktErgebnis{}, fmt.Errorf("Verkaufspreis: %w", err)
	}

	// Die FBA-Gebühr darf leer sein und zählt dann als 0 — sie hat bewusst
	// keinen geratenen Vorgabewert.
	var gebuehr money.Cents
	if strings.TrimSpace(mf.FBA) != "" {
		if gebuehr, err = money.Parse(mf.FBA); err != nil {
			return marktErgebnis{}, fmt.Errorf("FBA-Gebühr: %w", err)
		}
	}

	provision, err := strconv.ParseFloat(strings.Replace(strings.TrimSpace(mf.Provision), ",", ".", 1), 64)
	if err != nil {
		return marktErgebnis{}, fmt.Errorf("Provision: %q ist keine Zahl", mf.Provision)
	}

	zielUSt := srv.ustPermille(ziel.Code)
	grund.VKBrutto = vk
	grund.ZielUStPermille = zielUSt
	grund.ProvisionProzent = provision
	grund.FBA = gebuehr

	me := marktErgebnis{
		Ziel:     ziel,
		Ergebnis: calc.Rechne(grund),
		VKBrutto: vk, FBA: gebuehr, Provision: provision,
		ZielUStPermille: zielUSt,
		ChartURL:        "/chart?asin=" + f.ASIN + "&markt=" + string(ziel.Code),
	}

	// Dieselbe Rechnung ein zweites Mal, mit der lokalen Gebühr des
	// Zielmarkts: das ist der Gewinn für jemanden, der dort Bestand liegen
	// hat statt aus dem Lagerland zu liefern.
	//
	// Eingesetzt wird der lokale Tarif unmittelbar — nicht die eingetragene
	// Gebühr abzüglich der Differenz beider Tarife. Der Abzug stimmte nur,
	// solange im Feld exakt der EFN-Tabellenpreis steht; nach einer Korrektur
	// von Hand ergäbe er eine erfundene Zahl, und die stünde anschließend im
	// Post. Von Hand einzugreifen ist aber ausdrücklich vorgesehen (R1).
	//
	// Gerechnet wird über calc.Rechne und nicht über die Differenz der
	// Gebühren, obwohl das kürzer wäre: Marge und Gewinn sollen aus derselben
	// Funktion kommen wie die Hauptzahlen — eine zweite Formel wäre eine
	// zweite Wahrheit, die irgendwann abweicht.
	if lokal, ok := srv.lokalerTarif(ziel.Code, f.Masse); ok {
		grund.FBA = lokal
		zweite := calc.Rechne(grund)
		me.PanEU, me.PanEUGebuehr = &zweite, lokal
	}
	return me, nil
}
```

`errors` und `strconv` sind in `dealrechnung.go` bereits importiert (aus `baueDeal` bzw. `fremdQuelle`); fehlende ergänzen.

- [ ] **Step 4: `rechnungBloecke` je Markt, Übersicht daneben**

In `internal/web/rechnung.go`: `rechnungBloecke(e dealErgebnis)` bekommt den Markt als zweiten Parameter. Im Rumpf `erg := e.Ergebnis` → `erg := m.Ergebnis`, und jedes `e.Ziel`, `e.VKBrutto`, `e.FBA`, `e.Provision`, `e.ZielUStPermille`, `e.PanEU`, `e.PanEUGebuehr` → `m.…`. `e.Quell`, `e.QuellHost`, `e.EKArt`, `e.UStModus`, `e.QuellUStPermille`, `e.MargenBasis` bleiben bei `e`.

```go
// rechnungBloecke schlüsselt einen Zielmarkt eines Deals auf: erst der
// Einkauf, dann der Verkauf, dann das, was übrig bleibt.
//
// Der Markt wird ausdrücklich übergeben statt aus e gegriffen: ein Deal hat
// mehrere, und der Kassenbon gilt immer genau einem.
func rechnungBloecke(e dealErgebnis, m marktErgebnis) []rechnungBlock {
```

Darunter neu:

```go
// marktErgebnisZeile ist eine Spalte der Ergebnisübersicht in Schritt 3.
//
// Sie steht neben dem ausführlichen Kassenbon und ersetzt ihn nicht: der
// Vergleich zwischen den Märkten braucht die Zahlen nebeneinander, das
// Nachrechnen eines einzelnen Marktes braucht sie untereinander.
type marktErgebnisZeile struct {
	Code      string
	Leitmarkt bool
	Offen     bool

	FBA    string
	Gewinn string
	Marge  string

	// Die drei Pan-EU-Felder sind leer, wo es den Vergleich nicht gibt. Die
	// Vorlage fragt mit {{if}} danach; ein "0,00 €" stünde sonst als Aussage
	// da, die niemand gerechnet hat.
	FBAPanEU    string
	GewinnPanEU string
	MargePanEU  string
}

// ergebnisUebersicht baut die Spalten der Übersicht.
func ergebnisUebersicht(e dealErgebnis, offen marketplace.Code) []marktErgebnisZeile {
	zeilen := make([]marktErgebnisZeile, 0, len(e.Maerkte))
	for _, m := range e.Maerkte {
		z := marktErgebnisZeile{
			Code:      string(m.Ziel.Code),
			Leitmarkt: m.Leitmarkt,
			Offen:     m.Ziel.Code == offen,
			FBA:       m.FBA.Euro(),
			Gewinn:    m.Ergebnis.Gewinn.Euro(),
			Marge:     prozent(m.Ergebnis.MargeProzent, 1),
		}
		if m.PanEU != nil {
			z.FBAPanEU = m.PanEUGebuehr.Euro()
			z.GewinnPanEU = m.PanEU.Gewinn.Euro()
			z.MargePanEU = prozent(m.PanEU.MargeProzent, 1)
		}
		zeilen = append(zeilen, z)
	}
	return zeilen
}
```

- [ ] **Step 5: Der offene Markt und `rechnungFuellen`**

In `dealformular.go`: `dealFormular` bekommt

```go
	// OffenerMarkt ist der Markt, dessen ausführlicher Kassenbon in Schritt 3
	// unter der Übersicht steht. Vorgabe ist der Leitmarkt; ohne die
	// Umschaltmöglichkeit ließen sich die anderen Spalten nie nachrechnen.
	OffenerMarkt marketplace.Code
```

und in `formularLesen`, nach dem Leitmarkt:

```go
		// Der offene Markt fällt auf den Leitmarkt zurück, wenn das Feld
		// leer ist oder auf einen nicht (mehr) gewählten Markt zeigt —
		// dieselbe Auflösung wie beim Leitmarkt selbst.
```
```go
	offen := leitmarktAufloesen(r.PostForm.Get("offen"), maerkte)
	leit := leitmarktAufloesen(r.PostForm.Get("leitmarkt"), maerkte)
	if r.PostForm.Get("offen") == "" {
		offen = leit
	}
```
und im Rückgabewert `Leitmarkt: leit, OffenerMarkt: offen`.

In `dealrechnung.go` ersetzt `rechnungFuellen` die bisherige `rechnungOderFehler`:

```go
// rechnungFuellen rechnet den Deal und legt beides in die Seite: je Markt eine
// Spalte der Übersicht und den ausführlichen Kassenbon des offenen Marktes.
//
// Entweder Zahlen oder eine Meldung, nie beides — dieselbe Regel wie zuvor.
// Ein halb gefüllter Vergleich neben einem Fehler wäre die schlechtere Hälfte
// von beidem.
func (srv *Server) rechnungFuellen(d *dealSeite) {
	d.Ergebnisse, d.Rechnung, d.RechenFehler = nil, nil, ""

	erg, err := srv.rechneDeal(d.Formular)
	if err != nil {
		d.RechenFehler = sicherFehlertext(err.Error())
		return
	}
	d.Ergebnisse = ergebnisUebersicht(erg, d.Formular.OffenerMarkt)

	// Kein offener Markt getroffen — dann der Leitmarkt, damit unter der
	// Übersicht nie eine leere Fläche steht.
	m, ok := erg.Markt(d.Formular.OffenerMarkt)
	if !ok {
		m = erg.Leit()
	}
	d.OffenerMarkt = string(m.Ziel.Code)
	d.Rechnung = rechnungBloecke(erg, m)
}
```

In `deal.go`: `dealSeite` bekommt `Ergebnisse []marktErgebnisZeile` und `OffenerMarkt string`; jede Stelle mit
`d.Rechnung, d.RechenFehler = srv.rechnungOderFehler(d.Formular)` wird zu `srv.rechnungFuellen(&d)`.

`uebernehmeGeprueft` bekommt Chart und Kassenbon vom richtigen Markt. Es schreibt weiterhin **keine** Zahlen ins Formular zurück — die stehen dort schon:

```go
func (d *dealSeite) uebernehmeGeprueft(erg dealErgebnis) {
	d.Vorschau = erg.Text
	d.ChartURL = erg.Leit().ChartURL
	d.Ergebnisse = ergebnisUebersicht(erg, d.Formular.OffenerMarkt)
	if m, ok := erg.Markt(d.Formular.OffenerMarkt); ok {
		d.Rechnung = rechnungBloecke(erg, m)
	} else {
		d.Rechnung = rechnungBloecke(erg, erg.Leit())
	}
	if erg.Extern {
		d.Formular.QuellURL = erg.QuellURL
	}
}
```

- [ ] **Step 6: Fragment `rechnung` um die Übersicht ergänzen**

In `internal/web/templates/deal.html` das Fragment `rechnung` ersetzen:

```
{{define "rechnung"}}
{{if .RechenFehler}}<p class="fehler">{{.RechenFehler}}</p>{{end}}

{{/* Die Übersicht steht über dem Kassenbon: der Vergleich zwischen den
     Märkten braucht die Zahlen nebeneinander, das Nachrechnen eines
     einzelnen Marktes braucht sie untereinander. */}}
{{if .Ergebnisse}}
<div class="tabellenkarte">
<table class="rechnung uebersicht">
  <tr><th></th>{{range .Ergebnisse}}<th>Amazon.{{.Code}}{{if .Leitmarkt}} ★{{end}}</th>{{end}}</tr>
  <tr><td>FBA-Gebühr</td>{{range .Ergebnisse}}<td class="betrag">{{.FBA}}</td>{{end}}</tr>
  <tr class="betont"><td>Gewinn</td>{{range .Ergebnisse}}<td class="betrag">{{.Gewinn}}</td>{{end}}</tr>
  <tr class="betont"><td>Marge</td>{{range .Ergebnisse}}<td class="betrag">{{.Marge}}</td>{{end}}</tr>
  {{/* Die Pan-EU-Zeilen bleiben leer, wo es den Vergleich nicht gibt — im
       Lagerland etwa gibt es keinen zweiten Versandweg. */}}
  <tr><td>FBA-Gebühr lokal</td>{{range .Ergebnisse}}<td class="betrag">{{.FBAPanEU}}</td>{{end}}</tr>
  <tr><td>Gewinn Pan-EU</td>{{range .Ergebnisse}}<td class="betrag">{{.GewinnPanEU}}</td>{{end}}</tr>
  <tr><td>Marge Pan-EU</td>{{range .Ergebnisse}}<td class="betrag">{{.MargePanEU}}</td>{{end}}</tr>
  {{/* Ein Klick tauscht den Kassenbon darunter aus, ohne die Seite zu
       verlassen: hx-vals setzt "offen", das ganze Formular geht mit. */}}
  <tr><td></td>{{range .Ergebnisse}}<td>
    {{if .Offen}}<b>offen</b>{{else}}<button type="button" class="schmal"
      hx-post="/deal/berechnung" hx-target="#rechnung"
      hx-include="#deal-formular" hx-vals='{"offen": "{{.Code}}"}'>aufschlüsseln</button>{{end}}
  </td>{{end}}</tr>
</table>
</div>
{{end}}

{{range .Rechnung}}
<table class="rechnung">
  <caption>{{.Titel}}</caption>
  {{range .Zeilen}}
  <tr class="{{if .Betonung}}betont{{end}}">
    <td class="zeichen">{{.Zeichen}}</td><td>{{.Bezeichnung}}</td><td class="betrag">{{.Wert}}</td>
  </tr>
  {{end}}
</table>
{{end}}
{{end}}
```

- [ ] **Step 7: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS, `TestVorschauRechnetReferenzfall` weiterhin mit `26,70` und `12,9`.

- [ ] **Step 8: Full suite + commit**

```bash
make test
git add internal/web/
git commit -m "$(cat <<'MSG'
feat(web): jeden Zielmarkt einzeln rechnen

rechneDeal stellt die Einkaufsseite einmal zusammen und läuft damit über
die Märkte; je Markt entsteht ein marktErgebnis samt Pan-EU-Vergleich.
Schritt 3 zeigt die Märkte nebeneinander in einer Übersicht, darunter den
ausführlichen Kassenbon des offenen Marktes.

Der Markt steht vorn in jedem Rechenfehler. Ohne ihn stünde
"Verkaufspreis: kein gültiger Betrag" über vier Spalten, ohne zu sagen,
welche gemeint ist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Schritt 3 — die Eingabetabelle

**Files:**
- Modify: `internal/web/templates/deal.html` (Fragment `schritt3`)
- Modify: `internal/web/deal.go` (`dealSeite.VKKandidaten`, `dealSeite.SalesHinweis`)
- Test: `internal/web/deal_test.go`

**Interfaces:**
- Consumes: `dealFormular.Maerkte` (Task 5), `dealSeite.Ergebnisse` (Task 6)
- Produces:
  - `dealSeite.VKKandidaten` und `dealSeite.SalesHinweis` entfallen ersatzlos — beide sind jetzt Felder von `marktFormular` (Task 5) und stehen damit je Markt genau einmal da

- [ ] **Step 1: Write the failing test**

An `internal/web/deal_test.go` anhängen:

```go
func TestSchritt3ZeigtEineSpalteJeMarkt(t *testing.T) {
	srv, _ := testServer(t)
	ks := keepaServer(t)
	srv.keepa = keepaClientFuer(t, ks)

	v := schritt2Werte()
	v["zielmarkt"] = []string{"DE", "IT"}

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	koerper := w.Body.String()

	for _, feld := range []string{
		`name="vk.DE"`, `name="vk.IT"`,
		`name="sales.DE"`, `name="sales.IT"`,
		`name="provision.DE"`, `name="provision.IT"`,
		`name="fba.DE"`, `name="fba.IT"`,
	} {
		if !strings.Contains(koerper, feld) {
			t.Errorf("Schritt 3 hat kein %s:\n%s", feld, koerper)
		}
	}
}
```

`keepaClientFuer` ist der Helfer, mit dem die vorhandenen Tests `srv.keepa` auf den Test-Server umbiegen — den bereits in `deal_test.go` benutzten Weg übernehmen, keinen zweiten erfinden.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/web/ -run TestSchritt3ZeigtEineSpalteJeMarkt -v`
Expected: FAIL — nur die Felder des Leitmarkts stehen im Formular.

- [ ] **Step 3: Ausgangslage prüfen — hier ist nichts mehr zu tun**

`dealSeite.VKKandidaten` und `dealSeite.SalesHinweis` sind bereits in Task 5 entfallen; beide sind Felder von `marktFormular` und stehen je Markt genau einmal da. Schritt 3 rendert sie heute über `$leit.Kandidaten` bzw. `$leit.SalesHinweis`.

Vergewissere dich davon (`grep -n 'VKKandidaten' internal/web/deal.go` findet nichts) und geh weiter. Diese Aufgabe ist damit reine Vorlagenarbeit.

Eine eigene Spaltenliste neben `Formular.Maerkte` wäre die naheliegendere Bauart und die falsche: sie wäre eine zweite Sicht auf dieselben Zahlen, von Hand synchron zu halten, und still auseinanderlaufende Sichten sind genau der Fehler, gegen den schon das Marktsuffix gebaut ist. Die Vorlage läuft darum unmittelbar über `.Formular.Maerkte`.

**Die Radio-Gruppe der Ø-Preise braucht ebenfalls das Suffix.** Sie heißt heute `name="vk_wahl"` — bei vier Märkten verschmölzen alle vier Gruppen zu einer, und ein Klick auf Italiens Ø-90-Tage-Preis hübe die Wahl bei Deutschland auf. Sie wird zu `name="vk_wahl.{{$c}}"`.

Damit wird aus der bisherigen Einzelausnahme im Feldabgleich-Test eine Familienausnahme: `TestDealFormularUndHandlerFelderStimmenUeberein` führt `vk_wahl` in `ohneLeserErlaubt`, weil die Knöpfe absichtlich nie vom Server gelesen werden. Der Eintrag muss auf die Familie `vk_wahl.` lauten, sonst meldet der Test die Knöpfe zu Recht als Kontrolle ohne Wirkung. **Den Eintrag ändern, nicht die Prüfung abschalten** — und den vorhandenen Begründungskommentar dazu mitziehen, statt ihn zu ersetzen.

- [ ] **Step 4: Die Tabelle in der Vorlage**

Im Fragment `schritt3` die drei bisherigen `fieldset`-Blöcke (Verkaufspreis, Zahlen) durch eine Tabelle ersetzen — Zeilen sind die Größen, Spalten die Märkte, wie in der Tarifübersicht:

```
  <div class="tabellenkarte">
  <table class="eingabe">
    <tr><th></th>{{range .Formular.Maerkte}}<th>Amazon.{{.Code}}</th>{{end}}</tr>

    {{/* Die Auswahlknöpfe tragen bewusst kein name-Attribut: sonst sendete
         das Formular zwei Werte namens "vk.DE". Sie füllen nur das Feld. */}}
    <tr><td>Ø-Preise</td>
      {{range .Formular.Maerkte}}{{$c := .Code}}<td>
        {{range .Kandidaten}}
        <label><input type="radio" name="vk_wahl.{{$c}}" value="{{.Schluessel}}"
                      {{if .Gewaehlt}}checked{{end}}
                      onchange="this.form['vk.{{$c}}'].value='{{.Wert}}'; this.form['vk_quelle.{{$c}}'].value='{{.Schluessel}}'">
          {{.Bezeichnung}} — {{.Wert}} €</label>
        {{else}}<span class="fehler">Keepa hat keinen Verkaufspreis</span>{{end}}
      </td>{{end}}</tr>

    <tr><td>Verkaufspreis</td>
      {{range .Formular.Maerkte}}{{$c := .Code}}<td>
        <input name="vk.{{$c}}" value="{{.VK}}" placeholder="207,49"
               oninput="this.form['vk_quelle.{{$c}}'].value='manuell'">
        <input type="hidden" name="vk_quelle.{{$c}}" value="{{.VKQuelle}}">
      </td>{{end}}</tr>

    {{/* oninput setzt dieselbe "manuell"-Quelle wie beim VK-Feld: ohne das
         behauptete die Historie nach einer Handeingabe weiterhin "keepa"
         oder "standardwert", obwohl der Wert von niemandem außer dem
         Nutzer stammt (I5 im Abschluss-Review). */}}
    <tr><td>Verkäufe</td>
      {{range .Formular.Maerkte}}{{$c := .Code}}<td>
        <input name="sales.{{$c}}" value="{{.Sales}}"
               oninput="this.form['sales_quelle.{{$c}}'].value='manuell'">
        <input type="hidden" name="sales_quelle.{{$c}}" value="{{.SalesQuelle}}">
        <span class="herkunft">{{.SalesHinweis}}</span>
      </td>{{end}}</tr>

    <tr><td>Provision in %</td>
      {{range .Formular.Maerkte}}{{$c := .Code}}<td>
        <input name="provision.{{$c}}" value="{{.Provision}}"
               oninput="this.form['provision_quelle.{{$c}}'].value='manuell'">
        <input type="hidden" name="provision_quelle.{{$c}}" value="{{.ProvisionQuelle}}">
        <span class="herkunft">{{.ProvisionQuelle}}</span>
      </td>{{end}}</tr>

    <tr><td>FBA-Gebühr</td>
      {{range .Formular.Maerkte}}{{$c := .Code}}<td>
        <input name="fba.{{$c}}" value="{{.FBA}}" placeholder="leer, wenn unbekannt"
               oninput="this.form['fba_quelle.{{$c}}'].value='manuell'">
        <input type="hidden" name="fba_quelle.{{$c}}" value="{{.FBAQuelle}}">
        <span class="herkunft">{{.FBAQuelle}}</span>
      </td>{{end}}</tr>
  </table>
  </div>
```

Da die sichtbaren Felder jetzt alle Märkte abdecken, bindet Schritt 3 `verborgen-marktzahlen` **nicht** mehr ein — sonst stünde jedes Feld zweimal im Formular. `verborgen-maerkte` bleibt (es trägt `zielmarkt` und `leitmarkt`), und `offen` kommt als verborgenes Feld dazu:

```
  <input type="hidden" name="offen" value="{{.OffenerMarkt}}">
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS

- [ ] **Step 6: Full suite + commit**

```bash
make test
git add internal/web/
git commit -m "$(cat <<'MSG'
feat(web): Schritt 3 als Tabelle, Spalte je Markt

Zeilen sind die Größen, Spalten die Märkte — gebaut wie die vorhandene
Tarifübersicht, weil dort dieselbe Frage dieselbe Form bekommen hat.

Jede Spalte trägt ihre eigene Kandidatenliste und ihren eigenen
Sales-Hinweis: Keepa nennt Verkaufspreis und Verkaufszahl je Domain, und
ein Vorschlag aus dem falschen Land wäre schlimmer als keiner.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: Keepa je Markt, ein Fehlschlag hält die anderen nicht auf

**Files:**
- Modify: `internal/web/deal.go` (`ladeDeal`, `uebernehmeKeepa`, `schlageEinkaufspreisVor`)
- Test: `internal/web/deal_test.go`

**Interfaces:**
- Consumes: `holeProdukt(r, asin, ziel)` (unverändert), `dealFormular.marktZeiger` (Task 5)
- Produces: `func (srv *Server) uebernehmeKeepa(d *dealSeite, m marketplace.Marketplace, produkt keepa.Product)` — füllt genau eine Spalte

- [ ] **Step 1: Write the failing tests**

```go
func TestLadenHoltJedenMarktEinzeln(t *testing.T) {
	srv, _ := testServer(t)
	ks := keepaServer(t)
	srv.keepa = keepaClientFuer(t, ks)

	v := schritt2Werte()
	v["zielmarkt"] = []string{"DE", "IT"}

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	koerper := w.Body.String()
	// Beide Spalten sind mit Keepa-Werten vorbelegt, nicht nur die erste.
	if strings.Count(koerper, `value="keepa"`) < 2 {
		t.Errorf("nicht beide Märkte aus Keepa vorbelegt:\n%s", koerper)
	}
}

// Drei brauchbare Märkte sind besser als vier verweigerte: scheitert Keepa
// für einen Markt, tragen die anderen weiter ihre Zahlen und der betroffene
// die Standardwerte samt Hinweis.
func TestLadenUeberlebtEinenFehlschlagJeMarkt(t *testing.T) {
	srv, s := testServer(t)
	// Der Test-Server antwortet nur für die DE-Domain (3); jede andere
	// Domain bekommt einen Serverfehler.
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("domain") != "3" {
			http.Error(w, "kaputt", http.StatusInternalServerError)
			return
		}
		roh, _ := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	t.Cleanup(ks.Close)
	srv.keepa = keepaClientFuer(t, ks)
	_ = s.EinstellungSetzen(store.SchluesselProvision, "15")

	v := schritt2Werte()
	v["zielmarkt"] = []string{"DE", "IT"}

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, "Keepa nicht erreicht") {
		t.Errorf("kein Hinweis auf den fehlgeschlagenen Markt:\n%s", koerper)
	}
	// Der Standardwert für die Provision steht in der IT-Spalte.
	if !strings.Contains(koerper, "standardwert") {
		t.Errorf("IT hat keine Standardwerte bekommen:\n%s", koerper)
	}
	// Und DE hat trotzdem echte Keepa-Werte.
	if !strings.Contains(koerper, `value="keepa"`) {
		t.Errorf("DE hat keine Keepa-Werte:\n%s", koerper)
	}
	// Der Fehlertext eines gescheiterten Abrufs kann von einem *url.Error
	// stammen, dessen Anfrage-URL den API-Key als Query-Parameter trägt.
	// Ohne sicherFehlertext stünde er im Klartext auf dieser Seite.
	if strings.Contains(koerper, "key=") {
		t.Errorf("die Seite trägt einen Keepa-Key im Fehlertext:\n%s", koerper)
	}
}
```

`EinstellungSetzen` ist der vorhandene Setzer des Stores — den in `store/settings.go` benutzten Namen übernehmen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/web/ -run 'TestLaden' -v`
Expected: FAIL — `ladeDeal` fragt nur einen Markt.

- [ ] **Step 3: Die Schleife in `ladeDeal`**

Den Abschnitt ab `produkt, err := srv.holeProdukt(...)` ersetzen:

```go
	d.Schritt = schrittRechnung
	d.ChartURL = "/chart?asin=" + d.Formular.ASIN + "&markt=" + string(d.Formular.Leitmarkt)

	// Je Markt ein Abruf, der Reihe nach. Der Cache liegt auf (asin, domain)
	// und trennt die Märkte damit sauber — der Weg zurück nach Schritt 2 und
	// wieder vor kostet also keine weiteren Token.
	//
	// Ein Fehlschlag hält die anderen Märkte nicht auf: der betroffene fällt
	// auf die Standardwerte zurück und sagt das in seiner Spalte. Drei
	// brauchbare Märkte sind besser als vier verweigerte, und genau dieses
	// Verhalten hatte der Einzelmarkt schon.
	var fehler []string
	for _, mf := range d.Formular.Maerkte {
		ziel, ok := marketplace.ByCode(mf.Code)
		if !ok {
			continue
		}
		produkt, err := srv.holeProdukt(r, d.Formular.ASIN, ziel)
		if err != nil {
			// sicherFehlertext ist hier keine Formsache: holeProdukt reicht
			// im default-Zweig einen Fehler durch, der von einem *url.Error
			// aus einem fehlgeschlagenen HTTP-Aufruf stammen kann — und
			// dessen Anfrage-URL trägt den Keepa-API-Key als Query-Parameter
			// "key=...". Ohne den Scrub stünde er im Klartext auf der Seite,
			// genau die Klasse Leck, gegen die sicherFehlertext bereits in
			// channels.go absichert (siehe dortiger Kommentar).
			fehler = append(fehler, "Amazon."+string(ziel.Code)+": "+sicherFehlertext(err.Error()))
			srv.standardwerteFuer(d, ziel)
			continue
		}
		srv.uebernehmeKeepa(d, ziel, produkt)
	}
	d.Fehler = strings.Join(fehler, " · ")

	d.TokenText = srv.tokenText()
	srv.rechnungFuellen(d)
	srv.rendere(w, "schritt3", d)
```

Neuer Helfer neben `uebernehmeKeepa`:

```go
// standardwerteFuer belegt den Markt, für den Keepa nicht erreichbar war.
// Gefüllt wird nur, was leer ist — der Rückweg aus Schritt 4 bringt bereits
// von Hand geprüfte Zahlen mit, und die sind besser als jeder Standardwert.
func (srv *Server) standardwerteFuer(d *dealSeite, m marketplace.Marketplace) {
	sp := d.Formular.marktZeiger(m.Code)
	if sp == nil {
		return
	}
	if strings.TrimSpace(sp.Provision) == "" {
		sp.Provision = srv.store.Einstellung(store.SchluesselProvision)
		sp.ProvisionQuelle = "standardwert"
	}
	if strings.TrimSpace(sp.FBA) == "" {
		sp.FBA = srv.store.Einstellung(store.SchluesselFBA)
		sp.FBAQuelle = "standardwert"
	}
	if strings.TrimSpace(sp.Sales) == "" {
		sp.SalesQuelle = "manuell"
	}
	sp.SalesHinweis = "Keepa nicht erreicht — bitte eintragen"
}

```

Kein Aufbau und kein Zurückschreiben einer zweiten Liste: `d.Formular.Maerkte` ist die einzige Quelle, und `marktZeiger` schreibt unmittelbar hinein. Eine Spaltenliste daneben müsste vor der Schleife gefüllt und danach zurückgetragen werden — zwei Sichten auf dieselben Zahlen, die still auseinanderlaufen können.

- [ ] **Step 4: `uebernehmeKeepa` je Markt**

Die bisherige Fassung schreibt in `d.Formular.VK` usw.; sie bekommt den Markt als Parameter und schreibt in dessen Spalte. Der Kopf:

```go
// uebernehmeKeepa füllt die Spalte eines Marktes aus dem Keepa-Produkt.
//
// Gefüllt wird nur, was leer ist: so überlebt der Weg zurück aus Schritt 4
// die von Hand geprüften Zahlen, während ein frischer Aufruf sie vorher über
// keepaWerteLeeren abgeräumt hat und hier alles neu bekommt. Die
// Kandidatenliste entsteht in beiden Fällen neu — sie ist Anzeige, kein
// Eingabewert.
//
// Artikelname, Bild und Maße hängen am Artikel und nicht am Markt: sie werden
// nur vom Leitmarkt übernommen. Bei den Maßen mit einer Ausnahme — nennt der
// Leitmarkt keine, gelten die des ersten Marktes, der welche kennt. Es ist
// dasselbe physische Paket; das ist keine erfundene Zahl, sondern dieselbe
// aus einer anderen Auskunft.
func (srv *Server) uebernehmeKeepa(d *dealSeite, m marketplace.Marketplace, produkt keepa.Product) {
	sp := d.Formular.marktZeiger(m.Code)
	if sp == nil {
		return
	}

	if m.Code == d.Formular.Leitmarkt {
		d.Formular.BildKennung = gepruefteBildKennung(produkt.BildKennung)
		if strings.TrimSpace(d.Formular.Titel) == "" {
			d.Formular.Titel = produkt.Titel
		}
	}
	if produkt.Masse.Vollstaendig() && (m.Code == d.Formular.Leitmarkt || !d.Formular.Masse.Vollstaendig()) {
		d.Formular.Masse = produkt.Masse
	}

	// VK-Kandidaten, Ø 90 Tage Buy Box vorausgewählt.
	median := keepa.MedianZeitgewichtet(produkt.BuyBoxVerlauf, letzteMinute(produkt))
	gewaehlterVK := sp.VKQuelle
	for _, k := range []struct {
		schluessel, text string
		p                keepa.Price
	}{
		{"avg90", "Ø 90 Tage Buy Box", produkt.BuyBoxAvg90},
		{"median90", "Median 90 Tage Buy Box", median},
		{"aktuell", "Buy Box aktuell", produkt.BuyBoxAktuell},
		{"amazon", "Amazon aktuell", produkt.AmazonAktuell},
	} {
		if !k.p.OK {
			continue
		}
		gewaehlt := k.schluessel == gewaehlterVK || (gewaehlterVK == "" && k.schluessel == "avg90")
		sp.Kandidaten = append(sp.Kandidaten, kandidat{
			Schluessel: k.schluessel, Bezeichnung: k.text,
			Wert: k.p.Cents.String(), Gewaehlt: gewaehlt,
		})
		if gewaehlt && strings.TrimSpace(sp.VK) == "" {
			sp.VK = k.p.Cents.String()
			sp.VKQuelle = k.schluessel
		}
	}
	// Kennt Keepa den vorausgewählten Kandidaten für diesen Markt nicht,
	// rückt der erste vorhandene nach. Ist gar keiner übrig, bleibt das Feld
	// leer — es wird kein Wert erfunden.
	if strings.TrimSpace(sp.VK) == "" && len(sp.Kandidaten) > 0 {
		sp.VK = sp.Kandidaten[0].Wert
		sp.VKQuelle = sp.Kandidaten[0].Schluessel
		sp.Kandidaten[0].Gewaehlt = true
	}

	sales, quelle := produkt.Sales()
	switch quelle {
	case keepa.SalesMonthlySold:
		sp.SalesHinweis = "Keepa · monthlySold (Amazon-Badge)"
	case keepa.SalesRankDrops:
		sp.SalesHinweis = "Keepa · Schätzung aus Rangsprüngen, 30 Tage"
	default:
		sp.SalesHinweis = "Keepa hat keine Verkaufszahl — bitte eintragen"
	}
	if strings.TrimSpace(sp.Sales) == "" && quelle != keepa.SalesKeine {
		// Keine Zahl heißt leeres Feld, nicht 0: Product.Sales liefert für
		// "unbekannt" den Nullwert, und "Amazon.DE: 0 Verkäufe" wäre eine
		// veröffentlichte Aussage, die niemand gemessen hat. Leer lässt
		// baueDeal das Posten verweigern, bis jemand eine Zahl einträgt.
		sp.Sales = strconv.Itoa(sales)
		if quelle == keepa.SalesMonthlySold {
			sp.SalesQuelle = "monthlySold"
		} else {
			sp.SalesQuelle = "rankDrops30"
		}
	}

	if strings.TrimSpace(sp.Provision) == "" {
		if produkt.ProvisionProzent != nil {
			sp.Provision = strconv.FormatFloat(*produkt.ProvisionProzent, 'f', -1, 64)
			sp.ProvisionQuelle = "keepa"
		} else {
			sp.Provision = srv.store.Einstellung(store.SchluesselProvision)
			sp.ProvisionQuelle = "standardwert"
		}
	}

	// Die FBA-Gebühr aus drei möglichen Quellen — und welche zuerst gefragt
	// wird, hängt am Versandweg. Den ausführlichen Kommentar der bisherigen
	// Fassung (Ausland → Staffel führt, Lagerland → Keepa führt) unverändert
	// mit übernehmen: er begründet die Rangfolge, und sie ist der Kern der
	// vorangegangenen Änderung.
	if strings.TrimSpace(sp.FBA) == "" {
		weg := srv.wegFuer(m.Code)
		cent, klasse, tarif := srv.tarifGebuehr(m.Code, produkt.Masse)
		switch {
		case tarif && weg == fba.EFN:
			sp.FBA = cent.String()
			sp.FBAQuelle = tarifQuelle(weg, klasse)
		case produkt.FBA.OK:
			sp.FBA = produkt.FBA.Cents.String()
			sp.FBAQuelle = "keepa"
		case tarif:
			sp.FBA = cent.String()
			sp.FBAQuelle = tarifQuelle(weg, klasse)
		default:
			sp.FBA = srv.store.Einstellung(store.SchluesselFBA)
			sp.FBAQuelle = "standardwert"
		}
	}
}
```

Die Maße gehen dabei je Markt als `produkt.Masse` in `tarifGebuehr` — es sind die Angaben, die Keepa **für diesen Markt** liefert, und die Tarifklasse soll aus derselben Auskunft kommen wie die Gebühr, die sie ersetzt.

Der Einkaufspreis-Vorschlag (`schlageEinkaufspreisVor`) hängt am **Quellmarkt**, nicht am Ziel — er bleibt, wo er ist, und wird weiterhin genau einmal aufgerufen, nicht je Markt.

- [ ] **Step 5: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS

- [ ] **Step 6: Full suite + commit**

```bash
make test
git add internal/web/
git commit -m "$(cat <<'MSG'
feat(web): Keepa je Zielmarkt, ein Fehlschlag hält die anderen nicht auf

Provision, FBA-Gebühr, Verkaufspreis und Verkaufszahl gelten je Domain;
ladeDeal fragt darum je gewähltem Markt. Der Cache liegt bereits auf
(asin, domain) und trennt sie sauber.

Scheitert ein Markt, bekommt seine Spalte die Standardwerte und den
Hinweis, die anderen ihre echten Zahlen. Drei brauchbare Märkte sind
besser als vier verweigerte — genau das Verhalten hatte der Einzelmarkt
schon.

Artikelname, Bild und Maße kommen vom Leitmarkt; fehlen ihm die Maße,
gelten die des ersten Marktes, der welche nennt. Es ist dasselbe Paket.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: `baueDeal` — der Post nennt jeden Markt

**Files:**
- Modify: `internal/web/dealrechnung.go` (`baueDeal`, `vkTag`)
- Modify: `internal/post/render.go` (`StandardVorlage`)
- Test: `internal/web/deal_test.go`, `internal/post/render_test.go`

**Interfaces:**
- Consumes: `post.Daten.Maerkte`, `post.MarktDaten` (Task 2); `dealErgebnis.Maerkte` (Task 6)
- Produces: `baueDeal` füllt `post.Daten.Maerkte` und die Leitmarkt-Felder; neue `const StandardVorlage`

- [ ] **Step 1: Write the failing test**

```go
func TestVorschauNenntJedenMarkt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: "https://x/1", MentionTyp: "everyone",
	})

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	// Geprüft wird der Inhalt von <div class="vorschau">, nicht die ganze
	// Seite. Schritt 4 rendert daneben die Marktvergleichs-Tabelle und
	// spiegelt jedes Formularfeld als verborgenes Element — "Amazon.IT" und
	// "189,00" stehen dort ohnehin, ganz gleich was im Post steht. Ein Test
	// gegen den ganzen Körper bliebe grün, während der Post nur den
	// Leitmarkt nennt, und wäre damit eine Attrappe an der Stelle, an der
	// die Zusicherung dieser Aufgabe steht.
	post := vorschauInhalt(t, w.Body.String())
	for _, muss := range []string{"Amazon.DE", "Amazon.IT", "26,70", "189,00"} {
		if !strings.Contains(post, muss) {
			t.Errorf("Post enthält %q nicht:\n%s", muss, post)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/web/ -run TestVorschauNenntJedenMarkt -v`
Expected: FAIL — der Post nennt nur den Leitmarkt.

- [ ] **Step 3: `baueDeal` umbauen**

Die Verkaufszahl wird jetzt je Markt geprüft, und `post.Daten` bekommt beide Sichten:

```go
func (srv *Server) baueDeal(f dealFormular) (dealErgebnis, error) {
	erg, err := srv.rechneDeal(f)
	if err != nil {
		return dealErgebnis{}, err
	}

	// Wie beim Einkaufspreis und der Provision wird eine nicht lesbare
	// Verkaufszahl nie stillschweigend zu 0: eine kaputte Zahl im Post
	// ("Amazon.DE: 0 Verkäufe") wäre eine falsche, veröffentlichte Aussage
	// über den Artikel. Der Markt steht vorn, wie bei den Rechenfehlern.
	for i := range erg.Maerkte {
		mf, _ := f.Markt(erg.Maerkte[i].Ziel.Code)
		sales, err := strconv.Atoi(strings.TrimSpace(mf.Sales))
		if err != nil {
			return dealErgebnis{}, fmt.Errorf("Amazon.%s — Verkäufe: %q ist keine Zahl",
				erg.Maerkte[i].Ziel.Code, mf.Sales)
		}
		erg.Maerkte[i].Sales = sales
	}

	leit := erg.Leit()

	// Im Brutto-Modus bleibt der Parameter 0, so wie im ursprünglich
	// kopierten ArbitrageOne-Link.
	var ekNetto money.Cents
	if erg.UStModus == calc.Netto {
		ekNetto = leit.Ergebnis.EKNetto
	}

	// Der Einkaufslink bekommt den Standard-Tag seines eigenen Marktes: ein
	// Tag verdient nur dort, wofür er ausgestellt wurde, und Einkaufs- und
	// Zielmarkt sind hier regelmäßig verschiedene Länder. Bei einem
	// Fremdshop bleibt der Link unberührt.
	ekUrl := erg.QuellURL
	if !erg.Extern {
		ekTagWert := ""
		if t, ok := srv.store.StandardTag(string(erg.Quell.Code)); ok {
			ekTagWert = t.Tag
		}
		ekUrl = erg.Quell.ProductURLMitTag(f.ASIN, ekTagWert)
	}

	daten := post.Daten{
		Titel:   f.Titel,
		ASIN:    f.ASIN,
		Mention: mentionText(f.ChannelID, srv),
		EKHost:  erg.QuellHost,
		EKUrl:   ekUrl,
		// Im Post steht immer der Bruttopreis — auch nach einer
		// Netto-Eingabe, denn das ist der Betrag, den ein Leser im Shop
		// bezahlt.
		EK:      leit.Ergebnis.EKBrutto.Euro(),
		EKNotiz: f.EKNotiz,
		AOUrl: post.ArbitrageOneURL(post.AOParameter{
			ASIN: f.ASIN, VKBrutto: leit.VKBrutto, EKBrutto: leit.Ergebnis.EKBrutto,
			EKNettoBerechnet: ekNetto,
			Sales:            leit.Sales, Zielmarkt: leit.Ziel.Code, QuellURL: erg.QuellURL,
		}),
	}

	// Die Affiliate-Tags werden ausschließlich hier eingesetzt, nie in
	// erg.QuellURL. Dasselbe Feld speist auch den ArbitrageOne-Parameter
	// source_url, das versteckte Formularfeld quell_url und die gleichnamige
	// Spalte der Historie — ein dort eingebauter Tag sickerte in alle drei
	// durch.
	for _, m := range erg.Maerkte {
		vkTagWert := ""
		if t, ok := srv.vkTag(f, m.Ziel.Code); ok {
			vkTagWert = t.Tag
		}
		md := post.MarktDaten{
			Code:          string(m.Ziel.Code),
			VK:            m.VKBrutto.Euro(),
			VKUrl:         m.Ziel.ProductURLMitTag(f.ASIN, vkTagWert),
			Sales:         strconv.Itoa(m.Sales),
			Gewinn:        m.Ergebnis.Gewinn.Euro(),
			Marge:         prozent(m.Ergebnis.MargeProzent, 1),
			MargeGerundet: prozent(m.Ergebnis.MargeProzent, 0),
		}
		// Leer, wo es den Vergleich nicht gibt — die Vorlage fragt mit
		// {{if}} danach. Ein "0,00 €" stünde sonst als Aussage da, die
		// niemand gerechnet hat.
		if m.PanEU != nil {
			md.GewinnPanEU = m.PanEU.Gewinn.Euro()
			md.MargePanEU = prozent(m.PanEU.MargeProzent, 1)
		}
		daten.Maerkte = append(daten.Maerkte, md)

		// Die alten, flachen Felder tragen den Leitmarkt: eine gespeicherte
		// Vorlage kennt .Maerkte nicht, und Render läuft mit
		// missingkey=error — ohne sie renderte sie gar nicht mehr.
		if m.Leitmarkt {
			daten.Zielmarkt = md.Code
			daten.VK, daten.VKUrl, daten.Sales = md.VK, md.VKUrl, md.Sales
			daten.Gewinn, daten.Marge, daten.MargeGerundet = md.Gewinn, md.Marge, md.MargeGerundet
			daten.GewinnPanEU, daten.MargePanEU = md.GewinnPanEU, md.MargePanEU
		}
	}

	text, err := post.Render(srv.store.Einstellung(store.SchluesselVorlage), daten)
	if err != nil {
		return dealErgebnis{}, err
	}
	erg.Text = text

	if f.ChannelID != 0 {
		erg.Channel, _ = srv.store.Channel(f.ChannelID)
	}
	return erg, nil
}
```

- [ ] **Step 4: Die Vorgabe-Vorlage tauschen**

Erst **jetzt** — `baueDeal` füllt `.Maerkte`, also läuft der Wiederholungsblock nicht mehr über eine leere Liste. In `internal/post/render.go`:

```go
// StandardVorlage greift für jeden, der die Vorlage nie gespeichert hat.
//
// Je Markt eine Zeile, auch bei einem einzigen: eine Form für alle Fälle.
// Wer die frühere dreizeilige Form behalten will, hat sie in seiner
// gespeicherten Vorlage ohnehin schon — die bleibt unberührt, weil die
// flachen Felder oben weiterhin den Leitmarkt tragen.
const StandardVorlage = "🛒 {{.Titel}} {{.ASIN}} {{.Mention}}\n" +
	"🏬 [{{.EKHost}}]({{.EKUrl}})\n" +
	"💰 EK: {{.EK}} {{.EKNotiz}}\n" +
	MaerkteZeilen +
	":bar_chart: [ArbitrageOne Export]({{.AOUrl}})"
```

In `internal/post/render_test.go` den Wächter aus Task 2 (`TestStandardVorlageBleibtVorerstUnveraendert`) durch seine Umkehrung ersetzen:

```go
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
```

Ein Test in `internal/store`, der den Wortlaut der Vorgabe festhält, wird jetzt angepasst — nicht die Konstante. Tests in `internal/web`, die Verkaufspreis, Verkäufe oder Gewinn im Posttext suchen, müssen **grün bleiben, ohne aufgeweicht zu werden**: `baueDeal` füllt die Märkte ja gerade. Muss doch einer aufgeweicht werden, ist das ein Zeichen, dass die Verkabelung unvollständig ist.

- [ ] **Step 5: Run tests**

Run: `go test ./internal/post/ ./internal/web/ ./internal/store/ -v`
Expected: PASS

- [ ] **Step 6: Full suite + commit**

```bash
make test
git add internal/web/ internal/post/
git commit -m "$(cat <<'MSG'
feat(web,post): der Post nennt jeden Zielmarkt

baueDeal füllt post.Daten.Maerkte und daneben weiterhin die flachen
Felder mit den Zahlen des Leitmarkts. Eine gespeicherte Vorlage kennt
.Maerkte nicht, und Render läuft mit missingkey=error — ohne die alten
Felder renderte sie gar nicht mehr.

Die Verkaufszahl wird je Markt geprüft und nennt den Markt im Fehler: ein
"Amazon.IT: 0 Verkäufe" wäre eine falsche, veröffentlichte Aussage über
den Artikel.

Erst hier wird auch die Vorgabe-Vorlage getauscht — vorher liefe ihr
Wiederholungsblock über eine leere Liste und der Post verlöre Preis,
Verkäufe und Gewinn.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Schritt 2 — Kästchen statt Auswahlfeld, Leitmarkt, Einstellung als Liste

**Files:**
- Modify: `internal/web/templates/deal.html` (Fragment `schritt2`)
- Modify: `internal/web/templates/einstellungen.html`
- Modify: `internal/web/settings.go` (`speichereEinstellungen`)
- Modify: `internal/web/deal.go` (`zeigeDeal`, `ladeDeal`)
- Modify: `internal/store/settings.go` (Vorgabewert)
- Test: `internal/web/deal_test.go`, `internal/web/settings_test.go`

**Interfaces:**
- Consumes: `marketplace.CodesAusListe` (Task 1)
- Produces: Einstellung `deal.standard_zielmarkt` enthält künftig eine kommagetrennte Liste; Formularfelder `zielmarkt` (Kästchen, mehrfach) und `leitmarkt` (Radio)

- [ ] **Step 1: Write the failing tests**

```go
func TestSchritt2BietetJedenMarktAlsKaestchen(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/preis",
		url.Values{"einkaufslink": {"https://www.amazon.es/dp/B01636IZ0G"}}.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, `type="checkbox" name="zielmarkt"`) {
		t.Errorf("Schritt 2 hat keine Kästchen:\n%s", koerper)
	}
	if !strings.Contains(koerper, `type="radio" name="leitmarkt"`) {
		t.Errorf("Schritt 2 hat keine Leitmarkt-Wahl:\n%s", koerper)
	}
}

func TestStartseiteHaktDieStandardMaerkteAn(t *testing.T) {
	srv, s := testServer(t)
	if err := s.SetzeEinstellung(store.SchluesselZielmarkt, "DE,IT"); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/", "")
	koerper := w.Body.String()
	for _, muss := range []string{`value="DE" checked`, `value="IT" checked`} {
		if !strings.Contains(strings.ReplaceAll(koerper, "\n", " "), muss) {
			t.Errorf("Startseite hakt %q nicht an:\n%s", muss, koerper)
		}
	}
}

// Ohne Zielmarkt gibt es nichts zu laden. Die Rückfrage bleibt in Schritt 2,
// statt in Schritt 3 als Rechenfehler aufzuschlagen.
func TestLadenOhneMarktBleibtInSchritt2(t *testing.T) {
	srv, _ := testServer(t)

	v := schritt2Werte()
	delete(v, "zielmarkt")
	delete(v, "leitmarkt")

	w := hole(t, srv, http.MethodPost, "/deal/laden", v.Encode())
	koerper := w.Body.String()
	if !strings.Contains(koerper, schritt2Kennung) {
		t.Errorf("nicht in Schritt 2 geblieben:\n%s", koerper)
	}
	if !strings.Contains(koerper, "Zielmarktplatz") {
		t.Errorf("keine Rückfrage nach dem Zielmarktplatz:\n%s", koerper)
	}
}
```

In `internal/web/settings_test.go`:

```go
func TestEinstellungenSpeichernMehrereStandardMaerkte(t *testing.T) {
	srv, s := testServer(t)

	v := url.Values{}
	v["deal.standard_zielmarkt"] = []string{"DE", "IT", "ES"}

	w := hole(t, srv, http.MethodPost, "/einstellungen", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	if got := s.Einstellung(store.SchluesselZielmarkt); got != "DE,IT,ES" {
		t.Errorf("Einstellung = %q, will \"DE,IT,ES\"", got)
	}
}

// Kein angehaktes Kästchen wäre ein Zustand, aus dem der Funnel nicht
// herauskäme: Schritt 2 böte nichts Vorgewähltes und Schritt 3 nichts zu
// rechnen. Darum abgelehnt wie eine leere Vorlage.
func TestEinstellungenLehnenLeereMarktlisteAb(t *testing.T) {
	srv, s := testServer(t)
	_ = s.SetzeEinstellung(store.SchluesselZielmarkt, "DE,IT")

	v := url.Values{}
	v["deal.standard_zielmarkt"] = []string{""}

	w := hole(t, srv, http.MethodPost, "/einstellungen", v.Encode())
	if !strings.Contains(w.Body.String(), "Zielmarkt") {
		t.Errorf("keine Meldung zur leeren Marktliste:\n%s", w.Body.String())
	}
	if got := s.Einstellung(store.SchluesselZielmarkt); got != "DE,IT" {
		t.Errorf("Einstellung = %q, will unverändert \"DE,IT\"", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/web/ -run 'TestSchritt2|TestStartseiteHakt|TestLadenOhneMarkt|TestEinstellungen' -v`
Expected: FAIL

- [ ] **Step 3: Vorgabewert als Liste**

In `internal/store/settings.go`, in `vorgaben`:

```go
	// Eine Liste, nicht ein Markt: verkauft wird oft auf mehreren
	// Marktplätzen zugleich. Der erste Eintrag ist der Leitmarkt.
	SchluesselZielmarkt: "DE",
```
(Der Wert bleibt "DE" — eine einelementige Liste. Nur der Kommentar wird ergänzt; die Form ändert sich, nicht die Bedeutung.)

- [ ] **Step 4: Schritt 2 in der Vorlage**

Das `fieldset` „Zielmarktplatz" ersetzen:

```
  <fieldset><legend>Zielmarktplätze</legend>
    {{/* Kästchen statt Auswahlfeld: verkauft wird oft auf mehreren
         Marktplätzen zugleich. Der Leitmarkt daneben ist der, an dem alles
         hängt, was es nur einmal geben kann — Artikelname, Bild, Chart und
         die Zahlen der Historienzeile. */}}
    <table class="marktwahl">
      <tr><th>verkaufen</th><th>Leitmarkt</th><th></th></tr>
      {{range .Maerkte}}{{$c := printf "%s" .Code}}
      <tr>
        <td><input type="checkbox" name="zielmarkt" value="{{$c}}"
                   {{if $.Formular.MarktGewaehlt .Code}}checked{{end}}></td>
        <td><input type="radio" name="leitmarkt" value="{{$c}}"
                   {{if eq $c (printf "%s" $.Formular.Leitmarkt)}}checked{{end}}></td>
        <td>Amazon.{{$c}}</td>
      </tr>
      {{end}}
    </table>
  </fieldset>
```

Dazu in `dealformular.go`:

```go
// MarktGewaehlt sagt, ob ein Markt angehakt ist. Für die Vorlage —
// html/template kann nicht suchen.
func (f dealFormular) MarktGewaehlt(c marketplace.Code) bool {
	_, ok := f.Markt(c)
	return ok
}
```

Schritt 2 bindet `verborgen-maerkte` **nicht** ein: die Kästchen senden `zielmarkt` und `leitmarkt` bereits selbst, und ein zweites Element gleichen Namens sendete einen zweiten Wert.

- [ ] **Step 5: `zeigeDeal` und `ladeDeal`**

In `zeigeDeal` den provisorischen Block aus Task 5 durch die endgültige Fassung ersetzen:

```go
	// Die Vorauswahl kommt aus den Einstellungen; der erste Eintrag ist der
	// Leitmarkt. Bleibt nichts übrig — nur bei einer von Hand veränderten
	// Datenbank —, gilt der erste geführte Markt, damit Schritt 2 nie ohne
	// Vorauswahl dasteht.
	gewaehlt := marketplace.CodesAusListe(srv.store.Einstellung(store.SchluesselZielmarkt))
	if len(gewaehlt) == 0 {
		gewaehlt = marketplace.All()[:1]
	}
	for _, m := range gewaehlt {
		d.Formular.Maerkte = append(d.Formular.Maerkte, marktFormular{Code: m.Code})
	}
	d.Formular.Leitmarkt = leitmarktAufloesen("", d.Formular.Maerkte)
```

In `ladeDeal` den bisherigen Zielmarkt-Test ersetzen:

```go
	if len(d.Formular.Maerkte) == 0 {
		d.Fehler = "Bitte mindestens einen Zielmarktplatz wählen."
		srv.rendere(w, "schritt2", d)
		return
	}
```

- [ ] **Step 6: Einstellungsseite**

In `einstellungen.html` das `select` durch Kästchen ersetzen:

```
    <fieldset class="eingerueckt"><legend>Standard-Zielmärkte</legend>
      <small>vorgewählt in Schritt 2; der erste angehakte ist der Leitmarkt</small>
      {{/* Ein leeres verborgenes Feld vor den Kästchen: ein nicht angehaktes
           Kästchen sendet gar nichts, und ohne dieses Feld käme eine
           vollständig leere Auswahl als "Schlüssel fehlt" an — die Ablehnung
           unten liefe dann nie, und wer alle Haken entfernt bekäme eine
           Erfolgsmeldung, während die alte Einstellung stehen bliebe. Der
           leere Wert selbst fällt in marketplace.Codes weg. */}}
      <input type="hidden" name="deal.standard_zielmarkt" value="">
      {{range .Maerkte}}<label class="teil"><input type="checkbox"
        name="deal.standard_zielmarkt" value="{{.Code}}"
        {{if $.StandardMarkt .Code}}checked{{end}}> {{.Code}}</label>{{end}}
    </fieldset>
```

In `settings.go` dazu:

```go
// StandardMarkt sagt, ob ein Markt in den Standard-Zielmärkten steht — für
// die Vorlage, die nicht suchen kann.
func (d einstellungenDaten) StandardMarkt(c marketplace.Code) bool {
	for _, m := range marketplace.CodesAusListe(d.Werte["zielmarkt"]) {
		if m.Code == c {
			return true
		}
	}
	return false
}
```

Und in `speichereEinstellungen`, **vor** der generischen Schleife (die nur `werte[0]` nähme und damit alles außer dem ersten Markt verlöre):

```go
	// Die Standard-Zielmärkte kommen als mehrere Kästchen desselben Namens.
	// Die generische Schleife unten nähme nur den ersten Wert und verlöre
	// jeden weiteren — darum hier zusammengefasst und aus r.PostForm
	// entfernt, damit die Schleife sie nicht ein zweites Mal überschreibt.
	if r.PostForm.Has(store.SchluesselZielmarkt) {
		var codes []string
		for _, m := range marketplace.Codes(r.PostForm[store.SchluesselZielmarkt]) {
			codes = append(codes, string(m.Code))
		}
		// Kein angehaktes Kästchen wäre ein Zustand, aus dem der Funnel nicht
		// herauskäme: Schritt 2 böte nichts Vorgewähltes. Abgelehnt wie eine
		// leere Vorlage, statt ihn zu speichern.
		if len(codes) == 0 {
			d.Fehler = "Mindestens ein Standard-Zielmarkt muss angehakt sein."
			d.Vorschau, _ = post.Render(d.Werte["vorlage"], beispielDaten())
			srv.rendere(w, "einstellungen", d)
			return
		}
		if err := srv.store.SetzeEinstellung(store.SchluesselZielmarkt, strings.Join(codes, ",")); err != nil {
			srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
			return
		}
		delete(r.PostForm, store.SchluesselZielmarkt)
	}
```

- [ ] **Step 7: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS

- [ ] **Step 8: Full suite + commit**

```bash
make test
git add internal/web/ internal/store/settings.go
git commit -m "$(cat <<'MSG'
feat(web,store): mehrere Zielmärkte wählen, einer führt

Schritt 2 hat Kästchen statt eines Auswahlfelds und daneben die Wahl des
Leitmarkts. Die Einstellung deal.standard_zielmarkt ist jetzt eine Liste;
ein gespeichertes einzelnes "DE" bleibt als einelementige Liste gültig —
die Einstellung ändert ihre Form, nicht ihre Bedeutung.

Eine leere Auswahl wird abgelehnt wie eine leere Vorlage: sie wäre ein
Zustand, aus dem der Funnel nicht herauskäme.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: Schritt 4 — ein Tag je Markt, Hinweis auf alte Vorlagen

**Files:**
- Modify: `internal/web/deal.go` (`fuelleTagAuswahl`, `dealSeite`)
- Modify: `internal/web/templates/deal.html` (Fragment `schritt4`)
- Modify: `internal/web/templates/einstellungen.html`, `internal/web/settings.go` (`MaerkteZeilen` zum Kopieren)
- Test: `internal/web/deal_tag_test.go`

**Interfaces:**
- Consumes: `srv.vkTag(f, ziel)` (Task 5), `post.MaerkteZeilen` (Task 2)
- Produces:
  - `type tagAuswahl struct { Code string; Tags []store.AffiliateTag; TagID int64; OhneTag bool }`
  - `dealSeite.TagAuswahl []tagAuswahl` (ersetzt `dealSeite.Tags` und `dealSeite.OhneTag`)
  - `dealSeite.VorlageOhneMaerkte bool`

- [ ] **Step 1: Write the failing tests**

An `internal/web/deal_tag_test.go` anhängen:

```go
func TestSchritt4BietetJedemMarktSeinenTag(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: "https://x/1"})

	// tagAnlegen statt store.TagAnlegen: letzteres verwirft das Standard-Feld
	// absichtlich (siehe den Kommentar dort — der Weg zum Standard führt
	// ausschließlich über TagStandardSetzen). Mit store.TagAnlegen hätte
	// dieser Test überhaupt keinen Standard-Tag, beide Märkte zeigten ihren
	// "ohne Affiliate-Tag"-Hinweis, kein Link trüge ein ?tag= — und er wäre
	// trotzdem grün, weil er nur Feldnamen und Optionstexte prüft.
	tagAnlegen(t, s, "DE-Tag", "lugru-de-21", "DE")
	tagAnlegen(t, s, "IT-Tag", "lugru-it-21", "IT")

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode())
	koerper := w.Body.String()

	for _, muss := range []string{`name="tag.DE"`, `name="tag.IT"`, "lugru-de-21", "lugru-it-21"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Schritt 4 enthält %q nicht:\n%s", muss, koerper)
		}
	}

	// Und jeder Markt hat SEINEN Tag vorgewählt und im Link — das ist die
	// eigentliche Zusicherung. Ohne sie bliebe der Test grün, während beide
	// Auswahlfelder auf "kein Tag" stünden.
	if !strings.Contains(koerper, "?tag=lugru-de-21") || !strings.Contains(koerper, "?tag=lugru-it-21") {
		t.Errorf("nicht jeder Markt trägt seinen Tag im Link:\n%s", koerper)
	}
	if n := strings.Count(koerper, "selected"); n < 2 {
		t.Errorf("%d vorgewählte Tags, will mindestens zwei:\n%s", n, koerper)
	}
}

// Eine gespeicherte Vorlage ohne .Maerkte postet stillschweigend nur den
// Leitmarkt, während vier gewählt sind. Der Hinweis sagt, warum — ein Fehler
// wäre falsch: die Vorlage ist nicht kaputt, nur älter als diese Änderung.
func TestSchritt4WeistAufAlteVorlageHin(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: "https://x/1"})
	_ = s.SetzeEinstellung(store.SchluesselVorlage,
		"🛒 {{.Titel}}\n💸 VK: {{.VK}} Amazon.{{.Zielmarkt}}\n🤑 {{.Gewinn}} / {{.Marge}}")

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode())
	if !strings.Contains(w.Body.String(), "Vorlage") {
		t.Errorf("kein Hinweis auf die alte Vorlage:\n%s", w.Body.String())
	}
}

// Bei einem Markt gibt es nichts zu bemängeln — die alte Vorlage zeigt genau
// ihn, und ein Hinweis wäre Lärm.
func TestSchritt4SchweigtBeiEinemMarkt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: "https://x/1"})
	_ = s.SetzeEinstellung(store.SchluesselVorlage,
		"🛒 {{.Titel}}\n💸 VK: {{.VK}} Amazon.{{.Zielmarkt}}\n🤑 {{.Gewinn}} / {{.Marge}}")

	w := hole(t, srv, http.MethodPost, "/deal/vorschau",
		mitFeld(referenzFormular(cid), "channel_id", itoa(cid)).Encode())
	if strings.Contains(w.Body.String(), "zeigt nur den Leitmarkt") {
		t.Errorf("Hinweis bei einem Markt:\n%s", w.Body.String())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/web/ -run TestSchritt4 -v`
Expected: FAIL

- [ ] **Step 3: `tagAuswahl` je Markt**

In `deal.go`: `Tags []store.AffiliateTag` und `OhneTag bool` aus `dealSeite` entfernen, dafür:

```go
	// TagAuswahl ist je Markt ein Auswahlfeld. Ein Tag verdient nur auf dem
	// Markt, für den er ausgestellt wurde — die Bindung ist eine Regel, keine
	// Empfehlung, und darum bekommt jeder Markt seine eigene Liste.
	TagAuswahl []tagAuswahl

	// VorlageOhneMaerkte sagt, dass die gespeicherte Vorlage .Maerkte nicht
	// kennt und der Post darum nur den Leitmarkt nennt, obwohl mehrere Märkte
	// gewählt sind. Ein Hinweis, kein Fehler: die Vorlage ist nicht kaputt,
	// nur älter als diese Änderung.
	VorlageOhneMaerkte bool
```

```go
// tagAuswahl ist das Tag-Auswahlfeld eines Marktes in Schritt 4.
type tagAuswahl struct {
	Code string
	Tags []store.AffiliateTag
	// TagID ist der aufgelöste Tag — dieselbe Auflösung, die auch den Link
	// baut (vkTag). Zwei getrennte Rechnungen könnten auseinanderlaufen, und
	// dann zeigte das Feld einen anderen Tag an, als der Post trägt.
	TagID   int64
	OhneTag bool
}
```

`fuelleTagAuswahl` läuft über die Märkte:

```go
// fuelleTagAuswahl bestückt je Markt ein Auswahlfeld und legt fest, welcher
// Eintrag darin vorausgewählt ist.
//
// Der aufgelöste Tag wandert dabei zurück ins Formular. Damit trägt die
// nächste Anfrage ihn ausdrücklich mit, statt erneut auf den Standard zu
// fallen — und ein abgewählter Markt korrigiert eine stehengebliebene Tag-ID
// sichtbar im Feld, nicht nur unsichtbar im Link.
func (srv *Server) fuelleTagAuswahl(d *dealSeite) {
	d.TagAuswahl = make([]tagAuswahl, 0, len(d.Formular.Maerkte))
	for i := range d.Formular.Maerkte {
		c := d.Formular.Maerkte[i].Code
		tags, _ := srv.store.TagsFuerMarkt(string(c))

		t, gefunden := srv.vkTag(d.Formular, c)
		d.Formular.Maerkte[i].TagID = t.ID
		d.Formular.Maerkte[i].TagGesetzt = true

		d.TagAuswahl = append(d.TagAuswahl, tagAuswahl{
			Code: string(c), Tags: tags, TagID: t.ID, OhneTag: !gefunden,
		})
	}
}
```

Der Hinweis auf die alte Vorlage — in `vorschauDeal` und `sendeDeal` nach `fuelleTagAuswahl`:

```go
	// strings.Contains statt die Vorlage zu parsen: gesucht wird, ob sie das
	// Feld überhaupt erwähnt, und dafür reicht der Name. Ein falscher Treffer
	// (etwa ".Maerkte" in einem Kommentar) führt nur dazu, dass der Hinweis
	// ausbleibt — die Vorschau darunter zeigt ohnehin, was hinausgeht.
	d.VorlageOhneMaerkte = len(d.Formular.Maerkte) > 1 &&
		!strings.Contains(srv.store.Einstellung(store.SchluesselVorlage), ".Maerkte")
```

- [ ] **Step 4: Schritt 4 in der Vorlage**

Das eine Tag-`label` durch eines je Markt ersetzen. `tagAuswahl` bringt seine eigene `TagID` mit, darum braucht die Vorlage keine Hilfsfunktion — `$gewaehlt` hält sie über die innere Schleife hinweg fest:

```
  {{range .TagAuswahl}}{{$gewaehlt := .TagID}}
  <label>Affiliate-Tag Amazon.{{.Code}}
    <select name="tag.{{.Code}}" hx-post="/deal/vorschau" hx-target="#funnel">
      <option value="0">— kein Tag —</option>
      {{range .Tags}}<option value="{{.ID}}"
        {{if eq .ID $gewaehlt}}selected{{end}}>{{.Name}} ({{.Tag}}){{if .Standard}} — Standard{{end}}</option>{{end}}
    </select></label>
  {{if .OhneTag}}<p class="hinweis">Amazon.{{.Code}} ohne Affiliate-Tag — der Verkaufslink verdient dort keine Provision.</p>{{end}}
  {{end}}

  {{if .VorlageOhneMaerkte}}
  <p class="hinweis">Die gespeicherte Post-Vorlage kennt die Marktzeilen noch nicht und
    zeigt nur den Leitmarkt. Der Block zum Einfügen steht in den
    <a href="/einstellungen">Einstellungen</a>.</p>
  {{end}}
```

Schritt 4 bindet `verborgen-marktzahlen` weiterhin ein (die Zahlen sind hier nicht sichtbar), aber ohne `tag.*` — die Auswahlfelder senden das selbst.

- [ ] **Step 5: `MaerkteZeilen` zum Kopieren anbieten**

In `settings.go`, `einstellungenDaten`: `MaerkteZeilen string` neben `PanEUZeile` ergänzen und mit `post.MaerkteZeilen` füllen. In `einstellungen.html` neben dem bestehenden `<pre class="vorschau">{{.PanEUZeile}}</pre>` ein zweites:

```
    <p><small>Je Zielmarkt eine Zeile — wer die Vorlage schon einmal
      gespeichert hat, fügt diesen Block ein:</small></p>
    <pre class="vorschau">{{.MaerkteZeilen}}</pre>
```

- [ ] **Step 6: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS

- [ ] **Step 7: Full suite + commit**

```bash
make test
git add internal/web/
git commit -m "$(cat <<'MSG'
feat(web): ein Affiliate-Tag je Zielmarkt, Hinweis auf alte Vorlagen

Jeder Markt bekommt sein eigenes Auswahlfeld mit seinen eigenen Tags. Die
Bindung an den Markt ist eine Regel und keine Empfehlung — ein DE-Tag an
einem amazon.it-Link verdient nichts, und niemand sähe es ihm an.

Dazu der Hinweis, wenn die gespeicherte Vorlage .Maerkte nicht kennt und
darum nur den Leitmarkt zeigt, obwohl mehrere gewählt sind. Ein Hinweis,
kein Fehler: die Vorlage ist nicht kaputt, nur älter als diese Änderung.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: `sendeDeal` — Chart des Leitmarkts, Märkte in die Historie

**Files:**
- Modify: `internal/web/deal.go` (`sendeDeal`)
- Test: `internal/web/deal_test.go`

**Interfaces:**
- Consumes: `store.Deal.Maerkte`, `store.DealMarkt`, `store.DealMarktPanEU` (Task 3); `dealErgebnis.Maerkte` (Task 6)
- Produces: keine neuen — `sendeDeal` füllt nur mehr aus

- [ ] **Step 1: Write the failing test**

```go
func TestPostenSpeichertJedenMarkt(t *testing.T) {
	srv, s := testServer(t)
	discordServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"4711"}`))
	}))
	t.Cleanup(discordServer.Close)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: discordServer.URL})

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))
	v.Set("ohne_chart", "1")

	w := hole(t, srv, http.MethodPost, "/deal/senden", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	deals, err := s.Deals(store.DealFilter{})
	if err != nil || len(deals) != 1 {
		t.Fatalf("Deals = %v, %v — will genau einen", deals, err)
	}
	// Ein Post, eine Zeile: der Nachrichtentext steht einmal in der
	// Datenbank, nicht je Markt erneut.
	if deals[0].Zielmarkt != "DE" {
		t.Errorf("Zielmarkt = %q, will den Leitmarkt DE", deals[0].Zielmarkt)
	}

	maerkte, err := s.DealMaerkte([]int64{deals[0].ID})
	if err != nil {
		t.Fatalf("DealMaerkte: %v", err)
	}
	if len(maerkte[deals[0].ID]) != 2 {
		t.Fatalf("%d Marktzeilen, will 2", len(maerkte[deals[0].ID]))
	}
}
```

Den in `deal_test.go` bereits vorhandenen Weg benutzen, mit dem Tests einen Discord-Webhook nachstellen — falls dort schon ein Helfer existiert, den statt eines neuen `httptest.NewServer` verwenden.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/web/ -run TestPostenSpeichertJedenMarkt -v`
Expected: FAIL — keine Marktzeilen gespeichert.

- [ ] **Step 3: `sendeDeal` umbauen**

Chart und Deal-Zeile hängen am Leitmarkt, die Marktzeilen kommen daneben:

```go
	leit := erg.Leit()

	// Der Chart wird jetzt geholt und genau dieses Bild wird gesendet und
	// archiviert — so zeigt die Historie später denselben Stand. Einer, der
	// des Leitmarkts: vier Charts an einer Nachricht kosteten vier
	// Keepa-Abrufe je Post und machten sie schwer, ohne die
	// Kaufentscheidung zu verbessern.
	png, chartErr := srv.keepa.Chart(r.Context(), d.Formular.ASIN, leit.Ziel.ChartDomain, srv.chartOptionen())
```

(Der Rest des Chart-Blocks, der Discord-Versand und die Fehlerbehandlung bleiben unverändert.)

Vor `DealAnlegen` die Marktzeilen bauen:

```go
	// Die Marktzeilen tragen dieselben Zahlen wie der gesendete Post. Die
	// Quellen ("keepa", "standardwert", "EFN-Tarif · Standardpaket") kommen
	// aus dem Formular — in der Historie soll später ablesbar sein, woher
	// jede Zahl stammte.
	maerkte := make([]store.DealMarkt, 0, len(erg.Maerkte))
	for _, m := range erg.Maerkte {
		mf, _ := d.Formular.Markt(m.Ziel.Code)
		dm := store.DealMarkt{
			Markt: string(m.Ziel.Code), Leitmarkt: m.Leitmarkt,
			VKCent: m.VKBrutto, VKQuelle: mf.VKQuelle,
			Sales: m.Sales, SalesQuelle: mf.SalesQuelle,
			ProvisionProzent: m.Provision, ProvisionQuelle: mf.ProvisionQuelle,
			FBACent: m.FBA, FBAQuelle: mf.FBAQuelle,
			GewinnCent: m.Ergebnis.Gewinn, MargeProzent: m.Ergebnis.MargeProzent,
		}
		// Nur wo es den Vergleich gibt. Ein Nullwert stünde sonst als
		// Aussage da, die niemand gerechnet hat.
		if m.PanEU != nil {
			dm.PanEU = &store.DealMarktPanEU{
				FBACent:      m.PanEUGebuehr,
				GewinnCent:   m.PanEU.Gewinn,
				MargeProzent: m.PanEU.MargeProzent,
			}
		}
		maerkte = append(maerkte, dm)
	}
```

Und im `store.Deal`-Literal die marktabhängigen Felder auf `leit` umstellen sowie `Maerkte` ergänzen:

```go
		Zielmarkt: string(leit.Ziel.Code),
		VKCent:    leit.VKBrutto, VKQuelle: d.Formular.Leit().VKQuelle,
		Sales: leit.Sales, SalesQuelle: d.Formular.Leit().SalesQuelle,
		ProvisionProzent: leit.Provision, ProvisionQuelle: d.Formular.Leit().ProvisionQuelle,
		FBACent: leit.FBA, FBAQuelle: d.Formular.Leit().FBAQuelle,
		EKCent:     leit.Ergebnis.EKBrutto,
		GewinnCent: leit.Ergebnis.Gewinn, MargeProzent: leit.Ergebnis.MargeProzent,
		Maerkte:    maerkte,
```

- [ ] **Step 4: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS

- [ ] **Step 5: Full suite + commit**

```bash
git add internal/web/
make test
git commit -m "$(cat <<'MSG'
feat(web): Chart und Historienzeile vom Leitmarkt, Märkte daneben

Ein Post, eine Deal-Zeile, ein Chart — und je Markt eine Zeile in
deal_maerkte, samt Pan-EU-Vergleich, wo es ihn gibt.

Die deals-Zeile trägt die Zahlen des Leitmarkts. Bei einem Markt ist das
dieselbe Zeile wie bisher; alte Zeilen und jede bestehende Auswertung
bleiben vergleichbar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: Historie — die Märkte eines Posts anzeigen

**Files:**
- Modify: `internal/web/history.go`
- Modify: `internal/web/templates/historie.html`
- Test: `internal/web/history_test.go`

**Interfaces:**
- Consumes: `store.DealMaerkte(ids)` (Task 3)
- Produces: `type historieMarkt struct { Code string; Leitmarkt bool; VK, Sales, Provision, FBA, Gewinn, Marge, FBAPanEU, GewinnPanEU, MargePanEU, Quellen string }`, `historieZeile.Maerkte []historieMarkt`

- [ ] **Step 1: Write the failing test**

```go
func TestHistorieZeigtDieMaerkteEinesPosts(t *testing.T) {
	srv, s := testServer(t)

	d := store.Deal{
		ASIN: "B01636IZ0G", Titel: "Makita HR2630",
		Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, EKArt: "brutto", VKCent: 20749,
		Sales: 40, ProvisionProzent: 15, FBACent: 864,
		UStModus: "netto", GewinnCent: 2670, MargeProzent: 12.9,
		ChannelID: 1, ChannelName: "deals", NachrichtText: "Text",
		Maerkte: []store.DealMarkt{
			{Markt: "DE", Leitmarkt: true, VKCent: 20749, Sales: 40,
				ProvisionProzent: 15, FBACent: 864, GewinnCent: 2670, MargeProzent: 12.9},
			{Markt: "IT", VKCent: 18900, Sales: 12,
				ProvisionProzent: 15, FBACent: 1806, GewinnCent: 320, MargeProzent: 1.7,
				PanEU: &store.DealMarktPanEU{FBACent: 577, GewinnCent: 1548, MargeProzent: 8.2}},
		},
	}
	if _, err := s.DealAnlegen(d); err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/historie", "")
	koerper := w.Body.String()
	for _, muss := range []string{"IT", "189,00", "3,20", "15,48"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Historie enthält %q nicht:\n%s", muss, koerper)
		}
	}
}

// Jeder bisherige Deal hat keine Marktzeilen. Die Historie zeigt dann kein
// leeres Aufklappen, sondern gar keines.
func TestHistorieOhneMaerkteZeigtKeineMarkttabelle(t *testing.T) {
	srv, s := testServer(t)
	if _, err := s.DealAnlegen(store.Deal{
		ASIN: "B01636IZ0G", Titel: "Alt", Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, VKCent: 20749, ChannelID: 1, ChannelName: "deals",
		NachrichtText: "Text",
	}); err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/historie", "")
	if strings.Contains(w.Body.String(), "Zielmärkte") {
		t.Errorf("leere Markttabelle bei einem alten Deal:\n%s", w.Body.String())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/web/ -run TestHistorie -v`
Expected: FAIL — die Historie kennt die Märkte nicht.

- [ ] **Step 3: Märkte an die Zeilen hängen**

In `history.go`, neben `historieZeile`:

```go
// historieMarkt ist ein Zielmarkt in der aufgeklappten Ansicht eines Deals.
//
// Alle Felder sind fertig formatiert, wie bei historieZeile und aus demselben
// Grund: html/template kann nicht rechnen und nicht formatieren.
type historieMarkt struct {
	Code      string
	Leitmarkt bool

	VK        string
	Sales     string
	Provision string
	FBA       string
	Gewinn    string
	Marge     string

	// Leer, wo es den Vergleich nicht gab. Die Vorlage fragt mit {{if}}
	// danach; ein "0,00 €" stünde sonst als Aussage da, die niemand
	// gerechnet hat.
	FBAPanEU    string
	GewinnPanEU string
	MargePanEU  string

	// Quellen sagt, woher die Zahlen dieses Marktes stammten. Beim
	// Nachlesen eines alten Posts ist das oft die eigentliche Frage.
	Quellen string
}
```

In `historieZeile` ergänzen:

```go
	// Maerkte sind die Zielmärkte dieses Posts. Leer bei jedem Deal, der vor
	// dieser Spalte gepostet wurde — die Vorlage zeigt dann gar keine
	// Markttabelle statt einer leeren.
	Maerkte []historieMarkt
```

In `zeigeHistorie`, nachdem die Deals geladen und die Zeilen gebaut sind, in einem Zug nachladen:

```go
	// Eine Abfrage für die ganze Seite statt einer je Zeile: die Historie
	// zeigt fünfzig Deals gleichzeitig, und fünfzig Abfragen wären fünfzig
	// Sperren auf derselben einen SQLite-Verbindung.
	ids := make([]int64, 0, len(zeilen))
	for _, z := range zeilen {
		ids = append(ids, z.ID)
	}
	nachMarkt, err := srv.store.DealMaerkte(ids)
	if err != nil {
		// Die Märkte sind Beiwerk; die Historie selbst ist die Hauptsache.
		// Ein Fehler hier darf die Liste nicht verschlucken.
		d.Fehler = sicherFehlertext(err.Error())
	}
	for i := range zeilen {
		for _, m := range nachMarkt[zeilen[i].ID] {
			hm := historieMarkt{
				Code: m.Markt, Leitmarkt: m.Leitmarkt,
				VK: m.VKCent.Euro(), Sales: strconv.Itoa(m.Sales),
				Provision: zahlText(m.ProvisionProzent) + " %",
				FBA:       m.FBACent.Euro(),
				Gewinn:    m.GewinnCent.Euro(),
				Marge:     prozent(m.MargeProzent, 1),
				Quellen: "VK " + m.VKQuelle + " · Sales " + m.SalesQuelle +
					" · Provision " + m.ProvisionQuelle + " · FBA " + m.FBAQuelle,
			}
			if m.PanEU != nil {
				hm.FBAPanEU = m.PanEU.FBACent.Euro()
				hm.GewinnPanEU = m.PanEU.GewinnCent.Euro()
				hm.MargePanEU = prozent(m.PanEU.MargeProzent, 1)
			}
			zeilen[i].Maerkte = append(zeilen[i].Maerkte, hm)
		}
	}
```

(Namen der lokalen Variablen an die vorhandene Fassung von `zeigeHistorie` anpassen — dort heißt die Zeilenliste möglicherweise anders.)

- [ ] **Step 4: Die Tabelle in der Vorlage**

In `historie.html`, im bestehenden `<tr><td colspan="8">` **nach** dem `<details>` „Gesendeter Text" ein zweites einfügen:

```
    {{if .Maerkte}}
    <details><summary>Zielmärkte ({{len .Maerkte}})</summary>
      <table class="rechnung">
        <tr><th>Markt</th><th class="zahl">VK</th><th class="zahl">Verk.</th>
            <th class="zahl">Provision</th><th class="zahl">FBA</th>
            <th class="zahl">Gewinn</th><th class="zahl">Marge</th>
            <th class="zahl">FBA lokal</th><th class="zahl">Gewinn Pan-EU</th>
            <th class="zahl">Marge Pan-EU</th></tr>
        {{range .Maerkte}}
        <tr><td>Amazon.{{.Code}}{{if .Leitmarkt}} ★{{end}}</td>
            <td class="zahl">{{.VK}}</td><td class="zahl">{{.Sales}}</td>
            <td class="zahl">{{.Provision}}</td><td class="zahl">{{.FBA}}</td>
            <td class="zahl">{{.Gewinn}}</td><td class="zahl">{{.Marge}}</td>
            <td class="zahl">{{.FBAPanEU}}</td><td class="zahl">{{.GewinnPanEU}}</td>
            <td class="zahl">{{.MargePanEU}}</td></tr>
        <tr><td colspan="10" class="herkunft">{{.Quellen}}</td></tr>
        {{end}}
      </table>
    </details>
    {{end}}
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/web/ -v`
Expected: PASS

- [ ] **Step 6: Full suite + commit**

```bash
make test
git add internal/web/
git commit -m "$(cat <<'MSG'
feat(web): die Zielmärkte eines Posts in der Historie

Neben "Gesendeter Text" klappt jetzt eine Markttabelle auf: je Markt VK,
Verkäufe, Provision, FBA, Gewinn und Marge, dazu der Pan-EU-Vergleich, wo
es ihn gab, und die Herkunft jeder Zahl.

Geladen in einer Abfrage für die ganze Seite. Fünfzig Deals ergäben sonst
fünfzig Abfragen auf derselben einen SQLite-Verbindung.

Deals ohne Marktzeilen — jeder bisherige — zeigen die Tabelle gar nicht,
statt eine leere aufzuklappen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Abschluss

Nach Task 13 zur Gegenprobe von Hand durchspielen, was kein Test abdeckt:

- [ ] `make test` — der ganze Lauf grün.
- [ ] Anwendung starten, einen Deal mit **einem** Markt (DE) durchspielen: Gewinn und Post müssen aussehen wie vor der Änderung.
- [ ] Denselben Deal mit **vier** Märkten: Übersicht, Kassenbon je Markt umschaltbar, Post mit vier Zeilen, Historie mit vier Marktzeilen.
- [ ] Post-Vorlage in den Einstellungen auf eine alte Fassung ohne `.Maerkte` setzen und prüfen, dass Schritt 4 den Hinweis zeigt und der Post den Leitmarkt nennt.
- [ ] README auf Stellen prüfen, die „den Zielmarktplatz" in der Einzahl beschreiben, und dort nachziehen.
