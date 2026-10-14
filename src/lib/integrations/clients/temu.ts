import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Address } from "@/db/tables/core";
import { markShipped, registerTrackingUploader } from "@/lib/orders/service";
import {
  TEMU_ACCESS_CODES,
  TEMU_APIS,
  TEMU_HOSTS,
  TEMU_MASKED_NOTE,
  TEMU_REGION_CODES,
  TEMU_REGION_LABEL,
  TEMU_STATUS,
  type TemuCarrier,
  type TemuPageItem,
  type TemuRegion,
  type TemuShipping,
  temuAddress,
  temuCarrierId,
  temuCarrierNames,
  temuDate,
  temuErrorText,
  temuItems,
  temuOrderState,
  temuShipment,
  temuSign,
} from "@/lib/orders/temu";
import { registerListingPublisher } from "@/lib/listings/publish";
import { ManualStockError, registerStockPusher, syncSoon } from "@/lib/stock/channel-sync";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { temuGoodsPayload, temuGoodsProblems, temuListingState, type TemuGoodsInput } from "@/lib/temu/goods";
import { getIntegration } from "../store";
import { registerTester } from "../test";

// Temu Open API für lokale Shops (Seller Center): Bestellungen mit Lieferadresse abholen und die
// Sendungsnummer nach dem Versand melden. Alle Aufrufe gehen per POST an den Router der Region.

type Conn = { tenantId: string; appKey: string; appSecret: string; accessToken: string; region: TemuRegion | "auto" };

class TemuError extends Error {
  constructor(
    readonly code: number,
    msg: string,
    type: string,
  ) {
    super(temuErrorText(code, msg, type));
  }
}

async function conn(tenantId: string): Promise<Conn | null> {
  const v = await getIntegration(tenantId, "temu");
  if (!v?.appKey || !v.appSecret || !v.accessToken) return null;
  const region = (["eu", "us", "global"] as const).find((r) => r === v.region) ?? "auto";
  return { tenantId, appKey: v.appKey.trim(), appSecret: v.appSecret.trim(), accessToken: v.accessToken.trim(), region };
}

const host = (r: TemuRegion) => (process.env.TEMU_BASE_URL ? `${process.env.TEMU_BASE_URL.replace(/\/$/, "")}/${r}` : TEMU_HOSTS[r]);

async function post<T>(c: Conn, region: TemuRegion, type: string, params: Record<string, unknown>): Promise<T> {
  const p: Record<string, unknown> = { type, app_key: c.appKey, access_token: c.accessToken, data_type: "JSON", timestamp: Math.floor(Date.now() / 1000) };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p[k] = v;
  p.sign = temuSign(p, c.appSecret);
  let res: Response;
  try {
    res = await fetch(host(region), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p), signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Error(`Temu ist nicht erreichbar (${e instanceof Error ? e.message : String(e)}).`);
  }
  const text = await res.text();
  let json: { success?: boolean; errorCode?: number; errorMsg?: string; result?: T };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Temu antwortet nicht wie erwartet (HTTP ${res.status}).`);
  }
  if (!json.success) throw new TemuError(Number(json.errorCode ?? 0), String(json.errorMsg ?? ""), type);
  return json.result as T;
}

// Region „automatisch“: der Router, der den Token kennt (Europa zuerst). Gemerkt bis zum Neustart.
const regions = new Map<string, TemuRegion>();
const regionKey = (c: Conn) => `${c.tenantId}:${c.appKey}`;

async function call<T>(c: Conn, type: string, params: Record<string, unknown> = {}): Promise<T> {
  if (c.region !== "auto") return post<T>(c, c.region, type, params);
  const known = regions.get(regionKey(c));
  if (known) return post<T>(c, known, type, params);
  let first: unknown = null;
  for (const r of ["eu", "global", "us"] as const) {
    try {
      const out = await post<T>(c, r, type, params);
      regions.set(regionKey(c), r);
      return out;
    } catch (e) {
      if (!(e instanceof TemuError)) throw e;
      if (!TEMU_REGION_CODES.has(e.code)) {
        regions.set(regionKey(c), r);
        throw e;
      }
      first ??= e;
    }
  }
  throw first;
}

const asList = <T>(r: unknown): T[] => (Array.isArray(r) ? r : ((Object.values((r ?? {}) as object).find(Array.isArray) as T[] | undefined) ?? []));

type TokenInfo = { mallId?: number; regionId?: number; expiredTime?: number; apiScopeList?: string[] };
const fmtDate = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });

registerTester("temu", async (_v, tenantId) => {
  const c = await conn(tenantId);
  if (!c) throw new Error("App-Key, App-Secret und Access-Token eintragen und speichern.");
  regions.delete(regionKey(c));
  const info = (await call<TokenInfo>(c, "bg.open.accesstoken.info.get")) ?? {};
  const region = c.region === "auto" ? regions.get(regionKey(c)) : c.region;
  const head = `Verbunden mit Temu${region ? ` ${TEMU_REGION_LABEL[region]}` : ""}${info.mallId ? ` (Shop ${info.mallId})` : ""}.`;
  const parts = [head];
  const until = temuDate(info.expiredTime);
  if (until) parts.push(`Token gültig bis ${fmtDate(until)}.`);
  await tokenReminder(c, info);
  try {
    const r = await call<{ totalItemNum?: number }>(c, "bg.order.list.v2.get", { pageNumber: 1, pageSize: 1, parentOrderStatus: 2 });
    parts.push(`${r?.totalItemNum ?? 0} Bestellung(en) warten auf Versand – werden alle 5 Minuten abgeholt.`);
  } catch (e) {
    throw new Error(`${head} Aber: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Nur auswerten, wenn Temu die Freigaben als Schnittstellennamen liefert.
  const scopes = info.apiScopeList ?? [];
  const missing = scopes.some((s) => s.startsWith("bg.")) ? TEMU_APIS.filter((a) => !scopes.includes(a.type)) : [];
  if (missing.length) parts.push(`Noch nicht freigegeben: ${missing.map((m) => `${m.label} (${m.type})`).join(", ")} – im Seller Center die App neu autorisieren und den neuen Token eintragen.`);
  return parts.join(" ");
});

/** Ist Temu eingerichtet? (für den Hintergrund-Abruf) */
export async function temuConnected(tenantId: string) {
  return Boolean(await conn(tenantId));
}

const LIST = "bg.order.list.v2.get";
const PAGE = 50;

async function listOrders(c: Conn, params: Record<string, unknown>, maxPages: number) {
  const out: TemuPageItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await call<{ pageItems?: TemuPageItem[] }>(c, LIST, { ...params, pageNumber: page, pageSize: PAGE });
    const items = r?.pageItems ?? [];
    out.push(...items.filter((i) => i?.parentOrderMap?.parentOrderSn));
    if (items.length < PAGE) break;
  }
  return out;
}

/** Echte Lieferadresse; ohne Freigabe dafür die unkenntliche (dann ohne Adresse übernehmen). */
async function fetchAddress(c: Conn, sn: string, regionId?: number): Promise<{ address: Address | null; masked: boolean }> {
  const noAccess = (e: unknown) => e instanceof TemuError && [3000021, 3000027, 3000032, 180020001, 180020008].includes(e.code);
  const usable = (s: TemuShipping | null) => {
    const r = temuAddress(s ?? {}, regionId);
    return { address: r.masked ? null : r.address, masked: r.masked };
  };
  try {
    return usable(await call<TemuShipping>(c, "bg.order.decryptshippinginfo.get", { parentOrderSn: sn }));
  } catch (e) {
    if (!noAccess(e)) throw e;
  }
  try {
    return usable(await call<TemuShipping>(c, "bg.order.shippinginfo.v2.get", { parentOrderSn: sn }));
  } catch (e) {
    if (!noAccess(e)) throw e;
    return { address: null, masked: true };
  }
}

// Token-Ablauf höchstens alle 6 Stunden prüfen; Positionsstand je Bestellung bis zum Neustart.
const tokenChecked = new Map<string, number>();
const lastUpdate = new Map<string, number>();

const tokenKey = (c: Conn) => `${regionKey(c)}:${c.accessToken.slice(-8)}`;

/** Aufgabe, wenn der Token in den nächsten 14 Tagen abläuft. */
async function tokenReminder(c: Conn, info: TokenInfo | null) {
  tokenChecked.set(tokenKey(c), Date.now());
  const until = temuDate(info?.expiredTime);
  if (until && until.getTime() - Date.now() < 14 * 86400_000) {
    await upsertSystemTask(db, c.tenantId, "temu-token", {
      title: `Temu-Token läuft am ${fmtDate(until)} ab`,
      notes: "Im Seller Center (seller-eu.temu.com → Open Platform → Client-Verwaltung) die App neu autorisieren und den neuen Access-Token unter Anbindungen → Temu eintragen.",
      link: "/anbindungen",
      dueDate: until.toISOString().slice(0, 10),
    });
  } else await resolveSystemTask(db, c.tenantId, "temu-token");
}

async function checkToken(c: Conn) {
  if (Date.now() - (tokenChecked.get(tokenKey(c)) ?? 0) < 6 * 3600_000) return;
  try {
    await tokenReminder(c, await call<TokenInfo>(c, "bg.open.accesstoken.info.get"));
  } catch (e) {
    if (e instanceof TemuError && TEMU_ACCESS_CODES.has(e.code)) throw e;
    console.warn(`[Temu] Token-Prüfung: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function pull(c: Conn) {
  const t = c.tenantId;
  await checkToken(c);
  const bySn = new Map<string, TemuPageItem>();
  // Alle Bestellungen, die auf Versand warten …
  for (const it of await listOrders(c, { parentOrderStatus: 2 }, 20)) bySn.set(it.parentOrderMap.parentOrderSn, it);
  // … und kürzlich geänderte (storniert, im Seller Center versandt, zugestellt).
  const now = Math.floor(Date.now() / 1000);
  try {
    for (const it of await listOrders(c, { updateAtStart: now - 2 * 86400, updateAtEnd: now }, 10)) {
      if (!bySn.has(it.parentOrderMap.parentOrderSn)) bySn.set(it.parentOrderMap.parentOrderSn, it);
    }
  } catch (e) {
    if (e instanceof TemuError && TEMU_ACCESS_CODES.has(e.code)) throw e;
    console.warn(`[Temu] Änderungen: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!bySn.size) return { orders: 0 };

  const rows = await db
    .select({ id: schema.orders.id, externalId: schema.orders.externalId, status: schema.orders.status, notes: schema.orders.notes })
    .from(schema.orders)
    .where(and(eq(schema.orders.tenantId, t), eq(schema.orders.channel, "temu"), inArray(schema.orders.externalId, [...bySn.keys()])));
  const known = new Map(rows.map((r) => [r.externalId, r]));
  const setItems = async (orderId: string, it: TemuPageItem) => {
    const items = temuItems(it.orderList);
    if (!items.length) return;
    await db.delete(schema.orderItems).where(and(eq(schema.orderItems.tenantId, t), eq(schema.orderItems.orderId, orderId)));
    await db.insert(schema.orderItems).values(items.map((i) => ({ tenantId: t, orderId, ...i })));
  };

  let created = 0;
  for (const [sn, it] of bySn) {
    const p = it.parentOrderMap;
    const state = temuOrderState(it);
    const externalStatus = TEMU_STATUS[Number(p.parentOrderStatus)] ?? String(p.parentOrderStatus);
    const memo = `${t}:${sn}`;
    const ex = known.get(sn);
    if (!ex) {
      if (state !== "open") continue;
      const addr = await fetchAddress(c, sn, p.regionId);
      const [row] = await db
        .insert(schema.orders)
        .values({
          tenantId: t,
          channel: "temu",
          externalId: sn,
          orderDate: temuDate(p.parentOrderTime) ?? new Date(),
          fulfillment: "FBM",
          status: "open",
          externalStatus,
          buyerName: addr.address?.name1 ?? null,
          shipTo: addr.address ?? undefined,
          shipBy: temuDate(p.expectShipLatestTime),
          notes: addr.masked ? TEMU_MASKED_NOTE : null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.orders.id });
      if (!row) continue;
      await setItems(row.id, it);
      lastUpdate.set(memo, p.updateTime ?? 0);
      created++;
      continue;
    }

    const set: Partial<typeof schema.orders.$inferInsert> = { externalStatus, updatedAt: new Date() };
    const shipBy = temuDate(p.expectShipLatestTime);
    if (shipBy) set.shipBy = shipBy;
    const pendingHere = ex.status === "open" || ex.status === "label_created";
    if (state === "cancelled" && pendingHere) set.status = "cancelled";
    if (state === "delivered" && ex.status === "shipped") set.status = "delivered";
    // Bei Temu geändert (Adresse, Teil-Storno): Adresse und Positionen neu holen.
    if (state === "open" && ex.status === "open" && lastUpdate.get(memo) !== (p.updateTime ?? 0)) {
      const addr = await fetchAddress(c, sn, p.regionId);
      if (addr.address) {
        set.shipTo = addr.address;
        set.buyerName = addr.address.name1 ?? null;
        if (ex.notes === TEMU_MASKED_NOTE) set.notes = null;
      }
      await setItems(ex.id, it);
      lastUpdate.set(memo, p.updateTime ?? 0);
    }
    await db.update(schema.orders).set(set).where(and(eq(schema.orders.tenantId, t), eq(schema.orders.id, ex.id)));
    // Im Seller Center versandt → hier auch (Lager wird abgebucht, keine Meldung zurück).
    if ((state === "shipped" || state === "delivered") && pendingHere) await markShipped(t, ex.id, null);
  }
  return { orders: created };
}

/** Bestellungen von Temu abholen. Zugangsprobleme landen als Aufgabe auf der Startseite. */
export async function syncTemuOrders(tenantId: string) {
  const c = await conn(tenantId);
  if (!c) return { orders: 0 };
  try {
    const out = await pull(c);
    await resolveSystemTask(db, tenantId, "temu-verbindung");
    return out;
  } catch (e) {
    if (e instanceof TemuError && TEMU_ACCESS_CODES.has(e.code)) {
      // Erneuter Ausfall nach Behebung → wieder als offene Aufgabe (nicht im erledigten Eintrag versteckt).
      await db.delete(schema.tasks).where(and(eq(schema.tasks.tenantId, tenantId), eq(schema.tasks.systemKey, "temu-verbindung"), eq(schema.tasks.status, "done")));
      await upsertSystemTask(db, tenantId, "temu-verbindung", { title: "Temu-Verbindung prüfen", notes: e.message, priority: "critical", link: "/anbindungen" });
    }
    throw e;
  }
}

registerTrackingUploader("temu", async (tenantId, order) => {
  const c = await conn(tenantId);
  if (!c) throw new Error("Temu ist nicht verbunden (Anbindungen → Temu) – Sendungsnummer bitte im Seller Center eintragen.");
  const r = await call<{ pageItems?: TemuPageItem[] }>(c, LIST, { pageNumber: 1, pageSize: 10, parentOrderSnList: [order.externalId] });
  const it = r?.pageItems?.find((p) => p.parentOrderMap?.parentOrderSn === order.externalId);
  if (!it) throw new Error(`Temu kennt die Bestellung ${order.externalId} nicht.`);
  const state = temuOrderState(it);
  if (state === "shipped" || state === "delivered") return;
  if (state === "cancelled") throw new Error("Die Bestellung ist bei Temu storniert – nichts zu melden.");
  const carriers = asList<TemuCarrier>(await call(c, "bg.logistics.companies.get", { regionId: it.parentOrderMap.regionId ?? 76 }));
  const carrierId = temuCarrierId(carriers, order.carrier);
  if (!carrierId) {
    const names = temuCarrierNames(carriers).slice(0, 12);
    throw new Error(`Temu kennt den Versanddienstleister „${order.carrier ?? "DHL"}“ nicht${names.length ? ` (möglich: ${names.join(", ")})` : ""}.`);
  }
  const send = (warehouseId?: string) => call(c, "bg.logistics.shipment.v2.confirm", temuShipment(order.externalId, it.orderList, carrierId, order.trackingNumber ?? "", warehouseId));
  try {
    await send();
  } catch (e) {
    if (e instanceof TemuError && e.code === 120012004) return;
    if (!(e instanceof TemuError) || ![120015527, 120011085].includes(e.code)) throw e;
    // Shop mit eigenen Versandlagern: Standardlager mitschicken.
    const w = await call<{ warehouseList?: { warehouseId: string; defaultWarehouse?: boolean }[] }>(c, "bg.logistics.warehouse.list.get");
    const list = w?.warehouseList ?? [];
    const pick = list.find((x) => x.defaultWarehouse) ?? (list.length === 1 ? list[0] : undefined);
    if (!pick) throw new Error("Temu verlangt ein Versandlager – bitte im Seller Center ein Standardlager festlegen.");
    await send(pick.warehouseId);
  }
});

// ---- Angebote und Bestand -------------------------------------------------------------------

/** Temu-Nummern einer Artikelnummer (SKU im Temu-Angebot = SKU in der Wawi). */
type SkuRef = { goodsId: string; skuId: string };

const safeId = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Temu-Nummer ${v} ist zu groß für die Übertragung.`);
  return n;
};

async function findSku(c: Conn, sku: string): Promise<SkuRef | null> {
  const r = await call<{ skuList?: { goodsId?: string | number; skuId?: string | number; outSkuSn?: string }[] }>(c, "temu.local.sku.list.retrieve", { outSkuSnList: [sku], pageSize: 20 });
  const hit = (r?.skuList ?? []).find((x) => String(x.outSkuSn ?? "").trim() === sku && x.goodsId && x.skuId);
  return hit ? { goodsId: String(hit.goodsId), skuId: String(hit.skuId) } : null;
}

/**
 * Menge eines Temu-Angebots setzen (Bestandsabgleich der Wawi). Temu adressiert Artikel über
 * eigene Nummern – die werden einmal über die Artikelnummer (SKU) gesucht und am Angebot gemerkt.
 */
registerStockPusher("temu", async (tenantId, l, quantity) => {
  const c = await conn(tenantId);
  if (!c) throw new ManualStockError("Temu nicht verbunden");
  const p = (l.payload ?? {}) as { goodsId?: string; skuId?: string };
  const ref = p.goodsId && p.skuId ? { goodsId: String(p.goodsId), skuId: String(p.skuId) } : await findSku(c, l.sku);
  // Bis die SKU im Temu-Angebot steht: von Hand setzen lassen.
  if (!ref) throw new ManualStockError(`Temu kennt die SKU „${l.sku}“ nicht – im Temu-Angebot genau diese SKU eintragen, dann geht es automatisch`);
  const r = await call<{ operateResult?: boolean; msg?: string; skuStockEditStatusInfoList?: { skuId?: number; stockEditStatus?: boolean; errorMsg?: string }[] }>(c, "bg.local.goods.stock.edit", {
    goodsId: safeId(ref.goodsId),
    skuStockTargetList: [{ skuId: safeId(ref.skuId), stockTarget: Math.max(0, Math.floor(quantity)) }],
    requestUniqueKey: randomUUID(),
  });
  const bad = r?.skuStockEditStatusInfoList?.find((x) => x.stockEditStatus === false);
  if (bad || r?.operateResult === false) throw new Error(`Temu hat die Menge nicht übernommen: ${bad?.errorMsg || r?.msg || "ohne Begründung"}`);
  return p.goodsId === ref.goodsId && p.skuId === ref.skuId ? undefined : { payload: { goodsId: ref.goodsId, skuId: ref.skuId } };
}, { ready: temuConnected });

/** Angebot bei Temu anlegen. Gibt Temus Produktnummer zurück. */
export async function temuCreateGoods(tenantId: string, goods: TemuGoodsInput): Promise<{ goodsId: string }> {
  const c = await conn(tenantId);
  if (!c) throw new Error("Temu ist nicht verbunden (Anbindungen → Temu).");
  const problems = temuGoodsProblems(goods, { allowHttp: process.env.TEMU_ALLOW_HTTP_IMAGES === "1" });
  if (problems.length) throw new Error(problems.join(" "));
  try {
    const r = await call<{ goodsId?: string | number }>(c, "temu.local.goods.v3.add", temuGoodsPayload(goods));
    if (!r?.goodsId) throw new Error("Temu hat keine Produktnummer zurückgegeben.");
    return { goodsId: String(r.goodsId) };
  } catch (e) {
    // Schon angelegt (z. B. Antwort beim ersten Versuch verloren)? Dann das vorhandene nehmen.
    const known = (await temuGoodsStatus(tenantId, [goods.externalGoodsId]).catch(() => new Map())).get(goods.externalGoodsId);
    if (known?.goodsId) return { goodsId: known.goodsId };
    throw e;
  }
}

export type TemuGoodsState = { goodsId: string; status: string; skus: { skuId: string; skuSn: string }[] };

/** Stand der Angebote bei Temu (über unsere Angebotsnummern). */
export async function temuGoodsStatus(tenantId: string, externalGoodsIds: string[]): Promise<Map<string, TemuGoodsState>> {
  const c = await conn(tenantId);
  const out = new Map<string, TemuGoodsState>();
  if (!c || !externalGoodsIds.length) return out;
  for (let i = 0; i < externalGoodsIds.length; i += 50) {
    const r = await call<{ goodsList?: { goodsId?: string | number; outGoodsSn?: string; goodsStatus?: string; skuInfoList?: { skuId?: string | number; skuSn?: string }[] }[] }>(c, "temu.local.goods.list.retrieve", {
      outGoodsSnList: externalGoodsIds.slice(i, i + 50),
      pageSize: 50,
    });
    for (const g of r?.goodsList ?? []) {
      if (!g.outGoodsSn || !g.goodsId) continue;
      out.set(g.outGoodsSn, {
        goodsId: String(g.goodsId),
        status: String(g.goodsStatus ?? ""),
        skus: (g.skuInfoList ?? []).filter((x) => x.skuId).map((x) => ({ skuId: String(x.skuId), skuSn: String(x.skuSn ?? "") })),
      });
    }
  }
  return out;
}

/**
 * Wawi-Angebote für Temu mit dem Stand bei Temu abgleichen: in Prüfung, Entwurf, aktiv … Aktiv
 * heißt: Temu-Nummern gemerkt, Bestandsabgleich läuft. Ohne `ids` alle noch nicht aktiven.
 */
export async function refreshTemuListings(tenantId: string, ids?: string[]): Promise<number> {
  const L = schema.listings;
  const rows = (
    await db
      .select()
      .from(L)
      .where(and(eq(L.tenantId, tenantId), eq(L.channel, "temu"), sql`${L.payload} ? 'externalGoodsId'`, ...(ids ? [inArray(L.id, ids)] : [sql`${L.status} <> 'active'`])))
  ).filter((l) => typeof l.payload?.externalGoodsId === "string");
  if (!rows.length) return 0;
  const states = await temuGoodsStatus(tenantId, [...new Set(rows.map((l) => String(l.payload.externalGoodsId)))]);
  const synced: string[] = [];
  for (const l of rows) {
    const st = states.get(String(l.payload.externalGoodsId));
    if (!st) continue;
    const state = temuListingState(st.status);
    const sku = st.skus.find((x) => x.skuSn === l.sku) ?? (st.skus.length === 1 ? st.skus[0] : undefined);
    await db
      .update(L)
      .set({
        status: state.status,
        externalId: st.goodsId,
        lastError: state.lastError,
        payload: { ...l.payload, goodsId: st.goodsId, temuStatus: st.status, ...(sku ? { skuId: sku.skuId } : {}) },
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(L.id, l.id));
    if (state.status === "active" && l.status !== "active") synced.push(l.stockSku?.trim() || l.sku);
  }
  // Frisch freigegeben → Menge gleich mit der Wawi abgleichen.
  if (synced.length) syncSoon(tenantId, synced);
  return rows.length;
}

/** Wawi-Angebot (Kanal Temu, Entwurf) bei Temu anlegen – Bilder, Gewicht und Maße aus den Angebotsdaten. */
registerListingPublisher("temu", async (tenantId, l) => {
  const p = l.payload as { imageUrls?: string[]; weightG?: number; lengthCm?: number; widthCm?: number; heightCm?: number; attributes?: Record<string, string[]> };
  const goods: TemuGoodsInput = {
    externalGoodsId: l.sku,
    title: l.title,
    description: l.description ?? undefined,
    images: p.imageUrls ?? [],
    attributes: p.attributes ?? {},
    skus: [{ externalSkuId: l.sku, price: l.price ?? 0, quantity: l.quantity, images: p.imageUrls ?? [], ean: l.ean ?? undefined }],
    pack: { weightG: Number(p.weightG) || 0, lengthCm: Number(p.lengthCm) || 0, widthCm: Number(p.widthCm) || 0, heightCm: Number(p.heightCm) || 0 },
  };
  const { goodsId } = await temuCreateGoods(tenantId, goods);
  await db.update(schema.listings).set({ payload: { ...l.payload, externalGoodsId: l.sku, goodsId } }).where(eq(schema.listings.id, l.id));
  // Temu prüft neue Angebote – bis zur Freigabe Entwurf, der Abruf meldet den Stand.
  return { externalId: goodsId, status: "draft", lastError: temuListingState("INCOMPLETE").lastError };
});
