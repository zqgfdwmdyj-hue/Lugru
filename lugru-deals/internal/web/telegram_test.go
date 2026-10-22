package web

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type telegramStub struct {
	mu      sync.Mutex
	pfade   []string
	koerper []string
	srv     *httptest.Server
}

func neuerTelegramStub(t *testing.T) *telegramStub {
	s := &telegramStub{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		roh, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.pfade = append(s.pfade, r.URL.Path)
		s.koerper = append(s.koerper, string(roh))
		s.mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/getUpdates") {
			io.WriteString(w, `{"ok":true,"result":[{"update_id":1,"message":{"chat":{"id":4711,"type":"private","first_name":"Ludwig"}}}]}`)
			return
		}
		io.WriteString(w, `{"ok":true,"result":{}}`)
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func TestDealGehtZusaetzlichAnTelegram(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	tg := neuerTelegramStub(t)
	srv.telegramBasisURL = tg.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselTelegramToken, "123:abc")
	_ = s.SetzeEinstellung(store.SchluesselTelegramChat, "4711")
	_ = s.SetzeEinstellung(store.SchluesselTelegramAktiv, "1")

	postenMit(t, srv, s, referenzFormular(cid))

	// Läuft im Hintergrund.
	var pfade, koerper []string
	for i := 0; i < 200; i++ {
		tg.mu.Lock()
		pfade, koerper = append([]string(nil), tg.pfade...), append([]string(nil), tg.koerper...)
		tg.mu.Unlock()
		if len(pfade) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(pfade) != 1 || pfade[0] != "/bot123:abc/sendPhoto" {
		t.Fatalf("Telegram-Anfragen: %v", pfade)
	}
	for _, will := range []string{"4711", "Makita HR2630", `<a href="https://www.amazon.es/dp/B01636IZ0G">amazon.es</a>`} {
		if !strings.Contains(koerper[0], will) {
			t.Errorf("fehlt %q", will)
		}
	}
	if strings.Contains(koerper[0], "@everyone") {
		t.Errorf("Discord-Erwähnung ging mit an Telegram")
	}
}

func TestTelegramAusSchicktNichts(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	tg := neuerTelegramStub(t)
	srv.telegramBasisURL = tg.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselTelegramToken, "123:abc")
	_ = s.SetzeEinstellung(store.SchluesselTelegramChat, "4711")

	postenMit(t, srv, s, referenzFormular(cid))
	time.Sleep(50 * time.Millisecond)
	tg.mu.Lock()
	defer tg.mu.Unlock()
	if len(tg.pfade) != 0 {
		t.Errorf("ausgeschaltet, trotzdem gesendet: %v", tg.pfade)
	}
}

func TestTelegramChatSuchenUndTesten(t *testing.T) {
	srv, s := testServer(t)
	tg := neuerTelegramStub(t)
	srv.telegramBasisURL = tg.srv.URL

	seite := hole(t, srv, http.MethodPost, "/telegram/chats", "telegram.token=123%3Aabc").Body.String()
	if !strings.Contains(seite, "Ludwig") || !strings.Contains(seite, `value="4711"`) {
		t.Fatalf("gefundener Chat fehlt:\n%s", seite)
	}
	seite = hole(t, srv, http.MethodPost, "/telegram/test", "chat_uebernehmen=4711").Body.String()
	if !strings.Contains(seite, "Testnachricht an Telegram gesendet") {
		t.Errorf("Test ohne Erfolgsmeldung")
	}
	if s.Einstellung(store.SchluesselTelegramChat) != "4711" {
		t.Errorf("Chat nicht übernommen")
	}
}
