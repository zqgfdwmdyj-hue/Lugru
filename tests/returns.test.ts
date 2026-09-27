import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectReport, parseCustomerReturns, parseFbmReturns, parseReimbursements, parseTransactions } from "@/lib/reports/amazon";
import { monthly, reconcileFba, reconcileFbm, returnClaims, skuStats, type TxRow } from "@/lib/returns/reconcile";
import { parseDate } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";

// Erfundene Beispieldaten aus dem bisherigen Retouren-Tool (tools/make_samples.py, Stichtag 27.09.2026).
const dir = join(__dirname, "fixtures", "retouren");
const table = (f: string) => readTable(readFileSync(join(dir, f)));
const today = "2026-09-27";
const settings = { graceFba: 45, claimFba: 60, graceFbm: 21 };

const txTable = table("1-transaktionen.csv");
const tx: TxRow[] = parseTransactions(txTable)
  .filter((t) => t.kind !== "other" && t.orderId)
  .map((t) => ({ orderId: t.orderId!, sku: t.sku, date: t.date, kind: t.kind as TxRow["kind"], quantity: t.quantity, productSales: t.productSales ?? 0, shippingCredits: t.shippingCredits ?? 0, total: t.total ?? 0, channel: t.channel, description: t.description }));
const returns = parseCustomerReturns(table("2-fba-kundenretouren.txt")).map((r) => ({ orderId: r.orderId!, sku: r.sku, date: r.returnDate, quantity: r.quantity, disposition: r.disposition, reason: r.reason, title: r.title }));
const payments = [
  ...parseReimbursements(table("3-fba-erstattungen.txt")).map((r) => ({ orderId: r.orderId!, sku: r.sku, amount: r.amountTotal ?? 0, quantity: r.quantityTotal, date: r.approvalDate, reason: r.reason, source: "Erstattungsbericht" as const })),
  ...tx.filter((t) => t.kind === "reimb").map((t) => ({ orderId: t.orderId, sku: t.sku, amount: t.total, quantity: t.quantity || null, date: t.date, reason: t.description, source: "Transaktionsbericht" as const })),
];
const fbmReturns = parseFbmReturns(table("4-retourenbericht-haendlerversand.csv")).map((r) => ({ ...r, refundedAmount: r.refundedAmount ?? 0 }));
const byOrder = <T extends { orderId: string }>(rows: T[]) => new Map(rows.map((r) => [r.orderId, r]));

describe("Retouren-Abgleich", () => {
  it("erkennt alle vier Berichte, auch mit Hinweiszeile vor der Kopfzeile", () => {
    expect(["1-transaktionen.csv", "2-fba-kundenretouren.txt", "3-fba-erstattungen.txt", "4-retourenbericht-haendlerversand.csv"].map((f) => detectReport(table(f)))).toEqual([
      "transactions",
      "customerReturns",
      "reimbursements",
      "fbmReturns",
    ]);
    expect(txTable.headers[0]).toBe("Datum/Uhrzeit");
  });

  it("FBA: gleicher Status wie im bisherigen Tool", () => {
    const { rows } = reconcileFba({ tx, returns, payments }, settings, today);
    const r = byOrder(rows);
    expect(r.get("302-8830561-4471290")).toMatchObject({ status: "notReimb", amount: 119 });
    expect(r.get("306-7730021-4410982")?.status).toBe("partReimb");
    expect(r.get("306-1180452-7734110")?.status).toBe("reimbursed"); // über Anpassung im Transaktionsbericht
    expect(r.get("305-2294718-6600125")?.amazon?.amount).toBe(18.2); // über den Erstattungsbericht
    expect(r.get("303-6620184-9018843")?.status).toBe("waitAmazon");
    expect(r.get("305-8812034-2290117")?.status).toBe("amazonDamaged");
    expect(r.get("303-2290183-6617720")?.status).toBe("wrongItem");
    expect(r.get("304-3302981-5561047")?.status).toBe("pending");
    expect(r.get("306-5519024-2208736")?.overRefund).toBe(5);
  });

  it("FBA: nach dem Zahltag wird aus „ausstehend“ ein offener Fall", () => {
    const { rows } = reconcileFba({ tx, returns, payments }, { ...settings, claimFba: 50 }, today);
    expect(byOrder(rows).get("303-6620184-9018843")?.status).toBe("notReimb");
  });

  it("Händlerversand: fehlend, ohne Nachweis, noch erstatten, SAFE-T bezahlt", () => {
    const r = byOrder(reconcileFbm({ tx, returns: fbmReturns }, settings, today));
    expect(r.get("306-2291840-1187723")?.status).toBe("missing");
    expect(r.get("302-6601827-3348810")?.status).toBe("nodoc");
    expect(r.get("303-8810294-2201198")?.status).toBe("toRefund");
    expect(r.get("304-1109287-6653920")?.status).toBe("reimbursed");
  });

  it("macht aus offenen Zeilen Ansprüche", () => {
    const fba = reconcileFba({ tx, returns, payments }, settings, today).rows;
    const fbm = reconcileFbm({ tx, returns: fbmReturns }, settings, today);
    const claims = returnClaims([...fba, ...fbm], today);
    const types = (order: string) => claims.filter((c) => c.reference === order).map((c) => c.type);
    expect(types("302-8830561-4471290")).toEqual(["return_not_received"]);
    expect(types("305-8812034-2290117")).toEqual(["return_damaged"]);
    expect(types("303-2290183-6617720")).toEqual(["return_wrong_item"]);
    expect(types("306-2291840-1187723")).toEqual(["fbm_safet"]);
    expect(types("306-5519024-2208736")).toContain("refund_too_high");
    expect(types("303-6620184-9018843")).toEqual([]); // Amazon hat noch Zeit
    expect(claims.find((c) => c.reference === "302-8830561-4471290")?.refundValue).toBe(119);
  });

  it("Monate und Retourenquote je Artikel", () => {
    const { rows } = reconcileFba({ tx, returns, payments }, settings, today);
    expect(monthly(rows).length).toBeGreaterThan(0);
    const sneaker = skuStats(rows, tx, "fba", returns).find((s) => s.sku === "LG-SNK-WHT-42")!;
    expect(sneaker.sold).toBeGreaterThan(0);
    expect(sneaker.rate).toBeGreaterThan(0);
  });

  it("englischer Transaktionsbericht und Datumsformate", () => {
    const t = readTable(new TextEncoder().encode('date/time,settlement id,type,order id,sku,description,quantity,fulfillment,product sales,total\n"Sep 1, 2026 10:22:11 AM PDT",1,Refund,302-1,SKU1,Shirt,1,Amazon,-19.99,-17.50\n'));
    expect(detectReport(t)).toBe("transactions");
    expect(parseTransactions(t)[0]).toMatchObject({ kind: "refund", channel: "fba", productSales: -19.99, date: "2026-09-01" });
    expect(parseDate("01.09.2026 10:22:11 UTC")).toBe("2026-09-01");
    expect(parseDate("1. März 2026")).toBe("2026-03-01");
  });
});
