import "server-only";
import { z } from "zod";
import type { DealEingangZeile } from "@/db/tables/deal-eingang";
import { AMPEL_EMOJI, antwortEntwurf } from "@/lib/deal-eingang/logic";
import { eingaenge, eingang, eingangAnlegen, eingangPruefen, quellen, statusSetzen, STATUS_TEXT } from "@/lib/deal-eingang/service";
import { defineTool } from "../types";
import { abs, isoDate, json, uuid } from "./common";

// Deal-Eingang (WhatsApp/Kurzbefehl/Mail/ProfitPath → Deal-Ampel). Nur mit Freigabe „Deal-Eingang“ (kein VA, kein
// B2B-Kunde). Inhalte nie ins Wissen und nie in den B2B-Kanal.

const QUELLE = { text: "Deal-Eingang im Seller-System (Prüfung mit Keepa, Amazon-Gebühren je Land, eigenem Bestand)" };
const AMPEL = { gruen: "grün", gelb: "gelb", rot: "rot" } as const;

const zeileKurz = (z: DealEingangZeile) => ({
  nr: z.nr,
  asin: z.asin,
  titel: z.titel ?? z.angebot.name,
  ampel: AMPEL[z.ampel],
  gruende: z.gruende,
  ek_netto: z.ekNetto,
  bestes_land: z.bestesLand,
  gewinn_stueck: z.gewinn,
  roi_prozent: z.roi,
  empfohlene_menge: z.empfohlen,
  kapitalbedarf: z.kapitalbedarf,
  lohnt_bis_ek: z.maxEk.length ? z.maxEk : undefined,
  eigener_bestand: z.eigen ? { bestand: z.eigen.bestand, reichweite_tage: z.eigen.reichweite, kapital_ampel: z.eigen.kapitalAmpel, letzter_ek: z.eigen.letzterEk } : undefined,
  risiken: z.risiken.length ? z.risiken : undefined,
  zuordnung_unsicher: z.zuordnung === "titel" || z.zuordnung === "keine" || undefined,
});

export const dealEingangTool = defineTool({
  name: "deal_eingang",
  title: "Deal-Eingang",
  description:
    "Geprüfte Deal-Eingänge (geteilt aus WhatsApp, iPhone-Kurzbefehl, Mail, ProfitPath, von Claude) mit Ampel und Kurzbegründung. Filter: status (neu, gekauft, bestellvorschlag, b2b, verworfen, preisliste), quelle (Absender bzw. „ProfitPath · Modul“), ampel, seit (YYYY-MM-DD). Für den Morgenbericht: seit = gestern, ampel grün/gelb.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({
    status: z.enum(["neu", "gekauft", "bestellvorschlag", "b2b", "verworfen", "preisliste"]).optional(),
    quelle: z.string().trim().min(1).max(80).optional(),
    ampel: z.enum(["gruen", "gelb", "rot"]).optional(),
    seit: isoDate.optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  run: async (ctx, i) => {
    const rows = await eingaenge(ctx.session.tenantId, { status: i.status, quelle: i.quelle, ampel: i.ampel, seit: i.seit ? new Date(`${i.seit}T00:00:00Z`) : undefined, limit: i.limit });
    return json({
      eingaenge: rows.map((e) => ({
        id: e.id,
        zeit: e.createdAt.toISOString(),
        quelle: e.quelle ?? undefined,
        weg: e.weg,
        status: STATUS_TEXT[e.status],
        pruefung: e.pruefung === "fertig" ? undefined : e.pruefung,
        ampel: e.ampel ? `${AMPEL_EMOJI[e.ampel]} ${AMPEL[e.ampel]}` : null,
        kurz: e.zusammenfassung ?? e.fehler ?? undefined,
        angebote: e.zeilen.length || undefined,
        fristen: e.zeilen.map((z) => z.angebot.gueltigBis).filter(Boolean).length ? e.zeilen.map((z) => z.angebot.gueltigBis).filter(Boolean) : undefined,
        link: abs(ctx, `/deal-eingang/${e.id}`),
      })),
      link: abs(ctx, "/deal-eingang"),
    });
  },
});

export const dealEingangDetailTool = defineTool({
  name: "deal_eingang_detail",
  title: "Deal-Eingang: Einzelheiten",
  description: "Ein Deal-Eingang mit allen erkannten Angeboten: Ampel und bis zu drei Gründe je Angebot, Gewinn/ROI im besten Land, empfohlene Menge, Kapitalbedarf, max. EK je Land, eigener Bestand, Risiken und ein Antwort-Entwurf an den Händler.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({ id: uuid }),
  run: async (ctx, i) => {
    const e = await eingang(ctx.session.tenantId, i.id);
    if (!e) return { text: "Eingang nicht gefunden.", isError: true };
    const beste = [...e.zeilen].sort((a, b) => (b.roi ?? -999) - (a.roi ?? -999))[0];
    return json({
      id: e.id,
      zeit: e.createdAt.toISOString(),
      quelle: e.quelle ?? undefined,
      weg: e.weg,
      status: STATUS_TEXT[e.status],
      grund: e.grund ?? undefined,
      pruefung: e.pruefung,
      ampel: e.ampel ? AMPEL[e.ampel] : null,
      kurz: e.zusammenfassung ?? undefined,
      dateien: e.dateiNamen.length ? e.dateiNamen : undefined,
      angebote: e.zeilen.map(zeileKurz),
      antwort_entwurf: beste ? antwortEntwurf({ name: beste.angebot.name, titel: beste.titel, ampel: beste.ampel, empfohlen: beste.empfohlen, ekNetto: beste.ekNetto, maxEk: beste.maxEk }) : undefined,
      link: abs(ctx, `/deal-eingang/${e.id}`),
    });
  },
});

export const dealQuellenTool = defineTool({
  name: "deal_quellen",
  title: "Deal-Eingang: Trefferquote je Quelle",
  description: "Trefferquote je Absender bzw. ProfitPath-Modul: gemeldet, Angebote, grün, gekauft, verworfen, Ø ROI laut Prüfung und Ø realer ROI (sellerboard, ab 30 Tagen nach dem Kauf).",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({}),
  run: async (ctx) => {
    const q = await quellen(ctx.session.tenantId);
    return json({ quellen: q.map((x) => ({ quelle: x.quelle, gemeldet: x.eingaenge, angebote: x.angebote, gruen: x.gruen, gekauft: x.gekauft, verworfen: x.verworfen, roi_prognose_prozent: x.roiPrognose, roi_real_prozent: x.roiReal, roi_real_aus: x.roiRealN || undefined })), link: abs(ctx, "/deal-eingang") });
  },
});

export const dealEingangPruefenTool = defineTool({
  name: "deal_eingang_pruefen",
  title: "Deal prüfen und ablegen",
  description:
    "Prüft einen Deal aus dem Chat (Text einer Nachricht oder ASIN/EAN mit EK) mit der Deal-Ampel und legt ihn im Deal-Eingang ab (Quelle optional). Ohne EK: max. EK je Land für den Ziel-ROI. Nur auf ausdrücklichen Wunsch benutzen.",
  area: "dealeingang",
  write: true,
  input: z.object({
    text: z.string().trim().max(20_000).optional(),
    asin: z.string().trim().regex(/^[A-Za-z0-9]{10}$/).optional(),
    ean: z.string().trim().regex(/^\d{8,14}$/).optional(),
    ek: z.number().positive().max(100_000).optional().describe("Einkaufspreis je Stück"),
    ek_netto: z.boolean().default(true),
    menge: z.number().int().positive().max(1_000_000).optional(),
    quelle: z.string().trim().max(80).optional(),
  }),
  summary: (i) => `Deal prüfen: ${i.asin ?? i.ean ?? (i.text ?? "").slice(0, 60)}${i.ek ? ` zu ${i.ek} €` : ""}`,
  run: async (ctx, i) => {
    if (!i.text && !i.asin && !i.ean) return { text: "text, asin oder ean angeben.", isError: true };
    const angebote =
      i.asin || i.ean
        ? [{ asin: i.asin?.toUpperCase() ?? null, ean: i.ean ?? null, name: null, marke: null, ek: i.ek ?? null, ekNetto: i.ek ? i.ek_netto : null, waehrung: "EUR", menge: i.menge ?? null, moq: null, staffel: null, versand: null, lieferzeit: null, zahlung: null, gueltigBis: null, zustand: null, packung: null }]
        : null;
    const text = i.text ?? [i.asin, i.ean, i.ek ? `${i.ek} ${i.ek_netto ? "netto" : "brutto"}` : null, i.menge ? `${i.menge} Stk` : null].filter(Boolean).join(" ");
    const r = await eingangAnlegen(ctx.session.tenantId, ctx.session.userId, { weg: "claude", text, quelle: i.quelle ?? null, angebote });
    if (r.neu) await eingangPruefen(ctx.session.tenantId, r.id);
    const e = await eingang(ctx.session.tenantId, r.id);
    if (!e) return { text: "Eingang nicht gefunden.", isError: true };
    return json({ id: e.id, neu: r.neu, pruefung: e.pruefung, fehler: e.fehler ?? undefined, ampel: e.ampel ? AMPEL[e.ampel] : null, kurz: e.zusammenfassung ?? undefined, angebote: e.zeilen.map(zeileKurz), link: abs(ctx, `/deal-eingang/${e.id}`) });
  },
});

export const dealEingangStatusTool = defineTool({
  name: "deal_eingang_status",
  title: "Deal-Eingang: Entscheidung setzen",
  description: "Setzt die Entscheidung zu einem Deal-Eingang: gekauft, verworfen (mit grund), neu. Für Bestellvorschlag/B2B-Deal die Knöpfe auf der Seite nutzen. Nur auf ausdrücklichen Wunsch benutzen.",
  area: "dealeingang",
  write: true,
  input: z.object({ id: uuid, status: z.enum(["neu", "gekauft", "verworfen"]), grund: z.string().trim().max(300).optional() }),
  summary: (i) => `Deal-Eingang → ${i.status}${i.grund ? ` (${i.grund})` : ""}`,
  run: async (ctx, i) => {
    if (i.status === "verworfen" && !i.grund) return { text: "Beim Verwerfen bitte einen Grund angeben.", isError: true };
    try {
      await statusSetzen(ctx.session.tenantId, i.id, i.status, i.grund ?? null);
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e), isError: true };
    }
    return json({ ok: true, meldung: `Status: ${STATUS_TEXT[i.status]}.`, link: abs(ctx, `/deal-eingang/${i.id}`) });
  },
});

export const DEAL_EINGANG = [dealEingangTool, dealEingangDetailTool, dealQuellenTool, dealEingangPruefenTool, dealEingangStatusTool];
