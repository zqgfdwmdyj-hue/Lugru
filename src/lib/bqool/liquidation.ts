import "server-only";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { katalogRegel, liquidationStehtNoch, rueckkehrStand, type ExportLand } from "./export-logic";

// B31.6: SKUs, die wegen „Min unter Mindestmarge“ auf Liquidation gehen. Aktiv, sobald das BQool-Ist Liquidation mit
// dem gesetzten Min zeigt (dann automatisch Verlust-Stopp-Ausnahme im freigegebenen Rahmen); Test vor dem ersten
// Regelwechsel; Rückkehr-Vorschlag, wenn die Buy Box 14 Tage über effektivem Min der ursprünglichen Regel + 3 % liegt.

const LQ = schema.bqoolLiquidationen;
const L = schema.bqoolListings;
const A = schema.verlustAusnahmen;
export const AUSNAHME_PREFIX = "BQool-Liquidation";
const TASK_RUECKKEHR = "bqool-rueckkehr";
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
  const offen = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), inArray(LQ.status, ["vorgeschlagen", "aktiv", "zurueck_vorgeschlagen"]), eq(LQ.grund, "min_unter_marge")));
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
      await db.update(LQ).set({ status: "aktiv", aktivSeit: i.am, updatedAt: new Date() }).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, l.land), eq(LQ.sku, l.sku)));
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
export async function liquidationenPflegen(tenantId: string, heute = todayIso()): Promise<{ aktiviert: number; vorgeschlagen: number; offen: number; testBestanden: boolean }> {
  const ab = await liquidationIstAbgleich(tenantId);
  const liste = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), inArray(LQ.status, ["aktiv", "zurueck_vorgeschlagen"]), eq(LQ.grund, "min_unter_marge")));
  let vorgeschlagen = 0;
  if (liste.length) {
    const { bqoolVorschau } = await import("./export-service");
    const v = await bqoolVorschau(tenantId, { heute });
    const zeilen = new Map(v.laender.flatMap((l) => l.zeilen.map((z) => [`${z.land}|${z.sku}`, z])));
    for (const l of liste) {
      const z = zeilen.get(`${l.land}|${l.sku}`);
      const effMinVorher = z?.effMinVorher ?? l.effMinVorher ?? null;
      const r = rueckkehrStand({ buybox: z?.buybox ?? null, effMinVorher, ueberSeit: l.ueberSeit, heute });
      const neu = l.status === "aktiv" && r.vorschlagen;
      if (neu) vorgeschlagen++;
      if (neu || r.ueberSeit !== l.ueberSeit || (effMinVorher !== null && effMinVorher !== l.effMinVorher)) {
        await db
          .update(LQ)
          .set({ ueberSeit: r.ueberSeit, effMinVorher, ...(neu ? { status: "zurueck_vorgeschlagen" as const, zurueckVorgeschlagenAm: new Date() } : {}), updatedAt: new Date() })
          .where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, l.land), eq(LQ.sku, l.sku)));
      }
    }
  }
  const offen = await rueckkehrAufgabe(tenantId);
  return { aktiviert: ab.aktiviert, vorgeschlagen, offen, testBestanden: ab.testBestanden };
}

/** Aufgabe „zurück auf die ursprüngliche Regel?“ – erledigt, wenn nichts mehr offen ist. */
async function rueckkehrAufgabe(tenantId: string): Promise<number> {
  const offen = await db.select({ land: LQ.land, sku: LQ.sku, regelVorher: LQ.regelVorher }).from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.status, "zurueck_vorgeschlagen")));
  if (!offen.length) {
    await resolveSystemTask(db, tenantId, TASK_RUECKKEHR);
    return 0;
  }
  await upsertSystemTask(db, tenantId, TASK_RUECKKEHR, {
    title: `BQool: ${offen.length} SKU${offen.length === 1 ? "" : "s"} zurück von Liquidation auf die ursprüngliche Regel?`,
    notes: `Buy Box seit 14 Tagen über dem effektiven Min der ursprünglichen Regel + 3 %. Freigabe auf Repricer → BQool-Dateien („zurück auf …“) – erst dann kommt der Regelwechsel in die nächste Datei.\n${offen.slice(0, 20).map((o) => `• ${o.land} ${o.sku} → ${o.regelVorher ?? "?"}`).join("\n")}`,
    category: "amazon",
    link: "/repricer/bqool#liquidation",
  });
  return offen.length;
}

/** Rückkehr freigeben: Soll-Regel wieder die ursprüngliche (Min = effektiver Min), Liquidation beendet, Ausnahme weg. */
export async function rueckkehrFreigeben(tenantId: string, land: string, sku: string): Promise<string | null> {
  const [l] = await db.select().from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku)));
  if (!l?.regelVorher) return null;
  const { zuweisungSetzen } = await import("./export-service");
  await zuweisungSetzen(tenantId, { land: land as ExportLand, sku, regel: l.regelVorher, untergrenze: null, quelle: "hand", grund: "zurück nach Liquidation (Buy Box 14 Tage über effektivem Min + 3 %)" });
  await db.update(LQ).set({ status: "beendet", beendetAm: new Date(), ueberSeit: null, updatedAt: new Date() }).where(and(eq(LQ.tenantId, tenantId), eq(LQ.land, land), eq(LQ.sku, sku)));
  const nochAktiv = await db.select({ land: LQ.land }).from(LQ).where(and(eq(LQ.tenantId, tenantId), eq(LQ.sku, sku), inArray(LQ.status, ["vorgeschlagen", "aktiv", "zurueck_vorgeschlagen"])));
  if (!nochAktiv.length) await db.delete(A).where(and(eq(A.tenantId, tenantId), eq(A.sku, sku), like(A.grund, `${AUSNAHME_PREFIX}%`)));
  await rueckkehrAufgabe(tenantId);
  return l.regelVorher;
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
  const wegenMarge = rows.filter((r) => r.grund === "min_unter_marge" && r.status !== "vorgeschlagen");
  const unterBe = wegenMarge.filter((r) => r.minGesetzt !== null && r.breakEven !== null && r.minGesetzt < r.breakEven - 0.005);
  const rahmenJeSku = new Map<string, number>();
  for (const r of rows.filter((x) => x.status !== "vorgeschlagen")) rahmenJeSku.set(r.sku, Math.max(rahmenJeSku.get(r.sku) ?? 0, r.verlustBis ?? 0));
  return {
    anzahl: wegenMarge.length,
    unterBreakEven: unterBe.length,
    vorgeschlagen: rows.filter((r) => r.grund === "min_unter_marge" && r.status === "vorgeschlagen").length,
    rueckkehr: rows.filter((r) => r.status === "zurueck_vorgeschlagen").length,
    rahmenJeSku,
    zeilen: rows,
  };
}

export { liquidationsZeile } from "./export-logic";
