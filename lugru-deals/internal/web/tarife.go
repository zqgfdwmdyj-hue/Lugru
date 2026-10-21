package web

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/fba"
	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Die Tarifseite bildet Amazons Tarifübersichten nach: Zeilen sind
// Größenklassen, Spalten sind Zielmärkte. Sie ist damit absichtlich keine
// Liste von Formularen wie /channels oder /tags, sondern eine Tabelle, die
// ein Formular gemeinsam speichert — abgetippt wird sie auch am Stück.
//
// Jede Spalte trägt ihren Versandweg. Das Lagerland bekommt den lokalen
// Tarif, jeder andere Markt den des Europäischen Versandnetzwerks — je Markt
// ist genau einer erreichbar, also zeigt die Seite auch nur einen. In der
// Datenbank stehen trotzdem beide: wechselt das Lagerland, gilt schlagartig
// die jeweils andere Spalte, und die soll dann nicht leer sein.

// tarifZeile ist eine Klasse samt ihren Beträgen, beides als Text fürs
// Formular. Leerer Text heißt „nicht eingetragen" — und das ist etwas
// anderes als 0,00 €, siehe store.EFNGebuehr.
type tarifZeile struct {
	Klasse   fba.Klasse
	LaengeCM string
	BreiteCM string
	HoeheCM  string
	GewichtG string

	// Je Zielmarkt drei Felder: der Betrag, und für die Übergrößen das
	// Grundgewicht samt Zuschlag je zusätzlichem Kilogramm. Die beiden
	// letzten bleiben bei allen Umschlag- und Paketklassen leer — dort gibt
	// es nur einen Festbetrag.
	Gebuehren map[string]tarifBetrag
}

type tarifBetrag struct {
	Cent         string
	FreiGewichtG string
	CentProKg    string
}

type tarifDaten struct {
	Titel     string
	TokenText string
	Meldung   string
	Fehler    string
	Lagerland string
	Zuschlag  string // je Einheit, aus den Einstellungen
	Stand     string // worauf die Startbestückung beruht
	Spalten   []tarifSpalte
	Zeilen    []tarifZeile
}

// tarifSpalte ist ein Zielmarkt samt dem Versandweg, der für ihn gilt.
type tarifSpalte struct {
	Markt marketplace.Marketplace
	Weg   string // "lokal" oder "efn", für die Beschriftung
}

// spalten sind alle Märkte mit ihrem jeweiligen Versandweg.
func (srv *Server) spalten() (string, []tarifSpalte) {
	lager := srv.lagerland()
	var alle []tarifSpalte
	for _, m := range marketplace.All() {
		alle = append(alle, tarifSpalte{Markt: m, Weg: string(srv.wegFuer(m.Code))})
	}
	return string(lager), alle
}

// wegFuer sagt, welche der beiden Tarifübersichten für ein Ziel gilt.
//
// Die ganze Unterscheidung steckt in dieser einen Zeile: liegt die Ware im
// Zielland, gilt der lokale Tarif; kommt sie von woanders, der des
// Europäischen Versandnetzwerks. Der Unterschied ist kein Detail — je nach
// Klasse liegt der EFN-Tarif beim Anderthalb- bis Dreieinhalbfachen.
func (srv *Server) wegFuer(ziel marketplace.Code) fba.Weg {
	if ziel == srv.lagerland() {
		return fba.Lokal
	}
	return fba.EFN
}

func (srv *Server) tarifDaten() tarifDaten {
	lager, spalten := srv.spalten()
	d := tarifDaten{
		Titel: "Versandtarife", TokenText: srv.tokenText(),
		Lagerland: lager, Spalten: spalten,
		Stand: srv.store.Einstellung(store.SchluesselTarifeBestueckt),
	}
	if z := srv.zuschlagJeEinheit(); z != 0 {
		d.Zuschlag = z.Euro()
	}

	klassen, err := srv.store.TarifKlassen()
	if err != nil {
		d.Fehler = "Tarife nicht lesbar: " + err.Error()
		return d
	}
	gebuehren := map[fba.Weg]map[int64]map[string]fba.Gebuehr{}
	for _, weg := range []fba.Weg{fba.Lokal, fba.EFN} {
		g, err := srv.store.TarifGebuehren(weg)
		if err != nil {
			d.Fehler = "Tarife nicht lesbar: " + err.Error()
			return d
		}
		gebuehren[weg] = g
	}

	for _, k := range klassen {
		z := tarifZeile{
			Klasse:    k,
			LaengeCM:  zentimeter(k.MaxLaengeMM),
			BreiteCM:  zentimeter(k.MaxBreiteMM),
			HoeheCM:   zentimeter(k.MaxHoeheMM),
			GewichtG:  strconv.Itoa(k.MaxGewichtG),
			Gebuehren: map[string]tarifBetrag{},
		}
		for _, sp := range spalten {
			m := sp.Markt
			g, da := gebuehren[fba.Weg(sp.Weg)][k.ID][string(m.Code)]
			if !da {
				z.Gebuehren[string(m.Code)] = tarifBetrag{}
				continue
			}
			b := tarifBetrag{Cent: g.Cent.String()}
			// Null heißt hier "keine Kilogramm-Staffel" und bleibt darum
			// leer statt als "0" dazustehen — ein Feld voller Nullen liest
			// sich wie eine Angabe.
			if g.FreiGewichtG > 0 {
				b.FreiGewichtG = strconv.Itoa(g.FreiGewichtG)
			}
			if g.CentProKg > 0 {
				b.CentProKg = g.CentProKg.String()
			}
			z.Gebuehren[string(m.Code)] = b
		}
		d.Zeilen = append(d.Zeilen, z)
	}
	return d
}

func (srv *Server) zeigeTarife(w http.ResponseWriter, r *http.Request) {
	srv.rendere(w, "tarife", srv.tarifDaten())
}

// speichereTarife übernimmt die ganze Tabelle auf einmal.
//
// Erst wird alles geprüft, dann alles geschrieben — in einer Transaktion.
// Zeile für Zeile zu speichern hieße, nach einem Tippfehler in der zwanzigsten
// Zeile die halbe Tabelle im neuen und die andere Hälfte im alten Zustand
// stehen zu lassen, und beides zusammen rechnete ab sofort echte Deals (R2).
//
// Gelesen werden dabei nur Felder zu Klassen, die tatsächlich in der Datenbank
// stehen, und nur Spalten zu Märkten, die marketplace kennt. Über die
// Formularschlüssel zu laufen und aus ihnen die IDs zu gewinnen, hieße einer
// selbstgebauten Anfrage zu erlauben, Zeilen zu erfinden.
func (srv *Server) speichereTarife(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		srv.fehler(w, http.StatusBadRequest, "Formular nicht lesbar")
		return
	}

	lager, spalten := srv.spalten()

	// Welchem Versandweg eine Spalte zugeordnet ist, hängt am Lagerland —
	// und das kann sich geändert haben, seit diese Seite gebaut wurde. Ohne
	// diese Prüfung landeten die angezeigten IT-EFN-Beträge nach einem
	// Wechsel auf IT stillschweigend als IT-lokal in der Datenbank und
	// vermischten beide Tarifwerke dauerhaft (R3).
	if gerendert := strings.ToUpper(strings.TrimSpace(r.PostForm.Get("lagerland"))); gerendert != lager {
		srv.tarifFehlerMitEingaben(w, r, fmt.Sprintf(
			"Das Lagerland steht inzwischen auf %s, diese Tabelle wurde noch für %s gebaut. "+
				"Nichts gespeichert — bitte die Seite neu laden, sonst gerieten die Beträge in den falschen Versandweg.",
			lager, gerendert))
		return
	}

	klassen, err := srv.store.TarifKlassen()
	if err != nil {
		srv.tarifFehlerMitEingaben(w, r, "Tarife nicht lesbar: "+err.Error())
		return
	}

	var neueKlassen []fba.Klasse
	var eintraege []store.TarifGebuehrEintrag

	for _, k := range klassen {
		id := strconv.FormatInt(k.ID, 10)
		// Ohne lesbare Zahl bleibt die bisherige Reihenfolge stehen: ein
		// vertipptes Feld darf die Staffel nicht umsortieren, denn die
		// Reihenfolge entscheidet, welche Klasse ein Paket bekommt.
		sortierung := k.Sortierung
		if n, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("sortierung." + id))); err == nil {
			sortierung = n
		}
		neu, err := klasseAusFormular(r, "."+id, sortierung)
		if err != nil {
			srv.tarifFehlerMitEingaben(w, r, fmt.Sprintf("Klasse %q: %v", k.Bezeichnung, err))
			return
		}
		neu.ID = k.ID
		neueKlassen = append(neueKlassen, neu)

		for _, sp := range spalten {
			m, weg := sp.Markt, fba.Weg(sp.Weg)
			eintrag, err := gebuehrAusFormular(r, id, string(m.Code), neu.Bezeichnung)
			if err != nil {
				srv.tarifFehlerMitEingaben(w, r, err.Error())
				return
			}
			eintrag.KlasseID, eintrag.Markt, eintrag.Weg = k.ID, string(m.Code), weg
			eintraege = append(eintraege, eintrag)
		}
	}

	if err := srv.store.TarifTabelleSchreiben(neueKlassen, eintraege); err != nil {
		srv.tarifFehlerMitEingaben(w, r, "Speichern fehlgeschlagen: "+err.Error())
		return
	}

	d := srv.tarifDaten()
	d.Meldung = "Gespeichert."
	srv.rendere(w, "tarife", d)
}

// gebuehrAusFormular liest eine Zelle der Tabelle: Betrag und, bei den
// Übergrößen, die Kilogramm-Staffel.
//
// Ein leeres Betragsfeld ergibt einen Löscheintrag. Es auf 0 zu setzen hieße,
// eine kostenlose Sendung zu behaupten.
func gebuehrAusFormular(r *http.Request, id, markt, klasse string) (store.TarifGebuehrEintrag, error) {
	roh := strings.TrimSpace(r.PostForm.Get("geb." + id + "." + markt))
	if roh == "" {
		return store.TarifGebuehrEintrag{Loeschen: true}, nil
	}

	cent, err := money.Parse(roh)
	if err != nil {
		return store.TarifGebuehrEintrag{}, fmt.Errorf(
			"Klasse %q, %s: %q ist kein Betrag.", klasse, markt, roh)
	}
	if cent < 0 {
		return store.TarifGebuehrEintrag{}, fmt.Errorf(
			"Klasse %q, %s: eine Gebühr ist kein negativer Betrag.", klasse, markt)
	}

	g := fba.Gebuehr{Cent: cent}

	// Die Kilogramm-Staffel gilt nur zusammen: ein Grundgewicht ohne Zuschlag
	// bewirkte nichts, ein Zuschlag ohne Grundgewicht begänne beim ersten
	// Gramm. Fehlt eines von beiden, gilt der Festbetrag — und die Zeile sagt
	// das, statt es zu erraten.
	frei := strings.TrimSpace(r.PostForm.Get("frei." + id + "." + markt))
	proKg := strings.TrimSpace(r.PostForm.Get("prokg." + id + "." + markt))
	if (frei == "") != (proKg == "") {
		return store.TarifGebuehrEintrag{}, fmt.Errorf(
			"Klasse %q, %s: Grundgewicht und Zuschlag je Kilogramm gehören zusammen — entweder beide oder keines.",
			klasse, markt)
	}
	if frei != "" {
		gramm, err := gramm(frei)
		if err != nil {
			return store.TarifGebuehrEintrag{}, fmt.Errorf(
				"Klasse %q, %s, Grundgewicht: %v", klasse, markt, err)
		}
		proKgCent, err := money.Parse(proKg)
		if err != nil || proKgCent < 0 {
			return store.TarifGebuehrEintrag{}, fmt.Errorf(
				"Klasse %q, %s: %q ist kein Zuschlag je Kilogramm.", klasse, markt, proKg)
		}
		g.FreiGewichtG, g.CentProKg = gramm, proKgCent
	}
	return store.TarifGebuehrEintrag{Gebuehr: g}, nil
}

// neueTarifKlasse hängt eine Zeile an. Die Beträge kommen danach über
// speichereTarife dazu — erst existiert die Klasse, dann hat sie Preise.
func (srv *Server) neueTarifKlasse(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		srv.fehler(w, http.StatusBadRequest, "Formular nicht lesbar")
		return
	}

	sortierung, _ := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("sortierung")))
	k, err := klasseAusFormular(r, "", sortierung)
	if err != nil {
		srv.tarifFehler(w, err.Error())
		return
	}
	if _, err := srv.store.TarifKlasseAnlegen(k); err != nil {
		srv.tarifFehler(w, "Anlegen fehlgeschlagen: "+err.Error())
		return
	}

	d := srv.tarifDaten()
	d.Meldung = "Klasse angelegt. Jetzt die Beträge eintragen und speichern."
	srv.rendere(w, "tarife", d)
}

func (srv *Server) loescheTarifKlasse(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		srv.fehler(w, http.StatusBadRequest, "ungültige Klassen-ID")
		return
	}
	d := srv.tarifDaten()
	if err := srv.store.TarifKlasseLoeschen(id); err != nil {
		d.Fehler = "Löschen fehlgeschlagen: " + err.Error()
	} else {
		d = srv.tarifDaten()
		d.Meldung = "Klasse gelöscht, samt ihren Beträgen."
	}
	srv.rendere(w, "tarife", d)
}

func (srv *Server) tarifFehler(w http.ResponseWriter, text string) {
	d := srv.tarifDaten()
	d.Fehler = text
	srv.rendere(w, "tarife", d)
}

// tarifFehlerMitEingaben zeigt den Fehler und lässt die abgeschickten Werte
// stehen.
//
// Ohne das käme die Tabelle aus der Datenbank zurück, und wer dreißig Zeilen
// bearbeitet und sich in einer vertippt hat, verlöre die anderen
// neunundzwanzig — gerade weil jetzt nichts mehr teilweise gespeichert wird
// (R2).
func (srv *Server) tarifFehlerMitEingaben(w http.ResponseWriter, r *http.Request, text string) {
	d := srv.tarifDaten()
	d.Fehler = text
	for i := range d.Zeilen {
		z := &d.Zeilen[i]
		id := strconv.FormatInt(z.Klasse.ID, 10)
		uebernimm(r, "bez."+id, &z.Klasse.Bezeichnung)
		uebernimm(r, "laenge."+id, &z.LaengeCM)
		uebernimm(r, "breite."+id, &z.BreiteCM)
		uebernimm(r, "hoehe."+id, &z.HoeheCM)
		uebernimm(r, "gewicht."+id, &z.GewichtG)
		for markt, b := range z.Gebuehren {
			uebernimm(r, "geb."+id+"."+markt, &b.Cent)
			uebernimm(r, "frei."+id+"."+markt, &b.FreiGewichtG)
			uebernimm(r, "prokg."+id+"."+markt, &b.CentProKg)
			z.Gebuehren[markt] = b
		}
	}
	srv.rendere(w, "tarife", d)
}

// uebernimm setzt ziel auf den abgeschickten Wert, wenn das Feld überhaupt
// mitgeschickt wurde. Ein leer abgeschicktes Feld bleibt leer — das ist eine
// Angabe und nicht das Fehlen einer.
func uebernimm(r *http.Request, name string, ziel *string) {
	if r.PostForm.Has(name) {
		*ziel = strings.TrimSpace(r.PostForm.Get(name))
	}
}

// klasseAusFormular liest eine Zeile. suffix ist "" für die Neuanlage und
// ".<id>" für eine bestehende Zeile — dieselben Feldnamen, einmal ohne und
// einmal mit Kennung.
//
// Alle vier Grenzen sind Pflicht und müssen größer als null sein. Eine Zeile
// mit einer offenen Grenze passte nie (fba.Klasse.Passt lässt sie
// durchfallen) und stünde nur als Blindgänger in der Tabelle. Wer eine
// Klasse ohne obere Schranke braucht, trägt eine große Zahl ein.
func klasseAusFormular(r *http.Request, suffix string, sortierung int) (fba.Klasse, error) {
	bez := strings.TrimSpace(r.PostForm.Get("bez" + suffix))
	if bez == "" {
		return fba.Klasse{}, fmt.Errorf("die Bezeichnung fehlt")
	}

	k := fba.Klasse{Sortierung: sortierung, Bezeichnung: bez}
	for _, feld := range []struct {
		name string
		text string
		ziel *int
	}{
		{"Länge", "laenge", &k.MaxLaengeMM},
		{"Breite", "breite", &k.MaxBreiteMM},
		{"Höhe", "hoehe", &k.MaxHoeheMM},
	} {
		mm, err := millimeter(r.PostForm.Get(feld.text + suffix))
		if err != nil {
			return fba.Klasse{}, fmt.Errorf("%s: %w", feld.name, err)
		}
		*feld.ziel = mm
	}

	g, err := gramm(r.PostForm.Get("gewicht" + suffix))
	if err != nil {
		return fba.Klasse{}, fmt.Errorf("Gewicht: %w", err)
	}
	k.MaxGewichtG = g
	return k, nil
}

// millimeter liest eine Kantenlänge in Zentimetern, wie sie in Amazons
// Tarifübersicht steht ("33 × 23 × 2,5 cm"), und gibt Millimeter zurück.
//
// Gerechnet wird über money.Parse: die Funktion beherrscht Komma wie Punkt
// und liefert Hundertstel, aus denen sich Zehntel durch Teilen ergeben. Eine
// eigene Zahlenformel wäre eine zweite Stelle, an der aus Text eine Zahl
// wird — und die läuft irgendwann anders als diese hier.
func millimeter(s string) (int, error) {
	hundertstel, err := money.Parse(s)
	if err != nil {
		return 0, fmt.Errorf("%q ist keine Zahl", strings.TrimSpace(s))
	}
	mm := int(math.Round(float64(hundertstel) / 10))
	if mm <= 0 {
		return 0, fmt.Errorf("muss größer als null sein")
	}
	return mm, nil
}

// gramm liest ein Gewicht in Gramm. Punkte gelten als Tausendertrenner
// ("1.400"), Nachkommastellen gibt es nicht: ein halbes Gramm entscheidet
// keine Größenklasse, ein mit Komma gemeintes Kilogramm dagegen um den
// Faktor tausend — und das soll auffallen statt durchzurutschen.
func gramm(s string) (int, error) {
	roh := strings.TrimSpace(s)
	g, err := strconv.Atoi(strings.NewReplacer(".", "", " ", "", " ", "").Replace(roh))
	if err != nil {
		return 0, fmt.Errorf("%q ist keine ganze Zahl in Gramm", roh)
	}
	if g <= 0 {
		return 0, fmt.Errorf("muss größer als null sein")
	}
	return g, nil
}

// zentimeter schreibt Millimeter fürs Formular zurück: 25 -> "2,5", 330 -> "33".
func zentimeter(mm int) string {
	if mm%10 == 0 {
		return strconv.Itoa(mm / 10)
	}
	return strconv.Itoa(mm/10) + "," + strconv.Itoa(mm%10)
}

// lagerland ist der Markt, in dem die Ware liegt. Jedes andere Ziel wird von
// dort aus über EFN beliefert — daran hängt die ganze Staffel.
func (srv *Server) lagerland() marketplace.Code {
	c := marketplace.Code(strings.ToUpper(strings.TrimSpace(
		srv.store.Einstellung(store.SchluesselLagerland))))
	if _, ok := marketplace.ByCode(c); !ok {
		return marketplace.DE
	}
	return c
}
