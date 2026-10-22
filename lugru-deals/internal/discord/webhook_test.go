package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type empfangen struct {
	Inhalt   string
	Mentions map[string]any
	// MentionsVorhanden hält fest, ob die Nutzlast den Schlüssel
	// allowed_mentions überhaupt trug. Mentions allein reicht nicht: eine
	// fehlende Angabe und ein leeres {"parse":[]} ergeben beide eine nil-
	// bzw. leere Map, also denselben len(...)==0 — nur die Präsenzprüfung
	// unterscheidet "bewusst begrenzt" von "Feld vergessen".
	MentionsVorhanden bool
	// RollenVorhanden hält aus demselben Grund wie MentionsVorhanden fest,
	// ob allowed_mentions den verschachtelten Schlüssel "roles" überhaupt
	// trug: len(Mentions["roles"].([]any)) ist bei einem fehlenden Feld und
	// bei einem gesendeten, aber leeren "roles":[] gleichermaßen 0 — nur
	// die Präsenzprüfung unterscheidet "keine Rolle erlaubt" (Schlüssel
	// fehlt) von "eine leere Rollenliste erlaubt" (Schlüssel da, aber leer).
	RollenVorhanden bool
	PNGName         string
	PNGBytes        []byte
	WaitFlag        string
	ThreadID        string
	Flags           int
}

// server nimmt eine Webhook-Anfrage entgegen und zerlegt sie.
func server(t *testing.T, status int, antwort string, ziel *empfangen) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ziel.WaitFlag = r.URL.Query().Get("wait")
		ziel.ThreadID = r.URL.Query().Get("thread_id")

		_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil {
			t.Errorf("Content-Type nicht lesbar: %v", err)
			return
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			teil, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("multipart: %v", err)
				return
			}
			daten, _ := io.ReadAll(teil)
			switch teil.FormName() {
			case "payload_json":
				// Präsenz getrennt von Inhalt prüfen: map[string]any lässt
				// ein fehlendes Feld und ein leeres {"parse":[]} nicht
				// auseinanderhalten (beide ergeben eine nil- bzw. leere
				// Map). Nur ein Blick auf die rohen Schlüssel zeigt, ob
				// allowed_mentions überhaupt gesendet wurde.
				var roh map[string]json.RawMessage
				if err := json.Unmarshal(daten, &roh); err != nil {
					t.Errorf("payload_json: %v", err)
				}
				am, mentionsVorhanden := roh["allowed_mentions"]
				ziel.MentionsVorhanden = mentionsVorhanden

				// Dieselbe Präsenzprüfung noch einmal eine Ebene tiefer:
				// "roles" steckt verschachtelt in allowed_mentions, und nur
				// ein Blick auf dessen rohe Schlüssel zeigt, ob "roles"
				// überhaupt gesendet wurde — nicht nur, ob es leer ist.
				if mentionsVorhanden {
					var amRoh map[string]json.RawMessage
					if err := json.Unmarshal(am, &amRoh); err != nil {
						t.Errorf("allowed_mentions: %v", err)
					} else {
						_, ziel.RollenVorhanden = amRoh["roles"]
					}
				}

				var p struct {
					Content         string         `json:"content"`
					AllowedMentions map[string]any `json:"allowed_mentions"`
					Flags           int            `json:"flags"`
				}
				if err := json.Unmarshal(daten, &p); err != nil {
					t.Errorf("payload_json: %v", err)
				}
				ziel.Inhalt = p.Content
				ziel.Mentions = p.AllowedMentions
				ziel.Flags = p.Flags
			case "files[0]":
				ziel.PNGName = teil.FileName()
				ziel.PNGBytes = daten
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, antwort)
	}))
}

func TestSendeMitAnhang(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1234567890"}`, &got)
	defer srv.Close()

	png := []byte("\x89PNG\r\n\x1a\nBILDDATEN")
	erg, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
		Inhalt:    "🛒 Makita HR2630 @everyone",
		Mention:   MentionEveryone,
		ChartName: "B01636IZ0G-20260905.png",
		ChartPNG:  png,
	})
	if err != nil {
		t.Fatalf("Sende: %v", err)
	}

	if erg.NachrichtID != "1234567890" {
		t.Errorf("NachrichtID = %q, will 1234567890", erg.NachrichtID)
	}
	if got.WaitFlag != "true" {
		t.Errorf("wait = %q, will true — ohne das liefert Discord keine Nachrichten-ID", got.WaitFlag)
	}
	if got.Inhalt != "🛒 Makita HR2630 @everyone" {
		t.Errorf("Inhalt = %q", got.Inhalt)
	}
	if got.PNGName != "B01636IZ0G-20260905.png" {
		t.Errorf("Dateiname = %q", got.PNGName)
	}
	if string(got.PNGBytes) != string(png) {
		t.Errorf("PNG-Inhalt weicht ab")
	}
}

func TestSendeOhneAnhang(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1"}`, &got)
	defer srv.Close()

	if _, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
		Inhalt: "nur Text", Mention: MentionKeine,
	}); err != nil {
		t.Fatalf("Sende: %v", err)
	}
	if got.PNGName != "" {
		t.Errorf("Dateiname = %q, will leer", got.PNGName)
	}
}

func TestAllowedMentions(t *testing.T) {
	faelle := []struct {
		mention   MentionTyp
		rollenID  string
		willParse []any
		willRoles []any
	}{
		{MentionKeine, "", []any{}, nil},
		{MentionEveryone, "", []any{"everyone"}, nil},
		{MentionHere, "", []any{"everyone"}, nil},
		{MentionRolle, "999", []any{}, []any{"999"}},
		// M9 im Abschluss-Review: web.speichereChannel lehnt eine leere
		// Rollen-ID inzwischen beim Anlegen ab, aber ältere oder direkt in
		// der Datenbank angelegte Channels können trotzdem hier ankommen.
		// Ohne diesen Fall stünde "roles":[""] in der Nutzlast — Discord
		// lehnt die leere Snowflake mit einem nichtssagenden HTTP 400 ab.
		// willRoles: nil (wie bei den mentionslosen Fällen oben) erwartet,
		// dass der Schlüssel "roles" ganz fehlt statt eine leere Liste mit
		// einem leeren Eintrag zu tragen.
		{MentionRolle, "", []any{}, nil},
	}
	for _, f := range faelle {
		var got empfangen
		srv := server(t, 200, `{"id":"1"}`, &got)

		if _, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
			Inhalt: "@everyone Text", Mention: f.mention, RollenID: f.rollenID,
		}); err != nil {
			t.Fatalf("Sende(%s): %v", f.mention, err)
		}
		srv.Close()

		// allowed_mentions muss bei jedem Mention-Typ gesendet werden,
		// MentionKeine eingeschlossen — sonst entscheidet Discord selbst,
		// wer angepingt wird, statt der hier konfigurierten Begrenzung zu
		// folgen.
		if !got.MentionsVorhanden {
			t.Errorf("%s: allowed_mentions fehlt in der Nutzlast", f.mention)
			continue
		}

		parse, _ := got.Mentions["parse"].([]any)
		if len(parse) != len(f.willParse) {
			t.Errorf("%s: parse = %v, will %v", f.mention, parse, f.willParse)
			continue
		}
		for i := range parse {
			if parse[i] != f.willParse[i] {
				t.Errorf("%s: parse[%d] = %v, will %v", f.mention, i, parse[i], f.willParse[i])
			}
		}
		// willRoles == nil erwartet, dass der Schlüssel "roles" in der
		// Nutzlast ganz fehlt — nicht nur eine leere Liste. len(rollen) !=
		// len(f.willRoles) allein kann das nicht prüfen: ein fehlendes Feld
		// und ein gesendetes, aber leeres "roles":[] ergeben beide
		// len(rollen) == 0. Erst RollenVorhanden unterscheidet die beiden
		// Fälle, genau wie MentionsVorhanden es oben für allowed_mentions
		// selbst tut.
		willRollenVorhanden := f.willRoles != nil
		if got.RollenVorhanden != willRollenVorhanden {
			t.Errorf("%s: RollenVorhanden = %v, will %v (roles = %v)", f.mention, got.RollenVorhanden, willRollenVorhanden, got.Mentions["roles"])
			continue
		}
		if !willRollenVorhanden {
			continue
		}
		rollen, _ := got.Mentions["roles"].([]any)
		if len(rollen) != len(f.willRoles) {
			t.Errorf("%s: roles = %v, will %v", f.mention, rollen, f.willRoles)
			continue
		}
		for i := range rollen {
			if rollen[i] != f.willRoles[i] {
				t.Errorf("%s: roles[%d] = %v, will %v", f.mention, i, rollen[i], f.willRoles[i])
			}
		}
	}
}

func TestMentionKeinePingtNichtTrotzEveryoneImText(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1"}`, &got)
	defer srv.Close()

	if _, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{
		Inhalt: "Test @everyone bitte ignorieren", Mention: MentionKeine,
	}); err != nil {
		t.Fatalf("Sende: %v", err)
	}
	if !got.MentionsVorhanden {
		t.Errorf("allowed_mentions fehlt in der Nutzlast — ohne das Feld entscheidet Discord selbst, wer angepingt wird, und ein Testchannel könnte den ganzen Server aufwecken")
	}
	parse, _ := got.Mentions["parse"].([]any)
	if len(parse) != 0 {
		t.Errorf("parse = %v, will leer — ein Testchannel darf nie den Server anpingen", parse)
	}
}

func TestFehlerklassen(t *testing.T) {
	faelle := []struct {
		status int
		pruef  func(error) bool
		name   string
	}{
		{401, func(e error) bool { return errors.Is(e, ErrWebhookTot) }, "401"},
		{403, func(e error) bool { return errors.Is(e, ErrWebhookTot) }, "403"},
		{404, func(e error) bool { return errors.Is(e, ErrWebhookTot) }, "404"},
		{500, func(e error) bool { var s ErrServer; return errors.As(e, &s) }, "500"},
		{502, func(e error) bool { var s ErrServer; return errors.As(e, &s) }, "502"},
	}
	for _, f := range faelle {
		var got empfangen
		srv := server(t, f.status, `{}`, &got)
		_, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
		srv.Close()
		if err == nil || !f.pruef(err) {
			t.Errorf("HTTP %s: unerwarteter Fehler %v", f.name, err)
		}
	}
}

// TestErfolgOhneNachrichtenIDIstFehler stellt sicher, dass eine 2xx-Antwort
// ohne brauchbare Nachrichten-ID als Fehler zurückkommt. Mit wait=true
// liefert Discord bei jedem echten Erfolg das Nachrichtenobjekt — ein
// unlesbarer oder leerer Body ist also kein stiller Erfolg. Ein Aufrufer,
// der den Versand nur anhand von err bestätigt, darf hier nie grünes Licht
// bekommen.
func TestErfolgOhneNachrichtenIDIstFehler(t *testing.T) {
	faelle := []struct {
		name    string
		antwort string
	}{
		{"kein JSON", "das ist kein JSON"},
		{"leeres Objekt ohne id", `{}`},
	}
	for _, f := range faelle {
		var got empfangen
		srv := server(t, 200, f.antwort, &got)
		erg, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
		srv.Close()
		if !errors.Is(err, ErrKeineNachrichtID) {
			t.Errorf("%s: will ErrKeineNachrichtID, bekam %v", f.name, err)
		}
		if erg.NachrichtID != "" {
			t.Errorf("%s: NachrichtID = %q trotz Fehler, will leer", f.name, erg.NachrichtID)
		}
	}
}

func TestRateLimitTraegtWartezeit(t *testing.T) {
	var got empfangen
	srv := server(t, 429, `{"retry_after":1.5}`, &got)
	defer srv.Close()

	_, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
	var rl ErrRateLimit
	if !errors.As(err, &rl) {
		t.Fatalf("will ErrRateLimit, bekam %v", err)
	}
	if rl.Warten != 1500*time.Millisecond {
		t.Errorf("Warten = %v, will 1.5s", rl.Warten)
	}
}

// TestRateLimitFallbackBeiUnlesbaremBody stellt sicher, dass ein 429 mit
// unlesbarem retry_after nicht in einer Wartezeit von 0 endet — sonst würde
// SendeMitWiederholung sofort erneut zuschlagen, statt Discord überhaupt
// eine Pause zu gönnen.
func TestRateLimitFallbackBeiUnlesbaremBody(t *testing.T) {
	var got empfangen
	srv := server(t, 429, "das ist kein JSON", &got)
	defer srv.Close()

	_, err := Sende(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
	var rl ErrRateLimit
	if !errors.As(err, &rl) {
		t.Fatalf("will ErrRateLimit, bekam %v", err)
	}
	if rl.Warten != time.Second {
		t.Errorf("Warten = %v, will 1s Fallback — sonst hämmert die Wiederholung sofort ohne Pause", rl.Warten)
	}
}

func TestWiederholungBeiServerfehler(t *testing.T) {
	versuche := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		versuche++

		// Der Multipart-Body wird pro Versuch neu aufgebaut. Das hier
		// festzuschreiben schützt vor einer Regression, bei der ein Retry
		// den bereits verbrauchten Body-Reader wiederverwendet und Discord
		// dann leer oder unvollständig erreicht.
		koerper, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("Versuch %d: Body nicht lesbar: %v", versuche, err)
		}
		if len(koerper) == 0 {
			t.Errorf("Versuch %d: Body ist leer", versuche)
		}
		if !bytes.Contains(koerper, []byte(`"content":"x"`)) {
			t.Errorf("Versuch %d: Body trägt nicht den erwarteten Inhalt", versuche)
		}

		if versuche < 3 {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"7"}`)
	}))
	defer srv.Close()

	erg, err := SendeMitWiederholung(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
	if err != nil {
		t.Fatalf("SendeMitWiederholung: %v", err)
	}
	if erg.NachrichtID != "7" {
		t.Errorf("NachrichtID = %q, will 7", erg.NachrichtID)
	}
	if versuche != 3 {
		t.Errorf("%d Versuche, will 3", versuche)
	}
}

func TestKeineWiederholungBeiTotemWebhook(t *testing.T) {
	versuche := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		versuche++
		w.WriteHeader(404)
	}))
	defer srv.Close()

	_, err := SendeMitWiederholung(context.Background(), srv.Client(), srv.URL, Nachricht{Inhalt: "x"})
	if !errors.Is(err, ErrWebhookTot) {
		t.Fatalf("will ErrWebhookTot, bekam %v", err)
	}
	if versuche != 1 {
		t.Errorf("%d Versuche, will 1 — ein toter Webhook wird durch Wiederholen nicht lebendig", versuche)
	}
}

func TestWebhookURLMitVorhandenerQuery(t *testing.T) {
	var got empfangen
	srv := server(t, 200, `{"id":"1"}`, &got)
	defer srv.Close()

	if _, err := Sende(context.Background(), srv.Client(), srv.URL+"?thread_id=42", Nachricht{Inhalt: "x"}); err != nil {
		t.Fatalf("Sende: %v", err)
	}
	if got.WaitFlag != "true" {
		t.Errorf("wait = %q — vorhandene Query-Parameter dürfen wait nicht verdrängen", got.WaitFlag)
	}
	if got.ThreadID != "42" {
		t.Errorf("thread_id = %q, will 42 — vorhandene Query-Parameter dürfen nicht verworfen werden", got.ThreadID)
	}
}

// TestFehlerVerraetNieDenToken ist die Kernaussage dieses Pakets in Sachen
// Geheimnisschutz: eine Webhook-URL ist ein Bearer-Token — wer sie kennt,
// kann in den Channel schreiben. *url.Error (von url.Parse ebenso wie von
// http.Client.Do) zitiert per Error()-Methode aber die komplette
// Anfrage-URL im Klartext, den Token eingeschlossen. Sende und
// SendeMitWiederholung müssen deshalb so gebaut sein, dass keine von ihnen
// zurückgegebene Fehlermeldung die URL je enthält — unabhängig davon, ob
// die URL kaputt, der Host unerreichbar oder die Antwort ein Fehlerstatus
// ist.
//
// Ein Reviewer hat gezeigt, dass ein großgeschriebenes Schema (z. B. durch
// die Autokorrektur einer Mobiltastatur) den bisherigen, nur case-sensitive
// Scrub der Web-Schicht umgeht (`https?://\S*` erkennt "HTTPS://" nicht).
// Der eigentliche Fehler liegt aber hier: die URL darf gar nicht erst in die
// Fehlermeldung gelangen, unabhängig davon, wie die Web-Schicht sie später
// filtert.
func TestFehlerVerraetNieDenToken(t *testing.T) {
	const token = "GEHEIMTOKENXYZ789"
	pfad := "/api/webhooks/123/" + token

	faelle := []struct {
		name   string
		status int    // 0 = kein Server, roh wird direkt als Webhook-URL verwendet
		body   string // Antwortkörper, nur wenn status != 0
		roh    string // vollständige Webhook-URL, nur wenn status == 0
	}{
		{
			name: "URL nicht lesbar (Steuerzeichen)",
			roh:  "https://discord.com" + pfad + "\x7f",
		},
		{
			// Exakt die vom Reviewer gemeldete Byte-Folge: großgeschriebenes
			// Schema plus Steuerzeichen. net/url gibt bei einem Parse-Fehler
			// die rohe Eingabe unverändert zurück — Großschreibung
			// eingeschlossen, weil die Normalisierung des Schemas nie
			// erreicht wird.
			name: "URL nicht lesbar (Schema großgeschrieben)",
			roh:  "HTTPS://discord.com" + pfad + "\x7f",
		},
		{
			// .invalid ist laut RFC 2606 reserviert und löst nie auf — kein
			// echter Server nötig, und es verlässt kein echter DNS-Lookup
			// die Maschine (siehe Task-Report für die Messung).
			name: "Host nicht auflösbar",
			roh:  "https://nicht-da-xyz-999.invalid" + pfad,
		},
		{name: "HTTP 401", status: 401, body: `{}`},
		// Winziges retry_after, damit SendeMitWiederholung (ein Retry bei
		// 429) den Test nicht unnötig ausbremst.
		{name: "HTTP 429", status: 429, body: `{"retry_after":0.001}`},
		{name: "HTTP 500", status: 500, body: `{}`},
		{name: "2xx mit kaputtem Body", status: 200, body: "das ist kein JSON"},
	}

	for _, f := range faelle {
		t.Run(f.name, func(t *testing.T) {
			webhookURL := f.roh
			if f.status != 0 {
				var ziel empfangen
				srv := server(t, f.status, f.body, &ziel)
				t.Cleanup(srv.Close)
				webhookURL = srv.URL + pfad
			}

			// Eigener Client mit Timeout statt srv.Client(): der Fall "Host
			// nicht auflösbar" hat keinen Server, und ein hängender
			// DNS-Lookup darf den Test nicht unbegrenzt blockieren.
			hc := &http.Client{Timeout: 3 * time.Second}

			pruefe := func(quelle string, err error) {
				t.Helper()
				if err == nil {
					t.Fatalf("%s: kein Fehler, obwohl einer erwartet wurde", quelle)
				}
				if strings.Contains(err.Error(), token) {
					t.Errorf("%s: Fehlermeldung verrät den Token: %v", quelle, err)
				}
			}

			_, err := Sende(context.Background(), hc, webhookURL, Nachricht{Inhalt: "x"})
			pruefe("Sende", err)

			_, err = SendeMitWiederholung(context.Background(), hc, webhookURL, Nachricht{Inhalt: "x"})
			pruefe("SendeMitWiederholung", err)
		})
	}
}

// Bearbeiten trifft genau die Nachricht, behält vorhandene Query-Parameter
// (thread_id) und pingt niemanden an.
func TestBearbeiteTrifftDieNachricht(t *testing.T) {
	var methode, pfad, thread string
	var nutzlast struct {
		Content         string         `json:"content"`
		AllowedMentions map[string]any `json:"allowed_mentions"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methode, pfad, thread = r.Method, r.URL.Path, r.URL.Query().Get("thread_id")
		_ = json.NewDecoder(r.Body).Decode(&nutzlast)
		io.WriteString(w, `{"id":"555"}`)
	}))
	defer srv.Close()

	err := Bearbeite(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/tok?thread_id=9", "555", "neu")
	if err != nil {
		t.Fatalf("Bearbeite: %v", err)
	}
	if methode != http.MethodPatch || pfad != "/api/webhooks/1/tok/messages/555" {
		t.Errorf("Anfrage = %s %s", methode, pfad)
	}
	if thread != "9" {
		t.Errorf("thread_id = %q, will 9", thread)
	}
	if nutzlast.Content != "neu" {
		t.Errorf("content = %q", nutzlast.Content)
	}
	if p, _ := nutzlast.AllowedMentions["parse"].([]any); nutzlast.AllowedMentions == nil || len(p) != 0 {
		t.Errorf("allowed_mentions = %v, will leeres parse", nutzlast.AllowedMentions)
	}
}

func TestLoescheUndSchonGeloescht(t *testing.T) {
	var methode string
	status, antwort := http.StatusNoContent, ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methode = r.Method
		w.WriteHeader(status)
		io.WriteString(w, antwort)
	}))
	defer srv.Close()

	if err := Loesche(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/tok", "555"); err != nil {
		t.Fatalf("Loesche: %v", err)
	}
	if methode != http.MethodDelete {
		t.Errorf("Methode = %s", methode)
	}

	// In Discord schon von Hand gelöscht: das Ziel ist erreicht.
	status, antwort = http.StatusNotFound, `{"message":"Unknown Message","code":10008}`
	if err := Loesche(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/tok", "555"); err != nil {
		t.Errorf("schon gelöschte Nachricht: %v", err)
	}

	// Ein 404 ohne diesen Code ist der Webhook selbst.
	status, antwort = http.StatusNotFound, `{"message":"Unknown Webhook","code":10015}`
	if err := Loesche(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/tok", "555"); !errors.Is(err, ErrWebhookTot) {
		t.Errorf("toter Webhook: %v", err)
	}
}

func TestBearbeiteVerschwundeneNachricht(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		io.WriteString(w, `{"message":"Unknown Message","code":10008}`)
	}))
	defer srv.Close()

	err := Bearbeite(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/tok", "555", "x")
	if !errors.Is(err, ErrNachrichtWeg) {
		t.Errorf("Fehler = %v, will ErrNachrichtWeg", err)
	}
}

// Posts gehen ohne Link-Vorschaukästen hinaus (SUPPRESS_EMBEDS), auch nach
// dem Bearbeiten — die Kästen machten jeden Deal auf dem Handy lang.
func TestOhneLinkVorschau(t *testing.T) {
	var e empfangen
	srv := server(t, http.StatusOK, `{"id":"1","channel_id":"2"}`, &e)
	defer srv.Close()
	if _, err := Sende(context.Background(), srv.Client(), srv.URL+"/api/webhooks/1/x", Nachricht{Inhalt: "Deal"}); err != nil {
		t.Fatal(err)
	}
	if e.Flags != 4 {
		t.Errorf("flags beim Senden = %d, will 4", e.Flags)
	}

	var patch struct {
		Flags int `json:"flags"`
	}
	ps := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&patch)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"1","channel_id":"2"}`)
	}))
	defer ps.Close()
	if err := Bearbeite(context.Background(), ps.Client(), ps.URL+"/api/webhooks/1/x", "1", "neu"); err != nil {
		t.Fatal(err)
	}
	if patch.Flags != 4 {
		t.Errorf("flags beim Bearbeiten = %d, will 4", patch.Flags)
	}
}
