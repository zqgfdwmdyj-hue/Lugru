import "server-only";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { abrechnungsMonat, istMonatsLagergebuehrText, remissionPruefen, sellerboardLagerFixkosten } from "./lagergebuehren-logic";

// FBA-Lagergebühren aus dem Bericht „Monthly Storage Fees“: Übersicht je Monat/Land/ASIN, Abgleich mit der
// Amazon-Abrechnung und den sellerboard-Fixkosten, Werte je ASIN für Kapital-Ampel und B2B-Scanner.
// Die Gebühren stecken bereits in der Amazon-Abrechnung – sie werden nie zusätzlich vom Gewinn abgezogen.

const L = schema.amazonLagergebuehren;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type LagerSortierung = "gebuehr" | "volumen";

/** Reichweite in Tagen je ASIN (FBA-Bestand inkl. unterwegs ÷ Verkäufe/Tag laut sellerboard); null = unbekannt, 9999 = keine Verkäufe. */
async function reichweiteJeAsin(tenantId: string, asins: string[]): Promise<Map<string, number | null>> {
  if (!asins.length) return new Map();
  const I = schema.sellerboardInventory;
  const rows = await db
    .select({ asin: I.asin, stueck: sql<number>`sum(${I.fbaStock} + ${I.reserved} + ${I.inbound})::float`, vel: sql<number>`sum(coalesce(${I.salesVelocity}, 0))::float` })
    .from(I)
    .where(and(eq(I.tenantId, tenantId), inArray(I.asin, asins)))
    .groupBy(I.asin);
  return new Map(rows.map((r) => [r.asin!, r.vel > 0 ? Math.round(r.stueck / r.vel) : r.stueck > 0 ? 9999 : null]));
}

/** Abgleich eines Monats: Bericht ↔ Amazon-Abrechnung (gebucht im Folgemonat) ↔ sellerboard-Fixkosten „Lager…“. */
export async function lagerAbgleich(tenantId: string, monat: string, berichtSumme: number) {
  const S = schema.amazonSettlementLines;
  const am = abrechnungsMonat(monat);
  const zeilen = await db
    .select({ text: sql<string>`coalesce(${S.amountDescription}, '') || ' ' || coalesce(${S.transactionType}, '')`, betrag: S.amount })
    .from(S)
    .where(and(eq(S.tenantId, tenantId), gte(S.postedDate, `${am}-01`), lt(S.postedDate, `${abrechnungsMonat(am)}-01`), sql`(${S.amountDescription} ~* '(storage|lagergeb)' or ${S.transactionType} ~* '(storage|lagergeb)')`));
  const inAbrechnung = zeilen.filter((z) => istMonatsLagergebuehrText(z.text));
  const abrechnung = inAbrechnung.length ? r2(-inAbrechnung.reduce((n, z) => n + Number(z.betrag), 0)) : null;
  const C = schema.cashItems;
  const fix = await db.select({ beschreibung: C.description, betrag: C.amount, rhythmus: C.recurrence }).from(C).where(and(eq(C.tenantId, tenantId), eq(C.category, "Fixkosten (sellerboard)")));
  const sb = sellerboardLagerFixkosten(fix.map((f) => ({ beschreibung: f.beschreibung, betrag: Number(f.betrag), rhythmus: f.rhythmus })));
  return {
    bericht: r2(berichtSumme),
    amazon_abrechnung: abrechnung === null ? { hinweis: `In den Abrechnungen von ${am} keine Lagergebühr gefunden (Abrechnung bzw. Transaktionsbericht für ${am} fehlt?).` } : { monat: am, summe: abrechnung, differenz: r2(abrechnung - berichtSumme) },
    sellerboard_fixkosten: sb ? { summe_monat: sb.summeMonat, posten: sb.posten, differenz: r2(sb.summeMonat - berichtSumme) } : { hinweis: "In sellerboard ist keine Fixkosten-Position „Lagergebühr“ angelegt – sellerboard verrechnet die Lagergebühr aus der Amazon-Abrechnung." },
    hinweis: "Die Lagergebühr steckt in der Amazon-Abrechnung (Auszahlung) – im Gewinn und in der Liquidität ist sie damit schon enthalten und wird nicht zusätzlich abgezogen.",
  };
}

/** Übersicht für Werkzeug und Gewinn-Seite: Monat (Standard: letzter), Filter Land/ASIN, Sortierung nach Gebühr oder Volumen. */
export async function lagergebuehrenUebersicht(tenantId: string, o: { monat?: string | null; land?: string | null; asin?: string | null; sortierung?: LagerSortierung; limit?: number } = {}) {
  const monate = await db
    .select({ monat: L.monat, summe: sql<number>`sum(${L.gebuehr})::float`, asins: sql<number>`count(distinct ${L.asin})::int` })
    .from(L)
    .where(eq(L.tenantId, tenantId))
    .groupBy(L.monat)
    .orderBy(desc(L.monat));
  if (!monate.length) return null;
  const monat = o.monat ?? monate[0].monat;
  const land = o.land?.toUpperCase() || null;
  const wo = and(eq(L.tenantId, tenantId), eq(L.monat, monat), land ? eq(L.land, land) : undefined, o.asin ? eq(L.asin, o.asin.toUpperCase()) : undefined);
  const sortSql = o.sortierung === "volumen" ? sql`sum(coalesce(${L.volumenM3}, 0))` : sql`sum(${L.gebuehr})`;
  const [laender, kopf, asins] = await Promise.all([
    db.select({ land: L.land, summe: sql<number>`sum(${L.gebuehr})::float`, asins: sql<number>`count(distinct ${L.asin})::int` }).from(L).where(wo).groupBy(L.land).orderBy(desc(sql`sum(${L.gebuehr})`)),
    db.select({ summe: sql<number>`coalesce(sum(${L.gebuehr}), 0)::float`, asins: sql<number>`count(distinct ${L.asin})::int`, uebergross: sql<number>`count(distinct ${L.asin}) filter (where ${L.uebergross})::int`, gefahrgut: sql<number>`count(distinct ${L.asin}) filter (where coalesce(${L.gefahrgut}, '') not in ('', '--', 'none', 'n/a'))::int` }).from(L).where(wo),
    db
      .select({
        asin: L.asin,
        titel: sql<string | null>`max(${L.titel})`,
        groesse: sql<string | null>`max(${L.groesse})`,
        uebergross: sql<boolean>`bool_or(${L.uebergross})`,
        summe: sql<number>`sum(${L.gebuehr})::float`,
        bestand: sql<number>`sum(coalesce(${L.bestandSchnitt}, 0))::float`,
        volumen: sql<number>`sum(coalesce(${L.volumenM3}, 0))::float`,
        zuschlag: sql<number>`sum(coalesce(${L.zuschlag}, 0))::float`,
        rabatt: sql<number>`sum(coalesce(${L.rabatt}, 0))::float`,
        laender: sql<string[]>`array_agg(distinct ${L.land})`,
      })
      .from(L)
      .where(wo)
      .groupBy(L.asin)
      .orderBy(desc(sortSql))
      .limit(Math.min(100, Math.max(1, o.limit ?? 15))),
  ]);
  const reichweite = await reichweiteJeAsin(tenantId, asins.map((a) => a.asin));
  const zeilen = asins.map((a) => {
    const rw = reichweite.get(a.asin) ?? null;
    return {
      asin: a.asin,
      titel: a.titel,
      groesse: a.groesse,
      uebergross: a.uebergross,
      laender: a.laender,
      gebuehr: r2(a.summe),
      bestand_schnitt: r2(a.bestand),
      je_stueck: a.bestand > 0 ? r2(a.summe / a.bestand) : null,
      volumen_m3: Math.round(a.volumen * 1000) / 1000,
      zuschlag_auslastung: a.zuschlag ? r2(a.zuschlag) : null,
      rabatt: a.rabatt ? r2(a.rabatt) : null,
      reichweite_tage: rw,
      remission: remissionPruefen({ uebergross: a.uebergross, volumenM3: a.volumen, gebuehrMonat: a.summe, reichweiteTage: rw }),
    };
  });
  const k = kopf[0] ?? { summe: 0, asins: 0, uebergross: 0, gefahrgut: 0 };
  return {
    monat,
    land,
    monate: monate.map((m) => ({ monat: m.monat, gebuehr: r2(m.summe), asins: m.asins })),
    laender: laender.map((l) => ({ land: l.land, gebuehr: r2(l.summe), asins: l.asins })),
    summe: r2(k.summe),
    anzahl_asins: k.asins,
    anzahl_uebergross: k.uebergross,
    anzahl_gefahrgut: k.gefahrgut,
    asins: zeilen,
    remission_pruefen: zeilen.filter((z) => z.remission).map((z) => ({ asin: z.asin, titel: z.titel, grund: z.remission })),
    abgleich: land || o.asin ? undefined : await lagerAbgleich(tenantId, monat, k.summe),
  };
}

/** Je ASIN der letzte Monat: Gebühr (alle Länder), Ø Bestand, Gebühr je Stück, übergroß, Volumen, Größenklasse. */
export async function lagerJeAsin(tenantId: string, asins?: string[]): Promise<Map<string, { monat: string; gebuehr: number; jeStueck: number | null; uebergross: boolean; volumenM3: number; groesse: string | null }>> {
  if (asins && !asins.length) return new Map();
  const [letzter] = await db.select({ monat: sql<string | null>`max(${L.monat})` }).from(L).where(eq(L.tenantId, tenantId));
  if (!letzter?.monat) return new Map();
  const rows = await db
    .select({ asin: L.asin, gebuehr: sql<number>`sum(${L.gebuehr})::float`, bestand: sql<number>`sum(coalesce(${L.bestandSchnitt}, 0))::float`, uebergross: sql<boolean>`bool_or(${L.uebergross})`, volumen: sql<number>`sum(coalesce(${L.volumenM3}, 0))::float`, groesse: sql<string | null>`max(${L.groesse})` })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), eq(L.monat, letzter.monat), asins ? inArray(L.asin, asins) : undefined))
    .groupBy(L.asin);
  return new Map(rows.map((r) => [r.asin, { monat: letzter.monat!, gebuehr: r2(r.gebuehr), jeStueck: r.bestand > 0 ? r2(r.gebuehr / r.bestand) : null, uebergross: r.uebergross, volumenM3: r.volumen, groesse: r.groesse }]));
}

/**
 * FBA-Gebühr nach Größenklasse (solange die SP-API fehlt): Ø FBA-Gebühr der eigenen Artikel derselben Größenklasse
 * laut Lagergebühren-Bericht. Nur für ASINs, deren Größenklasse aus dem Bericht bekannt ist.
 */
export async function fbaNachGroesse(tenantId: string, asins: string[]): Promise<Map<string, { fba: number; groesse: string }>> {
  if (!asins.length) return new Map();
  const P = schema.products;
  const [klassen, schnitt] = await Promise.all([
    db.selectDistinctOn([L.asin], { asin: L.asin, groesse: L.groesse }).from(L).where(and(eq(L.tenantId, tenantId), inArray(L.asin, asins), sql`${L.groesse} is not null`)).orderBy(L.asin, desc(L.monat)),
    db
      .select({ groesse: L.groesse, fba: sql<number>`avg(abs(${P.fbaFee}))::float`, n: sql<number>`count(distinct ${P.asin})::int` })
      .from(L)
      .innerJoin(P, and(eq(P.tenantId, L.tenantId), eq(P.asin, L.asin)))
      .where(and(eq(L.tenantId, tenantId), sql`${P.fbaFee} is not null`, sql`${L.groesse} is not null`))
      .groupBy(L.groesse),
  ]);
  const jeKlasse = new Map(schnitt.filter((s) => s.n >= 3 && s.fba > 0).map((s) => [s.groesse!, r2(s.fba)]));
  return new Map(klassen.filter((k) => k.groesse && jeKlasse.has(k.groesse)).map((k) => [k.asin, { fba: jeKlasse.get(k.groesse!)!, groesse: k.groesse! }]));
}
