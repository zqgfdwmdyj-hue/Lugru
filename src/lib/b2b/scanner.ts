import "server-only";
import { fbaNachGroesse } from "@/lib/reports/lagergebuehren";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { eurRates } from "@/lib/fx/ecb";
import type { KeepaStand, Marktplatz } from "@/lib/keepa/auswertung";
import { keepaMarkt } from "@/lib/keepa/markt";
import { getSettings } from "@/lib/settings";
import { econOf } from "@/lib/suppliers/offer-econ";
import { kundeAusPrognose, MWST } from "./logic";
import { inEurMit, KEEPA_LAENDER, keepaEintrag } from "./prognose";
import { kundenpreisVorschlag, type Ampel } from "./preislisten-logik";
import { b2bPrepJeStueck } from "@/lib/shipping/prep";

// Preislisten-Scanner für B2B-Deals: jedes Angebot einer Preisliste je Marktplatz bewerten – Buy Box (aktuell,
// Ø 90 T., Tief 12 M.), Verkäufe/Monat, Angebote, Amazon-Anteil, Gebühren, Gewinn/ROI beim EK, Kundenpreis-
// Vorschlag mit Ampel, Aktionsmuster, Packungs-Warnungen. Marktdaten aus dem Keepa-Zwischenspeicher (24 Std.);
// fehlende werden im Hintergrund nachgeladen. NL/BE/PL/SE kennt Keepa nicht – dort erst im Deal (Amazon live).

export const SCAN_MAX_ALTER_STD = 24;
const O = schema.supplierOffers;
const F = schema.supplierFeeds;
const C = schema.keepaCache;

export type ScanLand = {
  land: string;
  vk: number | null;
  vkEur: number | null;
  waehrung: string;
  vk90: number | null;
  tief12: number | null;
  verkaeufe: number | null;
  angebote: number | null;
  amazonProzent: number | null;
  gebuehren: number | null;
  mwst: number;
  gewinnBeiEk: number | null;
  roiBeiEk: number | null;
  margeBeiEk: number | null;
  aktionsmuster: string | null;
  vorschlag: { preis: number | null; marge: number | null; ampel: Ampel };
};
export type ScanZeile = {
  offerId: string;
  sku: string;
  titel: string;
  ean: string | null;
  asin: string | null;
  ekJeVerkauf: number | null;
  einheiten: number;
  bestand: number | null;
  moq: number | null;
  warnungen: string[];
  laender: ScanLand[];
  bester: ScanLand | null;
  ampel: Ampel;
  fehlend: string[];
  dealId: string | null;
};

const asinVon = (o: { asin: string | null; market: { asin: string | null } | null }) => o.asin ?? o.market?.asin ?? null;

export async function preislisteAuswerten(tenantId: string, feedId: string, o: { limit?: number } = {}) {
  const [feed] = await db.select().from(F).where(and(eq(F.tenantId, tenantId), eq(F.id, feedId)));
  if (!feed) return null;
  const s = await getSettings(tenantId);
  const laender = s.b2b.marktplaetze.filter((l) => KEEPA_LAENDER.has(l));
  const offers = await db
    .select()
    .from(O)
    .where(and(eq(O.tenantId, tenantId), eq(O.feedId, feedId), eq(O.active, true)))
    .orderBy(desc(O.updatedAt))
    .limit(o.limit ?? 600);
  const asins = [...new Set(offers.map(asinVon).filter((a): a is string => !!a))];
  const grenze = new Date(Date.now() - SCAN_MAX_ALTER_STD * 3600_000);
  const cache = asins.length && laender.length ? await db.select({ asin: C.asin, mp: C.marktplatz, stand: C.stand, am: C.abgerufenAm, gefunden: C.gefunden }).from(C).where(and(eq(C.tenantId, tenantId), inArray(C.asin, asins), inArray(C.marktplatz, laender as Marktplatz[]), gt(C.abgerufenAm, grenze))) : [];
  const stand = new Map(cache.map((c) => [`${c.asin}|${c.mp}`, c]));
  const deals = asins.length ? await db.select({ id: schema.deals.id, asin: schema.deals.asin }).from(schema.deals).where(and(eq(schema.deals.tenantId, tenantId), inArray(schema.deals.asin, asins), sql`${schema.deals.status} not in ('verfallen')`)) : [];
  const dealZu = new Map(deals.map((d) => [d.asin, d.id]));
  const inEur = inEurMit(await eurRates());
  // Solange die SP-API fehlt: FBA-Gebühr nach Größenklasse aus dem Lagergebühren-Bericht (Ø eigener Artikel derselben Klasse).
  const nachGroesse = await fbaNachGroesse(tenantId, asins.filter((a) => !offers.some((o) => asinVon(o) === a && o.market?.fbaFee)));
  const now = Date.now();
  const costPct = Number(feed.mapping.costPct ?? 0) || 0;
  const vatPct = feed.mapping.vatPct ? Number(feed.mapping.vatPct) || null : null;
  const zeilen: ScanZeile[] = offers.map((of) => {
    const asin = asinVon(of);
    const e = econOf({ price: of.price, title: of.title, url: of.url, market: of.market, pricesGross: feed.pricesGross, costPct, vatPct, amazonQty: of.amazonQty, matchReview: of.matchReview }, s);
    const ek = e.costPerSale ?? null;
    const warnungen = [...e.issues];
    if (e.unitsPerSale > 1) warnungen.push(`Amazon-Angebot = ${e.unitsPerSale} Stück – EK je Verkauf ${ek?.toFixed(2).replace(".", ",")} €.`);
    if (e.caseQty > 1) warnungen.push(`Liste nennt Karton/Gebinde à ${e.caseQty} – Preis je Einheit umgerechnet.`);
    if (e.implausible) warnungen.push("ROI unplausibel hoch – Packungsgröße prüfen.");
    const provision = of.market?.referralPct ? of.market.referralPct / 100 : s.pricing.referralRate;
    const groesse = asin ? nachGroesse.get(asin) : undefined;
    const fba = of.market?.fbaFee ?? groesse?.fba ?? s.pricing.defaultFbaFee;
    if (!of.market?.fbaFee && groesse) warnungen.push(`FBA-Gebühr geschätzt nach Größenklasse „${groesse.groesse}“ (Ø eigener Artikel, Lagergebühren-Bericht): ${groesse.fba.toFixed(2).replace(".", ",")} €.`);
    const fehlend: string[] = [];
    const ls: ScanLand[] = [];
    if (asin)
      for (const land of laender) {
        const c = stand.get(`${asin}|${land}`);
        if (!c) {
          fehlend.push(land);
          continue;
        }
        if (!c.gefunden || !c.stand) continue;
        const k = keepaEintrag(c.stand as KeepaStand, land as Marktplatz, inEur, now);
        const gebuehren = k.vkEur !== null ? Math.round((k.vkEur * provision + fba) * 100) / 100 : null;
        const mwst = MWST[land] ?? 0.19;
        const beiEk = ek !== null ? kundeAusPrognose({ vkEur: k.vkEur, mwstSatz: mwst, gebuehren }, ek, 0) : { gewinn: null, roi: null, marge: null };
        const vorschlag = kundenpreisVorschlag({ vkEur: k.vkEur, land, gebuehren, minRoi: s.b2b.minKundenRoi, prep: b2bPrepJeStueck(s.b2b.prepGebuehr, s.prep.preisliste).betrag, ek: ek ?? 0, versandAnteil: s.b2b.versandAnteil, minMargeProzent: s.b2b.minMarge * 100, amazonProzent: k.amazonProzent });
        ls.push({ land, vk: k.vk, vkEur: k.vkEur, waehrung: k.waehrung, vk90: k.vk90, tief12: k.tief12, verkaeufe: k.verkaeufeMonat, angebote: k.angeboteFba === null && k.angeboteFbm === null ? null : (k.angeboteFba ?? 0) + (k.angeboteFbm ?? 0), amazonProzent: k.amazonProzent, gebuehren, mwst, gewinnBeiEk: beiEk.gewinn, roiBeiEk: beiEk.roi, margeBeiEk: beiEk.marge, aktionsmuster: k.aktionsmuster, vorschlag });
      }
    const bester = [...ls].sort((a, b) => (b.vorschlag.marge ?? -Infinity) - (a.vorschlag.marge ?? -Infinity))[0] ?? null;
    if (bester?.aktionsmuster) warnungen.push(`${bester.land}: ${bester.aktionsmuster}`);
    return {
      offerId: of.id,
      sku: of.supplierSku,
      titel: of.market?.title ?? of.title ?? of.supplierSku,
      ean: of.ean,
      asin,
      ekJeVerkauf: ek,
      einheiten: e.unitsPerSale,
      bestand: of.stock,
      moq: of.moq,
      warnungen,
      laender: ls,
      bester,
      ampel: !asin || !bester ? "rot" : warnungen.length && bester.vorschlag.ampel === "gruen" ? "gelb" : bester.vorschlag.ampel,
      fehlend,
      dealId: asin ? (dealZu.get(asin) ?? null) : null,
    };
  });
  const mitDaten = zeilen.filter((z) => z.laender.length).length;
  return { feed, laender, zeilen, stand: { angebote: zeilen.length, mitAsin: zeilen.filter((z) => z.asin).length, mitDaten, offen: zeilen.reduce((n, z) => n + z.fehlend.length, 0) } };
}

/** Fehlende/alte Keepa-Daten je ASIN und Land nachladen (begrenzt; läuft im Hintergrund). */
export async function scanNachladen(tenantId: string, feedId: string, max = 60): Promise<number> {
  const a = await preislisteAuswerten(tenantId, feedId);
  if (!a) return 0;
  let n = 0;
  for (const z of a.zeilen) {
    for (const land of z.fehlend) {
      if (n >= max || !z.asin) return n;
      try {
        await keepaMarkt(tenantId, z.asin, land as Marktplatz);
      } catch {
        return n; // Keepa nicht verbunden oder Tokens aufgebraucht – später weiter
      }
      n++;
    }
  }
  return n;
}

export function scanCsv(zeilen: ScanZeile[]): string {
  const zelle = (v: string | number | null) => {
    const roh = v === null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
    const t = typeof v === "string" && /^[=+\-@\t]/.test(roh) ? `'${roh}` : roh;
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const kopf = ["Ampel", "Artikelnr.", "EAN", "ASIN", "Titel", "EK je Verkauf", "Bestand", "MOQ", "Bestes Land", "Buy Box", "Ø 90 T.", "Tief 12 M.", "Verk./Monat", "Angebote", "Amazon %", "Gebühren", "Gewinn bei EK", "ROI bei EK", "Kundenpreis-Vorschlag", "Unsere Marge %", "Warnungen"];
  const rows = zeilen.map((z) => {
    const b = z.bester;
    return [z.ampel, z.sku, z.ean, z.asin, z.titel, z.ekJeVerkauf, z.bestand, z.moq, b?.land ?? null, b?.vk ?? null, b?.vk90 ?? null, b?.tief12 ?? null, b?.verkaeufe ?? null, b?.angebote ?? null, b?.amazonProzent ?? null, b?.gebuehren ?? null, b?.gewinnBeiEk ?? null, b?.roiBeiEk ?? null, b?.vorschlag.preis ?? null, b?.vorschlag.marge ?? null, z.warnungen.join(" | ")].map(zelle).join(";");
  });
  return "﻿" + [kopf.join(";"), ...rows].join("\r\n") + "\r\n";
}
