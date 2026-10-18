# GRULU-Website (neu)

Neue Version von www.grulu-box.de – eigenständig, unabhängig vom Seller-System in diesem Repository.

## Was neu ist

| Funktion | Beschreibung |
|---|---|
| **KI-Chat „Frag GRULU“** | Das Maskottchen beantwortet Fragen zu Boxen, Geschenken und Lieferung und erzählt Gute-Nacht-Geschichten. Läuft über Claude. Ohne Server oder API-Schlüssel antwortet der Chat aus festen FAQ-Antworten. |
| **GRULU-Musik** | Eigene fröhliche Melodie, live im Browser erzeugt. Dafür braucht es keine GEMA- oder Lizenzrechte. Startet nur auf Klick, wie es Browser verlangen. |
| **Box-Finder** | Drei Klicks, danach gibt es eine passende Box mit Amazon-Link und Konfetti. |
| **ChatGPT-fähig** | Strukturierte Produktdaten (schema.org), `llms.txt`, `robots.txt` für ChatGPT-Bots, Produkt-Feed und ein Button „Frag ChatGPT nach GRULU“. Siehe [CHATGPT-WERBUNG.md](CHATGPT-WERBUNG.md). |
| **GRULU-Welt** | Ausmalbild (Flächen antippen, als Bild speichern), Spiel „Süßigkeiten-Fang“ mit Rekord, persönliche Gute-Nacht-Geschichte per KI mit Vorlese-Funktion, Grußkarte zum Teilen per WhatsApp. |
| **Schulstart-Countdown** | Tage bis zur Einschulung, passende Kauftipps und eine Kalender-Erinnerung 3 Wochen und 1 Woche vorher. |
| **TikTok-Bereich** | Videos laden erst nach Klick (Datenschutz). Kanalname und Live-Hinweis in `public/js/social.js` oben eintragen. |
| **Unboxing-Galerie** | Kunden senden Fotos ein. Diese erscheinen erst, wenn ihr sie unter `/admin` freigebt. Standortdaten werden entfernt. |
| **Schneller und DSGVO-freundlicher** | Schriften liegen auf dem eigenen Server statt bei Google Fonts. Kein WordPress, keine Plugins, keine Cookies. |

Korrigiert gegenüber der alten Seite: Die Schultüte hatte den Text der Nerds-Box. Der Reisebox-Button führte ins Leere (`#`). Der Website-Link im Footer zeigte auf die E-Mail-Adresse.

## Starten

```bash
cd website
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start      # http://localhost:8080
```

Oder mit Docker:

```bash
docker build -t grulu-website website
docker run -d -p 8080:8080 -v grulu-data:/app/data \
  -e ANTHROPIC_API_KEY=sk-ant-... -e ADMIN_PASSWORD=ein-langes-passwort grulu-website
```

Einstellungen (Umgebungsvariablen):

- `ANTHROPIC_API_KEY`: Schlüssel von console.anthropic.com. Ohne Schlüssel antwortet der Chat aus festen FAQ-Antworten.
- `CHAT_MODEL`: Standard ist `claude-opus-5-5`. Günstiger geht es mit `claude-haiku-5-5`.
- `NEWSLETTER_WEBHOOK`: Adresse des Newsletter-Anbieters, z. B. Brevo oder CleverReach. Der Anbieter muss die Bestätigungs-Mail (Double-Opt-in) verschicken. Ohne diese Adresse zeigt das Formular „startet in Kürze“.
- `ADMIN_PASSWORD`: Passwort für `/admin` (Galerie-Fotos freigeben oder löschen). Benutzername: `admin`. Ohne Passwort ist die Verwaltung aus.
- `DATA_DIR`: Ordner für eingesendete Fotos, Standard `./data`. Bei Docker ist das ein Volume: `-v grulu-data:/app/data`.
- `PORT`: Standard ist 8080.

Kostenschutz: Pro Besucher sind höchstens 20 Chat-Nachrichten und 5 Geschichten in 10 Minuten möglich, dazu 3 Foto-Einsendungen pro Stunde. Antworten sind kurz gehalten. Zusätzlich empfiehlt sich in der Anthropic Console ein Monatslimit.

Das Wissen des Chats steht in `knowledge.md`. Bei neuen Produkten oder Preisen dort ändern und neu starten. Produktdaten stehen zusätzlich in `public/index.html`, `public/llms.txt` und `public/feed/products.jsonl`.

## Vor dem Livegang

1. **Impressum und Datenschutz** von der alten Seite übernehmen, als `public/impressum/index.html` und `public/datenschutz/index.html`.
2. **Datenschutzerklärung ergänzen**:
   - Chat-Nachrichten und Angaben für die Geschichte (Vorname, Alter, Thema) gehen an Anthropic (USA). Dazu einen Auftragsverarbeitungsvertrag mit Anthropic abschließen.
   - TikTok-Videos laden erst nach Klick. Beim Laden gehen Daten an TikTok.
   - Galerie: Speicherung der eingesendeten Fotos mit Einwilligung, Widerruf per E-Mail.
   - Den Newsletter-Anbieter nennen.
   - Countdown, Spiel-Rekord und Musik-Einstellung bleiben nur im Browser des Besuchers.
3. **Hosting**: Die Seite braucht Node.js wegen des Chats. Sie kann z. B. auf dem Hetzner-Server neben dem Seller-System laufen, mit Caddy davor. Danach die Domain umstellen.
4. Sobald die Reisebox bei Amazon ist: den Link in `index.html`, `app.js` (BOXES) und `knowledge.md` eintragen.
