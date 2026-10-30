"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { MAIL_CATEGORIES } from "@/db/schema";
import { requireArea } from "@/lib/auth/session";
import { rememberLeadSender } from "@/lib/leads/service";
import { MANUAL_RULE, TOPICS, TOPIC_LABEL, type Topic } from "@/lib/inbox/classify";
import { applyMailUpgrades, ingestMail, parseRaw, syncAllMailboxes } from "@/lib/inbox/service";
import { mailboxCredentials, sendMail, setDefaultSender } from "@/lib/mail/accounts";
import { imapOrdnerListe, MailFehler, testAccount } from "@/lib/mail/connect";
import { gueltigeOrdner } from "@/lib/mail/ordner";

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
      counts[await ingestMail(session.tenantId, box.id, await parseRaw(Buffer.from(await f.arrayBuffer()), undefined, "Upload"))]++;
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

/** Einordnung von Hand korrigieren: Thema und Wichtigkeit. Ein verknüpftes To-do bekommt den neuen Thementitel. */
export async function correctMail(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const category = z.enum(MAIL_CATEGORIES).parse(fd.get("category"));
  const topic = z.enum(TOPICS as [Topic, ...Topic[]]).parse(fd.get("topic"));
  const [m] = await db.select().from(schema.emails).where(and(eq(schema.emails.id, id), eq(schema.emails.tenantId, session.tenantId)));
  if (!m) return;
  await db.update(schema.emails).set({ category, topic, matchedRule: MANUAL_RULE }).where(and(eq(schema.emails.id, m.id), eq(schema.emails.tenantId, session.tenantId)));
  const oldLabel = TOPIC_LABEL[(m.topic ?? "other") as Topic];
  if (m.taskId && oldLabel && topic !== m.topic) {
    const [t] = await db.select({ title: schema.tasks.title }).from(schema.tasks).where(and(eq(schema.tasks.id, m.taskId), eq(schema.tasks.tenantId, session.tenantId)));
    if (t?.title.startsWith(`${oldLabel}: `)) {
      await db.update(schema.tasks).set({ title: `${TOPIC_LABEL[topic]}: ${t.title.slice(oldLabel.length + 2)}`.slice(0, 280) }).where(and(eq(schema.tasks.id, m.taskId), eq(schema.tasks.tenantId, session.tenantId)));
    }
  }
  revalidatePath("/", "layout");
}

/** Mails mit den aktuellen Regeln neu einstufen – nur hochstufen, von Hand korrigierte bleiben (nur auf Klick). */
export async function applyMailUpgradesAction() {
  const session = await requireArea("posteingang");
  const n = await applyMailUpgrades(session.tenantId);
  revalidatePath("/", "layout");
  redirect(`/posteingang?ansicht=wichtig&hochgestuft=${n}`);
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
  revalidatePath("/", "layout");
}

export async function setDefaultSenderAction(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const [box] = await db.select({ id: schema.mailboxes.id }).from(schema.mailboxes).where(and(eq(schema.mailboxes.id, id), eq(schema.mailboxes.tenantId, session.tenantId)));
  if (!box) return;
  await setDefaultSender(session.tenantId, box.id);
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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

/**
 * Antwort-Entwurf speichern, senden oder verwerfen (Formular an der Mail). Senden nur mit Häkchen „geprüft“ –
 * Entwürfe (z. B. von Claude) gehen nie ungeprüft raus. Antwort hängt sich per In-Reply-To an den Verlauf.
 */
export async function draftAction(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("draftId"));
  const D = schema.emailDrafts;
  const [d] = await db.select().from(D).where(and(eq(D.tenantId, session.tenantId), eq(D.id, id)));
  if (!d) return;
  const back = (q: string) => redirect(`/posteingang/${d.emailId}?entwurf=${q}#entwurf`);
  const op = String(fd.get("op") ?? "");
  if (op === "verwerfen") {
    await db.delete(D).where(and(eq(D.tenantId, session.tenantId), eq(D.id, d.id)));
    revalidatePath("/posteingang");
    back("verworfen");
  }
  if (d.sentAt) back("schon-gesendet");
  const to = String(fd.get("to") ?? "").trim().slice(0, 200);
  const subject = String(fd.get("subject") ?? "").trim().slice(0, 300);
  const body = String(fd.get("body") ?? "").slice(0, 20_000);
  if (!z.string().email().safeParse(to.split(/[,;]\s*/)[0]).success || !subject || !body.trim()) back("unvollstaendig");
  await db.update(D).set({ to, subject, body, updatedAt: new Date() }).where(and(eq(D.tenantId, session.tenantId), eq(D.id, d.id)));
  if (op !== "senden") back("gespeichert");
  if (fd.get("geprueft") !== "on") back("nicht-bestaetigt");
  const [m] = await db.select({ key: schema.emails.messageKey }).from(schema.emails).where(and(eq(schema.emails.tenantId, session.tenantId), eq(schema.emails.id, d.emailId)));
  let ok = false;
  try {
    const { from } = await sendMail(session.tenantId, { to, subject, text: body, inReplyTo: m?.key?.startsWith("<") ? m.key : undefined });
    await db.update(D).set({ sentAt: new Date(), sentFrom: from }).where(eq(D.id, d.id));
    ok = true;
  } catch (e) {
    console.error("[Posteingang] Entwurf senden:", e);
  }
  revalidatePath("/posteingang");
  back(ok ? "gesendet" : "fehler");
}

/** „Verbindung testen“ je Postfach: IMAP (Ordner) und SMTP (mit Ausweichen auf 587); Fehlerart wird gespeichert. */
export async function testMailboxAction(_prev: InboxState, fd: FormData): Promise<InboxState> {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const M = schema.mailboxes;
  const [box] = await db.select().from(M).where(and(eq(M.id, id), eq(M.tenantId, session.tenantId)));
  if (!box) return { ok: false, message: "Postfach nicht gefunden." };
  try {
    const creds = await mailboxCredentials(box);
    if (creds.kind !== "imap") {
      await db.update(M).set({ lastError: null, fehlerArt: null, updatedAt: new Date() }).where(eq(M.id, box.id));
      return { ok: true, message: `Anmeldung bei ${creds.kind === "gmail" ? "Google" : "Microsoft"} klappt.` };
    }
    const r = await testAccount(creds.account, { nurAbruf: box.nurAbruf });
    await db.update(M).set({ lastError: null, fehlerArt: null, updatedAt: new Date() }).where(eq(M.id, box.id));
    const teile = [`Abruf (IMAP) klappt – ${r.ordner.length} Ordner`];
    if (r.smtp.ok === null) teile.push("Versand aus (nur Abruf)");
    else if (r.smtp.ok) {
      teile.push(`Versand (SMTP) klappt über Port ${r.smtp.port}${r.smtp.ausweich ? " – automatisch umgestellt, weil der bisherige Port gesperrt war" : ""}`);
      if (r.smtp.ausweich && box.integrationId) await db.update(schema.integrations).set({ config: r.einstellungen, updatedAt: new Date() }).where(and(eq(schema.integrations.id, box.integrationId), eq(schema.integrations.tenantId, session.tenantId)));
    } else teile.push(`${r.smtp.meldung} Tipp: „Nur abrufen“ einschalten, wenn über dieses Postfach nicht gesendet werden muss.`);
    revalidatePath("/", "layout");
    return { ok: r.smtp.ok !== false, message: `${teile.join(" · ")}.` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(M).set({ lastError: message, fehlerArt: e instanceof MailFehler ? e.art : "sonst", updatedAt: new Date() }).where(eq(M.id, box.id));
    revalidatePath("/", "layout");
    return { ok: false, message };
  }
}

/** Ordner/Labels eines IMAP-Postfachs wählen (leer bzw. „Automatisch“ = Gmail „Alle Nachrichten“, sonst Posteingang + Archiv). */
export async function ordnerAction(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const M = schema.mailboxes;
  const [box] = await db.select().from(M).where(and(eq(M.id, id), eq(M.tenantId, session.tenantId)));
  if (!box || box.provider !== "imap") return;
  const zurueck = (m: string) => redirect(`/posteingang/postfaecher/${box.id}?meldung=${encodeURIComponent(m)}#ordner`);
  if (fd.get("op") === "automatisch") {
    await db.update(M).set({ ordner: null, updatedAt: new Date() }).where(eq(M.id, box.id));
    revalidatePath("/", "layout");
    zurueck("Ordner: automatisch.");
  }
  let liste: Awaited<ReturnType<typeof imapOrdnerListe>> = [];
  try {
    const c = await mailboxCredentials(box);
    if (c.kind === "imap") liste = await imapOrdnerListe(c.account);
  } catch (e) {
    zurueck(`Ordner nicht gespeichert – ${e instanceof Error ? e.message : String(e)}`);
  }
  const wahl = gueltigeOrdner(fd.getAll("ordner").map(String), liste);
  await db.update(M).set({ ordner: wahl.length ? wahl : null, updatedAt: new Date() }).where(eq(M.id, box.id));
  revalidatePath("/", "layout");
  zurueck(wahl.length ? `${wahl.length} Ordner gespeichert – beim nächsten Abruf werden sie gelesen.` : "Keine Auswahl – Ordner: automatisch.");
}

/** „Nur abrufen“ ein/aus: Postfach wird dann nicht zum Senden benutzt. */
export async function nurAbrufAction(fd: FormData) {
  const session = await requireArea("posteingang");
  const id = uuid.parse(fd.get("id"));
  const M = schema.mailboxes;
  const [box] = await db.select().from(M).where(and(eq(M.id, id), eq(M.tenantId, session.tenantId)));
  if (!box) return;
  await db.update(M).set({ nurAbruf: !box.nurAbruf, updatedAt: new Date() }).where(eq(M.id, box.id));
  revalidatePath("/", "layout");
}
