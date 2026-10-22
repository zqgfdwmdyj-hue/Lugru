package web

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/ebay"
	"github.com/trinkfreunde/lugru-deal-discord/internal/money"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// eBay als Verkaufsweg: der Monitor rechnet gegen den Marktpreis bei eBay
// (siehe internal/ebay) nach Gebühren und eigenem Versand — wie ein Ankauf,
// nur dass der Preis aus eBay kommt.

// ebayGemerkt hält den Marktpreis je EAN eine halbe Stunde: die Browse-API
// erlaubt 5.000 Abfragen am Tag, und der Monitor prüft im Minutentakt.
type ebayGemerkt struct {
	mu     sync.Mutex
	client *ebay.Client
	schl   string
	preise map[string]ebayStand
}

type ebayStand struct {
	vk     money.Cents
	anzahl int
	zeit   time.Time
}

const ebayMerken = 30 * time.Minute

func (srv *Server) ebayClient() *ebay.Client {
	app, cert := srv.store.Einstellung(store.SchluesselEbayAppID), srv.store.Einstellung(store.SchluesselEbayCertID)
	sellerURL, sellerKey := srv.store.Einstellung(store.SchluesselEbaySellerURL), srv.store.Einstellung(store.SchluesselEbaySellerKey)
	schl := app + "|" + cert + "|" + sellerURL + "|" + sellerKey
	srv.ebayCache.mu.Lock()
	defer srv.ebayCache.mu.Unlock()
	if srv.ebayCache.client == nil || srv.ebayCache.schl != schl {
		srv.ebayCache.client = ebay.NeuerClient(app, cert, srv.http)
		if sellerURL != "" && sellerKey != "" {
			srv.ebayCache.client.Seller = &ebay.Seller{URL: sellerURL, Schluessel: sellerKey}
		}
		if srv.ebayBasisURL != "" {
			srv.ebayCache.client.BasisURL = srv.ebayBasisURL
		}
		srv.ebayCache.schl = schl
		srv.ebayCache.preise = map[string]ebayStand{}
	}
	return srv.ebayCache.client
}

// ebayAnwenden setzt im Produkt den eBay-Marktpreis und als Ankauf den Erlös
// nach Gebühren und Versand.
func (srv *Server) ebayAnwenden(ctx context.Context, p *store.MonitorProdukt, liste billiger.Preisliste) error {
	ean := liste.EAN
	if ean == "" {
		ean = p.EAN
	}
	if ean == "" {
		return errors.New("eBay: ohne EAN keine Suche — billiger.de nennt keine")
	}
	c := srv.ebayClient()
	srv.ebayCache.mu.Lock()
	st, ok := srv.ebayCache.preise[ean]
	srv.ebayCache.mu.Unlock()
	if !ok || time.Since(st.zeit) > ebayMerken {
		as, err := c.Suche(ctx, ean)
		if err != nil {
			return err
		}
		vk, n := ebay.Marktpreis(as, 5)
		if n == 0 {
			return errors.New("eBay: kein neues Sofort-Kaufen-Angebot zu dieser EAN")
		}
		st = ebayStand{vk: vk, anzahl: n, zeit: time.Now()}
		srv.ebayCache.mu.Lock()
		srv.ebayCache.preise[ean] = st
		srv.ebayCache.mu.Unlock()
	}
	gebuehr, _ := strconv.ParseFloat(strings.ReplaceAll(srv.store.Einstellung(store.SchluesselEbayGebuehr), ",", "."), 64)
	fix, _ := money.Parse(srv.store.Einstellung(store.SchluesselEbayGebuehrFix))
	versand, _ := money.Parse(srv.store.Einstellung(store.SchluesselEbayVersand))
	p.EbayVK, p.EbayAnzahl = st.vk, st.anzahl
	p.EbayLink = "https://www.ebay.de/sch/i.html?_nkw=" + url.QueryEscape(ean) + "&LH_BIN=1&LH_ItemCondition=1000"
	p.Ankauf = ebay.Erloes(st.vk, gebuehr, fix, versand)
	return nil
}
