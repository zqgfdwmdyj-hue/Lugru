package web

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/altpost"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Aktionen auf einem schon geposteten Deal: als ausverkauft markieren, die
// Markierung zurücknehmen, den Post löschen. Alle drei gehen über denselben
// Webhook, über den der Post gesendet wurde — ein Webhook darf nur seine
// eigenen Nachrichten bearbeiten.

// markiereAusverkauft streicht den Post in Discord durch und setzt eine
// Zeile darüber. Der Chart bleibt stehen.
func (srv *Server) markiereAusverkauft(w http.ResponseWriter, r *http.Request) {
	srv.postAktion(w, r, store.StatusAusverkauft, "Als ausverkauft markiert.")
}

// markiereVerfuegbar stellt den ursprünglichen Text wieder her.
func (srv *Server) markiereVerfuegbar(w http.ResponseWriter, r *http.Request) {
	srv.postAktion(w, r, store.StatusAktiv, "Wieder als verfügbar markiert.")
}

// loeschePost entfernt den Post aus Discord. Der Deal bleibt in der
// Historie, als gelöscht markiert: dort soll nachlesbar bleiben, was einmal
// hinausging, und die Statistik lässt ihn weg.
func (srv *Server) loeschePost(w http.ResponseWriter, r *http.Request) {
	srv.postAktion(w, r, store.StatusGeloescht, "Post in Discord gelöscht.")
}

// postAktion ist der Rahmen um setzePostStatus für die Knöpfe der
// Historie: zurück zur Historie — mit denselben Filtern, von denen aus
// geklickt wurde — und die Rückmeldung dort anzeigen.
func (srv *Server) postAktion(w http.ResponseWriter, r *http.Request, status, meldung string) {
	_ = r.ParseForm()
	zurueck := historieRuecksprung(r.PostForm.Get("zurueck"))

	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	deal, err := srv.store.Deal(id)
	if err != nil {
		zurueckMit(w, r, zurueck, "fehler", "Deal nicht gefunden.")
		return
	}
	if err := srv.setzePostStatus(r.Context(), deal, status); err != nil {
		zurueckMit(w, r, zurueck, "fehler", err.Error())
		return
	}
	zurueckMit(w, r, zurueck, "meldung", meldung)
}

// setzePostStatus ändert den Post in Discord passend zum neuen Status und
// hält den Status fest. Die Fehler sind fertige Sätze für die Oberfläche.
// Der Abgleich der Reaktionen nutzt denselben Weg, wenn er einen Deal
// selbst als ausverkauft markiert.
func (srv *Server) setzePostStatus(ctx context.Context, deal store.Deal, status string) error {
	if deal.DiscordNachrichtID == "" {
		return errors.New("Zu diesem Deal ist keine Discord-Nachricht bekannt.")
	}
	if deal.Status == store.StatusGeloescht {
		return errors.New("Der Post ist in Discord schon gelöscht.")
	}
	channel, err := srv.store.Channel(deal.ChannelID)
	if err != nil {
		return errors.New("Den Channel #" + deal.ChannelName +
			" gibt es im Programm nicht mehr — ohne seinen Webhook lässt sich der Post nicht ändern.")
	}

	switch status {
	case store.StatusAusverkauft:
		err = discord.Bearbeite(ctx, srv.http, channel.WebhookURL, deal.DiscordNachrichtID,
			ausverkauftText(deal.NachrichtText))
	case store.StatusAktiv:
		err = discord.Bearbeite(ctx, srv.http, channel.WebhookURL, deal.DiscordNachrichtID, deal.NachrichtText)
	case store.StatusGeloescht:
		err = discord.Loesche(ctx, srv.http, channel.WebhookURL, deal.DiscordNachrichtID)
	}

	switch {
	case errors.Is(err, discord.ErrNachrichtWeg):
		// Jemand hat den Post in Discord von Hand gelöscht. Das ist kein
		// Fehler des Programms; die Historie hält es nur fest.
		_ = srv.store.DealStatusSetzen(deal.ID, store.StatusGeloescht)
		return errors.New("Der Post existiert in Discord nicht mehr — in der Historie als gelöscht markiert.")
	case err != nil:
		if errors.Is(err, discord.ErrWebhookTot) {
			_ = srv.store.ChannelDefekt(channel.ID, true)
		}
		return errors.New("Nicht geändert: " + sicherFehlertext(err.Error()))
	}

	if err := srv.store.DealStatusSetzen(deal.ID, status); err != nil {
		return errors.New("In Discord geändert, aber nicht in der Historie gespeichert: " + sicherFehlertext(err.Error()))
	}
	return nil
}

// ausverkauftText ist der Post mit einer Zeile darüber und durchgestrichen.
//
// Zeile für Zeile durchgestrichen: Discord streicht nicht über
// Zeilenumbrüche hinweg. Wird der Text damit länger als Discord erlaubt,
// bleibt er ungestrichen — die Zeile darüber sagt dasselbe.
func ausverkauftText(original string) string {
	const kopf = "❌ **AUSVERKAUFT** ❌\n"
	var b strings.Builder
	b.WriteString(kopf)
	for i, z := range strings.Split(original, "\n") {
		if i > 0 {
			b.WriteString("\n")
		}
		if strings.TrimSpace(z) == "" {
			b.WriteString(z)
			continue
		}
		b.WriteString("~~" + z + "~~")
	}
	if len([]rune(b.String())) <= post.MaxLaenge {
		return b.String()
	}
	text := kopf + original
	if r := []rune(text); len(r) > post.MaxLaenge {
		return string(r[:post.MaxLaenge])
	}
	return text
}

// historieRuecksprung prüft die Filter, mit denen die Historie zuvor
// angezeigt wurde. Sie kommen aus dem Formular zurück und werden darum neu
// zusammengesetzt: übernommen werden nur die bekannten Filterfelder, und das
// Ziel ist immer /historie — nie eine Adresse von außen.
func historieRuecksprung(roh string) url.Values {
	q, _ := url.ParseQuery(roh)
	out := url.Values{}
	for _, k := range historieFilterFelder {
		if v := q.Get(k); v != "" {
			out.Set(k, v)
		}
	}
	return out
}

func zurueckMit(w http.ResponseWriter, r *http.Request, q url.Values, art, text string) {
	q.Set(art, text)
	http.Redirect(w, r, "/historie?"+q.Encode(), http.StatusSeeOther)
}

// postBearbeitenSeite ist die Seite zum nachträglichen Ändern eines Posts.
type postBearbeitenSeite struct {
	Titel     string
	TokenText string
	Fehler    string
	Deal      store.Deal
	Text      string
	Zurueck   string
	MaxLaenge int
}

// zeigePostBearbeiten zeigt den gesendeten Text zum Ändern — etwa wenn ein
// Link falsch war.
func (srv *Server) zeigePostBearbeiten(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	deal, err := srv.store.Deal(id)
	if err != nil {
		srv.fehler(w, http.StatusNotFound, "Deal nicht gefunden.")
		return
	}
	srv.rendere(w, "postbearbeiten", postBearbeitenSeite{
		Titel: "Historie", TokenText: srv.tokenText(), Deal: deal, Text: deal.NachrichtText,
		Zurueck: r.URL.Query().Get("zurueck"), MaxLaenge: post.MaxLaenge,
	})
}

// speicherePostBearbeiten ändert den Post in Discord und in der Historie.
// Ein als ausverkauft markierter Post bleibt durchgestrichen. Niemand wird
// dabei erneut angepingt (siehe discord.Bearbeite).
func (srv *Server) speicherePostBearbeiten(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	deal, err := srv.store.Deal(id)
	if err != nil {
		srv.fehler(w, http.StatusNotFound, "Deal nicht gefunden.")
		return
	}
	text := strings.TrimSpace(strings.ReplaceAll(r.PostForm.Get("text"), "\r\n", "\n"))
	seite := postBearbeitenSeite{Titel: "Historie", TokenText: srv.tokenText(), Deal: deal, Text: text,
		Zurueck: r.PostForm.Get("zurueck"), MaxLaenge: post.MaxLaenge}
	nochmal := func(fehler string) {
		seite.Fehler = fehler
		srv.rendere(w, "postbearbeiten", seite)
	}
	switch {
	case text == "":
		nochmal("Der Post darf nicht leer sein.")
		return
	case len([]rune(text)) > post.MaxLaenge:
		nochmal("Der Text ist " + strconv.Itoa(len([]rune(text))) + " Zeichen lang — Discord erlaubt höchstens " +
			strconv.Itoa(post.MaxLaenge) + ".")
		return
	case deal.DiscordNachrichtID == "":
		nochmal("Zu diesem Deal ist keine Discord-Nachricht bekannt.")
		return
	case deal.Status == store.StatusGeloescht:
		nochmal("Der Post ist in Discord schon gelöscht.")
		return
	}
	channel, err := srv.store.Channel(deal.ChannelID)
	if err != nil {
		nochmal("Den Channel #" + deal.ChannelName + " gibt es im Programm nicht mehr — ohne seinen Webhook lässt sich der Post nicht ändern.")
		return
	}
	inhalt := text
	if deal.Status == store.StatusAusverkauft {
		inhalt = ausverkauftText(text)
	}
	if err := discord.Bearbeite(r.Context(), srv.http, channel.WebhookURL, deal.DiscordNachrichtID, inhalt); err != nil {
		if errors.Is(err, discord.ErrNachrichtWeg) {
			_ = srv.store.DealStatusSetzen(deal.ID, store.StatusGeloescht)
			nochmal("Der Post existiert in Discord nicht mehr — in der Historie als gelöscht markiert.")
			return
		}
		nochmal("Nicht geändert: " + sicherFehlertext(err.Error()))
		return
	}
	// Der Einkaufslink der Historie folgt dem berichtigten Post.
	quell := deal.QuellURL
	if d, ok := altpost.Lies(text); ok {
		quell = d.QuellURL
	}
	if err := srv.store.DealTextSetzen(deal.ID, text, quell); err != nil {
		nochmal("In Discord geändert, aber nicht in der Historie gespeichert: " + sicherFehlertext(err.Error()))
		return
	}
	zurueckMit(w, r, historieRuecksprung(seite.Zurueck), "meldung", "Post in Discord geändert.")
}
