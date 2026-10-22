package web

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func tagFormular() url.Values {
	return url.Values{
		"name":   {"Hauptkonto DE"},
		"tag":    {"lugru-21"},
		"markt":  {"DE"},
		"id":     {""},
		"anlass": {""},
	}
}

func TestTagSeiteZeigtAngelegteTags(t *testing.T) {
	srv, s := testServer(t)
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-21", "DE", true)

	w := hole(t, srv, http.MethodGet, "/tags", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d", w.Code)
	}
	koerper := w.Body.String()
	for _, muss := range []string{"Hauptkonto DE", "lugru-21", "DE"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Seite enthält %q nicht:\n%s", muss, koerper)
		}
	}
}

func TestTagAnlegenUeberDasFormular(t *testing.T) {
	srv, s := testServer(t)

	w := hole(t, srv, http.MethodPost, "/tags", tagFormular().Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	alle, _ := s.Tags()
	if len(alle) != 1 {
		t.Fatalf("%d Tags gespeichert, will 1", len(alle))
	}
	if alle[0].Name != "Hauptkonto DE" || alle[0].Tag != "lugru-21" || alle[0].Markt != "DE" {
		t.Errorf("gespeichert: %+v", alle[0])
	}
}

// Das Häkchen im Anlege-Formular muss den Standard gleich mitsetzen — sonst
// wären es zwei Schritte für den Regelfall.
func TestTagAnlegenMitHaekchenSetztDenStandard(t *testing.T) {
	srv, s := testServer(t)

	f := tagFormular()
	f.Set("standard", "1")
	hole(t, srv, http.MethodPost, "/tags", f.Encode())

	got, ok := s.StandardTag("DE")
	if !ok {
		t.Fatal("kein Standard für DE gesetzt")
	}
	if got.Tag != "lugru-21" {
		t.Errorf("Standard = %q, will lugru-21", got.Tag)
	}
}

func TestTagFormularWeistUngueltigesZurueck(t *testing.T) {
	faelle := []struct {
		name    string
		aendern func(url.Values)
		meldung string
	}{
		{"ohne Name", func(v url.Values) { v.Set("name", "") }, "Pflicht"},
		{"ohne Tag", func(v url.Values) { v.Set("tag", "") }, "Pflicht"},
		{"Tag mit Leerzeichen", func(v url.Values) { v.Set("tag", "lugru 21") }, "Buchstaben"},
		{"Tag mit Klammer", func(v url.Values) { v.Set("tag", "lugru)-21") }, "Buchstaben"},
		{"Tag mit kaufmännischem Und", func(v url.Values) { v.Set("tag", "a&b") }, "Buchstaben"},
		{"unbekannter Markt", func(v url.Values) { v.Set("markt", "UK") }, "Marktplatz"},
	}
	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			srv, s := testServer(t)
			v := tagFormular()
			f.aendern(v)

			w := hole(t, srv, http.MethodPost, "/tags", v.Encode())
			if !strings.Contains(w.Body.String(), f.meldung) {
				t.Errorf("Meldung enthält %q nicht:\n%s", f.meldung, w.Body.String())
			}
			if alle, _ := s.Tags(); len(alle) != 0 {
				t.Errorf("trotz Ablehnung gespeichert: %+v", alle)
			}
		})
	}
}

func TestTagAendernUeberDasFormular(t *testing.T) {
	srv, s := testServer(t)
	id := tagAnlegen(t, s, "Hauptkonto DE", "lugru-21", "DE", false)

	f := tagFormular()
	f.Set("id", itoa(id))
	f.Set("name", "Zweitkonto DE")
	f.Set("tag", "zweit-21")
	hole(t, srv, http.MethodPost, "/tags", f.Encode())

	got, _ := s.Tag(id)
	if got.Name != "Zweitkonto DE" || got.Tag != "zweit-21" {
		t.Errorf("nach Ändern: %+v", got)
	}
	if alle, _ := s.Tags(); len(alle) != 1 {
		t.Errorf("%d Tags, will 1 — Ändern hat einen zweiten angelegt", len(alle))
	}
}

func TestTagStandardUeberDieRoute(t *testing.T) {
	srv, s := testServer(t)
	erst := tagAnlegen(t, s, "Erst", "erst-21", "DE", true)
	zweit := tagAnlegen(t, s, "Zweit", "zweit-21", "DE", false)

	w := hole(t, srv, http.MethodPost, "/tags/"+itoa(zweit)+"/standard", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}

	got, ok := s.StandardTag("DE")
	if !ok || got.ID != zweit {
		t.Errorf("StandardTag(DE) = %+v, will ID %d", got, zweit)
	}
	if alt, _ := s.Tag(erst); alt.Standard {
		t.Error("der bisherige Standard trägt das Häkchen noch")
	}
}

func TestTagLoeschenUeberDieRoute(t *testing.T) {
	srv, s := testServer(t)
	id := tagAnlegen(t, s, "Weg damit", "weg-21", "DE", true)

	w := hole(t, srv, http.MethodPost, "/tags/"+itoa(id)+"/loeschen", "")
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	if alle, _ := s.Tags(); len(alle) != 0 {
		t.Errorf("%d Tags übrig, will 0", len(alle))
	}
}

// Der Nav-Punkt wird über den Seitentitel aktiv gesetzt (siehe layout.html).
// Weicht der Titel ab, ist der Punkt nie hervorgehoben.
func TestTagSeiteHeisstTags(t *testing.T) {
	srv, _ := testServer(t)
	koerper := hole(t, srv, http.MethodGet, "/tags", "").Body.String()

	if !strings.Contains(koerper, `href="/tags"`) {
		t.Errorf("Nav-Punkt /tags fehlt:\n%s", koerper)
	}
	if !strings.Contains(koerper, "<title>Tags · Lugru Deals</title>") {
		t.Errorf("Seitentitel ist nicht „Tags\":\n%s", koerper)
	}
}

// Ein gelöschter Standard-Tag hinterlässt einen Markt ohne Standard. Der
// Funnel muss das aushalten und seinen Hinweis zeigen, statt zu scheitern.
func TestFunnelUeberlebtMarktOhneStandardTag(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	id := tagAnlegen(t, s, "Hauptkonto DE", "lugru-21", "DE", true)
	if err := s.TagLoeschen(id); err != nil {
		t.Fatalf("TagLoeschen: %v", err)
	}

	koerper := vorschau(t, srv, referenzFormular(cid))
	if !strings.Contains(koerper, "ohne Affiliate-Tag") {
		t.Errorf("Hinweis fehlt, obwohl der Markt keinen Standard mehr hat:\n%s", koerper)
	}
	if !strings.Contains(koerper, "https://www.amazon.de/dp/B01636IZ0G") {
		t.Errorf("Verkaufslink fehlt ganz:\n%s", koerper)
	}
}
