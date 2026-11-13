// Prüfstand je Reiter: welcher Ablauf geprüft wird, was erwartet ist, welche automatische Prüfung ihn abdeckt
// (Datei › Titelanfang) und was live geprüft wurde. Daraus erzeugt `npm run pruefstand` die Datei PRUEFSTAND.md –
// zusammen mit den Ergebnissen des letzten Laufs (test-results/ergebnis.json).
//
// Live-Prüfung nachtragen: beim Reiter unter `live` eine Zeile ergänzen (Datum, wer, Ablauf, Ergebnis) und
// `npm run pruefstand` erneut ausführen. Nur erfundene Daten oder das Nur-ansehen-Konto verwenden.

export type Ablauf = { ablauf: string; erwartet: string; tests: string[] };
export type Live = { datum: string; wer: string; ablauf: string; ergebnis: string; status: "ok" | "befund" | "behoben" };
export type Reiter = { abläufe?: Ablauf[]; live?: Live[]; offen?: string[] };

const FRUEHER = "vor dem 28.10.2026";

/** Schlüssel = Pfad aus der Navigation (src/lib/nav.ts) bzw. ein Name für Bereiche ohne eigenen Menüpunkt. */
export const PRUEFSTAND: Record<string, Reiter> = {
  "/": {
    abläufe: [
      { ablauf: "B15.2 Privater Kalender auf der Startseite", erwartet: "nur „Privat belegt“ + Uhrzeit, nie Titel, Ort oder Betrag; Assistenz sieht nichts", tests: ["b15-sofort.spec.ts › Startseite"] },
      { ablauf: "B15.1 FBM-Versandbestätigung offen", erwartet: "Alarm mit Frist, Datei für Seller Central, „Verkauft, jetzt liefern“ erst nach Bestätigung erledigt", tests: ["amazon-todos-versand.spec.ts › Bestell-Mails folgen dem Auftrag"] },
      { ablauf: "B25.7 Paletten ohne Kunde unter „Jetzt dringend“", erwartet: "Signal „N Paletten ohne Kunde – werden nicht abgerechnet“ mit Link auf den Filter", tests: ["b25.spec.ts › B25.3/B25.5/B25.6/B25.7"] },
    ],
    offen: ["Aufgaben anlegen, erledigen, verschieben", "Tageskennzahlen"],
  },
  "/posteingang": {
    abläufe: [
      { ablauf: ".eml-Datei hochladen", erwartet: "Rückmeldung, Dateiauswahl danach leer", tests: ["formulare.spec.ts › Posteingang: .eml hochladen"] },
      { ablauf: "Antwort-Entwurf (über Claude) prüfen und senden", erwartet: "Entwurf an der Mail; ohne Häkchen „Geprüft“ wird nicht gesendet; mit Häkchen landet die Mail in den Test-Mails und der Entwurf ist als gesendet markiert", tests: ["geschaeft.spec.ts › Antwort-Entwurf"] },
      { ablauf: "Posteingang auf null: Regel an Zuständigen, Auto-Archiv, Zahlung abgelehnt (IT), Termin-Mail → Privatkalender, Vorschlag für Claude", erwartet: "Aufgabe für die Zuständige, Newsletter archiviert, Zahlung kritisch mit Aufgabe, Termin nur im Privatkalender (nie im Posteingang)", tests: ["posteingang-null.spec.ts › Regel an Zuständigen"] },
      { ablauf: "B32.5 Antwort aus dem Mailprogramm (Gesendet-Ordner) auf eine Käuferfrage; neue B2B-Anfrage aus dem Mailprogramm", erwartet: "Mail „beantwortet (extern)“ mit Postfach/Name, Aufgabe erledigt, vorbereiteter Entwurf verworfen, Verlauf zeigt die Antwort; neue Anfrage unter „Ausgehend“ mit „Nachfassen in 3 Tagen“ → fällig = Aufgabe, Antwort des Kunden schließt sie", tests: ["persoenliche-mails.spec.ts › Abnahme 5–6"] },
      { ablauf: "Gerichts-/Behörden-Mail und Anwalts-Mails (B14)", erwartet: "Behörde: Entwurf an den Anwalt (nicht gesendet) + Aufgabe; Anwalt mit Aktenzeichen: in den Fall statt in den Posteingang", tests: ["recht-discord.spec.ts › Teil A"] },
    ],
    offen: ["Mails abrufen (nur echte Postfächer) – inkl. Gesendet-Ordner und Minuten-Abruf", "Entwurf echt senden (nur mit echtem Postfach)", "Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test", "Outlook: Zuordnung gesendeter Mails nur über Betreff + Empfänger (kein In-Reply-To aus Graph)"],
  },
  "/rechtsfaelle": {
    abläufe: [
      { ablauf: "Asana-Fall (nur lesen) mit Kommentar „Bitte bis … Unterlagen senden“, privater Fall, Anwalts-Mails, Claude", erwartet: "Status und Frist im Fall, wir am Zug, Aufgabe 3 Tage vorher (Kalender), privater Fall nur im Privatbereich, Startseite nur mit Anzahl, Entwurf nie gesendet, Asana nie beschrieben", tests: ["recht-discord.spec.ts › Teil A"] },
    ],
    offen: ["Echter Asana-Zugang (Token) beim Anwalt; ob Webhooks für Gäste gehen", "Echte Anwalts-Mails (Domain, Aktenzeichen-Format)"],
  },
  "/schnell": {
    abläufe: [
      { ablauf: "Diktat per Handy-Schlüssel: Aufgabe, Eingangsliste, Privates nur mit Zugang, Widerruf", erwartet: "richtig eingeordnet, widerrufener Schlüssel → 401", tests: ["schnell-familie.spec.ts › Diktat per Schlüssel"] },
      { ablauf: "Widget, Anrufe in der Fahrzeit, Briefing je Ziel, SMS-Codes, Ins Auto, Fahrtenbuch, Scan, Auto-Status/Klima", erwartet: "Werte mit Satz zum Vorlesen; „KAUFEN“ nur Entwurf; Navi-Ziel und Klima im (erfundenen) Auto; Fahrt als geschäftlich vorgeschlagen; Tesla-Schlüssel unter /.well-known", tests: ["handy-tesla.spec.ts › Widget"] },
    ],
    offen: ["Echtes Handy (Kurzbefehle/Widget)", "Echter Tesla (Fleet-API-App, virtueller Schlüssel, Befehls-Proxy)", "Echte SMS über Twilio"],
  },
  "/posteingang/verbinden": {
    abläufe: [
      { ablauf: "Postfach verbinden: App-Passwort zuerst, Anleitung (Google, Microsoft 365, GMX/WEB.DE, IONOS/STRATO), „Nur abrufen“, OAuth nur unter „Erweitert“", erwartet: "IMAP-Formular sichtbar, Erweitert zugeklappt", tests: ["postfach.spec.ts › Anbindungen, Verbinden"] },
      { ablauf: "Mails hochladen: niederländische Compliance-Mail und Routinemail „Verkauft, jetzt liefern“", erwartet: "Compliance kritisch, Routine unwichtig; Empfänger (Delivered-To) und Ordner „Upload“ an der Mail; Amazon-ToDo mit Marktplatz NL, SKU, ASIN und Link „Kontozustand“; Claude: posteingang/mail mit an + ordner", tests: ["postfach.spec.ts › Anbindungen, Verbinden"] },
    ],
    offen: ["IMAP mit echtem Postfach: Ordnerauswahl (Gmail „Alle Nachrichten“), Test-Knopf, SMTP 465 → 587, Fehlerarten (Anmeldung, IMAP aus, Port) – nur live mit Nur-ansehen-Daten"],
  },
  "/anbindungen": {
    abläufe: [
      { ablauf: "Karte „Postfächer“ und Warnung ohne Amazon-Mail; Google/Microsoft nur optional unter „Erweitert“", erwartet: "Warnung „Kein Postfach verbunden“; Google-Karte zeigt OPTIONAL; anbindungen_status (nur Probleme) listet Google nicht, liefert Postfächer und Warnung", tests: ["postfach.spec.ts › Anbindungen, Verbinden"] },
      { ablauf: "B25.12 Intervall je Abruf auf der Karte, echter Zeitplan statt „laut Plan“", erwartet: "z. B. „Amazon-Bestellungen: alle 15 Min.“; Zeitplan aus dem letzten Lauf", tests: ["b25.spec.ts › B25.10/B25.12"] },
      { ablauf: "B29 sellerboard-Aufrufbudget: künstliches Budget 5, „Fällige Abrufe nachholen“ gegen den sellerboard-Nachbau", erwartet: "Zähler „sellerboard-Aufrufe heute: n/125 (Automatik n, Reserve n)“ = Aufrufe beim Nachbau, höchstens 5; Verkauf lief (Vorrang), übrige Abrufe „übersprungen (Tagesbudget)“, kein Fehler", tests: ["b29-sellerboard-budget.spec.ts › Abnahme 2"] },
      { ablauf: "B30 ArbitrageOne-Einkäufe (PurchaseOrders): Fehlimport mit Art ek_liste → „Erneut verarbeiten“; Einkauf → Bestellungen; Upload unter Uploads; EK-Vorschlag", erwartet: "„fertig“ mit „2 Bestellungen, 3 Positionen, 2 ohne Zuordnung“, Art ao_einkaeufe; Bestellungen mit Lieferant, Datum, Menge, EK, Status, „1 ohne Zuordnung“; Upload erkannt als „ArbitrageOne – Bestellungen“, „schon bekannt: 3 Positionen“; EK-Vorschlag mit Warnung gegen sellerboard-COG, keine Charge; Liquidität ohne die Bestellung", tests: ["b30-ao-bestellungen.spec.ts › Fehlimport (ek_liste)"] },
      { ablauf: "B30.3 Fehlimporte beim nächsten Abruf nachverarbeitet; fehlende Spalten", erwartet: "Fehlimport von vor 4 Tagen „fertig“ als ao_einkaeufe; Einkäufe · ok · 1 Bestellung, 1 Position; Fehler nennt „gefunden: …; fehlt: …“", tests: ["b30-ao-bestellungen.spec.ts › Fehlimporte beim nächsten Abruf"] },
      { ablauf: "B29 Limit-Fehler „used up today's MCP call limit“, danach Rücksetzung", erwartet: "genau ein Eintrag „pausiert bis 01:00 Uhr“ (auch unter nur_probleme), keine Fehlerzeilen, während der Pause kein Aufruf; danach nachgeholt Verkauf → Gewinn je Produkt → Bestand → Tagesabrufe, Eintrag weg", tests: ["b29-sellerboard-budget.spec.ts › Abnahme 3"] },
    ],
    offen: ["B30 mit der echten PurchaseOrders-Datei: Import vom 06.11. nach dem Update „fertig“, Spaltenzuordnung (EK netto/brutto, Menge, Status) prüfen; Lauf am 07.11. 05:30 Einkäufe · ok – nur live (To-dos 90/91)", "B29 Abnahme 1 und 4 mit echtem sellerboard: am 06.11. nach 01:00 laufen alle Abrufe wieder, um 12:00 höchstens 45 Aufrufe laut Zähler; ein ganzer Tag mit Morgenbericht und drei Nachfragen endet unter 125 – nur live (Rechnung nach Plan im Unit-Test: 45 bis 12:00, 72 am Tag)", "B29 schlanke Feldauswahl (bis 200 Zeilen je Seite) gegen echtes sellerboard – lehnt sellerboard sie ab, fällt der Abruf von selbst auf volle Zeilen zurück"],
  },
  "/amazon-faelle": {
    abläufe: [
      { ablauf: "Amazon-Mails einordnen: Freischaltung abgelehnt, Fall „Antwort nötig“ (2 Mails, gleiche Fall-ID), Freischaltung entzogen, unsichere Mail", erwartet: "Paket mit Rechnung ≤ 180 Tage und ≥ 10 Stück, VA-Thread; ein Vorgang mit Antwort DE/EN inkl. Sendung, POD als „fehlt“; Entzug rot mit Meldung an Ludwig und Bestand in €; Einordnung von Hand lernt; Claude-Werkzeuge", tests: ["amazon-faelle.spec.ts › Freischaltung abgelehnt"] },
      { ablauf: "20 erfundene Amazon-Mails in 8 Sprachen einordnen (Unit-Test)", erwartet: "≥ 18 richtig (Bereich und Phase), Fall-ID/ASIN/Frist erkannt", tests: [] },
      { ablauf: "Amazon-Berichte 1–4: Konto-Berichte anfordern/abholen, Kontozustand, gestrandet/gesperrt, weitere Gebühren, USt per Schnittstelle, Datei-Import", erwartet: "DE „gefährdet“ (neue Markenbeschwerde), FR gut; 2 SKUs/8 Stück/10,50 € gebunden; Tasse gesperrt; Langzeitlager 3,40 €, Inbound 1,20 €; Aufgaben + Push; USt mit Quelle api; amazon_faelle/amazon_lagergebuehren", tests: ["amazon-berichte.spec.ts › Kontozustand, gestrandet"] },
    ],
    offen: ["Echte Seller-Central-Mails (nur live mit Nur-ansehen-Daten)", "SP-API: Listings Restrictions (Freischaltungsstatus je Marktplatz) – braucht die Amazon-Anbindung"],
  },
  "/assistent-verlauf": {
    abläufe: [
      { ablauf: "B25.6 Rückgängig für aufgabe_verschieben (auch aufgabe_zuweisen, auftrag_status, privat_eintrag_anlegen)", erwartet: "neuer Aufruf zeigt „↩ Rückgängig“, Klick stellt die alte Frist her", tests: ["b25.spec.ts › B25.3/B25.5/B25.6/B25.7"] },
      { ablauf: "Auftrag an Claude aus den Amazon-ToDos: „ToDos mit versendetem Auftrag erledigen“ → Vorschau → Ausführen → Verlauf → Rückgängig; gelber Auftragsstatus; Preis ändern; Mail mit „ignore previous instructions“; VA-Konto; gleiche Aktion über den Konnektor", erwartet: "Vorschau nennt 2 passende und 1 getrennt (nicht versendet), ohne Klick keine Änderung; Verlauf mit Auftragstext und Datensätzen, Rückgängig öffnet wieder; gelb nur mit Einzelbestätigung; Preis: Hinweis + Link, keine Ausführung; Mail-Text löst nichts aus; VA ohne Finanzen; Konnektor gleiches Ergebnis", tests: ["assistent-aktionen.spec.ts › Vorschau → Ausführen"] },
    ],
  },
  "/deal-eingang": {
    abläufe: [
      { ablauf: "B25.3 Schwelle „Lugru Deals=60“", erwartet: "als gespeicherter Wert im Feld, nicht als Platzhalter", tests: ["b25.spec.ts › B25.3/B25.5/B25.6/B25.7"] },
      { ablauf: "Text, Screenshot (3 Angebote), Kurzbefehl mit Geräte-Schlüssel, Kapital-Ampel rot, Preisliste (XLSX 500 Zeilen), Mail „Deal prüfen“, ProfitPath über Discord, Knöpfe Bestellvorschlag/B2B-Deal, Claude-Werkzeuge", erwartet: "Ampel je Angebot mit Gründen; Push ≤ 60 s nur bei Grün/Gelb (ProfitPath); widerrufener Schlüssel abgelehnt; gleiche ASIN/EK zusammengefasst, neuer EK = Update; Einkaufsentwurf und B2B-Entwurf angelegt", tests: ["deal-eingang.spec.ts › Text, Screenshot"] },
      { ablauf: "Abschnitt 10/11: Lugru-Deals-History über den Endpunkt (mit/ohne Schlüssel, erneut senden), Budget-Grenze je Deal, geteilter Deal mit Shop-Link, „Gekauft: Menge, Preis“, Amazon-Bestellbestätigung als .eml, 👎 aus der Push-Meldung mit Grund, 👍 unter der ProfitPath-Nachricht in Discord, Wareneingang + 35 Tage mit sellerboard-Monat, Monatsbericht, Claude-Werkzeuge", erwartet: "History neu/aktualisiert/ungültig gezählt, ohne Schlüssel 401; Deal-Wert „Passt zu dir (X/100)“ mit ähnlichen Deals (Lugru-Gruppe); über Budget höchstens Gelb mit Budget-Grund; Push mit „Zum Angebot“ (Shop-Link) und „Gekauft …“; gekauft → Bestellung „bestellt“ + Aufgabe „Wareneingang buchen“; Mail → gekauft (Menge, Preis, Bestellnummer), Mail bleibt im Posteingang; 👍/👎 mit Weg gespeichert; Ergebnis nach 30 Tagen mit realem ROI; deal_wert/deal_lernen_bericht/deal_bewerten/deal_gekauft", tests: ["deal-wert.spec.ts › History-Import"] },
      { ablauf: "Nachtrag B28: Deal-Quelle mit Lieferant anlegen, Testpfanne (Buy Box 79 €, früher 57,99 €, IT 1 Angebot), Ziel-VK DE 56 €, 👍 mit Grund „In einem Land kein Angebot“ + ähnlicher Deal neu prüfen, 👍 in Discord mit Rückfrage (Zahl-Reaktion + Text), Gekauft 84 × 25 € mit Bestellmail, Antwort mit Sendungsnummer als .eml, Claude-Werkzeuge", erwartet: "je Land Gewinn/Marge/ROI + max. EK Ziel-ROI/Ziel-Marge, Verk./Monat überall gefüllt (IT „geschätzt“), Seller-Central-Knopf; Szenario rechnet neu + „ca. n Verkäufe/Monat (Keepa „gekauft“)“; Deal-Wert des ähnlichen Deals steigt mit Grund-Text, Lernbericht zählt Gründe; Bot fragt im Thread, Grund + Freitext gespeichert; Entwurf an den Lieferanten, nichts gesendet vor „Senden“, danach Beleg am Deal und im Einkauf, Sendungsnummer + Rechnung zugeordnet; deal_gekauft legt nur Entwurf an", tests: ["deal-b28.spec.ts › Abnahmen 1–5"] },
      { ablauf: "B28.6 Abnahme 6: Testpfanne ab 84 Stück, Mindest-ROI p. a. in den Einstellungen", erwartet: "Spalten „Umschlag“ (Spanne, geschätzt) und „ROI p. a.“ je Land, Hinweis „Umschlag … · ROI p. a. … (Ziel ≥ 100 %)“, Reichweiten-Warnung mit Menge für 45 Tage; deal_wert/deal_eingang_detail mit roi_pa_prozent und umschlag", tests: ["b28-umschlag.spec.ts › Abnahme 6"] },
      { ablauf: "B34.4/5 Abnahme: Ankaufspreis 26 € (Testartikel EK 20 €, Rückvergütung 2 %, Zahlungsziel 7 T), Menge teilweise angemeldet, „Gekauft“, Ausgang „Verlust“", erwartet: "Amazon und Ankauf nebeneinander (Gewinn je Stück/gesamt, Marge, ROI, Geld nach, ROI p. a., Fazit); Wissenseintrag „Ankaufserver“ insider; Warnung vor dem Kauf ohne Stopp, Meldung mit offenen Punkten, Aufgabe „Ankauf bestätigen“ mit Frist; Ausgang erledigt die Aufgabe und legt eine Frage in der Lernschleife an; nur Inhaber", tests: ["b34-ankauf.spec.ts › Abnahme"] },
      { ablauf: "Lücken aus dem Bauauftrag (Abschnitte 2, 4, 5, 7): weitere Einstellungen (ungültiger/gültiger iCloud-Link), Kurzbefehl-Skizzen, offene Rechteinhaber-Beschwerde zur ASIN, Lieferant ohne Marktplatz-Freigabe + Gefahrgut, Keepa-Mini-Chart, Screenshot im Original und fremde Datei", erwartet: "Einstellungen gespeichert, Budget/Ziel-ROI unverändert; Link + 4 Skizzen; Rot mit Fallnummer; Rot „selektiver Vertrieb“ + Gelb Gefahrgut als 2. Grund; Chart mit Ø/Tief/Stand; Bild 200 image/png, Datei über anderen Eingang 404", tests: ["deal-eingang-luecken.spec.ts › Einstellungen"] },
    ],
    offen: ["B28: Bestellmail an echte Lieferanten (Zustellung, Message-ID-Erhalt je Postfach) und Discord-Rückfrage nach 👍 im echten ProfitPath-Kanal (Bot braucht dort „Nachrichten senden“, „Threads erstellen“, „Reaktionen hinzufügen“) – nur live", "ProfitPath mit echtem Discord-Bot (Message Content Intent, Rechte „Kanal ansehen“ + „Nachrichtenverlauf lesen“) – nur live", "Lugru Deals live: Programm auf den neuen Stand bringen, Seller-Adresse + Verbindungsschlüssel eintragen – die History kommt dann von selbst", "Echte Bestellbestätigungen anderer Shops (Betreff/Format je Shop) – nur live"],
  },
  "/delegation": {
    abläufe: [
      { ablauf: "Aufgabe an die VA über Discord: Thread mit Anleitung und Datei, ✅ erledigt, Rechnungsfrage automatisch beantwortet, Rückfrage → Antwort im Thread", erwartet: "Thread je Aufgabe, Status übernommen, keine Privat-/Finanzdaten an die VA", tests: ["va-discord.spec.ts › Aufgabe → Thread"] },
      { ablauf: "B18: Anspruch mit Frist in 8 Tagen, Frist rückt auf 7/5/3/1 Tage, VA antwortet „case 12345678901“, Anspruch mit Frist heute, dann abgelaufen; Claude va_aufgaben/ueberblick", erwartet: "Thread sofort (Englisch, Art, SKU, Sendung, Menge, Betrag, Frist, Anleitung); Erinnerung nur an −7/−3/−1; eingereicht mit Fallnummer; Fristtag → Meldung an Ludwig; verpasst → Liste „Premium-Support/PSTAM“, Zeile „N Fristen verpasst“ rot (VA-Seite, Feierabend, ueberblick); „Daily overview“ einmal am Tag mit Thread-Links", tests: ["va-automatik.spec.ts › Anspruch: Thread sofort"] },
      { ablauf: "B18: Amazon-Mails Markenbeschwerde, Fall „Antwort nötig“ 120 €, Fall 800 €, Fallnummer im Fall-Thread, „An die VA“ von Hand, Modus „Vorschlag“, Regel je Kategorie ändern", erwartet: "Marke nur Ludwig; 120 € automatisch Thread; 800 € erst Ludwig (Meldung, Knopf); Vorgang „eingereicht“; im Vorschlag kein Thread, tägliche Aufgabe; Regel gespeichert", tests: ["va-automatik.spec.ts › Fall-Zentrale: Marke nur Ludwig"] },
      { ablauf: "B18: Tagesgrenze erreicht, zwei neue Ansprüche, VA antwortet „#n case …“ im Sammel-Thread", erwartet: "beide im Sammel-Thread (#1, #2), nur der genannte eingereicht", tests: ["va-automatik.spec.ts › Tagesgrenze"] },
    ],
    offen: ["VA-Automatik live: Zeitzone „Asia/Manila“ prüfen, einige Tage im Modus „Vorschlag“ beobachten, dann auf „automatisch“ umstellen"],
  },
  "/kalender": {
    abläufe: [
      { ablauf: "Geschäftskalender als Büro-Konto und als Inhaberin", erwartet: "keine privaten Einträge (Testwort PRIVATGEHEIM erscheint nicht)", tests: ["privat.spec.ts › Privates bleibt privat"] },
      { ablauf: "B25.8 Tagesplan: Termin mit Ort, Anruf-Aufgabe mit Nummer", erwartet: "Fahrzeit-Block vor dem Termin (aus PLZ geschätzt, „Anrufe möglich“); 📞-Link mit tel:", tests: ["b25.spec.ts › B25.8"] },
    ],
  },
  "/kalender/feierabend": {
    abläufe: [
      { ablauf: "Feierabend: erledigt/offen, auf morgen schieben, morgen Top 3", erwartet: "wichtige bleiben stehen", tests: ["herzstueck.spec.ts › Feierabend"] },
      { ablauf: "Wochenrückblick mit „Privates zeigen“ (B16)", erwartet: "Beobachtungen (Bogen-Format, „unvollständig“), Zuwendung je Art und Richtung, Gespräche, Danke, Stimmung, Dateideen, Aufgaben, Vorwochen-Vergleich; ohne Freigabe nichts Privates", tests: ["privat-rueckblick.spec.ts › Beobachtung anlegen"] },
    ],
  },
  "/auftraege": {
    abläufe: [
      { ablauf: "Labels kaufen und alle als versendet melden (Amazon, simuliert)", erwartet: "Versandbestätigung je Amazon-Auftrag an den Testdienst; eBay ohne Verbindung als Meldung", tests: ["labels.spec.ts › Offene Aufträge"] },
      { ablauf: "Ansicht „Meldung offen“", erwartet: "fehlgeschlagene Meldungen sichtbar", tests: ["labels.spec.ts › Offene Aufträge"] },
    ],
  },
  "/auftraege/lieferschein": {
    abläufe: [
      { ablauf: "Falsche Datei hochladen", erwartet: "Fehler; Datei und Haken bleiben; Kanal bei „Offene Aufträge“ bleibt", tests: ["formulare.spec.ts › Falsche Datei"] },
      { ablauf: "Vorschau mit lauter „bitte prüfen“", erwartet: "Fehler; Auswahl je Bestellung bleibt", tests: ["formulare.spec.ts › Vorschau: alle"] },
      { ablauf: "Gewichte pflegen", erwartet: "unklare Eingabe bleibt stehen, gültige Zeile zeigt gespeicherte Werte, neue Zeile leert sich", tests: ["formulare.spec.ts › Gewichte"] },
      { ablauf: "Offene Aufträge → Versandart → Labels kaufen (Post/DHL simuliert)", erwartet: "5 Labels, Kabel als DHL-Paket, keine echten Käufe", tests: ["labels.spec.ts › Offene Aufträge"] },
    ],
  },
  "/auftraege/prep-center": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Zeitraum = Monat, Stand = letzter Bestellabruf, fehlende Gebühren als Text statt 0", tests: ["kennzahlen.spec.ts › Prep Center"] },
      { ablauf: "Frage im Fragefeld „Was kostet uns das Prep Center?“", erwartet: "exakte Zahlen je Monat aus den Testdaten + Erklärung", tests: ["fragefeld.spec.ts › Prep Center"] },
    ],
  },
  "/versand/abholung": {
    abläufe: [
      { ablauf: "Abholung per Claude: „DHL-Abholung morgen 10–12 Uhr, 12 Pakete, <Abholort>“ (Abholort vorher unter Einstellungen → Abholung angelegt)", erwartet: "erst Rückfrage mit Zusammenfassung und Hinweisen (keine feste Uhrzeit, > 10 Pakete = Anfrage), nichts gebucht; nach „Ja“ (bestaetigt) Buchung mit Auftragsnummer, Protokoll „über Claude“; doppelt und Sonntag abgelehnt; Storno über abholung_stornieren", tests: ["abholung.spec.ts › Abnahme 1: Stammdaten einmal"] },
      { ablauf: "UPS-Abholung von der Seite: UPS → Abholung buchen; Storno; VA (Service) bucht DHL", erwartet: "Paketzahl/Datum/Fenster vorbelegt, PRN 2929TEST… im Protokoll, Storno an UPS; VA bucht, Einstellungen → Abholung gesperrt", tests: ["abholung.spec.ts › Abnahme 4: UPS-Abholung in drei Klicks"] },
      { ablauf: "Vorschlag am Abend: 5 bzw. 6 fertige DHL-Labels über der Schwelle, „Vorschlag jetzt prüfen“", erwartet: "bei 5 kein Vorschlag; bei 6 Aufgabe „Abholung buchen? … DHL-Labels fertig“ mit Push, nichts gebucht; Ein-Klick „Jetzt buchen“ bucht genau das, Aufgabe erledigt", tests: ["abholung.spec.ts › Abnahme 5: mehr als n fertige Labels"] },
    ],
    offen: ["Echte DHL-Abholung: API „Parcel DE Pickup“ in der DHL-App freischalten, GKP-Benutzer mit Abholrecht, Abholorte eintragen – erste Buchung (Sandbox aus) nur live (To-do)", "Echte UPS-Abholung: App im UPS Developer Portal (OAuth + Pickup), Zugang unter Anbindungen → UPS – erste Buchung nur live (To-do)"],
  },
  "/rechnungsstation": {
    abläufe: [
      { ablauf: "50 Blätter nacheinander an der Station (VA mit Bereich Service), Stapel fertig, Prüfliste, Weitergabe", erwartet: "49 Belege (1 Zweiseiter angehängt), alle mit Lieferant/Datum, 42 automatisch zugeordnet (Bestellungen, ASIN an Charge), Kassenzettel als Ausgabe, Duplikat und fehlender Betrag rot, unsicheres Datum gelb; Aufgabe „Rechnungsstapel prüfen: 49 Belege, …, 2 unklar“; 47 an Stotax (gelb mit Vermerk), rot erst nach Prüfung; nach der Prüfung Aufgabe erledigt; unter 10 Minuten", tests: ["rechnungsstation.spec.ts › Abnahme 2: 50 Blätter"] },
      { ablauf: "PDF-Stapel (22 Seiten, 20 Rechnungen) im Scanner-Ordner, „Scanner-Ordner jetzt prüfen“; Lager ohne Zugriff", erwartet: "20 Belege (2 Zweiseiter), alle grün, Original nach verarbeitet/; Lager wird umgeleitet, Upload 403", tests: ["rechnungsstation.spec.ts › Abnahme 3: PDF-Stapel"] },
    ],
    offen: ["Kamera an der Werkbank: Auslöser (Blatt still, Ränder erkannt) und Entzerren mit echtem Papier – Logik im Unit-Test, Gerät nur live", "Einzugsscanner: Netzwerkfreigabe auf ./scan-eingang einrichten, echte PDF mit Kassenzetteln/Rechnungen – nur live", "Drive-Belegordner: Dienstkonto mit Schreibrecht, Ordner-ID in der Prüfliste (Inhaber) – nur live"],
  },
  "/rechnungsstation/pruefen": {
    abläufe: [
      { ablauf: "Prüfliste nach dem Stapel: Bild je Beleg, Duplikat-Hinweis, „Ausstehende jetzt an Stotax“, fehlenden Betrag nachtragen, Duplikat verwerfen", erwartet: "nur rote/gelbe Belege mit Bild; Weitergabe meldet „An Stotax übertragen: 47“ und bleibt im Stapel; nach Speichern geprüft und weitergegeben, verworfenes Duplikat „kein Beleg“; Liste danach leer", tests: ["rechnungsstation.spec.ts › Abnahme 2: 50 Blätter"] },
      { ablauf: "„Scanner-Ordner jetzt prüfen“ mit PDF-Stapel", erwartet: "Meldung „1 PDF aus dem Scanner-Ordner: 20 Belege“, Stapel mit 20 Belegen", tests: ["rechnungsstation.spec.ts › Abnahme 3: PDF-Stapel"] },
    ],
  },
  "/scan": {
    abläufe: [
      { ablauf: "B34.1 Abnahme 1+2: EAN + Regalpreis über das Ziffernfeld (Laden, brutto), Rückvergütung 2 %, Einkaufsliste und Deal", erwartet: "Ampel, bestes Land, Gewinn/Stück, ROI, ROI p. a. in unter 3 s wie scan_pruefen; Rückvergütung senkt den effektiven EK und hebt den ROI; „Heute gescannt“ mit Summe und Kapital-Ampel; Deal im Deal-Eingang", tests: ["b34-scan.spec.ts › Abnahme 1+2"] },
      { ablauf: "B34.1 Abnahme 3: Amazon-Link aus der Shop-App teilen (Web Share Target), Modus Online, „Kauf vorbereiten“", erwartet: "Ergebnis öffnet sich, Kauf-Link auf den Shop des geteilten Links (nichts automatisch gekauft)", tests: ["b34-scan.spec.ts › Abnahme 3"] },
      { ablauf: "B34.1 Abnahme 4: Scan ohne Netz", erwartet: "zwischengespeichert, bei Netz nachgeprüft, Push mit Ergebnis", tests: ["b34-scan.spec.ts › Abnahme 4"] },
      { ablauf: "B34.1 Abnahme 5: Kassenbon- und Preisschild-Foto", erwartet: "Kassenbon als Beleg in der Rechnungsstation, Preisschild in der Ablage des Scans", tests: ["b34-scan.spec.ts › Abnahme 5"] },
      { ablauf: "B34.1 Abnahme 0: Scan-Modus auf dem Handy-Startbildschirm, Probelauf mit 3 bekannten EANs", erwartet: "Manifest mit Kurzbefehl „Scan-Modus“, Anleitung iPhone/Android auf /scan, 3 Probe-EANs aus den eigenen Produkten liefern je eine Ampel", tests: ["b34-scan-start.spec.ts › Startbildschirm"] },
    ],
    offen: ["Kamera-Scan (BarcodeDetector/ZXing) und Vorlesen auf dem echten iPhone/Android – nur live", "Teilen-Menü der Amazon-App (Android: Web Share Target nach „Zum Startbildschirm“; iPhone: Kurzbefehl) – nur live"],
  },
  "/rechnungsstation/ablage": {
    abläufe: [
      { ablauf: "B34.2 Abnahme: Testordner mit 5 Rechnungen + 2 Dubletten, echtes Agent-Programm, Kontoauszug, Löschen einer Dublette", erwartet: "umbenannt JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr, Ordner Monat/Lieferant, Dubletten in „Dubletten“, nichts gelöscht; Kontoauszug nicht als Rechnung; Löschen erst nach Freigabe", tests: ["b34-ablage.spec.ts › Abnahme"] },
      { ablauf: "B34.2 Drive-Abnahme: Test-Ordner in Drive (Nachbau) mit 5 Rechnungen + 2 Dubletten + Kontoauszug, Schreibrecht aus/an, Freigabe der Charge, Papierkorb", erwartet: "Vorschau mit neuen Namen JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr und Zielordner Monat/Lieferant, Dublettenliste (Prüfsumme bzw. Nr + Betrag), Kontoauszug nicht als Rechnung; ohne Schreibrecht nichts geändert; nach Freigabe sortiert und umbenannt, Dubletten in „Dubletten“, nichts gelöscht; Papierkorb nur nach eigener Freigabe", tests: ["b34-drive.spec.ts › Abnahme"] },
    ],
    offen: ["Agent 1.1.0 auf dem Arbeits-PC mit dem echten Download-Ordner (Windows-Pfade, Rechte) – nur live", "Echter Kontoauszug (MT940/CAMT/PDF) und PayPal-Export – Zuordnung „Zahlung ohne Beleg“/„Beleg ohne Zahlung“ live prüfen"],
  },
  "/b2b/abverkauf": {
    abläufe: [
      { ablauf: "B34.3 Abnahme: Ladenhüter (Kapital > 300 €, keine Verkäufe) → Preisliste PDF + Excel; 10 Test-Leads per CSV; E-Mail ohne „Rechtlich geprüft“; Serienbrief-PDF; Antwort im Posteingang; erneuter Import; „Rechtlich geprüft“ an", erwartet: "Preisliste ohne EK/Break-even/interne Gründe, Preis über Break-even; 10 Leads (E-Mail nur mit Quelle Impressum, verschlüsselt); E-Mail gesperrt, keine Mail raus; Brief mit Anschrift und Datenschutzhinweis Art. 14 DSGVO (Quelle, Rechtsgrundlage, Löschfrist, Widerspruch, Abmelden); Antwort → Aufgabe, Abmeldung → Sperrliste, Import blockiert; Erfolg je Charge (Rücklauf, Umsatz, Marge) auch in der B2B-Bilanz; E-Mail erst mit Einwilligung + „Rechtlich geprüft“, mit Datenschutzhinweis", tests: ["b34-abverkauf.spec.ts › Abnahme"] },
      { ablauf: "B34.3a/3.6 Abnahme: Beilage der Logistik-Firma (Textprüfung), 3 Test-Leads, Charge, Briefversand über den LetterXpress-Nachbau im Testmodus, Testbrief, Status, AV-Haken, live", erwartet: "Beilage als eigenes Blatt mit eigenem Impressum, „all-in“/unbelegte Fläche gesperrt; Kostenvorschau 2,80 € = Kosten laut Anbieter; ohne Testbrief und ohne bestätigte Freigabe nichts beim Anbieter; Status gedruckt/zugestellt kommt zurück; live ohne AV-Haken gesperrt; Kosten je Charge und je Rücklauf", tests: ["b34-briefversand.spec.ts › Abnahme"] },
      { ablauf: "B34.3b Abnahme: Kampagne „Friseure“ mit 2 Testprodukten (MHD 06/2028 und 01/2027), Leads mit Koordinaten, Brief-PDF, Anfrageseite ohne Anmeldung", erwartet: "MHD unter 6 Monaten nicht angeboten; Umkreis 50 km zeigt nur Leads im Radius (Gründe für die anderen); Brief mit QR-Code, Kurzlink und Kampagnen-ID; falsche USt-ID abgelehnt, Anfrage → Aufgabe + Eintrag im Posteingang, Anschreiben beantwortet; Lagerkostenrechner 10 Paletten = 14,4 m³", tests: ["b34-kampagnen.spec.ts › Abnahme", "b34-kampagnen.spec.ts › Lager & Logistik"] },
      { ablauf: "B34.3c Abnahme Stufe 1: Apify-Export (Google Maps) per CSV ohne Angabe von Quelle/Datum, „Rechtlich geprüft“ an, Entwurf per Mail und per Brief, Freigabe; Keepa-Export mit Stückzahl; Impressum-Mail von Hand; LUCID-Export", erwartet: "Quelle „Apify-Export (Datei)“ und Datum aus scrapedAt automatisch; E-Mail verschlüsselt gespeichert (Quelle Impressum), Mail-Weg gesperrt – Brief erst nach Freigabe, keine Mail raus; Antwort erlaubt, wenn sich der Händler meldet; Vorschlag „Zielgruppe AdelPrep“ ab 80 Stück, Übernahme von Hand; LUCID ohne Entwurf, bis „geklärt“ gesetzt ist", tests: ["b34-lead-quellen.spec.ts › Abnahme Stufe 1"] },
    ],
    offen: ["Vor E-Mail-Versand an Fremdkontakte rechtlich prüfen lassen (keine Rechtsberatung im System)", "Echte Leads (z. B. Apify-CSV): Spaltennamen beim ersten Import prüfen", "Briefe drucken und frankieren – außerhalb des Systems"],
  },
  "/b2b/leads": {
    abläufe: [
      { ablauf: "B35.8 Abnahme: 50-Zeilen-CSV mit Dubletten (Name+PLZ, Website, USt-IdNr.), eigener Testlieferant, Konfliktbranche, Wein, Frischware, ohne Anschrift; Nachtrag nur mit gleicher USt-IdNr.; Sperre per Klick, Brief vor 30 Tagen; Charge vorbereiten (20); Beilage abwählen; Freigabe; Versand-Vorschau", erwartet: "47 neu + 3 Dubletten zusammengeführt, Nachtrag als „schon vorhanden“ zusammengeführt (Verlauf); Priorität und empfohlene Kampagne sichtbar; Lieferant/Konflikt/Frischware ausgeschlossen, Wein „Lagerbedingungen klären“, ohne Anschrift/gesperrt/Mindestabstand nie in der Charge; genau 20 Entwürfe, keine Charge, kein Brief beim Anbieter; Beilage nur bei Zielgruppe AdelPrep und je Brief abwählbar; nach Freigabe Vorschau mit 20 Briefen, weiter nichts verschickt; Auskunft als JSON", tests: ["b35-lead-maschine.spec.ts › Abnahme B35.8/B35.9"] },
      { ablauf: "B35.7/B35.9 Stufe 2: Quellen ohne Datum der rechtlichen Prüfung, dann mit Datum; Apify-Lauf (Nachbau mit steigenden Kosten, Budget 0,10 $); Google Places (2. Seite über Budget); Impressum-Abruf mit Captcha-Seite und normaler Seite; zweiter Lauf", erwartet: "ohne Prüfdatum kein Lauf-Knopf; Apify bricht bei Überschreitung ab (Abbruch beim Anbieter, Teilergebnis gespeichert, Lauf „abgebrochen“); Places stoppt vor dem 2. Abruf; Impressum: robots.txt, eigener User-Agent, ≥ Pause zwischen Abrufen, USt-IdNr./E-Mail ergänzt (Mail nur für Antworten); Captcha-Seite einmal abgerufen, übersprungen, im Wochenbericht gemeldet, nicht erneut versucht", tests: ["b35-lead-maschine.spec.ts › Abnahme B35.8/B35.9"] },
      { ablauf: "Keine Werbe-E-Mail an Leads (UWG § 7), auch nicht mit „Rechtlich geprüft“ und Einwilligung", erwartet: "Mail-Weg gesperrt, Freigabe ergibt „Nichts freigegeben“, keine Mail im Testpostfach", tests: ["b34-abverkauf.spec.ts › Abnahme", "b34-lead-quellen.spec.ts › Abnahme Stufe 1"] },
    ],
    offen: ["Rechtliche Prüfung (Stufe 2, Art.-14-Hinweis, Google-Places-Speicherregeln, LUCID) – erst danach Datum eintragen", "Echte Apify-Actor-Eingabe und Places-Preise je Abruf – beim ersten Lauf mit kleinem Budget prüfen", "Wöchentlicher Lauf (Zeitplan) nur live – im Test von Hand gestartet"],
  },
  "/marken/video": {
    abläufe: [
      { ablauf: "B36.7 Abnahme 1–3: Kanal (streng, Zielgruppe „Männer ab 55“, Länge Standard 16–20 Min.) anlegen, Worker-Token, Thema „Kein Sex mehr in der Beziehung? 5 Gründe …“ mit vidIQ-Keywords, echter Python-Worker; Gliederung, Skript, Vorschau freigeben", erwartet: "Gliederung mit 5 Punkten und 6 Quellen zur Freigabe (Websuche, vidIQ in der Recherche); Zielgruppe und „16–20 Minuten“ im Recherche-Prompt; Skript 2.600 Wörter (verlangt 2.300–2.900), 5 Punkte, alle Quellen-IDs in der Liste; MP4 1920×1080, 16–20 Min., Untertitel, Thumbnail 1280×720, 5 Titel, Beschreibung mit Kapiteln (0:00 Intro) und Quellen, Tags; Video im Player", tests: ["b36-video.spec.ts › Abnahme B36.7 1–8"] },
      { ablauf: "B36.7 Abnahme 4/7/8: Worker während „Sprache“ hart beenden, 11 Min. Stille, Neustart; Bildidee „Bett“ (streng) und abgelehnte Bildidee", erwartet: "„wartet (Worker aus)“ + „seit 11 Min. keine Meldung“; Neustart macht weiter, jede Szene genau einmal bei ElevenLabs (höchstens die beim Abbruch laufende doppelt), Bilder einmal; gpt-image-2.5-flare (gpt-image-1 abgeschaltet)/1536×1024/medium; Ablehnung → Ersatzmotiv; „Bett“ erreicht den Anbieter nicht; < 3 GB frei → kein Auftrag", tests: ["b36-video.spec.ts › Abnahme B36.7 1–8"] },
      { ablauf: "B36.7 Abnahme 5/6: Mit YouTube verbinden (Nachbau), „Privat hochladen“ an, Vorschau mit Titel 2 freigeben; Kosten", erwartet: "Refresh-Token verschlüsselt; Upload mit Sichtbarkeit private, gewähltem Titel, Thumbnail; Seller-System bestätigt „privat“; Kosten Ist > 0 mit Claude/ElevenLabs/OpenAI, Monatssumme je Kanal, Zeile im Wochenrückblick; Projektordner am PC danach aufgeräumt", tests: ["b36-video.spec.ts › Abnahme B36.7 1–8"] },
      { ablauf: "B36.6 Ablage Google Drive: Drive verbinden, Kanal ohne Freigaben (Länge 12–14 Min.), Thema des ersten Durchlaufs mit englischer Vorlage, Video bis „fertig“, danach „Privat hochladen“; Modell Opus 5.5", erwartet: "Prompt verlangt 1.750–2.050 Wörter, Skript in der Spanne; Vorlage + „Nicht übersetzen“ in der Recherche; MP4 nur in Drive („Seller-System Videos/<Kanal>/<Datum Thema>“, gleiche Größe), kleine Dateien auch im Seller-System, kein MP4 auf dem Server; Vorschau/Download leiten nach Drive; Upload holt das Video aus Drive und ist privat; Claude-Kosten mit Opus 5.5", tests: ["b36-video.spec.ts › B36.6 Ablage Google Drive"] },
      { ablauf: "B36.9 Whiteboard-Collage: Kanal im Stil Whiteboard (Figur, Referenzbild, Freigabe Szenen-Übersicht), Video bis zur Übersicht, ein Motiv „neu erzeugen“, freigeben, „Privat hochladen“", erwartet: "Motive einzeln 1024×1024 transparent mit Referenzbild, jede Motiv-Art einmal bezahlt, Hand einmal, Figur aus dem Profil, Ablehnung → Ersatzmotiv; Übersicht als Bild, „neu erzeugen“ kostet genau 1 Bild; Video 1920×1080 beginnt leer, weißer Hintergrund, keine eingebrannten Untertitel, roter Balken; Kosten je Motiv; privater Upload mit Untertitel-Spur „Deutsch“", tests: ["b36-video.spec.ts › B36.9/B36.10 Whiteboard-Collage"] },
      { ablauf: "B36.10 Tempo (13.11.): Whiteboard-Kanal mit Tempo „schnell“, Skript in kurzen Szenen, Sprache mit Wortzeiten, Szenen-Übersicht, Render", erwartet: "mindestens 55 Szenen mit je höchstens 2 Sätzen; Schlüsselwort je Motiv aus dem Szenentext; jede Szene bei ElevenLabs „with-timestamps“; je Szene höchstens 3 s ohne neue Aktion, im Schnitt höchstens alle 3 s eine Aktion, Zeichenzeit 1,5 s; Lücken mit Unterstreichen/Einkreisen/Pfeil gefüllt; Hinweis „Takt: N Szenen, Ø alle … s“ in der Szenen-Übersicht; Video mit Zoom, beginnt leer, keine eingebrannten Untertitel", tests: ["b36-video.spec.ts › B36.9/B36.10 Whiteboard-Collage"] },
      { ablauf: "B37 Instagram-Stories Abnahme 1–6: Kanal „Testkanal Instagram“ (täglich 12:00, Freigabe jedes Mal, Limit 5 $, Fakten), 5 Themen + eigenes Foto, Stories erzeugen, Handy-Vorschau, Regelverstoß, Neu erzeugen/Motiv neu/Ablehnen, Freigeben, Instagram verbinden, posten mit Fehlern und abgelaufenem Zugang, Limit", erwartet: "5 Stories + 1 Regel-Test als MP4 1080×1920 (5–15 s) zur Freigabe; Einblick mit eigenem Foto ohne Bildanbieter; Handy zeigt alle ohne seitliches Scrollen; Preis nur aus den Fakten, „Enthalten:“, keine „kostenlose Zählung“/Komplettpreis/Versicherung, „Werbung“ bei Preis/Leistung/CTA; Regelverstoß → Hinweis + Freigabe gesperrt; Neu erzeugen ohne neues Motiv, „Motiv neu“ genau 1 Bild; Ablehnen = nichts gepostet; ohne Verbindung „von Hand posten“; nach Verbindung zur Planzeit gepostet (Datei über signierten 24-h-Link, falsche Signatur 404); 4 Fehlversuche → „nicht gepostet“ + Meldung; abgelaufener Zugang sofort gemeldet; Erneut posten; Kosten je Story > 0, Monatslimit sperrt Erzeugen/Planen, wartende Story „Monatslimit erreicht“", tests: ["b36-video.spec.ts › B37 Instagram-Stories"] },
      { ablauf: "B36.10 Nachtrag: fertiges, privat hochgeladenes Whiteboard-Video → „Im neuen Takt neu machen“ (gleicher Text), Szenen-Übersicht freigeben", erwartet: "Kostenschätzung vorab (Sprache mit Wortzeiten, Motive aus der Bibliothek); Auftrag ab Skript, YouTube-ID und „Privat hochladen“ zurückgesetzt, alter Text als eigenes Skript; keine neue Recherche/Websuche; mindestens 55 kurze Szenen; Sprache je Szene einmal mit Wortzeiten; kein neues Motiv bezahlt; neues Video fertig, Upload erst wieder von Hand", tests: ["b36-video.spec.ts › B36.10 „Im neuen Takt neu machen“"] },
      { ablauf: "Nachtrag 13.11. Sprechtempo/Zeichnen/Hand: Whiteboard-Video mit Sprechtempo 1,1 und Motiv-Stil Strichzeichnung rendern", erwartet: "ElevenLabs mit speed 1,1 und den gespeicherten Stimmeinstellungen (Stabilität bleibt); Stille vor/nach jeder Szene abgeschnitten, höchstens 0,3 s zwischen Szenen; Wörter/Min. ≥ 135 im Auftrag; alle Motiv-Prompts außer Glühbirne „Schwarze Strichzeichnung … keine Flächen“, kein „Filzstift“; keine Hand vom Bildmodell; Hand im MP4 sichtbar", tests: ["b36-video.spec.ts › B36.9/B36.10 Whiteboard-Collage"] },
      { ablauf: "Nachtrag 13.11. Probeszene: fertiges Whiteboard-Video, Sprechtempo 1,15, „Probeszene (20 s)“ ab Szene 3, danach Warnung unter 135 Wörter/Min. und „Neu vertonen & zeichnen“", erwartet: "probe.mp4 1920×1080, höchstens 20,3 s, Hand sichtbar; ElevenLabs speed 1,15; keine neuen Bilder; Status und Freigaben des Videos unverändert, Ergebnis mit Wörter/Min. auf der Seite; Vorschau-Freigabe mit 95 Wörtern/Min. zeigt Warnung; Neu vertonen vertont nur die übrigen Szenen, ergibt ≥ 135 Wörter/Min.", tests: ["b36-video.spec.ts › Nachtrag 13.11. Probeszene"] },
      { ablauf: "Nachtrag 13.11. (2) Vollbild in Bewegung + Pexels: Vollbild-Kanal mit „Bildwechsel alle 6 s“ und „Echte Videoclips“ (Pixabay), Video bis zur Vorschau rendern", erwartet: "Bildplan von Claude (ein Aufruf je 25 Szenen); im Schnitt alle 4–8 s ein neues Bild oder ein Clip, Start je Element beim Schlüsselwort; jedes Bild fährt (Bildausschnitt ändert sich innerhalb des Bilds); mindestens ein Viertel Clips, Clips von Pixabay (Suche ≤ 15 Treffer, safesearch, nur Filme), jede Clip-Datei einmal geladen, Filmer in der Beschreibung; Bildaufrufe = verschiedene Bilder + 1 Ablehnung", tests: ["b36-video.spec.ts › Abnahme B36.7 1–8"] },
      { ablauf: "Nachtrag 13.11. (2) Hand: Whiteboard-Video und Probeszene mit der Foto-Hand", erwartet: "Hand (Hautton) in mehreren Einzelbildern der ersten Szenen und der Probeszene sichtbar; unterer Rand ohne Untertitel", tests: ["b36-video.spec.ts › B36.9/B36.10 Whiteboard-Collage", "b36-video.spec.ts › Nachtrag 13.11. Probeszene"] },
      { ablauf: "Nachtrag 13.11. (3) Pixabay statt Pexels: Anbindungen → Pixabay „Verbindung testen“ (gültig/falsch), Brücke /pixabay/videos ohne, mit falschem und mit gültigem Schlüssel", erwartet: "gültig → „Schlüssel gültig. Videosuche funktioniert“; falsch → „Schlüssel abgelehnt“ bzw. HTTP 401, nie Teile des Schlüssels; ohne Schlüssel 424; Antwort im Pexels-Format (IDs pixabay-…, leere Größen weg), höchstens 15 Treffer, fremder Pfad 404; im Video (B36.7) alle Clips von Pixabay, Pexels nicht gefragt, Nachweis „Videos: Pixabay (pixabay.com) – …“", tests: ["b36-video.spec.ts › Pixabay: „Verbindung testen“ und Brücke", "b36-video.spec.ts › Abnahme B36.7 1–8"] },
      { ablauf: "Nachtrag 13.11.: Störung beim Anbieter – „Skript – Punkt 3“ scheitert 5-mal (529), danach „Jetzt neu versuchen“", erwartet: "Status „wartet“ statt „Fehler“, neuer Versuch automatisch in 10 Min. (danach 30, 60), Hinweis „Störung beim Anbieter in „Skript“ … (1/3)“; „Jetzt neu versuchen“ holt nur den fehlenden Abschnitt und die danach; alle Claude-Aufrufe mit mindestens 16.000 Tokens Platz (Denken zählt mit)", tests: ["b36-video.spec.ts › Abnahme B36.7"] },
      { ablauf: "B36 Robustheit (12.11.): Recherche und Skript abschnittsweise; im Nachbau bricht der Hook einmal mitten im Stream ab, Quellen „Punkt 2“ einmal 529, „Punkt 3“ 5-mal Abbruch, ElevenLabs 2-mal Abbruch; danach „Schritt wiederholen“", erwartet: "Abbrüche/529 nach 2, 4, 8, 16 s wiederholt (Log „neuer Versuch“); nach 5 Fehlversuchen Schritt-Fehler „Skript – Punkt 3: nach 5 Versuchen nicht geklappt“; fertige Abschnitte als Dateien im Projektordner; Wiederholen holt nur Punkt 3 bis CTA; Skript 1.500–1.700 Wörter, 5 Punkte, alle Studien in der Quellenliste; Sprache je Szene genau einmal bezahlt", tests: ["b36-video.spec.ts › Abnahme B36.7 1–8"] },
      { ablauf: "B36 Bildmodell (13.11.): Standard, Wahl auf der Seite (Sunburst), gewähltes Modell im Konto gesperrt; OpenAI „Verbindung testen“ mit gültigem und falschem Schlüssel (Pfad statt Schlüssel); Brücke mit falschem Schlüssel", erwartet: "Bilder mit gpt-image-2.5-flare, nie gpt-image-1; Wahl gespeichert und bei jedem Bild benutzt, Kosten-Zeile nennt das Modell; gesperrtes Modell einmal versucht, dann Flare; Test „Schlüssel gültig. Bildmodell für Videos: …“ bzw. „Schlüssel abgelehnt (HTTP 401)“; Brücke 401 „OpenAI-Schlüssel abgelehnt … neu eintragen“ ohne Schlüsselteile", tests: ["b36-video.spec.ts › OpenAI: „Verbindung testen“"] },
      { ablauf: "Video aus dem claude.ai-Chat anlegen (video_auftrag_anlegen): Kanal, Thema, eigenes Skript, Startzeit – erst ohne, dann mit Bestätigung", erwartet: "Erst Rückfrage „Soll ich das Video so anlegen?“ mit Kanal, Stil, Länge, Zielgruppe, Start, Kostenschätzung und Freigaben, nichts angelegt; klare Fehler (Kanal unbekannt, Skript zu kurz, Startzeit); nach Ja Auftrag mit Skript und Startzeit (wartet), Protokoll Stufe gelb; ohne Änderungsrecht nicht in der Werkzeugliste", tests: ["b36-video.spec.ts › Werkzeug video_auftrag_anlegen"] },
    ],
    offen: ["Echte Anbieter (Claude-Websuche, ElevenLabs-Stimme, gpt-image-1, YouTube-Upload, Google Drive) – erstes Video mit echten Zugängen prüfen", "B36.9 Sichtvergleich Testvideo ↔ Referenzvideo (echte Motive, Hand, Schrift, Farben)", "Worker unter Windows (Docker Desktop bzw. Python + ffmpeg) – Einrichtung am Arbeits-PC", "vidIQ Stufe 2 (eigene API) und Shorts – nicht Teil dieses Auftrags", "B36.10 Sichtprüfung am echten Video (Takt, Zoom, Wisch, Hervorhebungen)", "Nachtrag 13.11.: Probeszene am echten Video „Vakuumpumpe“ (Worker 1.4.0, echte Stimme und Motive) ansehen, dann neu vertonen & zeichnen", "Nachtrag 13.11. (2)/(3): Pixabay-Schlüssel eintragen (Pexels vergibt zurzeit keine), Probeszene am Vollbild-Video des Uhren-Kanals ansehen, dann neu bebildern & rendern", "B37 echtes Instagram-Konto: Meta-App, App-Prüfung (instagram_business_content_publish), öffentliche https-Adresse, erste Story live"],
  },
  "/repricer": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl; „Ohne EK“ mit Link zu den betroffenen Artikeln", tests: ["kennzahlen.spec.ts › Repricer"] },
      { ablauf: "BQool-Export „Manage Listings“ hochladen", erwartet: "Rückmeldung mit Anzahl je Marktplatz, Auffälligkeiten (ohne Min, pausiert, ohne Regel) in der Tabelle und im Werkzeug „repricer“", tests: ["geschaeft.spec.ts › BQool-Export"] },
      { ablauf: "B15.11 Übersicht je Regel, Filter, alle Länder", erwartet: "Regel mit DE/FR, aktiv/pausiert richtig (Angebotsstatus „Inactive“ ≠ pausiert); Filter Land und Status", tests: ["b15-anzeige.spec.ts › Repricer"] },
      { ablauf: "B25.5 /repricer/export ohne Format", erwartet: "leitet auf die Vorschau „BQool-Dateien“ mit Warnungen je Land; CSV nur mit ?format", tests: ["b25.spec.ts › B25.3/B25.5/B25.6/B25.7"] },
    ],
    offen: ["Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen"],
  },
  "/repricer/bqool": {
    abläufe: [
      { ablauf: "B31 täglicher BQool-Kreislauf: Ist DE/FR/IT/ES holen, Soll erzeugen, Push „BQool-Upload freigeben“, ohne Freigabe nichts, Freigeben → Upload je Land (Dateityp Repricing Central) mit Rückmeldung und Fehlerzeilen-Aufgabe, Nachkontrolle, Verfall, automatisch nur nach Min-Prüfung", erwartet: "Ist aller 4 Länder mit Stand heute (repricer „bqool_stand: heute …“), Push „DE 2 / FR 1 / IT 1 / ES 1 Änderungen, 0 Regelwechsel …“ mit Freigeben/Ansehen, nichts hochgeladen bis zur Freigabe, danach 4 Dateien mit Typ „repricing“, „1 Fehlerzeile“ als Aufgabe, Nachkontrolle „Min und Regel stimmen bei allen 4 SKUs“, Min DE = effektiver Min unter der Buy Box; verfallener Lauf lädt nichts hoch; „automatisch“ erst mit bestätigtem Min-Verhalten", tests: ["b31-bqool-kreislauf.spec.ts › Ist aller Länder"] },
      { ablauf: "Ist hochladen → Abgleich → Liquidation → Export DE/FR → Übertragen mit Bestätigung", erwartet: "Dateien im BQool-Format, je Land eigene Upload-Seite, ein Land fehlgeschlagen → Aufgabe", tests: ["bqool-dateien.spec.ts › Ist hochladen"] },
    ],
    offen: ["Echte BQool-Seiten: Export-Seite DE (Download „Full Template“) und Upload-Dateityp „Repricing Central File“ – einmal mit „Verbindung testen“ und „Jetzt starten“ prüfen (nur live)", "Min-Verhalten in BQool an einer SKU nachsehen, dann Häkchen „Min-Verhalten geprüft“ (B31.3)"],
  },
  "/repricer/leistung": {
    abläufe: [
      { ablauf: "B31.5 Abnahme 5: vier „Listing Performance“ (je Land) + „Daily Sales“ per Upload; Land offen → Rückfrage", erwartet: "Typ und Land erkannt (DE über Regelname, FR/IT/ES über SKU-Abgleich, Daily Sales DE über Umsatzsumme), Buy Box je Land wie in den Dateien, Listen „unter Min ohne Buy Box“ (Min senken), „Verlust“ (Liquidation), „Preisbewegung“ (Aufgabe „BQool-Regel prüfen“), Gewinn-Seite Spalte BQool je Tag, Verlust-Stopp zweite Quelle, Claude repricer/umsatz/verlust_stopp; unbekannte SKUs → „Welches Land?“", tests: ["b31-5-bqool-berichte.spec.ts › Abnahme 5"] },
      { ablauf: "B31.5 täglicher Lauf holt die Berichte selbst", erwartet: "„Listing Performance“ mit „Last 7 days“ und „Daily Sales“ je Land heruntergeladen und ohne Rückfrage eingelesen, Abruf „BQool: Berichte“", tests: ["b31-5-bqool-berichte.spec.ts › Automatik"] },
      { ablauf: "B31.6 Abnahme 6: gewünschter Min unter effektivem Min (ia) → Test mit einer SKU → BQool-Lauf", erwartet: "Regelwechsel „ia → Liquidation“ mit festem Min (nie unter Break-even ohne Freigabe), bis zum Test nicht in der Datei; Test-Export mit Rule Name „Liquidation“ und festem Min; nach dem BQool-Lauf aktiv mit Verlust-Stopp-Ausnahme, Min bleibt stehen → Test bestanden, Regelwechsel im vollen Export; Repricer „Regel seit“ + Filter, Kapital-Ampel-Zeile", tests: ["b31-6-liquidation.spec.ts › Abnahme 6/7"] },
      { ablauf: "B31.6 Abnahme 7: Buy Box 14 Tage über effektivem Min + 3 %", erwartet: "Tag 13 kein Vorschlag, Tag 14 „zurück auf ia“ mit Aufgabe und Werkzeug-Feld; nach Freigabe Soll wieder ia (effektiver Min), Liquidation beendet, Ausnahme entfernt", tests: ["b31-6-liquidation.spec.ts › Abnahme 6/7"] },
      { ablauf: "B31.6a/b Regel-Leiter: 1 → 2, 2 → 3, Liquidation läuft ab", erwartet: "Vorschläge je Stufenwechsel mit Freigabe (Soll Abverkauf bzw. Liquidation mit Min = max(Break-even, Buy Box − 1 %)), 7 Tage vor „Liquidation bis“ Aufgabe mit drei Knöpfen, +30 Tage, automatisch verlängert, dauerhaft; Spalten Stufe/Liquidation bis, Filter „läuft in 7 Tagen ab“", tests: ["b31-6ab-7-8-b32.spec.ts › 1 → 2 und 2 → 3"] },
      { ablauf: "B31.7 Abnahme 1–4: Zustand der Ware", erwartet: "RET_-SKU gebraucht mit Zielpreis und Min gebraucht (Export-Vorschau), unbekannt ohne Upload + Aufgabe, Zustand von Hand rechnet Zielpreis neu, Vorschlag „aktivieren“", tests: ["b31-6ab-7-8-b32.spec.ts › Abnahme 1–4: RET_-SKU"] },
      { ablauf: "B31.8 Abnahme 1–4: Schnelldreher-Schutz", erwartet: "Kennzeichen von Hand, Min = Break-even + 7 %, kein Stufenwechsel, Morgenbericht-Zähler, nach 21 Tagen ohne Buy Box Vorschlag mit drei Knöpfen", tests: ["b31-6ab-7-8-b32.spec.ts › Abnahme 1–4: Kennzeichen"] },
      { ablauf: "B32 Listing-Check Abnahme 1–3, 5", erwartet: "Befund 1 (Min über Buy Box) und 2 (pausiert), Freigabe → nächster Upload, Schwellen änderbar, Budget/„Check unvollständig“, Morgenbericht-Zeile „Listing-Check“, Werkzeug listing_check", tests: ["b31-6ab-7-8-b32.spec.ts › Abnahme 1–3, 5"] },
      { ablauf: "B33 Abnahme 1–5: BQool-Formel, Katalog je Land, Min-Reset, „Download listings“, Processing Report", erwartet: "effektiver Min = P(m) mit FBA/Provision des Landes aus der BQool-Liste (FR ≠ DE), Katalog je Land und Stufe mit Typ/Marge/Bedingung (ohne feste Marge keine Prozentzahl), Vorschau „Min wird von BQool täglich überschrieben“ bei ia, Nachkontrolle per „Download listings“ mit Min vorher/Datei/nachher (Reset = Hinweis, Liquidation = Fehler), Upload-Fehler aus „View Processing Report“ mit deutscher und BQool-Zeit", tests: ["b33-bqool-formel.spec.ts › Abnahme 1–5"] },
    ],
    offen: ["B33: Stufen je Land einmal gegen die BQool-Screenshots prüfen, Listen-Seite …/repricing/amazonde eintragen, Processing Reports vom 07.11. beim ersten Lauf live lesen", "Echte BQool-Berichtsseiten „Listing Performance“/„Daily Sales“ unter Anbindungen eintragen und einmal „Jetzt starten“ (nur live)", "Spalte „Products“ der echten Datei: SKU-Erkennung beim ersten Upload prüfen (Ergebnis nennt Zeilen ohne SKU)"],
  },
  "/bestand": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl, keine kaputten Werte", tests: ["kennzahlen.spec.ts › Bestand"] },
      { ablauf: "Inventur scannen", erwartet: "bucht +1, Feld leert sich für den nächsten Scan", tests: ["formulare.spec.ts › Inventur-Scanner"] },
      { ablauf: "B15.3 Prep Center verschickt", erwartet: "eigenes Lager unverändert; alte Fehlbuchung als Vorschlag, Zurückbuchen nur auf Klick", tests: ["b15-sofort.spec.ts › Prep Center"] },
    ],
  },
  "/inbound": { abläufe: [{ ablauf: "FBA-Sendung scannen", erwartet: "unbekannter Code → Fehler; gültiger Code bucht; Karton-Auswahl bleibt", tests: ["formulare.spec.ts › Scanner: unbekannter Code"] }] },
  "/paletten": { abläufe: [{ ablauf: "B15.13 Palette ohne Kunde", erwartet: "Warnung mit Palettennummer, Filter „ohne Kunde“", tests: ["b15-anzeige.spec.ts › Palettenlager"] }] },
  "/paletten/sendungen": {
    abläufe: [
      { ablauf: "Anlegen, verschieben, Meldung an alle, Kunden-Link, abgelaufen, zurückgezogen", erwartet: "Meldung im System + Mail (abgefangen), Kunden sieht nur Freigegebenes, Links verfallen", tests: ["sendungen.spec.ts › Anlegen"] },
      { ablauf: "Notiz über Claude bzw. Fragefeld", erwartet: "nur mit Recht; Mitarbeiter als Vorschlag mit Ausführen/Ablehnen", tests: ["rechte.spec.ts › Claude-Konnektor"] },
    ],
  },
  "/remissionen/pruefungen": {
    abläufe: [
      { ablauf: "Retouren-Station: Paket mit 4 Artikeln ohne Tastatur/Maus (Sprache + Handscanner)", erwartet: "Remission über Etikett, Lieferschein-Abgleich, LPN → Kundenretoure; Fall nur ab Schwelle und wenn Amazon nicht gezahlt hat; KI-Warnung bei Abweichung; Netz weg → Warteschlange; Video je Paket", tests: ["retouren-station.spec.ts › Paket mit 4 Artikeln"] },
      { ablauf: "Fall-Paket und Eingereicht", erwartet: "Text DE/EN, Fotos 1_Versandetikett … 4_Inhalt in fester Reihenfolge, ZIP, Anspruch mit Betrag/Frist, Fallnummer + Eingereicht im Verlauf; RET-SKU mit EK der Charge", tests: ["retouren-station.spec.ts › Paket mit 4 Artikeln"] },
      { ablauf: "Rechte der Station", erwartet: "ohne Bereich Amazon kein Zugriff auf Station, Schnittstelle und Fotos", tests: ["retouren-station.spec.ts › Rechte"] },
    ],
    offen: ["Echte Hardware: Spracherkennung im Lager (Lärm), LPN-Erkennung per Kamera ≥ 95 % bei gutem Licht, Handscanner-Modell", "Echte KI-Erkennung von Etikett/Lieferschein mit echten Paketen", "Fristen der Anspruchsarten mit der aktuellen Amazon-Richtlinie abgleichen"],
  },
  "/b2b": {
    abläufe: [
      { ablauf: "B25.10 Wo Deal-Blatt, Sammelbestellung und Prep-Export erscheinen", erwartet: "Hilfe-Kasten auf der B2B-Seite (offen, solange kein Deal da ist)", tests: ["b25.spec.ts › B25.10/B25.12"] },
      { ablauf: "B15.12 SKU-Kürzel in der Lieferantenliste", erwartet: "Kürzel in eigener Liste, nicht bei den Freigaben; „Ist ein Lieferant“ nur auf Klick", tests: ["b15-anzeige.spec.ts › Lieferanten"] },
      { ablauf: "Deal anlegen, Prognose je Land, Rechenhilfe, Freischalten nur mit Vertriebsfreigabe, Discord", erwartet: "Prognose DE/FR/IT/ES (Keepa) und NL (Amazon live); Warnung bei negativem Verdienst; ohne Freigabe des Lieferanten kein Freischalten; Discord „neu“, „fast weg“, „geschlossen“", tests: ["b2b-deals.spec.ts › Freischalten nur mit Vertriebsfreigabe", "b2b-deals.spec.ts › Abnahme"] },
      { ablauf: "Abnahme: 1 Deal, 3 Kunden, 1 Fehlmenge", erwartet: "VIES → Reverse Charge nur FR; Mengengrenzen im Portal; Vorkasse-Rechnungen (Lexoffice), Zahlungsabgleich, Bestellung Entwurf → Freigabe → Senden nur mit Haken; Wareneingang 54/60 → anteilig 18/27/9, 3 Gutschriften, Reklamation; Export CSV/XLSX/PDF; verteilt → erledigt", tests: ["b2b-deals.spec.ts › Abnahme"] },
      { ablauf: "Kundenportal getrennt", erwartet: "eigene Anmeldung (Einladungs-Link, einmalig); nur eigene Reservierungen und Belege; kein Zugang ins Seller-System, Mitarbeiter-Anmeldung gilt im Portal nicht", tests: ["b2b-deals.spec.ts › Abnahme", "b2b-deals.spec.ts › Portal"] },
      { ablauf: "Preislisten je Land, Lieferanten-Mail, Claude-Werkzeuge, Erfolgskontrolle", erwartet: "KI ordnet unklare Spalten zu; Ampel/Filter/Export; Deal aus Zeile; Mail-Anhang wird übernommen (Aufgabe); deal_anlegen/preis/freischalten protokolliert, Kunden ohne Kontaktdaten; Kontrolle 30/60 Tage je Land", tests: ["b2b-preislisten.spec.ts › Preisliste", "b2b-preislisten.spec.ts › Lieferanten-Antwort", "b2b-preislisten.spec.ts › Claude-Werkzeuge", "b2b-preislisten.spec.ts › Erfolgskontrolle"] },
    ],
    offen: [
      "Echte Lexoffice-Anbindung mit dem Schlüssel der Deal-Firma (Rechnungsnummern, Reverse-Charge-Text, PDF)",
      "Echter VIES-Abruf mit eigener USt-IdNr. (Kennung der qualifizierten Abfrage)",
      "Discord-Webhook im echten B2B-Kanal",
      "PrepTool (preptool.de): API-Anbindung folgt, sobald Instanz-Adresse und OpenAPI-Datei vorliegen – bis dahin Export neutral (CSV/XLSX/PDF)",
      "Steuer: Reverse Charge nur, wenn die Ware Deutschland verlässt – bei FBA-Versand in DE mit dem Steuerberater klären",
    ],
  },
  "/ansprueche": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl", tests: ["kennzahlen.spec.ts › Ansprüche"] },
      { ablauf: "Als eingereicht markieren (über Claude)", erwartet: "nur mit Freigabe „ändern“; Status, Fallnummer, Zeitpunkt und Protokolleintrag „über Claude“; zweiter Aufruf ändert nichts Falsches", tests: ["geschaeft.spec.ts › Archivieren und „Anspruch eingereicht“"] },
    ],
  },
  "/gewinn": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Zeitraum, Quelle, Stand; keine kaputten Werte", tests: ["kennzahlen.spec.ts › Gewinn"] },
      { ablauf: "B15.4 Quelle je Zeile, sellerboard als Ersatz, Amazon-Zeile", erwartet: "Abrechnung nur bis Monatsmitte → Amazon aus sellerboard; ohne sellerboard Hinweis „Zeitraum danach fehlt“; USt.-Zeilen und Rücklagen nicht im Ergebnis", tests: ["b15-zahlen.spec.ts › Gewinn"] },
      { ablauf: "B25.1 Abrechnung aus dem Transaktionsbericht (auch ältere Importe)", erwartet: "fehlende Abrechnungszeilen aus gespeicherten Transaktionen nachgezogen; genauere Datei ersetzt sie; Übertrag = Auszahlung, nie Umsatz; keine Doppelzählung", tests: ["b25.spec.ts › B25.1/B25.2"] },
    ],
    offen: ["Amazon-Zeile mit echten Abrechnungen gegen sellerboard vergleichen (−525 € laut Testbericht)"],
  },
  "/cashflow": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Schätzungen mit „≈“, „keine Daten“ statt 0", tests: ["kennzahlen.spec.ts › Cash Flow"] },
      { ablauf: "Kontoauszug einlesen, Amex erkannt, großer Einkauf in der Amex-Woche", erwartet: "Woche „unter Reserve“, Was-wäre-wenn meldet Unterschreitung", tests: ["teil2.spec.ts › Liquidität"] },
    ],
  },
  "/hebel": { abläufe: [{ ablauf: "Kennzahlen", erwartet: "geschätzte Werte gekennzeichnet", tests: ["kennzahlen.spec.ts › Hebel"] }] },
  "/kapital": {
    abläufe: [
      { ablauf: "Ladenhüter (Reichweite > 120 T) wird rot mit Vorschlägen", erwartet: "Ampel rot, „Nicht nachbestellen“", tests: ["teil2.spec.ts › Kapital-Ampel"] },
      { ablauf: "Kennzahlen", erwartet: "Zeitraum, Quelle, Stand", tests: ["kennzahlen.spec.ts › Kapital-Ampel"] },
      { ablauf: "B28.7 Abnahme 7: drei erhaltene Einkäufe eines Testlieferanten mit FBA-Sendungen und Monatswerten, ein Einkauf > 45 Tage offen, Umsatz 30 Tage", erwartet: "Cash-to-Cash-Zyklus mit Medianen (4/3/8 T + 14 T Auszahlung), je Lieferant, Kapital ÷ Monatsumsatz, Hinweis „Einkäufe bereinigen“; kapital_ampel.cash_to_cash; Deal-Eingang nimmt den eigenen Vorlauf", tests: ["b28-umschlag.spec.ts › Abnahme 7"] },
      { ablauf: "Hinweis gestrandeter Bestand + weitere Amazon-Gebühren", erwartet: "Stück, gebundenes Kapital, Langzeit-Lagergebühr", tests: ["amazon-berichte.spec.ts › Kontozustand, gestrandet"] },
    ],
  },
  "/verlust": {
    abläufe: [
      { ablauf: "2 von 3 Tagen im Minus → Fall + wichtige Aufgabe; Ausnahme → Aufgabe erledigt, Wochensumme sichtbar", erwartet: "Aufgabe „verlust-<SKU>“ offen/wichtig bzw. nicht mehr offen", tests: ["teil2.spec.ts › Kapital-Ampel"] },
      { ablauf: "Kennzahlen", erwartet: "Zeitraum, Quelle, Stand", tests: ["kennzahlen.spec.ts › Verlust-Stopp"] },
    ],
    offen: ["Echte sellerboard-Tageswerte je Produkt (kommen mit „Gewinn je Produkt und Tag“ um 04:00 und 13:00)"],
  },
  "/echtheit": { abläufe: [{ ablauf: "Marke anlegen, Rechnung erkannt, Abdeckung, Audit-Paket", erwartet: "Beleg + SKU im Ordner, ZIP (PK…)", tests: ["teil2.spec.ts › Echtheits-Ordner"] }] },
  "/amazon-business": {
    abläufe: [
      { ablauf: "Geschäftsbericht (CSV) hochladen, Staffelpreis-Vorschlag übernehmen, Freigabe, Upload-Datei", erwartet: "B2B-Werte je ASIN, Status freigegeben, Datei mit business-price", tests: ["teil2.spec.ts › Amazon Business"] },
      { ablauf: "Kennzahlen", erwartet: "Zeitraum, Quelle, Stand", tests: ["kennzahlen.spec.ts › Amazon Business"] },
    ],
    offen: ["Übertragung der Staffelpreise über die Amazon-Schnittstelle (Listings, B2B-Angebot) – live mit echter Freigabe prüfen"],
  },
  "/calls": {
    abläufe: [
      { ablauf: "Google-Doc importieren → KI-Punkte → übernehmen → Aufgabe mit Link; Offene Punkte; Discord-Kanal", erwartet: "4 Punkte, Aufgabe (amazon) mit Frist, Fragen/Consultant-Punkte offen, Zusammenfassung mit Teilnehmern, 1 neuer Call aus Discord", tests: ["teil2.spec.ts › Call-Archiv"] },
      { ablauf: "Umzug aus dem bisherigen Call-Archiv: Export (JSON) hochladen, zweimal", erwartet: "Call mit Zusammenfassung und Google-Doc-Link, 3 Vorschläge; zweiter Import: „1 waren schon da“", tests: ["teil2.spec.ts › Umzug aus dem bisherigen Call-Archiv"] },
      { ablauf: "Wochen-Calls der Deal-Gruppe auf einmal: Word + ZIP (Text, Untertitel) + Link aus Discord-Kopie; Titel/Datum ändern; nochmal hochladen", erwartet: "4 Calls mit Datum aus Dateiname/Kopfzeile, KI im Hintergrund fertig, Wissen aus dem Call im Wissen (Quelle, Einschätzung, Suche), Datum geändert; zweites Hochladen: Kopie (gleicher Inhalt) und Link übersprungen", tests: ["teil2.spec.ts › Wochen-Calls der Deal-Gruppe"] },
      { ablauf: "B25.12 Suchfeld über alle Transkripte", erwartet: "eingefügter Call wird über ein Wort aus dem Transkript gefunden; ohne Treffer „Kein Call enthält …“", tests: ["b25.spec.ts › B25.10/B25.12"] },
      { ablauf: "Gruppen-Kanäle (Discord, nur lesen): Nachrichten mehrerer Nutzer, Deal, Kanal „aus“, alter Rohtext", erwartet: "Tageszusammenfassung (Quelle Chat), Insider-Wissen mit Link, Frühwarnung mit eigenem Abgleich, Deal im Deal-Eingang, Kanal „aus“ nicht gelesen, Bot schreibt nie, keine Namen an die KI, Rohtext > 30 Tage gelöscht", tests: ["recht-discord.spec.ts › Teil B"] },
    ],
    offen: ["Echter Discord-Bot im Call-Kanal (Bot-Token, Kanal-ID) und Freigabe der Google Docs", "Export des bisherigen Call-Archivs auf dem Server hochladen (echte Daten, nicht im Repo)", "Gruppen-Kanäle: Bot vom Server-Admin der Deal-Gruppe eingeladen (nur Leserechte)"],
  },
  "/wissen": {
    abläufe: [
      { ablauf: "Wissen aus Calls: KI-Auszug je Call, Bereich „Aus Calls“, Eintrag mit Quelle, Suche", erwartet: "Einträge mit Einschätzung und Link zum Call, im Bereich „Aus Calls“ und in der Suche", tests: ["teil2.spec.ts › Wochen-Calls der Deal-Gruppe"] },
      { ablauf: "Anleitung anlegen und beim Zuweisen anhängen", erwartet: "Anleitung im Wissen, 📘 an der Aufgabe", tests: ["teil2.spec.ts › Anleitung im Wissen"] },
    ],
  },
  "/calls/offen": { abläufe: [{ ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl, keine kaputten Werte", tests: ["kennzahlen.spec.ts › Offene Punkte Consultant"] }] },
  "/kalender/zeiten": { abläufe: [{ ablauf: "Freier Tag → Aufgabe wandert auf den nächsten Arbeitstag; Wochenrückblick", erwartet: "Fälligkeit verschoben, Rückblick sichtbar", tests: ["teil2.spec.ts › Feste freie Zeiten"] }] },
  "/board": { abläufe: [{ ablauf: "Aufgabe zuweisen hängt passende Anleitung an; zugewiesene Person sieht sie", erwartet: "📘-Link auf der Karte, auch bei der Assistenz", tests: ["teil2.spec.ts › Anleitung im Wissen"] }] },
  "/privat/familienaufgaben": { abläufe: [{ ablauf: "Familien-Zugang: Aufgabe anlegen, Fairness aus; kein Geld/Tagebuch/Geschäft", erwartet: "nur Familienliste + Familienkalender", tests: ["teil2.spec.ts › Familien-Zugang"] }] },
  "/deal-eingang/lernen": { abläufe: [{ ablauf: "B28.8 Abnahme 8: zwei Verlustprodukte + ein Gewinner im Vormonat, „Liste jetzt erstellen“, „Nie wieder“ mit Grund und Freitext, Büro-Kraft mit Deal-Eingang-Zugriff", erwartet: "Liste des Vormonats (größter Verlust zuerst, Gewinner fehlt), Antwort gespeichert und im Lernbericht + deal_lernen_bericht.lernschleife, Büro-Kraft sieht keine Knöpfe", tests: ["b28-umschlag.spec.ts › Abnahme 8"] }] },
  "/deal-eingang/lugru": { abläufe: [{ ablauf: "Lugru Deals über Discord: History, Live-Post, Reaktion, doppelter Post, eigener Kauf, Statistik, deal_quellen, Deal-Wert", erwartet: "Live-Post im Deal-Eingang mit Ampel (Push nur Grün/Gelb), History mit Reaktionen, Statistik aktualisiert, „Lugru Deals“ in deal_quellen, keine Namen gespeichert", tests: ["lugru-deals.spec.ts › History, Live-Post"] }] },
  "/privat/therapie-bogen": { abläufe: [{ ablauf: "Therapie-Bogen seit letzter Sitzung (B16): Beobachtung mit 3 Feldern und „[?]“, Zeitraum wählen, Beobachtung ändern/löschen per Formular und Claude, rückgängig", erwartet: "Beginn = letzter Paartherapie-Termin; Tabelle Datum | Situation | Problematik | gewünschte Veränderung; „unvollständig“ markiert; Protokoll ohne Inhalte", tests: ["privat-rueckblick.spec.ts › Beobachtung anlegen"] }] },
  "/privat/geld": { abläufe: [{ ablauf: "Frage für den Steuerberater, nur für die eigene Person", erwartet: "Hinweis „keine Steuerberatung“, Familien-Zugang gesperrt", tests: ["teil2.spec.ts › Privates Geld"] }] },
  "/ebay/pruefen": { abläufe: [{ ablauf: "Kleinanzeigen-Entwurf am eBay-Angebot", erwartet: "Titel ≤ 65, Kategorie, Zustand, Preis in ganzen Euro, Text ohne eBay-Sätze, Bilder + ZIP; nichts wird eingestellt", tests: ["amazon-berichte.spec.ts › eBay-Angebot → Titel"] }] },
  "/rechnungen": { abläufe: [{ ablauf: "Rechnung hochladen, Sammelbearbeitung", erwartet: "Upload leert nach Erfolg; Auswahl bleibt bei Fehlschlag; Rückfrage abgelehnt = nichts passiert", tests: ["formulare.spec.ts › Rechnungen"] }] },
  "/import": {
    abläufe: [
      { ablauf: "Unbekannte Datei importieren", erwartet: "Fehler, Datei bleibt ausgewählt", tests: ["formulare.spec.ts › Import"] },
      { ablauf: "B25.2 Spalte „Ergebnis / Fehler“, Lagergebühren/USt-Bericht unter „Was erkannt wird“", erwartet: "Ergebnis je Import (auch „nachgezogen“), fehlgeschlagene Uploads und abgelehnte Schnittstellen-Berichte mit Fehler", tests: ["b25.spec.ts › B25.1/B25.2"] },
    ],
  },
  "/marken/uhren": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "nur echte Deals, Herkunft angegeben", tests: ["kennzahlen.spec.ts › Uhren"] },
      { ablauf: "Übungs-Deal", erwartet: "zählt nicht unter „Verworfen“ und nicht in den Kennzahlen", tests: ["uebungsdaten.spec.ts › Übungs-Deal"] },
    ],
  },
  "/marken/uhren/deals": {
    abläufe: [
      { ablauf: "Pflichtfeld-Fehler → Eingaben bleiben → speichern → neu laden → Status ändern → nochmals speichern", erwartet: "Status bleibt (Handy und Desktop)", tests: ["formulare.spec.ts › Pflichtfeld-Fehler"] },
      { ablauf: "Filter und Schalter „Übungs-Deals zeigen“", erwartet: "Übung standardmäßig ausgeblendet, Schalter blendet ein", tests: ["uebungsdaten.spec.ts › Übungs-Deal"] },
    ],
    live: [
      { datum: FRUEHER, wer: "Prüfung mit ChatGPT", ablauf: "Uhren-Deal bearbeiten", ergebnis: "Eingaben/Status gingen verloren – behoben, seither automatisch geprüft", status: "behoben" },
      { datum: FRUEHER, wer: "Prüfung mit ChatGPT", ablauf: "Übungs-Deal", ergebnis: "zählte unter „Verworfen“ – behoben, seither automatisch geprüft", status: "behoben" },
    ],
  },
  "/privat": {
    abläufe: [
      { ablauf: "B32 Persönliche Mail „muss den Termin morgen absagen, bin krank“ (Abnahme 1–4)", erwartet: "nur im Privatbereich (Privat › Nachrichten), Push „Antwort prüfen“ ohne Discord-Kanal (DM nur, wenn eingestellt), Termin als abgesagt markiert (Rückgängig), KI-Entwurf mit gute Besserung und Unterschrift; „Senden“ = Antwort im selben Verlauf, Karte weg; Newsletter/Amazon unverändert; Büro/Familie sehen nichts; Morgenbericht/Überblick nur Anzahl", tests: ["persoenliche-mails.spec.ts › Abnahme 1–4"] },
      { ablauf: "B32 Handy: persönliche Mail im Vollbild", erwartet: "Senden · Bearbeiten · Später fest unten, kein Querscrollen; Später speichert den Text und lässt die Nachricht offen", tests: ["persoenliche-mails.spec.ts › Handy: persönliche Mail im Vollbild"] },
      { ablauf: "Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen", erwartet: "Ausnahme bleibt bei Serienänderung erhalten; nur die gewählten Termine ändern/verschwinden", tests: ["privat.spec.ts › Serie anlegen"] },
      { ablauf: "Abendritual als Abfolge „zweimal Streicheln, danach Massage“", erwartet: "die nächsten Abende im Voraus: S, S, M, S, S, M", tests: ["privat.spec.ts › Abendritual als Abfolge"] },
      { ablauf: "Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe", erwartet: "nichts Privates sichtbar; nur mit Privat-Freigabe der Inhaberin im Konnektor", tests: ["privat.spec.ts › Privates bleibt privat"] },
      { ablauf: "Familienkalender: „To do Ina: …“ → wichtige Aufgabe", erwartet: "genau eine Aufgabe (wichtig, Ina, Frist = Termintag); erledigt bleibt erledigt", tests: ["familie-watch.spec.ts › Familienkalender: „To do Ina"] },
      { ablauf: "B27 ArbitrageOne-Nachtlauf: PurchaseOrders .xls/Lagerbestand .xlsx, „wird erstellt“, Dialog, Fehler mit Bildschirmfoto, Erneut verarbeiten", erwartet: "Einkäufe/Lagerbestand verarbeitet; BQool aus der Export-Liste, Reimbursement über den Dialog; Fehler je Export mit Bild + Seite; sellerboard „übersprungen“; alter Fehlimport → fertig", tests: ["b27-automatik.spec.ts › ArbitrageOne"] },
      { ablauf: "B27 anbindungen_status: sellerboard-Zeitplan fest, altes Call-Archiv abgelöst", erwartet: "feste Uhrzeiten („04:00 und 13:00“, B29) statt „wird beim nächsten Lauf erfasst“; Call-Archiv nicht unter nur_probleme", tests: ["b27-automatik.spec.ts › anbindungen_status"] },
      { ablauf: "BQool-Upload: Erfolg erkennen (kurzer Hinweis, stille Annahme, Ablehnung), sonst „bitte prüfen“ + „hat geklappt“", erwartet: "Hinweis/Server-Annahme = hochgeladen, JSON-Ablehnung = Fehler; nichts erkannt = gelb + normale Aufgabe; „hat geklappt“ → von Hand bestätigt, Status fertig, Aufgabe erledigt", tests: ["bqool-upload-erkennung.spec.ts › kurzer Hinweis"] },
      { ablauf: "Familientermine direkt im Tagesplan/Kalender zuordnen (ich / beide / nur Partnerin)", erwartet: "„nur Tom“ → blockt nicht, steht unter „Blockt nicht“, Kapazität steigt; zurückholen und ↺ gehen; Kalender-Tagesliste gleich; To-do-Termine blocken nicht", tests: ["familie-watch.spec.ts › Familientermine direkt"] },
      { ablauf: "Familienkalender: Wen betrifft der Termin (ich / Familie / Partnerin), Name im Titel", erwartet: "Termin nur der Partnerin blockt den eigenen Tagesplan nicht (keine Fahrzeit), „nur Tom“ im Kalender; Familie blockt wieder", tests: ["familie-watch.spec.ts › Familienkalender"] },
      { ablauf: "Rückblick mit frei gewähltem Zeitraum (von–bis, Schnellauswahl) und Wochenrückblick „7 Tage bis“ beliebigem Tag", erwartet: "Zählungen nur im Zeitraum; vertauschte Daten getauscht, Zukunft auf heute gekürzt; „Zurück zum Monat“", tests: ["privat-rueckblick.spec.ts › Rückblick mit frei gewähltem Zeitraum"] },
    ],
    offen: ["Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests", "Live nie prüfen (echte private Daten)"],
  },
  "/einstellungen": {
    abläufe: [
      { ablauf: "Testumgebung: Banner, Sperre nach außen, Übersicht", erwartet: "Banner auf jeder Seite, Verbindungen nach außen gesperrt, Mails abgefangen", tests: ["testumgebung.spec.ts › Banner"] },
      { ablauf: "Apple Watch: Seite mit Anleitung, ein Kurzbefehl für alles (watch/frage), Ausprobieren", erwartet: "über Handy & Tesla erreichbar; Adresse + Schlüssel; Ausprobieren zeigt die Uhr-Antwort; freie Sätze → richtiger Befehl, ändernde nur per POST", tests: ["familie-watch.spec.ts › Apple Watch"] },
      { ablauf: "Zugang Assistenz (Büro): Finanz- und Privatseiten aufrufen", erwartet: "gesperrt, keine Finanz- oder Privatdaten", tests: ["teil2.spec.ts › Assistenz (Büro)"] },
      { ablauf: "B25.9 Privat „voll“ bei Nicht-Inhaber, va@…-Konto ohne VA-Rolle", erwartet: "Privatbereich gesperrt; beim Inhaber-Login auf „kein Zugang“ bereinigt + Dialog + Aufgabe; Knopf „Als VA-Rolle übernehmen“", tests: ["b25.spec.ts › B25.9"] },
    ],
  },
  "/einstellungen/hintergrund": {
    abläufe: [
      { ablauf: "Eigener Reiter „Hintergrund & Importe“ neben Anbindungen und KI-Assistent; Anbindungen nur noch mit Hinweis", erwartet: "Reiter aktiv, Abschnitt Hintergrund-Abrufe mit Tabelle; unter Anbindungen keine Abruf-Tabelle mehr, Link auf den neuen Reiter", tests: ["navigation.spec.ts › Favoriten (max. 8"] },
      { ablauf: "ArbitrageOne „Jetzt abholen“, zweiter Abruf, fehlender Export, Zwei-Faktor (Importe – ArbitrageOne)", erwartet: "Meldung und Lauf-Zeilen im neuen Reiter; Rücksprung nach dem Knopf auf /einstellungen/hintergrund", tests: ["arbitrageone.spec.ts › Verbindung testen"] },
      { ablauf: "Amazon-Berichte sofort anfordern / Konto-Berichte / fertige abholen", erwartet: "Meldung „6 Berichte angefordert …“ im neuen Reiter, Berichte in der Tabelle", tests: ["amazon-berichte.spec.ts › Kontozustand, gestrandet"] },
      { ablauf: "Discord live und Abrufzeile „Call-Archiv (Discord live)“", erwartet: "Auslöser live, zuletzt empfangen, sofort bei Eingang", tests: ["b21-calls-live.spec.ts › Upload → Archiv"] },
      { ablauf: "BQool-Upload „hat geklappt“", erwartet: "Zeile „hochgeladen (von Hand bestätigt)“, Rücksprung in den Reiter", tests: ["bqool-upload-erkennung.spec.ts › kurzer Hinweis"] },
    ],
  },
  "/einstellungen/claude": {
    abläufe: [
      { ablauf: "Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten", erwartet: "nicht angebotene Werkzeuge abgewiesen und protokolliert; Änderungen nur als Vorschlag", tests: ["rechte.spec.ts › Claude-Konnektor"] },
      { ablauf: "Jedes lesende Werkzeug einzeln", erwartet: "Beschreibung, Antwort ohne Fehler, Quelle + Datenstand, Links öffnen echte Seiten", tests: ["werkzeuge.spec.ts › Jedes lesende Werkzeug"] },
      { ablauf: "Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag)", erwartet: "Zahlen aus dem Keepa-Nachbau, zweiter Aufruf aus dem Zwischenspeicher (keine neue Keepa-Abfrage), unbekannte ASIN klar benannt", tests: ["keepa.spec.ts › keepa_produkt"] },
      { ablauf: "Keepa: Länder vergleichen", erwartet: "DE/FR/IT/ES/UK nach Verkäufen sortiert, UK auch in EUR, NL/BE/PL/SE als „nicht bei Keepa“", tests: ["keepa.spec.ts › keepa_vergleich"] },
      { ablauf: "Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon)", erwartet: "Lager-Konto bekommt sie nicht, direkter Aufruf abgewiesen", tests: ["keepa.spec.ts › Rechte"] },
      { ablauf: "Amazon je Land: Buy Box, Listung, Lageralter (Berichte) und Angebote live", erwartet: "Berichte unter Einstellungen → Hintergrund & Importe anfordern/abholen; Werte aus dem Amazon-Nachbau je Land; Angebote live mit 10-Min.-Zwischenspeicher; unbekannte ASIN als Fehler je Land", tests: ["geschaeft.spec.ts › Amazon je Land"] },
      { ablauf: "Neue Werkzeuge ohne Neustart (notifications/tools/list_changed)", erwartet: "Ereignis-Kanal meldet beim Verbinden „tools/list_changed“", tests: ["retouren-station.spec.ts › Paket mit 4 Artikeln"] },
      { ablauf: "Rechte der neuen Werkzeuge im Fragefeld", erwartet: "Büro: Posteingang, Repricer, Angebote live (über Wawi → Lieferanten); keine Buy Box, Listung, Lageralter, Ansprüche, Anbindungen", tests: ["geschaeft.spec.ts › Rechte im Fragefeld"] },
    ],
    offen: ["Amazon-Berichte je Land mit echtem Konto (Marktplätze unter Anbindungen → Amazon eintragen)", "getItemOffers-Ratenlimit im Betrieb beobachten"],
  },
  Fragefeld: {
    abläufe: [
      { ablauf: "Altes Gespräch nach Update fortsetzen", erwartet: "kein 400, alter Denk-Schritt verworfen", tests: ["fragefeld.spec.ts › Altes Gespräch"] },
      { ablauf: "Privates im Kalender-Werkzeug", erwartet: "nie (auch nicht für die Inhaberin)", tests: ["privat.spec.ts › Privates bleibt privat"] },
    ],
    live: [{ datum: FRUEHER, wer: "Nutzung im Betrieb", ablauf: "Altes Gespräch fortsetzen", ergebnis: "400 „thinking block bound to a different conversation“ – behoben, seither automatisch geprüft", status: "behoben" }],
  },
  "/drucken": {
    abläufe: [
      { ablauf: "Druckagent Abnahme 0/2/5c/6: Agent anlegen, online/offline, Papier leer, Push, erneut drucken, Umzug, Widerruf", erwartet: "Token nur einmal sichtbar (Prüfsumme gespeichert), Heartbeat → grün, „Papier leer (Etikettenrolle leer)“ rot, ohne Heartbeat rot „nicht erreichbar seit …“ und Auftrag wartet, Push nach 15 Min. genau einmal, nach Rückkehr gedruckt (Brother-Raster), erneut drucken, Umzug deaktiviert den alten Agenten, Widerruf → 401 „abgemeldet“", tests: ["druckagent.spec.ts › Abnahme 0/2/5c/6"] },
      { ablauf: "Druckagent Abnahme 1: iPhone „FNSKU-Etikett 3×“", erwartet: "Auftrag nach < 30 s gedruckt (Agent im Dauerbetrieb), drei Etiketten; Etiketten-Seite sendet ebenfalls an den QL-800", tests: ["druckagent.spec.ts › Abnahme 1"] },
      { ablauf: "Druckagent Abnahme 3: Seller-Central-PDF", erwartet: "Kartonlabels per Drag & Drop → QL-1100 alle Seiten, Sendung zugeordnet und verlinkt; FNSKU-Bogen über das iPhone → einzelne 62-mm-Etiketten am QL-800", tests: ["druckagent.spec.ts › Abnahme 3"] },
      { ablauf: "DHL-Label direkt an den QL-1100", erwartet: "Knopf „An QL-1100 im Lager“ am erstellten Label legt einen Druckauftrag an", tests: ["label-aus-chat.spec.ts › Abnahme 1+2"] },
    ],
    offen: ["Abnahme 0 live: Windows-Dienst startet vor der Anmeldung (Neustart des Arbeits-PCs)", "Abnahme 5 live: Auto-Aus aus, Druck um 06:00", "Abnahme 5b live: „Drucker startet nicht“ nach 30 s mit echter Shelly", "Medien 103 × 164 am echten QL-1100"],
  },
  "/lager/scannen": {
    abläufe: [
      { ablauf: "Druckagent Abnahme 4: Scanner-Arbeitsplatz", erwartet: "Artikel scannen + „Drucken 5×“ → Auftrag mit 5 Etiketten ohne Tastatur; Wareneingang (Menge durch Mehrfachscan, Stellplatz) bucht eigenes Lager; Abbrechen; VA ohne Preisetiketten und ohne Agent-Einstellungen; Nur-ansehen ohne Druckknopf", tests: ["druckagent.spec.ts › Abnahme 4"] },
    ],
  },
  "Server (Port, Adresse, Testumgebung)": {
    offen: ["`deploy/absichern.sh` auf dem echten Server ausführen (siehe ABNAHME.md, Teil B)", "`deploy/testumgebung.sh an` + `pruefen` auf dem Server"],
    live: [{ datum: FRUEHER, wer: "Prüfung mit ChatGPT", ablauf: "Erreichbarkeit", ergebnis: "Port 3020 offen, APP_URL intern – Skript zum Absichern bereit, auf dem Server noch auszuführen", status: "befund" }],
  },
};

/** Jede Seite der Navigation wird zusätzlich von dieser Prüfung abgedeckt (Desktop und Handy). */
export const ALLE_SEITEN: Ablauf = {
  ablauf: "Seite öffnen (Inhaberin): Status mit Text, aktive Auswahl markiert, deaktivierte Knöpfe erkennbar, Kontrast ≥ 4,5:1, am Handy kein Querscrollen",
  erwartet: "keine Befunde",
  tests: ["oberflaeche.spec.ts › Alle Seiten"],
};
