# Lugru Deal Discord

Postet Amazon-Arbitrage-Deals nach Discord. Holt Titel, Preisverlauf,
Verkaufszahlen und Gebühren aus Keepa, rechnet Gewinn und Marge und hängt den
Keepa-Preischart als Bild an den Post.

## Windows

Die vollständige Anleitung steht unter
[`scripts/windows/README.md`](scripts/windows/README.md) — sie umfasst
PowerShell-Skripte für Installation, Update und Deinstallation über
bordmitteleigene Scheduled Tasks (kein Drittsoftware-Zwang). Hier nur die
Kurzfassung für Geübte:

### Schnellstart

```powershell
# ZIP aus https://github.com/trinkfreunde/lugru-deal-discord/releases/latest
# herunterladen und entpacken, dann in der entpackten PowerShell:
.\install.ps1 -StartNow
```

Es ist kein Go, kein Git und kein `make` nötig — das Release-ZIP enthält
die vorgebaute `lugru-deals.exe`, alle PowerShell-Skripte und einen
CMD-Wrapper (`install.cmd` / `uninstall.cmd`) für den Doppelklick-Fall.

Wer das Repo lokal hat und selbst bauen möchte: `make windows` baut die
EXE nach `dist\lugru-deals.exe`, danach `install.ps1` aus
`scripts/windows/`.

Default-Pfade (anpassbar per `-InstallDir`/`-DataDir`):

- InstallDir = `%LOCALAPPDATA%\Programs\LuGruDeals\`
  (`C:\Users\<name>\AppData\Local\Programs\LuGruDeals`)
- DataDir   = `%LOCALAPPDATA%\LuGruDeals\`

Beide liegen unter `%LOCALAPPDATA%` — keine Admin-Rechte nötig. Ein
Scheduled Task startet die Anwendung bei jeder Anmeldung und erbt die
benutzerspezifischen Umgebungsvariablen aus der Windows-Registry
(`KEEPA_API_KEY`, `LUGRU_*`). Der Launcher reicht sie an die EXE weiter.
Eine Änderung greift erst nach Restart der EXE (`stop.ps1` + `start.ps1`
oder kurz Task aus- und wieder einschalten).

### Manueller Start ohne Skripte

Wer die Skripte umgehen will, kann die EXE direkt starten — nützlich
für Tests:

```cmd
"%LOCALAPPDATA%\Programs\LuGruDeals\lugru-deals.exe" ^
    -db "%LOCALAPPDATA%\LuGruDeals\deals.db" ^
    -charts "%LOCALAPPDATA%\LuGruDeals\charts"
```

Die EXE läuft dann im Vordergrund mit Konsolenfenster und lauscht auf
`http://127.0.0.1:8080`. Beendet wird mit **STRG+C** im Fenster — so läuft
der geordnete Shutdown und SQLite WAL wird sauber gecheckt.

### Häufige Stolperfallen (Kurzfassung)

- **„Adresse wird bereits verwendet" (address already in use):** anderes
  Programm auf Port 8080 — `LUGRU_ADRESSE=127.0.0.1:8090` setzen oder
  anderes Programm beenden.
- **Browser öffnet sich nicht:** im Scheduled-Task-Modus unterdrückt der
  Launcher den Browser absichtlich (`-browser 0`). Doppelklick direkt auf
  `lugru-deals.exe` öffnet den Standardbrowser via
  `rundll32 url.dll,FileProtocolHandler`.
- **Datenbank nicht schreibbar unter `C:\Program Files\…`:** dort nicht
  installieren — UAC-Beschränkungen. Stattdessen `-DataDir` zeigen auf
  einen beschreibbaren Pfad (z. B. `%LOCALAPPDATA%\LuGruDeals\`).
- **SmartScreen-Dialog:** die EXE ist nicht signiert, erster Start
  erfordert **Weitere Informationen → Trotzdem ausführen**. Eine Code-
  Signatur würde das dauerhaft abstellen — siehe Roadmap in der
  Detail-Anleitung.

### Was beim harten Kill mit `deals.db` passiert

Ein harter Abbruch — `Stop-Process -Force`, `taskkill /F`, Stromausfall —
ist **kein Datenverlust**: `internal/store/store.go` setzt
`PRAGMA journal_mode = WAL` beim Start, und der WAL-Mode ist genau für
diesen Fall gebaut. Beim nächsten Start übernimmt SQLite automatisch alle
committeten Schreibvorgänge aus der WAL-Datei in die Hauptdatenbank und
verwirft angefangene. Liegengebliebene `deals.db-shm` und `deals.db-wal`
beim nächsten Start von Hand löschen oder einfach liegenlassen — sie
behindern nichts. Vollständige Tabelle in
[`scripts/windows/README.md`](scripts/windows/README.md#was-zu-sqlite-wal-gesagt-werden-muss).

## Docker

    docker build -t lugru-deals .
    docker run -p 127.0.0.1:8080:8080 -v "$PWD/daten:/daten" \
      -e KEEPA_API_KEY=dein_key lugru-deals

Der Ordner `daten/` muss vorher nicht angelegt werden — das übernimmt der
Container automatisch. Legt Docker ihn beim ersten Start selbst neu an,
gehört er auf dem Host zunächst `root`; der Container startet deshalb intern
kurz als root, übernimmt den Besitz von `/daten` und wechselt erst danach zum
unprivilegierten Benutzer, unter dem lugru-deals tatsächlich läuft. Das
passiert bei jedem Start automatisch, es ist kein manueller Schritt nötig.

## Erste Schritte

1. Unter **Einstellungen** den Keepa-API-Key eintragen.
2. Unter **Channels** einen Channel mit Discord-Webhook anlegen und testen.
3. Unter **Tags** je Marktplatz einen Affiliate-Tag anlegen und als Standard
   markieren.
4. Unter **Neuer Deal** dem Funnel folgen.

## Der Funnel

Ein neuer Deal entsteht in vier Schritten auf einer einzigen Seite:

1. **Einkaufslink** — eine Amazon-URL, der Link eines beliebigen anderen Shops
   oder eine nackte ASIN. Führt der Link zu einem fremden Shop, wird die ASIN
   nachgefragt: verkauft wird immer bei Amazon, und ohne ASIN gibt es weder
   Keepa-Daten noch einen Verkaufslink. Das Einkaufsland — es legt nur den
   Umsatzsteuersatz des Einkaufs fest — wird aus der Endung des Shops
   vorgeschlagen und zur Bestätigung angezeigt. Bei einer nackten ASIN wird
   es nachgefragt.
2. **Einkauf & Ziel** — Einkaufspreis eingeben, mit einem Schalter für netto
   oder brutto, dazu die Zielmarktplätze: ein Kästchen je Marktplatz, denn
   verkauft wird oft auf mehreren zugleich. Einer davon ist der
   **Leitmarkt** — der Marktplatz, an dem alles hängt, was es nur einmal
   geben kann: Artikelname, Bild, Chart, die Links zu ArbitrageOne und
   ProfitPath und die Zahlen der Historienzeile. Die übrigen gewählten Märkte bekommen in
   Schritt 3 trotzdem ihre eigene Rechnung und im Post ihre eigene Zeile.
   Erst nach der Marktwahl wird Keepa gefragt, also auch erst dann ein Token
   verbraucht.
3. **Berechnung** — eine Tabelle mit einer Spalte je gewähltem Zielmarkt:
   Verkaufspreis, Verkäufe, Provision und FBA-Gebühr stehen vorbefüllt da und
   lassen sich je Markt von Hand korrigieren. Darüber steht die
   Ergebnis-Übersicht: eine Zeile je Markt mit Verkäufen, Verkaufspreis,
   Gewinn, Marge und ROI, dazu der Pan-EU-Vergleich, wo es ihn gibt. Am Ende
   jeder Zeile sitzt ein Taschenrechner — grün, wo etwas übrig bleibt, rot,
   wo nicht —, und wer darauf zeigt, bekommt die vollständige Rechnung genau
   dieses Marktes: Einkauf, Verkauf, Ergebnis. Jede Änderung rechnet alles
   sofort neu, ohne die Seite zu verlassen.
4. **Vorschau** — links der fertige Post als Karte, so wie Discord ihn zeigen
   wird, rechts daneben Channel und Affiliate-Tags: Produktname mit Link, Bild, Einkauf, je Zielmarkt ein Feld mit
   Preis, Verkäufen, Gewinn und Marge, darunter der Preisverlauf. Der Rand
   der Karte ist grün, bernstein oder rot — nach derselben Margenschwelle,
   nach der auch die Marktübersicht ihre Chips färbt. Channel und
   Affiliate-Tag wählen, posten.

Zurück geht es aus jedem Schritt; die Zahlen, die in Schritt 3 von Hand
geprüft wurden, bleiben dabei erhalten.

## Der Discord-Post

Der Post ist eine Karte (ein Discord-Embed) und kein Fließtext. Das Programm
baut sie selbst:

- **Titel** ist der Artikelname und führt auf das Angebot im Leitmarkt.
- **Farbe des linken Randes** sagt, was der Deal taugt: grün ab 12 % Marge,
  bernstein ab 6 %, sonst rot. Dieselben Schwellen wie die Chips in der
  Marktübersicht — derselbe Deal darf nicht an zwei Stellen verschieden
  bewertet aussehen.
- **Beschreibung** nennt den Einkauf mit Betrag, Shop und Notiz, dazu die
  Links zu ArbitrageOne und ProfitPath.
- **Je Zielmarkt ein Feld**: Verkaufspreis (verlinkt), Verkäufe, Gewinn,
  Marge und, wo es ihn gibt, der Pan-EU-Vergleich. Discord setzt **zwei**
  davon nebeneinander — bei mehreren Märkten wird der Post damit lesbar,
  statt gleich aussehende Zeilen untereinander zu stapeln. Zwei und nicht
  drei, weil neben dem Produktbild sonst mitten im Betrag umgebrochen wird;
  die Grenze zieht ein leeres Feld auf dem dritten Platz, denn eine
  Einstellung dafür kennt Discord nicht. Aufgefüllt wird jede Reihe, auch die
  letzte: Discord teilt die Breite je Reihe unter deren eigenen Feldern auf,
  und eine Reihe aus zwei Feldern setzte die zweite Spalte bei der Hälfte
  statt bei einem Drittel — die Märkte stünden dann gegeneinander versetzt.
- **Bild** ist das Produktfoto, **das große Bild** der Preisverlauf aus Keepa.
- **Fußzeile** trägt die ASIN.
- **Drei Knöpfe** unter der Karte: 🛒 *Zum Einkauf*, 📊 *ArbitrageOne* und
  📈 *ProfitPath*. Das Emoji reist als eigenes Feld mit und nicht vorn in der Beschriftung —
  Discord setzt es dann links vom Text, und im Text zählte es gegen dessen
  Länge. Es sind
  Link-Knöpfe — sie lösen keine Interaktion aus und brauchen darum kein
  Programm, das auf einen Klick wartet. Nur deshalb kommen sie für einen
  gewöhnlichen Channel-Webhook überhaupt in Frage.

Ob Discord die Knöpfe von einem Webhook annimmt, der keiner Anwendung gehört,
hat sich über die Jahre geändert und lässt sich von außen nicht zusagen. Das
Programm schickt sie darum mit `with_components=true` mit; lehnt Discord die
Nachricht ab (HTTP 400), wiederholt es sie **einmal ohne Knöpfe**, mit dem
Analyse-Link zurück im Text. Der Deal geht in jedem Fall hinaus; wo die Knöpfe
nicht erlaubt sind, fehlen nur sie.

Die Erwähnung (`@everyone`, `@here`, eine Rolle) steht über der Karte und
nicht in ihr: Discord wertet Karten nicht auf Erwähnungen aus, ein `@here`
darin erreichte niemanden.

Unter *Einstellungen → Notiz im Post* lässt sich eine zusätzliche Zeile
setzen, etwa „nur 3 Stück verfügbar". Sie ist optional und leer der
Normalfall; die Platzhalter der früheren Vorlage (`{{.Titel}}`, `{{.Gewinn}}`,
`{{range .Maerkte}}` …) gelten dort weiter. Wer eine eigene Vorlage
gespeichert hatte, behält sie — sie steht künftig als Notiz in der Karte. Die
unveränderte Standardvorlage wird beim Start geleert, sonst nennte sie jeden
Deal ein zweites Mal.

Nennt die Notiz den ArbitrageOne- oder den ProfitPath-Link, lässt die Karte
ihren eigenen weg — derselbe Link zweimal untereinander ist einmal zu viel.
Sieht die Notiz nach dem ganzen Post von früher aus (`{{range .Maerkte}}`,
`{{.VKUrl}}` oder `{{.AOUrl}}`), sagt die Einstellungsseite es: die Karte
baut Märkte und Links selbst, alles davon in der Notiz erscheint doppelt.


## Shop-Monitor

Unter **Monitor** beobachtet das Programm Produkte bei billiger.de und postet
selbst, sobald ein Shop einen Deal hergibt. billiger.de führt die Angebote von
OTTO, Kaufland, MediaMarkt, Cyberport und vielen anderen auf einer Seite und
liefert sie — anders als die Shops selbst — auch an einen Server aus.

1. **Produkt anlegen:** das Produkt bei billiger.de öffnen und den Link
   (`…/pricelist/…` oder `…/products/…`) einfügen. Optional: höchster
   Einkaufspreis mit Versand, nur bestimmte Shops („OTTO, Kaufland“),
   Zielmärkte. Die ASIN sucht der Monitor über die EAN selbst bei Keepa.
2. **Regeln anlegen:** je Regel ein Channel und Mindestwerte für Marge,
   Gewinn und Verkäufe, optional nur für ein Produkt oder bestimmte Shops.
   Ein Treffer geht in jeden Channel, dessen Regel er erfüllt.
3. **Testen:** zeigt den fertigen Post und die Channels, ohne zu senden.
4. **Einschalten:** unter *Einstellungen* oben auf der Seite.

Ein Treffer läuft durch dieselben Schritte wie ein Deal von Hand — der Post
sieht deshalb genau so aus. Einkaufspreis ist der Preis mit Versand, der
Einkaufslink die Preisliste bei billiger.de, die Notiz nennt den Shop.

Keepa wird nur gefragt, wenn sich das günstigste passende Angebot ändert;
derselbe Deal wird innerhalb der Sperrzeit (Vorgabe 6 Stunden) nicht noch
einmal gepostet, außer er wird günstiger. Jedes Produkt wird höchstens alle
15 Sekunden geprüft (Vorgabe 60), zwischen zwei Abrufen liegen 2 Sekunden.

**Ankauf statt Amazon:** Bei Art „Ankauf“ rechnet der Monitor nicht gegen
Amazon, sondern gegen einen festen Ankaufspreis. Ein Treffer ist dann jeder
Shop-Preis (mit Versand) bis zum Preiswecker — ohne Keepa, ohne Token. Leer
gelassen liegt der Preiswecker bei 95 % des Ankaufspreises. Der Post nennt
Shop, EK, Ankauf, Gewinn je Stück, Marge und den Hinweis, aber keine Namen
von Ankäufern. Mit Kategorien („Konsolen“, „Starlink“ …) und der Art in den
Regeln lassen sich die Treffer auf eigene Channels verteilen.

**Weitere Bausteine des Monitors** (alle unter *Monitor*):

- **mydealz:** neue Deals aus dem Feed von mydealz werden mitgelesen; passt
  ein Titel zu den Stichworten eines Produkts („ps5 pro, -controller“), wird
  er wie ein Shop-Angebot bewertet. Ohne Stichworte gilt der Name.
- **Prio:** hoch/normal/niedrig mit eigenen Prüfintervallen (Vorgabe 15 s,
  60 s, 300 s).
- **Preisverlauf:** der Post nennt „Tiefster Preis seit X Tagen“ oder den
  7-Tage-Schnitt. Fällt ein Preis weit unter diesen Schnitt (Vorgabe 20 %),
  geht unabhängig vom Preiswecker eine Meldung in den Preissturz-Channel.
- **Kategorie-Scan:** ganze Kategorien bei billiger.de werden alle zehn
  Minuten auf solche Preisstürze geprüft.
- **Ausverkauft:** verschwindet ein gepostetes Angebot, wird der Post in
  Discord als ausverkauft markiert.
- **Direkte Shop-Links:** mit eingetragener öffentlicher Adresse steht im
  Post ein Kurzlink (`/go/…`), der beim Klick über billiger.de direkt zum
  Shop führt. `/go/` ist ohne Anmeldung erreichbar.
- **Ankäufer:** je Produkt mehrere Ankäufer mit Staffel („ab 6 Stk“). Der
  beste Einzelpreis ist der Ankauf, Mengenpreise stehen im Post — die Namen
  nie.
- **Listen-Import:** eure Tabelle einfügen; der Monitor sucht je Zeile die
  Seite bei billiger.de (mit EAN-Abgleich) und legt nach eurer Prüfung alles
  an.
- **Admin-Channel:** Fehler (billiger.de blockt, Keepa leer, Post
  gescheitert) kommen nur zu euch, je Art höchstens einmal pro Stunde.

Grenzen: die Preise bei billiger.de kommen aus den Datenfeeds der Shops und
sind darum nicht sekundengenau — ein Restock ist dort meist erst nach einigen
Minuten zu sehen. OTTO und Kaufland direkt abzufragen geht nur über einen
kostenpflichtigen Dienst, der deren Bot-Schutz umgeht.

## Affiliate-Tags

Die Amazon-Links im Post tragen einen Affiliate-Tag: aus
`https://www.amazon.de/dp/B01636IZ0G` wird
`https://www.amazon.de/dp/B01636IZ0G?tag=beispiel-21`.

Jeder Tag gehört zu genau einem Marktplatz, denn ein PartnerNet-Tag verdient
nur dort, wofür er ausgestellt wurde — ein DE-Tag an einem amazon.es-Link ist
wirkungslos. Je Marktplatz kann einer als Standard markiert sein; er ist im
Funnel vorausgewählt.

Getaggt werden beide Amazon-Links des Posts, jeder mit dem Tag seines eigenen
Marktes:

- der **Verkaufslink** jedes Zielmarkts mit dem Tag, der für ihn in Schritt 4
  gewählt ist — je Markt ein eigenes Auswahlfeld, und angeboten werden darin
  nur dessen eigene Tags;
- der **Einkaufslink** automatisch mit dem Standard-Tag des Einkaufsmarktes.

Ein Einkaufslink zu einem Fremdshop bleibt unberührt. Das gilt auch für
Amazon-Marktplätze, die dieses Programm nicht führt (amazon.co.uk etwa) — sie
zählen hier als Fremdshop.

Fehlt für den Zielmarkt ein Standard, oder wird in Schritt 4 ausdrücklich
„kein Tag" gewählt, weist die Vorschau darauf hin und lässt trotzdem posten.
Ein fehlender Tag kostet Provision, ein blockierter Deal den ganzen Deal.

Der ArbitrageOne-Export bekommt keinen Tag: sein Parameter `source_url` geht
an ein Analysewerkzeug, nicht an einen Käufer. Aus demselben Grund steht in
der Historie der ungetaggte Einkaufslink — sie hält eine Bezugsquelle fest,
keine Provisionszuordnung. Welcher Tag tatsächlich im Post stand, steht dort
im gespeicherten Nachrichtentext. Der ProfitPath-Link trägt aus demselben
Grund keinen Tag — er nennt ohnehin keinen Amazon-Link, sondern ASIN, Märkte
und Preise als eigene Parameter.

## Versandtarife

Die Ware liegt in einem Land — dem **Lagerland**, unter Einstellungen gewählt,
Vorgabe DE. Dorthin gilt Amazons lokaler Tarif; jedes andere Ziel wird von dort
über das Europäische Versandnetzwerk beliefert und kostet den EFN-Tarif.

Der Unterschied ist erheblich. Gerechnet mit den hinterlegten Tarifen, DE lokal
gegen IT über EFN:

| Paket | Klasse | DE lokal | IT EFN |
|---|---|---|---|
| Leichter Umschlag, 100 g | Leichter Umschlag ≤ 100 g | 2,28 € | 5,50 € |
| Einzelflasche 8×8×30 cm, 1,2 kg | Kleines Paket ≤ 1,4 kg | 3,15 € | 9,28 € |
| 6er-Träger 30×20×25 cm, 6,0 kg | Standardpaket ≤ 8,9 kg | 5,77 € | 18,06 € |
| Kasten 40×30×30 cm, 15,0 kg | Standardübergröße Light | 7,03 € | 33,25 € |

Keepa liefert je Marktplatz nur die **lokale** Gebühr — also die, die gälte,
läge die Ware bereits dort. Für ein Auslandsziel ist das die falsche Zahl, und
zwar um das Zwei- bis Fünffache zu niedrig.

Einen EFN-Tarif liefert Keepa nicht und kann es auch nicht: welchen Weg eine
Sendung nimmt, hängt am Verkäuferkonto und am Lagerort, nicht an der ASIN. Er
steht deshalb unter **Tarife**, in der Form von Amazons eigenen Übersichten —
Zeilen sind Größenklassen, Spalten sind Zielmärkte, und jede Spalte trägt den
Weg, der für sie gilt. Grenzen und Beträge stehen bewusst nicht im Programm:
Amazons Tabellen ändern sich mehrmals im Jahr.

Beim ersten Start wird die Staffel **einmalig** aus beiden Tarifübersichten
befüllt: 31 Klassen, lokale Beträge für DE, FR, IT und ES sowie EFN-Beträge für
FR, IT und ES (die EFN-Übersicht führt die drei in einer Spalte, also gilt
derselbe Betrag). Danach wird sie nie wieder angefasst — von Hand geänderte
Werte bleiben, und eine bewusst geleerte Tabelle füllt sich nicht von selbst.

Für die Übergrößen führt jede Zelle zusätzlich die Kilogramm-Staffel, die
Amazon dort ansetzt: einen Grundbetrag bis zu einem Gewicht und darüber einen
Zuschlag je zusätzlichem Kilogramm, aufgerundet auf angefangene Kilogramm. Bei
Umschlägen und Paketen bleiben diese beiden Felder leer.

Dazu kommt der **Zuschlag je Einheit** aus den Einstellungen, Vorgabe 0,26 €.
Das ist Fußnote 4 beider Übersichten: wer Lagerbestand in Deutschland hat und
am Central Europe Program nicht teilnimmt, zahlt so viel mehr je Einheit aus
einem deutschen Logistikzentrum. Wer teilnimmt, trägt 0 ein.

### Zwei Gewinne im Post

Ein Deal ins Ausland hat zwei Gewinne: den für Ware aus dem Lagerland (EFN)
und den für Ware, die im Zielland liegt (Pan-EU oder lokaler Bestand). Beide
stehen im Post, weil der Unterschied groß ist — ein 6er-Träger von DE nach ES
bringt 8,94 € über EFN und 20,02 € mit spanischem Bestand, 9,9 % gegen 22,2 %
Marge. Beides steht im Feld desselben Marktes:

    Amazon.ES
    149,99 € · 18 Verk.
    Gewinn 8,94 €
    Marge 9,9 %
    Pan-EU 20,02 € · 22,2 %

Unterschiedlich ist allein die Versandgebühr. Die Umsatzsteuer bleibt die des
Ziellandes, die Provision sowieso; der Zuschlag je Einheit fällt weg, weil die
Sendung dann nicht aus einem deutschen Logistikzentrum geht.

Die zweite Zahl rechnet mit Amazons lokalem Tarif, nicht mit der eingetragenen
Gebühr abzüglich einer Differenz — eine von Hand korrigierte Gebühr wandert
also nicht in den Vergleich. Die Aufschlüsselung in Schritt 3 nennt beide
Gebühren nebeneinander.

Die Zeile erscheint nur, wenn es den Vergleich gibt: bei einem Ziel im
Lagerland, ohne Maße von Keepa oder ohne beide Tarife bleibt sie weg. Eine
leere Zahl wäre eine Aussage, die niemand gerechnet hat.

Die Tarifseite speichert die ganze Tabelle auf einmal: erst wird alles
geprüft, dann alles in einer Transaktion geschrieben. Ein Tippfehler in einer
Zeile lässt also nichts halb geändert zurück, und die eingegebenen Werte
bleiben zur Korrektur stehen. Wurde das Lagerland geändert, während die Seite
offen war, wird das Speichern abgelehnt — sonst gerieten die angezeigten
Beträge in den falschen Versandweg.

### Welche Quelle zuerst gefragt wird

Das hängt am Versandweg, und die Regel hält bewusst am Bisherigen fest:

- **Ins Ausland** führt die Staffel. Keepa kennt den EFN-Tarif nicht.
- **Im Lagerland** führt Keepa. Dort ist Keepas Zahl genau die gesuchte, und
  sie stammt aus Amazons eigener Einstufung — die kennt Warengruppe und
  Volumengewicht und weiß damit mehr als die Staffel hier. Der lokale Tarif
  fängt nur auf, was Keepa nicht weiß, etwa fehlende Maße.

Für Deals mit Ziel DE ändert sich damit nichts. Was sich ändert, sind die
Auslandsdeals — und genau die waren falsch.

Gegriffen wird ohnehin nur, wenn alles zusammenkommt: Maße von Keepa
vorhanden, eine passende Klasse eingetragen und für Markt und Weg ein Betrag
hinterlegt. Sonst bleibt es bei Keepas Gebühr, ersatzweise dem Standardwert.
Ein leeres Betragsfeld heißt „nicht eingetragen", nicht „0,00 €".

Die Klasse zu einem Artikel bestimmt sich aus den Paketmaßen, die Keepa
mitliefert. Verglichen wird der Größe nach — längste Kante gegen längste
Grenze —, ein quer liegendes Paket fällt also nicht aus seiner Klasse. Welche
der drei Kanten im Formular „Länge" heißt, ist entsprechend gleichgültig.

Nicht abgebildet ist das **Volumengewicht**: bei Paketen und Übergrößen nimmt
Amazon das größere aus Einheits- und Volumengewicht, hier zählt allein Keepas
Paketgewicht. Für Lebensmittel und Gourmet — und eine Reihe weiterer
Kategorien — nimmt Amazon davon ohnehin ausdrücklich aus und rechnet mit dem
Einheitsgewicht. Außerhalb dieser Kategorien fällt die Gebühr für leichte,
sperrige Ware zu niedrig aus und gehört von Hand geprüft. Ebenso fehlt die
Klasse „Sonderübergröße" (über 31,5 kg oder mit einer Kante über 175 cm) — ein
solches Paket findet keine Klasse und fällt auf Keepas Gebühr zurück. Das
dritte Merkmal dieser Klasse, ein Umfang über 360 cm, lässt sich mit drei
Kantengrenzen nicht ausdrücken und greift darum nicht.

Woher die Zahl im Feld stammt, steht daneben und in der Historie:
`EFN-Tarif · <Klasse>`, `lokaler Tarif · <Klasse>`, `keepa` oder
`standardwert`.

## Einstellungen über die Umgebung

| Variable | Vorgabe | Zweck |
|---|---|---|
| `LUGRU_ADRESSE` | `127.0.0.1:8080` | Lauschadresse |
| `LUGRU_PASSWORT` | (leer) | Schützt die Oberfläche mit Anmeldung (Benutzer `lugru`). **Pflicht, sobald das Tool aus dem Netz erreichbar ist.** |
| `LUGRU_BENUTZER` | `lugru` | Benutzername zur Anmeldung |
| `LUGRU_ZEITZONE` | `Europe/Berlin` | Zeitzone für alle angezeigten Zeiten |
| `LUGRU_DB` | `deals.db` | Pfad zur Datenbank |
| `LUGRU_CHARTS` | `charts` | Ordner für Chart-Bilder |
| `LUGRU_BROWSER` | `1` | Browser beim Start öffnen |
| `KEEPA_API_KEY` | — | sticht die Einstellung in der Oberfläche |

Flaggen (`-adresse`, `-db`, `-charts`, `-browser`) schlagen die Umgebung, die
Umgebung schlägt die eingebauten Vorgaben.

## Sicherheitshinweis

Die Anwendung hat keine Anmeldung. Beim direkten Start (die gebaute
`dist/lugru-deals.exe` oder ein selbst gebautes Binary) lauscht sie darum auf
`127.0.0.1` und ist nur vom eigenen Rechner erreichbar.

Auf Windows ist das auch der Grund, warum `taskkill /F` und das
Schließen eines Scheduled-Task-Fensters die Anwendung *ohne* Rückfrage
beenden — und warum das ungefährlich ist: die Datenbank läuft im
SQLite-WAL-Mode und repariert sich beim nächsten Start selbst (siehe
„Was beim harten Kill mit `deals.db` passiert" im Windows-Abschnitt oben).

Das Docker-Image setzt intern `LUGRU_ADRESSE=0.0.0.0:8080` — ohne das wäre
der Container von außerhalb seines eigenen Netzwerk-Namespaces gar nicht
erreichbar, das ist bei Docker normal. Die eigentliche Absicherung passiert
deshalb über die Portveröffentlichung: Der obige `docker run`-Befehl bindet
den Port ausdrücklich nur an `127.0.0.1` des Hosts
(`-p 127.0.0.1:8080:8080`), nicht an alle Schnittstellen.

Wird statt dessen `-p 8080:8080` verwendet (ohne die IP davor), ist die
Anwendung von jedem Gerät im selben Netz erreichbar — im Café- oder
Büro-WLAN kann dann jede und jeder dort die Deal-Historie lesen, den
Keepa-Key im Klartext auf der Einstellungsseite auslesen und selbst Deals in
die hinterlegten Discord-Channels posten.

Die Historie zeigt zu jedem Deal das Produktbild und lädt es direkt von
`m.media-amazon.com`. Sie braucht dafür Internet, und Amazon sieht, wann sie
geöffnet wird — das ist der einzige Zugriff auf einen fremden Server, den die
Oberfläche selbst auslöst. Deals ohne hinterlegte Bild-Kennung, also alles vor
diesem Stand Gepostete, zeigen wie bisher nur den Titel.

Soll die Anwendung dennoch aus der Ferne erreichbar sein, gehört zwingend
ein passwortgeschützter Reverse Proxy davor — niemals `-p 8080:8080` oder
`LUGRU_ADRESSE=0.0.0.0` ohne einen solchen Proxy.

## Datenbank-Upgrades

Bestehende Datenbanken werden beim Start automatisch und wiederholbar um
`quell_url`, `ek_art` und `bild_kennung` ergänzt. Das gilt sowohl für den
ursprünglichen Stand als auch für bereits verwendete Funnel- oder Bild-Versionen.

Die Tabellen `affiliate_tags`, `fba_klassen`, `fba_gebuehren` und
`deal_maerkte` entstehen beim Start ebenso von selbst. Sie sind neu und nicht
bloß zusätzliche Spalten, darum genügt für sie das gewöhnliche `CREATE TABLE
IF NOT EXISTS` — auch in einer Datei, die schon Deals enthält. `deal_maerkte`
trägt je gepostetem Deal und Zielmarkt eine eigene Zeile (Verkaufspreis,
Verkäufe, Provision, FBA-Gebühr, Gewinn, Marge und der Pan-EU-Vergleich, wo es
ihn gibt) und ergänzt damit `deals`, das weiterhin nur den Leitmarkt trägt.
Für Deals aus der Zeit vor dieser Änderung bleibt sie leer — die Historie
zeigt für sie wie bisher nur die eine Zeile aus `deals`. Die beiden
Tariftabellen werden danach einmalig aus Amazons Übersichten befüllt; die
Marke dafür steht als `versand.tarife_startbestueckung` in den
Einstellungen. Soll gar kein Tarif greifen, genügt es, die Tarifseite zu
leeren — sie füllt sich nicht wieder. Alte Deals behalten ihre Werte; ohne
frühere Angaben gelten leerer Einkaufslink, Brutto-Eingabe und kein
Produktbild.

## Entwicklung

Voraussetzung: Go 1.25 oder neuer (`go.mod` verlangt `go 1.25.0`).

    make test      # alle Tests
    make bau       # Binary für das eigene System
    make windows   # dist/lugru-deals.exe
    make linux     # dist/lugru-deals
    make docker    # Docker-Image lugru-deals:neu
