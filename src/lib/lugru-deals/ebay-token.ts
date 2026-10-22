import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { ebayDb } from "@/lib/ebay/db/pg";
import { getSettings } from "@/lib/ebay/db/db";
import { getAppAccessToken } from "@/lib/ebay/ebay/auth";
import { schluesselPasst } from "./schluessel";

/**
 * Findet den Mandanten zu einem Verbindungsschlüssel von Lugru Deals. Jeder
 * Mandant mit der Anbindung „lugru_deals“ wird geprüft — es sind wenige, und
 * der Schlüssel liegt verschlüsselt, ein Index darauf ginge nicht.
 */
export async function tenantFuerDealsSchluessel(schluessel: string): Promise<string | null> {
  if (!schluessel) return null;
  const zeilen = await db
    .select({ tenantId: schema.integrations.tenantId })
    .from(schema.integrations)
    .where(eq(schema.integrations.provider, "lugru_deals"));
  let gefunden: string | null = null;
  for (const z of zeilen) {
    const werte = await getIntegration(z.tenantId, "lugru_deals");
    // Kein früher Abbruch: jeder Kandidat kostet gleich viel Zeit.
    if (schluesselPasst(schluessel, werte?.schluessel) && !gefunden) gefunden = z.tenantId;
  }
  return gefunden;
}

/** Das eBay-App-Token des Mandanten (Client-Credentials, nur Lesezugriff auf Angebote). */
export async function ebayAppTokenFuer(tenantId: string): Promise<{ accessToken: string; env: string }> {
  const edb = ebayDb(tenantId);
  const settings = await getSettings(edb);
  const accessToken = await getAppAccessToken(edb, settings);
  return { accessToken, env: settings.env };
}
