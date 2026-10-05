import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { getSettings } from "@/lib/settings";
import { carrierList } from "./rules";
import { extractJsonObject, parseLooseDate, parseScPage, scAiPrompt, type ScOrder, type ScPackage, type ScPage } from "./sc-removal";
import { syncClaims } from "./service";

export type ScImportResult = {
  pages: number;
  orders: number;
  packages: number;
  problemPackages: number;
  newRows: number;
  updatedRows: number;
  withoutPackages: { orderId: string | null; url: string }[];
  viaAi: number;
};

const digits = (s: string) => s.replace(/\D/g, "");
/** Gleiche Sendung? Seller Central hängt teils eine Prüfziffer an oder kürzt. */
const sameTracking = (a: string, b: string) => a === b || (digits(a).length >= 8 && (digits(a).includes(digits(b)) || digits(b).includes(digits(a))) && Math.abs(digits(a).length - digits(b).length) <= 2);

async function aiParse(apiKey: string, cfg: Parameters<typeof modelFor>[0], page: ScPage, orderId: string | null): Promise<ScOrder | null> {
  const r = await askClaude(apiKey, scAiPrompt(page.text), { model: modelFor(cfg, "simple"), task: "simple", maxTokens: 2000, timeoutMs: 60_000 });
  const o = extractJsonObject(r.text) as { orderId?: unknown; packages?: unknown } | null;
  const id = orderId ?? (typeof o?.orderId === "string" ? o.orderId : null);
  if (!o || !id || !Array.isArray(o.packages)) return null;
  const packages: ScPackage[] = (o.packages as Record<string, unknown>[]).flatMap((p) => {
    const tracking = typeof p.tracking === "string" ? p.tracking.trim() : "";
    if (!/\d{5}/.test(digits(tracking))) return [];
    const items = Array.isArray(p.items)
      ? (p.items as Record<string, unknown>[]).flatMap((i) => (typeof i.quantity === "number" && i.quantity > 0 ? [{ fnsku: typeof i.fnsku === "string" ? i.fnsku : null, quantity: Math.round(i.quantity) }] : []))
      : [];
    return [{ tracking, carrier: typeof p.carrier === "string" ? p.carrier : null, shipmentDate: null, items, lastEvent: typeof p.lastEvent === "string" ? p.lastEvent.slice(0, 200) : null, lastEventAt: typeof p.lastEventAt === "string" ? parseLooseDate(p.lastEventAt) : null }];
  });
  return { orderId: id, url: page.url, requestDate: null, packages };
}

/** Erfasste Seller-Central-Seiten übernehmen: Pakete als Remissionssendungen speichern, dann Ansprüche abgleichen. */
export async function importScPages(tenantId: string, pages: ScPage[]): Promise<ScImportResult> {
  const settings = await getSettings(tenantId);
  const keywords = carrierList(settings.claims.problemCarriers);
  const res: ScImportResult = { pages: pages.length, orders: 0, packages: 0, problemPackages: 0, newRows: 0, updatedRows: 0, withoutPackages: [], viaAi: 0 };
  const ai = await getIntegration(tenantId, "anthropic");
  let aiBudget = 15;

  const orders: ScOrder[] = [];
  for (const page of pages) {
    let o = parseScPage(page);
    if ((!o || !o.packages.length) && ai?.apiKey && aiBudget > 0 && page.text.trim().length > 200) {
      aiBudget--;
      try {
        const viaAi = await aiParse(ai.apiKey, ai, page, o?.orderId ?? page.orderId ?? null);
        if (viaAi?.packages.length) {
          o = { ...viaAi, requestDate: o?.requestDate ?? viaAi.requestDate };
          res.viaAi++;
        }
      } catch {
        /* KI nicht erreichbar – Seite bleibt in „ohne Pakete“ */
      }
    }
    if (!o || !o.packages.length) {
      res.withoutPackages.push({ orderId: o?.orderId ?? page.orderId ?? null, url: page.url });
      continue;
    }
    orders.push(o);
  }

  const RS = schema.amazonRemovalShipments;
  const RO = schema.amazonRemovalOrders;
  for (const o of orders) {
    res.orders++;
    const [existing, orderLines] = await Promise.all([
      db.select().from(RS).where(and(eq(RS.tenantId, tenantId), eq(RS.orderId, o.orderId))),
      db.select({ sku: RO.sku, fnsku: RO.fnsku, requestDate: RO.requestDate }).from(RO).where(and(eq(RO.tenantId, tenantId), eq(RO.orderId, o.orderId))),
    ]);
    const requestDate = o.requestDate ?? orderLines[0]?.requestDate ?? existing.find((e) => e.requestDate)?.requestDate ?? null;
    for (const p of o.packages) {
      res.packages++;
      const hay = `${p.carrier ?? ""} ${p.tracking}`.toLowerCase();
      if (keywords.some((k) => hay.includes(k))) res.problemPackages++;
      // Paket steht schon aus dem Amazon-Bericht drin → nur Versender und Sendungsverfolgung ergänzen, Mengen nicht doppeln.
      const fromReport = existing.filter((e) => e.source === "report" && e.trackingNumber && sameTracking(e.trackingNumber, p.tracking));
      if (fromReport.length) {
        for (const e of fromReport) {
          await db
            .update(RS)
            .set({
              carrier: p.carrier && !(e.carrier ?? "").toLowerCase().includes(p.carrier.toLowerCase()) ? (e.carrier ? `${p.carrier} (${e.carrier})` : p.carrier) : e.carrier,
              lastEvent: p.lastEvent ?? e.lastEvent,
              lastEventAt: p.lastEventAt ?? e.lastEventAt,
              requestDate: e.requestDate ?? requestDate,
            })
            .where(eq(RS.id, e.id));
          res.updatedRows++;
        }
        continue;
      }
      const items = p.items.length ? p.items : [{ fnsku: null, quantity: 0 }];
      for (const it of items) {
        const sku = orderLines.find((l) => it.fnsku && l.fnsku === it.fnsku)?.sku ?? (orderLines.length === 1 ? orderLines[0].sku : null);
        const rowHash = `sc:${o.orderId}:${p.tracking}:${it.fnsku ?? "-"}`;
        const values = {
          tenantId,
          rowHash,
          orderId: o.orderId,
          requestDate,
          shipmentDate: p.shipmentDate,
          sku,
          fnsku: it.fnsku,
          shippedQuantity: it.quantity,
          carrier: p.carrier,
          trackingNumber: p.tracking,
          lastEvent: p.lastEvent,
          lastEventAt: p.lastEventAt,
          source: "seller_central",
        };
        const r = await db
          .insert(RS)
          .values(values)
          .onConflictDoUpdate({ target: [RS.tenantId, RS.rowHash], set: { shippedQuantity: it.quantity, carrier: p.carrier, sku, requestDate, lastEvent: p.lastEvent, lastEventAt: p.lastEventAt, shipmentDate: p.shipmentDate } })
          .returning({ inserted: sql<boolean>`(xmax = 0)` });
        if (r[0]?.inserted) res.newRows++;
        else res.updatedRows++;
      }
    }
  }
  await syncClaims(tenantId);
  return res;
}
