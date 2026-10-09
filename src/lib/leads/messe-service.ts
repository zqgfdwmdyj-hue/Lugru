import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { getIntegration } from "@/lib/integrations/store";
import { fetchFollow } from "@/lib/suppliers/feed-service";
import { assessFinding, nameKey, validEmail } from "./logic";
import {
  chunkText,
  exhibitorPrompt,
  fairFromTitle,
  htmlLines,
  iawFairName,
  iawPageUrls,
  isIawDirectory,
  matchesCategories,
  normUrl,
  parseExhibitorJson,
  parseIawDetail,
  parseIawList,
  parseMessePayload,
  type Exhibitor,
} from "./messe";
import { saveCandidates, type Candidate } from "./sources";

// Messe-Ausstellerverzeichnisse → Kontakte (Quelle „Messe“). IAW wird direkt gelesen (Liste, alle
// Seiten, Detailseiten mit Anschrift/Web/Kontakt-E-Mail), andere Verzeichnisse per KI aus dem Text.
// Läuft im Hintergrund, der Stand steht bei den Suchläufen.

const S = schema.supplierLeadSearches;
const PAUSE_MS = Number(process.env.MESSE_PAUSE_MS ?? 700);
const MAX_PAGES = 30;
const MAX_DETAILS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getHtml(url: string): Promise<string> {
  const res = await fetchFollow(url, { Accept: "text/html,application/xhtml+xml", "Accept-Language": "de-DE,de;q=0.9,en;q=0.5" });
  if (!res.ok) throw new Error(res.status === 403 ? "Die Messeseite blockt Abrufe vom Server (HTTP 403) – bitte über das Lesezeichen im Browser auslesen." : `Messeseite nicht erreichbar (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 8 * 1024 * 1024) throw new Error("Seite größer als 8 MB.");
  return new TextDecoder().decode(buf);
}

export type FairOptions = { fairName?: string; details: boolean; categories: string };

/** Link zum Ausstellerverzeichnis → Suchlauf im Hintergrund. */
export async function startFairImport(tenantId: string, url: string, opts: FairOptions) {
  const u = new URL(url);
  const [row] = await db.insert(S).values({ tenantId, brand: opts.fairName?.trim() || u.hostname.replace(/^www\./, ""), source: "messe", message: "liest die Ausstellerliste …" }).returning({ id: S.id });
  void runFairImport(tenantId, row.id, url, opts);
  return row.id;
}

async function progress(id: string, message: string) {
  await db.update(S).set({ message }).where(eq(S.id, id));
}

async function runFairImport(tenantId: string, searchId: string, url: string, opts: FairOptions) {
  try {
    const first = await getHtml(url);
    let fair = opts.fairName?.trim() || "";
    let list: Exhibitor[];
    if (isIawDirectory(first)) {
      fair ||= iawFairName(first);
      list = parseIawList(first, url);
      const pages = iawPageUrls(first, url).slice(0, MAX_PAGES);
      for (let i = 0; i < pages.length; i++) {
        await progress(searchId, `liest Seite ${i + 2} von ${pages.length + 1} …`);
        await sleep(PAUSE_MS);
        list.push(...parseIawList(await getHtml(pages[i]), pages[i]));
      }
      list = [...new Map(list.map((e) => [e.detailUrl ?? e.name, e])).values()];
      if (opts.details) {
        const todo = list.slice(0, MAX_DETAILS);
        for (let i = 0; i < todo.length; i++) {
          if (!todo[i].detailUrl) continue;
          if (i % 10 === 0) await progress(searchId, `${list.length} Aussteller – lade Details ${i + 1} von ${todo.length} …`);
          await sleep(PAUSE_MS);
          try {
            const d = parseIawDetail(await getHtml(todo[i].detailUrl!));
            Object.assign(todo[i], Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))));
          } catch {
            // Einzelne Detailseite fehlt – Aussteller bleibt mit Name und Stand.
          }
        }
      }
    } else {
      const title = /<title>([^<]+)<\/title>/i.exec(first)?.[1]?.trim() ?? "";
      fair ||= fairFromTitle(title) || new URL(url).hostname;
      const pages = [first, ...(await followPages(first, url, searchId))];
      const text = pages.map((h) => htmlLines(h).join("\n")).join("\n");
      const links = pages.flatMap((h) => pageLinks(h, url));
      if (text.length < 400) throw new Error("Auf der Seite stehen keine Aussteller – sie werden vermutlich per JavaScript geladen. Bitte über das Lesezeichen „→ Seller-System Messe“ im Browser auslesen.");
      list = await aiExhibitors(tenantId, fair, text, links, searchId);
      if (opts.details) await genericDetails(list, url, searchId);
    }
    const r = await saveExhibitors(tenantId, fair, list, opts.categories);
    await db.update(S).set({ brand: fair, status: "fertig", message: r.message, found: r.found, created: r.created, finishedAt: new Date() }).where(eq(S.id, searchId));
  } catch (e) {
    await db.update(S).set({ status: "fehler", message: e instanceof Error ? e.message : String(e), finishedAt: new Date() }).where(eq(S.id, searchId));
  }
}

/** Weitere Seiten einer Liste: rel="next" bzw. „weiter/›/»/next“-Links auf derselben Seite. */
async function followPages(html: string, url: string, searchId: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set([url]);
  let cur = html;
  let curUrl = url;
  for (let i = 0; i < MAX_PAGES; i++) {
    const next = nextLink(cur, curUrl);
    if (!next || seen.has(next)) break;
    seen.add(next);
    await progress(searchId, `liest Seite ${i + 2} …`);
    await sleep(PAUSE_MS);
    cur = await getHtml(next);
    curUrl = next;
    out.push(cur);
  }
  return out;
}

function nextLink(html: string, base: string): string | null {
  const rel = /<a[^>]+rel="next"[^>]+href="([^"]+)"|<a[^>]+href="([^"]+)"[^>]+rel="next"/i.exec(html);
  const cand = rel?.[1] ?? rel?.[2] ?? [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>\s*(?:weiter|nächste|next|›|»|&raquo;|&rsaquo;)\s*<\/a>/gi)][0]?.[1];
  if (!cand) return null;
  try {
    const u = new URL(cand.replace(/&amp;/g, "&"), base);
    return u.hostname === new URL(base).hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

function pageLinks(html: string, base: string): { t: string; h: string }[] {
  return [...html.matchAll(/<a[^>]+href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .flatMap((m) => {
      const t = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      try {
        return t && t.length < 120 ? [{ t, h: new URL(m[1].replace(/&amp;/g, "&"), base).toString() }] : [];
      } catch {
        return [];
      }
    })
    .slice(0, 3000);
}

async function aiExhibitors(tenantId: string, fair: string, text: string, links: { t: string; h: string }[], searchId: string | null): Promise<Exhibitor[]> {
  const ai = await getIntegration(tenantId, "anthropic");
  if (!ai?.apiKey) throw new Error("Für andere Messen als die IAW liest die KI die Liste – bitte unter Anbindungen → KI (Claude) einen Schlüssel eintragen.");
  const chunks = chunkText(text, 14_000).slice(0, 25);
  const out: Exhibitor[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (searchId) await progress(searchId, `KI liest die Aussteller (${i + 1} von ${chunks.length}) …`);
    // Nur Links, deren Text im Stück vorkommt – hält die Anfrage klein.
    const part = links.filter((l) => chunks[i].includes(l.t)).slice(0, 400);
    const r = await askClaude(ai.apiKey, exhibitorPrompt(fair, chunks[i], part), { model: modelFor(ai, "simple"), maxTokens: 8000, timeoutMs: 180_000 });
    out.push(...parseExhibitorJson(r.text));
  }
  return [...new Map(out.map((e) => [nameKey(e.name), e])).values()];
}

/** Detailseiten anderer Verzeichnisse ohne KI: E-Mail, Website, Telefon aus dem Text. */
async function genericDetails(list: Exhibitor[], base: string, searchId: string) {
  const host = new URL(base).hostname;
  const todo = list.filter((e) => e.detailUrl && new URL(e.detailUrl).hostname === host && (!e.email || !e.website)).slice(0, MAX_DETAILS);
  for (let i = 0; i < todo.length; i++) {
    if (i % 10 === 0) await progress(searchId, `lade Details ${i + 1} von ${todo.length} …`);
    await sleep(PAUSE_MS);
    try {
      const html = await getHtml(todo[i].detailUrl!);
      const mail = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase()).find((m) => validEmail(m) && !m.endsWith(`@${host.replace(/^www\./, "")}`));
      todo[i].email ??= mail ?? null;
      const site = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]).find((h) => {
        const hh = new URL(h).hostname;
        return hh !== host && !/facebook|instagram|linkedin|twitter|x\.com|youtube|google|xing|tiktok|pinterest|whatsapp/.test(hh);
      });
      todo[i].website ??= normUrl(site);
      todo[i].phone ??= /(?:Tel(?:efon)?|Phone)[.:]?\s*([+\d][\d\s/().-]{6,})/i.exec(htmlLines(html).join("\n"))?.[1]?.trim() ?? null;
    } catch {
      // weiter mit dem nächsten
    }
  }
}

/** Aussteller → Kontakte (zusammengeführt mit vorhandenen Firmen). */
async function saveExhibitors(tenantId: string, fair: string, list: Exhibitor[], categories: string) {
  const kept = list.filter((e) => matchesCategories(e, categories));
  const cands: Candidate[] = kept.map((e) => {
    const a = assessFinding({ companyName: e.name, source: "messe", email: e.email, searchBrand: "", fair, categories: e.categories, description: e.description });
    const detail = [fair, e.booth, e.categories.slice(0, 4).join(", ")].filter(Boolean).join(" · ");
    return {
      source: "messe",
      sourceId: nameKey(e.name),
      companyName: e.name,
      street: e.street,
      zip: e.zip,
      city: e.city,
      country: e.country,
      phone: e.phone,
      email: e.email,
      website: e.website,
      kind: a.kind,
      score: a.score,
      reasons: a.reasons,
      evidence: [
        { label: "Messe-Aussteller", value: detail, ...(e.detailUrl ? { url: e.detailUrl } : {}) },
        ...(e.description ? [{ label: "Selbstbeschreibung", value: e.description.slice(0, 300) }] : []),
      ],
      finding: { source: "messe", label: `Messe: ${fair}`, detail, url: e.detailUrl ?? undefined },
    };
  });
  const s = await saveCandidates(tenantId, "", cands);
  const withMail = kept.filter((e) => e.email).length;
  return {
    found: kept.length,
    created: s.created,
    message: `${kept.length} Aussteller${list.length !== kept.length ? ` (von ${list.length}, nach Kategorie gefiltert)` : ""} – ${s.created} neu${s.merged ? `, ${s.merged} mit vorhandenen zusammengeführt` : ""} · ${withMail} mit E-Mail`,
  };
}

/** Daten vom Messe-Lesezeichen oder eingefügter Text. */
export async function importFairData(tenantId: string, raw: string, opts: FairOptions) {
  const p = parseMessePayload(raw);
  const text = p?.text ?? raw.trim();
  if (text.length < 40) throw new Error("Zu wenig Text – auf der Messeseite Strg+A, Strg+C und hier einfügen, oder das Lesezeichen nutzen.");
  const fair = opts.fairName?.trim() || fairFromTitle(p?.title) || (p?.url ? new URL(p.url).hostname : "Messe");
  const [row] = await db.insert(S).values({ tenantId, brand: fair, source: "messe", message: "KI liest die Aussteller …" }).returning({ id: S.id });
  void (async () => {
    try {
      const list = await aiExhibitors(tenantId, fair, text, p?.links ?? [], row.id);
      const r = await saveExhibitors(tenantId, fair, list, opts.categories);
      await db.update(S).set({ status: "fertig", message: r.message, found: r.found, created: r.created, finishedAt: new Date() }).where(eq(S.id, row.id));
    } catch (e) {
      await db.update(S).set({ status: "fehler", message: e instanceof Error ? e.message : String(e), finishedAt: new Date() }).where(eq(S.id, row.id));
    }
  })();
  return fair;
}
