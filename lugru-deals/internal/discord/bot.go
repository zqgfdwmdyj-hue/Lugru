package discord

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Ein Webhook kann schreiben, aber nichts lesen — auch nicht die Reaktionen
// unter den eigenen Posts. Dafür gibt es hier einen Bot: er liest die
// Reaktionen und kann ✅ und ❌ unter einen neuen Post setzen. Er muss dazu
// nicht dauerhaft verbunden sein; alles läuft über Discords REST-API.

// BotBasisURL ist Discords API. Tests ersetzen sie.
const BotBasisURL = "https://discord.com/api/v10"

var (
	// ErrBotToken: Discord kennt den Token nicht (HTTP 401).
	ErrBotToken = errors.New("discord: Bot-Token ungültig")
	// ErrBotRechte: der Bot sieht den Channel nicht oder darf dort nicht
	// lesen bzw. reagieren (HTTP 403, oder 404 für einen unbekannten Channel).
	ErrBotRechte = errors.New("discord: Bot hat keinen Zugriff auf den Channel")
	// ErrKanalWeg: den Channel gibt es in Discord nicht (mehr), oder der Bot
	// ist nicht auf dem Server (Discord-Fehlercode 10003).
	ErrKanalWeg = errors.New("discord: Channel unbekannt")
)

// Bot spricht mit Discord im Namen eines Bot-Kontos.
type Bot struct {
	Token    string
	BasisURL string
	HTTP     *http.Client
}

// Reaktion ist eine Emoji-Reaktion unter einer Nachricht.
type Reaktion struct {
	// Name ist das Emoji selbst ("✅") oder bei einem Server-Emoji dessen
	// Name; ID ist nur bei Server-Emojis gesetzt.
	Name string
	ID   string
	// Anzahl zählt alle, die reagiert haben — den Bot eingeschlossen, wenn
	// Selbst gesetzt ist.
	Anzahl int
	Selbst bool
}

// Reaktionen liest die Reaktionen einer Nachricht.
func (b Bot) Reaktionen(ctx context.Context, kanalID, nachrichtID string) ([]Reaktion, error) {
	antwort, err := b.anfrage(ctx, http.MethodGet,
		"/channels/"+url.PathEscape(kanalID)+"/messages/"+url.PathEscape(nachrichtID))
	if err != nil {
		return nil, err
	}
	var n struct {
		Reactions []struct {
			Count int  `json:"count"`
			Me    bool `json:"me"`
			Emoji struct {
				ID   *string `json:"id"`
				Name string  `json:"name"`
			} `json:"emoji"`
		} `json:"reactions"`
	}
	if err := json.Unmarshal(antwort, &n); err != nil {
		return nil, fmt.Errorf("discord: Nachricht nicht lesbar: %w", err)
	}
	out := make([]Reaktion, 0, len(n.Reactions))
	for _, r := range n.Reactions {
		re := Reaktion{Name: r.Emoji.Name, Anzahl: r.Count, Selbst: r.Me}
		if r.Emoji.ID != nil {
			re.ID = *r.Emoji.ID
		}
		out = append(out, re)
	}
	return out, nil
}

// Reagiere setzt eine Reaktion des Bots unter eine Nachricht.
func (b Bot) Reagiere(ctx context.Context, kanalID, nachrichtID string, e Emoji) error {
	_, err := b.anfrage(ctx, http.MethodPut,
		"/channels/"+url.PathEscape(kanalID)+"/messages/"+url.PathEscape(nachrichtID)+
			"/reactions/"+e.pfad()+"/@me")
	return err
}

// anfrage führt eine Anfrage aus und wartet dabei Discords Rate Limits ab:
// nach einem 429 so lange, wie Discord sagt, und vorbeugend, wenn der
// Eimer leer ist. Beim Abgleich vieler Deals hintereinander ist das der
// Normalfall, kein Fehler.
func (b Bot) anfrage(ctx context.Context, methode, pfad string) ([]byte, error) {
	basis := b.BasisURL
	if basis == "" {
		basis = BotBasisURL
	}
	hc := b.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}

	for versuch := 0; ; versuch++ {
		req, err := http.NewRequestWithContext(ctx, methode, basis+pfad, nil)
		if err != nil {
			return nil, fmt.Errorf("discord: Anfrage nicht baubar: %w", ohneWebhookURL(err))
		}
		req.Header.Set("Authorization", "Bot "+b.Token)
		if methode == http.MethodPut {
			req.ContentLength = 0
		}

		resp, err := hc.Do(req)
		if err != nil {
			return nil, fmt.Errorf("discord: nicht erreichbar: %w", ohneWebhookURL(err))
		}
		antwort, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests && versuch < 3 {
			var r struct {
				RetryAfter float64 `json:"retry_after"`
			}
			warten := time.Second
			if json.Unmarshal(antwort, &r) == nil && r.RetryAfter > 0 {
				warten = time.Duration(r.RetryAfter * float64(time.Second))
			}
			if err := warte(ctx, min(warten, 30*time.Second)); err != nil {
				return nil, err
			}
			continue
		}

		if resp.Header.Get("X-RateLimit-Remaining") == "0" {
			if s, err := strconv.ParseFloat(resp.Header.Get("X-RateLimit-Reset-After"), 64); err == nil && s > 0 {
				if err := warte(ctx, min(time.Duration(s*float64(time.Second)), 30*time.Second)); err != nil {
					return nil, err
				}
			}
		}

		switch {
		case resp.StatusCode == http.StatusUnauthorized:
			return nil, ErrBotToken
		case resp.StatusCode == http.StatusNotFound && discordCode(antwort) == 10008:
			return nil, ErrNachrichtWeg
		case resp.StatusCode == http.StatusNotFound && discordCode(antwort) == 10003:
			return nil, ErrKanalWeg
		case resp.StatusCode == http.StatusForbidden, resp.StatusCode == http.StatusNotFound:
			return nil, fmt.Errorf("%w (HTTP %d)", ErrBotRechte, resp.StatusCode)
		case resp.StatusCode == http.StatusTooManyRequests:
			return nil, ErrRateLimit{Warten: time.Second}
		case resp.StatusCode >= 500:
			return nil, ErrServer{Status: resp.StatusCode}
		case resp.StatusCode < 200 || resp.StatusCode > 299:
			return nil, fmt.Errorf("discord: HTTP %d: %s", resp.StatusCode, antwort)
		}
		return antwort, nil
	}
}

// Emoji ist eine Reaktion, nach der gezählt wird.
type Emoji struct {
	Name string
	// ID ist nur bei einem Server-Emoji gesetzt.
	ID string
}

// EmojiAus liest ein Emoji, wie es in den Einstellungen steht: entweder das
// Zeichen selbst ("✅") oder ein Server-Emoji in Discords Schreibweise
// ("<:gekauft:123456789>", animiert "<a:gekauft:123456789>").
func EmojiAus(eingabe string) Emoji {
	s := strings.TrimSpace(eingabe)
	if strings.HasPrefix(s, "<") && strings.HasSuffix(s, ">") {
		teile := strings.Split(strings.Trim(s, "<>"), ":")
		if len(teile) == 3 {
			return Emoji{Name: teile[1], ID: teile[2]}
		}
	}
	return Emoji{Name: s}
}

// Leer sagt, ob kein Emoji eingestellt ist.
func (e Emoji) Leer() bool { return e.Name == "" }

// Passt sagt, ob eine Reaktion dieses Emoji ist.
func (e Emoji) Passt(r Reaktion) bool {
	if e.ID != "" {
		return r.ID == e.ID
	}
	return r.ID == "" && r.Name == e.Name
}

func (e Emoji) pfad() string {
	if e.ID != "" {
		return url.PathEscape(e.Name + ":" + e.ID)
	}
	return url.PathEscape(e.Name)
}

// Zaehle liefert, wie viele Leute mit dem Emoji reagiert haben — ohne den
// Bot selbst, dessen vorbelegte Reaktion kein Kauf ist.
func Zaehle(reaktionen []Reaktion, e Emoji) int {
	if e.Leer() {
		return 0
	}
	for _, r := range reaktionen {
		if e.Passt(r) {
			n := r.Anzahl
			if r.Selbst {
				n--
			}
			return max(n, 0)
		}
	}
	return 0
}

// WebhookKanal ermittelt den Channel, in den ein Webhook postet. Die
// Webhook-Adresse selbst ist die Berechtigung dafür, ein Token braucht es
// nicht. Postet der Webhook in einen Thread (thread_id in der Adresse), ist
// der Thread der Channel der Nachricht.
func WebhookKanal(ctx context.Context, hc *http.Client, webhookURL string) (string, error) {
	u, err := url.Parse(webhookURL)
	if err != nil {
		return "", fmt.Errorf("discord: Webhook-URL nicht lesbar: %w", ohneWebhookURL(err))
	}
	if t := u.Query().Get("thread_id"); t != "" {
		return t, nil
	}
	u.RawQuery = ""
	antwort, err := schicke(ctx, hc, http.MethodGet, u.String(), "", nil)
	if err != nil {
		return "", err
	}
	var w struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(antwort, &w); err != nil || w.ChannelID == "" {
		return "", errors.New("discord: Webhook nennt keinen Channel")
	}
	return w.ChannelID, nil
}

// VerlaufNachricht ist eine Nachricht aus dem Verlauf eines Channels.
type VerlaufNachricht struct {
	ID     string
	Inhalt string
	Zeit   time.Time
	// AutorID und AutorName sind der Discord-Nutzer; AutorName ist der
	// Anzeigename, sonst der Benutzername. Webhook ist gesetzt, wenn ein
	// Webhook die Nachricht gesendet hat.
	AutorID       string
	AutorName     string
	AutorBenutzer string
	Webhook       bool
	// Anhaenge zählt Bilder und Dateien — eine Nachricht ohne Text, aber
	// mit Anhang, verrät eine fehlende Message-Content-Berechtigung.
	Anhaenge   int
	Reaktionen []Reaktion
}

// Nachrichten liest bis zu 100 Nachrichten eines Channels, die älter sind
// als vor (leer: die jüngsten), die jüngste zuerst.
func (b Bot) Nachrichten(ctx context.Context, kanalID, vor string) ([]VerlaufNachricht, error) {
	pfad := "/channels/" + url.PathEscape(kanalID) + "/messages?limit=100"
	if vor != "" {
		pfad += "&before=" + url.QueryEscape(vor)
	}
	antwort, err := b.anfrage(ctx, http.MethodGet, pfad)
	if err != nil {
		return nil, err
	}
	var roh []struct {
		ID        string `json:"id"`
		Content   string `json:"content"`
		Timestamp string `json:"timestamp"`
		WebhookID string `json:"webhook_id"`
		Author    struct {
			ID         string `json:"id"`
			Username   string `json:"username"`
			GlobalName string `json:"global_name"`
		} `json:"author"`
		Attachments []json.RawMessage `json:"attachments"`
		Reactions   []struct {
			Count int  `json:"count"`
			Me    bool `json:"me"`
			Emoji struct {
				ID   *string `json:"id"`
				Name string  `json:"name"`
			} `json:"emoji"`
		} `json:"reactions"`
	}
	if err := json.Unmarshal(antwort, &roh); err != nil {
		return nil, fmt.Errorf("discord: Nachrichten nicht lesbar: %w", err)
	}
	out := make([]VerlaufNachricht, 0, len(roh))
	for _, n := range roh {
		z, _ := time.Parse(time.RFC3339Nano, n.Timestamp)
		name := n.Author.GlobalName
		if name == "" {
			name = n.Author.Username
		}
		m := VerlaufNachricht{
			ID: n.ID, Inhalt: n.Content, Zeit: z,
			AutorID: n.Author.ID, AutorName: name, AutorBenutzer: n.Author.Username, Webhook: n.WebhookID != "",
			Anhaenge: len(n.Attachments),
		}
		for _, r := range n.Reactions {
			re := Reaktion{Name: r.Emoji.Name, Anzahl: r.Count, Selbst: r.Me}
			if r.Emoji.ID != nil {
				re.ID = *r.Emoji.ID
			}
			m.Reaktionen = append(m.Reaktionen, re)
		}
		out = append(out, m)
	}
	return out, nil
}
