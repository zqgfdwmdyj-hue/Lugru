// sellerboard-Connector: Antworten auswerten und auf das Seller-System abbilden. Reine Logik (ohne DB/Netz).
// Die Werkzeuge antworten mit einer Textzeile („products: success …“) und danach JSON.

import type { SbShipmentLine, SbTopRow } from "@/db/tables/sellerboard";

type Obj = Record<string, unknown>;

/** JSON-Teil einer Werkzeug-Antwort; Fehlertext, wenn keiner da ist. */
export function parseToolText(text: string): Obj {
  const t = text.trim();
  const at = t.startsWith("{") ? 0 : t.indexOf("\n{");
  if (at < 0) throw new Error(`sellerboard: ${t.split("\n")[0].slice(0, 200) || "leere Antwort"}`);
  try {
    return JSON.parse(t.slice(at).trim()) as Obj;
  } catch {
    throw new Error(`sellerboard: Antwort nicht lesbar (${t.split("\n")[0].slice(0, 120)})`);
  }
}

/** „preparing“ = sellerboard rechnet noch – gleiche Anfrage gleich noch einmal. */
export const isPreparing = (o: Obj) => o.status === "preparing";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown, def = 0) => {
  const n = num(v);
  return n === null ? def : Math.round(n);
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Unix-Sekunden → JJJJ-MM-TT (UTC); sellerboard liefert für „kein Datum“ sehr kleine Werte. */
export const dayOf = (v: unknown): string | null => {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
};

export type SbProduct = { sbId: string; sku: string; asin: string | null; ean: string | null; name: string | null; channel: string | null; cost: number | null; costPeriod: string | null; price: number | null; fbaFee: number | null; referralFee: number | null; vatPct: number | null; margin: number | null };

/** Produktzeile. EK 0 heißt in sellerboard „nicht hinterlegt“ → null (nicht 0 €). */
export function mapProduct(r: Obj): SbProduct | null {
  const sbId = str(r.ProductID);
  const sku = str(r.SKU);
  if (!sbId || !sku) return null;
  const cost = num(r.Cost);
  return {
    sbId,
    sku,
    asin: str(r.ASIN),
    ean: str(r.EAN),
    name: str(r.Name),
    channel: str(r.Channel),
    cost: cost !== null && cost > 0 ? Math.round(cost * 10000) / 10000 : null,
    costPeriod: str(r.CostPeriod),
    price: num(r.Price),
    fbaFee: num(r.FBAFees),
    referralFee: num(r.ReferralFee),
    vatPct: num(r.VAT),
    margin: num(r.Margin),
  };
}

export type SbInventory = { sbId: string; sku: string; asin: string | null; fnsku: string | null; name: string | null; channel: string | null; fbaStock: number; reserved: number; inbound: number; salesVelocity: number | null; daysLeft: number | null; timeToReorder: string | null; daysToReorder: number | null; qtyToReorder: number; runningOut: string | null; cost: number | null };

/**
 * Bestandszeile. „Reserviert“ wie im FBA-Bericht: Kundenbestellungen + Umlagerung + Bearbeitung (sellerboards
 * eigenes Feld „Reserved“ zählt die Kundenbestellungen nicht mit).
 */
export function mapInventory(r: Obj): SbInventory | null {
  const sbId = str(r.ProductID);
  const sku = str(r.SKU);
  if (!sbId || !sku) return null;
  const parts = [r.reserved_customerorders, r.reserved_fc_transfers, r.reserved_fc_processing].map((v) => num(v));
  const reserved = parts.some((p) => p !== null) ? parts.reduce<number>((s, p) => s + (p ?? 0), 0) : int(r.Reserved);
  const cost = num(r.Cost);
  return {
    sbId,
    sku,
    asin: str(r.ASIN),
    fnsku: str(r.FNSKU),
    name: str(r.Name),
    channel: str(r.Channel),
    fbaStock: Math.max(0, int(r.FBAStock)),
    reserved: Math.max(0, Math.round(reserved)),
    inbound: Math.max(0, int(r.SentToFBA)),
    salesVelocity: num(r.SalesVelocity),
    daysLeft: num(r.DaysOfStockLeft) === null ? null : int(r.DaysOfStockLeft),
    timeToReorder: str(r.TimeToReorder),
    daysToReorder: num(r.DaysToReorder) === null ? null : int(r.DaysToReorder),
    qtyToReorder: Math.max(0, int(r.QtyToReorder)),
    runningOut: str(r.RunningOutOfStock),
    cost: cost !== null && cost > 0 ? cost : null,
  };
}

export type SbShipment = { sbId: string; amazonId: string | null; name: string | null; status: string; createdOn: string | null; lastUpdate: string | null; lines: SbShipmentLine[] };

/**
 * Versandpläne → einzelne Amazon-Sendungen (nur die tragen eine Amazon-Sendungsnummer und empfangene Mengen).
 * Produkte stehen in der Antwort einmal unter „products“ und werden über die id zugeordnet.
 */
export function mapShipments(reply: Obj): SbShipment[] {
  const products = new Map<string, Obj>();
  for (const p of (reply.products as Obj[] | undefined) ?? []) if (str(p.ProductID)) products.set(String(p.ProductID), p);
  const out: SbShipment[] = [];
  for (const plan of (reply.result as Obj[] | undefined) ?? []) {
    for (const s of (plan.shipments as Obj[] | undefined) ?? []) {
      const sbId = str(s.id);
      if (!sbId) continue;
      const lines: SbShipmentLine[] = [];
      for (const l of (s.products as Obj[] | undefined) ?? []) {
        const p = products.get(String(l.id)) ?? {};
        const sku = str(p.SKU);
        if (!sku) continue;
        lines.push({ sku, fnsku: str(p.fnsku) ?? str(p.FNSKU), asin: str(p.ASIN), name: str(p.Name), units: Math.max(0, int(l.Units)), received: Math.max(0, int(l.UnitsReceived)) });
      }
      out.push({ sbId, amazonId: str(s.amazonId), name: str(s.name) ?? str(plan.number), status: (str(s.status) ?? str(plan.status) ?? "UNKNOWN").toUpperCase(), createdOn: dayOf(s.date ?? plan.date), lastUpdate: dayOf(s.last_update_date ?? plan.last_update_date), lines });
    }
  }
  return out;
}

export type SbMonth = { month: string; sales: number | null; units: number | null; orders: number | null; refunds: number | null; amazonFees: number | null; productCosts: number | null; expenses: number | null; grossProfit: number | null; netProfit: number | null; payout: number | null };

/** Monatswerte aus dashboard_period (eine Periode je Monat). */
export function mapMonths(reply: Obj, monthOfStart: (unix: number) => string): SbMonth[] {
  const out: SbMonth[] = [];
  for (const p of (reply.result as Obj[] | undefined) ?? []) {
    const info = ((p.data as Obj | undefined)?.Info ?? null) as Obj | null;
    if (!info || p.has_data === false) continue;
    out.push({
      month: monthOfStart(Number(p.start)),
      sales: num(info.Sales),
      units: num(info.Units) === null ? null : int(info.Units),
      orders: num(info.Orders) === null ? null : int(info.Orders),
      refunds: num(info.Refunds) === null ? null : int(info.Refunds),
      amazonFees: num(info.AmazonFees),
      productCosts: num(info.ProductCosts),
      expenses: num(info.Expenses),
      grossProfit: num(info.GrossProfit),
      netProfit: num(info.NetProfit),
      payout: num(info.EstPayout),
    });
  }
  return out;
}

export type SbSkuMonth = { sku: string; asin: string | null; name: string | null; units: number | null; sales: number | null; netProfit: number | null };

/** Zeilen aus dashboard_table (entry_type product). */
export function mapSkuRows(reply: Obj): SbSkuMonth[] {
  const out: SbSkuMonth[] = [];
  for (const r of (reply.result as Obj[] | undefined) ?? []) {
    const i = (r.Info ?? r) as Obj;
    const sku = str(i.SKU);
    if (!sku) continue;
    out.push({ sku, asin: str(i.ASIN), name: str(i.Name), units: num(i.Units) === null ? null : int(i.Units), sales: num(i.Sales), netProfit: num(i.NetProfit) });
  }
  return out;
}

export type SbFixCost = { ref: string; name: string; amount: number; recurrence: "monthly" | "weekly" | "none"; start: string; end: string | null };

/**
 * Fixkosten: sellerboard liefert je Monat eine Zeile („<id>_<JJJJMMTT>“). Zusammengefasst je Kostenposten mit dem
 * zuletzt gültigen Betrag; Einmaliges nur, wenn es noch kommt (für die Vorschau zählt nur die Zukunft).
 */
export function mapFixCosts(rows: Obj[], today: string): SbFixCost[] {
  const byRef = new Map<string, { row: Obj; at: number }>();
  for (const r of rows) {
    const id = str(r.id);
    if (!id || r.Forecast === true) continue;
    const ref = id.replace(/_\d{8}$/, "");
    const at = num(r.OperDate) ?? 0;
    const cur = byRef.get(ref);
    if (!cur || at > cur.at) byRef.set(ref, { row: r, at });
  }
  const out: SbFixCost[] = [];
  for (const [ref, { row, at }] of byRef) {
    const type = (str(row.Type) ?? "").toLowerCase();
    const recurrence = type.startsWith("month") ? "monthly" : type.startsWith("week") ? "weekly" : "none";
    const amount = num(row.Sum);
    if (amount === null || amount === 0) continue;
    const end = dayOf(row.enddate);
    if (end && end < today) continue;
    const start = recurrence === "none" ? dayOf(at) : dayOf(row.begindate) ?? dayOf(at);
    if (!start || (recurrence === "none" && start < today)) continue;
    out.push({ ref, name: str(row.Name) ?? "Fixkosten", amount: -Math.abs(amount), recurrence, start, end });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/**
 * Fehlmengen einer abgeschlossenen Amazon-Sendung: verschickt − empfangen je Zeile (nur > 0). „Abgeschlossen“ =
 * CLOSED, oder seit `graceDays` keine Änderung mehr in Annahme (RECEIVING/CHECKED_IN/DELIVERED).
 */
export function shipmentShortages<L extends { units: number; received: number }>(s: { status: string; lastUpdate: string | null; lines: L[] }, today: string, graceDays: number) {
  const settledStates = ["RECEIVING", "CHECKED_IN", "DELIVERED"];
  const quietSince = s.lastUpdate ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${s.lastUpdate}T12:00:00Z`)) / 86_400_000) : 0;
  const final = s.status === "CLOSED" || (settledStates.includes(s.status) && quietSince >= graceDays);
  if (!final) return [];
  return s.lines.filter((l) => l.units > l.received).map((l) => ({ ...l, missing: l.units - l.received }));
}

// ---- Verkaufs-Kennzahlen (Kacheln wie im sellerboard-Dashboard), Amazon und eBay

export type SbChannel = "amazon" | "ebay";
export type SbKpi = { fromDay: string; toDay: string; sales: number | null; orders: number | null; units: number | null; refunds: number | null; advertising: number | null; payout: number | null; grossProfit: number | null; netProfit: number | null; missingCost: boolean };

/** Kennzahlen je Zeitraum aus dashboard_period bzw. ebay_dashboard_period. */
export function mapKpis(reply: Obj): SbKpi[] {
  const out: SbKpi[] = [];
  for (const p of (reply.result as Obj[] | undefined) ?? []) {
    const data = (p.data as Obj | undefined) ?? {};
    const info = (data.Info ?? null) as Obj | null;
    const fromDay = dayOf(p.start);
    const toDay = dayOf(p.end);
    if (!info || !fromDay || !toDay) continue;
    const ex = (data.Exclamations ?? {}) as Obj;
    out.push({
      fromDay,
      toDay,
      sales: num(info.Sales),
      orders: num(info.Orders) === null ? null : int(info.Orders),
      units: num(info.Units) === null ? null : int(info.Units),
      refunds: num(info.Refunds) === null ? null : int(info.Refunds),
      advertising: num(info.Advertising),
      payout: num(info.EstPayout),
      grossProfit: num(info.GrossProfit),
      netProfit: num(info.NetProfit),
      missingCost: ex.exclamation_product_cost === true,
    });
  }
  return out;
}

export type SbTop = SbTopRow;

/** Produktzeilen (dashboard_table / ebay_dashboard_table, entry_type product). Nur https-Bilder/-Links. */
export function mapTop(reply: Obj): SbTop[] {
  const https = (v: unknown) => {
    const s = str(v);
    return s && /^https:\/\//i.test(s) ? s : null;
  };
  return ((reply.result as Obj[] | undefined) ?? []).map((r) => {
    const i = (r.Info ?? r) as Obj;
    const variant = str(i.variant_name);
    return {
      name: str(i.Name) ? `${str(i.Name)}${variant ? ` (${variant})` : ""}` : null,
      sku: str(i.SKU),
      image: https(i.Image),
      link: https(i.LinkToAmazon) ?? https(i.Link),
      units: Math.max(0, int(i.Units)),
      refunds: Math.max(0, int(i.Refunds)),
      sales: num(i.Sales),
      netProfit: num(i.NetProfit),
    };
  });
}

const DAY = 86_400;
const unixDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
const isoOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** Kachel-Zeiträume wie im sellerboard-Dashboard (UTC-Tage): heute, gestern, Monat bis heute, letzter Monat. */
export function tilePeriods(todayUtc: string) {
  const t = unixDay(todayUtc);
  const [y, m] = todayUtc.split("-").map(Number);
  const monthStart = Date.UTC(y, m - 1, 1) / 1000;
  const lastStart = Date.UTC(y, m - 2, 1) / 1000;
  const lastEnd = monthStart - DAY;
  return [
    { key: "heute", label: "Heute", start: t, end: t },
    { key: "gestern", label: "Gestern", start: t - DAY, end: t - DAY },
    { key: "monat", label: "Monat bis heute", start: monthStart, end: t },
    { key: "vormonat", label: "Letzter Monat", start: lastStart, end: lastEnd },
  ].map((p) => ({ ...p, fromDay: isoOf(p.start), toDay: isoOf(p.end) }));
}

/** Die letzten n Tage (UTC, ältester zuerst) in Paketen zu höchstens 12 Zeiträumen je Abruf. */
export function dayBatches(todayUtc: string, n: number) {
  const t = unixDay(todayUtc);
  const days = Array.from({ length: n }, (_, i) => t - (n - 1 - i) * DAY);
  return Array.from({ length: Math.ceil(n / 12) }, (_, i) => days.slice(i * 12, i * 12 + 12).map((d) => ({ start: d, end: d })));
}

export type KpiSum = { sales: number; orders: number; units: number; refunds: number; advertising: number; payout: number; grossProfit: number; netProfit: number; missingCost: boolean };

/** Kanäle zusammenzählen (wie sellerboard „alle Kanäle“). Fehlende Werte zählen als 0. */
export function sumKpis(rows: Partial<SbKpi>[]): KpiSum {
  const s: KpiSum = { sales: 0, orders: 0, units: 0, refunds: 0, advertising: 0, payout: 0, grossProfit: 0, netProfit: 0, missingCost: false };
  for (const r of rows) {
    s.sales += r.sales ?? 0;
    s.orders += r.orders ?? 0;
    s.units += r.units ?? 0;
    s.refunds += r.refunds ?? 0;
    s.advertising += r.advertising ?? 0;
    s.payout += r.payout ?? 0;
    s.grossProfit += r.grossProfit ?? 0;
    s.netProfit += r.netProfit ?? 0;
    s.missingCost ||= r.missingCost === true;
  }
  return s;
}

/** Sammelaufgabe „Nachbestellen“: nur was sellerboard ausdrücklich als „jetzt“ markiert. */
export function reorderNow(rows: Pick<SbInventory, "timeToReorder" | "qtyToReorder">[]) {
  return rows.filter((r) => (r.timeToReorder ?? "").toUpperCase() === "YES" && r.qtyToReorder > 0);
}
