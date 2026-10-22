package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
)

// gelesen baut eine Anfrage aus den Werten und gibt das gelesene Formular
// zurück — formularLesen setzt ein bereits geparstes PostForm voraus.
func gelesen(t *testing.T, v url.Values) dealFormular {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/deal/berechnung", strings.NewReader(v.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if err := r.ParseForm(); err != nil {
		t.Fatalf("ParseForm: %v", err)
	}
	return formularLesen(r)
}

func TestFormularLiestJedenMarktMitSeinenEigenenZahlen(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt":    {"DE", "IT"},
		"leitmarkt":    {"IT"},
		"vk.DE":        {"207,49"},
		"vk_quelle.DE": {"avg90"},
		"vk.IT":        {"189,00"},
		"vk_quelle.IT": {"manuell"},
		"fba.DE":       {"8,64"},
		"fba.IT":       {"18,06"},
	})

	if len(f.Maerkte) != 2 {
		t.Fatalf("%d Märkte gelesen, will 2: %+v", len(f.Maerkte), f.Maerkte)
	}
	if f.Maerkte[0].Code != marketplace.DE || f.Maerkte[0].VK != "207,49" || f.Maerkte[0].FBA != "8,64" {
		t.Errorf("DE = %+v", f.Maerkte[0])
	}
	if f.Maerkte[1].Code != marketplace.IT || f.Maerkte[1].VK != "189,00" || f.Maerkte[1].FBA != "18,06" {
		t.Errorf("IT = %+v", f.Maerkte[1])
	}
	if f.Leitmarkt != marketplace.IT {
		t.Errorf("Leitmarkt = %q, will IT", f.Leitmarkt)
	}
	if f.Leit().VK != "189,00" {
		t.Errorf("Leit().VK = %q, will 189,00", f.Leit().VK)
	}
}

// Wer in Schritt 2 ein Kästchen abhakt, trägt den alten Leitmarkt noch mit.
// Der erste gewählte rückt dann nach — es gibt keinen Zustand ohne
// Leitmarkt, in dem sich weiterrechnen ließe.
func TestLeitmarktRuecktNachWennErNichtMehrGewaehltIst(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt": {"FR", "IT"},
		"leitmarkt": {"DE"},
		"vk.FR":     {"100,00"},
	})

	if f.Leitmarkt != marketplace.FR {
		t.Errorf("Leitmarkt = %q, will FR", f.Leitmarkt)
	}
}

func TestFormularUebergehtUnbekanntenMarkt(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt": {"DE", "XX"},
		"vk.DE":     {"207,49"},
		"vk.XX":     {"999,00"},
	})

	if len(f.Maerkte) != 1 || f.Maerkte[0].Code != marketplace.DE {
		t.Fatalf("Märkte = %+v, will genau [DE]", f.Maerkte)
	}
}

// Ein abgewählter Markt darf seine Werte nicht an den Nachbarn vererben —
// genau der Grund für das Marktsuffix statt einer laufenden Nummer.
func TestFormularVerwechseltDieMaerkteNicht(t *testing.T) {
	f := gelesen(t, url.Values{
		"zielmarkt": {"IT"},
		"vk.DE":     {"207,49"},
		"vk.IT":     {"189,00"},
	})

	if len(f.Maerkte) != 1 {
		t.Fatalf("%d Märkte, will 1", len(f.Maerkte))
	}
	if f.Maerkte[0].VK != "189,00" {
		t.Errorf("IT trägt VK %q, will 189,00 — die Werte sind verrutscht", f.Maerkte[0].VK)
	}
}

// Ohne gewählten Markt gibt es nichts zu rechnen. Leit() muss trotzdem einen
// brauchbaren Nullwert liefern, statt in einen Indexfehler zu laufen.
func TestFormularOhneMarktLiefertLeerenLeitmarkt(t *testing.T) {
	f := gelesen(t, url.Values{"asin": {"B01636IZ0G"}})

	if len(f.Maerkte) != 0 {
		t.Fatalf("Märkte = %+v, will leer", f.Maerkte)
	}
	if f.Leitmarkt != "" || f.Leit().VK != "" {
		t.Errorf("Leitmarkt = %q, Leit() = %+v", f.Leitmarkt, f.Leit())
	}
}
