import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import type { KeepaStand, Marktplatz } from "@/lib/keepa/auswertung";
import { BEFUND_TITEL, befundePruefen, CHECK_STANDARD, checkMorgenZeile, median, pushNoetig, stufeA, stufeFuer, type CheckEingabe, type CheckStand } from "./listing-check-logic";
import { istGebraucht, plusTage, schnelldreherKandidat, tageZwischen, type Zustand } from "./leiter-logic";
import type { ExportLand } from "./export-logic";

// B32 Listing-Check: läuft nach dem BQool-Ist (06:00, B31.2) bzw. auf Knopfdruck. Stufe A täglich (Wert = Kapital ×
// Nachfrage, Schnelldreher, offene Befunde), Stufe B wöchentlich, Stufe C (ohne Bestand) monatlich. Keepa nur für
// Stufe A und nur im Budget; Befunde landen als Vorschläge (art „check_n“) mit Freigeben/Ablehnen/Später.

const V = schema.bqoolVorschlaege;
const P = schema.bqoolSkuPflege;

export async function listingCheck(tenantId: string, heute = todayIso(), o: { keepa?: boolean } = {}): Promise<CheckStand> {
  const start = Date.now();
  const s = await getSettings(tenantId);
  const b = s.bqool;
  const schwellen = CHECK_STANDARD;
  const { bqoolVorschau } = await import("./export-service");
  const v = await bqoolVorschau(tenantId, { heute });
  const zeilen = v.laender.flatMap((l) => l.zeilen);
  const [ist, pflegeRows, offen, leistung, kap, lq] = await Promise.all([
    db.select().from(schema.bqoolListings).where(eq(schema.bqoolListings.tenantId, tenantId)),
    db.select().from(P).where(eq(P.tenantId, tenantId)),
    db.select({ land: V.land, sku: V.sku, art: V.art }).from(V).where(and(eq(V.tenantId, tenantId), inArray(V.status, ["offen", "spaeter"]), sql`${V.art} like 'check_%'`)),
    db.select().from(schema.bqoolLeistung).where(and(eq(schema.bqoolLeistung.tenantId, tenantId), gte(schema.bqoolLeistung.stichtag, plusTage(heute, -30)))),
    import("@/lib/money/kapital-service").then((x) => x.kapitalAmpel(tenantId, heute)).catch(() => null),
    db.select().from(schema.bqoolLiquidationen).where(eq(schema.bqoolLiquidationen.tenantId, tenantId)),
  ]);
  const istJe = new Map(ist.map((i) => [`${i.marktplatz}|${i.sku}`, i]));
  const pfJe = new Map(pflegeRows.map((p) => [`${p.land}|${p.sku}`, p]));
  const offenJe = new Set(offen.map((x) => `${x.land}|${x.sku}`));
  const kapJe = new Map((kap?.zeilen ?? []).map((z) => [z.sku, z]));
  const liqFrei = new Set(lq.filter((l) => l.verlustBis !== null && l.status !== "beendet").map((l) => `${l.land}|${l.sku}`));
  // BQool Listing Performance: 7-Tage-Verkäufe, Buy-Box-Quote, Durchschnittspreis je Bericht (Preisband)
  const lpJe = new Map<string, typeof leistung>();
  for (const l of leistung) lpJe.set(`${l.land}|${l.sku}`, [...(lpJe.get(`${l.land}|${l.sku}`) ?? []), l]);
  // Keepa-Zwischenspeicher je ASIN/Land
  const asins = [...new Set(zeilen.map((z) => z.asin).filter((a): a is string => !!a))];
  const keepaRows = asins.length ? await db.select({ asin: schema.keepaCache.asin, mp: schema.keepaCache.marktplatz, stand: schema.keepaCache.stand, am: schema.keepaCache.abgerufenAm }).from(schema.keepaCache).where(and(eq(schema.keepaCache.tenantId, tenantId), inArray(schema.keepaCache.asin, asins))) : [];
  const keepaJe = new Map(keepaRows.map((k) => [`${k.asin}|${k.mp}`, k]));

  // Stufe A: Wert = Kapital × Nachfrage (Keepa „monatlich verkauft“), dazu Schnelldreher und offene Befunde
  const basis = zeilen.map((z) => {
    const k = z.asin ? (keepaJe.get(`${z.asin}|${z.land}`)?.stand as KeepaStand | null) : null;
    return { key: `${z.land}|${z.sku}`, kapital: kapJe.get(z.sku)?.kapital ?? null, nachfrage: k?.aktuell?.monatlich_verkauft ?? 0, schnelldreher: z.schnelldreher, offen: offenJe.has(`${z.land}|${z.sku}`) };
  });
  const inA = stufeA(basis, schwellen.stufeA);
  // Keepa nur für Stufe A, älter als 24 Std., im Budget (Abrufe je Lauf, Token-Reserve)
  let keepaAbrufe = 0;
  let unvollstaendig = 0;
  let tokens: number | null = null;
  if (o.keepa !== false) {
    const { keepaMarkt } = await import("@/lib/keepa/markt");
    for (const z of zeilen) {
      if (!inA.has(`${z.land}|${z.sku}`) || !z.asin) continue;
      const k = keepaJe.get(`${z.asin}|${z.land}`);
      if (k && Date.now() - k.am.getTime() < 24 * 3_600_000) continue;
      if (keepaAbrufe >= schwellen.keepaJeLauf || (tokens !== null && tokens < schwellen.keepaTokenReserve)) {
        unvollstaendig++;
        continue;
      }
      try {
        const r = await keepaMarkt(tenantId, z.asin, z.land as Marktplatz);
        keepaAbrufe++;
        tokens = r.tokensUebrig ?? tokens;
        if (r.stand) keepaJe.set(`${z.asin}|${z.land}`, { asin: z.asin, mp: z.land, stand: r.stand, am: r.abgerufen });
        if (r.ausSpeicher && r.warnung) unvollstaendig++;
      } catch {
        unvollstaendig++;
      }
    }
  }

  // BQool-Stand: älter als 2 Tage → „BQool-Stand alt“ (Check läuft mit Hinweis)
  const istStand = ist.reduce<Date | null>((m, x) => (!m || x.eingelesenAm > m ? x.eingelesenAm : m), null);
  const bqoolAlt = !istStand || tageZwischen(istStand.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }), heute) > 2;

  let stA = 0;
  let stB = 0;
  let stC = 0;
  let neu = 0;
  const aktuell = new Set<string>();
  const pushes: { titel: string; text: string }[] = [];
  const geprueft: { land: string; sku: string }[] = [];
  for (const z of zeilen) {
    const key = `${z.land}|${z.sku}`;
    const pf = pfJe.get(key);
    const stufe = stufeFuer({ inA: inA.has(key), bestand: z.bestand, zuletzt: pf?.checkZuletzt ?? null, heute });
    if (!stufe) {
      // nicht dran: offene Befunde bleiben stehen
      for (const x of offen.filter((x) => x.land === z.land && x.sku === z.sku)) aktuell.add(`${x.art}|${key}`);
      continue;
    }
    if (stufe === "A") stA++;
    else if (stufe === "B") stB++;
    else stC++;
    geprueft.push({ land: z.land, sku: z.sku });
    const i = istJe.get(key);
    const k = z.asin ? (keepaJe.get(`${z.asin}|${z.land}`)?.stand as KeepaStand | null) : null;
    const lp = (lpJe.get(key) ?? []).sort((a, c) => (a.stichtag < c.stichtag ? 1 : -1));
    const lp7 = lp.find((x) => x.zeitraumTage <= 7) ?? lp[0];
    const kz = kapJe.get(z.sku);
    const bbUeberMaxSeit = i?.max != null && z.buybox !== null && z.buybox > i.max + 0.005 ? (pf?.bbUeberMaxSeit ?? heute) : null;
    const preise = lp.filter((x) => x.units && x.units > 0 && x.sales && tageZwischen(x.stichtag, heute) <= 14).map((x) => (x.sales as number) / (x.units as number));
    const anzahl = lp.filter((x) => tageZwischen(x.stichtag, heute) <= 14).reduce((n, x) => n + (x.units ?? 0), 0);
    const gebraucht = istGebraucht(z.zustand as Zustand);
    const kandidat = !gebraucht && !z.schnelldreher && schnelldreherKandidat({ verkaeufe30: kz?.verkaufProTag != null ? Math.round(kz.verkaufProTag * 30) : null, reichweite: kz?.reichweite ?? null, alterTage: z.alterTage, bbQuote: lp7?.bbWins ?? null }, b.leiter.schnell);
    // Befund 1: Ziel-Min = effektiver Min; Schnelldreher (auch Kandidat) Break-even + 7 %, nie unter dem effektiven Min
    const schnellZiel = z.bodenSchnell !== null ? Math.max(z.effMin ?? 0, z.bodenSchnell) : z.effMin;
    const e: CheckEingabe = {
      land: z.land,
      sku: z.sku,
      asin: z.asin,
      titel: z.titel,
      bestand: stufe === "C" ? 0 : z.bestand,
      status: i?.status ?? null,
      minBqool: i?.min ?? null,
      maxBqool: i?.max ?? null,
      preis: i?.preis ?? null,
      buybox: z.buybox ?? k?.aktuell?.buybox ?? null,
      bb30: k?.kennzahlen?.["30"]?.buybox?.schnitt ?? null,
      rang: k?.aktuell?.verkaufsrang ?? null,
      monatlichVerkauft: k?.aktuell?.monatlich_verkauft ?? null,
      verkaeufe7: lp7?.units ?? null,
      verkaeufe30: kz?.verkaufProTag != null ? Math.round(kz.verkaufProTag * 30) : null,
      bbUeberMaxTage: bbUeberMaxSeit ? tageZwischen(bbUeberMaxSeit, heute) : 0,
      ohneBuyboxTage: pf?.ohneBuyboxSeit ? tageZwischen(pf.ohneBuyboxSeit, heute) : 0,
      breakEven: z.breakEven,
      effMin: z.effMin,
      zielMin: z.schnelldreher || kandidat ? schnellZiel : gebraucht ? z.min : z.effMin,
      liquidationFreigegeben: liqFrei.has(key),
      gebrauchtMitNeupreisMin: gebraucht && i?.min != null && z.effMinStufe1 !== null && i.min >= z.effMinStufe1 - 0.005,
      schnelldreher: z.schnelldreher,
      schnelldreherKandidat: kandidat,
      reichweite: kz?.reichweite ?? null,
      lagerdauer: z.alterTage,
      kapital: kz?.kapital ?? null,
      verkaufspreisMedian: median(preise),
      verkaufspreisAnzahl: anzahl,
    };
    // Stufe C: nur Min-Prüfung aus der Datei (Befund 1 und 6)
    const befunde = befundePruefen(e, schwellen).filter((x) => stufe !== "C" || x.nr === 1 || x.nr === 6);
    for (const x of befunde) {
      const art = `check_${x.nr}`;
      aktuell.add(`${art}|${key}`);
      const alt = await db.select({ id: V.id, status: V.status, entschiedenAm: V.entschiedenAm, spaeterBis: V.spaeterBis }).from(V).where(and(eq(V.tenantId, tenantId), eq(V.land, z.land), eq(V.sku, z.sku), eq(V.art, art), inArray(V.status, ["offen", "spaeter", "abgelehnt"])));
      const off = alt.find((a) => a.status === "offen" || a.status === "spaeter");
      if (!off && alt.some((a) => a.status === "abgelehnt" && a.entschiedenAm && tageZwischen(a.entschiedenAm.toISOString().slice(0, 10), heute) < 14)) continue;
      const werte = { vonRegel: z.regel, nachRegel: null, min: x.wert, gruende: [x.vorschlag], daten: { titel: z.titel, asin: z.asin, befund: x.titel, nr: x.nr, aktion: x.aktion, zahlen: x.zahlen, stufe, verkaeufe30: e.verkaeufe30 ?? 0, schnell: e.schnelldreher || e.schnelldreherKandidat }, potenzial: x.potenzial, updatedAt: new Date() };
      if (off) {
        const status = off.status === "spaeter" && off.spaeterBis && off.spaeterBis <= heute ? "offen" : off.status;
        await db.update(V).set({ ...werte, status }).where(eq(V.id, off.id));
      } else {
        await db.insert(V).values({ tenantId, land: z.land, sku: z.sku, art, ...werte });
        neu++;
        if (pushNoetig(x, e, schwellen)) pushes.push({ titel: `Listing-Check: ${x.titel}`, text: `${z.land} ${z.asin ?? z.sku} ${String(z.titel ?? "").slice(0, 40)} – ${x.vorschlag}` });
      }
    }
    await db
      .insert(P)
      .values({ tenantId, land: z.land, sku: z.sku, bbUeberMaxSeit, checkZuletzt: heute })
      .onConflictDoUpdate({ target: [P.tenantId, P.land, P.sku], set: { bbUeberMaxSeit, checkZuletzt: heute, updatedAt: new Date() } });
  }
  // Nicht mehr zutreffende offene Befunde geprüfter SKUs → veraltet
  const gepr = new Set(geprueft.map((g) => `${g.land}|${g.sku}`));
  const weg = offen.filter((x) => gepr.has(`${x.land}|${x.sku}`) && !aktuell.has(`${x.art}|${x.land}|${x.sku}`));
  for (const x of weg) await db.update(V).set({ status: "veraltet", updatedAt: new Date() }).where(and(eq(V.tenantId, tenantId), eq(V.land, x.land), eq(V.sku, x.sku), eq(V.art, x.art), inArray(V.status, ["offen", "spaeter"])));
  if (pushes.length) {
    const { pushen } = await import("./kreislauf");
    await pushen(tenantId, { titel: pushes.length === 1 ? pushes[0].titel : `Listing-Check: ${pushes.length} dringende Befunde`, text: pushes.slice(0, 3).map((p) => p.text).join(" · "), link: "/repricer/listing-check" }).catch(() => undefined);
  }
  const offenJetzt = await db.select({ land: V.land, sku: V.sku, potenzial: V.potenzial, daten: V.daten }).from(V).where(and(eq(V.tenantId, tenantId), eq(V.status, "offen"), sql`${V.art} like 'check_%'`)).orderBy(sql`${V.potenzial} desc nulls last`).limit(200);
  const stand: CheckStand = {
    am: heute,
    dauerMs: Date.now() - start,
    geprueft: geprueft.length,
    stufeA: stA,
    stufeB: stB,
    stufeC: stC,
    keepaAbrufe,
    unvollstaendig,
    neu,
    offen: offenJetzt.length,
    bqoolAlt,
    bqoolStand: istStand ? istStand.toISOString() : null,
    top: offenJetzt.slice(0, 5).map((x) => ({ land: x.land, sku: x.sku, asin: ((x.daten as { asin?: string | null }).asin ?? null), titel: String((x.daten as { befund?: string }).befund ?? ""), potenzial: x.potenzial ?? 0 })),
  };
  const { bqoolEinstellungenSpeichern } = await import("./export-service");
  await bqoolEinstellungenSpeichern(tenantId, { listingCheckStand: stand });
  return stand;
}

/** Befund entscheiden: Freigeben wirkt über die Soll-Regel bzw. den Pflege-Stand (nächster BQool-Upload), nie direkt. */
export async function befundEntscheiden(tenantId: string, id: string, entscheidung: "freigeben" | "ablehnen" | "spaeter", userId: string | null): Promise<string> {
  const [x] = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.id, id)));
  if (!x || !x.art.startsWith("check_") || (x.status !== "offen" && x.status !== "spaeter")) return "Befund nicht (mehr) offen.";
  const heute = todayIso();
  const setz = (status: "freigegeben" | "abgelehnt" | "spaeter" | "erledigt", spaeterBis: string | null = null) =>
    db.update(V).set({ status, spaeterBis, entschiedenAm: new Date(), entschiedenVon: userId, updatedAt: new Date(), daten: { ...(x.daten as object), verkaeufeVorher: (x.daten as { verkaeufe30?: number }).verkaeufe30 ?? 0 } }).where(eq(V.id, x.id));
  if (entscheidung === "ablehnen") {
    await setz("abgelehnt");
    return `${x.sku} (${x.land}): abgelehnt.`;
  }
  if (entscheidung === "spaeter") {
    await setz("spaeter", plusTage(heute, 7));
    return `${x.sku} (${x.land}): später (7 Tage).`;
  }
  const d = x.daten as { aktion?: string; befund?: string };
  const pflege = (werte: Partial<typeof P.$inferInsert>) => db.insert(P).values({ tenantId, land: x.land, sku: x.sku, ...werte }).onConflictDoUpdate({ target: [P.tenantId, P.land, P.sku], set: { ...werte, updatedAt: new Date() } });
  const { zuweisungSetzen } = await import("./export-service");
  const s = await getSettings(tenantId);
  let text = "erledigt";
  if (d.aktion === "min" && x.min !== null) {
    await zuweisungSetzen(tenantId, { land: x.land as ExportLand, sku: x.sku, regel: x.vonRegel ?? s.bqool.standardRegel, untergrenze: x.min, quelle: "hand", grund: `Listing-Check: ${d.befund ?? ""}`.slice(0, 300) });
    // Schnelldreher-Kandidat: Schutz gleich mit setzen (Boden 7 %, keine Liquidation durch den Min-Wunsch)
    if ((d as { schnell?: boolean }).schnell) await pflege({ schnelldreher: true, schnellQuelle: "auto", schnellSeit: new Date(), schnellBis: null });
    text = `Min ${x.min.toFixed(2)} kommt in den nächsten Upload${(d as { schnell?: boolean }).schnell ? " (Schnelldreher-Schutz gesetzt)" : ""}`;
  } else if (d.aktion === "aktivieren") {
    await pflege({ aktivieren: true });
    text = "wird mit dem nächsten Upload aktiviert";
  } else if (d.aktion === "schnelldreher") {
    await pflege({ schnelldreher: true, schnellQuelle: "auto", schnellSeit: new Date(), schnellBis: null });
    text = "Schnelldreher (Boden 7 %, kein Abverkauf)";
  } else if (d.aktion === "max" && x.min !== null) {
    await pflege({ maxSoll: x.min });
    text = `Max ${x.min.toFixed(2)} kommt in den nächsten Upload`;
  } else if (d.aktion === "leiter") {
    const abv = x.land === "DE" ? s.bqool.abverkaufRegel.DE : s.bqool.abverkaufRegel.sonst;
    await zuweisungSetzen(tenantId, { land: x.land as ExportLand, sku: x.sku, regel: abv, untergrenze: null, quelle: "leiter", grund: "Listing-Check: Ladenhüter" });
    text = `auf ${abv} (Stufe 2) im nächsten Upload`;
  }
  await setz(d.aktion === "hinweis" || d.aktion === "verlust" || d.aktion === "zustand" ? "erledigt" : "freigegeben");
  return `${x.sku} (${x.land}): ${text}.`;
}

/** B32.4: Trefferquote – Freigaben, die 14 Tage später zu Verkäufen führten (Verkäufe 30 T gestiegen). */
export async function checkTrefferquote(tenantId: string, heute = todayIso()): Promise<{ freigaben: number; mitVerkauf: number; quote: number | null }> {
  const fr = await db.select().from(V).where(and(eq(V.tenantId, tenantId), eq(V.status, "freigegeben"), sql`${V.art} like 'check_%'`, sql`${V.entschiedenAm} <= ${new Date(Date.parse(`${heute}T00:00:00Z`) - 14 * 86_400_000)}`));
  if (!fr.length) return { freigaben: 0, mitVerkauf: 0, quote: null };
  const kap = await import("@/lib/money/kapital-service").then((x) => x.kapitalAmpel(tenantId, heute)).catch(() => null);
  const jetzt = new Map((kap?.zeilen ?? []).map((z) => [z.sku, z.verkaufProTag != null ? Math.round(z.verkaufProTag * 30) : 0]));
  const mit = fr.filter((x) => (jetzt.get(x.sku) ?? 0) > ((x.daten as { verkaeufeVorher?: number }).verkaeufeVorher ?? 0)).length;
  return { freigaben: fr.length, mitVerkauf: mit, quote: Math.round((mit / fr.length) * 100) };
}

export async function listingCheckMorgenZeilen(tenantId: string): Promise<string[]> {
  const st = (await getSettings(tenantId)).bqool.listingCheckStand;
  const z = checkMorgenZeile(st);
  return z ? [z] : [];
}

export async function befundeOffen(tenantId: string) {
  return db.select().from(V).where(and(eq(V.tenantId, tenantId), inArray(V.status, ["offen"]), sql`${V.art} like 'check_%'`)).orderBy(sql`${V.potenzial} desc nulls last`, V.land, V.sku);
}

export { BEFUND_TITEL };
