package web

import (
	"net/http"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
)

// kauflimitSeite füllt das Fragment "kauflimit" in Schritt 2.
type kauflimitSeite struct {
	Fehler   string
	Markt    string
	Angebote []kauflimitZeile
	Token    int
}

type kauflimitZeile struct {
	keepa.Angebot
	Preis       string
	HaendlerURL string
	PasstZumEK  bool
}

// kauflimitPruefen fragt Keepa nach den aktuellen Angeboten auf dem
// Einkaufsmarkt und zeigt je Angebot Bestand bzw. Kauflimit.
//
// Nur auf Knopfdruck: die Abfrage mit Angeboten und Bestand kostet etwa 8
// bis 14 Token statt einem. Übernommen wird nichts von selbst — ob die Zahl
// ein Limit oder der echte Lagerbestand ist, sagt die Keepa-API nicht.
func (srv *Server) kauflimitPruefen(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	f := formularLesen(r)
	var d kauflimitSeite
	defer func() { srv.rendere(w, "kauflimit", d) }()

	markt, ok := marketplace.ByCode(marketplace.Code(f.Quellmarkt))
	if f.OhneLink || f.QuellURL != "" || !ok || !asinMuster.MatchString(f.ASIN) {
		d.Fehler = "Geht nur, wenn bei Amazon eingekauft wird."
		return
	}
	d.Markt = strings.TrimPrefix(markt.Host, "www.")

	schluessel := srv.keepaKeyAufloesen()
	if schluessel == "" {
		d.Fehler = "Kein Keepa-API-Key hinterlegt — bitte in den Einstellungen eintragen."
		return
	}
	kc := *srv.keepa
	kc.Key = schluessel
	liste, a, err := kc.Angebote(r.Context(), f.ASIN, markt.KeepaDomain)
	if err != nil {
		d.Fehler = sicherFehlertext(keepaFehler(err, f.ASIN, markt).Error())
		return
	}
	srv.merkeToken(a.TokensLeft, a.TokensConsumed)
	d.Token = a.TokensConsumed

	ek := srv.ekBruttoFuerVergleich(f, markt)
	for i, o := range liste {
		if i == 6 {
			break
		}
		z := kauflimitZeile{Angebot: o, Preis: o.Gesamt.Euro()}
		if !o.Amazon && o.VerkaeuferID != "" {
			z.HaendlerURL = "https://" + markt.Host + "/sp?seller=" + o.VerkaeuferID
		}
		// Bis 2 % Abstand zum eingegebenen EK gilt als das gekaufte Angebot.
		if ek > 0 {
			abstand := int64(o.Gesamt) - int64(ek)
			if abstand < 0 {
				abstand = -abstand
			}
			z.PasstZumEK = abstand*50 <= int64(ek)
		}
		d.Angebote = append(d.Angebote, z)
	}
}

// ekBruttoFuerVergleich ist der eingegebene Einkaufspreis als Bruttobetrag,
// so wie Keepa die Angebote nennt. 0, wenn keiner lesbar ist.
func (srv *Server) ekBruttoFuerVergleich(f dealFormular, markt marketplace.Marketplace) money.Cents {
	ek, err := money.Parse(f.EK)
	if err != nil || ek <= 0 {
		return 0
	}
	if f.EKArt == "netto" {
		ust := int64(srv.ustFuer(markt.Code, f.Steuersatz))
		return money.Cents((int64(ek)*(1000+ust) + 500) / 1000)
	}
	return ek
}
