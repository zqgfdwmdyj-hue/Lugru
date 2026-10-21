package billiger

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	spanneMuster = regexp.MustCompile(`(\d{1,3})\s*(?:-|–|bis)\s*(\d{1,3})\s*(werktag|tag|woche|monat)`)
	zahlMuster   = regexp.MustCompile(`(\d{1,3})\s*(werktag|tag|woche|monat)`)
	datumMuster  = regexp.MustCompile(`\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?`)
	sofortMuster = regexp.MustCompile(`sofort|auf lager|ab lager|lagernd|verfügbar|lieferbar|24\s*h`)
)

func tageJe(einheit string) int {
	switch {
	case strings.HasPrefix(einheit, "woche"):
		return 7
	case strings.HasPrefix(einheit, "monat"):
		return 30
	}
	return 1
}

// MaxLiefertage liest aus dem Lieferzeit-Text bei billiger.de die längste
// genannte Lieferzeit in Tagen: „1-3 Werktage" → 3, „Bis zu 4 Werktage" → 4,
// „2 Wochen" → 14, „Auf Lager" → 1, ein Datum → Tage bis dahin. Werktage
// zählen dabei wie Tage. ok ist false, wenn der Text nichts Verwertbares sagt.
func MaxLiefertage(text string, jetzt time.Time) (int, bool) {
	t := strings.ToLower(text)
	max, gefunden := 0, false
	for _, m := range spanneMuster.FindAllStringSubmatch(t, -1) {
		if n, err := strconv.Atoi(m[2]); err == nil {
			max, gefunden = maxInt(max, n*tageJe(m[3])), true
		}
	}
	if !gefunden {
		for _, m := range zahlMuster.FindAllStringSubmatch(t, -1) {
			if n, err := strconv.Atoi(m[1]); err == nil {
				max, gefunden = maxInt(max, n*tageJe(m[2])), true
			}
		}
	}
	if gefunden {
		return max, true
	}
	if m := datumMuster.FindStringSubmatch(t); m != nil {
		tag, _ := strconv.Atoi(m[1])
		monat, _ := strconv.Atoi(m[2])
		jahr := jetzt.Year()
		if m[3] != "" {
			jahr, _ = strconv.Atoi(m[3])
			if jahr < 100 {
				jahr += 2000
			}
		}
		if monat >= 1 && monat <= 12 && tag >= 1 && tag <= 31 {
			d := time.Date(jahr, time.Month(monat), tag, 0, 0, 0, 0, jetzt.Location())
			if m[3] == "" && d.Before(jetzt.AddDate(0, 0, -1)) {
				d = d.AddDate(1, 0, 0)
			}
			tage := int(d.Sub(jetzt).Hours()/24) + 1
			if tage < 1 {
				tage = 1
			}
			return tage, true
		}
	}
	if sofortMuster.MatchString(t) {
		return 1, true
	}
	return 0, false
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
