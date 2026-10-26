import "server-only";
import { and, eq, inArray, like, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { recordJob } from "@/lib/today/jobs";
import { syncClaims } from "@/lib/claims/service";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { sbAllPages, sbCall } from "./client";
import { readConn, sbConnected, writeConn } from "./connection";
import { mapFixCosts, mapInventory, mapMonths, mapProduct, mapShipments, mapSkuRows, reorderNow, type SbInventory, type SbProduct } from "./parse";

// Abgleich mit sellerboard (nur lesend). „bestand“ = Bestand + Sendungen (alle 4 Std.), „alles“ zusätzlich
// Produkte/EK, Monatswerte, Gewinn je SKU und Fixkosten (täglich). Läuft im Hintergrund, je Mandant einmal.

export type SyncScope = "bestand" | "alles";
const running = new Set<string>();
const chunks = <T,>(a: T[], n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
/** Doppelte Einträge (gleiche sellerboard-ID auf zwei Seiten) – der letzte gilt; sonst scheitert das Upsert. */
const uniqueBy = <T extends { sbId: string }>(a: T[]) => [...new Map(a.map((x) => [x.sbId, x])).values()];

/** Welches sellerboard-Konto (bei mehreren: das erste mit Daten). */
export async function identifyAccount(tenantId: string) {
  const r = await sbCall(tenantId, "list_accounts");
  const list = (r.accounts as { account_id?: string; name?: string }[] | undefined) ?? [];
  const a = list[0];
  if (a?.account_id) await writeConn(tenantId, { config: { accountId: a.account_id, accountName: a.name ?? undefined } });
}

const monthOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 7);
const utcDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

/** Monatsgrenzen (UTC) der letzten n Monate inkl. laufendem Monat bis heute. */
export function monthPeriods(today: string, n: number) {
  const out: { start: number; end: number; month: string }[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const last = new Date(Date.UTC(y, m - i, 0));
    const lastIso = i === 0 ? today : last.toISOString().slice(0, 10);
    out.push({ start: utcDay(first.toISOString().slice(0, 10)), end: utcDay(lastIso), month: first.toISOString().slice(0, 7) });
  }
  return out;
}

async function syncProducts(t: string, now: Date) {
  const rows = (await sbAllPages(t, "products", {}, 35)).map(mapProduct).filter((r): r is SbProduct => r !== null);
  const P = schema.sellerboardProducts;
  for (const part of chunks(uniqueBy(rows))) {
    await db
      .insert(P)
      .values(part.map((r) => ({ tenantId: t, ...r, vatPct: r.vatPct === null ? null : String(r.vatPct), syncedAt: now })))
      .onConflictDoUpdate({
        target: [P.tenantId, P.sbId],
        set: { sku: sql`excluded.sku`, asin: sql`excluded.asin`, ean: sql`excluded.ean`, name: sql`excluded.name`, channel: sql`excluded.channel`, cost: sql`excluded.cost`, costPeriod: sql`excluded.cost_period`, price: sql`excluded.price`, fbaFee: sql`excluded.fba_fee`, referralFee: sql`excluded.referral_fee`, vatPct: sql`excluded.vat_pct`, margin: sql`excluded.margin`, syncedAt: sql`excluded.synced_at` },
      });
  }
  // In sellerboard gelöschte Produkte: weg (der EK käme sonst aus einer alten Liste).
  if (rows.length) await db.delete(P).where(and(eq(P.tenantId, t), lt(P.syncedAt, now)));
  return rows.length;
}

/** Bestand je SKU zusammenfassen (eine SKU kann in mehreren Zeilen stehen, z. B. je Marktplatz). */
function bySku(rows: SbInventory[]) {
  const m = new Map<string, SbInventory>();
  for (const r of rows) {
    const cur = m.get(r.sku);
    if (!cur) m.set(r.sku, { ...r });
    else Object.assign(cur, { fbaStock: cur.fbaStock + r.fbaStock, reserved: cur.reserved + r.reserved, inbound: cur.inbound + r.inbound });
  }
  return [...m.values()];
}

async function syncInventory(t: string, now: Date) {
  const rows = (await sbAllPages(t, "inventory", { channel: "FBA" }, 35)).map(mapInventory).filter((r): r is SbInventory => r !== null).filter((r) => (r.channel ?? "FBA").toUpperCase() === "FBA");
  const S = schema.sellerboardInventory;
  for (const part of chunks(uniqueBy(rows))) {
    await db
      .insert(S)
      .values(part.map((r) => ({ tenantId: t, ...r, salesVelocity: r.salesVelocity === null ? null : String(r.salesVelocity), syncedAt: now })))
      .onConflictDoUpdate({
        target: [S.tenantId, S.sbId],
        set: { sku: sql`excluded.sku`, asin: sql`excluded.asin`, fnsku: sql`excluded.fnsku`, name: sql`excluded.name`, channel: sql`excluded.channel`, fbaStock: sql`excluded.fba_stock`, reserved: sql`excluded.reserved`, inbound: sql`excluded.inbound`, salesVelocity: sql`excluded.sales_velocity`, daysLeft: sql`excluded.days_left`, timeToReorder: sql`excluded.time_to_reorder`, daysToReorder: sql`excluded.days_to_reorder`, qtyToReorder: sql`excluded.qty_to_reorder`, runningOut: sql`excluded.running_out`, cost: sql`excluded.cost`, syncedAt: sql`excluded.synced_at` },
      });
  }
  if (rows.length) await db.delete(S).where(and(eq(S.tenantId, t), lt(S.syncedAt, now)));

  // FBA-Bestand wie aus dem Bestandsbericht (Stand heute, Herkunft sellerboard). Unverkäufliches kennt sellerboard
  // hier nicht – der bisherige Wert bleibt stehen.
  const I = schema.amazonInventory;
  const today = todayIso();
  for (const part of chunks(bySku(rows))) {
    await db
      .insert(I)
      .values(part.map((r) => ({ tenantId: t, sku: r.sku, fnsku: r.fnsku, asin: r.asin, title: r.name, fulfillable: r.fbaStock, reserved: r.reserved, inboundShipped: r.inbound, total: r.fbaStock + r.reserved + r.inbound, snapshotDate: today, source: "sellerboard" as const })))
      .onConflictDoUpdate({
        target: [I.tenantId, I.sku],
        set: {
          fnsku: sql`coalesce(excluded.fnsku, ${I.fnsku})`,
          asin: sql`coalesce(excluded.asin, ${I.asin})`,
          title: sql`coalesce(${I.title}, excluded.title)`,
          fulfillable: sql`excluded.fulfillable`,
          reserved: sql`excluded.reserved`,
          inboundWorking: sql`0`,
          inboundShipped: sql`excluded.inbound_shipped`,
          inboundReceiving: sql`0`,
          total: sql`excluded.total + ${I.unsellable}`,
          snapshotDate: sql`excluded.snapshot_date`,
          source: sql`excluded.source`,
          updatedAt: sql`now()`,
        },
      });
  }

  // Eine Sammelaufgabe statt vieler einzelner.
  const now2 = reorderNow(rows);
  const key = "sellerboard-reorder";
  if (now2.length) {
    await upsertSystemTask(db, t, key, {
      title: `${now2.length} Produkt${now2.length === 1 ? "" : "e"} jetzt nachbestellen (laut sellerboard)`,
      notes: "sellerboard rechnet mit Abverkauf, Lieferzeit und Puffer. Liste mit Menge und spätestem Bestelldatum unter Einkauf → Bestellvorschläge.",
      category: "einkauf",
      link: "/einkauf/vorschlaege#sellerboard",
      dueDate: today,
    });
  } else await resolveSystemTask(db, t, key);
  return rows.length;
}

async function syncShipments(t: string, now: Date) {
  const begin = Math.floor(Date.now() / 1000) - 150 * 86_400;
  const all: ReturnType<typeof mapShipments> = [];
  let total = Infinity;
  for (let page = 1; (page - 1) * 8 < total && page <= 200; page++) {
    const reply = await sbCall(t, "fba_shipments", { begin_date: begin, page, count: 8 });
    total = Number(reply.total ?? 0);
    const got = mapShipments(reply);
    all.push(...got);
    if (!((reply.result as unknown[] | undefined) ?? []).length) break;
  }
  const S = schema.sellerboardShipments;
  for (const part of chunks(uniqueBy(all), 200)) {
    await db
      .insert(S)
      .values(part.map((s) => ({ tenantId: t, ...s, syncedAt: now })))
      .onConflictDoUpdate({ target: [S.tenantId, S.sbId], set: { amazonId: sql`excluded.amazon_id`, name: sql`excluded.name`, status: sql`excluded.status`, createdOn: sql`excluded.created_on`, lastUpdate: sql`excluded.last_update`, lines: sql`excluded.lines`, syncedAt: sql`excluded.synced_at` } });
  }
  return all.length;
}

async function syncMonths(t: string, now: Date) {
  const periods = monthPeriods(todayIso(), 12);
  const reply = await sbCall(t, "dashboard_period", { periods: periods.map((p) => ({ start: p.start, end: p.end })) });
  const months = mapMonths(reply, monthOf);
  const M = schema.sellerboardMonths;
  for (const m of months) {
    await db.insert(M).values({ tenantId: t, ...m, syncedAt: now }).onConflictDoUpdate({ target: [M.tenantId, M.month], set: { ...m, syncedAt: now } });
  }
  // Gewinn je SKU: laufender und letzter Monat.
  const SK = schema.sellerboardSkuMonths;
  let skuRows = 0;
  for (const p of periods.slice(-2)) {
    await sbCall(t, "dashboard_period", { periods: [{ start: p.start, end: p.end }] });
    const rows: ReturnType<typeof mapSkuRows> = [];
    let total = Infinity;
    for (let page = 1; (page - 1) * 35 < total && page <= 120; page++) {
      const reply = await sbCall(t, "dashboard_table", { entry_type: "product", period_start: p.start, period_end: p.end, page, count: 35 });
      total = Number(reply.total ?? 0);
      rows.push(...mapSkuRows(reply));
      if (!((reply.result as unknown[] | undefined) ?? []).length) break;
    }
    const merged = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = merged.get(r.sku);
      if (!cur) merged.set(r.sku, { ...r });
      else Object.assign(cur, { units: (cur.units ?? 0) + (r.units ?? 0), sales: (cur.sales ?? 0) + (r.sales ?? 0), netProfit: (cur.netProfit ?? 0) + (r.netProfit ?? 0) });
    }
    await db.delete(SK).where(and(eq(SK.tenantId, t), eq(SK.month, p.month)));
    for (const part of chunks([...merged.values()])) await db.insert(SK).values(part.map((r) => ({ tenantId: t, month: p.month, ...r, syncedAt: now })));
    skuRows += merged.size;
  }
  return { months: months.length, skuRows };
}

async function syncFixCosts(t: string) {
  const rows = await sbAllPages(t, "expenses", {}, 50, 40);
  const costs = mapFixCosts(rows, todayIso());
  const C = schema.cashItems;
  const refs = costs.map((c) => `sellerboard:${c.ref}`);
  for (const c of costs) {
    const values = { tenantId: t, date: c.start, amount: c.amount, category: "Fixkosten (sellerboard)", description: c.name, recurrence: c.recurrence, endDate: c.end, externalRef: `sellerboard:${c.ref}` };
    await db
      .insert(C)
      .values(values)
      .onConflictDoUpdate({ target: [C.tenantId, C.externalRef], targetWhere: sql`${C.externalRef} is not null`, set: { date: values.date, amount: values.amount, description: values.description, recurrence: values.recurrence, endDate: values.endDate, category: values.category } });
  }
  // In sellerboard entfernte Fixkosten auch hier entfernen – nur die übernommenen, nie eigene Posten.
  const old = await db.select({ id: C.id, ref: C.externalRef }).from(C).where(and(eq(C.tenantId, t), like(C.externalRef, "sellerboard:%")));
  const gone = old.filter((o) => !refs.includes(o.ref!)).map((o) => o.id);
  if (gone.length) await db.delete(C).where(and(eq(C.tenantId, t), inArray(C.id, gone)));
  return costs.length;
}

/** Ein Abgleich (wartet bis fertig). Fehler eines Teils halten die anderen nicht auf. */
export async function syncSellerboard(tenantId: string, scope: SyncScope = "alles") {
  if (!(await sbConnected(tenantId))) return { skipped: true };
  if (running.has(tenantId)) return { skipped: true };
  running.add(tenantId);
  const now = new Date();
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      void recordJob(tenantId, `sellerboard: ${name}`, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      void recordJob(tenantId, `sellerboard: ${name}`, msg);
    }
  };
  try {
    await writeConn(tenantId, { config: { syncing: scope === "alles" ? "Abgleich läuft (alles) …" : "Abgleich läuft (Bestand) …" } });
    const conn = await readConn(tenantId);
    if (!conn?.config.accountId) await step("Konto", () => identifyAccount(tenantId));
    if (scope === "alles") await step("Produkte & EK", async () => void (counts.produkte = await syncProducts(tenantId, now)));
    await step("FBA-Bestand", async () => void (counts.bestand = await syncInventory(tenantId, now)));
    await step("FBA-Sendungen", async () => void (counts.sendungen = await syncShipments(tenantId, now)));
    if (scope === "alles") {
      await step("Monatswerte & Gewinn je SKU", async () => {
        const r = await syncMonths(tenantId, now);
        counts.monate = r.months;
        counts.skuMonat = r.skuRows;
      });
      await step("Fixkosten", async () => void (counts.fixkosten = await syncFixCosts(tenantId)));
    }
    // Fehlmengen aus den Sendungen gleich als Ansprüche prüfen.
    await step("Ansprüche aus Sendungen", async () => void (await syncClaims(tenantId)));
    await writeConn(tenantId, { config: { syncing: null, lastSyncAt: new Date().toISOString(), lastSyncError: errors.length ? errors.join(" · ").slice(0, 800) : null, lastCounts: { ...((await readConn(tenantId))?.config.lastCounts ?? {}), ...counts } } });
    return { skipped: false, counts, errors };
  } catch (e) {
    await writeConn(tenantId, { config: { syncing: null, lastSyncError: e instanceof Error ? e.message : String(e) } }).catch(() => undefined);
    throw e;
  } finally {
    running.delete(tenantId);
  }
}

/** Im Hintergrund starten (Knopf „Jetzt abgleichen“, nach dem Verbinden, Zeitplan). */
export function startSellerboardSync(tenantId: string, scope: SyncScope) {
  void syncSellerboard(tenantId, scope).catch((e) => console.error("[sellerboard]", e instanceof Error ? e.message : e));
}

export const sellerboardSyncRunning = (tenantId: string) => running.has(tenantId);
