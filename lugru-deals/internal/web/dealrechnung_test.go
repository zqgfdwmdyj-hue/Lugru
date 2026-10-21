package web

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// zweiMaerkte ist der Referenzfall, erweitert um Italien: dieselbe Ware,
// derselbe Einkauf, ein zweiter Absatzmarkt.
func zweiMaerkte() url.Values {
	v := referenzFormular(0)
	v["zielmarkt"] = []string{"DE", "IT"}
	v.Set("leitmarkt", "DE")
	v.Set("vk.IT", "189,00")
	v.Set("vk_quelle.IT", "avg90")
	v.Set("sales.IT", "12")
	v.Set("sales_quelle.IT", "monthlySold")
	v.Set("provision.IT", "15")
	v.Set("provision_quelle.IT", "keepa")
	v.Set("fba.IT", "18,06")
	v.Set("fba_quelle.IT", "EFN-Tarif · Standardpaket")
	return v
}

func TestBerechnungZeigtJedenMarktEinzeln(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", zweiMaerkte().Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	koerper := w.Body.String()
	// Der Leitmarkt rechnet unverändert wie im Referenzfall.
	for _, muss := range []string{"DE", "IT", "26,70", "12,9"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Übersicht enthält %q nicht:\n%s", muss, koerper)
		}
	}

	// Und IT rechnet mit SEINEN Zahlen, nicht mit denen von DE. Ohne diese
	// Zusicherung ginge eine Regression durch, die jedem Markt die Zahlen des
	// Leitmarkts gäbe — die Übersicht zeigte dann vier Spalten, und alle
	// stimmten überein. Genau das ist die Überschrift dieser Aufgabe.
	//
	// 189,00 € VK, 22 % IT-USt, 15 % Provision, 18,06 € EFN-Gebühr gegen
	// 130,56 € Einkauf zu 21 % ES-Vorsteuer: 0,61 € bei 0,3 % Marge. Die Zahl
	// steht hier ausgeschrieben und nicht nachgerechnet — eine im Test
	// nachgebaute Formel wäre eine zweite Wahrheit neben calc.Rechne.
	if !strings.Contains(koerper, "0,61") {
		t.Errorf("IT trägt nicht seinen eigenen Gewinn (0,61 €):\n%s", koerper)
	}
}

// Ein Markt mit unlesbarer Zahl nennt sich beim Namen. Ohne das stünde in
// Schritt 3 "Verkaufspreis: kein gültiger Betrag" über vier Spalten, ohne zu
// sagen, welche gemeint ist.
func TestBerechnungNenntDenMarktImFehler(t *testing.T) {
	srv, _ := testServer(t)

	v := zweiMaerkte()
	v.Set("vk.IT", "keine Zahl")

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", v.Encode())
	koerper := w.Body.String()
	if !strings.Contains(koerper, "IT") || !strings.Contains(koerper, "Verkaufspreis") {
		t.Errorf("Fehler nennt Markt und Größe nicht:\n%s", koerper)
	}
}

func TestBerechnungOhneMarktBittetUmEinenMarkt(t *testing.T) {
	srv, _ := testServer(t)

	v := referenzFormular(0)
	delete(v, "zielmarkt")
	delete(v, "leitmarkt")

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", v.Encode())
	if !strings.Contains(w.Body.String(), "Zielmarktplatz") {
		t.Errorf("keine Rückfrage nach dem Zielmarktplatz:\n%s", w.Body.String())
	}
}

// Die Rechnung eines Marktes steckt in der Zeile dieses Marktes und nicht
// irgendwo darunter: sonst stünde bei mehreren Märkten nicht fest, zu welcher
// Zahl der Kassenbon gehört, den man gerade liest.
func TestRechnungStecktInDerZeileIhresMarktes(t *testing.T) {
	srv, _ := testServer(t)

	w := hole(t, srv, http.MethodPost, "/deal/berechnung", zweiMaerkte().Encode())
	koerper := w.Body.String()

	// Die beiden Rechner grenzen die Bereiche ab: was zwischen dem einen und
	// dem nächsten steht, gehört dem ersten. Auf ein schließendes </tr> lässt
	// sich dabei nicht zählen — die Karte selbst enthält eine Tabelle mit
	// eigenen Zeilen.
	de := strings.Index(koerper, `aria-label="Rechnung für Amazon.DE"`)
	it := strings.Index(koerper, `aria-label="Rechnung für Amazon.IT"`)
	if de < 0 || it < 0 || de > it {
		t.Fatalf("die beiden Taschenrechner stehen nicht in der erwarteten Reihenfolge (DE %d, IT %d):\n%s", de, it, koerper)
	}
	bereiche := map[string]string{"DE": koerper[de:it], "IT": koerper[it:]}
	for markt, bereich := range bereiche {
		if !strings.Contains(bereich, "Verkauf über Amazon."+markt) {
			t.Errorf("die Rechnung von %s steht nicht bei seinem Rechner:\n%s", markt, bereich)
		}
		for anderer := range bereiche {
			if anderer != markt && strings.Contains(bereich, "Verkauf über Amazon."+anderer) {
				t.Errorf("beim Rechner von %s steht die Rechnung von %s:\n%s", markt, anderer, bereich)
			}
		}
	}
}
