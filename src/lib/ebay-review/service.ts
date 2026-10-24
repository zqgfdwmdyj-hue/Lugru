import "server-only";
import { and, asc, eq, inArray, lt, ne, notInArray, or, sql, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { extractJsonObject } from "@/lib/claims/sc-removal";
import { getAttempt, getSettings, getToken, listAttempts, updateAttempt } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import { getAppAccessToken, getUserAccessToken } from "@/lib/ebay/ebay/auth";
import { ACCEPT_LANGUAGE, apiBase, CONTENT_LANGUAGE, MARKETPLACE } from "@/lib/ebay/ebay/config";
import { ebayFetch, EbayHttpError } from "@/lib/ebay/ebay/http";
import { getCategoryAspects } from "@/lib/ebay/ebay/taxonomy";
import type { CategoryAspect } from "@/lib/ebay/pipeline/aspects";
import { tradingBody } from "@/lib/ebay/trading-map";
import type { Settings } from "@/lib/ebay/types";
import { ebayActiveItems } from "@/lib/integrations/clients/ebay";
import { getIntegration } from "@/lib/integrations/store";
import { todayIso } from "@/lib/dates";
import { uploadPictureToEps } from "@/lib/ebay/ebay/pictures";
import { isAsin } from "@/lib/ebay/keepa/keepa";
import { keepaByCode, keepaKey, keepaProducts } from "@/lib/integrations/clients/keepa";
import { xmlAt, xmlText } from "@/lib/xml";
import { amazonContentFrom, cleanImages, isEbayHosted, sanitizeDescription, type AmazonContent } from "./content";
import {
  aiPrompt,
  competitorsFrom,
  factsFromItem,
  fitTitle,
  marketFrom,
  mergeAspects,
  parseAiSuggestion,
  reviewListing,
  reviseXml,
  revisionSummary,
  titleQuery,
  TRAFFIC_METRICS,
  trafficFrom,
  withTraffic,
  type AiSuggestion,
  type CategoryHint,
  type Issue,
  type ListingFacts,
  type Market,
  type Revision,
  type Traffic,
} from "./logic";

// „Angebote prüfen“: laufende eBay-Angebote laden, im Hintergrund nacheinander prüfen (GetItem,
// Merkmale der Kategorie, Preisvergleich über die Browse-Suche, Kategorie-Vorschlag, Verkehrsdaten),
// auf Wunsch einen KI-Vorschlag holen und Änderungen zurück zu eBay schicken.

const C = schema.ebayListingChecks;
const PAUSE_MS = Number(process.env.EBAY_REVIEW_PAUSE_MS ?? 400);
const TRADING_VERSION = "1415";
const TRAFFIC_DAYS = 30;

type Conn = { edb: ReturnType<typeof ebayDb>; settings: Settings; base: string };

async function conn(tenantId: string): Promise<Conn | null> {
  const edb = ebayDb(tenantId);
  const settings = await getSettings(edb);
  if (!settings.clientId || !settings.clientSecret) return null;
  if (!(await getToken(edb, settings.env, "user"))?.refreshToken) return null;
  return { edb, settings, base: apiBase(settings.env) };
}

async function mustConn(tenantId: string): Promise<Conn> {
  const c = await conn(tenantId);
  if (!c) throw new Error("eBay ist nicht verbunden (eBay → eBay-Einstellungen → Verbindung).");
  return c;
}

async function trading(c: Conn, call: string, inner: string) {
  const res = await fetch(`${c.base}/ws/api.dll`, {
    method: "POST",
    headers: {
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_VERSION,
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": "77",
      "X-EBAY-API-IAF-TOKEN": await getUserAccessToken(c.edb, c.settings),
      "Content-Type": "text/xml; charset=utf-8",
    },
    body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${inner}</${call}Request>`,
  });
  const text = await res.text();
  if (!res.ok && !text.includes(`${call}Response`)) throw new Error(`eBay ${call} → HTTP ${res.status}`);
  return tradingBody(text, call);
}

async function appHeaders(c: Conn): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getAppAccessToken(c.edb, c.settings)}`,
    "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
    "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DDE",
    Accept: "application/json",
    "Accept-Language": ACCEPT_LANGUAGE,
  };
}

async function userHeaders(c: Conn): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getUserAccessToken(c.edb, c.settings)}`,
    "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
    "Content-Type": "application/json",
    "Content-Language": CONTENT_LANGUAGE,
    "Accept-Language": ACCEPT_LANGUAGE,
    Accept: "application/json",
  };
}

// ---- Angebote laden ----------------------------------------------------------------------------

const lastRefresh = new Map<string, number>();

/** Laufende Angebote von eBay holen: neue anlegen (zum Prüfen vormerken), beendete markieren. */
export async function refreshListings(tenantId: string): Promise<{ total: number; added: number; ended: number }> {
  const c = await mustConn(tenantId);
  const items = await ebayActiveItems(tenantId);
  lastRefresh.set(tenantId, Date.now());
  const tool = new Map((await listAttempts(c.edb)).filter((a) => a.status === "published" && a.listingId).map((a) => [a.listingId!, a.id]));
  const existing = new Map((await db.select({ itemId: C.itemId, status: C.status }).from(C).where(eq(C.tenantId, tenantId))).map((r) => [r.itemId, r.status]));
  let added = 0;
  for (const i of items) {
    const attemptId = tool.get(i.itemId) ?? null;
    const base = { title: i.title, image: i.image, url: i.url, sku: i.sku, price: i.price, quantity: i.quantity, variations: i.variations, source: (attemptId ? "tool" : "ebay") as "tool" | "ebay", attemptId, updatedAt: new Date() };
    if (!existing.has(i.itemId)) {
      await db.insert(C).values({ tenantId, itemId: i.itemId, ...base, status: "wartet" }).onConflictDoNothing();
      added++;
    } else {
      await db
        .update(C)
        .set({ ...base, ...(existing.get(i.itemId) === "beendet" ? { status: "wartet" as const } : {}) })
        .where(and(eq(C.tenantId, tenantId), eq(C.itemId, i.itemId)));
    }
  }
  const active = items.map((i) => i.itemId);
  const endedRows = await db
    .update(C)
    .set({ status: "beendet", updatedAt: new Date() })
    .where(and(eq(C.tenantId, tenantId), ne(C.status, "beendet"), active.length ? notInArray(C.itemId, active) : sql`true`))
    .returning({ id: C.id });
  return { total: items.length, added, ended: endedRows.length };
}

/** Alle (oder nur die seit `days` Tagen nicht geprüften) Angebote zum Prüfen vormerken. */
export async function queueChecks(tenantId: string, opts: { staleDays?: number; itemIds?: string[] } = {}): Promise<number> {
  const conds = [eq(C.tenantId, tenantId), inArray(C.status, ["fertig", "fehler", "wartet"])];
  if (opts.itemIds) conds.push(opts.itemIds.length ? inArray(C.itemId, opts.itemIds) : sql`false`);
  if (opts.staleDays !== undefined) conds.push(or(isNull(C.checkedAt), lt(C.checkedAt, new Date(Date.now() - opts.staleDays * 86_400_000)))!);
  const rows = await db.update(C).set({ status: "wartet", updatedAt: new Date() }).where(and(...conds)).returning({ id: C.id });
  return rows.length;
}

// ---- Prüfen ------------------------------------------------------------------------------------

const running = new Set<string>();

export function isReviewRunning(tenantId: string) {
  return running.has(tenantId);
}

/** Im Hintergrund starten (Seite wartet nicht). */
export function startChecks(tenantId: string) {
  void runChecks(tenantId).catch((e) => console.error("[Angebote prüfen]", e instanceof Error ? e.message : e));
}

/** Warteschlange abarbeiten; höchstens `max` Angebote je Lauf. */
export async function runChecks(tenantId: string, max = 200): Promise<number> {
  if (running.has(tenantId)) return 0;
  running.add(tenantId);
  let done = 0;
  try {
    const c = await conn(tenantId);
    if (!c) return 0;
    await db
      .update(C)
      .set({ status: "wartet" })
      .where(and(eq(C.tenantId, tenantId), eq(C.status, "läuft"), lt(C.updatedAt, new Date(Date.now() - 15 * 60 * 1000))));
    const batch = await db
      .select()
      .from(C)
      .where(and(eq(C.tenantId, tenantId), eq(C.status, "wartet")))
      .orderBy(sql`${C.checkedAt} asc nulls first`, asc(C.createdAt))
      .limit(max);
    if (!batch.length) return 0;
    const traffic = await trafficFor(c, batch.map((r) => r.itemId));
    for (const row of batch) {
      await db.update(C).set({ status: "läuft", updatedAt: new Date() }).where(eq(C.id, row.id));
      try {
        await checkOne(c, tenantId, row.itemId, traffic);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Angebot inzwischen beendet oder gelöscht → nicht als Fehler stehen lassen.
        const ended = /beendet|ended|nicht gefunden|not found|invalid item/i.test(msg);
        await db.update(C).set({ status: ended ? "beendet" : "fehler", message: msg.slice(0, 500), updatedAt: new Date() }).where(eq(C.id, row.id));
      }
      done++;
      if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  } finally {
    running.delete(tenantId);
  }
  return done;
}

type TrafficResult = { map: Map<string, Traffic>; error: string | null };

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

/** Verkehrsdaten der letzten 30 Tage für bis zu einige hundert Angebote (je 50 in einer Abfrage). */
async function trafficFor(c: Conn, itemIds: string[]): Promise<TrafficResult> {
  const map = new Map<string, Traffic>();
  const to = new Date(Date.now() - 86_400_000);
  const from = new Date(to.getTime() - (TRAFFIC_DAYS - 1) * 86_400_000);
  try {
    for (let i = 0; i < itemIds.length; i += 50) {
      const ids = itemIds.slice(i, i + 50);
      const filter = `marketplace_ids:{${MARKETPLACE}},date_range:[${ymd(from)}..${ymd(to)}],listing_ids:{${ids.join("|")}}`;
      const json = await ebayFetch(`${c.base}/sell/analytics/v1/traffic_report?dimension=LISTING&filter=${encodeURIComponent(filter)}&metric=${TRAFFIC_METRICS.join(",")}`, { headers: await userHeaders(c) });
      for (const [k, v] of trafficFrom(json, TRAFFIC_DAYS)) map.set(k, v);
    }
    return { map, error: null };
  } catch (e) {
    const denied = e instanceof EbayHttpError && (e.status === 401 || e.status === 403);
    const at = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
    const detail = e instanceof Error ? e.message.slice(0, 160) : String(e);
    return {
      map,
      error: denied
        ? `eBay verweigert die Verkehrsdaten (Stand ${at}: ${detail}). Unter eBay → eBay-Einstellungen → Verbindung mit Häkchen „Verkehrsdaten“ neu verbinden – danach werden sie automatisch geladen. Bleibt diese Meldung trotz Neuverbinden, ist die Berechtigung „Analytics“ für den eBay-Entwicklerzugang nicht freigegeben.`
        : `Verkehrsdaten nicht abrufbar (Stand ${at}): ${detail}`,
    };
  }
}

async function aspectDefsFor(c: Conn, categoryId: string | null): Promise<CategoryAspect[] | null> {
  if (!categoryId) return null;
  try {
    return await getCategoryAspects(c.edb, c.settings, categoryId);
  } catch {
    return null;
  }
}

async function marketFor(c: Conn, f: ListingFacts): Promise<Market | null> {
  const filters = ["buyingOptions:{FIXED_PRICE}", "deliveryCountry:DE", ...(f.conditionId === "1000" ? ["conditionIds:{1000}"] : [])].join(",");
  const search = async (param: string) => ebayFetch(`${c.base}/buy/browse/v1/item_summary/search?${param}&limit=50&filter=${encodeURIComponent(filters)}`, { headers: await appHeaders(c) });
  const own = { price: f.price, shipping: f.shippingCost };
  try {
    if (f.ean) {
      const items = competitorsFrom(await search(`gtin=${encodeURIComponent(f.ean)}`), { itemId: f.itemId, seller: f.sellerUser });
      if (items.length) return marketFrom("ean", own, items);
    }
    const q = titleQuery(f.title);
    if (!q) return null;
    const items = competitorsFrom(await search(`q=${encodeURIComponent(q)}${f.categoryId ? `&category_ids=${encodeURIComponent(f.categoryId)}` : ""}`), { itemId: f.itemId, seller: f.sellerUser });
    return items.length ? marketFrom("titel", own, items) : null;
  } catch {
    return null;
  }
}

async function categoriesFor(c: Conn, title: string): Promise<CategoryHint[] | null> {
  const q = titleQuery(title);
  if (!q) return null;
  try {
    const json = (await ebayFetch(`${c.base}/commerce/taxonomy/v1/category_tree/77/get_category_suggestions?q=${encodeURIComponent(q)}`, { headers: await appHeaders(c) })) as {
      categorySuggestions?: { category?: { categoryId?: string; categoryName?: string } }[];
    } | null;
    return (json?.categorySuggestions ?? []).map((s) => ({ categoryId: s.category?.categoryId ?? "", categoryName: s.category?.categoryName ?? "" })).filter((s) => s.categoryId);
  } catch {
    return null;
  }
}

async function getFacts(c: Conn, itemId: string): Promise<ListingFacts> {
  const body = await trading(c, "GetItem", `<ItemID>${itemId.replace(/\D/g, "")}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeWatchCount>true</IncludeWatchCount>`);
  return factsFromItem(body);
}

async function checkOne(c: Conn, tenantId: string, itemId: string, traffic: TrafficResult) {
  const f = await getFacts(c, itemId);
  const [defs, market, categories] = await Promise.all([aspectDefsFor(c, f.categoryId), marketFor(c, f), categoriesFor(c, f.title)]);
  const t = traffic.map.get(itemId) ?? null;
  const { score, issues } = reviewListing(f, { defs, market, traffic: t, categories, today: todayIso() });
  await db
    .update(C)
    .set({
      status: "fertig",
      score,
      issues,
      facts: f as unknown as Record<string, unknown>,
      market: market as unknown as Record<string, unknown> | null,
      traffic: (t ? t : traffic.error ? { unavailable: traffic.error } : null) as Record<string, unknown> | null,
      title: f.title,
      image: f.images[0] ?? null,
      url: f.url,
      price: f.price,
      quantity: f.quantity,
      variations: f.variations,
      message: null,
      checkedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(C.tenantId, tenantId), eq(C.itemId, itemId)));
}

/** Ein einzelnes Angebot sofort prüfen (nach dem Ändern oder per Knopf). */
export async function checkNow(tenantId: string, itemId: string) {
  const c = await mustConn(tenantId);
  const traffic = await trafficFor(c, [itemId]);
  await checkOne(c, tenantId, itemId, traffic);
}

/**
 * Nur die Verkehrsdaten neu holen – z. B. direkt nach dem Neuverbinden mit „Verkehrsdaten“. Ersetzt bei allen
 * geprüften Angeboten Einblendungen/Klicks und die daraus abgeleiteten Hinweise, ohne jedes Angebot neu zu prüfen.
 */
export async function refreshTraffic(tenantId: string): Promise<{ updated: number; withData: number; error: string | null }> {
  const c = await conn(tenantId);
  if (!c) return { updated: 0, withData: 0, error: "eBay ist nicht verbunden." };
  const rows = await db
    .select({ id: C.id, itemId: C.itemId, issues: C.issues, facts: C.facts })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), eq(C.status, "fertig")));
  if (!rows.length) return { updated: 0, withData: 0, error: null };
  const traffic = await trafficFor(c, rows.map((r) => r.itemId));
  const today = todayIso();
  let withData = 0;
  for (const r of rows) {
    const t = traffic.map.get(r.itemId) ?? null;
    if (t) withData++;
    const set: Partial<typeof C.$inferInsert> = { traffic: (t ? t : traffic.error ? { unavailable: traffic.error } : null) as Record<string, unknown> | null, updatedAt: new Date() };
    const facts = r.facts as ListingFacts | null;
    if (facts && !traffic.error) Object.assign(set, withTraffic((r.issues ?? []) as Issue[], facts, t, today));
    await db.update(C).set(set).where(and(eq(C.id, r.id), eq(C.tenantId, tenantId)));
  }
  return { updated: rows.length, withData, error: traffic.error };
}

/** Nach dem Neuverbinden im Hintergrund die Verkehrsdaten nachladen (die Seite wartet nicht). */
export function refreshTrafficSoon(tenantId: string) {
  void refreshTraffic(tenantId).catch((e) => console.error("[Verkehrsdaten]", e instanceof Error ? e.message : e));
}

/** Für den Hintergrund-Abruf: einmal am Tag neu laden, Ungeprüfte und Ältere (7 Tage) prüfen. */
export async function reviewDue(tenantId: string) {
  if (!(await conn(tenantId))) return 0;
  if (Date.now() - (lastRefresh.get(tenantId) ?? 0) > 24 * 3600_000) await refreshListings(tenantId);
  await queueChecks(tenantId, { staleDays: 7 });
  return runChecks(tenantId, 80);
}

// ---- Lesen -------------------------------------------------------------------------------------

export type CheckRow = {
  itemId: string;
  source: "tool" | "ebay";
  title: string;
  image: string | null;
  url: string | null;
  sku: string | null;
  price: number | null;
  quantity: number | null;
  variations: number;
  status: string;
  score: number | null;
  issues: Issue[];
  message: string | null;
  checkedAt: Date | null;
  sold: number | null;
  watchers: number | null;
  impressions: number | null;
  hasAi: boolean;
  appliedAt: string | null;
};

export async function reviewOverview(tenantId: string) {
  const rows = await db
    .select({
      itemId: C.itemId,
      source: C.source,
      title: C.title,
      image: C.image,
      url: C.url,
      sku: C.sku,
      price: C.price,
      quantity: C.quantity,
      variations: C.variations,
      status: C.status,
      score: C.score,
      issues: C.issues,
      message: C.message,
      checkedAt: C.checkedAt,
      sold: sql<number | null>`(${C.facts}->>'sold')::numeric`,
      watchers: sql<number | null>`(${C.facts}->>'watchers')::numeric`,
      impressions: sql<number | null>`(${C.traffic}->>'impressions')::numeric`,
      trafficNote: sql<string | null>`${C.traffic}->>'unavailable'`,
      hasAi: sql<boolean>`${C.ai} is not null`,
      appliedAt: sql<string | null>`${C.applied}->>'at'`,
    })
    .from(C)
    .where(eq(C.tenantId, tenantId));
  const list: CheckRow[] = rows.map((r) => ({ ...r, issues: (r.issues ?? []) as Issue[], sold: r.sold === null ? null : Number(r.sold), watchers: r.watchers === null ? null : Number(r.watchers), impressions: r.impressions === null ? null : Number(r.impressions) }));
  const active = list.filter((r) => r.status !== "beendet");
  const checked = active.filter((r) => r.score !== null);
  const counts = new Map<string, number>();
  for (const r of checked) for (const i of r.issues) counts.set(i.key, (counts.get(i.key) ?? 0) + 1);
  return {
    rows: active,
    ended: list.length - active.length,
    waiting: active.filter((r) => r.status === "wartet" || r.status === "läuft").length,
    failed: active.filter((r) => r.status === "fehler").length,
    avgScore: checked.length ? Math.round(checked.reduce((s, r) => s + (r.score ?? 0), 0) / checked.length) : null,
    top: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    trafficNote: rows.find((r) => r.trafficNote)?.trafficNote ?? null,
    connected: Boolean(await conn(tenantId)),
    running: running.has(tenantId),
  };
}

export type CheckDetail = Omit<typeof C.$inferSelect, "facts" | "market" | "traffic" | "ai" | "issues"> & { facts: ListingFacts | null; market: Market | null; traffic: (Traffic & { unavailable?: string }) | { unavailable: string } | null; ai: (AiSuggestion & { at: string; model: string }) | null; issues: Issue[] };

export async function reviewDetail(tenantId: string, itemId: string): Promise<{ row: CheckDetail; defs: CategoryAspect[] | null } | null> {
  const [row] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.itemId, itemId)));
  if (!row) return null;
  const r = row as unknown as CheckDetail;
  const c = await conn(tenantId);
  const defs = c && r.facts?.categoryId ? await aspectDefsFor(c, r.facts.categoryId) : null;
  return { row: r, defs };
}

// ---- KI-Vorschlag ------------------------------------------------------------------------------

export async function suggestWithAi(tenantId: string, itemId: string): Promise<AiSuggestion> {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für KI-Vorschläge unter Anbindungen → KI (Claude) einen Schlüssel eintragen.");
  const d = await reviewDetail(tenantId, itemId);
  if (!d?.row.facts) throw new Error("Bitte das Angebot zuerst prüfen lassen.");
  const f = d.row.facts;
  const defs = d.defs ?? [];
  const titles = (d.row.market?.items ?? []).map((i) => i.title).filter(Boolean);
  const model = modelFor(ai, "creative");
  const r = await askClaude(ai.apiKey, aiPrompt(f, defs, titles), { model, task: "creative", maxTokens: 1500 });
  const s = parseAiSuggestion(extractJsonObject(r.text), defs, f.aspects);
  if (!s) throw new Error("Die KI hat keinen brauchbaren Vorschlag geliefert – bitte noch einmal versuchen.");
  await db
    .update(C)
    .set({ ai: { ...s, at: new Date().toISOString(), model }, updatedAt: new Date() })
    .where(and(eq(C.tenantId, tenantId), eq(C.itemId, itemId)));
  return s;
}

/** KI-Vorschläge nacheinander für die schwächsten Angebote ohne Vorschlag (im Hintergrund). */
export async function suggestForWeakest(tenantId: string, limit = 10): Promise<number> {
  const rows = await db
    .select({ itemId: C.itemId })
    .from(C)
    .where(and(eq(C.tenantId, tenantId), eq(C.status, "fertig"), isNull(C.ai), lt(C.score, 90)))
    .orderBy(asc(C.score))
    .limit(limit);
  let n = 0;
  for (const r of rows) {
    try {
      await suggestWithAi(tenantId, r.itemId);
      n++;
    } catch (e) {
      // Ohne Schlüssel oder bei KI-Störung abbrechen – die übrigen würden genauso scheitern.
      if (/Schlüssel|KI-Aufruf fehlgeschlagen/.test(e instanceof Error ? e.message : "")) break;
    }
  }
  return n;
}

// ---- Ändern bei eBay ---------------------------------------------------------------------------

/**
 * Titel, Merkmale, Preis, Preisvorschlag, Bilder und Beschreibung bei eBay ändern. Danach wird das Angebot
 * neu geprüft. `replaceAspects`: die Merkmalsliste ersetzt die vorhandene (sonst werden Merkmale ergänzt).
 */
export async function applyRevision(tenantId: string, itemId: string, r: Revision, opts: { replaceAspects?: boolean } = {}): Promise<string[]> {
  const c = await mustConn(tenantId);
  const d = await reviewDetail(tenantId, itemId);
  if (!d?.row.facts) throw new Error("Bitte das Angebot zuerst prüfen lassen.");
  // Frisch von eBay: Merkmale werden als volle Liste geschickt, also vom aktuellen Stand ausgehen.
  const f = await getFacts(c, itemId);
  const wantAspects = r.aspects && Object.keys(r.aspects).length ? r.aspects : null;
  const aspects = wantAspects ? (opts.replaceAspects ? wantAspects : mergeAspects(f.aspects, wantAspects)) : null;
  const aspectsChanged = aspects && JSON.stringify(aspects) !== JSON.stringify(f.aspects);
  let images: string[] | undefined;
  if (r.images) {
    const { images: clean, dropped } = cleanImages(r.images);
    if (dropped.length) throw new Error(`Diese Bilder gehen nicht (nur https, höchstens 24): ${dropped.slice(0, 3).join(", ")}`);
    if (!clean.length) throw new Error("Mindestens ein Bild muss bleiben.");
    if (JSON.stringify(clean) !== JSON.stringify(f.images)) images = clean;
  }
  const description = r.description !== undefined ? sanitizeDescription(r.description) : undefined;
  const rev: Revision = {
    ...(r.title && fitTitle(r.title) !== f.title ? { title: fitTitle(r.title) } : {}),
    ...(aspectsChanged ? { aspects: aspects! } : {}),
    ...(r.price !== undefined && Math.abs(r.price - f.price) >= 0.005 ? { price: r.price } : {}),
    ...(r.bestOffer !== undefined && r.bestOffer !== f.bestOffer ? { bestOffer: r.bestOffer } : {}),
    ...(images ? { images } : {}),
    ...(description !== undefined && description !== (f.descriptionHtml ?? "").trim() ? { description } : {}),
  };
  if (rev.price !== undefined && f.variations > 0) throw new Error("Bei Angeboten mit Varianten den Preis bitte je Variante im eBay-Tool bzw. bei eBay ändern.");
  if (rev.bestOffer && f.variations > 0) throw new Error("Preisvorschlag gibt es bei eBay nicht für Angebote mit Varianten.");
  const summary = revisionSummary(f, { ...rev, aspects: aspectsChanged ? (opts.replaceAspects ? rev.aspects : wantAspects ?? undefined) : undefined });
  if (opts.replaceAspects && aspectsChanged) summary.splice(summary.findIndex((x) => x.startsWith("Merkmale")), 1, `Merkmale: ${Object.keys(rev.aspects!).length} (Liste ersetzt)`);
  if (!summary.length) throw new Error("Nichts zu ändern – die Werte sind schon so bei eBay.");

  // Bilder von außerhalb (Keepa/Amazon, eigene Links) erst zu eBay kopieren – eBay zeigt nur eigene Bilder zuverlässig.
  if (rev.images) rev.images = await Promise.all(rev.images.map((u) => (isEbayHosted(u) ? u : externalToEps(c, u))));

  if (d.row.source === "tool" && d.row.attemptId) await reviseViaInventory(c, d.row.attemptId, rev, opts.replaceAspects ? rev.aspects ?? null : wantAspects ?? {}, Boolean(opts.replaceAspects));
  else await trading(c, "ReviseFixedPriceItem", reviseXml(itemId, rev));

  await db
    .update(C)
    .set({ applied: { at: new Date().toISOString(), changes: summary }, updatedAt: new Date() })
    .where(and(eq(C.tenantId, tenantId), eq(C.itemId, itemId)));
  try {
    await checkNow(tenantId, itemId);
  } catch {
    // Prüfung läuft beim nächsten Durchgang – die Änderung ist trotzdem bei eBay.
  }
  return summary;
}

/** Bild von einer Adresse (Amazon, eigener Server …) zu eBay (EPS) kopieren – eBay lädt es selbst herunter. */
async function externalToEps(c: Conn, url: string): Promise<string> {
  let body;
  try {
    body = await trading(c, "UploadSiteHostedPictures", `<ExternalPictureURL>${url.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</ExternalPictureURL><PictureSet>Standard</PictureSet><ExtensionInDays>30</ExtensionInDays>`);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/^eBay \(UploadSiteHostedPictures\):\s*/, "");
    throw new Error(`eBay konnte das Bild nicht übernehmen (${url}): ${msg} Nichts wurde geändert – Bild entfernen oder andere Adresse nehmen.`);
  }
  const full = xmlText(xmlAt(body, "SiteHostedPictureDetails", "FullURL"));
  if (!full) throw new Error(`eBay hat das Bild nicht übernommen: ${url}`);
  return full;
}

/** Eigene Bilddatei zu eBay hochladen (für „Bild hinzufügen“). */
export async function uploadImageFile(tenantId: string, name: string, data: Buffer): Promise<string> {
  const c = await mustConn(tenantId);
  if (data.length > 12 * 1024 * 1024) throw new Error("Bilder dürfen höchstens 12 MB groß sein.");
  return uploadPictureToEps(c.edb, c.settings, name || "bild.jpg", data);
}

/** Produktdaten von Amazon (über Keepa): per eingegebener ASIN/EAN oder der EAN des Angebots. */
export async function amazonContentFor(tenantId: string, itemId: string, code?: string): Promise<AmazonContent & { tokensLeft: number | null }> {
  const key = await keepaKey(tenantId);
  if (!key) throw new Error("Für Amazon-Daten fehlt der Keepa-Schlüssel (Anbindungen → Keepa oder eBay-Tool → Bildquellen).");
  const d = await reviewDetail(tenantId, itemId);
  const raw = (code?.trim() || d?.row.facts?.ean || "").replace(/[\s-]/g, "").toUpperCase();
  if (!raw) throw new Error("Das Angebot hat keine EAN – bitte ASIN oder EAN eingeben.");
  if (!isAsin(raw) && !/^\d{8,14}$/.test(raw)) throw new Error("Das ist weder eine ASIN noch eine EAN (8–14 Ziffern).");
  const r = isAsin(raw) ? await keepaProducts(key, [raw]) : await keepaByCode(key, [raw]);
  const products = r.products.map(amazonContentFrom);
  const best = products.find((p) => p.images.length) ?? products[0];
  if (!best) throw new Error(`Bei Amazon (über Keepa) nichts zu ${raw} gefunden.`);
  return { ...best, tokensLeft: r.tokensLeft };
}

const OFFER_READONLY = ["offerId", "status", "listing", "warnings"];

/** Übers eBay-Tool eingestellte Angebote: Inventory API (aktuellen Stand holen, ändern, zurückschreiben). */
async function reviseViaInventory(c: Conn, attemptId: number, rev: Revision, added: Record<string, string[]> | null, replace = false) {
  const a = await getAttempt(c.edb, attemptId);
  if (!a?.sku) throw new Error("Angebot im eBay-Tool nicht gefunden.");
  const inv = `${c.base}/sell/inventory/v1`;
  const h = await userHeaders(c);
  const isGroup = Boolean(a.variants?.items?.length);
  const aspectsOf = (cur: Record<string, string[]>) => (replace && added ? added : mergeAspects(cur, added ?? {}));
  const touchesItem = rev.title || Object.keys(added ?? {}).length || rev.images || rev.description !== undefined;
  if (touchesItem) {
    if (isGroup) {
      const g = (await ebayFetch(`${inv}/inventory_item_group/${encodeURIComponent(a.sku)}`, { headers: h })) as Record<string, unknown> & { aspects?: Record<string, string[]>; title?: string };
      const body = { ...g, ...(rev.title ? { title: rev.title } : {}), aspects: aspectsOf(g.aspects ?? {}), ...(rev.images ? { imageUrls: rev.images } : {}), ...(rev.description !== undefined ? { description: rev.description } : {}) };
      delete (body as Record<string, unknown>).inventoryItemGroupKey;
      await ebayFetch(`${inv}/inventory_item_group/${encodeURIComponent(a.sku)}`, { method: "PUT", headers: h, body: JSON.stringify(body) });
    } else {
      const it = (await ebayFetch(`${inv}/inventory_item/${encodeURIComponent(a.sku)}`, { headers: h })) as { availability?: unknown; condition?: string; conditionDescription?: string; conditionDescriptors?: unknown; packageWeightAndSize?: unknown; product?: Record<string, unknown> & { aspects?: Record<string, string[]> } };
      const product = { ...(it.product ?? {}), ...(rev.title ? { title: rev.title } : {}), aspects: aspectsOf(it.product?.aspects ?? {}), ...(rev.images ? { imageUrls: rev.images } : {}), ...(rev.description !== undefined ? { description: rev.description } : {}) };
      const body = { availability: it.availability, condition: it.condition, conditionDescription: it.conditionDescription, conditionDescriptors: it.conditionDescriptors, packageWeightAndSize: it.packageWeightAndSize, product };
      await ebayFetch(`${inv}/inventory_item/${encodeURIComponent(a.sku)}`, { method: "PUT", headers: h, body: JSON.stringify(body) });
    }
  }
  if (rev.price !== undefined || rev.bestOffer !== undefined || (rev.description !== undefined && !isGroup)) {
    if (!a.offerId) throw new Error("Zum Angebot fehlt die eBay-Angebotsnummer (Offer) – Preis/Beschreibung bitte im eBay-Tool ändern.");
    const o = (await ebayFetch(`${inv}/offer/${encodeURIComponent(a.offerId)}`, { headers: h })) as Record<string, unknown> & { pricingSummary?: Record<string, unknown>; listingPolicies?: Record<string, unknown> & { bestOfferTerms?: Record<string, unknown> } };
    const body: Record<string, unknown> = { ...o };
    for (const k of OFFER_READONLY) delete body[k];
    if (rev.price !== undefined) body.pricingSummary = { ...(o.pricingSummary ?? {}), price: { value: rev.price.toFixed(2), currency: "EUR" } };
    if (rev.bestOffer !== undefined) body.listingPolicies = { ...(o.listingPolicies ?? {}), bestOfferTerms: { ...(o.listingPolicies?.bestOfferTerms ?? {}), bestOfferEnabled: rev.bestOffer } };
    if (rev.description !== undefined) body.listingDescription = rev.description;
    await ebayFetch(`${inv}/offer/${encodeURIComponent(a.offerId)}`, { method: "PUT", headers: h, body: JSON.stringify(body) });
  }
  // Das eBay-Tool zeigt danach dieselben Werte.
  await updateAttempt(c.edb, attemptId, {
    ...(rev.title ? { title: rev.title } : {}),
    ...(Object.keys(added ?? {}).length ? { aspects: replace && added ? added : mergeAspects(a.aspects ?? {}, added ?? {}) } : {}),
    ...(rev.images ? { imageUrls: rev.images } : {}),
    ...(rev.description !== undefined ? { description: rev.description } : {}),
    ...(rev.price !== undefined && !isGroup ? { price: rev.price } : {}),
  });
}
