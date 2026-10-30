import "server-only";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyImport } from "@/lib/imports/apply";
import { ImportFormatError, parseArbitrageOne, readSheet } from "@/lib/imports/arbitrageone";
import { sellerboardCostMap, skuCostMap } from "@/lib/money/costs";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { ekAbgleich, ekVorschau, sellerboardXls } from "./logic";

// EK-Import: ArbitrageOne-Liste einmal hochladen → Vorschau → übernehmen (Chargen-Logik wie beim bisherigen Import)
// → sellerboard-Importdatei bzw. Browser-Automatik → am Folgetag mit dem sellerboard-EK gegenprüfen.

const E = schema.ekImporte;

export class EkImportFehler extends Error {}

/** SKUs, die das System kennt (Charge, Amazon-Bestand, sellerboard) – in Blöcken (Postgres: höchstens 1664 Werte je Liste). */
async function bekannteSkus(tenantId: string, skus: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < skus.length; i += 1000) {
    const teil = skus.slice(i, i + 1000);
    const [a, b, c] = await Promise.all([
      db.select({ sku: schema.lots.sku }).from(schema.lots).where(and(eq(schema.lots.tenantId, tenantId), inArray(schema.lots.sku, teil))),
      db.select({ sku: schema.amazonInventory.sku }).from(schema.amazonInventory).where(and(eq(schema.amazonInventory.tenantId, tenantId), inArray(schema.amazonInventory.sku, teil))),
      db.select({ sku: schema.sellerboardInventory.sku }).from(schema.sellerboardInventory).where(and(eq(schema.sellerboardInventory.tenantId, tenantId), inArray(schema.sellerboardInventory.sku, teil))),
    ]);
    for (const r of [...a, ...b, ...c]) out.add(r.sku);
  }
  return out;
}

/** Datei lesen und als Vorschau speichern (noch nichts übernommen). */
export async function ekImportVorschau(tenantId: string, userId: string | null, dateiname: string, bytes: Uint8Array): Promise<{ id: string; anzahl: Record<string, number>; zeilen: number }> {
  let parsed;
  try {
    parsed = parseArbitrageOne(readSheet(bytes));
  } catch (e) {
    if (e instanceof ImportFormatError) throw new EkImportFehler(`Keine EK-Liste erkannt: ${e.message} Erwartet: ArbitrageOne-Export für sellerboard (ASIN | SKU | Cost).`);
    throw e;
  }
  if (!parsed.rows.length) throw new EkImportFehler("Keine Zeilen mit SKU gefunden.");
  // Gleiche SKU mehrfach: die letzte Zeile gilt (wie beim Übernehmen).
  const roh = [...new Map(parsed.rows.map((r) => [r.sku, r])).values()];
  const [aktuell, bekannt] = await Promise.all([skuCostMap(tenantId), bekannteSkus(tenantId, roh.map((r) => r.sku))]);
  const v = ekVorschau(roh, new Map([...aktuell.entries()].map(([k, c]) => [k, { cost: c.cost, source: c.source }])), bekannt);
  const [e] = await db.insert(E).values({ tenantId, userId, dateiname: dateiname.slice(0, 200), quelle: parsed.source, roh, zeilen: v.zeilen, anzahl: v.anzahl }).returning({ id: E.id });
  return { id: e.id, anzahl: v.anzahl, zeilen: roh.length };
}

export async function ekImport(tenantId: string, id: string) {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  return e ?? null;
}

export async function ekImporte(tenantId: string, limit = 10) {
  return db.select({ id: E.id, dateiname: E.dateiname, status: E.status, anzahl: E.anzahl, sellerboard: E.sellerboard, geprueftAm: E.geprueftAm, pruefung: E.pruefung, createdAt: E.createdAt, uebernommenAm: E.uebernommenAm }).from(E).where(eq(E.tenantId, tenantId)).orderBy(desc(E.createdAt)).limit(limit);
}

/** Vorschau übernehmen: EK mit der bisherigen Chargen-Logik; danach Nachbearbeitung (fehlende EK, Kapital-Ampel …). */
export async function ekImportUebernehmen(tenantId: string, userId: string, id: string) {
  const e = await ekImport(tenantId, id);
  if (!e) throw new EkImportFehler("Import nicht gefunden.");
  if (e.status !== "vorschau") throw new EkImportFehler(e.status === "uebernommen" ? "Schon übernommen." : "Verworfen.");
  const s = await getSettings(tenantId);
  const stats = await applyImport({ tenantId, userId, fileName: e.dateiname, parsed: { source: e.quelle, rows: e.roh, skipped: [] }, vatRate: s.vatRate });
  await db.update(E).set({ status: "uebernommen", uebernommenAm: new Date() }).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  const { runAfterImport } = await import("@/lib/hooks");
  await runAfterImport(tenantId);
  return stats;
}

export async function ekImportVerwerfen(tenantId: string, id: string) {
  await db.update(E).set({ status: "verworfen" }).where(and(eq(E.tenantId, tenantId), eq(E.id, id), eq(E.status, "vorschau")));
}

/**
 * sellerboard-Importdatei: je SKU des Imports der gültige EK im System (nach dem Übernehmen – auch geerbter EK bei
 * Retouren statt 0,01 €), sonst der EK aus der Datei; Platzhalter fehlen. Merkt sich den Download.
 */
export async function sellerboardImportDatei(tenantId: string, id: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const e = await ekImport(tenantId, id);
  if (!e) return null;
  const system = e.status === "uebernommen" ? await skuCostMap(tenantId) : new Map();
  const bytes = sellerboardXls(e.roh.map((r) => ({ asin: r.asin, sku: r.sku, cost: system.get(r.sku)?.cost ?? r.costNet })));
  if (e.sellerboard === "offen") await db.update(E).set({ sellerboard: "datei", sellerboardProtokoll: [...e.sellerboardProtokoll, { zeit: new Date().toISOString(), text: "sellerboard-Importdatei heruntergeladen" }] }).where(eq(E.id, id));
  return { name: `sellerboard_Kosten_${e.createdAt.toISOString().slice(0, 10)}.xls`, bytes };
}

export async function sellerboardProtokoll(tenantId: string, id: string, status: "automatik_ok" | "automatik_fehler", text: string) {
  const e = await ekImport(tenantId, id);
  if (!e) return;
  await db.update(E).set({ sellerboard: status, sellerboardProtokoll: [...e.sellerboardProtokoll, { zeit: new Date().toISOString(), text: text.slice(0, 500) }] }).where(eq(E.id, id));
}

/**
 * Gegenprüfung am Folgetag (Hintergrund): übernommene Importe ab 20 Stunden alt – EK im System gegen den EK aus dem
 * letzten sellerboard-Abgleich. Abweichungen → Aufgabe; alles gleich → Aufgabe erledigt.
 */
export async function ekGegenpruefung(tenantId: string, now = new Date()): Promise<number> {
  const offen = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.status, "uebernommen"), isNull(E.geprueftAm), lt(E.uebernommenAm, new Date(now.getTime() - 20 * 3600_000))));
  if (!offen.length) return 0;
  const [system, sb] = await Promise.all([skuCostMap(tenantId), sellerboardCostMap(tenantId)]);
  const sys = new Map([...system.entries()].map(([k, v]) => [k, v.cost]));
  let n = 0;
  for (const e of offen) {
    const skus = e.roh.map((r) => r.sku);
    const abweichend = ekAbgleich(skus, sys, sb);
    await db.update(E).set({ geprueftAm: now, pruefung: { geprueft: skus.length, abweichend: abweichend.slice(0, 500) } }).where(eq(E.id, e.id));
    const key = `ek-sellerboard-${e.id}`;
    if (abweichend.length) {
      n += abweichend.length;
      await upsertSystemTask(db, tenantId, key, {
        title: `sellerboard-EK weicht ab: ${abweichend.length} SKU${abweichend.length === 1 ? "" : "s"} (Import ${e.dateiname})`.slice(0, 200),
        notes: `${abweichend.slice(0, 8).map((a) => `${a.sku}: System ${a.system?.toFixed(2) ?? "–"} / sellerboard ${a.sellerboard?.toFixed(2) ?? "fehlt"}`).join("\n")}${abweichend.length > 8 ? `\n… und ${abweichend.length - 8} weitere` : ""}\nGrund prüfen: Importdatei bei sellerboard hochgeladen? sellerboard-Abgleich gelaufen?`,
        category: "einkauf",
        link: `/einkauf/ek-import?id=${e.id}`,
      });
    } else await resolveSystemTask(db, tenantId, key);
  }
  return n;
}
