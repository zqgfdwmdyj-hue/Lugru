import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LeadEvidence } from "@/db/schema";
import { askClaudeWithWeb, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { assertPublicUrl } from "@/lib/suppliers/feed-service";
import { bestEmail, contactLinks, domainFromName, extractEmails, FALLBACK_PATHS, type FoundEmail } from "./email-finder";
import { parseResearch, validEmail } from "./logic";

// E-Mail-Adresse finden: Website ermitteln (vorhanden, aus dem Firmennamen oder per kurzer
// KI-Websuche), dann Startseite, Impressum, Kontakt- und Händlerseiten lesen und die beste
// Adresse für eine Einkaufsanfrage nehmen. Gefundenes steht mit Fundstelle am Kontakt.

const L = schema.supplierLeads;
const MAX_PAGES = 8;
const UA = "Mozilla/5.0 (compatible; Seller-System Kontaktsuche)";

/** Seite laden: nur öffentliche Adressen, Weiterleitungen geprüft, kurzes Zeitlimit, nur HTML. */
async function fetchPage(raw: string): Promise<{ url: string; html: string } | null> {
  let u = assertPublicUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "de-DE,de;q=0.9,en;q=0.5" }, redirect: "manual", signal: AbortSignal.timeout(12_000) });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (next) {
      u = assertPublicUrl(new URL(next, u).toString());
      continue;
    }
    if (!res.ok || !/html|text\/plain/i.test(res.headers.get("content-type") ?? "text/html")) return null;
    const buf = await res.arrayBuffer();
    return { url: u.toString(), html: new TextDecoder().decode(buf.slice(0, 2 * 1024 * 1024)) };
  }
  return null;
}

export type CrawlResult = { reachable: boolean; site: string; pages: string[]; found: FoundEmail[]; contactUrl: string | null };

/** Startseite + Impressum/Kontakt/Händlerseiten (höchstens 8 Seiten). */
export async function crawlForEmails(site: string): Promise<CrawlResult> {
  const pages: string[] = [];
  const found = new Map<string, FoundEmail>();
  let contactUrl: string | null = null;
  let home: { url: string; html: string } | null = null;
  try {
    home = await fetchPage(site);
  } catch {
    home = null;
  }
  if (!home) return { reachable: false, site, pages, found: [], contactUrl: null };
  pages.push(home.url);
  for (const f of extractEmails(home.html, home.url)) found.set(f.email, f);
  const origin = new URL(home.url).origin;
  const links = contactLinks(home.html, home.url);
  const queue = [...links, ...(links.length < 2 ? FALLBACK_PATHS.map((p) => origin + p) : [])].filter((x, i, a) => a.indexOf(x) === i && x !== home!.url);
  for (const url of queue) {
    if (pages.length >= MAX_PAGES) break;
    let page: { url: string; html: string } | null = null;
    try {
      page = await fetchPage(url);
    } catch {
      page = null;
    }
    if (!page) continue;
    pages.push(page.url);
    if (!contactUrl && /kontakt|contact/i.test(page.url)) contactUrl = page.url;
    for (const f of extractEmails(page.html, page.url)) if (!found.has(f.email)) found.set(f.email, f);
    // Gute Adresse der eigenen Domain im Impressum/Kontakt gefunden → reicht.
    const best = bestEmail([...found.values()], home.url);
    if (best && /impressum|imprint|kontakt|contact/i.test(best.page) && best.email.endsWith(new URL(home.url).hostname.replace(/^www\./, "").split(".").slice(-2).join("."))) break;
  }
  contactUrl ??= pages.find((p) => /impressum|imprint/i.test(p)) ?? null;
  return { reachable: true, site: home.url, pages, found: [...found.values()], contactUrl };
}

const pageLabel = (url: string) => {
  const p = new URL(url).pathname.toLowerCase();
  return /impressum|imprint|legal/.test(p) ? "Impressum" : /kontakt|contact/.test(p) ? "Kontaktseite" : p === "/" || p === "" ? "Startseite" : p;
};

function websitePrompt(l: { companyName: string; street: string | null; zip: string | null; city: string | null; country: string | null; phone: string | null }) {
  return [
    `Finde die offizielle Website und die geschäftliche E-Mail-Adresse dieser Firma (Impressum/Kontaktseite):`,
    `Firma: ${l.companyName}`,
    `Adresse: ${[l.street, [l.zip, l.city].filter(Boolean).join(" "), l.country].filter(Boolean).join(", ") || "unbekannt"}`,
    l.phone ? `Telefon: ${l.phone}` : "",
    "Nur die Website genau dieser Firma (Name und Ort passen), keine Verzeichnisse wie Firmenwissen, North Data, Gelbe Seiten. E-Mail nur, wenn sie in den Suchergebnissen steht – nichts erfinden.",
    'Antworte NUR mit JSON: {"website":"https://…","email":"…","summary":"1 Satz"}',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * E-Mail für einen Kontakt suchen. `ai`: Ist keine Website bekannt, fragt eine kurze KI-Websuche
 * nach der Website (ca. 1–3 Cent). Ergebnis und geprüfte Seiten stehen als Beleg am Kontakt.
 */
export async function findEmailFor(tenantId: string, id: string, opts: { ai: boolean }) {
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, tenantId)));
  if (!l) return null;
  const sites: string[] = [];
  // Bekannte Adresse so nehmen, wie sie ist (kann eine Unterseite sein); B2B-Link und Domain aus dem Namen als Startseite.
  const add = (u: string | null | undefined, originOnly: boolean) => {
    if (!u) return;
    try {
      const x = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
      const v = originOnly ? x.origin : x.toString();
      if (!sites.includes(v)) sites.push(v);
    } catch {
      // kein Link
    }
  };
  add(l.website, false);
  add(l.b2bUrl, true);
  add(domainFromName(l.companyName), true);
  let crawl: CrawlResult | null = null;
  for (const s of sites) {
    crawl = await crawlForEmails(s);
    if (crawl.reachable) break;
  }
  let aiEmail: string | null = null;
  let aiSite: string | null = null;
  if ((!crawl?.reachable || !bestEmail(crawl.found, crawl.site)) && opts.ai) {
    const ai = await getIntegration(tenantId, "anthropic");
    if (ai?.apiKey) {
      try {
        const r = await askClaudeWithWeb(ai.apiKey, websitePrompt(l), { model: modelFor(ai, "simple"), maxSearches: 3, maxTokens: 700 });
        const p = parseResearch(r.text);
        aiSite = p?.website ?? null;
        aiEmail = p?.email ?? null;
        if (aiSite && !sites.includes(aiSite)) {
          const c = await crawlForEmails(aiSite);
          if (c.reachable) crawl = c;
        }
      } catch {
        // Websuche nicht möglich – Ergebnis der Website-Suche zählt.
      }
    }
  }
  const best = crawl ? bestEmail(crawl.found, crawl.site) : null;
  const email = best?.email ?? (validEmail(aiEmail) ? aiEmail : null);
  const checked = crawl?.reachable
    ? `${new URL(crawl.site).hostname.replace(/^www\./, "")} (${crawl.pages.map((p, i) => (i === 0 ? "Startseite" : pageLabel(p))).filter((x, i, a) => a.indexOf(x) === i).join(", ")})`
    : sites.length || aiSite ? "Website nicht erreichbar" : "keine Website gefunden";
  const evidence: LeadEvidence = email
    ? best
      ? { label: "E-Mail gefunden", value: `${best.email} – ${pageLabel(best.page)} von ${new URL(best.page).hostname.replace(/^www\./, "")}${best.how === "Text" || best.how === "Link" ? "" : ` (${best.how})`}`, url: best.page }
      : { label: "E-Mail gefunden", value: `${email} – laut Websuche (auf der Website nicht bestätigt)` }
    : { label: "E-Mail-Suche", value: `keine Adresse gefunden – geprüft: ${checked}`, ...(crawl?.contactUrl ? { url: crawl.contactUrl } : {}) };
  const [cur] = await db.select().from(L).where(eq(L.id, id));
  await db
    .update(L)
    .set({
      email: cur.email && validEmail(cur.email) ? cur.email : email,
      website: cur.website ?? (crawl?.reachable ? crawl.site : aiSite),
      contactUrl: crawl?.contactUrl ?? cur.contactUrl,
      emailSearchedAt: new Date(),
      evidence: [...cur.evidence.filter((e) => e.label !== "E-Mail gefunden" && e.label !== "E-Mail-Suche"), evidence].slice(-12),
      busy: cur.busy === "email" ? null : cur.busy,
      updatedAt: new Date(),
    })
    .where(eq(L.id, id));
  return { email, checked };
}

/** Für ausgewählte Kontakte ohne E-Mail im Hintergrund suchen (je 3 gleichzeitig). */
export async function startEmailSearch(tenantId: string, ids: string[], opts: { onlyNew?: boolean } = {}) {
  const candidates = (
    await db
      .select({ id: L.id, email: L.email })
      .from(L)
      .where(and(eq(L.tenantId, tenantId), inArray(L.id, ids), isNull(L.busy), isNull(L.mailedAt), ...(opts.onlyNew ? [isNull(L.emailSearchedAt)] : [])))
  ).filter((l) => !validEmail(l.email));
  if (!candidates.length) return 0;
  // Atomar belegen – zwei schnelle Aufrufe (Doppelklick, Neuladen) starten nie zwei Suchen.
  const claimed = await db
    .update(L)
    .set({ busy: "email" })
    .where(and(eq(L.tenantId, tenantId), inArray(L.id, candidates.map((c) => c.id)), isNull(L.busy), ...(opts.onlyNew ? [isNull(L.emailSearchedAt)] : [])))
    .returning({ id: L.id });
  if (!claimed.length) return 0;
  const queue = claimed.map((r) => r.id);
  void Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        await findEmailFor(tenantId, id, { ai: true }).catch(async () => {
          await db.update(L).set({ busy: null, emailSearchedAt: new Date() }).where(eq(L.id, id));
        });
      }
    }),
  );
  return claimed.length;
}
