package web

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Die Reaktionen unter den Posts (✅ gekauft, ❌ nicht mehr verfügbar) sind
// die einzige Rückmeldung darüber, was aus einem Deal geworden ist. Ein Bot
// liest sie regelmäßig im Hintergrund; ohne Bot-Token geschieht nichts.

const (
	// abgleichAlle ist der Abstand zwischen zwei Abgleichen aller Posts der
	// letzten abgleichTage.
	abgleichAlle = 30 * time.Minute
	// abgleichFrischAlle ist der Abstand für frische Posts (die letzten
	// abgleichFrischStunden): dort reagieren die Leute, und ein ❌ soll
	// nicht eine halbe Stunde lang unbeachtet bleiben.
	abgleichFrischAlle    = 2 * time.Minute
	abgleichFrischStunden = 48
	// abgleichTage begrenzt den Abgleich auf jüngere Posts: auf einen
	// Wochen alten Deal reagiert kaum noch jemand, und jeder Post ist eine
	// Anfrage bei Discord.
	abgleichTage = 30
	// abgleichHoechstens begrenzt die Posts je Durchgang.
	abgleichHoechstens = 300
)

// abgleich ist der Zustand des Hintergrund-Abgleichs.
type abgleich struct {
	mu      sync.Mutex
	laeuft  bool
	zuletzt time.Time
	fehler  string
	anzahl  int

	// anstoss weckt den Abgleich außer der Reihe (Knopf "Jetzt abrufen").
	anstoss chan struct{}
}

// abgleichStand ist der Zustand für die Anzeige.
type abgleichStand struct {
	Aktiv   bool // ein Bot-Token ist hinterlegt
	Laeuft  bool
	Zuletzt string
	Anzahl  int
	Fehler  string
	// Seite ist die Seite, auf die der Knopf "Jetzt abrufen" zurückführt.
	Seite string
}

// MitSeite setzt die Rückkehrseite — für die Vorlage, die keine Felder
// zuweisen kann.
func (a abgleichStand) MitSeite(seite string) abgleichStand {
	a.Seite = seite
	return a
}

func (srv *Server) abgleichStand() abgleichStand {
	srv.reaktionen.mu.Lock()
	defer srv.reaktionen.mu.Unlock()
	st := abgleichStand{
		Aktiv:  srv.store.Einstellung(store.SchluesselBotToken) != "",
		Laeuft: srv.reaktionen.laeuft,
		Anzahl: srv.reaktionen.anzahl,
		Fehler: srv.reaktionen.fehler,
	}
	if !srv.reaktionen.zuletzt.IsZero() {
		st.Zuletzt = srv.reaktionen.zuletzt.Local().Format("02.01.2006 15:04")
	}
	return st
}

// StarteReaktionsAbgleich lässt den Abgleich im Hintergrund laufen, bis ctx
// endet: kurz nach dem Start, dann alle abgleichAlle und auf Anstoß.
func (srv *Server) StarteReaktionsAbgleich(ctx context.Context) {
	go func() {
		erster := time.NewTimer(time.Minute)
		defer erster.Stop()
		takt := time.NewTicker(abgleichAlle)
		defer takt.Stop()
		frisch := time.NewTicker(abgleichFrischAlle)
		defer frisch.Stop()
		for {
			seit := time.Now().AddDate(0, 0, -abgleichTage)
			select {
			case <-ctx.Done():
				return
			case <-erster.C:
			case <-takt.C:
			case <-srv.reaktionen.anstoss:
			case <-frisch.C:
				seit = time.Now().Add(-abgleichFrischStunden * time.Hour)
			}
			srv.gleicheReaktionenAbSeit(ctx, seit)
		}
	}()
}

// stosseAbgleichAn weckt den Abgleich, ohne zu warten. Läuft er gerade
// oder ist schon einer angestoßen, geschieht nichts weiter.
func (srv *Server) stosseAbgleichAn() {
	select {
	case srv.reaktionen.anstoss <- struct{}{}:
	default:
	}
}

// reaktionenAbrufen ist der Knopf "Reaktionen jetzt abrufen". Der Abgleich
// läuft im Hintergrund — bei vielen Posts wartet er auf Discords Rate
// Limits, und so lange soll keine Seite hängen.
func (srv *Server) reaktionenAbrufen(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	ziel := "/historie"
	switch r.PostForm.Get("seite") {
	case "statistik":
		ziel = "/statistik"
	case "einstellungen":
		ziel = "/einstellungen"
	}
	if srv.store.Einstellung(store.SchluesselBotToken) == "" {
		http.Redirect(w, r, ziel+"?fehler="+urlText("Kein Bot-Token hinterlegt — siehe Einstellungen."), http.StatusSeeOther)
		return
	}
	srv.stosseAbgleichAn()
	http.Redirect(w, r, ziel+"?meldung="+urlText("Reaktionen werden abgerufen — die Seite in einer Minute neu laden."), http.StatusSeeOther)
}

// gleicheReaktionenAb liest die Reaktionen aller Posts der letzten
// abgleichTage.
func (srv *Server) gleicheReaktionenAb(ctx context.Context) {
	srv.gleicheReaktionenAbSeit(ctx, time.Now().AddDate(0, 0, -abgleichTage))
}

// gleicheReaktionenAbSeit liest die Reaktionen der Posts seit einem Zeitpunkt.
func (srv *Server) gleicheReaktionenAbSeit(ctx context.Context, seit time.Time) {
	token := srv.store.Einstellung(store.SchluesselBotToken)
	if token == "" {
		return
	}
	srv.reaktionen.mu.Lock()
	if srv.reaktionen.laeuft {
		srv.reaktionen.mu.Unlock()
		return
	}
	srv.reaktionen.laeuft = true
	srv.reaktionen.mu.Unlock()

	anzahl, fehler := srv.abgleichDurchgang(ctx, token, seit)

	srv.reaktionen.mu.Lock()
	srv.reaktionen.laeuft = false
	srv.reaktionen.zuletzt = time.Now()
	srv.reaktionen.anzahl = anzahl
	srv.reaktionen.fehler = fehler
	srv.reaktionen.mu.Unlock()
	if fehler != "" {
		log.Printf("Reaktionen: %s", fehler)
	}
	// Neue Reaktionszahlen gleich ans Seller-System.
	if anzahl > 0 {
		srv.stosseSellerAn()
	}
}

// abgleichDurchgang liefert, bei wie vielen Posts die Reaktionen gelesen
// wurden, und einen Fehlertext für die Anzeige (leer, wenn alles ging).
func (srv *Server) abgleichDurchgang(ctx context.Context, token string, seit time.Time) (int, string) {
	bot := srv.bot(token)
	gekauft := discord.EmojiAus(srv.store.Einstellung(store.SchluesselReaktionGekauft))
	weg := discord.EmojiAus(srv.store.Einstellung(store.SchluesselReaktionWeg))
	schwelleFuer := srv.ausverkauftSchwelle()
	automatisch := srv.store.Einstellung(store.SchluesselReaktionAuto) == "1"

	deals, err := srv.store.DealsFuerAbgleich(seit, abgleichHoechstens)
	if err != nil {
		return 0, "Posts nicht lesbar: " + sicherFehlertext(err.Error())
	}

	// Je Channel des Programms einmal der Discord-Channel, falls ein alter
	// Deal ihn nicht selbst kennt; und die Channels, die der Bot nicht sehen
	// darf — deren übrige Posts werden gar nicht erst gefragt.
	kanalVon := map[int64]string{}
	gesperrt := map[string]bool{}
	var probleme []string
	gelesen := 0

	for _, d := range deals {
		if ctx.Err() != nil {
			break
		}
		kanal := d.DiscordKanalID
		if kanal == "" {
			kanal = kanalVon[d.ChannelID]
			if kanal == "" {
				c, err := srv.store.Channel(d.ChannelID)
				if err != nil {
					continue
				}
				if kanal, err = discord.WebhookKanal(ctx, srv.http, c.WebhookURL); err != nil {
					continue
				}
				kanalVon[d.ChannelID] = kanal
			}
			_ = srv.store.DealKanalSetzen(d.ID, kanal)
		}
		if gesperrt[kanal] {
			continue
		}

		rs, err := bot.Reaktionen(ctx, kanal, d.DiscordNachrichtID)
		switch {
		case errors.Is(err, discord.ErrBotToken):
			return gelesen, "Der Bot-Token wird von Discord abgelehnt — bitte in den Einstellungen prüfen."
		case errors.Is(err, discord.ErrBotRechte):
			gesperrt[kanal] = true
			probleme = append(probleme, "kein Zugriff auf #"+d.ChannelName+
				" (dem Bot fehlt dort „Kanäle ansehen“ oder „Nachrichtenverlauf lesen“)")
			continue
		case errors.Is(err, discord.ErrKanalWeg):
			gesperrt[kanal] = true
			probleme = append(probleme, "#"+d.ChannelName+
				" findet der Bot nicht — Channel in Discord gelöscht oder Bot nicht auf diesem Server")
			continue
		case errors.Is(err, discord.ErrNachrichtWeg):
			_ = srv.store.DealStatusSetzen(d.ID, store.StatusGeloescht)
			continue
		case err != nil:
			probleme = append(probleme, sicherFehlertext(err.Error()))
			continue
		}

		kaeufe, nv := discord.Zaehle(rs, gekauft), discord.Zaehle(rs, weg)
		_ = srv.store.DealReaktionenSetzen(d.ID, kaeufe, nv, time.Now())
		gelesen++

		grenze := schwelleFuer(d.ChannelID)
		if automatisch && grenze > 0 && nv >= grenze && d.Status == store.StatusAktiv {
			if err := srv.setzePostStatus(ctx, d, store.StatusAusverkauft); err != nil {
				probleme = append(probleme, d.ASIN+": "+err.Error())
			}
		}
	}

	return gelesen, strings.Join(eindeutig(probleme), " · ")
}

// reaktionenVorbelegen setzt ✅ und ❌ unter einen frisch gesendeten Post,
// damit jeder nur noch draufdrücken muss. Die Reaktion des Bots selbst zählt
// später nicht mit (siehe discord.Zaehle).
//
// Läuft im Hintergrund: der Post ist schon draußen, und ein langsamer oder
// fehlender Bot darf die Bestätigung nicht aufhalten.
//
// channelName steht nur in der Fehlermeldung — damit klar ist, in welchem
// Channel dem Bot ein Recht fehlt.
func (srv *Server) reaktionenVorbelegen(kanal, nachricht, channelName string) {
	token := srv.store.Einstellung(store.SchluesselBotToken)
	if token == "" || kanal == "" || nachricht == "" ||
		srv.store.Einstellung(store.SchluesselReaktionVorlegen) != "1" {
		return
	}
	bot := srv.bot(token)
	go func() {
		ctx, abbruch := context.WithTimeout(context.Background(), 30*time.Second)
		defer abbruch()
		for _, s := range []string{store.SchluesselReaktionGekauft, store.SchluesselReaktionWeg} {
			e := discord.EmojiAus(srv.store.Einstellung(s))
			if e.Leer() {
				continue
			}
			if err := bot.Reagiere(ctx, kanal, nachricht, e); err != nil {
				srv.reaktionen.mu.Lock()
				grund := sicherFehlertext(err.Error())
				if errors.Is(err, discord.ErrBotRechte) {
					// Der Bot sieht den Channel (sonst käme er hier gar nicht
					// hin), darf dort aber keine neuen Reaktionen setzen —
					// typisch, wenn der Channel das für @everyone sperrt.
					grund = "dem Bot fehlt dort das Recht „Reaktionen hinzufügen“ (Channel-Einstellungen → Berechtigungen → Bot-Rolle erlauben)"
				}
				srv.reaktionen.fehler = "Reaktion " + e.Name + " in #" + channelName + " nicht gesetzt: " + grund
				srv.reaktionen.mu.Unlock()
				return
			}
		}
	}()
}

func (srv *Server) bot(token string) discord.Bot {
	return discord.Bot{Token: token, BasisURL: srv.botBasisURL, HTTP: srv.http}
}

func eindeutig(s []string) []string {
	gesehen := map[string]bool{}
	var out []string
	for _, x := range s {
		if !gesehen[x] {
			gesehen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// urlText kodiert einen Text für einen Abfrageparameter.
func urlText(s string) string { return url.QueryEscape(s) }

// ausverkauftSchwelle liefert je Channel, ab wie vielen ❌ ein Deal als
// ausverkauft gilt: in B2B-Channels die eigene Schwelle, sonst die
// allgemeine. 0 heißt: nie.
func (srv *Server) ausverkauftSchwelle() func(channelID int64) int {
	schwelle := srv.store.EinstellungZahl(store.SchluesselReaktionSchwelle)
	schwelleB2B := srv.store.EinstellungZahl(store.SchluesselReaktionSchwelleB2B)
	b2b := map[int64]bool{}
	if cs, err := srv.store.B2BChannels(); err == nil {
		for _, c := range cs {
			b2b[c.ID] = true
		}
	}
	return func(channelID int64) int {
		if b2b[channelID] && schwelleB2B > 0 {
			return schwelleB2B
		}
		return schwelle
	}
}
