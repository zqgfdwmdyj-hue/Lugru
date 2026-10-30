// Package web liefert die lokale Oberfläche aus.
package web

import (
	"embed"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

//go:embed templates/*.html
var vorlagenFS embed.FS

//go:embed static
var statischFS embed.FS

type Server struct {
	// einlesen ist der Import alter Deals aus Discord (siehe import.go).
	einlesen einlesen

	store *store.Store
	keepa *keepa.Client
	http  *http.Client
	tmpl  *template.Template

	// envKeepaKey ist der Wert der Umgebungsvariable KEEPA_API_KEY beim
	// Start des Programms — leer, wenn sie nicht gesetzt war. Er sticht
	// dauerhaft jede spätere Änderung an der Einstellung, siehe
	// keepaKeyAufloesen in deal.go und den Kommentar zu C1 im
	// Abschluss-Review: der Key darf sich nicht nur einmal beim Start
	// auflösen, sonst bleibt ein frisch in den Einstellungen gespeicherter
	// Key bis zum Neustart wirkungslos.
	envKeepaKey string

	// tokenMu schützt tokenLinks und tokenVerbraucht: sie werden bei jeder
	// Keepa-Antwort in ladeDeal geschrieben und bei jedem Seitenaufbau in der
	// Kopfzeile gelesen, aus jeweils eigenen Requests und damit potenziell
	// nebenläufig.
	tokenMu         sync.Mutex
	tokenLinks      int
	tokenVerbraucht int

	// reaktionen ist der Hintergrund-Abgleich der Discord-Reaktionen.
	reaktionen *abgleich
	// seller ist das Senden der Deals ans Lugru-Seller-System (sellerdeals.go).
	seller *sellerAbgleich
	// botBasisURL ersetzt Discords API in Tests; leer heißt Discord selbst.
	botBasisURL string

	// telegram ist der Stand des Telegram-Versands, telegramBasisURL
	// ersetzt Telegrams API in Tests.
	telegram         telegramStand
	telegramBasisURL string

	// monitorMu lässt immer nur eine Monitor-Prüfung zugleich laufen — die
	// im Hintergrund und die per Knopf „Testen" sollen sich nicht
	// überholen und denselben Deal nicht zweimal posten.
	monitorMu sync.Mutex
	// monitorHTTP ersetzt in Tests den Client für billiger.de; nil heißt
	// srv.http.
	monitorHTTP *http.Client
	// mydealzZuletzt ist der letzte Abruf des mydealz-Feeds; nur der
	// Monitor-Takt liest und schreibt ihn. mydealzFeed ersetzt den Feed in
	// Tests.
	mydealzZuletzt time.Time
	mydealzFeed    string

	// ebayCache hält den eBay-Zugang und die Marktpreise; ebayBasisURL
	// ersetzt die eBay-API in Tests.
	ebayCache    ebayGemerkt
	ebayBasisURL string

	// kaeufeZuletzt ist der letzte Abgleich der ✅ unter Monitor-Posts.
	kaeufeZuletzt time.Time
	// appleBasisURL ersetzt itunes.apple.com in Tests.
	appleBasisURL string
	// spotifyCache hält Zugang und gefundene Podcasts; spotifyBasisURL
	// ersetzt Spotify in Tests.
	spotifyCache    spotifyGemerkt
	spotifyBasisURL string
}

// Neu baut den Server. envKeepaKey ist die Umgebungsvariable KEEPA_API_KEY
// beim Start (leer, wenn nicht gesetzt) — siehe das Feld gleichen Namens.
// Version ist der Stand des Programms, beim Bauen gesetzt
// (-ldflags "-X …/internal/web.Version=2026-09-30.1"). Er steht unten auf
// jeder Seite — so sieht man sofort, ob auf dem Server die neue Datei läuft.
var Version = "Entwicklung"

func Neu(s *store.Store, k *keepa.Client, hc *http.Client, envKeepaKey string) *Server {
	return &Server{
		store:       s,
		keepa:       k,
		http:        hc,
		envKeepaKey: envKeepaKey,
		reaktionen:  &abgleich{anstoss: make(chan struct{}, 1)},
		seller:      &sellerAbgleich{},
		// Die Vorlagen kennen eine einzige eigene Funktion: fahne liefert das
		// Länder-SVG der Marktübersicht. Es als Zeichenkette durch die
		// Seitendaten zu reichen hieße, Markup in Go-Strukturen zu tragen,
		// die sonst nur fertige Zahlen führen.
		tmpl: template.Must(template.New("").Funcs(template.FuncMap{"fahne": fahne, "version": func() string { return Version }, "contains": enthaeltCode, "tabelle": auswertungTabelle}).
			ParseFS(vorlagenFS, "templates/*.html")),
	}
}

// eigeneTypen sind die Endungen, für die Go von sich aus keinen Inhaltstyp
// kennt. Der Rest bleibt Gos Erkennung überlassen.
var eigeneTypen = map[string]string{
	".woff2":       "font/woff2",
	".ico":         "image/x-icon",
	".webmanifest": "application/manifest+json",
}

// inhaltstyp liefert den Inhaltstyp für einen Pfad, oder "" wenn Go ihn selbst
// bestimmen soll.
func inhaltstyp(pfad string) string {
	return eigeneTypen[strings.ToLower(path.Ext(pfad))]
}

// statischAusliefern reicht die eingebetteten Dateien durch und setzt vorher
// den Inhaltstyp für Endungen, die Go nicht kennt.
//
// Gos eingebaute MIME-Tabelle führt .woff2 nicht. Auf Unix liest das
// mime-Paket zusätzlich /etc/mime.types und drei Verwandte — auf einem Mac mit
// Apache-Konfiguration steht woff2 dort, und lokal sieht darum alles richtig
// aus. Im alpine-Image dieses Projekts existiert keine dieser vier Dateien
// (nachgeprüft: das Image installiert nur ca-certificates und su-exec), und
// die Schrift ginge dort als application/octet-stream hinaus. Der Typ wird
// deshalb hier gesetzt, statt ihn der Umgebung des Zielsystems zu überlassen.
//
// Bewusst kein mime.AddExtensionType: das verändert einen prozessweiten
// Zustand, und ein Test könnte auf diesem Mac nicht unterscheiden, ob der Typ
// von der Registrierung oder aus /etc/apache2/mime.types stammt.
//
// http.ServeContent überschreibt einen bereits gesetzten Content-Type nicht,
// der Wert von hier bleibt also stehen. Im Fehlerfall setzt http.Error seinen
// eigenen Typ per Set und ersetzt ihn wieder.
func statischAusliefern() http.Handler {
	dateien := http.FileServerFS(statischFS)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if typ := inhaltstyp(r.URL.Path); typ != "" {
			w.Header().Set("Content-Type", typ)
		}
		dateien.ServeHTTP(w, r)
	})
}

func (srv *Server) Routen() http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /static/", statischAusliefern())
	// Browser fragen das Icon ohne Hinweis im HTML unter /favicon.ico ab.
	mux.HandleFunc("GET /favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/static/favicon.ico"
		statischAusliefern().ServeHTTP(w, r2)
	})

	// Die vier Funnel-Schritte, in der Reihenfolge, in der sie durchlaufen
	// werden. Jede Route liefert das Fragment des Schritts, den sie erreicht
	// — der Zurück-Knopf eines Schritts ruft schlicht die Route des
	// vorherigen auf (siehe den Kommentar am Kopf von deal.go).
	mux.HandleFunc("GET /{$}", srv.zeigeDeal)
	mux.HandleFunc("POST /deal/start", srv.starteDeal)
	mux.HandleFunc("POST /deal/preis", srv.preisDeal)
	mux.HandleFunc("POST /deal/laden", srv.ladeDeal)
	mux.HandleFunc("POST /deal/kauflimit", srv.kauflimitPruefen)
	mux.HandleFunc("POST /deal/berechnung", srv.berechneDeal)
	mux.HandleFunc("POST /deal/vorschau", srv.vorschauDeal)
	mux.HandleFunc("POST /deal/senden", srv.sendeDeal)
	mux.HandleFunc("GET /chart", srv.zeigeChart)

	mux.HandleFunc("POST /deal/entwurf", srv.speichereEntwurf)
	mux.HandleFunc("GET /entwurf/{id}", srv.oeffneEntwurf)
	mux.HandleFunc("POST /entwurf/{id}/loeschen", srv.loescheEntwurf)

	mux.HandleFunc("GET /historie", srv.zeigeHistorie)
	mux.HandleFunc("GET /historie/chart/{datei}", srv.zeigeHistorieChart)
	mux.HandleFunc("GET /deal/erneut/{id}", srv.erneutPosten)
	mux.HandleFunc("POST /post/{id}/ausverkauft", srv.markiereAusverkauft)
	mux.HandleFunc("POST /post/{id}/verfuegbar", srv.markiereVerfuegbar)
	mux.HandleFunc("POST /post/{id}/loeschen", srv.loeschePost)
	mux.HandleFunc("GET /post/{id}/bearbeiten", srv.zeigePostBearbeiten)
	mux.HandleFunc("POST /post/{id}/bearbeiten", srv.speicherePostBearbeiten)

	mux.HandleFunc("GET /statistik", srv.zeigeStatistik)
	mux.HandleFunc("GET /statistik/bild", srv.zeigeStatistikBild)
	mux.HandleFunc("GET /einlesen", srv.zeigeEinlesen)
	mux.HandleFunc("POST /einlesen/start", srv.starteEinlesen)
	mux.HandleFunc("POST /einlesen/uebernehmen", srv.uebernehmeEinlesen)
	mux.HandleFunc("POST /reaktionen/abrufen", srv.reaktionenAbrufen)
	mux.HandleFunc("POST /telegram/chats", srv.telegramChats)
	mux.HandleFunc("POST /telegram/test", srv.telegramTest)

	mux.HandleFunc("GET /channels", srv.zeigeChannels)
	mux.HandleFunc("POST /channels", srv.speichereChannel)
	mux.HandleFunc("POST /channels/{id}/loeschen", srv.loescheChannel)
	mux.HandleFunc("POST /channels/{id}/test", srv.testeChannel)
	mux.HandleFunc("POST /channels/{id}/gruppe", srv.speichereChannelGruppe)
	mux.HandleFunc("POST /channels/{id}/mention", srv.speichereChannelMention)

	mux.HandleFunc("GET /tags", srv.zeigeTags)
	mux.HandleFunc("POST /tags", srv.speichereTag)
	mux.HandleFunc("POST /tags/{id}/loeschen", srv.loescheTag)
	mux.HandleFunc("POST /tags/{id}/standard", srv.standardTag)

	mux.HandleFunc("GET /tarife", srv.zeigeTarife)
	mux.HandleFunc("POST /tarife", srv.speichereTarife)
	mux.HandleFunc("POST /tarife/neu", srv.neueTarifKlasse)
	mux.HandleFunc("POST /tarife/{id}/loeschen", srv.loescheTarifKlasse)

	mux.HandleFunc("GET /go/{kurz}", srv.zumShop)
	mux.HandleFunc("GET /monitor", srv.zeigeMonitor)
	mux.HandleFunc("POST /monitor/produkte", srv.speichereMonitorProdukt)
	mux.HandleFunc("POST /monitor/produkte/{id}/aendern", srv.aendereMonitorProdukt)
	mux.HandleFunc("POST /monitor/produkte/{id}/aktiv", srv.schalteMonitorProdukt)
	mux.HandleFunc("POST /monitor/produkte/{id}/loeschen", srv.loescheMonitorProdukt)
	mux.HandleFunc("POST /monitor/produkte/{id}/testen", srv.testeMonitorProdukt)
	mux.HandleFunc("POST /monitor/regeln", srv.speichereMonitorRegel)
	mux.HandleFunc("POST /monitor/regeln/{id}/aktiv", srv.schalteMonitorRegel)
	mux.HandleFunc("POST /monitor/regeln/{id}/loeschen", srv.loescheMonitorRegel)
	mux.HandleFunc("POST /monitor/einstellungen", srv.speichereMonitorEinstellungen)
	mux.HandleFunc("POST /monitor/produkte/{id}/ankaeufer", srv.speichereAnkaeufer)
	mux.HandleFunc("POST /monitor/ankaeufer/{id}/loeschen", srv.loescheAnkaeufer)
	mux.HandleFunc("POST /monitor/kategorien", srv.speichereKategorie)
	mux.HandleFunc("POST /monitor/kategorien/{id}/loeschen", srv.loescheKategorie)
	mux.HandleFunc("POST /monitor/rabatte", srv.speichereShopRabatt)
	mux.HandleFunc("POST /monitor/rabatte/{id}/loeschen", srv.loescheShopRabatt)
	mux.HandleFunc("POST /monitor/podcasts", srv.speicherePodcast)
	mux.HandleFunc("POST /monitor/podcasts/{id}/aktiv", srv.schaltePodcast)
	mux.HandleFunc("POST /monitor/podcasts/{id}/loeschen", srv.loeschePodcast)
	mux.HandleFunc("POST /monitor/feeds", srv.speichereFeed)
	mux.HandleFunc("POST /monitor/feeds/{id}/aktiv", srv.schalteFeed)
	mux.HandleFunc("POST /monitor/feeds/{id}/loeschen", srv.loescheFeed)
	mux.HandleFunc("POST /monitor/import", srv.zeigeImport)
	mux.HandleFunc("POST /monitor/import/uebernehmen", srv.uebernehmeImport)

	mux.HandleFunc("GET /einstellungen", srv.zeigeEinstellungen)
	mux.HandleFunc("POST /einstellungen", srv.speichereEinstellungen)
	mux.HandleFunc("POST /einstellungen/vorschau", srv.vorschauVorlage)

	return mux
}

// rendere gibt eine benannte Vorlage aus. Fehler beim Rendern werden
// protokolliert statt halb ausgegeben.
func (srv *Server) rendere(w http.ResponseWriter, name string, daten any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := srv.tmpl.ExecuteTemplate(w, name, daten); err != nil {
		log.Printf("Vorlage %s: %v", name, err)
	}
}

// fehler antwortet mit einer schlichten Meldung, die htmx einsetzen kann.
func (srv *Server) fehler(w http.ResponseWriter, status int, meldung string) {
	// Content-Type muss vor WriteHeader gesetzt werden, danach ist es wirkungslos.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := srv.tmpl.ExecuteTemplate(w, "fehler", meldung); err != nil {
		log.Printf("Vorlage fehler: %v", err)
	}
}

// platzhalterDaten füttert die "platzhalter"-Vorlage für Seiten, deren
// eigentlicher Handler erst in einem späteren Task entsteht.
type platzhalterDaten struct {
	Titel     string
	TokenText string
	Text      string
}

// platzhalter rendert Kopf, Hinweistext und Fuß in einem einzigen
// Vorlagenaufruf, damit nur einmal ein Header gesetzt wird.
func (srv *Server) platzhalter(w http.ResponseWriter, titel, text string) {
	srv.rendere(w, "platzhalter", platzhalterDaten{Titel: titel, Text: text})
}

// Der Token-Stand wird bei jeder Keepa-Antwort mitgeführt und in der
// Kopfzeile angezeigt, damit ein leeres Kontingent nicht überrascht.
func (srv *Server) merkeToken(links, verbraucht int) {
	srv.tokenMu.Lock()
	defer srv.tokenMu.Unlock()
	srv.tokenLinks = links
	srv.tokenVerbraucht = verbraucht
}

func (srv *Server) tokenText() string {
	srv.tokenMu.Lock()
	defer srv.tokenMu.Unlock()
	if srv.tokenLinks == 0 && srv.tokenVerbraucht == 0 {
		return ""
	}
	return fmt.Sprintf("Keepa: %d Token übrig (zuletzt %d verbraucht)", srv.tokenLinks, srv.tokenVerbraucht)
}
