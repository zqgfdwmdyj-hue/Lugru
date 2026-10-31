import { describe, expect, it } from "vitest";
import {
  anspruchText,
  bezugAus,
  fallKategorie,
  fallnummerInAntwort,
  feiertageAusText,
  fristErinnerung,
  istArbeitstag,
  sammelZuordnung,
  tagesbeginn,
  tageBis,
  uebersichtFaellig,
  uebersichtText,
  vaEntscheidung,
  VA_REGEL_STANDARD,
  wochentag,
} from "@/lib/va/automatik-logic";
import { vaHeuteText } from "@/lib/va/logic";

// B18 VA-Automatik – erfundene Beispiele, keine echten Daten.

describe("Kategorie je Fall (Fall-Zentrale)", () => {
  it("ordnet Bereich/Phase den Kategorien des Auftrags zu", () => {
    expect(fallKategorie({ bereich: "fall", phase: "antwort_noetig" })).toBe("fall_antwort");
    expect(fallKategorie({ bereich: "freischaltung", phase: "abgelehnt" })).toBe("freischaltung_abgelehnt");
    expect(fallKategorie({ bereich: "freischaltung", phase: "nachreichen" })).toBe("freischaltung_abgelehnt");
    expect(fallKategorie({ bereich: "freischaltung", phase: "entzogen" })).toBe("freischaltung_entzogen");
    expect(fallKategorie({ bereich: "freischaltung", phase: "beantragt" })).toBe("info");
    expect(fallKategorie({ bereich: "angebot", phase: "offen", titel: "Angebot wegen fehlender GPSR-Angaben deaktiviert" })).toBe("angebot_deaktiviert");
    expect(fallKategorie({ bereich: "fba_sendung", phase: "offen" })).toBe("fba_fehlmenge");
    expect(fallKategorie({ bereich: "marke", phase: "offen" })).toBe("marke");
    expect(fallKategorie({ bereich: "kontozustand", phase: "antwort_noetig" })).toBe("kontozustand");
    expect(fallKategorie({ bereich: "a_bis_z", phase: "antwort_noetig" })).toBe("a_bis_z");
    expect(fallKategorie({ bereich: "info", phase: "info" })).toBe("info");
    expect(fallKategorie({ bereich: "entschaedigung", phase: "info" })).toBe("info");
    expect(fallKategorie({ bereich: "entschaedigung", phase: "antwort_noetig" })).toBe("fall_antwort");
    expect(fallKategorie({ bereich: "sonstiges", phase: "offen" })).toBe("sonstiges");
  });
  it("erkennt „Dokument erneut einreichen“ in mehreren Sprachen", () => {
    expect(fallKategorie({ bereich: "sonstiges", phase: "offen", titel: "Bitte Dokument erneut einreichen" })).toBe("dokument_erneut");
    expect(fallKategorie({ bereich: "fall", phase: "eroeffnet", titel: "Please resubmit your document" })).toBe("dokument_erneut");
    expect(fallKategorie({ bereich: "angebot", phase: "offen", titel: "Veuillez soumettre à nouveau le document" })).toBe("dokument_erneut");
    expect(fallKategorie({ bereich: "fall", phase: "nachreichen" })).toBe("dokument_erneut");
  });
  it("Marke/Konto gehen vor „erneut einreichen“", () => {
    expect(fallKategorie({ bereich: "marke", phase: "offen", titel: "Dokument erneut einreichen" })).toBe("marke");
  });
});

describe("Regel: an die VA / erst Ludwig / nie", () => {
  const e = (kategorie: Parameters<typeof vaEntscheidung>[0]["kategorie"], betrag: number | null, regeln = {}) => vaEntscheidung({ kategorie, betrag, regeln, schwelle: 500 });
  it("Standard laut Auftrag", () => {
    expect(VA_REGEL_STANDARD.anspruch).toBe("va");
    expect(e("fall_antwort", 120).ziel).toBe("va");
    expect(e("marke", null).ziel).toBe("ludwig");
    expect(e("freischaltung_entzogen", null).ziel).toBe("ludwig");
    expect(e("kontozustand", null).ziel).toBe("ludwig");
    expect(e("a_bis_z", 30).ziel).toBe("ludwig");
    expect(e("info", null).ziel).toBe("nie");
  });
  it("Betrag über 500 € geht erst an Ludwig (Schwelle einstellbar)", () => {
    const r = e("fall_antwort", 800);
    expect(r.ziel).toBe("ludwig");
    expect(r.grund).toContain("800,00 €");
    expect(e("anspruch", 500).ziel).toBe("va");
    expect(e("anspruch", 500.01).ziel).toBe("ludwig");
    expect(vaEntscheidung({ kategorie: "anspruch", betrag: 800, schwelle: 0 }).ziel).toBe("va");
  });
  it("Einstellung je Kategorie geht vor dem Standard", () => {
    expect(e("marke", null, { marke: "va" }).ziel).toBe("va");
    expect(e("anspruch", 10, { anspruch: "nie" }).ziel).toBe("nie");
    expect(e("info", 900, { info: "nie" }).ziel).toBe("nie");
  });
});

describe("Erinnerungen vor der Frist (09:00 Manila)", () => {
  const f = (o: Partial<Parameters<typeof fristErinnerung>[0]>) => fristErinnerung({ frist: "2026-11-10", heute: "2026-11-03", zeit: "09:00", uhrzeit: "09:00", letzte: null, tage: [7, 3, 1], ...o });
  it("Frist in 8 Tagen: keine Erinnerung; an Tag −7, −3, −1 um 09:00", () => {
    expect(f({ heute: "2026-11-02" })).toBeNull();
    expect(f({ heute: "2026-11-03" })).toBe(7);
    expect(f({ heute: "2026-11-05" })).toBeNull();
    expect(f({ heute: "2026-11-07" })).toBe(3);
    expect(f({ heute: "2026-11-09" })).toBe(1);
    expect(f({ heute: "2026-11-10" })).toBeNull();
  });
  it("nicht vor 09:00 und nur einmal am Tag", () => {
    expect(f({ zeit: "08:59" })).toBeNull();
    expect(f({ zeit: "15:30" })).toBe(7);
    expect(f({ letzte: "2026-11-03" })).toBeNull();
  });
  it("09:00 Manila = 02:00 Berlin (Winterzeit)", async () => {
    const { lokal } = await import("@/lib/va/logic");
    expect(lokal(new Date("2026-11-03T01:00:00Z"), "Asia/Manila")).toEqual({ datum: "2026-11-03", zeit: "09:00" });
    expect(lokal(new Date("2026-11-03T01:00:00Z"), "Europe/Berlin")).toEqual({ datum: "2026-11-03", zeit: "02:00" });
  });
  it("Tagesbeginn in VA-Zeit", () => {
    expect(tagesbeginn(new Date("2026-11-03T05:17:42Z"), "Asia/Manila").toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(tagesbeginn(new Date("2026-11-02T20:00:00Z"), "Asia/Manila").toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(tageBis("2026-11-02", "2026-11-10")).toBe(8);
  });
});

describe("Daily overview: Arbeitstage und Feiertage", () => {
  const MO_FR = [1, 2, 3, 4, 5];
  it("Mo–Fr um 09:00, nicht am Wochenende oder Feiertag, einmal am Tag", () => {
    expect(wochentag("2026-11-02")).toBe(1);
    expect(wochentag("2026-11-01")).toBe(7);
    expect(istArbeitstag("2026-10-31", MO_FR, [])).toBe(false);
    expect(istArbeitstag("2026-11-02", MO_FR, ["2026-11-02"])).toBe(false);
    const u = (o: Partial<Parameters<typeof uebersichtFaellig>[0]>) => uebersichtFaellig({ heute: "2026-11-02", zeit: "09:00", uhrzeit: "09:00", letzte: null, arbeitstage: MO_FR, feiertage: [], ruhe: false, ...o });
    expect(u({})).toBe(true);
    expect(u({ zeit: "08:59" })).toBe(false);
    expect(u({ letzte: "2026-11-02" })).toBe(false);
    expect(u({ letzte: "2026-10-30" })).toBe(true);
    expect(u({ heute: "2026-10-31" })).toBe(false);
    expect(u({ ruhe: true })).toBe(false);
  });
  it("Feiertage aus dem Formular", () => {
    expect(feiertageAusText("01.11.2026\n2026-12-25, 30.12.2026; quatsch")).toEqual(["2026-11-01", "2026-12-25", "2026-12-30"]);
  });
  it("Text auf Englisch mit Thread-Links", () => {
    const t = uebersichtText({
      datum: "2026-11-02",
      neu: [{ titel: "File claim for shipment FBA15TEST001", threadId: "900000000000000001" }],
      heute: [{ titel: "Answer case", threadId: "900000000000000002" }],
      morgen: [],
      ueberfaellig: [{ titel: "Upload invoice", threadId: "900000000000000003", frist: "2026-10-30" }],
      wartetAufLudwig: [{ titel: "Should I escalate?", threadId: "900000000000000004" }],
      beantwortet: [],
      vaId: "700000000000000001",
    });
    expect(t).toContain("🗓️ **Daily overview – Nov 2");
    expect(t).toContain("**New since yesterday (1)**");
    expect(t).toContain("→ <#900000000000000001>");
    expect(t).toContain("**Overdue (1)**");
    expect(t).toContain("since Oct 30");
    expect(t).toContain("Your questions waiting for Ludwig");
    expect(t).not.toMatch(/Neu|Fällig|überfällig/);
    expect(uebersichtText({ datum: "2026-11-02", neu: [], heute: [], morgen: [], ueberfaellig: [], wartetAufLudwig: [], beantwortet: [], vaId: null })).toContain("Nothing new");
  });
});

describe("Fallnummer in der Antwort der VA", () => {
  it("mit Kennwort 8–12 Ziffern, ohne Kennwort 10–12", () => {
    expect(fallnummerInAntwort("Submitted, case 12345678901")).toBe("12345678901");
    expect(fallnummerInAntwort("Case ID: 1234567890 ✅")).toBe("1234567890");
    expect(fallnummerInAntwort("done #98765432")).toBe("98765432");
    expect(fallnummerInAntwort("Fall-Nr. 22907365031 eingereicht")).toBe("22907365031");
    expect(fallnummerInAntwort("filed it: 22907365031")).toBe("22907365031");
  });
  it("keine Bestellnummer, Menge, Betrag oder Datum", () => {
    expect(fallnummerInAntwort("Order 302-1234567-1234567 checked")).toBeNull();
    expect(fallnummerInAntwort("3 units, €45.00")).toBeNull();
    expect(fallnummerInAntwort("done, filed on 2026-11-02")).toBeNull();
    expect(fallnummerInAntwort("done")).toBeNull();
  });
  it("Sammel-Thread: Nummer, Kennung oder einziger offener Eintrag", () => {
    const e = [
      { nr: 1, kennungen: ["TEST-SKU-A", "X00TESTAAA"], offen: true },
      { nr: 2, kennungen: ["TEST-SKU-B", "FBA15TEST002"], offen: true },
    ];
    expect(sammelZuordnung("#2 case 12345678901\n#1 done", e)).toEqual([
      { nr: 2, fallnummer: "12345678901", erledigt: false },
      { nr: 1, fallnummer: null, erledigt: true },
    ]);
    expect(sammelZuordnung("FBA15TEST002 submitted, case 1234567890", e)).toEqual([{ nr: 2, fallnummer: "1234567890", erledigt: true }]);
    expect(sammelZuordnung("case 1234567890", e)).toEqual([]);
    expect(sammelZuordnung("case 1234567890", [e[0], { ...e[1], offen: false }])).toEqual([{ nr: 1, fallnummer: "1234567890", erledigt: false }]);
    expect(sammelZuordnung("Where do I find the invoice?", e)).toEqual([]);
  });
});

describe("Anspruchs-Thread (Englisch)", () => {
  it("enthält Art, Kennungen, Sendung, Menge, Betrag, Frist, Belege, Anleitung", () => {
    const t = anspruchText({
      titel: "Shortage in shipment FBA15TEST001",
      typ: "inbound_shortage",
      sku: "TEST-SKU-A",
      asin: "B0TESTAAAA",
      fnsku: "X00TESTAAA",
      ...bezugAus("FBA15TEST001"),
      menge: 3,
      betrag: 45,
      frist: "2026-11-10",
      heute: "2026-11-02",
      belege: ["Shipped: 10", "Received: 7"],
      anhaenge: ["invoice-test.pdf"],
      falltext: "Hello, 3 units are missing.",
      anleitung: { titel: "File reimbursement claim", schritte: ["Open Seller Central", "Reply with the case ID"] },
      vaId: "700000000000000001",
    });
    expect(t).toContain("<@700000000000000001> 💶 **New reimbursement claim: Shortage in shipment FBA15TEST001**");
    expect(t).toContain("Type: Inbound shipment shortage");
    expect(t).toContain("SKU: TEST-SKU-A · ASIN: B0TESTAAAA · FNSKU: X00TESTAAA");
    expect(t).toContain("Shipment: FBA15TEST001");
    expect(t).toContain("Quantity: 3 · Expected amount: €45.00");
    expect(t).toContain("**Deadline: Nov 10**");
    expect(t).toContain("(8 days left)");
    expect(t).toContain("• Received: 7");
    expect(t).toContain("📎 Attachments: invoice-test.pdf");
    expect(t).toContain("📖 **Instructions: File reimbursement claim**");
    expect(t).toContain("reply here with the Amazon case ID");
  });
  it("Bezug: Sendung, Bestellung oder Referenz", () => {
    expect(bezugAus("302-1234567-1234567")).toEqual({ sendung: null, bestellung: "302-1234567-1234567", referenz: null });
    expect(bezugAus("REIMB-TEST-1")).toEqual({ sendung: null, bestellung: null, referenz: "REIMB-TEST-1" });
    expect(bezugAus(null)).toEqual({ sendung: null, bestellung: null, referenz: null });
  });
});

describe("Zeile „VA heute“", () => {
  it("mit Fristen verpasst", () => {
    expect(vaHeuteText({ erledigt: 6, rueckfragen: 2, auto: 3, fristenVerpasst: 1 })).toBe("VA heute: 6 erledigt, 2 Rückfragen, 3 automatisch beantwortet, 1 Frist verpasst");
    expect(vaHeuteText({ erledigt: 0, rueckfragen: 1, auto: 0 })).toBe("VA heute: 0 erledigt, 1 Rückfrage, 0 automatisch beantwortet, 0 Fristen verpasst");
  });
});
