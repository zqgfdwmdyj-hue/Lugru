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
//
// Der Zeitstempel löst bis auf die Nanosekunde auf: mit Millisekunden
// (".000") lieferten zwei unmittelbar aufeinanderfolgende Aufrufe – wie in
// TestChartNamenKollidierenNicht – auf dieser Maschine reproduzierbar
// denselben Dateinamen (ein Chart hätte den vorherigen überschrieben, ohne
// Fehler). Mit Nanosekunden trat das in 5000 Wiederholungen samt echtem
// Datei-Schreibvorgang zwischen den Aufrufen nicht mehr auf.
func (s *Store) ChartSpeichern(asin string, png []byte) (string, error) {
	datei := fmt.Sprintf("%s-%s.png", asin, time.Now().UTC().Format("20060102-150405.000000000"))
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
