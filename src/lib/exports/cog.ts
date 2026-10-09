import "server-only";
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import type { CogRow } from "./accountone";

export async function loadCogRows(tenantId: string): Promise<CogRow[]> {
  const L = schema.lots;
  const rows = await db
    .select({ asin: schema.products.asin, sku: L.sku, cost: L.unitCostNet })
    .from(L)
    .innerJoin(schema.products, eq(schema.products.id, L.productId))
    .where(and(eq(L.tenantId, tenantId), isNotNull(L.unitCostNet)))
    .orderBy(asc(L.createdAt), asc(L.sku));
  return rows.map((r) => ({ asin: r.asin, sku: r.sku, unitCostNet: Number(r.cost) }));
}

type Snapshot = { exportedAt: Date; costs: Record<string, number> } | null;

async function lastExport(tenantId: string): Promise<Snapshot> {
  const [r] = await db.select().from(schema.cogExports).where(eq(schema.cogExports.tenantId, tenantId));
  return r ? { exportedAt: r.exportedAt, costs: r.costs } : null;
}

const cents = (n: number) => Math.round(n * 100);

/** SKUs mit EK, die im letzten Download fehlten oder dort einen anderen EK hatten. */
export function changedRows(rows: CogRow[], snap: Snapshot): number {
  if (!snap) return rows.length;
  return rows.filter((r) => snap.costs[r.sku] === undefined || cents(snap.costs[r.sku]) !== cents(r.unitCostNet)).length;
}

export async function cogSummary(tenantId: string) {
  const L = schema.lots;
  const [withCost] = await db.select({ n: count() }).from(L).where(and(eq(L.tenantId, tenantId), isNotNull(L.unitCostNet)));
  const [withoutCost] = await db.select({ n: count() }).from(L).where(and(eq(L.tenantId, tenantId), isNull(L.unitCostNet)));
  const [inherited] = await db.select({ n: count() }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.unitCostSource, "inherited")));
  const snap = await lastExport(tenantId);
  return { withCost: withCost.n, withoutCost: withoutCost.n, inherited: inherited.n, lastExportAt: snap?.exportedAt ?? null, changedSinceExport: changedRows(await loadCogRows(tenantId), snap) };
}

/** Download merken (Stand je SKU) – die Erinnerung ist damit erledigt. */
export async function markCogExported(tenantId: string, rows: CogRow[]) {
  const costs = Object.fromEntries(rows.map((r) => [r.sku, Math.round(r.unitCostNet * 100) / 100]));
  const values = { tenantId, exportedAt: new Date(), costs };
  await db.insert(schema.cogExports).values(values).onConflictDoUpdate({ target: schema.cogExports.tenantId, set: { exportedAt: values.exportedAt, costs } });
  await resolveSystemTask(db, tenantId, "accountone-ek");
}

const REMIND_DAYS = 28;

/**
 * Erinnerung (Takt): Neue oder geänderte EKs seit dem letzten Download und der liegt mindestens
 * 4 Wochen zurück (oder es gab noch keinen) → Aufgabe „EK-Liste an AccountOne hochladen“.
 * AccountOne braucht die EKs, damit tax.fish die PAN-EU-Verbringungen richtig bewertet.
 */
export async function cogReminder(tenantId: string): Promise<{ due: boolean; changed: number }> {
  const snap = await lastExport(tenantId);
  const last = snap?.exportedAt ?? null;
  const changed = changedRows(await loadCogRows(tenantId), snap);
  const old = !last || Date.now() - last.getTime() >= REMIND_DAYS * 86_400_000;
  if (!changed || !old) return { due: false, changed };
  const L = schema.lots;
  const [missing] = await db.select({ n: count() }).from(L).where(and(eq(L.tenantId, tenantId), isNull(L.unitCostNet)));
  await upsertSystemTask(db, tenantId, "accountone-ek", {
    title: `EK-Liste an AccountOne hochladen (${changed} neue/geänderte SKUs)`,
    notes: [
      "AccountOne braucht die Einkaufspreise netto je SKU – tax.fish bewertet damit die PAN-EU-Verbringungen (Pro-forma-Rechnungen).",
      `Einkauf & Buchhaltung → COG-Export → CSV herunterladen, in AccountOne unter Benutzer → Artikelstammdaten → Einkaufspreis hochladen (Jahr eintragen).`,
      last ? `Letzter Download: ${last.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}.` : "Bisher noch nie heruntergeladen.",
      missing.n ? `Achtung: ${missing.n} Chargen ohne EK – fehlen in der Liste (Chargen → Ohne EK).` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    priority: "normal",
    category: "geld",
    link: "/export",
  });
  return { due: true, changed };
}
