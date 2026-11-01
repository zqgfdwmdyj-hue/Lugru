import "server-only";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { accountoneAus, bqoolVergleich, bqoolVergleichText, einkaufSchluessel, lagerbestandAus, type AoEinkauf, type BqVergleichZeile } from "./logic";

// ArbitrageOne: gespeicherte Einkäufe, Lagerbestand und AccountOne COG – und was das System daraus macht
// (Monatsrahmen, Liquidität, Lugru „gekauft“, Bestandsabgleich, Monatsdatei für den Steuerberater, BQool-Vergleich).

const AE = schema.aoEinkaeufe;
const AL = schema.aoLagerbestand;
const AC = schema.aoAccountoneCog;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Einkaufszeilen speichern; dieselbe Zeile (ASIN, SKU, Datum, Menge, EK, Lieferant, Rechnung) aus einer anderen Datei → übersprungen. */
export async function aoEinkaeufeSpeichern(tenantId: string, zeilen: AoEinkauf[], dateiImportId: string | null): Promise<{ neu: number; bekannt: number; zeitraum: { von: string | null; bis: string | null }; summe: number }> {
  let neu = 0;
  for (let i = 0; i < zeilen.length; i += 500) {
    const teil = zeilen.slice(i, i + 500);
    const r = await db
      .insert(AE)
      .values(teil.map((z) => ({ tenantId, schluessel: einkaufSchluessel(z), asin: z.asin, sku: z.sku, titel: z.titel, kaufdatum: z.kaufdatum, menge: z.menge, ekNetto: z.ekNetto === null ? null : String(z.ekNetto), waehrung: z.waehrung, lieferant: z.lieferant, rechnung: z.rechnung, dateiImportId })))
      .onConflictDoNothing()
      .returning({ id: AE.id });
    neu += r.length;
  }
  const tage = zeilen.map((z) => z.kaufdatum).sort();
  return { neu, bekannt: zeilen.length - neu, zeitraum: { von: tage[0] ?? null, bis: tage.at(-1) ?? null }, summe: r2(zeilen.reduce((n, z) => n + (z.ekNetto ?? 0) * z.menge, 0)) };
}

/** Wareneinkauf eines Monats laut ArbitrageOne-Einkäufen (EK netto × Menge). null = keine Einkäufe in dem Monat. */
export async function aoMonatseinkauf(tenantId: string, monat: string): Promise<{ summe: number; zeilen: number; ohneEk: number; stueck: number } | null> {
  const [y, m] = monat.split("-").map(Number);
  const bis = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const [r] = await db
    .select({ summe: sql<string>`coalesce(sum(${AE.menge} * ${AE.ekNetto}), 0)`, zeilen: sql<number>`count(*)::int`, ohneEk: sql<number>`count(*) filter (where ${AE.ekNetto} is null)::int`, stueck: sql<number>`coalesce(sum(${AE.menge}), 0)::int` })
    .from(AE)
    .where(and(eq(AE.tenantId, tenantId), gte(AE.kaufdatum, `${monat}-01`), lt(AE.kaufdatum, bis)));
  if (!r?.zeilen) return null;
  return { summe: r2(Number(r.summe)), zeilen: r.zeilen, ohneEk: r.ohneEk, stueck: r.stueck };
}

/** Ø Wareneinkauf je Woche aus den ArbitrageOne-Einkäufen der letzten 8 Wochen (brutto: EK netto + 19 %). */
export async function aoWareneinkaufJeWoche(tenantId: string, heute: string): Promise<{ proWoche: number; zeilen: number } | null> {
  const ab = new Date(`${heute}T12:00:00Z`);
  ab.setUTCDate(ab.getUTCDate() - 56);
  const [r] = await db
    .select({ summe: sql<string>`coalesce(sum(${AE.menge} * ${AE.ekNetto}), 0)`, zeilen: sql<number>`count(*)::int` })
    .from(AE)
    .where(and(eq(AE.tenantId, tenantId), gte(AE.kaufdatum, ab.toISOString().slice(0, 10)), sql`${AE.kaufdatum} <= ${heute}::date`));
  if (!r || r.zeilen < 2 || Number(r.summe) <= 0) return null;
  return { proWoche: (Number(r.summe) * 1.19) / 8, zeilen: r.zeilen };
}

/** Einkäufe je ASIN ab einem Tag – für den Lugru-Kauf-Abgleich. */
export async function aoEinkaeufeFuer(tenantId: string, asins: string[], seitTag: string) {
  const out: { asin: string; kaufdatum: string; menge: number; ekNetto: number | null; lieferant: string | null; rechnung: string | null; sku: string | null }[] = [];
  for (let i = 0; i < asins.length; i += 1000) {
    const rows = await db
      .select({ asin: AE.asin, kaufdatum: AE.kaufdatum, menge: AE.menge, ek: AE.ekNetto, lieferant: AE.lieferant, rechnung: AE.rechnung, sku: AE.sku })
      .from(AE)
      .where(and(eq(AE.tenantId, tenantId), inArray(AE.asin, asins.slice(i, i + 1000)), gte(AE.kaufdatum, seitTag)));
    out.push(...rows.map((r) => ({ ...r, ekNetto: r.ek === null ? null : Number(r.ek) })));
  }
  return out;
}

/** Lagerbestand eines Stichtags speichern (ersetzt einen früheren Stand desselben Tages). */
export async function aoLagerbestandSpeichern(tenantId: string, dateiname: string, table: unknown[][], heute: string, dateiImportId: string | null) {
  const l = lagerbestandAus(table, dateiname, heute);
  if (!l.zeilen.length) return null;
  await db.transaction(async (tx) => {
    await tx.delete(AL).where(and(eq(AL.tenantId, tenantId), eq(AL.stichtag, l.stichtag)));
    for (let i = 0; i < l.zeilen.length; i += 500)
      await tx.insert(AL).values(l.zeilen.slice(i, i + 500).map((z) => ({ tenantId, stichtag: l.stichtag, sku: z.sku, asin: z.asin, titel: z.titel, menge: z.menge, ekNetto: z.ekNetto === null ? null : String(z.ekNetto), wert: z.wert === null ? null : String(z.wert), lagerort: z.lagerort, dateiImportId })));
  });
  const abgleich = await aoLagerAbgleich(tenantId, l.stichtag);
  return { stichtag: l.stichtag, zeilen: l.zeilen.length, uebersprungen: l.uebersprungen, stueck: l.zeilen.reduce((n, z) => n + z.menge, 0), lagerwert: r2(l.zeilen.reduce((n, z) => n + (z.wert ?? 0), 0)), ohneWert: l.zeilen.filter((z) => z.wert === null).length, abgleich };
}

/** Letzter Lagerbestand: Stichtag, Stück, Lagerwert (für Liquidität und Anbindungen). */
export async function aoLagerwert(tenantId: string): Promise<{ stichtag: string; stueck: number; wert: number; skus: number } | null> {
  const [s] = await db.select({ stichtag: AL.stichtag }).from(AL).where(eq(AL.tenantId, tenantId)).orderBy(desc(AL.stichtag)).limit(1);
  if (!s) return null;
  const [r] = await db
    .select({ stueck: sql<number>`coalesce(sum(${AL.menge}), 0)::int`, wert: sql<string>`coalesce(sum(${AL.wert}), 0)`, skus: sql<number>`count(distinct coalesce(${AL.sku}, ${AL.asin}))::int` })
    .from(AL)
    .where(and(eq(AL.tenantId, tenantId), eq(AL.stichtag, s.stichtag)));
  return { stichtag: s.stichtag, stueck: r.stueck, wert: r2(Number(r.wert)), skus: r.skus };
}

/**
 * Bestandsabgleich: ArbitrageOne-Lagerbestand (Stichtag) je SKU gegen das eigene Lager im Seller-System. Nur
 * anzeigen – korrigiert wird nichts (Reparaturen nur als Vorschlag).
 */
export async function aoLagerAbgleich(tenantId: string, stichtag?: string) {
  const tag = stichtag ?? (await aoLagerwert(tenantId))?.stichtag;
  if (!tag) return null;
  const ao = await db.select({ sku: AL.sku, asin: AL.asin, titel: AL.titel, menge: sql<number>`sum(${AL.menge})::int` }).from(AL).where(and(eq(AL.tenantId, tenantId), eq(AL.stichtag, tag))).groupBy(AL.sku, AL.asin, AL.titel);
  const skus = ao.map((a) => a.sku).filter((s): s is string => !!s);
  const eigen = new Map<string, number>();
  for (let i = 0; i < skus.length; i += 1000) for (const r of await db.select({ sku: schema.ownStock.sku, menge: schema.ownStock.quantity }).from(schema.ownStock).where(and(eq(schema.ownStock.tenantId, tenantId), inArray(schema.ownStock.sku, skus.slice(i, i + 1000))))) eigen.set(r.sku, (eigen.get(r.sku) ?? 0) + Number(r.menge));
  const abw = ao
    .filter((a) => a.sku)
    .map((a) => ({ sku: a.sku!, asin: a.asin, titel: a.titel, arbitrageone: a.menge, eigenesLager: eigen.get(a.sku!) ?? 0, differenz: a.menge - (eigen.get(a.sku!) ?? 0) }))
    .filter((x) => x.differenz !== 0)
    .sort((x, y) => Math.abs(y.differenz) - Math.abs(x.differenz));
  return { stichtag: tag, geprueft: ao.length, abweichend: abw.length, ohneSku: ao.filter((a) => !a.sku).length, beispiele: abw.slice(0, 20) };
}

/** AccountOne COG je Monat speichern (eine Datei je Monat – eine neuere ersetzt die ältere). */
export async function aoAccountoneSpeichern(tenantId: string, monat: string, table: unknown[][], dateiname: string, dateiImportId: string | null) {
  const a = accountoneAus(table);
  if (!a.zeilen.length) return null;
  await db
    .insert(AC)
    .values({ tenantId, monat, zeilen: a.zeilen, spalten: a.spalten, dateiname: dateiname.slice(0, 200), dateiImportId })
    .onConflictDoUpdate({ target: [AC.tenantId, AC.monat], set: { zeilen: a.zeilen, spalten: a.spalten, dateiname: dateiname.slice(0, 200), dateiImportId, aktualisiertAm: new Date() } });
  return { monat, zeilen: a.zeilen.length, ohneEk: a.zeilen.filter((z) => z.ekNetto === null).length, summeEk: r2(a.zeilen.reduce((n, z) => n + (z.ekNetto ?? 0), 0)) };
}

/** Monatsdatei für den Steuerberater („CSV + Belege“): AccountOne COG des Monats (ASIN; SKU; EK netto). */
export async function accountoneMonatsdatei(tenantId: string, monat: string): Promise<string | null> {
  const [c] = await db.select().from(AC).where(and(eq(AC.tenantId, tenantId), eq(AC.monat, monat)));
  if (!c?.zeilen.length) return null;
  const z = (n: number | null) => (n === null ? "" : n.toFixed(2).replace(".", ","));
  return `﻿${[`AccountOne COG ${monat} (aus ArbitrageOne, Datei ${c.dateiname ?? "–"}; nur Zahlen)`, "", "ASIN;SKU;EK netto", ...c.zeilen.map((r) => [r.asin, r.sku, z(r.ekNetto)].join(";"))].join("\r\n")}\r\n`;
}

export async function accountoneStand(tenantId: string, monat: string) {
  const [c] = await db.select({ monat: AC.monat, aktualisiertAm: AC.aktualisiertAm, zeilen: sql<number>`jsonb_array_length(${AC.zeilen})::int` }).from(AC).where(and(eq(AC.tenantId, tenantId), eq(AC.monat, monat)));
  return c ?? null;
}

/** BQool-Datei aus ArbitrageOne gegen das Soll des Seller-Systems (je Land). Ändert nichts. */
export async function aoBqoolVergleichen(tenantId: string, text: string, dateiname: string) {
  const { liesBqoolDatei } = await import("@/lib/bqool/export-logic");
  const { bqoolVorschau } = await import("@/lib/bqool/export-service");
  const datei = liesBqoolDatei(text, dateiname);
  // Eine ArbitrageOne-Datei kann mehrere Kanäle enthalten (Amazon DE/FR …): je Land getrennt vergleichen.
  const jeLand = new Map<string, BqVergleichZeile[]>();
  for (const z of datei.zeilen) {
    const land = (/\b(DE|FR|IT|ES)\b/i.exec(z.channel)?.[1] ?? datei.land ?? "DE").toUpperCase();
    jeLand.set(land, [...(jeLand.get(land) ?? []), { sku: z.sku, regel: z.regel || null, min: z.min, max: z.max }]);
  }
  const vorschau = await bqoolVorschau(tenantId, { laender: [...jeLand.keys()] as ("DE" | "FR" | "IT" | "ES")[] });
  const laender = [...jeLand].map(([land, ao]) => {
    const soll = (vorschau.laender.find((l) => l.land === land)?.zeilen ?? []).map((z) => ({ sku: z.sku, regel: z.regel, min: z.min, max: z.max }));
    const v = bqoolVergleich(ao, soll);
    return { land, ...v, text: bqoolVergleichText(v) };
  });
  const abweichend = laender.reduce((n, l) => n + l.abweichend, 0);
  return { laender, abweichend, text: laender.length === 1 ? laender[0].text : `${laender.map((l) => `${l.land}: ${l.abweichend}`).join(" · ")} SKUs weichen ab (ArbitrageOne ↔ Seller-System).`, hinweis: "Nur Vergleich – die ArbitrageOne-Datei wird weder übernommen noch zu BQool hochgeladen; maßgeblich sind die Soll-Regeln im Seller-System." };
}

/** Letzter BQool-Vergleich (für die Seite „BQool-Dateien“). */
export async function letzterBqoolVergleich(tenantId: string) {
  const D = schema.dateiImporte;
  const [r] = await db
    .select({ id: D.id, am: D.fertigAm, ergebnis: D.ergebnis })
    .from(D)
    .where(and(eq(D.tenantId, tenantId), eq(D.art, "ao_bqool_vergleich"), eq(D.status, "fertig")))
    .orderBy(desc(D.fertigAm))
    .limit(1);
  return r?.ergebnis ? { id: r.id, am: r.am, ...(r.ergebnis as { abweichend?: number; text?: string; laender?: { land: string; abweichend: number; beispiele: { sku: string; art: string; arbitrageone: string; system: string }[] }[] }) } : null;
}
