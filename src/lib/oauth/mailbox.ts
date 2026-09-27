import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { encryptSecret } from "@/lib/crypto";

/** Legt nach erfolgreicher Anmeldung das Postfach an (oder aktualisiert es). */
export async function saveMailbox(tenantId: string, provider: "gmail" | "outlook", address: string, refreshToken: string) {
  const [existing] = await db
    .select()
    .from(schema.mailboxes)
    .where(and(eq(schema.mailboxes.tenantId, tenantId), eq(schema.mailboxes.provider, provider), eq(sql`lower(${schema.mailboxes.address})`, address.toLowerCase())));
  const sealed = encryptSecret(JSON.stringify({ refreshToken }));
  if (existing?.integrationId) {
    await db.update(schema.integrations).set({ secretEncrypted: sealed, updatedAt: new Date() }).where(eq(schema.integrations.id, existing.integrationId));
    await db.update(schema.mailboxes).set({ active: true, lastError: null, updatedAt: new Date() }).where(eq(schema.mailboxes.id, existing.id));
    return existing.id;
  }
  const [integ] = await db
    .insert(schema.integrations)
    .values({ tenantId, provider: `mailbox:${provider}:${address.toLowerCase()}`, label: address, secretEncrypted: sealed })
    .returning({ id: schema.integrations.id });
  const [mb] = await db.insert(schema.mailboxes).values({ tenantId, provider, address, integrationId: integ.id }).returning({ id: schema.mailboxes.id });
  return mb.id;
}
