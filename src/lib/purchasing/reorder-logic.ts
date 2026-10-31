// Nachbestellen laut sellerboard: je Zeile gültiger EK (gleicher Rechenweg wie überall), Kapitalbedarf netto,
// Dringlichkeit, Marge und eine Prüfliste (EK fehlt/weicht ab, Retoure, Bezugsquelle unklar). Reine Logik.

import { compareCost, isReturnSku, type OtherCost } from "@/lib/money/ek-logic";
import type { CostInfo } from "@/lib/money/profit-logic";
import { isNoSalesReach } from "@/lib/stock/breakdown";

export type SbReorderInput = {
  id: string;
  sku: string;
  asin: string | null;
  name: string | null;
  fbaStock: number;
  reserved: number;
  inbound: number;
  salesVelocity: number | null;
  daysLeft: number | null;
  timeToReorder: string | null;
  daysToReorder: number | null;
  qtyToReorder: number;
  /** EK laut sellerboard (nur zum Vergleich). */
  sbCost: number | null;
};

export type ReorderCheck = "ek_fehlt" | "ek_abweichung" | "retoure" | "quelle";
export const CHECK_LABEL: Record<ReorderCheck, { label: string; hint: string }> = {
  ek_fehlt: { label: "EK fehlt", hint: "Kein gültiger EK – Kapitalbedarf unbekannt. EK im Produkt eintragen." },
  ek_abweichung: { label: "EK weicht ab", hint: "sellerboard rechnet mit einem anderen EK (oft 0,01-€-Platzhalter). Hier zählt der gültige EK aus dem Seller-System." },
  retoure: { label: "Retoure", hint: "Einzelne zurückgekommene Einheit – nicht beim Lieferanten nachbestellbar. Bedarf beim Ursprungsartikel einplanen." },
  quelle: { label: "Bezugsquelle unklar", hint: "Kein früherer Einkauf und kein Lieferanten-Angebot zu dieser ASIN – Beschaffung prüfen." },
};

export type Urgency = "ueberfaellig" | "jetzt" | "bald";
export const URGENCY_LABEL: Record<Urgency, string> = { ueberfaellig: "überfällig", jetzt: "jetzt", bald: "bald" };

export type ReorderContext = {
  today: string;
  /** Gültiger EK je SKU. */
  costs: Map<string, CostInfo>;
  /** Retouren-Chargen: SKU → SKU der Ursprungs-Charge (falls bekannt). */
  returnLots: Map<string, string | null>;
  /** Beschaffbare SKUs je ASIN (Einkaufs-Chargen, keine Retouren) mit Lieferant. */
  purchasable: Map<string, { sku: string; supplier: string | null }[]>;
  /** Günstigstes Lieferanten-Angebot je ASIN. */
  feeds: Map<string, { supplier: string; price: number }>;
  /** Marge der letzten 30 Tage je SKU in % (mit gültigem EK), null = unbekannt. */
  margin: Map<string, number | null>;
};

export type ReorderRow = SbReorderInput & {
  urgency: Urgency;
  orderBy: string | null;
  ek: CostInfo | null;
  sbCompare: OtherCost | null;
  /** Kapitalbedarf netto = gültiger EK × Menge (null ohne EK oder bei Retouren). */
  capital: number | null;
  isReturn: boolean;
  /** Ursprungsartikel einer Retoure. */
  origin: string | null;
  source: string | null;
  margin: number | null;
  noSales: boolean;
  checks: ReorderCheck[];
  /** Regulär nachbestellbar: keine Retoure, Bezugsquelle bekannt, EK vorhanden. */
  regular: boolean;
};

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function urgencyOf(r: Pick<SbReorderInput, "timeToReorder" | "daysToReorder">): Urgency {
  const now = (r.timeToReorder ?? "").toUpperCase() === "YES";
  if (now && r.daysToReorder !== null && r.daysToReorder < 0) return "ueberfaellig";
  return now ? "jetzt" : "bald";
}

export function buildReorderRows(rows: SbReorderInput[], ctx: ReorderContext): ReorderRow[] {
  return rows.map((r) => {
    const ek = ctx.costs.get(r.sku) ?? null;
    const sbCompare = compareCost(ek, r.sbCost);
    const isReturn = isReturnSku(r.sku) || ctx.returnLots.has(r.sku);
    const buyable = r.asin ? (ctx.purchasable.get(r.asin) ?? []).filter((p) => !isReturnSku(p.sku)) : [];
    const parent = ctx.returnLots.get(r.sku) ?? null;
    const origin = isReturn ? (parent && !isReturnSku(parent) ? parent : (buyable[0]?.sku ?? null)) : null;
    const own = buyable.find((p) => p.sku === r.sku) ?? buyable[0];
    const feed = r.asin ? ctx.feeds.get(r.asin) : undefined;
    const source = own?.supplier ? `zuletzt bei ${own.supplier}` : feed ? `Angebot ${feed.supplier}` : own ? "früherer Einkauf (Lieferant unbekannt)" : null;
    const checks: ReorderCheck[] = [];
    if (isReturn) checks.push("retoure");
    if (!ek) checks.push("ek_fehlt");
    else if (sbCompare?.deviates) checks.push("ek_abweichung");
    if (!isReturn && !source) checks.push("quelle");
    if (isReturn && !origin) checks.push("quelle");
    const urgency = urgencyOf(r);
    const orderBy = r.daysToReorder === null ? null : r.daysToReorder <= 0 ? ctx.today : addDays(ctx.today, r.daysToReorder);
    const capital = !isReturn && ek ? Math.round(ek.cost * r.qtyToReorder * 100) / 100 : null;
    return {
      ...r,
      urgency,
      orderBy,
      ek,
      sbCompare,
      capital,
      isReturn,
      origin,
      source,
      margin: ctx.margin.get(r.sku) ?? null,
      noSales: isNoSalesReach(r.daysLeft),
      checks,
      regular: !isReturn && Boolean(ek) && Boolean(source),
    };
  });
}

export type ReorderFilter = {
  q?: string;
  dring?: Urgency | "alle";
  pruefen?: ReorderCheck | "alle" | "regulaer";
  margeMin?: number | null;
  kapitalMin?: number | null;
  sort?: "dring" | "kapital" | "marge";
};

const URG_ORDER: Record<Urgency, number> = { ueberfaellig: 0, jetzt: 1, bald: 2 };

export function filterReorder(rows: ReorderRow[], f: ReorderFilter): ReorderRow[] {
  const q = f.q?.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (q && ![r.sku, r.asin ?? "", r.name ?? "", r.origin ?? ""].some((x) => x.toLowerCase().includes(q))) return false;
    if (f.dring && f.dring !== "alle" && r.urgency !== f.dring) return false;
    if (f.pruefen === "regulaer" && !r.regular) return false;
    if (f.pruefen && f.pruefen !== "alle" && f.pruefen !== "regulaer" && !r.checks.includes(f.pruefen)) return false;
    if (f.margeMin !== null && f.margeMin !== undefined && (r.margin === null || r.margin < f.margeMin)) return false;
    if (f.kapitalMin !== null && f.kapitalMin !== undefined && (r.capital === null || r.capital < f.kapitalMin)) return false;
    return true;
  });
  const sort = f.sort ?? "dring";
  return out.sort((a, b) =>
    sort === "kapital"
      ? (b.capital ?? -1) - (a.capital ?? -1)
      : sort === "marge"
        ? (b.margin ?? -999) - (a.margin ?? -999)
        : URG_ORDER[a.urgency] - URG_ORDER[b.urgency] || (a.daysToReorder ?? 999) - (b.daysToReorder ?? 999) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999),
  );
}

/** Summen für die Kopfzeile: Kapitalbedarf netto nur aus regulären Zeilen; was fehlt, wird gezählt. */
export function reorderTotals(rows: ReorderRow[]) {
  const regular = rows.filter((r) => r.capital !== null && !r.isReturn);
  return {
    capital: Math.round(regular.reduce((n, r) => n + (r.capital ?? 0), 0) * 100) / 100,
    withCapital: regular.length,
    noEk: rows.filter((r) => r.checks.includes("ek_fehlt") && !r.isReturn).length,
    returns: rows.filter((r) => r.isReturn).length,
    noSource: rows.filter((r) => r.checks.includes("quelle")).length,
    deviating: rows.filter((r) => r.checks.includes("ek_abweichung")).length,
    byUrgency: { ueberfaellig: rows.filter((r) => r.urgency === "ueberfaellig").length, jetzt: rows.filter((r) => r.urgency === "jetzt").length, bald: rows.filter((r) => r.urgency === "bald").length },
  };
}

/**
 * B15.5: eine Definition für „Kapitalbedarf Bestellvorschläge“ – Startseite, Bestellvorschläge, Liquidität,
 * Kapital-Ampel und Claude rechnen gleich und zeigen diesen Text als Erklärung.
 */
export const KAPITALBEDARF_DEFINITION =
  "Kapitalbedarf netto (ohne USt.) = vorgeschlagene Menge laut sellerboard × gültiger EK. Ware unterwegs zu Amazon ist in der Menge schon berücksichtigt. Nicht enthalten: Artikel mit roter Kapital-Ampel (nicht nachbestellen), Retouren, Artikel ohne EK (gezählt, nicht als 0 €), Artikel, die schon im Einkauf angelegt oder bestellt sind, und Artikel mit Minus-Marge oder Kaufquote 0 % (getrennt als „prüfen“).";

export type Kapitalbedarf = ReturnType<typeof reorderTotals> & { rows: ReorderRow[]; rote: number; angelegt: number; pruefen: { row: ReorderRow; grund: string }[]; pruefenKapital: number };

/** Gemeinsame Rechnung: rote Ampel (bzw. `weg`) und schon angelegte Einkäufe (ASIN) heraus, dann Summen. */
/** Kaufquote je SKU aus sellerboard (letzte 30 Tage): % Einheiten je Besuch und Anzahl Besuche. */
export type Kaufquote = { conversion: number | null; sessions: number | null };

/**
 * B19.8: Artikel, die man vor dem Nachbestellen prüfen sollte – Minus-Marge (30 Tage) oder Kaufquote 0 % bei
 * vorhandenen Besuchen. Sie zählen nicht in die Summe, sondern stehen getrennt als „prüfen“. null = unauffällig.
 */
export function pruefGrund(r: Pick<ReorderRow, "margin">, k: Kaufquote | undefined): string | null {
  if (r.margin !== null && r.margin < 0) return `Minus-Marge (${String(r.margin).replace(".", ",")} % in 30 Tagen)`;
  if (k && k.conversion !== null && k.conversion <= 0 && (k.sessions ?? 0) > 0) return `Kaufquote 0 % (${k.sessions} Besuche in 30 Tagen)`;
  return null;
}

export function kapitalbedarf(rows: ReorderRow[], o: { weg?: (r: ReorderRow) => boolean; angelegteAsins?: Set<string>; kaufquoten?: Map<string, Kaufquote> } = {}): Kapitalbedarf {
  const ohneRot = o.weg ? rows.filter((r) => !o.weg!(r)) : rows;
  const offenAlle = o.angelegteAsins?.size ? ohneRot.filter((r) => !(r.asin && o.angelegteAsins!.has(r.asin))) : ohneRot;
  const pruefen = offenAlle.map((r) => ({ row: r, grund: pruefGrund(r, o.kaufquoten?.get(r.sku)) })).filter((x): x is { row: ReorderRow; grund: string } => x.grund !== null);
  const pruefSkus = new Set(pruefen.map((x) => x.row.sku));
  const offen = offenAlle.filter((r) => !pruefSkus.has(r.sku));
  return {
    ...reorderTotals(offen),
    rows: offen,
    rote: rows.length - ohneRot.length,
    angelegt: ohneRot.length - offenAlle.length,
    pruefen,
    pruefenKapital: Math.round(pruefen.reduce((n, x) => n + (x.row.isReturn ? 0 : (x.row.capital ?? 0)), 0) * 100) / 100,
  };
}
