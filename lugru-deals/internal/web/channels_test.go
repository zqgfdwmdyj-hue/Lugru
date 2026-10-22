package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestChannelAnlegenUeberFormular(t *testing.T) {
	srv, s := testServer(t)

	f := url.Values{
		"name":        {"deals-vip"},
		"webhook_url": {"https://discord.com/api/webhooks/123/geheimestoken"},
		"mention_typ": {"everyone"},
	}
	if w := hole(t, srv, http.MethodPost, "/channels", f.Encode()); w.Code >= 400 {
		t.Fatalf("Status = %d", w.Code)
	}

	cs, err := s.Channels()
	if err != nil {
		t.Fatalf("Channels: %v", err)
	}
	if len(cs) != 1 || cs[0].Name != "deals-vip" || cs[0].MentionTyp != "everyone" {
		t.Errorf("Channels = %+v", cs)
	}
}

func TestChannelListeMaskiertWebhook(t *testing.T) {
	srv, s := testServer(t)
	s.ChannelAnlegen(store.Channel{
		Name: "deals-vip", WebhookURL: "https://discord.com/api/webhooks/123/geheimestoken",
	})

	w := hole(t, srv, http.MethodGet, "/channels", "")
	if strings.Contains(w.Body.String(), "geheimestoken") {
		t.Error("die Webhook-URL steht im Klartext in der Seite")
	}
	if !strings.Contains(w.Body.String(), "deals-vip") {
		t.Error("der Channel-Name fehlt in der Liste")
	}
}

func TestChannelLoeschen(t *testing.T) {
	srv, s := testServer(t)
	id, _ := s.ChannelAnlegen(store.Channel{Name: "weg", WebhookURL: "https://x/1"})

	pfad := "/channels/" + itoa(id) + "/loeschen"
	if w := hole(t, srv, http.MethodPost, pfad, ""); w.Code >= 400 {
		t.Fatalf("Status = %d", w.Code)
	}
	if cs, _ := s.Channels(); len(cs) != 0 {
		t.Errorf("%d Channels übrig, will 0", len(cs))
	}
}

func TestChannelOhneNamenAbgelehnt(t *testing.T) {
	srv, s := testServer(t)
	f := url.Values{"name": {""}, "webhook_url": {"https://x/1"}}
	hole(t, srv, http.MethodPost, "/channels", f.Encode())

	if cs, _ := s.Channels(); len(cs) != 0 {
		t.Error("Channel ohne Namen wurde angelegt")
	}
}

func TestChannelOhneWebhookAbgelehnt(t *testing.T) {
	srv, s := testServer(t)
	f := url.Values{"name": {"x"}, "webhook_url": {""}}
	hole(t, srv, http.MethodPost, "/channels", f.Encode())

	if cs, _ := s.Channels(); len(cs) != 0 {
		t.Error("Channel ohne Webhook-URL wurde angelegt")
	}
}

// TestChannelRolleOhneRollenIDAbgelehnt deckt M9 ab: Mention "Rolle" ohne
// Rollen-ID ließ sich zuvor ganz normal über das Formular anlegen.
// erlaubteMentions schickte dann "roles":[""] an Discord, das die leere
// Snowflake ablehnt — der Versand scheiterte erst beim nächsten Testen oder
// Posten mit einem nichtssagenden "discord: HTTP 400", nie schon beim
// Anlegen des Channels selbst, wo der eigentliche Fehler liegt.
func TestChannelRolleOhneRollenIDAbgelehnt(t *testing.T) {
	srv, s := testServer(t)
	f := url.Values{
		"name": {"laut-ohne-rolle"}, "webhook_url": {"https://x/1"}, "mention_typ": {"rolle"},
	}
	w := hole(t, srv, http.MethodPost, "/channels", f.Encode())

	if !strings.Contains(w.Body.String(), "Rollen-ID") {
		t.Errorf("die Fehlermeldung nennt die fehlende Rollen-ID nicht:\n%s", w.Body.String())
	}
	if cs, _ := s.Channels(); len(cs) != 0 {
		t.Error("ein Rollen-Channel ohne Rollen-ID wurde angelegt")
	}
}

func TestMaskiere(t *testing.T) {
	faelle := map[string]string{
		"https://discord.com/api/webhooks/123456/sehrlangesgeheimestoken": "https://discord.com/api/webhooks/123456/…oken",
		"":     "",
		"kurz": "…kurz",
	}
	for ein, will := range faelle {
		if got := maskiere(ein); got != will {
			t.Errorf("maskiere(%q) = %q, will %q", ein, got, will)
		}
	}
}

// Die folgenden drei Tests sind über den Task-Brief hinaus ergänzt (siehe
// Bericht): sie sichern die Sicherheitseigenschaften ab, um die es in diesem
// Task laut Aufgabenbeschreibung eigentlich geht, und die von den
// Brief-Tests nicht geprüft werden, weil dort testeChannel gar nicht
// aufgerufen wird.

// TestChannelTestenSendetOhneMention stellt sicher, dass der Testknopf immer
// mit MentionKeine sendet — unabhängig davon, was für den Channel als
// Mention-Typ hinterlegt ist. Ein Testversand an einen produktiv laufenden
// @everyone-Channel darf nie den ganzen Server anpingen.
func TestChannelTestenSendetOhneMention(t *testing.T) {
	var nutzlast string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nutzlast = r.FormValue("payload_json")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"1"}`))
	}))
	defer fake.Close()

	srv, s := testServer(t)
	id, _ := s.ChannelAnlegen(store.Channel{
		Name: "laut", WebhookURL: fake.URL, MentionTyp: "everyone", RollenID: "123",
	})

	if w := hole(t, srv, http.MethodPost, "/channels/"+itoa(id)+"/test", ""); w.Code >= 400 {
		t.Fatalf("Status = %d", w.Code)
	}

	if nutzlast == "" {
		t.Fatal("der Fake-Webhook hat keine payload_json empfangen")
	}
	if strings.Contains(nutzlast, "everyone") {
		t.Errorf("Testnachricht pingt trotz konfiguriertem @everyone-Channel: %s", nutzlast)
	}
	if !strings.Contains(nutzlast, `"parse":[]`) {
		t.Errorf("payload_json erlaubt keine explizit leere Mention-Liste: %s", nutzlast)
	}
}

// TestChannelTestenFehlerZeigtWebhookNieImKlartext prüft, dass eine defekte
// Webhook-URL nie im Klartext in der Fehlermeldung der gerenderten Seite
// landet. net/url gibt bei einem Steuerzeichen (hier: Zeilenumbruch am Ende
// der URL — z. B. durch Copy-Paste aus einer Datei) die komplette Roh-URL in
// seiner Parse-Fehlermeldung zurück; discord.Sende bricht in diesem Fall vor
// jedem Netzwerkzugriff ab, der Test bleibt also netzwerkfrei.
func TestChannelTestenFehlerZeigtWebhookNieImKlartext(t *testing.T) {
	srv, s := testServer(t)
	geheim := "https://discord.com/api/webhooks/123/geheimestoken"
	id, _ := s.ChannelAnlegen(store.Channel{Name: "kaputt", WebhookURL: geheim + "\n"})

	w := hole(t, srv, http.MethodPost, "/channels/"+itoa(id)+"/test", "")
	if strings.Contains(w.Body.String(), "geheimestoken") {
		t.Error("die Webhook-URL steht im Klartext in der Fehlermeldung")
	}
}

// TestChannelTestenNetzwerkfehlerZeigtWebhookNieImKlartext deckt einen
// zweiten Leck-Pfad ab: auch ein Transportfehler (Host nicht erreichbar)
// bettet über *url.Error die komplette angefragte URL in seine
// Fehlermeldung ein — nicht nur ein Parse-Fehler. Ziel ist ein
// geschlossener lokaler Port; die Verbindung wird vom eigenen
// Betriebssystem sofort mit ECONNREFUSED abgelehnt, es findet kein
// echter Netzwerkzugriff über die Loopback-Schnittstelle hinaus statt.
func TestChannelTestenNetzwerkfehlerZeigtWebhookNieImKlartext(t *testing.T) {
	srv, s := testServer(t)
	id, _ := s.ChannelAnlegen(store.Channel{
		Name: "unerreichbar", WebhookURL: "http://127.0.0.1:1/api/webhooks/123/geheimestoken",
	})

	w := hole(t, srv, http.MethodPost, "/channels/"+itoa(id)+"/test", "")
	if strings.Contains(w.Body.String(), "geheimestoken") {
		t.Error("die Webhook-URL steht im Klartext in der Fehlermeldung")
	}
}

// TestChannelTestenGrossgeschriebenesSchemaNieImKlartext deckt die konkrete
// Lücke ab, die ein Reviewer end-to-end nachgestellt hat: eine Webhook-URL
// mit großgeschriebenem Schema ("HTTPS://" statt "https://" — z. B. durch
// die Autokorrektur einer Mobiltastatur) und einem Steuerzeichen (ein
// gewöhnlicher Copy-Paste-Unfall). net/url gibt bei einem Parse-Fehler die
// rohe Eingabe unverändert zurück, Großschreibung eingeschlossen. Der alte
// Scrub der Web-Schicht (`https?://\S*`, ohne (?i)) hat "HTTPS://" nicht
// erkannt, sodass der Token im Klartext auf der Seite landete — dieser Test
// bildet exakt die vom Reviewer genannte Byte-Folge nach.
func TestChannelTestenGrossgeschriebenesSchemaNieImKlartext(t *testing.T) {
	srv, s := testServer(t)
	geheim := "GEHEIM_ABC"
	id, _ := s.ChannelAnlegen(store.Channel{
		Name:       "grossschreibung",
		WebhookURL: "HTTPS://discord.com/api/webhooks/123/" + geheim + "\x7f",
	})

	w := hole(t, srv, http.MethodPost, "/channels/"+itoa(id)+"/test", "")
	if strings.Contains(w.Body.String(), geheim) {
		t.Error("die Webhook-URL steht im Klartext in der Fehlermeldung (Schema großgeschrieben)")
	}
}

// TestSicherFehlertextIstCaseInsensitiv sichert die zweite
// Verteidigungslinie unabhängig von internal/discord ab: selbst wenn ein
// künftiger Aufrufer eine URL ungefiltert in einen Fehlertext schreibt, muss
// sicherFehlertext sie unabhängig von der Groß-/Kleinschreibung des Schemas
// erkennen und maskieren.
func TestSicherFehlertextIstCaseInsensitiv(t *testing.T) {
	text := `discord: Webhook-URL nicht lesbar: parse "HTTPS://discord.com/api/webhooks/123/geheimestoken": net/url: invalid control character in URL`
	got := sicherFehlertext(text)
	if strings.Contains(got, "geheimestoken") {
		t.Errorf("sicherFehlertext(%q) = %q, enthält den Token noch", text, got)
	}
}
