import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InboundCheck } from "@/db/schema";

export type ResolvedItem = {
  sku: string;
  fnsku: string | null;
  asin: string;
  title: string | null;
  lotId: string;
  productId: string;
};

export type ResolveResult =
  | { kind: "ok"; item: ResolvedItem }
  | { kind: "ambiguous"; options: (ResolvedItem & { purchaseDate: string | null })[] }
  | { kind: "unknown" };

/** Mengenangabe vor dem Code: "6*X001…", "6x X001…", "6 X001…". */
export function splitQuantity(input: string): { quantity: number | null; code: string } {
  const m = /^\s*(\d{1,4})\s*[*xX×]\s*(.+)$/.exec(input) ?? /^\s*(\d{1,3})\s+(\S{6,})$/.exec(input);
  if (m) return { quantity: Number(m[1]), code: m[2].trim() };
  return { quantity: null, code: input.trim() };
}

export async function resolveCode(tenantId: string, shipmentId: string, raw: string): Promise<ResolveResult> {
  const code = raw.trim();
  if (!code) return { kind: "unknown" };
  const L = schema.lots;
  const P = schema.products;
  const select = {
    sku: L.sku,
    fnsku: L.fnsku,
    asin: P.asin,
    title: P.title,
    lotId: L.id,
    productId: P.id,
    purchaseDate: L.purchaseDate,
  };

  // 1. Schon in dieser Sendung
  const [inShipment] = await db
    .select({ sku: schema.inboundItems.sku })
    .from(schema.inboundItems)
    .where(and(eq(schema.inboundItems.shipmentId, shipmentId), or(ilike(schema.inboundItems.fnsku, code), ilike(schema.inboundItems.sku, code))));
  const lookup = inShipment?.sku ?? null;

  // 2. FNSKU oder SKU einer Charge
  const direct = await db
    .select(select)
    .from(L)
    .innerJoin(P, eq(P.id, L.productId))
    .where(and(eq(L.tenantId, tenantId), lookup ? eq(L.sku, lookup) : or(ilike(L.fnsku, code), eq(L.sku, code))))
    .limit(5);
  if (direct.length === 1) return { kind: "ok", item: direct[0] };

  // 3. EAN oder ASIN → alle Einkaufs-Chargen dieses Artikels
  const candidates = direct.length
    ? direct
    : await db
        .select(select)
        .from(L)
        .innerJoin(P, eq(P.id, L.productId))
        .where(and(eq(L.tenantId, tenantId), eq(L.kind, "purchase"), or(eq(P.ean, code), ilike(P.asin, code))))
        .orderBy(desc(L.purchaseDate))
        .limit(12);
  if (candidates.length === 0) return { kind: "unknown" };
  if (candidates.length === 1) return { kind: "ok", item: candidates[0] };

  // Wenn eine der Chargen schon in der Sendung ist, diese nehmen.
  const skus = candidates.map((c) => c.sku);
  const [already] = await db
    .select({ sku: schema.inboundItems.sku })
    .from(schema.inboundItems)
    .where(and(eq(schema.inboundItems.shipmentId, shipmentId), inArray(schema.inboundItems.sku, skus)))
    .orderBy(desc(schema.inboundItems.createdAt))
    .limit(1);
  if (already) return { kind: "ok", item: candidates.find((c) => c.sku === already.sku)! };
  return { kind: "ambiguous", options: candidates };
}

export async function computeChecks(tenantId: string, sku: string): Promise<InboundCheck[]> {
  const [row] = await db
    .select({ lot: schema.lots, product: schema.products })
    .from(schema.lots)
    .innerJoin(schema.products, eq(schema.products.id, schema.lots.productId))
    .where(and(eq(schema.lots.tenantId, tenantId), eq(schema.lots.sku, sku)));
  if (!row) return [{ level: "warn", message: "SKU nicht im System – EK unbekannt" }];
  const checks: InboundCheck[] = [];
  const { lot, product } = row;
  if (!lot.fnsku) checks.push({ level: "error", message: "FNSKU fehlt – Etikett nicht druckbar (FBA-Bestandsbericht importieren oder eintragen)" });
  if (lot.unitCostNet === null) checks.push({ level: "warn", message: "EK fehlt" });
  if (!product.weightGrams || !product.lengthCm || !product.widthCm || !product.heightCm) checks.push({ level: "warn", message: "Maße/Gewicht fehlen" });
  if (product.isHazmat) checks.push({ level: "error", message: "Gefahrgut – Freigabe prüfen" });
  if (product.prepInstructions) checks.push({ level: "warn", message: `Prep: ${product.prepInstructions}` });
  if (checks.length === 0) checks.push({ level: "ok", message: "OK" });
  return checks;
}

export async function addScan(opts: {
  tenantId: string;
  userId: string;
  shipmentId: string;
  item: ResolvedItem;
  quantity: number;
  boxId: string | null;
  code: string;
}) {
  const { tenantId, shipmentId, item, quantity } = opts;
  const checks = await computeChecks(tenantId, item.sku);
  return db.transaction(async (tx) => {
    const I = schema.inboundItems;
    let [row] = await tx.select().from(I).where(and(eq(I.shipmentId, shipmentId), eq(I.sku, item.sku)));
    if (!row) {
      [row] = await tx
        .insert(I)
        .values({ tenantId, shipmentId, lotId: item.lotId, productId: item.productId, sku: item.sku, fnsku: item.fnsku, asin: item.asin, title: item.title, scannedQuantity: 0, checks })
        .returning();
    }
    const [updated] = await tx
      .update(I)
      .set({ scannedQuantity: sql`greatest(0, ${I.scannedQuantity} + ${quantity})`, checks, fnsku: item.fnsku ?? row.fnsku })
      .where(eq(I.id, row.id))
      .returning();

    if (opts.boxId) {
      const B = schema.inboundBoxItems;
      const [bi] = await tx.select().from(B).where(and(eq(B.boxId, opts.boxId), eq(B.itemId, row.id)));
      if (bi) await tx.update(B).set({ quantity: sql`greatest(0, ${B.quantity} + ${quantity})` }).where(eq(B.id, bi.id));
      else if (quantity > 0) await tx.insert(B).values({ tenantId, boxId: opts.boxId, itemId: row.id, quantity });
    }
    await tx.insert(schema.inboundScans).values({ tenantId, shipmentId, itemId: row.id, boxId: opts.boxId, code: opts.code, quantity, userId: opts.userId });
    await tx.update(schema.inboundShipments).set({ updatedAt: new Date() }).where(eq(schema.inboundShipments.id, shipmentId));
    return updated;
  });
}

export async function loadShipment(tenantId: string, id: string) {
  const [shipment] = await db
    .select()
    .from(schema.inboundShipments)
    .where(and(eq(schema.inboundShipments.id, id), eq(schema.inboundShipments.tenantId, tenantId)));
  if (!shipment) return null;
  const [items, boxes, boxItems, scans] = await Promise.all([
    db
      .select({ item: schema.inboundItems, cost: schema.lots.unitCostNet, weightGrams: schema.products.weightGrams })
      .from(schema.inboundItems)
      .leftJoin(schema.lots, eq(schema.lots.id, schema.inboundItems.lotId))
      .leftJoin(schema.products, eq(schema.products.id, schema.inboundItems.productId))
      .where(eq(schema.inboundItems.shipmentId, id))
      .orderBy(asc(schema.inboundItems.createdAt)),
    db.select().from(schema.inboundBoxes).where(eq(schema.inboundBoxes.shipmentId, id)).orderBy(asc(schema.inboundBoxes.number)),
    db
      .select({ boxId: schema.inboundBoxItems.boxId, itemId: schema.inboundBoxItems.itemId, quantity: schema.inboundBoxItems.quantity })
      .from(schema.inboundBoxItems)
      .innerJoin(schema.inboundBoxes, eq(schema.inboundBoxes.id, schema.inboundBoxItems.boxId))
      .where(eq(schema.inboundBoxes.shipmentId, id)),
    db
      .select({ id: schema.inboundScans.id, code: schema.inboundScans.code, quantity: schema.inboundScans.quantity, createdAt: schema.inboundScans.createdAt, sku: schema.inboundItems.sku })
      .from(schema.inboundScans)
      .leftJoin(schema.inboundItems, eq(schema.inboundItems.id, schema.inboundScans.itemId))
      .where(eq(schema.inboundScans.shipmentId, id))
      .orderBy(desc(schema.inboundScans.createdAt))
      .limit(15),
  ]);
  return { shipment, items, boxes, boxItems, scans };
}

/** Prüfungen für die ganze Sendung, bevor sie an Amazon geht. */
export function shipmentChecks(view: NonNullable<Awaited<ReturnType<typeof loadShipment>>>) {
  const out: InboundCheck[] = [];
  const errors = view.items.filter((i) => i.item.checks.some((c) => c.level === "error")).length;
  const warns = view.items.filter((i) => i.item.checks.some((c) => c.level === "warn")).length;
  const units = view.items.reduce((n, i) => n + i.item.scannedQuantity, 0);
  out.push(units > 0 ? { level: "ok", message: `${units} Einheiten gescannt` } : { level: "error", message: "Noch nichts gescannt" });
  if (errors) out.push({ level: "error", message: `${errors} Artikel mit Fehler` });
  if (warns) out.push({ level: "warn", message: `${warns} Artikel mit Hinweis` });
  const planned = view.items.filter((i) => i.item.plannedQuantity > 0 && i.item.plannedQuantity !== i.item.scannedQuantity);
  if (planned.length) out.push({ level: "warn", message: `${planned.length} Artikel: gescannt ≠ geplant` });
  const inBoxes = new Map<string, number>();
  for (const bi of view.boxItems) inBoxes.set(bi.itemId, (inBoxes.get(bi.itemId) ?? 0) + bi.quantity);
  const unboxed = view.items.filter((i) => (inBoxes.get(i.item.id) ?? 0) !== i.item.scannedQuantity).length;
  if (view.boxes.length && unboxed) out.push({ level: "warn", message: `${unboxed} Artikel nicht vollständig Kartons zugeordnet` });
  for (const b of view.boxes) {
    const kg = b.weightKg ? Number(b.weightKg) : null;
    if (kg !== null && kg > 23) out.push({ level: "error", message: `Karton ${b.number}: ${kg} kg – über 23 kg nicht erlaubt` });
    else if (kg !== null && kg > 15) out.push({ level: "warn", message: `Karton ${b.number}: über 15 kg – Etikett „Schwer“ anbringen` });
    const dims = [b.lengthCm, b.widthCm, b.heightCm].map((x) => (x ? Number(x) : 0));
    if (dims.some((d) => d > 63.5)) out.push({ level: "error", message: `Karton ${b.number}: Seite über 63,5 cm` });
    if (!b.weightKg || dims.some((d) => d === 0)) out.push({ level: "warn", message: `Karton ${b.number}: Maße/Gewicht fehlen` });
  }
  if (!out.some((c) => c.level !== "ok")) out.push({ level: "ok", message: "Alles bereit" });
  return out;
}
