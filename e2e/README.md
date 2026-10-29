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
| `geschaeft.spec.ts` | Antwort-Entwurf (Senden nur mit Häkchen), Archivieren, Anspruch eingereicht, BQool-Export + „repricer“, Amazon je Land (Buy Box, Listung, Lageralter, Angebote live), Rechte |
| `fragefeld.spec.ts` | Altes Gespräch fortsetzen (kein 400), Prep-Center-Zahlen |
| `kennzahlen.spec.ts` | Jede Kennzahl mit Zeitraum/Quelle/Stand, keine kaputten Werte |
| `uebungsdaten.spec.ts` | Übungs-Deals zählen nirgends mit, Schalter blendet sie ein |
| `privat.spec.ts` | Serien mit Ausnahmen, Abendritual-Abfolge, Schutz privater Inhalte |
| `oberflaeche.spec.ts` | **alle** Menüseiten: Status mit Text, aktive Auswahl markiert, deaktiviert erkennbar, Kontrast, Handy ohne Querscrollen |
| `testumgebung.spec.ts` | Banner, Sperre nach außen, Übersicht der abgefangenen Mails |

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
