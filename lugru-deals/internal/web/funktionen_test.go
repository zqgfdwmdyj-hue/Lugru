package web

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// discordStub nimmt Senden, Bearbeiten und Löschen entgegen und merkt
// sich die letzte Anfrage.
type discordStub struct {
	mu      sync.Mutex
	methode string
	pfad    string
	inhalt  string
	srv     *httptest.Server
}

func neuerDiscordStub(t *testing.T) *discordStub {
	t.Helper()
	a := &discordStub{}
	a.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roh, _ := io.ReadAll(r.Body)
		a.mu.Lock()
		a.methode, a.pfad = r.Method, r.URL.Path
		if r.Method == http.MethodPatch {
			var p struct {
				Content string `json:"content"`
			}
			_ = json.Unmarshal(roh, &p)
			a.inhalt = p.Content
		} else {
			a.inhalt = string(roh)
		}
		a.mu.Unlock()
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"555"}`)
	}))
	t.Cleanup(a.srv.Close)
	return a
}

// postenMit sendet den Referenz-Deal und liefert seine ID in der Historie.
func postenMit(t *testing.T, srv *Server, s *store.Store, f url.Values) int64 {
	t.Helper()
	w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())
	if w.Code >= 400 {
		t.Fatalf("Senden: %d %s", w.Code, w.Body.String())
	}
	ds, err := s.Deals(store.DealFilter{Limit: 1})
	if err != nil || len(ds) == 0 {
		t.Fatalf("kein Deal gespeichert: %v\n%s", err, w.Body.String())
	}
	return ds[0].ID
}

func aufbau(t *testing.T) (*Server, *store.Store, *discordStub, int64) {
	t.Helper()
	srv, s := testServer(t)
	srv.keepa.BasisURL = keepaServer(t).URL
	dc := neuerDiscordStub(t)
	cid, err := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: dc.srv.URL + "/api/webhooks/1/tok", MentionTyp: "everyone"})
	if err != nil {
		t.Fatal(err)
	}
	return srv, s, dc, cid
}

func TestMaxMengeStehtImPostUndInDerHistorie(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	f := mitFeld(referenzFormular(cid), "max_menge", "3")

	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	if !strings.Contains(vorschau, "Max. 3 Stück pro Bestellung") {
		t.Errorf("Vorschau ohne Cart-Limit:\n%s", vorschau)
	}

	id := postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "Max. 3 Stück pro Bestellung") {
		t.Errorf("gesendeter Post ohne Cart-Limit:\n%s", dc.inhalt)
	}
	if d, _ := s.Deal(id); d.MaxMenge != 3 {
		t.Errorf("MaxMenge in der Historie = %d", d.MaxMenge)
	}
}

func TestUnlesbareMaxMengeWirdGemeldet(t *testing.T) {
	srv, _, _, cid := aufbau(t)
	f := mitFeld(referenzFormular(cid), "max_menge", "drei")
	w := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	if !strings.Contains(w, "keine Stückzahl") {
		t.Errorf("keine Meldung zur Max. Menge:\n%s", w)
	}
}

var entwurfIDMuster = regexp.MustCompile(`name="entwurf_id" value="(\d+)"`)

func TestEntwurfSpeichernOeffnenUndNachDemPostenWeg(t *testing.T) {
	srv, s, _, cid := aufbau(t)

	f := mitFeld(mitFeld(referenzFormular(cid), "entwurf_schritt", "4"), "max_menge", "2")
	antwort := hole(t, srv, http.MethodPost, "/deal/entwurf", f.Encode()).Body.String()
	treffer := entwurfIDMuster.FindStringSubmatch(antwort)
	if treffer == nil || treffer[1] == "0" {
		t.Fatalf("keine Entwurfs-ID in der Antwort:\n%s", antwort)
	}
	id := treffer[1]

	// Ein zweites Speichern mit dieser ID überschreibt denselben Entwurf.
	hole(t, srv, http.MethodPost, "/deal/entwurf", mitFeld(f, "entwurf_id", id).Encode())
	if alle, _ := s.Entwuerfe(); len(alle) != 1 {
		t.Fatalf("%d Entwürfe, will 1", len(alle))
	}

	start := hole(t, srv, http.MethodGet, "/", "").Body.String()
	if !strings.Contains(start, `href="/entwurf/`+id+`"`) || !strings.Contains(start, "Makita HR2630") {
		t.Errorf("Startseite listet den Entwurf nicht:\n%s", start)
	}

	offen := hole(t, srv, http.MethodGet, "/entwurf/"+id, "").Body.String()
	if !strings.Contains(offen, "<html") || !strings.Contains(offen, `<li class="jetzt"><b>4</b>`) {
		t.Errorf("Entwurf öffnet nicht als ganze Seite in Schritt 4:\n%s", offen)
	}
	if !strings.Contains(offen, "Max. 2 Stück") || !strings.Contains(offen, `name="entwurf_id" value="`+id+`"`) {
		t.Errorf("geöffneter Entwurf verlor Werte:\n%s", offen)
	}

	postenMit(t, srv, s, mitFeld(referenzFormular(cid), "entwurf_id", id))
	if alle, _ := s.Entwuerfe(); len(alle) != 0 {
		t.Errorf("Entwurf nach dem Posten noch da: %+v", alle)
	}
}

func TestErneutPostenOeffnetSchritt2MitAltenWerten(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	id := postenMit(t, srv, s, mitFeld(referenzFormular(cid), "max_menge", "4"))

	w := hole(t, srv, http.MethodGet, "/deal/erneut/"+strconv.FormatInt(id, 10), "")
	seite := w.Body.String()
	if !strings.Contains(seite, `<li class="jetzt"><b>2</b>`) {
		t.Fatalf("nicht in Schritt 2:\n%s", seite)
	}
	for _, will := range []string{`name="ek" autofocus value="130,56"`, `value="4" placeholder="z. B. 3"`, "B01636IZ0G"} {
		if !strings.Contains(seite, will) {
			t.Errorf("fehlt: %s", will)
		}
	}
}

func TestAusverkauftVerfuegbarLoeschen(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	id := postenMit(t, srv, s, referenzFormular(cid))
	pfad := "/post/" + strconv.FormatInt(id, 10)
	zurueck := url.Values{"zurueck": {"suche=Makita&status=aktiv"}}.Encode()

	w := hole(t, srv, http.MethodPost, pfad+"/ausverkauft", zurueck)
	if w.Code != http.StatusSeeOther || !strings.HasPrefix(w.Header().Get("Location"), "/historie?") ||
		!strings.Contains(w.Header().Get("Location"), "suche=Makita") {
		t.Errorf("Rücksprung = %d %q", w.Code, w.Header().Get("Location"))
	}
	if dc.methode != http.MethodPatch || dc.pfad != "/api/webhooks/1/tok/messages/555" {
		t.Errorf("Discord-Anfrage = %s %s", dc.methode, dc.pfad)
	}
	if !strings.HasPrefix(dc.inhalt, "❌ **AUSVERKAUFT** ❌\n~~🛒 Makita HR2630 @everyone~~") {
		t.Errorf("bearbeiteter Text:\n%s", dc.inhalt)
	}
	if d, _ := s.Deal(id); d.Status != store.StatusAusverkauft {
		t.Errorf("Status = %q", d.Status)
	}

	hole(t, srv, http.MethodPost, pfad+"/verfuegbar", zurueck)
	d, _ := s.Deal(id)
	if d.Status != store.StatusAktiv || dc.inhalt != d.NachrichtText {
		t.Errorf("nicht wiederhergestellt: Status %q, Text:\n%s", d.Status, dc.inhalt)
	}

	hole(t, srv, http.MethodPost, pfad+"/loeschen", zurueck)
	if dc.methode != http.MethodDelete {
		t.Errorf("Löschen schickte %s", dc.methode)
	}
	if d, _ := s.Deal(id); d.Status != store.StatusGeloescht {
		t.Errorf("Status nach Löschen = %q", d.Status)
	}

	// Ein offener Redirect ist nicht möglich: das Ziel ist immer /historie.
	w = hole(t, srv, http.MethodPost, pfad+"/ausverkauft", "zurueck=//boese.example")
	if loc := w.Header().Get("Location"); !strings.HasPrefix(loc, "/historie?") {
		t.Errorf("Rücksprung nach %q", loc)
	}
}

func TestHistorieFiltertNachMarge(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	postenMit(t, srv, s, referenzFormular(cid)) // Marge 12,9 %

	if seite := hole(t, srv, http.MethodGet, "/historie?marge_min=20", "").Body.String(); !strings.Contains(seite, "0 Deals") {
		t.Errorf("Marge ab 20 zeigt den Deal:\n%s", seite)
	}
	if seite := hole(t, srv, http.MethodGet, "/historie?marge_min=10&marge_max=13", "").Body.String(); !strings.Contains(seite, "1 Deals") {
		t.Errorf("Marge 10–13 zeigt den Deal nicht")
	}
	if seite := hole(t, srv, http.MethodGet, "/historie?marge_min=viel", "").Body.String(); !strings.Contains(seite, "Marge ab ist keine Zahl") {
		t.Errorf("unlesbare Marge nicht gemeldet")
	}
}

func TestStatistikSeite(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	postenMit(t, srv, s, referenzFormular(cid))
	seite := hole(t, srv, http.MethodGet, "/statistik", "").Body.String()
	for _, will := range []string{"Gewinn laut Posts", "26,70 €", "#deals", "Amazon.DE", "Je Monat"} {
		if !strings.Contains(seite, will) {
			t.Errorf("Statistik ohne %q", will)
		}
	}
}

func TestGruppenZuordnenUndStatistikUmschalten(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	postenMit(t, srv, s, referenzFormular(cid))
	zweiter, _ := s.ChannelAnlegen(store.Channel{Name: "server2-deals", WebhookURL: "https://x/2", Gruppe: "Server 2"})
	_ = zweiter

	w := hole(t, srv, http.MethodPost, "/channels/"+strconv.FormatInt(cid, 10)+"/gruppe", "gruppe=Server+1")
	if !strings.Contains(w.Body.String(), "Gruppe gespeichert") {
		t.Fatalf("Zuordnung ohne Meldung:\n%s", w.Body.String())
	}
	if d, _ := s.Deals(store.DealFilter{Limit: 1}); len(d) != 1 || d[0].Gruppe != "Server 1" {
		t.Errorf("Deal nicht mitgewandert: %+v", d)
	}

	alle := hole(t, srv, http.MethodGet, "/statistik", "").Body.String()
	if !strings.Contains(alle, `href="/statistik?gruppe=Server%201&amp;von=`) {
		t.Errorf("Gruppen-Reiter fehlen")
	}
	s1 := hole(t, srv, http.MethodGet, "/statistik?gruppe=Server+1", "").Body.String()
	if !strings.Contains(s1, "<b>1</b>") {
		t.Errorf("Server 1 zeigt den Deal nicht")
	}
	s2 := hole(t, srv, http.MethodGet, "/statistik?gruppe=Server+2", "").Body.String()
	if !strings.Contains(s2, "Im gewählten Zeitraum wurde nichts gepostet") {
		t.Errorf("Server 2 zeigt fremde Deals")
	}
	if h := hole(t, srv, http.MethodGet, "/historie?gruppe=Server+2", "").Body.String(); !strings.Contains(h, "0 Deals") {
		t.Errorf("Historie filtert nicht nach Gruppe")
	}
}

func TestMentionAufRolleUmstellen(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	pfad := "/channels/" + strconv.FormatInt(cid, 10) + "/mention"

	if w := hole(t, srv, http.MethodPost, pfad, "mention_typ=rolle&rollen_id="); !strings.Contains(w.Body.String(), "Rollen-ID Pflicht") {
		t.Errorf("leere Rollen-ID angenommen")
	}
	// Die Schreibweise aus Discord (<@&ID>) wird entpackt.
	hole(t, srv, http.MethodPost, pfad, "mention_typ=rolle&rollen_id=%3C%40%26123456789012345678%3E")
	c, _ := s.Channel(cid)
	if c.MentionTyp != "rolle" || c.RollenID != "123456789012345678" {
		t.Fatalf("Channel = %+v", c)
	}

	postenMit(t, srv, s, referenzFormular(cid))
	if !strings.Contains(dc.inhalt, `Makita HR2630 \u003c@\u0026123456789012345678\u003e\n`) {
		t.Errorf("Post erwähnt die Rolle nicht am Titelende:\n%s", dc.inhalt)
	}
	if !strings.Contains(dc.inhalt, `"roles":["123456789012345678"]`) {
		t.Errorf("allowed_mentions erlaubt die Rolle nicht:\n%s", dc.inhalt)
	}
}

// Ermäßigt rechnet mit 7 % statt 19 % auf der deutschen Verkaufsseite (und
// dem ermäßigten Satz des Einkaufslands) — der Gewinn ändert sich, und der
// Satz wird gespeichert.
func TestErmaessigterSteuersatz(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	normal := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode()).Body.String()
	erm := hole(t, srv, http.MethodPost, "/deal/vorschau", mitFeld(referenzFormular(cid), "steuersatz", "ermaessigt").Encode()).Body.String()
	if !strings.Contains(normal, "Gewinn: 26,70 €") {
		t.Fatalf("normaler Gewinn fehlt")
	}
	if strings.Contains(erm, "Gewinn: 26,70 €") || !strings.Contains(erm, "7 %") {
		t.Errorf("ermäßigt rechnet wie normal")
	}
	id := postenMit(t, srv, s, mitFeld(referenzFormular(cid), "steuersatz", "ermaessigt"))
	if d, _ := s.Deal(id); d.Steuersatz != "ermaessigt" {
		t.Errorf("Steuersatz nicht gespeichert: %q", d.Steuersatz)
	}
}

func TestPosterImPostHistorieUndCookie(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	_ = s.SetzeEinstellung(store.SchluesselPoster, "ludwig=123456789012345678\nk95\nmarkah")

	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", mitFeld(referenzFormular(cid), "poster", "k95").Encode()).Body.String()
	if !strings.Contains(vorschau, "👤 Deal von @k95") || !strings.Contains(vorschau, `<option value="k95" selected>`) {
		t.Errorf("Vorschau ohne Poster")
	}

	w := hole(t, srv, http.MethodPost, "/deal/senden", mitFeld(referenzFormular(cid), "poster", "ludwig").Encode())
	if !strings.Contains(dc.inhalt, `👤 Deal von \u003c@123456789012345678\u003e`) {
		t.Errorf("Post ohne Erwähnung des Posters:\n%s", dc.inhalt)
	}
	if c := w.Header().Get("Set-Cookie"); !strings.Contains(c, "lugru_poster=ludwig") {
		t.Errorf("Cookie = %q", c)
	}
	ds, _ := s.Deals(store.DealFilter{Poster: "ludwig"})
	if len(ds) != 1 || ds[0].Poster != "ludwig" {
		t.Errorf("Poster nicht gespeichert: %+v", ds)
	}

	// Mit Cookie ist der Poster vorausgewählt, auch ohne Feld im Formular.
	r := httptest.NewRequest(http.MethodPost, "/deal/vorschau", strings.NewReader(referenzFormular(cid).Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.AddCookie(&http.Cookie{Name: "lugru_poster", Value: "markah"})
	rw := httptest.NewRecorder()
	srv.Routen().ServeHTTP(rw, r)
	if !strings.Contains(rw.Body.String(), "👤 Deal von @markah") {
		t.Errorf("Cookie nicht als Vorauswahl genutzt")
	}

	// Ein erfundener Name aus dem Browser landet nicht im Post.
	fremd := hole(t, srv, http.MethodPost, "/deal/vorschau", mitFeld(referenzFormular(cid), "poster", "hacker").Encode()).Body.String()
	if strings.Contains(fremd, "hacker") && strings.Contains(fremd, "Deal von") {
		t.Errorf("unbekannter Poster im Post")
	}

	stat := hole(t, srv, http.MethodGet, "/statistik", "").Body.String()
	if !strings.Contains(stat, "Je Poster") || !strings.Contains(stat, "@ludwig") {
		t.Errorf("Statistik ohne Poster-Tabelle")
	}
}

func TestEinkaufOhneLink(t *testing.T) {
	srv, s, dc, cid := aufbau(t)

	// Schritt 1: Haken gesetzt, noch nichts eingetragen — Felder erscheinen.
	w := hole(t, srv, http.MethodPost, "/deal/preis", "ohne_link=1&einkaufslink=")
	if !strings.Contains(w.Body.String(), `name="lieferant"`) || strings.Contains(w.Body.String(), schritt2Kennung) {
		t.Fatalf("Schritt 1 ohne Lieferant-Feld oder schon weiter")
	}
	// Eine ASIN im Linkfeld wird übernommen, das Land ist DE.
	w = hole(t, srv, http.MethodPost, "/deal/preis", "ohne_link=1&einkaufslink=B01636IZ0G")
	if !strings.Contains(w.Body.String(), `value="B01636IZ0G"`) || !strings.Contains(w.Body.String(), "selected>DE</option>") {
		t.Errorf("ASIN oder Land nicht vorbelegt:\n%s", w.Body.String())
	}
	// Mit ASIN, Land und Lieferant geht es zu Schritt 2.
	w = hole(t, srv, http.MethodPost, "/deal/preis", "ohne_link=1&ohne_link_gesehen=1&asin=B01636IZ0G&quellmarkt=DE&lieferant=Metro")
	if !strings.Contains(w.Body.String(), schritt2Kennung) {
		t.Fatalf("nicht in Schritt 2:\n%s", w.Body.String())
	}

	f := referenzFormular(cid)
	f.Set("einkaufslink", "")
	f.Set("quellmarkt", "DE")
	f.Set("ohne_link", "1")
	f.Set("lieferant", "Metro")
	postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "🏬 Metro") || strings.Contains(dc.inhalt, "[Metro]") {
		t.Errorf("Post zeigt den Lieferanten nicht ohne Link:\n%s", dc.inhalt)
	}
	ds, _ := s.Deals(store.DealFilter{})
	if len(ds) != 1 || ds[0].Lieferant != "Metro" || ds[0].QuellURL != "" {
		t.Fatalf("Lieferant nicht gespeichert: %+v", ds)
	}
	if h := hole(t, srv, http.MethodGet, "/historie", "").Body.String(); !strings.Contains(h, "Einkauf bei Metro (ohne Link)") {
		t.Errorf("Historie ohne Lieferant")
	}
	if st := hole(t, srv, http.MethodGet, "/statistik", "").Body.String(); !strings.Contains(st, "Metro") {
		t.Errorf("Statistik ohne Lieferant")
	}
	// Erneut posten landet wieder beim Einkauf ohne Link.
	e := hole(t, srv, http.MethodGet, "/deal/erneut/"+itoa(ds[0].ID), "").Body.String()
	if !strings.Contains(e, `name="ohne_link" value="1"`) || !strings.Contains(e, `value="Metro"`) {
		t.Errorf("Erneut posten verliert den Einkauf ohne Link")
	}

	// Ohne Lieferant heißt er „Großhandel“.
	f.Set("lieferant", "")
	postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "🏬 Großhandel") {
		t.Errorf("Post ohne Vorgabe Großhandel:\n%s", dc.inhalt)
	}
}

func TestStatistikBild(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	if h := hole(t, srv, http.MethodGet, "/statistik/bild", "").Body.String(); !strings.Contains(h, "noch kein Bild") {
		t.Errorf("ohne Deals kein Hinweis")
	}
	postenMit(t, srv, s, referenzFormular(cid))
	if st := hole(t, srv, http.MethodGet, "/statistik", "").Body.String(); !strings.Contains(st, `href="/statistik/bild?`) {
		t.Errorf("Statistik ohne Link zum Bild")
	}
	h := hole(t, srv, http.MethodGet, "/statistik/bild?von=2000-01-01", "").Body.String()
	for _, will := range []string{`<canvas id="bild"`, `"deals":1`, `"top":[{"titel":"Makita HR2630"`, "Januar 2000 – "} {
		if !strings.Contains(h, will) {
			t.Errorf("Bildseite ohne %q", will)
		}
	}
}

func TestB2BChannelsEinstellen(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	b2b, _ := s.ChannelAnlegen(store.Channel{Name: "B2B-Grosshandel", WebhookURL: "https://discord.com/api/webhooks/2/b"})
	h := hole(t, srv, http.MethodGet, "/einstellungen", "").Body.String()
	if !strings.Contains(h, `value="`+itoa(b2b)+`"`+"\n        checked") {
		t.Errorf("B2B-Channel nicht vorausgewählt")
	}
	hole(t, srv, http.MethodPost, "/einstellungen", "statistik.b2b_felder=1&statistik.b2b_channel="+itoa(cid))
	if v := s.Einstellung(store.SchluesselB2BChannels); v != itoa(cid) {
		t.Errorf("gespeichert: %q", v)
	}
	hole(t, srv, http.MethodPost, "/einstellungen", "statistik.b2b_felder=1")
	if v := s.Einstellung(store.SchluesselB2BChannels); v != "" {
		t.Errorf("nichts angehakt gespeichert als %q", v)
	}
}

func TestDealInZweiChannelsPosten(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	b, _ := s.ChannelAnlegen(store.Channel{Name: "deals-b", Gruppe: "Server B", WebhookURL: dc.srv.URL + "/api/webhooks/2/tok",
		MentionTyp: "rolle", RollenID: "1469225443986116610"})

	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode()).Body.String()
	if !strings.Contains(vorschau, `name="channel_weitere" value="`+itoa(b)+`"`) {
		t.Fatalf("Schritt 4 ohne Kästchen für weitere Channels")
	}

	f := referenzFormular(cid)
	f.Add("channel_weitere", itoa(b))
	f.Set("zusatz", "⏳ ETA: 2 Wochen")
	w := hole(t, srv, http.MethodPost, "/deal/senden", f.Encode())
	if w.Header().Get("HX-Refresh") != "true" || !strings.Contains(w.Body.String(), "#deals, #deals-b") {
		t.Fatalf("Antwort: %v %s", w.Header(), w.Body.String())
	}
	// Der zweite Post ging zuletzt raus: mit der Rolle seines Channels.
	if dc.pfad != "/api/webhooks/2/tok" || !strings.Contains(dc.inhalt, `\u003c@\u00261469225443986116610\u003e`) ||
		!strings.Contains(dc.inhalt, "⏳ ETA: 2 Wochen") {
		t.Errorf("zweiter Post: %s %s", dc.pfad, dc.inhalt)
	}
	ds, _ := s.Deals(store.DealFilter{})
	if len(ds) != 2 {
		t.Fatalf("%d Deals in der Historie", len(ds))
	}
	var haupt, zweit store.Deal
	for _, d := range ds {
		if d.ChannelID == cid {
			haupt = d
		} else {
			zweit = d
		}
	}
	if haupt.HauptID != 0 || zweit.HauptID != haupt.ID || zweit.Gruppe != "Server B" {
		t.Errorf("Verknüpfung: haupt=%+v zweit=%+v", haupt.HauptID, zweit)
	}
	st, _ := s.Statistik(time.Time{}, time.Time{}, "")
	if st.Gesamt.Anzahl != 1 {
		t.Errorf("über alle Gruppen %d Deals statt 1", st.Gesamt.Anzahl)
	}
}

func TestASINImPostUndSchonGepostet(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	vorher := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode()).Body.String()
	if strings.Contains(vorher, "schon-gepostet") {
		t.Errorf("Hinweis, obwohl noch nie gepostet")
	}
	postenMit(t, srv, s, referenzFormular(cid))
	if !strings.Contains(dc.inhalt, "🔢 ASIN: B01636IZ0G") {
		t.Errorf("Post ohne ASIN-Zeile:\n%s", dc.inhalt)
	}
	nachher := hole(t, srv, http.MethodPost, "/deal/vorschau", referenzFormular(cid).Encode()).Body.String()
	if !strings.Contains(nachher, "Diese ASIN wurde schon 1× gepostet, zuletzt am") || !strings.Contains(nachher, "in #deals") ||
		!strings.Contains(nachher, `/historie?suche=B01636IZ0G`) {
		t.Errorf("Schritt 4 ohne Hinweis auf den früheren Post")
	}
}

// Ohne Zeitraum in der Adresse zeigt die Statistik den laufenden Monat;
// "Alles" (von und bis leer) zeigt alles.
func TestStatistikStandardDieserMonat(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	alt := time.Now().AddDate(0, -2, 0)
	if _, err := s.DealAnlegen(store.Deal{ASIN: "B000000001", Titel: "Alter Deal", Quellmarkt: "DE", Zielmarkt: "DE",
		GewinnCent: 1000, ChannelID: cid, ChannelName: "deals", Status: store.StatusAktiv, GepostetAm: alt}); err != nil {
		t.Fatal(err)
	}
	monat := hole(t, srv, http.MethodGet, "/statistik", "").Body.String()
	if !strings.Contains(monat, "Im gewählten Zeitraum wurde nichts gepostet") ||
		!strings.Contains(monat, `>Dieser Monat</a>`) || !strings.Contains(monat, `class="aktiv">Dieser Monat`) {
		t.Errorf("Standard ist nicht der laufende Monat")
	}
	alles := hole(t, srv, http.MethodGet, "/statistik?von=&bis=", "").Body.String()
	if strings.Contains(alles, "Im gewählten Zeitraum wurde nichts gepostet") {
		t.Errorf("„Alles“ zeigt den alten Deal nicht")
	}
}

func TestGewinnUndMargeVonHand(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	f := referenzFormular(cid)
	f.Set("gewinn_manuell", "26,65")
	f.Set("marge_manuell", "12,8")
	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	if !strings.Contains(vorschau, "Gewinn: 26,65 € / 12,8 % Marge") {
		t.Errorf("Vorschau ohne Handwerte")
	}
	id := postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "Gewinn: 26,65 € / 12,8 % Marge") {
		t.Errorf("Post ohne Handwerte:\n%s", dc.inhalt)
	}
	if d, _ := s.Deal(id); d.GewinnCent != 2665 || d.MargeProzent != 12.8 {
		t.Errorf("gespeichert: %v / %v", d.GewinnCent, d.MargeProzent)
	}
	f.Set("gewinn_manuell", "viel")
	if h := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String(); !strings.Contains(h, "ist kein Betrag") {
		t.Errorf("kein Fehler bei ungültigem Gewinn")
	}
}

// Nach einer Netto-Eingabe steht der Nettopreis im Post (B2B), mit
// "netto" dabei — außer die Notiz sagt es schon.
func TestNettoEKBleibtImPostNetto(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	f := referenzFormular(cid)
	f.Set("ek", "100,00")
	f.Set("ek_art", "netto")
	f.Set("ek_notiz", "zzgl. Versand")
	postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "EK: 100,00 € netto zzgl. Versand") {
		t.Errorf("Post ohne Nettopreis:\n%s", dc.inhalt)
	}
	f.Set("ek_notiz", "Netto inkl. Versand")
	postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "EK: 100,00 € Netto inkl. Versand") {
		t.Errorf("„netto“ doppelt oder fehlt:\n%s", dc.inhalt)
	}
	f.Set("ek_art", "brutto")
	postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "EK: 100,00 € Netto inkl. Versand") {
		t.Errorf("Brutto-Eingabe verändert:\n%s", dc.inhalt)
	}
}

// Die Handwerte stehen schon in Schritt 3 und kommen von dort in die
// Vorschau.
func TestHandwerteInSchritt3(t *testing.T) {
	srv, _, _, cid := aufbau(t)
	s3 := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode()).Body.String()
	if !strings.Contains(s3, `name="gewinn_manuell"`) || !strings.Contains(s3, `name="marge_manuell"`) {
		t.Fatalf("Schritt 3 ohne Felder für Gewinn/Marge von Hand")
	}
	f := referenzFormular(cid)
	f.Set("gewinn_manuell", "30")
	if v := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String(); !strings.Contains(v, "Gewinn: 30,00 €") ||
		!strings.Contains(v, `name="gewinn_manuell" value="30"`) {
		t.Errorf("Wert aus Schritt 3 fehlt in der Vorschau")
	}
}

func TestSalesMitPlusUndVerkaufsLinie(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	var mu sync.Mutex
	var bilder []string
	keepa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		bilder = append(bilder, r.URL.Query().Get("range")+":"+r.URL.Query().Get("monthlysold"))
		mu.Unlock()
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("\x89PNG\r\n\x1a\nTESTBILD"))
	}))
	t.Cleanup(keepa.Close)
	srv.keepa.BasisURL = keepa.URL

	f := referenzFormular(cid)
	f.Set("sales.DE", "50+")
	f.Set("chart_verkauft", "1")
	vorschau := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String()
	if !strings.Contains(vorschau, "verkauft=1") || !strings.Contains(vorschau, `name="chart_verkauft" value="1"`) {
		t.Errorf("Vorschau ohne Verkaufslinie im Chart oder ohne verborgenes Feld")
	}
	postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "Amazon.DE: 50+ Verkäufe") {
		t.Errorf("Post ohne „50+“:\n%s", dc.inhalt)
	}
	mu.Lock()
	defer mu.Unlock()
	// Je Zeitraum der Preis-Chart und der Verkaufs-Graph als eigene Anfrage.
	if strings.Join(bilder, " ") != "90: 90:1 30: 30:1" {
		t.Errorf("Chart-Abrufe (Tage:monthlysold) = %v, will [90: 90:1 30: 30:1]", bilder)
	}
}

func TestChartsMitVerkaufsGraphUndBeschriftung(t *testing.T) {
	srv, _, _, _ := aufbau(t)
	bild := func(h int, gelb bool) []byte {
		img := image.NewRGBA(image.Rect(0, 0, 800, h))
		draw.Draw(img, img.Bounds(), image.White, image.Point{}, draw.Src)
		if gelb {
			for x := 10; x < 790; x++ {
				img.Set(x, h/2, color.RGBA{0xf6, 0xd5, 0x00, 0xff})
			}
		}
		var buf bytes.Buffer
		_ = png.Encode(&buf, img)
		return buf.Bytes()
	}
	keepa := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if r.URL.Query().Get("monthlysold") == "1" {
			w.Write(bild(157, true))
			return
		}
		w.Write(bild(350, false))
	}))
	t.Cleanup(keepa.Close)
	srv.keepa.BasisURL = keepa.URL

	mit, err := srv.holeCharts(context.Background(), "B01636IZ0G", 3, true)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := png.Decode(bytes.NewReader(mit))
	// Zwei Blöcke: Streifen (30) + Preis (350) + Verkauf (157).
	if h := b.Bounds().Dy(); h != 2*(30+350+157) {
		t.Errorf("Höhe mit Verkaufsgraph = %d", h)
	}
	ohne, _ := srv.holeCharts(context.Background(), "B01636IZ0G", 3, false)
	b, _ = png.Decode(bytes.NewReader(ohne))
	if h := b.Bounds().Dy(); h != 2*(30+350) {
		t.Errorf("Höhe ohne Verkaufsgraph = %d", h)
	}
}

func TestPanEUVonHand(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	f := referenzFormular(cid)
	f.Set("gewinn_paneu_manuell", "7,85")
	f.Set("marge_paneu_manuell", "10,9")
	id := postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "Pan-EU: 7,85 € / 10,9 % Marge") {
		t.Errorf("Post ohne Pan-EU von Hand:\n%s", dc.inhalt)
	}
	ms, _ := s.DealMaerkte([]int64{id})
	if len(ms[id]) == 0 || ms[id][0].PanEU == nil || ms[id][0].PanEU.GewinnCent != 785 || ms[id][0].PanEU.MargeProzent != 10.9 {
		t.Errorf("Pan-EU nicht gespeichert: %+v", ms[id])
	}
	s3 := hole(t, srv, http.MethodPost, "/deal/laden", schritt2Werte().Encode()).Body.String()
	if !strings.Contains(s3, `name="gewinn_paneu_manuell"`) || !strings.Contains(s3, `name="marge_paneu_manuell"`) {
		t.Errorf("Schritt 3 ohne Pan-EU-Felder")
	}
}

func TestWeitereEinkaufslinks(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	s1 := hole(t, srv, http.MethodGet, "/", "").Body.String()
	if strings.Count(s1, `name="weitere_link"`) != 3 {
		t.Errorf("Schritt 1 ohne drei Felder für weitere Links")
	}
	f := referenzFormular(cid)
	f.Add("weitere_link", "https://www.saturn.de/p/123")
	f.Add("weitere_link", "")
	f.Add("weitere_link", "www.mediamarkt.de/p/456")
	postenMit(t, srv, s, f)
	if !strings.Contains(dc.inhalt, "(https://www.amazon.es/dp/B01636IZ0G)\\n🏬 [saturn.de](https://www.saturn.de/p/123)\\n🏬 [mediamarkt.de](https://www.mediamarkt.de/p/456)\\n💰 EK") {
		t.Errorf("weitere Links nicht unter dem ersten:\n%s", dc.inhalt)
	}
	f.Set("weitere_link", "kein link")
	if h := hole(t, srv, http.MethodPost, "/deal/vorschau", f.Encode()).Body.String(); !strings.Contains(h, "ist keine Adresse") {
		t.Errorf("kein Fehler bei ungültigem Link")
	}
}

func TestPostNachtraeglichBearbeiten(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	id := postenMit(t, srv, s, referenzFormular(cid))
	d, _ := s.Deal(id)
	seite := hole(t, srv, http.MethodGet, "/post/"+itoa(id)+"/bearbeiten", "").Body.String()
	if !strings.Contains(seite, "In Discord ändern") || !strings.Contains(seite, "amazon.es/dp/B01636IZ0G") {
		t.Fatalf("Bearbeiten-Seite ohne Text")
	}
	if h := hole(t, srv, http.MethodGet, "/historie", "").Body.String(); !strings.Contains(h, `/post/`+itoa(id)+`/bearbeiten`) {
		t.Errorf("Historie ohne Bearbeiten-Knopf")
	}

	neu := strings.Replace(d.NachrichtText, "[amazon.es](https://www.amazon.es/dp/B01636IZ0G)", "[saturn.de](https://www.saturn.de/p/1)", 1)
	w := hole(t, srv, http.MethodPost, "/post/"+itoa(id)+"/bearbeiten", url.Values{"text": {neu}}.Encode())
	if !strings.Contains(w.Header().Get("Location"), "Post+in+Discord") {
		t.Fatalf("Antwort: %d %s", w.Code, w.Body.String())
	}
	if dc.methode != http.MethodPatch || !strings.Contains(dc.inhalt, "saturn.de/p/1") {
		t.Errorf("Discord nicht geändert: %s %s", dc.methode, dc.inhalt)
	}
	nach, _ := s.Deal(id)
	if nach.NachrichtText != neu || nach.QuellURL != "https://www.saturn.de/p/1" {
		t.Errorf("Historie nicht geändert: %q", nach.QuellURL)
	}

	// Ausverkauft bleibt durchgestrichen.
	_ = s.DealStatusSetzen(id, store.StatusAusverkauft)
	hole(t, srv, http.MethodPost, "/post/"+itoa(id)+"/bearbeiten", url.Values{"text": {neu}}.Encode())
	if !strings.HasPrefix(dc.inhalt, "❌ **AUSVERKAUFT** ❌") {
		t.Errorf("ausverkauft nicht mehr durchgestrichen:\n%s", dc.inhalt)
	}
	// Zu lang wird abgelehnt.
	if h := hole(t, srv, http.MethodPost, "/post/"+itoa(id)+"/bearbeiten", url.Values{"text": {strings.Repeat("x", 2100)}}.Encode()).Body.String(); !strings.Contains(h, "höchstens") {
		t.Errorf("zu langer Text nicht abgelehnt")
	}
}

func TestErneutPostenUebernimmtAlleEingaben(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	f := referenzFormular(cid)
	f.Set("ek", "42,30")
	f.Set("ek_art", "netto")
	f.Set("ek_notiz", "exkl. Prep")
	f.Set("zusatz", "⏳ ETA: 2 Wochen")
	f.Add("weitere_link", "https://www.saturn.de/p/1")
	f.Set("gewinn_manuell", "9,99")
	id := postenMit(t, srv, s, f)

	h := hole(t, srv, http.MethodGet, "/deal/erneut/"+itoa(id), "").Body.String()
	if !regexp.MustCompile(`value="netto"\s*checked`).MatchString(h) {
		t.Errorf("netto nicht gewählt")
	}
	for _, will := range []string{`value="42,30"`, "exkl. Prep", "⏳ ETA: 2 Wochen", "https://www.saturn.de/p/1"} {
		if !strings.Contains(h, will) {
			t.Errorf("erneut posten ohne %q", will)
		}
	}
	if strings.Contains(h, `value="9,99"`) {
		t.Errorf("Gewinn von Hand wurde übernommen")
	}

	// Älterer Deal ohne gespeicherte Eingaben: netto wird zurückgerechnet.
	alt, _ := s.DealAnlegen(store.Deal{ASIN: "B01636IZ0G", Titel: "Alt", Quellmarkt: "DE", Zielmarkt: "DE",
		EKCent: 5034, EKArt: "netto", ChannelID: cid, ChannelName: "deals", Status: store.StatusAktiv})
	h = hole(t, srv, http.MethodGet, "/deal/erneut/"+itoa(alt), "").Body.String()
	if !strings.Contains(h, `value="42,30"`) || !regexp.MustCompile(`value="netto"\s*checked`).MatchString(h) {
		t.Errorf("alter Netto-Deal nicht netto zurückgerechnet")
	}
}

// Erneut posten übernimmt den VK, mit dem der Deal gepostet wurde — auch
// wenn er damals aus Keepa kam und auch für ältere Deals ohne gespeicherte
// Eingaben. Keepa liefert ihn danach nicht neu, die Preise stehen nur zur Wahl.
func TestErneutPostenUebernimmtVorigenVK(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	srv.keepa.Key = "k"
	f := referenzFormular(cid)
	f.Set("vk.DE", "19,80")
	id := postenMit(t, srv, s, f)
	alt, _ := s.DealAnlegen(store.Deal{ASIN: "B01636IZ0G", Titel: "Alt", Quellmarkt: "ES", Zielmarkt: "DE",
		EKCent: 5034, VKCent: 2150, ChannelID: cid, ChannelName: "deals", Status: store.StatusAktiv})

	for deal, will := range map[int64]string{id: "19,80", alt: "21,50"} {
		h := hole(t, srv, http.MethodGet, "/deal/erneut/"+itoa(deal), "").Body.String()
		if !strings.Contains(h, `name="vk.DE" value="`+will+`"`) {
			t.Fatalf("Deal %d: Schritt 2 ohne VK %s", deal, will)
		}
		w := url.Values{}
		for _, m := range regexp.MustCompile(`<input type="hidden" name="([^"]+)" value="([^"]*)"`).FindAllStringSubmatch(h, -1) {
			w.Add(m[1], html.UnescapeString(m[2]))
		}
		w.Set("channel_id", itoa(cid))
		w.Set("zielmarkt", "DE")
		w.Set("ek", "50,34")
		w.Set("ek_art", "brutto")
		h3 := hole(t, srv, http.MethodPost, "/deal/laden", w.Encode()).Body.String()
		if !strings.Contains(h3, `name="vk.DE" value="`+will+`"`) || !strings.Contains(h3, "VK vom letzten Post") {
			t.Errorf("Deal %d: Schritt 3 hat den vorigen VK %s nicht", deal, will)
		}
	}
}

// Bestand / Kauflimit: Schritt 2 bietet den Knopf nur bei Amazon-Einkauf,
// und die Antwort zeigt je Neu-Angebot den Bestand mit Übernahmeknopf.
func TestKauflimitAusKeepa(t *testing.T) {
	srv, _, _, cid := aufbau(t)
	srv.keepa.Key = "k"
	var anfrage string
	ks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		anfrage = r.URL.RawQuery
		w.Write([]byte(`{"tokensLeft": 50, "tokensConsumed": 8, "products": [{"offers": [
 {"sellerId": "A1GANOXEL", "condition": 1, "isFBA": true, "offerCSV": [7100000, 5958, 0], "stockCSV": [7100000, 3]},
 {"sellerId": "A2TEUER", "condition": 1, "offerCSV": [7100000, 7500, 0], "stockCSV": [7100000, 40]}]}]}`))
	}))
	defer ks.Close()
	srv.keepa.BasisURL = ks.URL

	f := referenzFormular(cid)
	f.Set("ek", "59,58")
	h := hole(t, srv, http.MethodPost, "/deal/kauflimit", f.Encode()).Body.String()
	if !strings.Contains(anfrage, "domain=9") || !strings.Contains(anfrage, "stock=1") {
		t.Errorf("Anfrage: %s", anfrage)
	}
	for _, will := range []string{"amazon.es", "59,58 €", "<b>3</b>", "value = '3'", "📊 Bestand: 3 Stück", "dein EK", "/sp?seller=A1GANOXEL", "8 Token"} {
		if !strings.Contains(h, will) {
			t.Errorf("Antwort ohne %q:\n%s", will, h)
		}
	}
	if strings.Count(h, "dein EK") != 1 {
		t.Errorf("nur das Angebot zum EK darf markiert sein")
	}

	// Fremdshop: kein Knopf in Schritt 2, und die Abfrage verweigert.
	f.Set("einkaufslink", "https://www.saturn.de/p/1")
	f.Set("quell_url", "https://www.saturn.de/p/1")
	h = hole(t, srv, http.MethodPost, "/deal/kauflimit", f.Encode()).Body.String()
	if !strings.Contains(h, "Geht nur, wenn bei Amazon eingekauft wird") {
		t.Errorf("Fremdshop nicht abgewiesen:\n%s", h)
	}
}
