// Package discord sendet fertige Deal-Posts an einen Webhook.
package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"
)

// MentionTyp legt fest, wen eine Nachricht anpingen darf.
type MentionTyp string

const (
	MentionKeine    MentionTyp = "keine"
	MentionEveryone MentionTyp = "everyone"
	MentionHere     MentionTyp = "here"
	MentionRolle    MentionTyp = "rolle"
)

var ErrWebhookTot = errors.New("discord: Webhook ungültig oder gelöscht")

// ErrAbgelehnt steht für eine Nachricht, die Discord inhaltlich zurückweist
// (HTTP 400). Anders als ein Serverfehler wird sie durch Wiederholen nicht
// besser.
type ErrAbgelehnt struct{ Antwort string }

func (e ErrAbgelehnt) Error() string { return "discord: HTTP 400: " + e.Antwort }

// ErrKeineNachrichtID zeigt an, dass eine 2xx-Antwort keine brauchbare
// Nachrichten-ID enthielt. Mit wait=true liefert Discord bei Erfolg immer
// das vollständige Nachrichtenobjekt — ein unlesbarer oder leerer Body ist
// also kein stiller Erfolg, sondern ein Fehler. Ein Aufrufer, der nur den
// Fehler prüft, darf einen solchen Versand nie als bestätigt werten.
var ErrKeineNachrichtID = errors.New("discord: Antwort ohne Nachrichten-ID")

// ErrRateLimit trägt die von Discord genannte Wartezeit.
type ErrRateLimit struct{ Warten time.Duration }

func (e ErrRateLimit) Error() string {
	return fmt.Sprintf("discord: zu viele Anfragen, warte %s", e.Warten.Round(time.Millisecond))
}

// ErrServer steht für 5xx — vorübergehend, Wiederholen lohnt sich.
type ErrServer struct{ Status int }

func (e ErrServer) Error() string { return fmt.Sprintf("discord: Serverfehler HTTP %d", e.Status) }

// ohneLinkVorschau ist Discords Nachrichten-Flag SUPPRESS_EMBEDS (1<<2):
// keine Vorschaukästen für die Links im Text (Amazon-Seite, ProfitPath …).
// Sie machten jeden Deal auf dem Handy doppelt so lang und wiederholten nur,
// was der Post schon sagt. Der Chart ist ein Anhang und bleibt sichtbar.
const ohneLinkVorschau = 1 << 2

type Nachricht struct {
	// Inhalt ist der Text des Posts, samt Erwähnung am Ende der Titelzeile.
	Inhalt string

	Mention   MentionTyp
	RollenID  string
	ChartName string
	ChartPNG  []byte
}

type Ergebnis struct {
	NachrichtID string
	// KanalID ist der Channel (oder Thread), in dem die Nachricht steht.
	// Der Bot braucht ihn, um später ihre Reaktionen zu lesen.
	KanalID string
}

// Sende schickt Text und Chart in einer Anfrage.
func Sende(ctx context.Context, hc *http.Client, webhookURL string, n Nachricht) (Ergebnis, error) {
	ziel, err := zielURL(webhookURL, "")
	if err != nil {
		return Ergebnis{}, err
	}
	koerper, contentType, err := baueMultipart(n)
	if err != nil {
		return Ergebnis{}, err
	}
	antwort, err := schicke(ctx, hc, http.MethodPost, ziel, contentType, koerper)
	if err != nil {
		return Ergebnis{}, err
	}
	return nachrichtAus(antwort)
}

// Bearbeite ersetzt den Text einer früher gesendeten Nachricht. Der Chart
// bleibt dabei stehen: Discord behält die Anhänge, solange die Anfrage sie
// nicht nennt.
//
// Niemand wird dabei angepingt. Discord benachrichtigt bei einer Bearbeitung
// ohnehin nicht neu, und allowed_mentions leer hält das auch dann so, wenn
// sich das je ändert.
func Bearbeite(ctx context.Context, hc *http.Client, webhookURL, nachrichtID, inhalt string) error {
	ziel, err := zielURL(webhookURL, nachrichtID)
	if err != nil {
		return err
	}
	koerper, err := json.Marshal(map[string]any{
		"content":          inhalt,
		"allowed_mentions": map[string]any{"parse": []string{}},
		"flags":            ohneLinkVorschau,
	})
	if err != nil {
		return fmt.Errorf("discord: Nutzlast nicht baubar: %w", err)
	}
	antwort, err := schicke(ctx, hc, http.MethodPatch, ziel, "application/json", koerper)
	if err != nil {
		return err
	}
	_, err = nachrichtAus(antwort)
	return err
}

// Loesche entfernt eine früher gesendete Nachricht. Ist sie schon weg
// (HTTP 404 mit Discords Fehlercode für "unbekannte Nachricht"), gilt das
// als Erfolg: das Ziel ist erreicht.
func Loesche(ctx context.Context, hc *http.Client, webhookURL, nachrichtID string) error {
	ziel, err := zielURL(webhookURL, nachrichtID)
	if err != nil {
		return err
	}
	_, err = schicke(ctx, hc, http.MethodDelete, ziel, "", nil)
	var weg errUnbekannteNachricht
	if errors.As(err, &weg) {
		return nil
	}
	return err
}

// errUnbekannteNachricht ist ein 404, bei dem Discord nicht den Webhook,
// sondern die Nachricht nicht kennt (Fehlercode 10008).
type errUnbekannteNachricht struct{}

func (errUnbekannteNachricht) Error() string { return "discord: Nachricht nicht gefunden" }

// ErrNachrichtWeg meldet, dass die Nachricht in Discord nicht mehr existiert
// — etwa weil jemand sie dort von Hand gelöscht hat.
var ErrNachrichtWeg = errors.New("discord: Nachricht existiert nicht mehr")

// schicke führt eine Anfrage aus und übersetzt Discords Antwortcodes in
// die Fehler dieses Pakets.
func schicke(ctx context.Context, hc *http.Client, methode, ziel, contentType string, koerper []byte) ([]byte, error) {
	var body io.Reader
	if koerper != nil {
		body = bytes.NewReader(koerper)
	}
	req, err := http.NewRequestWithContext(ctx, methode, ziel, body)
	if err != nil {
		return nil, fmt.Errorf("discord: Anfrage nicht baubar: %w", ohneWebhookURL(err))
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("discord: nicht erreichbar: %w", ohneWebhookURL(err))
	}
	defer resp.Body.Close()

	antwort, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	switch {
	case resp.StatusCode == http.StatusNotFound && discordCode(antwort) == 10008:
		// Der Webhook lebt, nur die Nachricht ist weg. Das ist kein toter
		// Webhook — der Channel darf dafür nicht als defekt gelten.
		if methode == http.MethodDelete {
			return nil, errUnbekannteNachricht{}
		}
		return nil, ErrNachrichtWeg

	case resp.StatusCode == http.StatusUnauthorized,
		resp.StatusCode == http.StatusForbidden,
		resp.StatusCode == http.StatusNotFound:
		return nil, fmt.Errorf("%w (HTTP %d)", ErrWebhookTot, resp.StatusCode)

	case resp.StatusCode == http.StatusTooManyRequests:
		var r struct {
			RetryAfter float64 `json:"retry_after"`
		}
		// Ein unlesbarer oder unbrauchbarer retry_after darf nicht in einer
		// Wartezeit von 0 enden — sonst wiederholt SendeMitWiederholung
		// sofort, ohne Discord überhaupt eine Pause zu gönnen.
		warten := time.Second
		if err := json.Unmarshal(antwort, &r); err == nil && r.RetryAfter > 0 {
			warten = time.Duration(r.RetryAfter * float64(time.Second))
		}
		return nil, ErrRateLimit{Warten: warten}

	case resp.StatusCode >= 500:
		return nil, ErrServer{Status: resp.StatusCode}

	case resp.StatusCode == http.StatusBadRequest:
		return nil, ErrAbgelehnt{Antwort: string(antwort)}

	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return nil, fmt.Errorf("discord: HTTP %d: %s", resp.StatusCode, antwort)
	}
	return antwort, nil
}

// discordCode liest Discords eigenen Fehlercode aus einer Fehlerantwort, 0
// wenn keiner darin steht.
func discordCode(antwort []byte) int {
	var f struct {
		Code int `json:"code"`
	}
	_ = json.Unmarshal(antwort, &f)
	return f.Code
}

// nachrichtAus liest die Nachrichten-ID aus einer Erfolgsantwort.
func nachrichtAus(antwort []byte) (Ergebnis, error) {
	var nachricht struct {
		ID        string `json:"id"`
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(antwort, &nachricht); err != nil {
		return Ergebnis{}, fmt.Errorf("%w: Antwort nicht lesbar: %v", ErrKeineNachrichtID, err)
	}
	if nachricht.ID == "" {
		return Ergebnis{}, fmt.Errorf("%w: Antwort ohne id-Feld", ErrKeineNachrichtID)
	}
	return Ergebnis{NachrichtID: nachricht.ID, KanalID: nachricht.ChannelID}, nil
}

// SendeMitWiederholung fängt vorübergehende Störungen ab: einmal nach einem
// Rate Limit, zweimal bei Serverfehlern. Ein toter Webhook wird nicht
// wiederholt — der wird durch Warten nicht lebendig.
func SendeMitWiederholung(ctx context.Context, hc *http.Client, webhookURL string, n Nachricht) (Ergebnis, error) {
	var letzter error
	for versuch := 0; versuch < 3; versuch++ {
		erg, err := Sende(ctx, hc, webhookURL, n)
		if err == nil {
			return erg, nil
		}
		letzter = err

		var rl ErrRateLimit
		var se ErrServer
		switch {
		case errors.As(err, &rl):
			if versuch >= 1 {
				return Ergebnis{}, err
			}
			if err := warte(ctx, rl.Warten); err != nil {
				return Ergebnis{}, err
			}
		case errors.As(err, &se):
			if err := warte(ctx, time.Duration(versuch+1)*500*time.Millisecond); err != nil {
				return Ergebnis{}, err
			}
		default:
			return Ergebnis{}, err
		}
	}
	return Ergebnis{}, letzter
}

func warte(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// zielURL hängt die nötigen Query-Parameter an, ohne vorhandene zu verwerfen
// — ein thread_id etwa muss beim Bearbeiten genauso mitgehen wie beim
// Senden.
//
// Ohne nachrichtID ist es die Adresse zum Senden, mit wait=true: ohne dieses
// Flag antwortet Discord mit 204 und ohne Nachrichten-ID, und die Historie
// hätte nichts festzuhalten. Mit nachrichtID ist es die Adresse genau dieser
// Nachricht, zum Bearbeiten oder Löschen.
func zielURL(roh, nachrichtID string) (string, error) {
	u, err := url.Parse(roh)
	if err != nil {
		return "", fmt.Errorf("discord: Webhook-URL nicht lesbar: %w", ohneWebhookURL(err))
	}
	q := u.Query()
	if nachrichtID == "" {
		q.Set("wait", "true")
	} else {
		u.Path = strings.TrimSuffix(u.Path, "/") + "/messages/" + url.PathEscape(nachrichtID)
		u.RawPath = ""
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// ohneWebhookURL liefert die Ursache eines *url.Error, ohne dessen URL.
//
// Die Webhook-URL ist ein Bearer-Token — wer sie kennt, kann in den Channel
// schreiben. Sowohl url.Parse als auch http.Client.Do melden einen Fehler
// als *url.Error, und dessen Error()-Methode zitiert per %q die komplette
// Anfrage- bzw. Parse-URL im Klartext: "parse \"<URL>\": <Grund>" bzw.
// "Get \"<URL>\": <Grund>". Ein fmt.Errorf mit %w auf einen solchen Fehler
// würde diese URL unverändert in die eigene Fehlermeldung übernehmen, ganz
// gleich ob als Ursache direkt sichtbar oder nur über errors.Unwrap
// erreichbar — %w ruft beim Formatieren Error() auf und bekäme exakt diesen
// String zurück.
//
// Das Feld Err dagegen ist die eigentliche Ursache (z. B. "net/url: invalid
// control character in URL" oder ein *net.OpError beim Verbindungsaufbau)
// und nennt laut Dokumentation von net/url und net/http nie die Anfrage-URL
// selbst — nur ggf. den Hostnamen, der für sich genommen kein Geheimnis
// ist. http.Client.Do garantiert laut Dokumentation, dass ein
// zurückgegebener Fehler immer ein *url.Error ist; für den unwahrschein-
// lichen Fall, dass hier trotzdem ein anderer Fehlertyp ankommt, wird auf
// dessen eigene Fehlermeldung zurückgefallen — die Web-Schicht scrubt
// zusätzlich als zweite Verteidigungslinie, falls doch einmal eine URL
// durchrutscht.
func ohneWebhookURL(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) && uerr.Err != nil {
		return uerr.Err
	}
	return err
}

func baueMultipart(n Nachricht) ([]byte, string, error) {
	var puffer bytes.Buffer
	w := multipart.NewWriter(&puffer)

	nutzlast := map[string]any{
		"content":          n.Inhalt,
		"allowed_mentions": erlaubteMentions(n),
		"flags":            ohneLinkVorschau,
	}
	roh, err := json.Marshal(nutzlast)
	if err != nil {
		return nil, "", fmt.Errorf("discord: Nutzlast nicht baubar: %w", err)
	}
	if err := w.WriteField("payload_json", string(roh)); err != nil {
		return nil, "", err
	}

	if len(n.ChartPNG) > 0 {
		name := n.ChartName
		if name == "" {
			name = "chart.png"
		}
		kopf := make(textproto.MIMEHeader)
		kopf.Set("Content-Disposition",
			fmt.Sprintf(`form-data; name="files[0]"; filename=%q`, name))
		kopf.Set("Content-Type", "image/png")

		teil, err := w.CreatePart(kopf)
		if err != nil {
			return nil, "", err
		}
		if _, err := teil.Write(n.ChartPNG); err != nil {
			return nil, "", err
		}
	}

	if err := w.Close(); err != nil {
		return nil, "", err
	}
	return puffer.Bytes(), w.FormDataContentType(), nil
}

// erlaubteMentions begrenzt bei jedem Senden ausdrücklich, wer angepingt wird.
//
// Ohne dieses Feld pingt ein Webhook jeden, dessen Name im Text steht — ein
// Testchannel würde dann den halben Server aufwecken, sobald @everyone in der
// Vorlage steht.
func erlaubteMentions(n Nachricht) map[string]any {
	switch n.Mention {
	case MentionEveryone, MentionHere:
		// Discord kennt für @everyone und @here denselben parse-Wert.
		return map[string]any{"parse": []string{"everyone"}}
	case MentionRolle:
		if n.RollenID == "" {
			// Die Web-Schicht lehnt diese Kombination beim Anlegen eines
			// Channels inzwischen ab (siehe web.speichereChannel), aber
			// ältere, direkt in der Datenbank angelegte Channels können
			// trotzdem hier ankommen. Ohne diese Ausnahme stünde
			// "roles":[""] in der Nutzlast, Discord lehnt die leere
			// Snowflake mit einem nichtssagenden HTTP 400 ab, und die
			// Mention-Begrenzung würde nie sichtbar auf "niemanden"
			// zurückfallen (M9 im Abschluss-Review).
			return map[string]any{"parse": []string{}}
		}
		return map[string]any{"parse": []string{}, "roles": []string{n.RollenID}}
	default:
		return map[string]any{"parse": []string{}}
	}
}
