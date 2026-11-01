import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { skuKauf, type EigenerKauf } from "@/lib/lugru-deals/auswertung-logic";

// Eigene Käufe aus den sellerboard-SKUs (B22.2): Kaufdatum, EK netto und Lieferant stehen in der SKU
// (LIEFERANT_TTMONJJ_ASIN_EK_VK bzw. alte Schemata), die Menge kommt aus den FBA-Sendungen bzw. dem Bestand.
// Gemeinsam für den Lugru-Kauf-Abgleich, die 24-Std.-Prüfung „Kauf vorbereitet“ und den Monatsrahmen.

export type SkuKauf = EigenerKauf & { sku: string; tag: string; menge: number | null; ekNetto: number | null; shop: string | null };
export type SkuSendung = { name: string | null; am: string | null; lines: { sku: string; asin?: string | null; units?: number | null }[] | null };

export async function skuKaeufeLaden(tenantId: string, jetzt: Date, seitTag: string): Promise<{ kaeufe: SkuKauf[]; sendungen: SkuSendung[]; versandt: Map<string, number>; bestand: Map<string, number> }> {
  const SBP = schema.sellerboardProducts;
  const SBI = schema.sellerboardInventory;
  const AI = schema.amazonInventory;
  const SBS = schema.sellerboardShipments;
  const [sbp, sbi, ai, sendungen] = await Promise.all([
    db.select({ sku: SBP.sku, asin: SBP.asin }).from(SBP).where(eq(SBP.tenantId, tenantId)),
    db.select({ sku: SBI.sku, asin: SBI.asin, menge: sql<number>`(${SBI.fbaStock} + ${SBI.reserved} + ${SBI.inbound})::int` }).from(SBI).where(eq(SBI.tenantId, tenantId)),
    db.select({ sku: AI.sku, asin: AI.asin, menge: AI.total }).from(AI).where(eq(AI.tenantId, tenantId)),
    db.select({ name: SBS.name, am: SBS.createdOn, lines: SBS.lines }).from(SBS).where(and(eq(SBS.tenantId, tenantId), gte(SBS.createdOn, seitTag))),
  ]);
  const versandt = new Map<string, number>();
  for (const sd of sendungen) for (const l of sd.lines ?? []) versandt.set(l.sku, (versandt.get(l.sku) ?? 0) + (l.units ?? 0));
  const bestand = new Map<string, number>();
  for (const r of [...sbi, ...ai]) if (r.menge) bestand.set(r.sku, Math.max(bestand.get(r.sku) ?? 0, r.menge));
  const skus = new Map<string, string | null>();
  for (const r of [...sbp, ...sbi, ...ai]) if (!skus.has(r.sku)) skus.set(r.sku, r.asin);
  const kaeufe: SkuKauf[] = [];
  for (const [sku, asinSpalte] of skus) {
    const k = skuKauf(sku, asinSpalte, jetzt);
    if (!k || k.tag < seitTag) continue;
    const menge = versandt.get(sku) || bestand.get(sku) || null;
    kaeufe.push({ sku, tag: k.tag, asin: k.asin, am: new Date(`${k.tag}T12:00:00Z`), ref: `sellerboard-SKU ${sku}`, nurTag: true, menge, ekNetto: k.ekNetto, shop: k.shop });
  }
  return { kaeufe, sendungen, versandt, bestand };
}
