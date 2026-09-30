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
import { suggestBoxes } from "@/lib/suppliers/boxes-service";
import { canAccess } from "@/lib/auth/areas";
import { assertBrand } from "@/lib/brands/access";

const uuid = z.string().uuid();

export async function createFeed(fd: FormData) {
  const session = await requireArea("wawi");
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  const supplierId = uuid.safeParse(fd.get("supplierId")).success ? String(fd.get("supplierId")) : null;
  const [f] = await db.insert(schema.supplierFeeds).values({ tenantId: session.tenantId, name, supplierId }).returning({ id: schema.supplierFeeds.id });
  redirect(`/lieferanten/${f.id}`);
}

export type FeedState = { ok: boolean; message: string; headers?: string[] } | null;

export async function uploadFeed(_prev: FeedState, fd: FormData): Promise<FeedState> {
  const session = await requireArea("wawi");
  const feedId = uuid.parse(fd.get("feedId"));
  const [feed] = await db.select().from(schema.supplierFeeds).where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, session.tenantId)));
  if (!feed) return { ok: false, message: "Feed nicht gefunden." };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Bitte Datei wählen." };
  const table = readTable(new Uint8Array(await file.arrayBuffer()));
  const pick = (k: keyof FeedMapping) => String(fd.get(`map_${k}`) ?? "") || feed.mapping[k] || "";
  const mapping: FeedMapping = { ...feed.mapping, ean: pick("ean"), asin: pick("asin"), supplierSku: pick("supplierSku"), title: pick("title"), price: pick("price"), stock: pick("stock") };
  if (!mapping.supplierSku || !table.headers.includes(mapping.supplierSku)) {
    return { ok: false, message: "Bitte die Spalten zuordnen (mindestens Lieferanten-Artikelnummer).", headers: table.headers };
  }
  const idx = (h?: string) => (h ? table.headers.indexOf(h) : -1);
  const col = { ean: idx(mapping.ean), asin: idx(mapping.asin), sku: idx(mapping.supplierSku), title: idx(mapping.title), price: idx(mapping.price), stock: idx(mapping.stock) };
  const values = table.rows
    .map((r) => ({
      tenantId: session.tenantId,
      feedId,
      supplierSku: (r[col.sku] ?? "").trim(),
      ean: col.ean >= 0 ? (r[col.ean] ?? "").replace(/\D/g, "") || null : null,
      asin: col.asin >= 0 ? (r[col.asin] ?? "").trim().toUpperCase() || null : null,
      title: col.title >= 0 ? (r[col.title] ?? "").trim() || null : null,
      price: col.price >= 0 ? parseAmount(r[col.price]) : null,
      stock: col.stock >= 0 ? Math.round(parseAmount(r[col.stock]) ?? 0) : null,
    }))
    .filter((v) => v.supplierSku);
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(schema.supplierOffers)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [schema.supplierOffers.feedId, schema.supplierOffers.supplierSku],
        set: { ean: sql`excluded.ean`, asin: sql`excluded.asin`, title: sql`excluded.title`, price: sql`excluded.price`, stock: sql`excluded.stock`, updatedAt: new Date() },
      });
  }
  await db.update(schema.supplierFeeds).set({ mapping, lastImportAt: new Date() }).where(eq(schema.supplierFeeds.id, feedId));
  revalidatePath(`/lieferanten/${feedId}`);
  return { ok: true, message: `${values.length} Angebote übernommen.` };
}

export async function offerToListing(fd: FormData) {
  const session = await requireArea("wawi");
  const id = uuid.parse(fd.get("offerId"));
  const [o] = await db.select().from(schema.supplierOffers).where(and(eq(schema.supplierOffers.id, id), eq(schema.supplierOffers.tenantId, session.tenantId)));
  if (!o) return;
  const price = parseAmount(fd.get("price"));
  await db
    .insert(schema.listings)
    .values({ tenantId: session.tenantId, channel: "ebay", sku: `L-${o.supplierSku}`.slice(0, 50), title: (o.title ?? o.supplierSku).slice(0, 80), ean: o.ean, price, quantity: Math.max(0, o.stock ?? 0), payload: { supplierOfferId: o.id } })
    .onConflictDoNothing();
  redirect(`/listings?kanal=ebay&sku=${encodeURIComponent(`L-${o.supplierSku}`.slice(0, 50))}`);
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
  const session = await requireArea("wawi");
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
  const session = await requireArea("wawi");
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
  const session = await requireArea("wawi");
  const feedId = await ownFeed(session.tenantId, fd.get("feedId"));
  const pct = parseAmount(fd.get("costPct"));
  const vat = parseAmount(fd.get("vatPct"));
  const [feed] = await db.select({ mapping: schema.supplierFeeds.mapping }).from(schema.supplierFeeds).where(eq(schema.supplierFeeds.id, feedId));
  const mapping = { ...feed.mapping, costPct: pct !== null && pct >= 0 && pct < 1000 ? String(pct) : "", vatPct: vat !== null && vat >= 0 && vat < 30 ? String(vat) : "" };
  await db.update(schema.supplierFeeds).set({ mapping }).where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, session.tenantId)));
  revalidatePath(`/lieferanten/${feedId}`);
}

export async function clearFeedAction(fd: FormData) {
  const session = await requireArea("wawi");
  const feedId = await ownFeed(session.tenantId, fd.get("feedId"));
  await db.delete(schema.supplierOffers).where(and(eq(schema.supplierOffers.feedId, feedId), eq(schema.supplierOffers.tenantId, session.tenantId)));
  revalidatePath(`/lieferanten/${feedId}`);
}

export type BoxState = { ok: boolean; message: string; brandId?: string } | null;

/** Aus den Artikeln Boxen vorschlagen lassen → Ideen im Marken-Board (mit exakter Kalkulation). */
export async function suggestBoxesAction(_prev: BoxState, fd: FormData): Promise<BoxState> {
  const session = await requireArea("wawi");
  try {
    if (!canAccess(session, "marken")) throw new Error("Für Box-Vorschläge braucht es Zugriff auf den Bereich Marken.");
    const feedId = await ownFeed(session.tenantId, fd.get("feedId"));
    const brandId = uuid.parse(fd.get("brandId"));
    assertBrand(session, brandId);
    const count = Math.min(8, Math.max(1, Number(fd.get("count") ?? 4) || 4));
    const r = await suggestBoxes(session.tenantId, session.userId, {
      feedId,
      allFeeds: fd.get("allFeeds") === "on",
      brandId,
      occasion: String(fd.get("occasion") ?? "") || null,
      count,
      wish: String(fd.get("wish") ?? "").trim().slice(0, 300) || undefined,
      packaging: parseAmount(fd.get("packaging")) ?? 2.5,
      fbaFee: parseAmount(fd.get("fbaFee")) ?? 5,
    });
    revalidatePath("/marken");
    const top = r.best.map((b) => `${b.title}${b.profit !== null ? ` (${b.profit.toFixed(2).replace(".", ",")} € Gewinn)` : ""}`).join(" · ");
    return { ok: true, message: `${r.count} Boxen als Ideen angelegt: ${top}`, brandId: r.brandId };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
