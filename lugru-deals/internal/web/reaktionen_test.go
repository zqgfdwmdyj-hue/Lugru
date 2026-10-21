package web

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// botStub spielt Discords Bot-API: Nachrichten mit Reaktionen lesen und
// Reaktionen setzen.
type botStub struct {
	mu       sync.Mutex
	antwort  string
	gesetzt  []string
	anfragen []string
	srv      *httptest.Server
}

func neuerBotStub(t *testing.T) *botStub {
	b := &botStub{antwort: `{"reactions":[]}`}
	b.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b.mu.Lock()
		defer b.mu.Unlock()
		b.anfragen = append(b.anfragen, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Bot geheim" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodPut {
			b.gesetzt = append(b.gesetzt, r.URL.Path)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		io.WriteString(w, b.antwort)
	}))
	t.Cleanup(b.srv.Close)
	return b
}

func TestReaktionenWerdenGelesenUndVorschlagGezeigt(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	bot := neuerBotStub(t)
	srv.botBasisURL = bot.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselBotToken, "geheim")
	_ = s.SetzeEinstellung(store.SchluesselReaktionVorlegen, "0")

	id := postenMit(t, srv, s, referenzFormular(cid))
	// Der Webhook-Stub nennt keinen channel_id; der Channel wird darum von
	// Hand gesetzt, wie ihn Discords Antwort beim Senden liefern würde.
	_ = s.DealKanalSetzen(id, "777")

	bot.antwort = `{"reactions":[{"count":5,"me":true,"emoji":{"id":null,"name":"✅"}},
		{"count":3,"me":false,"emoji":{"id":null,"name":"❌"}}]}`
	srv.gleicheReaktionenAb(context.Background())

	d, _ := s.Deal(id)
	if d.Kaeufe != 4 || d.NichtVerfuegbar != 3 || d.ReaktionenAm.IsZero() {
		t.Fatalf("Käufe=%d ❌=%d am=%v", d.Kaeufe, d.NichtVerfuegbar, d.ReaktionenAm)
	}
	if st := srv.abgleichStand(); st.Anzahl != 1 || st.Fehler != "" {
		t.Errorf("Stand = %+v", st)
	}

	seite := hole(t, srv, http.MethodGet, "/historie", "").Body.String()
	if !strings.Contains(seite, "✅ 4 · ❌ 3") || !strings.Contains(seite, "wohl ausverkauft?") {
		t.Errorf("Historie ohne Reaktionen oder Vorschlag")
	}
	stat := hole(t, srv, http.MethodGet, "/statistik", "").Body.String()
	if !strings.Contains(stat, "Top-Deals nach Käufen") || !strings.Contains(stat, "Käufe (✅)") {
		t.Errorf("Statistik ohne Käufe")
	}
	// Automatisch markieren ist aus: der Status bleibt.
	if d.Status != store.StatusAktiv {
		t.Errorf("Status = %q ohne Automatik", d.Status)
	}
}

func TestAutomatischAusverkauft(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	bot := neuerBotStub(t)
	srv.botBasisURL = bot.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselBotToken, "geheim")
	_ = s.SetzeEinstellung(store.SchluesselReaktionAuto, "1")
	_ = s.SetzeEinstellung(store.SchluesselReaktionVorlegen, "0")

	id := postenMit(t, srv, s, referenzFormular(cid))
	_ = s.DealKanalSetzen(id, "777")
	bot.antwort = `{"reactions":[{"count":3,"me":false,"emoji":{"id":null,"name":"❌"}}]}`
	srv.gleicheReaktionenAb(context.Background())

	if d, _ := s.Deal(id); d.Status != store.StatusAusverkauft {
		t.Errorf("Status = %q, will ausverkauft", d.Status)
	}
	if dc.methode != http.MethodPatch || !strings.HasPrefix(dc.inhalt, "❌ **AUSVERKAUFT**") {
		t.Errorf("Post nicht geändert: %s %q", dc.methode, dc.inhalt)
	}
}

func TestFalscherTokenWirdGemeldet(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	bot := neuerBotStub(t)
	srv.botBasisURL = bot.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselBotToken, "falsch")
	_ = s.SetzeEinstellung(store.SchluesselReaktionVorlegen, "0")
	id := postenMit(t, srv, s, referenzFormular(cid))
	_ = s.DealKanalSetzen(id, "777")

	srv.gleicheReaktionenAb(context.Background())
	if st := srv.abgleichStand(); !strings.Contains(st.Fehler, "Bot-Token") {
		t.Errorf("Fehler = %q", st.Fehler)
	}
}

func TestReaktionenVorbelegen(t *testing.T) {
	srv, s, _, _ := aufbau(t)
	bot := neuerBotStub(t)
	srv.botBasisURL = bot.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselBotToken, "geheim")

	srv.reaktionenVorbelegen("777", "555", "deals")
	// Läuft im Hintergrund; warten, bis beide gesetzt sind.
	for i := 0; i < 200; i++ {
		bot.mu.Lock()
		n := len(bot.gesetzt)
		bot.mu.Unlock()
		if n == 2 {
			break
		}
		<-timeAfter(10)
	}
	bot.mu.Lock()
	defer bot.mu.Unlock()
	if len(bot.gesetzt) != 2 || !strings.HasSuffix(bot.gesetzt[0], "/@me") ||
		!strings.Contains(bot.gesetzt[0], "/channels/777/messages/555/reactions/") {
		t.Errorf("gesetzt = %v", bot.gesetzt)
	}
}

func TestAbrufenKnopfOhneToken(t *testing.T) {
	srv, _, _, _ := aufbau(t)
	w := hole(t, srv, http.MethodPost, "/reaktionen/abrufen", "seite=statistik")
	if loc := w.Header().Get("Location"); !strings.HasPrefix(loc, "/statistik?fehler=") {
		t.Errorf("Location = %q", loc)
	}
}

func timeAfter(ms int) <-chan time.Time { return time.After(time.Duration(ms) * time.Millisecond) }

// Die Einstellungsseite zeigt die gespeicherten Werte des Bots, und
// Speichern übernimmt auch die beiden Kästchen.
func TestBotEinstellungen(t *testing.T) {
	srv, s := testServer(t)
	seite := hole(t, srv, http.MethodGet, "/einstellungen", "").Body.String()
	if !strings.Contains(seite, `name="reaktion.gekauft" value="✅"`) || !strings.Contains(seite, `name="reaktion.schwelle" value="3"`) {
		t.Errorf("Vorgaben fehlen auf der Seite")
	}
	hole(t, srv, http.MethodPost, "/einstellungen",
		"discord.bot_token=abc&reaktion.felder=1&reaktion.gekauft=%E2%9C%85&reaktion.weg=%E2%9D%8C&reaktion.schwelle=5&reaktion.automatisch=1")
	if s.Einstellung(store.SchluesselBotToken) != "abc" || s.Einstellung(store.SchluesselReaktionAuto) != "1" ||
		s.Einstellung(store.SchluesselReaktionVorlegen) != "0" || s.Einstellung(store.SchluesselReaktionSchwelle) != "5" {
		t.Errorf("nicht gespeichert")
	}
	if seite := hole(t, srv, http.MethodGet, "/einstellungen", "").Body.String(); !strings.Contains(seite, "Jetzt abrufen") {
		t.Errorf("Abgleich-Knopf fehlt bei gesetztem Token")
	}
}

func TestB2BSchonAbEinemKreuzAusverkauft(t *testing.T) {
	srv, s, dc, cid := aufbau(t)
	bot := neuerBotStub(t)
	srv.botBasisURL = bot.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselBotToken, "geheim")
	_ = s.SetzeEinstellung(store.SchluesselReaktionVorlegen, "0")
	_ = s.SetzeEinstellung(store.SchluesselReaktionAuto, "1")
	b2b, _ := s.ChannelAnlegen(store.Channel{Name: "b2b-deals", WebhookURL: dc.srv.URL + "/api/webhooks/2/tok"})

	normal := postenMit(t, srv, s, referenzFormular(cid))
	grosshandel := postenMit(t, srv, s, mitFeld(referenzFormular(b2b), "channel_id", itoa(b2b)))
	_ = s.DealKanalSetzen(normal, "777")
	_ = s.DealKanalSetzen(grosshandel, "778")

	bot.antwort = `{"reactions":[{"count":1,"me":false,"emoji":{"id":null,"name":"❌"}}]}`
	srv.gleicheReaktionenAb(context.Background())

	if d, _ := s.Deal(grosshandel); d.Status != store.StatusAusverkauft {
		t.Errorf("B2B-Deal nach einem ❌: %s", d.Status)
	}
	if d, _ := s.Deal(normal); d.Status != store.StatusAktiv {
		t.Errorf("normaler Deal nach einem ❌: %s", d.Status)
	}
}
