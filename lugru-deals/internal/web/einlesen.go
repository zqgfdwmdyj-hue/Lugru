package web

import (
	"context"
	"errors"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/altpost"
	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Alte Deals einlesen: der Bot geht den Verlauf der Channels durch, die das
// Tool kennt, und liest jeden Post, der nach einem Deal aussieht (siehe
// internal/altpost). Das dauert bei großen Channels eine Weile und läuft
// darum im Hintergrund. Gespeichert wird erst, wenn die Vorschau bestätigt
// ist — bis dahin liegt das Ergebnis nur im Speicher.

const (
	// einlesenHoechstens begrenzt die Nachrichten je Channel.
	einlesenHoechstens = 20000
	// einlesenDauer begrenzt einen ganzen Durchgang.
	einlesenDauer = 20 * time.Minute
)

type einlesen struct {
	mu      sync.Mutex
	laeuft  bool
	stand   string // Fortschritt, z. B. "#pan-eu-deals: 1.200 Nachrichten"
	fehler  []string
	fertig  time.Time
	treffer []einleseTreffer

	gelesen, schonDa, unerkannt, ohneText int
}

// einleseTreffer ist ein erkannter Deal, noch nicht gespeichert.
type einleseTreffer struct {
	NachrichtID string
	KanalID     string
	ChannelID   int64
	ChannelName string
	Gruppe      string
	Zeit        time.Time
	Poster      string
	Kaeufe      int
	Weg         int
	Text        string
	Deal        altpost.Deal
}

// einleseZeile ist ein Treffer, fertig für die Vorschau.
type einleseZeile struct {
	NachrichtID string
	Datum       string
	Channel     string
	Poster      string
	Titel       string
	ASIN        string
	EK, VK      string
	Gewinn      string
	Marge       string
	Klasse      string
	PanEU       bool
	Kaeufe      int
	Ausverkauft bool
}

type einleseSeite struct {
	Titel     string
	TokenText string
	Fehler    string
	Meldung   string

	BotDa    bool
	Channels []store.Channel
	Von      string

	Laeuft  bool
	Stand   string
	Fertig  string
	Hinweis []string

	Gelesen, SchonDa, Unerkannt, OhneText int
	Zeilen                                []einleseZeile
}

func (srv *Server) zeigeEinlesen(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	d := einleseSeite{
		Titel:     "Historie",
		TokenText: srv.tokenText(),
		Fehler:    q.Get("fehler"),
		Meldung:   q.Get("meldung"),
		BotDa:     srv.store.Einstellung(store.SchluesselBotToken) != "",
		Von:       q.Get("von"),
	}
	d.Channels, _ = srv.store.Channels()

	e := &srv.einlesen
	e.mu.Lock()
	d.Laeuft, d.Stand = e.laeuft, e.stand
	d.Hinweis = append(d.Hinweis, e.fehler...)
	d.Gelesen, d.SchonDa, d.Unerkannt, d.OhneText = e.gelesen, e.schonDa, e.unerkannt, e.ohneText
	if !e.fertig.IsZero() {
		d.Fertig = e.fertig.Local().Format("02.01.2006 15:04")
	}
	for _, t := range e.treffer {
		z := einleseZeile{
			NachrichtID: t.NachrichtID, Datum: t.Zeit.Local().Format("02.01.2006"),
			Channel: t.ChannelName, Poster: t.Poster, Titel: t.Deal.Titel, ASIN: t.Deal.ASIN,
			EK: money.Cents(t.Deal.EKCent).Euro(), VK: money.Cents(t.Deal.VKCent).Euro(),
			Kaeufe: t.Kaeufe, Ausverkauft: t.Deal.Ausverkauft,
		}
		gewinn, marge := t.Deal.GewinnCent, t.Deal.Marge
		if t.Deal.PanEU && t.Deal.PanEUGewinnCent > gewinn {
			gewinn, marge, z.PanEU = t.Deal.PanEUGewinnCent, t.Deal.PanEUMarge, true
		}
		z.Gewinn, z.Marge, z.Klasse = money.Cents(gewinn).Euro(), prozent(marge, 1), zahlklasse(float64(gewinn))
		d.Zeilen = append(d.Zeilen, z)
	}
	e.mu.Unlock()

	// Viele Nachrichten ohne jeden Text: Discord gibt dem Bot den Inhalt
	// nicht heraus.
	if d.OhneText > 0 && d.OhneText*2 >= d.Gelesen {
		d.Hinweis = append(d.Hinweis, "Bei vielen Nachrichten kam kein Text an. Im Discord-Entwicklerportal "+
			"unter Bot → „Message Content Intent“ einschalten, speichern und dann neu einlesen.")
	}
	srv.rendere(w, "einlesen", d)
}

// starteEinlesen stößt den Durchgang an und kehrt sofort zurück.
func (srv *Server) starteEinlesen(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	token := srv.store.Einstellung(store.SchluesselBotToken)
	if token == "" {
		http.Redirect(w, r, "/einlesen?fehler="+urlText("Kein Bot-Token hinterlegt — siehe Einstellungen."), http.StatusSeeOther)
		return
	}
	var von time.Time
	if v := r.PostForm.Get("von"); v != "" {
		t, err := time.ParseInLocation("2006-01-02", v, time.Local)
		if err != nil {
			http.Redirect(w, r, "/einlesen?fehler="+urlText("Datum nicht lesbar."), http.StatusSeeOther)
			return
		}
		von = t
	}
	gewaehlt := map[string]bool{}
	for _, id := range r.PostForm["channel"] {
		gewaehlt[id] = true
	}
	alle, _ := srv.store.Channels()
	var channels []store.Channel
	for _, c := range alle {
		if gewaehlt[itoa(c.ID)] {
			channels = append(channels, c)
		}
	}
	if len(channels) == 0 {
		http.Redirect(w, r, "/einlesen?fehler="+urlText("Bitte mindestens einen Channel wählen."), http.StatusSeeOther)
		return
	}

	e := &srv.einlesen
	e.mu.Lock()
	if e.laeuft {
		e.mu.Unlock()
		http.Redirect(w, r, "/einlesen", http.StatusSeeOther)
		return
	}
	e.laeuft, e.stand = true, "startet …"
	e.mu.Unlock()

	go func() {
		ctx, abbruch := context.WithTimeout(context.Background(), einlesenDauer)
		defer abbruch()
		srv.einlesenDurchgang(ctx, token, channels, von)
	}()
	http.Redirect(w, r, "/einlesen", http.StatusSeeOther)
}

func (srv *Server) einlesenDurchgang(ctx context.Context, token string, channels []store.Channel, von time.Time) {
	e := &srv.einlesen
	melde := func(f func()) {
		e.mu.Lock()
		f()
		e.mu.Unlock()
	}
	melde(func() {
		e.laeuft, e.fehler, e.treffer = true, nil, nil
		e.gelesen, e.schonDa, e.unerkannt, e.ohneText = 0, 0, 0, 0
	})
	defer melde(func() { e.laeuft, e.stand, e.fertig = false, "", time.Now() })

	bot := srv.bot(token)
	bekannt, err := srv.store.DiscordNachrichtIDs()
	if err != nil {
		melde(func() { e.fehler = append(e.fehler, "Historie nicht lesbar: "+sicherFehlertext(err.Error())) })
		return
	}
	gekauft := discord.EmojiAus(srv.store.Einstellung(store.SchluesselReaktionGekauft))
	weg := discord.EmojiAus(srv.store.Einstellung(store.SchluesselReaktionWeg))
	poster := srv.posterListe()

	for _, c := range channels {
		kanal, err := discord.WebhookKanal(ctx, srv.http, c.WebhookURL)
		if err != nil {
			melde(func() {
				e.fehler = append(e.fehler, "#"+c.Name+": Channel nicht ermittelbar ("+sicherFehlertext(err.Error())+")")
			})
			continue
		}
		vor, anzahl := "", 0
	seiten:
		for anzahl < einlesenHoechstens {
			melde(func() { e.stand = "#" + c.Name + ": " + itoa(int64(anzahl)) + " Nachrichten gelesen" })
			ns, err := bot.Nachrichten(ctx, kanal, vor)
			if err != nil {
				grund := sicherFehlertext(err.Error())
				switch {
				case errors.Is(err, discord.ErrBotToken):
					grund = "der Bot-Token wird abgelehnt"
				case errors.Is(err, discord.ErrBotRechte):
					grund = "der Bot darf dort nicht lesen („Kanäle ansehen“ und „Nachrichtenverlauf lesen“ erlauben)"
				case errors.Is(err, discord.ErrKanalWeg):
					grund = "den Channel findet der Bot nicht (Bot nicht auf diesem Server?)"
				}
				melde(func() { e.fehler = append(e.fehler, "#"+c.Name+": "+grund) })
				break
			}
			if len(ns) == 0 {
				break
			}
			for _, n := range ns {
				if !von.IsZero() && n.Zeit.Before(von) {
					break seiten
				}
				anzahl++
				vor = n.ID
				t, zaehler := srv.einleseTreffer(n, c, kanal, bekannt, poster, gekauft, weg)
				melde(func() {
					e.gelesen++
					switch zaehler {
					case "schonDa":
						e.schonDa++
					case "ohneText":
						e.ohneText++
						e.unerkannt++
					case "unerkannt":
						e.unerkannt++
					default:
						e.treffer = append(e.treffer, t)
					}
				})
			}
			if len(ns) < 100 {
				break
			}
		}
	}
	melde(func() {
		sort.SliceStable(e.treffer, func(i, j int) bool { return e.treffer[i].Zeit.After(e.treffer[j].Zeit) })
	})
	log.Printf("Einlesen: %d Nachrichten, %d Deals erkannt", e.gelesen, len(e.treffer))
}

var posterZeile = regexp.MustCompile(`Deal von\s+(?:<@!?(\d+)>|@([\w.\-]+))`)

// einleseTreffer bewertet eine Nachricht. zaehler ist "" für einen Treffer,
// sonst der Grund, warum sie nicht zählt.
func (srv *Server) einleseTreffer(n discord.VerlaufNachricht, c store.Channel, kanal string,
	bekannt map[string]bool, poster []posterEintrag, gekauft, weg discord.Emoji) (einleseTreffer, string) {
	if bekannt[n.ID] {
		return einleseTreffer{}, "schonDa"
	}
	if strings.TrimSpace(n.Inhalt) == "" {
		if n.Anhaenge > 0 && !n.Webhook {
			return einleseTreffer{}, "ohneText"
		}
		return einleseTreffer{}, "unerkannt"
	}
	d, ok := altpost.Lies(n.Inhalt)
	if !ok {
		return einleseTreffer{}, "unerkannt"
	}
	t := einleseTreffer{
		NachrichtID: n.ID, KanalID: kanal, ChannelID: c.ID, ChannelName: c.Name, Gruppe: c.Gruppe,
		Zeit: n.Zeit, Text: n.Inhalt, Deal: d,
		Kaeufe: discord.Zaehle(n.Reaktionen, gekauft), Weg: discord.Zaehle(n.Reaktionen, weg),
	}
	t.Poster = posterVon(n, poster)
	return t, ""
}

// posterVon ordnet den Verfasser einem Namen aus der Poster-Liste zu: über
// die Discord-ID, den Namen oder — bei einem Post des Tools — die Zeile
// „Deal von …“. Wer nicht in der Liste steht, bleibt mit seinem
// Discord-Namen stehen; ein Webhook ohne diese Zeile bleibt leer.
func posterVon(n discord.VerlaufNachricht, liste []posterEintrag) string {
	id, name := n.AutorID, n.AutorName
	benutzer := n.AutorBenutzer
	if n.Webhook {
		m := posterZeile.FindStringSubmatch(n.Inhalt)
		if m == nil {
			return ""
		}
		id, name, benutzer = m[1], m[2], m[2]
	}
	for _, p := range liste {
		if p.ID != "" && p.ID == id {
			return p.Name
		}
	}
	for _, p := range liste {
		kp := strings.ToLower(p.Name)
		for _, kandidat := range []string{name, benutzer} {
			k := strings.ToLower(kandidat)
			if k != "" && (k == kp || strings.Contains(k, kp)) {
				return p.Name
			}
		}
	}
	return name
}

// uebernehmeEinlesen speichert die angehakten Treffer.
func (srv *Server) uebernehmeEinlesen(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	gewaehlt := map[string]bool{}
	for _, id := range r.PostForm["nachricht"] {
		gewaehlt[id] = true
	}

	e := &srv.einlesen
	e.mu.Lock()
	if e.laeuft {
		e.mu.Unlock()
		http.Redirect(w, r, "/einlesen?fehler="+urlText("Das Einlesen läuft noch."), http.StatusSeeOther)
		return
	}
	treffer := e.treffer
	e.treffer = nil
	e.mu.Unlock()

	bekannt, _ := srv.store.DiscordNachrichtIDs()
	gespeichert := 0
	var fehler []string
	for _, t := range treffer {
		if !gewaehlt[t.NachrichtID] || bekannt[t.NachrichtID] {
			continue
		}
		if err := srv.speichereEingelesen(t); err != nil {
			fehler = append(fehler, t.Deal.Titel+": "+sicherFehlertext(err.Error()))
			continue
		}
		gespeichert++
	}
	if len(fehler) > 0 {
		http.Redirect(w, r, "/einlesen?fehler="+urlText(itoa(int64(gespeichert))+" Deals übernommen, Fehler: "+
			strings.Join(eindeutig(fehler), " · ")), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/historie?meldung="+urlText(itoa(int64(gespeichert))+" alte Deals aus Discord übernommen."), http.StatusSeeOther)
}

func (srv *Server) speichereEingelesen(t einleseTreffer) error {
	d := t.Deal
	status := store.StatusAktiv
	if d.Ausverkauft {
		status = store.StatusAusverkauft
	}
	ekArt := "brutto"
	if d.EKNetto {
		ekArt = "netto"
	}
	leit := store.DealMarkt{
		Markt: d.Zielmarkt, Leitmarkt: true,
		VKCent: money.Cents(d.VKCent), VKQuelle: "discord",
		Sales: d.Sales, SalesQuelle: "discord",
		GewinnCent: money.Cents(d.GewinnCent), MargeProzent: d.Marge,
	}
	if d.PanEU {
		leit.PanEU = &store.DealMarktPanEU{GewinnCent: money.Cents(d.PanEUGewinnCent), MargeProzent: d.PanEUMarge}
	}
	id, err := srv.store.DealAnlegen(store.Deal{
		ASIN: d.ASIN, Titel: d.Titel,
		Quellmarkt: d.Quellmarkt, QuellURL: d.QuellURL, Lieferant: d.Lieferant, Zielmarkt: d.Zielmarkt,
		EKCent: money.Cents(d.EKCent), EKArt: ekArt, EKNotiz: d.EKNotiz,
		VKCent: money.Cents(d.VKCent), VKQuelle: "discord",
		Sales: d.Sales, SalesQuelle: "discord",
		GewinnCent: money.Cents(d.GewinnCent), MargeProzent: d.Marge,
		ChannelID: t.ChannelID, ChannelName: t.ChannelName, Gruppe: t.Gruppe,
		NachrichtText: t.Text, DiscordNachrichtID: t.NachrichtID, DiscordKanalID: t.KanalID,
		GepostetAm: t.Zeit, MaxMenge: d.MaxMenge, Status: status, Poster: t.Poster,
		Importiert: true,
		Maerkte:    []store.DealMarkt{leit},
	})
	if err != nil {
		return err
	}
	return srv.store.DealReaktionenSetzen(id, t.Kaeufe, t.Weg, time.Now())
}

// EingeleseneNachpruefen liest alle eingelesenen Deals aus ihrem
// gespeicherten Posttext neu und übernimmt die Zahlen, wo sie sich
// geändert haben. Ein Post, der sich jetzt nicht mehr sicher lesen lässt
// (Gewinn passt in keiner Lesart zum VK), zählt ohne Gewinn weiter.
// Liefert die Zahl der berichtigten und der unlesbaren Deals.
func (srv *Server) EingeleseneNachpruefen() (berichtigt, unlesbar int) {
	eingelesen, err := srv.store.EingeleseneDeals()
	if err != nil {
		log.Printf("Eingelesene Deals nicht lesbar: %v", err)
		return 0, 0
	}
	for _, e := range eingelesen {
		alt, err := srv.store.Deal(e.ID)
		if err != nil {
			continue
		}
		d, ok := altpost.Lies(e.Text)
		n := store.Nachgelesen{
			Titel: d.Titel, ASIN: d.ASIN, EKCent: money.Cents(d.EKCent), VKCent: money.Cents(d.VKCent),
			GewinnCent: money.Cents(d.GewinnCent), MargeProzent: d.Marge,
		}
		if n.Titel == "" {
			n.Titel = alt.Titel
		}
		if n.ASIN == "" {
			n.ASIN = alt.ASIN
		}
		if d.PanEU {
			n.PanEU = &store.DealMarktPanEU{GewinnCent: money.Cents(d.PanEUGewinnCent), MargeProzent: d.PanEUMarge}
		}
		if !ok {
			n.GewinnCent, n.MargeProzent, n.PanEU = 0, 0, nil
		}
		geaendert := alt.Titel != n.Titel || alt.ASIN != n.ASIN || alt.EKCent != n.EKCent || alt.VKCent != n.VKCent ||
			alt.GewinnCent != n.GewinnCent || alt.MargeProzent != n.MargeProzent
		// Die Pan-EU-Zahlen stehen nur in der Marktzeile; sie werden bei
		// jedem Pan-EU-Deal neu geschrieben, das kostet nichts.
		if !geaendert && n.PanEU == nil && !alt.PanEU {
			continue
		}
		if err := srv.store.EingelesenenKorrigieren(e.ID, n); err != nil {
			log.Printf("Deal %d nicht berichtigt: %v", e.ID, err)
			continue
		}
		switch {
		case !ok:
			unlesbar++
		case geaendert:
			berichtigt++
		}
	}
	return berichtigt, unlesbar
}
