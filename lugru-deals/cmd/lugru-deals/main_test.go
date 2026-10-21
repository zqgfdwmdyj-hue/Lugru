package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestKonfigurationVorgaben(t *testing.T) {
	k := ladeKonfiguration(nil)
	if k.Adresse != "127.0.0.1:8080" {
		t.Errorf("Adresse = %q, will 127.0.0.1:8080 — die Anwendung darf nicht ungefragt im Netz stehen", k.Adresse)
	}
	if k.DBPfad != "deals.db" {
		t.Errorf("DBPfad = %q, will deals.db", k.DBPfad)
	}
	if k.ChartOrdner != "charts" {
		t.Errorf("ChartOrdner = %q, will charts", k.ChartOrdner)
	}
	if !k.BrowserOeffnen {
		t.Error("BrowserOeffnen = false, will true")
	}
}

func TestUmgebungUeberschreibt(t *testing.T) {
	os.Setenv("LUGRU_ADRESSE", "0.0.0.0:9000")
	os.Setenv("LUGRU_DB", "/daten/deals.db")
	os.Setenv("LUGRU_BROWSER", "0")
	t.Cleanup(func() {
		os.Unsetenv("LUGRU_ADRESSE")
		os.Unsetenv("LUGRU_DB")
		os.Unsetenv("LUGRU_BROWSER")
	})

	k := ladeKonfiguration(nil)
	if k.Adresse != "0.0.0.0:9000" {
		t.Errorf("Adresse = %q", k.Adresse)
	}
	if k.DBPfad != "/daten/deals.db" {
		t.Errorf("DBPfad = %q", k.DBPfad)
	}
	if k.BrowserOeffnen {
		t.Error("BrowserOeffnen = true trotz LUGRU_BROWSER=0")
	}
}

func TestFlaggenSchlagenUmgebung(t *testing.T) {
	os.Setenv("LUGRU_ADRESSE", "0.0.0.0:9000")
	t.Cleanup(func() { os.Unsetenv("LUGRU_ADRESSE") })

	k := ladeKonfiguration([]string{"-adresse", "127.0.0.1:7777"})
	if k.Adresse != "127.0.0.1:7777" {
		t.Errorf("Adresse = %q, will die Flagge 127.0.0.1:7777", k.Adresse)
	}
}

// TestBindFehlerWirdGemeldet stellt sicher, dass ein Bind-Fehler (z. B. eine
// Adresse, die schon belegt ist) als Fehler zurückkommt, statt — wie früher
// über log.Fatalf — den ganzen Prozess (und damit auch diesen Testlauf)
// sofort zu beenden. Ohne diese Eigenschaft würde im echten Betrieb ein
// zweiter Start auf derselben Adresse defer s.Close() in laufe()
// überspringen und die Datenbankverbindung offen lassen.
func TestBindFehlerWirdGemeldet(t *testing.T) {
	belegt, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listener für den Testaufbau: %v", err)
	}
	defer belegt.Close()

	adresse := belegt.Addr().String()
	server := &http.Server{Addr: adresse}

	// Großzügiges Zeitlimit als Sicherheitsnetz: das eigentliche Signal ist
	// hier der Bind-Fehler, der binnen Mikrosekunden eintrifft, nicht der
	// Kontextabbruch.
	ctx, abbruch := context.WithTimeout(context.Background(), 5*time.Second)
	defer abbruch()

	if err := starteUndWarte(ctx, server, adresse, false); err == nil {
		t.Fatal("starteUndWarte() = nil, will einen Fehler wegen der bereits belegten Adresse")
	}
}

// TestStarteUndWarteBeendetSichBeiAbbruch belegt, dass der reguläre Ablauf
// (Abbruch über den Kontext, wie bei SIGTERM/Interrupt) weiterhin ohne
// Fehler und ohne Hänger durchläuft — die Umstellung auf einen
// Fehlerrückgabewert darf diesen Pfad nicht verändern.
func TestStarteUndWarteBeendetSichBeiAbbruch(t *testing.T) {
	server := &http.Server{Addr: "127.0.0.1:0"}

	ctx, abbruch := context.WithCancel(context.Background())
	abbruch() // Kontext ist schon abgebrochen, bevor der Server überhaupt startet.

	fertig := make(chan error, 1)
	go func() { fertig <- starteUndWarte(ctx, server, "127.0.0.1:0", false) }()

	select {
	case err := <-fertig:
		if err != nil {
			t.Errorf("starteUndWarte() = %v, will nil beim geordneten Abbruch", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("starteUndWarte() kehrte nach dem Abbruch nicht rechtzeitig zurück")
	}
}
