import "server-only";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso, todayIso } from "@/lib/dates";
import { istLiquidation } from "@/lib/money/verlust";
import { getSettings } from "@/lib/settings";
import { readTable } from "@/lib/tabular";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import {
  BERICHT_LAENDER,
  BERICHT_TEXT,
  berichtArt,
  buyboxAnteil,
  buyboxWochen,
  buyboxZeile,
  landVorschlag,
  leistungAuswerten,
  leseDailySales,
  leseListingPerformance,
  tagesLand,
  zeitraumAus,
  type BerichtArt,
  type BerichtLand,
  type Kontext,
  type LeistungFall,
  type LeistungZeile,
  type Tageswert,
} from "./berichte-logic";

// B31.5 BQool-Berichte „Listing Performance“ und „Daily Sales“: einlesen (Land erkennen oder nachfragen), speichern,
// auswerten (Reiter „Leistung“, Morgenbericht, Verlust-Stopp, Gewinn-Vergleich), Aufgabe „BQool-Regel prüfen“.

const B = schema.bqoolBerichte;
const LP = schema.bqoolLeistung;
const TW = schema.bqoolTageswerte;
const OF = schema.bqoolBerichteOffen;

export type Via = "upload" | "automatik" | "claude";
export type BerichtErgebnis = {
  ok: boolean;
  art: BerichtArt | null;
  land: BerichtLand | null;
  text: string;
  hinweise: string[];
  /** Land nicht eindeutig: Knopf „Welches Land?“ mit Vorschlag. */
  rueckfrage?: { id: string; vorschlag: BerichtLand | null; begruendung: string };
  details?: Record<string, unknown>;
};

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const eur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ist je Land (letzter „Manage Listings“/Repricing-Datei): SKU → Regel – für die Land-Erkennung. */
async function istJeLand(tenantId: string) {
  const L = schema.bqoolListings;
  const rows = await db.select({ land: L.marktplatz, sku: L.sku, regel: L.regel }).from(L).where(and(eq(L.tenantId, tenantId), inArray(L.marktplatz, [...BERICHT_LAENDER])));
  const je: Partial<Record<BerichtLand, Map<string, string | null>>> = {};
  for (const r of rows) (je[r.land as BerichtLand] ??= new Map()).set(r.sku, r.regel);
  return je;
}

async function bekannteSkus(tenantId: string): Promise<Set<string>> {
  const [a, b] = await Promise.all([
    db.selectDistinct({ sku: schema.bqoolListings.sku }).from(schema.bqoolListings).where(eq(schema.bqoolListings.tenantId, tenantId)),
    db.selectDistinct({ sku: schema.amazonInventory.sku }).from(schema.amazonInventory).where(eq(schema.amazonInventory.tenantId, tenantId)),
  ]);
  return new Set([...a, ...b].map((x) => x.sku).filter((x): x is string => !!x));
}

/** Letzte Listing-Performance-Summen je Land (für das Land einer Daily-Sales-Datei). */
async function lpSummen(tenantId: string) {
  const rows = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.art, "listing_performance"))).orderBy(desc(B.stichtag), desc(B.eingelesenAm)).limit(40);
  const je = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!je.has(r.land) && r.sales !== null) je.set(r.land, r);
  return [...je.values()].map((r) => ({ land: r.land as BerichtLand, stichtag: r.stichtag, tage: r.zeitraumTage, sales: r.sales ?? 0 }));
}

/** Datei lesen, Land bestimmen (bzw. nachfragen) und speichern. */
export async function bqoolBerichtEinlesen(tenantId: string, name: string, bytes: Uint8Array, o: { land?: BerichtLand | null; tage?: 7 | 30; stichtag?: string; via?: Via } = {}): Promise<BerichtErgebnis> {
  const t = readTable(bytes);
  const art = berichtArt(t.headers);
  if (!art) return { ok: false, art: null, land: null, text: "Kein BQool-Bericht „Listing Performance“ bzw. „Daily Sales“ (Kopfzeile passt nicht).", hinweise: [] };
  const stichtag = o.stichtag ?? todayIso();
  const via = o.via ?? "upload";
  const s = await getSettings(tenantId);
  if (art === "listing_performance") {
    const tage = o.tage ?? zeitraumAus(name);
    const r = leseListingPerformance(t.headers, t.rows, await bekannteSkus(tenantId));
    if (!r.zeilen.length) return { ok: false, art, land: null, text: `Listing Performance: keine Zeile mit erkennbarer SKU${r.ohneSku ? ` (${r.ohneSku} Zeilen ohne SKU in „Products“)` : ""}. Spalten: ${t.headers.slice(0, 12).join(", ")}.`, hinweise: [] };
    const hinweise = [r.doppelt ? `${r.doppelt} doppelte SKU-Zeilen (zwei Regeln) zusammengefasst` : "", r.ohneSku ? `${r.ohneSku} Zeilen ohne SKU übersprungen` : "", r.fehlt.length ? `nicht in der Datei: ${r.fehlt.join(", ")}` : ""].filter(Boolean);
    let land = o.land ?? null;
    let landQuelle = o.land ? (via === "automatik" ? "Automatik" : "von Hand") : "";
    if (!land) {
      const v = landVorschlag(r.zeilen, await istJeLand(tenantId), s.bqool.abverkaufRegel);
      if (!v.land) return offenAblegen(tenantId, { art, datei: name, tage, stichtag, daten: { zeilen: r.zeilen, summe: r.summe }, vorschlag: v.vorschlag, begruendung: v.begruendung, hinweise });
      land = v.land;
      landQuelle = v.begruendung;
    }
    return leistungSpeichern(tenantId, { land, tage, stichtag, zeilen: r.zeilen, summe: r.summe, datei: name, via, landQuelle, hinweise });
  }
  const r = leseDailySales(t.headers, t.rows);
  if (!r.tage.length) return { ok: false, art, land: null, text: `Daily Sales: keine Zeile mit lesbarem Datum. Spalten: ${t.headers.slice(0, 10).join(", ")}.`, hinweise: [] };
  const hinweise = r.ungueltig ? [`${r.ungueltig} Zeilen ohne Datum (z. B. Summe) übersprungen`] : [];
  let land = o.land ?? null;
  let landQuelle = o.land ? (via === "automatik" ? "Automatik" : "von Hand") : "";
  if (!land) {
    const v = tagesLand(r.tage, await lpSummen(tenantId));
    if (!v.land) return offenAblegen(tenantId, { art, datei: name, tage: 0, stichtag: r.tage[r.tage.length - 1].tag, daten: { tage: r.tage }, vorschlag: v.vorschlag, begruendung: v.begruendung, hinweise });
    land = v.land;
    landQuelle = v.begruendung;
  }
  return tageSpeichern(tenantId, { land, tage: r.tage, datei: name, via, landQuelle, hinweise });
}

async function offenAblegen(tenantId: string, o: { art: BerichtArt; datei: string; tage: number; stichtag: string; daten: { zeilen?: unknown[]; tage?: unknown[]; summe?: unknown }; vorschlag: BerichtLand | null; begruendung: string; hinweise: string[] }): Promise<BerichtErgebnis> {
  await db.delete(OF).where(and(eq(OF.tenantId, tenantId), lt(OF.createdAt, new Date(Date.now() - 7 * 86_400_000))));
  const [row] = await db.insert(OF).values({ tenantId, art: o.art, datei: o.datei.slice(0, 200), zeitraumTage: o.tage, stichtag: o.stichtag, daten: o.daten, vorschlag: o.vorschlag, begruendung: o.begruendung }).returning({ id: OF.id });
  const n = (o.daten.zeilen ?? o.daten.tage ?? []).length;
  return {
    ok: false,
    art: o.art,
    land: null,
    text: `${BERICHT_TEXT[o.art]} gelesen (${n} ${o.art === "daily_sales" ? "Tage" : "SKUs"}), Land ${o.begruendung}. Welches Land?${o.vorschlag ? ` Vorschlag: ${o.vorschlag}.` : ""}`,
    hinweise: o.hinweise,
    rueckfrage: { id: row.id, vorschlag: o.vorschlag, begruendung: o.begruendung },
  };
}

/** Antwort auf „Welches Land?“: wartenden Bericht mit diesem Land speichern. */
export async function bqoolBerichtLandSetzen(tenantId: string, id: string, land: BerichtLand, via: Via = "upload"): Promise<BerichtErgebnis> {
  const [o] = await db.select().from(OF).where(and(eq(OF.tenantId, tenantId), eq(OF.id, id)));
  if (!o) return { ok: false, art: null, land, text: "Dieser Bericht wartet nicht mehr (schon übernommen oder älter als 7 Tage) – bitte noch einmal hochladen.", hinweise: [] };
  const r =
    o.art === "listing_performance"
      ? await leistungSpeichern(tenantId, { land, tage: o.zeitraumTage === 30 ? 30 : 7, stichtag: o.stichtag, zeilen: (o.daten.zeilen ?? []) as LeistungZeile[], summe: (o.daten.summe ?? null) as LeistungZeile | null, datei: o.datei, via, landQuelle: "von Hand", hinweise: [] })
      : await tageSpeichern(tenantId, { land, tage: (o.daten.tage ?? []) as Tageswert[], datei: o.datei, via, landQuelle: "von Hand", hinweise: [] });
  await db.delete(OF).where(and(eq(OF.tenantId, tenantId), eq(OF.id, id)));
  return r;
}

export async function offeneBerichte(tenantId: string) {
  return db.select({ id: OF.id, art: OF.art, datei: OF.datei, vorschlag: OF.vorschlag, begruendung: OF.begruendung, createdAt: OF.createdAt }).from(OF).where(and(eq(OF.tenantId, tenantId), gte(OF.createdAt, new Date(Date.now() - 7 * 86_400_000)))).orderBy(desc(OF.createdAt)).limit(20);
}

async function leistungSpeichern(tenantId: string, o: { land: BerichtLand; tage: 7 | 30; stichtag: string; zeilen: LeistungZeile[]; summe: LeistungZeile | null; datei: string; via: Via; landQuelle: string; hinweise: string[] }): Promise<BerichtErgebnis> {
  const jetzt = new Date();
  const anteil = buyboxAnteil(o.zeilen, o.summe);
  const sales = r2(o.zeilen.reduce((s, z) => s + (z.sales ?? 0), 0));
  const profit = r2(o.zeilen.reduce((s, z) => s + (z.profit ?? 0), 0));
  await db.transaction(async (tx) => {
    await tx.delete(LP).where(and(eq(LP.tenantId, tenantId), eq(LP.land, o.land), eq(LP.zeitraumTage, o.tage), eq(LP.stichtag, o.stichtag)));
    const werte = o.zeilen.map((z) => ({ ...z, tenantId, land: o.land, zeitraumTage: o.tage, stichtag: o.stichtag, sku: z.sku.slice(0, 200), titel: z.titel?.slice(0, 300) ?? null, eingelesenAm: jetzt }));
    for (let i = 0; i < werte.length; i += 500) await tx.insert(LP).values(werte.slice(i, i + 500));
    await tx
      .insert(B)
      .values({ tenantId, art: "listing_performance", land: o.land, zeitraumTage: o.tage, stichtag: o.stichtag, von: addDaysIso(o.stichtag, -(o.tage - 1)), bis: o.stichtag, zeilen: o.zeilen.length, buyboxAnteil: anteil, sales, profit, datei: o.datei.slice(0, 200), via: o.via, landQuelle: o.landQuelle.slice(0, 300), eingelesenAm: jetzt })
      .onConflictDoUpdate({ target: [B.tenantId, B.art, B.land, B.zeitraumTage, B.stichtag], set: { zeilen: o.zeilen.length, buyboxAnteil: anteil, sales, profit, datei: o.datei.slice(0, 200), via: o.via, landQuelle: o.landQuelle.slice(0, 300), eingelesenAm: jetzt } });
  });
  await db.insert(schema.reportImports).values({ tenantId, reportType: "BQool Listing Performance", fileName: o.datei.slice(0, 200), via: o.via === "automatik" ? "api" : "upload", rows: o.zeilen.length, inserted: o.zeilen.length, message: `${o.land} ${o.tage} Tage` });
  const a = await auswertungLand(tenantId, o.land, o.zeilen);
  await regelPruefenAufgabe(tenantId, o.land, a.preisbewegung);
  const teile = [`${o.zeilen.length} SKUs`, anteil !== null ? `Buy Box ${Math.round(anteil)} %` : "", `${a.unterMin.length} unter Min ohne Buy Box`, `${a.verlust.length} mit Verlust`, a.preisbewegung.length ? `${a.preisbewegung.length} auffällige Preisbewegung` : ""].filter(Boolean);
  return {
    ok: true,
    art: "listing_performance",
    land: o.land,
    text: `BQool Listing Performance ${o.land} (${o.tage} Tage bis ${dmy(o.stichtag)}): ${teile.join(" · ")}.`,
    hinweise: [`Land: ${o.landQuelle}`, ...o.hinweise],
    details: { leistung: { land: o.land, tage: o.tage, stichtag: o.stichtag, skus: o.zeilen.length, buybox_anteil: anteil, unter_min: a.unterMin.length, verlust: a.verlust.length, preisbewegung: a.preisbewegung.length } },
  };
}

async function tageSpeichern(tenantId: string, o: { land: BerichtLand; tage: Tageswert[]; datei: string; via: Via; landQuelle: string; hinweise: string[] }): Promise<BerichtErgebnis> {
  const jetzt = new Date();
  const von = o.tage[0].tag;
  const bis = o.tage[o.tage.length - 1].tag;
  const sales = r2(o.tage.reduce((s, t) => s + (t.sales ?? 0), 0));
  const profit = r2(o.tage.reduce((s, t) => s + (t.profit ?? 0), 0));
  const bb = o.tage.map((t) => t.bbWins).filter((x): x is number => x !== null);
  const anteil = bb.length ? Math.round((bb.reduce((s, x) => s + x, 0) / bb.length) * 10) / 10 : null;
  await db.transaction(async (tx) => {
    for (const t of o.tage) {
      const w = { sales: t.sales, salesFba: t.salesFba, salesFbm: t.salesFbm, orders: t.orders, units: t.units, profit: t.profit, bbWins: t.bbWins, zusatz: t.zusatz, datei: o.datei.slice(0, 200), eingelesenAm: jetzt };
      await tx.insert(TW).values({ tenantId, land: o.land, tag: t.tag, ...w }).onConflictDoUpdate({ target: [TW.tenantId, TW.land, TW.tag], set: w });
    }
    await tx
      .insert(B)
      .values({ tenantId, art: "daily_sales", land: o.land, zeitraumTage: 0, stichtag: bis, von, bis, zeilen: o.tage.length, buyboxAnteil: anteil, sales, profit, datei: o.datei.slice(0, 200), via: o.via, landQuelle: o.landQuelle.slice(0, 300), eingelesenAm: jetzt })
      .onConflictDoUpdate({ target: [B.tenantId, B.art, B.land, B.zeitraumTage, B.stichtag], set: { von, bis, zeilen: o.tage.length, buyboxAnteil: anteil, sales, profit, datei: o.datei.slice(0, 200), via: o.via, landQuelle: o.landQuelle.slice(0, 300), eingelesenAm: jetzt } });
  });
  await db.insert(schema.reportImports).values({ tenantId, reportType: "BQool Daily Sales", fileName: o.datei.slice(0, 200), via: o.via === "automatik" ? "api" : "upload", rows: o.tage.length, inserted: o.tage.length, message: o.land });
  return {
    ok: true,
    art: "daily_sales",
    land: o.land,
    text: `BQool Daily Sales ${o.land}: ${o.tage.length} Tage (${dmy(von)} – ${dmy(bis)}) · Umsatz ${eur(sales)} · Est. Profit ${eur(profit)}${anteil !== null ? ` · Buy Box Ø ${Math.round(anteil)} %` : ""}.`,
    hinweise: [`Land: ${o.landQuelle}`, ...o.hinweise],
    details: { tageswerte: { land: o.land, von, bis, tage: o.tage.length, umsatz: sales, gewinn: profit, buybox_anteil: anteil } },
  };
}

/** Min/effektiver Min/Liquidation je Land und SKU aus dem BQool-Stand (Ist + Regel-Katalog). */
async function kontextFuer(tenantId: string): Promise<Map<string, Kontext>> {
  const { bqoolStand } = await import("./service");
  const [st, zuw] = await Promise.all([bqoolStand(tenantId), db.select({ land: schema.bqoolZuweisungen.land, sku: schema.bqoolZuweisungen.sku, regel: schema.bqoolZuweisungen.regel }).from(schema.bqoolZuweisungen).where(and(eq(schema.bqoolZuweisungen.tenantId, tenantId), eq(schema.bqoolZuweisungen.freigegeben, true)))]);
  const soll = new Map(zuw.map((z) => [`${z.land}|${z.sku}`, z.regel]));
  return new Map(st.zeilen.map((z) => [`${z.marktplatz}|${z.sku}`, { bqMin: z.min, effMin: z.effMin, liquidation: istLiquidation(z.regel) || istLiquidation(soll.get(`${z.marktplatz}|${z.sku}`) ?? null), regelSoll: soll.get(`${z.marktplatz}|${z.sku}`) ?? null }]));
}

async function auswertungLand(tenantId: string, land: string, zeilen: LeistungZeile[]) {
  return leistungAuswerten(zeilen.map((z) => ({ ...z, land })), await kontextFuer(tenantId));
}

/** Aufgabe „BQool-Regel prüfen“ je Land – mit den SKUs der Liste „Auffällige Preisbewegung“; keine mehr → erledigt. */
async function regelPruefenAufgabe(tenantId: string, land: string, faelle: LeistungFall[]) {
  const key = `bqool-regel-pruefen-${land}`;
  if (!faelle.length) return resolveSystemTask(db, tenantId, key);
  await upsertSystemTask(db, tenantId, key, {
    title: `BQool-Regel prüfen: ${faelle.length} SKU${faelle.length === 1 ? "" : "s"} mit auffälliger Preisbewegung (${land})`.slice(0, 200),
    notes: [`Laut BQool-Bericht „Listing Performance“ ${land}:`, ...faelle.slice(0, 20).map((f) => `• ${f.sku}${f.titel ? ` (${f.titel.slice(0, 60)})` : ""}: ${f.vorschlag}`), faelle.length > 20 ? `… und ${faelle.length - 20} weitere` : ""].filter(Boolean).join("\n"),
    priority: "normal",
    category: "amazon",
    link: `/repricer/leistung?land=${land}#preisbewegung`,
    dueDate: todayIso(),
  });
}

type LpRow = typeof LP.$inferSelect;
const alsZeile = (r: LpRow): LeistungZeile & { land: string } => ({ land: r.land, sku: r.sku, asin: r.asin, titel: r.titel, regel: r.regel, sales: r.sales, orders: r.orders, units: r.units, profit: r.profit, bbWins: r.bbWins, lowestWin: r.lowestWin, atMin: r.atMin, atMax: r.atMax, belowMin: r.belowMin, avgOffers: r.avgOffers, avgPosition: r.avgPosition, reprice: r.reprice, priceUp: r.priceUp, priceDown: r.priceDown, priceChanges: r.priceChanges, bbLostAmazon: r.bbLostAmazon, bbLostFba: r.bbLostFba, bbLostFbm: r.bbLostFbm, zusatz: r.zusatz });

/** Letzter Listing-Performance-Bericht je Land (bevorzugt der gewünschte Zeitraum, sonst der jüngste). */
async function letzteJeLand(tenantId: string, tage?: 7 | 30) {
  const rows = await db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.art, "listing_performance"))).orderBy(desc(B.stichtag), desc(B.eingelesenAm)).limit(200);
  const je = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const alt = je.get(r.land);
    const passt = (x: (typeof rows)[number]) => (tage ? x.zeitraumTage === tage : x.zeitraumTage === 7);
    if (!alt || (!passt(alt) && passt(r))) je.set(r.land, r);
  }
  return { letzte: BERICHT_LAENDER.map((l) => je.get(l)).filter((x): x is (typeof rows)[number] => !!x), alle: rows };
}

/** Reiter „Leistung“ und Werkzeug repricer: Stand je Land, drei Listen, Buy-Box-Anteil je Woche, Daily Sales. */
export async function leistungStand(tenantId: string, o: { tage?: 7 | 30; land?: string | null } = {}) {
  const { letzte, alle } = await letzteJeLand(tenantId, o.tage);
  const gewaehlt = letzte.filter((b) => !o.land || b.land === o.land);
  const rows = gewaehlt.length
    ? await db
        .select()
        .from(LP)
        .where(and(eq(LP.tenantId, tenantId), sql`(${LP.land}, ${LP.zeitraumTage}, ${LP.stichtag}) in (${sql.join(gewaehlt.map((b) => sql`(${b.land}, ${b.zeitraumTage}, ${b.stichtag})`), sql`, `)})`))
    : [];
  const listen = rows.length ? leistungAuswerten(rows.map(alsZeile), await kontextFuer(tenantId)) : { unterMin: [], verlust: [], preisbewegung: [] };
  const [tagesBerichte, offen] = await Promise.all([db.select().from(B).where(and(eq(B.tenantId, tenantId), eq(B.art, "daily_sales"))).orderBy(desc(B.stichtag)).limit(8), offeneBerichte(tenantId)]);
  const wochen = buyboxWochen(alle.filter((b) => b.zeitraumTage === (o.tage ?? 7)).map((b) => ({ land: b.land, stichtag: b.stichtag, anteil: b.buyboxAnteil })));
  return {
    laender: letzte.map((b) => ({ land: b.land, tage: b.zeitraumTage, stichtag: b.stichtag, skus: b.zeilen, buyboxAnteil: b.buyboxAnteil, sales: b.sales, profit: b.profit, unterMin: listen.unterMin.filter((f) => f.land === b.land).length, verlust: listen.verlust.filter((f) => f.land === b.land).length, eingelesenAm: b.eingelesenAm, datei: b.datei, via: b.via, landQuelle: b.landQuelle })),
    ...listen,
    wochen,
    tagesBerichte: tagesBerichte.map((b) => ({ land: b.land, von: b.von, bis: b.bis, tage: b.zeilen, sales: b.sales, profit: b.profit, buyboxAnteil: b.buyboxAnteil, eingelesenAm: b.eingelesenAm })),
    offen,
  };
}

/** Werkzeug repricer: Buy-Box-Anteil je Land (letzter Bericht) und je Woche – ohne die Listen. */
export async function buyboxUebersicht(tenantId: string) {
  const { letzte, alle } = await letzteJeLand(tenantId, 7);
  return {
    jeLand: letzte.map((b) => ({ land: b.land, anteil: b.buyboxAnteil, tage: b.zeitraumTage, stichtag: b.stichtag })),
    wochen: buyboxWochen(alle.filter((b) => b.zeitraumTage === 7).map((b) => ({ land: b.land, stichtag: b.stichtag, anteil: b.buyboxAnteil }))),
  };
}

/** Morgenbericht: „Buy Box DE 29 %, FR 43 %, …“ aus den letzten Listing-Performance-Berichten (höchstens 8 Tage alt). */
export async function buyboxMorgenZeile(tenantId: string, heute = todayIso()): Promise<string | null> {
  const { letzte } = await letzteJeLand(tenantId, 7);
  return buyboxZeile(letzte.filter((b) => b.stichtag >= addDaysIso(heute, -8)).map((b) => ({ land: b.land, anteil: b.buyboxAnteil })));
}

/** Daily Sales je Tag (Gewinn-Seite, Werkzeug umsatz). */
export async function bqoolTageswerte(tenantId: string, von: string, bis: string) {
  return db.select().from(TW).where(and(eq(TW.tenantId, tenantId), gte(TW.tag, von), lte(TW.tag, bis))).orderBy(TW.tag, TW.land);
}

/** Verlust-Stopp, zweite Quelle: SKUs mit Est. Profit < 0 im letzten Listing-Performance-Bericht je Land. */
export async function bqoolVerlustQuelle(tenantId: string) {
  const { letzte } = await letzteJeLand(tenantId, 7);
  if (!letzte.length) return { stand: null as { land: string; tage: number; stichtag: string }[] | null, zeilen: [] as { land: string; sku: string; titel: string | null; regel: string | null; profit: number; units: number | null; sales: number | null; tage: number; stichtag: string }[] };
  const rows = await db
    .select()
    .from(LP)
    .where(and(eq(LP.tenantId, tenantId), sql`${LP.profit} < 0`, sql`(${LP.land}, ${LP.zeitraumTage}, ${LP.stichtag}) in (${sql.join(letzte.map((b) => sql`(${b.land}, ${b.zeitraumTage}, ${b.stichtag})`), sql`, `)})`));
  return {
    stand: letzte.map((b) => ({ land: b.land, tage: b.zeitraumTage, stichtag: b.stichtag })),
    zeilen: rows.map((r) => ({ land: r.land, sku: r.sku, titel: r.titel, regel: r.regel, profit: r.profit ?? 0, units: r.units, sales: r.sales, tage: r.zeitraumTage, stichtag: r.stichtag })).sort((a, b) => a.profit - b.profit),
  };
}
