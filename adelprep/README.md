# AdelPrep-Website (adelprep.de)

Statische Seite für das Prepcenter AdelPrep der Wittmann & Grunert GmbH. Unabhängig vom Seller-System in diesem Repository. Sie läuft im Hetzner-Webhosting S (PHP nur für das Anfrageformular).

| Datei | Inhalt |
|---|---|
| `public/index.html` | Startseite mit Preisliste, FAQ und Impressum |
| `public/datenschutz.html` | Datenschutzerklärung |
| `public/agb.html` | AGB (Entwurf, vor dem Livegang anwaltlich prüfen lassen) |
| `public/kontakt.php` | Anfrageformular, schickt an kontakt@wittmann-grunert.de (oben in der Datei änderbar) |
| `public/AdelPrep_Preisliste.pdf` | Flyer zum Herunterladen |
| `public/fonts/` | Schriften, lokal eingebunden (keine Google-Verbindung) |

## Hochladen unter Windows (Doppelklick)

Ordner `adelprep` auf den PC holen (GitHub → Code → Download ZIP, oder das ZIP aus dem Chat), dann `Hochladen.bat` doppelklicken. Alles Weitere steht in `LIESMICH.txt`. Das Skript nutzt WinSCP mit FTPS, lädt nur geänderte Dateien hoch, löscht nichts, sichert beim ersten Mal `public_html` und prüft danach, ob adelprep.de den neuen Stand zeigt (über `version.txt`). Zugangsdaten liegen verschlüsselt unter `%APPDATA%\AdelPrep`.

## Hochladen unter Linux / macOS

**Mit einem Befehl** (Linux, macOS, Git Bash unter Windows):

```bash
cp adelprep/.env.example adelprep/.env   # einmalig, FTP-Daten aus konsoleH eintragen
./adelprep/deploy.sh
```

Braucht `lftp`. Lädt nur geänderte Dateien hoch und löscht auf dem Server nichts.

**Per GitHub:** Einmalig unter Settings → Secrets and variables → Actions die Secrets `ADELPREP_FTP_HOST`, `ADELPREP_FTP_USER` und `ADELPREP_FTP_PASSWORD` anlegen. Danach wird die Seite bei jeder Änderung an `adelprep/public` auf `main` automatisch hochgeladen. Unter Actions → „AdelPrep Website hochladen“ → Run workflow geht es auch per Klick.

## Einmalig in konsoleH

- SSL: Let's-Encrypt-Zertifikat für adelprep.de und www.adelprep.de aktivieren.
- Accountwartung: Löschfrist für Weblogs auf 7 Tage stellen. So steht es in der Datenschutzerklärung.

## Preise ändern

Preise stehen in `public/index.html` (Abschnitt `id="preise"` und FAQ) und im Flyer-PDF. Beide gleich halten. Sie sollten auch zu den Standardpreisen in PrepTool passen.
