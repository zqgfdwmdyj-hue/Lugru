// Das Formular des Deal-Funnels: die Rohwerte, wie sie aus dem Browser
// kommen, und ihre Prüfung. Getrennt von den Handlern in deal.go, weil jedes
// Feld hier eine eigene Begründung trägt — was geprüft wird und warum — und
// diese Begründungen zwischen den Handlern untergingen.
package web

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/bild"
	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/post"
)

// dealFormular sind die Rohwerte aus dem Formular, alle als Text.
type dealFormular struct {
	// Einkaufslink ist die Roheingabe aus Schritt 1. Sie wird durch den
	// ganzen Funnel mitgetragen, damit "Zurück" den Link wieder im Feld
	// stehen hat, statt ihn neu abzuverlangen.
	Einkaufslink string

	// LinkBestaetigt ist der Einkaufslink, zu dem die von Hand
	// nachgetragenen Angaben (ASIN, Einkaufsland) gehören. Steht im
	// Linkfeld inzwischen ein anderer, gelten sie nicht mehr — siehe
	// preisDeal.
	LinkBestaetigt string

	ASIN       string
	Quellmarkt string
	// QuellURL ist der Einkaufslink eines Fremdshops. Leer, sobald bei
	// Amazon eingekauft wird — dort ergibt sich die Produktseite aus
	// Quellmarkt und ASIN.
	QuellURL string
	Titel    string

	// Leitmarkt ist der Markt, an dem alles hängt, was es nur einmal geben
	// kann: Artikelname, Produktbild, Chart, der ArbitrageOne-Link und die
	// Zahlen der Historienzeile. Leer, solange kein Markt gewählt ist.
	Leitmarkt marketplace.Code

	// Maerkte sind die gewählten Zielmärkte in Auswahlreihenfolge. Ein Markt
	// ist der Sonderfall "Liste mit einem Element" — es gibt keinen zweiten
	// Codepfad für ihn.
	Maerkte []marktFormular

	EK string
	// EKArt ist der Schalter aus Schritt 2: "netto" oder "brutto".
	EKArt   string
	EKNotiz string

	// MaxMenge ist die Höchstmenge je Bestellung (Cart-Limit), wie
	// eingegeben. Leer heißt: keine. Geprüft wird sie in maxMengeZahl.
	MaxMenge string

	// Zusatz sind freie Zeilen für den Post (ETA, MOQ …).
	Zusatz string

	// GewinnManuell und MargeManuell ersetzen, wenn gesetzt, Gewinn und
	// Marge des Leitmarkts — für die paar Cent, um die ein anderer Rechner
	// abweicht. Leer heißt: wie gerechnet.
	GewinnManuell string
	MargeManuell  string
	// Dasselbe für die Pan-EU-Zeile.
	GewinnPanEUManuell string
	MargePanEUManuell  string

	// VerkaufsLinie zeigt im langen Chart die Linie "Monatlich verkauft".
	VerkaufsLinie bool

	// TitelManuell: der Artikelname wurde in Schritt 3 von Hand geändert,
	// und zwar für die ASIN TitelASIN. Dann bleibt er, auch wenn Keepa neu
	// geladen wird.
	TitelManuell bool
	TitelASIN    string

	// WeitereLinks sind bis zu drei weitere Einkaufslinks.
	WeitereLinks []string

	// WeitereChannels sind Channels, in die derselbe Deal zusätzlich geht.
	WeitereChannels []int64

	UStModus string

	// Steuersatz ist "ermaessigt" für Waren mit ermäßigtem Umsatzsteuersatz
	// (in Deutschland 7 % statt 19 %), sonst "normal". Er gilt für Einkauf
	// und Verkauf gleichermaßen — der Satz hängt an der Ware, nicht am Land.
	Steuersatz string
	ChannelID  int64

	// OhneLink ist ein Einkauf ohne Link, etwa beim Großhandel. Gekauft
	// wird dann bei Lieferant (freier Name, darf leer sein); die ASIN wird
	// von Hand eingetragen, das Einkaufsland legt nur die Umsatzsteuer fest.
	OhneLink  bool
	Lieferant string

	// Poster ist, wer den Deal postet (Name aus der Einstellung). Fehlt er
	// im Formular, gilt der zuletzt in diesem Browser gewählte.
	Poster string

	// EntwurfID ist der Entwurf, aus dem dieser Deal stammt oder unter dem
	// er zuletzt gespeichert wurde, 0 ohne Entwurf. Nach dem Posten wird der
	// Entwurf gelöscht.
	EntwurfID int64

	// BildKennung kommt aus Keepa, reist aber als verstecktes Feld durch den
	// Browser — sie wird darum in formularLesen geprüft wie jede andere
	// Eingabe auch.
	BildKennung string

	// Masse sind die Paketmaße aus Keepa. Sie reisen mit, weil Schritt 4 den
	// Post allein aus dem Formular baut und dort keine Keepa-Antwort mehr
	// vorliegt — ohne sie ließe sich die Pan-EU-Alternative nicht rechnen.
	// Wie BildKennung kommen sie aus Keepa und werden trotzdem geprüft:
	// zwischen Keepa und hier liegt ein Browser.
	Masse fba.Masse
}

// marktFormular sind die Rohwerte eines einzelnen Zielmarkts, alle als Text.
//
// Diese fünf Größen gelten je Markt und nicht je Deal: Keepa liefert
// Verkaufspreis, Verkaufszahl, Provision und FBA-Gebühr immer für genau eine
// Domain, und ein Affiliate-Tag verdient nur auf dem Markt, für den er
// ausgestellt wurde.
type marktFormular struct {
	Code marketplace.Code

	VK        string
	VKQuelle  string
	ZielMarge string

	Sales       string
	SalesQuelle string

	Provision       string
	ProvisionQuelle string

	FBA       string
	FBAQuelle string

	// Kandidaten und SalesHinweis sind Anzeige, keine Eingabe: die
	// Vorschlagsliste für den Verkaufspreis und die Auskunft, woher die
	// Verkaufszahl stammt. Sie stehen hier statt in einer zweiten Liste
	// neben dieser, weil sie zu genau diesem Markt gehören — zwei parallele
	// Listen müssten von Hand synchron gehalten werden, und still
	// auseinanderlaufende Sichten auf dieselben Zahlen sind genau der
	// Fehler, gegen den schon das Marktsuffix gebaut ist.
	Kandidaten   []kandidat
	SalesHinweis string

	// TagID ist der gewählte Affiliate-Tag, 0 für "kein Tag". TagGesetzt
	// sagt, ob das Feld überhaupt mitgeschickt wurde — die beiden Zustände
	// sind nicht dasselbe: eine Anfrage aus Schritt 3 kennt das Auswahlfeld
	// noch gar nicht und soll den Standard des Marktes bekommen, während
	// eine 0 aus Schritt 4 die ausdrückliche Wahl "kein Tag" ist. Ohne die
	// Unterscheidung könnte ein als Standard markierter Tag nie greifen.
	// Dieselbe Überlegung wie bei r.PostForm.Has in settings.go.
	TagID      int64
	TagGesetzt bool
}

// Markt sucht den Eintrag eines Marktes.
func (f dealFormular) Markt(c marketplace.Code) (marktFormular, bool) {
	for _, m := range f.Maerkte {
		if m.Code == c {
			return m, true
		}
	}
	return marktFormular{}, false
}

// MarktGewaehlt sagt, ob ein Markt angehakt ist. Für die Vorlage —
// html/template kann nicht suchen.
func (f dealFormular) MarktGewaehlt(c marketplace.Code) bool {
	_, ok := f.Markt(c)
	return ok
}

// Leit liefert den Eintrag des Leitmarkts.
//
// Ohne gewählten Markt kommt der Nullwert zurück und kein Indexfehler: die
// Aufrufer prüfen den Deal ohnehin, und ein Absturz mitten in Schritt 3 wäre
// die schlechteste Art, "bitte einen Markt wählen" zu sagen.
func (f dealFormular) Leit() marktFormular {
	m, _ := f.Markt(f.Leitmarkt)
	return m
}

// marktZeiger liefert den Eintrag eines Marktes zum Schreiben. nil, wenn der
// Markt nicht gewählt ist — die Aufrufer füllen dann nichts, statt einen
// Eintrag zu erfinden, den niemand angehakt hat.
//
// Markt() daneben liefert eine Kopie und ist für alles gedacht, was nur
// liest; dieser Zeiger ist der einzige Weg, in einen Markt zu schreiben.
func (f *dealFormular) marktZeiger(c marketplace.Code) *marktFormular {
	for i := range f.Maerkte {
		if f.Maerkte[i].Code == c {
			return &f.Maerkte[i]
		}
	}
	return nil
}

// leitmarktAufloesen bestimmt den Leitmarkt aus dem Formularfeld.
//
// Steht dort ein Markt, der gar nicht (mehr) gewählt ist, rückt der erste
// gewählte nach. Das ist kein Angriff, sondern Alltag: wer in Schritt 2 ein
// Kästchen abhakt, trägt den alten Leitmarkt in einem verborgenen Feld noch
// mit — dieselbe Überlegung wie bei vkTag und einer stehengebliebenen Tag-ID.
func leitmarktAufloesen(gewuenscht string, maerkte []marktFormular) marketplace.Code {
	if len(maerkte) == 0 {
		return ""
	}
	c := marketplace.Code(strings.ToUpper(strings.TrimSpace(gewuenscht)))
	for _, m := range maerkte {
		if m.Code == c {
			return c
		}
	}
	return maerkte[0].Code
}

func formularLesen(r *http.Request) dealFormular {
	id, _ := strconv.ParseInt(r.PostForm.Get("channel_id"), 10, 64)
	entwurfID, _ := strconv.ParseInt(r.PostForm.Get("entwurf_id"), 10, 64)

	// Die marktabhängigen Felder tragen ihr Marktkürzel als Suffix
	// ("vk.IT"). Eine laufende Nummer wäre die naheliegendere Wahl und die
	// falsche: wer einen Markt abwählt, verschöbe damit jede folgende
	// Nummer, und die Werte erbten still den Nachbarn. Ein Marktkürzel
	// verschiebt sich nicht.
	//
	// Gelesen wird ausschließlich, was zu einem gewählten und von
	// marketplace.Codes bestätigten Markt gehört — ein mitgeschicktes
	// "vk.XX" fällt damit weg, statt einen fünften Markt zu erfinden.
	gewaehlt := marketplace.Codes(r.PostForm["zielmarkt"])
	maerkte := make([]marktFormular, 0, len(gewaehlt))
	for _, m := range gewaehlt {
		s := string(m.Code)
		mf := marktFormular{
			Code:            m.Code,
			VK:              r.PostForm.Get("vk." + s),
			VKQuelle:        r.PostForm.Get("vk_quelle." + s),
			ZielMarge:       r.PostForm.Get("zielmarge." + s),
			Sales:           r.PostForm.Get("sales." + s),
			SalesQuelle:     r.PostForm.Get("sales_quelle." + s),
			Provision:       r.PostForm.Get("provision." + s),
			ProvisionQuelle: r.PostForm.Get("provision_quelle." + s),
			FBA:             r.PostForm.Get("fba." + s),
			FBAQuelle:       r.PostForm.Get("fba_quelle." + s),
			TagGesetzt:      r.PostForm.Has("tag." + s),
		}
		if mf.TagGesetzt {
			mf.TagID, _ = strconv.ParseInt(r.PostForm.Get("tag."+s), 10, 64)
		}
		maerkte = append(maerkte, mf)
	}

	// Der USt-Modus wird nicht mehr erfragt, sondern steht fest auf netto:
	// bei Reverse Charge stellt Amazon einem Geschäftskunden ohne
	// Umsatzsteuer, es gibt also gar keine Vorsteuer, die abziehbar oder
	// nicht abziehbar sein könnte. Als Kosten zählt damit immer die
	// Nettogröße — genau das war bisher schon die Vorgabe, an bestehenden
	// Gewinnzahlen ändert sich nichts.
	//
	// Bewusst wird r.PostForm hier nicht gelesen: ein von Hand
	// mitgeschicktes ust_modus=brutto darf die Rechnung nicht mehr
	// beeinflussen.
	const ustModus = "netto"

	// Dieselbe Überlegung für den Netto/Brutto-Schalter: die Auswahlknöpfe
	// senden zwar immer einen Wert, aber jede Anfrage, die vor Schritt 2
	// entsteht, kennt das Feld noch gar nicht. Ohne Vorgabe stünde in der
	// Historie eine leere EKArt, obwohl brutto gemeint war.
	ekArt := r.PostForm.Get("ek_art")
	if ekArt != "netto" {
		ekArt = "brutto"
	}

	leit := leitmarktAufloesen(r.PostForm.Get("leitmarkt"), maerkte)

	return dealFormular{
		Einkaufslink:   strings.TrimSpace(r.PostForm.Get("einkaufslink")),
		LinkBestaetigt: strings.TrimSpace(r.PostForm.Get("link_bestaetigt")),
		ASIN:           strings.ToUpper(strings.TrimSpace(r.PostForm.Get("asin"))),
		Quellmarkt:     r.PostForm.Get("quellmarkt"),
		QuellURL:       strings.TrimSpace(r.PostForm.Get("quell_url")),
		Titel:          r.PostForm.Get("titel"),
		Maerkte:        maerkte,
		Leitmarkt:      leit,
		EK:             r.PostForm.Get("ek"),
		EKArt:          ekArt,
		EKNotiz:        r.PostForm.Get("ek_notiz"),
		Steuersatz:     steuersatzAus(r.PostForm.Get("steuersatz")),
		MaxMenge:       strings.TrimSpace(r.PostForm.Get("max_menge")),
		Zusatz:         strings.TrimSpace(r.PostForm.Get("zusatz")),
		GewinnManuell:  strings.TrimSpace(r.PostForm.Get("gewinn_manuell")),
		VerkaufsLinie:  r.PostForm.Get("chart_verkauft") == "1",
		TitelManuell:   r.PostForm.Get("titel_manuell") == "1",
		TitelASIN:      strings.ToUpper(strings.TrimSpace(r.PostForm.Get("titel_asin"))),
		WeitereLinks: func() []string {
			var out []string
			for _, v := range r.PostForm["weitere_link"] {
				if v = strings.TrimSpace(v); v != "" && len(out) < maxWeitereLinks {
					out = append(out, v)
				}
			}
			return out
		}(),
		MargeManuell:       strings.TrimSpace(r.PostForm.Get("marge_manuell")),
		GewinnPanEUManuell: strings.TrimSpace(r.PostForm.Get("gewinn_paneu_manuell")),
		MargePanEUManuell:  strings.TrimSpace(r.PostForm.Get("marge_paneu_manuell")),
		WeitereChannels: func() []int64 {
			var out []int64
			for _, v := range r.PostForm["channel_weitere"] {
				if n, err := strconv.ParseInt(v, 10, 64); err == nil && n != id && n > 0 {
					out = append(out, n)
				}
			}
			return out
		}(),
		UStModus:  ustModus,
		ChannelID: id,
		EntwurfID: entwurfID,
		OhneLink:  r.PostForm.Get("ohne_link") == "1",
		Lieferant: strings.TrimSpace(r.PostForm.Get("lieferant")),
		Poster: func() string {
			if p := strings.TrimSpace(r.PostForm.Get("poster")); r.PostForm.Has("poster") {
				return p
			}
			return posterVorwahl(r)
		}(),
		BildKennung: gepruefteBildKennung(r.PostForm.Get("bild_kennung")),
		Masse: fba.Masse{
			LaengeMM: masszahl(r.PostForm.Get("masse_l")),
			BreiteMM: masszahl(r.PostForm.Get("masse_b")),
			HoeheMM:  masszahl(r.PostForm.Get("masse_h")),
			GewichtG: masszahl(r.PostForm.Get("masse_g")),
		},
	}
}

// gepruefteBildKennung lässt nur einen echten Amazon-Bildnamen durch.
//
// Das Feld ist zwar versteckt, aber ein verstecktes Feld ist kein
// vertrauenswürdiges Feld: es kommt aus dem Browser zurück und landet später
// im src-Attribut eines img in der Historie. Ohne diese Prüfung würde dort
// jede beliebige fremde Adresse landen — etwa "//boese.example/verfolger.jpg",
// die als schemarelative Adresse vollständig ist. Eine unbrauchbare Kennung
// wird verworfen statt den ganzen Post abzulehnen: das Bild ist Beiwerk, der
// Deal ist die Hauptsache.
func gepruefteBildKennung(k string) string {
	if bild.Gueltig(k) {
		return k
	}
	return ""
}

// keepaWerteLeeren räumt alles weg, was an einem bestimmten Artikel auf einem
// bestimmten Zielmarktplatz hängt.
//
// Der Weg Schritt 3 → 2 → andere Zielmarktplätze trug diese Werte sonst
// einfach weiter: liefert Keepa für den neuen Markt keinen Ø-90-Tage-Preis,
// setzte die Kandidatenschleife keinen neuen — und der Nachrücker griff
// nicht, weil ja noch der alte Preis im Feld stand. Gerechnet wurde dann mit
// dem Verkaufspreis eines anderen Marktes. Dasselbe galt für Titel,
// Verkaufszahl, Provision und FBA-Gebühr.
//
// Erhalten bleiben sie allein auf dem unveränderten Rückweg aus Schritt 4,
// wo derselbe Artikel und dieselben Märkte gelten und die Zahlen bereits von
// Hand geprüft sind.
func (f *dealFormular) keepaWerteLeeren() {
	// Ein von Hand gekürzter Name bleibt — aber nur für denselben Artikel.
	if !f.TitelManuell || f.TitelASIN != strings.ToUpper(f.ASIN) {
		f.Titel, f.TitelManuell = "", false
	}
	// Auch das Bild hängt am Artikel: bliebe die Kennung stehen, zeigte die
	// Historie später das Produktfoto des vorher eingegebenen Artikels.
	f.BildKennung = ""
	// Die Maße hängen genauso am Artikel wie das Bild. Bleiben sie stehen,
	// während der Keepa-Abruf für die neue ASIN scheitert, rechnet der
	// Pan-EU-Vergleich mit der Größenklasse des vorherigen Produkts weiter —
	// eine Zahl im Post, die zu diesem Artikel nie gemessen wurde (R5).
	f.Masse = fba.Masse{}

	// Von Hand eingetragene Zahlen bleiben stehen (Quelle "manuell"): wer
	// den VK selbst gesetzt hat, will ihn nicht nach jedem Zurück und Weiter
	// oder beim erneuten Posten wieder eintippen. Alles aus Keepa kommt frisch.
	leer := func(wert, quelle *string) {
		if *quelle != "manuell" && *quelle != "vorher" {
			*wert, *quelle = "", ""
		}
	}
	for i := range f.Maerkte {
		m := &f.Maerkte[i]
		leer(&m.VK, &m.VKQuelle)
		leer(&m.Sales, &m.SalesQuelle)
		leer(&m.Provision, &m.ProvisionQuelle)
		leer(&m.FBA, &m.FBAQuelle)
	}
}

// masszahl liest ein Maß aus dem Formular. Es kommt aus Keepa, reist aber
// durch den Browser — Unlesbares und Negatives zählen darum als 0, also als
// „nicht bekannt". Ein aus der Luft gegriffener Wert könnte sonst eine
// Größenklasse und damit eine Gebühr erfinden.
func masszahl(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// maxMengeZahl liest das Cart-Limit. Leer ergibt 0 (keines); alles andere
// muss eine ganze Zahl von 1 bis 9999 sein. Eine unlesbare Angabe wird
// gemeldet statt verworfen: sie stünde sonst still nicht im Post, obwohl
// jemand sie eingetragen hat.
func maxMengeZahl(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 || n > 9999 {
		return 0, fmt.Errorf("Max. Menge: %q ist keine Stückzahl von 1 bis 9999", s)
	}
	return n, nil
}

// steuersatzAus lässt nur die beiden bekannten Werte durch; alles andere,
// auch ein fehlendes Feld, ist der normale Satz.
func steuersatzAus(s string) string {
	if s == "ermaessigt" {
		return s
	}
	return "normal"
}

// WeitererChannel sagt, ob ein Channel zusätzlich angehakt ist — für die
// Kästchen in Schritt 4.
func (f dealFormular) WeitererChannel(id int64) bool {
	for _, w := range f.WeitereChannels {
		if w == id {
			return true
		}
	}
	return false
}

// chartURL ist die Adresse der Chart-Vorschau für einen Markt.
func (f dealFormular) chartURL(markt string) string {
	u := "/chart?asin=" + f.ASIN + "&markt=" + markt
	if f.VerkaufsLinie {
		u += "&verkauft=1"
	}
	return u
}

// maxWeitereLinks: mit dem ersten Link zusammen vier Einkaufsquellen.
const maxWeitereLinks = 3

// WeitereLinkFelder sind die Werte für die drei Eingabefelder in Schritt 1,
// leere aufgefüllt.
func (f dealFormular) WeitereLinkFelder() []string {
	out := append([]string(nil), f.WeitereLinks...)
	for len(out) < maxWeitereLinks {
		out = append(out, "")
	}
	return out
}

// weitereEK prüft die weiteren Einkaufslinks und macht sie zu Post-Links.
// "www.shop.de/…" bekommt ein https:// davor.
func (f dealFormular) weitereEK() ([]post.EKLink, error) {
	var out []post.EKLink
	for i, roh := range f.WeitereLinks {
		if !strings.HasPrefix(roh, "http://") && !strings.HasPrefix(roh, "https://") {
			roh = "https://" + roh
		}
		u, err := url.Parse(roh)
		if err != nil || u.Hostname() == "" || !strings.Contains(u.Hostname(), ".") || strings.ContainsAny(roh, " <>") {
			return nil, fmt.Errorf("Weiterer Einkaufslink %d (%q) ist keine Adresse", i+2, f.WeitereLinks[i])
		}
		out = append(out, post.EKLink{Host: strings.TrimPrefix(strings.ToLower(u.Hostname()), "www."), URL: roh})
	}
	return out, nil
}
