"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { MAIL_CATEGORIES } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { rememberLeadSender } from "@/lib/leads/service";
import { ingestMail, parseRaw, syncAllMailboxes } from "@/lib/inbox/service";
import { sendMail, setDefaultSender } from "@/lib/mail/accounts";

export type InboxState = { ok: boolean; message: string } | null;
const uuid = z.string().uuid();

export async function uploadEml(_prev: InboxState, fd: FormData): Promise<InboxState> {
  const session = await requireArea("posteingang");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, message: "Bitte .eml-Dateien auswählen." };
  let [box] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.tenantId, session.tenantId), eq(schema.mailboxes.provider, "upload")));
  if (!box) [box] = await db.insert(schema.mailboxes).values({ tenantId: session.tenantId, provider: "upload", address: "Hochgeladene Mails" }).returning();
  const counts = { new: 0, duplicate: 0, ignored: 0 };
  for (const f of files) {
    try {
      counts[await ingestMail(session.tenantId, box.id, await parseRaw(Buffer.from(await f.arrayBuffer())))]++;
    } catch {
      counts.ignored++;
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `${counts.new} neu, ${counts.duplicate} schon bekannt, ${counts.ignored} nicht von Marktplätzen/ignoriert.` };
}

export async function syncNow(_prev: InboxState): Promise<InboxState> {
  const session = await requireArea("posteingang");
  const res = await syncAllMailboxes(session.tenantId);
  revalidatePath("/", "layout");
  if (!res.length) return { ok: false, message: "Noch kein Postfach verbunden." };
  return { ok: res.every((r) => !r.error), message: res.map((r) => (r.error ? `${r.address}: ${r.error}` : `${r.address}: ${r.new} neu`)).join(" · ") };
}

export async function setCategory(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const category = z.enum(MAIL_CATEGORIES).parse(fd.get("category"));
  await db.update(schema.emails).set({ category, matchedRule: "von Hand" }).where(and(eq(schema.emails.id, id), eq(schema.emails.tenantId, session.tenantId)));
  revalidatePath("/posteingang", "layout");
}

export async function archiveMails(fd: FormData) {
  const session = await requireArea("posteingang");
  const ids = fd.getAll("ids").map(String).filter((s) => uuid.safeParse(s).success);
  const one = fd.get("id");
  if (one && uuid.safeParse(one).success) ids.push(String(one));
  if (!ids.length) return;
  await db.update(schema.emails).set({ archived: true }).where(and(eq(schema.emails.tenantId, session.tenantId), inArray(schema.emails.id, ids)));
  revalidatePath("/", "layout");
}

export async function createTaskFromMail(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const [m] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.tenantId, session.tenantId)));
  if (!m || m.taskId) return;
  const [t] = await db.insert(schema.tasks).values({ tenantId: session.tenantId, title: (m.subject ?? "Mail").slice(0, 280), notes: m.fromAddress, category: "support", link: `/posteingang/${m.id}`, createdBy: session.userId }).returning({ id: schema.tasks.id });
  await db.update(schema.emails).set({ taskId: t.id }).where(eq(schema.emails.id, m.id));
  revalidatePath("/", "layout");
}

export async function toggleMailbox(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const [mb] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!mb) return;
  await db.update(schema.mailboxes).set({ active: !mb.active, updatedAt: new Date() }).where(eq(schema.mailboxes.id, id));
  revalidatePath("/posteingang");
}

export async function setDefaultSenderAction(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const [box] = await db.select({ id: schema.mailboxes.id }).from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!box) return;
  await setDefaultSender(session.tenantId, box.id);
  revalidatePath("/posteingang");
}

/** Absendername und Signatur eines Postfachs speichern. */
export async function saveMailboxProfileAction(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const [box] = await db.select({ id: schema.mailboxes.id }).from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!box) return;
  const fromName = String(fd.get("fromName") ?? "").replace(/[\r\n<>"]+/g, " ").trim().slice(0, 80) || null;
  const signature = String(fd.get("signature") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 2000) || null;
  await db.update(schema.mailboxes).set({ fromName, signature, updatedAt: new Date() }).where(eq(schema.mailboxes.id, box.id));
  if (fd.get("leadDefault") === "on") await rememberLeadSender(session.tenantId, box.id);
  revalidatePath("/posteingang");
  redirect(`/posteingang/postfaecher/${box.id}?meldung=${encodeURIComponent("Gespeichert.")}`);
}

export async function sendTestMail(_prev: InboxState, fd: FormData): Promise<InboxState> {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const [box] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!box) return { ok: false, message: "Postfach nicht gefunden." };
  try {
    await sendMail(session.tenantId, { to: box.address, subject: "Test-E-Mail vom Seller-System", text: "Der E-Mail-Versand über dieses Postfach funktioniert.\n\nAb jetzt können Rechnungen und Nachrichten darüber verschickt werden." }, { mailboxId: box.id });
    return { ok: true, message: `Gesendet an ${box.address} – bitte im Postfach nachsehen.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeMailbox(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const [box] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!box) return;
  // Die abgerufenen Mails bleiben; nur Zugang und Postfach werden entfernt.
  await db.delete(schema.mailboxes).where(and(eq(schema.mailboxes.id, box.id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (box.integrationId) await db.delete(schema.integrations).where(and(eq(schema.integrations.id, box.integrationId), eq(schema.integrations.tenantId, session.tenantId)));
  revalidatePath("/", "layout");
}
