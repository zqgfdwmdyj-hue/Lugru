/** Was ohne eine Anbindung fehlt – damit klar ist, warum eine Seite oder ein Claude-Werkzeug leer bleibt. */
export const FEHLT_OHNE: Record<string, string> = {
  amazon_sp:
    "Buy Box und Angebote live, Lageralter, Listungen je Land, Kundenretouren-, Remissions- und Erstattungsberichte (Retouren-Station), Gebühren je Land im B2B-Scanner und in der Deal-Ampel, Übertragung der Business-Preise",
  keepa: "Preisverlauf und Verkäufe je Monat, Deal-Ampel, Preis-Trend der Kapital-Ampel, B2B-Scanner",
  anthropic: "KI-Auswertungen: Calls und Wissen aus Calls, Rechnungen auslesen, Retouren-Station, Preislisten-Spalten",
  lexoffice: "B2B-Rechnungen und Zahlungsabgleich der Deals",
  discord_calls: "Call-Transkripte live aus dem Discord-Kanal (sofort beim Hochladen)",
  discord_profitpath: "ProfitPath-Deals automatisch in den Deal-Eingang (mit Gegenprüfung und Push bei Grün/Gelb)",
  discord_va: "Aufgaben an die VA als Discord-Thread, Rückfragen und automatische Antworten auf Datenfragen der VA",
  sellerboard_web: "EK automatisch zu sellerboard übertragen (sonst Importdatei herunterladen)",
  bqool_web: "BQool-Dateien automatisch hochladen (sonst ZIP herunterladen)",
  discord_b2b: "Meldung neuer Deals im B2B-Kanal",
  google_drive: "Rechnungen aus Google Drive, private Google Docs der Calls",
};
