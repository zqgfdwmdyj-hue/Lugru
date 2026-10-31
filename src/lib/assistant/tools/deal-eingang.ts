import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { DAUMEN_GRUENDE, type DealEingangZeile } from "@/db/tables/deal-eingang";
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
    "Geprüfte Deal-Eingänge (geteilt aus WhatsApp, iPhone-Kurzbefehl, Mail, ProfitPath, Lugru Deals, von Claude) mit Ampel und Kurzbegründung. Filter: status (neu, gekauft, bestellvorschlag, b2b, verworfen, preisliste), quelle (Absender bzw. „ProfitPath · Modul“; „Lugru Deals“ trifft alle Lugru-Kanäle), ampel, seit (YYYY-MM-DD). Aus der Lugru-History nachgetragene Eingänge (historisch: true, Ampel aus Post + Keepa beim Posten, kein Push) nur mit quelle oder mit_historie. Für den Morgenbericht: seit = gestern, ampel grün/gelb.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({
    status: z.enum(["neu", "gekauft", "bestellvorschlag", "b2b", "verworfen", "preisliste"]).optional(),
    quelle: z.string().trim().min(1).max(80).optional(),
    ampel: z.enum(["gruen", "gelb", "rot"]).optional(),
    seit: isoDate.optional(),
    mit_historie: z.boolean().default(false).describe("auch aus der Lugru-History nachgetragene Eingänge"),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  run: async (ctx, i) => {
    const rows = await eingaenge(ctx.session.tenantId, { status: i.status, quelle: i.quelle, ampel: i.ampel, seit: i.seit ? new Date(`${i.seit}T00:00:00Z`) : undefined, limit: i.limit, mitHistorie: i.mit_historie });
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
        historisch: e.historisch || undefined,
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
  description: "Trefferquote je Absender bzw. ProfitPath-Modul und „Lugru Deals“ (alle Posts der Gruppe inkl. History; je Kanal zusätzlich „Lugru Deals · #kanal“): gemeldet, Angebote, grün, gekauft, verworfen, Ø ROI laut Prüfung, Ø realer ROI (sellerboard, ab 30 Tagen nach dem Kauf), bei Lugru auch ✅-Käufe der Gruppe als Anzahl.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({}),
  run: async (ctx) => {
    const q = await quellen(ctx.session.tenantId);
    return json({ quellen: q.map((x) => ({ quelle: x.quelle, gemeldet: x.eingaenge, angebote: x.angebote, gruen: x.gruen, gekauft: x.gekauft, verworfen: x.verworfen, roi_prognose_prozent: x.roiPrognose, roi_real_prozent: x.roiReal, roi_real_aus: x.roiRealN || undefined, gruppen_kaeufe: x.gruppenKaeufe, ohne_testkanaele: x.testAusgeblendet ? `${x.testAusgeblendet} Deals aus Testkanälen nicht gezählt` : undefined, link: abs(ctx, x.link) })), link: abs(ctx, "/deal-eingang") });
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

// ---- Abschnitt 10/11: Deal-Wert, Lernbericht, 👍/👎, gekauft ------------------------------------------------------

const QUELLE_WERT = { text: "Deal-Eingang: Deal-Wert aus Kennzahlen (Keepa-Zwischenspeicher), ähnlichen früheren Deals (eigene + Lugru-Deals-Gruppe, nur Anzahlen) und ab 100 eigenen Deals mit Ergebnis einem Lernmodell" };

export const dealWertTool = defineTool({
  name: "deal_wert",
  title: "Deal-Wert",
  description:
    "Wie gut passt ein Deal zu Ludwig (0–100) mit Begründung („Passt zu dir (78/100): … Gegen: …“), Pro/Contra und ähnlichen früheren Deals (eigene Käufe/👍/👎/reale Ergebnisse, Lugru-Gruppe). deal_id = gespeicherter Wert eines Deal-Eingangs (je Angebot); asin = Markt-Sicht ohne EK. Rote Ampel deckelt auf 30 – der Wert ersetzt keine Prüfung.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE_WERT,
  input: z.object({ deal_id: uuid.optional(), asin: z.string().trim().regex(/^[A-Za-z0-9]{10}$/).optional() }),
  run: async (ctx, i) => {
    if (!i.deal_id && !i.asin) return { text: "deal_id oder asin angeben.", isError: true };
    const { dealWertFuer } = await import("@/lib/deal-eingang/wert");
    const r = await dealWertFuer(ctx.session.tenantId, { dealId: i.deal_id, asin: i.asin?.toUpperCase() });
    if (!r) return { text: "Deal-Eingang nicht gefunden.", isError: true };
    const aehnlich = (w: { aehnliche: { id: string | null; quelle: string; titel: string | null; asin: string | null; datum: string; ergebnis: string }[] }) =>
      w.aehnliche.map((a) => ({ quelle: a.quelle === "eigen" ? "eigener Deal" : "Lugru-Gruppe", titel: a.titel ?? undefined, asin: a.asin ?? undefined, datum: a.datum, ergebnis: a.ergebnis, link: a.id ? abs(ctx, `/deal-eingang/${a.id}`) : undefined }));
    if (r.art === "eingang") {
      if (!r.zeilen.length) return json({ deal_id: r.deal_id, hinweis: "Für diesen Eingang wurde noch kein Deal-Wert berechnet (vor Abschnitt 11 geprüft oder ohne ASIN) – im Deal-Eingang „Neu rechnen“.", link: abs(ctx, `/deal-eingang/${r.deal_id}`) });
      return json({
        deal_id: r.deal_id,
        angebote: r.zeilen.map((z) => ({ nr: z.nr, asin: z.asin, titel: z.titel, ampel: AMPEL[z.ampel], deal_wert: z.wert.wert, begruendung: z.wert.begruendung, dafuer: z.wert.dafuer, dagegen: z.wert.dagegen, verfahren: z.wert.verfahren, gedeckelt_wegen_rot: z.wert.gedeckelt || undefined, aehnliche_deals: aehnlich(z.wert) })),
        link: abs(ctx, `/deal-eingang/${r.deal_id}`),
      });
    }
    return json({ asin: r.asin, ohne_ek: true, hinweis: "Ohne EK nur Markt-Sicht (Keepa) und ähnliche Deals – für die volle Prüfung deal_eingang_pruefen mit EK.", deal_wert: r.wert.wert, begruendung: r.wert.begruendung, dafuer: r.wert.dafuer, dagegen: r.wert.dagegen, verfahren: r.wert.verfahren, aehnliche_deals: aehnlich(r.wert), link: abs(ctx, "/deal-eingang") });
  },
});

const vormonat = (heute: string) => {
  const d = new Date(`${heute.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export const dealLernenBerichtTool = defineTool({
  name: "deal_lernen_bericht",
  title: "Deal-Wert: Monatsbericht",
  description:
    "Monatsbericht „Wie gut lag der Deal-Wert?“: Deals mit Wert, Anzahl über der Schwelle, Trefferquote (über der Schwelle und danach gekauft/gut bzw. 👍), verpasste gute Deals (Wert < 50, aber gekauft/👍), Fehlkäufe (realer ROI < 0), Verfahren (Kennzahlen + ähnliche Deals bzw. Lernmodell ab 100 eigenen Deals mit Ergebnis) und Stand der Lugru-Deals-History. monat = YYYY-MM, Standard Vormonat.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE_WERT,
  input: z.object({ monat: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }),
  run: async (ctx, i) => {
    const monat = i.monat ?? vormonat(ctx.today);
    const { lernBerichtFuer } = await import("@/lib/deal-eingang/wert");
    const b = await lernBerichtFuer(ctx.session.tenantId, monat);
    return json({
      monat: b.monat,
      deals: b.deals,
      mit_deal_wert: b.mitWert,
      ueber_schwelle: b.ueberSchwelle,
      schwelle: b.schwelle,
      trefferquote_prozent: b.trefferquote,
      treffer_basis: b.trefferBasis,
      verpasst: b.verpasst.map((d) => ({ titel: d.titel, datum: d.datum, deal_wert: d.wert, link: abs(ctx, `/deal-eingang/${d.id}`) })),
      fehlkaeufe: b.fehlkaeufe.map((d) => ({ titel: d.titel, datum: d.datum, deal_wert: d.wert, realer_roi_prozent: d.realerRoi, link: abs(ctx, `/deal-eingang/${d.id}`) })),
      verfahren: b.verfahren,
      wichtigste_merkmale: b.wichtigsteMerkmale ?? undefined,
      lugru_history: { deals: b.lugru.deals, mit_kauf_reaktion: b.lugru.mitKauf, kauf_reaktionen: b.lugru.kaeufe, stand: b.lugru.zuletzt?.toISOString() ?? null },
      link: abs(ctx, `/deal-eingang/lernen?monat=${monat}`),
    });
  },
});

export const dealBewertenTool = defineTool({
  name: "deal_bewerten",
  title: "Deal bewerten (👍/👎)",
  description: `Speichert 👍 (hoch) oder 👎 (runter) zu einem Deal-Eingang, optional mit Kurzgrund aus der festen Liste (${DAUMEN_GRUENDE.join(", ")}). Fließt in den Deal-Wert ein. Lässt sich 7 Tage rückgängig machen. Nur auf ausdrücklichen Wunsch.`,
  area: "dealeingang",
  write: true,
  input: z.object({ deal_id: uuid, daumen: z.enum(["hoch", "runter"]), grund: z.enum(DAUMEN_GRUENDE).optional() }),
  summary: (i) => `Deal ${i.daumen === "hoch" ? "👍" : "👎"}${i.grund ? ` (${i.grund})` : ""}`,
  run: async (ctx, i) => {
    const E = schema.dealEingaenge;
    const [vorher] = await db.select({ daumen: E.daumen, grund: E.daumenGrund, weg: E.daumenWeg, am: E.daumenAm }).from(E).where(and(eq(E.tenantId, ctx.session.tenantId), eq(E.id, i.deal_id)));
    if (!vorher) return { text: "Deal-Eingang nicht gefunden.", isError: true };
    const { bewerten } = await import("@/lib/deal-eingang/wert");
    await bewerten(ctx.session.tenantId, i.deal_id, { daumen: i.daumen, grund: i.grund ?? null, weg: "claude" });
    return { text: JSON.stringify({ ok: true, gespeichert: i.daumen === "hoch" ? "👍" : "👎", grund: i.grund, link: abs(ctx, `/deal-eingang/${i.deal_id}`) }), ids: [i.deal_id], undo: { id: i.deal_id, vorher: { ...vorher, am: vorher.am?.toISOString() ?? null } } };
  },
  undo: async (ctx, d) => {
    const E = schema.dealEingaenge;
    const x = d as { id: string; vorher: { daumen: "hoch" | "runter" | null; grund: string | null; weg: "tool" | "push" | "discord" | "claude" | null; am: string | null } };
    await db.update(E).set({ daumen: x.vorher.daumen, daumenGrund: x.vorher.grund, daumenWeg: x.vorher.weg, daumenAm: x.vorher.am ? new Date(x.vorher.am) : null }).where(and(eq(E.tenantId, ctx.session.tenantId), eq(E.id, x.id)));
    return "Bewertung zurückgenommen.";
  },
});

export const dealGekauftTool = defineTool({
  name: "deal_gekauft",
  title: "Deal als gekauft markieren",
  description:
    "Markiert einen Deal-Eingang als gekauft (Menge, Preis netto je Stück): legt die Einkaufs-Bestellung als „bestellt“ an, Wareneingang und Rechnung werden erwartet. Kauft NICHTS ein – nur erfassen, was Ludwig selbst gekauft hat. Einzeln bestätigen. Nur auf ausdrücklichen Wunsch.",
  area: "dealeingang",
  write: true,
  stufe: "gelb",
  input: z.object({ deal_id: uuid, menge: z.number().int().positive().max(100_000), preis: z.number().positive().max(100_000).optional().describe("EK netto je Stück; leer = EK aus der Prüfung"), nr: z.number().int().positive().max(500).optional().describe("Angebot im Eingang (Nr.)") }),
  summary: (i) => `Deal gekauft: ${i.menge} Stk${i.preis ? ` zu ${i.preis.toFixed(2).replace(".", ",")} € netto` : ""}`,
  run: async (ctx, i) => {
    const { alsGekauft } = await import("@/lib/deal-eingang/kauf");
    try {
      const r = await alsGekauft(ctx.session.tenantId, i.deal_id, { menge: i.menge, preis: i.preis ?? null, nr: i.nr ?? null, weg: "claude" }, ctx.session.userId);
      return { text: JSON.stringify({ ok: true, menge: i.menge, angebot_nr: r.zeile, bestellung: r.bestellungId ? abs(ctx, `/einkauf/${r.bestellungId}`) : null, hinweis: r.bestellungId ? "Bestellung „bestellt“ – Wareneingang und Rechnung werden erwartet." : undefined, link: abs(ctx, `/deal-eingang/${i.deal_id}`) }), ids: [i.deal_id] };
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e), isError: true };
    }
  },
});

export const DEAL_EINGANG = [dealEingangTool, dealEingangDetailTool, dealQuellenTool, dealEingangPruefenTool, dealEingangStatusTool, dealWertTool, dealLernenBerichtTool, dealBewertenTool, dealGekauftTool];
