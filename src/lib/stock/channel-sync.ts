import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Channel } from "@/db/schema";
import { CHANNEL_LABEL } from "@/lib/labels";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { availableOf, oversold, planSync, setsContaining, stockSkuOf, targetQuantity, withSets, type StockLevel } from "./channel-logic";
import { loadSets } from "./sets";

type Listing = typeof schema.listings.$inferSelect;
/** Meldet die Menge an den Kanal. Darf Zusatzdaten (z. B. offerId, productType) für das nächste Mal zurückgeben. */
type StockPusher = (tenantId: string, listing: Listing, quantity: number) => Promise<{ payload?: Record<string, unknown> } | void>;
/** `ready`: nutzt dieser Mandant die Schnittstelle (z. B. Temu verbunden)? Sonst wie ohne Schnittstelle. */
const pushers = new Map<Channel, { push: StockPusher; ready?: (tenantId: string) => Promise<boolean> }>();

export function registerStockPusher(channel: Channel, push: StockPusher, opts: { ready?: (tenantId: string) => Promise<boolean> } = {}) {
  pushers.set(channel, { push, ready: opts.ready });
}

/** Die Schnittstelle kann diese Menge nicht setzen (z. B. SKU dort unbekannt) – wie ohne Schnittstelle als Aufgabe. */
export class ManualStockError extends Error {}

/** Kanäle, deren Menge dieser Mandant per Schnittstelle setzt; alle anderen bekommen eine Aufgabe zum Nachtragen. */
export async function channelsWithStockApi(tenantId: string): Promise<Channel[]> {
  await import("@/lib/integrations/clients");
  const out: Channel[] = [];
  for (const [channel, p] of pushers) if (!p.ready || (await p.ready(tenantId).catch(() => false))) out.push(channel);
  return out;
}

/**
 * Lager und Reservierung je Wawi-SKU. Reserviert sind Positionen offener FBM-Aufträge
 * (noch nicht versandt, nicht storniert) – zugeordnet über die Kanal-SKU des Angebots.
 * Nur SKUs mit eigenem Lagereintrag; ohne Eintrag kennt die Wawi den Bestand nicht.
 */
export async function stockLevels(tenantId: string, skus?: string[]): Promise<Map<string, StockLevel>> {
  const [res, stock, sets] = await Promise.all([
    db.execute<{ sku: string; qty: number }>(sql`
      select coalesce(nullif(l.stock_sku, ''), i.sku) as sku, sum(i.quantity)::int as qty
        from order_items i
        join orders o on o.id = i.order_id
        left join listings l on l.tenant_id = o.tenant_id and l.channel = o.channel and l.sku = i.sku
       where o.tenant_id = ${tenantId}
         and o.fulfillment = 'FBM'
         and o.status in ('open', 'label_created')
         and coalesce(o.external_status, '') !~* '(cancel|storn)'
         and i.sku is not null
       group by 1`),
    db.select({ sku: schema.ownStock.sku, quantity: schema.ownStock.quantity }).from(schema.ownStock).where(eq(schema.ownStock.tenantId, tenantId)),
    loadSets(tenantId),
  ]);
  const reserved = new Map(res.rows.map((r) => [r.sku, Number(r.qty)]));
  const base = new Map(stock.map((r) => [r.sku, { sku: r.sku, onHand: Number(r.quantity), reserved: reserved.get(r.sku) ?? 0 }]));
  // Sets (Komplettsets): Reservierung auf die Bestandteile, verfügbar = was sich daraus bilden lässt.
  const all = sets.length ? withSets(base, reserved, sets) : base;
  return skus?.length ? new Map([...all].filter(([k]) => skus.includes(k))) : all;
}

/** Wawi-SKU zu einer Kanal-SKU (z. B. eBay „LG-…“ → eigene SKU). */
export async function wawiSku(tenantId: string, channel: Channel, sku: string): Promise<string> {
  const [l] = await db
    .select({ stockSku: schema.listings.stockSku })
    .from(schema.listings)
    .where(and(eq(schema.listings.tenantId, tenantId), eq(schema.listings.channel, channel), eq(schema.listings.sku, sku)));
  return l?.stockSku?.trim() || sku;
}

export type SyncResult = { checked: number; pushed: number; failed: number; manual: number; oversold: string[] };

const running = new Set<string>();

/**
 * Gleicht die Mengen aller aktiven Kanal-Angebote mit dem verfügbaren Wawi-Bestand ab.
 * `skus` begrenzt auf bestimmte Wawi-SKUs (nach einer Bestandsänderung).
 */
export async function syncChannelStock(tenantId: string, opts: { skus?: string[] } = {}): Promise<SyncResult> {
  const result: SyncResult = { checked: 0, pushed: 0, failed: 0, manual: 0, oversold: [] };
  // Ein Lauf je Mandant gleichzeitig – sonst melden zwei Läufe dieselbe Menge doppelt.
  if (running.has(tenantId)) return result;
  running.add(tenantId);
  try {
    await import("@/lib/integrations/clients");
    const L = schema.listings;
    let rows = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.status, "active")));
    if (opts.skus?.length) {
      // Ändert sich ein Bestandteil, ändert sich auch, wie viele Sets verfügbar sind.
      const skus = [...opts.skus, ...setsContaining(await loadSets(tenantId), opts.skus)];
      rows = rows.filter((r) => skus.includes(stockSkuOf(r)));
    }
    // Alle Stände laden – die Überverkaufs-Prüfung braucht das Gesamtbild.
    const levels = await stockLevels(tenantId);
    const plan = planSync(rows, levels);
    result.checked = rows.length;
    const apis = new Set(await channelsWithStockApi(tenantId));

    for (const d of plan) {
      const l = rows.find((r) => r.id === d.listingId)!;
      if (d.action === "skip") {
        // Ein genauerer Grund (eBay-Menge nicht abrufbar) bleibt stehen.
        if (d.reason === "kein Wawi-Bestand" && l.stockSync && !/^Wawi-Bestand nicht angelegt/.test(l.lastError ?? ""))
          await db
            .update(L)
            .set({
              lastError:
                l.channel === "ebay"
                  ? `Kein Wawi-Bestand für SKU ${d.stockSku} – wird aus der eBay-Menge angelegt („Bestand aus eBay anlegen“).`
                  : `Kein Wawi-Bestand für SKU ${d.stockSku} – Menge im Kanal wird nicht abgeglichen. Unter Bestand eintragen oder Wawi-SKU zuordnen.`,
            })
            .where(eq(L.id, l.id));
        continue;
      }
      if (d.action === "none") continue;
      const key = `stock-manual:${l.id}`;
      // TikTok & Co. (oder Kanal nicht verbunden): keine Schnittstelle – als Aufgabe nachtragen lassen.
      const manual = async (reason?: string) => {
        result.manual++;
        await db.update(L).set({ lastError: `Bitte im Kanal auf ${d.target} setzen (${reason ?? "keine Schnittstelle"}).` }).where(eq(L.id, l.id));
        await upsertSystemTask(db, tenantId, key, {
          title: `${CHANNEL_LABEL[l.channel]}: Bestand von ${l.sku} auf ${d.target} setzen`,
          notes: `Wawi verfügbar: ${d.target}. Zuletzt gemeldet: ${l.pushedQuantity ?? "–"}. ${reason ? `${reason}. ` : ""}Nach dem Ändern im Kanal unter Listings „Gesetzt“ klicken.`,
          priority: d.target === 0 ? "critical" : "normal",
          category: "versand",
          link: `/listings?kanal=${l.channel}`,
        });
      };
      const fn = apis.has(l.channel) ? pushers.get(l.channel)?.push : undefined;
      if (!fn) {
        await manual();
        continue;
      }
      try {
        const r = await fn(tenantId, l, d.target);
        await db
          .update(L)
          .set({
            pushedQuantity: d.target,
            pushedAt: new Date(),
            quantity: d.target,
            lastError: null,
            lastSyncAt: new Date(),
            ...(r && r.payload ? { payload: { ...(l.payload ?? {}), ...r.payload } } : {}),
          })
          .where(eq(L.id, l.id));
        // Früher (ohne Schnittstelle) angelegte Aufgabe „Bestand von Hand setzen“ ist erledigt.
        await resolveSystemTask(db, tenantId, key);
        result.pushed++;
      } catch (e) {
        if (e instanceof ManualStockError) {
          await manual(e.message);
          continue;
        }
        result.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        const off = (e as { disableSync?: boolean }).disableSync === true;
        await db.update(L).set({ lastError: `Menge ${d.target} nicht übertragen: ${msg}`, ...(off ? { stockSync: false } : {}) }).where(eq(L.id, l.id));
      }
    }

    // Überverkauf: mehr bestellt als da – sofort sichtbar machen.
    const over = oversold(levels.values());
    result.oversold = over.map((o) => o.sku);
    const open = await db
      .select({ key: schema.tasks.systemKey })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.status, "open"), sql`${schema.tasks.systemKey} like 'oversold:%'`));
    for (const o of over) {
      await upsertSystemTask(db, tenantId, `oversold:${o.sku}`, {
        title: `Überverkauf: ${o.sku} – ${o.reserved} bestellt, ${o.onHand} im Lager`,
        notes: "Mehr in offenen Aufträgen als im eigenen Lager. Bestand prüfen (Inventur) oder Auftrag stornieren.",
        priority: "critical",
        category: "versand",
        link: `/bestand?q=${encodeURIComponent(o.sku)}`,
      });
    }
    for (const t of open) if (t.key && !over.some((o) => `oversold:${o.sku}` === t.key)) await resolveSystemTask(db, tenantId, t.key);
    return result;
  } finally {
    running.delete(tenantId);
  }
}

/** Kanal ohne Schnittstelle: Menge wurde von Hand gesetzt. */
export async function confirmManualStock(tenantId: string, listingId: string) {
  const L = schema.listings;
  const [l] = await db.select().from(L).where(and(eq(L.id, listingId), eq(L.tenantId, tenantId)));
  if (!l) return;
  const levels = await stockLevels(tenantId, [stockSkuOf(l)]);
  const target = targetQuantity(l, availableOf(levels.get(stockSkuOf(l))));
  await db.update(L).set({ pushedQuantity: target, quantity: target, pushedAt: new Date(), lastError: null }).where(eq(L.id, l.id));
  await resolveSystemTask(db, tenantId, `stock-manual:${l.id}`);
}

/** Nach einer Bestandsänderung (Wareneingang, Inventur, Versand, Retoure) im Hintergrund abgleichen. */
export function syncSoon(tenantId: string, skus?: string[]) {
  void syncChannelStock(tenantId, { skus }).catch((e) => console.error("[Bestandsabgleich]", e instanceof Error ? e.message : e));
}

/** Für die Übersichten: Angebote je Wawi-SKU. */
export async function listingsBySku(tenantId: string, skus: string[]) {
  if (!skus.length) return new Map<string, Listing[]>();
  const L = schema.listings;
  const rows = await db
    .select()
    .from(L)
    .where(and(eq(L.tenantId, tenantId), sql`coalesce(nullif(${L.stockSku}, ''), ${L.sku}) in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`));
  const out = new Map<string, Listing[]>();
  for (const r of rows) out.set(stockSkuOf(r), [...(out.get(stockSkuOf(r)) ?? []), r]);
  return out;
}

