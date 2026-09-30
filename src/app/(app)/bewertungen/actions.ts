"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";

export async function setFeedbackStatus(fd: FormData) {
  const session = await requireArea("service");
  await db
    .update(schema.feedback)
    .set({ status: z.enum(["new", "ok", "answered", "removal_requested", "removed"]).parse(fd.get("status")), notes: String(fd.get("notes") ?? "") || null })
    .where(and(eq(schema.feedback.id, z.string().uuid().parse(fd.get("id"))), eq(schema.feedback.tenantId, session.tenantId)));
  revalidatePath("/bewertungen");
}
