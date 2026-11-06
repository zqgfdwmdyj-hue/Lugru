import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// Schon verarbeitete Mails (Hash der Message-ID bzw. „p:<Anbieter-ID>“): der Abruf lädt sie nicht noch einmal.
// Auch vom System selbst verschickte Mails stehen hier – ihre Kopie im Gesendet-Ordner ist kein „ausgehend“.

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 40);

export async function gesehenMerken(tenantId: string, key: string, ergebnis: string) {
  if (!key) return;
  await db.insert(schema.mailGesehen).values({ tenantId, keyHash: hash(key), ergebnis }).onConflictDoNothing();
}

/** Welche Schlüssel sind noch unbekannt? */
export async function unbekannt(tenantId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const G = schema.mailGesehen;
  const map = new Map(keys.map((k) => [hash(k), k]));
  const rows = await db.select({ h: G.keyHash }).from(G).where(and(eq(G.tenantId, tenantId), inArray(G.keyHash, [...map.keys()])));
  const da = new Set(rows.map((r) => r.h));
  return new Set([...map].filter(([h]) => !da.has(h)).map(([, k]) => k));
}

/** Alte Einträge aufräumen (der Abruf schaut höchstens 14 Tage zurück). */
export async function gesehenAufraeumen(tenantId: string) {
  await db.delete(schema.mailGesehen).where(and(eq(schema.mailGesehen.tenantId, tenantId), sql`${schema.mailGesehen.createdAt} < now() - interval '45 days'`));
}
