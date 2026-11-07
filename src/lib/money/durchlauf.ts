import "server-only";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import type { Vorlauf } from "@/lib/deal-eingang/umschlag-logic";
import { abverkaufTage, durchlaufAuswerten, kapitalMonate, MIN_BASIS, vorlaufAus, zuBereinigen, BEREINIGEN_TAGE, type EinkaufDurchlauf } from "./durchlauf-logic";

// B28.7 Eigene Durchlaufzeiten aus vorhandenen Daten: Einkauf (bestellt/erhalten), FBA-Sendungen (sellerboard:
// erstellt, geschlossen), sellerboard-Monatswerte je SKU (Abverkauf). Median je Lieferant/Quelle, Cash-to-Cash.

const cache = new Map<string, { am: number; wert: Awaited<ReturnType<typeof berechnen>> }>();
const CACHE_MS = 10 * 60_000;

async function berechnen(tenantId: string, heute: string) {
  const PO = schema.purchaseOrders;
  const PI = schema.purchaseOrderItems;
  const ab = addDaysIso(heute, -365);
  const pos = await db
    .select({ id: PO.id, supplierId: PO.supplierId, orderDate: PO.orderDate, receivedAt: PO.receivedAt, quelle: PO.quelle })
    .from(PO)
    .where(and(eq(PO.tenantId, tenantId), eq(PO.status, "received"), isNotNull(PO.orderDate), isNotNull(PO.receivedAt), gte(PO.orderDate, ab)))
    .limit(2000);
  if (!pos.length) return durchlaufAuswerten([]);
  const ids = pos.map((p) => p.id);
  const supIds = [...new Set(pos.map((p) => p.supplierId).filter((x): x is string => !!x))];
  const [items, sups, sendungen] = await Promise.all([
    db.select({ poId: PI.poId, sku: PI.sku, asin: PI.asin, quantity: PI.quantity }).from(PI).where(and(eq(PI.tenantId, tenantId), inArray(PI.poId, ids))),
    supIds.length ? db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, tenantId), inArray(schema.suppliers.id, supIds))) : [],
    db.select({ createdOn: schema.sellerboardShipments.createdOn, lastUpdate: schema.sellerboardShipments.lastUpdate, status: schema.sellerboardShipments.status, lines: schema.sellerboardShipments.lines }).from(schema.sellerboardShipments).where(and(eq(schema.sellerboardShipments.tenantId, tenantId), gte(schema.sellerboardShipments.createdOn, ab))),
  ]);
  const skus = [...new Set(items.map((i) => i.sku).filter((x): x is string => !!x))];
  const S = schema.sellerboardSkuMonths;
  const monate = skus.length ? await db.select({ sku: S.sku, month: S.month, units: S.units }).from(S).where(and(eq(S.tenantId, tenantId), inArray(S.sku, skus), gte(S.month, ab.slice(0, 7)))) : [];
  const supName = new Map(sups.map((s) => [s.id, s.name]));
  const jeSku = new Map<string, { month: string; units: number | null }[]>();
  for (const m of monate) jeSku.set(m.sku, [...(jeSku.get(m.sku) ?? []), { month: m.month, units: m.units }]);
  const einkaeufe: EinkaufDurchlauf[] = pos.map((p) => {
    const its = items.filter((i) => i.poId === p.id);
    const set = new Set(its.map((i) => i.sku).filter((x): x is string => !!x));
    const erhalten = p.receivedAt!.toISOString().slice(0, 10);
    // erste FBA-Sendung mit einer SKU der Bestellung nach dem Wareneingang
    const s = sendungen.filter((x) => x.createdOn && x.createdOn >= erhalten && x.lines.some((l) => set.has(l.sku))).sort((a, b) => a.createdOn!.localeCompare(b.createdOn!))[0];
    const empfangen = s && /closed/i.test(s.status) ? s.lastUpdate : null;
    const menge = its.reduce((n, i) => n + (i.quantity ?? 0), 0);
    const units = new Map<string, number>();
    for (const sku of set) for (const m of jeSku.get(sku) ?? []) units.set(m.month, (units.get(m.month) ?? 0) + (m.units ?? 0));
    return {
      id: p.id,
      gruppe: (p.supplierId && supName.get(p.supplierId)) || (p.quelle === "arbitrageone" ? "ArbitrageOne" : "ohne Lieferant"),
      bestellt: p.orderDate,
      erhalten,
      versandt: s?.createdOn ?? null,
      empfangen,
      abverkaufTage: abverkaufTage([...units.entries()].map(([month, u]) => ({ month, units: u })), empfangen ?? s?.createdOn ?? null, menge),
    };
  });
  return durchlaufAuswerten(einkaeufe);
}

/** Auswertung (10 Minuten zwischengespeichert – wird je Deal-Prüfung gebraucht). */
export async function durchlaufZeiten(tenantId: string, heute = todayIso()) {
  const c = cache.get(tenantId);
  if (c && Date.now() - c.am < CACHE_MS) return c.wert;
  const wert = await berechnen(tenantId, heute);
  cache.set(tenantId, { am: Date.now(), wert });
  return wert;
}

/** Vorlauf für die Umschlagszeit: Lieferant/Quelle des Deals, sonst alle Einkäufe, sonst Standardwerte. */
export async function vorlaufFuer(tenantId: string, quelle: string | null | undefined): Promise<Vorlauf> {
  const d = await durchlaufZeiten(tenantId).catch(() => null);
  if (!d) return vorlaufAus(null);
  const q = (quelle ?? "").trim().toLowerCase();
  const g = q ? d.jeGruppe.find((x) => x.n >= MIN_BASIS && (x.gruppe.toLowerCase().includes(q) || q.includes(x.gruppe.toLowerCase()))) : undefined;
  return vorlaufAus(g?.phasen ?? d.gesamt);
}

/** Kapital-Ampel: Cash-to-Cash und Kapital ÷ Monatsumsatz (Lagerwert = gebundenes Kapital, Umsatz = letzte 30 Tage). */
export async function cashToCashKennzahlen(tenantId: string, lagerwert: number | null, heute = todayIso()) {
  const [d, s] = await Promise.all([durchlaufZeiten(tenantId, heute), getSettings(tenantId)]);
  const { sellerboardRange } = await import("@/lib/sellerboard/sales");
  const r = await sellerboardRange(tenantId, addDaysIso(heute, -29), heute).catch(() => null);
  const monatsumsatz = r?.sales ?? null;
  return { ...d, prepName: s.prep?.name ?? null, lagerwert, monatsumsatz, kapitalMonate: kapitalMonate(lagerwert, monatsumsatz), umsatzVollstaendig: r?.complete ?? false };
}

/** Aufgabe „Einkäufe bereinigen“: Bestellungen, die seit über 45 Tagen weder erhalten noch storniert sind. */
export async function einkaeufeBereinigenAufgabe(tenantId: string, heute = todayIso()) {
  const PO = schema.purchaseOrders;
  const offen = await db.select({ id: PO.id, number: PO.number, status: PO.status, orderDate: PO.orderDate }).from(PO).where(and(eq(PO.tenantId, tenantId), inArray(PO.status, ["ordered", "shipped", "partial"]))).limit(2000);
  const alt = zuBereinigen(offen, heute);
  const key = "einkaeufe-bereinigen";
  if (!alt.length) {
    await resolveSystemTask(db, tenantId, key);
    return 0;
  }
  await upsertSystemTask(db, tenantId, key, {
    title: `Einkäufe bereinigen: ${alt.length} Bestellung${alt.length === 1 ? "" : "en"} seit über ${BEREINIGEN_TAGE} Tagen weder erhalten noch storniert`,
    notes: `Diese Bestellungen verfälschen die Durchlaufzeiten (Kapital-Ampel → Cash-to-Cash) und den Kapitalbedarf. Bitte als erhalten buchen oder stornieren:\n${alt.slice(0, 25).map((p) => `• ${p.number} (bestellt ${p.orderDate})`).join("\n")}${alt.length > 25 ? `\n… und ${alt.length - 25} weitere` : ""}`,
    priority: "normal",
    category: "einkauf",
    link: "/einkauf?ansicht=offen",
    dueDate: heute,
  });
  return alt.length;
}
