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
  temuComplianceNote,
  temuComplianceTodos,
  type TemuComplianceGoods,
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
import { TEMU_GOODS_STATUS, temuGoodsPayload, temuGoodsProblems, temuListingState, type TemuGoodsInput } from "@/lib/temu/goods";
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
  // Produkte je Stand – zeigt, ob die Produktschnittstellen gehen und wo neue Angebote landen.
  try {
    parts.push(`Produkte bei Temu: ${await temuGoodsCounts(c)}.`);
  } catch (e) {
    parts.push(`Produktliste nicht abrufbar: ${e instanceof Error ? e.message : String(e)}`);
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

// Die Produkt-Schnittstellen (temu.local.*, bg.local.goods.*) erwarten ihre Angaben laut Temu-Doku in
// einem „request“-Objekt; manche nehmen sie auch direkt. Erst mit Hülle, bei einem Parameterfehler
// ohne – was klappt, wird je Schnittstelle gemerkt.
const wrapStyle = new Map<string, boolean>();

async function localCall<T>(c: Conn, type: string, params: Record<string, unknown>): Promise<T> {
  const known = wrapStyle.get(type);
  if (known !== undefined) return call<T>(c, type, known ? { request: params } : params);
  try {
    const r = await call<T>(c, type, { request: params });
    wrapStyle.set(type, true);
    return r;
  } catch (e) {
    // Zugang, Token, Region: am Format liegt es nicht.
    if (!(e instanceof TemuError) || TEMU_ACCESS_CODES.has(e.code) || TEMU_REGION_CODES.has(e.code)) throw e;
    try {
      const r = await call<T>(c, type, params);
      wrapStyle.set(type, false);
      return r;
    } catch {
      throw e;
    }
  }
}

type Obj = Record<string, unknown>;
/** Liste in einer Antwort – unter einem der Namen, sonst die erste Liste von Objekten. */
function listOf(result: unknown, ...keys: string[]): Obj[] {
  if (Array.isArray(result)) return result as Obj[];
  const r = (result ?? {}) as Obj;
  for (const k of keys) if (Array.isArray(r[k])) return r[k] as Obj[];
  const any = Object.values(r).find((v) => Array.isArray(v) && v.some((x) => x && typeof x === "object"));
  return (any as Obj[] | undefined) ?? [];
}
const field = (o: Obj, ...keys: string[]) => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
};
const nextToken = (r: unknown) => field((r ?? {}) as Obj, "pageToken", "nextPageToken", "nextToken");

/** Stände, nach denen Temu Produkte und SKUs sucht (Pflichtangabe beim Suchen). */
export const TEMU_SEARCH_TYPES = ["ACTIVE", "INACTIVE", "INCOMPLETE", "DRAFT", "DELETED"] as const;
type SearchType = (typeof TEMU_SEARCH_TYPES)[number];

/** Temu-Nummern einer Artikelnummer (SKU im Temu-Angebot = SKU in der Wawi). */
type SkuRef = { goodsId: string; skuId: string; status: SearchType };

const safeId = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Temu-Nummer ${v} ist zu groß für die Übertragung.`);
  return n;
};

const skuItem = (x: Obj, status: SearchType) => ({
  sku: field(x, "outSkuSn", "skuSn", "outSkuSN", "externalSkuId").trim(),
  goodsId: field(x, "goodsId", "productId"),
  skuId: field(x, "skuId", "productSkuId"),
  status,
});

/** SKUs bei Temu über die Artikelnummern suchen (je Stand, bis zu 200 je Anfrage). */
async function findSkus(c: Conn, skus: string[], types: readonly SearchType[] = TEMU_SEARCH_TYPES.filter((t) => t !== "DELETED")): Promise<Map<string, SkuRef>> {
  const out = new Map<string, SkuRef>();
  for (const type of types) {
    const open = skus.filter((s) => !out.has(s));
    for (let i = 0; i < open.length; i += 200) {
      const r = await localCall<unknown>(c, "temu.local.sku.list.retrieve", { skuSearchType: type, outSkuSnList: open.slice(i, i + 200), pageSize: 100 });
      for (const x of listOf(r, "skuList", "skuInfoList", "list").map((y) => skuItem(y, type))) {
        if (x.sku && x.goodsId && x.skuId && open.includes(x.sku) && !out.has(x.sku)) out.set(x.sku, { goodsId: x.goodsId, skuId: x.skuId, status: type });
      }
    }
    if (out.size === skus.length) break;
  }
  return out;
}

/**
 * Menge eines Temu-Angebots setzen (Bestandsabgleich der Wawi). Temu adressiert Artikel über
 * eigene Nummern – die werden einmal über die Artikelnummer (SKU) gesucht und am Angebot gemerkt.
 */
registerStockPusher("temu", async (tenantId, l, quantity) => {
  const c = await conn(tenantId);
  if (!c) throw new ManualStockError("Temu nicht verbunden");
  const p = (l.payload ?? {}) as { goodsId?: string; skuId?: string };
  const ref = p.goodsId && p.skuId ? { goodsId: String(p.goodsId), skuId: String(p.skuId) } : (await findSkus(c, [l.sku], ["ACTIVE", "INACTIVE"])).get(l.sku);
  // Bis die SKU im Temu-Angebot steht: von Hand setzen lassen.
  if (!ref) throw new ManualStockError(`Temu kennt die SKU „${l.sku}“ nicht – im Temu-Angebot genau diese SKU eintragen, dann geht es automatisch`);
  const r = await localCall<{ operateResult?: boolean; msg?: string; skuStockEditStatusInfoList?: { skuId?: number; stockEditStatus?: boolean; errorMsg?: string }[] }>(c, "bg.local.goods.stock.edit", {
    goodsId: safeId(ref.goodsId),
    stockType: 0,
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
    // Schon angelegt (z. B. zweiter Klick, Antwort beim ersten Versuch verloren)? Dann das vorhandene nehmen.
    const found = await findSkus(c, goods.skus.map((s) => s.externalSkuId)).catch(() => new Map<string, SkuRef>());
    const hit = [...found.values()][0];
    if (hit) return { goodsId: hit.goodsId };
    throw e;
  }
}

export type TemuGoodsState = { goodsId: string; status: string; skus: { skuId: string; skuSn: string }[] };

/**
 * Stand von Temu-Produkten (über Temus Produktnummer): Temu sucht nur je Stand, also der Reihe nach
 * aktiv, inaktiv, unvollständig, Entwurf, gelöscht. Dazu die SKU-Nummern für den Bestandsabgleich.
 */
export async function temuGoodsStatus(tenantId: string, goodsIds: string[]): Promise<Map<string, TemuGoodsState>> {
  const c = await conn(tenantId);
  const out = new Map<string, TemuGoodsState>();
  if (!c || !goodsIds.length) return out;
  for (const type of TEMU_SEARCH_TYPES) {
    const open = goodsIds.filter((g) => !out.has(g));
    if (!open.length) break;
    for (let i = 0; i < open.length; i += 100) {
      const ids = open.slice(i, i + 100);
      const r = await localCall<unknown>(c, "temu.local.goods.list.retrieve", { goodsSearchType: type, goodsIdList: ids, pageSize: 100 });
      for (const g of listOf(r, "goodsList", "list", "data")) {
        const id = field(g, "goodsId", "productId");
        if (!id || !ids.includes(id) || out.has(id)) continue;
        const nested = listOf(g.skuInfoList ?? g.skuList ?? [], "skuList").map((x) => skuItem(x, type)).filter((x) => x.skuId);
        out.set(id, { goodsId: id, status: field(g, "goodsStatus", "status") || type, skus: nested.map((x) => ({ skuId: x.skuId, skuSn: x.sku })) });
      }
    }
    // SKU-Nummern dieses Stands nachladen, wo die Produktliste sie nicht mitliefert.
    const noSkus = [...out.values()].filter((g) => !g.skus.length && open.includes(g.goodsId));
    for (let i = 0; i < noSkus.length; i += 100) {
      const ids = noSkus.slice(i, i + 100).map((g) => g.goodsId);
      const r = await localCall<unknown>(c, "temu.local.sku.list.retrieve", { skuSearchType: type, goodsIdList: ids, pageSize: 100 }).catch(() => null);
      for (const x of listOf(r, "skuList", "list").map((y) => skuItem(y, type))) {
        const g = out.get(x.goodsId);
        if (g && x.skuId && !g.skus.some((k) => k.skuId === x.skuId)) g.skus.push({ skuId: x.skuId, skuSn: x.sku });
      }
    }
  }
  return out;
}

/**
 * Wawi-Angebote für Temu mit dem Stand bei Temu abgleichen: aktiv, unvollständig, Entwurf … Aktiv
 * heißt: Temu-Nummern gemerkt, Bestandsabgleich läuft. Ohne `ids` alle noch nicht aktiven.
 */
export async function refreshTemuListings(tenantId: string, ids?: string[]): Promise<number> {
  const L = schema.listings;
  const rows = (
    await db
      .select()
      .from(L)
      .where(and(eq(L.tenantId, tenantId), eq(L.channel, "temu"), sql`(${L.payload} ? 'goodsId' or ${L.payload} ? 'externalGoodsId')`, ...(ids ? [inArray(L.id, ids)] : [sql`${L.status} <> 'active'`])))
  ).filter((l) => l.payload?.goodsId || l.externalId);
  if (!rows.length) return 0;
  const goodsOf = (l: (typeof rows)[number]) => String(l.payload.goodsId ?? l.externalId);
  const states = await temuGoodsStatus(tenantId, [...new Set(rows.map(goodsOf))]);
  const synced: string[] = [];
  for (const l of rows) {
    const st = states.get(goodsOf(l));
    if (!st) {
      await db
        .update(L)
        .set({ status: "draft", lastError: `Temu meldet zu Produkt ${goodsOf(l)} keinen Stand – im Seller Center unter Produkte (auch Entwürfe) nachsehen.`, lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(L.id, l.id));
      continue;
    }
    const state = temuListingState(st.status);
    // Noch nicht aktiv: dazuschreiben, welche Konformitätsangaben Temu noch verlangt.
    const todo = state.status !== "active" ? await complianceOf(tenantId, st.goodsId) : null;
    if (todo?.note) state.lastError = [state.lastError, todo.note].filter(Boolean).join(" ");
    const sku = st.skus.find((x) => x.skuSn === l.sku) ?? (st.skus.length === 1 ? st.skus[0] : undefined);
    await db
      .update(L)
      .set({
        status: state.status,
        externalId: st.goodsId,
        lastError: state.lastError,
        payload: { ...l.payload, goodsId: st.goodsId, temuStatus: st.status.toUpperCase(), ...(sku ? { skuId: sku.skuId } : {}), ...(todo ? { compliance: todo.check, complianceRaw: todo.raw } : {}) },
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

/**
 * Offene Konformitätsangaben eines Temu-Produkts (GPSR-Hersteller, EU-Verantwortliche, Fotos …): `note` als
 * Hinweis am Angebot, `check` als kurzer Stand der Abfrage, `raw` als knappe Rohantwort (Fehlersuche).
 */
type ComplianceCheck = { note: string | null; check: string | null; raw: string };
const COMPLIANCE_LISTS = ["gpsrInfoList", "repInfoList", "actualPhotoList", "certificateInfoList", "extraTemplateInfoList"];
const complianceCache = new Map<string, Promise<ComplianceCheck>>();
function complianceOf(tenantId: string, goodsId: string): Promise<ComplianceCheck> {
  // Je Abgleich nur einmal je Produkt fragen (Varianten teilen sich das Produkt).
  const key = `${tenantId}:${goodsId}`;
  const hit = complianceCache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<ComplianceCheck> => {
    const c = await conn(tenantId);
    if (!c) return { note: null, check: "Temu nicht verbunden", raw: "" };
    const type = "bg.local.compliance.goods.list.query";
    const find = (r: unknown) => listOf(r, "goodsList").find((x) => field(x, "goodsId") === goodsId);
    const r = await localCall<unknown>(c, type, { pageNo: 1, pageSize: 25, searchText: goodsId });
    let g = find(r);
    // Suche nach der Nummer greift nicht immer – dann die Liste der offenen/zu prüfenden Produkte.
    const r2 = g ? null : await localCall<unknown>(c, type, { pageNo: 1, pageSize: 100, statusList: [1, 2, 3, 4, 6, 7] });
    g ??= find(r2);
    if (!g) {
      const shape = (x: unknown) => {
        const o = (x ?? {}) as Obj;
        const first = listOf(o, "goodsList")[0];
        return `${Object.keys(o).join(",")}${first ? ` | Eintrag: ${Object.keys(first).join(",")}` : ""}`;
      };
      // Unvollständige Produkte führt Temu dort (noch) nicht – dann nichts anzeigen, die Angaben stehen im Seller Center.
      return { note: null, check: null, raw: `nicht in der Konformitätsliste · Suche: ${shape(r)} · Liste: ${shape(r2)}`.slice(0, 600) };
    }
    const t = temuComplianceTodos(g as TemuComplianceGoods);
    const raw = JSON.stringify(Object.fromEntries(Object.entries(g).filter(([k]) => COMPLIANCE_LISTS.includes(k) || /status|compliance/i.test(k)))).slice(0, 600);
    const check = t.open.length ? `offen: ${t.open.join(", ")}` : t.review.length ? `in Prüfung: ${t.review.join(", ")}` : "Temu meldet nichts Offenes";
    return { note: temuComplianceNote(t), check, raw };
  })().catch((e): ComplianceCheck => {
    const msg = e instanceof Error ? e.message : String(e);
    return { note: `Konformität bei Temu nicht abrufbar: ${msg}`, check: `Abfrage fehlgeschlagen: ${msg}`, raw: msg.slice(0, 600) };
  });
  complianceCache.set(key, p);
  setTimeout(() => complianceCache.delete(key), 60_000);
  return p;
}

/**
 * Produkte, die schon bei Temu sind (z. B. per Excel-Vorlage oder Shop-Synchronisierung eingestellt),
 * mit der Wawi verknüpfen: steht im Temu-Angebot dieselbe SKU wie bei eBay bzw. im Lager, entsteht ein
 * Temu-Angebot in der Wawi mit demselben Lager – ab dann folgt die Menge auf Temu dem Bestand.
 */
export async function linkTemuBySku(tenantId: string): Promise<{ checked: number; linked: number }> {
  const c = await conn(tenantId);
  if (!c) throw new Error("Temu ist nicht verbunden (Anbindungen → Temu).");
  const L = schema.listings;
  const have = new Set((await db.select({ sku: L.sku }).from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "temu")))).map((r) => r.sku));
  const ebay = await db.select().from(L).where(and(eq(L.tenantId, tenantId), eq(L.channel, "ebay")));
  const stock = await db.select({ sku: schema.ownStock.sku }).from(schema.ownStock).where(eq(schema.ownStock.tenantId, tenantId));
  const source = new Map<string, (typeof ebay)[number] | null>();
  for (const e of ebay) if (!have.has(e.sku)) source.set(e.sku, e);
  for (const s of stock) if (!have.has(s.sku) && !source.has(s.sku)) source.set(s.sku, null);
  const skus = [...source.keys()];
  if (!skus.length) return { checked: 0, linked: 0 };
  const found = await findSkus(c, skus);
  for (const [sku, ref] of found) {
    const e = source.get(sku) ?? null;
    const state = temuListingState(ref.status);
    await db
      .insert(L)
      .values({
        tenantId,
        channel: "temu",
        sku,
        stockSku: e ? e.stockSku?.trim() || null : null,
        title: (e?.title ?? sku).slice(0, 80),
        ean: e?.ean ?? null,
        condition: e?.condition ?? "NEW",
        price: null,
        quantity: 0,
        status: state.status,
        externalId: ref.goodsId,
        payload: { goodsId: ref.goodsId, skuId: ref.skuId, temuStatus: ref.status, linked: true },
        stockSync: true,
        lastError: state.lastError,
      })
      .onConflictDoNothing();
  }
  if (found.size) syncSoon(tenantId);
  return { checked: skus.length, linked: found.size };
}

/** Wie viele Produkte Temu je Stand führt – für den Verbindungstest. */
export async function temuGoodsCounts(c: Conn): Promise<string> {
  const parts: string[] = [];
  for (const type of TEMU_SEARCH_TYPES.filter((t) => t !== "DELETED")) {
    const r = await localCall<unknown>(c, "temu.local.goods.list.retrieve", { goodsSearchType: type, pageSize: 100 });
    const total = Number(field((r ?? {}) as Obj, "total", "totalCount", "totalNum", "totalItemNum"));
    const n = Number.isFinite(total) && total > 0 ? String(total) : `${listOf(r, "goodsList", "list").length}${nextToken(r) ? "+" : ""}`;
    parts.push(`${n} ${TEMU_GOODS_STATUS[type]}`);
  }
  return parts.join(", ");
}

/**
 * Wawi-Angebot (Kanal Temu) bei Temu anlegen – Bilder, Gewicht und Maße aus den Angebotsdaten. Ist es
 * schon bei Temu (Produktnummer gemerkt), nur den Stand abfragen statt doppelt anzulegen.
 */
registerListingPublisher("temu", async (tenantId, l) => {
  const p = l.payload as { goodsId?: string; externalGoodsId?: string; imageUrls?: string[]; weightG?: number; lengthCm?: number; widthCm?: number; heightCm?: number; attributes?: Record<string, string[]> };
  if (p.goodsId || p.externalGoodsId) {
    await refreshTemuListings(tenantId, [l.id]);
    const [now] = await db.select().from(schema.listings).where(eq(schema.listings.id, l.id));
    return { externalId: now?.externalId ?? String(p.goodsId ?? ""), status: now?.status === "active" ? "active" : "draft", lastError: now?.lastError ?? null };
  }
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
  await refreshTemuListings(tenantId, [l.id]).catch(() => 0);
  const [now] = await db.select().from(schema.listings).where(eq(schema.listings.id, l.id));
  return { externalId: goodsId, status: now?.status === "active" ? "active" : "draft", lastError: now?.lastError ?? temuListingState(null).lastError };
});
