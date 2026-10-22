# Mehrere Zielmarktplätze — Design

Datum: 2026-09-06

Ein Artikel, der sich in Deutschland verkauft, verkauft sich oft auch in
Frankreich, Italien und Spanien. Teilweise auf allen vier Marktplätzen
zugleich. Der Funnel trägt aber genau einen Zielmarkt durch alle vier
Schritte, und wer denselben Deal für vier Märkte posten will, füllt ihn
viermal aus — mit demselben Einkaufslink, demselben Preis, derselben Notiz.

## Zweck

Ein Deal soll mehrere Zielmarktplätze haben können, und der Post soll je
Markt zeigen, was dort herauskommt. Für jeden Markt außerhalb des Lagerlands
sind das zwei Zahlen und nicht eine: der Gewinn über das Versandnetzwerk
(EFN) und der Gewinn mit Bestand im Zielland (Pan-EU). Der Unterschied ist
kein Detail — beim 6er-Träger nach ES sind es 11,08 € je Einheit, aus 9,9 %
Marge werden 22,2 %.

## Ausgangsbefund

Der Pan-EU-Vergleich **existiert bereits**. `rechneDeal` rechnet denselben
Deal ein zweites Mal mit dem lokalen Tarif des Zielmarkts, sobald sich der
bestimmen lässt; `rechnungBloecke` zeigt ihn als eigenen Block in Schritt 3,
und `post.PanEUZeile` bringt ihn in den Post. `lokalerTarif` liefert
absichtlich nichts, wenn das Ziel im Lagerland liegt — dort gibt es keinen
zweiten Versandweg.

Was diesem Entwurf fehlt, ist also nicht die zweite Rechnung, sondern der
zweite, dritte und vierte Markt.

Der Zielmarkt sitzt heute an folgenden Stellen:

| Stelle | heute |
|---|---|
| `dealFormular.Zielmarkt` | ein Feld, Text |
| Schritt 2 | ein `<select name="zielmarkt">` |
| `holeProdukt(asin, ziel)` | ein Keepa-Abruf, Cache je `(asin, domain)` |
| VK, Verkäufe, Provision, FBA | je ein Feld, alle vier marktabhängig |
| `vkTag` | ein Affiliate-Tag, an den Zielmarkt gebunden |
| `post.Daten` | `Zielmarkt`, `VK`, `VKUrl`, `Sales`, `Gewinn`, `Marge` |
| Chart | einer, vom Zielmarkt |
| `store.Deal` | eine Zeile, Spalte `zielmarkt` |

`internal/web/deal.go` hat dabei 1529 Zeilen und ist die mit Abstand größte
Datei des Projekts.

## Entscheidungen

**Der eine Funnel trägt eine Liste, es gibt keinen zweiten.** Ein zweiter
Weg für Mehrfachmärkte neben dem bestehenden hätte zwei Stellen ergeben, die
dasselbe rechnen — und zwei solche Stellen laufen auseinander. Ein Markt ist
danach der Sonderfall „Liste mit einem Element", und für den ändert sich
nichts: gleiche Zahlen, gleicher Post, gleiche Historienzeile.

**Kein eigenes Paket für die Mehrmarkt-Rechnung.** Erwogen und verworfen:
ein `internal/deal` bräuchte Zugriff auf Tarife, Einstellungen und Tags und
zöge damit die halbe Kopplung von `web` mit, ohne eine echte Grenze zu
ziehen. `calc` bleibt, was es ist — die eine Funktion, die eine Rechnung
rechnet.

**Statt dessen ein Schnitt durch `deal.go`.** Die Datei wüchse durch diese
Änderung deutlich über 1529 Zeilen hinaus. Sie wird entlang vorhandener
Grenzen geteilt — Handler, Formular, Rechnung — und nicht umgebaut.

**Der Leitmarkt ist ausdrücklich, nicht abgeleitet.** Alles, was es nur
einmal geben kann, hängt an ihm: Artikelname, Produktbild, Chart, der
ArbitrageOne-Link und die Zahlen in der bestehenden `deals`-Zeile. Ihn aus
der Reihenfolge oder aus dem höchsten Gewinn zu erraten hieße, dass ein
Wechsel des Verkaufspreises stillschweigend den Chart tauscht.

**Ein Fehlschlag bei Keepa hält die anderen Märkte nicht auf.** Der
betroffene Markt fällt auf Standardprovision und Standard-FBA zurück und
sagt das in seiner Spalte — genau das Verhalten, das der Einzelmarkt heute
schon hat. Drei brauchbare Märkte sind besser als vier verweigerte.

**Die bisherigen Felder von `post.Daten` bleiben und tragen den Leitmarkt.**
`post.Render` läuft mit `missingkey=error`. Ein entferntes Feld ließe jede
gespeicherte Vorlage schlagartig nicht mehr rendern — und die Vorlage ist
eine Einstellung, die eine Änderung am Standard nie mitbekommt. Genau dafür
wurde seinerzeit `PanEUZeile` zum Kopieren angeboten, und derselbe Weg gilt
hier.

**Eine alte Vorlage bei mehreren Märkten bekommt einen Hinweis, keinen
Fehler.** Sie postet sonst stillschweigend nur den Leitmarkt, während vier
gewählt sind. Der Hinweis steht in Schritt 4 neben der Vorschau — die zeigt
ohnehin, was hinausgeht; der Hinweis sagt nur, warum. Ein Fehler wäre falsch:
die Vorlage ist nicht kaputt, sie ist nur älter als diese Änderung.

**Die `deals`-Zeile bleibt, wie sie ist.** Die Märkte kommen daneben, in eine
eigene Tabelle. Eine Zeile je Markt hätte denselben Nachrichtentext viermal
in die Datenbank geschrieben und denselben Artikel viermal in die
Historienliste — obwohl es ein Post ist. Alte Zeilen und jede bestehende
Auswertung bleiben so vergleichbar.

**Pan-EU-Spalten sind `NULL`, wenn es den Vergleich nicht gibt.** Eine 0 wäre
eine Aussage, die niemand gerechnet hat. Dieselbe Regel wie in `rechneDeal`,
wo `PanEU` ein Zeiger ist.

**Ein Chart, der des Leitmarkts.** Vier Charts an einer Nachricht kosteten
vier Keepa-Abrufe je Post und machten die Nachricht schwer, ohne die
Kaufentscheidung zu verbessern.

## Aufbau

### Was je Markt gilt und was einmal

| Einmal für den Deal | Je Markt |
|---|---|
| ASIN, Einkaufslink, Quellmarkt, QuellURL | VK + Quelle |
| EK, EK-Art, Notiz | Verkäufe + Quelle |
| Artikelname, Produktbild, Paketmaße | Provision + Quelle |
| Channel, Mention | FBA-Gebühr + Quelle |
| Leitmarkt | Affiliate-Tag |

Artikelname, Bild und Maße kommen vom Leitmarkt. Bei den Maßen mit einer
Ausnahme: nennt der Leitmarkt keine, gelten die des ersten Marktes, der
welche kennt. Es ist dasselbe physische Paket — das ist keine erfundene
Zahl, sondern dieselbe, aus einer anderen Auskunft.

### Formular

`dealFormular` behält alles Gemeinsame und bekommt zwei neue Felder:

    Leitmarkt string
    Maerkte   []marktFormular

`marktFormular` trägt Code, VK, VKQuelle, Sales, SalesQuelle, Provision,
ProvisionQuelle, FBA, FBAQuelle, TagID und TagGesetzt — also genau die
Felder, die heute flach in `dealFormular` stehen.

Im HTML heißen sie mit Marktsuffix: `vk.IT`, `sales.IT`, `provision.IT`,
`fba.IT`, `tag.IT`. Ein Index (`markt[2].vk`) wäre die naheliegendere Wahl und die
falsche: wer in Schritt 3 einen Markt abwählt und zurückgeht, verschöbe damit
jede folgende Nummer, und die Werte erbten still den Nachbarn. Der Marktcode
verschiebt sich nicht.

Gelesen wird ausschließlich, was zu einem angehakten und über
`marketplace.ByCode` geprüften Markt gehört. Ein mitgeschicktes `vk.XX` fällt
damit weg, statt einen fünften Markt zu erfinden.

`keepaWerteLeeren` räumt künftig je Markt und behält seine Begründung: die
gemeinsamen Felder (Bild, Maße, Titel) hängen am Artikel, die übrigen am
Markt.

### Schritt 2 — Auswahl

Aus dem Auswahlfeld werden Kästchen, eines je Markt, mindestens eines
gefordert. Darunter ein Radioknopf „Leitmarkt" unter den angehakten.

Die Einstellung `deal.standard_zielmarkt` wird zur Liste: `DE,FR,IT,ES`. Der
erste Eintrag ist der Leitmarkt. Ein gespeichertes einzelnes `DE` bleibt als
einelementige Liste gültig — die Einstellung ändert ihre Form, nicht ihre
Bedeutung. Einträge, die `marketplace.ByCode` nicht kennt, werden beim Lesen
übergangen; bleibt danach nichts übrig, gilt der Vorgabewert. Eine
Einstellung darf keinen Markt vorwählen, den es nicht gibt.

Fällt der gewählte Leitmarkt aus der Auswahl (Kästchen abgehakt), rückt der
erste angehakte Markt nach. Kein Leitmarkt ist kein Zustand, in dem sich
weiterrechnen ließe.

### Schritt 3 — die Tabelle

Zeilen sind die Größen, Spalten die Märkte — gebaut wie die bestehende
Tarifübersicht, weil dort dieselbe Frage dieselbe Form bekommen hat.

    │            │ DE      │ FR      │ IT      │ ES      │
    │ VK         │ [     ] │ [     ] │ [     ] │ [     ] │
    │ Verkäufe   │ [     ] │ [     ] │ [     ] │ [     ] │
    │ Provision  │ [     ] │ [     ] │ [     ] │ [     ] │
    │ FBA-Gebühr │ [     ] │ [     ] │ [     ] │ [     ] │

Je Spalte steht unter den Feldern die Herkunft (`keepa`, `standardwert`,
`EFN-Tarif · Standardpaket`) wie heute neben dem Einzelfeld, und darunter
die Ergebniszeile: Gewinn und Marge über EFN, darunter Gewinn und Marge
Pan-EU. Der ausführliche Kassenbon — `rechnungBloecke` unverändert — steht
für genau einen aufgeklappten Markt darunter, vorgewählt der Leitmarkt.

Die Live-Neuberechnung bleibt, wie sie ist: jede Änderung schickt das ganze
Formular an `/deal/berechnung` und tauscht `#rechnung` aus.

Keepa wird je gewähltem Markt einmal abgefragt, der Reihe nach. Der Cache
liegt schon heute auf `(asin, domain)` und trennt die Märkte damit sauber;
der Weg zurück nach Schritt 2 und wieder vor kostet also keine weiteren
Token. Die Token-Anzeige nennt weiterhin den Stand nach dem letzten Abruf.

Schlägt ein Markt fehl, trägt seine Spalte den Hinweis „Keepa nicht erreicht
— bitte eintragen" und die Standardwerte; die übrigen Spalten sind davon
unberührt. Der Fehlertext läuft wie bisher durch `sicherFehlertext` — er kann
den Keepa-Key tragen.

### Schritt 4 — Vorschau

Die Vorschau zeigt den fertigen Post. Daneben je Markt ein Tag-Auswahlfeld;
die Auflösung in `vkTag` gilt unverändert, nur je Markt statt einmal. Ein
Markt ohne passenden Tag bekommt den Hinweis, den es heute schon gibt.

Enthält die gespeicherte Vorlage kein `.Maerkte` und ist mehr als ein Markt
gewählt, hängt `post.Render` die Zeilen der weiteren Märkte (alle außer dem
Leitmarkt, in der Form von `MaerkteZeilen`) am Ende des Posts an. Hier steht
dann der Hinweis, dass die Märkte angehängt wurden, samt Link zu den
Einstellungen für alle, die den Block an eigener Stelle wollen.

Eine gespeicherte Vorlage, die wörtlich der alten `StandardVorlage`
entspricht (`post.AlteStandardVorlage`), tauscht der Store beim Start gegen
die aktuelle: wer die Einstellungen nur einmal gespeichert hat, ohne die
Vorlage anzufassen, bekommt so die neue Form ohne eigenes Zutun. Eine
tatsächlich angepasste Vorlage bleibt unberührt.

### Der Post

`post.Daten` bekommt:

    Maerkte []MarktDaten

`MarktDaten` trägt Code, VK, VKUrl, Sales, Gewinn, Marge, MargeGerundet,
GewinnPanEU, MargePanEU — alles bereits fertig formatierte Zeichenketten, wie
im Paket üblich. `GewinnPanEU` und `MargePanEU` bleiben leer, wo es den
Vergleich nicht gibt; die Vorlage fragt mit `{{if}}` danach.

Die bisherigen Felder bleiben und tragen die Zahlen des Leitmarkts.

Die neue `StandardVorlage`:

    🛒 {{.Titel}} {{.ASIN}} {{.Mention}}
    🏬 [{{.EKHost}}]({{.EKUrl}})
    💰 EK: {{.EK}} {{.EKNotiz}}
    {{range .Maerkte}}💸 [Amazon.{{.Code}}]({{.VKUrl}}): {{.VK}} · {{.Sales}} Verk. · 🤑 {{.Gewinn}} / {{.Marge}}{{if .GewinnPanEU}} · 🇪🇺 Pan-EU {{.GewinnPanEU}} / {{.MargePanEU}}{{end}}
    {{end}}:bar_chart: [ArbitrageOne Export]({{.AOUrl}})

Der Marktblock wird als eigene Konstante `MaerkteZeilen` geführt und auf der
Einstellungsseite zum Kopieren angeboten — genau wie `PanEUZeile`.

Vier Märkte bleiben weit unter Discords 2000 Zeichen; die Prüfung in `Render`
bleibt trotzdem, sie gilt dem Artikelnamen.

Der ArbitrageOne-Link bleibt einer, für den Leitmarkt.

### Historie

Die `deals`-Zeile bleibt unverändert und trägt die Zahlen des Leitmarkts:
in `zielmarkt` steht sein Code, in `vk_cent`, `sales`, `provision_prozent`,
`fba_cent`, `gewinn_cent` und `marge_prozent` seine Werte. Bei einem Deal
mit einem Markt ist das dieselbe Zeile wie bisher. Daneben, in `schema`:

    CREATE TABLE IF NOT EXISTS deal_maerkte (
        deal_id             INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        markt               TEXT    NOT NULL,
        leitmarkt           INTEGER NOT NULL DEFAULT 0,
        vk_cent             INTEGER NOT NULL,
        vk_quelle           TEXT    NOT NULL,
        sales               INTEGER NOT NULL,
        sales_quelle        TEXT    NOT NULL,
        provision_prozent   REAL    NOT NULL,
        provision_quelle    TEXT    NOT NULL,
        fba_cent            INTEGER NOT NULL,
        fba_quelle          TEXT    NOT NULL,
        gewinn_cent         INTEGER NOT NULL,
        marge_prozent       REAL    NOT NULL,
        paneu_fba_cent      INTEGER,
        paneu_gewinn_cent   INTEGER,
        paneu_marge_prozent REAL,
        PRIMARY KEY (deal_id, markt)
    );

`ON DELETE CASCADE` wie bei `fba_gebuehren`: eine gelöschte Deal-Zeile darf
keine Marktzeilen hinterlassen, die auf nichts mehr zeigen.

`DealAnlegen` wird transaktional — Deal und Marktzeilen zusammen oder gar
nicht. Heute ist es ein einzelnes INSERT; bleibt es das, hinterließe ein
Fehler beim Schreiben der Märkte einen Deal, dessen gespeicherter Post vier
Märkte nennt und dessen Datenbank einen kennt.

In der Historienliste kommt neben „Gesendeter Text" ein zweites `<details>`
mit der Markttabelle. Deals ohne Marktzeilen — jeder bisherige — zeigen es
nicht, statt eine leere Tabelle aufzuklappen.

## Was sich nicht ändert

`internal/calc` wird nicht angefasst. Die Rechnung je Markt ist dieselbe
Funktion, nur öfter aufgerufen — eine zweite Formel wäre eine zweite
Wahrheit.

Ebenso unverändert: die Tarifstaffel und ihre Seite, `internal/fba`,
`internal/keepa`, `internal/discord`, die Tag-Verwaltung und die
Umsatzsteuer-Einstellungen.

**Ein Deal mit einem Zielmarkt rechnet und postet nach dieser Änderung genau
wie vorher.** Das ist die Messlatte für die Umsetzung, nicht bloß eine
Hoffnung: die vorhandenen Tests zu Einzelmarkt-Deals müssen unverändert
grün bleiben.

## Prüfen

Neu zu prüfen:

- **Formularlesen**: Teilmenge der Märkte; ein unbekannter Marktcode fällt
  weg; Werte eines abgewählten Marktes wandern nicht zum Nachbarn.
- **Leitmarkt**: gewählt; nicht mehr angehakt (der erste rückt nach); gar
  keiner gewählt (Schritt 2 fragt nach).
- **Keepa-Teilausfall**: ein Markt von vieren scheitert — die anderen drei
  tragen ihre Werte, der vierte die Standardwerte samt Hinweis, und der
  Fehlertext enthält keinen Key.
- **Vorlage**: eine gespeicherte Vorlage ohne `.Maerkte` rendert unverändert
  und zeigt den Leitmarkt; bei mehr als einem Markt werden die weiteren
  Märkte angehängt und der Hinweis erscheint. Bei einem Markt wird nichts
  angehängt; eine Vorlage mit `.Maerkte` bekommt nichts nachgeschoben. Die
  alte Standardvorlage wird beim Start gegen die neue getauscht, eine
  angepasste bleibt stehen.
- **Speichern**: Deal samt vier Marktzeilen; ein Fehler in der Mitte lässt
  keine halbe Zeile stehen.
- **Pan-EU**: Ziel im Lagerland trägt `NULL` in den drei Spalten, nicht 0.

## Bekannte Abweichung: der Teilausfall gilt nur den Eingaben

Oben steht, ein Keepa-Fehlschlag halte die anderen Märkte nicht auf und die
übrigen Spalten blieben unberührt. Für die **Eingabefelder** stimmt das: der
gescheiterte Markt bekommt Standardprovision, Standard-FBA und seinen
Hinweis, die anderen ihre echten Werte.

Für die **gerechneten** Zahlen stimmt es nicht. `rechnungFuellen` gilt die
Regel „entweder Zahlen oder eine Meldung, nie beides", und `rechneDeal`
bricht beim ersten Markt ab, dessen Werte sich nicht lesen lassen. Da
`standardwerteFuer` bewusst keinen Verkaufspreis erfindet, bleibt der beim
gescheiterten Markt leer — und damit verschwindet die ganze Übersicht hinter
„Amazon.IT — Verkaufspreis: kein Betrag angegeben".

Erreichbar, aber nicht schlimm: ein Preis von Hand, und alles erscheint. Die
Auflösung — ein Fehler je Markt in `marktErgebnis` statt eines Abbruchs, und
eine Spalte, die einen Strich samt Meldung zeigt, während die übrigen ihre
Zahlen tragen — ist eine echte Änderung an der Kernrechnung und bekommt
darum eine eigene Runde mit eigenem Review, statt sich an diese anzuhängen.

Gefunden hat es der Gesamt-Review dieser Reihe; die Entscheidung, es zu
vertagen, ist bewusst getroffen und nicht übersehen.

## Nicht in diesem Entwurf

- Weitere EFN-Ziele (NL, BE, SE, PL). Keepa führt sie nicht — weder
  Preisverlauf noch Gebühr noch Provision. Das ist eine eigene Frage.
- Ein Markt je Channel. Alle Märkte gehen in denselben Post und damit in
  denselben Channel.
- Automatische Auswahl der lohnenden Märkte. Die Kästchen setzt, wer den
  Deal baut.

