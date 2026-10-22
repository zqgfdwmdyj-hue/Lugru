// Package altpost liest Deals aus alten Discord-Posts: solchen, die von
// Hand oder vor dem Tool gepostet wurden. Erkannt wird das Format, in dem
// ihr postet:
//
//	🛒 Logitech MX Creative Console @everyone
//	🏬 [mediamarkt.de](https://…)
//	💰 EK: 99.99 € Brutto inkl. Versand
//	💸 VK: 164.99 €  [Amazon.DE](https://www.amazon.de/dp/B0…)
//	ℹ️ Amazon.DE: 50+ Verkäufe
//	🤑 Gewinn: 30.9 € / 19 % Marge
//
// Gesucht wird nach den Stichworten (EK:, VK:, Gewinn:), nicht nach den
// Emojis — die sehen je nach Gerät anders aus oder sind Server-Emojis.
package altpost

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Deal ist, was aus einem Post gelesen wurde. Beträge in Cent.
type Deal struct {
	Titel string
	ASIN  string

	// Quellmarkt ist das Land des Einkaufs, QuellURL der Link zu einem
	// Fremdshop (leer bei Amazon), Lieferant der Name eines Einkaufs ohne
	// Link.
	Quellmarkt string
	QuellURL   string
	Lieferant  string
	Zielmarkt  string

	EKCent  int64
	EKNotiz string
	EKNetto bool
	VKCent  int64
	Sales   int

	GewinnCent int64
	Marge      float64

	// PanEU ist gesetzt, wenn der Post eine Pan-EU-Zeile hat.
	PanEU           bool
	PanEUGewinnCent int64
	PanEUMarge      float64
	MaxMenge        int
	Ausverkauft     bool
}

var (
	linkMuster  = regexp.MustCompile(`\[([^\]]*)\]\(<?(https?://[^)>\s]+)>?\)|<?(https?://[^\s<>)]+)>?`)
	asinMuster  = regexp.MustCompile(`(?i)/(?:dp|gp/product|gp/aw/d|product)/([A-Z0-9]{10})(?:[/?#]|$)`)
	asinFrei    = regexp.MustCompile(`\b(B0[A-Z0-9]{8})\b`)
	amazonHost  = regexp.MustCompile(`(?i)(?:^|\.)amazon\.(de|fr|it|es|co\.uk|com|nl|pl|se|com\.be)$`)
	amazonText  = regexp.MustCompile(`(?i)amazon\.(de|fr|it|es|nl|pl|se|be|uk)\b`)
	zahlMuster  = regexp.MustCompile(`[-−–]?\s?\d[\d.,]*`)
	prozMuster  = regexp.MustCompile(`([-−–]?\s?\d[\d.,]*)\s*%`)
	mention     = regexp.MustCompile(`@everyone|@here|<@[!&]?\d+>`)
	eigenEmoji  = regexp.MustCompile(`<a?:\w+:\d+>|:[a-z0-9_+\-]+:`)
	salesMuster = regexp.MustCompile(`(?i)(\d[\d.]*)\s*\+?\s*(?:verk|sales|sold)`)
	mengeMuster = regexp.MustCompile(`(?i)max\.?\s*(\d+)`)
)

// Lies liest einen Post. ok ist false, wenn er nicht nach einem Deal
// aussieht: ohne Titel oder ohne Gewinnzeile.
func Lies(text string) (Deal, bool) {
	var d Deal
	text = strings.ReplaceAll(text, "\r", "")
	if strings.Contains(strings.ToUpper(text), "AUSVERKAUFT") {
		d.Ausverkauft = true
	}
	text = strings.ReplaceAll(text, "~~", "")

	var zeilen []string
	for _, z := range strings.Split(text, "\n") {
		z = strings.TrimSpace(z)
		if z == "" || strings.Contains(strings.ToUpper(z), "AUSVERKAUFT") {
			continue
		}
		zeilen = append(zeilen, z)
	}
	if len(zeilen) < 2 {
		return d, false
	}

	d.Titel = titelAus(zeilen[0])
	gewinnGefunden := false
	// Die Beträge erst als Kandidaten sammeln: "7.848" kann 7848 € oder
	// 7,848 € heißen, entschieden wird erst mit dem VK (siehe waehle).
	var ekK, vkK, gewK, panK []int64
	var shopLinks []string
	var alleLinks []string

	for i, z := range zeilen {
		klein := strings.ToLower(z)
		links := linksAus(z)
		alleLinks = append(alleLinks, links...)
		switch {
		case i == 0:
		case strings.Contains(klein, "pan-eu") || strings.Contains(klein, "pan eu") || strings.Contains(klein, "paneu"):
			if k := betragKandidaten(z, ":"); len(k) > 0 {
				panK = k
				d.PanEUMarge = prozentAus(z)
			}
		case strings.Contains(klein, "gewinn") || strings.Contains(klein, "profit"):
			if k := betragKandidaten(z, ":"); len(k) > 0 && !gewinnGefunden {
				gewK, gewinnGefunden = k, true
				d.Marge = prozentAus(z)
			}
		case strings.Contains(klein, "ek:") || strings.HasPrefix(klein, "ek ") || strings.Contains(klein, "einkauf:"):
			if k := betragKandidaten(z, ":"); len(k) > 0 {
				ekK = k
				d.EKCent = k[0]
				d.EKNotiz = notizNachBetrag(z)
				d.EKNetto = strings.Contains(klein, "netto")
			}
		case strings.Contains(klein, "vk:") || strings.Contains(klein, "verkauf:"):
			if k := betragKandidaten(z, ":"); len(k) > 0 {
				vkK = k
			}
			if m := amazonText.FindStringSubmatch(z); m != nil {
				d.Zielmarkt = marktCode(m[1])
			}
			for _, l := range links {
				if u, err := url.Parse(l); err == nil && d.Zielmarkt == "" {
					if h := amazonHost.FindStringSubmatch(u.Hostname()); h != nil {
						d.Zielmarkt = marktCode(h[1])
					}
				}
			}
			// Der Verkaufslink kommt vor allen anderen, wenn die ASIN
			// gesucht wird.
			alleLinks = append(links, alleLinks...)
		case salesMuster.MatchString(z):
			if m := salesMuster.FindStringSubmatch(z); m != nil {
				d.Sales, _ = strconv.Atoi(strings.ReplaceAll(m[1], ".", ""))
			}
		case strings.Contains(klein, "max") && strings.Contains(klein, "stück"):
			if m := mengeMuster.FindStringSubmatch(z); m != nil {
				d.MaxMenge, _ = strconv.Atoi(m[1])
			}
		case strings.Contains(klein, "arbitrageone") || strings.Contains(klein, "profitpath") || strings.Contains(klein, "keepa"):
		case d.EKCent == 0 && len(links) > 0:
			// Linkzeilen vor dem EK sind die Einkaufsquellen.
			shopLinks = append(shopLinks, links...)
		case d.EKCent == 0 && d.Lieferant == "" && len(links) == 0 && i == 1:
			// Eine Zeile ohne Link direkt unter dem Titel: Einkauf ohne
			// Link, etwa beim Großhandel.
			d.Lieferant = strings.TrimSpace(ohneEmoji(z))
		}
	}
	if d.Titel == "" || !gewinnGefunden {
		return d, false
	}
	if !d.plausibel(ekK, vkK, gewK, panK) {
		return d, false
	}

	// ASIN: zuerst aus einem Amazon-Link, sonst frei im Text.
	for _, l := range alleLinks {
		if m := asinMuster.FindStringSubmatch(l); m != nil {
			d.ASIN = strings.ToUpper(m[1])
			break
		}
	}
	if d.ASIN == "" {
		if m := asinFrei.FindStringSubmatch(text); m != nil {
			d.ASIN = m[1]
		}
	}
	// Ältere Posts nennen die ASIN in der Titelzeile; im Titel stört sie.
	if t := strings.Join(strings.Fields(asinFrei.ReplaceAllString(d.Titel, "")), " "); t != "" {
		d.Titel = t
	}
	if d.Zielmarkt == "" {
		d.Zielmarkt = "DE"
	}

	// Einkauf: der erste Shop-Link. Amazon selbst heißt Quellmarkt ohne URL.
	d.Quellmarkt = "DE"
	if len(shopLinks) > 0 {
		d.Lieferant = ""
		if u, err := url.Parse(shopLinks[0]); err == nil {
			host := strings.ToLower(u.Hostname())
			if h := amazonHost.FindStringSubmatch(host); h != nil {
				d.Quellmarkt = marktCode(h[1])
			} else {
				d.QuellURL = shopLinks[0]
				d.Quellmarkt = landAusHost(host)
			}
		}
	}
	return d, true
}

func titelAus(z string) string {
	z = mention.ReplaceAllString(z, "")
	z = ohneEmoji(z)
	z = strings.ReplaceAll(z, "**", "")
	return strings.TrimSpace(z)
}

// ohneEmoji entfernt Emojis und Symbole am Zeilenanfang sowie Server-Emojis
// und :kurznamen: überall.
func ohneEmoji(z string) string {
	z = eigenEmoji.ReplaceAllString(z, "")
	return strings.TrimLeftFunc(z, func(r rune) bool {
		return !(r >= '0' && r <= '9') && !istBuchstabe(r)
	})
}

func istBuchstabe(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= 0xC0 && r <= 0x24F)
}

func linksAus(z string) []string {
	var out []string
	for _, m := range linkMuster.FindAllStringSubmatch(z, -1) {
		if m[2] != "" {
			out = append(out, m[2])
		} else if m[3] != "" {
			out = append(out, m[3])
		}
	}
	return out
}

// betragNach liest den ersten Betrag hinter dem Trenner (etwa "EK:").
func betragNach(z, trenner string) (int64, bool) {
	if i := strings.Index(z, trenner); i >= 0 {
		z = z[i+len(trenner):]
	}
	// Links und Prozentangaben zuerst weg, damit keine Zahl aus einer
	// Adresse oder der Marge als Betrag gilt.
	z = linkMuster.ReplaceAllString(z, "")
	z = prozMuster.ReplaceAllString(z, "")
	m := zahlMuster.FindString(z)
	if m == "" {
		return 0, false
	}
	f, ok := zahl(m)
	if !ok {
		return 0, false
	}
	if f < 0 {
		return int64(f*100 - 0.5), true
	}
	return int64(f*100 + 0.5), true
}

func prozentAus(z string) float64 {
	m := prozMuster.FindStringSubmatch(z)
	if m == nil {
		return 0
	}
	f, _ := zahl(m[1])
	return f
}

// notizNachBetrag ist der Text hinter dem Betrag der EK-Zeile, etwa
// "Brutto inkl. Versand".
func notizNachBetrag(z string) string {
	if i := strings.Index(z, ":"); i >= 0 {
		z = z[i+1:]
	}
	if loc := zahlMuster.FindStringIndex(z); loc != nil {
		z = z[loc[1]:]
	}
	z = strings.TrimSpace(z)
	z = strings.TrimLeft(z, "€ ")
	return strings.TrimSpace(z)
}

// zahl liest deutsche und englische Schreibweisen: 99,99 · 99.99 ·
// 1.299,99 · 1,299.99 · 30.9 · −5,77.
func zahl(s string) (float64, bool) {
	s = strings.NewReplacer("−", "-", "–", "-", " ", "").Replace(strings.TrimSpace(s))
	s = strings.TrimRight(s, ".,")
	punkt, komma := strings.LastIndex(s, "."), strings.LastIndex(s, ",")
	switch {
	case punkt >= 0 && komma >= 0:
		if komma > punkt {
			s = strings.ReplaceAll(s, ".", "")
			s = strings.Replace(s, ",", ".", 1)
		} else {
			s = strings.ReplaceAll(s, ",", "")
		}
	case komma >= 0:
		if strings.Count(s, ",") == 1 && len(s)-komma-1 != 3 {
			s = strings.Replace(s, ",", ".", 1)
		} else {
			s = strings.ReplaceAll(s, ",", "")
		}
	case punkt >= 0:
		// Ein einzelner Punkt mit genau drei Ziffern dahinter ist ein
		// Tausenderpunkt (1.299), sonst ein Dezimalpunkt (99.99, 30.9).
		if strings.Count(s, ".") > 1 || len(s)-punkt-1 == 3 {
			s = strings.ReplaceAll(s, ".", "")
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	return f, err == nil
}

func marktCode(tld string) string {
	switch strings.ToLower(tld) {
	case "co.uk", "uk":
		return "UK"
	case "com.be", "be":
		return "BE"
	case "com":
		return "US"
	}
	return strings.ToUpper(tld)
}

func landAusHost(host string) string {
	for _, l := range []string{"de", "fr", "it", "es"} {
		if strings.HasSuffix(host, "."+l) {
			return strings.ToUpper(l)
		}
	}
	return "DE"
}

// betragKandidaten liest den ersten Betrag hinter dem Trenner, mit allen
// Lesarten: meist genau eine, bei "7.848" oder "7,848" zwei — Tausender
// (7848) zuerst, dann Dezimal (7,848). Beträge in Cent.
func betragKandidaten(z, trenner string) []int64 {
	if i := strings.Index(z, trenner); i >= 0 {
		z = z[i+len(trenner):]
	}
	z = linkMuster.ReplaceAllString(z, "")
	z = prozMuster.ReplaceAllString(z, "")
	roh := zahlMuster.FindString(z)
	if roh == "" {
		return nil
	}
	f, ok := zahl(roh)
	if !ok {
		return nil
	}
	out := []int64{cent(f)}
	s := strings.TrimRight(strings.NewReplacer("−", "-", "–", "-", " ", "").Replace(roh), ".,")
	for _, sep := range []string{".", ","} {
		andere := map[string]string{".": ",", ",": "."}[sep]
		if strings.Count(s, sep) == 1 && !strings.Contains(s, andere) && len(s)-strings.LastIndex(s, sep)-1 == 3 {
			if g, err := strconv.ParseFloat(strings.Replace(s, sep, ".", 1), 64); err == nil && cent(g) != out[0] {
				out = append(out, cent(g))
			}
		}
	}
	return out
}

func cent(f float64) int64 {
	if f < 0 {
		return int64(f*100 - 0.5)
	}
	return int64(f*100 + 0.5)
}

// plausibel wählt aus den Lesarten die, die zusammenpasst, und rechnet eine
// Marge nach, die nicht stimmen kann. false, wenn der Gewinn in keiner
// Lesart zum Verkaufspreis passt — dann ist der Post nicht sicher lesbar.
//
// Grundregel: Der Gewinn je Stück ist nie größer als der Verkaufspreis,
// die Marge (Gewinn geteilt durch VK) liegt darum zwischen -100 und 100 %.
func (d *Deal) plausibel(ekK, vkK, gewK, panK []int64) bool {
	if len(vkK) > 0 {
		d.VKCent = vkK[0]
	}
	passt := func(c int64) bool {
		if c < 0 {
			c = -c
		}
		if d.VKCent > 0 {
			return c <= d.VKCent
		}
		return c <= 1000000 // ohne VK: höchstens 10.000 € Gewinn
	}
	waehle := func(k []int64) (int64, bool) {
		for _, c := range k {
			if passt(c) {
				return c, true
			}
		}
		return 0, false
	}
	var ok bool
	if d.GewinnCent, ok = waehle(gewK); !ok {
		return false
	}
	if len(panK) > 0 {
		d.PanEUGewinnCent, d.PanEU = waehle(panK)
	}
	for _, c := range ekK {
		if d.VKCent == 0 || c <= 3*d.VKCent {
			d.EKCent = c
			break
		}
	}
	d.Marge = margeNach(d.Marge, d.GewinnCent, d.VKCent)
	if d.PanEU {
		d.PanEUMarge = margeNach(d.PanEUMarge, d.PanEUGewinnCent, d.VKCent)
	}
	return true
}

// margeNach behält eine gelesene Marge, wenn sie möglich ist, und rechnet
// sie sonst aus Gewinn und VK nach (auf eine Stelle gerundet).
func margeNach(marge float64, gewinn, vk int64) float64 {
	if marge >= -100 && marge <= 100 && !(marge == 0 && gewinn != 0) {
		return marge
	}
	if vk <= 0 {
		return 0
	}
	m := float64(gewinn) * 100 / float64(vk)
	return float64(int64(m*10+0.5*sign(m))) / 10
}

func sign(f float64) float64 {
	if f < 0 {
		return -1
	}
	return 1
}
