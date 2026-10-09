import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { leadToSupplier } from "@/lib/leads/service";
import { sendMail } from "@/lib/mail/accounts";
import { upsertSystemTask } from "@/lib/tasks/system";
import { FOLLOW_UP_DAYS, LEAD_COLUMNS, leadColumn, TASK_COLUMNS, taskColumn, type LeadColumnKey, type TaskColumnKey } from "./logic";

const L = schema.supplierLeads;
const T = schema.tasks;

// ---- Großhändler-Pipeline -------------------------------------------------------------------

export async function leadBoard(tenantId: string) {
  const rows = await db
    .select()
    .from(L)
    .where(
      and(
        eq(L.tenantId, tenantId),
        ne(L.status, "ausgeschlossen"),
        or(notInArray(L.status, ["neu", "geprueft"]), eq(L.onBoard, true), eq(L.kind, "grosshandel")),
      ),
    )
    .orderBy(desc(L.updatedAt))
    .limit(800);
  const cols = new Map<LeadColumnKey, typeof rows>(LEAD_COLUMNS.map((c) => [c.key, []]));
  for (const l of rows) {
    const c = leadColumn(l);
    if (c) cols.get(c)!.push(l);
  }
  return cols;
}

/** Karte in eine Spalte ziehen. „Abgeschlossen“ legt die Firma als Lieferant an. */
export async function moveLead(tenantId: string, id: string, column: LeadColumnKey) {
  const col = LEAD_COLUMNS.find((c) => c.key === column);
  if (!col) throw new Error("Unbekannte Spalte.");
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, tenantId)));
  if (!l) throw new Error("Kontakt nicht gefunden.");
  const status = column === "kontakt" ? (l.mailBody && !l.mailedAt ? "entwurf" : "geprueft") : col.target;
  await db
    .update(L)
    .set({ status, onBoard: column === "kontakt" ? true : l.onBoard, updatedAt: new Date() })
    .where(eq(L.id, id));
  if (column === "abgeschlossen" && !l.supplierId) await leadToSupplier(tenantId, id);
}

/** Angeschrieben, aber nach FOLLOW_UP_DAYS keine Antwort → Spalte „Follow-up“ und Aufgabe. */
export async function autoFollowUps(tenantId: string) {
  const due = await db
    .select()
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.status, "angeschrieben"), isNull(L.repliedAt), lt(L.mailedAt, new Date(Date.now() - FOLLOW_UP_DAYS * 86_400_000))));
  for (const l of due) {
    await db.update(L).set({ status: "follow_up", updatedAt: new Date() }).where(eq(L.id, l.id));
    await upsertSystemTask(db, tenantId, `lead-followup:${l.id}`, {
      title: `Nachfassen: ${l.companyName} (seit ${FOLLOW_UP_DAYS} Tagen keine Antwort)`,
      notes: l.mailSubject,
      category: "einkauf",
      link: `/lieferanten/finden/${l.id}`,
    });
  }
  return due.length;
}

/** Nachfass-Mail an dieselbe Adresse wie die erste Anfrage. */
export async function sendFollowUp(tenantId: string, id: string, subject: string, body: string) {
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, tenantId)));
  if (!l?.mailedAt || !l.mailedTo) throw new Error("Erst die Anfrage senden – nachgefasst wird auf diese Mail.");
  if (l.repliedAt) throw new Error("Die Firma hat schon geantwortet.");
  if (!subject.trim() || !body.trim()) throw new Error("Betreff und Text fehlen.");
  // Erst sperren, dann senden – ein zweiter Klick schickt nichts doppelt.
  const [claimed] = await db.update(L).set({ followUpAt: new Date() }).where(and(eq(L.id, id), isNull(L.followUpAt))).returning({ id: L.id });
  if (!claimed) throw new Error("Es wurde schon nachgefasst.");
  try {
    // Vom selben Postfach wie die erste Anfrage (falls noch verbunden), sonst vom Standard-Absender.
    await sendMail(tenantId, { to: l.mailedTo, subject: subject.trim(), text: body.trim() }, { mailboxId: l.mailFromId });
  } catch (e) {
    await db.update(L).set({ followUpAt: null }).where(eq(L.id, id));
    throw e;
  }
  await db.update(L).set({ status: "follow_up", mailError: null, updatedAt: new Date() }).where(eq(L.id, id));
  await db.update(T).set({ status: "done", completedAt: new Date() }).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, `lead-followup:${id}`)));
}

/** „Preisliste erhalten“ → Lieferant + Feed anlegen, dort die Liste hochladen. */
export async function feedFromLead(tenantId: string, id: string) {
  const [l] = await db.select().from(L).where(and(eq(L.id, id), eq(L.tenantId, tenantId)));
  if (!l) throw new Error("Kontakt nicht gefunden.");
  const supplierId = l.supplierId ?? (await leadToSupplier(tenantId, id));
  const F = schema.supplierFeeds;
  const [existing] = await db.select({ id: F.id }).from(F).where(and(eq(F.tenantId, tenantId), eq(F.supplierId, supplierId))).limit(1);
  if (existing) return existing.id;
  const [f] = await db.insert(F).values({ tenantId, name: `${l.companyName} – Preisliste`, supplierId }).returning({ id: F.id });
  if (l.status !== "abgeschlossen") await db.update(L).set({ status: "preisliste", updatedAt: new Date() }).where(eq(L.id, id));
  return f.id;
}

// ---- Eigene Aufgaben --------------------------------------------------------------------------

/** Eigene Aufgaben (oder alle offenen) nach Spalten; erledigte der letzten 14 Tage. */
export async function taskBoard(tenantId: string, all: boolean) {
  const rows = await db
    .select()
    .from(T)
    .where(
      and(
        eq(T.tenantId, tenantId),
        all ? sql`true` : or(eq(T.category, "eigene"), sql`${T.boardColumn} is not null`),
        or(eq(T.status, "open"), gte(T.completedAt, new Date(Date.now() - 14 * 86_400_000))),
      ),
    )
    .orderBy(sql`${T.dueDate} asc nulls last`, desc(T.createdAt))
    .limit(600);
  const cols = new Map<TaskColumnKey, typeof rows>(TASK_COLUMNS.map((c) => [c.key, []]));
  for (const t of rows) cols.get(taskColumn(t))!.push(t);
  return cols;
}

export async function moveTask(tenantId: string, id: string, column: TaskColumnKey) {
  if (!TASK_COLUMNS.some((c) => c.key === column)) throw new Error("Unbekannte Spalte.");
  await db
    .update(T)
    .set(column === "erledigt" ? { status: "done", completedAt: new Date() } : { status: "open", completedAt: null, boardColumn: column === "offen" ? null : column })
    .where(and(eq(T.id, id), eq(T.tenantId, tenantId)));
}

export async function addTask(tenantId: string, userId: string, title: string, dueDate: string | null) {
  await db.insert(T).values({ tenantId, title: title.slice(0, 300), dueDate, category: "eigene", createdBy: userId });
}

export const boardCounts = async (tenantId: string) => {
  const [r] = await db
    .select({ followUp: sql<number>`count(*) filter (where ${L.status} = 'follow_up' and ${L.followUpAt} is null)::int`, replies: sql<number>`count(*) filter (where ${L.status} = 'antwort')::int` })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), inArray(L.status, ["follow_up", "antwort"])));
  return r ?? { followUp: 0, replies: 0 };
};
