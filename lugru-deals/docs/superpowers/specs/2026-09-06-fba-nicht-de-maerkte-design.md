# FBA-Berechnung für Zielmärkte außerhalb DE — Design

Datum: 2026-09-06

Die Ware liegt in Deutschland. Verkauft wird sie auch auf amazon.fr, .it
und .es — und dorthin geht sie über das Europäische Versandnetzwerk (EFN),
zu dessen Tarif.

Ein Deal mit Zielmarktplatz außerhalb Deutschlands rechnet heute aber mit
der FBA-Gebühr, die Keepa für diesen Markt nennt, und das ist die **lokale**
Versandgebühr: die, die gälte, läge die Ware bereits im Zielland. Sie ist
niedriger als der EFN-Tarif. Jeder Nicht-DE-Deal sieht damit besser aus, als
er ist.

## Zweck

Die Frage, mit der dieser Entwurf beginnt, war: **liefert Keepa dazu Daten?**
Die Antwort steht unten und ist die Grundlage jeder weiteren Entscheidung —
sie lautet für den einen Teil ja und für den anderen nein, und genau daran
entlang läuft der Schnitt zwischen dem, was das Programm abfragen kann, und
dem, was es fragen muss.

## Was Keepa liefert

Nachgesehen im offiziellen Java-Client von Keepa (`keepacom/api_backend`) —
er bildet die API vollständig ab: `structs/Product.java` das Produktobjekt,
`structs/Request.java` jeden Endpunkt samt Parametern,
`structs/ProductFinderRequest.java` jedes Feld, nach dem Keepa filtern kann,
`structs/Stats.java` das Statistikobjekt. Die Doku unter `keepa.com/api-docs`
war aus der Arbeitsumgebung nicht erreichbar (Netzsperre), der Client ist
aber dieselbe Quelle in Codeform.

| Feld | Inhalt | im Programm |
|---|---|---|
| `fbaFees.pickAndPackFee` | Versandgebühr in Cent | genutzt (`Product.FBA`) |
| `fbaFees.pickAndPackFeeTax` | Steuer auf diese Gebühr | ungenutzt |
| `fbaFees.storageFee` | Lagergebühr | ungenutzt |
| `fbaFees.storageFeeTax` | Steuer darauf | ungenutzt |
| `referralFeePercentage` | Provision in Prozent | genutzt |
| `variableClosingFee` | Abschlussgebühr (Medien) | ungenutzt |
| `packageLength/Width/Height` | Maße in Millimeter | ungenutzt |
| `packageWeight`, `itemWeight` | Gewicht in Gramm | ungenutzt |

**Alle diese Werte gelten je Marktplatz.** Das Produktobjekt trägt ein Feld
`domainId`, und die Anfrage nennt genau eine `domain`. `holeProdukt` fragt
schon heute mit `ziel.KeepaDomain` — also mit dem *Zielmarkt*, nicht mit DE.
Die FBA-Gebühr und die Provision eines IT-Deals sind darum bereits
italienische Werte, und der Keepa-Cache trägt `(asin, domain)` im
Schlüssel, kann die Märkte also nicht vermischen.

Die Marktzuordnung selbst stimmt: Keepas `AmazonLocale` zählt
`RESERVED, US, GB, DE, FR, JP, CA, RESERVED2, IT, ES, IN, MX, BR`, und die
Ordnungszahlen daraus — DE 3, FR 4, IT 8, ES 9 — sind genau die Werte in
`marketplace.tabelle`.

Zwei Einschränkungen stehen in Keepas eigener Feldbeschreibung und gehören
mitgelesen:

- Die Gebühr wird **aus den Maßen gerechnet**: „If the total fee is 0 the
  product does not have (valid) dimensions and thus the fee can not be
  calculated." Fehlen die Maße, fehlt die Gebühr — `Price.OK` ist dann false,
  und das Formular fällt auf den Standardwert zurück.
- Die Provision hängt am **Preis**: „determined by either the current price
  or, in the absence of a current offer, the previous one. If neither of
  these prices is available […] based on a standard sales price of 100.00."
  In Kategorien mit Preisstufen kann der Prozentsatz also danebenliegen,
  wenn der eingetragene VK stark vom aktuellen Preis abweicht.

## Was Keepa nicht liefert

Im ganzen Produktobjekt gibt es kein Feld für `EFN`, `Pan-EU`, `VAT` oder
einen Steuersatz — die Wörter kommen dort nicht einmal vor. Konkret fehlt:

**Der Versandweg.** Ob eine Einheit lokal, über Pan-EU oder über EFN
versandt wird, ist keine Eigenschaft der ASIN, sondern eine des
Verkäuferkontos und des Lagerorts. Zwei Händler, dieselbe ASIN, derselbe
Marktplatz — verschiedene Gebühren. Keepa kann das nicht wissen und tut auch
nicht so: es nennt genau eine Zahl, die lokale.

**Der EFN-Aufschlag.** Es gibt kein zweites Gebührenfeld, keinen Schalter an
der Anfrage, keinen eigenen Endpunkt. Das ist keine Vermutung aus dem
Produktobjekt allein, sondern über die ganze API geprüft:

- Der Endpunkt `/product` kennt die Parameter `asin`, `code`, `domain`,
  `stats`, `history`, `update`, `offers`, `only-live-offers`, `days`,
  `rating`, `buybox`, `videos`, `aplus`, `stock` — **keiner davon** wählt
  einen Tarif, ein Programm oder ein Lagerland.
- Der Product Finder, der über Keepas gesamten Index filtert, hat für
  Gebühren genau ein Feldpaar: `fbaFees_lte` / `fbaFees_gte`. Ein einziger
  Skalar. Gäbe es lokal *und* EFN, stünden dort zwei.
- Das `Stats`-Objekt führt überhaupt kein Gebührenfeld.

Wer den EFN-Tarif braucht, muss ihn aus Amazons Tarifübersicht mitbringen.

**Umsatzsteuersätze.** Weder der Regelsatz eines Marktes noch der ermäßigte
Satz einer Warengruppe. Keepas Preise sind Verbraucherpreise inklusive
Steuer, aber der Satz selbst steht nirgends.

**Die weiteren EFN-Ziele.** Keepa führt elf Domains: US, GB, DE, FR, JP, CA,
IT, ES, IN, MX, BR. In Europa sind das DE, FR, IT, ES und GB — genau die
vier, die das Programm ohnehin kennt. Aus einem deutschen Lager beliefert
EFN aber auch amazon.nl, .se, .pl und .be, und für die gibt es aus Keepa
weder Preisverlauf noch Gebühr noch Provision. Solange nur FR, IT und ES
Ziel sind, spielt das keine Rolle; es begrenzt nur, wohin sich das Programm
später erweitern ließe.

Für den Versandweg ist das keine Lücke, die man schließen könnte, sondern
eine, die man schließen *muss*, weil sie in der Sache nicht zu Daten über das
Produkt gehört. Für die Steuersätze ist es eine, die das Programm längst
selbst füllt.

## Ausgangsbefund

Was für Nicht-DE-Ziele bereits stimmt:

- **Die Steuersätze.** `marketplace.tabelle` führt je Markt einen Satz
  (DE 19,0 %, FR 20,0 %, IT 22,0 %, ES 21,0 %), und `srv.ustPermille`
  lässt ihn unter Einstellungen je Markt überschreiben. `calc.Rechne`
  zieht den **Ziel**satz vom Verkaufspreis ab und den **Quell**satz vom
  Einkauf — beide getrennt, beide richtig herum. Beim Versand aus DE über
  EFN mit OSS gilt der Satz des Ziellandes; genau den nimmt die Rechnung.
- **Provision und FBA-Gebühr** kommen, wie oben beschrieben, schon vom
  Zielmarkt.
- **Die Währung** ist in allen vier geführten Märkten der Euro. Ein
  Umrechnungsproblem gibt es hier nicht — es entstünde erst mit einem Ziel
  wie PL, SE oder UK.

Was fehlt:

1. **Der EFN-Aufschlag** — der eigentliche Gegenstand dieses Entwurfs.
2. **Der Standardwert der FBA-Gebühr ist global.** `calc.standard_fba` ist
   ein einziger Schlüssel. Kennt Keepa für eine ASIN keine Maße, bekommt ein
   IT-Deal denselben deutschen Schätzwert wie ein DE-Deal.
3. **Ermäßigte Steuersätze** kennt das Programm nicht. Der Satz hängt am
   Markt, nicht am Artikel. Für ein Getränk mit ermäßigtem Satz in IT oder ES
   ist der Regelsatz die falsche Zahl — und Keepa hilft dabei nicht.

## Entscheidungen

**Das Lager steht in Deutschland, also ist jedes Ziel außer DE ein
EFN-Versand.** Damit braucht es keinen Schalter je Deal und keine Auswahl
zwischen Versandwegen: die Regel folgt aus dem Zielmarkt, den der Funnel
ohnehin schon kennt. Zielmarkt DE — Keepas Gebühr stimmt. Zielmarkt FR, IT
oder ES — Keepas Gebühr ist die lokale und damit die falsche; es gilt der
EFN-Tarif.

**Das Lagerland bleibt trotzdem eine Einstellung, kein fest verdrahtetes
„DE".** Nicht als Vorrat für einen Fall, den es nicht gibt, sondern weil die
Regel sonst nirgends aufgeschrieben stünde: der Vergleich `Zielmarkt ≠
Lagerland` benennt im Code genau das, was ihn auslöst. Ein hartes `!= "DE"`
verstreut dieselbe Annahme über mehrere Stellen, ohne sie je zu benennen.

**Die Gebühr bleibt von Hand überschreibbar.** Das ist sie heute schon, und
sie ist damit auch der Notausgang für jeden Sonderfall — eine Sendung, die
doch aus lokalem Bestand geht, ein Tarif, den die Einstellung noch nicht
kennt.

**Der Tarif wird nach Größenklasse gestaffelt, nicht pauschal.** Amazons
EFN-Gebühr hängt an Maßen und Gewicht, und Keepa liefert beides
(`packageLength/Width/Height` in Millimeter, `packageWeight` in Gramm). Ein
Pauschalbetrag je Zielland wäre eine Näherung, deren Fehler mit dem Gewicht
wächst; die Staffel trifft die Zahl.

**Das Tarifwerk sind Daten, keine Konstanten im Code.** Weder die Beträge
noch die Klassengrenzen stehen im Programm. Amazons Tabellen ändern sich
mehrmals im Jahr — zuletzt der Treibstoff- und Logistikzuschlag von 1,5 % zum
17. April 2026 — und eine nachgebaute Tabelle wäre am Tag ihrer
Fertigstellung veraltet, würde aber falsche Zahlen mit der Autorität von
Programmcode ausstatten. Eingetragen wird beides aus der eigenen
Tarifübersicht.

**Klassen einmal, Gebühren je Markt.** So ist Amazons Tarifübersicht selbst
gebaut: Zeilen sind Größenklassen, Spalten sind Länder. Die Grenzen einer
Klasse stehen darum genau einmal da und nicht dreimal nebeneinander —
sonst gäbe es drei Antworten auf die Frage, was ein Standardpaket ist.

Die EFN-Übersicht führt FR, IT und ES sogar in **einer** Spalte („Central
European Program (DE/PL/CZ)/IT/ES/FR"): für alle drei gilt derselbe Betrag.
Die lokale Übersicht dagegen hat je Land eine eigene Spalte, und die Beträge
gehen dort deutlich auseinander. Die Trennung je Markt ist also nötig — und
außerdem haben die weiteren EFN-Ziele NL/BE, SE und PL eigene Spalten.

**Beide Tarifwerke stehen nebeneinander, nicht nacheinander.** Amazon führt
zwei Übersichten: eine für lokalen und paneuropäischen Versand, eine für das
Versandnetzwerk. Welche gilt, hängt allein daran, ob die Ware im Zielland
liegt — je Zielmarkt ist genau eine erreichbar. Gespeichert werden trotzdem
beide, denn wechselt das Lagerland, gilt schlagartig die jeweils andere, und
die soll dann nicht leer sein. Ein Feld `weg` an der Gebühr sagt, welche es
ist; die Klassengrenzen sind für beide dieselben.

Der Abstand ist kein Detail. Gerechnet über die Startbestückung, DE lokal
gegen IT über EFN:

| Paket | Klasse | DE lokal | IT EFN |
|---|---|---|---|
| Leichter Umschlag, 100 g | Leichter Umschlag ≤ 100 g | 2,28 € | 5,50 € |
| Einzelflasche 8×8×30 cm, 1,2 kg | Kleines Paket ≤ 1,4 kg | 3,15 € | 9,28 € |
| 6er-Träger 30×20×25 cm, 6,0 kg | Standardpaket ≤ 8,9 kg | 5,77 € | 18,06 € |
| Kasten 40×30×30 cm, 15,0 kg | Standardübergröße Light | 7,03 € | 33,25 € |

Das Zwei- bis Fünffache — genau der Betrag, um den ein Auslandsdeal bisher zu
gut aussah.

**Die Kilogramm-Staffel gehört zur Gebühr, nicht zur Klasse.** Für die
Übergrößen führt die Übersicht je Klasse zwei Zeilen: einen Grundbetrag bis
zu einem Gewicht und darüber „0,36 € je zusätzlichem Kilogramm". Das ist ein
Preis und nicht zwei — eine zweite Zeile in der Staffel wäre eine Klasse, die
es nicht gibt. Aufgerundet wird auf angefangene Kilogramm, so wie Amazon es
meint; abgerundet ergäbe sich eine zu niedrige Gebühr, und zu niedrig ist
hier die gefährliche Richtung.

**Der Zuschlag je Einheit steht in den Einstellungen, nicht in der Staffel.**
Fußnote 4 beider Übersichten: wer Lagerbestand in Deutschland hat und am
Central Europe Program nicht teilnimmt, zahlt je Einheit aus einem deutschen
Logistikzentrum 0,26 € mehr. Nachgerechnet stimmt das genau — in beiden
Übersichten liegt die Spalte „Nur DE" in **jeder** Zeile exakt 0,26 € über der
CEP-Spalte. Es ist also ein Aufschlag auf jede Zeile und kein anderer Tarif,
und so wird er auch abgebildet: eine Zahl, nicht eine zweite Tabelle. Wer
teilnimmt, trägt 0 ein.

**Welche Quelle zuerst gefragt wird, hängt am Versandweg.** Das ist die
Entscheidung, die am meisten am bisherigen Verhalten ändert — und darum die,
die am wenigsten ändert:

- *Ins Ausland* führt die Staffel. Keepa kennt den EFN-Tarif nicht; seine Zahl
  ist die lokale des Zielmarkts und damit sicher die falsche.
- *Im Lagerland* führt Keepa. Dort ist seine Zahl genau die gesuchte, und sie
  stammt aus Amazons eigener Einstufung — die kennt Warengruppe und
  Volumengewicht und weiß damit mehr als diese Staffel. Sie durch eine eigene
  Klassenwahl zu ersetzen wäre kein Fortschritt, sondern eine zweite Meinung.
  Die Staffel fängt hier nur auf, was Keepa nicht weiß.

So bleibt für DE-Deals alles wie bisher, und die lokale Übersicht ist dort
Rückfall statt Ersatz.

**Die erste passende Klasse gewinnt.** Die Klassen tragen darum eine
Reihenfolge. Verglichen wird nach Amazons eigener Regel: die drei Maße des
Pakets absteigend sortiert gegen die drei Grenzen der Klasse, ebenfalls
absteigend sortiert — ein flaches, langes Paket fällt sonst durch eine
Klasse, in die es gehört.

**Keine Maße, keine Klasse, keine erfundene Zahl.** Fehlen Keepa die Maße —
dasselbe `-1`, das schon heute die Gebühr fehlen lässt — oder passt das
Paket in keine eingetragene Klasse, bleibt es beim bisherigen Verhalten:
Keepas Gebühr, sonst der Standardwert. Lieber die alte Näherung als eine
neue Erfindung.

**Ohne eingetragene Tarife ändert sich nichts.** Eine leere Tabelle trifft
nie zu, und dann steht in der Gebühr genau die Zahl, die heute dort steht.
Zusammen mit der Rangfolge oben heißt das: **kein DE-Deal rechnet nach dieser
Änderung anders als vorher.** Was sich ändert, sind allein die Auslandsdeals —
und genau die waren falsch.

**Die Herkunft bleibt sichtbar.** Steht heute `keepa` oder `standardwert` an
der FBA-Gebühr, steht dort künftig `EFN-Tarif` samt Klassennamen, wenn die
Zahl von dort kommt. Sie stammt dann nicht mehr aus Keepa, und die Historie,
die diese Herkunft bereits festhält, darf das nicht verwischen.

## Aufbau

### Einstellungen

Ein neuer Schlüssel neben den bestehenden:

    versand.lagerland    Länderkürzel, Vorgabe "DE"

Die Tarife selbst gehören nicht hierher. Sie sind eine Liste von Stücken mit
eigenem Lebenszyklus — wie Channels und Affiliate-Tags — und nicht die
flachen Schlüssel/Wert-Paare, die ein einziges Formular gemeinsam speichert.

### Tabellen `fba_klassen` und `fba_gebuehren`

    CREATE TABLE IF NOT EXISTS fba_klassen (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sortierung    INTEGER NOT NULL DEFAULT 0,
        bezeichnung   TEXT    NOT NULL,
        max_laenge_mm INTEGER NOT NULL DEFAULT 0,
        max_breite_mm INTEGER NOT NULL DEFAULT 0,
        max_hoehe_mm  INTEGER NOT NULL DEFAULT 0,
        max_gewicht_g INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS fba_gebuehren (
        klasse_id      INTEGER NOT NULL REFERENCES fba_klassen(id) ON DELETE CASCADE,
        markt          TEXT    NOT NULL,
        weg            TEXT    NOT NULL,   -- "lokal" oder "efn"
        cent           INTEGER NOT NULL,
        frei_gewicht_g INTEGER NOT NULL DEFAULT 0,
        cent_pro_kg    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (klasse_id, markt, weg)
    );

`ON DELETE CASCADE` statt Aufräumen im Code: eine gelöschte Klasse darf keine
Gebühren hinterlassen, die auf nichts mehr zeigen. `PRAGMA foreign_keys = ON`
steht bereits im Schema.

### Speichern: erst prüfen, dann schreiben

Die Tarifseite wird als ganze Tabelle abgeschickt. Geprüft wird darum
vollständig, bevor der erste Schreibzugriff passiert, und geschrieben wird in
einer Transaktion. Zeile für Zeile zu speichern hieße, nach einem Tippfehler
in der zwanzigsten Zeile die halbe Tabelle im neuen und die andere Hälfte im
alten Zustand stehen zu lassen — und beides zusammen rechnete ab sofort echte
Deals. Schlägt die Prüfung fehl, bleiben die abgeschickten Werte im Formular
stehen; sonst verlöre, wer sich in einer von dreißig Zeilen vertippt, die
anderen neunundzwanzig.

**Das Formular trägt sein Lagerland mit.** Welchem Versandweg eine Spalte
zugeordnet ist, hängt daran — und es kann sich geändert haben, seit die Seite
gebaut wurde. Stimmt es nicht mehr überein, wird das Speichern abgelehnt statt
die angezeigten EFN-Beträge stillschweigend als lokale abzulegen.

### Seite „Versandtarife"

Eine Seite in der Bauart von `/tags`, aufgebaut wie Amazons Tarifübersicht:
Zeilen sind Klassen, Spalten sind Märkte. Je Zeile die Grenzen und je Markt
ein Gebührenfeld samt Kilogramm-Staffel; ein Formular speichert alles.

Jede Spalte trägt den Weg, der für sie gilt — das Lagerland „lokal", die
übrigen „efn". Gezeigt wird je Markt nur dieser eine, weil nur er erreichbar
ist; in der Datenbank stehen beide.

### Der Pan-EU-Vergleich im Post

Ein Deal ins Ausland hat zwei Gewinne, nicht einen: den für Ware aus dem
Lagerland und den für Ware, die im Zielland liegt. Der Unterschied ist keine
Nuance — beim 6er-Träger nach ES sind es 11,08 € je Einheit, aus 9,9 % Marge
werden 22,2 %. Wer den Deal liest, fährt womöglich das andere Programm, und
für den ist die erste Zahl schlicht falsch.

Beide stehen darum im Post. Gerechnet wird der zweite über `calc.Rechne` mit
der lokalen Gebühr: Gewinn und Marge sollen aus derselben Funktion kommen wie
die Hauptzahlen, sonst gäbe es eine zweite Formel, die irgendwann abweicht.

**Eingesetzt wird der lokale Tarif unmittelbar**, nicht die eingetragene
Gebühr abzüglich der Differenz beider Tarife. Der Abzug wäre kürzer, stimmte
aber nur, solange im Feld exakt der EFN-Tabellenpreis steht. Nach einer
Korrektur von Hand — die ausdrücklich vorgesehen ist — ergäbe er eine
erfundene Zahl: bei EFN 18,32 €, lokal 7,24 € und einer Eingabe von 12,00 €
kämen 0,92 € heraus, und die stünde anschließend im Post. So steht in beiden
Zeilen je eine Zahl, die für sich einsteht, und die Aufschlüsselung nennt
beide Gebühren nebeneinander.

**Nur die Gebühr unterscheidet sich.** Die Umsatzsteuer ist dieselbe — ob über
OSS aus dem Lagerland oder aus lokalem Bestand, für den Endkunden gilt der Satz
des Ziellandes. Die Provision ohnehin, es ist derselbe Marktplatz. Der
Zuschlag je Einheit fällt dagegen weg: er gilt für Sendungen aus deutschen
Logistikzentren, und aus lokalem Bestand geht die Sendung dort gar nicht los.

**Die Maße reisen im Formular mit.** Schritt 4 baut den Post allein daraus,
eine Keepa-Antwort liegt dort nicht mehr vor. Sie werden beim Einlesen geprüft
wie jede andere Eingabe — zwischen Keepa und dem Handler liegt ein Browser.

**Ohne Vergleich keine Zeile.** Fehlt eines von beidem — Ziel im Lagerland,
keine Maße, keine Klasse, ein fehlender Tarif —, bleiben `GewinnPanEU` und
`MargePanEU` leer, und das `{{if}}` der Vorlage lässt die Zeile weg. Eine
halbe Vergleichszahl wäre schlimmer als keine.

**Eine bereits gespeicherte Vorlage bekommt die Zeile nicht von selbst.** Die
Einstellungsseite bietet sie deshalb zum Kopieren an, statt sie nur im
Quelltext zu führen.

### Funnel, Schritt 3

Kein neues Feld und kein Schalter. Ist der Zielmarkt ein anderer als das
Lagerland und findet sich zu Keepas Maßen eine Klasse mit einem Betrag für
diesen Markt, wird die FBA-Gebühr damit vorbelegt; die Herkunft lautet dann
`EFN-Tarif · <Klassenname>`. Im Lagerland bleibt es bei `keepa`, solange Keepa
eine Gebühr nennt — sonst springt `lokaler Tarif · <Klassenname>` ein.

Eine von Hand eingetragene Gebühr bleibt unberührt — sie ist bereits die
Antwort auf genau diese Frage. Und weil der Tarif nur die *Vorbelegung*
setzt, bleibt der Weg offen, sie zu überschreiben, wenn eine Sendung doch
aus lokalem Bestand geht.

### Paket `internal/fba`

Die Klassenwahl ist reine Rechnung und bekommt darum ein eigenes Paket, frei
von Datenbank und Vorlagen — aus demselben Grund wie `internal/calc`:

    func Waehle(klassen []Klasse, m Masse) (Klasse, bool)

`Masse` sind die vier Zahlen aus Keepa. Unvollständige Maße ergeben nie
einen Treffer, und die Klassen werden in ihrer Reihenfolge geprüft.

### keepa

`Product` bekommt die vier Maße. Keepa nennt `-1` oder `0` für „unbekannt";
beides wird zu `0`, damit der Rest des Programms nur einen Fall kennt.

### Startbestückung

Die Staffel wird beim ersten Start einmalig aus beiden Tarifübersichten
befüllt — 31 Klassen, lokale Beträge für DE, FR, IT und ES, EFN-Beträge für
FR, IT und ES.

Das steht nicht im Widerspruch zu „das Tarifwerk gehört nicht ins Programm",
sondern ist dessen Kehrseite: die Zahlen landen **einmalig** in der Datenbank
und werden von da an dort gelesen und dort geändert. Eine Marke in den
Einstellungen hält fest, dass es passiert ist; wer die Staffel bewusst leert
oder eine Klasse löscht, bekommt sie nicht beim nächsten Start zurück. Eine
Erstbefüllung ist keine Zwangsbefüllung.

Ohne sie wäre die Entscheidung für die Staffel eine Entscheidung für über
zweihundert von Hand abgetippte Beträge — und eine Tabelle, die niemand
ausfüllt, rechnet genauso falsch wie gar keine.

Nicht übernommen ist die Klasse „Sonderübergröße" (über 31,5 kg oder mit
einer Kante über 175 cm): die lokale Übersicht führt für sie keinen
CEP-Betrag, die EFN-Übersicht kennt sie gar nicht. Ein solches Paket findet
keine Klasse und fällt auf Keepas Gebühr zurück.

Damit das auch eintritt, tragen die beiden letzten Klassen ihre echten
Schranken — 175 cm je Kante und 31,5 kg — statt beliebig großer Ersatzwerte.
Mit 9999 mm und 999 kg fing „Schwere Übergröße" jedes beliebige Paket auf und
belegte es mit einem Tarif, den die Übersicht für diesen Fall gar nicht
kennt. Das dritte Merkmal, ein Umfang über 360 cm, lässt sich mit drei
Kantengrenzen nicht ausdrücken und bleibt offen.

### calc

`calc.Rechne` bekommt **kein** neues Feld. Der Aufschlag ist eine
Vorbelegungsfrage, keine Rechenregel: in die Rechnung geht weiterhin eine
einzige FBA-Gebühr ein, und die Aufschlüsselung zeigt weiterhin eine Zeile.
Damit bleibt das Paket frei von Amazons Programmlogik — und die Zeile
„FBA-Gebühr" behält genau die Zahl, die der Nutzer im Feld darüber sieht.

### Standardwert je Markt

`calc.standard_fba` wird zu `calc.standard_fba.<Code>`, mit demselben
Zeilenmuster wie die Steuersätze. Der bestehende globale Wert wandert beim
Start auf `calc.standard_fba.DE`, damit vorhandene Datenbanken ihre Angabe
behalten.

## Offene Fragen

Diese Punkte brauchen eine Entscheidung, bevor gebaut wird:

1. **Ermäßigte Steuersätze**: soll der Satz je Deal übersteuerbar werden
   (ein Feld in Schritt 3, wie Provision und FBA-Gebühr), oder bleibt es
   beim Satz je Markt?
2. **Das Volumengewicht fehlt.** Fußnote 3 der Übersicht: bei Paketen und
   Übergrößen nimmt Amazon das größere aus Einheits- und Volumengewicht.
   Hier zählt allein Keepas Paketgewicht. Für ein leichtes, sperriges
   Produkt fällt die Gebühr damit zu niedrig aus. Die Fußnote nimmt
   allerdings eine lange Liste von Kategorien ausdrücklich aus, darunter
   **„Lebensmittel und Gourmet"** — für Getränke gilt also ohnehin das
   Einheitsgewicht, und die Lücke bleibt theoretisch. Wer außerhalb dieser
   Kategorien handelt, muss die Gebühr von Hand prüfen.
3. **Enthält Keepas Gebühr den Zuschlag?** Fußnote 4 spricht von jeder
   Einheit, „die von deutschen Logistikzentren versendet wird" — nicht nur von
   EFN-Sendungen. Ein DE-Deal bekommt weiterhin Keepas Gebühr, und ob die den
   Zuschlag schon enthält, lässt sich nur gegen eine echte Abrechnung prüfen.
   Der Zuschlag wird darum nur dort gerechnet, wo der Betrag aus der
   CEP-Spalte stammt — also auf dem Staffel-Weg, nicht auf dem Keepa-Weg.
   Fällt der Vergleich mit einer Abrechnung anders aus, ist das die Stelle.
4. **Stimmt Keepas Gebühr überhaupt mit der lokalen Übersicht überein?** Beide
   sollten dasselbe sagen. Weichen sie ab, ist entweder Keepas Stand veraltet
   oder die Größenklasse hier falsch gewählt — und dann gehört die Rangfolge
   im Lagerland umgedreht. Ein Vergleich an einem echten Artikel klärt das in
   einer Minute.
5. **Sollen Märkte ohne Keepa-Daten überhaupt Ziel sein können?** EFN aus
   DE beliefert auch amazon.nl, .se, .pl und .be. Ein Deal dorthin ließe
   sich nur mit von Hand eingetragenen Zahlen posten — Verkaufspreis,
   Provision, Gebühr und Chart fielen alle aus. Das ist eine eigene
   Entscheidung, keine Nebenfolge dieses Entwurfs.
