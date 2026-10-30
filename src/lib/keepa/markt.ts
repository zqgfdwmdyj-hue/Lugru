import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { keepaKey, keepaProduktVerlauf } from "@/lib/integrations/clients/keepa";
import { KEEPA_VERALTET_STUNDEN, keepaAlterHinweis, keepaNeuAbrufen, MARKTPLAETZE, standAusKeepa, type KeepaStand, type Marktplatz } from "./auswertung";

// Keepa-Daten je ASIN und Marktplatz: zuerst aus dem Zwischenspeicher (jünger als 6 Stunden), sonst bei Keepa
// abfragen und speichern. Ist Keepa gerade nicht erreichbar oder sind die Tokens aufgebraucht, wird ein älterer
// Stand mit Hinweis verwendet. Keepa wird immer mit update=48 gefragt: Ist Keepas eigener Stand älter als 48 Std.,
// holt Keepa das Produkt frisch von Amazon. Bleibt er trotzdem alt, steht ein Hinweis im Ergebnis (alterHinweis).

export const MAX_ALTER_STUNDEN = 6;

export type MarktErgebnis = {
  marktplatz: Marktplatz;
  stand: KeepaStand | null;
  abgerufen: Date;
  ausSpeicher: boolean;
  tokensUebrig: number | null;
  warnung?: string;
  /** Keepas Werte sind älter als 48 Std. (Text für das Ergebnis). */
  alterHinweis?: string;
};

export async function keepaMarkt(tenantId: string, asin: string, mp: Marktplatz, now = Date.now()): Promise<MarktErgebnis> {
  const C = schema.keepaCache;
  const [row] = await db.select().from(C).where(and(eq(C.tenantId, tenantId), eq(C.asin, asin), eq(C.marktplatz, mp)));
  const ausRow = (warnung?: string): MarktErgebnis => {
    const stand = row!.gefunden ? (row!.stand ?? null) : null;
    return { marktplatz: mp, stand, abgerufen: row!.abgerufenAm, ausSpeicher: true, tokensUebrig: row!.tokensUebrig, warnung, alterHinweis: keepaAlterHinweis(stand?.keepa_aktualisiert, now) };
  };
  if (!keepaNeuAbrufen(row, now, MAX_ALTER_STUNDEN)) return ausRow();
  const key = await keepaKey(tenantId);
  if (!key) {
    if (row) return ausRow("Keepa ist nicht mehr verbunden – älterer Stand.");
    throw new Error("Keepa ist nicht verbunden – unter Anbindungen → Keepa den API-Schlüssel eintragen.");
  }
  try {
    const { product, tokensLeft } = await keepaProduktVerlauf(key, asin, MARKTPLAETZE[mp].domain, { updateStunden: KEEPA_VERALTET_STUNDEN });
    const roh = standAusKeepa(product, mp, now);
    const stand: KeepaStand | null = roh ? { ...roh, update_angefordert: true } : null;
    const abgerufen = new Date(now);
    const werte = { abgerufenAm: abgerufen, gefunden: stand !== null, stand, tokensUebrig: tokensLeft };
    await db.insert(C).values({ tenantId, asin, marktplatz: mp, ...werte }).onConflictDoUpdate({ target: [C.tenantId, C.asin, C.marktplatz], set: werte });
    return { marktplatz: mp, stand, abgerufen, ausSpeicher: false, tokensUebrig: tokensLeft, alterHinweis: keepaAlterHinweis(stand?.keepa_aktualisiert, now) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (row) return ausRow(`Keepa gerade nicht abrufbar (${msg}) – älterer Stand.`);
    throw e;
  }
}
