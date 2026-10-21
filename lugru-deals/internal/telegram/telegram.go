// Package telegram schickt Deals zusätzlich an einen Telegram-Chat.
//
// Telegram kennt dafür Bots: man legt einen bei @BotFather an, bekommt
// einen Token und kann damit in jeden Chat schreiben, in dem der Bot ist —
// den eigenen Privatchat mit ihm, eine Gruppe oder einen Kanal.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// BasisURL ist Telegrams Bot-API. Tests ersetzen sie.
const BasisURL = "https://api.telegram.org"

// Telegram begrenzt die Bildunterschrift auf 1024 Zeichen sichtbaren Text.
// Wird der Post länger, gehen Bild und Text getrennt hinaus.
const maxUnterschrift = 1024

var ErrToken = errors.New("telegram: Bot-Token ungültig")

type Bot struct {
	Token    string
	BasisURL string
	HTTP     *http.Client
}

// Chat ist ein Chat, in dem der Bot etwas empfangen hat.
type Chat struct {
	ID   int64
	Name string
	Typ  string // "private", "group", "supergroup", "channel"
}

// Sende schickt den Post: mit Chart als Foto samt Bildunterschrift, ohne
// Chart als Textnachricht. textHTML ist schon Telegram-HTML (siehe HTML).
func (b Bot) Sende(ctx context.Context, chatID string, textHTML string, sichtbar int, png []byte) error {
	if len(png) == 0 {
		return b.sendeText(ctx, chatID, textHTML)
	}
	if sichtbar > maxUnterschrift {
		if err := b.sendeFoto(ctx, chatID, png, ""); err != nil {
			return err
		}
		return b.sendeText(ctx, chatID, textHTML)
	}
	return b.sendeFoto(ctx, chatID, png, textHTML)
}

func (b Bot) sendeText(ctx context.Context, chatID, textHTML string) error {
	koerper, _ := json.Marshal(map[string]any{
		"chat_id":    chatID,
		"text":       textHTML,
		"parse_mode": "HTML",
		// Ohne das hängt Telegram unter jeden Deal die Vorschau des ersten
		// Links — meist den Einkaufsshop, nicht den Artikel.
		"link_preview_options": map[string]any{"is_disabled": true},
	})
	_, err := b.anfrage(ctx, "sendMessage", "application/json", koerper)
	return err
}

func (b Bot) sendeFoto(ctx context.Context, chatID string, png []byte, unterschriftHTML string) error {
	var puffer bytes.Buffer
	w := multipart.NewWriter(&puffer)
	_ = w.WriteField("chat_id", chatID)
	if unterschriftHTML != "" {
		_ = w.WriteField("caption", unterschriftHTML)
		_ = w.WriteField("parse_mode", "HTML")
	}
	teil, err := w.CreateFormFile("photo", "chart.png")
	if err != nil {
		return err
	}
	if _, err := teil.Write(png); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	_, err = b.anfrage(ctx, "sendPhoto", w.FormDataContentType(), puffer.Bytes())
	return err
}

// Chats liefert die Chats, in denen der Bot zuletzt Nachrichten bekommen
// hat. So findet sich die Chat-ID, ohne dass jemand sie nachschlagen muss:
// dem Bot einmal schreiben (oder ihn in die Gruppe holen), dann abrufen.
func (b Bot) Chats(ctx context.Context) ([]Chat, error) {
	antwort, err := b.anfrage(ctx, "getUpdates", "application/json", []byte(`{"limit":100}`))
	if err != nil {
		return nil, err
	}
	var updates []map[string]json.RawMessage
	if err := json.Unmarshal(antwort, &updates); err != nil {
		return nil, fmt.Errorf("telegram: Antwort nicht lesbar: %w", err)
	}
	var out []Chat
	gesehen := map[int64]bool{}
	for _, u := range updates {
		for _, feld := range []string{"message", "channel_post", "my_chat_member", "edited_message"} {
			roh, da := u[feld]
			if !da {
				continue
			}
			var m struct {
				Chat struct {
					ID        int64  `json:"id"`
					Type      string `json:"type"`
					Title     string `json:"title"`
					FirstName string `json:"first_name"`
					Username  string `json:"username"`
				} `json:"chat"`
			}
			if json.Unmarshal(roh, &m) != nil || m.Chat.ID == 0 || gesehen[m.Chat.ID] {
				continue
			}
			gesehen[m.Chat.ID] = true
			name := m.Chat.Title
			if name == "" {
				name = strings.TrimSpace(m.Chat.FirstName + " @" + m.Chat.Username)
			}
			out = append(out, Chat{ID: m.Chat.ID, Name: name, Typ: m.Chat.Type})
		}
	}
	return out, nil
}

// anfrage ruft eine Methode der Bot-API auf und liefert deren "result".
//
// Der Token steht in Telegrams Adresse selbst. Fehler dürfen darum nie die
// Adresse zitieren — net/http täte das von sich aus.
func (b Bot) anfrage(ctx context.Context, methode, contentType string, koerper []byte) (json.RawMessage, error) {
	basis := b.BasisURL
	if basis == "" {
		basis = BasisURL
	}
	hc := b.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		basis+"/bot"+b.Token+"/"+methode, bytes.NewReader(koerper))
	if err != nil {
		return nil, errors.New("telegram: Anfrage nicht baubar")
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := hc.Do(req)
	if err != nil {
		var uerr *url.Error
		if errors.As(err, &uerr) && uerr.Err != nil {
			return nil, fmt.Errorf("telegram: nicht erreichbar: %v", uerr.Err)
		}
		return nil, errors.New("telegram: nicht erreichbar")
	}
	defer resp.Body.Close()
	roh, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))

	var a struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
	}
	_ = json.Unmarshal(roh, &a)
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusNotFound:
		return nil, ErrToken
	case !a.OK:
		if a.Description == "" {
			a.Description = "HTTP " + strconv.Itoa(resp.StatusCode)
		}
		return nil, fmt.Errorf("telegram: %s", a.Description)
	}
	return a.Result, nil
}

var (
	linkMuster    = regexp.MustCompile(`\[([^\]]*)\]\(([^)\s]*)\)`)
	fettMuster    = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	durchMuster   = regexp.MustCompile(`~~([^~]+)~~`)
	erwaehnMuster = regexp.MustCompile(`\s*(<@&\d+>|<@!?\d+>|@everyone|@here)`)
	kurzformen    = strings.NewReplacer(":bar_chart:", "📊", ":chart_with_upwards_trend:", "📈")
)

// HTML übersetzt einen Discord-Post in Telegrams HTML und liefert dazu die
// Länge des sichtbaren Textes (für die Grenze der Bildunterschrift).
//
// Die Erwähnung fällt weg: @everyone und Rollen gibt es in Telegram nicht,
// und als bloßer Text stünde da nur "<@&1469…>".
func HTML(discordText string) (string, int) {
	text := erwaehnMuster.ReplaceAllString(discordText, "")
	text = kurzformen.Replace(text)

	var sichtbar strings.Builder
	var b strings.Builder
	rest := text
	for {
		ort := linkMuster.FindStringSubmatchIndex(rest)
		if ort == nil {
			break
		}
		vor := rest[:ort[0]]
		b.WriteString(format(vor))
		sichtbar.WriteString(vor)
		linkText, ziel := rest[ort[2]:ort[3]], rest[ort[4]:ort[5]]
		if strings.HasPrefix(ziel, "http://") || strings.HasPrefix(ziel, "https://") {
			b.WriteString(`<a href="` + html.EscapeString(ziel) + `">` + html.EscapeString(linkText) + `</a>`)
		} else {
			b.WriteString(html.EscapeString(linkText))
		}
		sichtbar.WriteString(linkText)
		rest = rest[ort[1]:]
	}
	b.WriteString(format(rest))
	sichtbar.WriteString(rest)
	return b.String(), len([]rune(sichtbar.String()))
}

// format maskiert Text für HTML und übersetzt Fett und Durchgestrichen.
func format(s string) string {
	s = html.EscapeString(s)
	s = fettMuster.ReplaceAllString(s, "<b>$1</b>")
	s = durchMuster.ReplaceAllString(s, "<s>$1</s>")
	return s
}
