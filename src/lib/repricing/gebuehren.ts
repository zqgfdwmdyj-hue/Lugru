import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { GebuehrenBeobachtung } from "./strategie-logic";

// Gebühren je Land und SKU (FBA-Gebühr, Provisionssatz) für Soll-Min und Break-even speichern und laden.

const G = schema.repricingGebuehren;

export type GebuehrenZeile = { land: string; sku: string; asin?: string | null; fba: number | null; satz: number | null; preis: number | null; kategorie: string | null };

/** Gebühren einer Quelle speichern (nur Zeilen mit FBA-Gebühr oder Provision; vorhandene Werte derselben Quelle werden ersetzt). */
export async function gebuehrenSpeichern(tenantId: string, quelle: "liste" | "amazon", zeilen: GebuehrenZeile[]): Promise<number> {
  const werte = [...new Map(zeilen.filter((z) => z.fba !== null || z.satz !== null).map((z) => [`${z.land}|${z.sku}`, z])).values()];
  const jetzt = new Date();
  for (let i = 0; i < werte.length; i += 500) {
    await db
      .insert(G)
      .values(werte.slice(i, i + 500).map((z) => ({ tenantId, land: z.land, sku: z.sku, quelle, asin: z.asin ?? null, fba: z.fba, provisionSatz: z.satz, preis: z.preis, kategorie: z.kategorie, stand: jetzt })))
      .onConflictDoUpdate({
        target: [G.tenantId, G.land, G.sku, G.quelle],
        set: { asin: sql`coalesce(excluded.asin, ${G.asin})`, fba: sql`coalesce(excluded.fba, ${G.fba})`, provisionSatz: sql`coalesce(excluded.provision_satz, ${G.provisionSatz})`, preis: sql`excluded.preis`, kategorie: sql`coalesce(excluded.kategorie, ${G.kategorie})`, stand: sql`excluded.stand` },
      });
  }
  return werte.length;
}

export type GebuehrenJe = Map<string, { liste?: GebuehrenBeobachtung; amazon?: GebuehrenBeobachtung }>;

/** Gebühren je „Land|SKU“ und Quelle. */
export async function gebuehrenLaden(tenantId: string, laender: string[]): Promise<GebuehrenJe> {
  if (!laender.length) return new Map();
  const rows = await db.select().from(G).where(and(eq(G.tenantId, tenantId), inArray(G.land, laender)));
  const je: GebuehrenJe = new Map();
  for (const r of rows) {
    const k = `${r.land}|${r.sku}`;
    const e = je.get(k) ?? {};
    e[r.quelle] = { fba: r.fba, satz: r.provisionSatz, preis: r.preis, kategorie: r.kategorie };
    je.set(k, e);
  }
  return je;
}
