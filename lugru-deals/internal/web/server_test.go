package web

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// testServer baut einen Server auf einer frischen Datenbank.
func testServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	s, err := store.Open(filepath.Join(dir, "test.db"), filepath.Join(dir, "charts"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	return Neu(s, keepa.NeuerClient(""), http.DefaultClient, ""), s
}

func hole(t *testing.T, srv *Server, methode, pfad string, formular string) *httptest.ResponseRecorder {
	t.Helper()
	var koerper *strings.Reader
	if formular == "" {
		koerper = strings.NewReader("")
	} else {
		koerper = strings.NewReader(formular)
	}
	r := httptest.NewRequest(methode, pfad, koerper)
	if formular != "" {
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	w := httptest.NewRecorder()
	srv.Routen().ServeHTTP(w, r)
	return w
}

func TestStartseiteAntwortet(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodGet, "/", "")
	if w.Code != http.StatusOK {
		t.Errorf("Status = %d, will 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "<html") {
		t.Error("Antwort enthält kein HTML")
	}
}

func TestStatischeDateienWerdenAusgeliefert(t *testing.T) {
	srv, _ := testServer(t)
	for _, pfad := range []string{"/static/style.css", "/static/htmx.min.js"} {
		w := hole(t, srv, http.MethodGet, pfad, "")
		if w.Code != http.StatusOK {
			t.Errorf("%s: Status = %d, will 200", pfad, w.Code)
		}
		if w.Body.Len() == 0 {
			t.Errorf("%s: leerer Körper", pfad)
		}
	}
}

func TestUnbekanntePfadeGeben404(t *testing.T) {
	srv, _ := testServer(t)
	if w := hole(t, srv, http.MethodGet, "/gibtsnicht", ""); w.Code != http.StatusNotFound {
		t.Errorf("Status = %d, will 404", w.Code)
	}
}

// Die Schrift wird selbst ausgeliefert, damit die Oberfläche ohne fremden
// Server auskommt. Go kennt .woff2 nicht in seiner eingebauten MIME-Tabelle —
// ohne AddExtensionType ginge die Datei als application/octet-stream hinaus.
func TestSchriftWirdAlsWoff2Ausgeliefert(t *testing.T) {
	srv, _ := testServer(t)

	for _, datei := range []string{"geist-latin.woff2", "geist-latin-ext.woff2"} {
		w := hole(t, srv, http.MethodGet, "/static/"+datei, "")
		if w.Code != http.StatusOK {
			t.Errorf("%s: Status = %d, will 200", datei, w.Code)
			continue
		}
		if ct := w.Header().Get("Content-Type"); ct != "font/woff2" {
			t.Errorf("%s: Content-Type = %q, will font/woff2", datei, ct)
		}
		if got := w.Body.Bytes(); len(got) < 4 || string(got[:4]) != "wOF2" {
			t.Errorf("%s: fängt nicht mit wOF2 an — keine gültige woff2-Datei", datei)
		}
	}
}

// Die SIL Open Font License verlangt, dass Copyright-Hinweis und Lizenztext
// mitgeliefert werden. Ohne diese Datei wäre das Selbsthosting nicht
// lizenzkonform — der Test hält sie fest, damit sie nicht wegoptimiert wird.
func TestSchriftlizenzLiegtBei(t *testing.T) {
	srv, _ := testServer(t)
	w := hole(t, srv, http.MethodGet, "/static/geist-OFL.txt", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d, will 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "SIL Open Font License") {
		t.Error("die beiliegende Datei ist kein OFL-Lizenztext")
	}
}

// inhaltstyp deckt genau die Endungen ab, die Go nicht selbst kennt. Der Test
// ist bewusst unabhängig von der Umgebung: auf diesem Mac liefert Go den
// woff2-Typ über /etc/apache2/mime.types mit, im alpine-Image dieses Projekts
// existiert keine der MIME-Dateien, die Go liest (nachgeprüft). Ein Test, der
// nur die ausgelieferte Antwort betrachtet, würde den Unterschied nicht sehen.
func TestInhaltstypSetztNurWasGoNichtKennt(t *testing.T) {
	faelle := map[string]string{
		"/static/geist-latin.woff2":     "font/woff2",
		"/static/geist-latin-ext.WOFF2": "font/woff2", // Endung ohne Rücksicht auf Groß-/Kleinschreibung
		"/static/style.css":             "",           // kennt Go selbst
		"/static/htmx.min.js":           "",
		"/static/geist-OFL.txt":         "",
	}
	for pfad, will := range faelle {
		if got := inhaltstyp(pfad); got != will {
			t.Errorf("inhaltstyp(%q) = %q, will %q", pfad, got, will)
		}
	}
}

// Die Navigation markiert die aktive Seite, indem die Vorlage .Titel mit der
// Beschriftung vergleicht. Das funktioniert nur, solange beide wörtlich
// übereinstimmen — dieser Test hält genau das fest, für alle vier Seiten.
func TestNavigationMarkiertDieAktiveSeite(t *testing.T) {
	srv, _ := testServer(t)

	for pfad, aktiv := range map[string]string{
		"/":              "Neuer Deal",
		"/historie":      "Historie",
		"/channels":      "Channels",
		"/einstellungen": "Einstellungen",
	} {
		koerper := hole(t, srv, http.MethodGet, pfad, "").Body.String()

		nav := koerper[strings.Index(koerper, "<nav"):strings.Index(koerper, "</nav>")]
		if !strings.Contains(nav, `class="aktiv"`) {
			t.Errorf("%s: keine aktive Seite markiert", pfad)
			continue
		}
		// Genau eine — sonst wäre die Markierung wertlos.
		if n := strings.Count(nav, `class="aktiv"`); n != 1 {
			t.Errorf("%s: %d aktive Einträge, will genau 1", pfad, n)
		}
		if !strings.Contains(nav, `class="aktiv">`+aktiv+`<`) {
			t.Errorf("%s: markiert nicht %q", pfad, aktiv)
		}
	}
}

func TestIconsWerdenAusgeliefert(t *testing.T) {
	srv, _ := testServer(t)
	for pfad, typ := range map[string]string{
		"/favicon.ico":                 "image/x-icon",
		"/static/icon.svg":             "image/svg+xml",
		"/static/apple-touch-icon.png": "image/png",
		"/static/manifest.webmanifest": "application/manifest+json",
	} {
		w := hole(t, srv, http.MethodGet, pfad, "")
		if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), typ) {
			t.Errorf("%s: %d %q", pfad, w.Code, w.Header().Get("Content-Type"))
		}
	}
	if w := hole(t, srv, http.MethodGet, "/historie", ""); !strings.Contains(w.Body.String(), `rel="apple-touch-icon"`) {
		t.Error("Seite verlinkt das Icon nicht")
	}
}
