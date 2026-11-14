import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MeldeArt } from "./logic";

/** Inhaber (nicht nur lesend, aktiv) – Empfänger für Repricing- und Druck-Hinweise. */
async function inhaber(tenantId: string): Promise<string[]> {
  const M = schema.memberships;
  return (await db.select({ id: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner"), eq(M.readOnly, false), isNull(M.deaktiviertAm))).orderBy(asc(M.createdAt))).map((m) => m.id);
}

/** Push an den Inhaber (ohne Discord). */
export async function inhaberPushen(tenantId: string, m: { titel: string; text: string; link: string; aktionen?: { aktion: string; titel: string; link: string }[] }, art: Extract<MeldeArt, "repricing" | "druck">) {
  const an = await inhaber(tenantId);
  if (!an.length) return;
  const { melden } = await import("./service");
  await melden(tenantId, an, { ...m, art, aktionen: m.aktionen ?? null }, { ohneDiscord: true }).catch((e) => console.error(`[Push ${art}]`, e instanceof Error ? e.message : e));
}
