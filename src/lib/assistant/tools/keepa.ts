import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { eurRates } from "@/lib/fx/ecb";
import { buyboxAnteile, MARKTPLAETZE, MARKTPLATZ_LISTE, OHNE_KEEPA, type KeepaStand, type Marktplatz } from "@/lib/keepa/auswertung";
import { keepaMarkt, MAX_ALTER_STUNDEN, type MarktErgebnis } from "@/lib/keepa/markt";
import type { Datenstand } from "../stand";
import { defineTool, type ToolCtx } from "../types";
import { abs, berlinDateTime, json, round2 } from "./common";

// Keepa für Claude: Preis-, Angebots- und Rang-Verlauf je ASIN und Marktplatz. Nur lesen. Zuerst aus dem
// Zwischenspeicher (jünger als 6 Stunden), sonst bei Keepa (je Marktplatz 3 Tokens, ohne „offers“). Sind Keepas
// Werte älter als 48 Std., fordert der Abruf frische Daten an; bleiben sie alt, steht „hinweis“ im Ergebnis.

const TAG = 86_400_000;
const asinSchema = z.string().trim().regex(/^[A-Za-z0-9]{10}$/, "ASIN mit 10 Zeichen, z. B. B0C1234567");
const LEGENDE = {
  null: "keine Daten bei Keepa",
  preise: "in der Landeswährung (waehrung); Buy Box inklusive Versand",
  monatlich_verkauft: "Amazon-Angabe „x+ im letzten Monat gekauft“ (Mindestwert, keine Schätzung) – null = Amazon zeigt keine Angabe",
  verkaufsrang: "Hauptkategorie des jeweiligen Marktplatzes – zwischen Ländern nur grob vergleichbar",
};

const links = (ctx: ToolCtx, asin: string, mp: Marktplatz) => ({
  link: abs(ctx, `/lieferanten/abfrage?q=${asin}`),
  amazon_seite: `https://${MARKTPLAETZE[mp].host}/dp/${asin}`,
  keepa_seite: `https://keepa.com/#!product/${MARKTPLAETZE[mp].domain}-${asin}`,
});

const alter = (d: Date) => {
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  return min < 60 ? `${min} Min. alt` : `${Math.round(min / 6) / 10} Std. alt`.replace(".", ",");
};

function standText(r: Pick<MarktErgebnis, "ausSpeicher" | "abgerufen">) {
  return r.ausSpeicher ? `bei Keepa abgerufen am ${berlinDateTime(r.abgerufen)} (aus dem Zwischenspeicher, ${alter(r.abgerufen)}; neu erst nach ${MAX_ALTER_STUNDEN} Std.)` : `gerade bei Keepa abgerufen (${berlinDateTime(r.abgerufen)})`;
}

async function eigenesProdukt(ctx: ToolCtx, asin: string) {
  const P = schema.products;
  const [p] = await db.select({ title: P.title }).from(P).where(and(eq(P.tenantId, ctx.session.tenantId), eq(P.asin, asin))).limit(1);
  return p ? { titel: p.title ?? undefined, link: abs(ctx, `/produkte?q=${asin}`) } : undefined;
}

const OHNE_HOST: Record<(typeof OHNE_KEEPA)[number], string> = { NL: "amazon.nl", BE: "amazon.com.be", PL: "amazon.pl", SE: "amazon.se" };
const gbpInEur = async () => (await eurRates()).GBP ?? null;

// ---- keepa_produkt -----------------------------------------------------------------------------

export const keepaProdukt = defineTool({
  name: "keepa_produkt",
  title: "Keepa: Produkt",
  description:
    "Keepa-Daten zu einer ASIN auf einem Amazon-Marktplatz (DE, FR, IT, ES, UK): aktuell Buy-Box-Preis, Amazon-Preis bzw. „nicht auf Lager“, Anzahl Neu-Angebote (gesamt, FBA, FBM), Verkaufsrang und „x im letzten Monat gekauft“; Durchschnitt/Minimum/Maximum über 30, 90 und 180 Tage für Buy Box, Amazon und Rang; wie oft Amazon nicht auf Lager war; Buy-Box-Anteile (Amazon/FBA/FBM); dazu ein Wert je Tag (Buy Box, Amazon, Angebote, Rang). Für „Lohnt sich der Einkauf?“, „Wie viele Angebote sind im Markt?“, „Verkauft Amazon mit?“. Nur lesen; nutzt einen Zwischenspeicher (6 Std.).",
  area: ["lieferanten", "amazon"],
  write: false,
  quelle: { text: "Keepa (Preis-, Angebots- und Rang-Verlauf von Amazon)" },
  input: z.object({
    asin: asinSchema,
    marktplatz: z.enum(MARKTPLATZ_LISTE as [Marktplatz, ...Marktplatz[]]).default("DE").describe("Amazon-Marktplatz"),
    tage: z.number().int().min(1).max(365).default(90).describe("Länge des Tagesverlaufs und Zeitraum der Buy-Box-Anteile (höchstens 365)"),
  }),
  run: async (ctx, i) => {
    const asin = i.asin.toUpperCase();
    const mp = i.marktplatz;
    const r = await keepaMarkt(ctx.session.tenantId, asin, mp);
    const datenstand: Datenstand & Record<string, unknown> = {
      quelle: `Keepa (${MARKTPLAETZE[mp].host.replace(/^www\./, "")})`,
      stand: standText(r),
      abgerufen: berlinDateTime(new Date()) ?? "",
      keepa_aktualisiert: r.stand?.keepa_aktualisiert ? berlinDateTime(new Date(r.stand.keepa_aktualisiert)) : undefined,
      keepa_veraltet: r.alterHinweis,
      tokens_uebrig: r.tokensUebrig ?? undefined,
      letzter_fehler: r.warnung,
    };
    const eigen = await eigenesProdukt(ctx, asin);
    if (!r.stand) return json({ asin, marktplatz: mp, gefunden: false, hinweis: `Keepa hat zu ${asin} auf ${MARKTPLAETZE[mp].host.replace(/^www\./, "")} keine Daten (ASIN unbekannt oder dort nicht gelistet).`, eigenes_produkt: eigen, ...links(ctx, asin, mp), datenstand });
    const s: KeepaStand = r.stand;
    const kurs = s.waehrung === "GBP" ? await gbpInEur() : null;
    const eur = (v: number | null) => (kurs && v !== null ? round2(v * kurs) : undefined);
    const bis = r.abgerufen.getTime();
    return json({
      asin,
      marktplatz: mp,
      gefunden: true,
      hinweis: r.alterHinweis,
      titel: s.titel,
      waehrung: s.waehrung,
      eigenes_produkt: eigen,
      aktuell: {
        buybox_preis: s.aktuell.buybox,
        buybox_preis_eur: eur(s.aktuell.buybox),
        amazon_preis: s.aktuell.amazon ?? (s.aktuell.amazon_status === "kein Amazon-Angebot" ? "kein Amazon-Angebot" : "nicht auf Lager"),
        amazon_status: s.aktuell.amazon_status,
        angebote_neu: s.aktuell.angebote_neu,
        angebote_fba: s.aktuell.angebote_fba,
        angebote_fbm: s.aktuell.angebote_fbm,
        verkaufsrang: s.aktuell.verkaufsrang,
        monatlich_verkauft: s.aktuell.monatlich_verkauft,
      },
      kennzahlen: { "30_tage": s.kennzahlen["30"], "90_tage": s.kennzahlen["90"], "180_tage": s.kennzahlen["180"] },
      buybox_anteile: buyboxAnteile(s.buybox_verlauf, s.buybox_stats, MARKTPLAETZE[mp].amazonId, bis - i.tage * TAG, bis) ?? "keine Buy-Box-Daten bei Keepa",
      verlauf: { tage: i.tage, wert_je_tag: "Stand am Tagesende (Europe/Berlin), heute = aktueller Stand", spalten: ["datum", "buybox", "amazon", "angebote", "rang"], zeilen: s.verlauf.slice(-i.tage) },
      umrechnung: kurs ? { eur_je_gbp: kurs, quelle: "EZB-Tageskurs" } : undefined,
      legende: LEGENDE,
      ...links(ctx, asin, mp),
      datenstand,
    });
  },
});

// ---- keepa_vergleich ---------------------------------------------------------------------------

export const keepaVergleich = defineTool({
  name: "keepa_vergleich",
  title: "Keepa: Länder vergleichen",
  description:
    "Eine ASIN in allen Amazon-Ländern, die Keepa abdeckt (DE, FR, IT, ES, UK), nebeneinander: Buy-Box-Preis (UK zusätzlich in EUR), Anzahl Neu-Angebote, Verkaufsrang, „x im letzten Monat gekauft“ und ob Amazon auf Lager ist – sortiert nach Verkäufen. Für „In welchem Land verkauft sich das am besten?“, „Wohin zuerst liefern?“. NL, BE, PL und SE erfasst Keepa nicht. Nur lesen; Zwischenspeicher 6 Std.",
  area: ["lieferanten", "amazon"],
  write: false,
  quelle: { text: "Keepa (Preis-, Angebots- und Rang-Daten von Amazon)" },
  input: z.object({ asin: asinSchema }),
  run: async (ctx, i) => {
    const asin = i.asin.toUpperCase();
    const res = await Promise.allSettled(MARKTPLATZ_LISTE.map((mp) => keepaMarkt(ctx.session.tenantId, asin, mp)));
    const kurs = await gbpInEur();
    const ok = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const fehler = res.flatMap((r, n) => (r.status === "rejected" ? [`${MARKTPLATZ_LISTE[n]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : []));
    if (!ok.length) throw new Error(fehler[0]?.replace(/^[A-Z]{2}: /, "") ?? "Keepa nicht erreichbar.");
    const zeilen = ok.map((r) => {
      const s = r.stand;
      if (!s) return { marktplatz: r.marktplatz, gefunden: false, keepa_seite: links(ctx, asin, r.marktplatz).keepa_seite };
      return {
        marktplatz: r.marktplatz,
        gefunden: true,
        waehrung: s.waehrung,
        buybox_preis: s.aktuell.buybox,
        buybox_preis_eur: s.waehrung === "EUR" ? s.aktuell.buybox : kurs && s.aktuell.buybox !== null ? round2(s.aktuell.buybox * kurs) : null,
        angebote_neu: s.aktuell.angebote_neu,
        verkaufsrang: s.aktuell.verkaufsrang,
        monatlich_verkauft: s.aktuell.monatlich_verkauft,
        amazon: s.aktuell.amazon_status,
        amazon_seite: links(ctx, asin, r.marktplatz).amazon_seite,
        stand: berlinDateTime(r.abgerufen),
        keepa_aktualisiert: s.keepa_aktualisiert ? berlinDateTime(new Date(s.keepa_aktualisiert)) : undefined,
        hinweis: r.alterHinweis,
      };
    });
    // Meiste Verkäufe zuerst (ohne Angabe ans Ende), dann bester Rang.
    const key = (z: (typeof zeilen)[number]) => ("monatlich_verkauft" in z ? [-(z.monatlich_verkauft ?? -1), z.verkaufsrang ?? Number.MAX_SAFE_INTEGER] : [1, Number.MAX_SAFE_INTEGER]);
    zeilen.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    const titel = ok.find((r) => r.stand?.titel)?.stand?.titel ?? null;
    const neu = ok.filter((r) => !r.ausSpeicher).length;
    const aeltester = ok.reduce((m, r) => (r.abgerufen < m ? r.abgerufen : m), ok[0].abgerufen);
    const tokens = ok.map((r) => r.tokensUebrig).filter((n): n is number => n !== null);
    return json({
      asin,
      titel,
      maerkte: zeilen,
      sortierung: "nach „monatlich_verkauft“ (Amazon-Angabe), dann Verkaufsrang",
      nicht_bei_keepa: OHNE_KEEPA.map((m) => ({ marktplatz: m, hinweis: `Keepa erfasst ${OHNE_HOST[m]} nicht – dafür z. B. Seller Central oder sellerboard nutzen` })),
      fehler: fehler.length ? fehler : undefined,
      umrechnung: kurs ? { eur_je_gbp: kurs, quelle: "EZB-Tageskurs" } : undefined,
      legende: LEGENDE,
      link: abs(ctx, `/lieferanten/abfrage?q=${asin}`),
      datenstand: {
        quelle: "Keepa (amazon.de, .fr, .it, .es, .co.uk)",
        stand: `${neu ? `${neu} Länder gerade bei Keepa abgerufen` : "alle aus dem Zwischenspeicher"}${neu < ok.length && neu ? `, ${ok.length - neu} aus dem Zwischenspeicher` : ""}; ältester Stand ${berlinDateTime(aeltester)}`,
        abgerufen: berlinDateTime(new Date()) ?? "",
        tokens_uebrig: tokens.length ? Math.min(...tokens) : undefined,
        letzter_fehler: ok.map((r) => r.warnung).filter(Boolean).join(" ") || undefined,
        keepa_veraltet: ok.filter((r) => r.alterHinweis).map((r) => r.marktplatz).join(", ") ? `Keepa-Werte älter als 48 Std. bei: ${ok.filter((r) => r.alterHinweis).map((r) => r.marktplatz).join(", ")} (siehe „hinweis“ je Land)` : undefined,
      },
    });
  },
});

export const KEEPA = [keepaProdukt, keepaVergleich];
