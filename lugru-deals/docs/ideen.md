# Ideensammlung

Noch nichts davon ist gebaut. Erst sammeln, dann entscheiden.

## Schnell umsetzbar

- [x] ✅ **gebaut:** Doppelte Deals erkennen: Hinweis in Schritt 2 und 4, wenn dieselbe ASIN schon gepostet wurde; ASIN als eigene Zeile im Post (für die Discord-Suche)
- [ ] Risiko als eigenes Feld (🟢 sicher / 🟡 bisl riski / 🔴 riskant) statt in der EK-Notiz
- [ ] Warnung, wenn Amazon selbst auf dem Angebot verkauft
- [x] ✅ **gebaut:** Max. Menge / Cart-Limit als eigenes Feld

## Mittlerer Aufwand

- [x] ✅ **gebaut:** Posts nachträglich ändern: „Ausverkauft“ markieren oder löschen, direkt aus der Historie
- [x] ✅ **gebaut:** Einen Deal in mehrere Channels gleichzeitig posten (Statistik „Alle“ zählt ihn einmal)
- [ ] Eigener Thread pro Deal (Forum-Channels)
- [x] ✅ **gebaut:** Statistik-Seite: Deals, Gewinn, Marge je Channel/Markt/Monat

## Größer

- [ ] Preiswächter: gepostete Deals regelmäßig bei Keepa prüfen und melden, wenn sie nicht mehr aufgehen
- [ ] Geplantes Posten zu einer festen Uhrzeit

## Aufräumen

- [x] Nicht mehr benutzten Karten-Code entfernen
- [x] Port auf 8080 festgelegt
- [x] Datenbankreste und `charts/` aus `scripts/windows/` löschen, dazu die leere Datei `:` im Hauptverzeichnis

## Neue Ideen (Runde 2)

- [ ] ROI zusätzlich zur Marge (Gewinn / EK)
- [ ] Break-even-VK: bis zu welchem VK der Deal noch aufgeht
- [ ] EK im Vergleich zum 90-Tage-Durchschnitt
- [ ] Verkaufsrang und Anzahl der Konkurrenten im Post
- [ ] Rabattcode / Coupon / Spar-Abo als eigenes Feld
- [ ] Eigene Vorlage pro Channel
- [x] ✅ **gebaut:** Entwürfe speichern
- [ ] Automatisches Backup der Datenbank

## Neue Ideen (Runde 3)

- [x] ✅ **gebaut:** Suche und Filter in der Historie – ASIN/Titel und Channel gibt es schon, neu: Zeitraum und Marge
- [x] ✅ **gebaut:** Deal erneut posten / als Vorlage für einen neuen Deal verwenden
- [ ] Export der Historie als Excel/CSV
- [ ] Mindestmarge: Warnung vor dem Senden, wenn der Deal darunter liegt
- [ ] Fremdshop-Links automatisch mit den eigenen Affiliate-Tags (Nicht-Amazon-Shops)
- [ ] Mehrere Nutzer mit Anmeldung, damit mehrere Admins gleichzeitig posten können
- [ ] Hinweis auf eine neue Version (Update-Prüfung beim Start)

## Neue Ideen (Runde 4)

- [ ] Erinnerung an alte Deals: Hinweis auf Deals, die älter als X Tage und noch nicht als ausverkauft markiert sind
- [ ] Grund beim Ausverkauft-Markieren („Preis gestiegen“, „Limit erreicht“) – steht dann im Post
- [x] ✅ **gebaut:** Statistik: beste Einkaufsquellen – aus welchem Shop/Land die meisten und besten Deals kommen
- [x] ✅ **gebaut:** Statistik: Dauerbrenner – Artikel, die öfter gepostet wurden (mit Knopf „Erneut posten“)
- [ ] Schnell-Deal: ASIN/Link und EK in einem Schritt, direkt zur Berechnung
- [ ] Chart-Zeitraum pro Deal wählbar (z. B. 1 Jahr bei Saisonartikeln)
- [ ] Dunkles Design für die Oberfläche

## Neue Ideen (Runde 5)

- [ ] Wochenrückblick: automatisch „Top-Deals der Woche“ in einen Discord-Channel posten
- [ ] Kategorie aus Keepa (Werkzeug, Küche …) – als Filter in Historie und Statistik
- [ ] Statistik: Laufzeit – wie lange ein Deal im Schnitt hielt, bis er ausverkauft war
- [ ] Beobachtungsliste: ASINs merken, die gerade nicht aufgehen, und später mit einem Klick neu prüfen
- [ ] Sammel-Check: mehrere ASINs/Links auf einmal einfügen, Tabelle mit Gewinn und Marge je Artikel
- [ ] Interne Notiz zum Deal – nur im Tool sichtbar, nicht im Post

## Reaktionen als Rückmeldung

- [x] ✅ **gebaut:** ✅ (gekauft) und ❌ (nicht mehr verfügbar) je Deal aus Discord abrufen und in Historie + Statistik zeigen
  - braucht einen Discord-Bot (ein Webhook kann Reaktionen nicht lesen)
  - ✅ gebaut: ✅ und ❌ nach dem Posten automatisch vorbelegen
  - ✅ gebaut: ab X ❌ als ausverkauft vorschlagen oder automatisch markieren

## Zwei Discord-Server

- [x] ✅ **gebaut:** Gruppen je Channel (z. B. je Server), Statistik und Historie danach umschaltbar
- [x] ✅ **gebaut:** Rückmeldung aus Discord: gekauft / nicht mehr verfügbar / ohne Reaktion, mit Liste je Deal

## Telegram

- [x] ✅ **gebaut:** Jeder gepostete Deal zusätzlich an einen Telegram-Chat (Einstellungen → Telegram)
- [ ] „Ausverkauft“ auch in Telegram nachziehen

## Wer postet

- [x] ✅ **gebaut:** „Gepostet von“ in Schritt 4, direkt unter dem Titel im Post, in Historie (mit Filter) und Statistik

## Großhandel

- [x] ✅ **gebaut:** Einkauf ohne Link: Haken in Schritt 1, ASIN + Einkaufsland + Lieferant (z. B. Metro), im Post „🏬 Metro“ ohne Link, Lieferant in Historie und Statistik

## Werbung

- [x] ✅ **gebaut:** Statistik → „Bild für Instagram / TikTok“: Vorschau im Browser, Story/Post/Quadrat, Überschrift, Aufruf und Farbe anpassbar, ohne Gruppennamen, PNG herunterladen oder teilen

## Alte Deals

- [x] ✅ **gebaut:** Alte Deals aus den Discord-Channels einlesen (Vorschau, dann übernehmen), Etikett „aus Discord“

## Gewinn mit Cart-Limit

- [x] ✅ **gebaut:** Gewinn × Cart-Limit (sonst Standard-Stückzahl, Vorgabe 6), ohne Deals aus B2B-Channels (in den Einstellungen wählbar), in Statistik und Werbebild; Cart-Limit auch aus „3er cart“ in der EK-Notiz

## Zusatzzeilen

- [x] ✅ **gebaut:** Freie Zeilen im Post unter dem EK (ETA, MOQ, Zahlungsziel …)

## Statistik

- [x] ✅ **gebaut:** Statistik öffnet mit dem laufenden Monat
- [x] ✅ **gebaut:** Werbebild-Format „Discord-Auswertung“ für Mitglieder: wer was gepostet hat, Top-Deals, meistgekauft, Quellen und Zielmärkte

## Weitere Wünsche

<!-- hier ergänzen -->
