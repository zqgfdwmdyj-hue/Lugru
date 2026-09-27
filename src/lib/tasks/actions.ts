"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireSession } from "@/lib/auth/session";

const newTask = z.object({
  title: z.string().trim().min(1).max(300),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  category: z.enum(schema.TASK_CATEGORIES).default("eigene"),
  critical: z.literal("on").optional(),
});

export async function createTask(formData: FormData) {
  const session = await requireSession();
  const parsed = newTask.safeParse({
    title: formData.get("title"),
    dueDate: formData.get("dueDate") ?? "",
    category: formData.get("category") || undefined,
    critical: formData.get("critical") ?? undefined,
  });
  if (!parsed.success) return;
  await db.insert(schema.tasks).values({
    tenantId: session.tenantId,
    title: parsed.data.title,
    dueDate: parsed.data.dueDate || null,
    category: parsed.data.category,
    priority: parsed.data.critical ? "critical" : "normal",
    createdBy: session.userId,
  });
  revalidatePath("/", "layout");
}

export async function toggleTask(formData: FormData) {
  const session = await requireSession();
  const id = z.string().uuid().parse(formData.get("id"));
  const [task] = await db
    .select({ status: schema.tasks.status })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, session.tenantId)));
  if (!task) return;
  const done = task.status === "open";
  await db
    .update(schema.tasks)
    .set({ status: done ? "done" : "open", completedAt: done ? new Date() : null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, session.tenantId)));
  revalidatePath("/", "layout");
}

export async function deleteTask(formData: FormData) {
  const session = await requireSession();
  const id = z.string().uuid().parse(formData.get("id"));
  await db
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.tenantId, session.tenantId)));
  revalidatePath("/", "layout");
}
