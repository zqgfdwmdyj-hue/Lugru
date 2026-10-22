# Oberfläche im ProfitPath-Stil — Design

Datum: 2026-09-06

Die Oberfläche übernimmt die visuelle Sprache von `profitpath.com/de`: Farben,
Typografie, Radien, Knopf- und Kartenbehandlung.

## Zweck

Die Oberfläche ist heute unformatiertes HTML mit 54 Zeilen CSS. Sie
funktioniert, sieht aber nach Rohentwurf aus. ProfitPath ist im selben Feld
unterwegs — Amazon-Arbitrage — und hat eine ausgearbeitete, ruhige Bildsprache,
an der sich die eigene Oberfläche ausrichten kann.

## Abgrenzung

Übernommen wird die visuelle Sprache: Farbwerte, Schriftwahl, Typo-Maße,
Radien, Schatten, die Behandlung von Knöpfen, Karten und Tabellen. Das ist
freies Handwerk.

Nicht übernommen werden Logo, Wortmarke, Illustrationen und Texte von
ProfitPath. Die gehören ihnen.

## Ausgangsbefund

`profitpath.com/de` ist eine **Marketing-Seite**: Hero, Verlaufs-CTA,
Testimonial-Reihen, Preistabellen. Lugru-Deals ist ein Werkzeug aus Formularen
und Tabellen. Die Token passen überall, die Landingpage-Möblierung nirgends —
übernommen wird darum das Tokensystem, angewandt auf die eigene Struktur.

Die Tokens sind aus der laufenden Seite ausgelesen, nicht vom Bild geschätzt.
Das Original arbeitet mit einem Tailwind-/shadcn-Satz in HSL; hier stehen die
umgerechneten Werte.

## Tokens

    --grund: #f1f5f9;        --flaeche: #fff;
    --text: #22282f;         --gedaempft: #576370;   --leise: #64748b;
    --rand: #e2e5e9;         --rand-stark: #e2e8f0;
    --akzent: #3b8bf6;       --akzent-dunkel: #2563eb;  --akzent-hell: #61a8ff;
    --radius: 8px;           --radius-knopf: 12px;

Zwei Tokenpaare kommen dazu, die die Marketing-Seite nicht definiert, ihre
Anwendung aber sehr wohl verwendet: `--erfolg` (`#047857` auf `#ecfdf5`, Rand
`#a7f3d0`) und `--warnung` (`#b91c1c` auf `#fef2f2`, Rand `#fecaca`). Beide aus
derselben Tailwind-Familie wie der Rest der Palette, damit sie nicht wie
Fremdkörper wirken. `--warnung` ersetzt das bisherige `#b3261e` der
Fehlermeldungen.

## Bausteine

| Baustein | Behandlung |
|---|---|
| Navigation | Weiße Leiste, Haarlinie unten, Wortmarke links, Links 14 px/500 gedämpft, aktive Seite als gefüllte Pille |
| Primärknopf | Verlauf `#61a8ff → #4998f8`, 1 px Rand `#4998f8`, Radius 12 px, weiß 14 px/500, Schatten |
| Sekundärknopf | Weiß, 1 px `--rand-stark`, Radius 12 px, feiner Schatten |
| Löschknopf | Weiß mit rotem Text und rotem Rand — im Original nicht vorhanden, hier nötig |
| Eingabefelder | Weiß, 1 px `--rand-stark`, Radius 8 px, Fokusring 3 px `rgba(59,139,246,.25)` |
| `<fieldset>` | Karte: weiß auf `--grund`, Radius 8 px, Haarlinie, feiner Schatten |
| Tabellen | Karte; Kopfzeile 12 px/600 gedämpft, Zeilen mit Haarlinie, Hover `#f8fafc`, Zahlen rechtsbündig mit `tabular-nums` |
| Gewinn/Marge | Chip, Radius 6 px, `2px 8px`, 13 px/500 |

### Aktive Navigation

Die Vorlagen liefern `.Titel` bereits passend — „Neuer Deal", „Historie",
„Channels", „Einstellungen" sind genau die Beschriftungen der Navigation. Der
aktive Zustand entsteht durch Vergleich in der Vorlage, ohne neues Feld.

### Farbcodierte Zahlen

Gewinn und Marge bekommen einen grünen Chip bei positivem, einen roten bei
negativem Wert. **Exakt 0 bleibt neutral** — ein Nulldeal ist weder das eine
noch das andere, und ein grüner Chip auf 0,00 € wäre eine Aussage, die die Zahl
nicht hergibt.

Die Klasse entsteht im Handler aus `deal.GewinnCent` beziehungsweise
`deal.MargeProzent`, nicht in der Vorlage: `html/template` kann nicht rechnen,
dieselbe Begründung wie bei `VorherigeSeite` und den Bildadressen. Die Farbe
kommt zum Vorzeichen hinzu und ersetzt es nicht — wer Farben schlecht
unterscheidet, liest weiterhin das Minus.

## Schrift

Geist, als Variable Font (ein File deckt 400–600 ab), selbst ausgeliefert:

| Datei | Subset | Größe |
|---|---|---|
| `static/geist-latin.woff2` | latin | 29 288 B |
| `static/geist-latin-ext.woff2` | latin-ext | 16 540 B |

Latin-ext kommt mit, weil Amazon-Produkttitel aus FR/IT/ES und von
osteuropäischen Marken Zeichen enthalten, die sonst in einer Fremdschrift
mitten im Titel stünden.

`static/geist-OFL.txt` liefert Copyright-Hinweis und Lizenztext mit. Die SIL
Open Font License verlangt das bei Weitergabe; ohne diese Datei wäre das
Selbsthosting nicht lizenzkonform.

`//go:embed static` zieht die Dateien von sich aus mit ins Binary — dafür ist
kein Code nötig. Nötig ist dagegen `mime.AddExtensionType(".woff2",
"font/woff2")`: Go kennt die Endung nicht in seiner eingebauten Tabelle, und
`http.FileServerFS` liefert die Datei sonst als `application/octet-stream` aus.

Selbst ausliefern statt Google Fonts einzubinden: die Anwendung soll ohne
fremden Server auskommen. Der Sicherheitshinweis im README nennt bereits die
Amazon-Produktbilder als einzigen Fremdzugriff — ein zweiter käme ungelegen,
und ohne Internet fiele die Schrift sonst zurück.

## Tests

Der größte Teil ist CSS und in Go-Tests nicht sinnvoll zu fassen; er wird im
Browser geprüft. Testgetrieben entsteht, was Logik ist:

- `GewinnKlasse` und `MargeKlasse`: positiv, negativ, und die Null als
  Neutralfall
- Die Schriftdateien sind eingebettet und werden als `font/woff2` ausgeliefert
- Die Navigation markiert auf jeder der vier Seiten genau die aktive

## Beim Umsetzen aufgefallen

Drei Fehler, die es schon vorher gab und die im Zuge der Umstellung sichtbar
wurden — sie sind mitbehoben:

- `.spalten` stand auf `grid-template-columns: 1fr 1fr`. Ein blankes `1fr` hat
  eine Mindestbreite von `auto`, die sich nach dem breitesten unteilbaren
  Inhalt richtet: das 800 px breite Keepa-Chart drückte die linke Spalte auf
  gut 145 px zusammen. Jetzt `minmax(0, 1fr)` plus `img { max-width: 100% }`.
- `input { width: 100% }` galt auch für Auswahl- und Ankreuzfelder. Gedehnt
  rutschte der Knopf ans rechte Zellenende und seine Beschriftung in die
  nächste Zeile — die VK-Kandidaten standen unter ihren Auswahlknöpfen.
- Kurze Tabellenspalten brachen um: ein zweizeiliges „deals-vip" machte die
  ganze Zeile hoch. Jetzt bricht nur noch die Artikelspalte.

Die Blätter-Links der Historie sind semantisch eine Navigation und bekommen
darum ein `<nav>`. Die Regeln der Kopfleiste sind deshalb auf `body > nav`
eingeschränkt, sonst sähen sie wie eine zweite Kopfleiste aus.

## Nicht dabei

Keine Hero-Sektionen, Verlaufsflächen, Testimonial-Reihen oder
Gitter-Hintergründe. Kein Dark Mode — das Original hat keinen. Kein Logo, keine
Wortmarke, keine Illustrationen von ProfitPath.
