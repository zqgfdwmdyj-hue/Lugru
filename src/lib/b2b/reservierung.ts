import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { todayIso } from "@/lib/dates";
import { pruefeReservierung, reservierbar, steuerFuer } from "./logic";
import { nachReservierung } from "./service";

// Reservieren im Kundenportal. Der Deal wird während der Prüfung gesperrt (FOR UPDATE), damit zwei gleichzeitige
// Reservierungen die Gesamtmenge nicht überschreiten. Je Kunde und Deal gibt es eine Reservierung – erneutes
// Reservieren ändert die Menge, solange noch keine Rechnung erstellt ist.

const D = schema.deals;
const R = schema.dealReservierungen;
const K = schema.b2bKunden;
const KP = schema.dealKundenpreise;

/** Preis für einen Kunden: eigener Kundenpreis, sonst der des Deals. */
export async function preisFuerKunde(tenantId: string, dealId: string, kundeId: string, standard: number | null): Promise<number | null> {
  const [p] = await db.select({ preis: KP.preisNetto }).from(KP).where(and(eq(KP.tenantId, tenantId), eq(KP.dealId, dealId), eq(KP.kundeId, kundeId)));
  return p?.preis ?? standard;
}

export async function reservieren(o: { tenantId: string; kundeId: string; dealId: string; menge: number; bedingungen: boolean }): Promise<{ ok: true; menge: number } | { ok: false; fehler: string }> {
  const s = await getSettings(o.tenantId);
  const heute = todayIso();
  const ergebnis = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from deals where id = ${o.dealId} and tenant_id = ${o.tenantId} for update`);
    const [d] = await tx.select().from(D).where(and(eq(D.tenantId, o.tenantId), eq(D.id, o.dealId)));
    if (!d) return { ok: false as const, fehler: "Deal nicht gefunden." };
    const [k] = await tx.select({ land: K.land, ustId: K.ustId, ustGueltig: K.ustGueltig, aktiv: K.aktiv }).from(K).where(and(eq(K.tenantId, o.tenantId), eq(K.id, o.kundeId)));
    if (!k?.aktiv) return { ok: false as const, fehler: "Ihr Zugang ist nicht aktiv." };
    const alle = await tx.select({ id: R.id, kundeId: R.kundeId, menge: R.menge, status: R.status }).from(R).where(and(eq(R.tenantId, o.tenantId), eq(R.dealId, o.dealId)));
    const meine = alle.find((r) => r.kundeId === o.kundeId);
    if (meine && !["reserviert", "storniert"].includes(meine.status)) return { ok: false as const, fehler: "Für diese Reservierung gibt es schon eine Rechnung – Änderungen bitte per Mail." };
    const p = pruefeReservierung(d, alle, o.kundeId, o.menge, heute, o.bedingungen);
    if (!p.ok) return p;
    const [kp] = await tx.select({ preis: KP.preisNetto }).from(KP).where(and(eq(KP.tenantId, o.tenantId), eq(KP.dealId, o.dealId), eq(KP.kundeId, o.kundeId)));
    const preis = kp?.preis ?? d.kundenpreisNetto;
    if (preis === null) return { ok: false as const, fehler: "Für diesen Deal ist noch kein Preis festgelegt." };
    const steuer = steuerFuer({ kundeLand: k.land, ustId: k.ustId, ustGueltig: k.ustGueltig, firmaLand: s.b2b.firma.land || "DE", satz: s.b2b.ustSatz });
    const werte = { menge: o.menge, preisNetto: preis, status: "reserviert" as const, bedingungenAm: new Date(), reverseCharge: steuer.art === "reverse_charge", updatedAt: new Date() };
    if (meine) await tx.update(R).set(werte).where(eq(R.id, meine.id));
    else await tx.insert(R).values({ tenantId: o.tenantId, dealId: o.dealId, kundeId: o.kundeId, ...werte });
    return { ok: true as const, menge: o.menge };
  });
  if (ergebnis.ok) await nachReservierung(o.tenantId, o.dealId).catch((e) => console.error("B2B nach Reservierung", e instanceof Error ? e.message : e));
  return ergebnis;
}

/** Stornieren durch den Kunden: nur solange der Deal offen ist und noch keine Rechnung existiert. */
export async function stornieren(o: { tenantId: string; kundeId: string; dealId: string }): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const [x] = await db
    .select({ id: R.id, status: R.status, dealStatus: D.status })
    .from(R)
    .innerJoin(D, eq(D.id, R.dealId))
    .where(and(eq(R.tenantId, o.tenantId), eq(R.kundeId, o.kundeId), eq(R.dealId, o.dealId)));
  if (!x) return { ok: false, fehler: "Keine Reservierung gefunden." };
  if (x.status !== "reserviert" || x.dealStatus !== "aktiv") return { ok: false, fehler: "Stornieren ist nicht mehr möglich (Deal geschlossen oder Rechnung erstellt) – bitte per Mail melden." };
  await db.update(R).set({ status: "storniert", updatedAt: new Date() }).where(eq(R.id, x.id));
  return { ok: true };
}

/** Was der Kunde zu einem Deal sehen darf: eigene Reservierung, freie Menge, eigene Grenzen. */
export async function portalDealStand(tenantId: string, kundeId: string, d: typeof D.$inferSelect) {
  const alle = await db.select({ kundeId: R.kundeId, menge: R.menge, status: R.status }).from(R).where(and(eq(R.tenantId, tenantId), eq(R.dealId, d.id)));
  const rb = reservierbar(d, alle, kundeId, todayIso());
  const [meine] = await db.select().from(R).where(and(eq(R.tenantId, tenantId), eq(R.dealId, d.id), eq(R.kundeId, kundeId)));
  const preis = await preisFuerKunde(tenantId, d.id, kundeId, d.kundenpreisNetto);
  return { ...rb, meine: meine ?? null, preis };
}
