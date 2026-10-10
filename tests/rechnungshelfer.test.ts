import { describe, expect, it } from "vitest";
import { convertDraft, paymentDaysOf, RechnungshelferDraft, ticketPrefix } from "@/lib/invoices/rechnungshelfer";

const buyer = { name: "Ankauf Test GmbH", street: "Teststr. 1", zip: "10115", city: "Berlin", country: "DE", vatId: "DE123456789" };
const opts = { defaultPaymentDays: 14, kleinunternehmer: false, today: "2026-10-10" };

// Aufbau wie der JSON-Export des Rechnungshelfers (Werte erfunden).
const konsolen = {
  type: "invoice_draft",
  created_at: "2026-10-08T22:58:00+02:00",
  ticket: "sieben-12747",
  payment_term: "Instant",
  payment_term_days: 0,
  invoice_date: "2026-10-08",
  is_reverse_charge: false,
  cross_month: false,
  region: "de",
  currency: "EUR",
  positions: [
    { product_name: "PS5 Disc Slim 0110", quantity: 3, net_unit_price: 508.13, net_total: 1524.39, tax_rate: 19, description: "404628079027 (3x)", trackings: [{ tracking_number: "404628079027", quantity: 3, service_date: "2026-10-07" }] },
    { product_name: "Dualsense White 0110", quantity: 3, net_unit_price: 41.2, net_total: 123.6, tax_rate: 19, description: "404628079027 (3x)", trackings: [{ tracking_number: "404628079027", quantity: 3, service_date: "2026-10-07" }] },
    { product_name: "PS5 Dualsense Ladestation 0110", quantity: 3, net_unit_price: 13.27, net_total: 39.81, tax_rate: 19, description: "404628079027 (3x)", trackings: [{ tracking_number: "404628079027", quantity: 3, service_date: "2026-10-07" }] },
  ],
  totals: { net: 1687.8, tax: 320.67, gross: 2008.47 },
  delivery: { date: "2026-10-07", date_until: "2026-10-07" },
  texts: { head: "…", foot: "Ticket: sieben-12747", tax: "Umsatzsteuer 19%" },
};

describe("Rechnungshelfer", () => {
  it("Ticket → Server-Präfix, Zahlungsziel", () => {
    expect(ticketPrefix("sieben-12747")).toBe("sieben");
    expect(ticketPrefix("drittserver-14181")).toBe("drittserver");
    expect(ticketPrefix("Mein Server-77")).toBe("mein server");
    expect(paymentDaysOf({ payment_term: "Instant", payment_term_days: null })).toBe(0);
    expect(paymentDaysOf({ payment_term: "60 Tage", payment_term_days: null })).toBe(60);
    expect(paymentDaysOf({ payment_term: "60 Tage", payment_term_days: 60 })).toBe(60);
    expect(paymentDaysOf({ payment_term: "irgendwas", payment_term_days: null })).toBeNull();
  });

  it("Konsolen unter 5.000 €: normale USt, Sendung in der Bezeichnung, nichts zu prüfen", () => {
    const d = RechnungshelferDraft.parse(konsolen);
    const r = convertDraft(d, buyer, opts);
    expect(r.warnings).toEqual([]);
    expect(r.input).toMatchObject({ taxCase: "domestic", serviceDate: "2026-10-07", paymentDays: 0, reference: "Ticket sieben-12747", rcWhole: false });
    expect(r.input.serviceDateTo).toBeUndefined();
    expect(r.input.lines[0]).toMatchObject({ description: "PS5 Disc Slim 0110 – Sendung 404628079027 (3x)", quantity: 3, unitNet: 508.13, vatRate: 19, device: true });
    expect(r.input.lines[1].device).toBe(false);
    expect(r.totals.net).toBe(1687.8);
    // USt auf die Summe: 1 Cent Unterschied zum Rechnungshelfer (rundet je Position) – kein Prüfgrund.
    expect(r.totals.gross).toBe(2008.48);
  });

  it("ohne Kunden: Entwurf mit Hinweis", () => {
    const r = convertDraft(RechnungshelferDraft.parse(konsolen), null, opts);
    expect(r.warnings).toEqual(["Kunde für „sieben“ noch nicht festgelegt."]);
  });

  it("Reverse Charge: Konsolen ohne USt, Zubehör mit USt", () => {
    const big = { ...konsolen, is_reverse_charge: true, positions: [{ ...konsolen.positions[0], quantity: 12, tax_rate: 0 }, { ...konsolen.positions[1], tax_rate: 19 }], totals: { net: 6221.16, tax: 23.48, gross: 6244.64 } };
    const r = convertDraft(RechnungshelferDraft.parse(big), buyer, opts);
    expect(r.warnings).toEqual([]);
    expect(r.input.rcWhole).toBe(true);
    expect(r.input.lines[0]).toMatchObject({ vatRate: 19, device: true });
    expect(r.totals).toEqual({ net: 6221.16, gross: 6244.64 });
  });

  it("Reverse Charge laut Rechnungshelfer, aber keine erkannte Ware → alle Positionen §13b, prüfen", () => {
    const rc = { ...konsolen, is_reverse_charge: true, positions: [{ product_name: "Samsung 9100 Pro 4TB 0904", quantity: 3, net_unit_price: 467.91, tax_rate: 0 }], totals: { net: 1403.73, tax: 0, gross: 1403.73 } };
    const r = convertDraft(RechnungshelferDraft.parse(rc), buyer, opts);
    expect(r.input.lines[0].device).toBe(true);
    expect(r.warnings[0]).toMatch(/keine Position als Handy/);
    expect(r.totals.gross).toBe(1403.73);
  });

  it("Konsolen ≥ 5.000 € ohne RC-Kennzeichen → Hinweis", () => {
    const big = { ...konsolen, positions: [{ ...konsolen.positions[0], quantity: 12 }], totals: { net: 6097.56, tax: 1158.54, gross: 7256.1 } };
    const r = convertDraft(RechnungshelferDraft.parse(big), buyer, opts);
    expect(r.warnings.some((w) => /kein Reverse Charge/.test(w))).toBe(true);
  });

  it("Aufschlag nur in der Summe → eigene Position + Hinweis; mehrere Sendungen → Zeitraum und Liste", () => {
    const d = {
      ...konsolen,
      ticket: "drittserver-14181",
      payment_term: "60 Tage",
      payment_term_days: 60,
      positions: [
        { product_name: "Samsung 9100 Pro 2TB 1004", quantity: 3, net_unit_price: "250.18", tax_rate: 19, description: "400201535482 (2x), DE5378149289 (1x)", trackings: [{ tracking_number: "400201535482", quantity: 2, service_date: "2026-04-08" }, { tracking_number: "DE5378149289", quantity: 1, service_date: "2026-04-10" }] },
      ],
      totals: { net: 765.54, tax: 145.45, gross: 910.99 },
      delivery: { date: "2026-04-08", date_until: "2026-04-10" },
    };
    const r = convertDraft(RechnungshelferDraft.parse(d), buyer, opts);
    expect(r.input).toMatchObject({ serviceDate: "2026-04-08", serviceDateTo: "2026-04-10", paymentDays: 60, note: "Lieferungen: 400201535482 am 08.04.2026, DE5378149289 am 10.04.2026" });
    expect(r.input.lines[1]).toMatchObject({ description: "Zahlungsziel-Aufschlag (60 Tage)", unitNet: 15, quantity: 1 });
    expect(r.warnings[0]).toMatch(/Zahlungsziel-Aufschlag/);
    expect(r.totals.net).toBe(765.54);
  });

  it("unvollständiges JSON wird abgelehnt", () => {
    expect(RechnungshelferDraft.safeParse({ type: "invoice_draft", ticket: "x-1", positions: [] }).success).toBe(false);
    expect(RechnungshelferDraft.safeParse({ type: "invoice_draft", positions: konsolen.positions }).success).toBe(false);
    expect(RechnungshelferDraft.safeParse({ ...konsolen, positions: [{ product_name: "X", quantity: 1, net_unit_price: "abc" }] }).success).toBe(false);
  });
});
