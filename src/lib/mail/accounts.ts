import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import MailComposer from "nodemailer/lib/mail-composer";
import { db, schema } from "@/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { gmailSend, googleToken, graphSend, microsoftToken, MS_SCOPES, MS_SCOPES_READONLY } from "@/lib/integrations/clients/mail";
import { getIntegration } from "@/lib/integrations/store";
import { smtpSend, type Account } from "./connect";
import type { ServerSettings } from "./servers";

// Postfächer als Konten: Zugang lesen (OAuth-Token oder IMAP/SMTP-Passwort) und zentral senden.
// Alles, was im System E-Mails verschickt (eBay-Rechnungen, Antworten …), geht über sendMail().

type Mailbox = typeof schema.mailboxes.$inferSelect;
type OAuthSecret = { refreshToken: string; scope?: string };

export type Credentials =
  | { kind: "gmail"; accessToken: string }
  | { kind: "outlook"; accessToken: string }
  | { kind: "imap"; account: Account };

async function integrationOf(mailbox: Mailbox) {
  if (!mailbox.integrationId) throw new Error("Postfach ist nicht verbunden.");
  const [integ] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.id, mailbox.integrationId), eq(schema.integrations.tenantId, mailbox.tenantId)));
  if (!integ?.secretEncrypted) throw new Error("Anmeldung fehlt – Postfach neu verbinden.");
  return integ;
}

export async function mailboxCredentials(mailbox: Mailbox): Promise<Credentials> {
  const integ = await integrationOf(mailbox);
  const secret = JSON.parse(decryptSecret(integ.secretEncrypted!)) as OAuthSecret & { password?: string };
  if (mailbox.provider === "imap") {
    const cfg = integ.config as unknown as ServerSettings;
    return { kind: "imap", account: { ...cfg, address: mailbox.address, password: secret.password ?? "" } };
  }
  const isGmail = mailbox.provider === "gmail";
  const app = await getIntegration(mailbox.tenantId, isGmail ? "google" : "microsoft");
  if (!app?.clientId || !app.clientSecret) throw new Error("App-Zugang fehlt (Anbindungen).");
  const params = { client_id: app.clientId, client_secret: app.clientSecret, refresh_token: secret.refreshToken, grant_type: "refresh_token" };
  // Microsoft verlangt beim Erneuern die Berechtigungen – nur die, denen zugestimmt wurde.
  const msScope = (secret.scope ?? "").includes("Mail.Send") ? MS_SCOPES.join(" ") : MS_SCOPES_READONLY.join(" ");
  const tok = isGmail ? await googleToken(params) : await microsoftToken({ ...params, scope: msScope });
  if (tok.refresh_token && tok.refresh_token !== secret.refreshToken) {
    await db
      .update(schema.integrations)
      .set({ secretEncrypted: encryptSecret(JSON.stringify({ ...secret, refreshToken: tok.refresh_token })), updatedAt: new Date() })
      .where(eq(schema.integrations.id, integ.id));
  }
  return isGmail ? { kind: "gmail", accessToken: tok.access_token } : { kind: "outlook", accessToken: tok.access_token };
}

/** Legt nach der Anmeldung mit Google/Microsoft das Postfach an (oder aktualisiert es). */
export async function saveOAuthMailbox(tenantId: string, provider: "gmail" | "outlook", address: string, refreshToken: string, scope?: string) {
  return upsertMailbox(tenantId, provider, address, encryptSecret(JSON.stringify({ refreshToken, scope })), {});
}

/** Legt ein IMAP/SMTP-Postfach an (Passwort verschlüsselt, Server als Einstellungen). */
export async function saveImapMailbox(tenantId: string, account: Account) {
  const { password, address, ...settings } = account;
  return upsertMailbox(tenantId, "imap", address, encryptSecret(JSON.stringify({ password })), settings);
}

async function upsertMailbox(tenantId: string, provider: "gmail" | "outlook" | "imap", address: string, sealed: string, config: Record<string, unknown>) {
  const M = schema.mailboxes;
  const [existing] = await db.select().from(M).where(and(eq(M.tenantId, tenantId), eq(M.provider, provider), eq(sql`lower(${M.address})`, address.toLowerCase())));
  if (existing?.integrationId) {
    await db.update(schema.integrations).set({ secretEncrypted: sealed, config, updatedAt: new Date() }).where(and(eq(schema.integrations.id, existing.integrationId), eq(schema.integrations.tenantId, tenantId)));
    await db.update(M).set({ active: true, lastError: null, updatedAt: new Date() }).where(eq(M.id, existing.id));
    return existing.id;
  }
  const [integ] = await db
    .insert(schema.integrations)
    .values({ tenantId, provider: `mailbox:${provider}:${address.toLowerCase()}`, label: address, config, secretEncrypted: sealed })
    .returning({ id: schema.integrations.id });
  const [mb] = await db.insert(M).values({ tenantId, provider, address, integrationId: integ.id }).returning({ id: M.id });
  return mb.id;
}

// ---- Versand ------------------------------------------------------------------------------

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer | Uint8Array; contentType?: string }[];
};

/** Postfächer, über die gesendet werden kann – das Standardpostfach zuerst. */
export async function senderMailboxes(tenantId: string) {
  const M = schema.mailboxes;
  const [boxes, [tenant]] = await Promise.all([
    db.select().from(M).where(and(eq(M.tenantId, tenantId), eq(M.active, true), inArray(M.provider, ["gmail", "outlook", "imap"]))).orderBy(M.createdAt),
    db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)),
  ]);
  const def = tenant?.settings.mail?.defaultSenderId;
  return { boxes: boxes.sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : 0)), defaultId: boxes.some((b) => b.id === def) ? def! : boxes[0]?.id ?? null };
}

export async function setDefaultSender(tenantId: string, mailboxId: string) {
  await db
    .update(schema.tenants)
    .set({ settings: sql`${schema.tenants.settings} || jsonb_build_object('mail', coalesce(${schema.tenants.settings}->'mail', '{}'::jsonb) || ${JSON.stringify({ defaultSenderId: mailboxId })}::jsonb)` })
    .where(eq(schema.tenants.id, tenantId));
}

export async function buildRaw(from: { name?: string; address: string }, mail: OutgoingMail): Promise<Buffer> {
  const composer = new MailComposer({
    from: from.name ? { name: from.name, address: from.address } : from.address,
    to: mail.to,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
  });
  return composer.compile().build();
}

/**
 * Sendet über ein verbundenes Postfach – ohne Angabe über das Standardpostfach.
 * Gibt die Absenderadresse zurück.
 */
export async function sendMail(tenantId: string, mail: OutgoingMail, opts: { mailboxId?: string | null; fromName?: string } = {}): Promise<{ from: string }> {
  const { boxes, defaultId } = await senderMailboxes(tenantId);
  const id = opts.mailboxId || defaultId;
  const box = boxes.find((b) => b.id === id);
  if (!box) {
    throw new Error(boxes.length === 0 ? "Kein Postfach zum Senden verbunden – bitte unter Posteingang ein Postfach verbinden." : "Das gewählte Absender-Postfach ist nicht mehr verbunden.");
  }
  const raw = await buildRaw({ name: opts.fromName, address: box.address }, mail);
  const creds = await mailboxCredentials(box);
  if (creds.kind === "gmail") await gmailSend(creds.accessToken, raw);
  else if (creds.kind === "outlook") await graphSend(creds.accessToken, raw);
  else await smtpSend(creds.account, raw, { from: box.address, to: mail.to.split(/[,;]\s*/).filter(Boolean) });
  return { from: box.address };
}
