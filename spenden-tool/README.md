# Spenden-Tool

Eigenständige Web-App für die Lebensmittelverteilung (Foodsharing). Sie ist unabhängig vom
Seller-Tool und hat eigene Datenbank, eigenen Login und eigenen Start.

## Was es kann

- **Produktdatenbank:** wiederkehrende Spendenprodukte mit Foto, Kategorie und dem zuletzt verwendeten
  Preis, dazu der Verlauf, wann ein Produkt zu welchem Preis dabei war.
- **Verteilungen:** gegliedert nach Arbeitsablauf in die Reiter **Produkte** (hinzufügen per Fotos, aus der
  Datenbank oder manuell; schlanke Liste mit Suche, Kategorie- und Prüfstatus-Filter, „Details bearbeiten“ und
  Stapelaktionen für Kategorie, Collage/Aushang, MHD und KI), **Prüfen** (Preiswidersprüche mit Foto daneben,
  unbestätigte Preise und KI-Angaben, nicht vergleichbare Packungsgrößen, Kategorien, fehlende Angaben),
  **Ausgabe** (Collage, Aushang, Messenger-Text, Social Media, Ideen – mit Hinweis auf offene Punkte vor dem
  Export) und **Einstellungen** (Datum, Ort, Überschrift, interne Notiz). Speicherstand ist immer unten sichtbar;
  Änderungen werden zeilenweise automatisch gespeichert. „Letzte übernehmen“ auf der Startseite legt die nächste
  Verteilung mit allen Produkten und Preisen an.
- **Eine Preislogik für alles:** Collage, Aushang, Messenger und Social Media geben immer die eingetragene
  Spendenempfehlung mit ihrer **Abgabeeinheit** aus (Einzelstück, Mehrfachpackung mit Stückzahl, Karton). Preise aus
  dem Foto oder von der KI sind zunächst „unbestätigt“ und überschreiben nie einen eingetragenen Preis.
- **Vorder- und Rückseite:** Rückseiten werden kein eigenes Produkt, sondern Infofoto (Zutaten, Gewicht, MHD) –
  nie auf Collage oder Social Media; die KI-Erkennung nutzt sie mit. Drei Wege: beim Hochladen „Vorder- und
  Rückseite abwechselnd“ (jedes zweite Foto ist die Rückseite des vorherigen), unter „Prüfen“ → „Mögliche
  Rückseiten“ (gleicher/enthaltener Name, gleiche Größe; nur auf Klick) oder zwei Produkte auswählen → „Zu einem
  Produkt (Rückseite)“. Auf der Produktseite lassen sich Infofotos zum Hauptfoto machen oder entfernen.
- **Fotos drehen:** ↺ / ↻ unter jedem Foto in der Produktliste, auf der Produktseite und im Collage-Editor. Das
  gespeicherte Foto wird gedreht und gilt damit überall (Collage, Social Media, KI).
- **Doppelte Fotos:** Jedes Foto bekommt einen Fingerabdruck. Dasselbe Foto wird wiedererkannt – auch verkleinert,
  neu gespeichert, per WhatsApp verschickt oder als PNG/HEIC – und weder doppelt angelegt noch doppelt von der KI
  ausgewertet. Nur ähnliche Fotos werden nicht automatisch zusammengelegt, sondern unter Produkte → „Mögliche
  Doppelte“ zum Prüfen und Zusammenführen angezeigt (dort auch Doppelte aus der Zeit vor dieser Funktion).
- **KI-Preisrecherche (Claude):** erkennt das Produkt auf dem Foto, trägt fehlende Namen ein und sucht
  den günstigsten aktuellen Preis bei deutschen Händlern, mit Links. Daraus wird ein Spendenpreis
  vorgeschlagen (Standard: 25 % vom günstigsten Preis). Das läuft im Hintergrund.
- **Collage:** Bilder zum Teilen im Messenger; alle Bilder auf einmal als eine PDF-Datei (Seite für Seite). Das Raster passt sich an, die Anzahl pro Bild ist
  einstellbar (4 bis 20), in den Formaten 4:5, 9:16, 1:1 oder A4. Der Preis steht auf dem Foto. Auf ein Produkt
  in der Collage tippen, um Name, Preis und Zusatztext einzeln ein- oder auszuschalten, das Foto zu drehen und Lage
  (9 Stellen) und Farbe des Preises festzulegen – das gilt für dieses Produkt auch
  bei späteren Verteilungen („Automatisch“ setzt es zurück, „Für alle Bilder“ übernimmt es für die ganze Collage).
- **Aushang:** A4 „Unsere Spendenempfehlungen“, die Schrift passt sich automatisch der Seite an.
- **Messenger-Text:** dieselbe Liste als Text zum Kopieren.
- **MHD-Foto:** pro Produkt ein Foto vom aufgedruckten Datum – die KI liest es ab und trägt es ein
  (Claude Haiku, ohne Websuche, Bruchteil eines Cents). Das Foto wird getrennt gespeichert und erscheint
  nie auf Collage oder Social Media.
- **Alte Fotos mit Preis darauf** (z. B. aus früheren Collagen): Wird bei jedem neuen Foto automatisch geprüft, ebenso
  beim Start der KI-Preissuche; für schon vorhandene Fotos zeigt die Verteilungsseite „Preise aus Fotos lesen“. Die KI (Claude Haiku, ca. 0,2 Cent je Foto)
  liest den Preis ab und trägt ihn dort „unbestätigt“ ein, wo noch keiner steht. Stimmt er mit dem eingetragenen
  überein, druckt die Collage keinen zweiten. Weicht er ab, erscheint unter „Prüfen“ ein Widerspruch mit Foto und
  drei Möglichkeiten: „Eingetragenen Preis bestätigen“ (die Collage setzt ihn als kleines Feld genau über den alten
  Preis), „Fotopreis übernehmen“ oder „Erkennung falsch“. Bis dahin gilt der eingetragene Preis.
- **Kategorien:** Neue Fotos landen in „Noch zuordnen“; die KI darf diese Kategorie ersetzen, bestätigte
  Kategorien nicht. Abweichende KI-Vorschläge stehen unter „Prüfen“ zum einzelnen Übernehmen.
- **MHD nur wo nötig:** pro Produkt „automatisch“, „ja“ oder „nein“. Automatisch nach Produktart: Spielzeug,
  Schwimmhilfen, Babyzubehör (Flaschen, Sauger, Windeln) und Haushaltswaren nie – auch wenn sie falsch unter
  „Lebensmittel“ stehen. Babyprodukte, die als Nahrung erkannt werden (Brei, Gläschen, Dessert, Snack, HiPP …), brauchen
  eins; ist unklar, ob Nahrung oder Zubehör, erscheint „MHD-Relevanz prüfen“ (zählt bis dahin als „MHD nötig“).
- **Kategorie-Auffälligkeiten:** z. B. Gewürze unter „Drogerie & Haushalt“ oder ein Schwimmsitz unter
  „Lebensmittel“ erscheinen als offener Punkt; geändert wird erst mit „Übernehmen“, „Stimmt so“ blendet sie aus.
- **Abgabeeinheit getrennt vom Preis bestätigen:** Vorschläge nur aus eindeutigen Angaben („6er-Pack“,
  „6 x 125 g“, „10 Stück“) – nie aus Maßen, Gewichten, Altersangaben oder Modellnummern. Unter „Prüfen“ lassen
  sich alle offenen Einheiten auf einmal bestätigen.
- **Nie zwei Preise auf einem Bild:** Steht derselbe Preis im Foto, wird keiner dazugedruckt; ein abweichender wird
  gezielt überklebt – oder, wenn seine Lage unbekannt ist, verlangt das Tool ein Foto ohne Preis. Noch nicht
  geprüfte Fotos – und solche, bei denen der ältere Leser nichts gefunden hat – werden beim Öffnen von
  Collage/Social Media automatisch (neu) gelesen. Übersieht die Erkennung einen Preis trotzdem: in der Collage aufs
  Bild tippen → „Preis steht schon im Foto“ (oder in den Produktdetails von Hand eintragen).
- **Interne KI-Hinweise** („Marke nicht identifiziert“, „genaue Packungsgröße unbekannt“) erscheinen nie in den
  Ausgaben; unter „Prüfen“ lassen sie sich in die interne Notiz verschieben. B-Ware zählt nicht als Vergleichspreis.
- **Ideen (✨):** Die KI liest die Produkte einer Verteilung und schlägt Themenpakete (z. B. Halloween, Winter,
  Frühstück) mit Gesamtpreis, Rezepte aus den vorhandenen Sachen, einen fertigen Werbetext und Tipps fürs Team vor.
  Themen per Klick oder eigener Wunsch; Claude Sonnet, ca. 3–5 Cent je Durchlauf. Ergebnisse bleiben gespeichert.
  Auswahl „Alles“, „Rezept-Ideen“ (5–8 Rezepte) oder „Verwendungs-Ideen“ (wofür man jedes Produkt nutzen kann).
  Dazu ein **Plakat** (A4, als Bild oder PDF) mit Fotos, „Einzeln“ und Packungs-Spendenempfehlung – die KI wählt Thema,
  Texte und Produkte, Fotos und Beträge kommen aus der Verteilung. Das Wort „Preis“ verwendet die KI nicht.
- **Ganze Packung / Karton / Kasten:** Art (Karton, Kasten, Packung, Tray, Palette) und Anzahl darin – bei
  Getränken Flaschen je Kasten und Inhalt je Flasche („Kasten (12 × 0,5 l) 4 €“). Vorschlag: 20 % vom Handelspreis
  der ganzen Packung (PACKUNG_ANTEIL), bei Getränken der normale Anteil. Die KI-Preissuche nennt immer den Preis des
  ganzen Angebots (Kasten, Sixpack) und die Anzahl darin – nie den Liter- oder Kilopreis.
- **Kategorien:** Babyprodukte, Lebensmittel, Süßes & Snacks, Getränke, Tee & Nahrungsergänzung, Drogerie (inkl.
  Haut- und Haarpflege), Haushalt, Spielzeug, Sonstiges – in dieser Reihenfolge im Aushang. Die alten Kategorien
  „Drogerie & Haushalt“, „Hautpflege“ und „Haarpflege“ werden nicht mehr angeboten und nicht automatisch verschoben.
  Erkannt wird nach Produktart vor Geschmack: „Powerade Golden Mango“ bleibt Getränk, „Trinkschokoladenpulver“
  Lebensmittel, „Mango Chutney“ wird nicht wegen „Mango“ umsortiert.
- **Kategorie prüfen (Produktdatenbank):** Produkte → „Kategorie prüfen“ listet alle Produkte mit unpassender oder
  alter Kategorie – auch solche, die nie in einer Verteilung waren (z. B. Bitzee unter Lebensmittel). Je Produkt
  „Übernehmen“ oder „Stimmt so“; nichts wird automatisch geändert.
  Alte Sammelkategorien („Drogerie & Haushalt“, „Hautpflege“, „Haarpflege“) lassen sich dort mit einem Klick
  auflösen (Vorschau, wohin wie viele gehen: nach Produktart, KI-Erkennung, sonst „Drogerie“).
- **Mehrere Fotos je Produkt:** Beim Hochladen „Alle ausgewählten Fotos sind ein Produkt“ – die KI nimmt die
  Vorderseite als Titelbild, die übrigen werden Infofotos. Nachträglich: in den Produktdetails bzw. auf der
  Produktseite „Weitere Fotos hinzufügen“ – es entsteht kein neuer Artikel. Auch „Neues Produkt“ nimmt mehrere
  Fotos; ohne Namen erkennt die KI das Produkt. Danach öffnet sich gleich die Kartei zum Kontrollieren (ebenso nach
  dem Hochladen eines einzelnen Fotos). Die gewählte Upload-Art merkt sich das Gerät.
- **Produktkartei „Für Verteilungen“:** dieselben Felder wie in den Details der Produktliste (Abgabeeinheit, Inhalt,
  Text vor dem Preis, Varianten, Text auf dem Bild, Collage/Aushang, dazu Bestand und MHD der kommenden Verteilung).
  Gespeichert als Vorlage am Produkt und sofort in alle kommenden Verteilungen übernommen; Änderungen in der
  Produktliste halten die Vorlage aktuell.
- **Fotoregel:** jedes Produkt einzeln fotografieren, Vorder- und Rückseite (bzw. Unterseite mit MHD). Sieht die KI
  mehrere verschiedene Produkte auf einem Foto, erscheint „Mehrere Produkte im Foto“ mit der Bitte, einzeln neu zu
  fotografieren.
- **KI nach dem Hochladen (Verwaltung):** erkennt jedes neue Produkt selbst und füllt Name, Größe, Kategorie, MHD
  und einen Preisvorschlag aus – der Preis gilt als „unbestätigt“, bis jemand kontrolliert. Stufe wählbar oder aus;
  Standard ist die KI_MODUS-Stufe.
- **Abgabeeinheit Kasten, Tray, Palette:** Für Getränke (und alles, was nur im Ganzen abgegeben wird) gilt der Preis
  direkt für das Gebinde – kein Flaschenpreis nötig. Ausgabe z. B. „Kasten (20 × 0,5 l) 4 €“. Getränke bekommen
  „Kasten“ als Vorschlag; der KI-Vorschlag rechnet mit der Flaschenzahl des Kastens.
- **Inhalt / Menge (optional):** am Produkt, z. B. „1,5 kg“ oder „0,5 l“ – steht in Collage, Aushang und Messenger
  automatisch vor dem Preis („1,5 kg 10 €“, bei Packungen „6 × 0,5 l 3 €“). Vorschlag aus der Variante mit einem
  Klick bzw. als Stapelaktion „Inhalt aus Variante“; ein eigener Text vor dem Preis hat Vorrang.
- **Varianten:** neben dem Einzelpreis beliebig viele Varianten mit eigener Empfehlung (Packung, Karton, Kasten,
  Tray, Palette – „+ weitere Variante“). Erscheinen in Collage (höchstens zwei Zeilen), Aushang, Messenger und Ideen.
  Abgabeeinheit und Varianten werden beim nächsten Hinzufügen des Produkts übernommen.
- **Preis nach Bestand:** Ist viel da (Palette, Kartons), schlägt die Liste einen günstigeren Preis vor (Palette
  60 %, ½ Palette 70 %, ¼ Palette 80 %, Kartons 90 %) – Übernahme nur auf Klick.
- **MHD automatisch bei Lebensmitteln:** Nach der KI-Erkennung bzw. beim Hochladen mit Rückseite liest die KI das
  Datum von den Fotos (zuerst Rückseiten); markiert als „automatisch gelesen – bitte prüfen“. Unter „Prüfen“ auch
  von Hand startbar. In den Produktdetails steht das MHD-Datum direkt unter „MHD nötig?“ („✓ MHD stimmt“ oder
  korrigieren); in der Produktzeile steht „MHD 12.10.26“ bzw. „MHD fehlt“, auf der Produktseite das letzte MHD.
- **Bestand (ca.) und Ergebnis:** pro Produkt „1 Palette / ½ / ¼ Palette / mehrere Kartons / Einzelprodukt / wenige
  Reste“ und nach der Verteilung „alles weg / wenig übrig / viel übrig“. Für vergangene Verteilungen gibt es den
  Reiter „Ergebnisse“ (ein Tipp je Produkt) und einen Hinweis auf der Startseite. „Noch offen“ (keine Rückmeldung)
  zählt nicht als „viel übrig“. Beim Kopieren einer Verteilung werden Bestand, Ergebnisse und MHD nicht übernommen.
- **Statistik:** Renner und Ladenhüter (Anteil plus Anzahl der Ergebnisse), Kategorien nach Jahreszeit, am häufigsten
  dabei – je Jahr oder gesamt. Gezählt werden Produktangebote (Einträge), keine abgegebenen Stückzahlen.
- **Farbsystem:** Produkte blau, Prüfen bernstein, Ausgabe violett, Ergebnisse türkis – für aktive Reiter,
  Bereichsüberschriften und Hauptaktionen. Status immer mit Farbe, Symbol und Text: ✓ grün (ok/alles weg),
  ! bernstein (prüfen/wenig übrig), ✕ rot-koralle (Fehler/viel übrig), ○ grau (offen). Fließtext 16 px,
  Nebenangaben mindestens 14 px, Knöpfe auf dem Handy mindestens 44 px hoch.
- **Prüfen in drei Stufen:** ① Zuerst klären (Preiswiderspruch, alter Fotopreis, Rückseite, ohne Preis/Namen,
  mehrere Produkte im Foto), ② Prüfen (unbestätigt, Vergleich, KI-Angaben, Einheit, MHD, Kategorie), ③ Optional
  (interne Hinweise, ohne Foto). MHD-Hinweise in einem Block. „Je Produkt“: ein Satz Zusammenfassung, aufklappbar.
- **Ergebnisliste:** Suche, Kategorie und Status (offen/erfasst/je Ergebnis) kombinierbar, Fortschritt und Filter
  bleiben beim Scrollen oben. Ein Tipp speichert sofort, „↺ zurücksetzen“ macht es rückgängig. „✕ Filter
  zurücksetzen“ löscht Suche, Kategorie und Status auf einmal. Reiter-Zähler: „Prüfen 79 offen“, „Ergebnisse 0/79“.
- **Startseite:** je Verteilung eine Hauptaktion nach Stand (Fotos hochladen → Prüfen → Ausgabe → Ergebnisse),
  Nachbereitung und Archiv kompakt.
- **Export ohne Blockieren:** Collage, PDF und Social-Media-Bilder zeigen offene Punkte als Hinweis auf der Seite
  (kein Browser-Dialog), dazu Fortschritt, „Abbrechen“ und eine verständliche Fehlermeldung.
- **Social Media:** Story (9:16), Feed-Titelbild (4:5), Karussell (ein Produkt pro Bild), Story-Serie,
  Preisliste als Bild, Video/Reel für TikTok & Instagram (MP4) und fertige Texte mit Hashtags –
  automatisch aus der Verteilung, direkt im Browser, ohne KI-Kosten. Immer nur das gewählte Format; Highlights
  lassen sich auswählen und sortieren. Account, Hashtags und die Collage-Vorlage („Als Vorlage speichern“) gelten
  fürs ganze Team.

## Zugänge

Beim ersten Start meldet man sich mit dem Team-Passwort (`APP_PASSWORD`) an und legt unter **Verwaltung** den ersten
Admin an. Ab dann gilt das Team-Passwort nicht mehr: Jede Person bekommt einen eigenen Zugang (E-Mail oder Name +
Passwort; wie im Seller-Tool mit Rolle Helfer/Admin und erzeugtem Passwort – auch mehrere Personen auf einmal),
das Protokoll zeigt, wer was geändert hat. Admins verwalten Zugänge (anlegen, Passwort neu setzen, sperren) und
können ungenutzte Fotos aufräumen; unter **Mein Konto** ändert jede Person ihr eigenes Passwort. Ein neues Passwort
meldet die Person auf allen Geräten ab, Sperren wirkt sofort.

Admin-Passwort vergessen? Auf dem Server:

```bash
cd /opt/spenden-tool/spenden-tool
docker compose exec app npx tsx scripts/benutzer.ts <anmeldename> <neues-passwort> --admin
```

In der Produktliste wird automatisch gespeichert, sobald man eine Zeile verlässt oder kurz nichts tippt.

## Starten (Docker)

```bash
cd spenden-tool
cp .env.example .env     # APP_PASSWORD, APP_SECRET und ggf. ANTHROPIC_API_KEY eintragen
docker compose up -d --build
```

Danach ist die App unter http://localhost:3100 erreichbar. Die Anmeldung erfolgt mit dem Team-Passwort.
Eine tägliche Datensicherung mit allen Fotos landet in `./backups`.

## Als App aufs iPhone (und Android)

Das Tool ist eine installierbare Web-App: eigenes Symbol, Vollbild ohne Browserleiste, Updates automatisch.
- **iPhone/iPad:** in Safari öffnen → Teilen → „Zum Home-Bildschirm“ (die Seite zeigt diesen Hinweis selbst an)
- **Android:** in Chrome „App installieren“

Voraussetzung: eigene Domain mit HTTPS, z. B. https://lugrspende.de (Einrichtung siehe deploy/README.md).

## Auf dem Server (Hetzner)

Siehe [deploy/README.md](deploy/README.md): eigener Ordner, eigene Container und Datenbank, Test auf Port 3021.

## KI-Preisrecherche einrichten

1. Auf https://platform.claude.com einen API-Schlüssel anlegen und Guthaben aufladen.
2. Den Schlüssel in der `.env` als `ANTHROPIC_API_KEY=` eintragen und mit
   `docker compose up -d` neu starten.

Drei Stufen, jeweils beim Start wählbar:

| Stufe | Was passiert | Kosten je Produkt (Schätzung) |
|---|---|---|
| Nur Namen erkennen | Claude Haiku liest das Foto, keine Websuche | deutlich unter 1 Cent |
| Preis suchen – minimal | Claude Haiku, genau 1 Websuche | etwa 2–3 Cent |
| Preis suchen – sparsam (Standard) | Claude Haiku, höchstens 2 Websuchen | etwa 3–6 Cent |
| Preis suchen – genau | Claude Sonnet, bis zu 4 Websuchen | etwa 10–20 Cent |

Die tatsächlichen Kosten jeder Recherche stehen auf der Produktseite, die Summe je Verteilung auf der
Verteilungsseite. Produkte mit einem Ergebnis aus den letzten 60 Tagen werden beim Sammelstart übersprungen –
wiederkehrende Produkte kosten also nur einmal. Die Standard-Stufe lässt sich mit `KI_MODUS` in der `.env` ändern.
Kostenlos geht es auch ohne KI: Neben jedem Preisfeld öffnen die Links „idealo“ und „Google“ den Preisvergleich
mit dem Produktnamen. Günstigster Ablauf: erst „Nur Namen erkennen“, dann Preise selbst nachschauen oder nur für
unklare Produkte die KI suchen lassen.

Ohne Schlüssel funktioniert alles andere normal, nur die KI-Knöpfe sind dann aus.

## Entwicklung

Voraussetzungen: Node.js 22, PostgreSQL 14+.

```bash
npm install
npm run db:migrate
npm run dev          # http://localhost:3100
npm test
npm run typecheck
npm run e2e          # Ablauftests im Browser, siehe e2e/README.md
```

Schema ändern: `src/db/schema.ts` anpassen, dann `npm run db:generate` und `npm run db:migrate`.

```
src/db/schema.ts            Datenmodell
src/lib/layout.ts           Raster, Preisformat, Aushang-Gruppierung, Messenger-Text
src/lib/price-research.ts   KI-Preisrecherche (Claude + Websuche)
src/app/(app)/              Seiten nach dem Login
src/app/aushang/            Druckansicht
```
