import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getIntegration } from "@/lib/integrations/store";
import {
  gmailFetchRaw,
  googleToken,
  graphFetch,
  microsoftToken,
  type GraphMessage,
} from "@/lib/integrations/clients/mail";
import { classifyMail, TOPIC_LABEL, type Topic } from "./classify";

export type ParsedMail = {
  messageKey: string;
  providerMessageId?: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  receivedAt: Date;
  text: string;
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseRaw(raw: Buffer, providerMessageId?: string): Promise<ParsedMail> {
  const m = await simpleParser(raw);
  const from = m.from?.value?.[0];
  const text = m.text?.trim() || (typeof m.html === "string" ? htmlToText(m.html) : "");
  return {
    messageKey: m.messageId ?? createHash("sha1").update(raw).digest("hex"),
    providerMessageId,
    fromAddress: from?.address ?? "",
    fromName: from?.name || null,
    subject: m.subject ?? "",
    receivedAt: m.date ?? new Date(),
    text,
  };
}

function fromGraph(g: GraphMessage): ParsedMail {
  const body = g.body?.contentType === "html" ? htmlToText(g.body.content) : (g.body?.content ?? g.bodyPreview ?? "");
  return {
    messageKey: g.internetMessageId ?? `graph:${g.id}`,
    providerMessageId: g.id,
    fromAddress: g.from?.emailAddress?.address ?? "",
    fromName: g.from?.emailAddress?.name ?? null,
    subject: g.subject ?? "",
    receivedAt: new Date(g.receivedDateTime),
    text: body,
  };
}

const CATEGORY_FOR_TASK: Record<string, (typeof schema.TASK_CATEGORIES)[number]> = { amazon: "amazon", ebay: "ebay", tiktok: "support", temu: "support", dhl: "versand" };
const CASE_TYPE: Partial<Record<Topic, (typeof schema.CASE_TYPES)[number]>> = {
  a_to_z: "a_to_z",
  chargeback: "chargeback",
  ebay_case: "ebay_not_received",
  return_request: "return_request",
  account_health: "account_health",
};

/** Speichert eine Mail (Dubletten über alle Postfächer hinweg erkannt) und legt Aufgaben an. */
export async function ingestMail(tenantId: string, mailboxId: string | null, m: ParsedMail): Promise<"new" | "duplicate" | "ignored"> {
  const c = classifyMail({ from: `${m.fromName ?? ""} <${m.fromAddress}>`, subject: m.subject, body: m.text });
  if (!c.relevant) return "ignored";
  const [row] = await db
    .insert(schema.emails)
    .values({
      tenantId,
      mailboxId,
      providerMessageId: m.providerMessageId ?? null,
      messageKey: m.messageKey,
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      subject: clip(m.subject, 500),
      receivedAt: m.receivedAt,
      snippet: clip(m.text.replace(/\s+/g, " "), 300),
      bodyText: clip(m.text, 20_000),
      category: c.category,
      topic: c.topic,
      matchedRule: c.rule,
      references: c.references,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return "duplicate";

  if (c.category === "critical" || c.category === "action") {
    const refs = Object.values(c.references).join(" · ");
    const due = c.dueInDays !== null ? addDaysIso(todayIso(m.receivedAt), c.dueInDays) : null;
    const [task] = await db
      .insert(schema.tasks)
      .values({
        tenantId,
        title: clip(`${TOPIC_LABEL[c.topic]}: ${m.subject}`, 280),
        notes: clip(`${m.fromName ?? m.fromAddress}${refs ? ` · ${refs}` : ""}`, 500),
        priority: c.category === "critical" ? "critical" : "normal",
        category: CATEGORY_FOR_TASK[c.source ?? ""] ?? "support",
        dueDate: due,
        link: `/posteingang/${row.id}`,
        systemKey: `mail:${row.id}`,
      })
      .returning({ id: schema.tasks.id });
    await db.update(schema.emails).set({ taskId: task.id }).where(eq(schema.emails.id, row.id));

    const caseType = CASE_TYPE[c.topic];
    if (caseType) {
      await db.insert(schema.cases).values({
        tenantId,
        channel: c.source === "ebay" ? "ebay" : c.source === "tiktok" ? "tiktok" : c.source === "temu" ? "temu" : "amazon",
        type: caseType,
        title: clip(m.subject, 200),
        externalId: c.references.caseId ?? null,
        orderRef: c.references.amazonOrder ?? c.references.ebayOrder ?? null,
        deadline: due,
        notes: `Aus Mail vom ${m.receivedAt.toLocaleDateString("de-DE")}`,
      });
    }
    if (c.references.caseId) {
      const claims = await db.select({ id: schema.claims.id }).from(schema.claims).where(and(eq(schema.claims.tenantId, tenantId), eq(schema.claims.amazonCaseId, c.references.caseId)));
      for (const cl of claims) await db.insert(schema.claimEvents).values({ tenantId, claimId: cl.id, action: "Mail zum Fall", note: clip(m.subject, 200) });
    }
  }
  return "new";
}

// --- Postfächer abrufen ---------------------------------------------------------------

async function mailboxToken(tenantId: string, mailbox: typeof schema.mailboxes.$inferSelect) {
  if (!mailbox.integrationId) throw new Error("Postfach ist nicht verbunden.");
  const [integ] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, mailbox.integrationId));
  if (!integ?.secretEncrypted) throw new Error("Anmeldung fehlt – Postfach neu verbinden.");
  const { refreshToken } = JSON.parse(decryptSecret(integ.secretEncrypted)) as { refreshToken: string };
  const app = await getIntegration(tenantId, mailbox.provider === "gmail" ? "google" : "microsoft");
  if (!app?.clientId || !app.clientSecret) throw new Error("App-Zugang fehlt (Anbindungen).");
  const params = { client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" };
  const tok = mailbox.provider === "gmail" ? await googleToken(params) : await microsoftToken({ ...params, scope: "offline_access Mail.Read User.Read" });
  if (tok.refresh_token && tok.refresh_token !== refreshToken) {
    await db.update(schema.integrations).set({ secretEncrypted: encryptSecret(JSON.stringify({ refreshToken: tok.refresh_token })), updatedAt: new Date() }).where(eq(schema.integrations.id, integ.id));
  }
  return tok.access_token;
}

export async function syncMailbox(tenantId: string, mailboxId: string) {
  const [mb] = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.id, mailboxId), eq(schema.mailboxes.tenantId, tenantId)));
  if (!mb || mb.provider === "upload" || !mb.active) return { new: 0 };
  const since = mb.lastSyncAt ? new Date(mb.lastSyncAt.getTime() - 3600_000) : new Date(Date.now() - 14 * 86400_000);
  let count = 0;
  try {
    const token = await mailboxToken(tenantId, mb);
    const mails =
      mb.provider === "gmail"
        ? await Promise.all((await gmailFetchRaw(token, Math.floor(since.getTime() / 1000))).map((r) => parseRaw(r.raw, r.id)))
        : (await graphFetch(token, since)).map(fromGraph);
    for (const m of mails) if ((await ingestMail(tenantId, mb.id, m)) === "new") count++;
    await db.update(schema.mailboxes).set({ lastSyncAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(schema.mailboxes.id, mb.id));
  } catch (e) {
    await db.update(schema.mailboxes).set({ lastError: e instanceof Error ? e.message : String(e), updatedAt: new Date() }).where(eq(schema.mailboxes.id, mb.id));
    throw e;
  }
  return { new: count };
}

export async function syncAllMailboxes(tenantId: string) {
  const boxes = await db.select().from(schema.mailboxes).where(and(eq(schema.mailboxes.tenantId, tenantId), eq(schema.mailboxes.active, true)));
  const results: { address: string; new?: number; error?: string }[] = [];
  for (const b of boxes) {
    if (b.provider === "upload") continue;
    try {
      results.push({ address: b.address, ...(await syncMailbox(tenantId, b.id)) });
    } catch (e) {
      results.push({ address: b.address, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
