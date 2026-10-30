import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { preislisteAuswerten, scanNachladen } from "@/lib/b2b/scanner";
import { spaltenZuordnen } from "@/lib/b2b/preislisten-mail";
import { importTable } from "@/lib/suppliers/feed-service";
import { readTable, type Table } from "@/lib/tabular";
import { angeboteAlsTabelle, type Angebot } from "./logic";
import type { EingangDatei } from "./service";

// Preislisten-Weiche: Tabelle (XLSX/CSV) oder ab ~15 erkannten Zeilen → Preislisten-Scanner (B2B), Lieferant = Quelle.

const F = schema.supplierFeeds;
const S = schema.suppliers;

export async function alsPreisliste(tenantId: string, o: { quelle: string | null; tabellen: EingangDatei[]; angebote: Angebot[] }): Promise<{ feedId: string; text: string }> {
  const q = o.quelle?.trim() || null;
  const [lief] = q ? await db.select({ id: S.id }).from(S).where(and(eq(S.tenantId, tenantId), sql`(lower(${S.name}) = lower(${q}) or lower(${S.code}) = lower(${q}))`)).limit(1) : [];
  const name = `${q ?? "Unbekannt"} – Deal-Eingang`;
  let [feed] = await db.select().from(F).where(and(eq(F.tenantId, tenantId), eq(F.name, name)));
  if (!feed) [feed] = await db.insert(F).values({ tenantId, name, supplierId: lief?.id ?? null }).returning();
  let t: Table | null = null;
  for (const d of o.tabellen) {
    try {
      t = readTable(d.bytes);
      if (t.rows.length) break;
    } catch {
      t = null;
    }
  }
  if (!t) t = angeboteAlsTabelle(o.angebote);
  const z = await spaltenZuordnen(tenantId, t, feed.mapping);
  const r = await importTable(tenantId, feed, t, { mapping: z.mapping, full: true });
  if (!r.ok) return { feedId: feed.id, text: `Preisliste ${q ?? ""} erkannt (${t.rows.length} Zeilen) – Spalten bitte zuordnen.`.replace("  ", " ") };
  await scanNachladen(tenantId, feed.id, 80).catch(() => 0);
  const a = await preislisteAuswerten(tenantId, feed.id);
  const n = { gruen: 0, gelb: 0, rot: 0 } as Record<string, number>;
  for (const x of a?.zeilen ?? []) n[x.ampel] = (n[x.ampel] ?? 0) + 1;
  const offen = a?.stand.offen ?? 0;
  return { feedId: feed.id, text: `Preisliste${q ? ` von ${q}` : ""}: ${t.rows.length} Zeilen – ${n.gruen} 🟢, ${n.gelb} 🟡, ${n.rot} 🔴${offen ? ` (Marktdaten für ${offen} Länder-Werte laden noch)` : ""}.` };
}
