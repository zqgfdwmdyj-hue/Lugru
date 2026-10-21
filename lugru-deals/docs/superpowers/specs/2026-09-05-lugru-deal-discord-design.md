# Lugru Deal Discord — Design

Datum: 2026-09-05

Lokale Anwendung, die Amazon-Arbitrage-Deals nach Discord postet. Ersetzt das
bisherige Google Sheet, aus dem der Post-Text von Hand zusammengebaut wird.

## Zweck

Der Nutzer fügt einen Einkaufslink ein — eine Amazon-URL, den Link eines
beliebigen anderen Shops oder eine nackte ASIN. Die Anwendung holt Titel,
Preisverlauf, Verkaufszahlen und Gebühren aus Keepa, rechnet Gewinn und Marge,
rendert daraus den Discord-Post und sendet ihn samt Keepa-Preischart über einen
Webhook. Jeder Post landet in einer durchsuchbaren Historie.

Erfolgskriterium: Ein Deal, der heute mehrere Minuten Sheet-Arbeit kostet, ist
mit ASIN, Einkaufspreis und einer Notiz gepostet.

## Betrieb

Ein einzelnes Go-Binary. Auf Windows per Doppelklick, der Browser öffnet sich
auf `http://localhost:8080`. Dasselbe Binary läuft als Docker-Image.

Neben dem Binary liegen:

| Datei | Inhalt |
|---|---|
| `deals.db` | SQLite: Channels, Deals, Einstellungen, Keepa-Cache |
| `charts/` | Gespeicherte Chart-PNGs, ein Bild je gepostetem Deal |

Betriebseinstellungen kommen über Umgebungsvariablen und Kommandozeilen-Flaggen,
nicht über eine Konfigurationsdatei: Docker spricht Umgebungsvariablen ohnehin,
und eine eigene Datei bräuchte eine zusätzliche Abhängigkeit samt Parser, ohne
etwas zu können, was die vier Werte nicht auch so hergeben.

| Variable | Flagge | Vorgabe |
|---|---|---|
| `LUGRU_ADRESSE` | `-adresse` | `127.0.0.1:8080` |
| `LUGRU_DB` | `-db` | `deals.db` |
| `LUGRU_CHARTS` | `-charts` | `charts` |
| `LUGRU_BROWSER` | `-browser` | an |
| `KEEPA_API_KEY` | — | leer, sticht die Einstellung in der Oberfläche |

Der Server lauscht auf `127.0.0.1`, im Docker-Betrieb per `LUGRU_ADRESSE` auf
`0.0.0.0`. Keine Anmeldung — die Anwendung ist für den lokalen Einzelbetrieb
gedacht.

Der Keepa-API-Key steht in den Einstellungen und lässt sich per Umgebungs-
variable `KEEPA_API_KEY` überschreiben. Webhook-URLs sind Geheimnisse und
werden in der Oberfläche maskiert dargestellt.

## Ablauf

Der Weg zum Post ist ein Funnel aus vier Schritten. Jeder Schritt fragt genau
das ab, was der nächste braucht, und trägt alles bisher Gesammelte als
verborgene Felder weiter. Die Seite wird dabei nie verlassen: htmx tauscht nur
den Ausschnitt des jeweiligen Schritts aus.

```
1  Einkaufslink
   Amazon-URL, Link eines anderen Shops oder nackte ASIN
      ↓  Amazon-URL:    ASIN und Einkaufsland stehen fest, keine Rückfrage
      ↓  Fremdshop:     ASIN nachfragen, Einkaufsland aus der Endung
      ↓                 vorschlagen und bestätigen lassen
      ↓  nackte ASIN:   Einkaufsland nachfragen
2  Einkauf & Ziel
   Einkaufspreis eingeben — Schalter netto/brutto — plus Zielmarktplatz
      ↓  eine Keepa-Produktabfrage, nur Zielmarktplatz
      ↓  ein Chart-Bild vom Zielmarktplatz
3  Berechnung
   vorbefüllt: Titel · VK-Kandidaten · Sales · Provision · FBA
   daneben die Aufschlüsselung, die bei jeder Änderung live neu rechnet
      ↓  Titel kürzen, Zahlen prüfen
4  Vorschau
   fertiger Post samt Chart und Aufschlüsselung, Channel wählen
      ↓
Senden → Discord-Webhook → Zeile in der Historie
```

Zurück geht es aus jedem Schritt: der Zurück-Knopf ruft schlicht die Route des
vorherigen Schritts auf, mit allem, was das Formular gerade trägt. Der Weg
zurück aus Schritt 4 behält die von Hand geprüften Zahlen; vorwärts aus
Schritt 2 werden sie frisch von Keepa geholt, weil Verkaufspreis, Provision und
FBA immer nur für einen bestimmten Zielmarktplatz gelten.

Der Server hält dabei keinen Entwurf: der ganze Zustand steht im Formular. Ein
Neuladen der Seite beginnt darum sauber von vorn, und zwei Browserfenster
stören sich nicht gegenseitig.

### Einkauf außerhalb von Amazon

Verkauft wird immer bei Amazon, eingekauft nicht unbedingt. Führt der
Einkaufslink zu einem fremden Shop, fragt Schritt 1 die ASIN nach — ohne sie
gibt es weder Keepa-Daten noch einen Verkaufslink. Das Einkaufsland (DE/FR/IT/ES)
legt allein den Umsatzsteuersatz des Einkaufs fest und wird aus der Endung des
Shops **vorgeschlagen, nicht gesetzt**: die Auswahl steht sichtbar im Formular
und geht erst mit dem Weiter-Klick in die Rechnung — eine Shop-Endung belegt
nicht, welcher Satz für diesen Einkauf tatsächlich gilt. Wer außerhalb dieser
vier einkauft, gibt den Einkaufspreis in Schritt 2 netto ein, dann spielt der
Satz keine Rolle mehr. Im Post steht statt der Amazon-Produktseite der Link des
Shops, aus dem tatsächlich eingekauft wird.

ASIN und Einkaufsland gehören dabei immer zu genau einem Link: das Formular
trägt den Link mit, für den sie bestätigt wurden. Steht im Feld später ein
anderer, werden sie verworfen und erneut erfragt, statt den neuen Einkaufslink
mit dem Artikel des alten weiterlaufen zu lassen.

Der Link selbst wird für den Markdown-Linkkontext des Posts entschärft
(`[Shop](hier)`): Klammern, spitze Klammern und Leerzeichen werden
prozentkodiert. Ohne das beendet eine schließende Klammer in der Query den
Link vorzeitig, und ein zweiter, angehängter Link sähe aus, als wäre er
mitgeschickt worden. Der Link kommt von außen — er ist genau die Art Eingabe,
die jemand anderes vorgibt.

## Architektur

Serverseitig gerendertes HTML mit htmx für die dynamischen Teile. Kein
Build-Schritt, kein npm. Templates und CSS liegen per `embed.FS` im Binary.

| Paket | Aufgabe | Kennt nicht |
|---|---|---|
| `keepa` | HTTP-Client, API-Antwort → Produkt-Struct; Chart-Abruf | Deals, Discord, DB |
| `calc` | Reine Funktion: Deal-Eingaben → Gewinn, Marge | HTTP, DB, Templates |
| `post` | Post-Text rendern, ArbitrageOne-URL bauen | Discord, Keepa |
| `discord` | Webhook senden (multipart), Fehler klassifizieren | Deals, Keepa |
| `store` | SQLite-Zugriff, Chart-Dateien | HTTP |
| `web` | Handler, Formulare, Historie | Keepa/Discord direkt |

`calc` hat keine Abhängigkeiten und ist die am gründlichsten getestete Einheit —
dort steckt die Zahl, die im Post steht.

## Rechenkern

### Netto-Modus (Standard)

```
EK netto  = EK brutto / (1 + USt Quellland)
VK netto  = VK brutto / (1 + USt Zielland)
Provision = VK netto × referralFeePercentage / 100
FBA       = fbaFees.pickAndPackFee
Gewinn    = VK netto − EK netto − Provision − FBA
Marge     = Gewinn / VK brutto
```

Referenzfall (Makita HR2630, ES → DE):

```
207,49 / 1,19 = 174,36    VK netto
130,56 / 1,21 = 107,90    EK netto
174,36 × 15 % =  26,15    Provision
                  8,64    FBA
──────────────────────────────────
                 31,67 €  Gewinn
31,67 / 207,49 =  15,3 %  Marge
```

### Netto- oder Brutto-Eingabe (Schalter in Schritt 2)

Der Schalter sagt, welche der beiden Größen gerade eingegeben wird. Bei
`netto` wird der Bruttopreis mit dem Satz des Einkaufslands hochgerechnet
(`EK brutto = EK netto × (1 + USt Quellland)`), bei `brutto` der Nettopreis
heruntergerechnet. Im Post steht immer der Bruttopreis — das ist der Betrag,
den ein Leser im Shop bezahlt.

Der Schalter ist etwas anderes als der Vorsteuer-Modus darunter: der
beantwortet die davon unabhängige Frage, ob die Vorsteuer überhaupt abziehbar
ist. Beide zusammen ergeben die Größe, die als Kosten in den Gewinn eingeht —
`EK netto`, wenn die Vorsteuer abziehbar ist, sonst `EK brutto`.

### Brutto-Modus (Schalter pro Deal)

Der Schalter wirkt ausschließlich auf die EK-Seite: `EK netto := EK brutto`.
Der VK bleibt netto, weil die Umsatzsteuer daraus unabhängig vom Einkauf ans
Finanzamt geht. Derselbe Deal ergibt dann 9,01 € Gewinn bei 4,3 % Marge.

### Einstellungen zum Rechenkern

| Einstellung | Vorgabe |
|---|---|
| USt-Sätze | DE 19 %, FR 20 %, IT 22 %, ES 21 % |
| Margenbasis | VK brutto (Alternative: VK netto) |
| Standard-Provision | 15 % |
| Standard-FBA-Gebühr | konfigurierbar, kein sinnvoller Vorgabewert |
| Vorsteuer-Modus | netto |

Rundung: Ein- und Ausgabewerte sind Ganzzahlen in Cent. Innerhalb einer
Berechnung wird mit voller Genauigkeit gerechnet und erst das Endergebnis auf
Cent gerundet — sonst summieren sich die Rundungsfehler aus drei Divisionen zu
einer sichtbaren Abweichung im Post.

## Keepa-Anbindung

### Produktabfrage

```
GET https://api.keepa.com/product?key=…&domain=3&asin=…&stats=90&history=1
```

Eine Abfrage pro Deal, nur der Zielmarktplatz. Der Quellmarktplatz wird nicht
abgefragt — der Einkaufspreis stammt aus dem Warenkorb und enthält Mengen-
rabatte, die in Keepa nicht abgebildet sind.

Preise kommen als Ganzzahl in Cent. **`-1` bedeutet „kein Wert" und muss überall
als *fehlend* durchgereicht werden**, nie als 0 € oder −0,01 €.

### Feld-Zuordnung

Verifiziert gegen [`Product.java`](https://github.com/keepacom/api_backend/blob/master/src/main/java/com/keepa/api/backend/structs/Product.java)
und [`Stats.java`](https://github.com/keepacom/api_backend/blob/master/src/main/java/com/keepa/api/backend/structs/Stats.java).

| Formularfeld | Keepa-Feld | Wenn nicht vorhanden |
|---|---|---|
| Titel | `title` | Abbruch mit Meldung |
| VK · Ø 90 Tage Buy Box | `stats.avg90[18]` | Option ausgegraut |
| VK · Median 90 Tage | selbst gerechnet aus `csv[18]` | Option ausgegraut |
| VK · Buy Box aktuell | `stats.current[18]` | Option ausgegraut |
| VK · Amazon aktuell | `stats.current[0]` | Option ausgegraut |
| Sales | `monthlySold` (0 = nicht gesetzt) | → `stats.salesRankDrops30`, sonst leer |
| Provision | `referralFeePercentage` (Double) | → Standardwert |
| FBA-Gebühr | `fbaFees.pickAndPackFee` | → Standardwert |

Vorausgewählt ist Ø 90 Tage Buy Box; kennt Keepa sie für diesen Markt nicht,
rückt der erste vorhandene Kandidat nach. Sind alle VK-Kandidaten leer, bleibt
das Feld leer — es wird kein Wert erfunden. Dasselbe gilt für die
Verkaufszahl: kennt Keepa keine, bleibt das Feld leer statt auf 0 zu stehen,
und der Post lässt sich erst absenden, wenn eine Zahl eingetragen ist.

Alle diese Werte gelten immer nur für einen bestimmten Artikel auf einem
bestimmten Zielmarktplatz. Ein frischer Aufruf räumt sie darum vorher weg,
statt sie nur zu überschreiben — sonst bliebe beim Wechsel des Zielmarktplatzes
der Preis des vorigen stehen, wenn Keepa für den neuen keinen liefert.
Erhalten bleiben sie allein auf dem unveränderten Rückweg aus Schritt 4.

`referralFeePercent` ist in der API als deprecated markiert und wird nicht
benutzt.

**Median:** Keepa liefert nur Durchschnitte. Der Median wird aus dem
Rohverlauf `csv[18]` selbst berechnet, zeitgewichtet — sonst verzerren kurze
Preisausreißer das Ergebnis.

### Marktplätze

Datengetrieben, keine Sonderfälle im Code. Zwei verschiedene Schreibweisen, die
nicht verwechselt werden dürfen:

| Markt | `domain` (Produkt-API) | `domain` (Chart) | USt | Host |
|---|---|---|---|---|
| DE | 3 | `de` | 19 % | amazon.de |
| FR | 4 | `fr` | 20 % | amazon.fr |
| IT | 8 | `it` | 22 % | amazon.it |
| ES | 9 | `es` | 21 % | amazon.es |

Alle vier in Euro, keine Währungsumrechnung.

### Token

Jede Antwort enthält `tokensLeft` und `tokensConsumed`; beides steht dauerhaft
in der Kopfzeile der Oberfläche. Ist das Kontingent erschöpft, nennt die
Anwendung die Wartezeit aus `refillIn`.

### Cache

Dieselbe ASIN auf demselben Marktplatz wird 30 Minuten lang nicht erneut
abgefragt. Ein „Neu laden"-Knopf umgeht den Cache bewusst.

### Eingabe-Erkennung

Erkannt werden `/dp/ASIN`, `/gp/product/ASIN`, ASIN mit Query-Anhang und eine
nackte ASIN. Der Host bestimmt den Quellmarktplatz. Bei einer nackten ASIN
fragt die Anwendung nach dem Einkaufsland, statt zu raten.

Eine ASIN im Pfad zählt nur als vollständiges Segment: `/product/1234567890123`
ist eine 13-stellige Artikelnummer und keine ASIN `1234567890`. Auf einem
Fremdshop gilt zudem allein die Amazon-eigene Linkform (`/dp/`, `/gp/product/`,
`/gp/aw/d/`) — `/product/` benutzen auch beliebige andere Shops, und dort steht
deren eigene Nummer. Eine geratene ASIN ist schlimmer als eine gestellte Frage.

Jeder andere Host gilt als Fremdshop und ist kein Fehler, sondern der zweite
vorgesehene Weg in den Funnel — auch ein Amazon-Marktplatz, der nicht in der
Tabelle steht (amazon.co.uk etwa); dessen Produktpfad trägt die ASIN dann
trotzdem und wird mitgenommen. Erlaubt sind nur `http` und `https`: ein
`javascript:`-Link darf nie bis in den Discord-Post durchrutschen, wo ihn keine
Vorlage mehr entschärfen kann.

## Chart-Bild

### Abruf

```
GET https://graph.keepa.com/pricehistory.png
    ?asin=…&domain=de&range=90&bb=1&amazon=1&new=1&width=800&height=350
```

Kein API-Key, kein Token-Verbrauch. Live geprüft: liefert HTTP 200 und ein
gültiges PNG; `range`, `width`, `height`, `domain` und `bb` wirken nachweislich.

Der Chart zeigt den **Zielmarktplatz** mit eingeblendeter Buy-Box-Kurve — also
genau der Reihe, aus der der VK-Vorschlag stammt. Zeitraum, Kurven und Bildgröße
liegen in den Einstellungen.

Falls Keepa den freien Endpunkt irgendwann sperrt, lässt sich in den
Einstellungen auf den offiziellen, token-pflichtigen `api.keepa.com/graphimage`
umschalten. Der Endpunkt existiert (geprüft: antwortet ohne Key mit
`invalidParameter`), kostet aber Token.

### Einbindung in den Post

Das PNG wird als **Datei-Anhang** hochgeladen, nicht verlinkt. Der Post ist
damit dauerhaft und unabhängig von Keepas Verfügbarkeit, und der Post-Text
bleibt unverändert im bisherigen Format.

Versand als `multipart/form-data` an den Webhook: Feld `payload_json` mit
`content` und `allowed_mentions`, Feld `files[0]` mit dem PNG.

Kein Discord-Embed: Mentions in Embeds lösen keine Benachrichtigung aus, ein
`@everyone` würde dort niemanden pingen.

### Speicherung

Das PNG wird unter `charts/<asin>-<zeitstempel>.png` abgelegt, damit die
Historie den Chart von damals zeigt und nicht den heutigen Stand. Bewusst nicht
nach Deal-ID benannt: die entsteht erst beim Einfügen in die Datenbank, und das
passiert erst, nachdem Discord das Senden bestätigt hat.

### Fehlerfall

Lässt sich der Chart nicht laden, erscheint das in der Vorschau *vor* dem
Senden. Der Nutzer entscheidet, ob der Post ohne Bild rausgeht.

## Post-Aufbau

### Vorlage

Das Format liegt als Go-Template in den Einstellungen, vorbelegt mit dem
bisherigen Schema.

> **Nachtrag (Aufgabe „mehrere Zielmärkte"):** Die drei Zeilen VK/Sales/Gewinn
> galten ursprünglich einem einzigen Zielmarkt. Seit ein Deal mehrere
> Zielmärkte tragen kann, ersetzt `post.MaerkteZeilen` sie durch einen Block,
> der für jeden gewählten Markt genau eine Zeile schreibt — auch bei nur
> einem Markt. Die flachen Felder (`.Zielmarkt`, `.VK`, `.Sales`, `.Gewinn`,
> `.Marge`, …) bleiben in `post.Daten` bestehen und tragen weiterhin die
> Zahlen des Leitmarkts: `Render` läuft mit `missingkey=error`, ein
> entferntes Feld ließe jede gespeicherte Vorlage schlagartig nicht mehr
> rendern. Aktuelles Format (`post.StandardVorlage`, siehe
> `internal/post/render.go`):
>
> ```
> 🛒 {{.Titel}} {{.ASIN}} {{.Mention}}
> 🏬 [{{.EKHost}}]({{.EKUrl}})
> 💰 EK: {{.EK}} {{.EKNotiz}}
> {{range .Maerkte}}💸 [Amazon.{{.Code}}]({{.VKUrl}}): {{.VK}} · {{.Sales}} Verk. · 🤑 {{.Gewinn}} / {{.Marge}}{{if .GewinnPanEU}} · 🇪🇺 Pan-EU {{.GewinnPanEU}} / {{.MargePanEU}}{{end}}
> {{end}}:bar_chart: [ArbitrageOne Export]({{.AOUrl}})
> ```

Der ursprünglich geplante Stand, gegen den diese Spezifikation entworfen
wurde:

```
🛒 {{.Titel}} {{.ASIN}} {{.Mention}}
🏬 [{{.EKHost}}]({{.EKUrl}})
💰 EK: {{.EK}} {{.EKNotiz}}
💸 VK: {{.VK}}  [Amazon.{{.Zielmarkt}}]({{.VKUrl}})
ℹ️ Amazon.{{.Zielmarkt}}: {{.Sales}} Verkäufe
🤑 Gewinn: {{.Gewinn}} / {{.Marge}} Marge
:bar_chart: [ArbitrageOne Export]({{.AOUrl}})
```

Beim Speichern wird die Vorlage geprüft und probeweise gerendert. Schlägt das
fehl, bleibt die zuletzt funktionierende Vorlage aktiv.

Daneben steht eine Live-Vorschau mit echten Deal-Daten.

### Zahlenformatierung

Zwei getrennte Formatierungen, die nicht vermischt werden dürfen:

- **Anzeige und Post:** deutsches Format mit Komma — `130,56 €`
- **ArbitrageOne-URL:** Dezimalpunkt — `sell_price=207.49`

Der bisherige Post mischt beides (`130.56 €` neben `31,67 €`); die Anwendung
vereinheitlicht auf Komma.

### ArbitrageOne-URL

```
https://app.arbitrageone.de/analyze
  ?via=fbaresell
  &asin=<ASIN>
  &sell_price=<VK brutto, Punkt>
  &source_price=<EK brutto, Punkt>
  &source_price_calculated_net=<EK netto im Netto-Modus, sonst 0>
  &estimated_sales=<Sales>
  &target_marketplace=<DE|FR|IT|ES>
  &source_url=<EK-URL, prozentkodiert>
```

`via=fbaresell` ist fest. `source_price_calculated_net` trägt im Netto-Modus
den heruntergerechneten EK, im Brutto-Modus `0`.

### Marktplatz-Links

Aus ASIN und Marktplatz erzeugt: `https://www.amazon.<tld>/dp/<ASIN>`.

## Oberfläche

**Neuer Deal.** Der Funnel aus vier Schritten (siehe *Ablauf*), mit einer
Fortschrittsanzeige über dem jeweils aktuellen Schritt. In Schritt 3 steht
links das vorbefüllte Formular und rechts die Aufschlüsselung samt Chart; jede
Änderung rechnet die Aufschlüsselung live neu, ohne die Seite zu verlassen und
ohne den Chart erneut zu holen. Jedes automatisch befüllte Feld trägt eine
Herkunftsangabe (`Keepa` / `Standardwert` / `von dir`), damit erkennbar bleibt,
welche Zahl geschätzt ist.

Die Aufschlüsselung nennt jeden Zwischenschritt, aus dem der Gewinn entsteht —
Einkauf brutto abzüglich Vorsteuer, Verkaufspreis abzüglich Umsatzsteuer,
Provision, FBA — statt nur das Ergebnis. Sie entsteht in Go aus genau einem
`calc.Ergebnis`, damit keine Vorlage sich eine Zahl selbst zusammenrechnet.

In Schritt 4 baut jede Änderung der Channel-Auswahl den Post neu: die
Erwähnung (`@everyone`, `@here`, eine Rolle) hängt am Channel und steht damit
im Text. Ohne das zeigte die Vorschau einen Post ohne Erwähnung, während
gesendet einer mit ihr würde — der gezeigte wäre nicht der gesendete.

Die EK-Notiz ist ein Freitextfeld mit Vorschlägen aus bereits benutzten Notizen
(`SELECT DISTINCT ek_notiz FROM deals`) — keine eigene Pflege nötig.

**Historie.** Tabelle aller Posts, durchsuchbar nach ASIN, Titel, Channel und
Zeitraum. Jede Zeile klappt den exakt gesendeten Text auf, samt der damals
verwendeten Zahlen und dem gespeicherten Chart.

**Channels.** Name, Webhook-URL (maskiert), Mention-Einstellung
(keine / `@everyone` / `@here` / Rolle), Testknopf.

**Einstellungen.** Keepa-Key, Post-Vorlage mit Vorschau, USt-Sätze,
Standard-Provision und -FBA, Margenbasis, Chart-Parameter, Standard-Zielmarkt.

## Datenmodell

```
channels   id, name, webhook_url, mention_typ, rollen_id, aktiv, angelegt_am

deals      id, asin, titel,
           quellmarkt, quell_url, zielmarkt,
           ek_cent, ek_art, ek_notiz, vk_cent, vk_quelle,
           sales, sales_quelle,
           provision_prozent, provision_quelle,
           fba_cent, fba_quelle,
           ust_modus, gewinn_cent, marge_prozent,
           channel_id, nachricht_text, chart_datei,
           gepostet_am, discord_nachricht_id

settings   schluessel, wert

keepa_cache  asin, domain_id, geholt_am, antwort_json
```

`quell_url` steht nur bei einem Einkauf außerhalb von Amazon; dort ist der Link
die einzige Angabe, die den Einkauf wiederfindbar macht, während er sich bei
Amazon aus Quellmarkt und ASIN ergibt. `ek_art` hält fest, ob der Preis netto
oder brutto eingegeben wurde — `ek_cent` ist immer der Bruttopreis, damit die
Historie Zeile für Zeile vergleichbar bleibt.

Beide Spalten sind nach der ersten Auslieferung dazugekommen. `CREATE TABLE IF
NOT EXISTS` erreicht eine bestehende Datei nicht, darum ergänzt `store.Open` sie
zusätzlich per `ALTER TABLE`, wenn `pragma_table_info` sie vermisst — genauso
wiederholbar wie der Rest des Schemas, ein Migrationszähler bleibt entbehrlich.

Die `*_quelle`-Spalten halten fest, ob ein Wert von Keepa, aus einem
Standardwert oder von Hand kam. Sie speisen die Herkunftsangaben im Formular und
machen alte Posts nachvollziehbar.

Index auf `deals(asin)` — auch ohne Duplikat-Warnung, damit die Suche schnell
bleibt und die Warnung später ohne Umbau nachrüstbar ist.

`discord_nachricht_id` wird gefüllt (der Webhook wird mit `?wait=true`
aufgerufen), aber vorerst nicht benutzt. Es kostet nichts und ist die einzige
Angabe, die sich später nicht nachträglich beschaffen lässt, falls nachträgliches
Bearbeiten doch einmal gebraucht wird.

## Fehlerbehandlung

| Fall | Verhalten |
|---|---|
| Einkaufslink ohne ASIN | Schritt 1 fragt die ASIN nach, statt abzulehnen |
| ASIN unbekannt / Keepa 404 | Meldung am Eingabefeld, Formular bleibt leer |
| Keepa-Token erschöpft | Wartezeit aus `refillIn` anzeigen, manuelle Eingabe möglich |
| Keepa nicht erreichbar | Fehler nennen, manuelle Eingabe möglich |
| Chart nicht ladbar | In der Vorschau anzeigen, Nutzer entscheidet |
| Webhook tot (401/404) | Channel als defekt markieren, Deal **nicht** als gepostet speichern |
| Discord 429 | Einmal nach der genannten Wartezeit wiederholen, dann aufgeben |
| Discord 5xx | Zwei Wiederholungen, dann Fehler mit „erneut senden" |
| Nachricht über 2000 Zeichen | Vor dem Senden abfangen, Vorlage prüfen lassen |

Ein Deal landet nur in der Historie, wenn Discord das Senden bestätigt hat.
Lieber ein verlorener Entwurf als ein Eintrag, der fälschlich behauptet,
gepostet worden zu sein.

**Mentions werden immer explizit begrenzt.** Bei jedem Senden setzt die
Anwendung `allowed_mentions` passend zur Channel-Einstellung. Ein Testchannel
kann dann selbst dann niemanden anpingen, wenn `@everyone` in der Vorlage steht.

## Tests

Alle ohne echte API-Aufrufe.

| Einheit | Prüfung |
|---|---|
| `calc` | Tabellentests; Makita-Referenzfall auf den Cent; Netto- und Brutto-Modus; Netto- und Brutto-Eingabe; fehlende Gebühren; Nullpreise; beide Margenbasen |
| `keepa` | Zuordnung gegen eine gespeicherte echte API-Antwort, inklusive `-1`-Feldern und fehlendem `monthlySold`; Median-Berechnung gegen einen von Hand gerechneten Verlauf |
| URL-Parser | Alle Amazon-Linkformen der vier Marktplätze, nackte ASIN, Fremdshop-Links, ungültige Eingaben |
| `web` | Jeder Funnel-Schritt über seine echte Route; die Formulare tragen alle Felder, die der nächste Schritt liest |
| `post` | Vorlage und ArbitrageOne-URL gegen den erwarteten Text des Referenz-Deals; Komma- und Punkt-Formatierung |
| `discord` | Fehlerbehandlung und multipart-Aufbau gegen einen lokalen Test-Server |

## Bewusst nicht enthalten

- **Duplikat-Warnung beim Eingeben einer bereits geposteten ASIN.** Der Index
  liegt bereits, die Ergänzung wäre später klein.
- **Posten in mehrere Channels gleichzeitig** und zeitversetztes Posten.
- **Nachträgliches Bearbeiten oder Löschen** gesendeter Discord-Nachrichten.
- **Keepa-Abfrage des Quellmarktplatzes** — Cart-Preise stehen dort ohnehin nicht.
- **Anmeldung.** Nachzurüsten, falls die Anwendung je im Netz stehen soll.
