import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LeadEvidence, LeadFinding, LeadSource } from "@/db/schema";
import { askClaudeWithWeb, modelFor } from "@/lib/ai/claude";
import { getSettings as ebaySettings } from "@/lib/ebay/db/db";
import { ebayDb } from "@/lib/ebay/db/pg";
import { getAppAccessToken } from "@/lib/ebay/ebay/auth";
import { ACCEPT_LANGUAGE, apiBase, MARKETPLACE } from "@/lib/ebay/ebay/config";
import { ebayFetch } from "@/lib/ebay/ebay/http";
import { extractGpsr } from "@/lib/ebay/pipeline/gpsr";
import { keepaKey, keepaOffers, keepaSearchRaw, keepaSellerDetails } from "@/lib/integrations/clients/keepa";
import { getIntegration } from "@/lib/integrations/store";
import { assessFinding, brandMatches, countryName, nameKey, parseAddressLines, parseDistributors, validEmail, type LeadKind } from "./logic";
import { importFromLucid } from "./service";

// Weitere Wege zu Bezugsquellen einer Marke – neben dem Verpackungsregister:
// - Amazon: wer die Marke dort verkauft (Keepa: Angebote → Verkäufer mit Impressum).
// - eBay: gewerbliche Verkäufer der Marke (Impressum) und die GPSR-Angaben der Angebote
//   (Hersteller und EU-Verantwortlicher – Letzterer ist oft Importeur/Distributor).
// - KI-Websuche: offizielle Distributoren, Händlerlisten der Marke, B2B-Shops.
// Dieselbe Firma aus mehreren Quellen wird zu einem Kontakt zusammengeführt.

const L = schema.supplierLeads;
const S = schema.supplierLeadSearches;

export type Candidate = {
  source: Exclude<LeadSource, "lucid">;
  sourceId: string;
  companyName: string;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  vatId?: string | null;
  registerNumber?: string | null;
  kind: LeadKind;
  score: number;
  reasons: string[];
  evidence: LeadEvidence[];
  finding: Omit<LeadFinding, "at" | "brand">;
};

const t = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Funde speichern: gleiche Quelle/Kennung oder gleicher Firmenname → vorhandenen Kontakt ergänzen. */
export async function saveCandidates(tenantId: string, brand: string, cands: Candidate[]) {
  const existing = await db.select({ id: L.id, companyName: L.companyName, source: L.source, sourceId: L.sourceId }).from(L).where(eq(L.tenantId, tenantId));
  const byKey = new Map<string, string>();
  const bySrc = new Map<string, string>();
  for (const e of existing) {
    byKey.set(nameKey(e.companyName), e.id);
    bySrc.set(`${e.source}:${e.sourceId}`, e.id);
  }
  const at = new Date().toISOString();
  let created = 0;
  let merged = 0;
  for (const c of cands) {
    const finding: LeadFinding = { ...c.finding, brand, at };
    const key = nameKey(c.companyName);
    const id = bySrc.get(`${c.source}:${c.sourceId}`) ?? (key.length >= 4 ? byKey.get(key) : undefined);
    if (id) {
      const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, tenantId)));
      if (!l) continue;
      const evidence = [...l.evidence];
      for (const e of c.evidence) if (!evidence.some((x) => x.label === e.label && x.value === e.value)) evidence.push(e);
      await db
        .update(L)
        .set({
          street: l.street ?? c.street ?? null,
          zip: l.zip ?? c.zip ?? null,
          city: l.city ?? c.city ?? null,
          country: l.country ?? c.country ?? null,
          phone: l.phone ?? c.phone ?? null,
          email: l.email ?? c.email ?? null,
          website: l.website ?? c.website ?? null,
          vatId: l.vatId ?? c.vatId ?? null,
          registerNumber: l.registerNumber ?? c.registerNumber ?? null,
          searchBrands: [...new Set([...l.searchBrands, brand])],
          findings: [...l.findings.filter((f) => !(f.source === finding.source && f.label === finding.label && f.brand === brand)), finding].slice(-20),
          evidence: evidence.slice(0, 12),
          score: Math.max(l.score, c.score),
          // Eine geprüfte oder schon eindeutige Einstufung bleibt.
          kind: l.checkedAt || l.kind !== "unklar" ? l.kind : c.kind,
          notes: l.notes ?? (c.reasons.join(" · ") || null),
          updatedAt: new Date(),
        })
        .where(eq(L.id, id));
      bySrc.set(`${c.source}:${c.sourceId}`, id);
      merged++;
      continue;
    }
    const [row] = await db
      .insert(L)
      .values({
        tenantId,
        source: c.source,
        sourceId: c.sourceId.slice(0, 200),
        searchBrands: [brand],
        companyName: c.companyName.slice(0, 300),
        street: c.street ?? null,
        zip: c.zip ?? null,
        city: c.city ?? null,
        country: c.country ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        website: c.website ?? null,
        vatId: c.vatId ?? null,
        registerNumber: c.registerNumber ?? null,
        kind: c.kind,
        score: c.score,
        evidence: c.evidence.slice(0, 12),
        findings: [finding],
        notes: c.reasons.join(" · ") || null,
      })
      .returning({ id: L.id });
    byKey.set(key, row.id);
    bySrc.set(`${c.source}:${c.sourceId}`, row.id);
    created++;
  }
  return { created, merged };
}

// ---- Amazon (Keepa) ---------------------------------------------------------------------------

/** amazon.de selbst und Amazon Warehouse – keine Bezugsquelle. */
const AMAZON_SELLERS = new Set(["A3JWKAKR8XB7XF", "A8KICS1PHF7ZO"]);
/** Ungefähre Keepa-Kosten: Suche 10, je ASIN mit Angeboten bis 13, je Verkäufer 1. */
export const keepaCostEstimate = (asins: number, sellers = 30) => 10 + asins * 13 + sellers;

export async function amazonCandidates(tenantId: string, brand: string, maxAsins = 10): Promise<{ cands: Candidate[]; note: string }> {
  const key = await keepaKey(tenantId);
  if (!key) throw new Error("Kein Keepa-Schlüssel – unter Anbindungen → Keepa eintragen.");
  const search = await keepaSearchRaw(key, brand);
  const byBrand = search.products.filter((p) => typeof p.asin === "string" && (brandMatches([String(p.brand ?? "")], brand) || brandMatches([String(p.manufacturer ?? "")], brand)));
  const pool = byBrand.length ? byBrand : search.products.filter((p) => typeof p.asin === "string" && brandMatches([String(p.title ?? "")], brand));
  let n = Math.min(maxAsins, pool.length);
  if (search.tokensLeft !== null && search.tokensLeft < keepaCostEstimate(n)) n = Math.max(0, Math.floor((search.tokensLeft - 40) / 13));
  if (!pool.length) return { cands: [], note: "keine Produkte der Marke auf amazon.de gefunden" };
  if (n < 1) throw new Error(`Zu wenige Keepa-Tokens (${search.tokensLeft}) – in einer Stunde erneut versuchen.`);
  const asins = pool.slice(0, n).map((p) => String(p.asin));

  const off = await keepaOffers(key, asins);
  const per = new Map<string, { asins: Set<string>; fba: boolean }>();
  for (const p of off.products) {
    const offers = (p.offers as Record<string, unknown>[] | undefined) ?? [];
    const live = Array.isArray(p.liveOffersOrder) ? (p.liveOffersOrder as number[]).map((i) => offers[i]).filter(Boolean) : offers;
    for (const o of live) {
      const id = typeof o.sellerId === "string" ? o.sellerId : null;
      if (!id || o.isAmazon === true || AMAZON_SELLERS.has(id) || (typeof o.condition === "number" && o.condition !== 1)) continue;
      const e = per.get(id) ?? { asins: new Set<string>(), fba: false };
      e.asins.add(String(p.asin));
      e.fba ||= o.isFBA === true;
      per.set(id, e);
    }
  }
  const ids = [...per.entries()].sort((a, b) => b[1].asins.size - a[1].asins.size).slice(0, 40).map(([id]) => id);
  const det = await keepaSellerDetails(key, ids);
  const cands: Candidate[] = [];
  for (const id of ids) {
    const s = det.sellers[id];
    const name = t(s?.businessName, 300) ?? t(s?.sellerName, 300);
    if (!name || /^amazon(\.| |$)/i.test(name)) continue;
    const info = per.get(id)!;
    const count = info.asins.size;
    const email = validEmail(s?.email) ? s!.email!.trim().toLowerCase() : null;
    const a = assessFinding({ companyName: name, source: "amazon", offers: count, email, searchBrand: brand });
    const url = `https://www.amazon.de/sp?seller=${encodeURIComponent(id)}`;
    const shown = t(s?.sellerName) && s?.sellerName !== name ? `„${s?.sellerName}“: ` : "";
    cands.push({
      source: "amazon",
      sourceId: id,
      companyName: name,
      ...parseAddressLines(s?.address, name),
      phone: t(s?.phoneNumber, 60),
      email,
      vatId: t(s?.vatID, 40),
      registerNumber: t(s?.tradeNumber, 60),
      kind: a.kind,
      score: a.score,
      reasons: a.reasons,
      evidence: [
        { label: "Amazon-Verkäufer", value: `${shown}${count} von ${asins.length} geprüften Produkten der Marke${info.fba ? " (auch FBA)" : ""}`, url },
        ...(t(s?.vatID) ? [{ label: "USt-ID", value: t(s?.vatID)! }] : []),
        ...(t(s?.tradeNumber) ? [{ label: "Handelsregister", value: t(s?.tradeNumber)! }] : []),
        ...(t(s?.representative) ? [{ label: "Vertreten durch", value: t(s?.representative)! }] : []),
      ],
      finding: { source: "amazon", label: "Amazon-Verkäufer", detail: `${count} Produkt(e) der Marke${info.fba ? " · FBA" : ""}`, url },
    });
  }
  const left = det.tokensLeft ?? off.tokensLeft;
  return { cands, note: `${asins.length} Produkte geprüft, ${ids.length} Verkäufer${left !== null ? ` · ${left} Keepa-Tokens übrig` : ""}` };
}

// ---- eBay (Browse-API) --------------------------------------------------------------------------

type EbaySummary = { itemId?: string; title?: string; itemWebUrl?: string; seller?: { username?: string } };
type EbayLegal = {
  name?: string;
  email?: string;
  phone?: string;
  imprint?: string;
  registrationNumber?: string;
  legalContactFirstName?: string;
  legalContactLastName?: string;
  vatDetails?: { issuingCountry?: string; vatId?: string }[];
  sellerProvidedLegalAddress?: { addressLine1?: string; addressLine2?: string; city?: string; postalCode?: string; country?: string; countryName?: string };
};

export async function ebayCandidates(tenantId: string, brand: string, maxSellers = 15): Promise<{ cands: Candidate[]; note: string }> {
  const edb = ebayDb(tenantId);
  const settings = await ebaySettings(edb);
  if (!settings.clientId || !settings.clientSecret) throw new Error("eBay ist nicht verbunden (eBay → eBay-Einstellungen → Verbindung).");
  const headers = { Authorization: `Bearer ${await getAppAccessToken(edb, settings)}`, "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE, Accept: "application/json", "Accept-Language": ACCEPT_LANGUAGE };
  const base = apiBase(settings.env);
  const res = (await ebayFetch(`${base}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(brand)}&limit=200&filter=${encodeURIComponent("conditions:{NEW},buyingOptions:{FIXED_PRICE}")}`, { headers })) as { itemSummaries?: EbaySummary[] } | null;
  const items = (res?.itemSummaries ?? []).filter((i) => typeof i.itemId === "string" && brandMatches([String(i.title ?? "")], brand));
  const per = new Map<string, { n: number; itemId: string }>();
  for (const i of items) {
    const u = i.seller?.username;
    if (!u) continue;
    const e = per.get(u) ?? { n: 0, itemId: i.itemId! };
    e.n++;
    per.set(u, e);
  }
  const top = [...per.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, maxSellers);
  const cands: Candidate[] = [];
  const gpsrSeen = new Set<string>();
  let privat = 0;
  for (const [user, info] of top) {
    let item: Record<string, unknown>;
    try {
      item = (await ebayFetch(`${base}/buy/browse/v1/item/${encodeURIComponent(info.itemId)}`, { headers })) as Record<string, unknown>;
    } catch {
      continue;
    }
    const itemUrl = t(item.itemWebUrl, 500) ?? undefined;
    // GPSR: Hersteller und EU-Verantwortliche aus dem Angebot.
    const g = extractGpsr(item);
    if (g) {
      const people: [typeof g.manufacturer, "manufacturer" | "responsible"][] = [[g.manufacturer, "manufacturer"], ...g.responsiblePersons.map((p) => [p, "responsible"] as [typeof p, "responsible"])];
      for (const [c, role] of people) {
        const name = t(c.companyName, 300);
        if (!name || gpsrSeen.has(nameKey(name))) continue;
        gpsrSeen.add(nameKey(name));
        const email = validEmail(c.email) ? c.email!.trim().toLowerCase() : null;
        const a = assessFinding({ companyName: name, source: "gpsr", role, email, searchBrand: brand });
        const label = role === "manufacturer" ? "Hersteller laut GPSR" : "EU-Verantwortlicher laut GPSR";
        cands.push({
          source: "gpsr",
          sourceId: nameKey(name),
          companyName: name,
          street: [c.addressLine1, c.addressLine2].filter(Boolean).join(", ") || null,
          zip: t(c.postalCode, 20),
          city: t(c.city, 120),
          country: countryName(c.country),
          phone: t(c.phone, 60),
          email,
          website: c.contactUrl && /^https?:\/\//i.test(c.contactUrl) ? c.contactUrl : null,
          kind: a.kind,
          score: a.score,
          reasons: a.reasons,
          evidence: [{ label, value: `auf dem eBay-Angebot von ${user}`, ...(itemUrl ? { url: itemUrl } : {}) }],
          finding: { source: "gpsr", label, detail: "aus einem eBay-Angebot der Marke", url: itemUrl },
        });
      }
    }
    const seller = (item.seller ?? {}) as { sellerAccountType?: string; sellerLegalInfo?: EbayLegal };
    if (seller.sellerAccountType === "INDIVIDUAL") {
      privat++;
      continue;
    }
    const legal = seller.sellerLegalInfo ?? {};
    const imprintName = t(legal.imprint?.split(/\r?\n/)[0], 200);
    const name = t(legal.name, 300) ?? imprintName ?? user;
    const addr = legal.sellerProvidedLegalAddress ?? {};
    const email = validEmail(legal.email) ? legal.email!.trim().toLowerCase() : null;
    const a = assessFinding({ companyName: name, source: "ebay", offers: info.n, email, searchBrand: brand });
    const vat = legal.vatDetails?.find((v) => v.vatId)?.vatId ?? null;
    const url = `https://www.ebay.de/usr/${encodeURIComponent(user)}`;
    cands.push({
      source: "ebay",
      sourceId: user,
      companyName: name,
      street: [addr.addressLine1, addr.addressLine2].filter(Boolean).join(", ") || null,
      zip: t(addr.postalCode, 20),
      city: t(addr.city, 120),
      country: countryName(addr.country) ?? t(addr.countryName, 80),
      phone: t(legal.phone, 60),
      email,
      vatId: t(vat, 40),
      registerNumber: t(legal.registrationNumber, 60),
      kind: a.kind,
      score: a.score,
      reasons: name === user ? [...a.reasons, "nur der eBay-Name ist bekannt (kein Impressum)"] : a.reasons,
      evidence: [
        { label: "eBay-Verkäufer", value: `${user}: ${info.n} Angebote der Marke`, url },
        ...(vat ? [{ label: "USt-ID", value: vat }] : []),
        ...(t(legal.registrationNumber) ? [{ label: "Handelsregister", value: t(legal.registrationNumber)! }] : []),
      ],
      finding: { source: "ebay", label: "eBay-Verkäufer", detail: `${info.n} Angebot(e) der Marke`, url },
    });
  }
  return { cands, note: `${items.length} Angebote der Marke, ${per.size} Verkäufer${privat ? `, ${privat} privat (übersprungen)` : ""}` };
}

// ---- KI-Websuche nach Distributoren -------------------------------------------------------------

export function distributorPrompt(brand: string): string {
  return [
    `Finde Bezugsquellen für Händler: Wer verkauft Produkte der Marke „${brand}“ an Wiederverkäufer in Deutschland bzw. der EU?`,
    "Gesucht: offizielle Distributoren/Importeure (z. B. Händler- oder Distributorenliste auf der Website der Marke, „Händler werden“, „Where to buy / Distributors“), Großhändler mit B2B-Shop oder Händlerregistrierung, B2B-Plattformen mit eigenem Firmennamen.",
    "Nicht gesucht: reine Endkunden-Shops, Marktplätze (Amazon, eBay …), Preisvergleiche, Privatpersonen.",
    "Nur Firmen, die du in den Suchergebnissen belegen kannst. Unbekanntes als null. Höchstens 15 Firmen, die besten zuerst.",
    "Antworte am Ende NUR mit diesem JSON:",
    '{"companies":[{"name":"Firma GmbH","role":"distributor|wholesaler|manufacturer|retailer","website":"https://…","email":"…","phone":"…","city":"…","country":"DE","note":"1 Satz: warum Bezugsquelle","sourceUrl":"https://…"}]}',
  ].join("\n");
}

export async function webCandidates(tenantId: string, brand: string): Promise<{ cands: Candidate[]; note: string }> {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für die Websuche unter Anbindungen → KI (Claude) einen Schlüssel eintragen.");
  const r = await askClaudeWithWeb(ai.apiKey, distributorPrompt(brand), { model: modelFor(ai, "simple"), maxSearches: 6, maxTokens: 3000 });
  const list = parseDistributors(r.text);
  const ROLE: Record<string, string> = { distributor: "Distributor", wholesaler: "Großhändler", manufacturer: "Hersteller", retailer: "Händler" };
  const cands: Candidate[] = list.map((d) => {
    const a = assessFinding({ companyName: d.name, source: "web", role: d.role, email: d.email, searchBrand: brand });
    const host = d.website ? new URL(d.website).hostname.replace(/^www\./, "") : null;
    const url = d.url ?? d.website ?? undefined;
    return {
      source: "web",
      sourceId: host ?? nameKey(d.name),
      companyName: d.name,
      city: d.city,
      country: d.country,
      phone: d.phone,
      email: d.email,
      website: d.website,
      kind: a.kind,
      score: a.score,
      reasons: a.reasons,
      evidence: d.note ? [{ label: "Websuche", value: d.note, ...(url ? { url } : {}) }] : [],
      finding: { source: "web", label: "Websuche", detail: d.role ? ROLE[d.role] : undefined, url },
    };
  });
  return { cands, note: `${r.searches} Websuchen` };
}

// ---- Suchlauf über mehrere Quellen ---------------------------------------------------------------

/** Ein Lauf gilt nach dieser Zeit als abgebrochen (z. B. Neustart des Servers). */
export const SEARCH_STALE_MS = 15 * 60_000;

/**
 * Marke in den gewählten Quellen suchen. Das Register läuft sofort (schnell, Meldung direkt),
 * Amazon, eBay und Websuche im Hintergrund – die Seite zeigt den Stand.
 */
export async function startBrandSearch(tenantId: string, brand: string, sources: LeadSource[], opts: { onlyActive: boolean }) {
  const b = brand.trim();
  if (b.length < 2) throw new Error("Bitte eine Marke mit mindestens 2 Zeichen eingeben.");
  const running = await db
    .select({ source: S.source, brand: S.brand })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), eq(S.status, "laeuft"), gte(S.startedAt, new Date(Date.now() - SEARCH_STALE_MS))));
  const todo = [...new Set(sources)].filter((s) => s !== "gpsr" && !running.some((r) => r.source === s && r.brand.toLowerCase() === b.toLowerCase()));
  const messages: string[] = [];
  let lucidError: string | null = null;
  for (const source of todo) {
    const [row] = await db.insert(S).values({ tenantId, brand: b, source }).returning({ id: S.id });
    if (source === "lucid") {
      const r = await runSource(tenantId, b, source, row.id, opts);
      if (r.ok) messages.push(`Verpackungsregister: ${r.message}`);
      else lucidError = r.message;
    } else {
      void runSource(tenantId, b, source, row.id, opts);
    }
  }
  const bg = todo.filter((s) => s !== "lucid");
  if (bg.length) messages.push(`${bg.map((s) => SOURCE_NAMES[s]).join(", ")} ${bg.length > 1 ? "laufen" : "läuft"} im Hintergrund.`);
  if (!todo.length) messages.push("Diese Suche läuft schon.");
  return { message: [lucidError, ...messages].filter(Boolean).join(" · "), lucidError };
}

const SOURCE_NAMES: Record<LeadSource, string> = { lucid: "Verpackungsregister", amazon: "Amazon-Verkäufer", ebay: "eBay-Verkäufer", gpsr: "GPSR", web: "KI-Websuche" };

async function runSource(tenantId: string, brand: string, source: LeadSource, searchId: string, opts: { onlyActive: boolean }): Promise<{ ok: boolean; message: string }> {
  try {
    let found = 0;
    let created = 0;
    let message: string;
    if (source === "lucid") {
      const r = await importFromLucid(tenantId, brand, opts);
      found = r.stored;
      created = r.created;
      message = `${r.total} Einträge zu „${brand}“, ${r.stored} übernommen (${r.created} neu) – Markenlisten werden geladen; Firmen, bei denen „${brand}“ nur Wortteil ist, werden ausgeblendet.`;
    } else {
      const { cands, note } = source === "amazon" ? await amazonCandidates(tenantId, brand) : source === "ebay" ? await ebayCandidates(tenantId, brand) : await webCandidates(tenantId, brand);
      const s = await saveCandidates(tenantId, brand, cands);
      found = cands.length;
      created = s.created;
      message = `${cands.length} Firmen (${s.created} neu${s.merged ? `, ${s.merged} mit vorhandenen zusammengeführt` : ""}) · ${note}`;
    }
    await db.update(S).set({ status: "fertig", message, found, created, finishedAt: new Date() }).where(eq(S.id, searchId));
    return { ok: true, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(S).set({ status: "fehler", message, finishedAt: new Date() }).where(eq(S.id, searchId));
    return { ok: false, message };
  }
}

/** Letzte Suchläufe für die Anzeige. */
export async function recentSearches(tenantId: string, limit = 8) {
  return db.select().from(S).where(eq(S.tenantId, tenantId)).orderBy(desc(S.startedAt)).limit(limit);
}
