package bild_test

import (
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/bild"
)

func TestGueltigNimmtEchteKeepaNamen(t *testing.T) {
	for _, k := range []string{
		"41Ny6ILlHnL.jpg",
		"51QeQxxJ8ZL.png",
		"A1b-c_d+e.jpeg",
		"71xyz.gif",
	} {
		if !bild.Gueltig(k) {
			t.Errorf("Gueltig(%q) = false, erwartet true", k)
		}
	}
}

func TestGueltigWeistAllesAbWasKeinDateinameIst(t *testing.T) {
	for _, k := range []string{
		"",
		"41Ny6ILlHnL",                // ohne Endung
		"41Ny6ILlHnL.svg",            // Endung nicht erlaubt
		"../../../etc/passwd.jpg",    // Pfad nach oben
		"unter/ordner.jpg",           // Pfad nach unten
		"bild.jpg?x=1",               // Query angehängt
		"bild.jpg#anker",             // Fragment angehängt
		"http://boese.example/x.jpg", // ganze fremde Adresse
		"//boese.example/x.jpg",      // schemarelative Adresse
		"bild .jpg",                  // Leerzeichen
		"bild\n.jpg",                 // Zeilenumbruch
		"\"onerror=alert(1).jpg",     // Ausbruch aus dem Attribut
	} {
		if bild.Gueltig(k) {
			t.Errorf("Gueltig(%q) = true, erwartet false", k)
		}
	}
}

func TestGueltigBegrenztDieLaenge(t *testing.T) {
	lang := ""
	for range 65 {
		lang += "a"
	}
	if bild.Gueltig(lang + ".jpg") {
		t.Error("Gueltig mit 65-Zeichen-Namen = true, erwartet false")
	}
}

func TestKennungAusCSVNimmtDenErsten(t *testing.T) {
	got := bild.KennungAusCSV("41Ny6ILlHnL.jpg,51QeQxxJ8ZL.jpg,61abc.jpg")
	if got != "41Ny6ILlHnL.jpg" {
		t.Errorf("KennungAusCSV = %q, erwartet %q", got, "41Ny6ILlHnL.jpg")
	}
}

func TestKennungAusCSVUeberspringtUngueltige(t *testing.T) {
	got := bild.KennungAusCSV("../boese.jpg,41Ny6ILlHnL.jpg")
	if got != "41Ny6ILlHnL.jpg" {
		t.Errorf("KennungAusCSV = %q, erwartet %q", got, "41Ny6ILlHnL.jpg")
	}
}

func TestKennungAusCSVOhneBrauchbarenEintrag(t *testing.T) {
	for _, csv := range []string{"", ",", "  ", "../boese.jpg"} {
		if got := bild.KennungAusCSV(csv); got != "" {
			t.Errorf("KennungAusCSV(%q) = %q, erwartet leer", csv, got)
		}
	}
}

func TestURLSetztDieKantenlaengeVorDieEndung(t *testing.T) {
	got := bild.URL("41Ny6ILlHnL.jpg", 160)
	want := "https://m.media-amazon.com/images/I/41Ny6ILlHnL._SL160_.jpg"
	if got != want {
		t.Errorf("URL = %q, erwartet %q", got, want)
	}
}

func TestURLOhneKantenlaengeLiefertDasOriginal(t *testing.T) {
	got := bild.URL("41Ny6ILlHnL.jpg", 0)
	want := "https://m.media-amazon.com/images/I/41Ny6ILlHnL.jpg"
	if got != want {
		t.Errorf("URL = %q, erwartet %q", got, want)
	}
}

// Die Kennung läuft über ein verstecktes Formularfeld durch den Browser. URL
// prüft sie deshalb ein zweites Mal und baut aus Unsinn keine Adresse, statt
// ihn in ein src-Attribut durchzureichen.
func TestURLBautAusUngueltigerKennungNichts(t *testing.T) {
	for _, k := range []string{"", "../boese.jpg", "http://boese.example/x.jpg"} {
		if got := bild.URL(k, 160); got != "" {
			t.Errorf("URL(%q) = %q, erwartet leer", k, got)
		}
	}
}
