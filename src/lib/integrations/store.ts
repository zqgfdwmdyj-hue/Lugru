import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { integrationDef } from "./registry";

export type IntegrationValues = Record<string, string>;

/** Liest Einstellungen und entschlüsselte Geheimnisse einer Anbindung. */
export async function getIntegration(tenantId: string, provider: string): Promise<IntegrationValues | null> {
  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.provider, provider)));
  if (!row) return null;
  const secrets = row.secretEncrypted ? (JSON.parse(decryptSecret(row.secretEncrypted)) as IntegrationValues) : {};
  return { ...(row.config as IntegrationValues), ...secrets };
}

/** Speichert eine Anbindung. Leere Geheimfelder behalten den bisherigen Wert. */
export async function saveIntegration(tenantId: string, provider: string, values: IntegrationValues) {
  const def = integrationDef(provider);
  if (!def) throw new Error("Unbekannte Anbindung");
  const current = (await getIntegration(tenantId, provider)) ?? {};
  const config: IntegrationValues = {};
  const secrets: IntegrationValues = {};
  for (const f of def.fields) {
    const v = (values[f.key] ?? "").trim();
    if (f.secret) {
      const keep = v === "" ? current[f.key] : v;
      if (keep) secrets[f.key] = keep;
    } else if (v) {
      config[f.key] = v;
    }
  }
  const sealed = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null;
  const [existing] = await db
    .select({ id: schema.integrations.id })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.provider, provider)));
  if (existing) {
    await db
      .update(schema.integrations)
      .set({ config, secretEncrypted: sealed, updatedAt: new Date() })
      .where(eq(schema.integrations.id, existing.id));
  } else {
    await db.insert(schema.integrations).values({ tenantId, provider, config, secretEncrypted: sealed });
  }
}

export async function deleteIntegration(tenantId: string, provider: string) {
  await db
    .delete(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.provider, provider)));
}

/** Für die Übersicht: welche Felder gesetzt sind (Geheimnisse nur als „gesetzt“). */
export async function integrationStatus(tenantId: string) {
  const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.tenantId, tenantId));
  const out = new Map<string, { config: IntegrationValues; secretKeys: string[]; updatedAt: Date; label: string | null }>();
  for (const r of rows) {
    let secretKeys: string[] = [];
    try {
      secretKeys = r.secretEncrypted ? Object.keys(JSON.parse(decryptSecret(r.secretEncrypted))) : [];
    } catch {
      secretKeys = [];
    }
    out.set(r.provider, { config: r.config as IntegrationValues, secretKeys, updatedAt: r.updatedAt, label: r.label });
  }
  return out;
}
