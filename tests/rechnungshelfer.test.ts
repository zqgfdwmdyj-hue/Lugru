import { describe, expect, it } from "vitest";
import { convertDraft, paymentDaysOf, RechnungshelferDraft } from "@/lib/invoices/rechnungshelfer";
import { parseRechnungshelferText } from "@/lib/invoices/rechnungshelfer-text";

const buyer = { name: "Ankauf Test GmbH", street: "Teststr. 1", zip: "10115", city: "Berlin", country: "DE", vatId: "DE123456789" };
const opts = { defaultPaymentDays: 14, kleinunternehmer: false, today: "2026-10-10" };

// Aufbau wie der JSON-Export des Rechnungshelfers (alle Werte erfunden).
const ship = (n: number) => ({ description: `900000000001 (${n}x)`, trackings: [{ tracking_number: "900000000001", quantity: n, service_date: "2026-10-07" }] });
const konsolen = {
  type: "invoice_draft",
  created_at: "2026-10-08T22:58:00+02:00",
  ticket: "acht-10001",
  payment_term: "Instant",
  payment_term_days: 0,
  invoice_date: "2026-10-08",
  is_reverse_charge: false,
  cross_month: false,
  region: "de",
  currency: "EUR",
  positions: [
    { product_name: "PS5 Slim Test", quantity: 3, net_unit_price: 480, net_total: 1440, tax_rate: 19, ...ship(3) },
    { product_name: "Controller Test", quantity: 3, net_unit_price: 40, net_total: 120, tax_rate: 19, ...ship(3) },
    { product_name: "Ladestation Test", quantity: 3, net_unit_price: 12.5, net_total: 37.5, tax_rate: 19, ...ship(3) },
  ],
  totals: { net: 1597.5, tax: 303.54, gross: 1901.04 },
  delivery: { date: "2026-10-07", date_until: "2026-10-07" },
  texts: { head: "…", foot: "Ticket: acht-10001", tax: "Umsatzsteuer 19%" },
};

describe("Rechnungshelfer", () => {
  it("Zahlungsziel", () => {
    expect(paymentDaysOf({ payment_term: "Instant", payment_term_days: null })).toBe(0);
    expect(paymentDaysOf({ payment_term: "60 Tage", payment_term_days: null })).toBe(60);
    expect(paymentDaysOf({ payment_term: "60 Tage", payment_term_days: 60 })).toBe(60);
    expect(paymentDaysOf({ payment_term: "irgendwas", payment_term_days: null })).toBeNull();
  });

  it("Konsolen unter 5.000 €: normale USt, Sendung in der Bezeichnung, nichts zu prüfen", () => {
    const r = convertDraft(RechnungshelferDraft.parse(konsolen), buyer, opts);
    expect(r.warnings).toEqual([]);
    expect(r.input).toMatchObject({ taxCase: "domestic", serviceDate: "2026-10-07", paymentDays: 0, reference: "Ticket acht-10001", rcWhole: false });
    expect(r.input.serviceDateTo).toBeUndefined();
    expect(r.input.lines[0]).toMatchObject({ description: "PS5 Slim Test – Sendung 900000000001 (3x)", quantity: 3, unitNet: 480, vatRate: 19, device: true });
    expect(r.input.lines[1].device).toBe(false);
    expect(r.totals.net).toBe(1597.5);
    // USt auf die Summe: 1 Cent Unterschied zum Rechnungshelfer (rundet je Position) – kein Prüfgrund.
    expect(r.totals.gross).toBe(1901.03);
  });

  it("ohne Rechnungsempfänger: Entwurf mit Hinweis", () => {
    const r = convertDraft(RechnungshelferDraft.parse(konsolen), null, opts);
    expect(r.warnings).toEqual(["Rechnungsempfänger noch nicht festgelegt."]);
  });

  it("Reverse Charge: Konsolen ohne USt, Zubehör mit USt", () => {
    const big = { ...konsolen, is_reverse_charge: true, positions: [{ ...konsolen.positions[0], quantity: 12, tax_rate: 0 }, { ...konsolen.positions[1], tax_rate: 19 }], totals: { net: 5880, tax: 22.8, gross: 5902.8 } };
    const r = convertDraft(RechnungshelferDraft.parse(big), buyer, opts);
    expect(r.warnings).toEqual([]);
    expect(r.input.rcWhole).toBe(true);
    expect(r.input.lines[0]).toMatchObject({ vatRate: 19, device: true });
    expect(r.totals).toEqual({ net: 5880, gross: 5902.8 });
  });

  it("Reverse Charge laut Rechnungshelfer, aber keine erkannte Ware → alle Positionen §13b, prüfen", () => {
    const rc = { ...konsolen, is_reverse_charge: true, positions: [{ product_name: "SSD Test 4TB", quantity: 3, net_unit_price: 400, tax_rate: 0 }], totals: { net: 1200, tax: 0, gross: 1200 } };
    const r = convertDraft(RechnungshelferDraft.parse(rc), buyer, opts);
    expect(r.input.lines[0].device).toBe(true);
    expect(r.warnings[0]).toMatch(/keine Position als Handy/);
    expect(r.totals.gross).toBe(1200);
  });

  it("Konsolen ≥ 5.000 € ohne RC-Kennzeichen → Hinweis; ohne RC-Angabe (Text/Screenshot) entscheidet § 13b allein", () => {
    const big = { ...konsolen, positions: [{ ...konsolen.positions[0], quantity: 12 }], totals: { net: 5760, tax: 1094.4, gross: 6854.4 } };
    expect(convertDraft(RechnungshelferDraft.parse(big), buyer, opts).warnings.some((w) => /kein Reverse Charge/.test(w))).toBe(true);
    const unknown = convertDraft(RechnungshelferDraft.parse({ ...big, is_reverse_charge: null, totals: { net: 5760, gross: 5760 } }), buyer, opts);
    expect(unknown.warnings).toEqual([]);
    expect(unknown.totals.gross).toBe(5760);
  });

  it("Aufschlag nur in der Summe → eigene Position + Hinweis; mehrere Sendungen → Zeitraum und Liste", () => {
    const d = {
      ...konsolen,
      ticket: "neun-10002",
      payment_term: "60 Tage",
      payment_term_days: 60,
      positions: [
        { product_name: "SSD Test 2TB", quantity: 3, net_unit_price: "250", tax_rate: 19, description: "900000000002 (2x), DE0000000003 (1x)", trackings: [{ tracking_number: "900000000002", quantity: 2, service_date: "2026-04-08" }, { tracking_number: "DE0000000003", quantity: 1, service_date: "2026-04-10" }] },
      ],
      totals: { net: 765, tax: 145.35, gross: 910.35 },
      delivery: { date: "2026-04-08", date_until: "2026-04-10" },
    };
    const r = convertDraft(RechnungshelferDraft.parse(d), buyer, opts);
    expect(r.input).toMatchObject({ serviceDate: "2026-04-08", serviceDateTo: "2026-04-10", paymentDays: 60, note: "Lieferungen: 900000000002 am 08.04.2026, DE0000000003 am 10.04.2026" });
    expect(r.input.lines[1]).toMatchObject({ description: "Zahlungsziel-Aufschlag (60 Tage)", unitNet: 15, quantity: 1 });
    expect(r.warnings[0]).toMatch(/Zahlungsziel-Aufschlag/);
    expect(r.totals.net).toBe(765);
  });

  it("unvollständiges JSON wird abgelehnt", () => {
    expect(RechnungshelferDraft.safeParse({ type: "invoice_draft", ticket: "x-1", positions: [] }).success).toBe(false);
    expect(RechnungshelferDraft.safeParse({ type: "invoice_draft", positions: konsolen.positions }).success).toBe(false);
    expect(RechnungshelferDraft.safeParse({ ...konsolen, positions: [{ product_name: "X", quantity: 1, net_unit_price: "abc" }] }).success).toBe(false);
  });

  it("Screenshot-Entwurf: immer zur Prüfung", () => {
    const r = convertDraft(RechnungshelferDraft.parse({ ...konsolen, _source: "screenshot" }), buyer, opts);
    expect(r.warnings[0]).toMatch(/Aus Screenshot gelesen/);
  });
});

// So sieht der Text aus, wenn man die Rechnungshelfer-Nachricht in Discord kopiert (Werte erfunden).
const discordText = `📋 Rechnungshelfer
Pos 1 — \`PS5 Slim Test\`
Menge: \`3\` | Netto: \`480,00\` | Brutto: \`571,20\`
Gesamt Netto: \`1440,00\` | Gesamt Brutto: \`1713,60\`

Pos 2 — \`Controller Test\`
Menge: \`3\` | Netto: \`40,00\` | Brutto: \`47,60\`
Gesamt Netto: \`120,00\` | Gesamt Brutto: \`142,80\`

Pos 3 — \`Ladestation Test\`
Menge: \`3\` | Netto: \`12,50\` | Brutto: \`14,88\`
Gesamt Netto: \`37,50\` | Gesamt Brutto: \`44,64\`

Gesamt — Netto: \`1597,50\` | Brutto: \`1901,04\`
Marge: \`49,17\`

Notiz:
Ticket: acht-10001
Lieferübersicht/Sendungsdaten:
[Pos1] PS5 Slim Test: 900000000001 (3x)
[Pos2] Controller Test: 900000000001 (3x)
[Pos3] Ladestation Test: 900000000001 (3x)

Leistungszeitraum: 07.10.2026
💳 Instant | Netto: 1597,50 | Brutto: 1901,04`;

describe("Rechnungshelfer-Text aus Discord", () => {
  it("liest Positionen, Sendungen, Ticket, Zeitraum, Zahlungsziel, Summen", () => {
    const p = parseRechnungshelferText(discordText)!;
    expect(p.notes).toEqual([]);
    expect(p.draft).toMatchObject({
      type: "invoice_draft",
      _source: "text",
      ticket: "acht-10001",
      payment_term: "Instant",
      totals: { net: 1597.5, gross: 1901.04 },
      delivery: { date: "2026-10-07", date_until: "2026-10-07" },
    });
    expect(p.draft.positions).toEqual([
      { product_name: "PS5 Slim Test", quantity: 3, net_unit_price: 480, tax_rate: 19, description: "900000000001 (3x)" },
      { product_name: "Controller Test", quantity: 3, net_unit_price: 40, tax_rate: 19, description: "900000000001 (3x)" },
      { product_name: "Ladestation Test", quantity: 3, net_unit_price: 12.5, tax_rate: 19, description: "900000000001 (3x)" },
    ]);
    // Gleiche Rechnung wie über den Webhook.
    const r = convertDraft(RechnungshelferDraft.parse(p.draft), buyer, opts);
    expect(r.warnings).toEqual([]);
    expect(r.input.lines[0].description).toBe("PS5 Slim Test – Sendung 900000000001 (3x)");
    expect(r.totals.gross).toBe(1901.03);
  });

  it("Zeitraum, Tausenderpunkte, ohne Ticket", () => {
    const t = "Pos 1 — Konsole X\nMenge: 12 | Netto: 1.234,50 | Brutto: 1.469,06\nLeistungszeitraum: 01.10.2026 - 09.10.2026\nZahlungsziel: 30 Tage";
    const p = parseRechnungshelferText(t, { now: new Date("2026-10-10T12:00:00Z") })!;
    expect(p.draft.positions[0]).toMatchObject({ quantity: 12, net_unit_price: 1234.5 });
    expect(p.draft).toMatchObject({ ticket: "discord-202610101200", payment_term: "30 Tage", delivery: { date: "2026-10-01", date_until: "2026-10-09" } });
    expect(p.notes[0]).toMatch(/Kein Ticket/);
    const r = convertDraft(RechnungshelferDraft.parse(p.draft), buyer, opts);
    expect(r.input.paymentDays).toBe(30);
    expect(r.warnings.some((w) => /Kein Ticket erkannt/.test(w))).toBe(true);
  });

  it("kein Rechnungshelfer im Text → null", () => {
    expect(parseRechnungshelferText("Hallo, wann kommt die Zahlung?")).toBeNull();
  });
});
