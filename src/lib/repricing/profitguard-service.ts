import "server-only";
import { and, eq, inArray, max } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { decodeText, detectDelimiter, isSpreadsheetBinary, readTable } from "@/lib/tabular";
import { formatLernen, gebuehrenAusListing, leseProfitguard, type PgMarkt } from "./profitguard-logic";

// ProfitGuard-Export („Export & Import“ in ProfitGuard, CSV/XLSX) als Ist-Stand einlesen – je Marktplatz ersetzen –,
// Dateiformat für die Importdatei lernen, Gebühren je Land merken; Buy-Box-Anteil je SKU und Land aus ProfitGuard bzw.
// dem Amazon-Geschäftsbericht (Sales and Traffic). Keine Schnittstelle, keine Browser-Sitzung.

const PG = schema.profitguardListings;

export async function importProfitguard(tenantId: string, bytes: Uint8Array, datei: string, standardMarkt: PgMarkt | null, via: "upload" | "claude" = "upload") {
  const t = readTable(bytes);
  const r = leseProfitguard(t.headers, t.rows, standardMarkt);
  if (!r.zeilen.length) {
    const why = r.fehlt.includes("SKU") ? "keine SKU-Spalte gefunden" : r.ohneMarkt ? `${r.ohneMarkt} Zeilen ohne erkennbaren Marktplatz – bitte den Marktplatz der Datei wählen` : "keine Zeilen mit SKU";
    return { ok: false as const, message: `Nichts eingelesen: ${why}. Ist das der Export aus ProfitGuard („Export & Import“)?` };
  }
  const maerkte = [...new Set(r.zeilen.map((z) => z.marktplatz))];
  const now = new Date();
  // Doppelte SKU je Marktplatz in der Datei: die letzte Zeile gilt.
  const unique = new Map(r.zeilen.map((z) => [`${z.marktplatz}|${z.sku}`, z]));
  await db.transaction(async (tx) => {
    const alt = new Map((await tx.select({ m: PG.marktplatz, sku: PG.sku, strategie: PG.strategie, seit: PG.strategieSeit }).from(PG).where(and(eq(PG.tenantId, tenantId), inArray(PG.marktplatz, maerkte)))).map((x) => [`${x.m}|${x.sku}`, x]));
    await tx.delete(PG).where(and(eq(PG.tenantId, tenantId), inArray(PG.marktplatz, maerkte)));
    const values = [...unique.values()].map((z) => {
      const a = alt.get(`${z.marktplatz}|${z.sku}`);
      return { tenantId, ...z, datei: datei.slice(0, 200), eingelesenAm: now, strategieSeit: a && (a.strategie ?? "") === (z.strategie ?? "") ? (a.seit ?? now) : now };
    });
    for (let i = 0; i < values.length; i += 500) await tx.insert(PG).values(values.slice(i, i + 500));
  });
  // Format für die Importdatei lernen (Kopfzeile, Trennzeichen, Dezimalzeichen, Werte für „im Repricing“).
  const trenner = isSpreadsheetBinary(bytes) ? "," : detectDelimiter(decodeText(bytes).slice(0, 20000));
  const format = formatLernen(t.headers, t.rows, r.spalten, trenner);
  if (format) {
    const { repricingEinstellungenSpeichern } = await import("./soll-service");
    const s = await getSettings(tenantId);
    await repricingEinstellungenSpeichern(tenantId, { profitguard: { strategieNamen: s.repricing.profitguard.strategieNamen, format } });
  }
  const { gebuehrenSpeichern } = await import("./gebuehren");
  const gebuehren = await gebuehrenSpeichern(tenantId, "liste", [...unique.values()].map((z) => ({ land: z.marktplatz, sku: z.sku, asin: z.asin, preis: z.preis, ...gebuehrenAusListing(z.zusatz, z.preis) }))).catch(() => 0);
  await import("./liquidation").then((x) => x.liquidationIstAbgleich(tenantId)).catch(() => undefined);
  await import("./soll-service").then((x) => x.repricingAbgleichAufgabe(tenantId)).catch(() => undefined);
  await db.insert(schema.reportImports).values({ tenantId, reportType: "ProfitGuard Export", fileName: datei.slice(0, 200), via: via === "claude" ? "api" : "upload", rows: r.zeilen.length, inserted: unique.size, message: maerkte.join(", ") });
  const je = maerkte.map((m) => `${m} ${[...unique.values()].filter((z) => z.marktplatz === m).length}`).join(", ");
  const warn = [r.fehlt.length ? `nicht in der Datei: ${r.fehlt.join(", ")}` : "", r.ohneMarkt ? `${r.ohneMarkt} Zeilen ohne Marktplatz übersprungen` : "", r.ohneSku ? `${r.ohneSku} Zeilen ohne SKU übersprungen` : "", format ? "" : "Format für die Importdatei nicht gelernt (SKU/Min/Max fehlen)"].filter(Boolean).join(" · ");
  return { ok: true as const, message: `${unique.size} SKUs aus ProfitGuard eingelesen (${je})${gebuehren ? `, Gebühren je Land für ${gebuehren}` : ""}.${warn ? ` Hinweis: ${warn}.` : ""}`, erkannt: r.erkannt };
}

/** Stand der ProfitGuard-Importe je Marktplatz. */
export async function profitguardStand(tenantId: string) {
  const rows = await db.select({ markt: PG.marktplatz, am: max(PG.eingelesenAm) }).from(PG).where(eq(PG.tenantId, tenantId)).groupBy(PG.marktplatz);
  return rows.map((x) => ({ marktplatz: x.markt, am: x.am }));
}

/**
 * Buy-Box-Anteil in % je „Land|SKU“: aus dem ProfitGuard-Export, sonst aus dem Amazon-Geschäftsbericht (Sales and
 * Traffic, 30 Tage; per SKU bzw. ASIN). Ersetzt die frühere BQool-„Listing Performance“.
 */
export async function buyboxAnteilJeSku(tenantId: string): Promise<Map<string, { anteil: number; quelle: "profitguard" | "amazon" }>> {
  const BB = schema.amazonBuybox;
  const [pg, amz] = await Promise.all([
    db.select({ land: PG.marktplatz, sku: PG.sku, asin: PG.asin, anteil: PG.buyboxAnteil }).from(PG).where(eq(PG.tenantId, tenantId)),
    db.select({ land: BB.land, sku: BB.sku, asin: BB.asin, anteil: BB.buyboxProzent }).from(BB).where(eq(BB.tenantId, tenantId)),
  ]);
  const out = new Map<string, { anteil: number; quelle: "profitguard" | "amazon" }>();
  const amzAsin = new Map<string, number>();
  for (const a of amz) {
    if (a.anteil === null) continue;
    if (a.sku) out.set(`${a.land}|${a.sku}`, { anteil: a.anteil, quelle: "amazon" });
    amzAsin.set(`${a.land}|${a.asin}`, a.anteil);
  }
  for (const p of pg) {
    const k = `${p.land}|${p.sku}`;
    if (p.anteil !== null) out.set(k, { anteil: p.anteil, quelle: "profitguard" });
    else if (!out.has(k) && p.asin && amzAsin.has(`${p.land}|${p.asin}`)) out.set(k, { anteil: amzAsin.get(`${p.land}|${p.asin}`)!, quelle: "amazon" });
  }
  return out;
}

/** Buy-Box-Anteil je Land (Morgenbericht, Repricer-Seite): ProfitGuard-Mittel bzw. Amazon nach Sitzungen gewichtet. */
export async function buyboxAnteilJeLand(tenantId: string): Promise<{ land: string; anteil: number; quelle: "profitguard" | "amazon"; skus: number }[]> {
  const BB = schema.amazonBuybox;
  const [pg, amz] = await Promise.all([
    db.select({ land: PG.marktplatz, anteil: PG.buyboxAnteil }).from(PG).where(eq(PG.tenantId, tenantId)),
    db.select({ land: BB.land, anteil: BB.buyboxProzent, sitzungen: BB.sitzungen }).from(BB).where(eq(BB.tenantId, tenantId)),
  ]);
  const je = new Map<string, { anteil: number; quelle: "profitguard" | "amazon"; skus: number }>();
  const pgJe = new Map<string, number[]>();
  for (const p of pg) if (p.anteil !== null) pgJe.set(p.land, [...(pgJe.get(p.land) ?? []), p.anteil]);
  for (const [land, w] of pgJe) je.set(land, { anteil: Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 10) / 10, quelle: "profitguard", skus: w.length });
  const amzJe = new Map<string, { s: number; g: number; n: number }>();
  for (const a of amz) {
    if (a.anteil === null) continue;
    const g = a.sitzungen && a.sitzungen > 0 ? a.sitzungen : 1;
    const x = amzJe.get(a.land) ?? { s: 0, g: 0, n: 0 };
    amzJe.set(a.land, { s: x.s + a.anteil * g, g: x.g + g, n: x.n + 1 });
  }
  for (const [land, x] of amzJe) if (!je.has(land) && x.g > 0) je.set(land, { anteil: Math.round((x.s / x.g) * 10) / 10, quelle: "amazon", skus: x.n });
  return [...je.entries()].map(([land, v]) => ({ land, ...v })).sort((a, b) => ["DE", "FR", "IT", "ES"].indexOf(a.land) - ["DE", "FR", "IT", "ES"].indexOf(b.land) || a.land.localeCompare(b.land));
}

/** Morgenbericht: „Buy Box DE 29 %, FR 43 % (ProfitGuard)“. */
export async function buyboxMorgenZeile(tenantId: string): Promise<string | null> {
  const je = await buyboxAnteilJeLand(tenantId);
  if (!je.length) return null;
  const quellen = [...new Set(je.map((x) => (x.quelle === "profitguard" ? "ProfitGuard" : "Amazon-Geschäftsbericht")))].join("/");
  return `Buy Box ${je.map((x) => `${x.land} ${String(x.anteil).replace(".", ",")} %`).join(", ")} (${quellen})`;
}
