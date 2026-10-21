// Package bild macht aus Keepas imagesCSV eine geprüfte Bild-Kennung und baut
// daraus die Adresse des Produktbildes bei Amazon.
//
// Eigenes Paket, weil zwei Seiten dasselbe brauchen: keepa beim Parsen der
// Produktantwort und web beim Rendern der Historie. Ohne dieses Paket müsste
// eines der beiden vom anderen abhängen.
package bild

import (
	"regexp"
	"strconv"
	"strings"
)

// kennungMuster beschreibt einen Amazon-Bildnamen wie "41Ny6ILlHnL.jpg".
//
// Bewusst eine Erlaubnisliste statt einer Verbotsliste: die Kennung landet in
// einem src-Attribut, und dort ist alles gefährlich, was nicht ausdrücklich
// ein Dateiname ist — ein Schrägstrich ("//boese.example/x.jpg" ist eine
// vollständige fremde Adresse), ein Punkt-Punkt, ein Fragezeichen, ein
// Anführungszeichen. Die Längengrenze hält den Namen in der Größenordnung, in
// der Amazon ihn tatsächlich vergibt.
var kennungMuster = regexp.MustCompile(`^[A-Za-z0-9_+-]{1,64}\.(jpg|jpeg|png|gif)$`)

// Gueltig sagt, ob k als Bildname in eine Adresse eingesetzt werden darf.
func Gueltig(k string) bool { return kennungMuster.MatchString(k) }

// KennungAusCSV liefert den ersten brauchbaren Eintrag aus Keepas imagesCSV.
//
// Keepa reiht dort mehrere Bilder desselben Produkts auf; das erste ist das
// Hauptbild. Unbrauchbare Einträge werden übersprungen statt die ganze Liste
// zu verwerfen — ein einzelner unerwarteter Name soll nicht das Bild eines
// Deals kosten, dessen zweiter Eintrag in Ordnung ist.
func KennungAusCSV(csv string) string {
	for _, teil := range strings.Split(csv, ",") {
		teil = strings.TrimSpace(teil)
		if Gueltig(teil) {
			return teil
		}
	}
	return ""
}

const basis = "https://m.media-amazon.com/images/I/"

// URL baut die Adresse des Bildes. kante ist die längste Kante in Pixeln, die
// Amazon liefern soll; 0 bedeutet Originalgröße.
//
// Die Kennung wird hier erneut geprüft, obwohl sie beim Speichern schon einmal
// geprüft wurde: sie stammt aus der Datenbank, war davor aber ein verstecktes
// Formularfeld im Browser — dieselbe Überlegung wie bei store.ChartLesen. Bei
// einer ungültigen Kennung entsteht keine Adresse, sondern die leere
// Zeichenkette; eine Vorlage schreibt dann ein leeres src statt einer
// erfundenen oder fremden Adresse.
func URL(k string, kante int) string {
	if !Gueltig(k) {
		return ""
	}
	if kante <= 0 {
		return basis + k
	}
	punkt := strings.LastIndexByte(k, '.')
	return basis + k[:punkt] + "._SL" + strconv.Itoa(kante) + "_" + k[punkt:]
}
