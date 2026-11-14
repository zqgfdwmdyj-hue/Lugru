import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import type { KeepaStand } from "@/lib/keepa/auswertung";
import { aeltesteTage } from "@/lib/money/kapital";
import { repricerRows } from "@/lib/repricer";
import type { ProfitguardExportZeile, TenantSettings } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { abverkaufFuer, istGebraucht, stufeVonRegel, zielpreisGebraucht, zustandAusBefund, zustandAusText, zustandBestimmen, type Stufe, type Zustand, type ZustandQuelle } from "./leiter-logic";
import { HINWEIS_TEXT, PG_FORMAT_STANDARD, profitguardDatei, pruefe, type Hinweis, type PgDateiZeile } from "./profitguard-logic";
import {
  abverkaufVorschlagen,
  breakEvenMin,
  effektiverMin,
  EXPORT_LAENDER,
  gebuehrenFuerLand,
  katalogRegel,
  LIQUIDATION,
  margeBeiPreis,
  maxPreis,
  minEntscheidung,
  neutraleStrategie,
  regelFuer,
  SCHNELLDREHER,
  stufenText,
  systemMinMax,
  titelHatMarke,
  UST,
  vergleiche,
  warnungen,
  type Aenderung,
  type ExportLand,
  type IstStand,
  type SollZeile,
  type Strategie,
  type Zuweisung,
} from "./strategie-logic";

// Soll-Strategie je SKU und Land (Seller-System) gegen den Ist-Stand in ProfitGuard: Freigabe-Vorschau, Importdatei
// für ProfitGuard mit Protokoll, Abgleich als Aufgabe. Das System sendet nichts an ProfitGuard oder Amazon – die Datei
// lädt Ludwig selbst in ProfitGuard hoch („Export & Import“).

const PG = schema.profitguardListings;
const Z = schema.repricingZuweisungen;
const E = schema.profitguardExporte;
const LQ = schema.repricingLiquidationen;

export type VorschauZeile = SollZeile & {
  /** Strategiename in ProfitGuard (Zuordnung in den Einstellungen). */
  strategieName: string;
  titel: string | null;
  asin: string | null;
  quelle: "zuweisung" | "marke" | "abverkauf" | "standard";
  effMin: number | null;
  marge: number | null;
  buybox: number | null;
  /** Ist in ProfitGuard: neutrale Strategie, Name wie in der Datei, Min/Max, im Repricing. */
  istRegel: Strategie | null;
  istStrategieName: string | null;
  istMin: number | null;
  istMax: number | null;
  istImRepricing: boolean | null;
  istPreis: number | null;
  /** Auffälligkeiten Seller-System ↔ ProfitGuard. */
  hinweise: Hinweis[];
  warnungen: string[];
  art: Aenderung["art"];
  regelWechsel: boolean;
  minDiff: number | null;
  /** „neu“ = wegen Min unter Marge auf Liquidation, „ja“ = Strategie ist schon Liquidation. */
  liquidation: "neu" | "ja" | null;
  /** Freigegebene Liquidation (Zuweisung bzw. aktive Liquidation) – Min darf unter dem System-Min liegen. */
  liquidationFrei: boolean;
  regelVorher: Strategie | null;
  breakEven: number | null;
  /** Klassischer Mindestpreis mit Mindestgewinn in € (nur Vergleich) – der Soll-Min ist `min` (Marge je Altersstufe). */
  systemMin: number | null;
  systemMax: number | null;
  /** Marge beim Soll-Min (vom Brutto-Preis). */
  margeNeu: number | null;
  /** Marge beim Min in ProfitGuard. */
  margeIst: number | null;
  /** Effektiver Min der ursprünglichen Strategie (für die Rückkehr). */
  effMinVorher: number | null;
  verlustBis: number | null;
  minGewuenscht: number | null;
  /** Seit wann die Strategie in ProfitGuard steht. */
  strategieSeit: Date | null;
  stufe: Stufe | null;
  istStufe: Stufe | null;
  alterTage: number | null;
  effMinStufe1: number | null;
  effMinStufe2: number | null;
  keinWechsel: "buybox_ueber" | "buybox_unbekannt" | "schnelldreher" | null;
  /** Break-even + Schnelldreher-Boden – auch für Kandidaten (Listing-Check Befund 1). */
  bodenSchnell: number | null;
  zustand: Zustand;
  zustandQuelle: ZustandQuelle;
  zielpreis: number | null;
  zielpreisQuelle: string | null;
  minGebraucht: number | null;
  schnelldreher: boolean;
  boden: number | null;
  /** Bestand FBA (verkaufbar + reserviert + unterwegs) + eigenes Lager (FBM). */
  bestand: number;
  fba: number;
  provision: number;
  gebuehren: { quelle: "liste" | "amazon" | "produkt"; geschaetzt: boolean; staffel: boolean; kategorie: string | null };
  stufeText: string | null;
};

export type LandVorschau = { land: ExportLand; zeilen: VorschauZeile[]; neu: number; geaendert: number; gleich: number; regelWechsel: number; mitWarnung: number; mitHinweis: number; istStand: Date | null; vergleichMit: "profitguard" | "export" | "nichts" };

export type SollVorschau = {
  laender: LandVorschau[];
  ekFehlt: { land: ExportLand; sku: string; titel: string | null }[];
  /** Zustand unbekannt – kein automatischer Preis, nicht in der Datei (Aufgabe „Zustand prüfen“). */
  zustandUnbekannt: { land: ExportLand; sku: string; titel: string | null }[];
  vorschlaege: { sku: string; titel: string | null; reichweite: number | null; kapital: number | null }[];
  /** In ProfitGuard, aber ohne Soll (kein Bestand bzw. nicht im Seller-System). */
  nurIst: { land: string; sku: string; strategie: string | null; min: number | null; max: number | null; imRepricing: boolean | null }[];
  letzterExport: { id: string; am: Date; anzahl: Record<string, number> } | null;
};

/** ProfitGuard-Strategiename → neutrale Strategie (über die Zuordnung in den Einstellungen, sonst am Namen erkannt). */
export function istStrategieAus(name: string | null | undefined, namen: Record<Strategie, string>): Strategie | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  const treffer = (Object.entries(namen) as [Strategie, string][]).find(([, v]) => v.trim().toLowerCase() === n);
  return treffer ? treffer[0] : neutraleStrategie(name);
}

async function istStand(tenantId: string, laender: string[]) {
  const rows = laender.length ? await db.select().from(PG).where(and(eq(PG.tenantId, tenantId), inArray(PG.marktplatz, laender))) : [];
  const je = new Map<string, typeof rows>();
  for (const r of rows) je.set(r.marktplatz, [...(je.get(r.marktplatz) ?? []), r]);
  return je;
}

export async function sollVorschau(tenantId: string, o: { laender?: ExportLand[]; heute?: string } = {}): Promise<SollVorschau> {
  const s = await getSettings(tenantId);
  const b = s.repricing;
  const laender = (o.laender?.length ? o.laender : b.laender).filter((l): l is ExportLand => (EXPORT_LAENDER as readonly string[]).includes(l));
  const heute = o.heute ?? todayIso();
  const [rows, zuw, ist, letzter, liqRows] = await Promise.all([
    repricerRows(tenantId),
    db.select().from(Z).where(eq(Z.tenantId, tenantId)),
    istStand(tenantId, laender),
    db.select().from(E).where(eq(E.tenantId, tenantId)).orderBy(desc(E.createdAt)).limit(1),
    db.select().from(LQ).where(eq(LQ.tenantId, tenantId)),
  ]);
  const gebJe = await import("./gebuehren").then((x) => x.gebuehrenLaden(tenantId, laender)).catch(() => new Map() as Awaited<ReturnType<typeof import("./gebuehren").gebuehrenLaden>>);
  const [zustandRows, pflegeRows, chargen, invZustand, station] = await Promise.all([
    db.select().from(schema.artikelZustand).where(eq(schema.artikelZustand.tenantId, tenantId)),
    db.select().from(schema.repricingSkuPflege).where(eq(schema.repricingSkuPflege.tenantId, tenantId)),
    db.select({ sku: schema.lots.sku, kind: schema.lots.kind }).from(schema.lots).where(eq(schema.lots.tenantId, tenantId)),
    db.select({ sku: schema.amazonInventory.sku, condition: schema.amazonInventory.condition, mfn: schema.amazonInventory.mfnFulfillable }).from(schema.amazonInventory).where(eq(schema.amazonInventory.tenantId, tenantId)),
    db.select({ sku: schema.retourenPositionen.sku, retSku: schema.retourenPositionen.retSku, befund: schema.retourenPositionen.befund }).from(schema.retourenPositionen).where(and(eq(schema.retourenPositionen.tenantId, tenantId), sql`${schema.retourenPositionen.befund} is not null`)),
  ]);
  const handZustand = new Map(zustandRows.filter((z) => z.quelle === "hand").map((z) => [`${z.land}|${z.sku}`, z.zustand as Zustand]));
  const kindJe = new Map<string, Set<string>>();
  for (const c of chargen) kindJe.set(c.sku, (kindJe.get(c.sku) ?? new Set()).add(c.kind));
  const invJe = new Map(invZustand.map((i) => [i.sku, i]));
  const befundJe = new Map<string, string>();
  for (const st of station) for (const k of [st.retSku, st.sku]) if (k && st.befund) befundJe.set(k, st.befund);
  const pflegeJe = new Map(pflegeRows.map((p) => [`${p.land}|${p.sku}`, p]));
  const leiter = b.leiter;
  const liqJe = new Map(liqRows.filter((l) => l.status !== "beendet" || l.verlustBis !== null).map((l) => [`${l.land}|${l.sku}`, l]));
  const skus = rows.map((r) => r.sku);
  const asins = [...new Set(rows.map((r) => r.asin).filter((a): a is string => !!a))];
  const [alter, keepa, listungen] = await Promise.all([
    skus.length ? db.select({ sku: schema.amazonLageralter.sku, alter: schema.amazonLageralter.alter }).from(schema.amazonLageralter).where(and(eq(schema.amazonLageralter.tenantId, tenantId), inArray(schema.amazonLageralter.sku, skus))) : [],
    asins.length && laender.length ? db.select({ asin: schema.keepaCache.asin, mp: schema.keepaCache.marktplatz, stand: schema.keepaCache.stand }).from(schema.keepaCache).where(and(eq(schema.keepaCache.tenantId, tenantId), inArray(schema.keepaCache.asin, asins), inArray(schema.keepaCache.marktplatz, laender))) : [],
    laender.length ? db.select({ land: schema.amazonListungen.land, sku: schema.amazonListungen.sku }).from(schema.amazonListungen).where(and(eq(schema.amazonListungen.tenantId, tenantId), inArray(schema.amazonListungen.land, laender))) : [],
  ]);
  const alterJe = new Map<string, number | null>();
  for (const a of alter) {
    const t = aeltesteTage(a.alter as Record<string, number>);
    if (t !== null) alterJe.set(a.sku, Math.max(alterJe.get(a.sku) ?? 0, t));
  }
  const keepaJe = new Map(keepa.map((k) => [`${k.asin}|${k.mp}`, k.stand as KeepaStand | null]));
  const gelistet = new Map<string, Set<string>>();
  for (const l of listungen) gelistet.set(l.land, (gelistet.get(l.land) ?? new Set()).add(l.sku));
  const zuwJe = new Map(zuw.filter((z) => z.freigegeben).map((z) => [`${z.land}|${z.sku}`, { regel: z.regel, untergrenze: z.untergrenze, quelle: z.quelle } as Zuweisung]));
  const letzteZeilen = letzter[0]?.zeilen ?? [];
  const namen = b.profitguard.strategieNamen;
  const ekFehlt: SollVorschau["ekFehlt"] = [];
  const zustandUnbekannt: SollVorschau["zustandUnbekannt"] = [];
  const nurIst: SollVorschau["nurIst"] = [];
  const f2 = (n: number | null) => (n === null ? "–" : n.toFixed(2));

  const ergebnis: LandVorschau[] = laender.map((land) => {
    const istRows = ist.get(land) ?? [];
    const istJe = new Map(istRows.map((r) => [r.sku, r]));
    const pgSkus = istRows.length ? new Set(istRows.map((r) => r.sku)) : null;
    const listSkus = gelistet.get(land) ?? null;
    // SKUs mit Bestand, die im Land gelistet bzw. in ProfitGuard sind; ohne beides alle (wie bisher).
    const kandidaten = rows.filter((r) => (pgSkus || listSkus ? !!pgSkus?.has(r.sku) || !!listSkus?.has(r.sku) : true));
    const imSoll = new Set<string>();
    const zeilen: VorschauZeile[] = [];
    for (const r of kandidaten) {
      if (r.unitCost === null || r.unitCost <= 0.011) {
        ekFehlt.push({ land, sku: r.sku, titel: r.title });
        continue;
      }
      const i = istJe.get(r.sku);
      const key = `${land}|${r.sku}`;
      const kinds = kindJe.get(r.sku);
      const zb = zustandBestimmen({
        hand: handZustand.get(`${land}|${r.sku}`) ?? handZustand.get(`*|${r.sku}`) ?? null,
        sku: r.sku,
        arbitrageone: null,
        amazon: zustandAusText(invJe.get(r.sku)?.condition ?? null),
        station: zustandAusBefund(befundJe.get(r.sku) ?? null),
        einkaufNeu: !!kinds?.has("purchase"),
        retoureCharge: !!kinds?.has("return") && !kinds?.has("purchase"),
      });
      if (zb.zustand === "unbekannt") {
        zustandUnbekannt.push({ land, sku: r.sku, titel: r.title });
        continue;
      }
      imSoll.add(r.sku);
      const gebraucht = istGebraucht(zb.zustand);
      const pf = pflegeJe.get(key);
      const schnelldreher = !!pf?.schnelldreher && !gebraucht;
      const abvRegel = abverkaufFuer(land, b.abverkaufRegel);
      let rf = regelFuer({ land, titel: r.title, asin: r.asin, zuweisung: zuwJe.get(key) ?? null, markenRegeln: b.markenRegeln, aufAbverkaufsListe: b.elektronikLaender.includes(land) && b.elektronikMarken.some((m) => titelHatMarke(r.title, m)) });
      // Gebrauchte laufen nicht mit Standard (Neupreis-Marge), sondern mit Abverkauf (Stufe 2), außer schon Liquidation.
      if (gebraucht && stufeVonRegel(rf.regel, b.katalog) === 1 && rf.quelle !== "zuweisung") rf = { ...rf, regel: abvRegel };
      // Schnelldreher: eigene Strategie mit Boden-Marge (keine Leiter), außer bei fester Zuweisung.
      if (schnelldreher && rf.quelle !== "zuweisung") rf = { ...rf, regel: SCHNELLDREHER };
      const kat = katalogRegel(b.katalog, rf.regel);
      const gj = gebJe.get(key);
      const geb = gebuehrenFuerLand({ land, liste: gj?.liste ?? null, amazon: gj?.amazon ?? null, produkt: { fba: r.fbaFee, satz: r.referralRate, geschaetzt: r.feeEstimated || r.refEstimated }, staffeln: b.provisionStaffeln });
      const kosten = { ek: r.unitCost, fba: geb.fba, fix: b.fixGebuehr, zusatz: b.zusatzkosten, ust: UST[land], provision: geb.provision };
      const sys = systemMinMax({ ek: r.unitCost, fba: geb.fba, satz: geb.satz, ust: UST[land], minGewinn: s.pricing.minProfit, maxFaktor: s.pricing.maxPriceFactor, zielVk: r.target });
      const systemMin = sys?.min ?? null;
      const alterTage = alterJe.get(r.sku) ?? null;
      const be0 = breakEvenMin({ ...kosten, margeProzent: 0 });
      const effBasis = { untergrenze: null, ...kosten, alterTage };
      const eff = effektiverMin({ ...effBasis, regel: kat, untergrenze: rf.untergrenze });
      const effMinStufe1 = effektiverMin({ ...effBasis, regel: katalogRegel(b.katalog, b.standardRegel) }).min;
      const effMinStufe2 = effektiverMin({ ...effBasis, regel: katalogRegel(b.katalog, abvRegel) }).min;
      const liq = liqJe.get(key) ?? null;
      const k = r.asin ? keepaJe.get(`${r.asin}|${land}`) : null;
      const neuBuybox = i?.buyboxPreis ?? k?.aktuell?.buybox ?? null;
      const ziel = gebraucht ? zielpreisGebraucht({ zustand: zb.zustand, keepa: k?.aktuell?.gebraucht ?? null, neuBuybox, faktoren: leiter.zustand.faktoren }) : { preis: null, quelle: null as string | null };
      const minGebraucht = gebraucht ? breakEvenMin({ ...kosten, margeProzent: leiter.zustand.mindestmarge }) : null;
      const buybox = gebraucht ? (ziel.preis ?? neuBuybox) : neuBuybox;
      const pBoden = breakEvenMin({ ...kosten, margeProzent: leiter.schnell.margeBoden });
      const bodenSchnell = pBoden !== null && be0 !== null ? Math.max(pBoden, be0) : pBoden;
      const boden = schnelldreher ? bodenSchnell : null;
      const gewuenscht = gebraucht && rf.quelle !== "zuweisung" && !kat?.festeUntergrenze ? minGebraucht : rf.untergrenze;
      const ent = minEntscheidung({ regelName: rf.regel, regel: kat, gewuenscht, effMin: eff.min, breakEven: be0, verlustBis: liq?.verlustBis ?? null, buybox, boden, schnelldreher, laeuft: !!liq && liq.grund !== "hand" && (liq.status === "aktiv" || liq.status === "zurueck_vorgeschlagen") });
      if (ent.min === null) continue;
      const min = ent.min;
      const regelVorher = ent.regelVorher ?? (liq && liq.grund !== "hand" ? neutraleStrategie(liq.regelVorher) : null);
      const effMinVorher = ent.art === "liquidation_neu" ? eff.min : regelVorher ? effektiverMin({ ...effBasis, regel: katalogRegel(b.katalog, regelVorher) }).min : null;
      const max0 = gebraucht && ziel.preis ? Math.max(Math.round(ziel.preis * leiter.zustand.maxFaktor * 100) / 100, Math.round(min * 1.05 * 100) / 100) : maxPreis({ min, faktor: s.pricing.maxPriceFactor, zielVk: r.target });
      // Listing-Check Befund 5: Max nach Freigabe („Max anheben“), nie unter Min + 5 %
      const max = pf?.maxSoll ? Math.max(pf.maxSoll, Math.round(min * 1.05 * 100) / 100) : max0;
      // Im Repricing: mit Bestand immer (sonst Auffälligkeit „nicht im Repricing“); gebrauchte Ware erst nach Freigabe „aktivieren“.
      const bestandJetzt = r.stock + (invJe.get(r.sku)?.mfn ?? 0);
      const aktiv = pf?.aktivieren ? true : gebraucht ? i?.imRepricing === true : bestandJetzt > 0 || i?.imRepricing === true;
      const liquidationFrei = ent.art === "liquidation" || (!!liq && (liq.status === "aktiv" || liq.status === "zurueck_vorgeschlagen"));
      const w = warnungen({ min, max }, { buybox, breakEven: null });
      if (ent.angehoben) w.push(`Gewünschter Min ${f2(gewuenscht)} unter Break-even ${f2(be0)} – auf Break-even angehoben (Abverkauf mit Verlust nicht freigegeben)`);
      if (ent.unterBreakEven) w.push(ent.verlustFreigegeben ? `Min ${f2(min)} unter Break-even ${f2(be0)} – Abverkauf mit Verlust freigegeben bis ${f2(liq?.verlustBis ?? null)} € je Stück` : `Min ${f2(min)} unter Break-even ${f2(be0)} – nicht freigegeben („Verlust akzeptiert bis“ setzen oder Min anheben)`);
      if (ent.keinWechsel === "buybox_ueber") w.push(`Gewünschter Min ${f2(gewuenscht)} unter effektivem Min ${f2(eff.min)} – kein Wechsel, die Buy Box ${f2(buybox)} liegt darüber (Min = effektiver Min genügt)`);
      if (ent.keinWechsel === "buybox_unbekannt") w.push(`Gewünschter Min ${f2(gewuenscht)} unter effektivem Min ${f2(eff.min)} – kein Wechsel ohne bekannte Buy Box (Min = effektiver Min)`);
      if (ent.keinWechsel === "schnelldreher") w.push(`Schnelldreher: kein Wechsel, Min mindestens Break-even + ${leiter.schnell.margeBoden} % (${f2(boden)})`);
      if (gebraucht && ziel.preis !== null && be0 !== null && ziel.preis < be0 - 0.005) w.push(`Verlust – Entscheidung: Zielpreis gebraucht ${f2(ziel.preis)} unter Break-even ${f2(be0)}`);
      if (ent.art === "liquidation_neu") w.push(`Wechsel auf Liquidation (gewünschter Min unter Marge) – erst nach Freigabe wirksam, Liquidation ab Import in ProfitGuard`);
      const istRegel = istStrategieAus(i?.strategie ?? null, namen);
      const inv = invJe.get(r.sku);
      const bestand = r.stock + (inv?.mfn ?? 0);
      const hinweise = pruefe({ ist: i ? { min: i.min, max: i.max, preis: i.preis, imRepricing: i.imRepricing } : null, bestand, sollMin: ent.art === "liquidation_neu" ? (eff.min ?? min) : min, liquidationFrei, sollStrategie: ent.regel, istStrategie: istRegel });
      zeilen.push({
        land, sku: r.sku, regel: ent.regel, strategieName: namen[ent.regel] ?? ent.regel, min, max, aktiv, titel: r.title, asin: r.asin, quelle: rf.quelle, effMin: eff.min, marge: eff.marge, buybox,
        istRegel, istStrategieName: i?.strategie ?? null, istMin: i?.min ?? null, istMax: i?.max ?? null, istImRepricing: i ? i.imRepricing : null, istPreis: i?.preis ?? r.price ?? null,
        hinweise, warnungen: w, art: "neu", regelWechsel: false, minDiff: null, liquidation: ent.art === "liquidation_neu" ? "neu" : ent.art === "liquidation" ? "ja" : null, liquidationFrei,
        regelVorher, breakEven: be0, systemMin, systemMax: sys?.max ?? null, margeNeu: margeBeiPreis({ preis: min, ...kosten }), margeIst: i?.min ? margeBeiPreis({ preis: i.min, ...kosten }) : null,
        effMinVorher, verlustBis: liq?.verlustBis ?? null, minGewuenscht: gewuenscht, strategieSeit: i?.strategieSeit ?? null, stufe: stufeVonRegel(ent.regel, b.katalog), istStufe: stufeVonRegel(istRegel, b.katalog),
        alterTage, effMinStufe1, effMinStufe2, keinWechsel: ent.keinWechsel, zustand: zb.zustand, zustandQuelle: zb.quelle, zielpreis: ziel.preis, zielpreisQuelle: ziel.quelle, minGebraucht, schnelldreher, boden, bodenSchnell,
        bestand, fba: geb.fba, provision: geb.satz, gebuehren: { quelle: geb.quelle, geschaetzt: geb.geschaetzt, staffel: typeof geb.provision !== "number", kategorie: geb.kategorie }, stufeText: eff.stufe ? stufenText(eff.stufe) : null,
      });
    }
    for (const x of istRows) if (!imSoll.has(x.sku) && !kandidaten.some((r) => r.sku === x.sku)) nurIst.push({ land, sku: x.sku, strategie: x.strategie, min: x.min, max: x.max, imRepricing: x.imRepricing });
    // Vergleich: ProfitGuard-Ist, sonst letzter eigener Export.
    const vergleichMit: LandVorschau["vergleichMit"] = istRows.length ? "profitguard" : letzteZeilen.some((z) => z.land === land) ? "export" : "nichts";
    const istMap = new Map<string, IstStand>(
      vergleichMit === "profitguard"
        ? istRows.map((x) => [x.sku, { regel: istStrategieAus(x.strategie, namen), min: x.min, max: x.max }])
        : letzteZeilen.filter((z) => z.land === land).map((z) => [z.sku, { regel: z.strategie, min: z.min, max: z.max }]),
    );
    const v = new Map(vergleiche(zeilen, istMap).map((a) => [a.sku, a]));
    for (const z of zeilen) {
      const a = v.get(z.sku)!;
      // „im Repricing“ weicht vom ProfitGuard-Ist ab → auch das ist eine Änderung für die Datei.
      const aktivAnders = vergleichMit === "profitguard" && istJe.has(z.sku) && z.istImRepricing !== null && z.istImRepricing !== z.aktiv;
      z.art = a.art === "gleich" && aktivAnders ? "geaendert" : a.art;
      z.regelWechsel = a.regelWechsel;
      z.minDiff = a.minDiff;
    }
    zeilen.sort((a, b) => b.hinweise.length - a.hinweise.length || Number(b.warnungen.length > 0) - Number(a.warnungen.length > 0) || Math.abs(b.minDiff ?? 0) - Math.abs(a.minDiff ?? 0) || a.sku.localeCompare(b.sku));
    const stand = istRows.reduce<Date | null>((m, x) => (!m || x.eingelesenAm > m ? x.eingelesenAm : m), null);
    return { land, zeilen, neu: zeilen.filter((z) => z.art === "neu").length, geaendert: zeilen.filter((z) => z.art === "geaendert").length, gleich: zeilen.filter((z) => z.art === "gleich").length, regelWechsel: zeilen.filter((z) => z.regelWechsel).length, mitWarnung: zeilen.filter((z) => z.warnungen.length).length, mitHinweis: zeilen.filter((z) => z.hinweise.length).length, istStand: stand, vergleichMit };
  });

  let vorschlaege: SollVorschau["vorschlaege"] = [];
  try {
    const { kapitalAmpel } = await import("@/lib/money/kapital-service");
    const k = await kapitalAmpel(tenantId, heute);
    const offen = new Set(zuw.map((z) => z.sku));
    vorschlaege = k.zeilen.filter((z) => abverkaufVorschlagen(z, s.kapital.rotReichweite) && !offen.has(z.sku)).map((z) => ({ sku: z.sku, titel: z.name, reichweite: z.reichweite, kapital: z.kapital }));
  } catch {
    vorschlaege = [];
  }
  return { laender: ergebnis, ekFehlt, zustandUnbekannt, vorschlaege, nurIst, letzterExport: letzter[0] ? { id: letzter[0].id, am: letzter[0].createdAt, anzahl: letzter[0].anzahl } : null };
}

/** Zusammenfassung einer Datei für die Freigabe (Strategiewechsel, Min unter Break-even, Liquidation neu). */
export type ExportZusammenfassung = { jeLand: Record<string, number>; gesamt: number; regelWechsel: number; warnungen: number; unterBreakEven: number; liquidation: number };

/** Was in eine Datei käme (für die Freigabe-Anzeige und den Export). Nur Änderungen = neue und geänderte Zeilen. */
export function exportAuswahl(v: SollVorschau, o: { nurAenderungen: boolean }): { zeilen: VorschauZeile[]; zusammenfassung: ExportZusammenfassung } {
  const zeilen = v.laender.flatMap((l) => l.zeilen.filter((z) => !o.nurAenderungen || z.art !== "gleich"));
  const jeLand = Object.fromEntries(v.laender.map((l) => [l.land, zeilen.filter((z) => z.land === l.land).length]));
  return {
    zeilen,
    zusammenfassung: { jeLand, gesamt: zeilen.length, regelWechsel: zeilen.filter((z) => z.regelWechsel).length, warnungen: zeilen.filter((z) => z.warnungen.length).length, unterBreakEven: zeilen.filter((z) => z.warnungen.some((w) => /unter Break-even/i.test(w))).length, liquidation: zeilen.filter((z) => z.liquidation === "neu").length },
  };
}

/** Braucht die Datei eine ausdrückliche Freigabe (Strategiewechsel, Liquidation neu, Min unter Break-even)? */
export const freigabeNoetig = (z: ExportZusammenfassung) => z.regelWechsel > 0 || z.liquidation > 0 || z.unterBreakEven > 0;

/**
 * ProfitGuard-Importdatei erzeugen und speichern (Download je Land bzw. alle Länder). Mit Strategiewechsel, neuer
 * Liquidation oder Min unter Break-even nur mit Freigabe (`freigegeben`). Es wird nichts an ProfitGuard gesendet.
 */
export async function profitguardExportErzeugen(tenantId: string, userId: string | null, o: { laender?: ExportLand[]; nurAenderungen: boolean; freigegeben?: boolean }): Promise<{ ok: true; id: string; anzahl: Record<string, number>; zusammenfassung: ExportZusammenfassung } | { ok: false; text: string; zusammenfassung: ExportZusammenfassung }> {
  const v = await sollVorschau(tenantId, { laender: o.laender });
  const { zeilen: gewaehlt, zusammenfassung } = exportAuswahl(v, { nurAenderungen: o.nurAenderungen });
  if (!gewaehlt.length) return { ok: false, text: o.nurAenderungen ? "Keine Änderungen gegenüber ProfitGuard – keine Datei nötig." : "Keine SKUs für die Datei (EK oder Zustand fehlen?).", zusammenfassung };
  if (freigabeNoetig(zusammenfassung) && !o.freigegeben) return { ok: false, text: `Freigabe nötig: ${zusammenfassung.regelWechsel} Strategiewechsel, ${zusammenfassung.liquidation} neu auf Liquidation, ${zusammenfassung.unterBreakEven} Min unter Break-even – „Freigabe geprüft“ anhaken.`, zusammenfassung };
  const zeilen: ProfitguardExportZeile[] = gewaehlt.map((z) => ({ land: z.land, sku: z.sku, strategie: z.regel, strategieName: z.strategieName, min: z.min, max: z.max, aktiv: z.aktiv, minVorher: z.istMin }));
  const anzahl = zusammenfassung.jeLand;
  const [e] = await db.insert(E).values({ tenantId, userId, laender: v.laender.map((l) => l.land), nurAenderungen: o.nurAenderungen, zeilen, anzahl, protokoll: [{ zeit: new Date().toISOString(), text: `Datei erzeugt: ${zeilen.length} Zeilen${o.freigegeben ? " (Freigabe geprüft)" : ""}` }] }).returning({ id: E.id });
  // Strategie vor Liquidation merken (Vorschlag; aktiv, sobald der ProfitGuard-Ist Liquidation + Min zeigt).
  for (const z of gewaehlt.filter((x) => x.liquidation === "neu")) {
    const werte = { grund: "min_unter_marge" as const, regelVorher: z.regelVorher, minGewuenscht: z.minGewuenscht, minGesetzt: z.min, effMinVorher: z.effMinVorher, breakEven: z.breakEven, updatedAt: new Date() };
    await db
      .insert(LQ)
      .values({ tenantId, land: z.land, sku: z.sku, ...werte, status: "vorgeschlagen" })
      .onConflictDoUpdate({ target: [LQ.tenantId, LQ.land, LQ.sku], set: { ...werte, status: sql`case when ${LQ.status} = 'beendet' then 'vorgeschlagen' else ${LQ.status} end`, beendetAm: sql`case when ${LQ.status} = 'beendet' then null else ${LQ.beendetAm} end` } });
  }
  return { ok: true, id: e.id, anzahl, zusammenfassung };
}

/** Datei(en) eines Exports im gelernten ProfitGuard-Format: je Land eine CSV, ohne Land alle Länder in einer Datei. */
export async function profitguardExportDatei(tenantId: string, id: string, land?: string | null): Promise<{ name: string; text: string } | null> {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) return null;
  const s = await getSettings(tenantId);
  const f = s.repricing.profitguard.format ?? PG_FORMAT_STANDARD;
  const zeilen = e.zeilen.filter((z) => !land || z.land === land);
  const ist = zeilen.length ? await db.select().from(PG).where(and(eq(PG.tenantId, tenantId), inArray(PG.sku, [...new Set(zeilen.map((z) => z.sku))]))) : [];
  const istJe = new Map(ist.map((x) => [`${x.marktplatz}|${x.sku}`, x]));
  const datei: PgDateiZeile[] = zeilen.map((z) => {
    const x = istJe.get(`${z.land}|${z.sku}`);
    return { land: z.land, sku: z.sku, strategieName: z.strategieName, min: z.min, max: z.max, aktiv: z.aktiv, ist: x ? { zusatz: x.zusatz, asin: x.asin, titel: x.titel, preis: x.preis, bestand: x.bestand } : null };
  });
  const datum = e.createdAt.toISOString().slice(0, 10);
  return { name: `ProfitGuard_${land ?? "alle"}_${datum}${e.nurAenderungen ? "_Aenderungen" : ""}.csv`, text: profitguardDatei(datei, f) };
}

export async function profitguardExporte(tenantId: string, limit = 10) {
  return db.select({ id: E.id, laender: E.laender, nurAenderungen: E.nurAenderungen, anzahl: E.anzahl, importiertAm: E.importiertAm, importiertVon: E.importiertVon, protokoll: E.protokoll, createdAt: E.createdAt }).from(E).where(eq(E.tenantId, tenantId)).orderBy(desc(E.createdAt)).limit(limit);
}

/** Von Hand bestätigen, dass die Datei in ProfitGuard importiert wurde (nur Vermerk – das System prüft es beim nächsten Export-Import). */
export async function exportImportiertBestaetigen(tenantId: string, id: string, wer: string): Promise<boolean> {
  const [e] = await db.select({ protokoll: E.protokoll }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) return false;
  const jetzt = new Date();
  await db.update(E).set({ importiertAm: jetzt, importiertVon: wer, protokoll: [...e.protokoll, { zeit: jetzt.toISOString(), text: `in ProfitGuard importiert (bestätigt von ${wer})` }] }).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  return true;
}

// ---- Soll-Strategien pflegen ----------------------------------------------------------------------------------

export async function zuweisungSetzen(tenantId: string, z: { land: ExportLand; sku: string; regel: string; untergrenze: number | null; quelle: Zuweisung["quelle"]; freigegeben?: boolean; grund?: string | null }) {
  const sku = z.sku.trim();
  const regel = neutraleStrategie(z.regel);
  if (!sku || !regel) throw new Error("SKU und Strategie angeben.");
  const werte = { regel, untergrenze: z.untergrenze, quelle: z.quelle, freigegeben: z.freigegeben ?? true, grund: z.grund ?? null, updatedAt: new Date() };
  await db.insert(Z).values({ tenantId, land: z.land, sku, ...werte }).onConflictDoUpdate({ target: [Z.tenantId, Z.land, Z.sku], set: werte });
}

export async function zuweisungLoeschen(tenantId: string, land: string, sku: string) {
  await db.delete(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.land, land), eq(Z.sku, sku)));
}

export async function zuweisungen(tenantId: string) {
  return db.select().from(Z).where(eq(Z.tenantId, tenantId)).orderBy(Z.regel, Z.sku, Z.land);
}

/** Kapital-Vorschlag freigeben: SKU in den gewählten Ländern auf „Abverkauf“. */
export async function vorschlagFreigeben(tenantId: string, sku: string, laender?: ExportLand[]) {
  const s = await getSettings(tenantId);
  for (const land of laender?.length ? laender : s.repricing.laender) {
    await zuweisungSetzen(tenantId, { land, sku, regel: abverkaufFuer(land, s.repricing.abverkaufRegel), untergrenze: null, quelle: "kapital", grund: "Kapital-Ampel rot, Reichweite über Grenze" });
  }
}

/**
 * Strategien aus dem ProfitGuard-Ist als Soll übernehmen: Liquidation (mit Min als feste Untergrenze), Abverkauf und
 * Schnelldreher werden Soll-Zuweisungen. Von Hand gepflegte Zuweisungen bleiben unangetastet.
 */
export async function istAlsSollUebernehmen(tenantId: string): Promise<{ liquidation: number; andere: number }> {
  const s = await getSettings(tenantId);
  const ist = await db.select().from(PG).where(eq(PG.tenantId, tenantId));
  const hand = new Set((await db.select({ land: Z.land, sku: Z.sku }).from(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.quelle, "hand")))).map((x) => `${x.land}|${x.sku}`));
  let liquidation = 0;
  let andere = 0;
  for (const r of ist) {
    const st = istStrategieAus(r.strategie, s.repricing.profitguard.strategieNamen);
    if (!st || st === s.repricing.standardRegel || hand.has(`${r.marktplatz}|${r.sku}`)) continue;
    if (!(EXPORT_LAENDER as readonly string[]).includes(r.marktplatz)) continue;
    await zuweisungSetzen(tenantId, { land: r.marktplatz as ExportLand, sku: r.sku, regel: st, untergrenze: st === LIQUIDATION ? r.min : null, quelle: "vorlage", grund: `aus ProfitGuard ${r.datei ?? ""}`.trim() });
    if (st === LIQUIDATION) liquidation++;
    else andere++;
  }
  return { liquidation, andere };
}

/** Abgleich Seller-System ↔ ProfitGuard als Aufgabe (Kategorie Amazon); ohne Auffälligkeiten erledigt. */
export async function repricingAbgleichAufgabe(tenantId: string): Promise<number> {
  const v = await sollVorschau(tenantId);
  const zeilen = v.laender.flatMap((l) => l.zeilen);
  const arten = new Map<Hinweis, number>();
  for (const z of zeilen) for (const h of z.hinweise) if (h !== "preis_unter_min") arten.set(h, (arten.get(h) ?? 0) + 1);
  const n = zeilen.filter((z) => z.hinweise.some((h) => h !== "preis_unter_min")).length;
  if (!n) {
    await resolveSystemTask(db, tenantId, "repricing-abgleich");
    return 0;
  }
  await upsertSystemTask(db, tenantId, "repricing-abgleich", {
    title: `ProfitGuard-Abgleich: ${n} SKU${n === 1 ? "" : "s"} auffällig`,
    notes: [...arten.entries()].map(([k, x]) => `${HINWEIS_TEXT[k]}: ${x}`).join("\n") + "\nKorrektur: Importdatei unter Repricer → ProfitGuard erzeugen und in ProfitGuard hochladen – das System ändert in ProfitGuard nichts selbst.",
    category: "amazon",
    link: "/repricer#abgleich",
  });
  return n;
}

/** Repricing-Einstellungen ändern: nur die genannten Felder. */
export async function repricingEinstellungenSpeichern(tenantId: string, patch: NonNullable<TenantSettings["repricing"]>) {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const alt = t?.settings ?? {};
  await db
    .update(schema.tenants)
    .set({ settings: { ...alt, repricing: { ...(alt.repricing ?? {}), ...patch } } })
    .where(eq(schema.tenants.id, tenantId));
}
