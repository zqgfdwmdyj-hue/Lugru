import "server-only";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/db";
import { importTable } from "@/lib/suppliers/feed-service";
import type { Table } from "@/lib/tabular";
import { spaltenZuordnen } from "./preislisten-mail";
import { scanNachladen } from "./scanner";

// Preisliste eines Lieferanten übernehmen – ein Weg für Oberfläche und Datei-Import: Spalten per Regeln, sonst KI;
// danach Marktdaten je Land im Hintergrund.

const F = schema.supplierFeeds;

export async function preislisteImportieren(tenantId: string, o: { supplierId: string; table: Table; name?: string | null; brutto?: boolean; voll?: boolean }) {
  const [sup] = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name, code: schema.suppliers.code }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, tenantId), eq(schema.suppliers.id, o.supplierId)));
  if (!sup) return { ok: false as const, message: "Lieferant nicht gefunden.", feedId: null, headers: [] as string[], ki: false };
  const name = (o.name ?? "").trim().slice(0, 120) || `${sup.name ?? sup.code} – Preisliste`;
  let [feed] = await db.select().from(F).where(and(eq(F.tenantId, tenantId), eq(F.supplierId, sup.id), eq(F.name, name)));
  if (!feed) [feed] = await db.insert(F).values({ tenantId, name, supplierId: sup.id, pricesGross: Boolean(o.brutto) }).returning();
  const z = await spaltenZuordnen(tenantId, o.table, feed.mapping);
  const r = await importTable(tenantId, feed, o.table, { mapping: z.mapping, full: Boolean(o.voll) });
  if (r.ok) after(() => scanNachladen(tenantId, feed.id, 80).catch((e) => console.error("B2B-Scan", e instanceof Error ? e.message : e)));
  return { ok: r.ok, message: r.message, feedId: feed.id, headers: r.headers ?? [], ki: z.ki, lieferant: sup.name ?? sup.code };
}

/** Lieferant aus einem Text (Name oder Kürzel, z. B. im Hinweis zum Datei-Import). Nur eindeutige Treffer. */
export async function lieferantAusText(tenantId: string, text: string | null | undefined): Promise<{ id: string; name: string } | null> {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  const alle = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name, code: schema.suppliers.code }).from(schema.suppliers).where(eq(schema.suppliers.tenantId, tenantId));
  const treffer = alle.filter((s) => (s.name && s.name.length >= 3 && t.includes(s.name.toLowerCase())) || (s.code && s.code.length >= 2 && new RegExp(`(^|[^a-z0-9])${s.code.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t)));
  return treffer.length === 1 ? { id: treffer[0].id, name: treffer[0].name ?? treffer[0].code ?? "" } : null;
}
