import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { limitErreicht, profilMitVorgaben } from "./story-logic";

const K = schema.videoKanaele;
const A = schema.videoAuftraege;

/** Kosten eines Kanals im laufenden Monat ($, Ist aus den Anbieter-Aufrufen). */
export async function kanalMonatKosten(tenantId: string, kanalId: string): Promise<number> {
  const [r] = await db
    .select({ k: sql<number>`coalesce(sum(${A.kostenIst}), 0)::float` })
    .from(A)
    .where(and(eq(A.tenantId, tenantId), eq(A.kanalId, kanalId), gte(A.createdAt, sql`date_trunc('month', now())`)));
  return r?.k ?? 0;
}

/**
 * B37.3.5 Monatslimit: Ist eine wartende Story über dem Limit ihres Kanals, bekommt sie den Status „fehler“ mit Hinweis
 * (kein stilles Warten) und der Worker nimmt sie nicht. Liefert true, wenn gesperrt.
 */
export async function storySperre(tenantId: string, auftragId: string): Promise<boolean> {
  const [r] = await db.select({ art: A.art, kanalId: A.kanalId, schritte: A.schritte, instagram: K.instagram }).from(A).innerJoin(K, eq(K.id, A.kanalId)).where(and(eq(A.tenantId, tenantId), eq(A.id, auftragId)));
  if (!r || r.art !== "story") return false;
  const limit = profilMitVorgaben(r.instagram).monatslimit;
  if (limit === null || limit === undefined) return false;
  const kosten = await kanalMonatKosten(tenantId, r.kanalId);
  if (!limitErreicht(kosten, limit)) return false;
  const fehler = `Monatslimit erreicht (${kosten.toFixed(2)} $ von ${limit.toFixed(2)} $) – Erzeugung gestoppt. Limit im Kanalprofil erhöhen oder nächsten Monat abwarten.`;
  await db.update(A).set({ status: "fehler", schritt: "story", schritte: { ...r.schritte, story: { status: "fehler", fehler, am: new Date().toISOString() } }, updatedAt: new Date() }).where(eq(A.id, auftragId));
  return true;
}
