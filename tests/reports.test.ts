import { describe, expect, it } from "vitest";
import {
  detectReport,
  parseCustomerReturns,
  parseInventory,
  parseLedger,
  parseOrdersReport,
  parseReimbursements,
  parseRemovalOrders,
  parseSettlement,
} from "@/lib/reports/amazon";
import { parseDelimited, readTable } from "@/lib/tabular";

const tsv = (s: string) => readTable(new TextEncoder().encode(s));

describe("parseDelimited", () => {
  it("versteht Anführungszeichen, Kommas und Zeilenumbrüche in Feldern", () => {
    expect(parseDelimited('a,b\n"x, y","z ""q""\nneu"\n')).toEqual([["a", "b"], ["x, y", 'z "q"\nneu']]);
  });
  it("erkennt Tabulatoren", () => {
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("Amazon-Reports", () => {
  it("Inventory Ledger", () => {
    const t = tsv(
      '"Date","FNSKU","ASIN","MSKU","Title","Event Type","Reference ID","Quantity","Fulfillment Center","Disposition","Reason","Country"\n' +
        '"09/20/2026","X001TEST01","B0TEST0001","SKU-1","Artikel","Adjustments","123","-1","DTM2","SELLABLE","M","DE"\n' +
        '"09/20/2026","X001TEST01","B0TEST0001","SKU-1","Artikel","Adjustments","123","-1","DTM2","SELLABLE","M","DE"\n',
    );
    expect(detectReport(t)).toBe("ledger");
    const rows = parseLedger(t);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ eventDate: "2026-09-20", sku: "SKU-1", eventType: "Adjustments", quantity: -1, reason: "M" });
    expect(rows[0].rowHash).not.toBe(rows[1].rowHash);
  });

  it("Erstattungen", () => {
    const t = tsv(
      "approval-date\treimbursement-id\tcase-id\tamazon-order-id\treason\tsku\tfnsku\tasin\tproduct-name\tcondition\tcurrency-unit\tamount-per-unit\tamount-total\tquantity-reimbursed-cash\tquantity-reimbursed-inventory\tquantity-reimbursed-total\n" +
        "2026-09-01T10:00:00+00:00\t111\t\t\tLost_Warehouse\tSKU-1\tX001TEST01\tB0TEST0001\tArtikel\tNew\tEUR\t4,10\t4,10\t1\t0\t1\n",
    );
    expect(detectReport(t)).toBe("reimbursements");
    expect(parseReimbursements(t)[0]).toMatchObject({ approvalDate: "2026-09-01", reimbursementId: "111", reason: "Lost_Warehouse", amountTotal: 4.1, quantityCash: 1 });
  });

  it("Kundenrücksendungen mit LPN", () => {
    const t = tsv(
      "return-date\torder-id\tsku\tasin\tfnsku\tproduct-name\tquantity\tfulfillment-center-id\tdetailed-disposition\treason\tstatus\tlicense-plate-number\tcustomer-comments\n" +
        "2026-09-10T08:00:00+00:00\t302-1\tSKU-1\tB0TEST0001\tX001TEST01\tArtikel\t1\tDTM2\tSELLABLE\tUNWANTED_ITEM\tUnit returned to inventory\tLPNHE100000001\t\n",
    );
    expect(detectReport(t)).toBe("customerReturns");
    expect(parseCustomerReturns(t)[0]).toMatchObject({ orderId: "302-1", lpn: "LPNHE100000001", disposition: "SELLABLE" });
  });

  it("Remissionsaufträge", () => {
    const t = tsv(
      "request-date\torder-id\torder-source\torder-type\torder-status\tlast-updated-date\tsku\tfnsku\tdisposition\trequested-quantity\tcancelled-quantity\tdisposed-quantity\tshipped-quantity\tin-process-quantity\tremoval-fee\tcurrency\n" +
        "2026-08-01T00:00:00+00:00\tR1\tSeller-initiated Manual Removal\tReturn\tCompleted\t2026-08-20T00:00:00+00:00\tSKU-1\tX001TEST01\tUnsellable\t3\t0\t0\t3\t0\t1,50\tEUR\n",
    );
    expect(detectReport(t)).toBe("removalOrders");
    expect(parseRemovalOrders(t)[0]).toMatchObject({ orderId: "R1", orderType: "Return", shippedQuantity: 3, removalFee: 1.5 });
  });

  it("Bestand", () => {
    const t = tsv("sku\tfnsku\tasin\tproduct-name\tcondition\tyour-price\tafn-fulfillable-quantity\tafn-unsellable-quantity\tafn-total-quantity\nSKU-1\tX001TEST01\tB0TEST0001\tArtikel\tNew\t19.99\t5\t2\t7\n");
    expect(detectReport(t)).toBe("inventory");
    expect(parseInventory(t)[0]).toMatchObject({ sku: "SKU-1", fulfillable: 5, unsellable: 2, total: 7, price: 19.99 });
  });

  it("Abrechnung mit Kopfzeile", () => {
    const t = tsv(
      "settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\ttotal-amount\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tposted-date\tsku\tquantity-purchased\n" +
        "S1\t01.09.2026 00:00:00 UTC\t15.09.2026 00:00:00 UTC\t17.09.2026 00:00:00 UTC\t1234,56\tEUR\t\t\t\t\t\t\t\t\n" +
        "S1\t\t\t\t\t\tOrder\t302-1\tItemPrice\tPrincipal\t19,99\t05.09.2026\tSKU-1\t1\n" +
        "S1\t\t\t\t\t\tOrder\t302-1\tItemFees\tCommission\t-3,00\t05.09.2026\tSKU-1\t\n",
    );
    expect(detectReport(t)).toBe("settlement");
    const s = parseSettlement(t);
    expect(s.headers[0]).toMatchObject({ settlementId: "S1", totalAmount: 1234.56 });
    expect(s.headers[0].depositDate?.toISOString().slice(0, 10)).toBe("2026-09-17");
    expect(s.lines).toHaveLength(2);
    expect(s.lines[1]).toMatchObject({ amountType: "ItemFees", amount: -3, sku: "SKU-1" });
  });

  it("Alle Bestellungen, gruppiert je Bestellung", () => {
    const t = tsv(
      "amazon-order-id\tmerchant-order-id\tpurchase-date\torder-status\tfulfillment-channel\tproduct-name\tsku\tasin\tquantity\tcurrency\titem-price\tshipping-price\n" +
        "302-1\t\t2026-09-05T10:00:00+00:00\tShipped\tAmazon\tA\tSKU-1\tB0TEST0001\t1\tEUR\t19.99\t0\n" +
        "302-2\t\t2026-09-06T10:00:00+00:00\tPending\tMerchant\tB\tSKU-2\tB0TEST0002\t2\tEUR\t10.00\t4.90\n" +
        "302-2\t\t2026-09-06T10:00:00+00:00\tPending\tMerchant\tC\tSKU-3\tB0TEST0003\t1\tEUR\t5.00\t0\n",
    );
    expect(detectReport(t)).toBe("orders");
    const o = parseOrdersReport(t);
    expect(o).toHaveLength(2);
    expect(o[1]).toMatchObject({ externalId: "302-2", fulfillment: "FBM", total: 19.9 });
    expect(o[1].items).toHaveLength(2);
  });
});
