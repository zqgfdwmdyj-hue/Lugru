import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEAL_STATUS } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { bestellStand } from "@/lib/b2b/ablauf";
import { DealEingabe } from "@/lib/b2b/eingabe";
import { dealBilanzen } from "@/lib/b2b/kontrolle";
import { besterMarkt, DEAL_STATUS_TEXT, preisWarnungen, RES_STATUS_TEXT, reservierungAktiv, unserVerdienst } from "@/lib/b2b/logic";
import { preislisteAuswerten } from "@/lib/b2b/scanner";
import { dealAnlegen, dealReservierungen, freischalten, freischaltHindernisse, ladeDeal, preisSetzen, prognoseAktualisieren, vertriebsfreigabe, type Deal } from "@/lib/b2b/service";
import { defineTool, type ToolCtx } from "../types";
import { abs, berlinDateTime, json, round2 } from "./common";

// B2B-Deals für Prep-Center-Kunden: Preislisten je Land auswerten, Deals, Bilanz, Kunden (lesen) sowie Deal anlegen,
// Kundenpreis setzen, freischalten (ändern). Kundendaten nur Firma/Land/Steuerstatus – keine Kontaktdaten.

const QUELLE_DEALS = { text: "B2B-Deals im Seller-System (Prognose: Keepa bzw. Amazon live, Rechnungen: Lexoffice)", jobs: ["B2B-Deals Fristen", "B2B-Zahlungen (Lexoffice)"] };

/** Deal per Kennung oder Nummer („12“ / „#12“); ohne Angabe der neueste. */
async function dealFinden(tenantId: string, ref?: string): Promise<Deal | null> {
  const D = schema.deals;
  const r = (ref ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f-]{36}$/i.test(r)) return ladeDeal(tenantId, r);
  if (/^\d{1,7}$/.test(r)) {
    const [d] = await db.select().from(D).where(and(eq(D.tenantId, tenantId), eq(D.nr, Number(r))));
    return d ?? null;
  }
  if (r) return null;
  const [d] = await db.select().from(D).where(eq(D.tenantId, tenantId)).orderBy(desc(D.nr)).limit(1);
  return d ?? null;
}

const dealKurz = (ctx: ToolCtx, d: Deal) => ({ nr: d.nr, status: DEAL_STATUS_TEXT[d.status], titel: d.titel, asin: d.asin, link: abs(ctx, `/b2b/${d.id}`) });

// ---- lesen ----------------------------------------------------------------------------------------

export const preislisten = defineTool({
  name: "preislisten",
  title: "B2B: Preislisten",
  description: "Preislisten der Lieferanten (Großhändler) mit Anzahl Angebote, davon mit ASIN, und Stand des letzten Imports – Einstieg für „Welche Preislisten habe ich, was ist neu?“. Auswerten je Land mit „preisliste_auswerten“.",
  area: "b2b",
  write: false,
  quelle: { text: "Lieferanten-Preislisten (Upload, Link oder Mail-Anhang)", jobs: ["Lieferanten-Preislisten"] },
  input: z.object({ limit: z.number().int().min(1).max(100).default(30) }),
  run: async (ctx, i) => {
    const F = schema.supplierFeeds;
    const S = schema.suppliers;
    const rows = await db
      .select({ id: F.id, name: F.name, stand: F.lastImportAt, lieferant: sql<string | null>`coalesce(${S.name}, ${S.code})`, angebote: sql<number>`(select count(*) from supplier_offers o where o.feed_id = ${F.id} and o.active)::int`, mitAsin: sql<number>`(select count(*) from supplier_offers o where o.feed_id = ${F.id} and o.active and coalesce(o.asin, o.market->>'asin') is not null)::int` })
      .from(F)
      .leftJoin(S, eq(S.id, F.supplierId))
      .where(eq(F.tenantId, ctx.session.tenantId))
      .orderBy(desc(F.lastImportAt))
      .limit(i.limit);
    return json({ anzahl: rows.length, preislisten: rows.map((r) => ({ id: r.id, name: r.name, lieferant: r.lieferant ?? undefined, angebote: r.angebote, mit_asin: r.mitAsin, stand: berlinDateTime(r.stand) ?? "noch nie importiert", link: abs(ctx, `/b2b/preislisten/${r.id}`) })), link: abs(ctx, "/b2b/preislisten") });
  },
});

export const preislisteAuswertenTool = defineTool({
  name: "preisliste_auswerten",
  title: "B2B: Preisliste je Land auswerten",
  description:
    "Wertet eine Lieferanten-Preisliste für B2B-Deals je Amazon-Land aus (DE, FR, IT, ES, UK über Keepa): Buy Box aktuell/Ø 90 Tage/Tief 12 Monate, Verkäufe pro Monat, Angebote, Amazon-Anteil an der Buy Box, Gebühren, Gewinn und ROI beim EK, Kundenpreis-Vorschlag (Kunde erreicht den Mindest-ROI) mit unserer Marge und Ampel, Packungs- und Aktions-Warnungen. Für „Was aus der Liste von X lohnt sich als Deal?“. Ohne Angabe die zuletzt importierte Liste.",
  area: "b2b",
  write: false,
  quelle: { text: "Preisliste + Keepa (Zwischenspeicher höchstens 24 Std.)", jobs: ["Keepa-Abgleich Lieferanten"] },
  input: z.object({
    preisliste: z.string().regex(/^[0-9a-f-]{36}$/i).optional().describe("id aus „preislisten“"),
    ampel: z.enum(["gruen", "gelb", "rot"]).optional(),
    land: z.enum(["DE", "FR", "IT", "ES", "UK"]).optional().describe("Sonst das beste Land je Artikel"),
    min_roi: z.number().min(0).max(1000).optional().describe("Mindest-ROI beim EK in %"),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    let feedId = i.preisliste;
    if (!feedId) {
      const [f] = await db.select({ id: schema.supplierFeeds.id }).from(schema.supplierFeeds).where(eq(schema.supplierFeeds.tenantId, t)).orderBy(desc(schema.supplierFeeds.lastImportAt)).limit(1);
      feedId = f?.id;
    }
    const a = feedId ? await preislisteAuswerten(t, feedId) : null;
    if (!a) return json({ anzahl: 0, hinweis: "Keine Preisliste gefunden – unter B2B-Deals → Preislisten hochladen.", link: abs(ctx, "/b2b/preislisten") });
    const reihe = { gruen: 0, gelb: 1, rot: 2 } as const;
    const zeilen = a.zeilen
      .map((z) => ({ z, l: i.land ? (z.laender.find((x) => x.land === i.land) ?? null) : z.bester }))
      .filter(({ z, l }) => (!i.ampel || z.ampel === i.ampel) && (i.min_roi === undefined || (l?.roiBeiEk ?? -Infinity) >= i.min_roi))
      .sort((x, y) => reihe[x.z.ampel] - reihe[y.z.ampel] || (y.l?.vorschlag.marge ?? -999) - (x.l?.vorschlag.marge ?? -999));
    return json({
      preisliste: a.feed.name,
      laender: a.laender,
      stand: { angebote: a.stand.angebote, mit_asin: a.stand.mitAsin, mit_marktdaten: a.stand.mitDaten, abfragen_offen: a.stand.offen },
      anzahl: Math.min(zeilen.length, i.limit),
      treffer_gesamt: zeilen.length,
      artikel: zeilen.slice(0, i.limit).map(({ z, l }) => ({
        ampel: z.ampel,
        titel: z.titel,
        asin: z.asin ?? undefined,
        ean: z.ean ?? undefined,
        ek_je_verkauf: z.ekJeVerkauf,
        bestand: z.bestand ?? undefined,
        moq: z.moq ?? undefined,
        land: l?.land,
        buybox: l?.vk ?? undefined,
        waehrung: l?.waehrung,
        buybox_90_tage: l?.vk90 ?? undefined,
        tief_12_monate: l?.tief12 ?? undefined,
        verkaeufe_monat: l?.verkaeufe ?? undefined,
        angebote: l?.angebote ?? undefined,
        amazon_buybox_prozent: l?.amazonProzent ?? undefined,
        gebuehren: l?.gebuehren ?? undefined,
        gewinn_bei_ek: l?.gewinnBeiEk ?? undefined,
        roi_bei_ek_prozent: l?.roiBeiEk ?? undefined,
        kundenpreis_vorschlag: l?.vorschlag.preis ?? undefined,
        unsere_marge_prozent: l?.vorschlag.marge ?? undefined,
        warnungen: z.warnungen.length ? z.warnungen : undefined,
        deal: z.dealId ? abs(ctx, `/b2b/${z.dealId}`) : undefined,
        link: z.asin ? abs(ctx, `/b2b/neu?angebot=${z.offerId}`) : undefined,
      })),
      erklaerung: "Kundenpreis-Vorschlag = höchster Preis, bei dem der Kunde im Land den Mindest-ROI (Einstellungen → B2B-Deals) erreicht. NL/BE/PL/SE kennt Keepa nicht – dort erst im Deal (Amazon live).",
      link: abs(ctx, `/b2b/preislisten/${a.feed.id}`),
    });
  },
});

export const deals = defineTool({
  name: "deals",
  title: "B2B: Deals",
  description: "B2B-Deals für Prep-Center-Kunden mit Status (Entwurf, offen, geschlossen, bestellt, angekommen, verteilt), Kundenpreis und EK, reservierter Menge gegen Höchstmenge und Lieferanten-MOQ, Frist und bestem Land (ROI des Kunden). Für „Welche Deals laufen, wo ist die MOQ erreicht?“.",
  area: "b2b",
  write: false,
  quelle: QUELLE_DEALS,
  input: z.object({ status: z.enum([...DEAL_STATUS, "laufend", "alle"] as [string, ...string[]]).default("laufend"), limit: z.number().int().min(1).max(100).default(30) }),
  run: async (ctx, i) => {
    const D = schema.deals;
    const st = i.status === "alle" ? [...DEAL_STATUS] : i.status === "laufend" ? ["entwurf", "aktiv", "geschlossen", "bestellt", "angekommen"] : [i.status];
    const rows = await db
      .select({ d: D, reserviert: sql<number>`coalesce((select sum(r.menge) from deal_reservierungen r where r.deal_id = ${D.id} and r.status not in ('storniert','erstattet')), 0)::int`, kunden: sql<number>`(select count(*) from deal_reservierungen r where r.deal_id = ${D.id} and r.status not in ('storniert','erstattet'))::int` })
      .from(D)
      .where(and(eq(D.tenantId, ctx.session.tenantId), inArray(D.status, st as Deal["status"][])))
      .orderBy(desc(D.nr))
      .limit(i.limit);
    return json({
      anzahl: rows.length,
      deals: rows.map(({ d, reserviert, kunden }) => {
        const b = besterMarkt(d.prognose);
        return { ...dealKurz(ctx, d), kundenpreis_netto: d.kundenpreisNetto, ek_netto: d.ekNetto, reserviert, max_gesamt: d.maxGesamt ?? undefined, moq_lieferant: d.moqLieferant, moq_erreicht: reserviert >= d.moqLieferant, kunden, frist: d.frist ?? undefined, bestes_land: b ? `${b.land} (${b.roi.toFixed(0)} % ROI Kunde)` : undefined };
      }),
      link: abs(ctx, "/b2b"),
    });
  },
});

export const deal = defineTool({
  name: "deal",
  title: "B2B: Deal im Detail",
  description: "Ein B2B-Deal im Detail: Artikel, Lieferant und Vertriebsfreigabe, EK/Staffel, Kundenpreis und unser Verdienst, Prognose je Land (Buy Box, Ø 90 Tage, Tief 12 Monate, Verkäufe, Angebote, Amazon-Anteil, Gewinn/ROI des Kunden, Aktionsmuster), Reservierungen je Kunde mit Status/Rechnung, Bestellstand und was vor dem Freischalten fehlt. Ohne Angabe der neueste Deal.",
  area: "b2b",
  write: false,
  quelle: QUELLE_DEALS,
  input: z.object({ deal: z.string().trim().max(40).optional().describe("Deal-Nummer (z. B. 12) oder id") }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const d = await dealFinden(t, i.deal);
    if (!d) return json({ hinweis: i.deal ? `Deal „${i.deal}“ nicht gefunden.` : "Noch keine Deals.", link: abs(ctx, "/b2b") });
    const s = await getSettings(t);
    const fr = await vertriebsfreigabe(t, d.supplierId);
    const res = await dealReservierungen(t, d.id);
    const v = d.kundenpreisNetto !== null ? unserVerdienst({ ek: d.ekNetto, kundenpreis: d.kundenpreisNetto, versandAnteil: d.versandAnteil, menge: d.maxGesamt ?? d.moqLieferant }) : null;
    const bs = d.status === "entwurf" ? null : await bestellStand(t, d);
    return json({
      ...dealKurz(ctx, d),
      marke: d.marke ?? undefined,
      ean: d.ean ?? undefined,
      lieferant_vertriebsfreigabe: fr.ok ? "ja" : fr.fehlt.join(", "),
      ek_netto: d.ekNetto,
      moq_lieferant: d.moqLieferant,
      kundenpreis_netto: d.kundenpreisNetto,
      unser_verdienst_je_stueck: v?.proStueck,
      unser_verdienst_gesamt: v?.gesamt ?? undefined,
      grenzen: { mindestmenge_kunde: d.mindestmengeKunde, max_gesamt: d.maxGesamt, max_je_kunde: d.maxProKunde, max_kunden: d.maxKunden, frist: d.frist },
      eigener_bestand: d.eigenerBestand || undefined,
      prognose: Object.entries(d.prognose).map(([land, p]) => ({ land, buybox: p.vk, waehrung: p.waehrung, buybox_90_tage: p.vk90, tief_12_monate: p.tief12, verkaeufe_monat: p.verkaeufeMonat, angebote: p.angeboteFba === null && p.angeboteFbm === null ? null : (p.angeboteFba ?? 0) + (p.angeboteFbm ?? 0), amazon_buybox_prozent: p.amazonProzent, gewinn_kunde: p.gewinnKunde, roi_kunde_prozent: p.roiKunde, aktionsmuster: p.aktionsmuster ?? undefined, hinweis: p.fehler ?? undefined })),
      warnungen: preisWarnungen({ verdienst: v, besterRoi: besterMarkt(d.prognose)?.roi ?? null, minRoiProzent: s.b2b.minKundenRoi * 100, kundenpreis: d.kundenpreisNetto }).map((w) => w.text),
      vor_dem_freischalten_fehlt: d.status === "entwurf" ? await freischaltHindernisse(t, d) : undefined,
      reservierungen: res.map(({ r, firma }) => ({ kunde: firma, menge: r.menge, zugeteilt: r.zugeteilt ?? undefined, preis_netto: r.preisNetto, status: RES_STATUS_TEXT[r.status], reverse_charge: r.reverseCharge || undefined, rechnung: r.rechnungNr ?? undefined, gutschrift: r.gutschriftBetrag ?? undefined })),
      reserviert: res.filter((x) => reservierungAktiv(x.r.status)).reduce((n, x) => n + x.r.menge, 0),
      bestellung: bs ? { bestellbar: bs.bestellMenge, faellig: bs.faellig.faellig ? (bs.faellig.grund === "moq" ? "MOQ erreicht" : "Frist vorbei") : "noch nicht", status: bs.bestellung?.status ?? "kein Entwurf" } : undefined,
    });
  },
});

export const dealBilanz = defineTool({
  name: "deal_bilanz",
  title: "B2B: Deal-Bilanz",
  description: "Bilanz der bestellten B2B-Deals: gelieferte Stück, Umsatz netto, EK und Versand, unser Gewinn je Deal und gesamt, dazu die Erfolgskontrolle 30/60 Tage nach Wareneingang (Ø Buy Box gegen Prognose, Trefferquote). Für „Was haben die Deals gebracht, stimmen die Prognosen?“.",
  area: "b2b",
  write: false,
  quelle: { text: "B2B-Deals + Erfolgskontrolle (Keepa)", jobs: ["B2B-Erfolgskontrolle"] },
  input: z.object({ deal: z.string().trim().max(40).optional().describe("Nur ein Deal (Nummer oder id)") }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const d = i.deal ? await dealFinden(t, i.deal) : null;
    if (i.deal && !d) return json({ hinweis: `Deal „${i.deal}“ nicht gefunden.`, link: abs(ctx, "/b2b/bilanz") });
    const b = await dealBilanzen(t, d?.id);
    return json({
      summe: { stueck: b.summe.stueck, umsatz_netto: b.summe.umsatz, gewinn: b.summe.gewinn },
      prognosen: { kontrollen: b.treffer.anzahl, trefferquote_prozent: b.treffer.trefferquote, abweichung_schnitt_prozent: b.treffer.abweichungSchnitt },
      deals: b.liste.slice(0, 50).map((x) => ({ nr: x.nr, titel: x.titel, status: DEAL_STATUS_TEXT[x.status as Deal["status"]], stueck: x.stueck, umsatz_netto: x.umsatzNetto, ek_netto: x.ekNetto, versand: x.versand, gewinn: x.gewinn, kontrollen: x.kontrollen.length ? x.kontrollen : undefined, link: abs(ctx, `/b2b/${x.id}`) })),
      link: abs(ctx, "/b2b/bilanz"),
    });
  },
});

export const b2bKunden = defineTool({
  name: "b2b_kunden",
  title: "B2B: Kunden",
  description: "B2B-Kunden (Amazon-Händler im Kundenportal): Firma, Land, USt-IdNr. geprüft ja/nein (nur dann Reverse Charge), Zahlungsart, Portal-Zugang und Anzahl Reservierungen. Ohne Kontaktdaten. Für „Welche Kunden haben noch keine geprüfte USt-IdNr.?“.",
  area: "b2b",
  write: false,
  quelle: { text: "B2B-Kunden im Seller-System (USt-Prüfung: VIES)" },
  input: z.object({ nur_aktive: z.boolean().default(true) }),
  run: async (ctx, i) => {
    const K = schema.b2bKunden;
    const Z = schema.b2bZugaenge;
    const rows = await db
      .select({ id: K.id, firma: K.firma, land: K.land, ustId: K.ustId, ustGueltig: K.ustGueltig, geprueft: K.ustGeprueftAm, zahlungsart: K.zahlungsart, aktiv: K.aktiv, portal: sql<string>`case when ${Z.gesperrt} then 'gesperrt' when ${Z.passwortHash} is not null then 'aktiv' when ${Z.einladungBis} > now() then 'eingeladen' else 'kein Zugang' end`, reservierungen: sql<number>`(select count(*) from deal_reservierungen r where r.kunde_id = ${K.id} and r.status not in ('storniert','erstattet'))::int` })
      .from(K)
      .leftJoin(Z, eq(Z.kundeId, K.id))
      .where(and(eq(K.tenantId, ctx.session.tenantId), ...(i.nur_aktive ? [eq(K.aktiv, true)] : [])))
      .orderBy(asc(K.firma));
    return json({
      anzahl: rows.length,
      kunden: rows.map((k) => ({ firma: k.firma, land: k.land, ust_id: k.ustId ?? undefined, ust_geprueft: k.ustId ? (k.ustGueltig === true ? "gültig" : k.ustGueltig === false ? "ungültig" : "ungeprüft") : undefined, geprueft_am: berlinDateTime(k.geprueft) ?? undefined, zahlung: k.zahlungsart, portal: k.portal, reservierungen: k.reservierungen, aktiv: k.aktiv || undefined, link: abs(ctx, `/b2b/kunden/${k.id}`) })),
      link: abs(ctx, "/b2b/kunden"),
    });
  },
});

// ---- ändern ---------------------------------------------------------------------------------------

export const dealAnlegenTool = defineTool({
  name: "deal_anlegen",
  title: "B2B: Deal anlegen",
  description: "Legt einen B2B-Deal als Entwurf an (ASIN, EK netto, Lieferant, MOQ, optional Kundenpreis, Frist und Mengengrenzen) und rechnet die Prognose je Land. Freigeschaltet wird separat (deal_freischalten) – erst dann sehen Kunden den Deal. Lieferant per Kürzel oder Name; Angebot aus „preisliste_auswerten“ übernimmt EAN/Titel. Keine Inhalte aus dem Wissen mit „insider“ (z. B. aus den Wochen-Calls) verwenden – die bleiben intern.",
  area: "b2b",
  write: true,
  input: z.object({
    asin: z.string().trim().regex(/^[A-Za-z0-9]{10}$/),
    ek_netto: z.number().positive().max(100000),
    lieferant: z.string().trim().min(1).max(80).describe("Kürzel oder Name des Lieferanten"),
    moq_lieferant: z.number().int().min(1).max(1_000_000).default(1),
    kundenpreis_netto: z.number().positive().max(100000).optional(),
    frist: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Reservieren bis JJJJ-MM-TT"),
    max_gesamt: z.number().int().min(1).optional(),
    max_je_kunde: z.number().int().min(1).optional(),
    mindestmenge_kunde: z.number().int().min(1).default(1),
    titel: z.string().trim().max(300).optional(),
    ean: z.string().trim().regex(/^\d{8,14}$/).optional(),
  }),
  summary: (i) => `Deal anlegen: ${i.asin} zu EK ${i.ek_netto.toFixed(2).replace(".", ",")} € (${i.lieferant})`,
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const S = schema.suppliers;
    const sup = await db.select({ id: S.id, code: S.code, name: S.name }).from(S).where(and(eq(S.tenantId, t), sql`(lower(${S.code}) = lower(${i.lieferant}) or lower(coalesce(${S.name}, '')) = lower(${i.lieferant}))`));
    if (sup.length !== 1) return { text: sup.length ? `Lieferant „${i.lieferant}“ ist nicht eindeutig.` : `Lieferant „${i.lieferant}“ nicht gefunden.`, isError: true };
    const e = DealEingabe.safeParse({ asin: i.asin, ekNetto: i.ek_netto, supplierId: sup[0].id, moqLieferant: i.moq_lieferant, kundenpreisNetto: i.kundenpreis_netto, frist: i.frist, maxGesamt: i.max_gesamt, maxProKunde: i.max_je_kunde, mindestmengeKunde: i.mindestmenge_kunde, titel: i.titel, ean: i.ean });
    if (!e.success) return { text: `Eingabe ungültig: ${e.error.issues.map((x) => x.message).join(", ")}`, isError: true };
    const { id, nr } = await dealAnlegen(t, ctx.session.userId, e.data);
    const p = await prognoseAktualisieren(t, id).catch((err) => ({ hinweise: [err instanceof Error ? err.message : String(err)] }));
    const d = (await ladeDeal(t, id))!;
    return json({ ok: true, nr, status: "Entwurf", bestes_land: besterMarkt(d.prognose) ?? undefined, hinweise: p.hinweise.length ? p.hinweise : undefined, vor_dem_freischalten_fehlt: await freischaltHindernisse(t, d), link: abs(ctx, `/b2b/${id}`) });
  },
});

export const dealPreisSetzen = defineTool({
  name: "deal_preis_setzen",
  title: "B2B: Kundenpreis setzen",
  description: "Setzt den Kundenpreis (netto je Stück) eines B2B-Deals und rechnet Gewinn/ROI des Kunden je Land neu; liefert Warnungen (wir im Minus, Kunde unter Mindest-ROI). Gibt es schon Reservierungen, nur mit trotz_reservierungen – deren Preis bleibt.",
  area: "b2b",
  write: true,
  stufe: "rot",
  seite: "/b2b",
  input: z.object({ deal: z.string().trim().min(1).max(40).describe("Deal-Nummer oder id"), kundenpreis_netto: z.number().positive().max(100000), trotz_reservierungen: z.boolean().default(false) }),
  summary: (i) => `Kundenpreis Deal ${i.deal}: ${i.kundenpreis_netto.toFixed(2).replace(".", ",")} € netto`,
  run: async (ctx, i) => {
    const d = await dealFinden(ctx.session.tenantId, i.deal);
    if (!d) return { text: `Deal „${i.deal}“ nicht gefunden.`, isError: true };
    const r = await preisSetzen(ctx.session.tenantId, d.id, i.kundenpreis_netto, { trotzReservierungen: i.trotz_reservierungen });
    if (!r.ok) return { text: r.fehler, isError: true };
    const n = (await ladeDeal(ctx.session.tenantId, d.id))!;
    return json({ ok: true, nr: d.nr, kundenpreis_netto: i.kundenpreis_netto, warnungen: r.warnungen.map((w) => w.text), je_land: Object.entries(n.prognose).map(([land, p]) => ({ land, gewinn_kunde: round2(p.gewinnKunde), roi_kunde_prozent: p.roiKunde })), link: abs(ctx, `/b2b/${d.id}`) });
  },
});

export const dealFreischalten = defineTool({
  name: "deal_freischalten",
  title: "B2B: Deal freischalten",
  description: "Schaltet einen B2B-Deal im Kundenportal frei (Kunden können reservieren) und meldet ihn im Discord-Kanal. Nur mit Kundenpreis, Frist und Vertriebsfreigabe des Lieferanten. Abo-Mails an Kunden nur, wenn ausdrücklich mails=true. Keine Inhalte aus dem Wissen mit „insider“ (z. B. aus den Wochen-Calls) verwenden – die bleiben intern.",
  area: "b2b",
  write: true,
  stufe: "gelb",
  input: z.object({ deal: z.string().trim().min(1).max(40).describe("Deal-Nummer oder id"), mails: z.boolean().default(false).describe("Kunden mit passendem Abo per Mail benachrichtigen") }),
  summary: (i) => `Deal ${i.deal} freischalten${i.mails ? " (mit Abo-Mails)" : ""}`,
  run: async (ctx, i) => {
    const d = await dealFinden(ctx.session.tenantId, i.deal);
    if (!d) return { text: `Deal „${i.deal}“ nicht gefunden.`, isError: true };
    const r = await freischalten(ctx.session.tenantId, d.id, ctx.session.userId, { mails: i.mails });
    if (!r.ok) return { text: r.fehler, isError: true };
    return json({ ok: true, nr: d.nr, status: "offen", discord_gemeldet: r.discord, abo_mails: r.mails, link: abs(ctx, `/b2b/${d.id}`) });
  },
});

export const B2B = [preislisten, preislisteAuswertenTool, deals, deal, dealBilanz, b2bKunden, dealAnlegenTool, dealPreisSetzen, dealFreischalten];
