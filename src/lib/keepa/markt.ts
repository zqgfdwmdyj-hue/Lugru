import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { keepaKey, keepaProduktVerlauf } from "@/lib/integrations/clients/keepa";
import { MARKTPLAETZE, standAusKeepa, type KeepaStand, type Marktplatz } from "./auswertung";

// Keepa-Daten je ASIN und Marktplatz: zuerst aus dem Zwischenspeicher (jünger als 6 Stunden), sonst bei Keepa
// abfragen und speichern. Ist Keepa gerade nicht erreichbar oder sind die Tokens aufgebraucht, wird ein älterer
// Stand mit Hinweis verwendet.

export const MAX_ALTER_STUNDEN = 6;

export type MarktErgebnis = {
  marktplatz: Marktplatz;
  stand: KeepaStand | null;
  abgerufen: Date;
  ausSpeicher: boolean;
  tokensUebrig: number | null;
  warnung?: string;
};

export async function keepaMarkt(tenantId: string, asin: string, mp: Marktplatz, now = Date.now()): Promise<MarktErgebnis> {
  const C = schema.keepaCache;
  const [row] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.asin, asin), eq(C.marktplatz, mp)));
  const ausRow = (warnung?: string): MarktErgebnis => ({ marktplatz: mp, stand: row!.gefunden ? (row!.stand ?? null) : null, abgerufen: row!.abgerufenAm, ausSpeicher: true, tokensUebrig: row!.tokensUebrig, warnung });
  if (row && now - row.abgerufenAm.getTime() < MAX_ALTER_STUNDEN * 3600_000) return ausRow();
  const key = await keepaKey(tenantId);
  if (!key) {
    if (row) return ausRow("Keepa ist nicht mehr verbunden – älterer Stand.");
    throw new Error("Keepa ist nicht verbunden – unter Anbindungen → Keepa den API-Schlüssel eintragen.");
  }
  try {
    const { product, tokensLeft } = await keepaProduktVerlauf(key, asin, MARKTPLAETZE[mp].domain);
    const stand = standAusKeepa(product, mp, now);
    const abgerufen = new Date(now);
    const werte = { abgerufenAm: abgerufen, gefunden: stand !== null, stand, tokensUebrig: tokensLeft };
    await db.insert(C).values({ tenantId, asin, marktplatz: mp, ...werte }).onConflictDoUpdate({ target: [C.tenantId, C.asin, C.marktplatz], set: werte });
    return { marktplatz: mp, stand, abgerufen, ausSpeicher: false, tokensUebrig: tokensLeft };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (row) return ausRow(`Keepa gerade nicht abrufbar (${msg}) – älterer Stand.`);
    throw e;
  }
}
