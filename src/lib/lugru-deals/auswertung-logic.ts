// Lugru-Deals auswerten – reine Logik: Keepa-Schnappschuss zum Zeitpunkt des Postens (aus dem Keepa-Verlauf),
// eigener Kauf erkannt, Statistik-Kacheln. Mitglieder werden nie gezählt oder benannt, nur Reaktionen als Anzahl.

import type { LugruKeepa } from "@/db/schema";
import type { VerlaufZeile } from "@/lib/keepa/auswertung";

const TAG = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const mittel = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const tagIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Keepa-Werte zum Zeitpunkt `am` aus dem Tagesverlauf (älteste zuerst): Buy Box an dem Tag und Ø 30/90/180 davor,
 * Preiseinbrüche (≥ 15 % unter dem Ø der 30 Tage davor) in 12 Monaten, Angebote und Trend 30 T, Amazon-Anteil
 * (Tage mit Amazon-Angebot in den 90 Tagen davor), Rang. null, wenn der Verlauf den Zeitpunkt nicht abdeckt.
 */
export function keepaSchnappschuss(verlauf: VerlaufZeile[], am: Date, o: { art?: LugruKeepa["art"]; jetzt?: Date; gekauftImMonat?: number | null; marke?: string | null; kategorie?: string | null } = {}): LugruKeepa | null {
  const t = am.getTime();
  const tag = tagIso(t);
  const bis = verlauf.filter((r) => r[0] <= tag);
  if (!bis.length || Date.parse(bis[bis.length - 1][0]) < t - 7 * TAG) return null;
  const inTagen = (n: number) => bis.filter((r) => r[0] > tagIso(t - n * TAG));
  const bbIn = (n: number) => inTagen(n).map((r) => r[1]).filter((x): x is number => x !== null);
  const letzte = [...bis].reverse();
  const buyBox = letzte.find((r) => r[1] !== null)?.[1] ?? null;
  const angebote = letzte.find((r) => r[3] !== null)?.[3] ?? null;
  const rang = letzte.find((r) => r[4] !== null)?.[4] ?? null;
  const vor30 = bis.filter((r) => r[0] <= tagIso(t - 30 * TAG)).reverse().find((r) => r[3] !== null)?.[3] ?? null;
  const t90 = inTagen(90);
  let einbrueche: number | null = null;
  const jahr = inTagen(365);
  if (jahr.length >= 60) {
    einbrueche = 0;
    let drin = false;
    for (const r of jahr) {
      if (r[1] === null) continue;
      const davor = bis.filter((x) => x[0] < r[0] && x[0] >= tagIso(Date.parse(r[0]) - 30 * TAG) && x[1] !== null).map((x) => x[1]!);
      const m = mittel(davor);
      const unten = m !== null && davor.length >= 7 && r[1] < m * 0.85;
      if (unten && !drin) einbrueche++;
      drin = unten;
    }
  }
  const m = (n: number) => {
    const x = mittel(bbIn(n));
    return x === null ? null : r2(x);
  };
  return {
    stand: (o.jetzt ?? new Date()).toISOString(),
    art: o.art ?? "verlauf",
    buyBox,
    buyBox30: m(30),
    buyBox90: m(90),
    buyBox180: m(180),
    einbrueche12: einbrueche,
    angebote,
    angeboteTrend30: angebote !== null && vor30 ? r1(((angebote - vor30) / vor30) * 100) : null,
    amazonAnteil: t90.length >= 10 ? r1((t90.filter((r) => r[2] !== null).length / t90.length) * 100) : null,
    rang,
    gekauftImMonat: o.gekauftImMonat ?? null,
    marke: o.marke ?? null,
    kategorie: o.kategorie ?? null,
  };
}

/** Eigener Kauf zu einem geposteten Deal: gleiche ASIN, bestellt in den 14 Tagen nach dem Posten (frühester Treffer). */
export function kaufZuDeal(deal: { asin: string; gepostetAm: Date }, kaeufe: { asin: string; am: Date; ref: string }[]): { ref: string; am: Date } | null {
  const von = deal.gepostetAm.getTime() - 3600_000;
  const bis = deal.gepostetAm.getTime() + 14 * TAG;
  const t = kaeufe.filter((k) => k.asin === deal.asin && k.am.getTime() >= von && k.am.getTime() <= bis).sort((a, b) => a.am.getTime() - b.am.getTime())[0];
  return t ? { ref: t.ref, am: t.am } : null;
}

export type StatDeal = {
  gepostetAm: Date;
  kanal: string | null;
  ampel: "gruen" | "gelb" | "rot" | null;
  reaktionen: Record<string, number>;
  kaeufe: number;
  gekauft: boolean;
  /** Realer ROI in % aus dem Ergebnis eines eigenen Kaufs (sellerboard), sonst null. */
  realerRoi: number | null;
  marke: string | null;
  kategorie: string | null;
  titel: string | null;
};

/** Marke grob aus dem Titel (erstes Wort), wenn Keepa keine liefert. */
export const markeAusTitel = (titel: string | null) => {
  const w = (titel ?? "").trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}&+-]/gu, "") ?? "";
  return w.length >= 2 ? w : null;
};

/** Statistik-Kacheln im Zeitraum: Deals/Woche, Ø Reaktionen, Anteil grün, gekauft, Ø realer ROI, beste Marken/Kategorien. */
export function lugruStatistik(deals: StatDeal[], von: Date, bis: Date) {
  const im = deals.filter((d) => d.gepostetAm >= von && d.gepostetAm <= bis);
  const wochen = Math.max(1, (bis.getTime() - von.getTime()) / (7 * TAG));
  const reak = im.map((d) => Object.values(d.reaktionen).reduce((s, n) => s + n, 0));
  const mitAmpel = im.filter((d) => d.ampel);
  const rois = im.map((d) => d.realerRoi).filter((x): x is number => x !== null);
  const gruppe = (key: (d: StatDeal) => string | null) => {
    const m = new Map<string, { deals: number; kaeufe: number; gekauft: number }>();
    for (const d of im) {
      const k = key(d);
      if (!k) continue;
      const x = m.get(k) ?? { deals: 0, kaeufe: 0, gekauft: 0 };
      x.deals++;
      x.kaeufe += d.kaeufe;
      if (d.gekauft) x.gekauft++;
      m.set(k, x);
    }
    return [...m.entries()]
      .filter(([, x]) => x.deals >= 2)
      .map(([name, x]) => ({ name, deals: x.deals, kaeufeJeDeal: r1(x.kaeufe / x.deals), gekauft: x.gekauft }))
      .sort((a, b) => b.kaeufeJeDeal - a.kaeufeJeDeal || b.deals - a.deals)
      .slice(0, 5);
  };
  const emojis = new Map<string, number>();
  for (const d of im) for (const [e, n] of Object.entries(d.reaktionen)) emojis.set(e, (emojis.get(e) ?? 0) + n);
  const kanaele = new Map<string, number>();
  for (const d of im) if (d.kanal) kanaele.set(d.kanal, (kanaele.get(d.kanal) ?? 0) + 1);
  return {
    zeitraum: { von: tagIso(von.getTime()), bis: tagIso(bis.getTime()) },
    deals: im.length,
    dealsJeWoche: r1(im.length / wochen),
    reaktionenSumme: reak.reduce((s, n) => s + n, 0),
    reaktionenSchnitt: reak.length ? r1(reak.reduce((s, n) => s + n, 0) / reak.length) : null,
    gruppenKaeufe: im.reduce((s, d) => s + d.kaeufe, 0),
    anteilGruen: mitAmpel.length ? Math.round((mitAmpel.filter((d) => d.ampel === "gruen").length / mitAmpel.length) * 100) : null,
    mitAmpel: mitAmpel.length,
    gekauft: im.filter((d) => d.gekauft).length,
    realerRoiSchnitt: rois.length ? r1(rois.reduce((s, n) => s + n, 0) / rois.length) : null,
    mitErgebnis: rois.length,
    besteMarken: gruppe((d) => d.marke ?? markeAusTitel(d.titel)),
    besteKategorien: gruppe((d) => d.kategorie),
    emojis: [...emojis.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([emoji, anzahl]) => ({ emoji, anzahl })),
    kanaele: [...kanaele.entries()].sort((a, b) => b[1] - a[1]).map(([kanal, anzahl]) => ({ kanal, anzahl })),
  };
}

export type LugruStatistik = ReturnType<typeof lugruStatistik>;
