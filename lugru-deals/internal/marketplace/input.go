package marketplace

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

var (
	ErrKeineEingabe = errors.New("keine Eingabe")
	ErrKeinLink     = errors.New("weder eine ASIN noch ein Einkaufslink erkannt")
)

// Einkaufsquelle ist das Ergebnis von Schritt 1 des Funnels: was sich aus dem
// eingefügten Einkaufslink ableiten lässt.
//
// Nicht jedes Feld ist immer gefüllt, und genau darauf baut der Funnel auf —
// er fragt hinterher nur noch das nach, was fehlt:
//
//	Amazon-Produktlink   ASIN und Markt bekannt, nichts zu fragen
//	Amazon-Link ohne /dp ASIN fehlt
//	nackte ASIN          Einkaufsmarkt fehlt
//	Fremdshop-Link       ASIN fehlt (außer der Pfad trägt zufällig eine)
//
// Markt bleibt bei einem Fremdshop bewusst nil: aus "mediamarkt.de" folgt
// kein Amazon-Marktplatz. Für die Umsatzsteuer wird trotzdem ein Land
// gebraucht — das erfragt der Funnel getrennt und speichert es als
// Quellmarkt, siehe LandZuHost.
type Einkaufsquelle struct {
	ASIN  string       // leer, wenn der Link keine ASIN hergibt
	Markt *Marketplace // nil bei nackter ASIN und bei jedem Fremdshop
	// URL ist der geprüfte Link, entschärft für den Markdown-Linkkontext des
	// Posts (siehe markdownGrenzen). Leer nur bei einer nackten ASIN, die
	// gar keinen Link mitbringt. Er sagt darum nichts darüber aus, ob
	// außerhalb von Amazon eingekauft wird — dafür ist Extern da, denn genau
	// diese Doppelbedeutung hat schon einmal einen ungeprüften Link an der
	// Entschärfung vorbeigeführt.
	URL  string
	Host string // Anzeigeform des Hosts, ohne "www."

	extern bool
}

// Extern meldet, ob eingekauft wird, wo Keepa nichts weiß: außerhalb der
// unterstützten Amazon-Marktplätze.
func (q Einkaufsquelle) Extern() bool { return q.extern }

var (
	nackteASIN = regexp.MustCompile(`^[A-Z0-9]{10}$`)
	// (?i): Amazon-Pfade erscheinen kleingeschrieben ("/dp/..."); u.Path wird
	// unverändert geprüft, die ASIN selbst danach auf Großschreibung normiert.
	//
	// (?:/|$) ist keine Formsache: ohne diese Segmentgrenze zählte auch der
	// Anfang einer längeren Nummer als ASIN, und aus einer gewöhnlichen
	// 13-stelligen Artikelnummer (/product/1234567890123) würde die
	// erfundene ASIN "1234567890" — Keepa-Abfrage und Verkaufslink zeigten
	// dann auf eine Kennung, die niemand eingegeben hat.
	pfadASIN = regexp.MustCompile(`(?i)/(?:dp|gp/product|gp/aw/d|product)/([a-z0-9]{10})(?:/|$)`)
	// Bei einem Fremdshop gilt nur die Amazon-eigene Linkform. "/product/"
	// ist die Form, die auch beliebige andere Shops benutzen — dort steht
	// hinter dem Segment eben deren eigene Artikelnummer und keine ASIN.
	// Zehn Zeichen können auch bei ihr zufällig passen, und eine geratene
	// ASIN ist schlimmer als eine gestellte Frage.
	fremdPfadASIN = regexp.MustCompile(`(?i)/(?:dp|gp/product|gp/aw/d)/([a-z0-9]{10})(?:/|$)`)
	// hostMuster hält als Link durchgehen zu lassen, was auch wirklich wie ein
	// Hostname aussieht. Ohne diese Prüfung würde jede Texteingabe ohne
	// Leerzeichen ("hallo") nach dem Voranstellen von "https://" zu einem
	// gültigen url.URL mit Host — und der Funnel liefe mit einem
	// Fantasie-Shop weiter, statt nach einem echten Link zu fragen.
	hostMuster = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
)

// ParseEinkaufslink erkennt, was in Schritt 1 eingefügt wurde: eine nackte
// ASIN, einen Amazon-Produktlink oder den Link eines beliebigen anderen Shops.
//
// Ein Fremdshop-Link ist ausdrücklich kein Fehler — er ist der zweite
// vorgesehene Weg in den Funnel. Verkauft wird ohnehin immer bei Amazon, der
// Einkauf kann aber von überall kommen; nur die ASIN muss dann von Hand
// nachgereicht werden, weil sie im Link eines Fremdshops nicht steht.
func ParseEinkaufslink(s string) (Einkaufsquelle, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return Einkaufsquelle{}, ErrKeineEingabe
	}

	if gross := strings.ToUpper(s); nackteASIN.MatchString(gross) {
		return Einkaufsquelle{ASIN: gross}, nil
	}

	roh := s
	if !strings.Contains(roh, "://") {
		roh = "https://" + roh
	}
	u, err := url.Parse(roh)
	if err != nil {
		return Einkaufsquelle{}, ErrKeinLink
	}
	// Nur http und https. Ein "javascript:"- oder "data:"-Link darf nie bis
	// in den Discord-Post durchrutschen, wo ihn html/template nicht mehr
	// entschärfen kann: der Post ist Markdown für einen fremden Dienst, kein
	// von diesem Programm gerendertes HTML.
	if u.Scheme != "http" && u.Scheme != "https" {
		return Einkaufsquelle{}, ErrKeinLink
	}
	wirt := strings.ToLower(u.Hostname())
	if !hostMuster.MatchString(wirt) {
		return Einkaufsquelle{}, ErrKeinLink
	}

	if m, ok := ByHost(wirt); ok {
		return Einkaufsquelle{
			ASIN:  pfadZuASIN(pfadASIN, u.Path),
			Markt: &m,
			URL:   linkSicher(u.String()),
			Host:  strings.TrimPrefix(m.Host, "www."),
		}, nil
	}

	// Alles andere ist ein Fremdshop — auch ein Amazon-Marktplatz, der hier
	// nicht in der Tabelle steht (amazon.co.uk etwa). Dessen Produktpfad
	// trägt die ASIN trotzdem; gerechnet wird dann mit dem Umsatzsteuersatz
	// des Landes, das der Funnel erfragt.
	return Einkaufsquelle{
		ASIN:   pfadZuASIN(fremdPfadASIN, u.Path),
		URL:    linkSicher(u.String()),
		Host:   strings.TrimPrefix(wirt, "www."),
		extern: true,
	}, nil
}

func pfadZuASIN(muster *regexp.Regexp, pfad string) string {
	if treffer := muster.FindStringSubmatch(pfad); treffer != nil {
		return strings.ToUpper(treffer[1])
	}
	return ""
}

// markdownGrenzen sind die Zeichen, die einen Fremdshop-Link aus dem
// Markdown-Link herausbrechen lassen, in den der Discord-Post ihn setzt:
// "[Shop](hier steht der Link)". Eine schließende Klammer im Link beendet
// ihn vorzeitig, und was danach kommt, steht als eigener Text — bis hin zu
// einem zweiten, scheinbar mitempfohlenen Link:
//
//	https://shop.example/x?y=)[Angebot](https://boese.example)
//
// Schema- und Hostprüfung fangen das nicht: der Link ist gültig, nur seine
// Query trägt die Klammer. Prozentkodiert bleibt er derselbe Link — jeder
// Server liest %28/%29 wie ( und ) —, kann aber nichts mehr beenden. Die
// spitzen Klammern und das Leerzeichen stehen aus demselben Grund dabei:
// Discord erkennt <…> als Linkform, und ein Leerzeichen trennt Linkziel und
// Titel.
var markdownGrenzen = strings.NewReplacer(
	"(", "%28", ")", "%29", "<", "%3C", ">", "%3E", " ", "%20", `"`, "%22",
)

// linkSicher macht einen Link für den Markdown-Linkkontext des Posts
// unschädlich. Steuerzeichen kommen hier nie an — url.Parse lehnt sie
// bereits ab.
func linkSicher(roh string) string { return markdownGrenzen.Replace(roh) }

// LandZuHost rät den Einkaufsmarktplatz eines Fremdshops aus seiner Endung:
// "mediamarkt.de" -> DE. Das legt allein den Umsatzsteuersatz fest, mit dem
// der Einkauf gerechnet wird, und ist darum nur ein Vorschlag — der Funnel
// zeigt ihn zur Bestätigung an, statt ihn stillschweigend zu übernehmen.
//
// Passt keine Endung, bleibt ok false: dann steht im Formular kein Land
// vorausgewählt und es muss eines gewählt werden.
func LandZuHost(host string) (Marketplace, bool) {
	h := strings.ToLower(strings.TrimSpace(host))
	punkt := strings.LastIndex(h, ".")
	if punkt < 0 {
		return Marketplace{}, false
	}
	endung := h[punkt+1:]
	for _, m := range tabelle {
		if m.TLD == endung {
			return m, true
		}
	}
	return Marketplace{}, false
}

// LandZuHostBekannt sagt, ob sich aus der Endung eines Shops ein Land
// ableiten lässt.
func LandZuHostBekannt(host string) bool {
	_, ok := LandZuHost(host)
	return ok
}
