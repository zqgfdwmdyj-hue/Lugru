import "server-only";
import { z } from "zod";
import { ABLEHNUNGSGRUND_LABEL, BEREICHE, BEREICH_LABEL, PHASE_LABEL, VERLANGT_LABEL, type Ablehnungsgrund, type Bereich, type Phase, type Verlangt } from "@/lib/amazon-faelle/logic";
import { erstattungenAbgleich, faelleListe, fallAnVa, fallDetail, fallStatusSetzen, freischaltungen, SETZBARE_PHASEN } from "@/lib/amazon-faelle/service";
import { defineTool } from "../types";
import { abs, berlinDateTime, isoDate, json, uuid } from "./common";

// Amazon-Fall-Zentrale: Vorgänge aus Amazon-Mails (Freischaltung, Fall, Erstattung, Marke, Angebot, Konto …) mit
// Verlauf, Frist und vorbereitetem Paket. Die Amazon-ToDos sind die einzelnen Aufforderungen dazu (kein Doppelbestand).

const QUELLE = { text: "Amazon-Fall-Zentrale aus Seller-Central-Mails aller Postfächer", jobs: ["Postfächer", "Amazon-Fall-Zentrale"] };
const kurz = (v: Awaited<ReturnType<typeof faelleListe>>[number], ctx: Parameters<typeof abs>[0]) => ({
  id: v.id,
  titel: v.titel,
  bereich: BEREICH_LABEL[v.bereich as Bereich] ?? v.bereich,
  phase: PHASE_LABEL[v.phase as Phase] ?? v.phase,
  status: v.status,
  dringlichkeit: v.dringlichkeit,
  bitte_pruefen: v.unsicher || undefined,
  fallnummer: v.fallnummer ?? undefined,
  marktplatz: v.marktplatz ?? undefined,
  marke: v.marke ?? undefined,
  asins: v.asins.length ? v.asins : undefined,
  betrag: v.betrag ?? undefined,
  frist: v.status === "offen" ? (v.frist ?? undefined) : undefined,
  zustaendig: v.zustaendig ?? undefined,
  letzte_mail: berlinDateTime(v.letzteMailAm),
  link: abs(ctx, `/amazon-faelle/${v.id}`),
});

export const amazonFaelleTool = defineTool({
  name: "amazon_faelle",
  title: "Amazon-Fall-Zentrale",
  description:
    "Vorgänge aus Amazon-Mails: Freischaltungen (beantragt/genehmigt/abgelehnt/entzogen), Seller-Support-Fälle (Antwort nötig, gelöst, geschlossen ohne Lösung), Erstattungen, Markenbeschwerden, deaktivierte Angebote, Kontozustand, A-bis-z, FBA-Sendungen – mit Frist, Dringlichkeit (rot/gelb/grau) und Zuständigkeit. Filter: kategorie, status (offen/erledigt/info), seit (JJJJ-MM-TT), frist_in_tagen. Für den Morgenbericht: seit = gestern bzw. frist_in_tagen = 3.",
  area: "amazon",
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({
    kategorie: z.enum(BEREICHE).optional(),
    status: z.enum(["offen", "erledigt", "info"]).optional(),
    seit: isoDate.optional(),
    frist_in_tagen: z.number().int().min(0).max(60).optional(),
    suche: z.string().trim().max(80).optional().describe("Fall-ID, ASIN, SKU, Marke"),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  run: async (ctx, i) => {
    const rows = await faelleListe(ctx.session.tenantId, { bereich: i.kategorie, status: i.status ?? (i.seit ? null : "offen"), seit: i.seit ? new Date(`${i.seit}T00:00:00Z`) : null, fristInTagen: i.frist_in_tagen ?? null, q: i.suche ?? null, limit: i.limit });
    return json({ anzahl: rows.length, vorgaenge: rows.map((v) => kurz(v, ctx)), hinweis: "Einzelne Aufforderungen stehen zusätzlich unter amazon_todos.", link: abs(ctx, "/amazon-faelle") });
  },
});

export const amazonFallTool = defineTool({
  name: "amazon_fall",
  title: "Amazon-Fall: Einzelheiten",
  description: "Ein Vorgang der Fall-Zentrale (per id oder Fallnummer): Verlauf aller Mails und Statuswechsel, vorbereitetes Paket (Text DE/EN, Checkliste, Belege), was noch fehlt, Ablehnungsgründe bzw. was Amazon verlangt, betroffener Bestand bei Entzug/Markenbeschwerde, verknüpfte Ansprüche.",
  area: "amazon",
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({ id_oder_fallnummer: z.string().trim().min(6).max(40) }),
  run: async (ctx, i) => {
    const d = await fallDetail(ctx.session.tenantId, i.id_oder_fallnummer);
    if (!d) return json({ gefunden: false, hinweis: "Kein Vorgang mit dieser Kennung/Fallnummer.", link: abs(ctx, "/amazon-faelle") });
    const v = d.vorgang;
    return json({
      ...kurz(v, ctx),
      sku: v.skus.length ? v.skus : undefined,
      sendung: v.shipmentId ?? undefined,
      bestellung: v.bestellnummer ?? undefined,
      ablehnungsgruende: v.ablehnungsgruende.length ? v.ablehnungsgruende.map((g) => ABLEHNUNGSGRUND_LABEL[g as Ablehnungsgrund] ?? g) : undefined,
      amazon_verlangt: v.verlangt.length ? v.verlangt.map((x) => VERLANGT_LABEL[x as Verlangt] ?? x) : undefined,
      betroffener_bestand: d.bestand && d.bestand.stueck ? { stueck: d.bestand.stueck, ek_wert: d.bestand.ekWert, umsatz_monat: d.bestand.umsatzMonat } : undefined,
      paket: v.paket ? { text_de: v.paket.texte.de, text_en: v.paket.texte.en, checkliste: v.paket.checkliste, belege: v.paket.belege.map((b) => b.name), fehlt: v.paket.fehlt.length ? v.paket.fehlt : undefined } : undefined,
      verlauf: d.verlauf.map((x) => ({ am: berlinDateTime(x.am), art: x.art, text: x.text, von: x.von ?? undefined })),
      ansprueche: d.ansprueche.length ? d.ansprueche.map((a) => ({ titel: a.title, status: a.status, betrag: a.expectedAmount, link: abs(ctx, `/ansprueche/${a.id}`) })) : undefined,
      va_aufgabe: d.task ? { status: d.task.status } : undefined,
    });
  },
});

export const freischaltungenTool = defineTool({
  name: "freischaltungen",
  title: "Freischaltungen je Marke",
  description: "Freischaltungen aus Amazon-Mails je Marke/ASIN und Marktplatz: Status (beantragt, genehmigt, abgelehnt, Unterlagen nachreichen, entzogen), Ablehnungsgründe, Erfolgsquote je Marke mit häufigsten Gründen und „jetzt einkaufbar“ (genehmigt mit offenem Deal/Deal-Eingang).",
  area: "amazon",
  ownerOnly: true,
  write: false,
  quelle: QUELLE,
  input: z.object({ marke: z.string().trim().max(80).optional(), status: z.enum(["offen", "beantragt", "genehmigt", "abgelehnt", "nachreichen", "entzogen"]).optional() }),
  run: async (ctx, i) => {
    const f = await freischaltungen(ctx.session.tenantId, { marke: i.marke ?? null, status: i.status ?? null });
    return json({
      freischaltungen: f.liste.slice(0, 60).map((v) => ({ marke: v.marke ?? undefined, asins: v.asins, marktplatz: v.marktplatz ?? undefined, status: PHASE_LABEL[v.phase as Phase] ?? v.phase, seit: berlinDateTime(v.ersteMailAm), zuletzt: berlinDateTime(v.letzteMailAm), gruende: v.ablehnungsgruende.length ? v.ablehnungsgruende.map((g) => ABLEHNUNGSGRUND_LABEL[g as Ablehnungsgrund] ?? g) : undefined, link: abs(ctx, `/amazon-faelle/${v.id}`) })),
      quote_je_marke: f.quote,
      jetzt_einkaufbar: f.einkaufbar.length ? f.einkaufbar : undefined,
      link: abs(ctx, "/amazon-faelle?bereich=freischaltung&status=alle"),
    });
  },
});

export const erstattungenAbgleichTool = defineTool({
  name: "erstattungen_abgleich",
  title: "Erstattungen an Kunden prüfen",
  description: "Abgleich Kunden-Erstattung ↔ Rücksendung bei Amazon ↔ Entschädigung (FBA): je Bestellposition Status, erstatteter und noch offener Betrag; Summen je Monat. status: ohne_ruecksendung (erstattet, nicht zurück, nicht entschädigt), beschaedigt (von Amazon/Spediteur beschädigt), offen (offener Betrag), erhalten. Zeitraum mit von/bis (Erstattungsdatum).",
  area: "amazon",
  ownerOnly: true,
  write: false,
  quelle: { text: "Retouren-Abgleich aus Amazon-Transaktionen, Kundenretouren- und Erstattungsbericht", jobs: ["Amazon-Reports abholen"] },
  input: z.object({ status: z.enum(["ohne_ruecksendung", "beschaedigt", "offen", "erhalten"]).optional(), von: isoDate.optional(), bis: isoDate.optional(), limit: z.number().int().min(1).max(200).default(50) }),
  run: async (ctx, i) => {
    const r = await erstattungenAbgleich(ctx.session.tenantId, { status: i.status ?? null, vonTag: i.von ?? null, bisTag: i.bis ?? null });
    return json({ quellen: r.quellen, offen_summe: r.summen.offen, positionen: r.zeilen.length, zeilen: r.zeilen.slice(0, i.limit), je_monat: r.monate.slice(0, 12), link: abs(ctx, "/retouren") });
  },
});

export const amazonFallStatusTool = defineTool({
  name: "amazon_fall_status",
  title: "Amazon-Fall: Status setzen",
  description: "Setzt Status/Phase eines Vorgangs der Fall-Zentrale (eingereicht, beantwortet, gelöst, genehmigt, abgelehnt, geschlossen ohne Lösung, erledigt), erfasst die Fallnummer aus Seller Central und eine Notiz. Nur auf ausdrücklichen Wunsch benutzen.",
  area: "amazon",
  ownerOnly: true,
  write: true,
  input: z.object({ id: uuid, status: z.enum([...SETZBARE_PHASEN, "erledigt"]).optional(), fallnummer: z.string().trim().regex(/^\d{6,14}$/).optional(), notiz: z.string().trim().max(1000).optional() }),
  summary: (i) => `Amazon-Fall → ${i.status ?? "Notiz"}${i.fallnummer ? ` (Fall ${i.fallnummer})` : ""}`,
  run: async (ctx, i) => {
    if (!i.status && !i.fallnummer && !i.notiz) return { text: "status, fallnummer oder notiz angeben.", isError: true };
    try {
      const v = await fallStatusSetzen(ctx.session.tenantId, i.id, { phase: i.status && i.status !== "erledigt" ? i.status : null, erledigt: i.status === "erledigt", fallnummer: i.fallnummer ?? null, notiz: i.notiz ?? null }, "Claude");
      return json({ ok: true, status: v.status, phase: PHASE_LABEL[v.phase as Phase] ?? v.phase, fallnummer: v.fallnummer ?? undefined, link: abs(ctx, `/amazon-faelle/${v.id}`) });
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e), isError: true };
    }
  },
});

export const amazonFallAnVaTool = defineTool({
  name: "amazon_fall_an_va",
  title: "Amazon-Fall an die VA",
  description: "Gibt einen Vorgang mit vorbereitetem Paket (Text DE/EN, Checkliste, Rechnungen) als Aufgabe an die VA (Discord-Thread). Nur auf ausdrücklichen Wunsch benutzen.",
  area: "amazon",
  ownerOnly: true,
  write: true,
  input: z.object({ id: uuid }),
  summary: () => "Amazon-Fall an die VA",
  run: async (ctx, i) => {
    const r = await fallAnVa(ctx.session.tenantId, i.id, ctx.session.userId);
    return r.ok ? json({ ok: true, meldung: "An die VA übergeben (Discord-Thread).", link: abs(ctx, `/amazon-faelle/${i.id}`) }) : { text: r.fehler, isError: true };
  },
});

export const AMAZON_FAELLE = [amazonFaelleTool, amazonFallTool, freischaltungenTool, erstattungenAbgleichTool, amazonFallStatusTool, amazonFallAnVaTool];
