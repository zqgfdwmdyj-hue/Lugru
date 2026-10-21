package web

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
	"github.com/trinkfreunde/lugru-deal-discord/internal/telegram"
)

// Jeder gepostete Deal geht zusätzlich an einen Telegram-Chat, sobald das
// in den Einstellungen eingeschaltet ist. Discord bleibt dabei der
// eigentliche Post: scheitert Telegram, ist der Deal trotzdem gepostet und
// in der Historie — der Fehler steht dann in den Einstellungen.

type telegramStand struct {
	mu      sync.Mutex
	zuletzt time.Time
	fehler  string
}

// telegramAnzeige ist der Stand für die Einstellungsseite.
type telegramAnzeige struct {
	Zuletzt string
	Fehler  string
	// Chats sind die gefundenen Chats nach "Chat suchen".
	Chats []telegram.Chat
}

func (srv *Server) telegramAnzeige() telegramAnzeige {
	srv.telegram.mu.Lock()
	defer srv.telegram.mu.Unlock()
	a := telegramAnzeige{Fehler: srv.telegram.fehler}
	if !srv.telegram.zuletzt.IsZero() {
		a.Zuletzt = srv.telegram.zuletzt.Local().Format("02.01.2006 15:04")
	}
	return a
}

func (srv *Server) telegramBot() (telegram.Bot, string, bool) {
	token := strings.TrimSpace(srv.store.Einstellung(store.SchluesselTelegramToken))
	chat := strings.TrimSpace(srv.store.Einstellung(store.SchluesselTelegramChat))
	return telegram.Bot{Token: token, BasisURL: srv.telegramBasisURL, HTTP: srv.http}, chat, token != "" && chat != ""
}

// anTelegram schickt den Post im Hintergrund an Telegram — die Antwort an
// den Browser wartet nicht darauf.
func (srv *Server) anTelegram(discordText string, png []byte) {
	if srv.store.Einstellung(store.SchluesselTelegramAktiv) != "1" {
		return
	}
	bot, chat, ok := srv.telegramBot()
	if !ok {
		return
	}
	text, sichtbar := telegram.HTML(discordText)
	go func() {
		ctx, abbruch := context.WithTimeout(context.Background(), 60*time.Second)
		defer abbruch()
		err := bot.Sende(ctx, chat, text, sichtbar, png)
		srv.telegramErgebnis(err)
	}()
}

func (srv *Server) telegramErgebnis(err error) {
	srv.telegram.mu.Lock()
	defer srv.telegram.mu.Unlock()
	if err != nil {
		srv.telegram.fehler = telegramFehlertext(err)
		log.Printf("Telegram: %s", srv.telegram.fehler)
		return
	}
	srv.telegram.zuletzt = time.Now()
	srv.telegram.fehler = ""
}

func telegramFehlertext(err error) string {
	switch {
	case errors.Is(err, telegram.ErrToken):
		return "Telegram lehnt den Bot-Token ab — bitte prüfen."
	case strings.Contains(err.Error(), "chat not found"):
		return "Telegram kennt den Chat nicht — dem Bot einmal schreiben bzw. ihn in die Gruppe holen, dann „Chat suchen“."
	case strings.Contains(err.Error(), "not enough rights") || strings.Contains(err.Error(), "forbidden"):
		return "Der Bot darf in diesem Chat nicht schreiben — in einem Kanal muss er Admin sein."
	}
	return sicherFehlertext(err.Error())
}

// telegramChats sucht die Chats, in denen der Bot zuletzt Nachrichten
// bekommen hat, und bietet sie zur Übernahme an.
func (srv *Server) telegramChats(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	d := srv.einstellungenDaten()
	d.Vorschau = beispielKarte(d.Werte["vorlage"])

	// Den eingetippten Token gleich übernehmen, damit niemand erst
	// speichern muss, bevor er suchen kann.
	if t := strings.TrimSpace(r.PostForm.Get(store.SchluesselTelegramToken)); t != "" {
		_ = srv.store.SetzeEinstellung(store.SchluesselTelegramToken, t)
		d = srv.einstellungenDaten()
		d.Vorschau = beispielKarte(d.Werte["vorlage"])
	}
	bot, _, _ := srv.telegramBot()
	if bot.Token == "" {
		d.Fehler = "Erst den Telegram-Bot-Token eintragen."
		srv.rendere(w, "einstellungen", d)
		return
	}
	chats, err := bot.Chats(r.Context())
	switch {
	case err != nil:
		d.Fehler = telegramFehlertext(err)
	case len(chats) == 0:
		d.Fehler = "Keinen Chat gefunden. Dem Bot in Telegram einmal „Hallo“ schreiben (oder ihn in die Gruppe holen und dort etwas schreiben), dann erneut suchen."
	default:
		d.Telegram.Chats = chats
		d.Meldung = "Chat gefunden — unten übernehmen."
	}
	srv.rendere(w, "einstellungen", d)
}

// telegramTest schickt eine Testnachricht an den eingestellten Chat.
func (srv *Server) telegramTest(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	if id := strings.TrimSpace(r.PostForm.Get("chat_uebernehmen")); id != "" {
		if _, err := strconv.ParseInt(id, 10, 64); err == nil {
			_ = srv.store.SetzeEinstellung(store.SchluesselTelegramChat, id)
		}
	}
	d := srv.einstellungenDaten()
	d.Vorschau = beispielKarte(d.Werte["vorlage"])
	bot, chat, ok := srv.telegramBot()
	if !ok {
		d.Fehler = "Für Telegram fehlen Bot-Token oder Chat."
		srv.rendere(w, "einstellungen", d)
		return
	}
	err := bot.Sende(r.Context(), chat, "✅ Testnachricht aus Lugru Deals — Telegram ist verbunden.", 60, nil)
	srv.telegramErgebnis(err)
	d = srv.einstellungenDaten()
	d.Vorschau = beispielKarte(d.Werte["vorlage"])
	if err != nil {
		d.Fehler = "Test fehlgeschlagen: " + telegramFehlertext(err)
	} else {
		d.Meldung = "Testnachricht an Telegram gesendet."
	}
	srv.rendere(w, "einstellungen", d)
}
