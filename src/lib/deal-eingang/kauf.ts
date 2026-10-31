import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DealEingangZeile } from "@/db/tables/deal-eingang";
import { addDaysIso, todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { angebotsLink, bestellbestaetigung, budgetPruefen, kaufText, passtZuDeal, type Budget } from "./kauf-logic";
import { wertSchwelleFuer } from "./logic";
import { DealEingangFehler } from "./service";

// Abschnitt 10 „Kaufen mit einem Tap“: Budget-Grenzen in der Prüfung, Kauf-Meldung mit Direktlink, „gekauft“ per
// Knopf, Sprache/SMS, Claude oder Bestellbestätigungs-Mail → Bestellung „bestellt“ (Wareneingang und Rechnung
// erwartet). Kein automatischer Kauf.

const E = schema.dealEingaenge;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Montag dieser Woche (Europe/Berlin) als ISO-Tag. */
function wochenAnfang(heute: string): string {
  const wt = new Date(`${heute}T12:00:00Z`).getUTCDay() || 7;
  return addDaysIso(heute, 1 - wt);
}
const berlinTag = (d = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

/** Schon ausgegeben (gekaufte Deals) heute und in dieser Woche. */
export async function budgetVerbraucht(tenantId: string, jetzt = new Date()): Promise<{ tag: number; woche: number }> {
  const heute = berlinTag(jetzt);
  const mo = wochenAnfang(heute);
  const rows = await db
    .select({ tag: sql<string>`to_char(${E.gekauftAm} at time zone 'Europe/Berlin', 'YYYY-MM-DD')`, summe: sql<number>`coalesce(${E.gekauftMenge}, 0) * coalesce(${E.gekauftPreis}, 0)` })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), gte(E.gekauftAm, new Date(`${mo}T00:00:00Z`))));
  let tag = 0;
  let woche = 0;
  for (const r of rows) {
    if (r.tag < mo) continue;
    woche += Number(r.summe);
    if (r.tag === heute) tag += Number(r.summe);
  }
  return { tag: r2(tag), woche: r2(woche) };
}

export async function budgetEinstellung(tenantId: string): Promise<Budget> {
  const d = (await getSettings(tenantId)).dealEingang;
  return { jeDeal: d.budgetJeDeal ?? 0, jeTag: d.budgetJeTag ?? 0, jeWoche: d.budgetJeWoche ?? 0 };
}

/** In der Prüfung: über der Budget-Grenze → höchstens Gelb mit Hinweis (Gründe bleiben ≤ 3). */
export async function budgetAnwenden(tenantId: string, zeilen: DealEingangZeile[], jetzt = new Date()) {
  const b = await budgetEinstellung(tenantId);
  if (!(b.jeDeal > 0 || b.jeTag > 0 || b.jeWoche > 0)) return;
  const v = await budgetVerbraucht(tenantId, jetzt);
  for (const z of zeilen) {
    if (z.ampel === "rot") continue;
    const p = budgetPruefen(z.kapitalbedarf, b, v);
    if (p.ok || !p.hinweis) continue;
    z.ampel = "gelb";
    z.gruende = [p.hinweis, ...z.gruende.filter((g) => !g.startsWith("Budget:"))].slice(0, 3);
  }
}

/**
 * Meldung bei Grün (bzw. Deal-Wert über der Schwelle): Direktlink zum Angebot, Menge, max. EK, Restbudget der Woche,
 * Ablauf. Knöpfe: „Zum Angebot“ und „Gekauft …“ (öffnet die Seite mit dem Kauf-Formular).
 */
export async function kaufMeldung(e: typeof E.$inferSelect): Promise<{ text: string; aktionen: { aktion: string; titel: string; link: string }[] } | null> {
  const s = (await getSettings(e.tenantId)).dealEingang;
  const schwelle = wertSchwelleFuer(e.quelle, s);
  const kandidaten = e.zeilen.filter((z) => z.asin && (z.ampel === "gruen" || (z.ampel !== "rot" && (z.wert?.wert ?? 0) >= schwelle)));
  const z = kandidaten.sort((a, b) => (b.gewinn ?? 0) * (b.empfohlen ?? 1) - (a.gewinn ?? 0) * (a.empfohlen ?? 1))[0];
  if (!z) return null;
  const b = await budgetEinstellung(e.tenantId);
  const v = await budgetVerbraucht(e.tenantId);
  const rest = budgetPruefen(z.kapitalbedarf, b, v).restWoche;
  const link = angebotsLink(e.rohtext, z.asin, z.bestesLand);
  const text = kaufText({ titel: z.titel, name: z.angebot.name, ekNetto: z.ekNetto, bestesLand: z.bestesLand, roi: z.roi, gewinn: z.gewinn, empfohlen: z.empfohlen, kapitalbedarf: z.kapitalbedarf, maxEk: z.maxEk, gueltigBis: z.angebot.gueltigBis }, { restWoche: rest, wert: z.wert?.wert ?? null });
  const aktionen = [...(link ? [{ aktion: "angebot", titel: "Zum Angebot", link }] : []), { aktion: "gekauft", titel: "Gekauft …", link: `/deal-eingang/${e.id}?zeile=${z.nr}#gekauft` }];
  return { text, aktionen };
}

/** Wem gehört der Kauf (Bestellung anlegen)? Person des Eingangs, sonst der Inhaber. */
async function personFuer(tenantId: string, userId: string | null): Promise<string | null> {
  if (userId) return userId;
  const [o] = await db.select({ id: schema.memberships.userId }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))).limit(1);
  return o?.id ?? null;
}

export type Gekauft = { menge: number; preis: number | null; nr?: number | null; weg: "knopf" | "mail" | "sprache" | "claude" | "sms"; ref?: string | null; bestellnr?: string | null; shop?: string | null };

/**
 * Deal als gekauft markieren (Menge, Preis netto je Stück). Legt die Einkaufs-Bestellung als „bestellt“ an (bzw. setzt
 * den Entwurf aus „In Bestellvorschläge“ auf bestellt): Wareneingang wird als Aufgabe erwartet, die Rechnung über die
 * Shop-Bestellnummer automatisch zugeordnet. Zweites „gekauft“ ändert nur Menge/Preis.
 */
export async function alsGekauft(tenantId: string, id: string, g: Gekauft, userId: string | null = null): Promise<{ bestellungId: string | null; zeile: number | null }> {
  if (!(g.menge > 0) || g.menge > 100_000) throw new DealEingangFehler("Bitte eine Menge angeben.");
  if (g.preis !== null && !(g.preis > 0 && g.preis < 100_000)) throw new DealEingangFehler("Preis unplausibel.");
  const [e] = await db.select().from(E).where(and(eq(E.tenantId, tenantId), eq(E.id, id)));
  if (!e) throw new DealEingangFehler("Eingang nicht gefunden.");
  const zeile = (g.nr ? e.zeilen.find((z) => z.nr === g.nr) : null) ?? e.zeilen.filter((z) => z.asin).sort((a, b) => (a.ampel === "gruen" ? -1 : 0) - (b.ampel === "gruen" ? -1 : 0))[0] ?? null;
  const preis = g.preis ?? zeile?.ekNetto ?? zeile?.angebot.ek ?? null;
  const schonGekauft = e.status === "gekauft" && e.gekauftAm;
  await db
    .update(E)
    .set({ status: "gekauft", gekauftMenge: g.menge, gekauftPreis: preis, gekauftAm: e.gekauftAm ?? new Date(), gekauftWeg: e.gekauftWeg ?? g.weg, gekauftRef: g.ref ?? e.gekauftRef, entschiedenAm: e.entschiedenAm ?? new Date() })
    .where(eq(E.id, e.id));
  if (schonGekauft || !zeile?.asin || !preis) return { bestellungId: e.bestellungId, zeile: zeile?.nr ?? null };

  // Bestellung: Entwurf weiterverwenden, sonst neu – Status „bestellt“, erwartet in 7 Tagen (bzw. Lieferzeit).
  const P = await import("@/lib/purchasing/service");
  const person = await personFuer(tenantId, userId ?? e.userId);
  const tage = Number(zeile.angebot.lieferzeit?.match(/(\d{1,2})\s*(?:tag|day|werktag)/i)?.[1] ?? 7) || 7;
  const PO = schema.purchaseOrders;
  const POI = schema.purchaseOrderItems;
  // Entwurf aus „In Bestellvorschläge“: nur übernehmen, wenn er allein diesen Artikel enthält – sonst würden andere
  // Vorschläge mitbestellt. Andernfalls neue Bestellung und den Artikel aus dem Entwurf nehmen.
  let poId: string | null = null;
  const [alt] = e.bestellungId ? await db.select({ status: PO.status }).from(PO).where(and(eq(PO.tenantId, tenantId), eq(PO.id, e.bestellungId))) : [];
  const altItems = alt?.status === "draft" ? await db.select({ id: POI.id, asin: POI.asin }).from(POI).where(and(eq(POI.tenantId, tenantId), eq(POI.poId, e.bestellungId!))) : [];
  if (alt?.status === "draft" && altItems.length && altItems.every((i) => i.asin === zeile.asin)) {
    poId = e.bestellungId;
  } else {
    if (!person) return { bestellungId: null, zeile: zeile.nr };
    poId = await P.createPurchaseOrder(tenantId, person, { supplier: g.shop ?? e.quelle ?? "Deal-Eingang", supplierOrderNo: g.bestellnr ?? undefined, expectedDate: addDaysIso(todayIso(), tage), notes: `Aus dem Deal-Eingang (${g.weg === "mail" ? "Bestellbestätigung" : "gekauft"}).` });
    await P.addItem(tenantId, poId, { asin: zeile.asin, quantity: g.menge, unitCostGross: r2(preis * 1.19), title: zeile.titel ?? zeile.angebot.name });
    for (const i of altItems.filter((x) => x.asin === zeile.asin)) await P.removeItem(tenantId, i.id);
  }
  await P.updatePurchaseOrder(tenantId, poId!, { status: "ordered", supplierOrderNo: g.bestellnr ?? undefined, expectedDate: addDaysIso(todayIso(), tage) });
  await db.update(E).set({ bestellungId: poId }).where(eq(E.id, e.id));
  return { bestellungId: poId, zeile: zeile.nr };
}

/**
 * Bestellbestätigung (Amazon/Shop) aus dem Postfach: passenden offenen Deal der letzten 14 Tage (ASIN, sonst Titel)
 * als gekauft markieren. Gibt die Deal-ID zurück oder null.
 */
export async function gekauftAusMail(tenantId: string, m: { messageKey: string; fromAddress: string; fromName?: string | null; subject: string; text: string }): Promise<string | null> {
  const b = bestellbestaetigung({ von: `${m.fromName ?? ""} <${m.fromAddress}>`, betreff: m.subject, text: m.text });
  if (!b) return null;
  const offen = await db
    .select()
    .from(E)
    .where(and(eq(E.tenantId, tenantId), inArray(E.status, ["neu", "bestellvorschlag"]), eq(E.historisch, false), isNull(E.gekauftAm), gte(E.createdAt, new Date(Date.now() - 14 * 86_400_000))))
    .orderBy(desc(E.createdAt))
    .limit(200);
  for (const pos of b.positionen) {
    for (const e of offen) {
      const z = e.zeilen.find((x) => passtZuDeal(pos, { asin: x.asin, titel: x.titel, name: x.angebot.name }, m.text));
      if (!z) continue;
      await alsGekauft(tenantId, e.id, { menge: pos.menge, preis: pos.preis, nr: z.nr, weg: "mail", ref: `mail:${m.messageKey}`.slice(0, 200), bestellnr: b.bestellnr, shop: b.shop });
      return e.id;
    }
  }
  return null;
}
