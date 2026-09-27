// Startinhalte für die Wissensdatenbank eines neuen Mandanten.
export const STARTER_KNOWLEDGE: {
  kind: "article" | "snippet";
  category: string;
  title: string;
  tags: string[];
  body: string;
}[] = [
  {
    kind: "article",
    category: "Tools & Abläufe",
    title: "So bestimmt das System den EK je Charge",
    tags: ["EK", "COG", "Arbitrage One"],
    body: `Jede SKU ist eine Charge (ein Einkauf). Für jede Charge gilt genau ein EK netto – daraus werden alle Exporte gespeist.

Vorrang der Quellen:
1. Manuell gesetzter EK
2. Eigene Vorlage „Tool“ aus Arbitrage One (EK netto inkl. Versandkosten)
3. AccountOne-COG-Export
4. Sellerboard-Export

Retouren (RET_…-SKUs) stehen in Arbitrage One mit 0,01 € oder fehlen ganz. Das System gibt ihnen den EK der letzten Einkaufs-Charge derselben ASIN vor dem Retourendatum.

Liefern zwei Exporte für dieselbe SKU unterschiedliche Werte, erscheint ein To-do „EK-Abweichung“.`,
  },
  {
    kind: "article",
    category: "Tools & Abläufe",
    title: "SKU-Schemata aus Arbitrage One",
    tags: ["SKU", "Arbitrage One"],
    body: `A   SHOP_EK_VK_TTMON_ASIN            z. B. KAUFL_84.03_127.08_27SEP_B0TEST0004
B   SHOP_VK_TTMON_ASIN_EKBRUTTO      z. B. FLACO_57.36_16SEP_B0TEST0003_42.93
C   SHOP_TTMONJJ_ASIN_EKBRUTTO_VK    z. B. AMZFR_24SEP26_B0TEST0008_305.99_470.00
RET RET_CODE_LPN_TTMONJJ_KANAL       z. B. RET_3_LPNHK100000002_16JUL25_FBA

A und B enthalten kein Jahr. Das System schätzt es (letztes Jahr, in dem das Datum nicht nach dem Export-Datum liegt) und markiert das Datum mit „~“. Schema C enthält das Jahr.`,
  },
  {
    kind: "article",
    category: "Tools & Abläufe",
    title: "Einkäufe aus Arbitrage One importieren",
    tags: ["Import", "Arbitrage One"],
    body: `Arbitrage One hat keine Schnittstelle, deshalb läuft es über Exporte:

1. In Arbitrage One unter Export die eigene Vorlage „Tool“ herunterladen (ASIN, Seller SKU, FNSKU, Produktname, Kaufdatum, Menge, EK netto mit VSK, Währung, EK netto Standard).
2. Im System unter „Import Arbitrage One“ hochladen.

Doppelte Zeilen sind egal – bekannte SKUs werden nur aktualisiert. Auch der Sellerboard- und der AccountOne-Export werden erkannt.
Kommt länger kein Import, erscheint auf der Startseite eine Erinnerung.`,
  },
  {
    kind: "article",
    category: "Ansprüche & Fristen",
    title: "Fehlende Einheiten beim Wareneingang reklamieren",
    tags: ["FBA", "Inbound", "Erstattung"],
    body: `Wenn Amazon weniger Einheiten einbucht als verschickt wurden:

1. Abwarten, bis die Sendung in Seller Central als abgeschlossen gilt.
2. Nachweise sammeln: Kartoninhalt / Scan-Protokoll, Rechnung, Zustellnachweis.
3. Fall über Seller Central einreichen (Textbaustein „Amazon-Support: fehlende Einheiten“).
4. Frist: [aktuelle Frist in Seller Central prüfen und hier eintragen]`,
  },
  {
    kind: "snippet",
    category: "Amazon-Support",
    title: "Amazon-Support: fehlende Einheiten beim Wareneingang",
    tags: ["FBA", "Inbound"],
    body: `Guten Tag,

in der Sendung {Sendungs-ID} wurden {Anzahl verschickt} Einheiten von {Artikel} (ASIN {ASIN}, FNSKU {FNSKU}) verschickt, eingebucht wurden jedoch nur {Anzahl eingebucht}.

Anbei der Kartoninhalt, die Rechnung sowie der Zustellnachweis. Bitte prüfen Sie den Wareneingang und erstatten Sie die fehlenden Einheiten.

Vielen Dank und freundliche Grüße`,
  },
  {
    kind: "snippet",
    category: "Kundennachrichten",
    title: "Kunde: Wo bleibt mein Paket?",
    tags: ["Versand", "Support"],
    body: `Hallo {Name},

vielen Dank für Ihre Nachricht. Ihre Bestellung wurde am {Versanddatum} mit DHL verschickt. Die Sendungsnummer lautet {Sendungsnummer} – den aktuellen Stand sehen Sie hier: {Tracking-Link}

Sollte das Paket in den nächsten Tagen nicht ankommen, melden Sie sich gerne wieder.

Viele Grüße`,
  },
];
