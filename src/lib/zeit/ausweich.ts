import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { freierTag, naechsterArbeitstag, type Block } from "./bloecke";

// Fälligkeit neuer/aktualisierter System-Aufgaben: nicht in freie Tage legen (eigenes Modul, damit
// tasks/system.ts es ohne Kreis-Import nutzen kann).

const cache = new Map<string, { at: number; bloecke: Block[] }>();
export const bloeckeGeaendert = (tenantId: string) => void cache.delete(tenantId);

async function freiBloecke(tenantId: string): Promise<Block[]> {
  const c = cache.get(tenantId);
  if (c && Date.now() - c.at < 60_000) return c.bloecke;
  const Z = schema.zeitbloecke;
  const rows = await db.select().from(Z).where(eq(Z.tenantId, tenantId));
  const bloecke = rows.filter((r) => r.art === "frei").map((r) => ({ id: r.id, art: r.art, titel: r.titel, userId: r.userId, wochentage: r.wochentage, ganztags: r.ganztags, vonZeit: r.vonZeit, bisZeit: r.bisZeit, gueltigVon: r.gueltigVon, gueltigBis: r.gueltigBis, stunden: r.stunden, link: r.link, aktiv: r.aktiv }));
  cache.set(tenantId, { at: Date.now(), bloecke });
  return bloecke;
}

/**
 * Fällt die Fälligkeit auf einen freien Tag, auf den nächsten Arbeitstag – außer heute/überfällig und wichtig
 * (dann Rückfrage auf der Startseite).
 */
export async function ausweichDatum(tenantId: string, dueDate: string | null | undefined, priority: string | undefined, heute: string): Promise<string | null> {
  if (!dueDate) return null;
  const bloecke = await freiBloecke(tenantId);
  if (!bloecke.length || !freierTag(bloecke, dueDate)) return dueDate;
  if (dueDate <= heute && priority === "critical") return dueDate;
  return naechsterArbeitstag(bloecke, dueDate < heute ? dueDate : addDaysIso(dueDate, 1));
}
