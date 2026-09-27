"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { CLAIM_TYPES } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { syncClaims } from "@/lib/claims/service";
import { parseAmount } from "@/lib/numbers";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

const uuid = z.string().uuid();

async function log(tenantId: string, claimId: string, userId: string, action: string, note?: string | null) {
  await db.insert(schema.claimEvents).values({ tenantId, claimId, userId, action, note: note ?? null });
}

async function setStatus(fd: FormData, status: (typeof schema.claims.$inferSelect)["status"], extra: Partial<typeof schema.claims.$inferInsert> = {}, action?: string) {
  const session = await requireSession();
  const id = uuid.parse(fd.get("id"));
  const note = String(fd.get("note") ?? "").trim() || null;
  await db
    .update(schema.claims)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)));
  await log(session.tenantId, id, session.userId, action ?? status, note);
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
  const session = await requireSession();
  const id = uuid.parse(fd.get("id"));
  await db
    .update(schema.claims)
    .set({ notes: String(fd.get("notes") ?? ""), amazonCaseId: String(fd.get("caseId") ?? "").trim() || null, updatedAt: new Date() })
    .where(and(eq(schema.claims.id, id), eq(schema.claims.tenantId, session.tenantId)));
  revalidatePath(`/ansprueche/${id}`);
}

export async function queueAllDetected() {
  const session = await requireSession();
  const rows = await db
    .update(schema.claims)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(schema.claims.tenantId, session.tenantId), eq(schema.claims.status, "detected")))
    .returning({ id: schema.claims.id });
  for (const r of rows) await log(session.tenantId, r.id, session.userId, "vorgemerkt");
  revalidatePath("/", "layout");
}

export async function redetect() {
  const session = await requireSession();
  await syncClaims(session.tenantId);
  revalidatePath("/", "layout");
}

export async function createManualClaim(fd: FormData) {
  const session = await requireSession();
  const settings = await getSettings(session.tenantId);
  const type = z.enum(CLAIM_TYPES).parse(fd.get("type"));
  const title = String(fd.get("title") ?? "").trim();
  if (!title) return;
  const qty = Math.max(1, Math.round(parseAmount(fd.get("quantity")) ?? 1));
  const unitCost = parseAmount(fd.get("unitCost"));
  const eventDate = String(fd.get("eventDate") || todayIso());
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
      eventDate,
      deadline: addDaysIso(eventDate, settings.claims.windowDays[type]),
    })
    .returning({ id: schema.claims.id });
  await log(session.tenantId, row.id, session.userId, "von Hand angelegt");
  revalidatePath("/", "layout");
}

export async function bulkStatus(fd: FormData) {
  const session = await requireSession();
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
