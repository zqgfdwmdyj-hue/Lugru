import "server-only";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { katalogRegel, liquidationStehtNoch, rueckkehrStand, type ExportLand } from "./export-logic";
import { ablaufStand, fruehereRueckkehr, istGebraucht, liquidationBis, plusTage, rueckkehrZiel, type Zustand } from "./leiter-logic";

// B31.6: SKUs, die wegen „Min unter Mindestmarge“ auf Liquidation gehen. Aktiv, sobald das BQool-Ist Liquidation mit
// dem gesetzten Min zeigt (dann automatisch Verlust-Stopp-Ausnahme im freigegebenen Rahmen); Test vor dem ersten
// Regelwechsel; Rückkehr-Vorschlag, wenn die Buy Box 14 Tage über effektivem Min der ursprünglichen Regel + 3 % liegt.

const LQ = schema.bqoolLiquidationen;
const L = schema.bqoolListings;
const A = schema.verlustAusnahmen;
export const AUSNAHME_PREFIX = "BQool-Liquidation";
const TASK_RUECKKEHR = "bqool-rueckkehr";
const TASK_ABLAUF = "bqool-liquidation-ablauf";
const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(2).replace(".", ","));
const dmy = (d: Date) => d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

/** Ausnahme-Text für den Verlust-Stopp (Rahmen steht im Datensatz – der Verlust-Stopp prüft ihn). */
export const ausnahmeGrund = (l: { land: string; verlustBis: number | null; regelVorher: string | null }, seit: Date) =>
  `${AUSNAHME_PREFIX} ${l.land} (Min unter Marge${l.regelVorher ? `, vorher „${l.regelVorher}“` : ""}) seit ${dmy(seit)} – ${l.verlustBis ? `Verlust bis ${f2(l.verlustBis)} € je Stück freigegeben` : "nur bis Break-even"}`;

/**
 * Nach jedem BQool-Ist: vorgeschlagene Liquidationen mit Liquidation + gesetztem Min im Ist → aktiv (Verlust-Stopp-
 * Ausnahme automatisch); Test „Min und Regel bleiben stehen“ erkennen (≥ 12 Std. nach dem ersten Treffer).
 */
export async function liquidationIstAbgleich(tenantId: string): Promise<{ aktiviert: number; testBestanden: boolean }> {
  const offen = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), inArray(LQ.status, ["vorgeschlagen", "aktiv", "zurueck_vorgeschlagen"]), inArray(LQ.grund, ["min_unter_marge", "leiter"])));
  if (!offen.length) return { aktiviert: 0, testBestanden: false };
  const s = await getSettings(tenantId);
  const ist = await db.select({ land: L.marktplatz, sku: L.sku, regel: L.regel, min: L.min, am: L.eingelesenAm }).from(L).where(and(eq(L.tenantId, tenantId), inArray(L.sku, [...new Set(offen.map((o) => o.sku))])));
  const istJe = new Map(ist.map((i) => [`${i.land}|${i.sku}`, i]));
  let aktiviert = 0;
  let test: { land: string; sku: string } | null = null;
  for (const l of offen) {
    const i = istJe.get(`${l.land}|${l.sku}`);
    if (!i) continue;
    const fest = !!katalogRegel(s.bqool.katalog, i.regel)?.festeUntergrenze;
    const minGleich = i.min !== null && l.minGesetzt !== null && Math.abs(i.min - l.minGesetzt) < 0.01;
    if (l.status === "vorgeschlagen" && fest && minGleich) {
      // B31.6a: „Liquidation bis“ ab dem Regelwechsel (Standard 45 Tage bzw. fester Termin)
      const bis = l.bis ?? liquidationBis(i.am.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }), s.bqool.leiter);
      await db.update(LQ).set({ status: "aktiv", aktivSeit: i.am, bis, updatedAt: new Date() }).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, l.land), eq(LQ.sku, l.sku)));
      // Verlust-Stopp: automatisch „Ausnahme übernehmen“ (bestehende Funktion), Rahmen prüft der Verlust-Stopp.
      await db.insert(A).values({ tenantId, sku: l.sku, grund: ausnahmeGrund(l, i.am).slice(0, 300), bis: null }).onConflictDoNothing();
      aktiviert++;
    } else if (!s.bqool.liquidationTest.bestanden && l.status !== "vorgeschlagen" && liquidationStehtNoch({ aktivSeit: l.aktivSeit, istAm: i.am, istRegelFest: fest, istMin: i.min, minGesetzt: l.minGesetzt })) {
      test ??= { land: l.land, sku: l.sku };
    }
  }
  if (test) await testSetzen(tenantId, { bestanden: true, am: new Date().toISOString(), land: test.land, sku: test.sku, vonHand: false });
  return { aktiviert, testBestanden: !!test };
}

async function testSetzen(tenantId: string, t: { bestanden: boolean; am: string | null; land: string | null; sku: string | null; vonHand: boolean }) {
  const { bqoolEinstellungenSpeichern } = await import("./export-service");
  await bqoolEinstellungenSpeichern(tenantId, { liquidationTest: t });
}

/** Test von Hand als bestanden bestätigen (nach dem Nachsehen in BQool) bzw. zurücksetzen. */
export async function liquidationTestBestaetigen(tenantId: string, bestanden: boolean, o: { land?: string | null; sku?: string | null } = {}) {
  await testSetzen(tenantId, { bestanden, am: bestanden ? new Date().toISOString() : null, land: o.land ?? null, sku: o.sku ?? null, vonHand: bestanden });
}

/**
 * Täglich (BQool-Lauf bzw. Hintergrund): Ist-Abgleich und Rückkehr-Prüfung. Buy Box aus dem BQool-Ist, sonst Keepa;
 * effektiver Min der ursprünglichen Regel wie in der Freigabe-Vorschau. Vorschläge als Aufgabe.
 */
export async function liquidationenPflegen(tenantId: string, heute = todayIso()): Promise<{ aktiviert: number; vorgeschlagen: number; offen: number; testBestanden: boolean; verlaengert: number; ablauf: number }> {
  const ab = await liquidationIstAbgleich(tenantId);
  const s = await getSettings(tenantId);
  const e = s.bqool.leiter;
  const liste = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), inArray(LQ.status, ["aktiv", "zurueck_vorgeschlagen"]), inArray(LQ.grund, ["min_unter_marge", "leiter"])));
  let vorgeschlagen = 0;
  let verlaengert = 0;
  const bald: typeof liste = [];
  if (liste.length) {
    const { bqoolVorschau } = await import("./export-service");
    const v = await bqoolVorschau(tenantId, { heute });
    const zeilen = new Map(v.laender.flatMap((l) => l.zeilen.map((z) => [`${z.land}|${z.sku}`, z])));
    // Bestand FBA + eigenes Lager je SKU (auch für SKUs, die nicht in der Vorschau stehen)
    const I = schema.amazonInventory;
    const inv = await db.select({ sku: I.sku, n: sql<number>`(${I.fulfillable} + ${I.reserved} + ${I.inboundWorking} + ${I.inboundShipped} + ${I.inboundReceiving} + ${I.mfnFulfillable})::int` }).from(I).where(and(eq(I.tenantId, tenantId), inArray(I.sku, [...new Set(liste.map((l) => l.sku))])));
    const bestandJe = new Map(inv.map((x) => [x.sku, x.n]));
    for (const l of liste) {
      const z = zeilen.get(`${l.land}|${l.sku}`);
      const effMinVorher = z?.effMinVorher ?? l.effMinVorher ?? null;
      const r = rueckkehrStand({ buybox: z?.buybox ?? null, effMinVorher, ueberSeit: l.ueberSeit, heute });
      // B31.6b: Rückkehr auf Stufe 2 (Abverkauf), auf Stufe 1 nur mit frischem Nachschub
      const ziel = rueckkehrZiel({ land: l.land, alterTage: z?.alterTage ?? null, gebraucht: istGebraucht((z?.zustand ?? "neu") as Zustand), abverkauf: s.bqool.abverkaufRegel, standard: s.bqool.standardRegel });
      const effMinZiel = z ? (ziel.stufe === 2 ? z.effMinStufe2 : z.effMinStufe1) : null;
      const frueher = l.status === "aktiv" ? fruehereRueckkehr({ bestand: bestandJe.get(l.sku) ?? 0, effMinZiel, buybox: z?.buybox ?? null, rueckkehr14: r.vorschlagen }) : null;
      const set: Partial<typeof LQ.$inferInsert> = {};
      if (r.ueberSeit !== l.ueberSeit) set.ueberSeit = r.ueberSeit;
      if (effMinVorher !== null && effMinVorher !== l.effMinVorher) set.effMinVorher = effMinVorher;
      if (frueher) {
        Object.assign(set, { status: "zurueck_vorgeschlagen" as const, zurueckVorgeschlagenAm: new Date(), rueckkehrGrund: frueher, rueckkehrRegel: ziel.regel });
        vorgeschlagen++;
      } else if (l.status === "aktiv") {
        // B31.6a: Ablauf – 7 Tage vorher melden; abgelaufen ohne Rückkehr-Bedingung → 30 Tage verlängern (Morgenbericht)
        const st = ablaufStand({ bis: l.bis, dauerhaft: l.dauerhaft, heute, vorwarnTage: e.ablaufVorwarnTage });
        if (st.stand === "abgelaufen") {
          Object.assign(set, { bis: plusTage(heute, e.verlaengernTage), verlaengert: l.verlaengert + 1, ablaufGemeldetAm: null });
          verlaengert++;
        } else if (st.stand === "bald" && !l.ablaufGemeldetAm) {
          Object.assign(set, { ablaufGemeldetAm: new Date(), rueckkehrRegel: ziel.regel });
          bald.push(l);
        }
      }
      if (Object.keys(set).length) await db.update(LQ).set({ ...set, updatedAt: new Date() }).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, l.land), eq(LQ.sku, l.sku)));
    }
  }
  if (bald.length) {
    const { pushen } = await import("./kreislauf");
    await pushen(tenantId, { titel: `Liquidation läuft in ${e.ablaufVorwarnTage} Tagen ab: ${bald.length} SKU${bald.length === 1 ? "" : "s"}`, text: `${bald.slice(0, 5).map((l) => `${l.land} ${l.sku}`).join(", ")}${bald.length > 5 ? " …" : ""} – „Verlängern ${e.verlaengernTage} Tage“, „Zurück auf alte Regel“ oder „Dauerhaft Liquidation“.`, link: "/repricer/bqool#liquidation", aktionen: [{ aktion: "ansehen", titel: "Entscheiden", link: "/repricer/bqool#liquidation" }] }).catch(() => undefined);
  }
  const offenAblauf = await db.select({ land: LQ.land, sku: LQ.sku, bis: LQ.bis }).from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.status, "aktiv"), sql`${LQ.ablaufGemeldetAm} is not null`, eq(LQ.dauerhaft, false)));
  if (offenAblauf.length) await upsertSystemTask(db, tenantId, TASK_ABLAUF, { title: `BQool: Liquidation läuft ab – ${offenAblauf.length} SKU${offenAblauf.length === 1 ? "" : "s"} entscheiden`, notes: `„Verlängern ${e.verlaengernTage} Tage“ / „Zurück auf alte Regel“ / „Dauerhaft Liquidation“ (Repricer → BQool-Dateien → Liquidation). Ohne Antwort bleibt die SKU auf Liquidation.\n${offenAblauf.slice(0, 20).map((o) => `• ${o.land} ${o.sku} bis ${o.bis ?? "–"}`).join("\n")}`, category: "amazon", link: "/repricer/bqool#liquidation" });
  else await resolveSystemTask(db, tenantId, TASK_ABLAUF);
  const offen = await rueckkehrAufgabe(tenantId);
  // B31.6b/B31.7/B31.8: Regel-Leiter, Schnelldreher, Zustand
  await import("./leiter").then((x) => x.leiterPflegen(tenantId, heute)).catch((err) => console.error("Regel-Leiter:", err));
  return { aktiviert: ab.aktiviert, vorgeschlagen, offen, testBestanden: ab.testBestanden, verlaengert, ablauf: bald.length };
}

/** Aufgabe „zurück auf die ursprüngliche Regel?“ – erledigt, wenn nichts mehr offen ist. */
async function rueckkehrAufgabe(tenantId: string): Promise<number> {
  const offen = await db.select({ land: LQ.land, sku: LQ.sku, regelVorher: LQ.regelVorher, ziel: LQ.rueckkehrRegel, grund: LQ.rueckkehrGrund }).from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.status, "zurueck_vorgeschlagen")));
  if (!offen.length) {
    await resolveSystemTask(db, tenantId, TASK_RUECKKEHR);
    return 0;
  }
  await upsertSystemTask(db, tenantId, TASK_RUECKKEHR, {
    title: `BQool: ${offen.length} SKU${offen.length === 1 ? "" : "s"} zurück von Liquidation?`,
    notes: `Rückkehr auf Stufe 2 (Abverkauf) – auf Stufe 1 nur mit frischem Nachschub. Freigabe auf Repricer → BQool-Dateien („zurück auf …“) – erst dann kommt der Regelwechsel in die nächste Datei.\n${offen.slice(0, 20).map((o) => `• ${o.land} ${o.sku} → ${o.ziel ?? o.regelVorher ?? "?"}${o.grund ? ` (${o.grund})` : ""}`).join("\n")}`,
    category: "amazon",
    link: "/repricer/bqool#liquidation",
  });
  return offen.length;
}

/** Rückkehr freigeben: Soll-Regel wieder die ursprüngliche (Min = effektiver Min), Liquidation beendet, Ausnahme weg. */
export async function rueckkehrFreigeben(tenantId: string, land: string, sku: string): Promise<string | null> {
  const [l] = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku)));
  const ziel = l?.rueckkehrRegel ?? l?.regelVorher ?? null;
  if (!l || !ziel) return null;
  const { zuweisungSetzen } = await import("./export-service");
  await zuweisungSetzen(tenantId, { land: land as ExportLand, sku, regel: ziel, untergrenze: null, quelle: "leiter", grund: `zurück nach Liquidation (${l.rueckkehrGrund ?? "Freigabe"})`.slice(0, 300) });
  await db.update(LQ).set({ status: "beendet", beendetAm: new Date(), ueberSeit: null, updatedAt: new Date() }).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku)));
  const nochAktiv = await db.select({ land: LQ.land }).from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.sku, sku), inArray(LQ.status, ["vorgeschlagen", "aktiv", "zurueck_vorgeschlagen"])));
  if (!nochAktiv.length) await db.delete(A).where(and(eq(A.tenantId, tenantId), eq(A.sku, sku), like(A.grund, `${AUSNAHME_PREFIX}%`)));
  await rueckkehrAufgabe(tenantId);
  return ziel;
}

/** B31.6a: Ablauf entscheiden – 30 Tage verlängern, zurück (Stufe 2) oder dauerhaft Liquidation; „bis“ von Hand ändern. */
export async function ablaufEntscheiden(tenantId: string, land: string, sku: string, wahl: "verlaengern" | "zurueck" | "dauerhaft" | "bis", bis?: string | null): Promise<string | null> {
  const [l] = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku)));
  if (!l) return null;
  const s = await getSettings(tenantId);
  const heute = todayIso();
  const w = and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku));
  if (wahl === "zurueck") {
    if (!l.rueckkehrRegel) await db.update(LQ).set({ rueckkehrRegel: rueckkehrZiel({ land, alterTage: null, gebraucht: false, abverkauf: s.bqool.abverkaufRegel, standard: s.bqool.standardRegel }).regel, rueckkehrGrund: "Ablauf – von Hand" }).where(w);
    const r = await rueckkehrFreigeben(tenantId, land, sku);
    await ablaufAufgabeAuffrischen(tenantId);
    return r ? `zurück auf „${r}“` : null;
  }
  if (wahl === "dauerhaft") await db.update(LQ).set({ dauerhaft: true, ablaufGemeldetAm: null, updatedAt: new Date() }).where(w);
  if (wahl === "verlaengern") await db.update(LQ).set({ bis: plusTage(l.bis && l.bis > heute ? l.bis : heute, s.bqool.leiter.verlaengernTage), dauerhaft: false, ablaufGemeldetAm: null, verlaengert: l.verlaengert + 1, updatedAt: new Date() }).where(w);
  if (wahl === "bis" && bis && /^\d{4}-\d{2}-\d{2}$/.test(bis)) await db.update(LQ).set({ bis, dauerhaft: false, ablaufGemeldetAm: null, updatedAt: new Date() }).where(w);
  await ablaufAufgabeAuffrischen(tenantId);
  return wahl === "dauerhaft" ? "dauerhaft Liquidation" : wahl === "verlaengern" ? `verlängert um ${s.bqool.leiter.verlaengernTage} Tage` : `Liquidation bis ${bis}`;
}

async function ablaufAufgabeAuffrischen(tenantId: string) {
  const n = await db.select({ sku: LQ.sku }).from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.status, "aktiv"), sql`${LQ.ablaufGemeldetAm} is not null`, eq(LQ.dauerhaft, false)));
  if (!n.length) await resolveSystemTask(db, tenantId, TASK_ABLAUF);
}

/** Rückkehr-Vorschlag ablehnen: bleibt auf Liquidation, Zähler beginnt von vorn. */
export async function rueckkehrAblehnen(tenantId: string, land: string, sku: string) {
  await db.update(LQ).set({ status: "aktiv", ueberSeit: null, zurueckVorgeschlagenAm: null, updatedAt: new Date() }).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku), eq(LQ.status, "zurueck_vorgeschlagen")));
  await rueckkehrAufgabe(tenantId);
}

/** „Mindest-Verlust akzeptiert bis x €“ je Stück setzen (null = nur bis Break-even). Legt bei Bedarf einen Datensatz an. */
export async function verlustFreigabeSetzen(tenantId: string, land: string, sku: string, verlustBis: number | null) {
  const wert = verlustBis !== null && verlustBis > 0 ? Math.round(verlustBis * 100) / 100 : null;
  await db
    .insert(LQ)
    .values({ tenantId, land, sku, grund: "hand", status: "aktiv", verlustBis: wert })
    .onConflictDoUpdate({ target: [LQ.tenantId, LQ.land, LQ.sku], set: { verlustBis: wert, updatedAt: new Date() } });
  // Ausnahme-Text der automatischen Verlust-Stopp-Ausnahme mitziehen
  const [l] = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku)));
  if (l?.aktivSeit) await db.update(A).set({ grund: ausnahmeGrund(l, l.aktivSeit).slice(0, 300) }).where(and(eq(A.tenantId, tenantId), eq(A.sku, sku), like(A.grund, `${AUSNAHME_PREFIX}%`)));
}

/** Für Verlust-Stopp, Kapital-Ampel und Morgenbericht: Liquidationen wegen Min unter Marge (aktiv) und Verlust-Rahmen je SKU. */
export async function liquidationsStand(tenantId: string) {
  const rows = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), inArray(LQ.status, ["vorgeschlagen", "aktiv", "zurueck_vorgeschlagen"])));
  const wegenMarge = rows.filter((r) => (r.grund === "min_unter_marge" || r.grund === "leiter") && r.status !== "vorgeschlagen");
  const unterBe = wegenMarge.filter((r) => r.minGesetzt !== null && r.breakEven !== null && r.minGesetzt < r.breakEven - 0.005);
  const rahmenJeSku = new Map<string, number>();
  for (const r of rows.filter((x) => x.status !== "vorgeschlagen")) rahmenJeSku.set(r.sku, Math.max(rahmenJeSku.get(r.sku) ?? 0, r.verlustBis ?? 0));
  return {
    anzahl: wegenMarge.length,
    unterBreakEven: unterBe.length,
    vorgeschlagen: rows.filter((r) => (r.grund === "min_unter_marge" || r.grund === "leiter") && r.status === "vorgeschlagen").length,
    rueckkehr: rows.filter((r) => r.status === "zurueck_vorgeschlagen").length,
    rahmenJeSku,
    zeilen: rows,
  };
}

export { liquidationsZeile } from "./export-logic";
