package discord

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReaktionenZaehlenOhneDenBot(t *testing.T) {
	var auth, pfad string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, pfad = r.Header.Get("Authorization"), r.URL.Path
		io.WriteString(w, `{"id":"5","reactions":[
			{"count":4,"me":true,"emoji":{"id":null,"name":"✅"}},
			{"count":2,"me":false,"emoji":{"id":null,"name":"❌"}},
			{"count":7,"me":false,"emoji":{"id":"99","name":"gekauft"}}]}`)
	}))
	defer srv.Close()

	b := Bot{Token: "geheim", BasisURL: srv.URL, HTTP: srv.Client()}
	rs, err := b.Reaktionen(context.Background(), "11", "5")
	if err != nil {
		t.Fatal(err)
	}
	if auth != "Bot geheim" || pfad != "/channels/11/messages/5" {
		t.Errorf("Anfrage: %q %q", auth, pfad)
	}
	if n := Zaehle(rs, EmojiAus("✅")); n != 3 {
		t.Errorf("✅ = %d, will 3 (ohne den Bot)", n)
	}
	if n := Zaehle(rs, EmojiAus("❌")); n != 2 {
		t.Errorf("❌ = %d, will 2", n)
	}
	if n := Zaehle(rs, EmojiAus("<:gekauft:99>")); n != 7 {
		t.Errorf("Server-Emoji = %d, will 7", n)
	}
	if n := Zaehle(rs, EmojiAus("👍")); n != 0 {
		t.Errorf("fehlendes Emoji = %d", n)
	}
}

func TestReagiereUndFehler(t *testing.T) {
	status := http.StatusNoContent
	var methode, pfad string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methode, pfad = r.Method, r.URL.EscapedPath()
		w.WriteHeader(status)
	}))
	defer srv.Close()
	b := Bot{Token: "x", BasisURL: srv.URL, HTTP: srv.Client()}

	if err := b.Reagiere(context.Background(), "11", "5", EmojiAus("✅")); err != nil {
		t.Fatal(err)
	}
	if methode != http.MethodPut || pfad != "/channels/11/messages/5/reactions/%E2%9C%85/@me" {
		t.Errorf("Anfrage = %s %s", methode, pfad)
	}

	status = http.StatusUnauthorized
	if _, err := b.Reaktionen(context.Background(), "1", "2"); !errors.Is(err, ErrBotToken) {
		t.Errorf("401: %v", err)
	}
	status = http.StatusForbidden
	if _, err := b.Reaktionen(context.Background(), "1", "2"); !errors.Is(err, ErrBotRechte) {
		t.Errorf("403: %v", err)
	}
}

func TestWebhookKanal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"id":"1","channel_id":"777"}`)
	}))
	defer srv.Close()

	k, err := WebhookKanal(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/tok")
	if err != nil || k != "777" {
		t.Errorf("Kanal = %q, %v", k, err)
	}
	k, _ = WebhookKanal(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/tok?thread_id=888")
	if k != "888" {
		t.Errorf("Thread = %q", k)
	}
}
