package web

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/trinkfreunde/lugru-deal-discord/internal/billiger"
	"github.com/trinkfreunde/lugru-deal-discord/internal/store"
)

// Direkte Shop-Links: billiger.de verschlüsselt den Weg zum Shop, und der
// entschlüsselte Link läuft nach einem Tag ab. Im Post steht darum ein
// Kurzlink auf diesen Server (/go/<kurz>); erst beim Klick wird über
// billiger.de der aktuelle Weg zum Shop geholt. Klappt das nicht, geht es auf
// die Seite bei billiger.de.
//
// /go/ ist ohne Anmeldung erreichbar (siehe MitPasswort) — sonst könnten eure
// Mitglieder den Link nicht öffnen. Er verrät nichts außer dem Ziel.

// basisURL ist die öffentliche Adresse dieses Servers, ohne „/" am Ende.
func (srv *Server) basisURL() string {
	return strings.TrimRight(strings.TrimSpace(srv.store.Einstellung(store.SchluesselMonitorBasisURL)), "/")
}

// shopLink liefert den Kurzlink zum Shop, leer ohne öffentliche Adresse oder
// ohne Klick-Schlüssel.
func (srv *Server) shopLink(a billiger.Angebot, ersatz string) string {
	basis := srv.basisURL()
	if basis == "" || a.Klick == "" {
		return ""
	}
	kurz, err := srv.store.MonitorLink(a.Klick, ersatz)
	if err != nil {
		return ""
	}
	return basis + "/go/" + kurz
}

// gueltigeBasisURL prüft die eingetragene Adresse.
func gueltigeBasisURL(roh string) (string, bool) {
	roh = strings.TrimRight(strings.TrimSpace(roh), "/")
	if roh == "" {
		return "", true
	}
	u, err := url.Parse(roh)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" {
		return "", false
	}
	return roh, true
}

// zumShop leitet einen Kurzlink weiter.
func (srv *Server) zumShop(w http.ResponseWriter, r *http.Request) {
	schluessel, ersatz, ok := srv.store.MonitorLinkAufloesen(r.PathValue("kurz"))
	if !ok {
		http.Error(w, "Link unbekannt oder abgelaufen.", http.StatusNotFound)
		return
	}
	ziel, err := billiger.KlickLink(r.Context(), srv.monitorClient(), schluessel)
	if err != nil {
		ziel = ersatz
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, ziel, http.StatusFound)
}
