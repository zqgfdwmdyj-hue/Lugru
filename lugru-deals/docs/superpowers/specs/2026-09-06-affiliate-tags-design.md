# Affiliate-Tags an den Amazon-Links — Design

Datum: 2026-09-06

Die Amazon-Links im Discord-Post bekommen einen Affiliate-Tag angehängt:
aus `https://www.amazon.de/dp/B01636IZ0G` wird
`https://www.amazon.de/dp/B01636IZ0G?tag=beispiel-21`. Die Tags werden auf
einer eigenen Seite verwaltet, im letzten Funnel-Schritt ausgewählt und je
Marktplatz mit einem Standard vorbelegt.

## Zweck

Jeder gepostete Deal schickt Leser auf eine Amazon-Produktseite. Ohne Tag
verdient dieser Klick nichts. Der Tag von Hand in die Post-Vorlage zu
schreiben scheidet aus: er gehört zu genau einem Marktplatz, und der
Zielmarkt wechselt von Deal zu Deal.

## Entscheidungen

**Ein Tag gehört zu einem Marktplatz.** Ein PartnerNet-Tag verdient nur dort,
wofür er ausgestellt wurde; ein DE-Tag auf `amazon.es` ist wirkungslos. Darum
trägt jeder Tag sein Länderkürzel, das Auswahlfeld im Funnel zeigt nur die
Tags des Zielmarkts, und „Standard" gibt es je Marktplatz einmal — nicht
einmal insgesamt.

**Getaggt werden beide Amazon-Links.** Der Verkaufslink bekommt den in
Schritt 4 gewählten Tag, der Einkaufslink automatisch den Standard-Tag seines
eigenen Marktes. Ein Fremdshop-Einkaufslink bleibt unberührt — auch der zu
`amazon.co.uk`, denn dieser Markt steht nicht in `marketplace.tabelle`, und
für einen Markt ohne Eintrag gibt es keinen Tag.

**Der Tag entsteht erst beim Rendern des Posts**, in `post.Daten`, nie in
`dealErgebnis.QuellURL`. Dasselbe Feld speist auch den ArbitrageOne-Parameter
`source_url`, das versteckte Formularfeld `quell_url` und die gleichnamige
Spalte der Historie. Ein dort eingebauter Tag würde in alle drei
durchsickern — in ein Analysewerkzeug, das ihn nicht braucht, und in
gespeicherte Daten, die eine Bezugsquelle festhalten sollen, keine
Provisionszuordnung.

**Keine neue Spalte in `deals`.** Der gesendete Text steht vollständig in
`nachricht_text`, samt der getaggten Links. Eine Spalte `tag` wäre eine
zweite Wahrheit über denselben Post, die von ihm abweichen kann.

**Kein Tag hält keinen Deal auf.** Fehlt für den Zielmarkt ein Standard, oder
wird ausdrücklich „kein Tag" gewählt, erscheint ein sichtbarer Hinweis, aber
der Posten-Knopf bleibt bedienbar. Ein fehlender Tag kostet Provision; ein
blockierter Deal kostet den ganzen Deal.

**Auswahl im Funnel, nicht in den Einstellungen.** Tags sind eine Liste von
Stücken mit eigenem Lebenszyklus, wie Channels — und nicht wie die flachen
Schlüssel/Wert-Paare der Einstellungsseite, die ein einziges Formular
gemeinsam speichert.

## Aufbau

### Tabelle `affiliate_tags`

Im `schema`-Block von `store.Open`:

    CREATE TABLE IF NOT EXISTS affiliate_tags (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,   -- freie Bezeichnung, "Hauptkonto DE"
        tag         TEXT    NOT NULL,   -- der echte Tag, "beispiel-21"
        markt       TEXT    NOT NULL,   -- DE | FR | IT | ES
        standard    INTEGER NOT NULL DEFAULT 0,
        angelegt_am TEXT    NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_standard
        ON affiliate_tags(markt) WHERE standard = 1;

Kein Eintrag in `ergaenzungen`: das ist die Liste nachgereichter *Spalten*.
`CREATE TABLE IF NOT EXISTS` legt die Tabelle in einer bestehenden Datei
genauso an wie in einer frischen.

Der partielle Unique-Index macht „höchstens ein Standard je Markt" zur Zusage
der Datenbank statt zu einer Hoffnung im Code.

### `internal/store/tags.go`

Spiegelt `channels.go`:

    type AffiliateTag struct {
        ID         int64
        Name       string
        Tag        string
        Markt      string
        Standard   bool
        AngelegtAm time.Time
    }

    TagAnlegen(t) (int64, error)
    TagAendern(t) error
    TagLoeschen(id) error
    Tag(id) (AffiliateTag, error)
    Tags() ([]AffiliateTag, error)          // nach Markt, dann Name
    TagsFuerMarkt(code string) ([]AffiliateTag, error)
    StandardTag(code string) (AffiliateTag, bool)
    TagStandardSetzen(id) error

`TagStandardSetzen` läuft in einer Transaktion und in dieser Reihenfolge:
erst den bisherigen Standard des Marktes löschen, dann den neuen setzen.
Andersherum schlägt der Unique-Index zu.

`TagAnlegen` und `TagAendern` setzen `standard` nie selbst — der Standard
wandert ausschließlich über `TagStandardSetzen`, damit es nur einen Weg zu
diesem Zustand gibt.

### `marketplace.ProductURLMitTag`

    // ProductURLMitTag baut die Produktseite mit angehängtem Affiliate-Tag.
    // Ein leerer Tag ergibt denselben Link wie ProductURL — kein nacktes "?tag=".
    func (m Marketplace) ProductURLMitTag(asin, tag string) string

Der Tag wird dabei prozentkodiert. Das ist die zweite Verteidigungslinie; die
erste ist die Formatprüfung beim Anlegen.

### Tag-Format

    ^[A-Za-z0-9_-]{1,50}$

geprüft in `web/tags.go` beim Anlegen und Ändern. Der Zeichensatz ist nicht
beliebig: der Wert durchquert zwei Kontexte und ist in beiden stumm. In der
Query fehlen ihm `& ? # % /`, im Markdown-Link des Posts — `[Amazon.DE](URL)`
— fehlen ihm `( ) < > "` und das Leerzeichen. Dieselbe Sorge, die
`markdownGrenzen` in `marketplace/input.go` für Fremdshop-Links behandelt.

### Auflösung des Tags im Funnel

`dealFormular` bekommt zwei Felder:

    TagID     int64
    TagGesetzt bool   // r.PostForm.Has("tag_id")

Das zweite trennt „Feld gar nicht gesendet" von „ausdrücklich auf 0 gesetzt" —
dieselbe Unterscheidung, die `speichereEinstellungen` schon für die
Post-Vorlage trifft. Ohne sie könnte der Standard nie vorausgewählt sein, denn
ein fehlendes Feld parst zu 0, und 0 heißt „kein Tag".

Verkaufslink:

| Zustand | Ergebnis |
|---|---|
| `tag_id` nicht gesendet | Standard-Tag des Zielmarkts |
| `tag_id = 0` | kein Tag |
| `tag_id` zeigt auf einen Tag des Zielmarkts | dieser Tag |
| `tag_id` zeigt woanders hin | Standard-Tag des Zielmarkts |

Die letzte Zeile ist kein Angriffsfall, sondern Alltag: wer aus Schritt 4
zurückgeht und in Schritt 2 den Zielmarkt wechselt, trägt eine Tag-ID des
alten Marktes mit. Sie still auf den Standard des neuen Marktes fallen zu
lassen ist richtiger, als einen DE-Tag auf `amazon.es` zu kleben.

Einkaufslink: immer der Standard-Tag des Einkaufsmarktes, und nur wenn
`Extern` false ist.

### Schritt 4

Ein zweites Auswahlfeld neben dem Channel:

    <label>Affiliate-Tag
      <select name="tag_id" hx-post="/deal/vorschau" hx-target="#funnel">
        <option value="0">— kein Tag —</option>
        …nur Tags des Zielmarkts, der Standard vorausgewählt…
      </select></label>

Das `hx-post` ist Pflicht: die Vorschau zeigt den fertigen Post-Text, und in
dem stehen die Links. Ohne den Neuaufbau zeigte sie einen anderen Post, als
gesendet wird — dieselbe Falle, die der Kommentar über dem Channel-Feld
bereits beschreibt.

Bleibt kein Tag übrig, erscheint über dem Posten-Knopf ein eigener Hinweis
(`OhneTag bool`, nicht das allgemeine `.Hinweis`-Feld, das schon anderes
trägt).

### Seite `/tags`

Nach dem Muster von Channels: `internal/web/tags.go`,
`templates/tags.html`, ein fünfter Nav-Punkt in `layout.html` — der
`aktiv`-Zustand entsteht dort aus `.Titel`, die Seite heißt also genau „Tags".

Routen:

    GET  /tags
    POST /tags                  Anlegen oder Ändern (verstecktes Feld id)
    POST /tags/{id}/loeschen
    POST /tags/{id}/standard

Tabelle: Name · Tag · Markt · Standard · Aktionen. Anlegen-Formular darunter
mit Name, Tag, Markt-Auswahl und Häkchen „Als Standard für diesen Markt".

Wird der Standard-Tag eines Marktes gelöscht, hat der Markt keinen mehr — die
Deals-Tabelle verweist nirgends auf Tags, es gibt nichts aufzuräumen.

## Tests

- `marketplace`: `ProductURLMitTag` mit Tag, mit leerem Tag, mit einem Tag,
  der Kodierung braucht.
- `store`: Anlegen, Lesen, Ändern, Löschen; `TagStandardSetzen` verschiebt das
  Häkchen innerhalb eines Marktes und lässt andere Märkte unberührt;
  `StandardTag` meldet false, wenn keiner gesetzt ist.
- `web/tags`: Formularprüfung (Pflichtfelder, Tag-Format, unbekannter Markt),
  Standard setzen, Löschen.
- `web/deal`, entlang der Tabelle oben:
  - fehlendes Feld ergibt den Standard-Tag des Zielmarkts im Verkaufslink
  - `tag_id = 0` ergibt ungetaggte Links und den Hinweis
  - eine Tag-ID des falschen Marktes fällt auf den Standard des Zielmarkts
  - der Einkaufslink ist nur bei Amazon-Einkauf getaggt, nie bei Fremdshop
  - `source_url` im ArbitrageOne-Link und `quell_url` in der Historie bleiben
    ungetaggt

## Dokumentation

README: „Erste Schritte" um den Tag-Schritt ergänzen, dazu ein kurzer
Abschnitt, der die Marktbindung erklärt.
