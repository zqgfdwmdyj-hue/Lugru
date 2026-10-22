package web

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Der Listen-Import liest eine eingefügte Tabelle, wie ihr sie führt:
//
//	Artikel	Preiswecker	Bester Ankauf	Hinweis
//	PlayStation 5 Pro 0711719024040	1116	1175 € (lost, Zero4K)	1180 € ab 6 Stk (Zero4K)
//
// Spalten sind durch Tabulatoren (aus Excel, Numbers oder WhatsApp kopiert)
// oder mindestens zwei Leerzeichen getrennt. Zeilen mit nur einem Feld sind
// Überschriften wie „Starlink" und werden zur Kategorie der folgenden
// Zeilen; die Kopfzeile „Artikel …" wird übersprungen.

// importZeile ist eine gelesene Zeile.
type importZeile struct {
	Kategorie string
	Name      string
	EAN       string
	Wecker    money.Cents
	Ankauf    money.Cents
	// Ankaeufer sind die gelesenen Ankäufer samt Staffel.
	Ankaeufer []store.Ankaeufer
	// Notiz ist die ganze Zeile zu Ankauf und Hinweis, nur für euch.
	Notiz      string
	Stichworte string
}

var (
	spaltenTrenner = regexp.MustCompile(`\t+| {2,}`)
	eanMuster      = regexp.MustCompile(`\b\d{12,14}\b`)
	// „1175 € (lost, Zero4K)", „407,91 € (Emre)", „645 €"
	preisNamen = regexp.MustCompile(`(\d[\d.]*(?:,\d{1,2})?)\s*€\s*(?:\(([^)]*)\))?`)
	// „1180 € ab 6 Stk (Zero4K)"
	staffelMuster = regexp.MustCompile(`(\d[\d.]*(?:,\d{1,2})?)\s*€\s*ab\s*(\d+)\s*Stk\.?\s*(?:\(([^)]*)\))?`)
	// „nur ab 4 Stk", „erst ab 2 Stk"
	nurAbMuster = regexp.MustCompile(`(?:nur|erst)\s+ab\s+(\d+)\s*Stk`)
	// „einzeln 600 € (Zero4K)"
	einzelnMuster = regexp.MustCompile(`einzeln\s+(\d[\d.]*(?:,\d{1,2})?)\s*€\s*(?:\(([^)]*)\))?`)
)

func betrag(s string) (money.Cents, bool) {
	c, err := money.Parse(s)
	return c, err == nil && c > 0
}

// liesImport liest die eingefügte Liste.
func liesImport(text string) []importZeile {
	var out []importZeile
	kategorie := ""
	for _, roh := range strings.Split(strings.ReplaceAll(text, "\r", ""), "\n") {
		zeile := strings.TrimSpace(roh)
		if zeile == "" {
			continue
		}
		felder := spaltenTrenner.Split(zeile, -1)
		for i := range felder {
			felder[i] = strings.TrimSpace(felder[i])
		}
		if strings.EqualFold(felder[0], "Artikel") {
			continue
		}
		if len(felder) < 2 {
			kategorie = felder[0]
			continue
		}
		z := importZeile{Kategorie: kategorie, Name: felder[0]}
		if ean := eanMuster.FindString(z.Name); ean != "" {
			z.EAN = ean
			z.Name = strings.TrimSpace(strings.Replace(z.Name, ean, "", 1))
		}
		z.Wecker, _ = betrag(felder[1])
		ankauf, hinweis := "", ""
		if len(felder) > 2 {
			ankauf = felder[2]
		}
		if len(felder) > 3 {
			hinweis = strings.Join(felder[3:], " ")
		}
		z.Notiz = strings.TrimSpace(strings.Trim(ankauf+" · "+hinweis, " ·"))

		abHaupt := 1
		if m := nurAbMuster.FindStringSubmatch(hinweis); m != nil {
			abHaupt, _ = strconv.Atoi(m[1])
		}
		if m := preisNamen.FindStringSubmatch(ankauf); m != nil {
			if c, ok := betrag(m[1]); ok {
				z.Ankaeufer = append(z.Ankaeufer, store.Ankaeufer{Name: m[2], Preis: c, AbStueck: abHaupt})
			}
		}
		for _, m := range staffelMuster.FindAllStringSubmatch(hinweis, -1) {
			if c, ok := betrag(m[1]); ok {
				ab, _ := strconv.Atoi(m[2])
				z.Ankaeufer = append(z.Ankaeufer, store.Ankaeufer{Name: m[3], Preis: c, AbStueck: ab})
			}
		}
		if m := einzelnMuster.FindStringSubmatch(hinweis); m != nil {
			if c, ok := betrag(m[1]); ok {
				z.Ankaeufer = append(z.Ankaeufer, store.Ankaeufer{Name: m[2], Preis: c, AbStueck: 1})
			}
		}
		if best, ok := einzelPreis(z.Ankaeufer); ok {
			z.Ankauf = best
		}
		z.Stichworte = stichworteAus(z.Name)
		out = append(out, z)
	}
	return out
}

// stichworteAus schlägt Stichworte für mydealz vor: der Name ohne Klammern
// und Füllwörter. Zubehör fällt mit „-controller" usw. weg, wo der Name kein
// Zubehör ist.
func stichworteAus(name string) string {
	n := regexp.MustCompile(`\([^)]*\)`).ReplaceAllString(name, " ")
	n = strings.Join(strings.Fields(strings.ReplaceAll(n, "…", " ")), " ")
	n = strings.ToLower(n)
	var teile []string
	teile = append(teile, n)
	for _, zubehoer := range []string{"controller", "hülle", "case", "kabel", "halterung", "ständer"} {
		if !strings.Contains(n, zubehoer) {
			teile = append(teile, "-"+zubehoer)
		}
	}
	return strings.Join(teile, ", ")
}
