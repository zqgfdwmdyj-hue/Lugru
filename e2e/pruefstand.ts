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
    ],
    offen: ["Aufgaben anlegen, erledigen, verschieben", "Tageskennzahlen"],
  },
  "/posteingang": {
    abläufe: [
      { ablauf: ".eml-Datei hochladen", erwartet: "Rückmeldung, Dateiauswahl danach leer", tests: ["formulare.spec.ts › Posteingang: .eml hochladen"] },
      { ablauf: "Antwort-Entwurf (über Claude) prüfen und senden", erwartet: "Entwurf an der Mail; ohne Häkchen „Geprüft“ wird nicht gesendet; mit Häkchen landet die Mail in den Test-Mails und der Entwurf ist als gesendet markiert", tests: ["geschaeft.spec.ts › Antwort-Entwurf"] },
      { ablauf: "Posteingang auf null: Regel an Zuständigen, Auto-Archiv, Zahlung abgelehnt (IT), Termin-Mail → Privatkalender, Vorschlag für Claude", erwartet: "Aufgabe für die Zuständige, Newsletter archiviert, Zahlung kritisch mit Aufgabe, Termin nur im Privatkalender (nie im Posteingang)", tests: ["posteingang-null.spec.ts › Regel an Zuständigen"] },
      { ablauf: "Gerichts-/Behörden-Mail und Anwalts-Mails (B14)", erwartet: "Behörde: Entwurf an den Anwalt (nicht gesendet) + Aufgabe; Anwalt mit Aktenzeichen: in den Fall statt in den Posteingang", tests: ["recht-discord.spec.ts › Teil A"] },
    ],
    offen: ["Mails abrufen (nur echte Postfächer)", "Entwurf echt senden (nur mit echtem Postfach)", "Einstufung „kritisch“ bei Zahlungsproblemen – nur als Unit-Test"],
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
    ],
  },
  "/amazon-faelle": {
    abläufe: [
      { ablauf: "Amazon-Mails einordnen: Freischaltung abgelehnt, Fall „Antwort nötig“ (2 Mails, gleiche Fall-ID), Freischaltung entzogen, unsichere Mail", erwartet: "Paket mit Rechnung ≤ 180 Tage und ≥ 10 Stück, VA-Thread; ein Vorgang mit Antwort DE/EN inkl. Sendung, POD als „fehlt“; Entzug rot mit Meldung an Ludwig und Bestand in €; Einordnung von Hand lernt; Claude-Werkzeuge", tests: ["amazon-faelle.spec.ts › Freischaltung abgelehnt"] },
      { ablauf: "20 erfundene Amazon-Mails in 8 Sprachen einordnen (Unit-Test)", erwartet: "≥ 18 richtig (Bereich und Phase), Fall-ID/ASIN/Frist erkannt", tests: [] },
    ],
    offen: ["Echte Seller-Central-Mails (nur live mit Nur-ansehen-Daten)", "SP-API: Listings Restrictions (Freischaltungsstatus je Marktplatz) – braucht die Amazon-Anbindung"],
  },
  "/assistent-verlauf": {
    abläufe: [
      { ablauf: "Auftrag an Claude aus den Amazon-ToDos: „ToDos mit versendetem Auftrag erledigen“ → Vorschau → Ausführen → Verlauf → Rückgängig; gelber Auftragsstatus; Preis ändern; Mail mit „ignore previous instructions“; VA-Konto; gleiche Aktion über den Konnektor", erwartet: "Vorschau nennt 2 passende und 1 getrennt (nicht versendet), ohne Klick keine Änderung; Verlauf mit Auftragstext und Datensätzen, Rückgängig öffnet wieder; gelb nur mit Einzelbestätigung; Preis: Hinweis + Link, keine Ausführung; Mail-Text löst nichts aus; VA ohne Finanzen; Konnektor gleiches Ergebnis", tests: ["assistent-aktionen.spec.ts › Vorschau → Ausführen"] },
    ],
  },
  "/deal-eingang": {
    abläufe: [
      { ablauf: "Text, Screenshot (3 Angebote), Kurzbefehl mit Geräte-Schlüssel, Kapital-Ampel rot, Preisliste (XLSX 500 Zeilen), Mail „Deal prüfen“, ProfitPath über Discord, Knöpfe Bestellvorschlag/B2B-Deal, Claude-Werkzeuge", erwartet: "Ampel je Angebot mit Gründen; Push ≤ 60 s nur bei Grün/Gelb (ProfitPath); widerrufener Schlüssel abgelehnt; gleiche ASIN/EK zusammengefasst, neuer EK = Update; Einkaufsentwurf und B2B-Entwurf angelegt", tests: ["deal-eingang.spec.ts › Text, Screenshot"] },
      { ablauf: "Abschnitt 10/11: Lugru-Deals-History über den Endpunkt (mit/ohne Schlüssel, erneut senden), Budget-Grenze je Deal, geteilter Deal mit Shop-Link, „Gekauft: Menge, Preis“, Amazon-Bestellbestätigung als .eml, 👎 aus der Push-Meldung mit Grund, 👍 unter der ProfitPath-Nachricht in Discord, Wareneingang + 35 Tage mit sellerboard-Monat, Monatsbericht, Claude-Werkzeuge", erwartet: "History neu/aktualisiert/ungültig gezählt, ohne Schlüssel 401; Deal-Wert „Passt zu dir (X/100)“ mit ähnlichen Deals (Lugru-Gruppe); über Budget höchstens Gelb mit Budget-Grund; Push mit „Zum Angebot“ (Shop-Link) und „Gekauft …“; gekauft → Bestellung „bestellt“ + Aufgabe „Wareneingang buchen“; Mail → gekauft (Menge, Preis, Bestellnummer), Mail bleibt im Posteingang; 👍/👎 mit Weg gespeichert; Ergebnis nach 30 Tagen mit realem ROI; deal_wert/deal_lernen_bericht/deal_bewerten/deal_gekauft", tests: ["deal-wert.spec.ts › History-Import"] },
      { ablauf: "Lücken aus dem Bauauftrag (Abschnitte 2, 4, 5, 7): weitere Einstellungen (ungültiger/gültiger iCloud-Link), Kurzbefehl-Skizzen, offene Rechteinhaber-Beschwerde zur ASIN, Lieferant ohne Marktplatz-Freigabe + Gefahrgut, Keepa-Mini-Chart, Screenshot im Original und fremde Datei", erwartet: "Einstellungen gespeichert, Budget/Ziel-ROI unverändert; Link + 4 Skizzen; Rot mit Fallnummer; Rot „selektiver Vertrieb“ + Gelb Gefahrgut als 2. Grund; Chart mit Ø/Tief/Stand; Bild 200 image/png, Datei über anderen Eingang 404", tests: ["deal-eingang-luecken.spec.ts › Einstellungen"] },
    ],
    offen: ["ProfitPath mit echtem Discord-Bot (Message Content Intent, Rechte „Kanal ansehen“ + „Nachrichtenverlauf lesen“) – nur live", "Lugru Deals live: Programm auf den neuen Stand bringen, Seller-Adresse + Verbindungsschlüssel eintragen – die History kommt dann von selbst", "Echte Bestellbestätigungen anderer Shops (Betreff/Format je Shop) – nur live"],
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
    abläufe: [{ ablauf: "Geschäftskalender als Büro-Konto und als Inhaberin", erwartet: "keine privaten Einträge (Testwort PRIVATGEHEIM erscheint nicht)", tests: ["privat.spec.ts › Privates bleibt privat"] }],
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
  "/repricer": {
    abläufe: [
      { ablauf: "Kennzahlen", erwartet: "Herkunft je Kennzahl; „Ohne EK“ mit Link zu den betroffenen Artikeln", tests: ["kennzahlen.spec.ts › Repricer"] },
      { ablauf: "BQool-Export „Manage Listings“ hochladen", erwartet: "Rückmeldung mit Anzahl je Marktplatz, Auffälligkeiten (ohne Min, pausiert, ohne Regel) in der Tabelle und im Werkzeug „repricer“", tests: ["geschaeft.spec.ts › BQool-Export"] },
      { ablauf: "B15.11 Übersicht je Regel, Filter, alle Länder", erwartet: "Regel mit DE/FR, aktiv/pausiert richtig (Angebotsstatus „Inactive“ ≠ pausiert); Filter Land und Status", tests: ["b15-anzeige.spec.ts › Repricer"] },
    ],
    offen: ["Echter BQool-Export (Spaltennamen der aktuellen BQool-Version) – einmal mit echter Datei prüfen"],
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
    ],
  },
  "/verlust": {
    abläufe: [
      { ablauf: "2 von 3 Tagen im Minus → Fall + wichtige Aufgabe; Ausnahme → Aufgabe erledigt, Wochensumme sichtbar", erwartet: "Aufgabe „verlust-<SKU>“ offen/wichtig bzw. nicht mehr offen", tests: ["teil2.spec.ts › Kapital-Ampel"] },
      { ablauf: "Kennzahlen", erwartet: "Zeitraum, Quelle, Stand", tests: ["kennzahlen.spec.ts › Verlust-Stopp"] },
    ],
    offen: ["Echte sellerboard-Tageswerte je Produkt (kommen mit dem täglichen Komplett-Abgleich)"],
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
  "/deal-eingang/lugru": { abläufe: [{ ablauf: "Lugru Deals über Discord: History, Live-Post, Reaktion, doppelter Post, eigener Kauf, Statistik, deal_quellen, Deal-Wert", erwartet: "Live-Post im Deal-Eingang mit Ampel (Push nur Grün/Gelb), History mit Reaktionen, Statistik aktualisiert, „Lugru Deals“ in deal_quellen, keine Namen gespeichert", tests: ["lugru-deals.spec.ts › History, Live-Post"] }] },
  "/privat/therapie-bogen": { abläufe: [{ ablauf: "Therapie-Bogen seit letzter Sitzung (B16): Beobachtung mit 3 Feldern und „[?]“, Zeitraum wählen, Beobachtung ändern/löschen per Formular und Claude, rückgängig", erwartet: "Beginn = letzter Paartherapie-Termin; Tabelle Datum | Situation | Problematik | gewünschte Veränderung; „unvollständig“ markiert; Protokoll ohne Inhalte", tests: ["privat-rueckblick.spec.ts › Beobachtung anlegen"] }] },
  "/privat/geld": { abläufe: [{ ablauf: "Frage für den Steuerberater, nur für die eigene Person", erwartet: "Hinweis „keine Steuerberatung“, Familien-Zugang gesperrt", tests: ["teil2.spec.ts › Privates Geld"] }] },
  "/rechnungen": { abläufe: [{ ablauf: "Rechnung hochladen, Sammelbearbeitung", erwartet: "Upload leert nach Erfolg; Auswahl bleibt bei Fehlschlag; Rückfrage abgelehnt = nichts passiert", tests: ["formulare.spec.ts › Rechnungen"] }] },
  "/import": { abläufe: [{ ablauf: "Unbekannte Datei importieren", erwartet: "Fehler, Datei bleibt ausgewählt", tests: ["formulare.spec.ts › Import"] }] },
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
      { ablauf: "Serie (wöchentlich) anlegen, einen Termin einzeln ändern, „dieser und alle folgenden“ ändern, ab hier löschen", erwartet: "Ausnahme bleibt bei Serienänderung erhalten; nur die gewählten Termine ändern/verschwinden", tests: ["privat.spec.ts › Serie anlegen"] },
      { ablauf: "Abendritual als Abfolge „zweimal Streicheln, danach Massage“", erwartet: "die nächsten Abende im Voraus: S, S, M, S, S, M", tests: ["privat.spec.ts › Abendritual als Abfolge"] },
      { ablauf: "Schutz: Konto ohne Privat, „nur Familie“, Suche, Fragefeld, Claude ohne Freigabe", erwartet: "nichts Privates sichtbar; nur mit Privat-Freigabe der Inhaberin im Konnektor", tests: ["privat.spec.ts › Privates bleibt privat"] },
    ],
    offen: ["Periode, Nähe, Tagebuch, Aufgaben – nur Unit-Tests", "Live nie prüfen (echte private Daten)"],
  },
  "/einstellungen": {
    abläufe: [
      { ablauf: "Testumgebung: Banner, Sperre nach außen, Übersicht", erwartet: "Banner auf jeder Seite, Verbindungen nach außen gesperrt, Mails abgefangen", tests: ["testumgebung.spec.ts › Banner"] },
      { ablauf: "Zugang Assistenz (Büro): Finanz- und Privatseiten aufrufen", erwartet: "gesperrt, keine Finanz- oder Privatdaten", tests: ["teil2.spec.ts › Assistenz (Büro)"] },
    ],
  },
  "/einstellungen/claude": {
    abläufe: [
      { ablauf: "Rechte: Konnektor (nur Inhaberin) und Fragefeld mit drei Konten", erwartet: "nicht angebotene Werkzeuge abgewiesen und protokolliert; Änderungen nur als Vorschlag", tests: ["rechte.spec.ts › Claude-Konnektor"] },
      { ablauf: "Jedes lesende Werkzeug einzeln", erwartet: "Beschreibung, Antwort ohne Fehler, Quelle + Datenstand, Links öffnen echte Seiten", tests: ["werkzeuge.spec.ts › Jedes lesende Werkzeug"] },
      { ablauf: "Keepa: Produkt (aktuell, 30/90/180 Tage, Buy-Box-Anteile, Wert je Tag)", erwartet: "Zahlen aus dem Keepa-Nachbau, zweiter Aufruf aus dem Zwischenspeicher (keine neue Keepa-Abfrage), unbekannte ASIN klar benannt", tests: ["keepa.spec.ts › keepa_produkt"] },
      { ablauf: "Keepa: Länder vergleichen", erwartet: "DE/FR/IT/ES/UK nach Verkäufen sortiert, UK auch in EUR, NL/BE/PL/SE als „nicht bei Keepa“", tests: ["keepa.spec.ts › keepa_vergleich"] },
      { ablauf: "Keepa-Werkzeuge nur mit Recht (Lieferanten oder Amazon)", erwartet: "Lager-Konto bekommt sie nicht, direkter Aufruf abgewiesen", tests: ["keepa.spec.ts › Rechte"] },
      { ablauf: "Amazon je Land: Buy Box, Listung, Lageralter (Berichte) und Angebote live", erwartet: "Berichte unter Anbindungen anfordern/abholen; Werte aus dem Amazon-Nachbau je Land; Angebote live mit 10-Min.-Zwischenspeicher; unbekannte ASIN als Fehler je Land", tests: ["geschaeft.spec.ts › Amazon je Land"] },
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
