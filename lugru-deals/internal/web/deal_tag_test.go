package web

import (
	"net/http"
	"strings"
	"testing"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// tagAnlegen legt einen Tag an und macht ihn zum Standard seines Marktes.
func tagAnlegen(t *testing.T, s *store.Store, name, tag, markt string, standard bool) int64 {
	t.Helper()
	id, err := s.TagAnlegen(store.AffiliateTag{Name: name, Tag: tag, Markt: markt})
	if err != nil {
		t.Fatalf("TagAnlegen: %v", err)
	}
	if standard {
		if err := s.TagStandardSetzen(id); err != nil {
			t.Fatalf("TagStandardSetzen: %v", err)
		}
	}
	return id
}

// vorschau ruft Schritt 4 mit dem Referenzfall auf (Einkauf ES, Ziel DE).
func vorschau(t *testing.T, srv *Server, werte interface{ Encode() string }) string {
	t.Helper()
	w := hole(t, srv, http.MethodPost, "/deal/vorschau", werte.Encode())
	if w.Code != http.StatusOK {
		t.Fatalf("Status = %d: %s", w.Code, w.Body.String())
	}
	return w.Body.String()
}

// Ohne mitgeschicktes tag.DE — der Zustand beim ersten Betreten von Schritt 4
// aus Schritt 3 heraus. Der Standard des Zielmarkts muss greifen, sonst wäre
// „als Standard markiert" wirkungslos.
func TestVerkaufslinkTraegtStandardTagDesZielmarkts(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-21", "DE", true)

	koerper := vorschau(t, srv, referenzFormular(cid))

	if !strings.Contains(koerper, "https://www.amazon.de/dp/B01636IZ0G?tag=lugru-21") {
		t.Errorf("Verkaufslink ohne Standard-Tag:\n%s", koerper)
	}
	if strings.Contains(koerper, "ohne Affiliate-Tag") {
		t.Error("Hinweis erscheint, obwohl ein Standard-Tag gesetzt ist")
	}
}

// tag.DE=0 ist die ausdrückliche Wahl „kein Tag" im Auswahlfeld. Sie muss
// den Standard schlagen — sonst gäbe es keinen Weg, bewusst ohne Tag zu
// posten.
func TestAusdruecklichKeinTagSchlaegtDenStandard(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-21", "DE", true)

	koerper := vorschau(t, srv, mitMarktFeld(referenzFormular(cid), "tag", "DE", "0"))

	if strings.Contains(koerper, "tag=lugru-21") {
		t.Errorf("Tag trotz ausdrücklicher Abwahl im Post:\n%s", koerper)
	}
	if !strings.Contains(koerper, "ohne Affiliate-Tag") {
		t.Errorf("Hinweis auf den fehlenden Tag fehlt:\n%s", koerper)
	}
}

// Der Alltagsfall: aus Schritt 4 zurück, in Schritt 2 den Zielmarkt gewechselt,
// wieder vor. Die mitgetragene Tag-ID gehört dann zum alten Markt. Sie darf
// nicht angeklebt werden — ein ES-Tag verdient auf amazon.de nichts.
func TestTagDesFalschenMarktesFaelltAufDenStandard(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	esID := tagAnlegen(t, s, "Spanien", "lugru-es-21", "ES", true)
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-de-21", "DE", true)

	koerper := vorschau(t, srv, mitMarktFeld(referenzFormular(cid), "tag", "DE", itoa(esID)))

	if !strings.Contains(koerper, "https://www.amazon.de/dp/B01636IZ0G?tag=lugru-de-21") {
		t.Errorf("Verkaufslink trägt nicht den DE-Standard:\n%s", koerper)
	}
	if strings.Contains(koerper, "amazon.de/dp/B01636IZ0G?tag=lugru-es-21") {
		t.Errorf("ES-Tag klebt am DE-Verkaufslink:\n%s", koerper)
	}
}

// Der Einkauf läuft im Referenzfall über amazon.es. Der Einkaufslink muss
// darum den ES-Standard tragen, nicht den des Zielmarkts.
func TestEinkaufslinkTraegtStandardTagSeinesEigenenMarktes(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Spanien", "lugru-es-21", "ES", true)
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-de-21", "DE", true)

	koerper := vorschau(t, srv, referenzFormular(cid))

	if !strings.Contains(koerper, "https://www.amazon.es/dp/B01636IZ0G?tag=lugru-es-21") {
		t.Errorf("Einkaufslink trägt nicht den ES-Standard:\n%s", koerper)
	}
	if strings.Contains(koerper, "amazon.es/dp/B01636IZ0G?tag=lugru-de-21") {
		t.Errorf("DE-Tag klebt am ES-Einkaufslink:\n%s", koerper)
	}
}

// Ein Fremdshop ist kein Amazon-Marktplatz und hat keinen Tag — auch dann
// nicht, wenn für das Einkaufsland ein Standard hinterlegt ist.
func TestFremdshopEinkaufslinkBleibtUngetaggt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Spanien", "lugru-es-21", "ES", true)

	f := mitFeld(referenzFormular(cid), "quell_url", "https://www.mediamarkt.es/de/product/foo")
	koerper := vorschau(t, srv, f)

	// Der ganze Link auf einmal, Adresse und Beschriftung: so schlägt der
	// Test sowohl an, wenn ein Tag angehängt wird, als auch wenn der
	// Fremdshop-Link durch die amazon.es-Produktseite ersetzt wird. Nur auf
	// "?tag=" hinter mediamarkt.es zu prüfen bewies nichts — bei einer
	// Ersetzung kommt der Host im Post gar nicht mehr vor.
	const willLink = `<a href="https://www.mediamarkt.es/de/product/foo" target="_blank" rel="noreferrer">mediamarkt.es</a>`
	if !strings.Contains(koerper, willLink) {
		t.Errorf("Fremdshop-Link steht nicht unverändert im Post, will %q:\n%s", willLink, koerper)
	}
}

// Der ArbitrageOne-Export bekommt den Einkaufslink als Parameter source_url.
// Dort hat ein Affiliate-Tag nichts zu suchen: der Link geht an ein
// Analysewerkzeug, nicht an einen Käufer. Derselbe Wert landet als quell_url
// in der Historie — ein Tag hier sickerte in beides durch.
func TestArbitrageOneQuelleBleibtUngetaggt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Spanien", "lugru-es-21", "ES", true)
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-de-21", "DE", true)

	koerper := vorschau(t, srv, referenzFormular(cid))

	// source_url ist im ArbitrageOne-Link kodiert: aus "?tag=" würde
	// "%3Ftag%3D".
	if strings.Contains(koerper, "%3Ftag%3D") {
		t.Errorf("Affiliate-Tag im ArbitrageOne-Parameter source_url:\n%s", koerper)
	}
}

// Das Auswahlfeld darf nur Tags des Zielmarkts anbieten — sonst wäre die
// Marktbindung eine Empfehlung statt einer Regel.
func TestTagAuswahlZeigtNurTagsDesZielmarkts(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Spanien", "lugru-es-21", "ES", true)
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-de-21", "DE", true)
	tagAnlegen(t, s, "Zweitkonto DE", "lugru-de2-21", "DE", false)

	koerper := vorschau(t, srv, referenzFormular(cid))

	for _, muss := range []string{"Hauptkonto DE", "Zweitkonto DE", "— kein Tag —"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Auswahlfeld enthält %q nicht:\n%s", muss, koerper)
		}
	}
	if strings.Contains(koerper, "Spanien") {
		t.Errorf("Auswahlfeld bietet einen ES-Tag an, obwohl der Zielmarkt DE ist:\n%s", koerper)
	}
}

// „Kein Tag" in Schritt 4 gilt dem Verkaufslink. Der Einkaufslink hängt nicht
// an dieser Wahl — sein Tag folgt dem Einkaufsmarkt und wird gar nicht
// abgefragt. Der Hinweis darf darum nicht behaupten, im Post verdiene kein
// Link mehr etwas: das wäre für den Einkaufslink schlicht falsch.
func TestAbgewaehlterVerkaufstagLaesstDenEinkaufstagStehen(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Spanien", "lugru-es-21", "ES", true)
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-de-21", "DE", true)

	koerper := vorschau(t, srv, mitMarktFeld(referenzFormular(cid), "tag", "DE", "0"))

	if !strings.Contains(koerper, "https://www.amazon.es/dp/B01636IZ0G?tag=lugru-es-21") {
		t.Errorf("Einkaufslink hat seinen Tag verloren:\n%s", koerper)
	}
	if strings.Contains(koerper, "amazon.de/dp/B01636IZ0G?tag=") {
		t.Errorf("Verkaufslink trägt trotz Abwahl einen Tag:\n%s", koerper)
	}
	if !strings.Contains(koerper, "der Verkaufslink verdient dort keine Provision") {
		t.Errorf("Hinweis spricht nicht genau vom Verkaufslink:\n%s", koerper)
	}
}

// Jeder Zielmarkt löst seinen Affiliate-Tag über srv.vkTag(f, m.Ziel.Code)
// auf — den EIGENEN Markt, nicht den des Leitmarkts. Alle Tag-Tests oben
// prüfen das nur am referenzFormular mit genau einem Markt, wo Leitmarkt und
// einziger Markt zusammenfallen und ein versehentlicher Tausch gegen
// leit.Ziel.Code gar nicht auffiele. Ohne diese Zusicherung könnte ein
// DE-Tag an einem amazon.it-Link landen: er verdient dort nichts, und
// niemand sähe es dem Link an (siehe der Kommentar an vkTag).
func TestJederMarktTraegtSeinenEigenenStandardTag(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "c", WebhookURL: "https://x/1"})
	tagAnlegen(t, s, "Hauptkonto DE", "lugru-de-21", "DE", true)
	tagAnlegen(t, s, "Hauptkonto IT", "lugru-it-21", "IT", true)

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	koerper := vorschau(t, srv, v)

	if !strings.Contains(koerper, "https://www.amazon.de/dp/B01636IZ0G?tag=lugru-de-21") {
		t.Errorf("amazon.de-Verkaufslink trägt nicht den DE-Standard:\n%s", koerper)
	}
	if !strings.Contains(koerper, "https://www.amazon.it/dp/B01636IZ0G?tag=lugru-it-21") {
		t.Errorf("amazon.it-Verkaufslink trägt nicht den IT-Standard:\n%s", koerper)
	}
	if strings.Contains(koerper, "amazon.it/dp/B01636IZ0G?tag=lugru-de-21") {
		t.Errorf("der DE-Tag des Leitmarkts klebt am amazon.it-Verkaufslink:\n%s", koerper)
	}
}

// Schritt 4 bot bislang genau ein Auswahlfeld an — das des Leitmarkts. Wer
// für Italien einen anderen als den Standard-Tag wollte, konnte ihn gar
// nicht wählen. Diese Zusicherung prüft, dass jeder gewählte Markt sein
// eigenes Feld mit seinen eigenen Tags bekommt.
func TestSchritt4BietetJedemMarktSeinenTag(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: "https://x/1"})
	// tagAnlegen statt store.TagAnlegen: letzteres verwirft das Standard-Feld
	// absichtlich (siehe den Kommentar dort — der Weg zum Standard führt
	// ausschließlich über TagStandardSetzen). Mit store.TagAnlegen hätte
	// dieser Test überhaupt keinen Standard-Tag, beide Märkte zeigten ihren
	// "ohne Affiliate-Tag"-Hinweis, kein Link trüge ein ?tag= — und er wäre
	// trotzdem grün, weil er nur Feldnamen und Optionstexte prüft.
	tagAnlegen(t, s, "DE-Tag", "lugru-de-21", "DE", true)
	tagAnlegen(t, s, "IT-Tag", "lugru-it-21", "IT", true)

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode())
	koerper := w.Body.String()

	for _, muss := range []string{`name="tag.DE"`, `name="tag.IT"`, "lugru-de-21", "lugru-it-21"} {
		if !strings.Contains(koerper, muss) {
			t.Errorf("Schritt 4 enthält %q nicht:\n%s", muss, koerper)
		}
	}

	// Und jeder Markt hat SEINEN Tag vorgewählt und im Link — das ist die
	// eigentliche Zusicherung. Ohne sie bliebe der Test grün, während beide
	// Auswahlfelder auf "kein Tag" stünden.
	if !strings.Contains(koerper, "?tag=lugru-de-21") || !strings.Contains(koerper, "?tag=lugru-it-21") {
		t.Errorf("nicht jeder Markt trägt seinen Tag im Link:\n%s", koerper)
	}
	if n := strings.Count(koerper, "selected"); n < 2 {
		t.Errorf("%d vorgewählte Tags, will mindestens zwei:\n%s", n, koerper)
	}
}

// Eine eigene Notiz steht in der Karte, und die Märkte stehen als Felder
// daneben. Beide Tests prüften früher einen Hinweis, den es nicht mehr gibt:
// Er sagte, eine alte Vorlage kenne die Marktzeilen nicht und die weiteren
// Märkte würden angehängt. Seit die Karte je Markt ein Feld baut, kann kein
// Markt mehr fehlen — der Hinweis wäre eine Warnung vor nichts.
func TestNotizStehtInDerKarteUndVerdraengtKeinenMarkt(t *testing.T) {
	srv, s := testServer(t)
	cid, _ := s.ChannelAnlegen(store.Channel{Name: "deals", WebhookURL: "https://x/1"})
	_ = s.SetzeEinstellung(store.SchluesselVorlage, "Nur 3 Stück verfügbar")

	v := zweiMaerkte()
	v.Set("channel_id", itoa(cid))

	w := hole(t, srv, http.MethodPost, "/deal/vorschau", v.Encode())
	koerper := w.Body.String()

	if !strings.Contains(koerper, "Nur 3 Stück verfügbar") {
		t.Errorf("die Notiz steht nicht im Post:\n%s", koerper)
	}
	for _, markt := range []string{"Amazon.DE", "Amazon.IT"} {
		if !strings.Contains(koerper, markt) {
			t.Errorf("die Karte nennt %s nicht:\n%s", markt, koerper)
		}
	}
}
