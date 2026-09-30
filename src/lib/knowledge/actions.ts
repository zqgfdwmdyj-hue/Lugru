"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";

const entry = z.object({
  title: z.string().trim().min(1, "Titel fehlt").max(200),
  category: z.string().trim().min(1).max(80),
  kind: z.enum(["article", "snippet"]),
  body: z.string().max(50_000),
  tags: z.string().max(500),
});

function read(formData: FormData) {
  return entry.parse({
    title: formData.get("title"),
    category: formData.get("category"),
    kind: formData.get("kind"),
    body: formData.get("body") ?? "",
    tags: formData.get("tags") ?? "",
  });
}

const splitTags = (s: string) =>
  [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 20);

export async function createEntry(formData: FormData) {
  const session = await requireArea("wissen");
  const data = read(formData);
  const [row] = await db
    .insert(schema.knowledgeEntries)
    .values({ ...data, tags: splitTags(data.tags), tenantId: session.tenantId, updatedBy: session.userId })
    .returning({ id: schema.knowledgeEntries.id });
  revalidatePath("/wissen");
  redirect(`/wissen/${row.id}`);
}

export async function updateEntry(formData: FormData) {
  const session = await requireArea("wissen");
  const id = z.string().uuid().parse(formData.get("id"));
  const data = read(formData);
  await db
    .update(schema.knowledgeEntries)
    .set({ ...data, tags: splitTags(data.tags), updatedBy: session.userId, updatedAt: new Date() })
    .where(and(eq(schema.knowledgeEntries.id, id), eq(schema.knowledgeEntries.tenantId, session.tenantId)));
  revalidatePath("/wissen");
  redirect(`/wissen/${id}`);
}

export async function deleteEntry(formData: FormData) {
  const session = await requireArea("wissen");
  const id = z.string().uuid().parse(formData.get("id"));
  await db
    .delete(schema.knowledgeEntries)
    .where(and(eq(schema.knowledgeEntries.id, id), eq(schema.knowledgeEntries.tenantId, session.tenantId)));
  revalidatePath("/wissen");
  redirect("/wissen");
}
