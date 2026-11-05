import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordJob, recordJobHinweis } from "@/lib/today/jobs";
import { readConn } from "./connection";
import { budgetEntscheidung, leererStand, naechsterReset, pauseText, SB_OBERGRENZE_AUTOMATIK, SbGestoppt, utcTag, zaehler, type BudgetStand, type SbPrio, type SbScope } from "./budget-logic";

// B29.2: Aufrufbudget im Seller-System – Zähler je UTC-Tag, Prüfung vor jedem sellerboard-Aufruf, Pause nach dem
// Limit-Fehler. Welche Priorität ein Aufruf hat, steht im Lauf-Kontext (geplant: verkauf/normal, sonst von Hand).

export const sbKontext = new AsyncLocalStorage<{ prio: SbPrio }>();
export const prioJetzt = (): SbPrio => sbKontext.getStore()?.prio ?? "hand";

/** Name des einen Eintrags „pausiert bis 01:00 Uhr“ in den Abrufen. */
export const PAUSE_JOB = "sellerboard: Tageslimit";

const A = () => schema.sellerboardAufrufe;
const P = () => schema.sellerboardPlan;

/** Obergrenze: Wert am Mandanten (zum Testen künstlich niedriger), sonst Umgebung, sonst 80. */
const obergrenzeVon = (wert: number | null | undefined) => wert ?? (Number(process.env.SELLERBOARD_BUDGET_AUTOMATIK) || SB_OBERGRENZE_AUTOMATIK);

export async function planLesen(tenantId: string) {
  const [p] = await db.select().from(P()).where(eq(P().tenantId, tenantId));
  const laeufe: Partial<Record<SbScope, Date>> = {};
  for (const [k, v] of Object.entries(p?.laeufe ?? {})) if (!k.includes(":")) laeufe[k as SbScope] = new Date(v);
  return { laeufe, pausiertBis: p?.pausiertBis ?? null, obergrenze: obergrenzeVon(p?.obergrenze) };
}

/** Beginn eines durchgeführten Laufs merken (übersprungene nicht – die werden nachgeholt). */
export async function laufMerken(tenantId: string, scopes: SbScope[], beginn: Date) {
  await planWerte(tenantId, Object.fromEntries(scopes.map((s) => [s, beginn.toISOString()])));
}

/** Weitere Werte im Plan (z. B. Fortschritt „produkte:seite“) – Schlüssel mit „:“ sind keine Abrufgruppen. */
export async function planWerteLesen(tenantId: string): Promise<Record<string, string>> {
  const [p] = await db.select({ l: P().laeufe }).from(P()).where(eq(P().tenantId, tenantId));
  return p?.l ?? {};
}

export async function planWerte(tenantId: string, patch: Record<string, string>) {
  if (!Object.keys(patch).length) return;
  await db
    .insert(P())
    .values({ tenantId, laeufe: patch })
    .onConflictDoUpdate({ target: [P().tenantId], set: { laeufe: sql`${P().laeufe} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() } });
}

/** Stand für die Budget-Entscheidung (heute, UTC). */
export async function budgetStand(tenantId: string, jetzt = new Date()): Promise<BudgetStand> {
  const [[a], plan] = await Promise.all([db.select().from(A()).where(and(eq(A().tenantId, tenantId), eq(A().tag, utcTag(jetzt)))), planLesen(tenantId)]);
  const s = leererStand(plan.obergrenze);
  s.pausiertBis = plan.pausiertBis;
  if (!a) return s;
  return { ...s, automatik: a.automatik, hand: a.hand, quotaGenutzt: a.quotaGenutzt, quotaLimit: a.quotaLimit, systemBeiQuota: a.systemBeiQuota };
}

/** Vor jedem sellerboard-Aufruf: weiter, oder SbGestoppt (pausiert / Tagesbudget). */
export async function budgetPruefen(tenantId: string, prio = prioJetzt(), jetzt = new Date()) {
  const e = budgetEntscheidung(await budgetStand(tenantId, jetzt), prio, jetzt);
  if (!e.ok) throw new SbGestoppt(e.art, e.bis, e.grund);
}

/** Einen beantworteten Aufruf zählen (geplant → Automatik, sonst „von Hand“). */
export async function aufrufZaehlen(tenantId: string, prio = prioJetzt(), jetzt = new Date()) {
  const hand = prio === "hand";
  await db
    .insert(A())
    .values({ tenantId, tag: utcTag(jetzt), automatik: hand ? 0 : 1, hand: hand ? 1 : 0 })
    .onConflictDoUpdate({ target: [A().tenantId, A().tag], set: hand ? { hand: sql`${A().hand} + 1`, updatedAt: jetzt } : { automatik: sql`${A().automatik} + 1`, updatedAt: jetzt } });
}

/** Übersprungene Abrufe des Tages zählen (für die Anzeige). */
export async function uebersprungenZaehlen(tenantId: string, jetzt = new Date()) {
  await db
    .insert(A())
    .values({ tenantId, tag: utcTag(jetzt), uebersprungen: 1 })
    .onConflictDoUpdate({ target: [A().tenantId, A().tag], set: { uebersprungen: sql`${A().uebersprungen} + 1`, updatedAt: jetzt } });
}

/** Stand laut sellerboard (usage_quota) merken – samt eigenem Zähler in diesem Moment. */
export async function quotaMerken(tenantId: string, q: { genutzt: number; limit: number }, jetzt = new Date()) {
  const tag = utcTag(jetzt);
  await db
    .insert(A())
    .values({ tenantId, tag, quotaGenutzt: q.genutzt, quotaLimit: q.limit, quotaAm: jetzt, systemBeiQuota: 0 })
    .onConflictDoUpdate({ target: [A().tenantId, A().tag], set: { quotaGenutzt: q.genutzt, quotaLimit: q.limit, quotaAm: jetzt, systemBeiQuota: sql`${A().automatik} + ${A().hand}`, updatedAt: jetzt } });
}

/**
 * sellerboard meldet „Tageslimit erreicht“: alle Abrufe bis zur Rücksetzung (00:00 UTC) pausieren – ein Eintrag
 * statt vieler Fehlerzeilen; Zeitpunkt und Datenstand für den Morgenbericht (B29.4) merken.
 */
export async function pauseSetzen(tenantId: string, jetzt = new Date()): Promise<Date> {
  const bis = naechsterReset(jetzt);
  const [p] = await db.select({ bis: P().pausiertBis }).from(P()).where(eq(P().tenantId, tenantId));
  if (p?.bis && p.bis >= bis) return p.bis;
  const conn = await readConn(tenantId).catch(() => null);
  const stand = conn?.config.salesSyncedAt ? new Date(conn.config.salesSyncedAt) : null;
  await db.insert(P()).values({ tenantId, pausiertBis: bis }).onConflictDoUpdate({ target: [P().tenantId], set: { pausiertBis: bis, updatedAt: jetzt } });
  await db
    .insert(A())
    .values({ tenantId, tag: utcTag(jetzt), limitErreichtAm: jetzt, datenStandBeiLimit: stand })
    .onConflictDoUpdate({ target: [A().tenantId, A().tag], set: { limitErreichtAm: sql`coalesce(${A().limitErreichtAm}, ${jetzt.toISOString()}::timestamptz)`, datenStandBeiLimit: sql`coalesce(${A().datenStandBeiLimit}, ${stand ? stand.toISOString() : null}::timestamptz)`, updatedAt: jetzt } });
  const { ABRUF_PLAN } = await import("@/lib/today/abruf-plan");
  await recordJobHinweis(tenantId, PAUSE_JOB, pauseText(bis), ABRUF_PLAN[PAUSE_JOB] ?? null);
  return bis;
}

/** Nach der Rücksetzung: Pause aufheben (der Eintrag gilt dann als erledigt). */
export async function pauseBeenden(tenantId: string, jetzt = new Date()): Promise<boolean> {
  const [p] = await db.select({ bis: P().pausiertBis }).from(P()).where(eq(P().tenantId, tenantId));
  if (!p?.bis || p.bis > jetzt) return false;
  await db.update(P()).set({ pausiertBis: null, updatedAt: jetzt }).where(eq(P().tenantId, tenantId));
  await recordJob(tenantId, PAUSE_JOB, null, 0);
  return true;
}

const berlin = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d) : null);
const tagText = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }).format(d);

/** Zähler für Anzeige und anbindungen_status, dazu der Hinweis für den Morgenbericht (Limit am Vortag erreicht). */
export async function zaehlerAnzeige(tenantId: string, jetzt = new Date()) {
  const gestern = utcTag(new Date(jetzt.getTime() - 86_400_000));
  const [stand, [g], [h]] = await Promise.all([
    budgetStand(tenantId, jetzt),
    db.select().from(A()).where(and(eq(A().tenantId, tenantId), eq(A().tag, gestern))),
    db.select({ uebersprungen: A().uebersprungen, quotaAm: A().quotaAm, limitErreichtAm: A().limitErreichtAm }).from(A()).where(and(eq(A().tenantId, tenantId), eq(A().tag, utcTag(jetzt)))),
  ]);
  const z = zaehler(stand);
  const limitGestern = g?.limitErreichtAm ?? null;
  return {
    ...z,
    tag_utc: utcTag(jetzt),
    obergrenze_automatik: stand.obergrenze,
    uebersprungen_heute: h?.uebersprungen ?? 0,
    stand_laut_sellerboard: h?.quotaAm ? berlin(h.quotaAm) : null,
    pausiert_bis: stand.pausiertBis && stand.pausiertBis > jetzt ? stand.pausiertBis : null,
    limit_heute_erreicht: h?.limitErreichtAm ? berlin(h.limitErreichtAm) : null,
    limit_gestern: limitGestern ? { erreicht_um: berlin(limitGestern), daten_von: berlin(g?.datenStandBeiLimit) ?? "unbekannt" } : null,
    morgenbericht_zeile: limitGestern ? `sellerboard-Limit am ${tagText(limitGestern)} erreicht, Daten von ${berlin(g?.datenStandBeiLimit) ?? berlin(limitGestern)}` : null,
  };
}
