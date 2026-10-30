import "server-only";
import { and, eq, gte, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDaysIso } from "@/lib/dates";
import { resolveSystemTask, upsertSystemTask } from "@/lib/tasks/system";
import { breakEvenJeSku } from "./kapital-service";
import { ausnahmeAktiv, fensterMitDaten, pruefeVerlust, verlustAufgabe, wochenSumme, VERLUST_REGEL, type TagWert, type VerlustFall } from "./verlust";

// Verlust-Stopp: täglich nach dem sellerboard-Abgleich. Fälle → wichtige Aufgabe je SKU (mit Break-even, Buy Box,
// BQool-Regel); bewusste Verlustverkäufe stehen als Ausnahme mit Wochensumme daneben.

export type VerlustFallMehr = VerlustFall & {
  breakEven: number | null;
  buybox: { preis: number | null; quelle: string; amazon?: boolean } | null;
  bqool: { regel: string | null; min: number | null; max: number | null; marktplatz: string } | null;
  aufgabe: { titel: string; notiz: string };
};
export type VerlustAusnahme = { sku: string; name: string | null; grund: string; bis: string | null; aktiv: boolean; angelegtAm: Date; woche: { summe: number; stueck: number; tageMitDaten: number } };

export async function verlustStopp(tenantId: string, heute: string): Promise<{ faelle: VerlustFallMehr[]; ausnahmen: VerlustAusnahme[]; stand: Date | null; tageMitDaten: string[]; fenster: string[]; bqoolExport: boolean }> {
  const t = tenantId;
  const D = schema.sellerboardSkuTage;
  const rows = await db.select().from(D).where(and(eq(D.tenantId, t), gte(D.day, addDaysIso(heute, -8))));
  const werte: TagWert[] = rows.map((r) => ({ day: r.day, sku: r.sku, asin: r.asin, name: r.name, units: r.units, netProfit: r.netProfit, avgPrice: r.avgPrice }));
  const fenster = fensterMitDaten(werte, heute);
  const tageMitDaten = fenster.filter((d) => rows.some((r) => r.day === d));
  const stand = rows.reduce<Date | null>((m, r) => (!m || r.syncedAt > m ? r.syncedAt : m), null);
  const A = schema.verlustAusnahmen;
  const ausn = await db.select().from(A).where(eq(A.tenantId, t));
  const aktiv = new Set(ausn.filter((a) => ausnahmeAktiv(a, heute)).map((a) => a.sku));
  const roh = pruefeVerlust(werte, heute, undefined, fenster).filter((f) => !aktiv.has(f.sku));

  const skus = roh.map((f) => f.sku);
  const asins = [...new Set(roh.map((f) => f.asin).filter((a): a is string => !!a))];
  const [[bqAlle], be, hk, kc, bq] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.bqoolListings).where(eq(schema.bqoolListings.tenantId, t)),
    breakEvenJeSku(t, skus),
    asins.length ? db.select().from(schema.hebelKeepa).where(and(eq(schema.hebelKeepa.tenantId, t), inArray(schema.hebelKeepa.asin, asins))) : [],
    asins.length ? db.select({ asin: schema.keepaCache.asin, stand: schema.keepaCache.stand }).from(schema.keepaCache).where(and(eq(schema.keepaCache.tenantId, t), eq(schema.keepaCache.marktplatz, "DE"), inArray(schema.keepaCache.asin, asins))) : [],
    skus.length ? db.select().from(schema.bqoolListings).where(and(eq(schema.bqoolListings.tenantId, t), inArray(schema.bqoolListings.sku, skus))) : [],
  ]);
  const faelle = roh.map((f) => {
    const h = f.asin ? hk.find((x) => x.asin === f.asin) : undefined;
    const k = f.asin ? kc.find((x) => x.asin === f.asin)?.stand : undefined;
    const buybox = h ? { preis: h.buyBoxPrice, quelle: `Keepa (${h.fetchedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })})`, amazon: h.buyBoxIsAmazon } : k ? { preis: k.aktuell.buybox ?? null, quelle: "Keepa (Produktabruf)" } : null;
    const b = bq.filter((x) => x.sku === f.sku).sort((x, y) => (x.marktplatz === "DE" ? -1 : y.marktplatz === "DE" ? 1 : 0))[0];
    const bqool = b ? { regel: b.regel, min: b.min, max: b.max, marktplatz: b.marktplatz } : null;
    const breakEven = be.get(f.sku) ?? null;
    return { ...f, breakEven, buybox, bqool, aufgabe: verlustAufgabe(f, { breakEven, buybox, bqool, bqoolExport: bqAlle.n > 0 }) };
  });
  const namen = new Map(rows.map((r) => [r.sku, r.name]));
  const ausnahmen = ausn
    .map((a) => ({ sku: a.sku, name: namen.get(a.sku) ?? null, grund: a.grund, bis: a.bis, aktiv: ausnahmeAktiv(a, heute), angelegtAm: a.angelegtAm, woche: wochenSumme(werte, a.sku, heute) }))
    .sort((x, y) => x.woche.summe - y.woche.summe);
  return { faelle, ausnahmen, stand, tageMitDaten, fenster, bqoolExport: bqAlle.n > 0 };
}

/**
 * Aufgaben abgleichen: je Fall eine wichtige Aufgabe „verlust-<SKU>“. Erledigt, aber danach wieder ein voller
 * Verlusttag → wieder offen. Kein Fall mehr (oder Ausnahme) → automatisch erledigt. Ohne Tagesdaten: nichts ändern.
 */
export async function refreshVerlustTasks(tenantId: string, heute: string): Promise<number> {
  const v = await verlustStopp(tenantId, heute);
  if (!v.tageMitDaten.length) return 0;
  const T = schema.tasks;
  const offen = await db.select({ key: T.systemKey, status: T.status, completedAt: T.completedAt }).from(T).where(and(eq(T.tenantId, tenantId), like(T.systemKey, "verlust-%")));
  const jetzt = new Set<string>();
  for (const f of v.faelle) {
    const key = `verlust-${f.sku}`.slice(0, 200);
    jetzt.add(key);
    await upsertSystemTask(db, tenantId, key, { title: `Verlust-Stopp: ${f.name ?? f.sku}`.slice(0, 200), notes: f.aufgabe.notiz, priority: "critical", category: "geld", link: `/verlust?q=${encodeURIComponent(f.sku)}`, dueDate: heute });
    const alt = offen.find((o) => o.key === key);
    const letzterVerlust = [...f.tage].reverse().find((x) => x.gewinn !== null && x.gewinn < 0)?.day;
    if (alt?.status === "done" && alt.completedAt && letzterVerlust && alt.completedAt < new Date(`${letzterVerlust}T00:00:00Z`)) {
      await db.update(T).set({ status: "open", completedAt: null }).where(and(eq(T.tenantId, tenantId), eq(T.systemKey, key)));
    }
  }
  for (const o of offen) if (o.key && o.status === "open" && !jetzt.has(o.key)) await resolveSystemTask(db, tenantId, o.key);
  return v.faelle.length;
}

export { VERLUST_REGEL };
