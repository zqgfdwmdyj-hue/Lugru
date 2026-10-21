package web

import (
	"html/template"
	"net/url"
	"regexp"
	"strings"
)

// kartenVorschau ist der Post, wie die Weboberfläche ihn zeigt.
//
// Sie ist eine Nachbildung, keine zweite Wahrheit: der Text ist genau der,
// der gesendet wird. Nachgebaut wird nur die Darstellung — ein Kasten mit
// rohem Markdown ("[Amazon.DE](https://…)") sagt niemandem, wie der Post
// aussehen wird.
type kartenVorschau struct {
	Text template.HTML
	// ChartURL ist der Preisverlauf unter dem Text, leer ohne Chart.
	ChartURL string
}

// kartenVorschauAus baut die Anzeige aus dem fertigen Post.
func kartenVorschauAus(text, chartURL string) kartenVorschau {
	return kartenVorschau{
		Text:     markdownHTML(emojiKurzformen.Replace(text)),
		ChartURL: chartURL,
	}
}

// emojiKurzformen sind die Discord-Kurzformen, die in den Vorlagen stehen.
// Discord zeigt sie als Emoji; die Vorschau soll es auch.
var emojiKurzformen = strings.NewReplacer(
	":bar_chart:", "📊",
	":chart_with_upwards_trend:", "📈",
)

var (
	linkMuster = regexp.MustCompile(`\[([^\]]*)\]\(([^)]*)\)`)
	fettMuster = regexp.MustCompile(`\*\*([^*]+)\*\*`)
)

// markdownHTML übersetzt genau die beiden Markdown-Formen, die in einem
// Post vorkommen: Links und Fettschrift. Kein vollständiger Markdown-Parser —
// mehr entsteht im Post nicht, und ein Parser, der mehr kann als der
// Erzeuger, lädt Fälle ein, die es nie gibt.
//
// Zuerst wird escaped, dann ersetzt: umgekehrt würde ein Produktname mit
// "<" oder "&" darin die eigenen Ersetzungen wieder zerlegen. Die Adresse
// eines Links geht zusätzlich durch sichereURL — sie stammt zwar aus
// marketplace und dem Einkaufslink, aber ein Link, der irgendwann einmal
// "javascript:" trägt, soll hier scheitern und nicht klicken lassen.
func markdownHTML(roh string) template.HTML {
	sicher := template.HTMLEscapeString(roh)

	sicher = linkMuster.ReplaceAllStringFunc(sicher, func(treffer string) string {
		teile := linkMuster.FindStringSubmatch(treffer)
		ziel := sichereURL(entschaerftZurueck(teile[2]))
		if ziel == "" {
			return teile[1]
		}
		return `<a href="` + template.HTMLEscapeString(ziel) + `" target="_blank" rel="noreferrer">` + teile[1] + `</a>`
	})
	sicher = fettMuster.ReplaceAllString(sicher, "<strong>$1</strong>")
	sicher = strings.ReplaceAll(sicher, "\n", "<br>")
	return template.HTML(sicher)
}

// entschaerftZurueck macht die HTML-Maskierung einer Adresse rückgängig,
// damit sichereURL sie parsen kann. Das Ergebnis wird vor dem Einsetzen
// erneut maskiert.
var zurueck = strings.NewReplacer("&amp;", "&", "&lt;", "<", "&gt;", ">", "&#34;", `"`, "&#39;", "'")

func entschaerftZurueck(s string) string { return zurueck.Replace(s) }

// sichereURL lässt nur http und https durch. Alles andere ergibt die leere
// Zeichenkette, und die Vorlage schreibt dann gar keinen Link statt eines,
// dessen Ziel niemand geprüft hat.
func sichereURL(roh string) string {
	if roh == "" {
		return ""
	}
	u, err := url.Parse(roh)
	if err != nil {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	return u.String()
}
