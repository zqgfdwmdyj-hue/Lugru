// Gewinn ehrlich rechnen: Umsatz, vorläufiges Ergebnis (nur bekannte Kosten) und vollständig berechneter
// Gewinn (nur Positionen, bei denen Preis, EK und Gebühren bekannt sind) getrennt. Fehlende Werte werden
// gezählt und nie still als 0 € gerechnet. Reine Logik – Abfragen stehen in profit.ts / costs.ts.

export type CostSource = "charge" | "manuell" | "ebay" | "set";
/** `detail` = genaue Herkunft (z. B. Angebot/Variante), `inherited` = Wert stammt nicht von der SKU selbst. */
export type CostInfo = { cost: number; source: CostSource; detail?: string; inherited?: boolean };

export const COST_SOURCE_LABEL: Record<CostSource, string> = { charge: "Charge", manuell: "von Hand (EK je SKU)", ebay: "eBay-Tool", set: "Summe der Set-Bestandteile" };

/** [SKU, EK, Herkunft, geerbt] */
export type CostPair = [string, number | null | undefined, string?, boolean?];

/** EK je SKU aus mehreren Quellen – die erste gefundene gewinnt (Reihenfolge der Quellen). */
export function mergeCosts(...sources: [CostSource, Iterable<CostPair>][]): Map<string, CostInfo> {
  const out = new Map<string, CostInfo>();
  for (const [source, entries] of sources) {
    for (const [sku, cost, detail, inherited] of entries) {
      const k = sku?.trim();
      if (!k || out.has(k) || cost === null || cost === undefined || !Number.isFinite(cost) || cost < 0) continue;
      out.set(k, { cost, source, ...(detail ? { detail } : {}), ...(inherited ? { inherited: true } : {}) });
    }
  }
  return out;
}

/**
 * EK eines Sets ohne eigenen EK: Summe der Bestandteile (Menge × EK), nur wenn alle Bestandteile einen EK
 * haben. Sets sind in der Wawi virtuell (Bestand aus den Einzelsorten) – also zählen die Komponenten.
 */
export function setCostPairs(sets: { sku: string; components: { sku: string; qty: number }[] }[], known: Map<string, CostInfo>): CostPair[] {
  const out: CostPair[] = [];
  for (const s of sets) {
    if (known.has(s.sku) || !s.components.length) continue;
    const parts = s.components.map((c) => ({ c, info: known.get(c.sku) }));
    if (parts.some((p) => !p.info)) continue;
    const cost = Math.round(parts.reduce((n, p) => n + p.c.qty * p.info!.cost, 0) * 10000) / 10000;
    out.push([s.sku, cost, s.components.map((c) => `${c.qty}× ${c.sku}`).join(" + ")]);
  }
  return out;
}

/**
 * Kanäle ohne eigene Gebühr je Bestellung: Temu zahlt den vereinbarten Basispreis aus (Gebühr steckt
 * darin), manuelle Verkäufe haben keine Plattform. Alle anderen brauchen eine Gebührenangabe.
 */
export const FEE_FREE_CHANNELS = new Set(["temu", "manual"]);

export type OrderLine = {
  orderId: string;
  externalId: string;
  channel: string;
  orderDate: string;
  sku: string | null;
  title: string | null;
  qty: number;
  /** Bruttopreis je Stück; null = unbekannt. */
  price: number | null;
  /** Gebühren der ganzen Bestellung; null = unbekannt. */
  orderFees: number | null;
};

export type ChannelSummary = {
  channel: string;
  orders: number;
  lines: number;
  revenueNet: number;
  /** Positionen ohne Preis (Umsatz fehlt). */
  missingPrice: number;
  cogsKnown: number;
  /** Positionen ohne EK und ihre SKUs. */
  missingCost: number;
  missingCostSkus: string[];
  feesKnown: number;
  /** Bestellungen ohne Gebührenangabe. */
  missingFeeOrders: number;
  /** Umsatz und Gewinn nur aus vollständigen Positionen. */
  completeRevenueNet: number;
  completeProfit: number;
  /** Umsatz − bekannte Kosten (EK, Gebühren). */
  provisional: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeChannels(lines: OrderLine[], costs: Map<string, CostInfo>, vatRate: number): ChannelSummary[] {
  const byChannel = new Map<string, OrderLine[]>();
  for (const l of lines) byChannel.set(l.channel, [...(byChannel.get(l.channel) ?? []), l]);
  const out: ChannelSummary[] = [];
  for (const [channel, list] of byChannel) {
    const feeFree = FEE_FREE_CHANNELS.has(channel);
    const orders = new Map<string, OrderLine[]>();
    for (const l of list) orders.set(l.orderId, [...(orders.get(l.orderId) ?? []), l]);
    const s: ChannelSummary = { channel, orders: orders.size, lines: list.length, revenueNet: 0, missingPrice: 0, cogsKnown: 0, missingCost: 0, missingCostSkus: [], feesKnown: 0, missingFeeOrders: 0, completeRevenueNet: 0, completeProfit: 0, provisional: 0 };
    const missingSkus = new Set<string>();
    for (const ls of orders.values()) {
      const fee = feeFree ? 0 : ls[0].orderFees;
      if (fee === null) s.missingFeeOrders++;
      else s.feesKnown += fee;
      const gross = ls.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0);
      for (const l of ls) {
        const net = l.price === null ? null : (l.price * l.qty) / (1 + vatRate);
        if (net === null) s.missingPrice++;
        else s.revenueNet += net;
        const c = l.sku ? costs.get(l.sku) : undefined;
        if (c) s.cogsKnown += c.cost * l.qty;
        else {
          s.missingCost++;
          missingSkus.add(l.sku ?? `(ohne SKU) ${l.title ?? l.externalId}`);
        }
        // Vollständig nur mit Preis, EK und Gebühr (Gebühr anteilig nach Umsatz der Position).
        if (net !== null && c && fee !== null) {
          const share = gross > 0 ? ((l.price ?? 0) * l.qty) / gross : 1 / ls.length;
          s.completeRevenueNet += net;
          s.completeProfit += net - c.cost * l.qty - fee * share;
        }
      }
    }
    s.missingCostSkus = [...missingSkus].sort();
    s.provisional = s.revenueNet - s.cogsKnown - s.feesKnown;
    for (const k of ["revenueNet", "cogsKnown", "feesKnown", "completeRevenueNet", "completeProfit", "provisional"] as const) s[k] = round2(s[k]);
    out.push(s);
  }
  return out.sort((a, b) => b.revenueNet - a.revenueNet);
}

/** Amazon je SKU (aus der Abrechnung) – Gebühren sind dort immer enthalten, nur der EK kann fehlen. */
export type AmazonSkuLine = { sku: string; units: number; revenueNet: number; costsExCogs: number; cogs: number | null };

export function summarizeAmazon(skus: AmazonSkuLine[], nonSkuCosts: number) {
  const revenueNet = skus.reduce((n, s) => n + s.revenueNet, 0);
  const withoutCogs = skus.reduce((n, s) => n + s.revenueNet + s.costsExCogs, 0);
  const cogsKnown = skus.reduce((n, s) => n + (s.cogs ?? 0), 0);
  const complete = skus.filter((s) => s.cogs !== null || s.units === 0);
  const missing = skus.filter((s) => s.cogs === null && s.units > 0);
  return {
    revenueNet: round2(revenueNet),
    provisional: round2(withoutCogs - cogsKnown + nonSkuCosts),
    completeRevenueNet: round2(complete.reduce((n, s) => n + s.revenueNet, 0)),
    completeProfit: round2(complete.reduce((n, s) => n + s.revenueNet + s.costsExCogs - (s.cogs ?? 0), 0) + nonSkuCosts),
    missingCostSkus: missing.map((s) => s.sku),
    missingCostRevenue: round2(missing.reduce((n, s) => n + s.revenueNet, 0)),
  };
}

export type Totals = {
  revenueNet: number;
  provisional: number;
  completeProfit: number;
  completeRevenueNet: number;
  /** Anteil des Umsatzes mit vollständigen Kosten (0–100). */
  coverage: number;
  complete: boolean;
  missing: { costSkus: number; costLines: number; feeOrders: number; priceLines: number };
};

export function totalsOf(amazon: ReturnType<typeof summarizeAmazon> | null, channels: ChannelSummary[]): Totals {
  const revenueNet = (amazon?.revenueNet ?? 0) + channels.reduce((n, c) => n + c.revenueNet, 0);
  const completeRevenueNet = (amazon?.completeRevenueNet ?? 0) + channels.reduce((n, c) => n + c.completeRevenueNet, 0);
  const missing = {
    costSkus: new Set([...(amazon?.missingCostSkus ?? []), ...channels.flatMap((c) => c.missingCostSkus)]).size,
    costLines: channels.reduce((n, c) => n + c.missingCost, 0) + (amazon?.missingCostSkus.length ?? 0),
    feeOrders: channels.reduce((n, c) => n + c.missingFeeOrders, 0),
    priceLines: channels.reduce((n, c) => n + c.missingPrice, 0),
  };
  const complete = missing.costLines === 0 && missing.feeOrders === 0 && missing.priceLines === 0;
  return {
    revenueNet: round2(revenueNet),
    provisional: round2((amazon?.provisional ?? 0) + channels.reduce((n, c) => n + c.provisional, 0)),
    completeProfit: round2((amazon?.completeProfit ?? 0) + channels.reduce((n, c) => n + c.completeProfit, 0)),
    completeRevenueNet: round2(completeRevenueNet),
    coverage: revenueNet > 0 ? Math.round((completeRevenueNet / revenueNet) * 100) : complete ? 100 : 0,
    complete,
    missing,
  };
}

// ---- Lagerwert ---------------------------------------------------------------------------------

export type StockLine = { sku: string; units: number; own: number };

/** Lagerwert getrennt: bewertet (mit EK), unbewertet (ohne EK) und negative Bestände (nicht verrechnet). */
export function stockValue(lines: StockLine[], costs: Map<string, CostInfo>) {
  let valued = 0;
  let valuedUnits = 0;
  let unvaluedUnits = 0;
  const unvaluedSkus: string[] = [];
  const negative: { sku: string; units: number }[] = [];
  for (const l of lines) {
    const positive = Math.max(0, l.units) + Math.max(0, l.own);
    if (l.own < 0) negative.push({ sku: l.sku, units: l.own });
    if (positive === 0) continue;
    const c = costs.get(l.sku);
    if (c) {
      valued += positive * c.cost;
      valuedUnits += positive;
    } else {
      unvaluedUnits += positive;
      unvaluedSkus.push(l.sku);
    }
  }
  return { valued: round2(valued), valuedUnits, unvaluedUnits, unvaluedSkus, negative, negativeUnits: negative.reduce((n, x) => n + x.units, 0) };
}
