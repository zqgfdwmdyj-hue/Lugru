import "server-only";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import type { KeepaStand } from "@/lib/keepa/auswertung";
import { aeltesteTage } from "@/lib/money/kapital";
import { repricerRows } from "@/lib/repricer";
import type { TenantSettings } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import {
  abgleich,
  abverkaufVorschlagen,
  buyboxErklaerung,
  bqoolCost,
  bqoolDatei,
  breakEvenMin,
  dateiMin,
  effektiverMin,
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
};

export type LandVorschau = { land: ExportLand; zeilen: VorschauZeile[]; neu: number; geaendert: number; gleich: number; regelWechsel: number; mitWarnung: number; istStand: Date | null; vergleichMit: "bqool" | "export" | "nichts" };

export type BqoolVorschau = {
  laender: LandVorschau[];
  ekFehlt: { land: ExportLand; sku: string; titel: string | null }[];
  vorschlaege: { sku: string; titel: string | null; reichweite: number | null; kapital: number | null }[];
  abgleich: AbgleichFall[];
  format: { ausVorlage: boolean };
  letzterExport: { id: string; am: Date; anzahl: Record<string, number> } | null;
};

function format(s: Awaited<ReturnType<typeof getSettings>>): BqoolFormat {
  return s.bqool.format ? { ...FORMAT_STANDARD, ...s.bqool.format, channel: { ...FORMAT_STANDARD.channel, ...s.bqool.format.channel } } : FORMAT_STANDARD;
}

/** BQool-Repricing-Datei (eigene Vorlage „Listings_…txt“ oder ArbitrageOne-Datei) als Ist-Stand eines Landes speichern. */
export async function bqoolDateiEinlesen(tenantId: string, name: string, bytes: Uint8Array): Promise<{ ok: boolean; message: string; land: ExportLand | null }> {
  const text = new TextDecoder("utf-8").decode(bytes);
  const r = liesBqoolDatei(text, name);
  if (!r.land) return { ok: false, message: "Land der BQool-Datei nicht erkennbar (Channel „Amazon DE/FR/IT/ES“ fehlt).", land: null };
  const land = r.land;
  const now = new Date();
  const zeilen = [...new Map(r.zeilen.map((z) => [z.sku, z])).values()];
  await db.transaction(async (tx) => {
    const skus = zeilen.map((z) => z.sku);
    // Die Datei enthält alle Angebote des Landes – was fehlt, ist bei BQool nicht (mehr) gelistet.
    await tx.delete(L).where(and(eq(L.tenantId, tenantId), eq(L.marktplatz, land), skus.length ? notInArray(L.sku, skus) : sql`true`));
    for (let i = 0; i < zeilen.length; i += 500) {
      const teil = zeilen.slice(i, i + 500).map((z) => ({ tenantId, marktplatz: land, sku: z.sku, regel: z.regel || null, min: z.min, max: z.max, status: z.enable === "1" ? "aktiv" : "pausiert", zusatz: { cost: z.cost !== null ? String(z.cost) : "", enable: z.enable }, datei: name.slice(0, 200), eingelesenAm: now }));
      await tx
        .insert(L)
        .values(teil)
        .onConflictDoUpdate({ target: [L.tenantId, L.marktplatz, L.sku], set: { regel: sql`excluded.regel`, min: sql`excluded.min`, max: sql`excluded.max`, status: sql`excluded.status`, zusatz: sql`${L.zusatz} || excluded.zusatz`, datei: sql`excluded.datei`, eingelesenAm: sql`excluded.eingelesen_am` } });
    }
  });
  await db.insert(schema.reportImports).values({ tenantId, reportType: "BQool Repricing-Datei", fileName: name.slice(0, 200), via: "upload", rows: r.zeilen.length, inserted: zeilen.length, message: land });
  const regeln = new Map<string, number>();
  for (const z of zeilen) regeln.set(z.regel || "–", (regeln.get(z.regel || "–") ?? 0) + 1);
  await bqoolAbgleichAufgabe(tenantId).catch(() => undefined);
  return { ok: true, land, message: `BQool ${land}: ${zeilen.length} SKUs als Ist-Stand übernommen (${[...regeln.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}).` };
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
  const [rows, zuw, ist, letzter] = await Promise.all([
    repricerRows(tenantId),
    db.select().from(Z).where(eq(Z.tenantId, tenantId)),
    istStand(tenantId, laender),
    db.select().from(E).where(eq(E.tenantId, tenantId)).orderBy(desc(E.createdAt)).limit(1),
  ]);
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
      const rf = regelFuer({ land, titel: r.title, asin: r.asin, zuweisung: zuwJe.get(`${land}|${r.sku}`) ?? null, markenRegeln: b.markenRegeln, aufAbverkaufsListe: b.elektronikLaender.includes(land) && b.elektronikMarken.some((m) => titelHatMarke(r.title, m)), abverkaufRegel: b.abverkaufRegel, standard: b.standardRegel, ist: i ? { regel: i.regel, min: i.min } : null, katalog: b.katalog });
      soll.set(`${land}|${r.sku}`, rf.regel);
      const kat = katalogRegel(b.katalog, rf.regel);
      const kosten = { ek: r.unitCost, fba: r.fbaFee, fix: b.fixGebuehr, zusatz: b.zusatzkosten, ust: UST[land], provision: r.referralRate };
      const be0 = breakEvenMin({ ...kosten, margeProzent: 0 });
      const min = dateiMin({ regel: kat, untergrenze: rf.untergrenze, breakEven: be0 });
      if (min === null) continue;
      const k = r.asin ? keepaJe.get(`${r.asin}|${land}`) : null;
      const bb90 = k?.kennzahlen?.["90"]?.buybox?.schnitt ?? null;
      const max = maxPreis({ min, bb90, faktor: b.maxFaktor, listenpreis: null, ersatzFaktor: s.pricing.maxPriceFactor });
      const enable = (i?.zusatz as Record<string, string> | undefined)?.enable || (i?.status === "aktiv" ? "1" : i?.status === "pausiert" ? "0" : f.enable);
      const eff = effektiverMin({ regel: kat, untergrenze: rf.untergrenze, ...kosten, alterTage: alterJe.get(r.sku) ?? null });
      const buybox = i?.buyboxPreis ?? k?.aktuell?.buybox ?? null;
      const w = warnungen({ min: eff.min ?? min, max }, { buybox, breakEven: kat?.festeUntergrenze ? be0 : null });
      if (!kat) w.push(`Regel „${rf.regel}“ steht nicht im Katalog`);
      const blockiert = minBlockiertBuybox({ istMin: i?.min ?? null, effMin: eff.min, buybox });
      if (blockiert) w.push(blockiert);
      zeilen.push({ land, sku: r.sku, cost: bqoolCost(r.unitCost, b.costUst), zusatz: b.zusatzkosten, regel: rf.regel, min, max, enable, titel: r.title, asin: r.asin, quelle: rf.quelle, effMin: eff.min, marge: eff.marge, buybox, istRegel: i?.regel ?? null, istMin: i?.min ?? null, erklaerung: buyboxErklaerung({ buybox, effMin: eff.min, unterregel: eff.unterregel }), warnungen: w, art: "neu", regelWechsel: false, minDiff: null });
    }
    // Vergleich: hochgeladener BQool-Stand, sonst letzter eigener Export.
    const vergleichMit: LandVorschau["vergleichMit"] = istRows.length ? "bqool" : letzteZeilen.some((z) => z.land === land) ? "export" : "nichts";
    const istMap = new Map<string, IstStand>(
      vergleichMit === "bqool"
        ? istRows.map((x) => [x.sku, { regel: x.regel, min: x.min, max: x.max, cost: (x.zusatz as Record<string, string>)?.cost ? Number((x.zusatz as Record<string, string>).cost) : undefined }])
        : letzteZeilen.filter((z) => z.land === land).map((z) => [z.sku, { regel: z.regel, min: z.min, max: z.max, cost: z.cost }]),
    );
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
  return {
    laender: ergebnis,
    ekFehlt,
    vorschlaege,
    abgleich: abgleich(istAlle, soll, b.katalog),
    format: { ausVorlage: f.ausVorlage },
    letzterExport: letzter[0] ? { id: letzter[0].id, am: letzter[0].createdAt, anzahl: letzter[0].anzahl } : null,
  };
}

/** Export erzeugen und speichern (Download je Land / ZIP). Nur Änderungen = neue und geänderte Zeilen. */
export async function bqoolExportErzeugen(tenantId: string, userId: string | null, o: { laender?: ExportLand[]; nurAenderungen: boolean }): Promise<{ id: string; anzahl: Record<string, number> }> {
  const v = await bqoolVorschau(tenantId, { laender: o.laender });
  const zeilen = v.laender.flatMap((l) => l.zeilen.filter((z) => !o.nurAenderungen || z.art !== "gleich").map((z) => ({ land: z.land, sku: z.sku, cost: z.cost, zusatz: z.zusatz, regel: z.regel, min: z.min, max: z.max, enable: z.enable })));
  const anzahl = Object.fromEntries(v.laender.map((l) => [l.land, zeilen.filter((z) => z.land === l.land).length]));
  const [e] = await db.insert(E).values({ tenantId, userId, laender: v.laender.map((l) => l.land), nurAenderungen: o.nurAenderungen, zeilen, anzahl }).returning({ id: E.id });
  return { id: e.id, anzahl };
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
