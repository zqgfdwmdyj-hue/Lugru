package web

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Das Lugru-Seller-System lernt aus den geposteten Deals, welche Deals
// gekauft wurden (Deal-Eingang → „Lernender Deal-Wert“). Gesendet werden nur
// die Zahlen eines Deals und die Reaktionen als ANZAHL (✅ gekauft, ❌ nicht
// verfügbar) — kein Nachrichtentext, kein Poster, keine Namen. Ein Deal, der
// zusätzlich in weitere Channels ging, zählt einmal: seine Reaktionen werden
// beim ersten Post zusammengezählt.
//
// Beim ersten Lauf geht die ganze History hinüber (in Paketen), danach
// stündlich die Deals der letzten sellerTage. Zusätzlich gleich nach jedem
// Posten (und nach Ausverkauft/Bearbeiten/neuen Reaktionen) die Deals der
// letzten sellerTageSofort – so steht ein neuer Deal nach Sekunden im
// Deal-Eingang des Seller-Systems. Ohne Seller-Adresse und
// Verbindungsschlüssel (Monitor → Einstellungen → eBay) geschieht nichts.

const (
	sellerAlle       = time.Hour
	sellerTage       = 30
	sellerPaket      = 500
	sellerVollStand  = "seller.deals_voll"
	sellerTageSofort = 2
)

// sellerSofortWarten: nach dem Posten kurz warten, damit Folge-Posts in
// weitere Channels im selben Paket mitgehen (Variable nur für Tests).
var sellerSofortWarten = 10 * time.Second

type sellerAbgleich struct {
	mu      sync.Mutex
	laeuft  bool
	zuletzt time.Time
	anzahl  int
	fehler  string
	// anstoss weckt den Abgleich sofort (nach dem Posten). Gepuffert mit 1:
	// mehrere Anstöße hintereinander ergeben einen Lauf.
	anstoss chan struct{}
}

// stosseSellerAn weckt den Abgleich ans Seller-System, ohne zu warten.
func (srv *Server) stosseSellerAn() {
	if srv.seller == nil {
		return
	}
	select {
	case srv.seller.anstoss <- struct{}{}:
	default:
	}
}

// sellerDeal ist ein Deal, wie ihn das Seller-System erwartet
// (POST /api/public/lugru-deals/deals).
type sellerDeal struct {
	ID              int64    `json:"id"`
	ASIN            string   `json:"asin"`
	Titel           string   `json:"titel,omitempty"`
	Quellmarkt      string   `json:"quellmarkt,omitempty"`
	Zielmarkt       string   `json:"zielmarkt,omitempty"`
	EKEur           *float64 `json:"ek_eur"`
	VKEur           *float64 `json:"vk_eur"`
	GewinnEur       *float64 `json:"gewinn_eur"`
	MargeProzent    *float64 `json:"marge_prozent"`
	VerkaeufeMonat  *int     `json:"verkaeufe_monat"`
	Gruppe          string   `json:"gruppe,omitempty"`
	Kanal           string   `json:"kanal,omitempty"`
	Status          string   `json:"status,omitempty"`
	Kaeufe          int      `json:"kaeufe"`
	NichtVerfuegbar int      `json:"nicht_verfuegbar"`
	ReaktionenAm    string   `json:"reaktionen_am,omitempty"`
	GepostetAm      string   `json:"gepostet_am"`
	// Discord-Nachricht des Posts: Das Seller-System liest die Deal-Kanäle auch selbst und führt
	// beide Quellen über diese ID zusammen (kein Deal doppelt).
	DiscordKanalID     string `json:"discord_kanal_id,omitempty"`
	DiscordNachrichtID string `json:"discord_nachricht_id,omitempty"`
	// Für den Live-Eingang im Seller-System: Shop und Einkaufslink (leer bei
	// Amazon-Einkauf), wie der EK eingegeben wurde, Höchstmenge je Bestellung.
	Shop         string `json:"shop,omitempty"`
	Einkaufslink string `json:"einkaufslink,omitempty"`
	EKArt        string `json:"ek_art,omitempty"`
	MaxMenge     int    `json:"max_menge,omitempty"`
}

// shopAus liefert den Shop-Namen aus dem Einkaufslink („www.shop.de/…“ → „shop.de“).
func shopAus(link string) string {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil || u.Host == "" {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

func euro(c int64) *float64 {
	if c == 0 {
		return nil
	}
	v := float64(c) / 100
	return &v
}

// sellerDeals macht aus Deals die Sendeliste: Folge-Posts (HauptID ≠ 0)
// zählen ihre Reaktionen beim ersten Post mit und fallen selbst weg. Fehlt
// der erste Post in der Liste, liefert haupt ihn nach (nil: Folge-Post
// verwerfen).
func sellerDeals(deals []store.Deal, haupt func(id int64) (store.Deal, bool)) []sellerDeal {
	index := map[int64]int{}
	var out []sellerDeal
	add := func(d store.Deal) int {
		if i, ok := index[d.ID]; ok {
			return i
		}
		gewinn, marge := int64(d.EffGewinnCent), d.EffMargeProzent
		if gewinn == 0 {
			gewinn, marge = int64(d.GewinnCent), d.MargeProzent
		}
		sd := sellerDeal{
			ID: d.ID, ASIN: strings.ToUpper(strings.TrimSpace(d.ASIN)), Titel: d.Titel,
			Quellmarkt: d.Quellmarkt, Zielmarkt: d.Zielmarkt,
			EKEur: euro(int64(d.EKCent)), VKEur: euro(int64(d.VKCent)), GewinnEur: euro(gewinn),
			Gruppe: d.Gruppe, Kanal: d.ChannelName, Status: d.Status,
			Kaeufe: d.Kaeufe, NichtVerfuegbar: d.NichtVerfuegbar,
			GepostetAm:     d.GepostetAm.UTC().Format(time.RFC3339),
			DiscordKanalID: d.DiscordKanalID, DiscordNachrichtID: d.DiscordNachrichtID,
			Shop: shopAus(d.QuellURL), Einkaufslink: strings.TrimSpace(d.QuellURL), EKArt: d.EKArt, MaxMenge: d.MaxMenge,
		}
		if sd.Status == store.StatusAktiv {
			sd.Status = "aktiv"
		}
		if marge != 0 {
			m := marge
			sd.MargeProzent = &m
		}
		if d.Sales > 0 {
			s := d.Sales
			sd.VerkaeufeMonat = &s
		}
		if !d.ReaktionenAm.IsZero() {
			sd.ReaktionenAm = d.ReaktionenAm.UTC().Format(time.RFC3339)
		}
		out = append(out, sd)
		index[d.ID] = len(out) - 1
		return len(out) - 1
	}
	for _, d := range deals {
		if d.HauptID == 0 {
			add(d)
		}
	}
	for _, d := range deals {
		if d.HauptID == 0 {
			continue
		}
		i, ok := index[d.HauptID]
		if !ok {
			h, gefunden := haupt(d.HauptID)
			if !gefunden {
				continue
			}
			i = add(h)
		}
		out[i].Kaeufe += d.Kaeufe
		out[i].NichtVerfuegbar += d.NichtVerfuegbar
		if d.ReaktionenAm.After(parseZeit(out[i].ReaktionenAm)) {
			out[i].ReaktionenAm = d.ReaktionenAm.UTC().Format(time.RFC3339)
		}
	}
	// Ohne gültige ASIN kann das Seller-System den Deal nicht zuordnen.
	gut := out[:0]
	for _, sd := range out {
		if len(sd.ASIN) == 10 {
			gut = append(gut, sd)
		}
	}
	return gut
}

func parseZeit(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

// StarteSellerAbgleich sendet die Deals im Hintergrund ans Seller-System:
// kurz nach dem Start (beim ersten Mal die ganze History), dann stündlich.
func (srv *Server) StarteSellerAbgleich(ctx context.Context) {
	go func() {
		erster := time.NewTimer(2 * time.Minute)
		defer erster.Stop()
		takt := time.NewTicker(sellerAlle)
		defer takt.Stop()
		for {
			tage := sellerTage
			select {
			case <-ctx.Done():
				return
			case <-erster.C:
			case <-takt.C:
			case <-srv.seller.anstoss:
				select {
				case <-ctx.Done():
					return
				case <-time.After(sellerSofortWarten):
				}
				// Was in der Wartezeit dazukam, geht im selben Lauf mit.
				select {
				case <-srv.seller.anstoss:
				default:
				}
				tage = sellerTageSofort
			}
			if n, err := srv.dealsAnsSellerTage(ctx, tage); err != nil {
				log.Printf("Deals ans Seller-System: %s", sicherFehlertext(err.Error()))
			} else if n > 0 {
				log.Printf("Deals ans Seller-System: %d gesendet", n)
			}
		}
	}()
}

var errSellerFehlt = errors.New("kein Seller-System hinterlegt")

// dealsAnsSeller sendet die Deals (beim ersten Mal alle, sonst die der
// letzten sellerTage) und liefert die Anzahl der gesendeten Deals.
func (srv *Server) dealsAnsSeller(ctx context.Context) (int, error) {
	return srv.dealsAnsSellerTage(ctx, sellerTage)
}

// dealsAnsSellerTage wie dealsAnsSeller, aber mit wählbarem Zeitraum (nach
// dem Posten nur die jüngsten Tage).
func (srv *Server) dealsAnsSellerTage(ctx context.Context, tage int) (int, error) {
	url := strings.TrimRight(strings.TrimSpace(srv.store.Einstellung(store.SchluesselEbaySellerURL)), "/")
	key := strings.TrimSpace(srv.store.Einstellung(store.SchluesselEbaySellerKey))
	if url == "" || key == "" {
		return 0, nil
	}
	srv.seller.mu.Lock()
	if srv.seller.laeuft {
		srv.seller.mu.Unlock()
		return 0, nil
	}
	srv.seller.laeuft = true
	srv.seller.mu.Unlock()

	n, err := srv.sellerDurchgang(ctx, url, key, tage)

	srv.seller.mu.Lock()
	srv.seller.laeuft = false
	srv.seller.zuletzt = time.Now()
	srv.seller.anzahl = n
	srv.seller.fehler = ""
	if err != nil {
		srv.seller.fehler = sicherFehlertext(err.Error())
	}
	srv.seller.mu.Unlock()
	return n, err
}

func (srv *Server) sellerDurchgang(ctx context.Context, url, key string, tage int) (int, error) {
	voll := srv.store.Einstellung(sellerVollStand) == ""
	f := store.DealFilter{Status: "alle", Limit: sellerPaket}
	if !voll {
		f.Von = time.Now().AddDate(0, 0, -tage)
	}
	var alle []store.Deal
	for {
		seite, err := srv.store.Deals(f)
		if err != nil {
			return 0, fmt.Errorf("Deals nicht lesbar: %w", err)
		}
		alle = append(alle, seite...)
		if len(seite) < sellerPaket || ctx.Err() != nil {
			break
		}
		f.Offset += sellerPaket
	}
	liste := sellerDeals(alle, func(id int64) (store.Deal, bool) {
		d, err := srv.store.Deal(id)
		return d, err == nil
	})
	gesendet := 0
	for i := 0; i < len(liste); i += sellerPaket {
		ende := min(i+sellerPaket, len(liste))
		if err := srv.sendeAnSeller(ctx, url, key, liste[i:ende]); err != nil {
			return gesendet, err
		}
		gesendet += ende - i
	}
	if voll {
		_ = srv.store.SetzeEinstellung(sellerVollStand, time.Now().UTC().Format(time.RFC3339))
	}
	return gesendet, nil
}

func (srv *Server) sendeAnSeller(ctx context.Context, url, key string, deals []sellerDeal) error {
	roh, err := json.Marshal(map[string]any{"deals": deals})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url+"/api/public/lugru-deals/deals", bytes.NewReader(roh))
	if err != nil {
		return errors.New("Seller-System: Adresse ungültig")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.http.Do(req)
	if err != nil {
		return errors.New("Seller-System nicht erreichbar")
	}
	defer resp.Body.Close()
	antwort, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	var r struct {
		Fehler string `json:"error"`
	}
	_ = json.Unmarshal(antwort, &r)
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return errors.New("Seller-System: Verbindungsschlüssel falsch (Anbindungen → Lugru Deals)")
	case resp.StatusCode == http.StatusNotFound:
		return errors.New("Seller-System: Deal-Import nicht gefunden — ist es auf dem neuesten Stand?")
	case resp.StatusCode != http.StatusOK:
		if r.Fehler != "" {
			return errors.New("Seller-System: " + r.Fehler)
		}
		return fmt.Errorf("Seller-System: HTTP %d", resp.StatusCode)
	}
	return nil
}

// sellerStand ist der Zustand für die Anzeige in den Einstellungen.
type sellerStand struct {
	Aktiv   bool
	Zuletzt string
	Anzahl  int
	Fehler  string
}

func (srv *Server) sellerStand() sellerStand {
	srv.seller.mu.Lock()
	defer srv.seller.mu.Unlock()
	st := sellerStand{
		Aktiv:  srv.store.Einstellung(store.SchluesselEbaySellerURL) != "" && srv.store.Einstellung(store.SchluesselEbaySellerKey) != "",
		Anzahl: srv.seller.anzahl,
		Fehler: srv.seller.fehler,
	}
	if !srv.seller.zuletzt.IsZero() {
		st.Zuletzt = srv.seller.zuletzt.Local().Format("02.01.2006 15:04")
	}
	return st
}
