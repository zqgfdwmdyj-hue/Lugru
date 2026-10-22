package web

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

func TestAlteDealsEinlesen(t *testing.T) {
	srv, s, _, _ := aufbau(t)
	bot := neuerBotStub(t)
	srv.botBasisURL = bot.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselBotToken, "geheim")
	_ = s.SetzeEinstellung(store.SchluesselPoster, "ludwig=111111\nk95\nmarkah")

	// thread_id in der Adresse: der Channel steht fest, ohne Webhook-Anfrage.
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "admin-deals", Gruppe: "Server 1",
		WebhookURL: "https://discord.com/api/webhooks/1/x?thread_id=777"})
	c, _ := s.Channel(cid)

	nachricht := func(id, text, autorID, name string, zeit time.Time, reaktionen string) map[string]any {
		var r any
		_ = json.Unmarshal([]byte(reaktionen), &r)
		return map[string]any{"id": id, "content": text, "timestamp": zeit.Format(time.RFC3339),
			"author": map[string]any{"id": autorID, "username": name, "global_name": nil}, "reactions": r}
	}
	jetzt := time.Now().Truncate(time.Second)
	seite, _ := json.Marshal([]any{
		nachricht("3", "Wer hat noch Kartons?", "222", "k95", jetzt, `[]`),
		nachricht("2", strings.ReplaceAll(handPostText, "\\n", "\n"), "222", "k95 | FBA", jetzt.Add(-time.Hour),
			`[{"count":2,"me":false,"emoji":{"id":null,"name":"✅"}}]`),
		nachricht("1", "🛒 Makita HR2630 @everyone\n💰 EK: 130,56 €\n💸 VK: 207,49 € [Amazon.DE](https://www.amazon.de/dp/B01636IZ0G)\n"+
			"🤑 Gewinn: -5,77 € / -19,2 % Marge\n🇪🇺 mit Pan-EU: 5,12 € / 17,1 % Marge", "111111", "lu", jetzt.Add(-2*time.Hour), `[]`),
	})
	bot.antwort = string(seite)

	srv.einlesenDurchgang(context.Background(), "geheim", []store.Channel{c}, time.Time{})

	h := hole(t, srv, http.MethodGet, "/einlesen", "").Body.String()
	for _, will := range []string{"2 Deals erkannt", "Logitech MX Creative Console", "@k95", "@ludwig", "Pan-EU", "3 Nachrichten gelesen"} {
		if !strings.Contains(h, will) {
			t.Errorf("Vorschau ohne %q", will)
		}
	}
	if n, _ := s.Deals(store.DealFilter{}); len(n) != 0 {
		t.Fatalf("vor dem Bestätigen gespeichert: %d", len(n))
	}

	// Nur den Logitech-Post übernehmen.
	w := hole(t, srv, http.MethodPost, "/einlesen/uebernehmen", url.Values{"nachricht": {"2"}}.Encode())
	if !strings.Contains(w.Header().Get("Location"), "1+alte+Deals") {
		t.Errorf("Weiterleitung = %q", w.Header().Get("Location"))
	}
	ds, _ := s.Deals(store.DealFilter{})
	if len(ds) != 1 {
		t.Fatalf("%d Deals gespeichert", len(ds))
	}
	d := ds[0]
	if !d.Importiert || d.ASIN != "B0DFQXJ3N7" || d.GewinnCent != 3090 || d.Poster != "k95" || d.Kaeufe != 2 ||
		d.Gruppe != "Server 1" || d.ChannelName != "admin-deals" || d.DiscordNachrichtID != "2" ||
		!d.GepostetAm.Equal(jetzt.Add(-time.Hour)) {
		t.Errorf("gespeichert: %+v", d)
	}
	if h := hole(t, srv, http.MethodGet, "/historie", "").Body.String(); !strings.Contains(h, "aus Discord") {
		t.Errorf("Historie ohne Kennzeichen")
	}

	// Zweiter Durchgang: der übernommene Post ist schon da. Der Pan-EU-Deal
	// zählt in der Statistik mit seinem Pan-EU-Gewinn.
	srv.einlesenDurchgang(context.Background(), "geheim", []store.Channel{c}, time.Time{})
	if srv.einlesen.schonDa != 1 || len(srv.einlesen.treffer) != 1 {
		t.Fatalf("schonDa=%d treffer=%d", srv.einlesen.schonDa, len(srv.einlesen.treffer))
	}
	hole(t, srv, http.MethodPost, "/einlesen/uebernehmen", url.Values{"nachricht": {"1"}}.Encode())
	st, _ := s.Statistik(time.Time{}, time.Time{}, "")
	if st.Gesamt.Anzahl != 2 || st.Gesamt.Gewinn != 3090+512 {
		t.Errorf("Statistik: %d Deals, %v", st.Gesamt.Anzahl, st.Gesamt.Gewinn)
	}
}

// Kommt nirgends Text an, fehlt dem Bot die Message-Content-Berechtigung.
func TestEinlesenOhneMessageContent(t *testing.T) {
	srv, s, _, _ := aufbau(t)
	bot := neuerBotStub(t)
	srv.botBasisURL = bot.srv.URL
	_ = s.SetzeEinstellung(store.SchluesselBotToken, "geheim")
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "x", WebhookURL: "https://discord.com/api/webhooks/1/x?thread_id=777"})
	c, _ := s.Channel(cid)
	bot.antwort = `[{"id":"1","content":"","timestamp":"2026-09-01T10:00:00Z","author":{"id":"2","username":"k95"},"attachments":[{}]}]`
	srv.einlesenDurchgang(context.Background(), "geheim", []store.Channel{c}, time.Time{})
	if h := hole(t, srv, http.MethodGet, "/einlesen", "").Body.String(); !strings.Contains(h, "Message Content Intent") {
		t.Errorf("kein Hinweis auf Message Content")
	}
}

const handPostText = "🛒 Logitech MX Creative Console, Programmierbares Tastenfeld @everyone\n" +
	"🏬 [mediamarkt.de](https://www.mediamarkt.de/de/product/_logitech-123.html)\n" +
	"💰 EK: 99.99 € Brutto inkl. Versand\n" +
	"💸 VK: 164.99 €  [Amazon.DE](https://www.amazon.de/dp/B0DFQXJ3N7)\n" +
	"ℹ️ Amazon.DE: 50+ Verkäufe\n" +
	"🤑 Gewinn: 30.9 € / 19 % Marge"

// Ein falsch eingelesener Deal wird beim Nachprüfen aus seinem Posttext
// berichtigt; Deals des Tools bleiben unberührt.
func TestEingeleseneNachpruefen(t *testing.T) {
	srv, s, _, cid := aufbau(t)
	text := "🛒 Moschino Fresh Couture B0CXYZ1234 @everyone\n💰 EK: 25,50 €\n" +
		"💸 VK: 39,00 € [Amazon.DE](https://www.amazon.de/dp/B0CXYZ1234)\n🤑 Gewinn: 7.848 € / 80110038380 % Marge"
	falsch, _ := s.DealAnlegen(store.Deal{ASIN: "B0CXYZ1234", Titel: "Moschino Fresh Couture B0CXYZ1234", Quellmarkt: "DE",
		Zielmarkt: "DE", EKCent: 2550, VKCent: 3900, GewinnCent: 784800, MargeProzent: 80110038380,
		ChannelID: cid, ChannelName: "deals", Status: store.StatusAktiv, NachrichtText: text, Importiert: true,
		Maerkte: []store.DealMarkt{{Markt: "DE", Leitmarkt: true, VKCent: 3900, GewinnCent: 784800, MargeProzent: 80110038380}}})
	eigen := postenMit(t, srv, s, referenzFormular(cid))
	vorher, _ := s.Deal(eigen)

	if n, u := srv.EingeleseneNachpruefen(); n != 1 || u != 0 {
		t.Errorf("berichtigt=%d unlesbar=%d", n, u)
	}
	d, _ := s.Deal(falsch)
	if d.GewinnCent != 785 || d.MargeProzent != 20.1 || d.EffGewinnCent != 785 || d.Titel != "Moschino Fresh Couture" {
		t.Errorf("nicht berichtigt: %+v", d)
	}
	if nachher, _ := s.Deal(eigen); nachher.GewinnCent != vorher.GewinnCent || nachher.Titel != vorher.Titel {
		t.Errorf("Deal des Tools verändert")
	}
	// Zweiter Lauf: nichts mehr zu tun.
	if n, u := srv.EingeleseneNachpruefen(); n != 0 || u != 0 {
		t.Errorf("zweiter Lauf: %d/%d", n, u)
	}
}
