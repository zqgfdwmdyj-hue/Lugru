import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { leseKontoauszugPdfText } from "@/lib/bank/pdf";

// Kontoauszug als PDF (erfundene Buchungen, Aufbau wie ein Sparkasse-Kontoauszug).

async function pdfMit(zeilen: [number, number, string][]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [x, y, t] of zeilen) page.drawText(t, { x, y, size: 9, font });
  const bytes = await doc.save();
  return (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text;
}

describe("Kontoauszug-PDF", () => {
  it("echtes PDF: Buchungen mit Name/Zweck, Anfangs- und Endsaldo, Saldo-Kontrolle geht auf", async () => {
    const text = await pdfMit([
      [40, 800, "Kontoauszug 5/2026"],
      [40, 780, "IBAN: DE00 1234 5678 0000 0000 09"],
      [40, 750, "Kontostand am 30.04.2026, Auszug Nr. 4"], [480, 750, "1.000,00 +"],
      [40, 720, "Buchungstag Wert Erlauterung / Verwendungszweck"], [480, 720, "Betrag"],
      [40, 700, "03.05.2026"], [110, 700, "03.05.2026"], [180, 700, "Uberweisung"], [480, 700, "-119,00"],
      [180, 688, "Testlieferant GmbH"], [180, 676, "Rechnung RE-T-0815"],
      [40, 656, "09.05.2026"], [110, 656, "09.05.2026"], [180, 656, "Gutschrift"], [480, 656, "4.321,09"],
      [180, 644, "AMAZON PAYMENTS EUROPE S.C.A."],
      [40, 624, "28.05.2026"], [110, 624, "31.05.2026"], [180, 624, "Entgeltabschluss"], [480, 624, "-12,90"],
      [40, 590, "Kontostand am 31.05.2026 um 20:00 Uhr"], [480, 590, "5.189,19 +"],
    ]);
    const a = leseKontoauszugPdfText(text);
    expect(a.konto).toBe("DE00123456780000000009");
    expect(a.umsaetze.map((u) => [u.buchungstag, u.betrag, u.gegenpartei, u.zweck])).toEqual([
      ["2026-05-03", -119, "Testlieferant GmbH", "Rechnung RE-T-0815"],
      ["2026-05-09", 4321.09, "AMAZON PAYMENTS EUROPE S.C.A.", ""],
      ["2026-05-28", -12.9, "", ""],
    ]);
    expect(a.umsaetze[2].valuta).toBe("2026-05-31");
    expect(a.anfang).toEqual({ datum: "2026-04-30", saldo: 1000 });
    expect(a.ende).toEqual({ datum: "2026-05-31", saldo: 5189.19 });
    expect(a.kontrolle).toEqual({ summe: 4189.19, differenz: 0 });
    expect(a.salden).toEqual([{ datum: "2026-05-31", saldo: 5189.19 }]);
  });

  it("Varianten: Vorzeichen hinten, S/H, Betrag in der Folgezeile, Datum ohne Jahr, Vorzeichen aus der Buchungsart", () => {
    const a = leseKontoauszugPdfText(
      [
        "Kontoauszug Nr. 11/2026",
        "Alter Kontostand 500,00 H",
        "02.11. 02.11. Lastschrift 49,99",
        "Testfunk GmbH",
        "Mandatsreferenz: TF-123 Glaeubiger-ID DE98ZZZ09999999999",
        "05.11. 05.11. Kartenzahlung",
        "Testmarkt",
        "Einkauf 12,50-",
        "10.11. 10.11. Gutschrift 100,00 H",
        "Testkunde",
        "20.11. 20.11. Umbuchung 30,00",
        "Neuer Kontostand 507,51 H",
      ].join("\n"),
    );
    expect(a.umsaetze.map((u) => [u.buchungstag, u.betrag])).toEqual([
      ["2026-11-02", -49.99],
      ["2026-11-05", -12.5],
      ["2026-11-10", 100],
      ["2026-11-20", -30],
    ]);
    expect(a.umsaetze[0].mandat).toBe("TF-123");
    expect(a.umsaetze[0].glaeubigerId).toBe("DE98ZZZ09999999999");
    expect(a.umsaetze[1].zweck).toBe("Einkauf");
    // „Umbuchung“ ohne Vorzeichen: erst als Eingang gelesen, die Saldo-Kontrolle dreht sie zur Ausgabe
    expect(a.unsicher).toBe(0);
    expect(a.kontrolle.differenz).toBe(0);
    expect(a.salden).toEqual([{ datum: "2026-11-20", saldo: 507.51 }]);
  });

  it("Kontrolle geht nicht auf → Differenz gemeldet, kein Saldo übernommen", () => {
    const a = leseKontoauszugPdfText(["Kontoauszug 3/2026", "Alter Kontostand 100,00 +", "01.03.2026 01.03.2026 Lastschrift -5,00", "Test", "Neuer Kontostand 90,00 +"].join("\n"));
    expect(a.kontrolle.differenz).toBe(-5);
    expect(a.salden).toEqual([]);
  });
  it("gleiche Datei zweimal → gleiche Schlüssel; gleiche Buchung zweimal am Tag → verschiedene", () => {
    const t = ["Kontoauszug 3/2026", "01.03.2026 01.03.2026 Lastschrift -5,00", "Test", "01.03.2026 01.03.2026 Lastschrift -5,00", "Test"].join("\n");
    const a = leseKontoauszugPdfText(t);
    const b = leseKontoauszugPdfText(t);
    expect(a.umsaetze.map((u) => u.schluessel)).toEqual(b.umsaetze.map((u) => u.schluessel));
    expect(new Set(a.umsaetze.map((u) => u.schluessel)).size).toBe(2);
  });
});
