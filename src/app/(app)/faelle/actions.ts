"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { CASE_STATUSES, CASE_TYPES, CHANNELS } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { parseAmount, parseDate } from "@/lib/numbers";

const uuid = z.string().uuid();

export async function createCase(fd: FormData) {
  const session = await requireArea("service");
  const title = String(fd.get("title") ?? "").trim();
  if (!title) return;
  await db.insert(schema.cases).values({
    tenantId: session.tenantId,
    channel: z.enum(CHANNELS).parse(fd.get("channel")),
    type: z.enum(CASE_TYPES).parse(fd.get("type")),
    title,
    externalId: String(fd.get("externalId") ?? "").trim() || null,
    orderRef: String(fd.get("orderRef") ?? "").trim() || null,
    customer: String(fd.get("customer") ?? "").trim() || null,
    amount: parseAmount(fd.get("amount")),
    deadline: parseDate(String(fd.get("deadline") ?? "")),
  });
  revalidatePath("/faelle");
}

export async function updateCase(fd: FormData) {
  const session = await requireArea("service");
  const id = uuid.parse(fd.get("id"));
  const status = z.enum(CASE_STATUSES).parse(fd.get("status"));
  await db
    .update(schema.cases)
    .set({
      status,
      deadline: parseDate(String(fd.get("deadline") ?? "")),
      notes: String(fd.get("notes") ?? ""),
      externalId: String(fd.get("externalId") ?? "").trim() || null,
      resolvedAt: ["won", "lost", "closed"].includes(status) ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.cases.id, id), eq(schema.cases.tenantId, session.tenantId)));
  revalidatePath("/faelle");
}
