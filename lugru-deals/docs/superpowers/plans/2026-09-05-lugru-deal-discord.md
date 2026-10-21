# Lugru Deal Discord — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein einzelnes Go-Binary mit lokaler Weboberfläche, das aus einer Amazon-ASIN einen fertig gerechneten Arbitrage-Deal samt Keepa-Preischart über einen Discord-Webhook postet und jeden Post archiviert.

**Architecture:** Reine Rechen- und Zuordnungslogik (`money`, `marketplace`, `calc`, `keepa`, `post`) liegt in abhängigkeitsfreien Paketen, die ohne Netzwerk testbar sind. Darüber liegen die I/O-Pakete (`store`, `discord`) und ganz oben `web` mit serverseitig gerendertem HTML plus htmx. Aufgebaut wird von unten nach oben, jede Aufgabe endet mit grünen Tests und einem Commit.

**Tech Stack:** Go 1.23, `modernc.org/sqlite` (reines Go, kein cgo), htmx 2.x als eingebettete Datei, `html/template` und `text/template` aus der Standardbibliothek. Keine weiteren Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-09-05-lugru-deal-discord-design.md`

## Global Constraints

Diese Vorgaben gelten für **jede** Aufgabe, auch wenn sie dort nicht wiederholt werden.

- **Go 1.23**, Modulpfad `github.com/trinkfreunde/lugru-deal-discord`.
- **`CGO_ENABLED=0` muss durchgehend funktionieren.** Darum `modernc.org/sqlite`, niemals `mattn/go-sqlite3`. Ohne das gibt es keinen Windows-Build ohne C-Toolchain, und das Doppelklick-Binary ist die halbe Existenzberechtigung des Projekts.
- **Geld ist immer `money.Cents` (int64).** `float64` darf in keiner exportierten Signatur auftauchen. Innerhalb einer Berechnung ist `float64` erlaubt, das Ergebnis wird sofort auf Cent gerundet.
- **Keepa: `-1` heißt „kein Wert".** Niemals als `0` behandeln. Dafür gibt es den Typ `keepa.Price` mit `OK bool`; Werte ohne `OK` dürfen nie in eine Rechnung fließen.
- **`csv[18]` (BUY_BOX_SHIPPING) hat Dreiergruppen** `(Zeit, Preis, Versand)`, `csv[0]` (AMAZON) hat Paare `(Zeit, Preis)`. Verifiziert in `Product.java`: `CsvType(int i, boolean price, boolean deal, boolean shipping, boolean extra)` mit `BUY_BOX_SHIPPING(18, true, false, true, true)`.
- **Zwei Zahlenformate, nie vermischen:** Anzeige und Post mit Komma (`130,56 €`), URL-Parameter mit Punkt (`sell_price=207.49`).
- **Marktplätze:** DE = Domain `3` / Chart `de` / 19 %, FR = `4` / `fr` / 20 %, IT = `8` / `it` / 22 %, ES = `9` / `es` / 21 %. Alle in Euro.
- **Kein Test ruft das Netz.** Keepa und Discord werden über `httptest.Server` bedient, Keepa-Antworten liegen als Fixture-Datei im Repo.
- **Bezeichner und Kommentare auf Deutsch**, soweit es die Domäne betrifft (`Gewinn`, `Marge`, `Zielmarkt`). Go-Konventionen bleiben unangetastet.
- **Referenzfall**, gegen den mehrere Aufgaben prüfen — Makita HR2630, ASIN `B01636IZ0G`, ES → DE:

  | Größe | Wert |
  |---|---|
  | EK brutto | 130,56 € (ES, 21 %) |
  | VK brutto | 207,49 € (DE, 19 %) |
  | Provision | 15,0 % |
  | FBA | 8,64 € |
  | **Gewinn** | **31,67 €** |
  | **Marge** | **15,3 %** (auf VK brutto) |

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `go.mod` | Modul, Go-Version, die eine Abhängigkeit |
| `internal/money/money.go` | Cent-Typ, Eingabe parsen, Komma- und Punktformat |
| `internal/marketplace/marketplace.go` | Marktplatz-Tabelle, Produkt-URLs |
| `internal/marketplace/input.go` | ASIN und Amazon-URL erkennen |
| `internal/calc/calc.go` | Gewinn und Marge, netto/brutto |
| `internal/keepa/product.go` | API-Antwort → `Product`, `-1`-Behandlung, Verlauf aus Dreiergruppen |
| `internal/keepa/median.go` | Zeitgewichteter Median |
| `internal/keepa/client.go` | HTTP-Client, Token-Felder, Fehlerklassen |
| `internal/keepa/chart.go` | Chart-URL bauen, PNG holen |
| `internal/post/render.go` | Vorlage prüfen und rendern |
| `internal/post/arbitrageone.go` | ArbitrageOne-URL |
| `internal/discord/webhook.go` | multipart senden, Fehler klassifizieren, Wiederholungen |
| `internal/store/store.go` | Datenbank öffnen, Schema |
| `internal/store/settings.go` | Einstellungen mit Vorgabewerten |
| `internal/store/channels.go` | Channel-CRUD |
| `internal/store/deals.go` | Deals einfügen und suchen |
| `internal/store/cache.go` | Keepa-Zwischenspeicher |
| `internal/store/charts.go` | Chart-PNGs auf der Platte |
| `internal/web/server.go` | Routen, `embed.FS`, Layout |
| `internal/web/settings.go` | Einstellungsseite |
| `internal/web/channels.go` | Channel-Seite |
| `internal/web/deal.go` | Neuer-Deal-Seite, der Kernablauf |
| `internal/web/history.go` | Historie |
| `internal/web/templates/*.html` | HTML-Vorlagen |
| `internal/web/static/` | `style.css`, `htmx.min.js` |
| `cmd/lugru-deals/main.go` | Konfiguration, Start, Browser öffnen |
| `Dockerfile` | Zweistufiger Build |
| `Makefile` | Build für Linux und Windows |

---

### Task 1: Geldbeträge

Fundament für alles Weitere. Ohne saubere Cent-Arithmetik und die Trennung von Komma- und Punktformat stimmen später die Zahlen im Post nicht.

**Files:**
- Create: `go.mod`
- Create: `internal/money/money.go`
- Test: `internal/money/money_test.go`

**Interfaces:**
- Consumes: nichts
- Produces: `money.Cents` (int64), `money.Parse(string) (Cents, error)`, `money.ErrLeer`, `(Cents).String() string` (`"130,56"`), `(Cents).Euro() string` (`"130,56 €"`), `(Cents).Dot() string` (`"130.56"`)

- [ ] **Step 1: Modul anlegen**

```bash
cd /Users/pascalwittler/lugru-deal-discord
go mod init github.com/trinkfreunde/lugru-deal-discord
go mod edit -go=1.23
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

`internal/money/money_test.go`:

```go
package money

import "testing"

func TestParse(t *testing.T) {
	faelle := []struct {
		ein  string
		will Cents
	}{
		{"130,56", 13056},
		{"130.56", 13056},
		{"1.234,56", 123456},
		{"1234,56", 123456},
		{"207,49 €", 20749},
		{" 130,56 ", 13056},
		{"1234", 123400},
		{"0,05", 5},
		{"-12,30", -1230},
		{"8,6", 860},
	}
	for _, f := range faelle {
		got, err := Parse(f.ein)
		if err != nil {
			t.Errorf("Parse(%q): unerwarteter Fehler %v", f.ein, err)
			continue
		}
		if got != f.will {
			t.Errorf("Parse(%q) = %d, will %d", f.ein, got, f.will)
		}
	}
}

func TestParseFehler(t *testing.T) {
	for _, ein := range []string{"", "   ", "abc", "12,345", "12,,3"} {
		if _, err := Parse(ein); err == nil {
			t.Errorf("Parse(%q): Fehler erwartet, kam keiner", ein)
		}
	}
}

func TestFormate(t *testing.T) {
	faelle := []struct {
		c                       Cents
		komma, euro, punkt      string
	}{
		{13056, "130,56", "130,56 €", "130.56"},
		{20749, "207,49", "207,49 €", "207.49"},
		{3167, "31,67", "31,67 €", "31.67"},
		{5, "0,05", "0,05 €", "0.05"},
		{0, "0,00", "0,00 €", "0.00"},
		{-1230, "-12,30", "-12,30 €", "-12.30"},
	}
	for _, f := range faelle {
		if got := f.c.String(); got != f.komma {
			t.Errorf("Cents(%d).String() = %q, will %q", f.c, got, f.komma)
		}
		if got := f.c.Euro(); got != f.euro {
			t.Errorf("Cents(%d).Euro() = %q, will %q", f.c, got, f.euro)
		}
		if got := f.c.Dot(); got != f.punkt {
			t.Errorf("Cents(%d).Dot() = %q, will %q", f.c, got, f.punkt)
		}
	}
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/money/`
Expected: FAIL — `undefined: Parse`, `undefined: Cents`

- [ ] **Step 4: Umsetzen**

`internal/money/money.go`:

```go
// Package money hält Geldbeträge als ganzzahlige Cent-Werte und trennt die
// beiden Schreibweisen, die das Projekt braucht: Komma für die Anzeige,
// Punkt für URL-Parameter.
package money

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Cents ist ein Geldbetrag in der kleinsten Währungseinheit.
type Cents int64

var (
	ErrLeer    = errors.New("kein Betrag angegeben")
	ErrUngueltig = errors.New("kein gültiger Betrag")
)

var wegDamit = strings.NewReplacer("€", "", " ", "", " ", "", "\t", "")

// Parse liest einen von Hand eingegebenen Betrag.
//
// Erlaubt sind "130,56", "130.56", "1.234,56", "1234" und angehängtes "€".
// Ist ein Komma vorhanden, gilt es als Dezimaltrennzeichen und Punkte als
// Tausendertrenner. Ohne Komma zählt ein einzelner Punkt mit höchstens zwei
// Nachkommastellen als Dezimaltrennzeichen, sonst als Tausendertrenner.
func Parse(s string) (Cents, error) {
	s = strings.TrimSpace(wegDamit.Replace(s))
	if s == "" {
		return 0, ErrLeer
	}

	negativ := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")

	var ganz, bruch string
	switch {
	case strings.Contains(s, ","):
		if strings.Count(s, ",") > 1 {
			return 0, ErrUngueltig
		}
		teile := strings.SplitN(strings.ReplaceAll(s, ".", ""), ",", 2)
		ganz, bruch = teile[0], teile[1]
	case strings.Count(s, ".") == 1 && len(s)-strings.Index(s, ".")-1 <= 2:
		teile := strings.SplitN(s, ".", 2)
		ganz, bruch = teile[0], teile[1]
	default:
		ganz = strings.ReplaceAll(s, ".", "")
	}

	if ganz == "" {
		ganz = "0"
	}
	if len(bruch) > 2 {
		return 0, ErrUngueltig
	}
	for len(bruch) < 2 {
		bruch += "0"
	}

	e, err := strconv.ParseInt(ganz, 10, 64)
	if err != nil {
		return 0, ErrUngueltig
	}
	c, err := strconv.ParseInt(bruch, 10, 64)
	if err != nil {
		return 0, ErrUngueltig
	}

	gesamt := Cents(e*100 + c)
	if negativ {
		gesamt = -gesamt
	}
	return gesamt, nil
}

// String liefert das deutsche Format ohne Einheit: "130,56".
func (c Cents) String() string { return c.formatiere(',') }

// Euro hängt das Währungszeichen an: "130,56 €".
func (c Cents) Euro() string { return c.String() + " €" }

// Dot liefert das Punktformat für URL-Parameter: "130.56".
// Niemals für die Anzeige verwenden.
func (c Cents) Dot() string { return c.formatiere('.') }

func (c Cents) formatiere(trenner byte) string {
	vorzeichen := ""
	if c < 0 {
		vorzeichen, c = "-", -c
	}
	return fmt.Sprintf("%s%d%c%02d", vorzeichen, int64(c)/100, trenner, int64(c)%100)
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `go test ./internal/money/ -v`
Expected: PASS für `TestParse`, `TestParseFehler`, `TestFormate`

- [ ] **Step 6: Commit**

```bash
git add go.mod internal/money/
git commit -m "feat(money): Cent-Typ mit Komma- und Punktformat

Trennt bewusst Anzeige (Komma) von URL-Parametern (Punkt) — der
bisherige Post mischte beides und ArbitrageOne braucht den Punkt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Marktplätze und Eingabe-Erkennung

Die Tabelle ist datengetrieben, damit NL oder PL später eine Zeile sind und kein Umbau. Die beiden Domain-Schreibweisen (Zahl für die Produkt-API, Kürzel für den Chart) sind die häufigste Verwechslungsquelle und werden darum getrennt benannt.

**Files:**
- Create: `internal/marketplace/marketplace.go`
- Create: `internal/marketplace/input.go`
- Test: `internal/marketplace/marketplace_test.go`
- Test: `internal/marketplace/input_test.go`

**Interfaces:**
- Consumes: nichts
- Produces:
  - `marketplace.Code` (string) mit `DE`, `FR`, `IT`, `ES`
  - `marketplace.Marketplace{Code Code; KeepaDomain int; ChartDomain string; Host string; TLD string; VATPermille int}`
  - `marketplace.All() []Marketplace`
  - `marketplace.ByCode(Code) (Marketplace, bool)`
  - `marketplace.ByHost(string) (Marketplace, bool)`
  - `(Marketplace).ProductURL(asin string) string`
  - `marketplace.Eingabe{ASIN string; Quelle *Marketplace}`
  - `marketplace.ParseEingabe(string) (Eingabe, error)`, `marketplace.ErrKeineASIN`, `marketplace.ErrUnbekannterMarkt`

- [ ] **Step 1: Den fehlschlagenden Test für die Tabelle schreiben**

`internal/marketplace/marketplace_test.go`:

```go
package marketplace

import "testing"

func TestTabelle(t *testing.T) {
	faelle := []struct {
		code        Code
		keepaDomain int
		chartDomain string
		vatPermille int
		tld         string
	}{
		{DE, 3, "de", 190, "de"},
		{FR, 4, "fr", 200, "fr"},
		{IT, 8, "it", 220, "it"},
		{ES, 9, "es", 210, "es"},
	}
	for _, f := range faelle {
		m, ok := ByCode(f.code)
		if !ok {
			t.Fatalf("ByCode(%q): nicht gefunden", f.code)
		}
		if m.KeepaDomain != f.keepaDomain {
			t.Errorf("%s KeepaDomain = %d, will %d", f.code, m.KeepaDomain, f.keepaDomain)
		}
		if m.ChartDomain != f.chartDomain {
			t.Errorf("%s ChartDomain = %q, will %q", f.code, m.ChartDomain, f.chartDomain)
		}
		if m.VATPermille != f.vatPermille {
			t.Errorf("%s VATPermille = %d, will %d", f.code, m.VATPermille, f.vatPermille)
		}
		if m.TLD != f.tld {
			t.Errorf("%s TLD = %q, will %q", f.code, m.TLD, f.tld)
		}
	}
	if len(All()) != 4 {
		t.Errorf("All() hat %d Einträge, will 4", len(All()))
	}
}

func TestByHost(t *testing.T) {
	faelle := map[string]Code{
		"www.amazon.de": DE,
		"amazon.de":     DE,
		"WWW.AMAZON.ES": ES,
		"amazon.it":     IT,
		"www.amazon.fr": FR,
	}
	for host, will := range faelle {
		m, ok := ByHost(host)
		if !ok {
			t.Errorf("ByHost(%q): nicht gefunden", host)
			continue
		}
		if m.Code != will {
			t.Errorf("ByHost(%q) = %s, will %s", host, m.Code, will)
		}
	}
	if _, ok := ByHost("www.amazon.co.uk"); ok {
		t.Error("ByHost(amazon.co.uk): darf nicht gefunden werden, UK ist nicht unterstützt")
	}
}

func TestProductURL(t *testing.T) {
	m, _ := ByCode(ES)
	will := "https://www.amazon.es/dp/B01636IZ0G"
	if got := m.ProductURL("B01636IZ0G"); got != will {
		t.Errorf("ProductURL = %q, will %q", got, will)
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/marketplace/`
Expected: FAIL — `undefined: ByCode`

- [ ] **Step 3: Tabelle umsetzen**

`internal/marketplace/marketplace.go`:

```go
// Package marketplace hält die unterstützten Amazon-Marktplätze als Daten,
// nicht als Sonderfälle im Code. Ein weiterer Markt ist eine Zeile in tabelle.
package marketplace

import (
	"fmt"
	"strings"
)

// Code ist das Länderkürzel, wie es im Post erscheint.
type Code string

const (
	DE Code = "DE"
	FR Code = "FR"
	IT Code = "IT"
	ES Code = "ES"
)

// Marketplace bündelt alles, was sich je Markt unterscheidet.
//
// KeepaDomain und ChartDomain bezeichnen denselben Markt in zwei
// Schreibweisen: die Produkt-API erwartet die Zahl, graph.keepa.com das
// Kürzel. Sie werden getrennt geführt, damit sie nicht verwechselt werden.
type Marketplace struct {
	Code        Code
	KeepaDomain int    // api.keepa.com, Parameter "domain"
	ChartDomain string // graph.keepa.com, Parameter "domain"
	Host        string
	TLD         string
	VATPermille int // 190 entspricht 19,0 % — Promille, damit ganzzahlig
}

var tabelle = []Marketplace{
	{Code: DE, KeepaDomain: 3, ChartDomain: "de", Host: "www.amazon.de", TLD: "de", VATPermille: 190},
	{Code: FR, KeepaDomain: 4, ChartDomain: "fr", Host: "www.amazon.fr", TLD: "fr", VATPermille: 200},
	{Code: IT, KeepaDomain: 8, ChartDomain: "it", Host: "www.amazon.it", TLD: "it", VATPermille: 220},
	{Code: ES, KeepaDomain: 9, ChartDomain: "es", Host: "www.amazon.es", TLD: "es", VATPermille: 210},
}

// All liefert alle Marktplätze in Anzeigereihenfolge.
func All() []Marketplace {
	kopie := make([]Marketplace, len(tabelle))
	copy(kopie, tabelle)
	return kopie
}

// ByCode sucht anhand des Länderkürzels, unabhängig von Groß- und Kleinschreibung.
func ByCode(c Code) (Marketplace, bool) {
	gesucht := Code(strings.ToUpper(string(c)))
	for _, m := range tabelle {
		if m.Code == gesucht {
			return m, true
		}
	}
	return Marketplace{}, false
}

// ByHost erkennt den Markt am Hostnamen einer Amazon-URL.
func ByHost(host string) (Marketplace, bool) {
	h := strings.ToLower(strings.TrimPrefix(strings.ToLower(host), "www."))
	for _, m := range tabelle {
		if h == strings.TrimPrefix(m.Host, "www.") {
			return m, true
		}
	}
	return Marketplace{}, false
}

// ProductURL baut die Produktseite für diese ASIN auf diesem Markt.
func (m Marketplace) ProductURL(asin string) string {
	return fmt.Sprintf("https://%s/dp/%s", m.Host, asin)
}
```

- [ ] **Step 4: Tabellentests laufen lassen**

Run: `go test ./internal/marketplace/ -run 'TestTabelle|TestByHost|TestProductURL' -v`
Expected: PASS

- [ ] **Step 5: Den fehlschlagenden Test für die Eingabe-Erkennung schreiben**

`internal/marketplace/input_test.go`:

```go
package marketplace

import (
	"errors"
	"testing"
)

func TestParseEingabe(t *testing.T) {
	faelle := []struct {
		ein        string
		willASIN   string
		willQuelle *Code // nil = nackte ASIN ohne erkennbaren Markt
	}{
		{"https://www.amazon.es/dp/B01636IZ0G", "B01636IZ0G", codeP(ES)},
		{"https://www.amazon.de/dp/B01636IZ0G", "B01636IZ0G", codeP(DE)},
		{"https://amazon.it/dp/B01636IZ0G", "B01636IZ0G", codeP(IT)},
		{"https://www.amazon.fr/gp/product/B01636IZ0G", "B01636IZ0G", codeP(FR)},
		{"https://www.amazon.es/gp/aw/d/B01636IZ0G", "B01636IZ0G", codeP(ES)},
		{"https://www.amazon.es/dp/B01636IZ0G?th=1&psc=1", "B01636IZ0G", codeP(ES)},
		{"https://www.amazon.es/Makita-HR2630/dp/B01636IZ0G/ref=sr_1_1", "B01636IZ0G", codeP(ES)},
		{"  https://www.amazon.es/dp/B01636IZ0G  ", "B01636IZ0G", codeP(ES)},
		{"B01636IZ0G", "B01636IZ0G", nil},
		{"  b01636iz0g  ", "B01636IZ0G", nil},
	}
	for _, f := range faelle {
		got, err := ParseEingabe(f.ein)
		if err != nil {
			t.Errorf("ParseEingabe(%q): unerwarteter Fehler %v", f.ein, err)
			continue
		}
		if got.ASIN != f.willASIN {
			t.Errorf("ParseEingabe(%q).ASIN = %q, will %q", f.ein, got.ASIN, f.willASIN)
		}
		switch {
		case f.willQuelle == nil && got.Quelle != nil:
			t.Errorf("ParseEingabe(%q).Quelle = %s, will nil", f.ein, got.Quelle.Code)
		case f.willQuelle != nil && got.Quelle == nil:
			t.Errorf("ParseEingabe(%q).Quelle = nil, will %s", f.ein, *f.willQuelle)
		case f.willQuelle != nil && got.Quelle.Code != *f.willQuelle:
			t.Errorf("ParseEingabe(%q).Quelle = %s, will %s", f.ein, got.Quelle.Code, *f.willQuelle)
		}
	}
}

func TestParseEingabeFehler(t *testing.T) {
	if _, err := ParseEingabe("https://www.amazon.co.uk/dp/B01636IZ0G"); !errors.Is(err, ErrUnbekannterMarkt) {
		t.Errorf("amazon.co.uk: will ErrUnbekannterMarkt, bekam %v", err)
	}
	for _, ein := range []string{"", "   ", "kein link", "https://www.amazon.de/", "B0163", "https://example.com/dp/B01636IZ0G"} {
		if _, err := ParseEingabe(ein); err == nil {
			t.Errorf("ParseEingabe(%q): Fehler erwartet, kam keiner", ein)
		}
	}
}

func codeP(c Code) *Code { return &c }
```

- [ ] **Step 6: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/marketplace/ -run TestParseEingabe`
Expected: FAIL — `undefined: ParseEingabe`

- [ ] **Step 7: Eingabe-Erkennung umsetzen**

`internal/marketplace/input.go`:

```go
package marketplace

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

var (
	ErrKeineASIN        = errors.New("keine ASIN in der Eingabe gefunden")
	ErrUnbekannterMarkt = errors.New("dieser Amazon-Marktplatz wird nicht unterstützt")
)

// Eingabe ist das Ergebnis der Erkennung. Quelle ist nil, wenn nur eine nackte
// ASIN eingegeben wurde — dann muss die Oberfläche nach dem Einkaufsmarkt
// fragen, statt einen zu raten.
type Eingabe struct {
	ASIN   string
	Quelle *Marketplace
}

var (
	nackteASIN = regexp.MustCompile(`^[A-Z0-9]{10}$`)
	pfadASIN   = regexp.MustCompile(`/(?:dp|gp/product|gp/aw/d|product)/([A-Z0-9]{10})`)
)

// ParseEingabe erkennt eine ASIN oder eine Amazon-Produkt-URL.
func ParseEingabe(s string) (Eingabe, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Eingabe{}, ErrKeineASIN
	}

	if gross := strings.ToUpper(s); nackteASIN.MatchString(gross) {
		return Eingabe{ASIN: gross}, nil
	}

	roh := s
	if !strings.Contains(roh, "://") {
		roh = "https://" + roh
	}
	u, err := url.Parse(roh)
	if err != nil || u.Host == "" {
		return Eingabe{}, ErrKeineASIN
	}

	m, ok := ByHost(u.Host)
	if !ok {
		if strings.Contains(strings.ToLower(u.Host), "amazon.") {
			return Eingabe{}, ErrUnbekannterMarkt
		}
		return Eingabe{}, ErrKeineASIN
	}

	treffer := pfadASIN.FindStringSubmatch(strings.ToUpper(u.Path))
	if treffer == nil {
		return Eingabe{}, ErrKeineASIN
	}
	return Eingabe{ASIN: treffer[1], Quelle: &m}, nil
}
```

- [ ] **Step 8: Alle Tests des Pakets laufen lassen**

Run: `go test ./internal/marketplace/ -v`
Expected: PASS für alle fünf Testfunktionen

- [ ] **Step 9: Commit**

```bash
git add internal/marketplace/
git commit -m "feat(marketplace): Markttabelle und Eingabe-Erkennung

Die beiden Domain-Schreibweisen (Zahl für die Produkt-API, Kürzel für
graph.keepa.com) sind getrennt benannt, weil ihre Verwechslung stumm
falsche Daten liefern würde.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Rechenkern

Hier steckt die Zahl, die im Post steht. Das Paket hat bewusst keine Abhängigkeit außer `money` und wird am gründlichsten getestet.

**Files:**
- Create: `internal/calc/calc.go`
- Test: `internal/calc/calc_test.go`

**Interfaces:**
- Consumes: `money.Cents` aus Task 1
- Produces:
  - `calc.USt` mit `Netto`, `Brutto`
  - `calc.Basis` mit `AufBrutto`, `AufNetto`
  - `calc.Eingabe{EKBrutto, VKBrutto money.Cents; QuellUStPermille, ZielUStPermille int; ProvisionProzent float64; FBA money.Cents; UStModus USt; MargenBasis Basis}`
  - `calc.Ergebnis{EKNetto, VKNetto, Provision, Gewinn money.Cents; MargeProzent float64}`
  - `calc.Rechne(Eingabe) Ergebnis`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`internal/calc/calc_test.go`:

```go
package calc

import (
	"math"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// referenz ist der Makita HR2630 aus der Spec, ES -> DE.
func referenz() Eingabe {
	return Eingabe{
		EKBrutto:         13056,
		VKBrutto:         20749,
		QuellUStPermille: 210, // ES 21 %
		ZielUStPermille:  190, // DE 19 %
		ProvisionProzent: 15.0,
		FBA:              864,
		UStModus:         Netto,
		MargenBasis:      AufBrutto,
	}
}

func TestReferenzfallNetto(t *testing.T) {
	got := Rechne(referenz())

	if got.VKNetto != 17436 {
		t.Errorf("VKNetto = %d, will 17436", got.VKNetto)
	}
	if got.EKNetto != 10790 {
		t.Errorf("EKNetto = %d, will 10790", got.EKNetto)
	}
	if got.Provision != 2615 {
		t.Errorf("Provision = %d, will 2615", got.Provision)
	}
	if got.Gewinn != 3167 {
		t.Errorf("Gewinn = %d, will 3167 (31,67 € aus dem Sheet)", got.Gewinn)
	}
	if math.Abs(got.MargeProzent-15.26) > 0.01 {
		t.Errorf("MargeProzent = %.4f, will ~15,26", got.MargeProzent)
	}
}

func TestReferenzfallBrutto(t *testing.T) {
	ein := referenz()
	ein.UStModus = Brutto
	got := Rechne(ein)

	if got.EKNetto != 13056 {
		t.Errorf("EKNetto = %d, will 13056 — im Brutto-Modus wird der EK nicht gekürzt", got.EKNetto)
	}
	if got.Gewinn != 901 {
		t.Errorf("Gewinn = %d, will 901", got.Gewinn)
	}
	if math.Abs(got.MargeProzent-4.34) > 0.01 {
		t.Errorf("MargeProzent = %.4f, will ~4,34", got.MargeProzent)
	}
}

func TestBruttoLaesstVKUnberuehrt(t *testing.T) {
	ein := referenz()
	ein.UStModus = Brutto
	got := Rechne(ein)
	if got.VKNetto != 17436 {
		t.Errorf("VKNetto = %d, will 17436 — der Brutto-Schalter darf nur die EK-Seite betreffen", got.VKNetto)
	}
}

func TestMargenBasisNetto(t *testing.T) {
	ein := referenz()
	ein.MargenBasis = AufNetto
	got := Rechne(ein)
	if math.Abs(got.MargeProzent-18.16) > 0.01 {
		t.Errorf("MargeProzent = %.4f, will ~18,16", got.MargeProzent)
	}
}

func TestOhneGebuehren(t *testing.T) {
	ein := referenz()
	ein.ProvisionProzent = 0
	ein.FBA = 0
	got := Rechne(ein)
	if got.Provision != 0 {
		t.Errorf("Provision = %d, will 0", got.Provision)
	}
	if will := money.Cents(17436 - 10790); got.Gewinn != will {
		t.Errorf("Gewinn = %d, will %d", got.Gewinn, will)
	}
}

func TestNullVKErgibtNullMarge(t *testing.T) {
	ein := referenz()
	ein.VKBrutto = 0
	got := Rechne(ein)
	if got.MargeProzent != 0 {
		t.Errorf("MargeProzent = %v, will 0 statt einer Division durch null", got.MargeProzent)
	}
}

func TestVerlustDealBleibtNegativ(t *testing.T) {
	ein := referenz()
	ein.EKBrutto = 30000
	got := Rechne(ein)
	if got.Gewinn >= 0 {
		t.Errorf("Gewinn = %d, will negativ", got.Gewinn)
	}
	if got.MargeProzent >= 0 {
		t.Errorf("MargeProzent = %.4f, will negativ", got.MargeProzent)
	}
}

func TestRundungErstAmEnde(t *testing.T) {
	// Drei Divisionen hintereinander: würde jede einzeln gerundet, wiche das
	// Ergebnis sichtbar ab. Der Referenzfall trifft nur bei später Rundung.
	got := Rechne(referenz())
	if got.Gewinn != 3167 {
		t.Errorf("Gewinn = %d, will 3167 — Zwischenwerte dürfen nicht gerundet werden", got.Gewinn)
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/calc/`
Expected: FAIL — `undefined: Rechne`

- [ ] **Step 3: Umsetzen**

`internal/calc/calc.go`:

```go
// Package calc rechnet Gewinn und Marge eines Arbitrage-Deals.
//
// Das Paket ist bewusst frei von Netzwerk, Datenbank und Vorlagen: hier steht
// die Zahl, die am Ende im Discord-Post landet, und sie muss ohne Aufbau einer
// Umgebung prüfbar sein.
package calc

import (
	"math"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// USt steuert, ob die Vorsteuer auf den Einkauf abgezogen wird.
type USt int

const (
	// Netto zieht die Vorsteuer des Einkaufslands ab. Standardfall.
	Netto USt = iota
	// Brutto lässt den Einkaufspreis ungekürzt, etwa ohne gültige Rechnung.
	Brutto
)

// Basis legt fest, worauf sich die Marge bezieht.
type Basis int

const (
	// AufBrutto bezieht die Marge auf den Brutto-Verkaufspreis. Reproduziert
	// die Zahlen des bisherigen Google Sheets.
	AufBrutto Basis = iota
	// AufNetto bezieht die Marge auf den Netto-Verkaufserlös.
	AufNetto
)

// Eingabe sind die Werte eines Deals, wie sie im Formular stehen.
type Eingabe struct {
	EKBrutto         money.Cents
	VKBrutto         money.Cents
	QuellUStPermille int // 210 entspricht 21,0 %
	ZielUStPermille  int
	ProvisionProzent float64 // 15.0 entspricht 15 %
	FBA              money.Cents
	UStModus         USt
	MargenBasis      Basis
}

// Ergebnis sind die abgeleiteten Werte. Alle Beträge auf Cent gerundet.
type Ergebnis struct {
	EKNetto      money.Cents
	VKNetto      money.Cents
	Provision    money.Cents
	Gewinn       money.Cents
	MargeProzent float64
}

// Rechne wertet einen Deal aus.
//
// Innerhalb der Funktion wird mit voller Genauigkeit gerechnet und erst am Ende
// auf Cent gerundet. Würde jeder Zwischenschritt gerundet, summierten sich die
// Fehler aus drei Divisionen zu einer sichtbaren Abweichung im Post.
func Rechne(e Eingabe) Ergebnis {
	vkNetto := netto(float64(e.VKBrutto), e.ZielUStPermille)

	// Der Brutto-Schalter betrifft ausschließlich die Einkaufsseite. Der
	// Verkaufserlös bleibt netto, weil die Umsatzsteuer daraus unabhängig vom
	// Einkauf ans Finanzamt geht.
	ekNetto := float64(e.EKBrutto)
	if e.UStModus == Netto {
		ekNetto = netto(float64(e.EKBrutto), e.QuellUStPermille)
	}

	provision := vkNetto * e.ProvisionProzent / 100
	gewinn := vkNetto - ekNetto - provision - float64(e.FBA)

	bezug := float64(e.VKBrutto)
	if e.MargenBasis == AufNetto {
		bezug = vkNetto
	}
	marge := 0.0
	if bezug != 0 {
		marge = gewinn / bezug * 100
	}

	return Ergebnis{
		EKNetto:      runde(ekNetto),
		VKNetto:      runde(vkNetto),
		Provision:    runde(provision),
		Gewinn:       runde(gewinn),
		MargeProzent: marge,
	}
}

// netto rechnet einen Bruttobetrag auf netto herunter. Ein Satz von 0 oder
// weniger lässt den Betrag unverändert, statt durch null zu teilen.
func netto(brutto float64, ustPermille int) float64 {
	if ustPermille <= 0 {
		return brutto
	}
	return brutto * 1000 / float64(1000+ustPermille)
}

func runde(f float64) money.Cents { return money.Cents(math.Round(f)) }
```

- [ ] **Step 4: Tests laufen lassen**

Run: `go test ./internal/calc/ -v`
Expected: PASS für alle acht Testfunktionen, insbesondere `TestReferenzfallNetto` mit Gewinn 3167

- [ ] **Step 5: Commit**

```bash
git add internal/calc/
git commit -m "feat(calc): Gewinn- und Margenrechnung

Reproduziert den Sheet-Referenzfall auf den Cent (Makita HR2630,
ES->DE: 31,67 € bei 15,3 %). Der Brutto-Schalter wirkt nur auf die
EK-Seite; der VK bleibt netto, weil die Umsatzsteuer daraus
unabhängig vom Einkauf abzuführen ist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Keepa-Produktzuordnung

Wandelt die rohe API-Antwort in ein sauberes Struct. Zwei Fallen, die hier abgefangen werden: `-1` bedeutet „kein Wert" und darf nie als Betrag durchrutschen, und `csv[18]` hat Dreiergruppen statt Paaren.

**Files:**
- Create: `internal/keepa/product.go`
- Create: `internal/keepa/testdata/produkt.json`
- Test: `internal/keepa/product_test.go`

**Interfaces:**
- Consumes: `money.Cents` aus Task 1
- Produces:
  - `keepa.Price{Cents money.Cents; OK bool}`
  - `keepa.Punkt{Minute int; Gesamt money.Cents}`
  - `keepa.Product{ASIN, Titel, Marke, Modell string; BuyBoxAvg90, BuyBoxAktuell, AmazonAktuell, FBA Price; BuyBoxVerlauf []Punkt; MonthlySold, RankDrops30 int; ProvisionProzent *float64}`
  - `keepa.SalesQuelle` mit `SalesMonthlySold`, `SalesRankDrops`, `SalesKeine`
  - `(Product).Sales() (int, SalesQuelle)`
  - `keepa.ParseAntwort([]byte) (Antwort, error)` mit `Antwort{Produkt Product; TokensLeft, TokensConsumed int; RefillIn time.Duration}`
  - `keepa.ErrNichtGefunden`

- [ ] **Step 1: Fixture anlegen**

`internal/keepa/testdata/produkt.json` — eine gekürzte, aber formtreue Antwort. `csv[18]` enthält bewusst Dreiergruppen inklusive eines Zeitpunkts ohne Angebot (`-1`) und eines mit unbekannten Versandkosten (`-1`):

```json
{
  "timestamp": 1788624229322,
  "tokensLeft": 1183,
  "refillIn": 42000,
  "refillRate": 20,
  "tokensConsumed": 1,
  "products": [
    {
      "asin": "B01636IZ0G",
      "domainId": 3,
      "title": "Makita HR2630/2 HR2630 230V SDS Plus 26mm Rotary Hammer, 800 W, 240 V",
      "brand": "Makita",
      "model": "HR2630",
      "partNumber": "HR2630",
      "monthlySold": 40,
      "referralFeePercentage": 15.0,
      "fbaFees": {
        "storageFee": 12,
        "storageFeeTax": 0,
        "pickAndPackFee": 864,
        "pickAndPackFeeTax": 0
      },
      "csv": [
        [7000000, 21498, 7001440, 21498],
        null,
        null,
        [7000000, 1200],
        null, null, null, null, null, null, null,
        null, null, null, null, null, null, null,
        [7000000, 18500, 0, 7001440, -1, -1, 7002880, 19900, 495, 7004320, 21286, -1]
      ],
      "stats": {
        "current": [21498, 21286, -1, 1200, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 21286],
        "avg90":   [20890, 20700, -1, 1350, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 20749],
        "salesRankDrops30": 37,
        "salesRankDrops90": 112
      }
    }
  ]
}
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

`internal/keepa/product_test.go`:

```go
package keepa

import (
	"errors"
	"os"
	"testing"
	"time"
)

func fixture(t *testing.T) Antwort {
	t.Helper()
	roh, err := os.ReadFile("testdata/produkt.json")
	if err != nil {
		t.Fatalf("Fixture nicht lesbar: %v", err)
	}
	a, err := ParseAntwort(roh)
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	return a
}

func TestStammdaten(t *testing.T) {
	p := fixture(t).Produkt
	if p.ASIN != "B01636IZ0G" {
		t.Errorf("ASIN = %q", p.ASIN)
	}
	if p.Marke != "Makita" {
		t.Errorf("Marke = %q, will Makita", p.Marke)
	}
	if p.Modell != "HR2630" {
		t.Errorf("Modell = %q, will HR2630", p.Modell)
	}
	if p.Titel == "" {
		t.Error("Titel ist leer")
	}
}

func TestPreiseUndMinusEins(t *testing.T) {
	p := fixture(t).Produkt

	if !p.BuyBoxAvg90.OK || p.BuyBoxAvg90.Cents != 20749 {
		t.Errorf("BuyBoxAvg90 = %+v, will {20749 true}", p.BuyBoxAvg90)
	}
	if !p.BuyBoxAktuell.OK || p.BuyBoxAktuell.Cents != 21286 {
		t.Errorf("BuyBoxAktuell = %+v, will {21286 true}", p.BuyBoxAktuell)
	}
	if !p.AmazonAktuell.OK || p.AmazonAktuell.Cents != 21498 {
		t.Errorf("AmazonAktuell = %+v, will {21498 true}", p.AmazonAktuell)
	}
	if !p.FBA.OK || p.FBA.Cents != 864 {
		t.Errorf("FBA = %+v, will {864 true}", p.FBA)
	}
}

func TestMinusEinsWirdNichtZuNull(t *testing.T) {
	roh := []byte(`{"tokensLeft":5,"products":[{"asin":"X","title":"t",
	  "stats":{"current":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1],
	           "avg90":[-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]}}]}`)
	a, err := ParseAntwort(roh)
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	for name, pr := range map[string]Price{
		"BuyBoxAvg90":   a.Produkt.BuyBoxAvg90,
		"BuyBoxAktuell": a.Produkt.BuyBoxAktuell,
		"AmazonAktuell": a.Produkt.AmazonAktuell,
		"FBA":           a.Produkt.FBA,
	} {
		if pr.OK {
			t.Errorf("%s.OK = true bei -1, will false", name)
		}
		if pr.Cents != 0 {
			t.Errorf("%s.Cents = %d, will 0 bei nicht gesetztem Wert", name, pr.Cents)
		}
	}
}

func TestBuyBoxVerlaufIstDreiergruppig(t *testing.T) {
	v := fixture(t).Produkt.BuyBoxVerlauf

	// Vier Dreiergruppen im Fixture, eine davon ohne Angebot (-1) -> drei Punkte.
	if len(v) != 3 {
		t.Fatalf("BuyBoxVerlauf hat %d Punkte, will 3 (der -1-Eintrag fällt weg): %+v", len(v), v)
	}
	will := []Punkt{
		{Minute: 7000000, Gesamt: 18500},        // 18500 + 0 Versand
		{Minute: 7002880, Gesamt: 19900 + 495},  // Preis plus Versand
		{Minute: 7004320, Gesamt: 21286},        // Versand -1 zählt als 0
	}
	for i, w := range will {
		if v[i] != w {
			t.Errorf("Punkt %d = %+v, will %+v", i, v[i], w)
		}
	}
}

func TestSalesQuelle(t *testing.T) {
	p := fixture(t).Produkt
	n, q := p.Sales()
	if n != 40 || q != SalesMonthlySold {
		t.Errorf("Sales() = (%d, %v), will (40, SalesMonthlySold)", n, q)
	}

	p.MonthlySold = 0
	n, q = p.Sales()
	if n != 37 || q != SalesRankDrops {
		t.Errorf("ohne monthlySold: Sales() = (%d, %v), will (37, SalesRankDrops)", n, q)
	}

	p.RankDrops30 = -1
	n, q = p.Sales()
	if n != 0 || q != SalesKeine {
		t.Errorf("ohne beides: Sales() = (%d, %v), will (0, SalesKeine)", n, q)
	}
}

func TestTokenFelder(t *testing.T) {
	a := fixture(t)
	if a.TokensLeft != 1183 {
		t.Errorf("TokensLeft = %d, will 1183", a.TokensLeft)
	}
	if a.TokensConsumed != 1 {
		t.Errorf("TokensConsumed = %d, will 1", a.TokensConsumed)
	}
	if a.RefillIn != 42*time.Second {
		t.Errorf("RefillIn = %v, will 42s", a.RefillIn)
	}
}

func TestLeereProduktliste(t *testing.T) {
	_, err := ParseAntwort([]byte(`{"tokensLeft":5,"products":[]}`))
	if !errors.Is(err, ErrNichtGefunden) {
		t.Errorf("will ErrNichtGefunden, bekam %v", err)
	}
}

func TestProvisionFehlt(t *testing.T) {
	a, err := ParseAntwort([]byte(`{"products":[{"asin":"X","title":"t"}]}`))
	if err != nil {
		t.Fatalf("ParseAntwort: %v", err)
	}
	if a.Produkt.ProvisionProzent != nil {
		t.Errorf("ProvisionProzent = %v, will nil", *a.Produkt.ProvisionProzent)
	}
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/keepa/`
Expected: FAIL — `undefined: ParseAntwort`

- [ ] **Step 4: Umsetzen**

`internal/keepa/product.go`:

```go
// Package keepa spricht mit der Keepa-API und wandelt deren Antworten in
// Werte um, mit denen der Rest des Programms rechnen kann.
package keepa

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Spaltenindizes der csv-Reihen. Die Nummerierung stammt aus Keepas CsvType.
const (
	csvAmazon         = 0  // Paare: Zeit, Preis
	csvBuyBoxShipping = 18 // Dreiergruppen: Zeit, Preis, Versand
)

var ErrNichtGefunden = errors.New("keepa: kein Produkt zu dieser ASIN")

// Price ist ein Betrag, der auch fehlen kann. Keepa liefert -1 für „kein
// Wert"; ohne OK darf der Betrag in keine Rechnung fließen.
type Price struct {
	Cents money.Cents
	OK    bool
}

// Punkt ist ein Zeitpunkt des Buy-Box-Verlaufs. Gesamt enthält Preis plus
// Versandkosten, weil nur diese Summe mit dem Verkaufserlös vergleichbar ist.
type Punkt struct {
	Minute int // Keepa-Zeit in Minuten
	Gesamt money.Cents
}

// SalesQuelle hält fest, woher die Verkaufszahl stammt. Die Oberfläche zeigt
// das an, damit eine Schätzung nie für eine gemessene Zahl gehalten wird.
type SalesQuelle int

const (
	SalesMonthlySold SalesQuelle = iota // Amazons "im letzten Monat gekauft"
	SalesRankDrops                      // Keepa-Schätzung aus Rangsprüngen
	SalesKeine
)

type Product struct {
	ASIN   string
	Titel  string
	Marke  string
	Modell string

	BuyBoxAvg90   Price
	BuyBoxAktuell Price
	AmazonAktuell Price
	FBA           Price

	BuyBoxVerlauf []Punkt

	MonthlySold      int
	RankDrops30      int
	ProvisionProzent *float64
}

// Sales liefert die Verkaufszahl und ihre Herkunft.
func (p Product) Sales() (int, SalesQuelle) {
	if p.MonthlySold > 0 {
		return p.MonthlySold, SalesMonthlySold
	}
	if p.RankDrops30 > 0 {
		return p.RankDrops30, SalesRankDrops
	}
	return 0, SalesKeine
}

// Antwort bündelt Produkt und Kontingentstand einer Abfrage.
type Antwort struct {
	Produkt        Product
	TokensLeft     int
	TokensConsumed int
	RefillIn       time.Duration
}

type rohAntwort struct {
	TokensLeft     int         `json:"tokensLeft"`
	TokensConsumed int         `json:"tokensConsumed"`
	RefillIn       int         `json:"refillIn"` // Millisekunden
	Products       []rohProdukt `json:"products"`
	Error          *rohFehler  `json:"error"`
}

type rohFehler struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type rohProdukt struct {
	ASIN                  string   `json:"asin"`
	Title                 string   `json:"title"`
	Brand                 string   `json:"brand"`
	Model                 string   `json:"model"`
	MonthlySold           int      `json:"monthlySold"`
	ReferralFeePercentage *float64 `json:"referralFeePercentage"`
	FBAFees               *struct {
		PickAndPackFee int `json:"pickAndPackFee"`
	} `json:"fbaFees"`
	CSV   [][]int `json:"csv"`
	Stats *struct {
		Current          []int `json:"current"`
		Avg90            []int `json:"avg90"`
		SalesRankDrops30 int   `json:"salesRankDrops30"`
	} `json:"stats"`
}

// ParseAntwort wandelt den Antwortkörper der Produkt-API um.
func ParseAntwort(roh []byte) (Antwort, error) {
	var r rohAntwort
	if err := json.Unmarshal(roh, &r); err != nil {
		return Antwort{}, fmt.Errorf("keepa: Antwort nicht lesbar: %w", err)
	}
	if r.Error != nil && r.Error.Type != "" {
		return Antwort{}, fmt.Errorf("keepa: %s: %s", r.Error.Type, r.Error.Message)
	}
	if len(r.Products) == 0 {
		return Antwort{}, ErrNichtGefunden
	}

	rp := r.Products[0]
	p := Product{
		ASIN:             rp.ASIN,
		Titel:            rp.Title,
		Marke:            rp.Brand,
		Modell:           rp.Model,
		MonthlySold:      rp.MonthlySold,
		RankDrops30:      -1,
		ProvisionProzent: rp.ReferralFeePercentage,
		BuyBoxVerlauf:    buyBoxVerlauf(rp.CSV),
	}
	if rp.FBAFees != nil {
		p.FBA = preis(rp.FBAFees.PickAndPackFee)
	}
	if rp.Stats != nil {
		p.RankDrops30 = rp.Stats.SalesRankDrops30
		p.BuyBoxAvg90 = ausReihe(rp.Stats.Avg90, csvBuyBoxShipping)
		p.BuyBoxAktuell = ausReihe(rp.Stats.Current, csvBuyBoxShipping)
		p.AmazonAktuell = ausReihe(rp.Stats.Current, csvAmazon)
	}

	return Antwort{
		Produkt:        p,
		TokensLeft:     r.TokensLeft,
		TokensConsumed: r.TokensConsumed,
		RefillIn:       time.Duration(r.RefillIn) * time.Millisecond,
	}, nil
}

// preis macht aus Keepas Ganzzahl einen Betrag. Negative Werte bedeuten
// „kein Wert" und werden nicht zu 0 € verfälscht.
func preis(v int) Price {
	if v < 0 {
		return Price{}
	}
	return Price{Cents: money.Cents(v), OK: true}
}

func ausReihe(reihe []int, index int) Price {
	if index >= len(reihe) {
		return Price{}
	}
	return preis(reihe[index])
}

// buyBoxVerlauf liest csv[18].
//
// Diese Reihe führt Versandkosten mit und hat deshalb Dreiergruppen
// (Zeit, Preis, Versand) statt der sonst üblichen Paare. Wer hier mit
// Schrittweite 2 läuft, bekommt stillschweigend Unsinn.
func buyBoxVerlauf(csv [][]int) []Punkt {
	if csvBuyBoxShipping >= len(csv) {
		return nil
	}
	roh := csv[csvBuyBoxShipping]

	var punkte []Punkt
	for i := 0; i+2 < len(roh); i += 3 {
		minute, p, versand := roh[i], roh[i+1], roh[i+2]
		if p < 0 {
			continue // zu diesem Zeitpunkt gab es keine Buy Box
		}
		if versand < 0 {
			versand = 0 // unbekannte Versandkosten nicht als Rabatt verrechnen
		}
		punkte = append(punkte, Punkt{Minute: minute, Gesamt: money.Cents(p + versand)})
	}
	return punkte
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `go test ./internal/keepa/ -v`
Expected: PASS für alle acht Testfunktionen

- [ ] **Step 6: Gegen echte Daten gegenprüfen (einmalig, manuell)**

Sobald ein Keepa-Key vorliegt, eine echte Antwort holen und **prüfen, ob `stats.avg90[18]` bereits Versandkosten enthält.** Die Dokumentation sagt „gewichteter Mittelwert mit CsvType-Indizierung", nennt aber nicht ausdrücklich, ob der Versand eingerechnet ist. Weicht der Wert deutlich vom selbst gerechneten Durchschnitt aus `BuyBoxVerlauf` ab, ist das der Grund.

```bash
curl -s "https://api.keepa.com/product?key=$KEEPA_API_KEY&domain=3&asin=B01636IZ0G&stats=90&history=1" \
  | python3 -m json.tool > /tmp/keepa_echt.json
```

Ergebnis als Notiz in `internal/keepa/product.go` festhalten. Kein Blocker für den weiteren Bau.

- [ ] **Step 7: Commit**

```bash
git add internal/keepa/
git commit -m "feat(keepa): Produktzuordnung mit -1- und Dreiergruppen-Behandlung

csv[18] fuehrt Versandkosten mit und hat deshalb Dreiergruppen statt
Paare (verifiziert in Product.java: BUY_BOX_SHIPPING(18,...,true,true)).
Fehlende Werte kommen als Price{OK:false} durch, nie als 0 EUR.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Zeitgewichteter Median

Keepa liefert nur Durchschnitte. Der Median muss selbst gerechnet werden — und zwar zeitgewichtet, weil Keepas eigener `avg90` laut Dokumentation ein *gewichteter* Mittelwert ist. Ein ungewichteter Median wäre nicht damit vergleichbar: ein Preis, der zwei Stunden galt, zählte dann so viel wie einer, der zwei Monate stand.

**Files:**
- Create: `internal/keepa/median.go`
- Test: `internal/keepa/median_test.go`

**Interfaces:**
- Consumes: `keepa.Punkt` aus Task 4
- Produces: `keepa.MedianZeitgewichtet(punkte []Punkt, bisMinute int) Price`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`internal/keepa/median_test.go`:

```go
package keepa

import "testing"

func TestMedianZeitgewichtet(t *testing.T) {
	faelle := []struct {
		name    string
		punkte  []Punkt
		bis     int
		willOK  bool
		willVal int64
	}{
		{
			name:   "leer",
			punkte: nil, bis: 100, willOK: false,
		},
		{
			name:    "ein einziger Punkt",
			punkte:  []Punkt{{0, 20000}},
			bis:     100, willOK: true, willVal: 20000,
		},
		{
			// 10000 hielt 90 Minuten, 90000 nur 10. Der Median muss 10000
			// sein — ein ungewichteter Median läge bei 50000.
			name:    "kurzer Ausreisser darf nicht durchschlagen",
			punkte:  []Punkt{{0, 10000}, {90, 90000}},
			bis:     100, willOK: true, willVal: 10000,
		},
		{
			name:    "drei gleich lange Abschnitte",
			punkte:  []Punkt{{0, 10000}, {10, 30000}, {20, 20000}},
			bis:     30, willOK: true, willVal: 20000,
		},
		{
			name:    "Reihenfolge der Preise ist egal",
			punkte:  []Punkt{{0, 30000}, {10, 10000}, {20, 20000}},
			bis:     30, willOK: true, willVal: 20000,
		},
		{
			name:    "Punkte ohne Dauer werden uebersprungen",
			punkte:  []Punkt{{0, 10000}, {0, 99999}, {10, 20000}},
			bis:     20, willOK: true, willVal: 20000,
		},
		{
			name:   "bisMinute vor dem ersten Punkt",
			punkte: []Punkt{{100, 20000}},
			bis:    50, willOK: false,
		},
	}

	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			got := MedianZeitgewichtet(f.punkte, f.bis)
			if got.OK != f.willOK {
				t.Fatalf("OK = %v, will %v", got.OK, f.willOK)
			}
			if f.willOK && int64(got.Cents) != f.willVal {
				t.Errorf("Cents = %d, will %d", got.Cents, f.willVal)
			}
		})
	}
}

func TestMedianUnterscheidetSichVomDurchschnitt(t *testing.T) {
	// Realistischer Fall: langer stabiler Preis, kurzer Preissturz.
	punkte := []Punkt{{0, 20000}, {800, 5000}, {820, 20000}}
	got := MedianZeitgewichtet(punkte, 1000)
	if !got.OK || got.Cents != 20000 {
		t.Errorf("Median = %+v, will {20000 true} — der Preissturz hielt nur 2 %% der Zeit", got)
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/keepa/ -run TestMedian`
Expected: FAIL — `undefined: MedianZeitgewichtet`

- [ ] **Step 3: Umsetzen**

`internal/keepa/median.go`:

```go
package keepa

import (
	"sort"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// MedianZeitgewichtet liefert den Preis, oberhalb und unterhalb dessen jeweils
// die Hälfte der beobachteten Zeit lag.
//
// Jeder Punkt gilt bis zum nächsten, der letzte bis bisMinute. Die Gewichtung
// nach Dauer ist entscheidend: Keepas eigener avg90 ist laut Dokumentation ein
// gewichteter Mittelwert, und ein ungewichteter Median wäre damit nicht
// vergleichbar — ein Preis, der zwei Stunden galt, zählte dann so viel wie
// einer, der zwei Monate stand.
func MedianZeitgewichtet(punkte []Punkt, bisMinute int) Price {
	type spanne struct {
		gesamt money.Cents
		dauer  int
	}

	var spannen []spanne
	gesamtdauer := 0
	for i, p := range punkte {
		ende := bisMinute
		if i+1 < len(punkte) {
			ende = punkte[i+1].Minute
		}
		dauer := ende - p.Minute
		if dauer <= 0 {
			continue
		}
		spannen = append(spannen, spanne{p.Gesamt, dauer})
		gesamtdauer += dauer
	}
	if gesamtdauer == 0 {
		return Price{}
	}

	sort.Slice(spannen, func(i, j int) bool { return spannen[i].gesamt < spannen[j].gesamt })

	haelfte := gesamtdauer / 2
	lauf := 0
	for _, s := range spannen {
		lauf += s.dauer
		if lauf > haelfte {
			return Price{Cents: s.gesamt, OK: true}
		}
	}
	return Price{Cents: spannen[len(spannen)-1].gesamt, OK: true}
}
```


- [ ] **Step 4: Tests laufen lassen**

Run: `go test ./internal/keepa/ -run TestMedian -v`
Expected: PASS für alle sieben Unterfälle und `TestMedianUnterscheidetSichVomDurchschnitt`

- [ ] **Step 5: Commit**

```bash
git add internal/keepa/median.go internal/keepa/median_test.go
git commit -m "feat(keepa): zeitgewichteter Median des Buy-Box-Verlaufs

Keepa liefert nur Durchschnitte. Die Gewichtung nach Dauer ist noetig,
damit der Wert mit Keepas avg90 vergleichbar bleibt — der ist laut
Doku ebenfalls ein gewichteter Mittelwert.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Keepa-Client und Chart-Abruf

Der HTTP-Teil. Der Chart kommt vom kostenlosen `graph.keepa.com` — kein Key, kein Token-Verbrauch, live geprüft.

**Files:**
- Create: `internal/keepa/client.go`
- Create: `internal/keepa/chart.go`
- Test: `internal/keepa/client_test.go`
- Test: `internal/keepa/chart_test.go`

**Interfaces:**
- Consumes: `keepa.ParseAntwort` aus Task 4
- Produces:
  - `keepa.Client{Key string; HTTP *http.Client; BasisURL string; ChartBasisURL string}`
  - `keepa.NeuerClient(key string) *Client`
  - `(*Client).Produkt(ctx context.Context, asin string, domain int) (Antwort, error)`
  - `keepa.ChartOptionen{Tage, Breite, Hoehe int; BuyBox, Amazon, Neu bool}`
  - `keepa.StandardChart` (Vorgabe: 90 Tage, 800×350, alle drei Kurven)
  - `(*Client).ChartURL(asin, chartDomain string, o ChartOptionen) string`
  - `(*Client).Chart(ctx context.Context, asin, chartDomain string, o ChartOptionen) ([]byte, error)`
  - `keepa.ErrTokensErschoepft{RefillIn time.Duration}`, `keepa.ErrKeinPNG`

- [ ] **Step 1: Den fehlschlagenden Client-Test schreiben**

`internal/keepa/client_test.go`:

```go
package keepa

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestProduktErfolg(t *testing.T) {
	roh, err := os.ReadFile("testdata/produkt.json")
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}

	var gesehen *http.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gesehen = r
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	a, err := c.Produkt(context.Background(), "B01636IZ0G", 3)
	if err != nil {
		t.Fatalf("Produkt: %v", err)
	}
	if a.Produkt.ASIN != "B01636IZ0G" {
		t.Errorf("ASIN = %q", a.Produkt.ASIN)
	}
	if a.TokensLeft != 1183 {
		t.Errorf("TokensLeft = %d, will 1183", a.TokensLeft)
	}

	q := gesehen.URL.Query()
	for schluessel, will := range map[string]string{
		"key": "geheim", "asin": "B01636IZ0G", "domain": "3",
		"stats": "90", "history": "1",
	} {
		if got := q.Get(schluessel); got != will {
			t.Errorf("Parameter %s = %q, will %q", schluessel, got, will)
		}
	}
}

func TestProduktTokensErschoepft(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"tokensLeft":0,"refillIn":120000,
		  "error":{"type":"NOT_ENOUGH_TOKEN","message":"Insufficient tokens"}}`))
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	_, err := c.Produkt(context.Background(), "B01636IZ0G", 3)
	var erschoepft ErrTokensErschoepft
	if !errors.As(err, &erschoepft) {
		t.Fatalf("will ErrTokensErschoepft, bekam %v", err)
	}
	if erschoepft.RefillIn != 2*time.Minute {
		t.Errorf("RefillIn = %v, will 2m", erschoepft.RefillIn)
	}
}

func TestProduktNichtGefunden(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"tokensLeft":10,"tokensConsumed":1,"products":[]}`))
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	if _, err := c.Produkt(context.Background(), "B0XXXXXXXX", 3); !errors.Is(err, ErrNichtGefunden) {
		t.Errorf("will ErrNichtGefunden, bekam %v", err)
	}
}

func TestProduktServerfehler(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.BasisURL = srv.URL

	if _, err := c.Produkt(context.Background(), "B01636IZ0G", 3); err == nil {
		t.Error("Fehler erwartet, kam keiner")
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/keepa/ -run TestProdukt`
Expected: FAIL — `undefined: NeuerClient`

- [ ] **Step 3: Client umsetzen**

`internal/keepa/client.go`:

```go
package keepa

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ErrTokensErschoepft meldet ein leeres Kontingent samt Wartezeit, damit die
// Oberfläche eine konkrete Zeit nennen kann statt „später nochmal".
type ErrTokensErschoepft struct {
	RefillIn time.Duration
}

func (e ErrTokensErschoepft) Error() string {
	return fmt.Sprintf("keepa: Kontingent erschöpft, neue Token in %s", e.RefillIn.Round(time.Second))
}

type Client struct {
	Key           string
	HTTP          *http.Client
	BasisURL      string // in Tests überschrieben
	ChartBasisURL string
}

func NeuerClient(key string) *Client {
	return &Client{
		Key:           key,
		HTTP:          &http.Client{Timeout: 30 * time.Second},
		BasisURL:      "https://api.keepa.com",
		ChartBasisURL: "https://graph.keepa.com",
	}
}

// Produkt holt eine ASIN von einem Marktplatz.
//
// stats=90 liefert die Durchschnitte, history=1 den Rohverlauf, aus dem der
// Median gerechnet wird. Der Quellmarktplatz wird bewusst nicht abgefragt: der
// Einkaufspreis stammt aus dem Warenkorb und enthält Mengenrabatte, die Keepa
// gar nicht kennt.
func (c *Client) Produkt(ctx context.Context, asin string, domain int) (Antwort, error) {
	q := url.Values{
		"key":     {c.Key},
		"domain":  {strconv.Itoa(domain)},
		"asin":    {asin},
		"stats":   {"90"},
		"history": {"1"},
	}
	ziel := c.BasisURL + "/product?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ziel, nil)
	if err != nil {
		return Antwort{}, fmt.Errorf("keepa: Anfrage nicht baubar: %w", err)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return Antwort{}, fmt.Errorf("keepa: nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()

	koerper, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return Antwort{}, fmt.Errorf("keepa: Antwort nicht lesbar: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		// Die Wartezeit steht im Körper, nicht im Header.
		if a, perr := ParseAntwort(koerper); perr == nil {
			return Antwort{}, ErrTokensErschoepft{RefillIn: a.RefillIn}
		}
		var r rohAntwort
		_ = json.Unmarshal(koerper, &r)
		return Antwort{}, ErrTokensErschoepft{RefillIn: time.Duration(r.RefillIn) * time.Millisecond}
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Antwort{}, fmt.Errorf("keepa: HTTP %d", resp.StatusCode)
	}

	return ParseAntwort(koerper)
}
```


- [ ] **Step 4: Client-Tests laufen lassen**

Run: `go test ./internal/keepa/ -run TestProdukt -v`
Expected: PASS für alle vier Testfunktionen

- [ ] **Step 5: Den fehlschlagenden Chart-Test schreiben**

`internal/keepa/chart_test.go`:

```go
package keepa

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestChartURL(t *testing.T) {
	c := NeuerClient("geheim")
	roh := c.ChartURL("B01636IZ0G", "de", StandardChart)

	u, err := url.Parse(roh)
	if err != nil {
		t.Fatalf("URL nicht parsebar: %v", err)
	}
	if !strings.HasSuffix(u.Path, "/pricehistory.png") {
		t.Errorf("Pfad = %q, will /pricehistory.png", u.Path)
	}
	if strings.Contains(roh, "geheim") {
		t.Error("der Chart-Endpunkt braucht keinen Key — er darf nicht in der URL stehen")
	}

	q := u.Query()
	for schluessel, will := range map[string]string{
		"asin": "B01636IZ0G", "domain": "de", "range": "90",
		"width": "800", "height": "350", "bb": "1", "amazon": "1", "new": "1",
	} {
		if got := q.Get(schluessel); got != will {
			t.Errorf("Parameter %s = %q, will %q", schluessel, got, will)
		}
	}
}

func TestChartURLKurvenAbschaltbar(t *testing.T) {
	c := NeuerClient("geheim")
	o := StandardChart
	o.BuyBox = false
	q, _ := url.Parse(c.ChartURL("B01636IZ0G", "de", o))
	if q.Query().Has("bb") {
		t.Error("bb steht in der URL, obwohl die Kurve abgeschaltet ist")
	}
}

func TestChartHolen(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 100))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Write(png)
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.ChartBasisURL = srv.URL

	got, err := c.Chart(context.Background(), "B01636IZ0G", "de", StandardChart)
	if err != nil {
		t.Fatalf("Chart: %v", err)
	}
	if len(got) != len(png) {
		t.Errorf("%d Bytes, will %d", len(got), len(png))
	}
}

func TestChartKeinPNG(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html>Wartungsarbeiten</html>"))
	}))
	defer srv.Close()

	c := NeuerClient("geheim")
	c.ChartBasisURL = srv.URL

	if _, err := c.Chart(context.Background(), "B01636IZ0G", "de", StandardChart); !errors.Is(err, ErrKeinPNG) {
		t.Errorf("will ErrKeinPNG, bekam %v", err)
	}
}
```

- [ ] **Step 6: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/keepa/ -run TestChart`
Expected: FAIL — `undefined: StandardChart`

- [ ] **Step 7: Chart-Abruf umsetzen**

`internal/keepa/chart.go`:

```go
package keepa

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

var ErrKeinPNG = errors.New("keepa: Antwort ist kein PNG")

// ChartOptionen steuern das Preisverlaufsbild.
type ChartOptionen struct {
	Tage   int
	Breite int
	Hoehe  int
	BuyBox bool
	Amazon bool
	Neu    bool
}

// StandardChart zeigt 90 Tage mit Buy-Box-Kurve — also der Reihe, aus der der
// VK-Vorschlag stammt. Ohne sie ließe sich der genannte VK nicht am Bild
// ablesen.
var StandardChart = ChartOptionen{
	Tage: 90, Breite: 800, Hoehe: 350,
	BuyBox: true, Amazon: true, Neu: true,
}

// ChartURL baut die Adresse des Preisverlaufsbildes.
//
// Dieser Endpunkt braucht weder Key noch Token. Er ist allerdings nicht
// dokumentiert — falls Keepa ihn schließt, ist der Umstieg auf das
// token-pflichtige api.keepa.com/graphimage der Ersatzweg.
func (c *Client) ChartURL(asin, chartDomain string, o ChartOptionen) string {
	q := url.Values{
		"asin":   {asin},
		"domain": {chartDomain},
		"range":  {strconv.Itoa(o.Tage)},
		"width":  {strconv.Itoa(o.Breite)},
		"height": {strconv.Itoa(o.Hoehe)},
	}
	if o.BuyBox {
		q.Set("bb", "1")
	}
	if o.Amazon {
		q.Set("amazon", "1")
	}
	if o.Neu {
		q.Set("new", "1")
	}
	return c.ChartBasisURL + "/pricehistory.png?" + q.Encode()
}

// Chart holt das Bild als Bytes, damit es als Datei-Anhang mitgesendet und
// lokal archiviert werden kann. Verlinken käme nicht in Frage: alte Posts
// würden leer, sobald Keepa die Adresse ändert.
func (c *Client) Chart(ctx context.Context, asin, chartDomain string, o ChartOptionen) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.ChartURL(asin, chartDomain, o), nil)
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: Anfrage nicht baubar: %w", err)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("keepa-chart: HTTP %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "image/png") {
		return nil, fmt.Errorf("%w (Content-Type %q)", ErrKeinPNG, ct)
	}

	daten, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("keepa-chart: Bild nicht lesbar: %w", err)
	}
	if !bytes.HasPrefix(daten, []byte("\x89PNG\r\n\x1a\n")) {
		return nil, ErrKeinPNG
	}
	return daten, nil
}
```

- [ ] **Step 8: Alle Tests des Pakets laufen lassen**

Run: `go test ./internal/keepa/ -v`
Expected: PASS für alle Testfunktionen aus Task 4, 5 und 6

- [ ] **Step 9: Commit**

```bash
git add internal/keepa/
git commit -m "feat(keepa): HTTP-Client und Chart-Abruf

Der Chart kommt von graph.keepa.com — ohne Key und ohne Token,
live geprueft. Das PNG wird als Bytes geholt statt verlinkt, damit
alte Posts nicht leer werden, wenn Keepa die Adresse aendert.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Post-Rendering und ArbitrageOne-URL

Erzeugt den Text, der bei Discord landet. `text/template`, **nicht** `html/template` — Ausgabeziel ist Discord-Markdown, und `html/template` würde Klammern und Anführungszeichen zu HTML-Entitäten verstümmeln.

**Files:**
- Create: `internal/post/render.go`
- Create: `internal/post/arbitrageone.go`
- Test: `internal/post/render_test.go`
- Test: `internal/post/arbitrageone_test.go`

**Interfaces:**
- Consumes: `money.Cents` aus Task 1, `marketplace.Code` aus Task 2
- Produces:
  - `post.Daten` mit den Feldern `Titel, ASIN, Mention, EKHost, EKUrl, EK, EKNotiz, VK, VKUrl, Zielmarkt, Sales, Gewinn, Marge, MargeGerundet, AOUrl` (alle `string`)
  - `post.StandardVorlage` (Konstante)
  - `post.Render(vorlage string, d Daten) (string, error)`
  - `post.Pruefe(vorlage string) error`
  - `post.ErrZuLang`, `post.MaxLaenge = 2000`
  - `post.AOParameter{ASIN string; VKBrutto, EKBrutto, EKNettoBerechnet money.Cents; Sales int; Zielmarkt marketplace.Code; QuellURL string}`
  - `post.ArbitrageOneURL(AOParameter) string`

- [ ] **Step 1: Den fehlschlagenden Test für die ArbitrageOne-URL schreiben**

`internal/post/arbitrageone_test.go`:

```go
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
		"&source_price_calculated_net=0" +
		"&estimated_sales=40" +
		"&target_marketplace=DE" +
		"&source_url=https%3A%2F%2Fwww.amazon.es%2Fdp%2FB01636IZ0G"

	if got != will {
		t.Errorf("URL falsch\n got: %s\nwill: %s", got, will)
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
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/post/`
Expected: FAIL — `undefined: ArbitrageOneURL`

- [ ] **Step 3: ArbitrageOne-URL umsetzen**

`internal/post/arbitrageone.go`:

```go
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

	paare := [][2]string{
		{"via", "fbaresell"},
		{"asin", p.ASIN},
		{"sell_price", p.VKBrutto.Dot()},
		{"source_price", p.EKBrutto.Dot()},
		{"source_price_calculated_net", nettoParameter(p.EKNettoBerechnet)},
		{"estimated_sales", strconv.Itoa(p.Sales)},
		{"target_marketplace", string(p.Zielmarkt)},
		{"source_url", p.QuellURL},
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

// nettoParameter liefert "0", wenn kein Nettowert vorliegt — so stand es im
// ursprünglich kopierten Link, und ArbitrageOne rechnet dann selbst.
func nettoParameter(c money.Cents) string {
	if c == 0 {
		return "0"
	}
	return c.Dot()
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `go test ./internal/post/ -run TestArbitrageOne -v`
Expected: PASS für alle drei Testfunktionen

- [ ] **Step 5: Den fehlschlagenden Test für das Rendern schreiben**

`internal/post/render_test.go`:

```go
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
		AOUrl:         "https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G",
	}
}

func TestRenderStandardVorlage(t *testing.T) {
	got, err := Render(StandardVorlage, referenzDaten())
	if err != nil {
		t.Fatalf("Render: %v", err)
	}

	will := strings.Join([]string{
		"🛒 Makita HR2630 B01636IZ0G @everyone",
		"🏬 [amazon.es](https://www.amazon.es/dp/B01636IZ0G)",
		"💰 EK: 130,56 € Brutto inkl. Versand (3er cart)",
		"💸 VK: 207,49 €  [Amazon.DE](https://www.amazon.de/dp/B01636IZ0G)",
		"ℹ️ Amazon.DE: 40 Verkäufe",
		"🤑 Gewinn: 31,67 € / 15,3 % Marge",
		":bar_chart: [ArbitrageOne Export](https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G)",
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
		"{{.Titel",             // Klammer nicht geschlossen
		"{{.GibtEsNicht}}",     // unbekanntes Feld
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
```

- [ ] **Step 6: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/post/ -run 'TestRender|TestPruefe|TestMarge'`
Expected: FAIL — `undefined: StandardVorlage`

- [ ] **Step 7: Rendern umsetzen**

`internal/post/render.go`:

```go
// Package post erzeugt den Text, der bei Discord landet.
package post

import (
	"errors"
	"fmt"
	"strings"
	"text/template"
)

// MaxLaenge ist Discords Grenze für den Nachrichtentext.
const MaxLaenge = 2000

var ErrZuLang = errors.New("post: Nachricht überschreitet 2000 Zeichen")

// Daten sind die Platzhalter der Vorlage. Alle Felder sind bereits fertig
// formatierte Zeichenketten — die Vorlage soll nicht rechnen oder formatieren
// müssen, damit ein Tippfehler darin nie eine falsche Zahl erzeugen kann.
type Daten struct {
	Titel   string
	ASIN    string
	Mention string

	EKHost  string
	EKUrl   string
	EK      string
	EKNotiz string

	VK        string
	VKUrl     string
	Zielmarkt string

	Sales string

	Gewinn        string
	Marge         string // eine Nachkommastelle, etwa "15,3 %"
	MargeGerundet string // ganzzahlig, etwa "15 %"

	AOUrl string
}

// StandardVorlage entspricht dem bisher von Hand gebauten Format.
const StandardVorlage = "🛒 {{.Titel}} {{.ASIN}} {{.Mention}}\n" +
	"🏬 [{{.EKHost}}]({{.EKUrl}})\n" +
	"💰 EK: {{.EK}} {{.EKNotiz}}\n" +
	"💸 VK: {{.VK}}  [Amazon.{{.Zielmarkt}}]({{.VKUrl}})\n" +
	"ℹ️ Amazon.{{.Zielmarkt}}: {{.Sales}} Verkäufe\n" +
	"🤑 Gewinn: {{.Gewinn}} / {{.Marge}} Marge\n" +
	":bar_chart: [ArbitrageOne Export]({{.AOUrl}})"

// Render setzt die Vorlage mit echten Werten zusammen.
//
// Bewusst text/template statt html/template: das Ziel ist Discord-Markdown,
// und die HTML-Variante würde & und Klammern zu Entitäten verstümmeln.
func Render(vorlage string, d Daten) (string, error) {
	t, err := template.New("post").Option("missingkey=error").Parse(vorlage)
	if err != nil {
		return "", fmt.Errorf("post: Vorlage nicht lesbar: %w", err)
	}

	var b strings.Builder
	if err := t.Execute(&b, d); err != nil {
		return "", fmt.Errorf("post: Vorlage nicht anwendbar: %w", err)
	}

	text := b.String()
	if len([]rune(text)) > MaxLaenge {
		return "", fmt.Errorf("%w (%d Zeichen)", ErrZuLang, len([]rune(text)))
	}
	return text, nil
}

// Pruefe stellt fest, ob eine Vorlage benutzbar ist, indem sie mit
// Beispieldaten gerendert wird. Die Einstellungsseite ruft das vor dem
// Speichern auf, damit eine kaputte Vorlage nie aktiv werden kann.
func Pruefe(vorlage string) error {
	_, err := Render(vorlage, beispiel)
	return err
}

var beispiel = Daten{
	Titel: "Beispielartikel", ASIN: "B000000000", Mention: "@everyone",
	EKHost: "amazon.es", EKUrl: "https://www.amazon.es/dp/B000000000",
	EK: "100,00 €", EKNotiz: "Brutto inkl. Versand",
	VK: "150,00 €", VKUrl: "https://www.amazon.de/dp/B000000000", Zielmarkt: "DE",
	Sales:  "40",
	Gewinn: "20,00 €", Marge: "13,3 %", MargeGerundet: "13 %",
	AOUrl:  "https://app.arbitrageone.de/analyze?via=fbaresell",
}
```

- [ ] **Step 8: Alle Tests des Pakets laufen lassen**

Run: `go test ./internal/post/ -v`
Expected: PASS für alle neun Testfunktionen

- [ ] **Step 9: Commit**

```bash
git add internal/post/
git commit -m "feat(post): Vorlagen-Rendering und ArbitrageOne-URL

text/template statt html/template — die HTML-Variante wuerde & und
Klammern zu Entitaeten machen und die Discord-Links zerstoeren.
Die AO-URL wird von Hand gebaut, weil url.Values alphabetisch
sortieren und damit vom Originallink abweichen wuerde.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Discord-Webhook mit Chart-Anhang

Sendet Text und PNG in einer `multipart/form-data`-Anfrage. Die Mention-Begrenzung ist hier kein Detail, sondern der Schutz davor, dass ein Testchannel versehentlich einen ganzen Server anpingt.

**Files:**
- Create: `internal/discord/webhook.go`
- Test: `internal/discord/webhook_test.go`

**Interfaces:**
- Consumes: nichts aus vorherigen Tasks
- Produces:
  - `discord.MentionTyp` (string) mit `MentionKeine`, `MentionEveryone`, `MentionHere`, `MentionRolle`
  - `discord.Nachricht{Inhalt string; Mention MentionTyp; RollenID string; ChartName string; ChartPNG []byte}`
  - `discord.Ergebnis{NachrichtID string}`
  - `discord.Sende(ctx context.Context, hc *http.Client, webhookURL string, n Nachricht) (Ergebnis, error)`
  - `discord.SendeMitWiederholung(ctx, hc, webhookURL, n) (Ergebnis, error)`
  - `discord.ErrWebhookTot`, `discord.ErrRateLimit{Warten time.Duration}`, `discord.ErrServer{Status int}`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`internal/discord/webhook_test.go`:

```go
package discord

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type empfangen struct {
	Inhalt   string
	Mentions map[string]any
	PNGName  string
	PNGBytes []byte
	WaitFlag string
}

// server nimmt eine Webhook-Anfrage entgegen und zerlegt sie.
func server(t *testing.T, status int, antwort string, ziel *empfangen) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ziel.WaitFlag = r.URL.Query().Get("wait")

		_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil {
			t.Errorf("Content-Type nicht lesbar: %v", err)
			return
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			teil, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("multipart: %v", err)
				return
			}
			daten, _ := io.ReadAll(teil)
			switch teil.FormName() {
			case "payload_json":
				var p struct {
					Content         string         `json:"content"`
					AllowedMentions map[string]any `json:"allowed_mentions"`
				}
				if err := json.Unmarshal(daten, &p); err != nil {
					t.Errorf("payload_json: %v", err)
				}
				ziel.Inhalt = p.Content
				ziel.Mentions = p.AllowedMentions
			case "files[0]":
				ziel.PNGName = teil.FileName()
				ziel.PNGBytes = daten
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, antwort)
	}))
}

func TestSendeMitAnhang(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1234567890"}`, &got)
	defer srv.Close()

	png := []byte("\x89PNG\r\n\x1a\nBILDDATEN")
	erg, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
		Inhalt:    "🛒 Makita HR2630 @everyone",
		Mention:   MentionEveryone,
		ChartName: "B01636IZ0G-20260905.png",
		ChartPNG:  png,
	})
	if err != nil {
		t.Fatalf("Sende: %v", err)
	}

	if erg.NachrichtID != "1234567890" {
		t.Errorf("NachrichtID = %q, will 1234567890", erg.NachrichtID)
	}
	if got.WaitFlag != "true" {
		t.Errorf("wait = %q, will true — ohne das liefert Discord keine Nachrichten-ID", got.WaitFlag)
	}
	if got.Inhalt != "🛒 Makita HR2630 @everyone" {
		t.Errorf("Inhalt = %q", got.Inhalt)
	}
	if got.PNGName != "B01636IZ0G-20260905.png" {
		t.Errorf("Dateiname = %q", got.PNGName)
	}
	if string(got.PNGBytes) != string(png) {
		t.Errorf("PNG-Inhalt weicht ab")
	}
}

func TestSendeOhneAnhang(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1"}`, &got)
	defer srv.Close()

	if _, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
		Inhalt: "nur Text", Mention: MentionKeine,
	}); err != nil {
		t.Fatalf("Sende: %v", err)
	}
	if got.PNGName != "" {
		t.Errorf("Dateiname = %q, will leer", got.PNGName)
	}
}

func TestAllowedMentions(t *testing.T) {
	faelle := []struct {
		mention   MentionTyp
		rollenID  string
		willParse []any
		willRoles []any
	}{
		{MentionKeine, "", []any{}, nil},
		{MentionEveryone, "", []any{"everyone"}, nil},
		{MentionHere, "", []any{"everyone"}, nil},
		{MentionRolle, "999", []any{}, []any{"999"}},
	}
	for _, f := range faelle {
		var got empfangen
		srv := server(t, 200, `{"id":"1"}`, &got)

		if _, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
			Inhalt: "@everyone Text", Mention: f.mention, RollenID: f.rollenID,
		}); err != nil {
			t.Fatalf("Sende(%s): %v", f.mention, err)
		}
		srv.Close()

		parse, _ := got.Mentions["parse"].([]any)
		if len(parse) != len(f.willParse) {
			t.Errorf("%s: parse = %v, will %v", f.mention, parse, f.willParse)
			continue
		}
		for i := range parse {
			if parse[i] != f.willParse[i] {
				t.Errorf("%s: parse[%d] = %v, will %v", f.mention, i, parse[i], f.willParse[i])
			}
		}
		rollen, _ := got.Mentions["roles"].([]any)
		if len(rollen) != len(f.willRoles) {
			t.Errorf("%s: roles = %v, will %v", f.mention, rollen, f.willRoles)
		}
	}
}

func TestMentionKeinePingtNichtTrotzEveryoneImText(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1"}`, &got)
	defer srv.Close()

	if _, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
		Inhalt: "Test @everyone bitte ignorieren", Mention: MentionKeine,
	}); err != nil {
		t.Fatalf("Sende: %v", err)
	}
	parse, _ := got.Mentions["parse"].([]any)
	if len(parse) != 0 {
		t.Errorf("parse = %v, will leer — ein Testchannel darf nie den Server anpingen", parse)
	}
}

func TestFehlerklassen(t *testing.T) {
	faelle := []struct {
		status int
		pruef  func(error) bool
		name   string
	}{
		{401, func(e error) bool { return errors.Is(e, ErrWebhookTot) }, "401"},
		{403, func(e error) bool { return errors.Is(e, ErrWebhookTot) }, "403"},
		{404, func(e error) bool { return errors.Is(e, ErrWebhookTot) }, "404"},
		{500, func(e error) bool { var s ErrServer; return errors.As(e, &s) }, "500"},
		{502, func(e error) bool { var s ErrServer; return errors.As(e, &s) }, "502"},
	}
	for _, f := range faelle {
		var got empfangen
		srv := server(t, f.status, `{}`, &got)
		_, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
		srv.Close()
		if err == nil || !f.pruef(err) {
			t.Errorf("HTTP %s: unerwarteter Fehler %v", f.name, err)
		}
	}
}

func TestRateLimitTraegtWartezeit(t *testing.T) {
	var got empfangen
	srv := server(t, 429, `{"retry_after":1.5}`, &got)
	defer srv.Close()

	_, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
	var rl ErrRateLimit
	if !errors.As(err, &rl) {
		t.Fatalf("will ErrRateLimit, bekam %v", err)
	}
	if rl.Warten != 1500*time.Millisecond {
		t.Errorf("Warten = %v, will 1.5s", rl.Warten)
	}
}

func TestWiederholungBeiServerfehler(t *testing.T) {
	versuche := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		versuche++
		if versuche < 3 {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"7"}`)
	}))
	defer srv.Close()

	erg, err := SendeMitWiederholung(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
	if err != nil {
		t.Fatalf("SendeMitWiederholung: %v", err)
	}
	if erg.NachrichtID != "7" {
		t.Errorf("NachrichtID = %q, will 7", erg.NachrichtID)
	}
	if versuche != 3 {
		t.Errorf("%d Versuche, will 3", versuche)
	}
}

func TestKeineWiederholungBeiTotemWebhook(t *testing.T) {
	versuche := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		versuche++
		w.WriteHeader(404)
	}))
	defer srv.Close()

	_, err := SendeMitWiederholung(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
	if !errors.Is(err, ErrWebhookTot) {
		t.Fatalf("will ErrWebhookTot, bekam %v", err)
	}
	if versuche != 1 {
		t.Errorf("%d Versuche, will 1 — ein toter Webhook wird durch Wiederholen nicht lebendig", versuche)
	}
}

func TestWebhookURLMitVorhandenerQuery(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1"}`, &got)
	defer srv.Close()

	if _, err := Sende(context.Background(), srv.Client(), srv.URL+"?thread_id=42", Nachricht{Inhalt: "x"}); err != nil {
		t.Fatalf("Sende: %v", err)
	}
	if got.WaitFlag != "true" {
		t.Errorf("wait = %q — vorhandene Query-Parameter dürfen wait nicht verdrängen", got.WaitFlag)
	}
}

var _ = strings.TrimSpace
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/discord/`
Expected: FAIL — `undefined: Sende`

- [ ] **Step 3: Umsetzen**

`internal/discord/webhook.go`:

```go
// Package discord sendet fertige Deal-Posts an einen Webhook.
package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"time"
)

// MentionTyp legt fest, wen eine Nachricht anpingen darf.
type MentionTyp string

const (
	MentionKeine    MentionTyp = "keine"
	MentionEveryone MentionTyp = "everyone"
	MentionHere     MentionTyp = "here"
	MentionRolle    MentionTyp = "rolle"
)

var ErrWebhookTot = errors.New("discord: Webhook ungültig oder gelöscht")

// ErrRateLimit trägt die von Discord genannte Wartezeit.
type ErrRateLimit struct{ Warten time.Duration }

func (e ErrRateLimit) Error() string {
	return fmt.Sprintf("discord: zu viele Anfragen, warte %s", e.Warten.Round(time.Millisecond))
}

// ErrServer steht für 5xx — vorübergehend, Wiederholen lohnt sich.
type ErrServer struct{ Status int }

func (e ErrServer) Error() string { return fmt.Sprintf("discord: Serverfehler HTTP %d", e.Status) }

type Nachricht struct {
	Inhalt    string
	Mention   MentionTyp
	RollenID  string
	ChartName string
	ChartPNG  []byte
}

type Ergebnis struct {
	NachrichtID string
}

// Sende schickt Text und Chart in einer Anfrage.
func Sende(ctx context.Context, hc *http.Client, webhookURL string, n Nachricht) (Ergebnis, error) {
	ziel, err := mitWait(webhookURL)
	if err != nil {
		return Ergebnis{}, err
	}

	koerper, contentType, err := baueMultipart(n)
	if err != nil {
		return Ergebnis{}, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ziel, bytes.NewReader(koerper))
	if err != nil {
		return Ergebnis{}, fmt.Errorf("discord: Anfrage nicht baubar: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := hc.Do(req)
	if err != nil {
		return Ergebnis{}, fmt.Errorf("discord: nicht erreichbar: %w", err)
	}
	defer resp.Body.Close()

	antwort, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	switch {
	case resp.StatusCode == http.StatusUnauthorized,
		resp.StatusCode == http.StatusForbidden,
		resp.StatusCode == http.StatusNotFound:
		return Ergebnis{}, fmt.Errorf("%w (HTTP %d)", ErrWebhookTot, resp.StatusCode)

	case resp.StatusCode == http.StatusTooManyRequests:
		var r struct {
			RetryAfter float64 `json:"retry_after"`
		}
		_ = json.Unmarshal(antwort, &r)
		return Ergebnis{}, ErrRateLimit{Warten: time.Duration(r.RetryAfter * float64(time.Second))}

	case resp.StatusCode >= 500:
		return Ergebnis{}, ErrServer{Status: resp.StatusCode}

	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return Ergebnis{}, fmt.Errorf("discord: HTTP %d: %s", resp.StatusCode, antwort)
	}

	var nachricht struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(antwort, &nachricht)
	return Ergebnis{NachrichtID: nachricht.ID}, nil
}

// SendeMitWiederholung fängt vorübergehende Störungen ab: einmal nach einem
// Rate Limit, zweimal bei Serverfehlern. Ein toter Webhook wird nicht
// wiederholt — der wird durch Warten nicht lebendig.
func SendeMitWiederholung(ctx context.Context, hc *http.Client, webhookURL string, n Nachricht) (Ergebnis, error) {
	var letzter error
	for versuch := 0; versuch < 3; versuch++ {
		erg, err := Sende(ctx, hc, webhookURL, n)
		if err == nil {
			return erg, nil
		}
		letzter = err

		var rl ErrRateLimit
		var se ErrServer
		switch {
		case errors.As(err, &rl):
			if versuch >= 1 {
				return Ergebnis{}, err
			}
			if err := warte(ctx, rl.Warten); err != nil {
				return Ergebnis{}, err
			}
		case errors.As(err, &se):
			if err := warte(ctx, time.Duration(versuch+1)*500*time.Millisecond); err != nil {
				return Ergebnis{}, err
			}
		default:
			return Ergebnis{}, err
		}
	}
	return Ergebnis{}, letzter
}

func warte(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// mitWait hängt wait=true an, ohne vorhandene Query-Parameter zu verwerfen.
// Ohne dieses Flag antwortet Discord mit 204 und ohne Nachrichten-ID.
func mitWait(roh string) (string, error) {
	u, err := url.Parse(roh)
	if err != nil {
		return "", fmt.Errorf("discord: Webhook-URL nicht lesbar: %w", err)
	}
	q := u.Query()
	q.Set("wait", "true")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func baueMultipart(n Nachricht) ([]byte, string, error) {
	var puffer bytes.Buffer
	w := multipart.NewWriter(&puffer)

	nutzlast := map[string]any{
		"content":          n.Inhalt,
		"allowed_mentions": erlaubteMentions(n),
	}
	roh, err := json.Marshal(nutzlast)
	if err != nil {
		return nil, "", fmt.Errorf("discord: Nutzlast nicht baubar: %w", err)
	}
	if err := w.WriteField("payload_json", string(roh)); err != nil {
		return nil, "", err
	}

	if len(n.ChartPNG) > 0 {
		name := n.ChartName
		if name == "" {
			name = "chart.png"
		}
		kopf := make(textproto.MIMEHeader)
		kopf.Set("Content-Disposition",
			fmt.Sprintf(`form-data; name="files[0]"; filename=%q`, name))
		kopf.Set("Content-Type", "image/png")

		teil, err := w.CreatePart(kopf)
		if err != nil {
			return nil, "", err
		}
		if _, err := teil.Write(n.ChartPNG); err != nil {
			return nil, "", err
		}
	}

	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return puffer.Bytes(), w.FormDataContentType(), nil
}

// erlaubteMentions begrenzt bei jedem Senden ausdrücklich, wer angepingt wird.
//
// Ohne dieses Feld pingt ein Webhook jeden, dessen Name im Text steht — ein
// Testchannel würde dann den halben Server aufwecken, sobald @everyone in der
// Vorlage steht.
func erlaubteMentions(n Nachricht) map[string]any {
	switch n.Mention {
	case MentionEveryone, MentionHere:
		// Discord kennt für @everyone und @here denselben parse-Wert.
		return map[string]any{"parse": []string{"everyone"}}
	case MentionRolle:
		return map[string]any{"parse": []string{}, "roles": []string{n.RollenID}}
	default:
		return map[string]any{"parse": []string{}}
	}
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `go test ./internal/discord/ -v`
Expected: PASS für alle neun Testfunktionen

- [ ] **Step 5: Commit**

```bash
git add internal/discord/
git commit -m "feat(discord): Webhook-Versand mit Chart-Anhang

allowed_mentions wird bei jedem Senden gesetzt, nicht nur wenn ein
Mention gewuenscht ist — sonst pingt ein Testchannel den halben
Server, sobald @everyone in der Vorlage steht.

Ein toter Webhook (401/403/404) wird nicht wiederholt, Rate Limits
einmal und Serverfehler zweimal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Datenbank und Einstellungen

Legt Schema und Einstellungsspeicher an. Der Treiber ist `modernc.org/sqlite`, weil er reines Go ist — mit `mattn/go-sqlite3` bräuchte der Windows-Build eine C-Toolchain, und das Doppelklick-Binary wäre dahin.

**Files:**
- Create: `internal/store/store.go`
- Create: `internal/store/settings.go`
- Test: `internal/store/store_test.go`
- Test: `internal/store/settings_test.go`
- Modify: `go.mod` (Abhängigkeit)

**Interfaces:**
- Consumes: `post.StandardVorlage` aus Task 7
- Produces:
  - `store.Store` mit `Open(dbPfad, chartOrdner string) (*Store, error)` und `(*Store).Close() error`
  - `(*Store).Einstellung(schluessel string) string` — liefert den Vorgabewert, wenn nichts gespeichert ist
  - `(*Store).SetzeEinstellung(schluessel, wert string) error`
  - `(*Store).AlleEinstellungen() map[string]string`
  - `(*Store).EinstellungZahl(schluessel string) int`
  - Konstanten `store.SchluesselKeepaKey`, `SchluesselVorlage`, `SchluesselMargenBasis`, `SchluesselUStModus`, `SchluesselUStPrefix`, `SchluesselProvision`, `SchluesselFBA`, `SchluesselZielmarkt`, `SchluesselChartTage`, `SchluesselChartBreite`, `SchluesselChartHoehe`, `SchluesselChartBuyBox`, `SchluesselChartAmazon`, `SchluesselChartNeu`, `SchluesselCacheMinuten`

- [ ] **Step 1: Abhängigkeit hinzufügen**

```bash
cd /Users/pascalwittler/lugru-deal-discord
go get modernc.org/sqlite@latest
go mod tidy
```

Prüfen, dass wirklich kein cgo nötig ist:

```bash
CGO_ENABLED=0 go build ./... && echo "cgo-frei: ok"
```

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

`internal/store/store_test.go`:

```go
package store

import (
	"path/filepath"
	"testing"
)

// temp legt einen Store in einem Testverzeichnis an.
func temp(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"), filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestOpenLegtSchemaAn(t *testing.T) {
	s := temp(t)
	for _, tabelle := range []string{"einstellungen", "channels", "deals", "keepa_cache"} {
		var name string
		err := s.db.QueryRow(
			`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tabelle,
		).Scan(&name)
		if err != nil {
			t.Errorf("Tabelle %q fehlt: %v", tabelle, err)
		}
	}
}

func TestOpenIstWiederholbar(t *testing.T) {
	dir := t.TempDir()
	pfad := filepath.Join(dir, "test.db")

	s1, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("erstes Open: %v", err)
	}
	if err := s1.SetzeEinstellung("probe", "wert"); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}
	s1.Close()

	s2, err := Open(pfad, filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("zweites Open: %v", err)
	}
	defer s2.Close()

	if got := s2.Einstellung("probe"); got != "wert" {
		t.Errorf("Einstellung nach Neuöffnen = %q, will \"wert\"", got)
	}
}
```

`internal/store/settings_test.go`:

```go
package store

import "testing"

func TestVorgabewerte(t *testing.T) {
	s := temp(t)
	faelle := map[string]string{
		SchluesselMargenBasis:  "brutto",
		SchluesselUStModus:     "netto",
		SchluesselProvision:    "15",
		SchluesselZielmarkt:    "DE",
		SchluesselChartTage:    "90",
		SchluesselChartBreite:  "800",
		SchluesselChartHoehe:   "350",
		SchluesselCacheMinuten: "30",
		SchluesselUStPrefix + "DE": "190",
		SchluesselUStPrefix + "ES": "210",
		SchluesselUStPrefix + "FR": "200",
		SchluesselUStPrefix + "IT": "220",
	}
	for schluessel, will := range faelle {
		if got := s.Einstellung(schluessel); got != will {
			t.Errorf("Einstellung(%q) = %q, will %q", schluessel, got, will)
		}
	}
}

func TestFBAHatKeinenVorgabewert(t *testing.T) {
	s := temp(t)
	// Eine geratene FBA-Gebuehr wuerde eine falsche Gewinnzahl in den Post
	// schreiben. Lieber leer lassen und den Nutzer tippen lassen.
	if got := s.Einstellung(SchluesselFBA); got != "" {
		t.Errorf("Einstellung(FBA) = %q, will leer", got)
	}
}

func TestVorlageIstVorbelegt(t *testing.T) {
	s := temp(t)
	if got := s.Einstellung(SchluesselVorlage); got == "" {
		t.Error("Vorlage ist leer, will die Standardvorlage")
	}
}

func TestSetzenUndLesen(t *testing.T) {
	s := temp(t)
	if err := s.SetzeEinstellung(SchluesselProvision, "12,5"); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}
	if got := s.Einstellung(SchluesselProvision); got != "12,5" {
		t.Errorf("Einstellung = %q, will 12,5", got)
	}
}

func TestUeberschreiben(t *testing.T) {
	s := temp(t)
	s.SetzeEinstellung("k", "a")
	s.SetzeEinstellung("k", "b")
	if got := s.Einstellung("k"); got != "b" {
		t.Errorf("Einstellung = %q, will b", got)
	}
}

func TestEinstellungZahl(t *testing.T) {
	s := temp(t)
	if got := s.EinstellungZahl(SchluesselChartTage); got != 90 {
		t.Errorf("EinstellungZahl(ChartTage) = %d, will 90", got)
	}
	s.SetzeEinstellung("kaputt", "keine zahl")
	if got := s.EinstellungZahl("kaputt"); got != 0 {
		t.Errorf("EinstellungZahl bei Unsinn = %d, will 0", got)
	}
}

func TestAlleEinstellungen(t *testing.T) {
	s := temp(t)
	alle := s.AlleEinstellungen()
	if alle[SchluesselZielmarkt] != "DE" {
		t.Errorf("AlleEinstellungen enthält Zielmarkt %q, will DE", alle[SchluesselZielmarkt])
	}
	if _, da := alle[SchluesselVorlage]; !da {
		t.Error("AlleEinstellungen enthält die Vorlage nicht")
	}
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/store/`
Expected: FAIL — `undefined: Open`

- [ ] **Step 4: Datenbank umsetzen**

`internal/store/store.go`:

```go
// Package store hält Channels, Deals, Einstellungen und den Keepa-Cache in
// einer SQLite-Datei neben dem Programm.
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // reines Go, damit CGO_ENABLED=0 möglich bleibt
)

type Store struct {
	db          *sql.DB
	chartOrdner string
}

// schema wird bei jedem Start ausgeführt. Alle Anweisungen sind
// wiederholbar, damit kein Migrationszähler nötig ist.
const schema = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    webhook_url TEXT    NOT NULL,
    mention_typ TEXT    NOT NULL DEFAULT 'keine',
    rollen_id   TEXT    NOT NULL DEFAULT '',
    defekt      INTEGER NOT NULL DEFAULT 0,
    angelegt_am TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    asin                 TEXT    NOT NULL,
    titel                TEXT    NOT NULL,
    quellmarkt           TEXT    NOT NULL,
    zielmarkt            TEXT    NOT NULL,
    ek_cent              INTEGER NOT NULL,
    ek_notiz             TEXT    NOT NULL DEFAULT '',
    vk_cent              INTEGER NOT NULL,
    vk_quelle            TEXT    NOT NULL DEFAULT '',
    sales                INTEGER NOT NULL DEFAULT 0,
    sales_quelle         TEXT    NOT NULL DEFAULT '',
    provision_prozent    REAL    NOT NULL DEFAULT 0,
    provision_quelle     TEXT    NOT NULL DEFAULT '',
    fba_cent             INTEGER NOT NULL DEFAULT 0,
    fba_quelle           TEXT    NOT NULL DEFAULT '',
    ust_modus            TEXT    NOT NULL DEFAULT 'netto',
    gewinn_cent          INTEGER NOT NULL DEFAULT 0,
    marge_prozent        REAL    NOT NULL DEFAULT 0,
    channel_id           INTEGER NOT NULL,
    channel_name         TEXT    NOT NULL,
    nachricht_text       TEXT    NOT NULL,
    chart_datei          TEXT    NOT NULL DEFAULT '',
    discord_nachricht_id TEXT    NOT NULL DEFAULT '',
    gepostet_am          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deals_asin      ON deals(asin);
CREATE INDEX IF NOT EXISTS idx_deals_gepostet  ON deals(gepostet_am DESC);

CREATE TABLE IF NOT EXISTS keepa_cache (
    asin         TEXT    NOT NULL,
    domain_id    INTEGER NOT NULL,
    geholt_am    TEXT    NOT NULL,
    antwort_json BLOB    NOT NULL,
    PRIMARY KEY (asin, domain_id)
);
`

// Open öffnet die Datenbank und legt Schema und Chart-Ordner an, falls sie
// fehlen.
func Open(dbPfad, chartOrdner string) (*Store, error) {
	if verz := filepath.Dir(dbPfad); verz != "" {
		if err := os.MkdirAll(verz, 0o755); err != nil {
			return nil, fmt.Errorf("store: Verzeichnis nicht anlegbar: %w", err)
		}
	}
	if err := os.MkdirAll(chartOrdner, 0o755); err != nil {
		return nil, fmt.Errorf("store: Chart-Ordner nicht anlegbar: %w", err)
	}

	db, err := sql.Open("sqlite", dbPfad+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("store: Datenbank nicht zu öffnen: %w", err)
	}
	// SQLite verträgt keine parallelen Schreiber; ein Verbindung reicht für
	// eine Einzelplatzanwendung und erspart Sperrfehler.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: Schema nicht anlegbar: %w", err)
	}

	return &Store{db: db, chartOrdner: chartOrdner}, nil
}

func (s *Store) Close() error { return s.db.Close() }
```

- [ ] **Step 5: Einstellungen umsetzen**

`internal/store/settings.go`:

```go
package store

import (
	"database/sql"
	"errors"
	"strconv"

	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
)

// Schlüssel der Einstellungen. Die USt-Sätze hängen das Länderkürzel an das
// Präfix an, etwa "ust.DE".
const (
	SchluesselKeepaKey     = "keepa.api_key"
	SchluesselVorlage      = "post.vorlage"
	SchluesselMargenBasis  = "calc.margen_basis"  // "brutto" oder "netto"
	SchluesselUStModus     = "calc.ust_modus"     // "netto" oder "brutto"
	SchluesselUStPrefix    = "ust."
	SchluesselProvision    = "calc.standard_provision"
	SchluesselFBA          = "calc.standard_fba"
	SchluesselZielmarkt    = "deal.standard_zielmarkt"
	SchluesselChartTage    = "chart.tage"
	SchluesselChartBreite  = "chart.breite"
	SchluesselChartHoehe   = "chart.hoehe"
	SchluesselChartBuyBox  = "chart.buybox"
	SchluesselChartAmazon  = "chart.amazon"
	SchluesselChartNeu     = "chart.neu"
	SchluesselCacheMinuten = "keepa.cache_minuten"
)

// vorgaben greifen, solange nichts gespeichert wurde.
//
// SchluesselFBA fehlt hier bewusst: eine geratene FBA-Gebühr würde eine
// falsche Gewinnzahl in den Post schreiben. Lieber leer lassen und den
// Nutzer zum Eintippen zwingen.
var vorgaben = map[string]string{
	SchluesselKeepaKey:         "",
	SchluesselVorlage:          post.StandardVorlage,
	SchluesselMargenBasis:      "brutto",
	SchluesselUStModus:         "netto",
	SchluesselProvision:        "15",
	SchluesselZielmarkt:        "DE",
	SchluesselChartTage:        "90",
	SchluesselChartBreite:      "800",
	SchluesselChartHoehe:       "350",
	SchluesselChartBuyBox:      "1",
	SchluesselChartAmazon:      "1",
	SchluesselChartNeu:         "1",
	SchluesselCacheMinuten:     "30",
	SchluesselUStPrefix + "DE": "190",
	SchluesselUStPrefix + "FR": "200",
	SchluesselUStPrefix + "IT": "220",
	SchluesselUStPrefix + "ES": "210",
}

// Einstellung liefert den gespeicherten Wert oder den Vorgabewert.
func (s *Store) Einstellung(schluessel string) string {
	var wert string
	err := s.db.QueryRow(
		`SELECT wert FROM einstellungen WHERE schluessel = ?`, schluessel,
	).Scan(&wert)
	if err == nil {
		return wert
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return vorgaben[schluessel]
	}
	return vorgaben[schluessel]
}

// EinstellungZahl liest eine ganzzahlige Einstellung. Unlesbare Werte ergeben
// 0, damit ein Tippfehler die Anwendung nicht anhält.
func (s *Store) EinstellungZahl(schluessel string) int {
	n, err := strconv.Atoi(s.Einstellung(schluessel))
	if err != nil {
		return 0
	}
	return n
}

func (s *Store) SetzeEinstellung(schluessel, wert string) error {
	_, err := s.db.Exec(`
		INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
		ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert`,
		schluessel, wert)
	return err
}

// AlleEinstellungen liefert Vorgaben und gespeicherte Werte zusammengeführt.
func (s *Store) AlleEinstellungen() map[string]string {
	alle := make(map[string]string, len(vorgaben))
	for k, v := range vorgaben {
		alle[k] = v
	}

	zeilen, err := s.db.Query(`SELECT schluessel, wert FROM einstellungen`)
	if err != nil {
		return alle
	}
	defer zeilen.Close()

	for zeilen.Next() {
		var k, v string
		if err := zeilen.Scan(&k, &v); err == nil {
			alle[k] = v
		}
	}
	return alle
}
```

- [ ] **Step 6: Tests laufen lassen**

Run: `go test ./internal/store/ -v`
Expected: PASS für alle neun Testfunktionen

- [ ] **Step 7: Cgo-Freiheit erneut prüfen**

Run: `CGO_ENABLED=0 go vet ./... && CGO_ENABLED=0 go build ./...`
Expected: keine Ausgabe, Exit 0

- [ ] **Step 8: Commit**

```bash
git add go.mod go.sum internal/store/
git commit -m "feat(store): SQLite-Schema und Einstellungen

modernc.org/sqlite statt mattn/go-sqlite3 — reines Go, damit
CGO_ENABLED=0 und damit der Windows-Build ohne C-Toolchain moeglich
bleibt.

Die Standard-FBA-Gebuehr hat bewusst keinen Vorgabewert: ein
geratener Betrag wuerde eine falsche Gewinnzahl in den Post schreiben.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Channels, Deals, Cache und Chart-Dateien

Der Rest der Datenhaltung. Zwei Entwurfsentscheidungen, die hier festgezurrt werden: der Channel-Name wird beim Deal mitgespeichert, damit die Historie einen gelöschten Channel überlebt, und Chart-Dateien heißen nach ASIN und Zeitstempel, weil die Deal-ID erst nach Discords Bestätigung existiert.

**Files:**
- Create: `internal/store/channels.go`
- Create: `internal/store/deals.go`
- Create: `internal/store/cache.go`
- Create: `internal/store/charts.go`
- Test: `internal/store/channels_test.go`
- Test: `internal/store/deals_test.go`
- Test: `internal/store/cache_test.go`
- Test: `internal/store/charts_test.go`

**Interfaces:**
- Consumes: `store.Store` aus Task 9, `money.Cents` aus Task 1
- Produces:
  - `store.Channel{ID int64; Name, WebhookURL, MentionTyp, RollenID string; Defekt bool; AngelegtAm time.Time}`
  - `(*Store).ChannelAnlegen(Channel) (int64, error)`, `.ChannelAendern(Channel) error`, `.ChannelLoeschen(int64) error`, `.Channel(int64) (Channel, error)`, `.Channels() ([]Channel, error)`, `.ChannelDefekt(int64, bool) error`
  - `store.Deal{ID int64; ASIN, Titel, Quellmarkt, Zielmarkt string; EKCent, VKCent, FBACent, GewinnCent money.Cents; EKNotiz, VKQuelle, SalesQuelle, ProvisionQuelle, FBAQuelle, UStModus string; Sales int; ProvisionProzent, MargeProzent float64; ChannelID int64; ChannelName, NachrichtText, ChartDatei, DiscordNachrichtID string; GepostetAm time.Time}`
  - `(*Store).DealAnlegen(Deal) (int64, error)`, `.Deal(int64) (Deal, error)`
  - `store.DealFilter{Suche string; ChannelID int64; Von, Bis time.Time; Limit, Offset int}`
  - `(*Store).Deals(DealFilter) ([]Deal, error)`, `.DealsAnzahl(DealFilter) (int, error)`, `.EKNotizen() ([]string, error)`
  - `(*Store).CacheLesen(asin string, domain int, maxAlter time.Duration) ([]byte, bool)`, `.CacheSchreiben(asin string, domain int, roh []byte) error`
  - `(*Store).ChartSpeichern(asin string, png []byte) (string, error)`, `.ChartPfad(datei string) string`, `.ChartLesen(datei string) ([]byte, error)`

- [ ] **Step 1: Den fehlschlagenden Channel-Test schreiben**

`internal/store/channels_test.go`:

```go
package store

import "testing"

func TestChannelRunde(t *testing.T) {
	s := temp(t)

	id, err := s.ChannelAnlegen(Channel{
		Name: "deals-vip", WebhookURL: "https://discord.com/api/webhooks/1/abc",
		MentionTyp: "everyone",
	})
	if err != nil {
		t.Fatalf("ChannelAnlegen: %v", err)
	}
	if id == 0 {
		t.Fatal("ChannelAnlegen lieferte ID 0")
	}

	c, err := s.Channel(id)
	if err != nil {
		t.Fatalf("Channel: %v", err)
	}
	if c.Name != "deals-vip" || c.MentionTyp != "everyone" {
		t.Errorf("Channel = %+v", c)
	}
	if c.AngelegtAm.IsZero() {
		t.Error("AngelegtAm ist nicht gesetzt")
	}

	c.Name = "deals-intern"
	c.MentionTyp = "keine"
	if err := s.ChannelAendern(c); err != nil {
		t.Fatalf("ChannelAendern: %v", err)
	}
	c2, _ := s.Channel(id)
	if c2.Name != "deals-intern" || c2.MentionTyp != "keine" {
		t.Errorf("nach Ändern: %+v", c2)
	}

	if err := s.ChannelDefekt(id, true); err != nil {
		t.Fatalf("ChannelDefekt: %v", err)
	}
	if c3, _ := s.Channel(id); !c3.Defekt {
		t.Error("Defekt = false nach ChannelDefekt(true)")
	}

	if err := s.ChannelLoeschen(id); err != nil {
		t.Fatalf("ChannelLoeschen: %v", err)
	}
	if _, err := s.Channel(id); err == nil {
		t.Error("gelöschter Channel ist noch abrufbar")
	}
}

func TestChannelsSortiertNachName(t *testing.T) {
	s := temp(t)
	for _, name := range []string{"zulu", "alpha", "mike"} {
		if _, err := s.ChannelAnlegen(Channel{Name: name, WebhookURL: "https://x/" + name}); err != nil {
			t.Fatalf("ChannelAnlegen(%s): %v", name, err)
		}
	}
	cs, err := s.Channels()
	if err != nil {
		t.Fatalf("Channels: %v", err)
	}
	will := []string{"alpha", "mike", "zulu"}
	if len(cs) != len(will) {
		t.Fatalf("%d Channels, will %d", len(cs), len(will))
	}
	for i, w := range will {
		if cs[i].Name != w {
			t.Errorf("Channels[%d] = %q, will %q", i, cs[i].Name, w)
		}
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/store/ -run TestChannel`
Expected: FAIL — `undefined: Channel`

- [ ] **Step 3: Channels umsetzen**

`internal/store/channels.go`:

```go
package store

import (
	"fmt"
	"time"
)

type Channel struct {
	ID         int64
	Name       string
	WebhookURL string
	MentionTyp string // "keine", "everyone", "here", "rolle"
	RollenID   string
	Defekt     bool
	AngelegtAm time.Time
}

func (s *Store) ChannelAnlegen(c Channel) (int64, error) {
	if c.MentionTyp == "" {
		c.MentionTyp = "keine"
	}
	erg, err := s.db.Exec(`
		INSERT INTO channels (name, webhook_url, mention_typ, rollen_id, defekt, angelegt_am)
		VALUES (?, ?, ?, ?, 0, ?)`,
		c.Name, c.WebhookURL, c.MentionTyp, c.RollenID, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return 0, fmt.Errorf("store: Channel nicht anlegbar: %w", err)
	}
	return erg.LastInsertId()
}

func (s *Store) ChannelAendern(c Channel) error {
	_, err := s.db.Exec(`
		UPDATE channels SET name = ?, webhook_url = ?, mention_typ = ?, rollen_id = ?
		WHERE id = ?`,
		c.Name, c.WebhookURL, c.MentionTyp, c.RollenID, c.ID)
	return err
}

func (s *Store) ChannelDefekt(id int64, defekt bool) error {
	wert := 0
	if defekt {
		wert = 1
	}
	_, err := s.db.Exec(`UPDATE channels SET defekt = ? WHERE id = ?`, wert, id)
	return err
}

func (s *Store) ChannelLoeschen(id int64) error {
	_, err := s.db.Exec(`DELETE FROM channels WHERE id = ?`, id)
	return err
}

const channelSpalten = `id, name, webhook_url, mention_typ, rollen_id, defekt, angelegt_am`

func (s *Store) Channel(id int64) (Channel, error) {
	zeile := s.db.QueryRow(`SELECT `+channelSpalten+` FROM channels WHERE id = ?`, id)
	return scanChannel(zeile)
}

func (s *Store) Channels() ([]Channel, error) {
	zeilen, err := s.db.Query(`SELECT ` + channelSpalten + ` FROM channels ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()

	var out []Channel
	for zeilen.Next() {
		c, err := scanChannel(zeilen)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, zeilen.Err()
}

type scanner interface{ Scan(...any) error }

func scanChannel(z scanner) (Channel, error) {
	var c Channel
	var defekt int
	var angelegt string
	if err := z.Scan(&c.ID, &c.Name, &c.WebhookURL, &c.MentionTyp, &c.RollenID, &defekt, &angelegt); err != nil {
		return Channel{}, err
	}
	c.Defekt = defekt != 0
	c.AngelegtAm, _ = time.Parse(time.RFC3339, angelegt)
	return c, nil
}
```

- [ ] **Step 4: Channel-Tests laufen lassen**

Run: `go test ./internal/store/ -run TestChannel -v`
Expected: PASS

- [ ] **Step 5: Den fehlschlagenden Deal-Test schreiben**

`internal/store/deals_test.go`:

```go
package store

import (
	"testing"
	"time"
)

func beispielDeal(channelID int64, asin, notiz string) Deal {
	return Deal{
		ASIN: asin, Titel: "Makita HR2630",
		Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, EKNotiz: notiz,
		VKCent: 20749, VKQuelle: "avg90",
		Sales: 40, SalesQuelle: "monthlySold",
		ProvisionProzent: 15, ProvisionQuelle: "keepa",
		FBACent: 864, FBAQuelle: "keepa",
		UStModus: "netto", GewinnCent: 3167, MargeProzent: 15.26,
		ChannelID: channelID, ChannelName: "deals-vip",
		NachrichtText: "🛒 Makita HR2630 B01636IZ0G",
		ChartDatei:    asin + "-20260905-120000.png",
		DiscordNachrichtID: "999",
	}
}

func TestDealRunde(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "deals-vip", WebhookURL: "https://x/1"})

	id, err := s.DealAnlegen(beispielDeal(cid, "B01636IZ0G", "Brutto inkl. Versand (3er cart)"))
	if err != nil {
		t.Fatalf("DealAnlegen: %v", err)
	}

	d, err := s.Deal(id)
	if err != nil {
		t.Fatalf("Deal: %v", err)
	}
	if d.GewinnCent != 3167 {
		t.Errorf("GewinnCent = %d, will 3167", d.GewinnCent)
	}
	if d.ChannelName != "deals-vip" {
		t.Errorf("ChannelName = %q", d.ChannelName)
	}
	if d.GepostetAm.IsZero() {
		t.Error("GepostetAm ist nicht gesetzt")
	}
}

func TestHistorieUeberlebtGeloeschtenChannel(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "deals-vip", WebhookURL: "https://x/1"})
	id, _ := s.DealAnlegen(beispielDeal(cid, "B01636IZ0G", "n"))

	if err := s.ChannelLoeschen(cid); err != nil {
		t.Fatalf("ChannelLoeschen: %v", err)
	}

	d, err := s.Deal(id)
	if err != nil {
		t.Fatalf("Deal nach Channel-Löschung: %v", err)
	}
	if d.ChannelName != "deals-vip" {
		t.Errorf("ChannelName = %q — der Name wird mitgespeichert, damit die Historie das überlebt", d.ChannelName)
	}
}

func TestDealsSuche(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(beispielDeal(cid, "B01636IZ0G", "n"))

	zweiter := beispielDeal(cid, "B0OTHER123", "n")
	zweiter.Titel = "Bosch GBH"
	s.DealAnlegen(zweiter)

	faelle := []struct {
		suche string
		will  int
	}{
		{"", 2},
		{"B01636IZ0G", 1},
		{"b01636iz0g", 1},
		{"Bosch", 1},
		{"Makita", 1},
		{"gibtsnicht", 0},
	}
	for _, f := range faelle {
		ds, err := s.Deals(DealFilter{Suche: f.suche, Limit: 50})
		if err != nil {
			t.Fatalf("Deals(%q): %v", f.suche, err)
		}
		if len(ds) != f.will {
			t.Errorf("Deals(%q) = %d Treffer, will %d", f.suche, len(ds), f.will)
		}
	}
}

func TestDealsNeuesteZuerst(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})

	alt := beispielDeal(cid, "B0ALT000000", "n")
	alt.GepostetAm = time.Now().Add(-48 * time.Hour)
	s.DealAnlegen(alt)

	neu := beispielDeal(cid, "B0NEU000000", "n")
	neu.GepostetAm = time.Now()
	s.DealAnlegen(neu)

	ds, err := s.Deals(DealFilter{Limit: 50})
	if err != nil {
		t.Fatalf("Deals: %v", err)
	}
	if len(ds) != 2 || ds[0].ASIN != "B0NEU000000" {
		t.Errorf("Reihenfolge falsch: %v", ds)
	}
}

func TestEKNotizen(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(beispielDeal(cid, "B0A0000000", "Brutto inkl. Versand"))
	s.DealAnlegen(beispielDeal(cid, "B0B0000000", "Brutto inkl. Versand (3er cart)"))
	s.DealAnlegen(beispielDeal(cid, "B0C0000000", "Brutto inkl. Versand"))

	notizen, err := s.EKNotizen()
	if err != nil {
		t.Fatalf("EKNotizen: %v", err)
	}
	if len(notizen) != 2 {
		t.Errorf("%d Notizen, will 2 (ohne Dopplung): %v", len(notizen), notizen)
	}
}

func TestDealsAnzahl(t *testing.T) {
	s := temp(t)
	cid, _ := s.ChannelAnlegen(Channel{Name: "c", WebhookURL: "https://x/1"})
	s.DealAnlegen(beispielDeal(cid, "B0A0000000", "n"))
	s.DealAnlegen(beispielDeal(cid, "B0B0000000", "n"))

	n, err := s.DealsAnzahl(DealFilter{})
	if err != nil {
		t.Fatalf("DealsAnzahl: %v", err)
	}
	if n != 2 {
		t.Errorf("DealsAnzahl = %d, will 2", n)
	}
}
```

- [ ] **Step 6: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/store/ -run TestDeal`
Expected: FAIL — `undefined: Deal`

- [ ] **Step 7: Deals umsetzen**

`internal/store/deals.go`:

```go
package store

import (
	"fmt"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// Deal ist ein gesendeter Post samt aller Zahlen, mit denen er gerechnet
// wurde. ChannelName wird bewusst mitgespeichert statt verknüpft: die
// Historie soll das Löschen eines Channels überleben.
type Deal struct {
	ID         int64
	ASIN       string
	Titel      string
	Quellmarkt string
	Zielmarkt  string

	EKCent  money.Cents
	EKNotiz string

	VKCent   money.Cents
	VKQuelle string

	Sales       int
	SalesQuelle string

	ProvisionProzent float64
	ProvisionQuelle  string

	FBACent   money.Cents
	FBAQuelle string

	UStModus     string
	GewinnCent   money.Cents
	MargeProzent float64

	ChannelID   int64
	ChannelName string

	NachrichtText      string
	ChartDatei         string
	DiscordNachrichtID string
	GepostetAm         time.Time
}

// DealFilter beschreibt eine Abfrage der Historie.
type DealFilter struct {
	Suche     string
	ChannelID int64
	Von, Bis  time.Time
	Limit     int
	Offset    int
}

func (s *Store) DealAnlegen(d Deal) (int64, error) {
	if d.GepostetAm.IsZero() {
		d.GepostetAm = time.Now()
	}
	erg, err := s.db.Exec(`
		INSERT INTO deals (
			asin, titel, quellmarkt, zielmarkt,
			ek_cent, ek_notiz, vk_cent, vk_quelle,
			sales, sales_quelle, provision_prozent, provision_quelle,
			fba_cent, fba_quelle, ust_modus, gewinn_cent, marge_prozent,
			channel_id, channel_name, nachricht_text, chart_datei,
			discord_nachricht_id, gepostet_am
		) VALUES (?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?)`,
		d.ASIN, d.Titel, d.Quellmarkt, d.Zielmarkt,
		int64(d.EKCent), d.EKNotiz, int64(d.VKCent), d.VKQuelle,
		d.Sales, d.SalesQuelle, d.ProvisionProzent, d.ProvisionQuelle,
		int64(d.FBACent), d.FBAQuelle, d.UStModus, int64(d.GewinnCent), d.MargeProzent,
		d.ChannelID, d.ChannelName, d.NachrichtText, d.ChartDatei,
		d.DiscordNachrichtID, d.GepostetAm.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, fmt.Errorf("store: Deal nicht speicherbar: %w", err)
	}
	return erg.LastInsertId()
}

const dealSpalten = `
	id, asin, titel, quellmarkt, zielmarkt,
	ek_cent, ek_notiz, vk_cent, vk_quelle,
	sales, sales_quelle, provision_prozent, provision_quelle,
	fba_cent, fba_quelle, ust_modus, gewinn_cent, marge_prozent,
	channel_id, channel_name, nachricht_text, chart_datei,
	discord_nachricht_id, gepostet_am`

func (s *Store) Deal(id int64) (Deal, error) {
	return scanDeal(s.db.QueryRow(`SELECT `+dealSpalten+` FROM deals WHERE id = ?`, id))
}

// bedingungen baut die WHERE-Klausel und ihre Parameter.
func (f DealFilter) bedingungen() (string, []any) {
	var teile []string
	var args []any

	if s := strings.TrimSpace(f.Suche); s != "" {
		teile = append(teile, `(asin LIKE ? COLLATE NOCASE OR titel LIKE ? COLLATE NOCASE)`)
		muster := "%" + s + "%"
		args = append(args, muster, muster)
	}
	if f.ChannelID != 0 {
		teile = append(teile, `channel_id = ?`)
		args = append(args, f.ChannelID)
	}
	if !f.Von.IsZero() {
		teile = append(teile, `gepostet_am >= ?`)
		args = append(args, f.Von.UTC().Format(time.RFC3339Nano))
	}
	if !f.Bis.IsZero() {
		teile = append(teile, `gepostet_am <= ?`)
		args = append(args, f.Bis.UTC().Format(time.RFC3339Nano))
	}

	if len(teile) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(teile, " AND "), args
}

func (s *Store) Deals(f DealFilter) ([]Deal, error) {
	wo, args := f.bedingungen()
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}

	abfrage := `SELECT ` + dealSpalten + ` FROM deals` + wo +
		` ORDER BY gepostet_am DESC, id DESC LIMIT ? OFFSET ?`
	args = append(args, limit, f.Offset)

	zeilen, err := s.db.Query(abfrage, args...)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()

	var out []Deal
	for zeilen.Next() {
		d, err := scanDeal(zeilen)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, zeilen.Err()
}

func (s *Store) DealsAnzahl(f DealFilter) (int, error) {
	wo, args := f.bedingungen()
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM deals`+wo, args...).Scan(&n)
	return n, err
}

// EKNotizen liefert die bisher benutzten Notizen für die Vorschlagsliste im
// Formular — ohne eigene Pflegetabelle.
func (s *Store) EKNotizen() ([]string, error) {
	zeilen, err := s.db.Query(`
		SELECT DISTINCT ek_notiz FROM deals
		WHERE ek_notiz <> '' ORDER BY ek_notiz COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()

	var out []string
	for zeilen.Next() {
		var n string
		if err := zeilen.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, zeilen.Err()
}

func scanDeal(z scanner) (Deal, error) {
	var d Deal
	var ek, vk, fba, gewinn int64
	var gepostet string

	err := z.Scan(
		&d.ID, &d.ASIN, &d.Titel, &d.Quellmarkt, &d.Zielmarkt,
		&ek, &d.EKNotiz, &vk, &d.VKQuelle,
		&d.Sales, &d.SalesQuelle, &d.ProvisionProzent, &d.ProvisionQuelle,
		&fba, &d.FBAQuelle, &d.UStModus, &gewinn, &d.MargeProzent,
		&d.ChannelID, &d.ChannelName, &d.NachrichtText, &d.ChartDatei,
		&d.DiscordNachrichtID, &gepostet)
	if err != nil {
		return Deal{}, err
	}

	d.EKCent = money.Cents(ek)
	d.VKCent = money.Cents(vk)
	d.FBACent = money.Cents(fba)
	d.GewinnCent = money.Cents(gewinn)
	d.GepostetAm, _ = time.Parse(time.RFC3339Nano, gepostet)
	return d, nil
}
```

- [ ] **Step 8: Deal-Tests laufen lassen**

Run: `go test ./internal/store/ -run TestDeal -v && go test ./internal/store/ -run 'TestHistorie|TestEKNotizen' -v`
Expected: PASS

- [ ] **Step 9: Den fehlschlagenden Test für Cache und Charts schreiben**

`internal/store/cache_test.go`:

```go
package store

import (
	"testing"
	"time"
)

func TestCacheTrefferUndAblauf(t *testing.T) {
	s := temp(t)
	roh := []byte(`{"products":[{"asin":"B01636IZ0G"}]}`)

	if _, da := s.CacheLesen("B01636IZ0G", 3, time.Hour); da {
		t.Error("leerer Cache meldet einen Treffer")
	}

	if err := s.CacheSchreiben("B01636IZ0G", 3, roh); err != nil {
		t.Fatalf("CacheSchreiben: %v", err)
	}

	got, da := s.CacheLesen("B01636IZ0G", 3, time.Hour)
	if !da {
		t.Fatal("frisch geschriebener Eintrag wird nicht gefunden")
	}
	if string(got) != string(roh) {
		t.Errorf("Inhalt weicht ab: %q", got)
	}

	if _, da := s.CacheLesen("B01636IZ0G", 3, 0); da {
		t.Error("abgelaufener Eintrag wird noch geliefert")
	}
}

func TestCacheTrenntMarktplaetze(t *testing.T) {
	s := temp(t)
	s.CacheSchreiben("B01636IZ0G", 3, []byte(`{"markt":"de"}`))

	if _, da := s.CacheLesen("B01636IZ0G", 9, time.Hour); da {
		t.Error("Eintrag für Domain 3 wird für Domain 9 geliefert")
	}
}

func TestCacheUeberschreibt(t *testing.T) {
	s := temp(t)
	s.CacheSchreiben("B01636IZ0G", 3, []byte(`alt`))
	s.CacheSchreiben("B01636IZ0G", 3, []byte(`neu`))

	got, _ := s.CacheLesen("B01636IZ0G", 3, time.Hour)
	if string(got) != "neu" {
		t.Errorf("Cache = %q, will neu", got)
	}
}
```

`internal/store/charts_test.go`:

```go
package store

import (
	"os"
	"strings"
	"testing"
)

func TestChartSpeichernUndLesen(t *testing.T) {
	s := temp(t)
	png := []byte("\x89PNG\r\n\x1a\nDATEN")

	datei, err := s.ChartSpeichern("B01636IZ0G", png)
	if err != nil {
		t.Fatalf("ChartSpeichern: %v", err)
	}
	if !strings.HasPrefix(datei, "B01636IZ0G-") || !strings.HasSuffix(datei, ".png") {
		t.Errorf("Dateiname = %q, will B01636IZ0G-<zeitstempel>.png", datei)
	}

	got, err := s.ChartLesen(datei)
	if err != nil {
		t.Fatalf("ChartLesen: %v", err)
	}
	if string(got) != string(png) {
		t.Error("Inhalt weicht ab")
	}

	if _, err := os.Stat(s.ChartPfad(datei)); err != nil {
		t.Errorf("Datei liegt nicht auf der Platte: %v", err)
	}
}

func TestChartNamenKollidierenNicht(t *testing.T) {
	s := temp(t)
	png := []byte("\x89PNG\r\n\x1a\n")

	a, _ := s.ChartSpeichern("B01636IZ0G", png)
	b, _ := s.ChartSpeichern("B01636IZ0G", png)
	if a == b {
		t.Errorf("zwei Charts derselben ASIN bekamen denselben Namen %q", a)
	}
}

func TestChartLesenLaesstNichtAusbrechen(t *testing.T) {
	s := temp(t)
	// Ein Dateiname aus der Datenbank darf nie aus dem Chart-Ordner führen.
	for _, boese := range []string{"../../etc/passwd", "/etc/passwd", "..\\..\\windows\\system.ini"} {
		if _, err := s.ChartLesen(boese); err == nil {
			t.Errorf("ChartLesen(%q) lieferte Daten statt eines Fehlers", boese)
		}
	}
}
```

- [ ] **Step 10: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/store/ -run 'TestCache|TestChart'`
Expected: FAIL — `undefined: CacheLesen`

- [ ] **Step 11: Cache und Charts umsetzen**

`internal/store/cache.go`:

```go
package store

import (
	"database/sql"
	"errors"
	"time"
)

// CacheLesen liefert eine gespeicherte Keepa-Antwort, falls sie jünger als
// maxAlter ist. Erspart Token bei Tippfehlern im Formular, beim Zurückgehen
// im Browser und beim zweiten Anlauf.
func (s *Store) CacheLesen(asin string, domain int, maxAlter time.Duration) ([]byte, bool) {
	var geholt string
	var roh []byte

	err := s.db.QueryRow(
		`SELECT geholt_am, antwort_json FROM keepa_cache WHERE asin = ? AND domain_id = ?`,
		asin, domain).Scan(&geholt, &roh)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, false
		}
		return nil, false
	}

	zeit, err := time.Parse(time.RFC3339Nano, geholt)
	if err != nil {
		return nil, false
	}
	if time.Since(zeit) > maxAlter {
		return nil, false
	}
	return roh, true
}

func (s *Store) CacheSchreiben(asin string, domain int, roh []byte) error {
	_, err := s.db.Exec(`
		INSERT INTO keepa_cache (asin, domain_id, geholt_am, antwort_json)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(asin, domain_id) DO UPDATE
		SET geholt_am = excluded.geholt_am, antwort_json = excluded.antwort_json`,
		asin, domain, time.Now().UTC().Format(time.RFC3339Nano), roh)
	return err
}
```

`internal/store/charts.go`:

```go
package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var ErrUngueltigerChartname = errors.New("store: ungültiger Chart-Dateiname")

// ChartSpeichern legt das PNG unter <asin>-<zeitstempel>.png ab.
//
// Bewusst nicht nach Deal-ID benannt: die entsteht erst beim Einfügen in die
// Datenbank, und das passiert erst, nachdem Discord das Senden bestätigt hat.
func (s *Store) ChartSpeichern(asin string, png []byte) (string, error) {
	datei := fmt.Sprintf("%s-%s.png", asin, time.Now().UTC().Format("20060102-150405.000"))
	if err := os.WriteFile(filepath.Join(s.chartOrdner, datei), png, 0o644); err != nil {
		return "", fmt.Errorf("store: Chart nicht speicherbar: %w", err)
	}
	return datei, nil
}

// ChartPfad liefert den vollen Pfad eines Chart-Dateinamens.
func (s *Store) ChartPfad(datei string) string {
	return filepath.Join(s.chartOrdner, datei)
}

// ChartLesen holt ein gespeichertes Bild zurück.
//
// Der Dateiname wird geprüft, obwohl er aus der eigenen Datenbank stammt: die
// Historie reicht ihn später an einen HTTP-Handler weiter, und dort darf kein
// Pfad aus dem Chart-Ordner herausführen.
func (s *Store) ChartLesen(datei string) ([]byte, error) {
	if datei == "" ||
		strings.ContainsAny(datei, `/\`) ||
		strings.Contains(datei, "..") {
		return nil, ErrUngueltigerChartname
	}
	return os.ReadFile(filepath.Join(s.chartOrdner, datei))
}
```

- [ ] **Step 12: Alle Tests des Pakets laufen lassen**

Run: `go test ./internal/store/ -v`
Expected: PASS für alle Testfunktionen aus Task 9 und 10

- [ ] **Step 13: Commit**

```bash
git add internal/store/
git commit -m "feat(store): Channels, Deals, Keepa-Cache und Chart-Dateien

Der Channel-Name wird beim Deal mitgespeichert statt verknuepft,
damit die Historie das Loeschen eines Channels ueberlebt.

Chart-Dateien heissen nach ASIN und Zeitstempel, weil die Deal-ID
erst nach Discords Bestaetigung existiert. ChartLesen prueft den
Namen, weil ihn spaeter ein HTTP-Handler weiterreicht.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Web-Grundgerüst und Einstellungsseite

Server, Routen, eingebettete Vorlagen und die Einstellungsseite. Der wichtigste Teil ist die Vorlagenprüfung: eine kaputte Post-Vorlage darf die Anwendung nicht lahmlegen.

**Files:**
- Create: `internal/web/server.go`
- Create: `internal/web/settings.go`
- Create: `internal/web/templates/layout.html`
- Create: `internal/web/templates/einstellungen.html`
- Create: `internal/web/static/style.css`
- Create: `internal/web/static/htmx.min.js`
- Test: `internal/web/server_test.go`
- Test: `internal/web/settings_test.go`

**Interfaces:**
- Consumes: `store.Store` aus Task 9/10, `post.Pruefe`/`post.StandardVorlage` aus Task 7, `keepa.Client` aus Task 6, `marketplace.All` aus Task 2
- Produces:
  - `web.Server{}` mit `web.Neu(s *store.Store, k *keepa.Client, hc *http.Client) *Server`
  - `(*Server).Routen() http.Handler`
  - `(*Server).rendere(w http.ResponseWriter, name string, daten any)` (paketintern)

- [ ] **Step 1: htmx holen**

```bash
cd /Users/pascalwittler/lugru-deal-discord
mkdir -p internal/web/static internal/web/templates
curl -sL https://cdnjs.cloudflare.com/ajax/libs/htmx/2.0.4/htmx.min.js \
  -o internal/web/static/htmx.min.js
test -s internal/web/static/htmx.min.js && echo "htmx geladen: $(wc -c < internal/web/static/htmx.min.js) Bytes"
```

Die Datei wird ins Binary eingebettet — die Anwendung darf im Betrieb kein CDN brauchen.

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

`internal/web/server_test.go`:

```go
package web

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// testServer baut einen Server auf einer frischen Datenbank.
func testServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	s, err := store.Open(filepath.Join(dir, "test.db"), filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	return Neu(s, keepa.NeuerClient(""), http.DefaultClient), s
}

func hole(t *testing.T, srv *Server, methode, pfad string, formular string) *httptest.ResponseRecorder {
	t.Helper()
	var koerper *strings.Reader
	if formular == "" {
		koerper = strings.NewReader("")
	} else {
		koerper = strings.NewReader(formular)
	}
	r := httptest.NewRequest(methode, pfad, koerper)
	if formular != "" {
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	w := httptest.NewRecorder()
	srv.Routen().ServeHTTP(w, r)
	return w
}

func TestStartseiteAntwortet(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodGet, "/", "")
	if w.Code != http.StatusOK {
		t.Errorf("Status = %d, will 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "<html") {
		t.Error("Antwort enthält kein HTML")
	}
}

func TestStatischeDateienWerdenAusgeliefert(t *testing.T) {
	srv, _ := testServer(t)
	for _, pfad := range []string{"/static/style.css", "/static/htmx.min.js"} {
		w := hole(t, srv, http.MethodGet, pfad, "")
		if w.Code != http.StatusOK {
			t.Errorf("%s: Status = %d, will 200", pfad, w.Code)
		}
		if w.Body.Len() == 0 {
			t.Errorf("%s: leerer Körper", pfad)
		}
	}
}

func TestUnbekanntePfadeGeben404(t *testing.T) {
	srv, _ := testServer(t)
	if w := hole(t, srv, http.MethodGet, "/gibtsnicht", ""); w.Code != http.StatusNotFound {
		t.Errorf("Status = %d, will 404", w.Code)
	}
}
```

`internal/web/settings_test.go`:

```go
package web

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestEinstellungenSeiteZeigtWerte(t *testing.T) {
	srv, s := testServer(t)
	s.SetzeEinstellung(store.SchluesselProvision, "12,5")

	w := hole(t, srv, http.MethodGet, "/einstellungen", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d, will 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "12,5") {
		t.Error("gespeicherte Provision steht nicht im Formular")
	}
}

func TestEinstellungenSpeichern(t *testing.T) {
	srv, s := testServer(t)

	f := url.Values{
		store.SchluesselKeepaKey:  {"abc123"},
		store.SchluesselVorlage:   {post.StandardVorlage},
		store.SchluesselProvision: {"14"},
		store.SchluesselZielmarkt: {"ES"},
	}
	w := hole(t, srv, http.MethodPost, "/einstellungen", f.Encode())
	if w.Code != http.StatusOK && w.Code != http.StatusSeeOther {
		t.Fatalf("Status = %d", w.Code)
	}

	if got := s.Einstellung(store.SchluesselKeepaKey); got != "abc123" {
		t.Errorf("KeepaKey = %q, will abc123", got)
	}
	if got := s.Einstellung(store.SchluesselProvision); got != "14" {
		t.Errorf("Provision = %q, will 14", got)
	}
}

func TestKaputteVorlageWirdAbgelehnt(t *testing.T) {
	srv, s := testServer(t)

	f := url.Values{store.SchluesselVorlage: {"{{.GibtEsNicht}}"}}
	w := hole(t, srv, http.MethodPost, "/einstellungen", f.Encode())

	if got := s.Einstellung(store.SchluesselVorlage); got != post.StandardVorlage {
		t.Errorf("Vorlage wurde überschrieben (%q) — eine kaputte Vorlage darf nie aktiv werden", got)
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "vorlage") {
		t.Error("Antwort nennt das Problem mit der Vorlage nicht")
	}
}

func TestVorlagenVorschau(t *testing.T) {
	srv, _ := testServer(t)

	f := url.Values{store.SchluesselVorlage: {"Gewinn: {{.Gewinn}}"}}
	w := hole(t, srv, http.MethodPost, "/einstellungen/vorschau", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d, will 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "Gewinn:") {
		t.Errorf("Vorschau zeigt die gerenderte Vorlage nicht: %s", w.Body.String())
	}
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/web/`
Expected: FAIL — `undefined: Neu`

- [ ] **Step 4: Server umsetzen**

`internal/web/server.go`:

```go
// Package web liefert die lokale Oberfläche aus.
package web

import (
	"embed"
	"html/template"
	"log"
	"net/http"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

//go:embed templates/*.html
var vorlagenFS embed.FS

//go:embed static
var statischFS embed.FS

type Server struct {
	store *store.Store
	keepa *keepa.Client
	http  *http.Client
	tmpl  *template.Template
}

func Neu(s *store.Store, k *keepa.Client, hc *http.Client) *Server {
	return &Server{
		store: s,
		keepa: k,
		http:  hc,
		tmpl:  template.Must(template.ParseFS(vorlagenFS, "templates/*.html")),
	}
}

func (srv *Server) Routen() http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /static/", http.FileServerFS(statischFS))

	mux.HandleFunc("GET /{$}", srv.zeigeDeal)
	mux.HandleFunc("POST /deal/laden", srv.ladeDeal)
	mux.HandleFunc("POST /deal/vorschau", srv.vorschauDeal)
	mux.HandleFunc("POST /deal/senden", srv.sendeDeal)
	mux.HandleFunc("GET /chart", srv.zeigeChart)

	mux.HandleFunc("GET /historie", srv.zeigeHistorie)
	mux.HandleFunc("GET /historie/chart/{datei}", srv.zeigeHistorieChart)

	mux.HandleFunc("GET /channels", srv.zeigeChannels)
	mux.HandleFunc("POST /channels", srv.speichereChannel)
	mux.HandleFunc("POST /channels/{id}/loeschen", srv.loescheChannel)
	mux.HandleFunc("POST /channels/{id}/test", srv.testeChannel)

	mux.HandleFunc("GET /einstellungen", srv.zeigeEinstellungen)
	mux.HandleFunc("POST /einstellungen", srv.speichereEinstellungen)
	mux.HandleFunc("POST /einstellungen/vorschau", srv.vorschauVorlage)

	return mux
}

// rendere gibt eine benannte Vorlage aus. Fehler beim Rendern werden
// protokolliert statt halb ausgegeben.
func (srv *Server) rendere(w http.ResponseWriter, name string, daten any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := srv.tmpl.ExecuteTemplate(w, name, daten); err != nil {
		log.Printf("Vorlage %s: %v", name, err)
	}
}

// fehler antwortet mit einer schlichten Meldung, die htmx einsetzen kann.
func (srv *Server) fehler(w http.ResponseWriter, status int, meldung string) {
	// Content-Type muss vor WriteHeader gesetzt werden, danach ist es wirkungslos.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := srv.tmpl.ExecuteTemplate(w, "fehler", meldung); err != nil {
		log.Printf("Vorlage fehler: %v", err)
	}
}
```

- [ ] **Step 5: Vorlagen und Stil anlegen**

`internal/web/templates/layout.html`:

```html
{{define "kopf"}}<!doctype html>
<html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Titel}} · Lugru Deals</title>
<link rel="stylesheet" href="/static/style.css">
<script src="/static/htmx.min.js"></script>
</head><body>
<nav>
  <a href="/">Neuer Deal</a>
  <a href="/historie">Historie</a>
  <a href="/channels">Channels</a>
  <a href="/einstellungen">Einstellungen</a>
  {{if .TokenText}}<span class="token">{{.TokenText}}</span>{{end}}
</nav>
<main>{{end}}

{{define "fuss"}}</main></body></html>{{end}}

{{define "fehler"}}<p class="fehler">{{.}}</p>{{end}}
```

`internal/web/templates/einstellungen.html`:

```html
{{define "einstellungen"}}
{{template "kopf" .}}
<h1>Einstellungen</h1>
{{if .Meldung}}<p class="meldung">{{.Meldung}}</p>{{end}}
{{if .Fehler}}<p class="fehler">{{.Fehler}}</p>{{end}}

<form method="post" action="/einstellungen">
  <label>Keepa-API-Key
    <input type="password" name="keepa.api_key" value="{{.Werte.keepaKey}}" autocomplete="off">
  </label>

  <fieldset><legend>Post-Vorlage</legend>
    <textarea name="post.vorlage" rows="9"
              hx-post="/einstellungen/vorschau" hx-trigger="keyup changed delay:400ms"
              hx-target="#vorschau">{{.Werte.vorlage}}</textarea>
    <div id="vorschau" class="vorschau">{{.Vorschau}}</div>
  </fieldset>

  <fieldset><legend>Rechnen</legend>
    <label>Standard-Provision in Prozent
      <input name="calc.standard_provision" value="{{.Werte.provision}}"></label>
    <label>Standard-FBA-Gebühr in Euro <small>leer lassen, wenn unbekannt</small>
      <input name="calc.standard_fba" value="{{.Werte.fba}}" placeholder="leer"></label>
    <label>Vorsteuer
      <select name="calc.ust_modus">
        <option value="netto" {{if eq .Werte.ustModus "netto"}}selected{{end}}>abziehbar (netto)</option>
        <option value="brutto" {{if eq .Werte.ustModus "brutto"}}selected{{end}}>nicht abziehbar (brutto)</option>
      </select></label>
    <label>Marge bezogen auf
      <select name="calc.margen_basis">
        <option value="brutto" {{if eq .Werte.margenBasis "brutto"}}selected{{end}}>VK brutto</option>
        <option value="netto" {{if eq .Werte.margenBasis "netto"}}selected{{end}}>VK netto</option>
      </select></label>
    {{range .USt}}
      <label>USt {{.Code}} in Promille
        <input name="ust.{{.Code}}" value="{{.Wert}}"></label>
    {{end}}
  </fieldset>

  <fieldset><legend>Chart</legend>
    <label>Zeitraum in Tagen <input name="chart.tage" value="{{.Werte.chartTage}}"></label>
    <label>Breite <input name="chart.breite" value="{{.Werte.chartBreite}}"></label>
    <label>Höhe <input name="chart.hoehe" value="{{.Werte.chartHoehe}}"></label>
  </fieldset>

  <fieldset><legend>Sonstiges</legend>
    <label>Standard-Zielmarkt
      <select name="deal.standard_zielmarkt">
        {{range .Maerkte}}<option value="{{.Code}}" {{if eq (printf "%s" .Code) $.Werte.zielmarkt}}selected{{end}}>{{.Code}}</option>{{end}}
      </select></label>
    <label>Keepa-Cache in Minuten <input name="keepa.cache_minuten" value="{{.Werte.cacheMinuten}}"></label>
  </fieldset>

  <button type="submit">Speichern</button>
</form>
{{template "fuss"}}
{{end}}
```

`internal/web/static/style.css`:

```css
:root { --rand: #d8d8d8; --grund: #fbfbfa; --text: #1c1c1a; --gedaempft: #6b6b66; --warnung: #b3261e; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
       background: var(--grund); color: var(--text); }
nav { display: flex; gap: 1.25rem; align-items: center; padding: .75rem 1.5rem;
      border-bottom: 1px solid var(--rand); background: #fff; }
nav a { color: var(--text); text-decoration: none; }
nav a:hover { text-decoration: underline; }
nav .token { margin-left: auto; color: var(--gedaempft); font-size: 13px; }
main { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
label { display: block; margin: .6rem 0; }
label small { color: var(--gedaempft); font-weight: normal; }
input, select, textarea { width: 100%; padding: .45rem .6rem; font: inherit;
                          border: 1px solid var(--rand); border-radius: 4px; background: #fff; }
textarea { font-family: ui-monospace, Menlo, Consolas, monospace; }
fieldset { border: 1px solid var(--rand); border-radius: 6px; margin: 1rem 0; padding: .5rem 1rem 1rem; }
button { padding: .5rem 1.1rem; font: inherit; border: 1px solid var(--rand);
         border-radius: 4px; background: #fff; cursor: pointer; }
button:hover { background: #f0f0ee; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--rand); }
.vorschau { white-space: pre-wrap; font-family: ui-monospace, Menlo, Consolas, monospace;
            background: #fff; border: 1px solid var(--rand); border-radius: 4px; padding: .75rem; }
.fehler { color: var(--warnung); }
.meldung { color: #1b5e20; }
.herkunft { color: var(--gedaempft); font-size: 12px; }
.spalten { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
@media (max-width: 800px) { .spalten { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Einstellungs-Handler umsetzen**

`internal/web/settings.go`:

```go
package web

import (
	"net/http"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type ustZeile struct {
	Code marketplace.Code
	Wert string
}

type einstellungenDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	Vorschau  string
	Maerkte   []marketplace.Marketplace
	USt       []ustZeile
	Werte     map[string]string
}

func (srv *Server) einstellungenDaten() einstellungenDaten {
	alle := srv.store.AlleEinstellungen()

	var ust []ustZeile
	for _, m := range marketplace.All() {
		ust = append(ust, ustZeile{Code: m.Code, Wert: alle[store.SchluesselUStPrefix+string(m.Code)]})
	}

	return einstellungenDaten{
		Titel:   "Einstellungen",
		Maerkte: marketplace.All(),
		USt:     ust,
		Werte: map[string]string{
			"keepaKey":     alle[store.SchluesselKeepaKey],
			"vorlage":      alle[store.SchluesselVorlage],
			"provision":    alle[store.SchluesselProvision],
			"fba":          alle[store.SchluesselFBA],
			"ustModus":     alle[store.SchluesselUStModus],
			"margenBasis":  alle[store.SchluesselMargenBasis],
			"zielmarkt":    alle[store.SchluesselZielmarkt],
			"chartTage":    alle[store.SchluesselChartTage],
			"chartBreite":  alle[store.SchluesselChartBreite],
			"chartHoehe":   alle[store.SchluesselChartHoehe],
			"cacheMinuten": alle[store.SchluesselCacheMinuten],
		},
	}
}

func (srv *Server) zeigeEinstellungen(w http.ResponseWriter, r *http.Request) {
	d := srv.einstellungenDaten()
	d.Vorschau, _ = post.Render(d.Werte["vorlage"], beispielDaten())
	srv.rendere(w, "einstellungen", d)
}

// speichereEinstellungen übernimmt alle gesendeten Felder.
//
// Die Post-Vorlage wird vorher gerendert; schlägt das fehl, bleibt die
// bisherige aktiv. Eine kaputte Vorlage darf nie in den Betrieb gelangen.
func (srv *Server) speichereEinstellungen(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		srv.fehler(w, http.StatusBadRequest, "Formular nicht lesbar")
		return
	}

	d := srv.einstellungenDaten()

	if vorlage := r.PostForm.Get(store.SchluesselVorlage); vorlage != "" {
		if err := post.Pruefe(vorlage); err != nil {
			d.Fehler = "Vorlage nicht gespeichert: " + err.Error()
			d.Vorschau, _ = post.Render(d.Werte["vorlage"], beispielDaten())
			srv.rendere(w, "einstellungen", d)
			return
		}
	}

	for schluessel, werte := range r.PostForm {
		if len(werte) > 0 {
			if err := srv.store.SetzeEinstellung(schluessel, werte[0]); err != nil {
				srv.fehler(w, http.StatusInternalServerError, "Speichern fehlgeschlagen: "+err.Error())
				return
			}
		}
	}

	d = srv.einstellungenDaten()
	d.Meldung = "Gespeichert."
	d.Vorschau, _ = post.Render(d.Werte["vorlage"], beispielDaten())
	srv.rendere(w, "einstellungen", d)
}

// vorschauVorlage rendert die Vorlage im Textfeld, während getippt wird.
func (srv *Server) vorschauVorlage(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	text, err := post.Render(r.PostForm.Get(store.SchluesselVorlage), beispielDaten())
	if err != nil {
		text = "⚠ " + err.Error()
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	srv.rendere(w, "vorschautext", text)
}

// beispielDaten füttern die Vorschau, solange kein echter Deal geladen ist.
func beispielDaten() post.Daten {
	return post.Daten{
		Titel: "Makita HR2630", ASIN: "B01636IZ0G", Mention: "@everyone",
		EKHost: "amazon.es", EKUrl: "https://www.amazon.es/dp/B01636IZ0G",
		EK: "130,56 €", EKNotiz: "Brutto inkl. Versand (3er cart)",
		VK: "207,49 €", VKUrl: "https://www.amazon.de/dp/B01636IZ0G", Zielmarkt: "DE",
		Sales:  "40",
		Gewinn: "31,67 €", Marge: "15,3 %", MargeGerundet: "15 %",
		AOUrl:  "https://app.arbitrageone.de/analyze?via=fbaresell&asin=B01636IZ0G",
	}
}
```

Zusätzlich in `layout.html` ergänzen:

```html
{{define "vorschautext"}}{{.}}{{end}}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `go test ./internal/web/ -v`
Expected: PASS für `TestStartseiteAntwortet` (nach Task 13 vollständig), `TestStatischeDateien…`, `TestEinstellungen…`, `TestKaputteVorlageWirdAbgelehnt`, `TestVorlagenVorschau`

Hinweis: `TestStartseiteAntwortet` schlägt fehl, solange `zeigeDeal` aus Task 13 fehlt. Für diesen Task genügt ein Platzhalter in `server.go`:

```go
func (srv *Server) zeigeDeal(w http.ResponseWriter, r *http.Request) {
	srv.rendere(w, "kopf", map[string]string{"Titel": "Neuer Deal"})
	srv.rendere(w, "fuss", nil)
}
```

Die übrigen noch fehlenden Handler bekommen bis Task 12 bis 14 denselben Platzhalter.

- [ ] **Step 8: Commit**

```bash
git add internal/web/ go.mod
git commit -m "feat(web): Grundgeruest, Vorlagen und Einstellungsseite

htmx und CSS liegen eingebettet im Binary — die Anwendung darf im
Betrieb kein CDN brauchen.

Eine kaputte Post-Vorlage wird beim Speichern abgelehnt, die
bisherige bleibt aktiv. Sonst koennte ein Tippfehler in den
Einstellungen das Posten dauerhaft unmoeglich machen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Channel-Verwaltung

Anlegen, ändern, löschen, testen. Der Testknopf sendet eine echte Nachricht — mit `MentionKeine`, damit ein Test nie jemanden anpingt.

**Files:**
- Create: `internal/web/channels.go`
- Create: `internal/web/templates/channels.html`
- Test: `internal/web/channels_test.go`

**Interfaces:**
- Consumes: `store.Channel` aus Task 10, `discord.Sende` aus Task 8
- Produces: Handler `zeigeChannels`, `speichereChannel`, `loescheChannel`, `testeChannel`; `web.maskiere(url string) string`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`internal/web/channels_test.go`:

```go
package web

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestChannelAnlegenUeberFormular(t *testing.T) {
	srv, s := testServer(t)

	f := url.Values{
		"name":        {"deals-vip"},
		"webhook_url": {"https://discord.com/api/webhooks/123/geheimestoken"},
		"mention_typ": {"everyone"},
	}
	if w := hole(t, srv, http.MethodPost, "/channels", f.Encode()); w.Code >= 400 {
		t.Fatalf("Status = %d", w.Code)
	}

	cs, err := s.Channels()
	if err != nil {
		t.Fatalf("Channels: %v", err)
	}
	if len(cs) != 1 || cs[0].Name != "deals-vip" || cs[0].MentionTyp != "everyone" {
		t.Errorf("Channels = %+v", cs)
	}
}

func TestChannelListeMaskiertWebhook(t *testing.T) {
	srv, s := testServer(t)
	s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: "https://discord.com/api/webhooks/123/geheimestoken",
	})

	w := hole(t, srv, http.MethodGet, "/channels", "")
	if strings.Contains(w.Body.String(), "geheimestoken") {
		t.Error("die Webhook-URL steht im Klartext in der Seite")
	}
	if !strings.Contains(w.Body.String(), "deals-vip") {
		t.Error("der Channel-Name fehlt in der Liste")
	}
}

func TestChannelLoeschen(t *testing.T) {
	srv, s := testServer(t)
	id, _ := s.ChannelAnlegen(store.Channel{Name: "weg", WebhookURL: "https://x/1"})

	pfad := "/channels/" + itoa(id) + "/loeschen"
	if w := hole(t, srv, http.MethodPost, pfad, ""); w.Code >= 400 {
		t.Fatalf("Status = %d", w.Code)
	}
	if cs, _ := s.Channels(); len(cs) != 0 {
		t.Errorf("%d Channels übrig, will 0", len(cs))
	}
}

func TestChannelOhneNamenAbgelehnt(t *testing.T) {
	srv, s := testServer(t)
	f := url.Values{"name": {""}, "webhook_url": {"https://x/1"}}
	hole(t, srv, http.MethodPost, "/channels", f.Encode())

	if cs, _ := s.Channels(); len(cs) != 0 {
		t.Error("Channel ohne Namen wurde angelegt")
	}
}

func TestChannelOhneWebhookAbgelehnt(t *testing.T) {
	srv, s := testServer(t)
	f := url.Values{"name": {"x"}, "webhook_url": {""}}
	hole(t, srv, http.MethodPost, "/channels", f.Encode())

	if cs, _ := s.Channels(); len(cs) != 0 {
		t.Error("Channel ohne Webhook-URL wurde angelegt")
	}
}

func TestMaskiere(t *testing.T) {
	faelle := map[string]string{
		"https://discord.com/api/webhooks/123456/sehrlangesgeheimestoken": "https://discord.com/api/webhooks/123456/…oken",
		"":     "",
		"kurz": "…kurz",
	}
	for ein, will := range faelle {
		if got := maskiere(ein); got != will {
			t.Errorf("maskiere(%q) = %q, will %q", ein, got, will)
		}
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/web/ -run TestChannel`
Expected: FAIL — `undefined: maskiere`

- [ ] **Step 3: Umsetzen**

`internal/web/channels.go`:

```go
package web

import (
	"net/http"
	"strconv"

	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type channelAnzeige struct {
	store.Channel
	WebhookMaskiert string
}

type channelDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	Channels  []channelAnzeige
}

func itoa(i int64) string { return strconv.FormatInt(i, 10) }

// maskiere kürzt eine Webhook-URL auf die letzten vier Zeichen. Die URL ist
// ein Geheimnis — wer sie hat, kann in den Channel schreiben.
func maskiere(u string) string {
	if u == "" {
		return ""
	}
	r := []rune(u)
	if len(r) <= 4 {
		return "…" + u
	}
	sichtbar := 4
	return string(r[:min(len(r)-sichtbar, 36)]) + "…" + string(r[len(r)-sichtbar:])
}

func (srv *Server) channelDaten() channelDaten {
	d := channelDaten{Titel: "Channels"}
	cs, err := srv.store.Channels()
	if err != nil {
		d.Fehler = "Channels nicht lesbar: " + err.Error()
		return d
	}
	for _, c := range cs {
		d.Channels = append(d.Channels, channelAnzeige{Channel: c, WebhookMaskiert: maskiere(c.WebhookURL)})
	}
	return d
}

func (srv *Server) zeigeChannels(w http.ResponseWriter, r *http.Request) {
	srv.rendere(w, "channels", srv.channelDaten())
}

func (srv *Server) speichereChannel(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		srv.fehler(w, http.StatusBadRequest, "Formular nicht lesbar")
		return
	}

	c := store.Channel{
		Name:       r.PostForm.Get("name"),
		WebhookURL: r.PostForm.Get("webhook_url"),
		MentionTyp: r.PostForm.Get("mention_typ"),
		RollenID:   r.PostForm.Get("rollen_id"),
	}

	d := srv.channelDaten()
	if c.Name == "" || c.WebhookURL == "" {
		d.Fehler = "Name und Webhook-URL sind Pflicht."
		srv.rendere(w, "channels", d)
		return
	}

	var err error
	if idText := r.PostForm.Get("id"); idText != "" && idText != "0" {
		c.ID, _ = strconv.ParseInt(idText, 10, 64)
		err = srv.store.ChannelAendern(c)
	} else {
		_, err = srv.store.ChannelAnlegen(c)
	}
	if err != nil {
		d.Fehler = "Speichern fehlgeschlagen: " + err.Error()
		srv.rendere(w, "channels", d)
		return
	}

	d = srv.channelDaten()
	d.Meldung = "Gespeichert."
	srv.rendere(w, "channels", d)
}

func (srv *Server) loescheChannel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Channel-ID")
		return
	}
	d := srv.channelDaten()
	if err := srv.store.ChannelLoeschen(id); err != nil {
		d.Fehler = "Löschen fehlgeschlagen: " + err.Error()
	} else {
		d = srv.channelDaten()
		d.Meldung = "Channel gelöscht. Die Historie bleibt erhalten."
	}
	srv.rendere(w, "channels", d)
}

// testeChannel sendet eine echte Nachricht — bewusst ohne Mention, damit ein
// Test niemals einen ganzen Server anpingt.
func (srv *Server) testeChannel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Channel-ID")
		return
	}

	c, err := srv.store.Channel(id)
	if err != nil {
		srv.fehler(w, http.StatusNotFound, "Channel nicht gefunden")
		return
	}

	d := srv.channelDaten()
	_, err = discord.Sende(r.Context(), srv.http, c.WebhookURL, discord.Nachricht{
		Inhalt:  "✅ Testnachricht aus Lugru Deals — dieser Webhook funktioniert.",
		Mention: discord.MentionKeine,
	})
	if err != nil {
		_ = srv.store.ChannelDefekt(id, true)
		d = srv.channelDaten()
		d.Fehler = "Test fehlgeschlagen: " + err.Error()
	} else {
		_ = srv.store.ChannelDefekt(id, false)
		d = srv.channelDaten()
		d.Meldung = "Testnachricht gesendet."
	}
	srv.rendere(w, "channels", d)
}
```

`internal/web/templates/channels.html`:

```html
{{define "channels"}}
{{template "kopf" .}}
<h1>Channels</h1>
{{if .Meldung}}<p class="meldung">{{.Meldung}}</p>{{end}}
{{if .Fehler}}<p class="fehler">{{.Fehler}}</p>{{end}}

<table>
  <tr><th>Name</th><th>Webhook</th><th>Mention</th><th>Zustand</th><th></th></tr>
  {{range .Channels}}
  <tr>
    <td>{{.Name}}</td>
    <td><code>{{.WebhookMaskiert}}</code></td>
    <td>{{.MentionTyp}}{{if .RollenID}} ({{.RollenID}}){{end}}</td>
    <td>{{if .Defekt}}<span class="fehler">defekt</span>{{else}}ok{{end}}</td>
    <td>
      <form method="post" action="/channels/{{.ID}}/test" style="display:inline">
        <button type="submit">Testen</button></form>
      <form method="post" action="/channels/{{.ID}}/loeschen" style="display:inline">
        <button type="submit">Löschen</button></form>
    </td>
  </tr>
  {{else}}
  <tr><td colspan="5">Noch kein Channel angelegt.</td></tr>
  {{end}}
</table>

<h2>Neuer Channel</h2>
<form method="post" action="/channels">
  <label>Name <input name="name" required></label>
  <label>Webhook-URL <input name="webhook_url" type="url" required></label>
  <label>Mention
    <select name="mention_typ">
      <option value="keine">keine</option>
      <option value="everyone">@everyone</option>
      <option value="here">@here</option>
      <option value="rolle">Rolle</option>
    </select></label>
  <label>Rollen-ID <small>nur bei Mention „Rolle"</small><input name="rollen_id"></label>
  <button type="submit">Anlegen</button>
</form>
{{template "fuss"}}
{{end}}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `go test ./internal/web/ -run TestChannel -v && go test ./internal/web/ -run TestMaskiere -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/web/
git commit -m "feat(web): Channel-Verwaltung mit Testknopf

Webhook-URLs sind Geheimnisse und werden in der Liste maskiert.
Der Testknopf sendet bewusst mit MentionKeine — ein Test darf nie
einen ganzen Server anpingen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Neuer Deal — der Kernablauf

Die Seite, auf der die Arbeit passiert. Vorschau und Senden teilen sich denselben Rechen- und Renderweg, damit der Text im Discord garantiert der ist, den die Vorschau gezeigt hat.

**Files:**
- Create: `internal/web/deal.go`
- Create: `internal/web/templates/deal.html`
- Test: `internal/web/deal_test.go`
- Modify: `internal/web/server.go` (Platzhalter `zeigeDeal` ersetzen)

**Interfaces:**
- Consumes: alle bisherigen Pakete
- Produces:
  - `web.dealFormular` (paketintern) mit `ASIN, Quellmarkt, Zielmarkt, Titel, VK, VKQuelle, EK, EKNotiz, Sales, SalesQuelle, Provision, ProvisionQuelle, FBA, FBAQuelle, UStModus string; ChannelID int64`
  - `(*Server).baueDeal(dealFormular) (dealErgebnis, error)` — der gemeinsame Weg von Vorschau und Senden
  - Handler `zeigeDeal`, `ladeDeal`, `vorschauDeal`, `sendeDeal`, `zeigeChart`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`internal/web/deal_test.go`:

```go
package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// keepaServer liefert die Fixture aus dem keepa-Paket aus.
func keepaServer(t *testing.T) *httptest.Server {
	t.Helper()
	roh, err := os.ReadFile(filepath.Join("..", "keepa", "testdata", "produkt.json"))
	if err != nil {
		t.Fatalf("Fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/pricehistory.png") {
			w.Header().Set("Content-Type", "image/png")
			w.Write([]byte("\x89PNG\r\n\x1a\nTESTBILD"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(roh)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// referenzFormular sind die Werte des Makita-Deals aus der Spec.
func referenzFormular(channelID int64) url.Values {
	return url.Values{
		"asin":             {"B01636IZ0G"},
		"quellmarkt":       {"ES"},
		"zielmarkt":        {"DE"},
		"titel":            {"Makita HR2630"},
		"vk":               {"207,49"},
		"vk_quelle":        {"avg90"},
		"ek":              {"130,56"},
		"ek_notiz":         {"Brutto inkl. Versand (3er cart)"},
		"sales":            {"40"},
		"sales_quelle":     {"monthlySold"},
		"provision":        {"15"},
		"provision_quelle": {"keepa"},
		"fba":              {"8,64"},
		"fba_quelle":       {"keepa"},
		"ust_modus":        {"netto"},
		"channel_id":       {itoa(channelID)},
	}
}

func TestVorschauRechnetReferenzfall(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: "https://x/1", MentionTyp: "everyone",
	})

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	koerper := w.Body.String()
	for _, muss := range []string{"31,67", "15,3", "Makita HR2630", "B01636IZ0G", "@everyone"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Vorschau enthält %q nicht:\n%s", muss, koerper)
		}
	}
}

func TestVorschauBruttoModus(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	f := referenzFormular(cid)
	f.Set("ust_modus", "brutto")

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode())
	if !strings.Contains(w.Body.String(), "9,01") {
		t.Errorf("Brutto-Modus zeigt nicht 9,01 €:\n%s", w.Body.String())
	}
}

func TestLadenFuelltFormular(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.ChartBasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	f := url.Values{
		"eingabe":   {"https://www.amazon.es/dp/B01636IZ0G"},
		"zielmarkt": {"DE"},
	}
	w := hole(t, srv, http.MethodPost, "/deal/laden", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	koerper := w.Body.String()
	for _, muss := range []string{
		"B01636IZ0G",
		"Makita",   // Titel aus Keepa
		"207,49",   // avg90 Buy Box
		"40",       // monthlySold
		"15",       // Provision aus Keepa
		"8,64",     // FBA aus Keepa
	} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Formular enthält %q nicht:\n%s", muss, koerper)
		}
	}
	if !strings.Contains(koerper, "ES") {
		t.Error("der aus der URL erkannte Quellmarkt ES fehlt")
	}
}

func TestLadenZeigtHerkunftDerWerte(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.BasisURL = ks.URL
	srv.keepa.ChartBasisURL = ks.URL
	s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})

	w := hole(t, srv, http.MethodPost, "/deal/laden",
		url.Values{"eingabe": {"B01636IZ0G"}, "quellmarkt": {"ES"}, "zielmarkt": {"DE"}}.Encode())

	if !strings.Contains(w.Body.String(), "Keepa") {
		t.Error("die Herkunftsangabe „Keepa\" fehlt — geschätzte und gemessene Werte müssen unterscheidbar sein")
	}
}

func TestLadenMitUnbekannterEingabe(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodPost, "/deal/laden", url.Values{"eingabe": {"kein link"}}.Encode())
	if !strings.Contains(strings.ToLower(w.Body.String()), "asin") {
		t.Errorf("Fehlermeldung nennt die ASIN nicht:\n%s", w.Body.String())
	}
}

func TestSendenSpeichertNurBeiErfolg(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.ChartBasisURL = ks.URL

	// Webhook antwortet mit 404 — der Deal darf nicht in der Historie landen.
	tot := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer tot.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "kaputt", WebhookURL: tot.URL})

	hole(t, srv, http.MethodPost, "/deal/senden", referenzFormular(cid).Encode())

	n, err := s.DealsAnzahl(store.DealFilter{})
	if err != nil {
		t.Fatalf("DealsAnzahl: %v", err)
	}
	if n != 0 {
		t.Errorf("%d Deals gespeichert, will 0 — ein fehlgeschlagener Post darf nicht als gepostet gelten", n)
	}

	c, _ := s.Channel(cid)
	if !c.Defekt {
		t.Error("der Channel wurde nach 404 nicht als defekt markiert")
	}
}

func TestSendenSpeichertBeiErfolg(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.ChartBasisURL = ks.URL

	var gesendet string
	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roh, _ := readAll(r)
		gesendet = roh
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"555"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: dc.URL, MentionTyp: "everyone",
	})

	w := hole(t, srv, http.MethodPost, "/deal/senden", referenzFormular(cid).Encode())
	if w.Code >= 400 {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	ds, err := s.Deals(store.DealFilter{Limit: 10})
	if err != nil {
		t.Fatalf("Deals: %v", err)
	}
	if len(ds) != 1 {
		t.Fatalf("%d Deals, will 1", len(ds))
	}

	d := ds[0]
	if d.GewinnCent != 3167 {
		t.Errorf("GewinnCent = %d, will 3167", d.GewinnCent)
	}
	if d.ChannelName != "deals-vip" {
		t.Errorf("ChannelName = %q", d.ChannelName)
	}
	if d.DiscordNachrichtID != "555" {
		t.Errorf("DiscordNachrichtID = %q, will 555", d.DiscordNachrichtID)
	}
	if d.ChartDatei == "" {
		t.Error("ChartDatei ist leer — der Chart wurde nicht archiviert")
	}
	if _, err := s.ChartLesen(d.ChartDatei); err != nil {
		t.Errorf("Chart nicht lesbar: %v", err)
	}
	if !strings.Contains(gesendet, "TESTBILD") {
		t.Error("das Chart-PNG wurde nicht mitgesendet")
	}
}

func TestSendenOhneChannelAbgelehnt(t *testing.T) {
	srv, s := testServer(t)

	f := referenzFormular(0)
	f.Set("channel_id", "0")
	hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())

	if n, _ := s.DealsAnzahl(store.DealFilter{}); n != 0 {
		t.Error("Deal ohne Channel wurde gespeichert")
	}
}

func TestVorschauUndSendenErzeugenDenselbenText(t *testing.T) {
	srv, s := testServer(t)
	ks := keepaServer(t)
	srv.keepa.ChartBasisURL = ks.URL

	dc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer dc.Close()

	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: dc.URL, MentionTyp: "everyone"})
	f := referenzFormular(cid)

	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())

	ds, _ := s.Deals(store.DealFilter{Limit: 1})
	if len(ds) != 1 {
		t.Fatal("kein Deal gespeichert")
	}
	// Der gepostete Text muss Zeile für Zeile in der Vorschau gestanden haben.
	for _, zeile := range strings.Split(ds[0].NachrichtText, "\n") {
		if zeile == "" {
			continue
		}
		if !strings.Contains(vorschau, htmlEscape(zeile)) {
			t.Errorf("Zeile stand nicht in der Vorschau: %q", zeile)
		}
	}
}
```

Dazu zwei kleine Testhelfer in `deal_test.go`:

```go
func readAll(r *http.Request) (string, error) {
	b, err := io.ReadAll(r.Body)
	return string(b), err
}

func htmlEscape(s string) string { return template.HTMLEscapeString(s) }
```

mit den Importen `io` und `html/template`.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/web/ -run TestVorschau`
Expected: FAIL — Route `/deal/vorschau` liefert 404 oder der Handler fehlt

- [ ] **Step 3: Den gemeinsamen Rechenweg umsetzen**

`internal/web/deal.go`:

```go
package web

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/calc"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// dealFormular sind die Rohwerte aus dem Formular, alle als Text.
type dealFormular struct {
	ASIN       string
	Quellmarkt string
	Zielmarkt  string
	Titel      string

	VK       string
	VKQuelle string

	EK      string
	EKNotiz string

	Sales       string
	SalesQuelle string

	Provision       string
	ProvisionQuelle string

	FBA       string
	FBAQuelle string

	UStModus  string
	ChannelID int64
}

func formularLesen(r *http.Request) dealFormular {
	id, _ := strconv.ParseInt(r.PostForm.Get("channel_id"), 10, 64)
	return dealFormular{
		ASIN:            strings.ToUpper(strings.TrimSpace(r.PostForm.Get("asin"))),
		Quellmarkt:      r.PostForm.Get("quellmarkt"),
		Zielmarkt:       r.PostForm.Get("zielmarkt"),
		Titel:           r.PostForm.Get("titel"),
		VK:              r.PostForm.Get("vk"),
		VKQuelle:        r.PostForm.Get("vk_quelle"),
		EK:              r.PostForm.Get("ek"),
		EKNotiz:         r.PostForm.Get("ek_notiz"),
		Sales:           r.PostForm.Get("sales"),
		SalesQuelle:     r.PostForm.Get("sales_quelle"),
		Provision:       r.PostForm.Get("provision"),
		ProvisionQuelle: r.PostForm.Get("provision_quelle"),
		FBA:             r.PostForm.Get("fba"),
		FBAQuelle:       r.PostForm.Get("fba_quelle"),
		UStModus:        r.PostForm.Get("ust_modus"),
		ChannelID:       id,
	}
}

type dealErgebnis struct {
	Text     string
	Ergebnis calc.Ergebnis
	Quell    marketplace.Marketplace
	Ziel     marketplace.Marketplace
	Channel  store.Channel
	EKBrutto money.Cents
	VKBrutto money.Cents
	FBA      money.Cents
	Sales    int
	Provision float64
	ChartURL string
}

// baueDeal rechnet und rendert.
//
// Vorschau und Senden gehen beide hier durch, damit der Text im Discord
// garantiert derselbe ist, den die Vorschau gezeigt hat.
func (srv *Server) baueDeal(f dealFormular) (dealErgebnis, error) {
	quell, ok := marketplace.ByCode(marketplace.Code(f.Quellmarkt))
	if !ok {
		return dealErgebnis{}, fmt.Errorf("unbekannter Einkaufsmarktplatz %q", f.Quellmarkt)
	}
	ziel, ok := marketplace.ByCode(marketplace.Code(f.Zielmarkt))
	if !ok {
		return dealErgebnis{}, fmt.Errorf("unbekannter Zielmarktplatz %q", f.Zielmarkt)
	}

	ek, err := money.Parse(f.EK)
	if err != nil {
		return dealErgebnis{}, fmt.Errorf("Einkaufspreis: %w", err)
	}
	vk, err := money.Parse(f.VK)
	if err != nil {
		return dealErgebnis{}, fmt.Errorf("Verkaufspreis: %w", err)
	}

	// Die FBA-Gebühr darf leer sein und zählt dann als 0 — sie hat bewusst
	// keinen geratenen Vorgabewert.
	var fba money.Cents
	if strings.TrimSpace(f.FBA) != "" {
		if fba, err = money.Parse(f.FBA); err != nil {
			return dealErgebnis{}, fmt.Errorf("FBA-Gebühr: %w", err)
		}
	}

	provision, err := strconv.ParseFloat(strings.Replace(strings.TrimSpace(f.Provision), ",", ".", 1), 64)
	if err != nil {
		return dealErgebnis{}, fmt.Errorf("Provision: %q ist keine Zahl", f.Provision)
	}
	sales, _ := strconv.Atoi(strings.TrimSpace(f.Sales))

	ustModus := calc.Netto
	if f.UStModus == "brutto" {
		ustModus = calc.Brutto
	}
	basis := calc.AufBrutto
	if srv.store.Einstellung(store.SchluesselMargenBasis) == "netto" {
		basis = calc.AufNetto
	}

	erg := calc.Rechne(calc.Eingabe{
		EKBrutto:         ek,
		VKBrutto:         vk,
		QuellUStPermille: srv.ustPermille(quell.Code),
		ZielUStPermille:  srv.ustPermille(ziel.Code),
		ProvisionProzent: provision,
		FBA:              fba,
		UStModus:         ustModus,
		MargenBasis:      basis,
	})

	// Im Brutto-Modus bleibt der Parameter 0, so wie im ursprünglich
	// kopierten ArbitrageOne-Link.
	var ekNetto money.Cents
	if ustModus == calc.Netto {
		ekNetto = erg.EKNetto
	}

	daten := post.Daten{
		Titel:         f.Titel,
		ASIN:          f.ASIN,
		Mention:       mentionText(f.ChannelID, srv),
		EKHost:        strings.TrimPrefix(quell.Host, "www."),
		EKUrl:         quell.ProductURL(f.ASIN),
		EK:            ek.Euro(),
		EKNotiz:       f.EKNotiz,
		VK:            vk.Euro(),
		VKUrl:         ziel.ProductURL(f.ASIN),
		Zielmarkt:     string(ziel.Code),
		Sales:         strconv.Itoa(sales),
		Gewinn:        erg.Gewinn.Euro(),
		Marge:         prozent(erg.MargeProzent, 1),
		MargeGerundet: prozent(erg.MargeProzent, 0),
		AOUrl: post.ArbitrageOneURL(post.AOParameter{
			ASIN: f.ASIN, VKBrutto: vk, EKBrutto: ek, EKNettoBerechnet: ekNetto,
			Sales: sales, Zielmarkt: ziel.Code, QuellURL: quell.ProductURL(f.ASIN),
		}),
	}

	text, err := post.Render(srv.store.Einstellung(store.SchluesselVorlage), daten)
	if err != nil {
		return dealErgebnis{}, err
	}

	var channel store.Channel
	if f.ChannelID != 0 {
		channel, _ = srv.store.Channel(f.ChannelID)
	}

	return dealErgebnis{
		Text: text, Ergebnis: erg, Quell: quell, Ziel: ziel, Channel: channel,
		EKBrutto: ek, VKBrutto: vk, FBA: fba, Sales: sales, Provision: provision,
		ChartURL: "/chart?asin=" + f.ASIN + "&markt=" + string(ziel.Code),
	}, nil
}

func (srv *Server) ustPermille(c marketplace.Code) int {
	if n := srv.store.EinstellungZahl(store.SchluesselUStPrefix + string(c)); n > 0 {
		return n
	}
	m, _ := marketplace.ByCode(c)
	return m.VATPermille
}

// prozent formatiert mit deutschem Komma: 15.26 -> "15,3 %" bzw. "15 %".
func prozent(v float64, stellen int) string {
	s := strconv.FormatFloat(v, 'f', stellen, 64)
	if stellen == 0 {
		s = strconv.Itoa(int(math.Round(v)))
	}
	return strings.Replace(s, ".", ",", 1) + " %"
}

func mentionText(channelID int64, srv *Server) string {
	if channelID == 0 {
		return ""
	}
	c, err := srv.store.Channel(channelID)
	if err != nil {
		return ""
	}
	switch c.MentionTyp {
	case "everyone":
		return "@everyone"
	case "here":
		return "@here"
	case "rolle":
		if c.RollenID != "" {
			return "<@&" + c.RollenID + ">"
		}
	}
	return ""
}
```

- [ ] **Step 4: Handler umsetzen**

Weiter in `internal/web/deal.go`:

```go
type dealSeite struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string

	Maerkte  []marketplace.Marketplace
	Channels []store.Channel
	Notizen  []string

	Formular dealFormular
	Vorschau string
	ChartURL string

	VKKandidaten []kandidat
	SalesHinweis string
}

type kandidat struct {
	Schluessel string
	Bezeichnung string
	Wert       string
	Gewaehlt   bool
}

func (srv *Server) seitenGeruest(titel string) dealSeite {
	channels, _ := srv.store.Channels()
	notizen, _ := srv.store.EKNotizen()
	return dealSeite{
		Titel:    titel,
		Maerkte:  marketplace.All(),
		Channels: channels,
		Notizen:  notizen,
	}
}

func (srv *Server) zeigeDeal(w http.ResponseWriter, r *http.Request) {
	d := srv.seitenGeruest("Neuer Deal")
	d.Formular.Zielmarkt = srv.store.Einstellung(store.SchluesselZielmarkt)
	d.Formular.UStModus = srv.store.Einstellung(store.SchluesselUStModus)
	srv.rendere(w, "deal", d)
}

// ladeDeal holt die ASIN bei Keepa und füllt das Formular vor.
func (srv *Server) ladeDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()

	ein, err := marketplace.ParseEingabe(r.PostForm.Get("eingabe"))
	if err != nil {
		srv.fehler(w, http.StatusOK, "Keine ASIN erkannt: "+err.Error())
		return
	}

	quell := r.PostForm.Get("quellmarkt")
	if ein.Quelle != nil {
		quell = string(ein.Quelle.Code)
	}
	if quell == "" {
		srv.fehler(w, http.StatusOK,
			"Bei einer nackten ASIN muss der Einkaufsmarktplatz ausgewählt werden.")
		return
	}

	zielCode := r.PostForm.Get("zielmarkt")
	if zielCode == "" {
		zielCode = srv.store.Einstellung(store.SchluesselZielmarkt)
	}
	ziel, ok := marketplace.ByCode(marketplace.Code(zielCode))
	if !ok {
		srv.fehler(w, http.StatusOK, "Unbekannter Zielmarktplatz "+zielCode)
		return
	}

	produkt, err := srv.holeProdukt(r, ein.ASIN, ziel)
	if err != nil {
		srv.fehler(w, http.StatusOK, err.Error())
		return
	}

	d := srv.seitenGeruest("Neuer Deal")
	d.Formular = dealFormular{
		ASIN:       ein.ASIN,
		Quellmarkt: quell,
		Zielmarkt:  string(ziel.Code),
		Titel:      produkt.Titel,
		EKNotiz:    "",
		UStModus:   srv.store.Einstellung(store.SchluesselUStModus),
	}

	// VK-Kandidaten, Ø 90 Tage Buy Box vorausgewählt.
	median := keepa.MedianZeitgewichtet(produkt.BuyBoxVerlauf, letzteMinute(produkt))
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
		gewaehlt := k.schluessel == "avg90"
		d.VKKandidaten = append(d.VKKandidaten, kandidat{
			Schluessel: k.schluessel, Bezeichnung: k.text,
			Wert: k.p.Cents.String(), Gewaehlt: gewaehlt,
		})
		if gewaehlt {
			d.Formular.VK = k.p.Cents.String()
			d.Formular.VKQuelle = k.schluessel
		}
	}
	// Ist kein Kandidat übrig, bleibt das Feld leer — es wird kein Wert erfunden.
	if d.Formular.VK == "" && len(d.VKKandidaten) > 0 {
		d.Formular.VK = d.VKKandidaten[0].Wert
		d.Formular.VKQuelle = d.VKKandidaten[0].Schluessel
		d.VKKandidaten[0].Gewaehlt = true
	}

	sales, quelle := produkt.Sales()
	d.Formular.Sales = strconv.Itoa(sales)
	switch quelle {
	case keepa.SalesMonthlySold:
		d.Formular.SalesQuelle = "monthlySold"
		d.SalesHinweis = "Keepa · monthlySold (Amazon-Badge)"
	case keepa.SalesRankDrops:
		d.Formular.SalesQuelle = "rankDrops30"
		d.SalesHinweis = "Keepa · Schätzung aus Rangsprüngen, 30 Tage"
	default:
		d.Formular.SalesQuelle = "manuell"
		d.SalesHinweis = "Keepa hat keine Verkaufszahl — bitte eintragen"
	}

	if produkt.ProvisionProzent != nil {
		d.Formular.Provision = strconv.FormatFloat(*produkt.ProvisionProzent, 'f', -1, 64)
		d.Formular.ProvisionQuelle = "keepa"
	} else {
		d.Formular.Provision = srv.store.Einstellung(store.SchluesselProvision)
		d.Formular.ProvisionQuelle = "standardwert"
	}

	if produkt.FBA.OK {
		d.Formular.FBA = produkt.FBA.Cents.String()
		d.Formular.FBAQuelle = "keepa"
	} else {
		d.Formular.FBA = srv.store.Einstellung(store.SchluesselFBA)
		d.Formular.FBAQuelle = "standardwert"
	}

	d.ChartURL = "/chart?asin=" + ein.ASIN + "&markt=" + string(ziel.Code)
	d.TokenText = srv.tokenText()

	srv.rendere(w, "formular", d)
}

// holeProdukt fragt Keepa, nutzt aber zuerst den Zwischenspeicher.
func (srv *Server) holeProdukt(r *http.Request, asin string, ziel marketplace.Marketplace) (keepa.Product, error) {
	minuten := srv.store.EinstellungZahl(store.SchluesselCacheMinuten)
	if roh, da := srv.store.CacheLesen(asin, ziel.KeepaDomain,
		time.Duration(minuten)*time.Minute); da && r.PostForm.Get("neu_laden") == "" {
		if a, err := keepa.ParseAntwort(roh); err == nil {
			return a.Produkt, nil
		}
	}

	if srv.store.Einstellung(store.SchluesselKeepaKey) == "" && srv.keepa.Key == "" {
		return keepa.Product{}, errors.New("Kein Keepa-API-Key hinterlegt — bitte in den Einstellungen eintragen.")
	}

	a, err := srv.keepa.Produkt(r.Context(), asin, ziel.KeepaDomain)
	if err != nil {
		var leer keepa.ErrTokensErschoepft
		switch {
		case errors.As(err, &leer):
			return keepa.Product{}, fmt.Errorf(
				"Keepa-Kontingent erschöpft. Neue Token in %s. Die Felder lassen sich von Hand ausfüllen.",
				leer.RefillIn.Round(time.Second))
		case errors.Is(err, keepa.ErrNichtGefunden):
			return keepa.Product{}, fmt.Errorf("Keepa kennt die ASIN %s auf amazon.%s nicht.", asin, ziel.TLD)
		default:
			return keepa.Product{}, fmt.Errorf("Keepa nicht erreichbar: %v. Die Felder lassen sich von Hand ausfüllen.", err)
		}
	}

	srv.merkeToken(a.TokensLeft, a.TokensConsumed)
	return a.Produkt, nil
}

func (srv *Server) vorschauDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest("Neuer Deal")
	d.Formular = formularLesen(r)

	erg, err := srv.baueDeal(d.Formular)
	if err != nil {
		d.Fehler = err.Error()
		srv.rendere(w, "vorschau", d)
		return
	}
	d.Vorschau = erg.Text
	d.ChartURL = erg.ChartURL
	srv.rendere(w, "vorschau", d)
}

// sendeDeal postet und speichert — in dieser Reihenfolge.
//
// Ein Deal landet nur dann in der Historie, wenn Discord das Senden bestätigt
// hat. Lieber ein verlorener Entwurf als ein Eintrag, der fälschlich
// behauptet, gepostet worden zu sein.
func (srv *Server) sendeDeal(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.seitenGeruest("Neuer Deal")
	d.Formular = formularLesen(r)

	if d.Formular.ChannelID == 0 {
		d.Fehler = "Bitte einen Channel auswählen."
		srv.rendere(w, "vorschau", d)
		return
	}

	erg, err := srv.baueDeal(d.Formular)
	if err != nil {
		d.Fehler = err.Error()
		srv.rendere(w, "vorschau", d)
		return
	}
	if erg.Channel.ID == 0 {
		d.Fehler = "Der gewählte Channel existiert nicht mehr."
		srv.rendere(w, "vorschau", d)
		return
	}

	// Der Chart wird jetzt geholt und genau dieses Bild wird gesendet und
	// archiviert — so zeigt die Historie später denselben Stand.
	png, chartErr := srv.keepa.Chart(r.Context(), d.Formular.ASIN, erg.Ziel.ChartDomain, srv.chartOptionen())
	if chartErr != nil && r.PostForm.Get("ohne_chart") == "" {
		d.Vorschau = erg.Text
		d.ChartURL = erg.ChartURL
		d.Fehler = "Chart nicht ladbar: " + chartErr.Error() +
			" — mit „Ohne Chart senden\" trotzdem posten."
		srv.rendere(w, "vorschau", d)
		return
	}

	chartName := ""
	if len(png) > 0 {
		chartName = d.Formular.ASIN + ".png"
	}

	gesendet, err := discord.SendeMitWiederholung(r.Context(), srv.http, erg.Channel.WebhookURL, discord.Nachricht{
		Inhalt:    erg.Text,
		Mention:   discord.MentionTyp(erg.Channel.MentionTyp),
		RollenID:  erg.Channel.RollenID,
		ChartName: chartName,
		ChartPNG:  png,
	})
	if err != nil {
		if errors.Is(err, discord.ErrWebhookTot) {
			_ = srv.store.ChannelDefekt(erg.Channel.ID, true)
		}
		d.Vorschau = erg.Text
		d.ChartURL = erg.ChartURL
		d.Fehler = "Nicht gesendet: " + err.Error()
		srv.rendere(w, "vorschau", d)
		return
	}
	_ = srv.store.ChannelDefekt(erg.Channel.ID, false)

	chartDatei := ""
	if len(png) > 0 {
		chartDatei, _ = srv.store.ChartSpeichern(d.Formular.ASIN, png)
	}

	if _, err := srv.store.DealAnlegen(store.Deal{
		ASIN: d.Formular.ASIN, Titel: d.Formular.Titel,
		Quellmarkt: string(erg.Quell.Code), Zielmarkt: string(erg.Ziel.Code),
		EKCent: erg.EKBrutto, EKNotiz: d.Formular.EKNotiz,
		VKCent: erg.VKBrutto, VKQuelle: d.Formular.VKQuelle,
		Sales: erg.Sales, SalesQuelle: d.Formular.SalesQuelle,
		ProvisionProzent: erg.Provision, ProvisionQuelle: d.Formular.ProvisionQuelle,
		FBACent: erg.FBA, FBAQuelle: d.Formular.FBAQuelle,
		UStModus: d.Formular.UStModus,
		GewinnCent: erg.Ergebnis.Gewinn, MargeProzent: erg.Ergebnis.MargeProzent,
		ChannelID: erg.Channel.ID, ChannelName: erg.Channel.Name,
		NachrichtText: erg.Text, ChartDatei: chartDatei,
		DiscordNachrichtID: gesendet.NachrichtID,
	}); err != nil {
		d.Fehler = "Gepostet, aber nicht in der Historie gespeichert: " + err.Error()
		srv.rendere(w, "vorschau", d)
		return
	}

	d = srv.seitenGeruest("Neuer Deal")
	d.Meldung = "Gepostet in #" + erg.Channel.Name + "."
	d.Formular.Zielmarkt = srv.store.Einstellung(store.SchluesselZielmarkt)
	d.Formular.UStModus = srv.store.Einstellung(store.SchluesselUStModus)
	srv.rendere(w, "deal", d)
}

// zeigeChart reicht das Keepa-Bild für die Vorschau durch, damit die Seite
// keine Fremdadresse laden muss.
func (srv *Server) zeigeChart(w http.ResponseWriter, r *http.Request) {
	asin := strings.ToUpper(r.URL.Query().Get("asin"))
	m, ok := marketplace.ByCode(marketplace.Code(r.URL.Query().Get("markt")))
	if !ok || asin == "" {
		http.Error(w, "asin und markt sind nötig", http.StatusBadRequest)
		return
	}

	png, err := srv.keepa.Chart(r.Context(), asin, m.ChartDomain, srv.chartOptionen())
	if err != nil {
		http.Error(w, "Chart nicht ladbar: "+err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Write(png)
}

func (srv *Server) chartOptionen() keepa.ChartOptionen {
	o := keepa.StandardChart
	if n := srv.store.EinstellungZahl(store.SchluesselChartTage); n > 0 {
		o.Tage = n
	}
	if n := srv.store.EinstellungZahl(store.SchluesselChartBreite); n > 0 {
		o.Breite = n
	}
	if n := srv.store.EinstellungZahl(store.SchluesselChartHoehe); n > 0 {
		o.Hoehe = n
	}
	o.BuyBox = srv.store.Einstellung(store.SchluesselChartBuyBox) == "1"
	o.Amazon = srv.store.Einstellung(store.SchluesselChartAmazon) == "1"
	o.Neu = srv.store.Einstellung(store.SchluesselChartNeu) == "1"
	return o
}

// letzteMinute liefert den Endzeitpunkt für die Mediansspanne.
func letzteMinute(p keepa.Product) int {
	if len(p.BuyBoxVerlauf) == 0 {
		return 0
	}
	return p.BuyBoxVerlauf[len(p.BuyBoxVerlauf)-1].Minute + 1
}
```

- [ ] **Step 5: Token-Anzeige ergänzen**

In `server.go`:

```go
// Der Token-Stand wird bei jeder Keepa-Antwort mitgeführt und in der Kopfzeile
// angezeigt, damit ein leeres Kontingent nicht überrascht.
func (srv *Server) merkeToken(links, verbraucht int) {
	srv.tokenMu.Lock()
	defer srv.tokenMu.Unlock()
	srv.tokenLinks = links
	srv.tokenVerbraucht = verbraucht
}

func (srv *Server) tokenText() string {
	srv.tokenMu.Lock()
	defer srv.tokenMu.Unlock()
	if srv.tokenLinks == 0 && srv.tokenVerbraucht == 0 {
		return ""
	}
	return fmt.Sprintf("Keepa: %d Token übrig (zuletzt %d verbraucht)", srv.tokenLinks, srv.tokenVerbraucht)
}
```

Dazu die Felder `tokenMu sync.Mutex`, `tokenLinks int`, `tokenVerbraucht int` in `Server` aufnehmen.

- [ ] **Step 6: Vorlage anlegen**

`internal/web/templates/deal.html`:

```html
{{define "deal"}}
{{template "kopf" .}}
<h1>Neuer Deal</h1>
{{if .Meldung}}<p class="meldung">{{.Meldung}}</p>{{end}}

<form hx-post="/deal/laden" hx-target="#formular">
  <label>Amazon-URL oder ASIN
    <input name="eingabe" autofocus placeholder="https://www.amazon.es/dp/B01636IZ0G"></label>
  <label>Einkaufsmarkt <small>nur nötig bei nackter ASIN</small>
    <select name="quellmarkt">
      <option value="">— aus URL erkennen —</option>
      {{range .Maerkte}}<option value="{{.Code}}">{{.Code}}</option>{{end}}
    </select></label>
  <label>Zielmarkt
    <select name="zielmarkt">
      {{range .Maerkte}}<option value="{{.Code}}" {{if eq (printf "%s" .Code) $.Formular.Zielmarkt}}selected{{end}}>{{.Code}}</option>{{end}}
    </select></label>
  <button type="submit">Laden</button>
</form>

<div id="formular"></div>
{{template "fuss"}}
{{end}}

{{define "formular"}}
<div class="spalten">
<form hx-post="/deal/vorschau" hx-target="#vorschau" hx-trigger="change, keyup changed delay:400ms">
  <input type="hidden" name="asin" value="{{.Formular.ASIN}}">
  <input type="hidden" name="quellmarkt" value="{{.Formular.Quellmarkt}}">
  <input type="hidden" name="zielmarkt" value="{{.Formular.Zielmarkt}}">
  <input type="hidden" name="vk_quelle" value="{{.Formular.VKQuelle}}">
  <input type="hidden" name="sales_quelle" value="{{.Formular.SalesQuelle}}">
  <input type="hidden" name="provision_quelle" value="{{.Formular.ProvisionQuelle}}">
  <input type="hidden" name="fba_quelle" value="{{.Formular.FBAQuelle}}">

  <p>{{.Formular.ASIN}} · Einkauf {{.Formular.Quellmarkt}} → Verkauf {{.Formular.Zielmarkt}}</p>

  <label>Artikelname <small>aus Keepa, kürzen</small>
    <input name="titel" value="{{.Formular.Titel}}"></label>

  <fieldset><legend>Verkaufspreis</legend>
    {{/* Die Auswahlknöpfe tragen bewusst kein name-Attribut: sonst würde das
         Formular zwei Werte namens "vk" senden. Sie füllen nur das Feld. */}}
    {{range .VKKandidaten}}
      <label><input type="radio" name="vk_wahl" value="{{.Schluessel}}"
                    {{if .Gewaehlt}}checked{{end}}
                    onchange="this.form.vk.value='{{.Wert}}'; this.form.vk_quelle.value='{{.Schluessel}}'">
        {{.Bezeichnung}} — {{.Wert}} €</label>
    {{else}}
      <p class="fehler">Keepa hat keinen Verkaufspreis — bitte eintragen.</p>
    {{end}}
    <label>Verkaufspreis <input name="vk" value="{{.Formular.VK}}" placeholder="207,49"></label>
  </fieldset>

  <fieldset><legend>Einkaufspreis</legend>
    <label>EK brutto <input name="ek" value="{{.Formular.EK}}" placeholder="130,56"></label>
    <label>Notiz
      <input name="ek_notiz" list="notizen" value="{{.Formular.EKNotiz}}"
             placeholder="Brutto inkl. Versand (3er cart)">
      <datalist id="notizen">{{range .Notizen}}<option value="{{.}}">{{end}}</datalist></label>
    <label><input type="checkbox" name="ust_modus" value="brutto"
      {{if eq .Formular.UStModus "brutto"}}checked{{end}}> Vorsteuer nicht abziehbar</label>
  </fieldset>

  <fieldset><legend>Zahlen</legend>
    <label>Verkäufe <input name="sales" value="{{.Formular.Sales}}">
      <span class="herkunft">{{.SalesHinweis}}</span></label>
    <label>Provision in % <input name="provision" value="{{.Formular.Provision}}">
      <span class="herkunft">{{.Formular.ProvisionQuelle}}</span></label>
    <label>FBA-Gebühr <input name="fba" value="{{.Formular.FBA}}" placeholder="leer, wenn unbekannt">
      <span class="herkunft">{{.Formular.FBAQuelle}}</span></label>
  </fieldset>

  <label>Channel
    <select name="channel_id">
      <option value="0">— wählen —</option>
      {{range .Channels}}<option value="{{.ID}}">{{.Name}}{{if .Defekt}} (defekt){{end}}</option>{{end}}
    </select></label>
</form>

<div id="vorschau">
  {{if .ChartURL}}<img src="{{.ChartURL}}" alt="Keepa-Preisverlauf">{{end}}
</div>
</div>
{{end}}

{{define "vorschau"}}
{{if .Fehler}}<p class="fehler">{{.Fehler}}</p>{{end}}
{{if .Meldung}}<p class="meldung">{{.Meldung}}</p>{{end}}
<div class="vorschau">{{.Vorschau}}</div>
{{if .ChartURL}}<img src="{{.ChartURL}}" alt="Keepa-Preisverlauf">{{end}}
<form hx-post="/deal/senden" hx-target="#vorschau" hx-include="closest .spalten form">
  <button type="submit">Posten</button>
</form>
{{end}}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `go test ./internal/web/ -v`
Expected: PASS für alle Testfunktionen, insbesondere `TestVorschauRechnetReferenzfall` (31,67 / 15,3), `TestSendenSpeichertNurBeiErfolg` (0 Deals) und `TestVorschauUndSendenErzeugenDenselbenText`

- [ ] **Step 8: Commit**

```bash
git add internal/web/
git commit -m "feat(web): Neuer-Deal-Ablauf mit Vorschau und Versand

Vorschau und Senden gehen durch dieselbe Funktion baueDeal, damit der
gepostete Text garantiert der ist, den die Vorschau gezeigt hat.

Gespeichert wird erst nach Discords Bestaetigung — lieber ein
verlorener Entwurf als ein Historieneintrag, der faelschlich
behauptet, gepostet worden zu sein.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Historie

Durchsuchbare Liste der geposteten Deals mit aufklappbarem Originaltext und archiviertem Chart.

**Files:**
- Create: `internal/web/history.go`
- Create: `internal/web/templates/historie.html`
- Test: `internal/web/history_test.go`

**Interfaces:**
- Consumes: `store.Deals`, `store.DealFilter`, `store.ChartLesen` aus Task 10
- Produces: Handler `zeigeHistorie`, `zeigeHistorieChart`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`internal/web/history_test.go`:

```go
package web

import (
	"net/http"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func historieDeal(s *store.Store, cid int64, asin, titel string) {
	s.DealAnlegen(store.Deal{
		ASIN: asin, Titel: titel, Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 13056, VKCent: 20749, GewinnCent: 3167, MargeProzent: 15.26,
		ChannelID: cid, ChannelName: "deals-vip",
		NachrichtText: "🛒 " + titel + " " + asin,
	})
}

func TestHistorieZeigtDeals(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals-vip", WebhookURL: "https://x/1"})
	historieDeal(s, cid, "B01636IZ0G", "Makita HR2630")

	w := hole(t, srv, http.MethodGet, "/historie", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d", w.Code)
	}
	koerper := w.Body.String()
	for _, muss := range []string{"B01636IZ0G", "Makita HR2630", "deals-vip", "31,67"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Historie enthält %q nicht", muss)
		}
	}
}

func TestHistorieSuche(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	historieDeal(s, cid, "B01636IZ0G", "Makita HR2630")
	historieDeal(s, cid, "B0BOSCH1234", "Bosch GBH")

	w := hole(t, srv, http.MethodGet, "/historie?suche=Bosch", "")
	koerper := w.Body.String()
	if !strings.Contains(koerper, "Bosch GBH") {
		t.Error("Treffer fehlt")
	}
	if strings.Contains(koerper, "Makita HR2630") {
		t.Error("Nicht-Treffer wird angezeigt")
	}
}

func TestHistorieLeer(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodGet, "/historie", "")
	if w.Code != http.StatusOK {
		t.Errorf("Status = %d, will 200 auch ohne Deals", w.Code)
	}
}

func TestHistorieChartAusliefern(t *testing.T) {
	srv, s := testServer(t)
	png := []byte("\x89PNG\r\n\x1a\nARCHIV")
	datei, err := s.ChartSpeichern("B01636IZ0G", png)
	if err != nil {
		t.Fatalf("ChartSpeichern: %v", err)
	}

	w := hole(t, srv, http.MethodGet, "/historie/chart/"+datei, "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d", w.Code)
	}
	if w.Header().Get("Content-Type") != "image/png" {
		t.Errorf("Content-Type = %q", w.Header().Get("Content-Type"))
	}
	if w.Body.String() != string(png) {
		t.Error("Bildinhalt weicht ab")
	}
}

func TestHistorieChartLaesstNichtAusbrechen(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodGet, "/historie/chart/..%2F..%2Fdeals.db", "")
	if w.Code == http.StatusOK {
		t.Error("ein Pfad aus dem Chart-Ordner heraus wurde ausgeliefert")
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./internal/web/ -run TestHistorie`
Expected: FAIL — Handler fehlt

- [ ] **Step 3: Umsetzen**

`internal/web/history.go`:

```go
package web

import (
	"net/http"
	"strconv"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type historieZeile struct {
	store.Deal
	EK     string
	VK     string
	Gewinn string
	Marge  string
	Datum  string
}

type historieDaten struct {
	Titel     string
	TokenText string
	Fehler    string
	Suche     string
	ChannelID int64
	Channels  []store.Channel
	Zeilen    []historieZeile
	Anzahl    int
	Seite     int
	MehrDa    bool

	// html/template kann nicht rechnen, darum werden die Nachbarseiten hier
	// vorbereitet.
	VorherigeSeite int
	NaechsteSeite  int
}

const historieProSeite = 50

func (srv *Server) zeigeHistorie(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	seite, _ := strconv.Atoi(q.Get("seite"))
	if seite < 1 {
		seite = 1
	}
	channelID, _ := strconv.ParseInt(q.Get("channel"), 10, 64)

	filter := store.DealFilter{
		Suche:     q.Get("suche"),
		ChannelID: channelID,
		Limit:     historieProSeite,
		Offset:    (seite - 1) * historieProSeite,
	}

	channels, _ := srv.store.Channels()
	d := historieDaten{
		Titel:     "Historie",
		Suche:     filter.Suche,
		ChannelID: channelID,
		Channels:  channels,
		Seite:          seite,
		VorherigeSeite: seite - 1,
		NaechsteSeite:  seite + 1,
		TokenText:      srv.tokenText(),
	}

	deals, err := srv.store.Deals(filter)
	if err != nil {
		d.Fehler = "Historie nicht lesbar: " + err.Error()
		srv.rendere(w, "historie", d)
		return
	}
	d.Anzahl, _ = srv.store.DealsAnzahl(filter)
	d.MehrDa = filter.Offset+len(deals) < d.Anzahl

	for _, deal := range deals {
		d.Zeilen = append(d.Zeilen, historieZeile{
			Deal:   deal,
			EK:     deal.EKCent.Euro(),
			VK:     deal.VKCent.Euro(),
			Gewinn: deal.GewinnCent.Euro(),
			Marge:  prozent(deal.MargeProzent, 1),
			Datum:  deal.GepostetAm.Local().Format("02.01.2006 15:04"),
		})
	}

	srv.rendere(w, "historie", d)
}

// zeigeHistorieChart liefert ein archiviertes Bild aus.
//
// Der Dateiname stammt aus der Datenbank, wird von ChartLesen aber trotzdem
// geprüft — hier kommt er über die URL wieder herein und darf nicht aus dem
// Chart-Ordner herausführen.
func (srv *Server) zeigeHistorieChart(w http.ResponseWriter, r *http.Request) {
	png, err := srv.store.ChartLesen(r.PathValue("datei"))
	if err != nil {
		http.Error(w, "Chart nicht gefunden", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(png)
}
```

`internal/web/templates/historie.html`:

```html
{{define "historie"}}
{{template "kopf" .}}
<h1>Historie</h1>
{{if .Fehler}}<p class="fehler">{{.Fehler}}</p>{{end}}

<form method="get" action="/historie">
  <label>Suche <small>ASIN oder Titel</small>
    <input name="suche" value="{{.Suche}}"></label>
  <label>Channel
    <select name="channel">
      <option value="0">alle</option>
      {{range .Channels}}<option value="{{.ID}}" {{if eq .ID $.ChannelID}}selected{{end}}>{{.Name}}</option>{{end}}
    </select></label>
  <button type="submit">Filtern</button>
</form>

<p>{{.Anzahl}} Deals</p>

<table>
  <tr><th>Datum</th><th>ASIN</th><th>Artikel</th><th>Channel</th>
      <th>EK</th><th>VK</th><th>Gewinn</th><th>Marge</th></tr>
  {{range .Zeilen}}
  <tr><td>{{.Datum}}</td><td>{{.ASIN}}</td><td>{{.Titel}}</td><td>{{.ChannelName}}</td>
      <td>{{.EK}}</td><td>{{.VK}}</td><td>{{.Gewinn}}</td><td>{{.Marge}}</td></tr>
  <tr><td colspan="8">
    <details><summary>Gesendeter Text</summary>
      <div class="vorschau">{{.NachrichtText}}</div>
      {{if .ChartDatei}}<img src="/historie/chart/{{.ChartDatei}}" alt="Preisverlauf beim Posten">{{end}}
      <p class="herkunft">
        VK aus {{.VKQuelle}} · Sales aus {{.SalesQuelle}} ·
        Provision aus {{.ProvisionQuelle}} · FBA aus {{.FBAQuelle}} ·
        Vorsteuer {{.UStModus}}
      </p>
    </details>
  </td></tr>
  {{else}}
  <tr><td colspan="8">Noch nichts gepostet.</td></tr>
  {{end}}
</table>

{{if gt .Seite 1}}<a href="/historie?suche={{.Suche}}&channel={{.ChannelID}}&seite={{.VorherigeSeite}}">zurück</a>{{end}}
{{if .MehrDa}}<a href="/historie?suche={{.Suche}}&channel={{.ChannelID}}&seite={{.NaechsteSeite}}">weiter</a>{{end}}
{{template "fuss"}}
{{end}}
```


- [ ] **Step 4: Tests laufen lassen**

Run: `go test ./internal/web/ -run TestHistorie -v`
Expected: PASS für alle fünf Testfunktionen

- [ ] **Step 5: Commit**

```bash
git add internal/web/
git commit -m "feat(web): durchsuchbare Historie mit archiviertem Chart

Jede Zeile klappt den exakt gesendeten Text auf, samt der damals
verwendeten Zahlen und ihrer Herkunft — so bleibt nachvollziehbar,
welcher Wert gemessen und welcher geschaetzt war.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Start, Konfiguration und Auslieferung

Das Programm selbst, plus Docker und Windows-Build.

**Files:**
- Create: `cmd/lugru-deals/main.go`
- Create: `Dockerfile`
- Create: `Makefile`
- Create: `README.md`
- Create: `.dockerignore`
- Test: `cmd/lugru-deals/main_test.go`

**Interfaces:**
- Consumes: alle Pakete
- Produces: das Binary `lugru-deals`

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

`cmd/lugru-deals/main_test.go`:

```go
package main

import (
	"os"
	"testing"
)

func TestKonfigurationVorgaben(t *testing.T) {
	k := ladeKonfiguration(nil)
	if k.Adresse != "127.0.0.1:8080" {
		t.Errorf("Adresse = %q, will 127.0.0.1:8080 — die Anwendung darf nicht ungefragt im Netz stehen", k.Adresse)
	}
	if k.DBPfad != "deals.db" {
		t.Errorf("DBPfad = %q, will deals.db", k.DBPfad)
	}
	if k.ChartOrdner != "charts" {
		t.Errorf("ChartOrdner = %q, will charts", k.ChartOrdner)
	}
	if !k.BrowserOeffnen {
		t.Error("BrowserOeffnen = false, will true")
	}
}

func TestUmgebungUeberschreibt(t *testing.T) {
	os.Setenv("LUGRU_ADRESSE", "0.0.0.0:9000")
	os.Setenv("LUGRU_DB", "/daten/deals.db")
	os.Setenv("LUGRU_BROWSER", "0")
	t.Cleanup(func() {
		os.Unsetenv("LUGRU_ADRESSE")
		os.Unsetenv("LUGRU_DB")
		os.Unsetenv("LUGRU_BROWSER")
	})

	k := ladeKonfiguration(nil)
	if k.Adresse != "0.0.0.0:9000" {
		t.Errorf("Adresse = %q", k.Adresse)
	}
	if k.DBPfad != "/daten/deals.db" {
		t.Errorf("DBPfad = %q", k.DBPfad)
	}
	if k.BrowserOeffnen {
		t.Error("BrowserOeffnen = true trotz LUGRU_BROWSER=0")
	}
}

func TestFlaggenSchlagenUmgebung(t *testing.T) {
	os.Setenv("LUGRU_ADRESSE", "0.0.0.0:9000")
	t.Cleanup(func() { os.Unsetenv("LUGRU_ADRESSE") })

	k := ladeKonfiguration([]string{"-adresse", "127.0.0.1:7777"})
	if k.Adresse != "127.0.0.1:7777" {
		t.Errorf("Adresse = %q, will die Flagge 127.0.0.1:7777", k.Adresse)
	}
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `go test ./cmd/lugru-deals/`
Expected: FAIL — `undefined: ladeKonfiguration`

- [ ] **Step 3: Umsetzen**

`cmd/lugru-deals/main.go`:

```go
// Kommando lugru-deals startet die lokale Oberfläche.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
	"github.com/trinkfreunde/lugru-deal-discord/internal/web"
)

type konfiguration struct {
	Adresse        string
	DBPfad         string
	ChartOrdner    string
	BrowserOeffnen bool
	KeepaKey       string
}

// ladeKonfiguration liest Vorgaben, Umgebungsvariablen und Flaggen — in
// dieser Reihenfolge, spätere gewinnen.
//
// Die Vorgabeadresse ist 127.0.0.1: die Anwendung hat keine Anmeldung und darf
// darum nicht ungefragt im Netz erreichbar sein. Im Docker-Betrieb setzt das
// Image LUGRU_ADRESSE auf 0.0.0.0.
func ladeKonfiguration(argumente []string) konfiguration {
	k := konfiguration{
		Adresse:        "127.0.0.1:8080",
		DBPfad:         "deals.db",
		ChartOrdner:    "charts",
		BrowserOeffnen: true,
	}

	if v := os.Getenv("LUGRU_ADRESSE"); v != "" {
		k.Adresse = v
	}
	if v := os.Getenv("LUGRU_DB"); v != "" {
		k.DBPfad = v
	}
	if v := os.Getenv("LUGRU_CHARTS"); v != "" {
		k.ChartOrdner = v
	}
	if v := os.Getenv("LUGRU_BROWSER"); v == "0" || strings.EqualFold(v, "false") {
		k.BrowserOeffnen = false
	}
	k.KeepaKey = os.Getenv("KEEPA_API_KEY")

	if argumente != nil {
		fs := flag.NewFlagSet("lugru-deals", flag.ContinueOnError)
		fs.StringVar(&k.Adresse, "adresse", k.Adresse, "Adresse, auf der gelauscht wird")
		fs.StringVar(&k.DBPfad, "db", k.DBPfad, "Pfad zur SQLite-Datei")
		fs.StringVar(&k.ChartOrdner, "charts", k.ChartOrdner, "Ordner für Chart-Bilder")
		browser := fs.Bool("browser", k.BrowserOeffnen, "Browser beim Start öffnen")
		if err := fs.Parse(argumente); err == nil {
			k.BrowserOeffnen = *browser
		}
	}
	return k
}

func main() {
	k := ladeKonfiguration(os.Args[1:])

	s, err := store.Open(k.DBPfad, k.ChartOrdner)
	if err != nil {
		log.Fatalf("Datenbank: %v", err)
	}
	defer s.Close()

	// Der Key aus der Umgebung sticht die Einstellung — so lässt sich das
	// Docker-Image ohne vorbefüllte Datenbank betreiben.
	key := k.KeepaKey
	if key == "" {
		key = s.Einstellung(store.SchluesselKeepaKey)
	}

	hc := &http.Client{Timeout: 30 * time.Second}
	srv := web.Neu(s, keepa.NeuerClient(key), hc)

	server := &http.Server{
		Addr:              k.Adresse,
		Handler:           srv.Routen(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("Lugru Deals läuft auf http://%s", k.Adresse)
		if k.BrowserOeffnen {
			oeffneBrowser("http://" + k.Adresse)
		}
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Beende…")

	herunter, abbruch := context.WithTimeout(context.Background(), 5*time.Second)
	defer abbruch()
	_ = server.Shutdown(herunter)
}

// oeffneBrowser startet den Standardbrowser. Schlägt das fehl, ist das kein
// Grund abzubrechen — die Adresse steht im Protokoll.
func oeffneBrowser(url string) {
	var befehl string
	var argumente []string

	switch runtime.GOOS {
	case "windows":
		befehl, argumente = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		befehl, argumente = "open", []string{url}
	default:
		befehl, argumente = "xdg-open", []string{url}
	}

	if err := exec.Command(befehl, argumente...).Start(); err != nil {
		log.Printf("Browser nicht geöffnet (%v) — bitte %s selbst aufrufen", err, url)
	}
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `go test ./cmd/lugru-deals/ -v`
Expected: PASS für alle drei Testfunktionen

- [ ] **Step 5: Docker und Makefile anlegen**

`Dockerfile`:

```dockerfile
FROM golang:1.23-alpine AS bau
WORKDIR /quelle
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# CGO_ENABLED=0 ist Pflicht: der SQLite-Treiber ist reines Go, und nur so
# entsteht ein Binary ohne Fremdbibliotheken.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /lugru-deals ./cmd/lugru-deals

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 lugru
COPY --from=bau /lugru-deals /usr/local/bin/lugru-deals
USER lugru
WORKDIR /daten
ENV LUGRU_ADRESSE=0.0.0.0:8080 \
    LUGRU_DB=/daten/deals.db \
    LUGRU_CHARTS=/daten/charts \
    LUGRU_BROWSER=0
EXPOSE 8080
VOLUME ["/daten"]
ENTRYPOINT ["lugru-deals"]
```

`.dockerignore`:

```
.git
docs
*.db
*.db-shm
*.db-wal
charts/
dist/
lugru-deals
lugru-deals.exe
```

`Makefile`:

```make
.PHONY: test bau windows linux docker alles

test:
	CGO_ENABLED=0 go test ./...

bau:
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o lugru-deals ./cmd/lugru-deals

windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
		go build -trimpath -ldflags="-s -w" -o dist/lugru-deals.exe ./cmd/lugru-deals

linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
		go build -trimpath -ldflags="-s -w" -o dist/lugru-deals ./cmd/lugru-deals

docker:
	docker build -t lugru-deals:neu .

alles: test windows linux
```

- [ ] **Step 6: Windows-Build prüfen**

```bash
make windows && ls -lh dist/lugru-deals.exe && file dist/lugru-deals.exe
```

Expected: eine `.exe` von etwa 15–25 MB, `PE32+ executable ... for MS Windows`

Schlägt das mit einer cgo-Meldung fehl, ist irgendwo eine Abhängigkeit hereingekommen, die C braucht — dann prüfen, ob wirklich `modernc.org/sqlite` benutzt wird.

- [ ] **Step 7: README schreiben**

`README.md`:

```markdown
# Lugru Deal Discord

Postet Amazon-Arbitrage-Deals nach Discord. Holt Titel, Preisverlauf,
Verkaufszahlen und Gebühren aus Keepa, rechnet Gewinn und Marge und hängt den
Keepa-Preischart als Bild an den Post.

## Windows

`lugru-deals.exe` doppelklicken. Der Browser öffnet sich auf
<http://localhost:8080>. Daneben entstehen `deals.db` und der Ordner `charts/`.

## Docker

    docker build -t lugru-deals .
    docker run -p 8080:8080 -v "$PWD/daten:/daten" \
      -e KEEPA_API_KEY=dein_key lugru-deals

## Erste Schritte

1. Unter **Einstellungen** den Keepa-API-Key eintragen.
2. Unter **Channels** einen Channel mit Discord-Webhook anlegen und testen.
3. Unter **Neuer Deal** eine Amazon-URL einfügen.

## Einstellungen über die Umgebung

| Variable | Vorgabe | Zweck |
|---|---|---|
| `LUGRU_ADRESSE` | `127.0.0.1:8080` | Lauschadresse |
| `LUGRU_DB` | `deals.db` | Pfad zur Datenbank |
| `LUGRU_CHARTS` | `charts` | Ordner für Chart-Bilder |
| `LUGRU_BROWSER` | `1` | Browser beim Start öffnen |
| `KEEPA_API_KEY` | — | sticht die Einstellung in der Oberfläche |

## Sicherheitshinweis

Die Anwendung hat keine Anmeldung. Sie lauscht darum auf `127.0.0.1` und ist
nur vom eigenen Rechner erreichbar. Wer `LUGRU_ADRESSE` auf `0.0.0.0` setzt,
macht sie im Netz erreichbar — dann gehört ein Reverse Proxy mit Passwortschutz
davor, sonst kann jeder im Netz in die Discord-Channels posten.

## Entwicklung

    make test      # alle Tests
    make bau       # Binary für das eigene System
    make windows   # dist/lugru-deals.exe
```

- [ ] **Step 8: Alles zusammen prüfen**

```bash
CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test ./... -count=1
make windows linux
```

Expected: `go vet` ohne Ausgabe, alle Tests PASS, beide Binaries in `dist/`

- [ ] **Step 9: Commit**

```bash
git add cmd/ Dockerfile Makefile README.md .dockerignore
git commit -m "feat: Start, Docker-Image und Windows-Build

Lauscht per Vorgabe auf 127.0.0.1 — die Anwendung hat keine
Anmeldung und darf nicht ungefragt im Netz stehen. Das Docker-Image
setzt LUGRU_ADRESSE bewusst auf 0.0.0.0, weil dort ein Port-Mapping
davor liegt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Reihenfolge und Abhängigkeiten

```
1 money ──┬── 3 calc ──┐
          ├── 4 keepa ─┼── 7 post ──┐
2 marketplace ─────────┘            ├── 13 deal
          5 median (nach 4)         │
          6 client (nach 4)         │
                        8 discord ──┤
9 store ── 10 store II ─────────────┤
                    11 web ── 12 channels ── 13 deal ── 14 historie ── 15 start
```

Tasks 1 bis 8 sind reine Logik und lassen sich in beliebiger Reihenfolge
bearbeiten, solange 1 und 2 zuerst kommen. Ab Task 11 ist die Reihenfolge
zwingend.
