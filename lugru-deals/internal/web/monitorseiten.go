package web

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Handler für Ankäufer, Kategorie-Scan und Listen-Import des Monitors.

// ---------------------------------------------------------------- Ankäufer

func (srv *Server) speichereAnkaeufer(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	p, err := srv.store.MonitorProdukt(idAusPfad(r))
	if err != nil {
		srv.monitorMeldung(w, "", "Produkt nicht gefunden.")
		return
	}
	preis, ok := betrag(r.PostForm.Get("preis"))
	if !ok {
		srv.monitorMeldung(w, "", "Ankäufer: kein gültiger Preis.")
		return
	}
	ab, _ := strconv.Atoi(strings.TrimSpace(r.PostForm.Get("ab")))
	if err := srv.store.AnkaeuferAnlegen(store.Ankaeufer{ProduktID: p.ID, Name: r.PostForm.Get("name"), Preis: preis, AbStueck: ab}); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Ankäufer gespeichert.", "")
}

func (srv *Server) loescheAnkaeufer(w http.ResponseWriter, r *http.Request) {
	_ = srv.store.AnkaeuferLoeschen(idAusPfad(r))
	srv.monitorMeldung(w, "Ankäufer gelöscht.", "")
}

// ---------------------------------------------------------------- Kategorien

func (srv *Server) speichereKategorie(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	link, err := billiger.NormalisiereKategorie(r.PostForm.Get("url"))
	if err != nil {
		srv.monitorMeldung(w, "", err.Error())
		return
	}
	name := strings.TrimSpace(r.PostForm.Get("name"))
	if name == "" {
		name = "Kategorie"
	}
	if err := srv.store.KategorieAnlegen(store.MonitorKategorie{Name: name, URL: link}); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Kategorie angelegt. Preisstürze erkennt der Scan, sobald er einen Tag Preise gesammelt hat.", "")
}

func (srv *Server) loescheKategorie(w http.ResponseWriter, r *http.Request) {
	_ = srv.store.KategorieLoeschen(idAusPfad(r))
	srv.monitorMeldung(w, "Kategorie gelöscht.", "")
}

// ---------------------------------------------------------------- Import

// importVorschlag ist eine gelesene Zeile mit den gefundenen Produktseiten.
type importVorschlag struct {
	importZeile
	Nr           int
	Treffer      []billiger.Variante
	Gewaehlt     string
	EANGeprueft  bool
	Fehler       string
	WeckerText   string
	AnkaufText   string
	AnkaeuferRoh string
	Warnung      string
}

// zeigeImport liest die eingefügte Liste und sucht je Zeile die Produktseite
// bei billiger.de. Steht eine EAN in der Zeile, wird der beste Treffer gegen
// sie geprüft, sonst gilt die Reihenfolge der Suche.
func (srv *Server) zeigeImport(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	zeilen := liesImport(r.PostForm.Get("liste"))
	if len(zeilen) == 0 {
		srv.monitorMeldung(w, "", "In der Liste steht keine Zeile mit Artikel und Preiswecker.")
		return
	}
	if len(zeilen) > 60 {
		zeilen = zeilen[:60]
	}
	vorschlaege := make([]importVorschlag, len(zeilen))
	ctx, abbruch := context.WithTimeout(r.Context(), 90*time.Second)
	defer abbruch()

	// Drei Abrufe zugleich, je eine Sekunde Pause: schnell genug für eine
	// Liste von 30 Zeilen und noch höflich zu billiger.de.
	auftraege := make(chan int)
	var wg sync.WaitGroup
	for range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range auftraege {
				vorschlaege[i] = srv.importSuchen(ctx, i, zeilen[i])
			}
		}()
	}
	for i := range zeilen {
		auftraege <- i
	}
	close(auftraege)
	wg.Wait()

	d := srv.monitorDaten()
	d.Import = vorschlaege
	srv.rendere(w, "monitor", d)
}

func (srv *Server) importSuchen(ctx context.Context, i int, z importZeile) importVorschlag {
	v := importVorschlag{importZeile: z, Nr: i}
	if z.Wecker > 0 {
		v.WeckerText = z.Wecker.String()
	}
	if z.Ankauf > 0 {
		v.AnkaufText = z.Ankauf.String()
	}
	if roh, err := json.Marshal(z.Ankaeufer); err == nil {
		v.AnkaeuferRoh = string(roh)
	}
	if z.Wecker > 0 && z.Ankauf > 0 && z.Wecker > z.Ankauf {
		v.Warnung = "Preiswecker liegt über dem Einzel-Ankauf"
	}
	if !warteKurz(ctx, time.Second) {
		v.Fehler = "abgebrochen"
		return v
	}
	treffer, err := billiger.Suche(ctx, srv.monitorClient(), z.Name)
	if err != nil {
		v.Fehler = sicherFehlertext(err.Error())
		return v
	}
	treffer = billiger.SortiereTreffer(treffer, z.Name, z.Notiz)
	if len(treffer) > 6 {
		treffer = treffer[:6]
	}
	v.Treffer = treffer
	if len(treffer) > 0 {
		v.Gewaehlt = treffer[0].URL
	}
	if z.EAN == "" {
		return v
	}
	for _, t := range treffer[:min(3, len(treffer))] {
		if !warteKurz(ctx, time.Second) {
			break
		}
		liste, err := billiger.Hole(ctx, srv.monitorClient(), t.URL)
		if err == nil && eanGleich(liste.EAN, z.EAN) {
			v.Gewaehlt, v.EANGeprueft = t.URL, true
			break
		}
	}
	return v
}

// eanGleich vergleicht EANs ohne führende Nullen (UPC und EAN-13).
func eanGleich(a, b string) bool {
	a, b = strings.TrimLeft(a, "0"), strings.TrimLeft(b, "0")
	return a != "" && a == b
}

// uebernehmeImport legt die geprüften Zeilen als Ankaufs-Produkte an.
func (srv *Server) uebernehmeImport(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	angelegt, uebersprungen := 0, 0
	var fehler []string
	for i := 0; i < 60; i++ {
		feld := func(n string) string { return strings.TrimSpace(r.PostForm.Get("z" + strconv.Itoa(i) + "_" + n)) }
		if !r.PostForm.Has("z" + strconv.Itoa(i) + "_name") {
			continue
		}
		link := feld("url")
		if link == "" {
			uebersprungen++
			continue
		}
		link, err := billiger.NormalisiereURL(link)
		if err != nil {
			fehler = append(fehler, feld("name")+": kein gültiger Link")
			continue
		}
		wecker, _ := betragOderNull(feld("wecker"))
		ankauf, _ := betragOderNull(feld("ankauf"))
		p := store.MonitorProdukt{
			Name: feld("name"), URL: link, Modus: store.ModusAnkauf, Ankauf: ankauf, MaxEK: wecker,
			Kategorie: feld("kategorie"), Stichworte: feld("stichworte"), Notiz: feld("notiz"),
			Prio: feld("prio"), EAN: feld("ean"), AuchVerzoegert: true, Aktiv: true,
		}
		id, err := srv.store.MonitorProduktAnlegen(p)
		if err != nil {
			fehler = append(fehler, p.Name+": "+sicherFehlertext(err.Error()))
			continue
		}
		var ankaeufer []store.Ankaeufer
		if json.Unmarshal([]byte(feld("ankaeufer")), &ankaeufer) == nil {
			for _, a := range ankaeufer {
				a.ProduktID = id
				_ = srv.store.AnkaeuferAnlegen(a)
			}
		}
		angelegt++
	}
	meldung := strconv.Itoa(angelegt) + " Produkte angelegt"
	if uebersprungen > 0 {
		meldung += ", " + strconv.Itoa(uebersprungen) + " ohne Link übersprungen"
	}
	meldung += ". Jetzt Regeln für die Channels prüfen und einzelne Produkte mit „Testen“ ansehen."
	srv.monitorMeldung(w, meldung, strings.Join(fehler, " · "))
}

// ---------------------------------------------------------------- Shop-Rabatte

func (srv *Server) speichereShopRabatt(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	shop := strings.TrimSpace(r.PostForm.Get("shop"))
	if shop == "" {
		srv.monitorMeldung(w, "", "Bitte einen Shop angeben.")
		return
	}
	cb := 0.0
	if v := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(r.PostForm.Get("cashback")), "%")); v != "" {
		var err error
		if cb, err = strconv.ParseFloat(strings.ReplaceAll(v, ",", "."), 64); err != nil || cb < 0 || cb > 50 {
			srv.monitorMeldung(w, "", "Cashback: eine Zahl zwischen 0 und 50.")
			return
		}
	}
	fest, err1 := betragOderNull(r.PostForm.Get("fest"))
	ab, err2 := betragOderNull(r.PostForm.Get("ab"))
	if err1 != nil || err2 != nil {
		srv.monitorMeldung(w, "", "Gutschein: kein gültiger Betrag.")
		return
	}
	if cb == 0 && fest == 0 {
		srv.monitorMeldung(w, "", "Bitte Cashback oder einen Gutschein-Betrag angeben.")
		return
	}
	if err := srv.store.ShopRabattAnlegen(store.ShopRabatt{Shop: shop, Cashback: cb, Fest: fest, Ab: ab, Notiz: r.PostForm.Get("notiz")}); err != nil {
		srv.monitorMeldung(w, "", "Nicht gespeichert: "+sicherFehlertext(err.Error()))
		return
	}
	srv.monitorMeldung(w, "Shop-Rabatt gespeichert.", "")
}

func (srv *Server) loescheShopRabatt(w http.ResponseWriter, r *http.Request) {
	_ = srv.store.ShopRabattLoeschen(idAusPfad(r))
	srv.monitorMeldung(w, "Shop-Rabatt gelöscht.", "")
}
