package web

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/discord"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

type channelAnzeige struct {
	store.Channel
	WebhookMaskiert string
}

type channelDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	Channels  []channelAnzeige
	// Gruppen sind die schon vergebenen Gruppen, als Vorschlagsliste.
	Gruppen []string
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
	for _, c := range cs {
		d.Channels = append(d.Channels, channelAnzeige{Channel: c, WebhookMaskiert: maskiere(c.WebhookURL)})
	}
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
