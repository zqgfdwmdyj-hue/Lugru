import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  feesForMonth,
  lastMonths,
  monthlyBill,
  normalizeLocation,
  occupiedOn,
  palletOverview,
  palletReminders,
  parseServices,
  ratesFor,
  servicesText,
  type CustomerRates,
  type PalletRates,
} from "@/lib/pallets/billing";
import { buildStatementPdf, statementMail } from "@/lib/pallets/statement";

// Paletten-Lager: Kundenpreise, Gebühren, Leistungen, Erinnerungen, Übersicht, Aufstellung. Fiktive Kunden.

const std: PalletRates = { pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 5, outFee: 4 };
const own = new Map<string, CustomerRates>([["müller gmbh", { name: "Müller GmbH", pricePerMonth: 10, freeDays: null, mode: "anteilig", inFee: 0, outFee: null }]]);
const ratesOf = (c: string | null) => ratesFor(c, std, own);

describe("Kundenpreise", () => {
  it("eigene Kondition vor Standard, leere Felder = Standard, Groß/Klein egal", () => {
    expect(ratesOf("müller GmbH ")).toEqual({ pricePerMonth: 10, freeDays: 5, mode: "anteilig", inFee: 0, outFee: 4 });
    expect(ratesOf("Fremd AG")).toEqual({ pricePerMonth: 14, freeDays: 5, mode: "monat", inFee: 5, outFee: 4 });
    expect(ratesOf(null).pricePerMonth).toBe(14);
  });
});

describe("Gebühren und Leistungen", () => {
  it("Einlagern im Monat des Einlagerns, Auslagern im Monat des Auslagerns", () => {
    expect(feesForMonth({ inAt: "2026-10-03", outAt: "2026-11-02" }, "2026-10", std)).toEqual({ inFee: 5, outFee: 0 });
    expect(feesForMonth({ inAt: "2026-10-03", outAt: "2026-11-02" }, "2026-11", std)).toEqual({ inFee: 0, outFee: 4 });
    expect(feesForMonth({ inAt: "2026-09-03", outAt: null }, "2026-10", std)).toEqual({ inFee: 0, outFee: 0 });
  });

  it("Monatsabrechnung: Lager + Ein/Aus + Leistungen je Kunde", () => {
    const bill = monthlyBill(
      [
        // frei (nur 3 Tage), aber Einlagern kostet → trotzdem in der Abrechnung
        { code: "P-1", inAt: "2026-10-28", outAt: null, customer: "Fremd AG" },
        { code: "P-2", inAt: "2026-10-01", outAt: "2026-10-20", customer: "Fremd AG" },
        // Müller: 10 €/Monat anteilig, ohne Einlagerungsgebühr, Auslagern 4 € (Standard)
        { code: "P-3", inAt: "2026-09-01", outAt: "2026-10-15", customer: "Müller GmbH" },
      ],
      "2026-10",
      ratesOf,
      [
        { customer: "müller gmbh", day: "2026-10-10", description: "Folieren", quantity: 2, unitPrice: 8 },
        { customer: "Neukunde", day: "2026-10-11", description: "Umpacken", quantity: 1.5, unitPrice: 35 },
        { customer: "Fremd AG", day: "2026-11-01", description: "nächster Monat", quantity: 1, unitPrice: 99 },
      ],
    );
    const by = Object.fromEntries(bill.groups.map((g) => [g.customer, g]));
    // P-1: Lager 14 (ab 2.11. kostenpflichtig, zählt bis Monatsende → 0 Tage im Oktober) → nur Einlagern 5
    expect(by["Fremd AG"].lines.find((l) => l.pallet.code === "P-1")).toMatchObject({ days: 0, storage: 0, inFee: 5, amount: 5 });
    // P-2: Lager 14, Einlagern 5, Auslagern 4
    expect(by["Fremd AG"].lines.find((l) => l.pallet.code === "P-2")).toMatchObject({ storage: 14, inFee: 5, outFee: 4, amount: 23 });
    expect(by["Fremd AG"].total).toBe(28);
    // P-3: 15 Tage im Oktober anteilig 10/31*15 = 4,84 + Auslagern 4; Folieren 16
    expect(by["Müller GmbH"]).toMatchObject({ storage: 4.84, fees: 4, servicesTotal: 16, total: 24.84 });
    expect(by["Neukunde"].total).toBe(52.5);
    expect(bill.total).toBe(105.34);
    expect([bill.storage, bill.fees, bill.services]).toEqual([18.84, 18, 68.5]);
  });

  it("Leistungsliste aus dem Textfeld", () => {
    expect(parseServices("Folieren = 8\nUmpacken je Stunde: 35,50 €\nKaputt\nPalettentausch;12")).toEqual([
      { name: "Folieren", price: 8 },
      { name: "Umpacken je Stunde", price: 35.5 },
      { name: "Palettentausch", price: 12 },
    ]);
    expect(servicesText([{ name: "Folieren", price: 8.5 }])).toBe("Folieren = 8,5");
  });

  it("Stellplatz einheitlich", () => {
    expect(normalizeLocation(" b-03 ")).toBe("B-03");
    expect(normalizeLocation("regal  2   fach 4")).toBe("REGAL 2 FACH 4");
    expect(normalizeLocation("")).toBeNull();
  });
});

describe("Erinnerungen", () => {
  const open = [
    { code: "P-10", inAt: "2026-10-18", outAt: null, customer: "Fremd AG" }, // frei bis 22.10. (heute)
    { code: "P-11", inAt: "2026-10-19", outAt: null, customer: "Fremd AG" }, // frei bis 23.10. (morgen)
    { code: "P-12", inAt: "2026-10-20", outAt: null, customer: "Fremd AG" }, // frei bis 24.10. – noch nicht
    { code: "P-13", inAt: "2026-07-01", outAt: null, customer: "Müller GmbH" }, // 114 Tage
    { code: "P-14", inAt: "2026-07-25", outAt: null, customer: "Müller GmbH" }, // 90 Tage
    { code: "P-15", inAt: "2026-07-26", outAt: null, customer: "Müller GmbH" }, // 89 Tage
  ];
  it("freie Zeit endet heute/morgen (je Kunde und Tag) und lange Standzeit (je Kunde)", () => {
    const r = palletReminders(open, "2026-10-22", ratesOf, { longStayDays: 90, remindFreeEnd: true });
    expect(r.freeEnd).toEqual([
      { customer: "Fremd AG", lastFreeDay: "2026-10-22", codes: ["P-10"] },
      { customer: "Fremd AG", lastFreeDay: "2026-10-23", codes: ["P-11"] },
    ]);
    expect(r.longStay).toEqual([{ customer: "Müller GmbH", codes: ["P-13", "P-14"], maxDays: 114 }]);
  });
  it("abschaltbar", () => {
    const r = palletReminders(open, "2026-10-22", ratesOf, { longStayDays: 0, remindFreeEnd: false });
    expect([r.freeEnd.length, r.longStay.length]).toEqual([0, 0]);
  });
});

describe("Übersicht", () => {
  it("Monate, Belegung und Umsatz je Kunde", () => {
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    const pallets = [
      { inAt: "2026-08-01", outAt: "2026-09-30", customer: "Fremd AG" },
      { inAt: "2026-09-15", outAt: null, customer: "Müller GmbH" },
      { inAt: "2026-10-01", outAt: null, customer: "Fremd AG" },
    ];
    expect(occupiedOn(pallets, "2026-09-30")).toBe(1); // am Auslagerungstag nicht mehr
    const o = palletOverview(pallets, [], ["2026-08", "2026-09", "2026-10"], ratesOf, "2026-10-22");
    expect(o.months.map((m) => m.occupied)).toEqual([1, 1, 2]);
    expect(o.months.map((m) => m.revenue)).toEqual([19, 21.67, 29]);
    expect(o.customers.map((c) => [c.customer, c.open])).toEqual([["Fremd AG", 1], ["Müller GmbH", 1]]);
    expect(o.avgStayDays).toBe(61);
  });
});

describe("Monatsaufstellung", () => {
  const group = {
    customer: "Müller GmbH",
    rates: ratesOf("Müller GmbH"),
    lines: [{ pallet: { code: "P-3", inAt: "2026-09-01", outAt: "2026-10-15", location: "B-03", contents: "Kartons Ware" }, days: 15, storage: 4.84, inFee: 0, outFee: 4, amount: 8.84 }],
    services: [{ charge: { customer: "Müller GmbH", day: "2026-10-10", description: "Folieren", quantity: 2, unitPrice: 8, palletCode: "P-3" }, amount: 16 }],
    storage: 4.84,
    fees: 4,
    servicesTotal: 16,
    total: 24.84,
  };
  it("PDF mit einer Seite, Sonderzeichen gehen", async () => {
    const pdf = await buildStatementPdf({ sender: { name: "Lager Muster", street: "Weg", houseNo: "1", zip: "12345", city: "Ort" }, month: "2026-10", group, today: "2026-11-01" });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Palettenaufstellung Oktober 2026 – Müller GmbH");
  });
  it("viele Paletten → mehrere Seiten", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ ...group.lines[0], pallet: { ...group.lines[0].pallet, code: `P-${i + 1}` } }));
    const doc = await PDFDocument.load(await buildStatementPdf({ sender: {}, month: "2026-10", group: { ...group, lines }, today: "2026-11-01" }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
  it("Mailtext mit Summe und Dateiname", () => {
    const m = statementMail({ customer: "Müller GmbH", month: "2026-10", group, company: "Lager Muster", signature: "Viele Grüße\nTeam Lager" });
    expect(m.subject).toBe("Palettenaufstellung Oktober 2026 – Lager Muster");
    expect(m.text).toContain("1 Palette, Summe 24,84 €");
    expect(m.text).not.toContain("Zum Monatsende");
    expect(m.text.endsWith("Viele Grüße\nTeam Lager")).toBe(true);
    expect(m.filename).toBe("Palettenaufstellung-2026-10-Müller-GmbH.pdf");
  });
});
