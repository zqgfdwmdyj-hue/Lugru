import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, notExists, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { askClaude } from "@/lib/ai/claude";
import { addDaysIso, todayIso } from "@/lib/dates";
import { notifyDiscord } from "@/lib/integrations/clients/discord";
import { getIntegration } from "@/lib/integrations/store";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { BATCH_SIZE, categoryLabel, MAX_TOKENS, noiseReason, parseTriage, todosClosedBy, triageByRules, triagePrompt, type TriageMail, type TriageResult } from "./logic";

// Amazon-ToDos: Amazon-Systemmails aus allen verbundenen Postfächern einstufen und als Aufgaben
// mit Frist führen. Läuft nach jedem Postfach-Abruf; die Erledigung passiert im Seller Central.

const T = schema.amazonTodos;
const SEEN = schema.amazonMailSeen;
const E = schema.emails;

export type RunResult = { checked: number; created: number; irrelevant: number; filtered: number; high: number; closedAuto: number; errors: string[]; ai: boolean };

const running = new Map<string, Promise<RunResult>>();

/** Ein Lauf je Firma zur Zeit – ein zweiter Aufruf bekommt den laufenden. */
export function runAmazonTodos(tenantId: string, opts: { sinceDays?: number; max?: number } = {}): Promise<RunResult> {
  const cur = running.get(tenantId);
  if (cur) return cur;
  const p = runOnce(tenantId, opts.sinceDays ?? 3, opts.max ?? 40).finally(() => running.delete(tenantId));
  running.set(tenantId, p);
  return p;
}

export const isRunning = (tenantId: string) => running.has(tenantId);

async function runOnce(tenantId: string, sinceDays: number, max: number): Promise<RunResult> {
  const result: RunResult = { checked: 0, created: 0, irrelevant: 0, filtered: 0, high: 0, closedAuto: 0, errors: [], ai: false };
  const since = new Date(Date.now() - sinceDays * 86400_000);
  // Bekannte Mails (schon Aufgabe oder schon verworfen) überspringen.
  const candidates = await db
    .select({ id: E.id, key: E.messageKey, fromAddress: E.fromAddress, fromName: E.fromName, subject: E.subject, receivedAt: E.receivedAt, body: E.bodyText })
    .from(E)
    .where(
      and(
        eq(E.tenantId, tenantId),
        gte(E.receivedAt, since),
        ilike(E.fromAddress, "%amazon.%"),
        notExists(db.select({ x: sql`1` }).from(T).where(and(eq(T.tenantId, tenantId), eq(T.messageKey, E.messageKey)))),
        notExists(db.select({ x: sql`1` }).from(SEEN).where(and(eq(SEEN.tenantId, tenantId), eq(SEEN.messageKey, E.messageKey)))),
      ),
    )
    .orderBy(desc(E.receivedAt))
    .limit(500);
  result.checked = candidates.length;

  // 1. Grobfilter ohne KI.
  const noise = candidates.map((c) => ({ c, reason: noiseReason({ from: `${c.fromName ?? ""} <${c.fromAddress ?? ""}>`, subject: c.subject ?? "" }) }));
  const filtered = noise.filter((n) => n.reason);
  if (filtered.length) {
    await db.insert(SEEN).values(filtered.map((n) => ({ tenantId, messageKey: n.c.key, reason: `Grobfilter: ${n.reason}` }))).onConflictDoNothing();
    result.filtered = filtered.length;
  }
  const todo = noise.filter((n) => !n.reason).map((n) => n.c).slice(0, max);
  if (todo.length === 0) {
    await refreshTodoTask(tenantId);
    return result;
  }

  // 2. Einstufen – mit KI in Blöcken, sonst nach Regeln.
  const mails: TriageMail[] = todo.map((c) => ({ key: c.key, from: `${c.fromName ?? ""} <${c.fromAddress ?? ""}>`.trim(), subject: c.subject ?? "", date: c.receivedAt.toISOString(), text: c.body ?? "" }));
  const ai = await getIntegration(tenantId, "anthropic");
  const results: TriageResult[] = [];
  if (ai?.apiKey) {
    result.ai = true;
    for (let i = 0; i < mails.length; i += BATCH_SIZE) {
      const batch = mails.slice(i, i + BATCH_SIZE);
      try {
        const r = await askClaude(ai.apiKey, triagePrompt(batch), { model: ai.model || undefined, maxTokens: MAX_TOKENS });
        const parsed = parseTriage(r.text, batch);
        if (parsed.length < batch.length) console.warn(`[Amazon-ToDos] KI-Block unvollständig: ${parsed.length}/${batch.length} – Rest beim nächsten Lauf.`);
        results.push(...parsed);
      } catch (e) {
        // Block bleibt unbekannt und kommt beim nächsten Lauf erneut dran.
        result.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  } else {
    results.push(...mails.map(triageByRules));
  }

  // 3. Speichern.
  const byKey = new Map(todo.map((c) => [c.key, c]));
  const created: (typeof T.$inferSelect)[] = [];
  for (const r of results) {
    const mail = byKey.get(r.key);
    if (!mail) continue;
    if (!r.relevant) {
      await db.insert(SEEN).values({ tenantId, messageKey: r.key, reason: "KI: nicht relevant" }).onConflictDoNothing();
      result.irrelevant++;
      continue;
    }
    const [row] = await db
      .insert(T)
      .values({
        tenantId,
        messageKey: r.key,
        emailId: mail.id,
        receivedAt: mail.receivedAt,
        sender: mail.fromName || mail.fromAddress,
        subject: mail.subject,
        category: r.category,
        priority: r.priority,
        deadline: r.deadline,
        asins: r.asins,
        summary: r.summary,
        bodyShort: (mail.body ?? "").slice(0, 1500),
        status: r.actionNeeded ? "open" : "done",
        infoOnly: !r.actionNeeded,
        closedBy: r.actionNeeded ? null : "nur Info",
        closedAt: r.actionNeeded ? null : new Date(),
        source: result.ai ? "ai" : "rules",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    created.push(row);
    result.created++;
    if (row.status === "open" && row.priority === "high") result.high++;
  }

  // 4. Freigabe-Mails erledigen ältere Aufgaben zur selben ASIN.
  for (const info of created.filter((c) => c.category === "freigabe_info" && c.asins.length)) {
    result.closedAuto += await autoClose(tenantId, info);
  }

  // 5. Neue Aufgaben mit hoher Priorität sofort melden.
  const high = created.filter((c) => c.status === "open" && c.priority === "high");
  if (high.length) {
    const base = (process.env.APP_URL || "").replace(/\/$/, "");
    const lines = high.slice(0, 8).map((c) => `• **${categoryLabel(c.category)}**${c.deadline ? ` (Frist ${fmt(c.deadline)})` : ""}: ${c.summary ?? c.subject}${c.asins.length ? ` – ${c.asins.slice(0, 3).join(", ")}` : ""}`);
    await notifyDiscord(tenantId, [`📋 **${high.length} neue Amazon-ToDo${high.length === 1 ? "" : "s"} mit hoher Priorität**`, ...lines, high.length > 8 ? `… und ${high.length - 8} weitere` : "", base ? `${base}/amazon-todos` : ""].filter(Boolean).join("\n"));
  }

  await refreshTodoTask(tenantId);
  if (result.created || result.irrelevant) console.log(`[Amazon-ToDos] ${JSON.stringify({ geprueft: result.checked, neu: result.created, irrelevant: result.irrelevant, gefiltert: result.filtered, hochprio: result.high, auto_erledigt: result.closedAuto })}`);
  return result;
}

const fmt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

async function autoClose(tenantId: string, info: typeof T.$inferSelect): Promise<number> {
  const open = await db
    .select({ id: T.id, category: T.category, asins: T.asins, receivedAt: T.receivedAt })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), sql`${T.asins} ?| ${sql.raw(`array[${info.asins.map((a) => `'${a.replace(/[^A-Z0-9]/g, "")}'`).join(",")}]`)}`));
  const ids = todosClosedBy(
    { category: info.category, asins: info.asins, receivedAt: info.receivedAt.toISOString() },
    open.map((o) => ({ ...o, receivedAt: o.receivedAt.toISOString() })),
  );
  if (!ids.length) return 0;
  await db
    .update(T)
    .set({ status: "done", closedAt: new Date(), closedBy: `automatisch: ${info.summary ?? info.subject ?? "Freigabe"} (${info.receivedAt.toLocaleDateString("de-DE")})`, updatedAt: new Date() })
    .where(and(eq(T.tenantId, tenantId), inArray(T.id, ids)));
  return ids.length;
}

/** Eine Sammelaufgabe auf der Startseite statt Hunderter Einzelaufgaben. */
export async function refreshTodoTask(tenantId: string) {
  const s = await todoStats(tenantId);
  if (s.open === 0) {
    await resolveSystemTask(db, tenantId, "amazon-todos");
    return;
  }
  const [next] = await db
    .select({ d: T.deadline })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), isNotNull(T.deadline), gte(T.deadline, todayIso())))
    .orderBy(asc(T.deadline))
    .limit(1);
  await upsertSystemTask(db, tenantId, "amazon-todos", {
    title: `Amazon-ToDos: ${s.open} offen (${s.high} hoch)${s.dueSoon ? `, ${s.dueSoon} mit Frist ≤ 7 Tage` : ""}${s.overdue ? `, ${s.overdue} Frist abgelaufen` : ""}`,
    notes: "Im Seller Central erledigen und in der Liste abhaken.",
    priority: s.dueSoon || s.overdue ? "critical" : "normal",
    category: "amazon",
    link: "/amazon-todos",
    dueDate: next?.d ?? null,
  });
}

export async function todoStats(tenantId: string) {
  const today = todayIso();
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${T.status} = 'open')::int`,
      high: sql<number>`count(*) filter (where ${T.status} = 'open' and ${T.priority} = 'high')::int`,
      dueSoon: sql<number>`count(*) filter (where ${T.status} = 'open' and ${T.deadline} between ${today}::date and ${addDaysIso(today, 7)}::date)::int`,
      overdue: sql<number>`count(*) filter (where ${T.status} = 'open' and ${T.deadline} < ${today}::date)::int`,
      done: sql<number>`count(*) filter (where ${T.status} = 'done')::int`,
      ignored: sql<number>`count(*) filter (where ${T.status} = 'ignored')::int`,
    })
    .from(T)
    .where(eq(T.tenantId, tenantId));
  return r ?? { open: 0, high: 0, dueSoon: 0, overdue: 0, done: 0, ignored: 0 };
}

export async function setTodoStatus(tenantId: string, id: string, status: "open" | "done" | "ignored", userName?: string) {
  await db
    .update(T)
    .set({ status, closedAt: status === "open" ? null : new Date(), closedBy: status === "open" ? null : `von Hand${userName ? ` (${userName})` : ""}`, updatedAt: new Date() })
    .where(and(eq(T.tenantId, tenantId), eq(T.id, id)));
  await refreshTodoTask(tenantId);
}

export async function setTodoNote(tenantId: string, id: string, note: string) {
  await db.update(T).set({ note: note.trim().slice(0, 2000) || null, updatedAt: new Date() }).where(and(eq(T.tenantId, tenantId), eq(T.id, id)));
}

/** Offene Fristen je Tag – für den Kalender. */
export async function todoDeadlines(tenantId: string, from: string, to: string) {
  return db
    .select({ deadline: T.deadline, category: T.category, n: sql<number>`count(*)::int`, high: sql<number>`count(*) filter (where ${T.priority} = 'high')::int` })
    .from(T)
    .where(and(eq(T.tenantId, tenantId), eq(T.status, "open"), isNotNull(T.deadline), gte(T.deadline, from), lte(T.deadline, to)))
    .groupBy(T.deadline, T.category);
}
