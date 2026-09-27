import { createHash } from "node:crypto";
import { parseAmount, parseDate, parseDateTime } from "@/lib/numbers";
import { columnAccessor, type Table } from "@/lib/tabular";

// Erkennt und liest Amazon-Reports (Download aus Seller Central oder per SP-API).
// Spaltennamen werden vereinheitlicht; deutsche Varianten sind mit aufgenommen.

export const REPORT_KINDS = {
  ledger: "Bestandsprotokoll (Inventory Ledger, Details)",
  reimbursements: "Erstattungen (Reimbursements)",
  customerReturns: "FBA-Kundenrücksendungen",
  removalOrders: "Remissionsaufträge (Details)",
  removalShipments: "Remissionssendungen (Details)",
  inventory: "FBA-Bestand (Manage Inventory)",
  settlement: "Abrechnung (Settlement, Flat File V2)",
  orders: "Alle Bestellungen",
  feedback: "Verkäuferbewertungen",
  fees: "FBA-Gebührenvorschau",
  transactions: "Transaktionen (Datumsbereich)",
  fbmReturns: "Retourenbericht Händlerversand",
} as const;
export type ReportKind = keyof typeof REPORT_KINDS;

type Acc = ReturnType<typeof columnAccessor>;

export function detectReport(table: Table): ReportKind | null {
  const a = columnAccessor(table.headers);
  if (a.has("event-type") || a.has("ereignistyp")) return "ledger";
  if (a.has("reimbursement-id")) return "reimbursements";
  if (a.has("return-date") && a.hasAny("license-plate-number", "detailed-disposition")) return "customerReturns";
  if (a.has("requested-quantity") && a.has("disposed-quantity")) return "removalOrders";
  if (a.has("shipment-date") && a.has("tracking-number") && a.hasAny("removal-order-type", "shipped-quantity")) return "removalShipments";
  if (a.has("afn-fulfillable-quantity")) return "inventory";
  if (a.has("settlement-id") && a.has("amount-type")) return "settlement";
  if (a.hasAny(...TX.type) && a.hasAny(...TX.total) && a.hasAny(...TX.order) && a.hasAny(...TX.date) && a.hasAny(...TX.settlement)) return "transactions";
  if (a.hasAny(...FBM.order) && a.hasAny(...FBM.rma) && a.hasAny(...FBM.requestDate)) return "fbmReturns";
  if (a.has("amazon-order-id") && a.has("fulfillment-channel")) return "orders";
  if (a.has("rating") && a.hasAny("comments", "order-id")) return "feedback";
  if (a.hasAny("expected-fulfillment-fee-per-unit", "estimated-fee-total")) return "fees";
  return null;
}

/** Stabiler Hash je Zeile; gleiche Zeilen in einer Datei werden durchgezählt. */
function hasher(kind: string) {
  const seen = new Map<string, number>();
  return (row: string[]) => {
    const base = kind + "\u0001" + row.join("\u0001");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha1").update(`${base}\u0002${n}`).digest("hex");
  };
}

const int = (v: string) => {
  const n = parseAmount(v);
  return n === null ? 0 : Math.round(n);
};
const orNull = (v: string) => (v === "" ? null : v);

function each<T>(table: Table, fn: (row: string[], a: Acc) => T | null): T[] {
  const a = columnAccessor(table.headers);
  const out: T[] = [];
  for (const row of table.rows) {
    const r = fn(row, a);
    if (r) out.push(r);
  }
  return out;
}

export function parseLedger(table: Table) {
  const h = hasher("ledger");
  return each(table, (r, a) => {
    const eventDate = parseDate(a.get(r, "date", "datum"));
    const eventType = a.get(r, "event-type", "ereignistyp");
    if (!eventDate || !eventType) return null;
    return {
      rowHash: h(r),
      eventDate,
      fnsku: orNull(a.get(r, "fnsku")),
      asin: orNull(a.get(r, "asin")),
      sku: orNull(a.get(r, "msku", "sku")),
      title: orNull(a.get(r, "title", "titel")),
      eventType,
      referenceId: orNull(a.get(r, "reference-id", "referenz-id")),
      quantity: int(a.get(r, "quantity", "menge")),
      fulfillmentCenter: orNull(a.get(r, "fulfillment-center", "versandzentrum")),
      disposition: orNull(a.get(r, "disposition")),
      reason: orNull(a.get(r, "reason", "grund")),
      country: orNull(a.get(r, "country", "land")),
      reconciledQuantity: a.hasAny("reconciled-quantity") ? int(a.get(r, "reconciled-quantity")) : null,
      unreconciledQuantity: a.hasAny("unreconciled-quantity") ? int(a.get(r, "unreconciled-quantity")) : null,
    };
  });
}

export function parseReimbursements(table: Table) {
  const h = hasher("reimb");
  return each(table, (r, a) => {
    const approvalDate = parseDate(a.get(r, "approval-date"));
    const reimbursementId = a.get(r, "reimbursement-id");
    if (!approvalDate || !reimbursementId) return null;
    return {
      rowHash: h(r),
      approvalDate,
      reimbursementId,
      caseId: orNull(a.get(r, "case-id")),
      orderId: orNull(a.get(r, "amazon-order-id", "order-id")),
      reason: orNull(a.get(r, "reason")),
      sku: orNull(a.get(r, "sku")),
      fnsku: orNull(a.get(r, "fnsku")),
      asin: orNull(a.get(r, "asin")),
      condition: orNull(a.get(r, "condition")),
      currency: orNull(a.get(r, "currency-unit", "currency")),
      amountPerUnit: parseAmount(a.get(r, "amount-per-unit")),
      amountTotal: parseAmount(a.get(r, "amount-total")),
      quantityCash: int(a.get(r, "quantity-reimbursed-cash")),
      quantityInventory: int(a.get(r, "quantity-reimbursed-inventory")),
      quantityTotal: int(a.get(r, "quantity-reimbursed-total")),
      originalReimbursementId: orNull(a.get(r, "original-reimbursement-id")),
      originalReimbursementType: orNull(a.get(r, "original-reimbursement-type")),
    };
  });
}

export function parseCustomerReturns(table: Table) {
  const h = hasher("returns");
  return each(table, (r, a) => {
    const returnDate = parseDate(a.get(r, "return-date"));
    if (!returnDate) return null;
    return {
      rowHash: h(r),
      returnDate,
      orderId: orNull(a.get(r, "order-id")),
      sku: orNull(a.get(r, "sku")),
      asin: orNull(a.get(r, "asin")),
      fnsku: orNull(a.get(r, "fnsku")),
      title: orNull(a.get(r, "product-name")),
      quantity: int(a.get(r, "quantity")) || 1,
      fulfillmentCenter: orNull(a.get(r, "fulfillment-center-id")),
      disposition: orNull(a.get(r, "detailed-disposition")),
      reason: orNull(a.get(r, "reason")),
      status: orNull(a.get(r, "status")),
      lpn: orNull(a.get(r, "license-plate-number")),
      customerComments: orNull(a.get(r, "customer-comments")),
    };
  });
}

export function parseRemovalOrders(table: Table) {
  return each(table, (r, a) => {
    const requestDate = parseDate(a.get(r, "request-date"));
    const orderId = a.get(r, "order-id");
    const sku = a.get(r, "sku");
    if (!requestDate || !orderId || !sku) return null;
    return {
      requestDate,
      orderId,
      orderType: orNull(a.get(r, "order-type")),
      orderStatus: orNull(a.get(r, "order-status")),
      lastUpdated: parseDate(a.get(r, "last-updated-date")),
      sku,
      fnsku: orNull(a.get(r, "fnsku")),
      disposition: a.get(r, "disposition"),
      requestedQuantity: int(a.get(r, "requested-quantity")),
      cancelledQuantity: int(a.get(r, "cancelled-quantity")),
      disposedQuantity: int(a.get(r, "disposed-quantity")),
      shippedQuantity: int(a.get(r, "shipped-quantity")),
      inProcessQuantity: int(a.get(r, "in-process-quantity")),
      removalFee: parseAmount(a.get(r, "removal-fee")),
      currency: orNull(a.get(r, "currency")),
    };
  });
}

export function parseRemovalShipments(table: Table) {
  const h = hasher("removalship");
  return each(table, (r, a) => {
    const orderId = a.get(r, "order-id");
    if (!orderId) return null;
    return {
      rowHash: h(r),
      requestDate: parseDate(a.get(r, "request-date")),
      orderId,
      shipmentDate: parseDate(a.get(r, "shipment-date")),
      sku: orNull(a.get(r, "sku")),
      fnsku: orNull(a.get(r, "fnsku")),
      disposition: orNull(a.get(r, "disposition")),
      shippedQuantity: int(a.get(r, "shipped-quantity")),
      carrier: orNull(a.get(r, "carrier")),
      trackingNumber: orNull(a.get(r, "tracking-number")),
      orderType: orNull(a.get(r, "removal-order-type")),
    };
  });
}

export function parseInventory(table: Table) {
  return each(table, (r, a) => {
    const sku = a.get(r, "sku");
    if (!sku) return null;
    return {
      sku,
      fnsku: orNull(a.get(r, "fnsku")),
      asin: orNull(a.get(r, "asin")),
      title: orNull(a.get(r, "product-name")),
      condition: orNull(a.get(r, "condition")),
      price: parseAmount(a.get(r, "your-price")),
      fulfillable: int(a.get(r, "afn-fulfillable-quantity")),
      unsellable: int(a.get(r, "afn-unsellable-quantity")),
      reserved: int(a.get(r, "afn-reserved-quantity")),
      inboundWorking: int(a.get(r, "afn-inbound-working-quantity")),
      inboundShipped: int(a.get(r, "afn-inbound-shipped-quantity")),
      inboundReceiving: int(a.get(r, "afn-inbound-receiving-quantity")),
      researching: int(a.get(r, "afn-researching-quantity")),
      total: int(a.get(r, "afn-total-quantity")),
      mfnFulfillable: int(a.get(r, "mfn-fulfillable-quantity")),
    };
  });
}

export type SettlementHeader = {
  settlementId: string;
  startDate: Date | null;
  endDate: Date | null;
  depositDate: Date | null;
  totalAmount: number | null;
  currency: string | null;
};

export function parseSettlement(table: Table) {
  const a = columnAccessor(table.headers);
  const h = hasher("settlement");
  const headers = new Map<string, SettlementHeader>();
  const lines = [];
  for (const r of table.rows) {
    const settlementId = a.get(r, "settlement-id");
    if (!settlementId) continue;
    const total = a.get(r, "total-amount");
    if (total !== "" || !headers.has(settlementId)) {
      const prev = headers.get(settlementId);
      headers.set(settlementId, {
        settlementId,
        startDate: parseDateTime(a.get(r, "settlement-start-date")) ?? prev?.startDate ?? null,
        endDate: parseDateTime(a.get(r, "settlement-end-date")) ?? prev?.endDate ?? null,
        depositDate: parseDateTime(a.get(r, "deposit-date")) ?? prev?.depositDate ?? null,
        totalAmount: parseAmount(total) ?? prev?.totalAmount ?? null,
        currency: orNull(a.get(r, "currency")) ?? prev?.currency ?? null,
      });
    }
    const amount = parseAmount(a.get(r, "amount"));
    if (amount === null || a.get(r, "amount-type") === "") continue;
    lines.push({
      settlementId,
      rowHash: h(r),
      transactionType: orNull(a.get(r, "transaction-type")),
      orderId: orNull(a.get(r, "order-id")),
      adjustmentId: orNull(a.get(r, "adjustment-id")),
      shipmentId: orNull(a.get(r, "shipment-id")),
      marketplace: orNull(a.get(r, "marketplace-name")),
      fulfillmentId: orNull(a.get(r, "fulfillment-id")),
      amountType: orNull(a.get(r, "amount-type")),
      amountDescription: orNull(a.get(r, "amount-description")),
      amount,
      postedDate: parseDate(a.get(r, "posted-date", "posted-date-time")),
      sku: orNull(a.get(r, "sku")),
      quantity: a.get(r, "quantity-purchased") === "" ? null : int(a.get(r, "quantity-purchased")),
    });
  }
  return { headers: [...headers.values()], lines };
}

export function parseOrdersReport(table: Table) {
  type Item = { sku: string | null; asin: string | null; title: string | null; quantity: number; price: number | null; externalItemId: string | null };
  type Order = {
    externalId: string;
    orderDate: Date;
    fulfillment: "FBA" | "FBM";
    externalStatus: string | null;
    currency: string;
    total: number;
    items: Item[];
  };
  const a = columnAccessor(table.headers);
  const orders = new Map<string, Order>();
  for (const r of table.rows) {
    const id = a.get(r, "amazon-order-id");
    const date = parseDateTime(a.get(r, "purchase-date"));
    if (!id || !date) continue;
    const channel = a.get(r, "fulfillment-channel").toLowerCase();
    const o =
      orders.get(id) ??
      ({
        externalId: id,
        orderDate: date,
        fulfillment: channel.startsWith("amazon") || channel === "afn" ? "FBA" : "FBM",
        externalStatus: orNull(a.get(r, "order-status")),
        currency: a.get(r, "currency") || "EUR",
        total: 0,
        items: [],
      } as Order);
    const price = parseAmount(a.get(r, "item-price"));
    o.total += (price ?? 0) + (parseAmount(a.get(r, "shipping-price")) ?? 0);
    o.items.push({
      sku: orNull(a.get(r, "sku")),
      asin: orNull(a.get(r, "asin")),
      title: orNull(a.get(r, "product-name")),
      quantity: int(a.get(r, "quantity")) || 1,
      price,
      externalItemId: orNull(a.get(r, "order-item-id")),
    });
    orders.set(id, o);
  }
  return [...orders.values()];
}

export function parseFeedback(table: Table) {
  const h = hasher("feedback");
  return each(table, (r, a) => {
    const date = parseDate(a.get(r, "date", "datum"));
    const rating = int(a.get(r, "rating", "bewertung"));
    if (!date || !rating) return null;
    return {
      rowHash: h(r),
      date,
      rating,
      comment: orNull(a.get(r, "comments", "kommentare")),
      orderRef: orNull(a.get(r, "order-id", "bestellnummer")),
    };
  });
}

export function parseFees(table: Table) {
  return each(table, (r, a) => {
    const asin = a.get(r, "asin");
    if (!asin) return null;
    const price = parseAmount(a.get(r, "your-price", "sales-price"));
    const referral = parseAmount(a.get(r, "estimated-referral-fee-per-unit"));
    return {
      asin,
      sku: orNull(a.get(r, "sku")),
      fbaFee: parseAmount(a.get(r, "expected-fulfillment-fee-per-unit", "expected-domestic-fulfilment-fee-per-unit")),
      referralRate: price && referral ? Math.round((referral / price) * 10000) / 10000 : null,
    };
  });
}

// --- Transaktionsbericht ----------------------------------------------------------------
// Spaltennamen deutsch und englisch (Download aus Seller Central bzw. SP-API).

const TX = {
  date: ["datum/uhrzeit", "date/time", "datum", "date"],
  settlement: ["abrechnungsnummer", "settlement-id"],
  type: ["typ", "type", "transaktionstyp"],
  order: ["bestellnummer", "order-id", "amazon-order-id"],
  sku: ["sku"],
  description: ["beschreibung", "description", "produktname"],
  quantity: ["menge", "quantity"],
  fulfillment: ["versand", "fulfillment", "fulfilment", "versandart"],
  productSales: ["umsätze", "umsatze", "product-sales", "umsatz", "produktumsätze"],
  shippingCredits: ["gutschrift-für-versandkosten", "shipping-credits", "versandgutschriften", "versandkostengutschrift"],
  sellingFees: ["verkaufsgebühren", "selling-fees"],
  fbaFees: ["gebühren-zu-versand-durch-amazon", "fba-fees", "versand-durch-amazon-gebühren"],
  total: ["gesamt", "total", "summe", "gesamtbetrag"],
};

/** Vereinfachter Text zum Vergleichen: klein, ohne Akzente und Sonderzeichen. */
const plain = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");

const REIMB_TEXT = /reimburs|customerreturn|kundenruck|entschadig/;
const REVERSAL_TEXT = /reversal|ruckbuch|storn/;

/** Ordnet eine Zeile des Transaktionsberichts ein (wie im bisherigen Retouren-Tool). */
export function classifyTransaction(type: string, description: string): "sale" | "refund" | "reimb" | "safet" | "other" {
  const t = plain(type);
  const d = plain(description);
  if (t.includes("safet") || (d.includes("safet") && (t.includes("erstatt") || t.includes("reimburs")))) return "safet";
  if ((t.includes("anpassung") || t.includes("adjustment") || REIMB_TEXT.test(t)) && REIMB_TEXT.test(d)) return "reimb";
  if ((t.includes("erstatt") || t.includes("refund")) && !REVERSAL_TEXT.test(t)) return "refund";
  if (t === "bestellung" || t === "order") return "sale";
  return "other";
}

export function channelOf(value: string): "fba" | "fbm" | "" {
  const v = plain(value);
  if (v.includes("amazon")) return "fba";
  if (["verkaufer", "seller", "handler", "merchant"].some((x) => v.includes(x))) return "fbm";
  return "";
}

export function parseTransactions(table: Table) {
  const h = hasher("tx");
  return each(table, (r, a) => {
    const type = a.get(r, ...TX.type);
    const total = parseAmount(a.get(r, ...TX.total));
    if (!type && total === null) return null;
    const description = a.get(r, ...TX.description);
    return {
      rowHash: h(r),
      date: parseDate(a.get(r, ...TX.date)),
      kind: classifyTransaction(type, description),
      type: orNull(type),
      settlementId: orNull(a.get(r, ...TX.settlement)),
      orderId: orNull(a.get(r, ...TX.order)),
      sku: orNull(a.get(r, ...TX.sku)),
      description: orNull(description),
      quantity: Math.abs(int(a.get(r, ...TX.quantity))),
      channel: channelOf(a.get(r, ...TX.fulfillment)),
      productSales: parseAmount(a.get(r, ...TX.productSales)),
      shippingCredits: parseAmount(a.get(r, ...TX.shippingCredits)),
      sellingFees: parseAmount(a.get(r, ...TX.sellingFees)),
      fbaFees: parseAmount(a.get(r, ...TX.fbaFees)),
      total,
    };
  });
}

// --- Retourenbericht Händlerversand ------------------------------------------------------

const FBM = {
  order: ["order-id", "bestellnummer"],
  orderDate: ["order-date", "bestelldatum"],
  rma: ["amazon-rma-id", "amazon-rma-nummer"],
  sku: ["merchant-sku", "händler-sku", "sku"],
  asin: ["asin"],
  title: ["item-name", "artikelname", "produktname"],
  requestDate: ["return-request-date", "rücksendeanforderungsdatum", "datum-der-rücksendeanforderung"],
  status: ["return-request-status", "status-der-rücksendeanforderung"],
  labelType: ["label-type", "etikettentyp"],
  tracking: ["tracking-id", "sendungsnummer", "trackingnummer"],
  delivery: ["return-delivery-date", "zustelldatum-der-rücksendung", "rücksendezustelldatum"],
  quantity: ["return-quantity", "rücksendemenge"],
  reason: ["return-reason", "rücksendegrund"],
  resolution: ["resolution", "lösung"],
  orderAmount: ["order-amount", "bestellbetrag"],
  refunded: ["refunded-amount", "erstatteter-betrag", "erstattungsbetrag"],
  safet: ["safet-claim-id", "safe-t-claim-id", "safe-t-antrags-id"],
};

export function parseFbmReturns(table: Table) {
  return each(table, (r, a) => {
    const orderId = a.get(r, ...FBM.order);
    if (!orderId) return null;
    const rma = orNull(a.get(r, ...FBM.rma));
    const sku = orNull(a.get(r, ...FBM.sku));
    const requestDate = parseDate(a.get(r, ...FBM.requestDate));
    return {
      rowKey: rma ? `${orderId}|${rma}|${sku ?? ""}` : `${orderId}|${sku ?? ""}|${requestDate ?? ""}`,
      orderId,
      orderDate: parseDate(a.get(r, ...FBM.orderDate)),
      rma,
      sku,
      asin: orNull(a.get(r, ...FBM.asin)),
      title: orNull(a.get(r, ...FBM.title)),
      requestDate,
      status: orNull(a.get(r, ...FBM.status)),
      labelType: orNull(a.get(r, ...FBM.labelType)),
      tracking: orNull(a.get(r, ...FBM.tracking)),
      deliveryDate: parseDate(a.get(r, ...FBM.delivery)),
      quantity: int(a.get(r, ...FBM.quantity)) || 1,
      reason: orNull(a.get(r, ...FBM.reason)),
      resolution: orNull(a.get(r, ...FBM.resolution)),
      orderAmount: parseAmount(a.get(r, ...FBM.orderAmount)),
      refundedAmount: parseAmount(a.get(r, ...FBM.refunded)),
      safetClaimId: orNull(a.get(r, ...FBM.safet)),
    };
  });
}
