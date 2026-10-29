import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { readTable } from "@/lib/tabular";
import { leseBestandsplanung, leseListings, leseSalesTraffic, type Land } from "./logic";

// Amazon-Berichte je Land speichern (je Land und Bericht komplett ersetzen) – vom Abruf über die Schnittstelle
// (processPendingReports) aufgerufen. Ohne Bezug zur Schnittstelle selbst, damit kein Kreis entsteht.

export const MARKT_BERICHTE = {
  buybox: "GET_SALES_AND_TRAFFIC_REPORT",
  listungen: "GET_MERCHANT_LISTINGS_ALL_DATA",
  lageralter: "GET_FBA_INVENTORY_PLANNING_DATA",
} as const;
export type MarktBericht = keyof typeof MARKT_BERICHTE;
export const berichtVonTyp = (t: string) => (Object.entries(MARKT_BERICHTE).find(([, v]) => v === t)?.[0] as MarktBericht | undefined) ?? null;

export async function speichereMarktBericht(tenantId: string, bericht: MarktBericht, landIn: Land, bytes: Uint8Array): Promise<number> {
  const now = new Date();
  let n = 0;
  if (bericht === "buybox") {
    const r = leseSalesTraffic(JSON.parse(new TextDecoder("utf-8").decode(bytes)));
    const land = r.land ?? landIn;
    const B = schema.amazonBuybox;
    await db.transaction(async (tx) => {
      await tx.delete(B).where(and(eq(B.tenantId, tenantId), eq(B.land, land)));
      const values = r.zeilen.map((z) => ({ tenantId, land, ...z, von: r.von, bis: r.bis, abgerufenAm: now }));
      // Doppelte ASIN (z. B. bei SKU-Auflösung): erste Zeile gilt.
      const uniq = [...new Map(values.map((v) => [v.asin, v])).values()];
      for (let i = 0; i < uniq.length; i += 500) await tx.insert(B).values(uniq.slice(i, i + 500));
      n = uniq.length;
    });
  } else if (bericht === "listungen") {
    const t = readTable(bytes);
    const zeilen = [...new Map(leseListings(t.headers, t.rows).map((z) => [z.sku, z])).values()];
    const L = schema.amazonListungen;
    await db.transaction(async (tx) => {
      await tx.delete(L).where(and(eq(L.tenantId, tenantId), eq(L.land, landIn)));
      for (let i = 0; i < zeilen.length; i += 500) await tx.insert(L).values(zeilen.slice(i, i + 500).map((z) => ({ tenantId, land: landIn, ...z, abgerufenAm: now })));
    });
    n = zeilen.length;
  } else {
    const t = readTable(bytes);
    const zeilen = [...new Map(leseBestandsplanung(t.headers, t.rows).map((z) => [z.sku, z])).values()];
    const A = schema.amazonLageralter;
    await db.transaction(async (tx) => {
      await tx.delete(A).where(and(eq(A.tenantId, tenantId), eq(A.land, landIn)));
      for (let i = 0; i < zeilen.length; i += 500) await tx.insert(A).values(zeilen.slice(i, i + 500).map((z) => ({ tenantId, land: landIn, ...z, abgerufenAm: now })));
    });
    n = zeilen.length;
  }
  await db.insert(schema.reportImports).values({ tenantId, reportType: `${MARKT_BERICHTE[bericht]} (${landIn})`, fileName: `SP-API ${bericht} ${landIn}`, via: "api", rows: n, inserted: n });
  return n;
}
