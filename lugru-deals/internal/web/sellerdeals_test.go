package web

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// sellerStub spielt den Deal-Import des Seller-Systems.
type sellerStub struct {
	mu      sync.Mutex
	pakete  [][]map[string]any
	roh     []string
	status  int
	pfad    string
	auth    string
	aufrufe int
}

func neuerSellerStub(t *testing.T) (*sellerStub, *httptest.Server) {
	st := &sellerStub{status: http.StatusOK}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st.mu.Lock()
		defer st.mu.Unlock()
		st.aufrufe++
		st.pfad = r.URL.Path
		st.auth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		st.roh = append(st.roh, string(b))
		var body struct {
			Deals []map[string]any `json:"deals"`
		}
		_ = json.Unmarshal(b, &body)
		st.pakete = append(st.pakete, body.Deals)
		w.WriteHeader(st.status)
		if st.status == http.StatusOK {
			io.WriteString(w, `{"ok":true,"neu":1,"aktualisiert":0,"ungueltig":0}`)
		} else {
			io.WriteString(w, `{"ok":false,"error":"Verbindungsschlüssel fehlt oder ist falsch."}`)
		}
	}))
	t.Cleanup(srv.Close)
	return st, srv
}

func TestDealsGehenAnsSellerSystemNurZahlenUndAnzahlen(t *testing.T) {
	srv, s := testServer(t)
	stub, ss := neuerSellerStub(t)

	// Ohne Adresse/Schlüssel geschieht nichts.
	if n, err := srv.dealsAnsSeller(context.Background()); n != 0 || err != nil || stub.aufrufe != 0 {
		t.Fatalf("ohne Einstellung gesendet: n=%d err=%v aufrufe=%d", n, err, stub.aufrufe)
	}
	_ = s.SetzeEinstellung(store.SchluesselEbaySellerURL, ss.URL+"/")
	_ = s.SetzeEinstellung(store.SchluesselEbaySellerKey, "test-schluessel")

	alt := time.Now().AddDate(0, -6, 0)
	haupt, err := s.DealAnlegen(store.Deal{ASIN: "B0TEST0001", Titel: "Testartikel", Quellmarkt: "DE", Zielmarkt: "DE",
		EKCent: money.Cents(1190), VKCent: money.Cents(2999), Sales: 120, GewinnCent: money.Cents(650), MargeProzent: 21.7,
		ChannelName: "deals", Gruppe: "Gruppe A", NachrichtText: "geheimer Text", Poster: "Testperson", GepostetAm: alt})
	if err != nil {
		t.Fatal(err)
	}
	folge, _ := s.DealAnlegen(store.Deal{ASIN: "B0TEST0001", Titel: "Testartikel", ChannelName: "b2b", HauptID: haupt, GepostetAm: alt})
	_ = s.DealReaktionenSetzen(haupt, 3, 1, alt.Add(time.Hour))
	_ = s.DealReaktionenSetzen(folge, 2, 0, alt.Add(2*time.Hour))
	_, _ = s.DealAnlegen(store.Deal{ASIN: "kaputt", Titel: "ohne ASIN", GepostetAm: alt})

	// Erster Lauf: ganze History (auch der sechs Monate alte Deal).
	n, err := srv.dealsAnsSeller(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("erster Lauf: n=%d err=%v", n, err)
	}
	if stub.pfad != "/api/public/lugru-deals/deals" || stub.auth != "Bearer test-schluessel" {
		t.Errorf("Ziel %q / Auth %q", stub.pfad, stub.auth)
	}
	d := stub.pakete[0][0]
	if d["asin"] != "B0TEST0001" || d["kaeufe"].(float64) != 5 || d["nicht_verfuegbar"].(float64) != 1 {
		t.Errorf("Folge-Post nicht eingerechnet: %v", d)
	}
	if d["ek_eur"].(float64) != 11.9 || d["vk_eur"].(float64) != 29.99 || d["verkaeufe_monat"].(float64) != 120 || d["status"] != "aktiv" {
		t.Errorf("Zahlen falsch: %v", d)
	}
	for _, verboten := range []string{"geheimer Text", "Testperson", "poster", "nachricht"} {
		if strings.Contains(stub.roh[0], verboten) {
			t.Errorf("gesendet wurde %q", verboten)
		}
	}
	if s.Einstellung(sellerVollStand) == "" {
		t.Error("Stand der vollen History nicht gemerkt")
	}
	if st := srv.sellerStand(); !st.Aktiv || st.Anzahl != 1 || st.Fehler != "" || st.Zuletzt == "" {
		t.Errorf("Stand = %+v", st)
	}

	// Danach nur noch die letzten 30 Tage: der alte Deal fehlt, ein neuer kommt.
	_, _ = s.DealAnlegen(store.Deal{ASIN: "B0TEST0002", Titel: "Neu", EKCent: money.Cents(500)})
	n, err = srv.dealsAnsSeller(context.Background())
	if err != nil || n != 1 || stub.pakete[1][0]["asin"] != "B0TEST0002" {
		t.Fatalf("zweiter Lauf: n=%d err=%v pakete=%v", n, err, stub.pakete[1])
	}

	// Falscher Schlüssel: verständlicher Fehler in der Anzeige.
	stub.status = http.StatusUnauthorized
	if _, err := srv.dealsAnsSeller(context.Background()); err == nil || !strings.Contains(err.Error(), "Verbindungsschlüssel falsch") {
		t.Errorf("Fehler = %v", err)
	}
	if st := srv.sellerStand(); !strings.Contains(st.Fehler, "Verbindungsschlüssel") {
		t.Errorf("Anzeige ohne Fehler: %+v", st)
	}
	seite := hole(t, srv, http.MethodGet, "/monitor", "").Body.String()
	if !strings.Contains(seite, "Verbindungsschlüssel falsch") {
		t.Errorf("Monitor-Seite zeigt den Fehler nicht")
	}
}

func TestNachDemPostenGehtDerDealSofortAnsSellerSystem(t *testing.T) {
	srv, s := testServer(t)
	stub, ss := neuerSellerStub(t)
	_ = s.SetzeEinstellung(store.SchluesselEbaySellerURL, ss.URL)
	_ = s.SetzeEinstellung(store.SchluesselEbaySellerKey, "test-schluessel")
	_ = s.SetzeEinstellung(sellerVollStand, time.Now().UTC().Format(time.RFC3339))
	alt := sellerSofortWarten
	sellerSofortWarten = 50 * time.Millisecond
	t.Cleanup(func() { sellerSofortWarten = alt })

	_, err := s.DealAnlegen(store.Deal{ASIN: "B0TEST0003", Titel: "Frisch", QuellURL: "https://www.testshop.example/p/1", EKCent: money.Cents(1190), EKArt: "netto", MaxMenge: 5, ChannelName: "deals"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv.StarteSellerAbgleich(ctx)
	srv.stosseSellerAn()
	srv.stosseSellerAn() // zweiter Anstoß in der Wartezeit ergibt keinen zweiten Lauf
	frist := time.Now().Add(5 * time.Second)
	for {
		stub.mu.Lock()
		n := stub.aufrufe
		stub.mu.Unlock()
		if n > 0 || time.Now().After(frist) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if stub.aufrufe != 1 || len(stub.pakete[0]) != 1 {
		t.Fatalf("nicht sofort gesendet: aufrufe=%d", stub.aufrufe)
	}
	d := stub.pakete[0][0]
	if d["shop"] != "testshop.example" || d["einkaufslink"] != "https://www.testshop.example/p/1" || d["ek_art"] != "netto" || d["max_menge"].(float64) != 5 {
		t.Errorf("Felder für den Live-Eingang fehlen: %v", d)
	}
}
