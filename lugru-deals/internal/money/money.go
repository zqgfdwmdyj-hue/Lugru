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
	ErrLeer      = errors.New("kein Betrag angegeben")
	ErrUngueltig = errors.New("kein gültiger Betrag")
)

var wegDamit = strings.NewReplacer("€", "", " ", "", "\u00A0", "", "\t", "")

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

	negativ := false
	switch {
	case strings.HasPrefix(s, "-"):
		negativ = true
		s = strings.TrimPrefix(s, "-")
	case strings.HasPrefix(s, "+"):
		s = strings.TrimPrefix(s, "+")
	}
	if s == "" {
		return 0, ErrUngueltig
	}

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

	if !nurZiffern(ganz) || !nurZiffern(bruch) {
		return 0, ErrUngueltig
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

// nurZiffern meldet, ob s ausschließlich aus ASCII-Ziffern besteht. Eine
// leere Zeichenkette gilt als gültig, da ganz/bruch nach dem Aufteilen leer
// sein dürfen (z. B. bei "130." oder "12,"). Sie verhindert, dass ein
// eingebettetes Vorzeichen (z. B. im Bruchteil "130,-5") von
// strconv.ParseInt stillschweigend als gültig akzeptiert wird.
func nurZiffern(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
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
