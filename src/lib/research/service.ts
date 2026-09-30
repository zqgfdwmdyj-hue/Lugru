import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { modelFor } from "@/lib/ai/claude";
import { upsertSystemTask } from "@/lib/tasks/system";
import { googleNewsUrl, parseFeed, titleKey, type FeedItem } from "./feeds";
import { summarize } from "./summary";

// Themen-Recherche: alle paar Tage neue Meldungen zu den eingestellten Themen suchen und als
// Einträge in der Wissensdatenbank ablegen (Kategorie „Recherche", je Thema und Lauf einer).

export const DEFAULT_TOPICS = [
  "E-Commerce Trends",
  "Amazon Private Label",
  "Amazon Seller Central Änderungen",
  "eBay Händler Neuigkeiten",
  "Online-Handel Recht Steuern",
  "Immobilien Investment",
  "Aktien ETF Börse",
];
export const DEFAULT_INTERVAL_DAYS = 3;
/** Je Thema und Lauf höchstens so viele neue Artikel – der Eintrag soll lesbar bleiben. */
const MAX_PER_TOPIC = 12;

export type ResearchSettings = { topics: string[]; feeds: string[]; intervalDays: number; lastRun: string | null; lastError: string | null };

export async function getResearchSettings(tenantId: string): Promise<ResearchSettings> {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const r = t?.settings.research ?? {};
  return {
    topics: r.topics ?? DEFAULT_TOPICS,
    feeds: r.feeds ?? [],
    intervalDays: r.intervalDays ?? DEFAULT_INTERVAL_DAYS,
    lastRun: r.lastRun ?? null,
    lastError: r.lastError ?? null,
  };
}

export async function saveResearchSettings(tenantId: string, patch: Partial<ResearchSettings>) {
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('research', coalesce(${schema.tenants.settings}->'research', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)` })
    .where(eq(schema.tenants.id, tenantId));
}

export async function fetchFeed(url: string): Promise<{ title: string | null; items: FeedItem[] }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Seller-System Recherche)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

const de = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }) : "");

export type ResearchResult = { topics: number; newItems: number; entries: number; errors: string[] };

/** Ein Lauf: alle Themen und eigenen Feeds abfragen, Neues ablegen. */
export async function runResearch(tenantId: string, fetcher = fetchFeed): Promise<ResearchResult> {
  const s = await getResearchSettings(tenantId);
  const ai = await getIntegration(tenantId, "anthropic");
  const sources: { topic: string; url: string }[] = [
    ...s.topics.map((topic) => ({ topic, url: googleNewsUrl(topic, s.intervalDays + 1) })),
    ...s.feeds.map((url) => ({ topic: "", url })),
  ];
  const R = schema.researchItems;
  const K = schema.knowledgeEntries;
  const result: ResearchResult = { topics: sources.length, newItems: 0, entries: 0, errors: [] };
  const today = de(new Date().toISOString());

  for (const src of sources) {
    let feed;
    try {
      feed = await fetcher(src.url);
    } catch (e) {
      result.errors.push(`${src.topic || src.url}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const topic = src.topic || feed.title || new URL(src.url).hostname;
    // Bekannt ist, was schon da war – per Adresse oder gleichem Titel (dieselbe Meldung bei mehreren Quellen).
    const candidates = feed.items
      .filter((i) => !i.published || Date.now() - Date.parse(i.published) < (s.intervalDays + 7) * 86400_000)
      .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
    if (candidates.length === 0) continue;
    const keys = candidates.map((i) => titleKey(i.title));
    const known = await db
      .select({ url: R.url, titleKey: R.titleKey })
      .from(R)
      .where(and(eq(R.tenantId, tenantId), sql`(${R.url} in (${sql.join(candidates.map((i) => sql`${i.link}`), sql`, `)}) or ${R.titleKey} in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}))`));
    const seenUrl = new Set(known.map((k) => k.url));
    const seenTitle = new Set(known.map((k) => k.titleKey));
    const fresh: FeedItem[] = [];
    const overflow: FeedItem[] = [];
    for (const i of candidates) {
      const k = titleKey(i.title);
      if (seenUrl.has(i.link) || seenTitle.has(k)) continue;
      seenTitle.add(k);
      // Über der Grenze: als gesehen merken, damit sie beim nächsten Lauf nicht „neu" nachtröpfeln.
      (fresh.length < MAX_PER_TOPIC ? fresh : overflow).push(i);
    }
    if (fresh.length === 0) continue;

    let summary = "";
    if (ai?.apiKey) {
      try {
        summary = await summarize(ai.apiKey, { topic, items: fresh }, modelFor(ai, "simple"));
      } catch (e) {
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    const list = fresh
      .map((a, i) => `[${i + 1}] ${a.title}\n${[a.source, de(a.published)].filter(Boolean).join(" · ")}\n${a.snippet ? `${a.snippet}\n` : ""}${a.link}`)
      .join("\n\n");
    const more = overflow.length ? `\n\n… und ${overflow.length} weitere Meldungen (Liste unter Wissen → Themen-Recherche).` : "";
    const body = [summary ? `ZUSAMMENFASSUNG (KI)\n${summary}` : null, `NEUE ARTIKEL (${fresh.length})\n\n${list}${more}`, `Automatisch gefunden am ${today} · Thema „${topic}". Nützliches gern in einen eigenen Eintrag übernehmen.`]
      .filter(Boolean)
      .join("\n\n");
    const [entry] = await db
      .insert(K)
      .values({ tenantId, kind: "article", category: "Recherche", title: `${topic} – neu am ${today}`, body, tags: ["recherche", topic.toLowerCase()] })
      .returning({ id: K.id });
    await db
      .insert(R)
      .values([...fresh, ...overflow].map((i, n) => ({ tenantId, topic, url: i.link, title: i.title, titleKey: titleKey(i.title), source: i.source, publishedAt: i.published ? new Date(i.published) : null, snippet: i.snippet || null, knowledgeId: n < fresh.length ? entry.id : null })))
      .onConflictDoNothing();
    result.newItems += fresh.length;
    result.entries++;
  }

  await saveResearchSettings(tenantId, { lastRun: new Date().toISOString(), lastError: result.errors.length ? result.errors.slice(0, 3).join(" | ") : null });
  if (result.entries > 0) {
    await upsertSystemTask(db, tenantId, "research-new", {
      title: `Recherche: ${result.newItems} neue Artikel zu ${result.entries} ${result.entries === 1 ? "Thema" : "Themen"} in der Wissensdatenbank`,
      notes: "Lesen und Wichtiges in eigene Einträge übernehmen.",
      category: "eigene",
      priority: "low",
      link: "/wissen?kat=Recherche",
    });
  }
  return result;
}

/** Für den Hintergrund-Takt: nur laufen, wenn der letzte Lauf lange genug her ist. */
export async function runResearchIfDue(tenantId: string): Promise<ResearchResult | null> {
  const s = await getResearchSettings(tenantId);
  if (s.topics.length === 0 && s.feeds.length === 0) return null;
  if (s.lastRun && Date.now() - Date.parse(s.lastRun) < s.intervalDays * 86400_000 - 30 * 60_000) return null;
  return runResearch(tenantId);
}

export async function recentResearch(tenantId: string, limit = 30) {
  const R = schema.researchItems;
  return db.select().from(R).where(eq(R.tenantId, tenantId)).orderBy(desc(R.createdAt), desc(R.publishedAt)).limit(limit);
}
