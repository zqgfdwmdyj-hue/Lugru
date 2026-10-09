"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { FeedMapping } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { parseAmount } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";
import { checkFeedWithKeepa, saveScanned, scan } from "@/lib/suppliers/scan-service";
import { importTable, pullFeed, refreshMarket } from "@/lib/suppliers/feed-service";
import { encryptSecret } from "@/lib/crypto";
import { suggestBoxes } from "@/lib/suppliers/boxes-service";
import { canAccess } from "@/lib/auth/areas";
import { assertBrand } from "@/lib/brands/access";

const uuid = z.string().uuid();

export async function createFeed(fd: FormData) {
  const session = await requireArea("lieferanten");
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  const supplierId = uuid.safeParse(fd.get("supplierId")).success ? String(fd.get("supplierId")) : null;
  const [f] = await db.insert(schema.supplierFeeds).values({ tenantId: session.tenantId, name, supplierId }).returning({ id: schema.supplierFeeds.id });
  redirect(`/lieferanten/${f.id}`);
}

export type FeedState = { ok: boolean; message: string; headers?: string[] } | null;

export async function uploadFeed(_prev: FeedState, fd: FormData): Promise<FeedState> {
  const session = await requireArea("lieferanten");
  const feedId = uuid.parse(fd.get("feedId"));
  const [feed] = await db.select().from(schema.supplierFeeds).where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, session.tenantId)));
  if (!feed) return { ok: false, message: "Feed nicht gefunden." };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Bitte Datei wählen." };
  const table = readTable(new Uint8Array(await file.arrayBuffer()));
  // Von Hand gewählte Spalten gehen vor; sonst erkennt das System sie selbst.
  const manual: FeedMapping = {};
  for (const k of ["ean", "asin", "supplierSku", "title", "price", "stock", "moq"] as const) {
    const v = String(fd.get(`map_${k}`) ?? "");
    if (v) manual[k] = v;
  }
  const r = await importTable(session.tenantId, feed, table, { mapping: manual, full: fd.get("full") === "on" });
  revalidatePath(`/lieferanten/${feedId}`);
  if (!r.ok) return { ok: false, message: r.message, headers: r.headers };
  if (fd.get("keepa") === "on") void refreshMarket(session.tenantId).catch(() => undefined);
  return { ok: true, message: r.message };
}

export type ScanState = { ok: boolean; message: string } | null;

async function ownFeed(tenantId: string, raw: FormDataEntryValue | null) {
  const feedId = uuid.parse(raw);
  const [feed] = await db.select({ id: schema.supplierFeeds.id }).from(schema.supplierFeeds).where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, tenantId)));
  if (!feed) throw new Error("Feed nicht gefunden.");
  return feedId;
}

/** Seite, Link, Text, Foto oder PDF scannen und als Angebote übernehmen. */
export async function scanFeedAction(_prev: ScanState, fd: FormData): Promise<ScanState> {
  const session = await requireArea("lieferanten");
  try {
    const feedId = await ownFeed(session.tenantId, fd.get("feedId"));
    const file = fd.get("file");
    const f = file instanceof File && file.size ? { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined;
    const usd = parseAmount(fd.get("usdRate"));
    const res = await scan(session.tenantId, { file: f, url: String(fd.get("url") ?? ""), text: String(fd.get("text") ?? "") });
    const saved = await saveScanned(session.tenantId, feedId, res.items, usd ? { USD: usd } : undefined);
    revalidatePath(`/lieferanten/${feedId}`);
    const warn = saved.missingRates.length ? ` Für ${saved.missingRates.join(", ")} fehlt ein Kurs – EK dort leer.` : "";
    return { ok: true, message: `${saved.saved} Artikel übernommen (${res.method}), ${saved.withEan} mit EAN/UPC.${warn}${saved.withEan ? " Jetzt „Mit Keepa prüfen“ für Amazon-Preise." : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function keepaFeedAction(_prev: ScanState, fd: FormData): Promise<ScanState> {
  const session = await requireArea("lieferanten");
  try {
    const feedId = await ownFeed(session.tenantId, fd.get("feedId"));
    const r = await checkFeedWithKeepa(session.tenantId, feedId, { byTitle: fd.get("byTitle") === "on" });
    revalidatePath(`/lieferanten/${feedId}`);
    if (!r.checked) return { ok: true, message: "Nichts zu prüfen – alles wurde in den letzten 7 Tagen geprüft (oder es gibt keine EANs – dann „auch ohne EAN“ anhaken)." };
    return { ok: true, message: `${r.checked} geprüft, ${r.found} auf amazon.de gefunden${r.byTitle ? ` (${r.byTitle} per Titel – bitte kurz gegenprüfen)` : ""}.${r.tokensLeft !== null ? ` Keepa-Tokens übrig: ${r.tokensLeft}.` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function feedCostAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const feedId = await ownFeed(session.tenantId, fd.get("feedId"));
  const pct = parseAmount(fd.get("costPct"));
  const vat = parseAmount(fd.get("vatPct"));
  const [feed] = await db.select({ mapping: schema.supplierFeeds.mapping }).from(schema.supplierFeeds).where(eq(schema.supplierFeeds.id, feedId));
  const mapping = { ...feed.mapping, costPct: pct !== null && pct >= 0 && pct < 1000 ? String(pct) : "", vatPct: vat !== null && vat >= 0 && vat < 30 ? String(vat) : "" };
  await db.update(schema.supplierFeeds).set({ mapping }).where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, session.tenantId)));
  revalidatePath(`/lieferanten/${feedId}`);
}

export async function clearFeedAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const feedId = await ownFeed(session.tenantId, fd.get("feedId"));
  await db.delete(schema.supplierOffers).where(and(eq(schema.supplierOffers.feedId, feedId), eq(schema.supplierOffers.tenantId, session.tenantId)));
  revalidatePath(`/lieferanten/${feedId}`);
}

export type BoxState = { ok: boolean; message: string; brandId?: string } | null;

/** Aus den Artikeln Boxen vorschlagen lassen → Ideen im Marken-Board (mit exakter Kalkulation). */
export async function suggestBoxesAction(_prev: BoxState, fd: FormData): Promise<BoxState> {
  const session = await requireArea("lieferanten", "marken");
  try {
    if (!canAccess(session, "marken")) throw new Error("Für Box-Vorschläge braucht es Zugriff auf den Bereich Marken.");
    // Aus dem Ideen-Board ohne Feed: alle Lieferanten-Artikel.
    const feedId = fd.get("feedId") ? await ownFeed(session.tenantId, fd.get("feedId")) : null;
    const brandId = uuid.parse(fd.get("brandId"));
    assertBrand(session, brandId);
    const count = Math.min(8, Math.max(1, Number(fd.get("count") ?? 4) || 4));
    const r = await suggestBoxes(session.tenantId, session.userId, {
      feedId,
      allFeeds: !feedId || fd.get("allFeeds") === "on",
      brandId,
      occasion: String(fd.get("occasion") ?? "") || null,
      count,
      wish: String(fd.get("wish") ?? "").trim().slice(0, 300) || undefined,
      packaging: parseAmount(fd.get("packaging")) ?? 2.5,
      fbaFee: parseAmount(fd.get("fbaFee")) ?? 5,
    });
    revalidatePath("/marken");
    const top = r.best.map((b) => `${b.title}${b.profit !== null ? ` (${b.profit.toFixed(2).replace(".", ",")} € Gewinn${b.margin !== null ? `, ${b.margin.toLocaleString("de-DE")} %` : ""}${b.compared ? `, ${b.compared} Vergleichsprodukte` : ""})` : ""}`).join(" · ");
    return { ok: true, message: `${r.count} rentable Boxen als Ideen angelegt${r.repaired ? ` (${r.repaired} nachgebessert)` : ""}${r.dropped ? `, ${r.dropped} unrentable verworfen` : ""}: ${top}`, brandId: r.brandId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Automatischer Abruf: Link, Zugang (verschlüsselt), Takt, netto/brutto. */
/** Link, Zugang und Takt aus dem Formular speichern – gemeinsam für „Speichern“ und „Jetzt abrufen“. */
async function saveSource(tenantId: string, fd: FormData) {
  const feedId = uuid.parse(fd.get("feedId"));
  const url = String(fd.get("sourceUrl") ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) redirect(`/lieferanten/${feedId}?abruf=${encodeURIComponent("Bitte einen http(s)-Link eintragen.")}`);
  const auth = String(fd.get("sourceAuth") ?? "").trim();
  const hours = Math.min(168, Math.max(1, Math.round(parseAmount(fd.get("pullEveryHours")) ?? 24)));
  await db
    .update(schema.supplierFeeds)
    .set({
      sourceUrl: url || null,
      // Leeres Feld = gespeicherten Zugang behalten; „-“ löscht ihn.
      ...(auth === "-" ? { sourceAuth: null } : auth ? { sourceAuth: encryptSecret(auth) } : {}),
      autoPull: Boolean(url) && fd.get("autoPull") === "on",
      pullEveryHours: hours,
      pricesGross: fd.get("pricesGross") === "on",
    })
    .where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, tenantId)));
  return feedId;
}

export async function saveFeedSourceAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const feedId = await saveSource(session.tenantId, fd);
  redirect(`/lieferanten/${feedId}?abruf=${encodeURIComponent("Gespeichert.")}`);
}

export async function pullNowAction(fd: FormData) {
  const session = await requireArea("lieferanten");
  const feedId = await saveSource(session.tenantId, fd);
  let msg: string;
  try {
    msg = await pullFeed(session.tenantId, feedId);
    void refreshMarket(session.tenantId).catch(() => undefined);
    msg += " Keepa prüft neue und geänderte Preise im Hintergrund.";
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  redirect(`/lieferanten/${feedId}?abruf=${encodeURIComponent(msg)}`);
}
