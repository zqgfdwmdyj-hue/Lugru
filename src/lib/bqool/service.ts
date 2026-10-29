import "server-only";
import { and, eq, inArray, max } from "drizzle-orm";
import { db, schema } from "@/db";
import { repricerRows } from "@/lib/repricer";
import { readTable } from "@/lib/tabular";
import { leseBqool, pruefe, type BqoolMarkt, type BqoolZeile, type Hinweis } from "./logic";

// BQool-Export speichern (je Marktplatz ersetzen) und mit dem Mindestpreis des Seller-Systems abgleichen.

export async function importBqool(tenantId: string, bytes: Uint8Array, datei: string, standardMarkt: BqoolMarkt | null) {
  const t = readTable(bytes);
  const r = leseBqool(t.headers, t.rows, standardMarkt);
  if (!r.zeilen.length) {
    const why = r.fehlt.includes("SKU") ? "keine SKU-Spalte gefunden" : r.ohneMarkt ? `${r.ohneMarkt} Zeilen ohne erkennbaren Marktplatz – bitte oben den Marktplatz der Datei wählen` : "keine Zeilen mit SKU";
    return { ok: false as const, message: `Nichts eingelesen: ${why}. Ist das der Export „Manage Listings“ aus BQool?` };
  }
  const maerkte = [...new Set(r.zeilen.map((z) => z.marktplatz))];
  const L = schema.bqoolListings;
  const now = new Date();
  // Doppelte SKU je Marktplatz in der Datei: die letzte Zeile gilt.
  const unique = new Map(r.zeilen.map((z) => [`${z.marktplatz}|${z.sku}`, z]));
  await db.transaction(async (tx) => {
    await tx.delete(L).where(and(eq(L.tenantId, tenantId), inArray(L.marktplatz, maerkte)));
    const values = [...unique.values()].map((z) => ({ tenantId, ...z, datei: datei.slice(0, 200), eingelesenAm: now }));
    for (let i = 0; i < values.length; i += 500) await tx.insert(L).values(values.slice(i, i + 500));
  });
  await db.insert(schema.reportImports).values({ tenantId, reportType: "BQool Manage Listings", fileName: datei.slice(0, 200), via: "upload", rows: r.zeilen.length, inserted: unique.size, message: maerkte.join(", ") });
  const je = maerkte.map((m) => `${m} ${[...unique.values()].filter((z) => z.marktplatz === m).length}`).join(", ");
  const warn = [r.fehlt.length ? `nicht in der Datei: ${r.fehlt.join(", ")}` : "", r.ohneMarkt ? `${r.ohneMarkt} Zeilen ohne Marktplatz übersprungen` : "", r.ohneSku ? `${r.ohneSku} Zeilen ohne SKU übersprungen` : ""].filter(Boolean).join(" · ");
  return { ok: true as const, message: `${unique.size} SKUs eingelesen (${je}).${warn ? ` Hinweis: ${warn}.` : ""}`, erkannt: r.erkannt };
}

export type BqoolAnsicht = BqoolZeile & { untergrenze: number | null; ek: number | null; hinweise: Hinweis[]; eingelesenAm: Date; datei: string | null };

export async function bqoolStand(tenantId: string) {
  const L = schema.bqoolListings;
  const [rows, sys] = await Promise.all([db.select().from(L).where(eq(L.tenantId, tenantId)), repricerRows(tenantId)]);
  const bySku = new Map(sys.map((r) => [r.sku, r]));
  const mitRegel = new Set(rows.filter((r) => r.regel).map((r) => r.marktplatz));
  const zeilen: BqoolAnsicht[] = rows.map((r) => {
    const s = bySku.get(r.sku);
    const z: BqoolZeile = { marktplatz: r.marktplatz as BqoolMarkt, sku: r.sku, asin: r.asin, titel: r.titel, versand: r.versand as BqoolZeile["versand"], preis: r.preis, min: r.min, max: r.max, regel: r.regel, status: r.status as BqoolZeile["status"], buyboxPreis: r.buyboxPreis, buyboxGewinner: r.buyboxGewinner, eigeneBuybox: r.eigeneBuybox, niedrigsterPreis: r.niedrigsterPreis, angebote: r.angebote, bestand: r.bestand, zusatz: r.zusatz };
    // Mindestpreis des Seller-Systems rechnet mit Gebühren/USt wie in DE – für andere Länder ein Richtwert.
    const untergrenze = s?.min ?? null;
    return { ...z, untergrenze, ek: s?.unitCost ?? null, hinweise: pruefe(z, untergrenze, mitRegel.has(r.marktplatz)), eingelesenAm: r.eingelesenAm, datei: r.datei };
  });
  const stand = await db.select({ markt: L.marktplatz, am: max(L.eingelesenAm) }).from(L).where(eq(L.tenantId, tenantId)).groupBy(L.marktplatz);
  return { zeilen, stand: stand.map((s) => ({ marktplatz: s.markt, am: s.am })) };
}
