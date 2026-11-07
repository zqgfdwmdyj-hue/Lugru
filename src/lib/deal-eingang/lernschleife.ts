import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayIso } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { EINKAUF_MONATE, istLernTag, monatName, trefferquoteMonate, trefferZeile, verlustProdukte, vormonat, type Fehlkauf, type LernAntwort } from "./lernschleife-logic";

// B28.8 Monatliche Lernschleife Verlustprodukte: am 3. die Verlustprodukte des Vormonats (sellerboard je SKU), nur
// Artikel, die in den letzten 6 Monaten eingekauft wurden; Ludwig beantwortet je Produkt „Nie wieder“ / „Pech“ /
// „Weiß nicht warum“ (nur Inhaber, nicht die VA). Antworten fließen als „ähnlicher Fehlkauf“ in den Deal-Wert.

const L = schema.lernschleifeFragen;
const E = schema.dealEingaenge;

const monatsAnfang = (heute: string, zurueck: number) => {
  const d = new Date(`${heute.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - zurueck);
  return d.toISOString().slice(0, 10);
};

/** Einkäufe der letzten 6 Monate: SKUs, ASINs, letzter Einkauf und Lieferant je SKU/ASIN. */
async function einkaeufe(tenantId: string, heute: string) {
  const ab = monatsAnfang(heute, EINKAUF_MONATE);
  const LO = schema.lots;
  const P = schema.products;
  const PO = schema.purchaseOrders;
  const PI = schema.purchaseOrderItems;
  const [lose, positionen, deals] = await Promise.all([
    db.select({ sku: LO.sku, asin: P.asin, datum: LO.purchaseDate, supplierId: LO.supplierId }).from(LO).leftJoin(P, eq(P.id, LO.productId)).where(and(eq(LO.tenantId, tenantId), eq(LO.kind, "purchase"), gte(LO.purchaseDate, ab))).limit(20_000),
    db.select({ sku: PI.sku, asin: PI.asin, datum: PO.orderDate, supplierId: PO.supplierId }).from(PI).innerJoin(PO, eq(PO.id, PI.poId)).where(and(eq(PI.tenantId, tenantId), eq(PO.tenantId, tenantId), gte(PO.orderDate, ab))).limit(20_000),
    db.select({ zeilen: E.zeilen, am: E.gekauftAm }).from(E).where(and(eq(E.tenantId, tenantId), eq(E.status, "gekauft"), gte(E.gekauftAm, new Date(`${ab}T00:00:00Z`)))).limit(2000),
  ]);
  const asins = new Set<string>();
  const skus = new Set<string>();
  const letzter = new Map<string, string>();
  const lieferant = new Map<string, string>();
  const merke = (k: string, datum: string | null, supplierId: string | null) => {
    if (datum && (letzter.get(k) ?? "") < datum) letzter.set(k, datum);
    if (supplierId && !lieferant.has(k)) lieferant.set(k, supplierId);
  };
  for (const r of [...lose, ...positionen]) {
    if (r.sku) { skus.add(r.sku); merke(`S|${r.sku}`, r.datum, r.supplierId); }
    if (r.asin) { asins.add(r.asin); merke(`A|${r.asin}`, r.datum, r.supplierId); }
  }
  for (const d of deals) for (const z of d.zeilen) if (z.asin) { asins.add(z.asin); merke(`A|${z.asin}`, d.am?.toISOString().slice(0, 10) ?? null, null); }
  return { asins, skus, letzter, lieferant, lose };
}

/** Marke, Kategorie, Quelle und Angebote aus dem jüngsten Deal mit dieser ASIN (sonst Lieferant als Quelle). */
async function merkmaleZu(tenantId: string, asin: string | null) {
  if (!asin) return null;
  const [d] = await db
    .select({ zeilen: E.zeilen, quelle: E.quelle })
    .from(E)
    .where(and(eq(E.tenantId, tenantId), sql`${E.zeilen} @> ${JSON.stringify([{ asin }])}::jsonb`))
    .orderBy(sql`${E.gekauftAm} desc nulls last`, desc(E.createdAt))
    .limit(1);
  const z = d?.zeilen.find((x) => x.asin === asin);
  if (!z) return null;
  const m = z.merkmale ?? null;
  return { marke: m?.marke ?? z.angebot?.marke ?? null, kategorie: m?.kategorie ?? null, quelle: d.quelle ?? null, angebote: m?.angebote ?? null };
}

async function inhaberIds(tenantId: string) {
  const M = schema.memberships;
  const rows = await db.select({ id: M.userId }).from(M).where(and(eq(M.tenantId, tenantId), eq(M.role, "owner"), eq(M.readOnly, false), isNull(M.deaktiviertAm)));
  return rows.map((r) => r.id);
}

/**
 * Liste der Verlustprodukte des Vormonats anlegen (idempotent je Monat und Produkt). Neue Einträge → Push an den
 * Inhaber mit Link (ohne Discord – nur Ludwig beantwortet).
 */
export async function lernschleifeErstellen(tenantId: string, heute = todayIso(), o: { monat?: string; push?: boolean } = {}) {
  const monat = o.monat ?? vormonat(heute);
  const S = schema.sellerboardSkuMonths;
  const rows = await db.select({ sku: S.sku, asin: S.asin, name: S.name, units: S.units, sales: S.sales, netProfit: S.netProfit }).from(S).where(and(eq(S.tenantId, tenantId), eq(S.month, monat)));
  const ek = await einkaeufe(tenantId, heute);
  const liste = verlustProdukte(rows, { asins: ek.asins, skus: ek.skus });
  const supIds = [...new Set(liste.flatMap((p) => [p.asin ? ek.lieferant.get(`A|${p.asin}`) : undefined, ...p.skus.map((s) => ek.lieferant.get(`S|${s}`))]).filter((x): x is string => !!x))];
  const sups = supIds.length ? await db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).where(and(eq(schema.suppliers.tenantId, tenantId), inArray(schema.suppliers.id, supIds))) : [];
  const supName = new Map(sups.map((s) => [s.id, s.name]));
  let neu = 0;
  for (const p of liste.slice(0, 100)) {
    const schluessel = p.asin ? `A|${p.asin}` : `S|${p.skus[0]}`;
    const m = await merkmaleZu(tenantId, p.asin);
    const supId = (p.asin ? ek.lieferant.get(`A|${p.asin}`) : undefined) ?? p.skus.map((s) => ek.lieferant.get(`S|${s}`)).find(Boolean);
    const letzter = [p.asin ? ek.letzter.get(`A|${p.asin}`) : undefined, ...p.skus.map((s) => ek.letzter.get(`S|${s}`))].filter((x): x is string => !!x).sort().at(-1) ?? null;
    const r = await db
      .insert(L)
      .values({ tenantId, monat, schluessel, asin: p.asin, skus: p.skus, titel: p.titel, units: p.units, umsatz: p.umsatz, gewinn: p.gewinn, marge: p.marge, marke: m?.marke ?? null, kategorie: m?.kategorie ?? null, quelle: m?.quelle ?? (supId ? supName.get(supId) ?? null : null), angebote: m?.angebote ?? null, letzterEinkauf: letzter })
      .onConflictDoNothing()
      .returning({ id: L.id });
    neu += r.length;
  }
  if (neu && o.push !== false) {
    const ids = await inhaberIds(tenantId);
    const groesster = liste[0];
    const { melden } = await import("@/lib/push/service");
    await melden(
      tenantId,
      ids,
      {
        titel: `Lernschleife ${monatName(monat)}: ${liste.length} Verlustprodukt${liste.length === 1 ? "" : "e"}`,
        text: `Größter Verlust: ${(groesster?.titel ?? groesster?.asin ?? "Artikel").slice(0, 60)} (${groesster?.gewinn.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €). Je Produkt: Nie wieder / Pech / Weiß nicht warum.`,
        link: "/deal-eingang/lernen#lernschleife",
        art: "lernschleife",
      },
      { ohneDiscord: true },
    ).catch((e) => console.error("[Lernschleife] Push:", e instanceof Error ? e.message : e));
  }
  return { monat, produkte: liste.length, neu };
}

/** Täglich aus dem Hintergrund: am 3. des Monats die Liste anlegen. */
export async function lernschleifeTakt(tenantId: string, heute = todayIso()) {
  if (!istLernTag(heute)) return null;
  return lernschleifeErstellen(tenantId, heute);
}

export type LernFrage = typeof L.$inferSelect;

/** Fragen eines Monats (offene zuerst, größter Verlust zuerst). */
export async function lernschleifeFragen(tenantId: string, monat?: string) {
  const where = monat ? and(eq(L.tenantId, tenantId), eq(L.monat, monat)) : eq(L.tenantId, tenantId);
  const rows = await db.select().from(L).where(where).orderBy(desc(L.monat), L.gewinn).limit(300);
  return rows.sort((a, b) => b.monat.localeCompare(a.monat) || Number(a.antwort !== null) - Number(b.antwort !== null) || (a.gewinn ?? 0) - (b.gewinn ?? 0));
}

/** Antwort speichern – nur der Inhaber (Prüfung in der Server-Action). */
export async function lernschleifeBeantworten(tenantId: string, userId: string, id: string, antwort: LernAntwort, gruende: string[], freitext: string | null) {
  const r = await db
    .update(L)
    .set({ antwort, gruende: gruende.slice(0, 10).map((g) => g.slice(0, 80)), freitext: freitext?.trim().slice(0, 500) || null, beantwortetAm: new Date(), beantwortetVon: userId })
    .where(and(eq(L.tenantId, tenantId), eq(L.id, id)))
    .returning({ id: L.id, titel: L.titel, asin: L.asin });
  return r[0] ?? null;
}

/** Beantwortete Fehlkäufe der letzten 24 Monate für den Deal-Wert (ähnliche Deals: Abschlag bzw. Hinweis). */
export async function fehlkaeufe(tenantId: string): Promise<Fehlkauf[]> {
  const rows = await db
    .select({ titel: L.titel, asin: L.asin, marke: L.marke, kategorie: L.kategorie, quelle: L.quelle, angebote: L.angebote, antwort: L.antwort, letzterEinkauf: L.letzterEinkauf, monat: L.monat, am: L.beantwortetAm })
    .from(L)
    .where(and(eq(L.tenantId, tenantId), isNotNull(L.antwort), gte(L.createdAt, new Date(Date.now() - 730 * 86_400_000))))
    .orderBy(desc(L.beantwortetAm))
    .limit(500);
  return rows.map((r) => ({ datum: r.letzterEinkauf ?? r.am?.toISOString().slice(0, 10) ?? `${r.monat}-01`, titel: r.titel, asin: r.asin, marke: r.marke, kategorie: r.kategorie, quelle: r.quelle, angebote: r.angebote, antwort: r.antwort! }));
}

/**
 * Trefferquote je Einkaufsmonat: Anteil der Einkäufe (Chargen der letzten 6 Monate mit Verkäufen) mit Marge über der
 * Ziel-Marge – Marge aus den sellerboard-Monatswerten der SKU ab dem Einkaufsmonat.
 */
export async function trefferquote(tenantId: string, heute = todayIso()) {
  const s = (await getSettings(tenantId)).dealEingang;
  const ziel = s.zielMarge ?? 10;
  const ab = monatsAnfang(heute, EINKAUF_MONATE);
  const LO = schema.lots;
  const lose = await db.select({ sku: LO.sku, datum: LO.purchaseDate }).from(LO).where(and(eq(LO.tenantId, tenantId), eq(LO.kind, "purchase"), gte(LO.purchaseDate, ab))).limit(5000);
  const skus = [...new Set(lose.map((l) => l.sku))];
  const S = schema.sellerboardSkuMonths;
  const monate = skus.length ? await db.select({ sku: S.sku, month: S.month, sales: S.sales, netProfit: S.netProfit }).from(S).where(and(eq(S.tenantId, tenantId), inArray(S.sku, skus), gte(S.month, ab.slice(0, 7)))) : [];
  const jeSku = new Map<string, typeof monate>();
  for (const m of monate) jeSku.set(m.sku, [...(jeSku.get(m.sku) ?? []), m]);
  const einkaeufe = lose.filter((l) => l.datum).map((l) => {
    const ms = (jeSku.get(l.sku) ?? []).filter((m) => m.month >= l.datum!.slice(0, 7));
    const umsatz = ms.reduce((n, m) => n + (m.sales ?? 0), 0);
    const gewinn = ms.reduce((n, m) => n + (m.netProfit ?? 0), 0);
    return { monat: l.datum!.slice(0, 7), marge: umsatz > 0 ? (gewinn / umsatz) * 100 : null };
  });
  return { ziel, zielMarge: ziel, monate: trefferquoteMonate(einkaeufe, ziel) };
}

/** Morgenbericht am 3.: „Trefferquote Oktober 2026: 72 % (Ziel 80 %)“ für den Vormonat (sonst null). */
export async function trefferMorgenZeile(tenantId: string, heute = todayIso()) {
  if (!istLernTag(heute)) return null;
  const t = await trefferquote(tenantId, heute);
  return trefferZeile(t.monate.find((m) => m.monat === vormonat(heute)) ?? null);
}

/** Für Lernbericht und Werkzeug: Stand der Lernschleife (Monat, offen/beantwortet, Antworten, Trefferquote). */
export async function lernschleifeBericht(tenantId: string, heute = todayIso()) {
  const [fragen, t] = await Promise.all([lernschleifeFragen(tenantId), trefferquote(tenantId, heute)]);
  const letzterMonat = fragen[0]?.monat ?? null;
  const imMonat = fragen.filter((f) => f.monat === letzterMonat);
  const zaehl = (a: LernAntwort) => fragen.filter((f) => f.antwort === a).length;
  const gruende = new Map<string, number>();
  for (const f of fragen) for (const g of f.gruende ?? []) gruende.set(g, (gruende.get(g) ?? 0) + 1);
  return {
    monat: letzterMonat,
    offen: imMonat.filter((f) => !f.antwort).length,
    beantwortet: imMonat.filter((f) => f.antwort).length,
    antworten: { nie_wieder: zaehl("nie_wieder"), pech: zaehl("pech"), unklar: zaehl("unklar") },
    gruende: [...gruende.entries()].sort((a, b) => b[1] - a[1]).map(([grund, anzahl]) => ({ grund, anzahl })),
    trefferquote: t.monate,
    trefferZiel: 80,
    zielMarge: t.zielMarge,
    fragen,
  };
}

