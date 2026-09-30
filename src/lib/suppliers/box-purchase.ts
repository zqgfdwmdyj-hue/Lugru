import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BoxComponent } from "@/db/tables/brands";
import { addComponentItem, createPurchaseOrder } from "@/lib/purchasing/service";
import { packInfo } from "./scan";
import { parseContentLine, shoppingList } from "./shopping";

type Idea = typeof schema.ideas.$inferSelect;

/**
 * Bestandteile einer Box. Neue Box-Vorschläge speichern sie direkt; bei älteren werden die Inhaltszeilen
 * („4× Titel (je … €)“) über den Titel den Lieferanten-Artikeln zugeordnet.
 */
export async function componentsFor(tenantId: string, idea: Idea): Promise<{ components: BoxComponent[]; unmatched: string[] }> {
  if (idea.components.length) return { components: idea.components, unmatched: [] };
  const lines = idea.contents.map((l) => ({ line: l, p: parseContentLine(l) })).filter((x) => x.p);
  if (!lines.length) return { components: [], unmatched: idea.contents };
  const titles = [...new Set(lines.map((x) => x.p!.title))];
  const offers = await db
    .select({ o: schema.supplierOffers, feedName: schema.supplierFeeds.name, mapping: schema.supplierFeeds.mapping })
    .from(schema.supplierOffers)
    .innerJoin(schema.supplierFeeds, eq(schema.supplierFeeds.id, schema.supplierOffers.feedId))
    .where(and(eq(schema.supplierOffers.tenantId, tenantId), inArray(schema.supplierOffers.title, titles)))
    .orderBy(desc(schema.supplierOffers.updatedAt));
  const components: BoxComponent[] = [];
  const unmatched: string[] = [];
  for (const { line, p } of lines) {
    const hit = offers.find((x) => x.o.title === p!.title);
    if (!hit) {
      unmatched.push(line);
      continue;
    }
    const caseQty = packInfo(hit.o.title ?? "", hit.o.url).caseQty;
    const price = hit.o.price === null ? null : Number(hit.o.price);
    components.push({
      offerId: hit.o.id,
      qty: p!.qty,
      title: hit.o.title ?? p!.title,
      unitCost: price === null ? 0 : Math.round(((price * (1 + Number(hit.mapping.costPct || 0) / 100)) / caseQty) * 100) / 100,
      caseQty,
      casePrice: price,
      url: hit.o.url,
      supplierSku: hit.o.supplierSku,
      feedId: hit.o.feedId,
      feedName: hit.feedName,
    });
  }
  return { components, unmatched };
}

/** Bestellung(en) im Einkauf anlegen – eine je Lieferanten-Feed, in ganzen Kartons. */
export async function purchaseForIdea(tenantId: string, userId: string, idea: Idea, boxes: number, vatRate: number) {
  const { components } = await componentsFor(tenantId, idea);
  if (!components.length) throw new Error("Keine Bestandteile mit Lieferanten-Artikel gefunden.");
  const list = shoppingList(components, boxes);
  const feeds = await db.select().from(schema.supplierFeeds).where(and(eq(schema.supplierFeeds.tenantId, tenantId), inArray(schema.supplierFeeds.id, [...new Set(components.map((c) => c.feedId))])));
  const suppliers = await db.select().from(schema.suppliers).where(eq(schema.suppliers.tenantId, tenantId));
  const offers = await db.select({ id: schema.supplierOffers.id, currency: schema.supplierOffers.currency }).from(schema.supplierOffers).where(and(eq(schema.supplierOffers.tenantId, tenantId), inArray(schema.supplierOffers.id, components.map((c) => c.offerId))));
  const poIds: string[] = [];
  for (const feed of feeds) {
    const rows = list.rows.filter((r) => r.feedId === feed.id);
    if (!rows.length) continue;
    const sup = suppliers.find((s) => s.id === feed.supplierId);
    const poId = await createPurchaseOrder(tenantId, userId, { supplier: sup?.code ?? feed.name, notes: `Für ${boxes}× Box „${idea.title}“ (Idee ${idea.id.slice(0, 8)})` });
    for (const r of rows) {
      // Auslandsware (USD/GBP) ohne deutsche USt auf der Rechnung; sonst der USt-Satz der Marke.
      const foreign = (offers.find((o) => o.id === r.offerId)?.currency ?? "EUR") !== "EUR";
      await addComponentItem(tenantId, poId, { supplierSku: r.supplierSku, title: r.title, quantity: r.orderUnits, unitCostGross: r.casePrice === null ? 0 : r.casePrice / Math.max(1, r.caseQty), vatRate: foreign ? 0 : vatRate, url: r.url });
    }
    poIds.push(poId);
  }
  return poIds;
}
