package web

import (
	"html/template"

	"github.com/trinkfreunde/lugru-deal-discord/internal/marketplace"
)

// Die Länderflaggen der Marktübersicht, jede als winziges SVG von drei bis
// vier Rechtecken.
//
// Bewusst kein Flaggen-Emoji: Windows stellt sie bis heute nicht dar, sondern
// zeigt statt der Flagge die beiden Buchstaben des Ländercodes — in der Zelle
// stünde dann zweimal dasselbe Kürzel nebeneinander. Und bewusst keine
// Bilddatei: vier Rechtecke im Markup kosten weniger als eine weitere Anfrage
// je Zeile.
//
// preserveAspectRatio="none" ist Absicht: die Rechtecke sollen sich auf das
// Seitenverhältnis der Zelle ziehen lassen, das Stylesheet gibt es vor.
var fahnen = map[marketplace.Code]template.HTML{
	"DE": `<svg viewBox="0 0 5 3" preserveAspectRatio="none"><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#dd0000"/><rect y="2" width="5" height="1" fill="#ffce00"/></svg>`,
	"FR": `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ed2939"/></svg>`,
	"IT": `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="1" height="2" fill="#009246"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ce2b37"/></svg>`,
	"ES": `<svg viewBox="0 0 4 3" preserveAspectRatio="none"><rect width="4" height="3" fill="#c60b1e"/><rect y="0.75" width="4" height="1.5" fill="#ffc400"/></svg>`,
	"NL": `<svg viewBox="0 0 3 3" preserveAspectRatio="none"><rect width="3" height="1" fill="#ae1c28"/><rect y="1" width="3" height="1" fill="#fff"/><rect y="2" width="3" height="1" fill="#21468b"/></svg>`,
	"BE": `<svg viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="1" height="2" fill="#000"/><rect x="1" width="1" height="2" fill="#fdda24"/><rect x="2" width="1" height="2" fill="#ef3340"/></svg>`,
	"PL": `<svg viewBox="0 0 2 2" preserveAspectRatio="none"><rect width="2" height="1" fill="#fff"/><rect y="1" width="2" height="1" fill="#dc143c"/></svg>`,
	"SE": `<svg viewBox="0 0 16 10" preserveAspectRatio="none"><rect width="16" height="10" fill="#006aa7"/><rect x="5" width="2" height="10" fill="#fecc00"/><rect y="4" width="16" height="2" fill="#fecc00"/></svg>`,
	"GB": `<svg viewBox="0 0 12 8" preserveAspectRatio="none"><rect width="12" height="8" fill="#012169"/><path d="M0 0l12 8M12 0L0 8" stroke="#fff" stroke-width="1.6"/><path d="M6 0v8M0 4h12" stroke="#fff" stroke-width="2.6"/><path d="M6 0v8M0 4h12" stroke="#c8102e" stroke-width="1.4"/></svg>`,
}

// fahne ist die Flagge eines Marktes für die Vorlage. Ein unbekanntes Kürzel
// bekommt eine leere graue Fläche statt gar nichts: sonst rutschte die
// Beschriftung um Flaggenbreite nach links und die Spalte stünde schief.
func fahne(code string) template.HTML {
	if f, ok := fahnen[marketplace.Code(code)]; ok {
		return `<span class="fahne">` + f + `</span>`
	}
	return `<span class="fahne"></span>`
}
