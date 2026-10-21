// Package marketplace hält die unterstützten Amazon-Marktplätze als Daten,
// nicht als Sonderfälle im Code. Ein weiterer Markt ist eine Zeile in tabelle.
package marketplace

import (
	"fmt"
	"net/url"
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

// ProductURLMitTag baut die Produktseite mit angehängtem Affiliate-Tag.
//
// Ein leerer Tag ergibt denselben Link wie ProductURL — ein nacktes "?tag="
// wäre sichtbarer Ballast in einer Adresse, die sonst niemand hinterfragt.
//
// Der Tag wird kodiert, obwohl die Tag-Seite ihn beim Anlegen bereits auf
// [A-Za-z0-9_-] einschränkt und dabei nichts übrig bleibt, was Kodierung
// braucht. Das ist Absicht: die Funktion ist öffentlich, und was sie baut
// landet unverändert im Markdown-Link eines Discord-Posts. Sie soll für sich
// allein stehen können, ohne sich auf die Sorgfalt ihres Aufrufers zu
// verlassen.
func (m Marketplace) ProductURLMitTag(asin, tag string) string {
	if tag == "" {
		return m.ProductURL(asin)
	}
	return m.ProductURL(asin) + "?tag=" + url.QueryEscape(tag)
}

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
