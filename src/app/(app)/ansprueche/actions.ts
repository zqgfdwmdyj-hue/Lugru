"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { CLAIM_TYPES } from "@/db/schema";
import { requireArea, requireOwner } from "@/lib/auth/session";
import { syncClaims } from "@/lib/claims/service";
import { parseAmount } from "@/lib/numbers";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { askClaude, modelFor } from "@/lib/ai/claude";
import { aiCaseTextPrompt } from "@/lib/claims/texts";
import { getIntegration } from "@/lib/integrations/store";

const uuid = z.string().uuid();

async function log(tenantId: string, claimId: string, userId: string, action: string, note?: string | null) {
  await db.insert(schema.claimEvents).values({ tenantId, claimId, userId, action, note: note ?? null });
}

async function setStatus(fd: FormData, status: (typeof schema.claims.$inferSelect)["status"], extra: Partial<typeof schema.claims.$inferInsert> = {}, action?: string) {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("id"));
  const note = String(fd.get("note") ?? "").trim() || null;
  await db
    .update(schema.claims)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)))
    .returning({ id: schema.claims.id })
    .then(async (r) => { if (r.length) await log(session.tenantId, id, session.userId, action ?? status, note); });
  revalidatePath("/", "layout");
}

export async function queueClaim(fd: FormData) {
  await setStatus(fd, "queued", {}, "vorgemerkt");
}

export async function dismissClaim(fd: FormData) {
  await setStatus(fd, "dismissed", { resolvedAt: new Date() }, "verworfen");
}

export async function reopenClaim(fd: FormData) {
  await setStatus(fd, "detected", { resolvedAt: null }, "wieder geöffnet");
}

export async function submitClaim(fd: FormData) {
  const caseId = String(fd.get("caseId") ?? "").trim() || null;
  await setStatus(fd, "submitted", { amazonCaseId: caseId, submittedAt: new Date() }, `eingereicht${caseId ? ` (Fall ${caseId})` : ""}`);
}

export async function resolveClaim(fd: FormData) {
  const amount = parseAmount(fd.get("amount"));
  const result = String(fd.get("result"));
  const status = result === "rejected" ? "rejected" : result === "partial" ? "partial" : "reimbursed";
  await setStatus(fd, status, { reimbursedAmount: amount ?? undefined, resolvedAt: new Date() }, status === "rejected" ? "abgelehnt" : `erstattet${amount !== null ? ` ${amount.toFixed(2)} €` : ""}`);
}

export async function escalateClaim(fd: FormData) {
  await setStatus(fd, "escalated", {}, "eskaliert");
}

export async function saveClaimNotes(fd: FormData) {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("id"));
  await db
    .update(schema.claims)
    .set({ notes: String(fd.get("notes") ?? ""), amazonCaseId: String(fd.get("caseId") ?? "").trim() || null, updatedAt: new Date() })
    .where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)))
    .returning({ id: schema.claims.id })
    .then(async (r) => { if (r.length) await log(session.tenantId, id, session.userId, "Notiz gespeichert"); });
  revalidatePath(`/ansprueche/${id}`);
}

export async function queueAllDetected() {
  const session = await requireArea("amazon");
  const rows = await db
    .update(schema.claims)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(schema.claims.tenantId, session.tenantId), eq(schema.claims.status, "detected")))
    .returning({ id: schema.claims.id });
  for (const r of rows) await log(session.tenantId, r.id, session.userId, "vorgemerkt");
  revalidatePath("/", "layout");
}

export async function redetect() {
  const session = await requireArea("amazon");
  await syncClaims(session.tenantId);
  revalidatePath("/", "layout");
}

export async function createManualClaim(fd: FormData) {
  const session = await requireArea("amazon");
  const settings = await getSettings(session.tenantId);
  const type = z.enum(CLAIM_TYPES).parse(fd.get("type"));
  const title = String(fd.get("title") ?? "").trim();
  if (!title) return;
  const qty = Math.max(1, Math.round(parseAmount(fd.get("quantity")) ?? 1));
  const unitCost = parseAmount(fd.get("unitCost"));
  // Ohne Ereignisdatum: Frist nur als Platzhalter ab heute (wird in der Liste so markiert).
  const entered = /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("eventDate") ?? "")) ? String(fd.get("eventDate")) : null;
  const [row] = await db
    .insert(schema.claims)
    .values({
      tenantId: session.tenantId,
      type,
      status: "detected",
      title,
      sku: String(fd.get("sku") ?? "").trim() || null,
      reference: String(fd.get("reference") ?? "").trim() || null,
      quantity: qty,
      unitCost,
      expectedAmount: unitCost === null ? null : Math.round(unitCost * qty * 100) / 100,
      eventDate: entered,
      deadline: addDaysIso(entered ?? todayIso(), settings.claims.windowDays[type]),
    })
    .returning({ id: schema.claims.id });
  await log(session.tenantId, row.id, session.userId, "von Hand angelegt");
  revalidatePath("/", "layout");
}

export async function bulkStatus(fd: FormData) {
  const session = await requireArea("amazon");
  const ids = fd.getAll("ids").map(String).filter((s) => uuid.safeParse(s).success);
  const action = String(fd.get("bulk"));
  if (ids.length === 0) return;
  const status = action === "queue" ? "queued" : action === "dismiss" ? "dismissed" : null;
  if (!status) return;
  await db
    .update(schema.claims)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.claims.tenantId, session.tenantId), inArray(schema.claims.id, ids)));
  for (const id of ids) await log(session.tenantId, id, session.userId, status === "queued" ? "vorgemerkt" : "verworfen");
  revalidatePath("/", "layout");
}

export type AiCaseState = { ok: boolean; text?: string; message?: string } | null;

/** Fall-Text von der KI formulieren lassen (Discord-Tipp: „am besten KI die Texte schreiben lassen“). */
export async function aiCaseTextAction(_prev: AiCaseState, fd: FormData): Promise<AiCaseState> {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("id"));
  const lang = fd.get("lang") === "en" ? "en" : "de";
  const [claim] = await db.select().from(schema.claims).where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)));
  if (!claim) return { ok: false, message: "Anspruch nicht gefunden." };
  const ai = await getIntegration(session.tenantId, "anthropic");
  if (!ai?.apiKey) return { ok: false, message: "Für KI-Texte unter Anbindungen → KI (Claude) einen Schlüssel eintragen." };
  try {
    const r = await askClaude(ai.apiKey, aiCaseTextPrompt(claim, lang), { model: modelFor(ai, "simple"), task: "simple", maxTokens: 1500 });
    return { ok: true, text: r.text.trim() };
  } catch (e) {
    return { ok: false, message: `KI nicht erreichbar: ${(e as Error).message}` };
  }
}

/** Ereignisdatum eintragen bzw. korrigieren – die Frist wird nach der Regel der Art neu berechnet. */
export async function setClaimEventDate(fd: FormData) {
  const session = await requireArea("amazon");
  const id = uuid.parse(fd.get("id"));
  const date = String(fd.get("eventDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const [claim] = await db.select().from(schema.claims).where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)));
  if (!claim) return;
  const settings = await getSettings(session.tenantId);
  const deadline = addDaysIso(date, settings.claims.windowDays[claim.type]);
  await db.update(schema.claims).set({ eventDate: date, deadline, updatedAt: new Date() }).where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)));
  await log(session.tenantId, id, session.userId, "Ereignisdatum gesetzt", `${date.split("-").reverse().join(".")} → Frist ${deadline.split("-").reverse().join(".")}`);
  revalidatePath("/", "layout");
}

/** Anspruch als eigener Thread an die VA (Englisch, mit Frist, Belegen, Anleitung). */
export async function anspruchAnVaAction(fd: FormData) {
  const s = await requireOwner();
  const id = uuid.parse(fd.get("id"));
  const { anspruchAnVa } = await import("@/lib/va/automatik");
  const r = await anspruchAnVa(s.tenantId, id, { userId: s.userId });
  if (!r.ok) await log(s.tenantId, id, s.userId, "an die VA fehlgeschlagen", r.fehler);
  revalidatePath(`/ansprueche/${id}`);
  revalidatePath("/delegation/va");
}
