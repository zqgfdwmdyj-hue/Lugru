import "server-only";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import type { KeepaStand } from "@/lib/keepa/auswertung";
import { aeltesteTage } from "@/lib/money/kapital";
import { repricerRows } from "@/lib/repricer";
import type { BqoolLaufZusammenfassung, TenantSettings } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { abverkaufFuer, istGebraucht, stufeVonRegel, zielpreisGebraucht, zustandAusBefund, zustandAusText, zustandBestimmen, type Stufe, type Zustand, type ZustandQuelle } from "./leiter-logic";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import {
  abgleich,
  abverkaufVorschlagen,
  buyboxErklaerung,
  bqoolCost,
  bqoolDatei,
  breakEvenMin,
  effektiverMin,
  liquidationsName,
  margeBeiPreis,
  minEntscheidung,
  EXPORT_LAENDER,
  FORMAT_STANDARD,
  katalogRegel,
  liesBqoolDatei,
  maxPreis,
  minBlockiertBuybox,
  regelFuer,
  titelHatMarke,
  UST,
  vergleiche,
  warnungen,
  type AbgleichFall,
  type Aenderung,
  type BqoolFormat,
  type ExportLand,
  type ExportZeile,
  type IstStand,
  type Zuweisung,
} from "./export-logic";

// BQool-Dateien je Land aus dem System: Ist (hochgeladene BQool-Dateien bzw. „Manage Listings“) gegen Soll (Regeln im
// System), Freigabe-Vorschau, Export mit Protokoll, Abgleich als Aufgabe. Preise in BQool ändert nur Ludwig (Upload
// bzw. Browser-Automatik auf Knopfdruck).

const L = schema.bqoolListings;
const Z = schema.bqoolZuweisungen;
const E = schema.bqoolExporte;
const LQ = schema.bqoolLiquidationen;

export type VorschauZeile = ExportZeile & {
  titel: string | null;
  asin: string | null;
  quelle: "zuweisung" | "ist" | "marke" | "abverkauf" | "standard";
  effMin: number | null;
  marge: number | null;
  buybox: number | null;
  istRegel: string | null;
  istMin: number | null;
  /** Warum (noch) keine Buy Box – Equalizer bewusst 1 Cent darüber bzw. auf Min. */
  erklaerung: string | null;
  warnungen: string[];
  art: Aenderung["art"];
  regelWechsel: boolean;
  minDiff: number | null;
  /** B31.6: „neu“ = wegen Min unter Marge auf Liquidation, „ja“ = Regel ist schon Liquidation. */
  liquidation: "neu" | "ja" | null;
  regelVorher: string | null;
  breakEven: number | null;
  /** Marge beim Min der Datei (vom Brutto-Preis). */
  margeNeu: number | null;
  /** Effektiver Min der ursprünglichen Regel (für die Rückkehr). */
  effMinVorher: number | null;
  /** Regelwechsel auf Liquidation, aber der Test mit einer SKU ist noch nicht bestanden → nicht in der Datei. */
  wartetAufTest: boolean;
  verlustBis: number | null;
  /** Gewünschter Min (Zuweisung bzw. Untergrenze aus BQool). */
  minGewuenscht: number | null;
  /** Seit wann die Regel in BQool steht (BQool-Ist). */
  regelSeit: Date | null;
  /** B31.6b: Stufe der Soll-Regel (1 ia · 2 Abverkauf · 3 Liquidation), Stufe der Ist-Regel. */
  stufe: Stufe | null;
  istStufe: Stufe | null;
  alterTage: number | null;
  /** Effektiver Min der Stufe-1-Regel (ia) und der Stufe-2-Regel (Abverkauf des Landes). */
  effMinStufe1: number | null;
  effMinStufe2: number | null;
  /** Gewünschter Min unter effektivem Min ohne Regelwechsel (Buy Box darüber/unbekannt, Schnelldreher). */
  keinWechsel: "buybox_ueber" | "buybox_unbekannt" | "schnelldreher" | null;
  /** B31.8: Break-even + Schnelldreher-Boden (7 %) – auch für Kandidaten (Listing-Check Befund 1). */
  bodenSchnell: number | null;
  /** B31.7: Zustand der Ware, Zielpreis und Min gebraucht. */
  zustand: Zustand;
  zustandQuelle: ZustandQuelle;
  zielpreis: number | null;
  zielpreisQuelle: string | null;
  minGebraucht: number | null;
  /** B31.8: Schnelldreher – Boden Break-even + 7 %, Leiter gesperrt. */
  schnelldreher: boolean;
  boden: number | null;
  /** Bestand FBA (verkaufbar + reserviert + unterwegs) + eigenes Lager (FBM). */
  bestand: number;
  /** FBA-Gebühr und Provision (für Vergleiche, z. B. eBay). */
  fba: number;
  provision: number;
};

export type LandVorschau = { land: ExportLand; zeilen: VorschauZeile[]; neu: number; geaendert: number; gleich: number; regelWechsel: number; mitWarnung: number; istStand: Date | null; vergleichMit: "bqool" | "export" | "nichts" };

export type BqoolVorschau = {
  laender: LandVorschau[];
  ekFehlt: { land: ExportLand; sku: string; titel: string | null }[];
  /** B31.7: Zustand unbekannt – kein automatischer Preis, nicht in der Datei (Aufgabe „Zustand prüfen“). */
  zustandUnbekannt: { land: ExportLand; sku: string; titel: string | null }[];
  vorschlaege: { sku: string; titel: string | null; reichweite: number | null; kapital: number | null }[];
  abgleich: AbgleichFall[];
  format: { ausVorlage: boolean };
  letzterExport: { id: string; am: Date; anzahl: Record<string, number> } | null;
};

function format(s: Awaited<ReturnType<typeof getSettings>>): BqoolFormat {
  return s.bqool.format ? { ...FORMAT_STANDARD, ...s.bqool.format, channel: { ...FORMAT_STANDARD.channel, ...s.bqool.format.channel } } : FORMAT_STANDARD;
}

/** BQool-Repricing-Datei (eigene Vorlage „Listings_…txt“ oder ArbitrageOne-Datei) als Ist-Stand eines Landes speichern. */
export async function bqoolDateiEinlesen(tenantId: string, name: string, bytes: Uint8Array, o: { /** B31.2: Land fest (Export-Seite je Land), sonst aus Dateiname/Channel. */ land?: ExportLand; ohneAbgleich?: boolean; via?: "upload" | "automatik" } = {}): Promise<{ ok: boolean; message: string; land: ExportLand | null; skus?: number }> {
  const text = new TextDecoder("utf-8").decode(bytes);
  const r = liesBqoolDatei(text, name);
  const land = o.land ?? r.land;
  if (!land) return { ok: false, message: "Land der BQool-Datei nicht erkennbar (Channel „Amazon DE/FR/IT/ES“ fehlt).", land: null };
  const now = new Date();
  const zeilen = [...new Map(r.zeilen.map((z) => [z.sku, z])).values()];
  await db.transaction(async (tx) => {
    const skus = zeilen.map((z) => z.sku);
    // Die Datei enthält alle Angebote des Landes – was fehlt, ist bei BQool nicht (mehr) gelistet.
    await tx.delete(L).where(and(eq(L.tenantId, tenantId), eq(L.marktplatz, land), skus.length ? notInArray(L.sku, skus) : sql`true`));
    for (let i = 0; i < zeilen.length; i += 500) {
      const teil = zeilen.slice(i, i + 500).map((z) => ({ tenantId, marktplatz: land, sku: z.sku, regel: z.regel || null, min: z.min, max: z.max, status: z.enable === "1" ? "aktiv" : "pausiert", zusatz: { cost: z.cost !== null ? String(z.cost) : "", enable: z.enable }, datei: name.slice(0, 200), eingelesenAm: now, regelSeit: now }));
      await tx
        .insert(L)
        .values(teil)
        .onConflictDoUpdate({ target: [L.tenantId, L.marktplatz, L.sku], set: { regelSeit: sql`case when ${L.regel} is distinct from excluded.regel then excluded.eingelesen_am else coalesce(${L.regelSeit}, excluded.eingelesen_am) end`, regel: sql`excluded.regel`, min: sql`excluded.min`, max: sql`excluded.max`, status: sql`excluded.status`, zusatz: sql`${L.zusatz} || excluded.zusatz`, datei: sql`excluded.datei`, eingelesenAm: sql`excluded.eingelesen_am` } });
    }
  });
  await db.insert(schema.reportImports).values({ tenantId, reportType: "BQool Repricing-Datei", fileName: name.slice(0, 200), via: o.via === "automatik" ? "api" : "upload", rows: r.zeilen.length, inserted: zeilen.length, message: land });
  const regeln = new Map<string, number>();
  for (const z of zeilen) regeln.set(z.regel || "–", (regeln.get(z.regel || "–") ?? 0) + 1);
  if (!o.ohneAbgleich) await bqoolAbgleichAufgabe(tenantId).catch(() => undefined);
  // B31.6: Liquidation im Ist erkannt → aktiv (Verlust-Stopp-Ausnahme), Test „bleibt stehen“
  await import("./liquidation").then((x) => x.liquidationIstAbgleich(tenantId)).catch(() => undefined);
  return { ok: true, land, skus: zeilen.length, message: `BQool ${land}: ${zeilen.length} SKUs als Ist-Stand übernommen (${[...regeln.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}).` };
}

async function istStand(tenantId: string, laender: ExportLand[]) {
  const rows = await db.select().from(L).where(and(eq(L.tenantId, tenantId), inArray(L.marktplatz, laender)));
  const je = new Map<string, typeof rows>();
  for (const r of rows) je.set(r.marktplatz, [...(je.get(r.marktplatz) ?? []), r]);
  return je;
}

export async function bqoolVorschau(tenantId: string, o: { laender?: ExportLand[]; heute?: string } = {}): Promise<BqoolVorschau> {
  const s = await getSettings(tenantId);
  const b = s.bqool;
  const laender = (o.laender?.length ? o.laender : b.laender).filter((l): l is ExportLand => (EXPORT_LAENDER as readonly string[]).includes(l));
  const heute = o.heute ?? todayIso();
  const [rows, zuw, ist, letzter, hochgeladen, liqRows] = await Promise.all([
    repricerRows(tenantId),
    db.select().from(Z).where(eq(Z.tenantId, tenantId)),
    istStand(tenantId, laender),
    db.select().from(E).where(eq(E.tenantId, tenantId)).orderBy(desc(E.createdAt)).limit(1),
    // B31: zuletzt bei BQool hochgeladene Exporte (für den Vergleich, wenn der Ist danach nicht neu geholt wurde)
    db.select({ createdAt: E.createdAt, zeilen: E.zeilen, protokoll: E.protokoll }).from(E).where(and(eq(E.tenantId, tenantId), inArray(E.uebertragung, ["fertig", "teilweise", "pruefen"]))).orderBy(desc(E.createdAt)).limit(20),
    db.select().from(LQ).where(eq(LQ.tenantId, tenantId)),
  ]);
  // B31.7/B31.8: Zustand (von Hand, Berichte, Retouren-Station, Einkauf) und Schnelldreher je SKU
  const [zustandRows, pflegeRows, chargen, invZustand, station] = await Promise.all([
    db.select().from(schema.artikelZustand).where(eq(schema.artikelZustand.tenantId, tenantId)),
    db.select().from(schema.bqoolSkuPflege).where(eq(schema.bqoolSkuPflege.tenantId, tenantId)),
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
  // B31.6: Liquidation wegen Min unter Marge – Regel vorher, Verlust-Freigabe; Test vor dem ersten Regelwechsel
  const liqJe = new Map(liqRows.filter((l) => l.status !== "beendet" || l.verlustBis !== null).map((l) => [`${l.land}|${l.sku}`, l]));
  const liqName = liquidationsName(b.katalog);
  const testBestanden = !!b.liquidationTest?.bestanden;
  const skus = rows.map((r) => r.sku);
  const asins = [...new Set(rows.map((r) => r.asin).filter((a): a is string => !!a))];
  const [alter, keepa, listungen] = await Promise.all([
    skus.length ? db.select({ sku: schema.amazonLageralter.sku, alter: schema.amazonLageralter.alter }).from(schema.amazonLageralter).where(and(eq(schema.amazonLageralter.tenantId, tenantId), inArray(schema.amazonLageralter.sku, skus))) : [],
    asins.length ? db.select({ asin: schema.keepaCache.asin, mp: schema.keepaCache.marktplatz, stand: schema.keepaCache.stand }).from(schema.keepaCache).where(and(eq(schema.keepaCache.tenantId, tenantId), inArray(schema.keepaCache.asin, asins), inArray(schema.keepaCache.marktplatz, laender))) : [],
    db.select({ land: schema.amazonListungen.land, sku: schema.amazonListungen.sku }).from(schema.amazonListungen).where(and(eq(schema.amazonListungen.tenantId, tenantId), inArray(schema.amazonListungen.land, laender))),
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
  const f = format(s);
  const ekFehlt: BqoolVorschau["ekFehlt"] = [];
  const zustandUnbekannt: BqoolVorschau["zustandUnbekannt"] = [];
  const soll = new Map<string, string>();

  const ergebnis: LandVorschau[] = laender.map((land) => {
    const istRows = ist.get(land) ?? [];
    const istJe = new Map(istRows.map((r) => [r.sku, r]));
    const bqoolSkus = istRows.length ? new Set(istRows.map((r) => r.sku)) : null;
    const listSkus = gelistet.get(land) ?? null;
    const kandidaten = rows.filter((r) => (bqoolSkus ? bqoolSkus.has(r.sku) : listSkus ? listSkus.has(r.sku) : true));
    const zeilen: VorschauZeile[] = [];
    for (const r of kandidaten) {
      if (r.unitCost === null || r.unitCost <= 0.011) {
        ekFehlt.push({ land, sku: r.sku, titel: r.title });
        continue;
      }
      const i = istJe.get(r.sku);
      const key = `${land}|${r.sku}`;
      // B31.7: Zustand – gebrauchte Ware bekommt eigenen Zielpreis/Min, unbekannt kommt nicht in die Datei
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
      const gebraucht = istGebraucht(zb.zustand);
      const pf = pflegeJe.get(key);
      const schnelldreher = !!pf?.schnelldreher && !gebraucht;
      const abvRegel = abverkaufFuer(land, b.abverkaufRegel);
      let rf = regelFuer({ land, titel: r.title, asin: r.asin, zuweisung: zuwJe.get(key) ?? null, markenRegeln: b.markenRegeln, aufAbverkaufsListe: b.elektronikLaender.includes(land) && b.elektronikMarken.some((m) => titelHatMarke(r.title, m)), abverkaufRegel: b.abverkaufRegel, standard: b.standardRegel, ist: i ? { regel: i.regel, min: i.min } : null, katalog: b.katalog });
      // B31.7c: Gebrauchte laufen nicht mit ia (Neupreis-Marge), sondern mit Abverkauf (Stufe 2), außer schon Liquidation.
      if (gebraucht && stufeVonRegel(rf.regel, b.katalog, b.abverkaufRegel) === 1 && rf.quelle !== "zuweisung") rf = { ...rf, regel: abvRegel };
      // B31.8: eigene BQool-Regel für Schnelldreher (Einstellung), sonst bleibt die Regel und der Boden steht als Min in der Datei.
      if (schnelldreher && leiter.schnell.regel && katalogRegel(b.katalog, leiter.schnell.regel) && rf.quelle !== "zuweisung") rf = { ...rf, regel: leiter.schnell.regel };
      const kat = katalogRegel(b.katalog, rf.regel);
      const kosten = { ek: r.unitCost, fba: r.fbaFee, fix: b.fixGebuehr, zusatz: b.zusatzkosten, ust: UST[land], provision: r.referralRate };
      const alterTage = alterJe.get(r.sku) ?? null;
      const be0 = breakEvenMin({ ...kosten, margeProzent: 0 });
      const eff = effektiverMin({ regel: kat, untergrenze: rf.untergrenze, ...kosten, alterTage });
      const effMinStufe1 = effektiverMin({ regel: katalogRegel(b.katalog, b.standardRegel), untergrenze: null, ...kosten, alterTage }).min;
      const effMinStufe2 = effektiverMin({ regel: katalogRegel(b.katalog, abvRegel), untergrenze: null, ...kosten, alterTage }).min;
      const liq = liqJe.get(key) ?? null;
      const k = r.asin ? keepaJe.get(`${r.asin}|${land}`) : null;
      const neuBuybox = i?.buyboxPreis ?? k?.aktuell?.buybox ?? null;
      // Gebraucht: Zielpreis aus Keepa-Gebrauchtpreis bzw. Neupreis × Faktor; Min gebraucht = Break-even + Mindestmarge
      const ziel = gebraucht ? zielpreisGebraucht({ zustand: zb.zustand, keepa: k?.aktuell?.gebraucht ?? null, neuBuybox, faktoren: leiter.zustand.faktoren }) : { preis: null, quelle: null as string | null };
      const minGebraucht = gebraucht ? breakEvenMin({ ...kosten, margeProzent: leiter.zustand.mindestmarge }) : null;
      const buybox = gebraucht ? (ziel.preis ?? neuBuybox) : neuBuybox;
      const bodenSchnell = breakEvenMin({ ...kosten, margeProzent: leiter.schnell.margeBoden });
      const boden = schnelldreher ? bodenSchnell : null;
      // B31.6: Min unter dem effektiven Min der Margen-Regel wirkt nur mit „Liquidation“ (fester Min, nie unter Break-even
      // ohne Freigabe) – und nur, wenn die Buy Box darunter liegt (B31.6b); sonst Min = effektiver Min (Sicherheitsnetz).
      const gewuenscht = gebraucht && rf.quelle !== "zuweisung" && !kat?.festeUntergrenze ? minGebraucht : rf.untergrenze;
      const ent = minEntscheidung({ regelName: rf.regel, regel: kat, gewuenscht, effMin: eff.min, breakEven: be0, verlustBis: liq?.verlustBis ?? null, liquidation: liqName, buybox, boden, schnelldreher, laeuft: !!liq && liq.grund !== "hand" && (liq.status === "aktiv" || liq.status === "zurueck_vorgeschlagen") });
      if (ent.min === null) continue;
      const min = ent.min;
      soll.set(key, ent.regel);
      const regelVorher = ent.regelVorher ?? (liq && liq.grund !== "hand" ? liq.regelVorher : null);
      const effMinVorher = ent.art === "liquidation_neu" ? eff.min : regelVorher ? effektiverMin({ regel: katalogRegel(b.katalog, regelVorher), untergrenze: null, ...kosten, alterTage }).min : null;
      const bb90 = k?.kennzahlen?.["90"]?.buybox?.schnitt ?? null;
      const max0 = gebraucht && ziel.preis ? Math.max(Math.round(ziel.preis * leiter.zustand.maxFaktor * 100) / 100, Math.round(min * 1.05 * 100) / 100) : maxPreis({ min, bb90, faktor: b.maxFaktor, listenpreis: null, ersatzFaktor: s.pricing.maxPriceFactor });
      // B32 Befund 5: Max nach Freigabe („Max anheben“), nie unter Min + 5 %
      const max = pf?.maxSoll ? Math.max(pf.maxSoll, Math.round(min * 1.05 * 100) / 100) : max0;
      // B31.7c: pausiertes Angebot nach Freigabe aktivieren
      const enable = pf?.aktivieren ? "1" : (i?.zusatz as Record<string, string> | undefined)?.enable || (i?.status === "aktiv" ? "1" : i?.status === "pausiert" ? "0" : f.enable);
      const w = warnungen({ min: ent.art === "marge" ? (eff.min ?? min) : min, max }, { buybox, breakEven: null });
      if (!kat) w.push(`Regel „${rf.regel}“ steht nicht im Katalog`);
      const f2 = (n: number | null) => (n === null ? "–" : n.toFixed(2));
      if (ent.angehoben) w.push(`Gewünschter Min ${f2(gewuenscht)} unter Break-even ${f2(be0)} – auf Break-even angehoben (Abverkauf mit Verlust nicht freigegeben)`);
      if (ent.unterBreakEven) w.push(ent.verlustFreigegeben ? `Min ${f2(min)} unter Break-even ${f2(be0)} – Abverkauf mit Verlust freigegeben bis ${f2(liq?.verlustBis ?? null)} € je Stück` : `Min ${f2(min)} unter Break-even ${f2(be0)} – nicht freigegeben („Verlust akzeptiert bis“ setzen oder Min anheben)`);
      if (ent.keinWechsel === "buybox_ueber") w.push(`Gewünschter Min ${f2(gewuenscht)} unter effektivem Min ${f2(eff.min)} – kein Regelwechsel, die Buy Box ${f2(buybox)} liegt darüber (Min = effektiver Min genügt)`);
      if (ent.keinWechsel === "buybox_unbekannt") w.push(`Gewünschter Min ${f2(gewuenscht)} unter effektivem Min ${f2(eff.min)} – kein Regelwechsel ohne bekannte Buy Box (Min = effektiver Min)`);
      if (ent.keinWechsel === "schnelldreher") w.push(`Schnelldreher: kein Regelwechsel, Min mindestens Break-even + ${leiter.schnell.margeBoden} % (${f2(boden)})`);
      if (gebraucht && ziel.preis !== null && be0 !== null && ziel.preis < be0 - 0.005) w.push(`Verlust – Entscheidung: Zielpreis gebraucht ${f2(ziel.preis)} unter Break-even ${f2(be0)}`);
      const istFest = !!katalogRegel(b.katalog, i?.regel)?.festeUntergrenze;
      // Regelwechsel auf Liquidation durch das System (Min unter Marge, Leiter) wartet auf den Test mit einer SKU.
      const wartetAufTest = !testBestanden && !istFest && (ent.art === "liquidation_neu" || (ent.art === "liquidation" && rf.quelle === "zuweisung" && (zuwJe.get(key)?.quelle as string) === "leiter"));
      if (wartetAufTest) w.push("Regelwechsel auf Liquidation wartet auf den Test mit einer SKU – noch nicht in der Datei");
      const blockiert = minBlockiertBuybox({ istMin: i?.min ?? null, effMin: eff.min, buybox });
      if (blockiert) w.push(blockiert);
      // B25.5: In BQool steht für die SKU kein Mindestpreis – ohne Upload bepreist BQool ohne Untergrenze.
      if (i && (i.min === null || i.min === undefined || i.min <= 0)) w.push("kein Min in BQool – erst mit diesem Upload abgesichert");
      const inv = invJe.get(r.sku);
      zeilen.push({ land, sku: r.sku, cost: bqoolCost(r.unitCost, b.costUst), zusatz: b.zusatzkosten, regel: ent.regel, min, max, enable, titel: r.title, asin: r.asin, quelle: rf.quelle, effMin: eff.min, marge: eff.marge, buybox, istRegel: i?.regel ?? null, istMin: i?.min ?? null, erklaerung: ent.art === "liquidation_neu" ? `Min ${f2(gewuenscht)} unter effektivem Min ${f2(eff.min)} (${rf.regel}) und Buy Box ${f2(buybox)} darunter – wirkt nur mit „${liqName}“: Regelwechsel, Min fest ${f2(min)}` : buyboxErklaerung({ buybox, effMin: eff.min, unterregel: eff.unterregel }), warnungen: w, art: "neu", regelWechsel: false, minDiff: null, liquidation: ent.art === "liquidation_neu" ? "neu" : ent.art === "liquidation" ? "ja" : null, regelVorher, breakEven: be0, margeNeu: margeBeiPreis({ preis: min, ...kosten }), effMinVorher, wartetAufTest, verlustBis: liq?.verlustBis ?? null, minGewuenscht: gewuenscht, regelSeit: i?.regelSeit ?? null, stufe: stufeVonRegel(ent.regel, b.katalog, b.abverkaufRegel), istStufe: stufeVonRegel(i?.regel ?? null, b.katalog, b.abverkaufRegel), alterTage, effMinStufe1, effMinStufe2, keinWechsel: ent.keinWechsel, zustand: zb.zustand, zustandQuelle: zb.quelle, zielpreis: ziel.preis, zielpreisQuelle: ziel.quelle, minGebraucht, schnelldreher, boden, bodenSchnell, bestand: r.stock + (inv?.mfn ?? 0), fba: r.fbaFee, provision: r.referralRate });
    }
    // Vergleich: hochgeladener BQool-Stand, sonst letzter eigener Export.
    const vergleichMit: LandVorschau["vergleichMit"] = istRows.length ? "bqool" : letzteZeilen.some((z) => z.land === land) ? "export" : "nichts";
    const istMap = new Map<string, IstStand>(
      vergleichMit === "bqool"
        ? istRows.map((x) => [x.sku, { regel: x.regel, min: x.min, max: x.max, cost: (x.zusatz as Record<string, string>)?.cost ? Number((x.zusatz as Record<string, string>).cost) : undefined }])
        : letzteZeilen.filter((z) => z.land === land).map((z) => [z.sku, { regel: z.regel, min: z.min, max: z.max, cost: z.cost }]),
    );
    // B31: Ist älter als ein erfolgreicher Upload dieses Landes (Export-Seite fehlt, Abruf fehlgeschlagen) → für die SKUs
    // der hochgeladenen Datei gilt deren Stand; sonst meldete der nächste Lauf dieselben Änderungen noch einmal.
    if (vergleichMit === "bqool") {
      const istAm = istRows.reduce<Date | null>((m, x) => (!m || x.eingelesenAm > m ? x.eingelesenAm : m), null);
      for (const ex of [...hochgeladen].reverse()) {
        if (istAm && ex.createdAt <= istAm) continue;
        if (!ex.protokoll.some((p) => p.land === land && (p.ok || p.unklar))) continue;
        for (const z of ex.zeilen) if (z.land === land) istMap.set(z.sku, { regel: z.regel, min: z.min, max: z.max, cost: z.cost });
      }
    }
    const v = new Map(vergleiche(zeilen, istMap).map((a) => [a.sku, a]));
    for (const z of zeilen) {
      const a = v.get(z.sku)!;
      z.art = a.art;
      z.regelWechsel = a.regelWechsel;
      z.minDiff = a.minDiff;
    }
    zeilen.sort((a, b) => Number(b.warnungen.length > 0) - Number(a.warnungen.length > 0) || Math.abs(b.minDiff ?? 0) - Math.abs(a.minDiff ?? 0) || a.sku.localeCompare(b.sku));
    const stand = istRows.reduce<Date | null>((m, x) => (!m || x.eingelesenAm > m ? x.eingelesenAm : m), null);
    return { land, zeilen, neu: zeilen.filter((z) => z.art === "neu").length, geaendert: zeilen.filter((z) => z.art === "geaendert").length, gleich: zeilen.filter((z) => z.art === "gleich").length, regelWechsel: zeilen.filter((z) => z.regelWechsel).length, mitWarnung: zeilen.filter((z) => z.warnungen.length).length, istStand: stand, vergleichMit };
  });

  // Vorschläge der Kapital-Ampel (Rot + Reichweite > Grenze) → „Abverkauf“, nur nach Freigabe.
  let vorschlaege: BqoolVorschau["vorschlaege"] = [];
  try {
    const { kapitalAmpel } = await import("@/lib/money/kapital-service");
    const k = await kapitalAmpel(tenantId, heute);
    const offen = new Set(zuw.map((z) => z.sku));
    vorschlaege = k.zeilen.filter((z) => abverkaufVorschlagen(z, s.kapital.rotReichweite) && !offen.has(z.sku)).map((z) => ({ sku: z.sku, titel: z.name, reichweite: z.reichweite, kapital: z.kapital }));
  } catch {
    vorschlaege = [];
  }
  const istAlle = [...ist.entries()].flatMap(([land, rs]) => rs.map((r) => ({ land: land as ExportLand, sku: r.sku, regel: r.regel })));
  // B31.6: Liquidation wegen Min unter Marge steht gesondert in der Freigabe – im Abgleich „Ist ≠ Soll“ nicht melden.
  const liqMarge = new Set([...ergebnis.flatMap((l) => l.zeilen.filter((z) => z.liquidation === "neu").map((z) => `${z.land}|${z.sku}`)), ...liqRows.filter((l) => l.grund === "min_unter_marge" && l.status !== "beendet").map((l) => `${l.land}|${l.sku}`)]);
  return {
    laender: ergebnis,
    ekFehlt,
    zustandUnbekannt,
    vorschlaege,
    abgleich: abgleich(istAlle, soll, b.katalog).filter((f) => !((f.art === "liquidation_soll" || f.art === "liquidation_ist") && liqMarge.has(`${f.land}|${f.sku}`))),
    format: { ausVorlage: f.ausVorlage },
    letzterExport: letzter[0] ? { id: letzter[0].id, am: letzter[0].createdAt, anzahl: letzter[0].anzahl } : null,
  };
}

/** Export erzeugen und speichern (Download je Land / ZIP). Nur Änderungen = neue und geänderte Zeilen. */
export async function bqoolExportErzeugen(tenantId: string, userId: string | null, o: { laender?: ExportLand[]; nurAenderungen: boolean; /** B31.6: nur diese „Land|SKU“ (Test einer SKU mit Liquidation). */ nurSkus?: string[] }): Promise<{ id: string; anzahl: Record<string, number>; zusammenfassung: BqoolLaufZusammenfassung }> {
  const v = await bqoolVorschau(tenantId, { laender: o.laender });
  const nur = o.nurSkus?.length ? new Set(o.nurSkus) : null;
  // B31.6: Regelwechsel auf Liquidation erst nach bestandenem Test mit einer SKU – außer im Test-Export selbst.
  const gewaehlt = v.laender.flatMap((l) => l.zeilen.filter((z) => (nur ? nur.has(`${z.land}|${z.sku}`) : (!o.nurAenderungen || z.art !== "gleich") && !z.wartetAufTest)));
  const zeilen = gewaehlt.map((z) => ({ land: z.land, sku: z.sku, cost: z.cost, zusatz: z.zusatz, regel: z.regel, min: z.min, max: z.max, enable: z.enable }));
  const anzahl = Object.fromEntries(v.laender.map((l) => [l.land, zeilen.filter((z) => z.land === l.land).length]));
  // B31.2: Zusammenfassung für Freigabe-Push und „automatisch hochladen“ (nur über die Zeilen der Datei).
  const zusammenfassung: BqoolLaufZusammenfassung = {
    jeLand: anzahl,
    gesamt: zeilen.length,
    regelWechsel: gewaehlt.filter((z) => z.regelWechsel).length,
    warnungen: gewaehlt.filter((z) => z.warnungen.length).length,
    unterBreakEven: gewaehlt.filter((z) => z.warnungen.some((w) => /unter Break-even/i.test(w))).length,
    liquidation: gewaehlt.filter((z) => z.liquidation === "neu" && z.regelWechsel).length,
  };
  const [e] = await db.insert(E).values({ tenantId, userId, laender: v.laender.map((l) => l.land), nurAenderungen: o.nurAenderungen, zeilen, anzahl }).returning({ id: E.id });
  // B31.6: Regel vor Liquidation merken (Vorschlag, aktiv erst, wenn BQool-Ist Liquidation + Min zeigt).
  for (const z of gewaehlt.filter((x) => x.liquidation === "neu")) {
    const werte = { grund: "min_unter_marge" as const, regelVorher: z.regelVorher, minGewuenscht: z.minGewuenscht, minGesetzt: z.min, effMinVorher: z.effMinVorher, breakEven: z.breakEven, updatedAt: new Date() };
    await db
      .insert(LQ)
      .values({ tenantId, land: z.land, sku: z.sku, ...werte, status: "vorgeschlagen" })
      .onConflictDoUpdate({ target: [LQ.tenantId, LQ.land, LQ.sku], set: { ...werte, status: sql`case when ${LQ.status} = 'beendet' then 'vorgeschlagen' else ${LQ.status} end`, beendetAm: sql`case when ${LQ.status} = 'beendet' then null else ${LQ.beendetAm} end` } });
  }
  return { id: e.id, anzahl, zusammenfassung };
}

/** Dateien eines Exports: je Land eine .txt im BQool-Format. */
export async function bqoolExportDateien(tenantId: string, id: string): Promise<{ name: string; text: string; land: ExportLand }[] | null> {
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) return null;
  const f = format(await getSettings(tenantId));
  const datum = e.createdAt.toISOString().slice(0, 10);
  return (e.laender as ExportLand[]).map((land) => ({ land, name: `BQool_${land}_${datum}${e.nurAenderungen ? "_Aenderungen" : ""}.txt`, text: bqoolDatei(land, e.zeilen.filter((z) => z.land === land).map((z) => ({ ...z, land })), f) }));
}

export async function bqoolExporte(tenantId: string, limit = 10) {
  return db.select({ id: E.id, laender: E.laender, nurAenderungen: E.nurAenderungen, anzahl: E.anzahl, uebertragung: E.uebertragung, protokoll: E.protokoll, createdAt: E.createdAt }).from(E).where(eq(E.tenantId, tenantId)).orderBy(desc(E.createdAt)).limit(limit);
}

// ---- Soll-Regeln pflegen ----------------------------------------------------------------------------------------

export async function zuweisungSetzen(tenantId: string, z: { land: ExportLand; sku: string; regel: string; untergrenze: number | null; quelle: Zuweisung["quelle"]; freigegeben?: boolean; grund?: string | null }) {
  const sku = z.sku.trim();
  if (!sku || !z.regel.trim()) throw new Error("SKU und Regel angeben.");
  const werte = { regel: z.regel.trim(), untergrenze: z.untergrenze, quelle: z.quelle, freigegeben: z.freigegeben ?? true, grund: z.grund ?? null, updatedAt: new Date() };
  await db.insert(Z).values({ tenantId, land: z.land, sku, ...werte }).onConflictDoUpdate({ target: [Z.tenantId, Z.land, Z.sku], set: werte });
}

export async function zuweisungLoeschen(tenantId: string, land: string, sku: string) {
  await db.delete(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.land, land), eq(Z.sku, sku)));
}

export async function zuweisungen(tenantId: string) {
  return db.select().from(Z).where(eq(Z.tenantId, tenantId)).orderBy(Z.regel, Z.sku, Z.land);
}

/** Kapital-Vorschlag freigeben: SKU in den gewählten Ländern auf „Abverkauf“ (DE „Abverkauf DE“). */
export async function vorschlagFreigeben(tenantId: string, sku: string, laender?: ExportLand[]) {
  const s = await getSettings(tenantId);
  for (const land of laender?.length ? laender : s.bqool.laender) {
    await zuweisungSetzen(tenantId, { land, sku, regel: land === "DE" ? s.bqool.abverkaufRegel.DE : s.bqool.abverkaufRegel.sonst, untergrenze: null, quelle: "kapital", grund: "Kapital-Ampel rot, Reichweite über Grenze" });
  }
}

/**
 * Listen aus dem BQool-Ist übernehmen: Liquidation (mit Min als feste Untergrenze) und andere Nicht-Standard-Regeln
 * aus dem Katalog (Abverkauf …) werden Soll-Zuweisungen. Von Hand gepflegte Zuweisungen bleiben unangetastet.
 */
export async function istAlsSollUebernehmen(tenantId: string): Promise<{ liquidation: number; andere: number }> {
  const s = await getSettings(tenantId);
  const ist = await db.select().from(L).where(eq(L.tenantId, tenantId));
  const hand = new Set((await db.select({ land: Z.land, sku: Z.sku }).from(Z).where(and(eq(Z.tenantId, tenantId), eq(Z.quelle, "hand")))).map((x) => `${x.land}|${x.sku}`));
  let liquidation = 0;
  let andere = 0;
  for (const r of ist) {
    const kat = katalogRegel(s.bqool.katalog, r.regel);
    if (!kat || kat.risiko || kat.name.toLowerCase() === s.bqool.standardRegel.toLowerCase() || hand.has(`${r.marktplatz}|${r.sku}`)) continue;
    if (!(EXPORT_LAENDER as readonly string[]).includes(r.marktplatz)) continue;
    await zuweisungSetzen(tenantId, { land: r.marktplatz as ExportLand, sku: r.sku, regel: kat.name, untergrenze: kat.festeUntergrenze ? r.min : null, quelle: "vorlage", grund: `aus BQool ${r.datei ?? ""}`.trim() });
    if (kat.festeUntergrenze) liquidation++;
    else andere++;
  }
  return { liquidation, andere };
}

/** Abgleich Ist ↔ Soll als Aufgabe (Kategorie Amazon); ohne Abweichungen erledigt. */
export async function bqoolAbgleichAufgabe(tenantId: string): Promise<number> {
  const v = await bqoolVorschau(tenantId);
  const n = v.abgleich.length;
  if (!n) {
    await resolveSystemTask(db, tenantId, "bqool-abgleich");
    return 0;
  }
  const arten = new Map<string, number>();
  for (const f of v.abgleich) arten.set(f.art, (arten.get(f.art) ?? 0) + 1);
  const text: Record<string, string> = { unbekannte_regel: "Regel nicht im Katalog", ohne_regel: "ohne Regel", risiko_regel: "Regel ohne Untergrenze (mbb)", liquidation_soll: "Soll Liquidation, BQool anders", liquidation_ist: "BQool Liquidation, Soll anders" };
  await upsertSystemTask(db, tenantId, "bqool-abgleich", {
    title: `BQool-Abgleich: ${n} Abweichung${n === 1 ? "" : "en"}`,
    notes: [...arten.entries()].map(([k, x]) => `${text[k] ?? k}: ${x}`).join(" · ") + "\nRegeln in BQool selbst anpassen – das System ändert keine BQool-Regeln.",
    category: "amazon",
    link: "/repricer/bqool",
  });
  return n;
}

/** BQool-Einstellungen ändern (Repricer → Regeln): nur die genannten Felder. */
export async function bqoolEinstellungenSpeichern(tenantId: string, patch: NonNullable<TenantSettings["bqool"]>) {
  const [t] = await db.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const alt = t?.settings ?? {};
  await db
    .update(schema.tenants)
    .set({ settings: { ...alt, bqool: { ...(alt.bqool ?? {}), ...patch } } })
    .where(eq(schema.tenants.id, tenantId));
}

/**
 * Ein BQool-Upload, den die Automatik nicht bestätigen konnte (oder als Fehler gemeldet hat), von Hand als
 * hochgeladen bestätigen – z. B. nach einem Blick in BQool. Nichts wird gelöscht: der Eintrag bekommt „von Hand
 * bestätigt“, ein Vermerk kommt ins Protokoll, der Status wird neu berechnet; ist alles hochgeladen, wird die Aufgabe erledigt.
 */
export async function bqoolUploadBestaetigen(tenantId: string, exportId: string, land: string, zeit: string, wer: string): Promise<boolean> {
  const { bqoolStatusAusProtokoll, zeilenText } = await import("@/lib/automatik/bqool-logic");
  const E = schema.bqoolExporte;
  const [e] = await db.select({ protokoll: E.protokoll }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, exportId)));
  if (!e) return false;
  const i = e.protokoll.findIndex((p) => p.land === land && p.zeit === zeit && !p.ok);
  if (i < 0) return false;
  const jetzt = new Date().toISOString();
  const alt = e.protokoll[i];
  const neu = [...e.protokoll];
  neu[i] = { ...alt, ok: true, unklar: undefined, vonHand: { von: wer, am: jetzt }, text: `${land}: ${alt.datei ?? ""} – ${zeilenText(alt.zeilen ?? 0)} hochgeladen (von Hand bestätigt)` };
  neu.push({ zeit: jetzt, text: `${land}: von Hand als hochgeladen bestätigt (${wer}) – vorher: ${alt.text.replace(/^[A-Z]{2}: /, "").slice(0, 160)}` });
  const status = bqoolStatusAusProtokoll(neu);
  await db.update(E).set({ protokoll: neu, ...(status ? { uebertragung: status } : {}) }).where(and(eq(E.tenantId, tenantId), eq(E.id, exportId)));
  if (status === "fertig") await resolveSystemTask(db, tenantId, `automatik-bqool-${exportId}`);
  return true;
}
