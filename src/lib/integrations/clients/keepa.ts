import "server-only";
import { getSettings } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import { parseKeepaProduct } from "@/lib/brands/market";
import type { MarketProduct } from "@/db/tables/brands";
import { getIntegration } from "../store";
import { registerTester } from "../test";

// Keepa (amazon.de): ähnliche Produkte mit Preis, FBA-Gebühr, Provision, Verkäufen im Monat.
// Ein Schlüssel für alles – steht er schon im eBay-Tool (Bildquellen), wird der genommen.

const DOMAIN_DE = 3;
const BASE = () => (process.env.KEEPA_BASE_URL || "https://api.keepa.com").replace(/\/$/, "");

export async function keepaKey(tenantId: string): Promise<string | null> {
  const own = await getIntegration(tenantId, "keepa");
  if (own?.apiKey) return own.apiKey;
  return (await getSettings(ebayDb(tenantId))).keepaApiKey ?? null;
}

async function keepaGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; type?: string } };
  if (!res.ok || json.error) {
    if (res.status === 401 || /key/i.test(json.error?.message ?? "")) throw new Error("Der Keepa-Schlüssel ist ungültig (Anbindungen → Keepa).");
    if (res.status === 402 || res.status === 429 || /token/i.test(json.error?.type ?? "")) throw new Error("Keine Keepa-Tokens mehr übrig – kurz warten, sie laden sich wieder auf.");
    throw new Error(`Keepa meldet einen Fehler: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Produktsuche auf amazon.de mit Kennzahlen der letzten 90 Tage. */
export async function keepaSearch(apiKey: string, term: string): Promise<{ products: MarketProduct[]; tokensLeft: number | null }> {
  const url = `${BASE()}/search?key=${encodeURIComponent(apiKey)}&domain=${DOMAIN_DE}&type=product&term=${encodeURIComponent(term)}&stats=90&page=0`;
  const json = await keepaGet(url);
  const products = ((json.products as Record<string, unknown>[] | undefined) ?? []).map(parseKeepaProduct).filter((p): p is MarketProduct => p !== null);
  return { products, tokensLeft: typeof json.tokensLeft === "number" ? json.tokensLeft : null };
}

registerTester("keepa", async (v) => {
  if (!v.apiKey) throw new Error("API-Schlüssel fehlt.");
  const json = await keepaGet(`${BASE()}/token?key=${encodeURIComponent(v.apiKey)}`);
  return `Verbunden – ${json.tokensLeft ?? "?"} Tokens verfügbar (je Suche ca. 10–20).`;
});

/** Produkte per ASIN (bis 100 je Aufruf, 1 Token je ASIN) mit Kennzahlen der letzten 90 Tage. */
export async function keepaProducts(apiKey: string, asins: string[]): Promise<{ products: Record<string, unknown>[]; tokensLeft: number | null }> {
  const url = `${BASE()}/product?key=${encodeURIComponent(apiKey)}&domain=${DOMAIN_DE}&asin=${asins.map(encodeURIComponent).join(",")}&stats=90&history=0`;
  const json = await keepaGet(url);
  return { products: (json.products as Record<string, unknown>[] | undefined) ?? [], tokensLeft: typeof json.tokensLeft === "number" ? json.tokensLeft : null };
}

/** Produkte per EAN/UPC (bis 100 je Aufruf). Keepa nennt die Codes je Produkt in eanList/upcList. */
export async function keepaByCode(apiKey: string, codes: string[]): Promise<{ products: Record<string, unknown>[]; tokensLeft: number | null }> {
  const url = `${BASE()}/product?key=${encodeURIComponent(apiKey)}&domain=${DOMAIN_DE}&code=${codes.map(encodeURIComponent).join(",")}&stats=90&history=0`;
  const json = await keepaGet(url);
  return { products: (json.products as Record<string, unknown>[] | undefined) ?? [], tokensLeft: typeof json.tokensLeft === "number" ? json.tokensLeft : null };
}
