package web

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestEinstellungenSeiteZeigtWerte(t *testing.T) {
	srv, s := testServer(t)
	s.SetzeEinstellung(store.SchluesselProvision, "12,5")

	w := hole(t, srv, http.MethodGet, "/einstellungen", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d, will 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "12,5") {
		t.Error("gespeicherte Provision steht nicht im Formular")
	}
}

func TestEinstellungenSpeichern(t *testing.T) {
	srv, s := testServer(t)

	f := url.Values{
		store.SchluesselKeepaKey:  {"abc123"},
		store.SchluesselVorlage:   {post.StandardVorlage},
		store.SchluesselProvision: {"14"},
		store.SchluesselZielmarkt: {"ES"},
	}
	w := hole(t, srv, http.MethodPost, "/einstellungen", f.Encode())
	if w.Code != http.StatusOK && w.Code != http.StatusSeeOther {
		t.Fatalf("Status = %d", w.Code)
	}

	if got := s.Einstellung(store.SchluesselKeepaKey); got != "abc123" {
		t.Errorf("KeepaKey = %q, will abc123", got)
	}
	if got := s.Einstellung(store.SchluesselProvision); got != "14" {
		t.Errorf("Provision = %q, will 14", got)
	}
}

func TestKaputteVorlageWirdAbgelehnt(t *testing.T) {
	srv, s := testServer(t)

	f := url.Values{store.SchluesselVorlage: {"{{.GibtEsNicht}}"}}
	w := hole(t, srv, http.MethodPost, "/einstellungen", f.Encode())

	if got := s.Einstellung(store.SchluesselVorlage); got != "" {
		t.Errorf("Notiz wurde überschrieben (%q) — eine kaputte Notiz darf nie aktiv werden", got)
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "vorlage") {
		t.Error("Antwort nennt das Problem mit der Vorlage nicht")
	}
}

// Eine leere Notiz ist der Normalfall und muss sich speichern lassen. Früher
// war die Vorlage der ganze Post, und eine leere hätte eine leere Nachricht
// gepostet — darum stand hier einmal das Gegenteil. Seit der Post eine Karte
// ist, die das Programm baut, ist die Notiz nur noch eine Zeile darin.
func TestLeereNotizIstErlaubt(t *testing.T) {
	srv, s := testServer(t)

	if err := s.SetzeEinstellung(store.SchluesselVorlage, "Alte Notiz"); err != nil {
		t.Fatalf("SetzeEinstellung: %v", err)
	}

	f := url.Values{store.SchluesselVorlage: {""}}
	w := hole(t, srv, http.MethodPost, "/einstellungen", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	if got := s.Einstellung(store.SchluesselVorlage); got != "" {
		t.Errorf("die geleerte Notiz wurde nicht gespeichert: %q", got)
	}
}

func TestVorlagenVorschau(t *testing.T) {
	srv, _ := testServer(t)

	f := url.Values{store.SchluesselVorlage: {"Gewinn: {{.Gewinn}}"}}
	w := hole(t, srv, http.MethodPost, "/einstellungen/vorschau", f.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d, will 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "Gewinn:") {
		t.Errorf("Vorschau zeigt die gerenderte Vorlage nicht: %s", w.Body.String())
	}
}

// TestEinstellungenSpeichernMehrereStandardMaerkte deckt Task 10 ab: die
// Standard-Zielmärkte kommen jetzt als mehrere Kästchen desselben Namens.
// Die generische Speicherschleife in speichereEinstellungen nähme davon nur
// den ersten Wert — hier wird geprüft, dass stattdessen alle drei ankommen.
func TestEinstellungenSpeichernMehrereStandardMaerkte(t *testing.T) {
	srv, s := testServer(t)

	v := url.Values{}
	v["deal.standard_zielmarkt"] = []string{"DE", "IT", "ES"}

	w := hole(t, srv, http.MethodPost, "/einstellungen", v.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	if got := s.Einstellung(store.SchluesselZielmarkt); got != "DE,IT,ES" {
		t.Errorf("Einstellung = %q, will \"DE,IT,ES\"", got)
	}
}

// Kein angehaktes Kästchen wäre ein Zustand, aus dem der Funnel nicht
// herauskäme: Schritt 2 böte nichts Vorgewähltes. Darum abgelehnt wie eine
// leere Vorlage — und die bisherige Einstellung bleibt dabei unverändert
// stehen.
func TestEinstellungenLehnenLeereMarktlisteAb(t *testing.T) {
	srv, s := testServer(t)
	_ = s.SetzeEinstellung(store.SchluesselZielmarkt, "DE,IT")

	v := url.Values{}
	v["deal.standard_zielmarkt"] = []string{""}

	w := hole(t, srv, http.MethodPost, "/einstellungen", v.Encode())
	if !strings.Contains(w.Body.String(), "Zielmarkt") {
		t.Errorf("keine Meldung zur leeren Marktliste:\n%s", w.Body.String())
	}
	if got := s.Einstellung(store.SchluesselZielmarkt); got != "DE,IT" {
		t.Errorf("Einstellung = %q, will unverändert \"DE,IT\"", got)
	}
}

var eingabeFeldRe = regexp.MustCompile(`<input[^>]*>`)
var wertAttributRe = regexp.MustCompile(`value="([^"]*)"`)

// browserFormularOhneHaken liest aus der gerenderten Einstellungsseite genau
// das heraus, was ein echter Browser sendet, wenn der Nutzer JEDES Kästchen
// bei "Standard-Zielmärkte" abwählt: ein nicht angehaktes Kästchen liefert
// gar nichts, ein verborgenes Feld mit demselben Namen aber schon.
//
// Das ist bewusst aus dem gerenderten HTML abgeleitet statt von Hand
// erdichtet: nur so schlägt der Test rot, wenn das verborgene Feld aus der
// Vorlage verschwindet, statt unabhängig von ihr immer dieselbe Formular-Map
// zu schicken.
func browserFormularOhneHaken(seite string) url.Values {
	v := url.Values{}
	for _, tag := range eingabeFeldRe.FindAllString(seite, -1) {
		if !strings.Contains(tag, `name="`+store.SchluesselZielmarkt+`"`) {
			continue
		}
		if strings.Contains(tag, `type="checkbox"`) {
			continue // abgewählt: ein Browser sendet dafür nichts
		}
		wert := ""
		if m := wertAttributRe.FindStringSubmatch(tag); len(m) == 2 {
			wert = m[1]
		}
		v.Add(store.SchluesselZielmarkt, wert)
	}
	return v
}

// TestEinstellungenLehnenFehlendenZielmarktAb deckt den Befund aus dem
// Review zu Task 10 ab: TestEinstellungenLehnenLeereMarktlisteAb prüft nur
// den synthetischen Fall []string{""}, den kein Browser erzeugt. Ein
// nicht angehaktes Kästchen sendet GAR NICHTS — ohne das verborgene Feld in
// der Vorlage käme der Schlüssel deal.standard_zielmarkt beim Abwählen aller
// Kästchen überhaupt nicht im Formular an, r.PostForm.Has liefe nie an, und
// die alte Einstellung bliebe unbemerkt stehen samt Erfolgsmeldung.
//
// Das Formular für den POST wird hier aus der echten GET-Seite abgeleitet
// (browserFormularOhneHaken), damit der Test tatsächlich das verborgene Feld
// aus der Vorlage prüft und nicht nur eine von Hand gebaute Annahme darüber.
func TestEinstellungenLehnenFehlendenZielmarktAb(t *testing.T) {
	srv, s := testServer(t)
	_ = s.SetzeEinstellung(store.SchluesselZielmarkt, "DE,IT")

	seite := hole(t, srv, http.MethodGet, "/einstellungen", "")
	v := browserFormularOhneHaken(seite.Body.String())

	w := hole(t, srv, http.MethodPost, "/einstellungen", v.Encode())
	if !strings.Contains(w.Body.String(), "Zielmarkt") {
		t.Errorf("keine Meldung zur fehlenden Marktauswahl:\n%s", w.Body.String())
	}
	if got := s.Einstellung(store.SchluesselZielmarkt); got != "DE,IT" {
		t.Errorf("Einstellung = %q, will unverändert \"DE,IT\"", got)
	}
}
