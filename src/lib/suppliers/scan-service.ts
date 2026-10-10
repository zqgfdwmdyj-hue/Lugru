import "server-only";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OfferMarket } from "@/db/schema";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { parseKeepaProduct } from "@/lib/brands/market";
import { eurRates } from "@/lib/fx/ecb";
import { getIntegration } from "@/lib/integrations/store";
import { keepaKey, keepaSearch } from "@/lib/integrations/clients/keepa";
import { KEEPA_MIN_TOKENS, recordHistory, refreshMarket, shareMarket } from "./feed-service";
import { stripHtml } from "@/lib/research/feeds";
import { chunkText, currencyOf, dedupe, fromCards, fromJsonLd, fromShopify, jsonLdFromHtml, parseCapture, parseScan, scanPromptForText, SCAN_INSTRUCTIONS, searchTerm, toEur, type ScannedItem } from "./scan";

const O = schema.supplierOffers;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export type ScanInput = { text?: string; url?: string; file?: { name: string; type: string; bytes: Uint8Array } };
export type ScanResult = { items: ScannedItem[]; method: string };

async function ai(tenantId: string) {
  const cfg = await getIntegration(tenantId, "anthropic");
  return cfg?.apiKey ? { key: cfg.apiKey, model: modelFor(cfg, "simple") } : null;
}

async function aiFromText(tenantId: string, text: string, source: string | undefined, fallbackCurrency: string): Promise<ScannedItem[]> {
  const k = await ai(tenantId);
  if (!k) return [];
  const out: ScannedItem[] = [];
  for (const part of chunkText(text)) {
    const r = await askClaude(k.key, scanPromptForText(part, source), { model: k.model, task: "simple", maxTokens: 12000, timeoutMs: 180_000 });
    out.push(...parseScan(r.text, source, fallbackCurrency));
  }
  return out;
}

async function fromUrl(tenantId: string, url: string): Promise<ScanResult> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("Das ist kein gültiger Link.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Nur http(s)-Links.");
  // Nur öffentliche Shops – keine Adressen im eigenen Netz (Server, Tailscale, Docker).
  if (!process.env.SCAN_ALLOW_PRIVATE && (/^(localhost|.*\.local|.*\.internal|.*\.ts\.net)$/i.test(u.hostname) || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.|\[)/.test(u.hostname))) {
    throw new Error("Nur öffentliche Shop-Seiten.");
  }
  const res = await fetch(u, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const html = res ? await res.text().catch(() => "") : "";
  if (!res || !res.ok || /Just a moment|cf-challenge|challenges\.cloudflare\.com/i.test(html.slice(0, 5000))) {
    throw new Error("Die Seite lässt keinen automatischen Abruf zu (Bot-Schutz). Bitte das Lesezeichen „→ Seller-System“ auf der Seite anklicken und das Ergebnis hier einfügen.");
  }
  // Shopify-Shops: vollständiger Katalog mit Barcodes.
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) {
    const all: ScannedItem[] = [];
    for (let page = 1; page <= 10; page++) {
      const j = await fetch(`${u.origin}/products.json?limit=250&page=${page}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const got = j ? fromShopify(j, u.origin) : [];
      all.push(...got);
      if (got.length === 0) break;
    }
    if (all.length) return { items: dedupe(all), method: "Shopify-Katalog" };
  }
  const ld = fromJsonLd(jsonLdFromHtml(html), u.href);
  if (ld.length >= 2 || (ld.length === 1 && !/collection|category|kategorie|search/i.test(u.pathname))) return { items: dedupe(ld), method: "Seitendaten (JSON-LD)" };
  const text = stripHtml(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")).slice(0, 150_000);
  const viaAi = await aiFromText(tenantId, text, u.href, currencyOf(text));
  if (viaAi.length) return { items: dedupe([...ld, ...viaAi]), method: "KI (Seitentext)" };
  if (ld.length) return { items: ld, method: "Seitendaten (JSON-LD)" };
  throw new Error("Auf der Seite wurden keine Produkte erkannt. Mit KI-Schlüssel (Anbindungen → KI) wird auch reiner Seitentext gelesen.");
}

async function fromFile(tenantId: string, f: NonNullable<ScanInput["file"]>): Promise<ScanResult> {
  const k = await ai(tenantId);
  if (!k) throw new Error("Fotos und PDFs liest die KI – bitte unter Anbindungen → KI (Claude) einen Schlüssel eintragen. CSV/Excel geht auch ohne (Kasten „Feed hochladen“).");
  const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const img = /^image\/(png|jpe?g|webp|gif)$/.test(f.type) ? f.type.replace("jpg", "jpeg") : null;
  if (!isPdf && !img) throw new Error("Bitte ein Foto/Screenshot (JPG, PNG, WebP) oder eine PDF wählen.");
  if (f.bytes.length > (isPdf ? 30 : 5) * 1024 * 1024) throw new Error(isPdf ? "PDF ist größer als 30 MB." : "Bild ist größer als 5 MB – bitte als JPG speichern oder zuschneiden.");
  const data = Buffer.from(f.bytes).toString("base64");
  const block = isPdf ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const) : ({ type: "image", source: { type: "base64", media_type: img!, data } } as const);
  const r = await askClaude(k.key, [block, { type: "text", text: SCAN_INSTRUCTIONS }], { model: k.model, task: "simple", maxTokens: 16000, timeoutMs: 240_000 });
  const items = parseScan(r.text);
  if (!items.length) throw new Error("Die KI hat in der Datei keine Produkte gefunden.");
  return { items: dedupe(items), method: isPdf ? "KI (PDF)" : "KI (Foto)" };
}

async function fromText(tenantId: string, text: string): Promise<ScanResult> {
  const cap = parseCapture(text);
  if (cap) {
    const ld = fromJsonLd(cap.jsonld ?? [], cap.url);
    const currency = currencyOf(cap.text ?? "");
    // Kategorie-Seite: Kacheln. Produktseite: JSON-LD reicht meist.
    const cards = fromCards(cap.items ?? [], cap.text);
    let items = dedupe([...ld, ...cards]);
    let method = "Browser-Erfassung";
    // Wenige/keine Treffer oder Kacheln ohne Titel → KI über Kacheln bzw. Text.
    if (items.length < Math.min(3, (cap.items ?? []).length) || items.length === 0) {
      const source = cap.items?.length ? cap.items.map((c) => `${c.text} || ${c.href}`).join("\n") : (cap.text ?? "");
      const viaAi = await aiFromText(tenantId, source, cap.url, currency);
      if (viaAi.length) {
        items = dedupe([...ld, ...viaAi.map((i) => ({ ...i, imageUrl: i.imageUrl ?? cap.items?.find((c) => c.href === i.url)?.img ?? null }))]);
        method = "Browser-Erfassung + KI";
      }
    }
    if (!items.length) throw new Error("In der Erfassung wurden keine Produkte erkannt. Auf einer Kategorie- oder Produktseite erneut versuchen.");
    return { items, method };
  }
  const t = text.trim();
  if (!t) throw new Error("Bitte Text einfügen.");
  const viaAi = await aiFromText(tenantId, t, undefined, currencyOf(t));
  if (viaAi.length) return { items: dedupe(viaAi), method: "KI (Text)" };
  // Ohne KI: Zeilen mit Preis.
  const lines = t.split(/\r?\n/).map((l) => ({ href: "", text: l, img: null }));
  const plain = fromCards(lines, t).map((i) => ({ ...i, url: null }));
  if (!plain.length) throw new Error("Keine Zeilen mit Preis erkannt. Mit KI-Schlüssel (Anbindungen → KI) klappt auch unordentlicher Text.");
  return { items: dedupe(plain), method: "Zeilen mit Preis" };
}

export async function scan(tenantId: string, input: ScanInput): Promise<ScanResult> {
  if (input.file) return fromFile(tenantId, input.file);
  if (input.url?.trim()) return fromUrl(tenantId, input.url);
  return fromText(tenantId, input.text ?? "");
}

/** Gescannte Artikel als Angebote speichern (Preis in EUR umgerechnet, Original bleibt stehen). */
export async function saveScanned(tenantId: string, feedId: string, items: ScannedItem[], manualRates?: Record<string, number>) {
  const started = new Date(Date.now() - 1000);
  const rates = { ...(await eurRates()), ...manualRates };
  const missing = new Set(items.filter((i) => i.price !== null && i.currency !== "EUR" && !rates[i.currency]).map((i) => i.currency));
  const values = items.map((i) => ({
    tenantId,
    feedId,
    supplierSku: i.sku,
    ean: i.ean,
    title: i.title,
    price: toEur(i.price, i.currency, rates),
    priceOrig: i.currency === "EUR" ? null : i.price,
    currency: i.currency,
    url: i.url,
    imageUrl: i.imageUrl,
    pack: i.pack,
    stock: i.stock,
    origin: "scan" as const,
    scannedAt: started,
  }));
  for (let n = 0; n < values.length; n += 500) {
    await db
      .insert(O)
      .values(values.slice(n, n + 500))
      .onConflictDoUpdate({
        target: [O.feedId, O.supplierSku],
        set: {
          title: sql`excluded.title`,
          ean: sql`coalesce(excluded.ean, ${O.ean})`,
          priceChangedAt: sql`case when excluded.price is not null and ${O.price} is distinct from excluded.price then now() else ${O.priceChangedAt} end`,
          price: sql`coalesce(excluded.price, ${O.price})`,
          priceOrig: sql`excluded.price_orig`,
          currency: sql`excluded.currency`,
          url: sql`coalesce(excluded.url, ${O.url})`,
          imageUrl: sql`coalesce(excluded.image_url, ${O.imageUrl})`,
          pack: sql`coalesce(excluded.pack, ${O.pack})`,
          stock: sql`excluded.stock`,
          // Von Hand gezogen: einmal prüfen, getrennt zeigen (nicht im 24-Std-Abgleich der Listen).
          origin: sql`'scan'`,
          scannedAt: sql`excluded.scanned_at`,
          active: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
  await recordHistory(tenantId, feedId, started);
  await shareMarket(tenantId, feedId);
  await db.update(schema.supplierFeeds).set({ lastImportAt: new Date() }).where(and(eq(schema.supplierFeeds.id, feedId), eq(schema.supplierFeeds.tenantId, tenantId)));
  return { saved: values.length, withEan: values.filter((v) => v.ean).length, rate: rates.USD ?? null, missingRates: [...missing], scannedAt: started };
}

/**
 * Von Hand gezogene Artikel ohne EAN einmal per Titel bei Keepa suchen (je Suche ca. 10 Tokens) –
 * begrenzt und nur, solange genug Tokens da sind. Mit EAN prüft `analyzeFeed` danach.
 */
export async function titleLookupScanned(tenantId: string, feedId: string, since: Date, limit = 25) {
  const key = await keepaKey(tenantId);
  if (!key) return { searched: 0, found: 0 };
  const rows = await db
    .select({ id: O.id, title: O.title })
    .from(O)
    .where(and(eq(O.tenantId, tenantId), eq(O.feedId, feedId), eq(O.origin, "scan"), sql`${O.scannedAt} >= ${since}`, isNull(O.ean), isNull(O.market), isNotNull(O.title)))
    .limit(limit);
  let found = 0;
  let searched = 0;
  for (const r of rows) {
    const res = await keepaSearch(key, searchTerm(r.title!));
    searched++;
    const mp = res.products[0];
    const market: OfferMarket = mp
      ? { checkedAt: new Date().toISOString(), asin: mp.asin, title: mp.title, price: mp.price, fbaFee: mp.fbaFee, referralPct: mp.referralPct, monthlySold: mp.monthlySold, salesRank: mp.salesRank, byTitle: true }
      : { checkedAt: new Date().toISOString(), asin: null, price: null, fbaFee: null, referralPct: null, monthlySold: null, salesRank: null, byTitle: true };
    if (mp) found++;
    await db.update(O).set({ market }).where(and(eq(O.id, r.id), eq(O.tenantId, tenantId)));
    if (res.tokensLeft !== null && res.tokensLeft < KEEPA_MIN_TOKENS + 10) break;
  }
  return { searched, found };
}

/**
 * Angebote mit EAN bei Keepa (amazon.de) nachschlagen: ASIN, Preis, FBA-Gebühr, Provision, Verkäufe.
 * 1 Token je Code; bereits geprüfte (7 Tage) werden übersprungen.
 */
export async function checkFeedWithKeepa(tenantId: string, feedId: string, opts: { byTitle?: boolean; limit?: number; titleLimit?: number } = {}) {
  const limit = opts.limit ?? 200;
  const key = await keepaKey(tenantId);
  if (!key) throw new Error("Bitte unter Anbindungen → Keepa einen Schlüssel eintragen.");
  const rows = await db
    .select({ id: O.id, ean: O.ean })
    .from(O)
    .where(and(eq(O.tenantId, tenantId), eq(O.feedId, feedId), isNotNull(O.ean), sql`(${O.market} is null or (${O.market}->>'checkedAt')::timestamptz < now() - interval '7 days')`))
    .limit(limit);
  // Je EAN nur einmal – das Ergebnis gilt für alle Feeds mit dieser EAN, mit VK-Verlauf.
  const r = await refreshMarket(tenantId, { eans: [...new Set(rows.map((x) => x.ean!))] });
  const found = r.found;
  let tokensLeft = r.tokensLeft;
  // Ohne EAN: Titelsuche (je Suche ca. 10 Tokens) – nur auf Wunsch und begrenzt.
  let byTitle = 0;
  if (opts.byTitle) {
    const noEan = await db
      .select({ id: O.id, title: O.title })
      .from(O)
      .where(and(eq(O.tenantId, tenantId), eq(O.feedId, feedId), isNull(O.ean), isNull(O.market), isNotNull(O.title)))
      .limit(opts.titleLimit ?? 20);
    for (const r of noEan) {
      const term = searchTerm(r.title!);
      const res = await keepaSearch(key, term);
      tokensLeft = res.tokensLeft;
      const mp = res.products[0];
      const market: OfferMarket = mp
        ? { checkedAt: new Date().toISOString(), asin: mp.asin, title: mp.title, price: mp.price, fbaFee: mp.fbaFee, referralPct: mp.referralPct, monthlySold: mp.monthlySold, salesRank: mp.salesRank, byTitle: true }
        : { checkedAt: new Date().toISOString(), asin: null, price: null, fbaFee: null, referralPct: null, monthlySold: null, salesRank: null, byTitle: true };
      if (mp) byTitle++;
      await db.update(O).set({ market }).where(and(eq(O.id, r.id), eq(O.tenantId, tenantId)));
    }
    return { checked: rows.length + noEan.length, found: found + byTitle, byTitle, tokensLeft };
  }
  return { checked: rows.length, found, byTitle, tokensLeft };
}

export async function deleteOffers(tenantId: string, feedId: string, ids: string[]) {
  if (!ids.length) return;
  await db.delete(O).where(and(eq(O.tenantId, tenantId), eq(O.feedId, feedId), inArray(O.id, ids)));
}
