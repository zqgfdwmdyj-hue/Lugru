import "server-only";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/numbers";
import { ersteRoteWoche, POSTEN_TEXT } from "@/lib/money/liquiditaet";
import { liquiditaet as liquiditaetBerechnen } from "@/lib/money/liquiditaet-service";
import { kapitalAmpel } from "@/lib/money/kapital-service";
import { VERLUST_REGEL, verlustStopp } from "@/lib/money/verlust-service";
import { defineTool } from "../types";
import { abs, berlinDateTime, json } from "./common";

// Geld: Liquiditätsvorschau, Kapital-Ampel, Verlust-Stopp (nur lesen).

export const liquiditaet = defineTool({
  name: "liquiditaet",
  title: "Liquidität (Vorschau)",
  description:
    "Liquiditätsvorschau der nächsten Wochen (Standard 8): je Woche Kontostand am Anfang, Zu- und Abflüsse, Ende, tiefster Stand und Ampel gegen die Mindestreserve; Posten mit Quelle (Amazon-/eBay-/Temu-Auszahlungen, B2B-Forderungen, Lieferantenrechnungen, geplante Einkäufe, Kreditkarte, Fixkosten, Steuern). Optional „was wäre wenn“ mit einem geplanten Einkauf. Für „Reicht das Geld für den Einkauf?“.",
  area: "geld",
  write: false,
  quelle: { text: "Kontoauszug, Amazon-Abrechnungen, sellerboard, B2B-Deals, Rechnungen, Bestellvorschläge, Plan-Posten, Steuertermine (Schätzung)", jobs: ["Abrechnungen"] },
  input: z.object({
    wochen: z.number().int().min(1).max(26).default(8),
    einkauf_betrag: z.number().positive().max(10_000_000).optional().describe("Was wäre wenn: geplanter Einkauf in €"),
    einkauf_datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Datum des geplanten Einkaufs (JJJJ-MM-TT)"),
  }),
  run: async (ctx, i) => {
    const szenario = i.einkauf_betrag ? { betrag: i.einkauf_betrag, datum: i.einkauf_datum ?? ctx.today, label: "Geplanter Einkauf (Was wäre wenn)" } : null;
    const l = await liquiditaetBerechnen(ctx.session.tenantId, { heute: ctx.today, wochen: i.wochen, szenario });
    const rot = ersteRoteWoche(l.wochen);
    return json({
      kontostand_start: l.start,
      kontostand_quelle: l.startQuelle === "bank" ? "Kontoauszug" : l.startQuelle === "hand" ? "von Hand" : "fehlt",
      kontostand_stand: l.startStand ? formatDate(l.startStand) : undefined,
      mindestreserve: l.reserve,
      erste_woche_unter_reserve: rot ? { ab: rot.start, tiefster_stand: rot.tiefster } : null,
      was_waere_wenn: l.szenario ? { betrag: l.szenario.betrag, datum: l.szenario.datum, ohne_einkauf_erste_rote_woche: l.ohneSzenario ? (ersteRoteWoche(l.ohneSzenario)?.start ?? null) : null } : undefined,
      wochen: l.wochen.map((w) => ({
        ab: w.start,
        anfang: w.anfang,
        zufluesse: w.zu,
        abfluesse: w.ab,
        ende: w.endeSaldo,
        tiefster: w.tiefster,
        ampel: w.ampel,
        moegliche_einkaeufe_nicht_freigegeben: w.moeglich || undefined,
        posten: w.posten.filter((p) => !p.nichtEingerechnet).map((p) => ({ datum: p.datum, betrag: p.betrag, was: p.label, art: POSTEN_TEXT[p.art], geschaetzt: p.geschaetzt || undefined })),
      })),
      hinweis_vorschlaege: "Bestellvorschläge zählen erst, wenn sie im Einkauf angelegt sind; vorher stehen sie nur unter „moegliche_einkaeufe_nicht_freigegeben“ und ändern den Kontostand nicht.",
      quellen: l.quellen.map((q) => ({ name: q.name, status: q.status, hinweis: q.hinweis })),
      link: abs(ctx, `/cashflow${l.szenario ? `?betrag=${l.szenario.betrag}&datum=${l.szenario.datum}` : ""}`),
    });
  },
});

export const kapital_ampel = defineTool({
  name: "kapital_ampel",
  title: "Kapital-Ampel je Produkt",
  description:
    "Wo liegt Geld, das zu wenig verdient? Je Produkt gebundenes Kapital (Bestand × EK), Gewinn der letzten 90 Tage, Jahresrendite auf das gebundene Kapital (Gewinn 90 T × 365/90 ÷ Kapital), Umschlag, Reichweite, ältestes Lageralter, Preis gegen Break-even und Preis-Trend – mit Ampel (grün/gelb/rot), Gründen und Vorschlägen (nicht nachbestellen, Repricer-Untergrenze, Abverkauf, Liquidation, anderer Kanal). Filter rot/gelb/grün/alle.",
  area: "geld",
  write: false,
  quelle: { text: "sellerboard (Bestand, Gewinn je Monat), eigenes Lager, EK im Seller-System, Amazon-Lageralter, Keepa (Buy Box)", jobs: ["sellerboard:*"] },
  input: z.object({
    filter: z.enum(["alle", "rot", "gelb", "gruen"]).default("alle"),
    suche: z.string().trim().max(80).optional().describe("SKU, ASIN oder Name"),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  run: async (ctx, i) => {
    const d = await kapitalAmpel(ctx.session.tenantId, ctx.today);
    const q = (i.suche ?? "").toLowerCase();
    const list = d.zeilen.filter((z) => (i.filter === "alle" || z.ampel === i.filter) && (!q || z.sku.toLowerCase().includes(q) || (z.asin ?? "").toLowerCase().includes(q) || (z.name ?? "").toLowerCase().includes(q)));
    const zaehl = (a: "gruen" | "gelb" | "rot") => d.zeilen.filter((z) => z.ampel === a).length;
    return json({
      stand_bestand: berlinDateTime(d.stand) ?? "noch kein Abgleich",
      zeitraum_gewinn: "letzte 90 Tage (aus Monatswerten, laufender Monat bis heute)",
      summe_kapital: { gesamt: d.summe.gesamt, rot: d.summe.rot, gelb: d.summe.gelb, gruen: d.summe.gruen },
      anzahl: { rot: zaehl("rot"), gelb: zaehl("gelb"), gruen: zaehl("gruen") },
      produkte: list.slice(0, i.limit).map((z) => ({
        sku: z.sku,
        asin: z.asin ?? undefined,
        name: z.name ?? undefined,
        ampel: z.ampel,
        bestand: z.stueck,
        kapital: z.kapital,
        gewinn_90_tage: z.tageDaten > 0 ? z.gewinn90 : null,
        rendite_jahr_prozent: z.rendite === null ? null : Math.round(z.rendite * 100),
        umschlag_jahr: z.umschlag,
        reichweite_tage: z.reichweite !== null && z.reichweite >= 9999 ? "keine Verkäufe" : z.reichweite,
        lageralter_ab_tage: z.aeltesteTage ?? undefined,
        preis: z.preis,
        break_even: z.breakEven,
        trend_30_zu_90_prozent: z.trendProzent ?? undefined,
        gruende: z.gruende,
        vorschlaege: z.vorschlaege.length ? z.vorschlaege : undefined,
        link: abs(ctx, `/kapital?q=${encodeURIComponent(z.sku)}`),
      })),
      hinweis: list.length > i.limit ? `Nur die ersten ${i.limit} von ${list.length} (rot zuerst, dann nach Kapital).` : undefined,
      legende: { kapital: "null = EK fehlt", rendite_jahr_prozent: "null = EK fehlt oder unter 30 Tage Verkaufsdaten", break_even: "Bruttopreis, bei dem EK + FBA nach Provision und USt gedeckt sind" },
      link: abs(ctx, i.filter === "alle" ? "/kapital" : `/kapital?filter=${i.filter}`),
    });
  },
});

export const verlust_stopp = defineTool({
  name: "verlust_stopp",
  title: "Verlust-Stopp",
  description:
    "Artikel, die gerade mit Verlust verkaufen: Ist-Gewinn je Produkt der letzten 3 abgeschlossenen Tage (Amazon + eBay); Auslöser 2 von 3 Tagen im Minus oder mindestens 5 Stück mit Verlust. Je Fall Tageswerte, Ø Preis, Break-even, Buy Box (Keepa) und BQool-Regel/Min; dazu die Ausnahme-Liste (bewusster Abverkauf) mit Gewinn der letzten 7 Tage. Für „Wo verliere ich gerade Geld?“.",
  area: "geld",
  write: false,
  quelle: { text: "sellerboard (Gewinn je Produkt und Tag), EK im Seller-System, Keepa, BQool-Export", jobs: ["sellerboard:*"] },
  input: z.object({}),
  run: async (ctx) => {
    const v = await verlustStopp(ctx.session.tenantId, ctx.today);
    // Dieselbe Quelle wie die Aufgaben „Verlust-Stopp: …“ – offene Aufgaben immer mit ausgeben, damit Werkzeug und
    // Aufgabenliste nie auseinanderlaufen (z. B. wenn neue Tageswerte noch fehlen).
    const T = schema.tasks;
    const offen = await db
      .select({ titel: T.title, notiz: T.notes, schluessel: T.systemKey, faellig: T.dueDate })
      .from(T)
      .where(and(eq(T.tenantId, ctx.session.tenantId), like(T.systemKey, "verlust-%"), eq(T.status, "open")))
      .limit(50);
    return json({
      regel: `${VERLUST_REGEL.tage} von ${VERLUST_REGEL.fenster} Tagen im Minus oder ≥ ${VERLUST_REGEL.stueck} Stück mit Verlust`,
      zeitraum: { von: v.fenster[0], bis: v.fenster[v.fenster.length - 1], tage_mit_daten: v.tageMitDaten },
      stand_sellerboard: berlinDateTime(v.stand) ?? "noch kein Abgleich",
      faelle: v.faelle.map((f) => ({
        sku: f.sku,
        asin: f.asin ?? undefined,
        name: f.name ?? undefined,
        ausloeser: f.grund,
        tage: f.tage.map((t) => ({ tag: t.day, gewinn: t.gewinn, stueck: t.units })),
        summe_3_tage: f.summe,
        preis_durchschnitt: f.preis,
        break_even: f.breakEven,
        buybox: f.buybox ? { preis: f.buybox.preis, quelle: f.buybox.quelle, amazon: f.buybox.amazon || undefined } : null,
        bqool: f.bqool,
        link: abs(ctx, `/verlust?q=${encodeURIComponent(f.sku)}`),
      })),
      ausnahmen: v.ausnahmen.map((a) => ({ sku: a.sku, name: a.name ?? undefined, grund: a.grund, bis: a.bis ?? "unbefristet", aktiv: a.aktiv, gewinn_7_tage: a.woche.tageMitDaten ? a.woche.summe : null, stueck_7_tage: a.woche.stueck })),
      offene_aufgaben: offen.map((a) => ({ titel: a.titel, sku: a.schluessel?.replace(/^verlust-/, ""), seit: a.faellig ?? undefined, notiz: a.notiz?.slice(0, 600) ?? undefined })),
      hinweis: !v.tageMitDaten.length
        ? `Für die letzten Tage liegen noch keine sellerboard-Tageswerte vor${offen.length ? ` – die ${offen.length} offenen Aufgaben stammen aus dem letzten Abgleich mit Tageswerten` : ""}. Kommen mit dem täglichen Komplett-Abgleich.`
        : v.tageMitDaten.length < VERLUST_REGEL.fenster
          ? "Für einzelne Tage fehlen sellerboard-Tageswerte – kommen mit dem täglichen Komplett-Abgleich."
          : undefined,
      link: abs(ctx, "/verlust"),
    });
  },
});

export const FINANZEN = [liquiditaet, kapital_ampel, verlust_stopp];
