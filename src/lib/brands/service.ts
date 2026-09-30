import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude } from "@/lib/ai/claude";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getIntegration } from "@/lib/integrations/store";
import { googleNewsUrl } from "@/lib/research/feeds";
import { fetchFeed } from "@/lib/research/service";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { checklistFor, contentPrompt, ideasPrompt, parseContent, parseIdeas, type BrandProfile } from "./ai";
import { DEFAULT_OCCASIONS, occasionByKey, upcomingOccasions } from "./occasions";

// Marken & Ideen: Markenprofile, KI-Ideen je Anlass, Content-Entwürfe, Planungsaufgaben.

const B = schema.brands;
const I = schema.ideas;
const C = schema.contentPosts;

/** Beim ersten Aufruf die beiden eigenen Marken anlegen (danach frei änderbar). */
export async function ensureDefaultBrands(tenantId: string) {
  const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(B).where(eq(B.tenantId, tenantId));
  if (has.n > 0) return;
  await db
    .insert(B)
    .values([
      {
        tenantId,
        name: "Kulu",
        description: "Schultüten (gefüllt und ungefüllt), amerikanische Süßigkeiten und Themenboxen zu Anlässen wie Halloween, Weihnachten, Ostern, Einschulung.",
        audience: "Eltern und Großeltern (Einschulung, Geschenke), Jugendliche und junge Erwachsene (US-Candy, Trends)",
        priceRange: "15–50 €",
        tone: "bunt, verspielt, überraschend, familienfreundlich",
        occasions: DEFAULT_OCCASIONS.kulu,
        trendTopics: "amerikanische Süßigkeiten Trend\nSüßigkeiten TikTok Trend\nSchultüte Trend\nSnack Box Geschenk",
        color: "#F59E0B",
      },
      {
        tenantId,
        name: "Zeitlux",
        description: "YouTube-Kanal rund um Uhren; eigenes Zubehör: Uhrenarmbänder, Uhrenboxen und Reiseetuis für unterwegs.",
        audience: "Uhren-Enthusiasten und Sammler, Einsteiger mit Automatik- oder Smartwatch",
        priceRange: "20–120 €",
        tone: "sachkundig, hochwertig, ehrlich, nahbar",
        occasions: DEFAULT_OCCASIONS.zeitlux,
        trendTopics: "Uhren Trend\nUhrenarmband\nUhrenbox Reise\nWatches and Wonders",
        color: "#1F5FAE",
      },
    ])
    .onConflictDoNothing();
}

export async function listBrands(tenantId: string) {
  await ensureDefaultBrands(tenantId);
  return db.select().from(B).where(eq(B.tenantId, tenantId)).orderBy(asc(B.name));
}

async function brandOf(tenantId: string, brandId: string) {
  const [b] = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.id, brandId)));
  if (!b) throw new Error("Marke nicht gefunden.");
  return b;
}

async function aiKey(tenantId: string) {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für KI-Vorschläge unter Anbindungen → „KI (Claude)“ einen API-Schlüssel eintragen. Ideen lassen sich auch von Hand anlegen.");
  return { key: ai.apiKey, model: ai.model || undefined };
}

/** Aktuelle Schlagzeilen zu den Trend-Begriffen der Marke (und zum Anlass). */
async function trendHeadlines(topics: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const t of topics.slice(0, 5)) {
    try {
      const f = await fetchFeed(googleNewsUrl(t, 30));
      out.push(...f.items.slice(0, 6).map((i) => `${i.title}${i.source ? ` (${i.source})` : ""}`));
    } catch {
      /* Trends sind nur Anregung */
    }
  }
  return [...new Set(out)];
}

export async function generateIdeas(tenantId: string, userId: string | null, brandId: string, opts: { occasion?: string | null; count?: number; wish?: string }) {
  const b = await brandOf(tenantId, brandId);
  const { key, model } = await aiKey(tenantId);
  const occ = opts.occasion ? occasionByKey(opts.occasion) : null;
  const upcoming = occ ? upcomingOccasions(todayIso(), { [occ.key]: b.occasions[occ.key] ?? occ.leadWeeks })[0] : null;
  const existing = (await db.select({ title: I.title }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.brandId, b.id)))).map((r) => r.title);
  const topics = (b.trendTopics ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (occ) topics.unshift(`${occ.name} ${b.name === "Kulu" ? "Süßigkeiten" : ""} Trend`.replace(/\s+/g, " ").trim());
  const trends = await trendHeadlines(topics);
  const r = await askClaude(key, ideasPrompt({ brand: b as BrandProfile, occasion: upcoming ? { name: upcoming.name, date: upcoming.date } : null, existing, trends, count: opts.count ?? 5, wish: opts.wish }), { model, maxTokens: 4000 });
  const drafts = parseIdeas(r.text);
  if (!drafts.length) throw new Error("Die KI hat keine lesbaren Ideen geliefert – bitte noch einmal versuchen.");
  const launch = upcoming ? addDaysIso(upcoming.date, -14) : null;
  await db.insert(I).values(
    drafts.map((d) => ({
      tenantId,
      brandId: b.id,
      kind: d.kind,
      occasion: occ?.key ?? null,
      title: d.title,
      concept: d.concept || null,
      contents: d.contents,
      targetPrice: d.targetPrice == null ? null : String(d.targetPrice),
      costEstimate: d.costEstimate == null ? null : String(d.costEstimate),
      why: d.why || null,
      sourcing: d.sourcing || null,
      launchDate: launch && launch > todayIso() ? launch : null,
      checklist: checklistFor(d.kind),
      source: "ai" as const,
      createdBy: userId,
    })),
  );
  return drafts.length;
}

export async function generateContent(tenantId: string, input: { ideaId?: string; brandId: string; platform: "tiktok" | "youtube" | "instagram"; count?: number; topic?: string }) {
  const b = await brandOf(tenantId, input.brandId);
  const { key, model } = await aiKey(tenantId);
  let subject = { title: input.topic?.trim() || `${b.name} – Sortiment`, concept: b.description, contents: [] as string[] };
  let occasion: string | null = null;
  if (input.ideaId) {
    const [idea] = await db.select().from(I).where(and(eq(I.tenantId, tenantId), eq(I.id, input.ideaId)));
    if (!idea) throw new Error("Idee nicht gefunden.");
    subject = { title: idea.title, concept: idea.concept, contents: idea.contents };
    occasion = idea.occasion ? (occasionByKey(idea.occasion)?.name ?? null) : null;
  }
  const r = await askClaude(key, contentPrompt({ brand: b as BrandProfile, subject, platform: input.platform, count: input.count ?? 4, occasion }), { model, maxTokens: 4000 });
  const drafts = parseContent(r.text);
  if (!drafts.length) throw new Error("Die KI hat keine lesbaren Content-Ideen geliefert – bitte noch einmal versuchen.");
  await db.insert(C).values(drafts.map((d) => ({ tenantId, brandId: b.id, ideaId: input.ideaId ?? null, platform: input.platform, format: d.format || null, hook: d.hook, script: d.script || null, shots: d.shots, caption: d.caption || null, hashtags: d.hashtags || null, soundIdea: d.soundIdea || null, source: "ai" as const })));
  return drafts.length;
}

/**
 * Täglich: Beginnt für eine Marke die Planungszeit eines Anlasses, entsteht eine Aufgabe
 * (steht damit auch im Kalender) – und mit KI-Schlüssel einmalig fünf Ideen dazu.
 */
export async function refreshBrandPlanning(tenantId: string) {
  // Keine Standardmarken anlegen – nur Firmen, die den Bereich schon nutzen.
  const brands = await db.select().from(B).where(eq(B.tenantId, tenantId));
  const today = todayIso();
  const hasAi = Boolean((await getIntegration(tenantId, "anthropic"))?.apiKey);
  for (const b of brands) {
    for (const u of upcomingOccasions(today, b.occasions)) {
      const taskKey = `brand-plan:${b.id}:${u.key}:${u.date.slice(0, 4)}`;
      const ideas = await db
        .select({ status: I.status, source: I.source, createdAt: I.createdAt })
        .from(I)
        .where(and(eq(I.tenantId, tenantId), eq(I.brandId, b.id), eq(I.occasion, u.key), sql`${I.createdAt} >= ${new Date(Date.parse(u.date) - 365 * 86400_000)}`));
      const decided = ideas.some((i) => ["planned", "in_progress", "live"].includes(i.status));
      if (!u.planning || decided) {
        await resolveSystemTask(db, tenantId, taskKey);
        continue;
      }
      if (hasAi && !ideas.some((i) => i.source === "ai")) {
        await generateIdeas(tenantId, null, b.id, { occasion: u.key, count: 5 }).catch((e) => console.error(`[Marken] Ideen ${b.name}/${u.key}:`, e instanceof Error ? e.message : e));
      }
      const n = (await db.select({ n: sql<number>`count(*)::int` }).from(I).where(and(eq(I.tenantId, tenantId), eq(I.brandId, b.id), eq(I.occasion, u.key), inArray(I.status, ["idea", "review"]))))[0].n;
      const decideBy = addDaysIso(u.date, -Math.max(21, Math.round((u.leadWeeks * 7) / 2)));
      await upsertSystemTask(db, tenantId, taskKey, {
        title: `${b.name}: ${u.name} (${u.date.slice(8, 10)}.${u.date.slice(5, 7)}.) planen – ${n ? `${n} Idee${n === 1 ? "" : "n"} zur Auswahl` : "noch keine Ideen"}`,
        notes: `Noch ${u.daysLeft} Tage bis ${u.name}. Idee auswählen („Geplant“), dann Einkauf, Verpackung, Listing und Content.${u.hint ? ` Hinweis: ${u.hint}.` : ""}`,
        category: "marken",
        priority: u.daysLeft < 30 ? "critical" : "normal",
        link: `/marken?marke=${b.id}&anlass=${u.key}`,
        dueDate: decideBy < today ? today : decideBy,
      });
    }
  }
}
