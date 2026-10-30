// Kommando lugru-deals startet die lokale Oberfläche.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // Zeitzonen auch auf Servern ohne eigene Zeitzonendaten

	"github.com/trinkfreunde/lugru-deal-discord/internal/keepa"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
	"github.com/trinkfreunde/lugru-deal-discord/internal/web"
)

type konfiguration struct {
	Adresse        string
	DBPfad         string
	ChartOrdner    string
	BrowserOeffnen bool
	KeepaKey       string
}

// ladeKonfiguration liest Vorgaben, Umgebungsvariablen und Flaggen — in
// dieser Reihenfolge, spätere gewinnen.
//
// Die Vorgabeadresse ist 127.0.0.1: die Anwendung hat keine Anmeldung und darf
// darum nicht ungefragt im Netz erreichbar sein. Im Docker-Betrieb setzt das
// Image LUGRU_ADRESSE auf 0.0.0.0.
func ladeKonfiguration(argumente []string) konfiguration {
	k := konfiguration{
		Adresse:        "127.0.0.1:8080",
		DBPfad:         "deals.db",
		ChartOrdner:    "charts",
		BrowserOeffnen: true,
	}

	if v := os.Getenv("LUGRU_ADRESSE"); v != "" {
		k.Adresse = v
	}
	if v := os.Getenv("LUGRU_DB"); v != "" {
		k.DBPfad = v
	}
	if v := os.Getenv("LUGRU_CHARTS"); v != "" {
		k.ChartOrdner = v
	}
	if v := os.Getenv("LUGRU_BROWSER"); v == "0" || strings.EqualFold(v, "false") {
		k.BrowserOeffnen = false
	}
	k.KeepaKey = os.Getenv("KEEPA_API_KEY")

	if argumente != nil {
		fs := flag.NewFlagSet("lugru-deals", flag.ContinueOnError)
		fs.StringVar(&k.Adresse, "adresse", k.Adresse, "Adresse, auf der gelauscht wird")
		fs.StringVar(&k.DBPfad, "db", k.DBPfad, "Pfad zur SQLite-Datei")
		fs.StringVar(&k.ChartOrdner, "charts", k.ChartOrdner, "Ordner für Chart-Bilder")
		browser := fs.Bool("browser", k.BrowserOeffnen, "Browser beim Start öffnen")
		if err := fs.Parse(argumente); err == nil {
			k.BrowserOeffnen = *browser
		}
	}
	return k
}

func main() {
	os.Exit(laufe())
}

// laufe enthält den eigentlichen Programmablauf und liefert den
// Exit-Code zurück. Die Trennung von main() hat einen einzigen Zweck: alle
// defer-Aufrufe in laufe() — allen voran s.Close() — müssen auch dann
// laufen, wenn der Prozess am Ende nicht mit 0 beendet werden soll. os.Exit
// überspringt sämtliche defer-Aufrufe; deshalb ruft main() es erst auf,
// nachdem laufe() (und damit alle seine defers) bereits durchgelaufen ist.
func laufe() int {
	k := ladeKonfiguration(os.Args[1:])
	setzeZeitzone()

	s, err := store.Open(k.DBPfad, k.ChartOrdner)
	if err != nil {
		log.Fatalf("Datenbank: %v", err)
	}
	defer s.Close()

	// Der Key aus der Umgebung sticht die Einstellung — so lässt sich das
	// Docker-Image ohne vorbefüllte Datenbank betreiben.
	key := k.KeepaKey
	if key == "" {
		key = s.Einstellung(store.SchluesselKeepaKey)
	}
	if key == "" {
		log.Println("Hinweis: kein Keepa-API-Key gesetzt — unter Einstellungen nachtragen, sonst bleiben Deals ohne Daten.")
	}

	hc := &http.Client{Timeout: 30 * time.Second}
	srv := web.Neu(s, keepa.NeuerClient(key), hc, k.KeepaKey)

	server := &http.Server{
		Addr:              k.Adresse,
		Handler:           web.MitPasswort(srv.Routen(), os.Getenv("LUGRU_BENUTZER"), os.Getenv("LUGRU_PASSWORT"), s),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Liest regelmäßig die Reaktionen (✅/❌) unter den Posts, sobald ein
	// Bot-Token eingetragen ist.
	srv.StarteReaktionsAbgleich(ctx)
	// Der Shop-Monitor prüft im Hintergrund die beobachteten Produkte bei
	// billiger.de — nur, solange er unter Monitor eingeschaltet ist.
	srv.StarteMonitor(ctx)
	// Eingelesene Deals mit dem aktuellen Einlesen nachprüfen — so werden
	// Zahlen, die eine ältere Version falsch gelesen hat, beim Start
	// berichtigt.
	if n, u := srv.EingeleseneNachpruefen(); n+u > 0 {
		log.Printf("Eingelesene Deals nachgeprüft: %d berichtigt, %d ohne lesbaren Gewinn", n, u)
	}

	if os.Getenv("LUGRU_PASSWORT") == "" && !strings.HasPrefix(k.Adresse, "127.0.0.1") && !strings.HasPrefix(k.Adresse, "localhost") {
		log.Println("WARNUNG: die Oberfläche ist aus dem Netz erreichbar und ohne Passwort — LUGRU_PASSWORT setzen!")
	}

	if err := starteUndWarte(ctx, server, k.Adresse, k.BrowserOeffnen); err != nil {
		log.Printf("Server: %v", err)
		return 1
	}
	return 0
}

// starteUndWarte startet den Server in einer eigenen Goroutine, wartet auf
// den Abbruch von ctx (SIGTERM/Interrupt) oder auf einen Fehler beim Binden
// bzw. Bedienen — etwa "address already in use" — und fährt den Server in
// jedem Fall geordnet herunter.
//
// Ein Bind-/Serve-Fehler wird zurückgegeben statt wie zuvor mit log.Fatalf
// den Prozess sofort zu beenden: log.Fatalf ruft os.Exit auf, und das
// überspringt sämtliche defer-Aufrufe im Aufrufer — insbesondere das
// Schließen der Datenbank in laufe().
func starteUndWarte(ctx context.Context, server *http.Server, adresse string, browserOeffnen bool) error {
	fehler := make(chan error, 1)
	go func() {
		log.Printf("Lugru Deals läuft auf http://%s", adresse)
		if browserOeffnen {
			oeffneBrowser("http://" + adresse)
		}
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fehler <- err
			return
		}
		fehler <- nil
	}()

	var serverFehler error
	select {
	case <-ctx.Done():
		log.Println("Beende…")
	case serverFehler = <-fehler:
	}

	herunter, abbruch := context.WithTimeout(context.Background(), 5*time.Second)
	defer abbruch()
	_ = server.Shutdown(herunter)

	return serverFehler
}

// oeffneBrowser startet den Standardbrowser. Schlägt das fehl, ist das kein
// Grund abzubrechen — die Adresse steht im Protokoll.
func oeffneBrowser(url string) {
	var befehl string
	var argumente []string

	switch runtime.GOOS {
	case "windows":
		befehl, argumente = "rundll32", []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		befehl, argumente = "open", []string{url}
	default:
		befehl, argumente = "xdg-open", []string{url}
	}

	if err := exec.Command(befehl, argumente...).Start(); err != nil {
		log.Printf("Browser nicht geöffnet (%v) — bitte %s selbst aufrufen", err, url)
	}
}

// setzeZeitzone legt fest, in welcher Zeit Datum und Uhrzeit angezeigt
// werden. Auf einem Server steht die Systemzeit meist auf UTC — dort wären
// alle Zeiten in der Oberfläche zwei Stunden hinter der Uhr in Discord.
// Vorgabe ist darum Europe/Berlin; LUGRU_ZEITZONE oder TZ stechen sie.
func setzeZeitzone() {
	name := os.Getenv("LUGRU_ZEITZONE")
	if name == "" && os.Getenv("TZ") != "" {
		return
	}
	if name == "" {
		name = "Europe/Berlin"
	}
	if z, err := time.LoadLocation(name); err == nil {
		time.Local = z
	} else {
		log.Printf("Zeitzone %q unbekannt: %v", name, err)
	}
}
