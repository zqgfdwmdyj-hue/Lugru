package telegram

import (
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTML(t *testing.T) {
	ein := "🛒 Makita <HR> & Co <@&1469225443986116610>\n" +
		"🏬 [amazon.es](https://www.amazon.es/dp/B0?a=1&b=2)\n" +
		":bar_chart: [ArbitrageOne Export](https://x.example/?q=1)\n" +
		"**fett** und [böse](javascript:alert(1))"
	aus, sichtbar := HTML(ein)
	for _, will := range []string{
		"🛒 Makita &lt;HR&gt; &amp; Co\n",
		`<a href="https://www.amazon.es/dp/B0?a=1&amp;b=2">amazon.es</a>`,
		`📊 <a href="https://x.example/?q=1">ArbitrageOne Export</a>`,
		"<b>fett</b>",
	} {
		if !strings.Contains(aus, will) {
			t.Errorf("fehlt %q in:\n%s", will, aus)
		}
	}
	if strings.Contains(aus, "javascript") || strings.Contains(aus, "1469") {
		t.Errorf("unsicherer Link oder Erwähnung übrig:\n%s", aus)
	}
	if sichtbar > 120 {
		t.Errorf("sichtbar = %d — die Adressen zählen nicht mit", sichtbar)
	}
}

func TestSendeFotoUndText(t *testing.T) {
	var pfade []string
	var unterschrift, chat string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pfade = append(pfade, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/sendPhoto") {
			_, p, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			mr := multipart.NewReader(r.Body, p["boundary"])
			for {
				teil, err := mr.NextPart()
				if err != nil {
					break
				}
				wert, _ := io.ReadAll(teil)
				switch teil.FormName() {
				case "caption":
					unterschrift = string(wert)
				case "chat_id":
					chat = string(wert)
				}
			}
		}
		io.WriteString(w, `{"ok":true,"result":{}}`)
	}))
	defer srv.Close()
	b := Bot{Token: "123:abc", BasisURL: srv.URL, HTTP: srv.Client()}

	if err := b.Sende(context.Background(), "42", "<b>Deal</b>", 4, []byte("png")); err != nil {
		t.Fatal(err)
	}
	if len(pfade) != 1 || pfade[0] != "/bot123:abc/sendPhoto" || unterschrift != "<b>Deal</b>" || chat != "42" {
		t.Errorf("Foto: %v %q %q", pfade, unterschrift, chat)
	}

	pfade = nil
	_ = b.Sende(context.Background(), "42", "lang", 2000, []byte("png"))
	if len(pfade) != 2 || !strings.HasSuffix(pfade[1], "/sendMessage") {
		t.Errorf("zu lange Unterschrift: %v", pfade)
	}
}

func TestChatsUndFehler(t *testing.T) {
	status, antwort := 200, `{"ok":true,"result":[
		{"update_id":1,"message":{"chat":{"id":555,"type":"private","first_name":"Ludwig","username":"lugru"}}},
		{"update_id":2,"my_chat_member":{"chat":{"id":-100777,"type":"channel","title":"Deals"}}},
		{"update_id":3,"message":{"chat":{"id":555,"type":"private"}}}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		io.WriteString(w, antwort)
	}))
	defer srv.Close()
	b := Bot{Token: "t", BasisURL: srv.URL, HTTP: srv.Client()}

	cs, err := b.Chats(context.Background())
	if err != nil || len(cs) != 2 || cs[0].ID != 555 || cs[1].Name != "Deals" {
		t.Errorf("Chats = %+v, %v", cs, err)
	}

	status, antwort = 401, `{"ok":false,"description":"Unauthorized"}`
	if _, err := b.Chats(context.Background()); !errors.Is(err, ErrToken) {
		t.Errorf("401: %v", err)
	}
	status, antwort = 400, `{"ok":false,"description":"Bad Request: chat not found"}`
	err = b.Sende(context.Background(), "1", "x", 1, nil)
	if err == nil || !strings.Contains(err.Error(), "chat not found") || strings.Contains(err.Error(), "bott") {
		t.Errorf("400: %v", err)
	}
}
