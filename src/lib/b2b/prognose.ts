import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DealPrognose, OfferMarket } from "@/db/schema";
import { eurRates } from "@/lib/fx/ecb";
import { itemOffers } from "@/lib/integrations/clients/amazon";
import { MARKTPLATZ_IDS, verdichteAngebote, type Land } from "@/lib/amazon-markt/logic";
import { buyboxAnteile, MARKTPLAETZE, type Marktplatz } from "@/lib/keepa/auswertung";
import { keepaMarkt } from "@/lib/keepa/markt";
import { getSettings } from "@/lib/settings";
import { aktionsmuster, kundeAusPrognose, MWST, tief12 } from "./logic";

// Prognose je Marktplatz für einen Deal: Buy Box (aktuell, Ø 90 Tage, Tief 12 Monate), Verkäufe/Monat, Angebote,
// Amazon-Anteil an der Buy Box, Gebühren und Gewinn/ROI des Kunden beim Kundenpreis. DE/FR/IT/ES/UK aus Keepa
// (6 Std. Zwischenspeicher); NL/BE/PL/SE deckt Keepa nicht ab – dort die aktuellen Angebote von Amazon (SP-API).

const TAG = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type Gebuehren = { provision: number; fba: number; geschaetzt: boolean };

/** Provision und FBA-Gebühr: eigener Artikel (Report) → Angebot aus der Preisliste (Keepa) → Standard aus den Einstellungen. */
export async function gebuehrenFuer(tenantId: string, asin: string, market?: OfferMarket | null): Promise<Gebuehren> {
  const P = schema.products;
  const [p] = await db.select({ fba: P.fbaFee, ref: P.referralRate }).from(P).where(and(eq(P.tenantId, tenantId), eq(P.asin, asin)));
  const s = await getSettings(tenantId);
  const fbaEigen = p?.fba !== null && p?.fba !== undefined ? Number(p.fba) : null;
  const refEigen = p?.ref !== null && p?.ref !== undefined ? Number(p.ref) : null;
  const fba = fbaEigen ?? market?.fbaFee ?? s.pricing.defaultFbaFee;
  const provision = refEigen ?? (market?.referralPct ? market.referralPct / 100 : null) ?? s.pricing.referralRate;
  return { provision, fba, geschaetzt: fbaEigen === null && !market?.fbaFee };
}

const KEEPA_LAENDER = new Set(Object.keys(MARKTPLAETZE));

export type PrognoseErgebnis = { prognose: DealPrognose; titel: string | null; hinweise: string[] };

/** Prognose für alle gewählten Länder. Fehler eines Landes stehen im Feld `fehler`, die anderen laufen weiter. */
export async function dealPrognose(tenantId: string, asin: string, o: { laender: string[]; kundenpreis: number | null; prepGebuehr: number | null; market?: OfferMarket | null }, now = Date.now()): Promise<PrognoseErgebnis> {
  const geb = await gebuehrenFuer(tenantId, asin, o.market);
  const kurse = await eurRates();
  const inEur = (betrag: number | null, waehrung: string) => {
    if (betrag === null) return null;
    if (waehrung === "EUR") return betrag;
    const k = kurse[waehrung];
    return k ? r2(betrag / k) : null;
  };
  const prognose: DealPrognose = {};
  const hinweise: string[] = [];
  let titel: string | null = null;
  if (geb.geschaetzt) hinweise.push(`Gebühren geschätzt (Provision ${Math.round(geb.provision * 100)} %, FBA ${geb.fba.toFixed(2).replace(".", ",")} € aus den Einstellungen) – FBA-Gebühren je Land weichen ab.`);

  for (const land of o.laender) {
    const mwstSatz = MWST[land] ?? 0.2;
    const leer = { vk: null, vk90: null, tief12: null, vkEur: null, verkaeufeMonat: null, angeboteFba: null, angeboteFbm: null, amazonProzent: null, gebuehren: null, gebuehrenGeschaetzt: geb.geschaetzt, mwstSatz, waehrung: land === "UK" ? "GBP" : land === "PL" ? "PLN" : land === "SE" ? "SEK" : "EUR", gewinnKunde: null, roiKunde: null, aktionsmuster: null, quelle: null, abgerufen: null, fehler: null };
    let e: DealPrognose[string] = { ...leer };
    try {
      if (KEEPA_LAENDER.has(land)) {
        const mp = land as Marktplatz;
        const r = await keepaMarkt(tenantId, asin, mp, now);
        const st = r.stand;
        if (!st) e = { ...leer, quelle: "keepa", abgerufen: r.abgerufen.toISOString(), fehler: "Keepa kennt die ASIN hier nicht." };
        else {
          titel ??= st.titel;
          const bbTage = st.verlauf.map((z) => z[1]);
          const vk = st.aktuell.buybox ?? st.kennzahlen["30"].buybox.schnitt;
          const anteile = buyboxAnteile(st.buybox_verlauf, st.buybox_stats, MARKTPLAETZE[mp].amazonId, now - 90 * TAG, now);
          e = {
            ...leer,
            waehrung: st.waehrung,
            vk,
            vk90: st.kennzahlen["90"].buybox.schnitt,
            tief12: tief12(bbTage),
            vkEur: inEur(vk, st.waehrung),
            verkaeufeMonat: st.aktuell.monatlich_verkauft,
            angeboteFba: st.aktuell.angebote_fba,
            angeboteFbm: st.aktuell.angebote_fbm,
            amazonProzent: anteile ? anteile.amazon_prozent : null,
            aktionsmuster: aktionsmuster(bbTage)?.text ?? null,
            quelle: "keepa",
            abgerufen: r.abgerufen.toISOString(),
            fehler: r.warnung ?? null,
          };
        }
      } else if (land in MARKTPLATZ_IDS) {
        const r = await itemOffers(tenantId, asin, land as Land);
        const a = verdichteAngebote(r.payload, land as Land, r.eigeneId);
        const waehrung = a.waehrung ?? e.waehrung;
        e = {
          ...leer,
          waehrung,
          vk: a.buyboxPreis,
          vkEur: inEur(a.buyboxPreis, waehrung),
          angeboteFba: a.angeboteFba,
          angeboteFbm: a.angeboteFbm,
          amazonProzent: a.buyboxBei === "Amazon" ? 100 : a.buyboxPreis !== null ? 0 : null,
          quelle: "amazon",
          abgerufen: r.abgerufen.toISOString(),
          fehler: a.buyboxPreis === null ? "Keine Buy Box." : null,
        };
      } else e = { ...leer, fehler: "Marktplatz unbekannt." };
    } catch (err) {
      e = { ...leer, fehler: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
    }
    if (e.vkEur !== null) e.gebuehren = r2(e.vkEur * geb.provision + geb.fba);
    const k = kundeAusPrognose(e, o.kundenpreis, o.prepGebuehr);
    e.gewinnKunde = k.gewinn;
    e.roiKunde = k.roi;
    if (e.vk !== null && e.vkEur === null) e.fehler = `Kein Kurs für ${e.waehrung} – Gewinn nicht berechnet.`;
    prognose[land] = e;
  }
  return { prognose, titel, hinweise };
}

/** Kundenrechnung in einer gespeicherten Prognose neu rechnen (anderer Kundenpreis), ohne neue Abfragen. */
export function prognoseMitPreis(p: DealPrognose, kundenpreis: number | null, prepGebuehr: number | null): DealPrognose {
  const out: DealPrognose = {};
  for (const [land, e] of Object.entries(p)) {
    const k = kundeAusPrognose(e, kundenpreis, prepGebuehr);
    out[land] = { ...e, gewinnKunde: k.gewinn, roiKunde: k.roi };
  }
  return out;
}
