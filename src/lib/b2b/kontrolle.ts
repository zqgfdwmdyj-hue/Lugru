import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Marktplatz } from "@/lib/keepa/auswertung";
import { keepaMarkt } from "@/lib/keepa/markt";
import { ekFuerMenge } from "./eingabe";
import { bewerte, bilanz } from "./logic";
import { KEEPA_LAENDER } from "./prognose";

// Erfolgskontrolle: 30 und 60 Tage nach Wareneingang den Ø-Buy-Box-Preis der letzten 30 Tage je Land mit der
// Prognose vergleichen (±10 % = wie prognostiziert). Bilanz je Deal: Umsatz, EK, unser Gewinn, Trefferquote.

const D = schema.deals;
const R = schema.dealReservierungen;
const KT = schema.dealKontrollen;
const B = schema.dealBestellungen;
const TAG = 86_400_000;
export const KONTROLL_TAGE = [30, 60] as const;

export async function erfolgskontrolle(tenantId: string, now = Date.now()): Promise<number> {
  const deals = await db.select().from(D).where(and(eq(D.tenantId, tenantId), isNotNull(D.angekommenAm), inArray(D.status, ["angekommen", "verteilt", "erledigt"])));
  let n = 0;
  for (const d of deals) {
    const vorhanden = new Set((await db.select({ tag: KT.tag, land: KT.land }).from(KT).where(and(eq(KT.tenantId, tenantId), eq(KT.dealId, d.id)))).map((k) => `${k.tag}|${k.land}`));
    for (const tag of KONTROLL_TAGE) {
      if (now - d.angekommenAm!.getTime() < tag * TAG) continue;
      for (const [land, p] of Object.entries(d.prognose)) {
        if (!KEEPA_LAENDER.has(land) || p.vk === null || vorhanden.has(`${tag}|${land}`)) continue;
        let ist: number | null = null;
        let angebote: number | null = null;
        try {
          const st = (await keepaMarkt(tenantId, d.asin, land as Marktplatz, now)).stand;
          ist = st?.kennzahlen["30"].buybox.schnitt ?? null;
          angebote = st ? (st.aktuell.angebote_fba ?? 0) + (st.aktuell.angebote_fbm ?? 0) : null;
        } catch {
          continue; // Keepa gerade nicht erreichbar – beim nächsten Lauf
        }
        const b = bewerte(p.vk, ist);
        await db.insert(KT).values({ tenantId, dealId: d.id, tag, land, prognoseVk: p.vk, bbSchnitt: ist, angebote, abweichungProzent: b.abweichungProzent, bewertung: b.bewertung }).onConflictDoNothing();
        n++;
      }
    }
  }
  return n;
}

export type DealBilanz = {
  id: string;
  nr: number;
  titel: string;
  asin: string;
  status: string;
  stueck: number;
  umsatzNetto: number;
  ekNetto: number;
  versand: number;
  gutschriften: number;
  gewinn: number;
  kontrollen: { tag: number; land: string; prognose: number | null; ist: number | null; abweichung: number | null; bewertung: string }[];
};

/** Bilanz je Deal (abgeschlossene Bestellungen) und gesamt – Trefferquote der Prognosen. */
export async function dealBilanzen(tenantId: string, dealId?: string) {
  const deals = await db
    .select()
    .from(D)
    .where(and(eq(D.tenantId, tenantId), inArray(D.status, ["bestellt", "angekommen", "verteilt", "erledigt"]), ...(dealId ? [eq(D.id, dealId)] : [])))
    .orderBy(desc(D.nr))
    .limit(200);
  const ids = deals.map((d) => d.id);
  const res = ids.length ? await db.select().from(R).where(and(eq(R.tenantId, tenantId), inArray(R.dealId, ids))) : [];
  const best = ids.length ? await db.select().from(B).where(and(eq(B.tenantId, tenantId), inArray(B.dealId, ids))) : [];
  const kontr = ids.length ? await db.select().from(KT).where(and(eq(KT.tenantId, tenantId), inArray(KT.dealId, ids))) : [];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const liste: DealBilanz[] = deals.map((d) => {
    const meine = res.filter((r) => r.dealId === d.id && ["bestellt", "angekommen", "an_prep", "erledigt"].includes(r.status));
    const stueck = meine.reduce((n, r) => n + (r.zugeteilt ?? r.menge), 0);
    const umsatz = meine.reduce((n, r) => n + (r.zugeteilt ?? r.menge) * r.preisNetto, 0);
    const b = best.find((x) => x.dealId === d.id);
    const bestellt = b?.menge ?? stueck;
    const ek = ekFuerMenge(d.ekNetto, d.staffel, bestellt) * stueck;
    const versand = (d.versandAnteil ?? 0) * stueck;
    const gutschriften = res.filter((r) => r.dealId === d.id).reduce((n, r) => n + (r.gutschriftBetrag ?? 0), 0);
    return {
      id: d.id,
      nr: d.nr,
      titel: d.titel,
      asin: d.asin,
      status: d.status,
      stueck,
      umsatzNetto: r2(umsatz),
      ekNetto: r2(ek),
      versand: r2(versand),
      gutschriften: r2(gutschriften),
      gewinn: r2(umsatz - ek - versand),
      kontrollen: kontr.filter((k) => k.dealId === d.id).sort((a, b) => a.tag - b.tag || a.land.localeCompare(b.land)).map((k) => ({ tag: k.tag, land: k.land, prognose: k.prognoseVk, ist: k.bbSchnitt, abweichung: k.abweichungProzent, bewertung: k.bewertung })),
    };
  });
  const summe = liste.reduce((s, x) => ({ stueck: s.stueck + x.stueck, umsatz: r2(s.umsatz + x.umsatzNetto), gewinn: r2(s.gewinn + x.gewinn) }), { stueck: 0, umsatz: 0, gewinn: 0 });
  return { liste, summe, treffer: bilanz(liste.flatMap((x) => x.kontrollen.map((k) => ({ bewertung: k.bewertung, abweichungProzent: k.abweichung })))) };
}
