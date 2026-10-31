package web

import (
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type channelAnzeige struct {
	store.Channel
	WebhookMaskiert string
	// FarbeAnzeige ist die gewählte oder automatische Farbe.
	FarbeAnzeige string
	Posts30      int
	Zuletzt      string
	// Verwendung sagt, wofür der Channel benutzt wird: Regeln, Feeds,
	// Podcasts, Preisstürze …
	Verwendung []string
}

// channelGruppe ist eine Karte der Channel-Seite: alle Channels einer
// Gruppe (etwa eines Discord-Servers).
type channelGruppe struct {
	Name     string
	Channels []channelAnzeige
}

type channelDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	Channels  []channelAnzeige
	// Gruppen sind die schon vergebenen Gruppen, als Vorschlagsliste.
	Gruppen []string
	// Karten sind die Channels nach Gruppe, Farben die wählbaren Farben.
	Karten []channelGruppe
	Farben []string
	// Defekt zählt die Channels, deren Webhook zuletzt scheiterte.
	Defekt int
}

func itoa(i int64) string { return strconv.FormatInt(i, 10) }

// maskiere versteckt das Token einer Webhook-URL. Sichtbar bleibt alles bis
// einschließlich des letzten "/" — Host, Pfad und die Webhook-ID sind für
// sich genommen wertlos. Der letzte Abschnitt dahinter ist das eigentliche
// Geheimnis (der Webhook-Token) und wird bis auf seine letzten vier Zeichen
// ersetzt, damit der Channel trotzdem wiedererkennbar bleibt.
func maskiere(u string) string {
	if u == "" {
		return ""
	}
	praefix, segment := "", u
	if i := strings.LastIndex(u, "/"); i != -1 {
		praefix, segment = u[:i+1], u[i+1:]
	}

	const sichtbar = 4
	r := []rune(segment)
	if len(r) <= sichtbar {
		return praefix + "…" + segment
	}
	return praefix + "…" + string(r[len(r)-sichtbar:])
}

// urlInFehlertext erkennt eine http(s)-URL innerhalb eines Fehlertexts.
//
// (?i): ein Schema kommt nicht garantiert kleingeschrieben an. net/url
// normalisiert das Schema zwar bei erfolgreichem Parsen, aber genau bei
// einem Parse-Fehler — dem Fall, um den es hier geht — wird die rohe,
// unnormalisierte Eingabe zitiert. "HTTPS://" (z. B. durch die
// Autokorrektur einer Mobiltastatur) ist also eine realistische Eingabe,
// kein Sonderfall, und muss genauso erkannt werden wie "https://".
var urlInFehlertext = regexp.MustCompile(`(?i)https?://\S*`)

// sicherFehlertext ersetzt jede URL in einem Fehlertext durch ihre maskierte
// Form. discord.Sende bemüht sich bereits, die Webhook-URL nie in einen
// Fehler zu schreiben (siehe internal/discord) — das ist die erste und
// eigentliche Verteidigungslinie. Dieser Scrub ist die zweite: er fängt
// jede URL ab, die trotzdem durchrutscht, egal aus welchem Fehlerpfad sie
// stammt. Ein Geheimnis darf unter keinen Umständen im Klartext auf der
// Seite landen, auch nicht über den Umweg einer Fehlermeldung — deshalb
// wird hier per Muster gesucht statt exakt verglichen (ein exakter
// String-Vergleich mit der Original-URL ginge z. B. an einer mit %q
// escapten Zeichenkette vorbei, in der ein echtes Steuerzeichen zu den
// zwei Zeichen "\" und "n" wird).
func sicherFehlertext(text string) string {
	return urlInFehlertext.ReplaceAllStringFunc(text, maskiere)
}

func (srv *Server) channelDaten() channelDaten {
	d := channelDaten{Titel: "Channels"}
	cs, err := srv.store.Channels()
	if err != nil {
		d.Fehler = "Channels nicht lesbar: " + sicherFehlertext(err.Error())
		return d
	}
	d.Farben = store.Farben
	nutzung, _ := srv.store.KanalNutzungen(time.Now().AddDate(0, 0, -30))
	verwendung := srv.kanalVerwendung()
	karteIdx := map[string]int{}
	for _, c := range cs {
		a := channelAnzeige{Channel: c, WebhookMaskiert: maskiere(c.WebhookURL), FarbeAnzeige: c.FarbeOderAuto(),
			Verwendung: verwendung[c.ID]}
		if n, ok := nutzung[c.ID]; ok {
			a.Posts30 = n.Posts30
			if !n.Zuletzt.IsZero() {
				a.Zuletzt = n.Zuletzt.Local().Format("02.01.06 15:04")
			}
		}
		if c.Defekt {
			d.Defekt++
		}
		d.Channels = append(d.Channels, a)
		name := c.Gruppe
		if name == "" {
			name = "Ohne Gruppe"
		}
		i, da := karteIdx[name]
		if !da {
			i = len(d.Karten)
			karteIdx[name] = i
			d.Karten = append(d.Karten, channelGruppe{Name: name})
		}
		d.Karten[i].Channels = append(d.Karten[i].Channels, a)
	}
	// „Ohne Gruppe“ ans Ende.
	sort.SliceStable(d.Karten, func(i, j int) bool {
		return d.Karten[i].Name != "Ohne Gruppe" && d.Karten[j].Name == "Ohne Gruppe"
	})
	d.Gruppen, _ = srv.store.Gruppen()
	return d
}

func (srv *Server) zeigeChannels(w http.ResponseWriter, r *http.Request) {
	srv.rendere(w, "channels", srv.channelDaten())
}

func (srv *Server) speichereChannel(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		srv.fehler(w, http.StatusBadRequest, "Formular nicht lesbar")
		return
	}

	c := store.Channel{
		Name:       r.PostForm.Get("name"),
		WebhookURL: r.PostForm.Get("webhook_url"),
		MentionTyp: r.PostForm.Get("mention_typ"),
		RollenID:   r.PostForm.Get("rollen_id"),
		Gruppe:     r.PostForm.Get("gruppe"),
	}

	d := srv.channelDaten()
	switch {
	case c.Name == "" || c.WebhookURL == "":
		d.Fehler = "Name und Webhook-URL sind Pflicht."
		srv.rendere(w, "channels", d)
		return
	case c.MentionTyp == "rolle" && strings.TrimSpace(c.RollenID) == "":
		// Ohne diese Prüfung liess sich "Rolle" ohne Rollen-ID ganz normal
		// über das Formular anlegen; erlaubteMentions schickte dann
		// "roles":[""] an Discord, das die leere Snowflake ablehnt, und der
		// Versand scheiterte erst beim nächsten Testen oder Posten mit einem
		// nichtssagenden "discord: HTTP 400" (M9 im Abschluss-Review).
		d.Fehler = "Bei Mention „Rolle“ ist eine Rollen-ID Pflicht."
		srv.rendere(w, "channels", d)
		return
	}

	var err error
	if idText := r.PostForm.Get("id"); idText != "" && idText != "0" {
		c.ID, _ = strconv.ParseInt(idText, 10, 64)
		err = srv.store.ChannelAendern(c)
	} else {
		_, err = srv.store.ChannelAnlegen(c)
	}
	if err != nil {
		d.Fehler = "Speichern fehlgeschlagen: " + sicherFehlertext(err.Error())
		srv.rendere(w, "channels", d)
		return
	}

	d = srv.channelDaten()
	d.Meldung = "Gespeichert."
	srv.rendere(w, "channels", d)
}

func (srv *Server) loescheChannel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Channel-ID")
		return
	}
	d := srv.channelDaten()
	if err := srv.store.ChannelLoeschen(id); err != nil {
		d.Fehler = "Löschen fehlgeschlagen: " + sicherFehlertext(err.Error())
	} else {
		d = srv.channelDaten()
		d.Meldung = "Channel gelöscht. Die Historie bleibt erhalten."
	}
	srv.rendere(w, "channels", d)
}

// testeChannel sendet eine echte Nachricht — bewusst ohne Mention, damit ein
// Test niemals einen ganzen Server anpingt.
func (srv *Server) testeChannel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Channel-ID")
		return
	}

	c, err := srv.store.Channel(id)
	if err != nil {
		srv.fehler(w, http.StatusNotFound, "Channel nicht gefunden")
		return
	}

	d := srv.channelDaten()
	_, err = discord.Sende(r.Context(), srv.http, c.WebhookURL, discord.Nachricht{
		Inhalt:  "✅ Testnachricht aus Lugru Deals — dieser Webhook funktioniert.",
		Mention: discord.MentionKeine,
	})
	if err != nil {
		_ = srv.store.ChannelDefekt(id, true)
		d = srv.channelDaten()
		d.Fehler = "Test fehlgeschlagen: " + sicherFehlertext(err.Error())
	} else {
		_ = srv.store.ChannelDefekt(id, false)
		d = srv.channelDaten()
		d.Meldung = "Testnachricht gesendet."
	}
	srv.rendere(w, "channels", d)
}

// speichereChannelGruppe ordnet einen Channel einer Gruppe zu, etwa einem
// Discord-Server. Die schon geposteten Deals des Channels wandern mit.
func (srv *Server) speichereChannelGruppe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Channel-ID")
		return
	}
	_ = r.ParseForm()
	d := srv.channelDaten()
	if err := srv.store.ChannelGruppeSetzen(id, r.PostForm.Get("gruppe")); err != nil {
		d.Fehler = "Gruppe nicht gespeichert: " + sicherFehlertext(err.Error())
	} else {
		d = srv.channelDaten()
		d.Meldung = "Gruppe gespeichert — die bisherigen Deals des Channels zählen jetzt dazu."
	}
	srv.rendere(w, "channels", d)
}

// rollenIDMuster ist eine Discord-ID: nur Ziffern. Wer statt der ID die
// Schreibweise <@&123> aus Discord einfügt, bekommt sie hier entpackt.
var rollenIDMuster = regexp.MustCompile(`^<?@?&?(\d{5,25})>?$`)

// speichereChannelMention ändert die Erwähnung eines bestehenden Channels —
// etwa von @everyone auf eine Rolle wie @Super Low Margin. Der Channel
// bleibt dabei derselbe, alte Posts lassen sich also weiter als ausverkauft
// markieren.
func (srv *Server) speichereChannelMention(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Channel-ID")
		return
	}
	_ = r.ParseForm()
	typ := r.PostForm.Get("mention_typ")
	rolle := strings.TrimSpace(r.PostForm.Get("rollen_id"))
	d := srv.channelDaten()

	switch typ {
	case "keine", "everyone", "here":
		rolle = ""
	case "rolle":
		m := rollenIDMuster.FindStringSubmatch(rolle)
		if m == nil {
			d.Fehler = "Bei Mention „Rolle“ ist eine Rollen-ID Pflicht — nur Ziffern, z. B. 1166374099178758214."
			srv.rendere(w, "channels", d)
			return
		}
		rolle = m[1]
	default:
		d.Fehler = "Unbekannte Mention."
		srv.rendere(w, "channels", d)
		return
	}

	if err := srv.store.ChannelMentionSetzen(id, typ, rolle); err != nil {
		d.Fehler = "Mention nicht gespeichert: " + sicherFehlertext(err.Error())
	} else {
		d = srv.channelDaten()
		d.Meldung = "Mention gespeichert."
	}
	srv.rendere(w, "channels", d)
}

// kanalVerwendung sammelt je Channel, wofür ihn Monitor und Einstellungen
// benutzen.
func (srv *Server) kanalVerwendung() map[int64][]string {
	out := map[int64][]string{}
	zaehle := map[int64]map[string]int{}
	plus := func(id int64, was string) {
		if id == 0 {
			return
		}
		if zaehle[id] == nil {
			zaehle[id] = map[string]int{}
		}
		zaehle[id][was]++
	}
	if rs, err := srv.store.MonitorRegeln(); err == nil {
		for _, r := range rs {
			plus(r.ChannelID, "Monitor-Regel")
		}
	}
	if fs, err := srv.store.Feeds(); err == nil {
		for _, f := range fs {
			plus(f.ChannelID, "Feed")
		}
	}
	if ps, err := srv.store.Podcasts(); err == nil {
		for _, p := range ps {
			plus(p.ChannelID, "Podcasts")
		}
	}
	for schluessel, was := range map[string]string{
		store.SchluesselMonitorSturzChannel: "Preisstürze",
		store.SchluesselMonitorAdminChannel: "Admin-Meldungen",
		store.SchluesselMonitorTagChannel:   "Tageszusammenfassung",
	} {
		plus(int64(srv.store.EinstellungZahl(schluessel)), was)
	}
	if b2b, err := srv.store.B2BChannels(); err == nil {
		for _, c := range b2b {
			plus(c.ID, "B2B")
		}
	}
	for id, m := range zaehle {
		var teile []string
		for _, was := range []string{"Monitor-Regel", "Feed", "Podcasts", "Preisstürze", "Admin-Meldungen", "Tageszusammenfassung", "B2B"} {
			switch n := m[was]; {
			case n == 1:
				teile = append(teile, was)
			case n > 1:
				teile = append(teile, strconv.Itoa(n)+" × "+was)
			}
		}
		out[id] = teile
	}
	return out
}

// speichereChannelFarbe setzt die Farbe eines Channels.
func (srv *Server) speichereChannelFarbe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Channel-ID")
		return
	}
	_ = r.ParseForm()
	if err := srv.store.ChannelFarbeSetzen(id, r.PostForm.Get("farbe")); err != nil {
		d := srv.channelDaten()
		d.Fehler = sicherFehlertext(err.Error())
		srv.rendere(w, "channels", d)
		return
	}
	srv.kanalFarbenLeeren()
	d := srv.channelDaten()
	d.Meldung = "Farbe gespeichert."
	srv.rendere(w, "channels", d)
}

// kanalfarbe ist die Farbe eines Channels nach Namen — für die Vorlagen,
// wo nur der Name bekannt ist (Historie, Monitor). Die Zuordnung wird kurz
// zwischengespeichert, damit eine lange Tabelle nicht je Zeile die
// Datenbank fragt.
func (srv *Server) kanalfarbe(name string) string {
	name = strings.TrimPrefix(strings.TrimSpace(name), "#")
	srv.farbenMu.Lock()
	defer srv.farbenMu.Unlock()
	if srv.farben == nil || time.Since(srv.farbenStand) > 10*time.Second {
		srv.farben = map[string]string{}
		if cs, err := srv.store.Channels(); err == nil {
			for _, c := range cs {
				srv.farben[strings.ToLower(c.Name)] = c.FarbeOderAuto()
			}
		}
		srv.farbenStand = time.Now()
	}
	if f, ok := srv.farben[strings.ToLower(name)]; ok {
		return "kf-" + f
	}
	return "kf-" + store.FarbeFuerName(name)
}

func (srv *Server) kanalFarbenLeeren() {
	srv.farbenMu.Lock()
	srv.farben = nil
	srv.farbenMu.Unlock()
}
