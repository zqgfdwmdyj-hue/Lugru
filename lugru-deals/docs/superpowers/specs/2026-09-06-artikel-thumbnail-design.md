# Artikel-Thumbnail mit Mouseover-Vergrößerung — Design

Datum: 2026-09-06

Die Historie zeigt zu jedem Deal das Produktbild als kleines Thumbnail neben
dem Titel. Beim Überfahren mit der Maus erscheint eine größere Fassung.

## Zweck

Die Historie ist heute eine reine Zahlenliste. Beim Überfliegen ist ein Deal
nur über Titel und ASIN wiederzuerkennen — das Produktbild ist der schnellste
Wiedererkennungsanker und kostet keine zusätzliche Keepa-Abfrage: Keepa liefert
`imagesCSV` bereits in derselben Produktantwort mit, aus der Titel, Preise und
Gebühren stammen.

## Entscheidungen

**Bild wird verlinkt, nicht archiviert.** Die Historie lädt das Bild zur
Anzeigezeit direkt von `m.media-amazon.com`. Anders als beim Keepa-Chart, der
bewusst lokal archiviert wird (der Chart ist eine Momentaufnahme des
Preisverlaufs und wäre später nicht rekonstruierbar), ist das Produktbild
stabil und nicht Teil dessen, was der Post behauptet. Der Preis dafür: die
Historie braucht Internet, und Amazon sieht, wann sie geöffnet wird.

**Gespeichert wird nur die Bild-Kennung**, also der Dateiname aus `imagesCSV`
(zum Beispiel `41Ny6ILlHnL.jpg`), nicht die volle Adresse. Die Adresse wird
beim Rendern gebaut — so lässt sich die Bildgröße ändern, ohne Altdaten
anzufassen.

**Vergrößerung rein mit CSS**, kein JavaScript. Das Projekt bringt bisher nur
htmx mit; eine erste eigene Skriptdatei für einen Hover-Effekt wäre unverhältnismäßig.

**Migrationsfreies Schema bleibt migrationsfrei.** `store.Open` führt alle
Anweisungen bei jedem Start aus. SQLite kennt kein
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, darum kapselt ein Helfer den einen
Fehler, der beim zweiten Start der Normalfall ist.

## Aufbau

### Neues Paket `internal/bild`

Eine Aufgabe: aus Keepas `imagesCSV` eine geprüfte Kennung machen und daraus
Amazon-Adressen bauen.

    Gueltig(k string) bool           // ^[A-Za-z0-9_+-]{1,64}\.(jpg|jpeg|png|gif)$
    KennungAusCSV(csv string) string // erste gültige Kennung, sonst ""
    URL(k string, kante int) string  // https://m.media-amazon.com/images/I/<name>._SL<kante>_.<endung>

Eigenes Paket, weil zwei Seiten es brauchen: `keepa` beim Parsen und `web` beim
Rendern. Ein gemeinsames kleines Paket erspart eine Abhängigkeit zwischen
beiden.

`URL` liefert bei ungültiger Kennung die leere Zeichenkette — eine Vorlage, die
das Ergebnis ungeprüft in ein `src` schreibt, bekommt dann ein leeres Attribut
statt einer erfundenen Adresse.

### Weg durch die Anwendung

Die Kennung reist genau wie `Titel` und `VKQuelle`: von der Keepa-Abfrage über
ein verstecktes Formularfeld bis in die Datenbank.

| Ort | Änderung |
|---|---|
| `keepa/product.go` | `rohProdukt.ImagesCSV`, neues Feld `Product.BildKennung` |
| `web/deal.go` | `dealFormular.BildKennung`, in `formularLesen` gelesen und mit `bild.Gueltig` geprüft |
| `templates/deal.html` | `<input type="hidden" name="bild_kennung">` bei den übrigen versteckten Feldern |
| `web/deal.go` `sendeDeal` | Kennung wandert in `store.Deal` |
| `store/deals.go` | `Deal.BildKennung`, Spalte `bild_kennung` in `dealSpalten`, `scanDeal`, `DealAnlegen` |
| `web/history.go` | `historieZeile.BildKlein` und `.BildGross`, leer ohne Kennung |
| `templates/historie.html` | Thumbnail in der Artikel-Zelle vor dem Titel |
| `static/style.css` | `.lupe`, `.lupe .gross` |

### Schema-Erweiterung

    // spalteErgaenzen hält Open wiederholbar, obwohl SQLite kein
    // ALTER TABLE … ADD COLUMN IF NOT EXISTS kennt: der Fehler
    // "duplicate column name" ist ab dem zweiten Start der Normalfall
    // und wird als einziger geschluckt.
    func spalteErgaenzen(db *sql.DB, tabelle, spalte, definition string) error

Jeder andere Fehler bricht `Open` weiterhin ab. Bestehende `deals.db` bekommen
die Spalte beim nächsten Start; alte Deals behalten eine leere Kennung und
zeigen kein Bild.

### Darstellung

`historieZeile` bekommt zwei fertige Adressen, weil `html/template` nicht
rechnen kann — dieselbe Begründung wie bei `VorherigeSeite`:

- `BildKlein`: `_SL160_`, angezeigt mit 40 px (scharf auf hochauflösenden Schirmen)
- `BildGross`: `_SL500_`

Artikel-Zelle:

    <td class="artikel">{{if .BildKlein}}<span class="lupe" tabindex="0"
           role="img" aria-label="Produktbild, vergrößert bei Fokus"
          ><img class="klein" src="{{.BildKlein}}" alt="" loading="lazy" width="40" height="40"
          ><img class="gross" src="{{.BildGross}}" alt="" loading="lazy"
        ></span>{{end}}<span>{{.Titel}}</span></td>

`.gross` ist `visibility: hidden` statt `display: none`, damit der Browser das
große Bild schon vor dem Hover laden darf. Es ist `position: fixed` **ohne**
`top`/`left`: dadurch bleibt es an seiner natürlichen Stelle neben dem
Thumbnail, erzeugt aber nie einen Scrollbalken und wird von keiner Tabellenzelle
beschnitten. `pointer-events: none` verhindert, dass es das Hovern der Zeile
darunter stört. Sichtbar wird es bei `:hover` und bei `:focus-within`.

`:focus-within` allein genügt dafür nicht: in der Lupe steckt sonst kein
fokussierbares Element, die Regel könnte nie greifen und die Vergrößerung wäre
eine reine Mausfunktion. Das `tabindex="0"` auf der Lupe macht sie anfassbar,
`role="img"` mit `aria-label` gibt dem Tabstopp einen Namen. Der zusätzliche
Tabstopp je Zeile fällt neben dem ohnehin vorhandenen `summary`-Tabstopp jeder
Detailzeile nicht ins Gewicht. Ein Test hält das fest — ohne ihn verschwindet
das Attribut bei der nächsten Änderung an der Vorlage unbemerkt.

Bekannte Einschränkung: bei der untersten sichtbaren Zeile kann die Vergrößerung
am Fensterrand abgeschnitten werden. Ohne JavaScript ist das zeilenweise nicht
zu korrigieren; die Größe ist darum auf `min(280px, 45vh)` gedeckelt, damit der
Fall selten und mild bleibt.

`alt=""` ist Absicht: der Titel steht unmittelbar daneben. `loading="lazy"` hält
den Erstaufbau der 50 Zeilen langen Liste billig.

## Sicherheit

Die Kennung wird geprüft, obwohl sie von Keepa stammt: sie läuft durch ein
verstecktes Formularfeld und kommt aus dem Browser zurück. Das ist dasselbe
Muster, gegen das `ChartLesen` den Dateinamen absichert, obwohl er aus der
eigenen Datenbank kommt. Ungeprüft könnte ein beliebiger String in einem
`src`-Attribut landen. Geprüft wird an beiden Enden: in `formularLesen` vor dem
Speichern und in `bild.URL` vor dem Bauen der Adresse.

Der Sicherheitshinweis im README verspricht heute, die Anwendung sei ohne Proxy
rein lokal. Er bekommt einen Satz zur Bildquelle.

## Tests

- `bild`: gültige und ungültige Kennungen, leeres CSV, mehrere Einträge,
  `..`, `/` und Query-Anhang in der Kennung, Adressformat je Kantenlänge
- `keepa`: `imagesCSV` im Testdatensatz, Parse-Test auf `BildKennung`, Fall
  ohne das Feld
- `store`: Deal mit Kennung schreiben und lesen; `Open` zweimal auf derselben
  Datei bleibt fehlerfrei; eine Datenbank im alten Schema öffnen und die Spalte
  danach vorfinden
- `web`: `formularLesen` verwirft eine manipulierte Kennung; `zeigeHistorie`
  rendert das `img` nur bei vorhandener Kennung und macht die Lupe
  fokussierbar; die Kennung reist vom Keepa-Abruf über das Formular bis in die
  Datenbank

## Nicht dabei

Kein Bild in der Deal-Vorschau, kein Bild-Anhang an Discord, kein lokales
Bildarchiv, keine Einstellung für die Bildgröße.
