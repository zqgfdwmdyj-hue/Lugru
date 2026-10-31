# Ablaufprüfungen (e2e) und Prüfstand

Automatische Prüfungen im Browser (Playwright), immer gegen eine **frische Test-Datenbank mit erfundenen Daten**
(`scripts/testdaten.ts`) und **Testdienste statt echter Dienste** (`scripts/testdienste.mjs`: Claude, Post, DHL,
Amazon, eBay, Temu …). Die App läuft dabei im Testbetrieb (`TESTUMGEBUNG=1`): Mails werden abgefangen, jede andere
Verbindung nach außen ist gesperrt. Nichts davon berührt das echte System.

## Ausführen

```bash
# einmalig: Postgres mit Benutzer seller/seller (Datenbank seller_e2e wird bei Bedarf angelegt)
npm ci && npx playwright install chromium
npm run build          # die Prüfungen laufen gegen den fertigen Build
npm run e2e            # alle Prüfungen, Desktop + Handy (Bericht: playwright-report/index.html)
npm run pruefstand     # PRUEFSTAND.md aus dem letzten Lauf erzeugen
```

Einzelne Datei: `npx playwright test e2e/privat.spec.ts`, nur Handy: `--project=handy`.

Auf GitHub läuft alles bei jedem Push nach `main`/`ueberarbeitung` (`.github/workflows/pruefung.yml`): grüner Haken
bzw. rotes X am Commit, der Prüfstand steht in der Zusammenfassung des Laufs.

## Was geprüft wird

| Datei | Ablauf |
|---|---|
| `formulare.spec.ts` | Formulare behalten Eingaben (Uhren-Deal als Regression, Lieferschein, Uploads, Scanner) |
| `labels.spec.ts` | Offene Aufträge → Labels (simuliert) → als versendet melden |
| `sendungen.spec.ts` | Speditions-Sendung: verschieben, Meldung an alle, Kunden-Link, Ablauf/Widerruf |
| `rechte.spec.ts` | Claude-Konnektor und Fragefeld mit mehreren Konten: Rechte, Vorschläge, Protokoll |
| `werkzeuge.spec.ts` | Jedes lesende Claude-Werkzeug: Beschreibung, Antwort, Quelle + Datenstand, Links |
| `keepa.spec.ts` | Keepa-Werkzeuge: Produkt, Länder-Vergleich, Zwischenspeicher, Rechte (gegen den Keepa-Nachbau) |
| `retouren-station.spec.ts` | Retouren-Station: Paket mit 4 Artikeln nur per Sprache/Handscanner (Test-Kamera), Netz weg → Warteschlange, Fall-Paket (Text, Fotos, ZIP), Eingereicht, RET-SKU mit EK, Werkzeug + Ereignis-Kanal, Rechte |
| `geschaeft.spec.ts` | Antwort-Entwurf (Senden nur mit Häkchen), Archivieren, Anspruch eingereicht, BQool-Export + „repricer“, Amazon je Land (Buy Box, Listung, Lageralter, Angebote live), Rechte |
| `fragefeld.spec.ts` | Altes Gespräch fortsetzen (kein 400), Prep-Center-Zahlen |
| `kennzahlen.spec.ts` | Jede Kennzahl mit Zeitraum/Quelle/Stand, keine kaputten Werte |
| `uebungsdaten.spec.ts` | Übungs-Deals zählen nirgends mit, Schalter blendet sie ein |
| `privat.spec.ts` | Serien mit Ausnahmen, Abendritual-Abfolge, Schutz privater Inhalte |
| `oberflaeche.spec.ts` | **alle** Menüseiten: Status mit Text, aktive Auswahl markiert, deaktiviert erkennbar, Kontrast, Handy ohne Querscrollen |
| `testumgebung.spec.ts` | Banner, Sperre nach außen, Übersicht der abgefangenen Mails |
| `teil2.spec.ts` | Liquidität (Kontoauszug, Amex, Reserve rot), Kapital-Ampel, Verlust-Stopp mit Ausnahme, Echtheits-Ordner + ZIP, Amazon Business (Bericht, Staffelpreise, Freigabe, Datei), Call-Archiv (Google Doc, KI-Punkte, Aufgaben, Discord), Anleitungen beim Zuweisen, freie Zeiten, Familien-Zugang, Assistenz ohne Finanzdaten, privates Geld |
| `zugriffe.spec.ts` | B19.2: Benutzerliste mit Spalte Privat-Zugriff und Warnungen, Rolle „VA“, neues Konto „Nur Familie“ sieht nur Familien-Termine und Schulbriefe |
| `lugru-deals.spec.ts` | Lugru Deals über Discord und direkt von der Seite; B19.1: History mit Ampel ohne Push, Testkanal draußen, Reaktionen, Weg A |
| `b19-rest.spec.ts` | B19.5–B19.8: Tagesplan „überbucht – x Min. zu viel“, Assistent-Verlauf, Deal-Blatt als Bild, Beobachtungen/Wochenrückblick, LPN, Handy-Anleitung, Werkzeug-Felder |
| `datei-import.spec.ts` | Datei-Import über den Konnektor: Upload-Link, Status mit absoluten Links, Übersicht; Lagergebühren (übergroß, Abgleich, Filter Land/Sortierung), USt je Periode/OSS; unbekanntes Format mit Vorschlag + Protokoll; Büro bekommt die Werkzeuge nicht |
| `b20-lugru.spec.ts` | B20.1/B20.2: Lugru-Nachtrag ohne 1.000er-Grenze, eine Zählbasis überall, Ampel-Regeln v2 (Amazon > 90 % rot, Angebote gelb), gerundete Prozente |
| `b20-faelle.spec.ts` | B20.5: Auszahlungsmitteilung schließt den Fall und landet in der Liquidität; Buy-Box-Hinweis als ToDo je Land, Bewertungs-/Versandmails archiviert |
| `b20-einkauf.spec.ts` | B20.8: Kaufquote 0 % über die ASIN, Posten über 10.000 € unter „prüfen“, Startseite „+ x zu prüfen (y €)“ |
| `b20-rest.spec.ts` | B20.3/B20.6/B20.9: gültige Schwelle je Quelle, Rückgängig nach `mail_markieren`, Sprachkennzeichen bei VA-Nachrichten, „AI Win Sales Booster“ im Regel-Katalog |

Testkonten (Passwort aus `TESTDATEN_PASSWORT`, in den Prüfungen fest): `inhaber` (Inhaberin, Privat voll),
`lager` (nur Palettenlager), `buero` (Büro), `pruefer` (nur ansehen), `familie` (nur Privat „Familie“).

## Neue Prüfung hinzufügen

1. Spec in `e2e/` anlegen, `test`/`expect` aus `./helfer` verwenden (prüft auch auf Skriptfehler im Browser).
2. Nur erfundene Daten – fehlende Testdaten in `scripts/testdaten.ts` ergänzen.
3. Soll der Ablauf auch am Handy laufen: `@handy` in den Titel.
4. In `e2e/pruefstand.ts` beim passenden Reiter eintragen (Ablauf, Erwartet, `"datei.spec.ts › Titelanfang"`).
   Nicht zugeordnete Prüfungen listet der Prüfstand am Ende auf.

## Live-Prüfung eintragen

Live nur mit dem Nur-ansehen-Konto bzw. in der Testumgebung auf dem Server prüfen, **nie den Privatbereich live**.
Ergebnis in `e2e/pruefstand.ts` beim Reiter unter `live` ergänzen (Datum, wer, Ablauf, Ergebnis, Status
`ok` | `befund` | `behoben`) und `npm run pruefstand` ausführen.
