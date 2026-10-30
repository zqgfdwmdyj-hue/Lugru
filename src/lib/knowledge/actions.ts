"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { anleitungText, leseAnleitung } from "./anleitung";
import { wissenSichtbar } from "./sichtbar";

const entry = z.object({
  title: z.string().trim().min(1, "Titel fehlt").max(200),
  category: z.string().trim().min(1).max(80),
  kind: z.enum(["article", "snippet", "anleitung"]),
  body: z.string().max(50_000),
  tags: z.string().max(500),
  origin: z.enum(["recherche", "anleitung", "notiz", "call"]).catch("notiz"),
});

function read(formData: FormData) {
  const e = parse(formData);
  if (e.kind !== "anleitung") return { ...e, anleitung: null };
  // Anleitung: Felder strukturiert speichern; der Text (für Suche und Anzeige) entsteht aus den Feldern + Ergänzungen.
  const anleitung = leseAnleitung((k) => formData.get(k));
  const extra = e.body.trim();
  return { ...e, origin: "anleitung" as const, anleitung, body: [anleitungText(anleitung), extra ? `Ergänzungen:\n${extra}` : ""].filter(Boolean).join("\n\n") };
}

function parse(formData: FormData) {
  return entry.parse({
    title: formData.get("title"),
    category: formData.get("category"),
    kind: formData.get("kind"),
    body: formData.get("body") ?? "",
    tags: formData.get("tags") ?? "",
    origin: formData.get("origin") ?? "notiz",
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
    .where(and(eq(schema.knowledgeEntries.id, id), eq(schema.knowledgeEntries.tenantId, session.tenantId), wissenSichtbar(session)));
  revalidatePath("/wissen");
  redirect(`/wissen/${id}`);
}

export async function deleteEntry(formData: FormData) {
  const session = await requireArea("wissen");
  const id = z.string().uuid().parse(formData.get("id"));
  await db
    .delete(schema.knowledgeEntries)
    .where(and(eq(schema.knowledgeEntries.id, id), eq(schema.knowledgeEntries.tenantId, session.tenantId), wissenSichtbar(session)));
  revalidatePath("/wissen");
  redirect("/wissen");
}

/** Eintrag als geprüft markieren (oder die Markierung zurücknehmen). Geprüfte Recherche wird zur Anleitung. */
export async function verifyEntry(formData: FormData) {
  const session = await requireArea("wissen");
  const id = z.string().uuid().parse(formData.get("id"));
  const K = schema.knowledgeEntries;
  const [e] = await db.select({ origin: K.origin, verifiedAt: K.verifiedAt }).from(K).where(and(eq(K.id, id), eq(K.tenantId, session.tenantId), wissenSichtbar(session)));
  if (!e) return;
  const on = !e.verifiedAt;
  await db
    .update(K)
    .set(on ? { verifiedAt: new Date(), verifiedBy: session.userId, origin: e.origin === "recherche" ? "anleitung" : e.origin } : { verifiedAt: null, verifiedBy: null })
    .where(and(eq(K.id, id), eq(K.tenantId, session.tenantId)));
  revalidatePath("/wissen", "layout");
}

/** „Insider – nicht weitergeben“ setzen oder aufheben. */
export async function insiderUmschalten(formData: FormData) {
  const session = await requireArea("wissen");
  const id = z.string().uuid().parse(formData.get("id"));
  const K = schema.knowledgeEntries;
  const [e] = await db.select({ insider: K.insider }).from(K).where(and(eq(K.id, id), eq(K.tenantId, session.tenantId), wissenSichtbar(session)));
  if (!e) return;
  await db.update(K).set({ insider: !e.insider }).where(and(eq(K.id, id), eq(K.tenantId, session.tenantId)));
  revalidatePath("/wissen", "layout");
}
