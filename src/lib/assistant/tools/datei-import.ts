import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { IMPORT_ARTEN, IMPORT_ART_KEYS, GUELTIG_MIN, MAX_MB } from "@/lib/datei-import/logic";
import { importeListe, importLinkAnlegen, importStatus } from "@/lib/datei-import/service";
import { umsatzsteuerBlock, umsatzsteuerOss } from "@/lib/datei-import/umsatzsteuer";
import { defineTool } from "../types";
import { abs, json, uuid } from "./common";

// Datei-Import über den Konnektor (Bauauftrag Datei-Import): import_link (ändernd, nur Inhaber) → Datei per HTTPS-PUT
// → import_status / importe. Dazu Umsatzsteuer je Periode/OSS-Quartal und Lagergebühren aus den importierten Berichten.

const ARTEN_TEXT = Object.entries(IMPORT_ARTEN).map(([k, v]) => `${k} = ${v.text}`).join("; ");

const importLink = defineTool({
  name: "import_link",
  title: "Datei-Import: Upload-Adresse anlegen",
  description: `Datei ins Seller-System laden, ohne die Oberfläche zu öffnen (nur auf ausdrücklichen Wunsch). Liefert eine einmalige Upload-Adresse (${GUELTIG_MIN} Min. gültig, höchstens ${MAX_MB} MB): die Datei per HTTPS-PUT dorthin schicken (z. B. curl -T datei.csv <upload_url>), danach mit import_status das Ergebnis abfragen. Verarbeitet wird mit demselben Code wie der Upload in der Oberfläche; dieselbe Datei zweimal → „bereits importiert“, nichts doppelt. Arten: ${ARTEN_TEXT}. Beim Geschäftsbericht Land und Zeitraum in „hinweis“ (z. B. „DE, 01.10.–31.10.2026“), bei der Preisliste den Lieferanten (Name oder Kürzel).`,
  area: null,
  ownerOnly: true,
  write: true,
  input: z.object({
    art: z.enum(IMPORT_ART_KEYS),
    dateiname: z.string().min(1).max(200),
    hinweis: z.string().max(300).optional().describe("z. B. „Marktplatz DE, Jan–Okt 2026“, beim Geschäftsbericht Land + Zeitraum, bei Preislisten der Lieferant"),
  }),
  summary: (i) => `Upload-Adresse für ${i.dateiname} (${i.art})`,
  run: async (ctx, i) => {
    const r = await importLinkAnlegen(ctx.session, { art: i.art, dateiname: i.dateiname, hinweis: i.hinweis ?? null }, ctx.baseUrl);
    return { text: json({ ...r, anleitung: `Datei innerhalb von ${GUELTIG_MIN} Minuten per PUT an upload_url schicken (Content-Type ${r.content_type}); danach import_status(import_id).` }), ids: [r.import_id] };
  },
});

const importStatusTool = defineTool({
  name: "import_status",
  title: "Datei-Import: Stand und Ergebnis",
  description: "Stand eines Datei-Imports (wartet_auf_datei | verarbeitet | fertig | fehler) mit Fortschritt und – wenn fertig – Ergebnis je Art: beim Amazon-Transaktionsbericht Zeitraum, Marktplätze, Zeilen, Abrechnungen, Summen je Typ, Auszahlungen (Übertrag) und was sich im System geändert hat (neu / bereits vorhanden, Abrechnungen ergänzt); beim Kontoauszug Kontostand und Buchungen; bei der EK-Liste neu/geändert/gleich mit Link; beim USt-Bericht der Block je Periode; bei Lagergebühren Monate, Länder, teuerste ASINs.",
  area: null,
  ownerOnly: true,
  write: false,
  input: z.object({ import_id: uuid }),
  run: async (ctx, i) => {
    const s = await importStatus(ctx.session.tenantId, i.import_id);
    if (!s) return { text: json({ fehler: "Import nicht gefunden." }), isError: true };
    const link = (s.ergebnis as { link?: string } | undefined)?.link;
    const ergebnis = s.ergebnis && link ? { ...(s.ergebnis as Record<string, unknown>), link: abs(ctx, link) } : s.ergebnis;
    return json({ ...s, ergebnis, link: link ? abs(ctx, link) : abs(ctx, "/uploads") });
  },
});

const importe = defineTool({
  name: "importe",
  title: "Datei-Importe (letzte)",
  description: "Letzte Datei-Importe über den Konnektor mit Status, Art, Datei, Datum und Kurzfassung des Ergebnisses. Filter: art.",
  area: null,
  ownerOnly: true,
  write: false,
  input: z.object({ limit: z.number().int().min(1).max(100).default(20), art: z.enum(IMPORT_ART_KEYS).optional() }),
  run: async (ctx, i) => json({ importe: await importeListe(ctx.session.tenantId, { limit: i.limit, art: i.art ?? null }), link: abs(ctx, "/uploads") }),
});

const umsatzsteuer = defineTool({
  name: "umsatzsteuer",
  title: "Umsatzsteuer je Periode (Amazon-USt-Bericht)",
  description: "Aus dem importierten Amazon-Umsatzsteuer-Transaktionsbericht für eine Periode (JJJJ-MM): Marktplätze, Zeilen je Typ, Umsatz netto/USt/brutto je Steuerland (davon OSS/lokal), Anteil OSS/REGULAR, Pan-EU-Verbringungen (Stück je Abgang→Ankunft, kein Umsatz), INVOICE/CREDIT_NOTE ohne Steuerland gesondert, Abweichung zum sellerboard-Monatsumsatz. Nur Zahlen und Hinweise – keine Steuerberatung.",
  area: ["geld", "buchhaltung"],
  write: false,
  quelle: { text: "Amazon-Umsatzsteuer-Transaktionsbericht (Datei-Import bzw. Upload), sellerboard-Monatswerte" },
  input: z.object({ periode: z.string().regex(/^\d{4}-\d{2}$/, "Periode als JJJJ-MM") }),
  run: async (ctx, i) => json({ ...(await umsatzsteuerBlock(ctx.session.tenantId, i.periode)), link: abs(ctx, `/buchhaltung?monat=${i.periode}`) }),
});

const umsatzsteuerOssTool = defineTool({
  name: "umsatzsteuer_oss",
  title: "OSS je Quartal (Amazon-USt-Bericht)",
  description: "OSS-Zahlen je Quartal (JJJJ-Q1 … Q4) aus den importierten Umsatzsteuer-Transaktionsberichten: Land, Steuersatz, Netto, USt, Summe – mit Hinweis, wenn Monate fehlen. Keine Steuerberatung.",
  area: ["geld", "buchhaltung"],
  write: false,
  quelle: { text: "Amazon-Umsatzsteuer-Transaktionsbericht (Datei-Import bzw. Upload)" },
  input: z.object({ quartal: z.string().regex(/^\d{4}-Q[1-4]$/i, "Quartal als JJJJ-Q1 … JJJJ-Q4") }),
  run: async (ctx, i) => json({ ...(await umsatzsteuerOss(ctx.session.tenantId, i.quartal)), link: abs(ctx, "/buchhaltung") }),
});

const lagergebuehren = defineTool({
  name: "lagergebuehren",
  title: "FBA-Lagergebühren je Monat",
  description: "Monatliche FBA-Lagergebühren aus dem Amazon-Bericht „Monthly Storage Fees“ (Datei-Import bzw. Upload): Summe je Monat und Land, teuerste ASINs, je ASIN Gebühr, Ø Bestand und Gebühr je Stück. Die Gebühren stecken schon in der Amazon-Abrechnung – zur Auswertung je Artikel, nicht zusätzlich zum Gewinn. Filter: monat (JJJJ-MM), asin.",
  area: "amazon",
  write: false,
  quelle: { text: "Amazon-Bericht „Monthly Storage Fees“ (Datei-Import bzw. Upload)", importe: true },
  input: z.object({ monat: z.string().regex(/^\d{4}-\d{2}$/).optional(), asin: z.string().max(12).optional(), limit: z.number().int().min(1).max(100).default(15) }),
  run: async (ctx, i) => {
    const L = schema.amazonLagergebuehren;
    const t = ctx.session.tenantId;
    const monate = await db.select({ monat: L.monat, summe: sql<number>`sum(${L.gebuehr})::float`, asins: sql<number>`count(distinct ${L.asin})::int` }).from(L).where(eq(L.tenantId, t)).groupBy(L.monat).orderBy(desc(L.monat));
    if (!monate.length) return json({ hinweis: "Noch keine Lagergebühren importiert – Bericht „Monthly Storage Fees“ hochladen (Upload-Seite oder import_link art=amazon_lagergebuehren).", link: abs(ctx, "/uploads") });
    const monat = i.monat ?? monate[0].monat;
    const wo = and(eq(L.tenantId, t), eq(L.monat, monat), i.asin ? eq(L.asin, i.asin.toUpperCase()) : undefined);
    const [laender, asins] = await Promise.all([
      db.select({ land: L.land, summe: sql<number>`sum(${L.gebuehr})::float` }).from(L).where(wo).groupBy(L.land).orderBy(desc(sql`sum(${L.gebuehr})`)),
      db
        .select({ asin: L.asin, titel: sql<string | null>`max(${L.titel})`, summe: sql<number>`sum(${L.gebuehr})::float`, bestand: sql<number>`sum(coalesce(${L.bestandSchnitt}, 0))::float`, zuschlag: sql<number>`sum(coalesce(${L.zuschlag}, 0))::float` })
        .from(L)
        .where(wo)
        .groupBy(L.asin)
        .orderBy(desc(sql`sum(${L.gebuehr})`))
        .limit(i.limit),
    ]);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return json({
      monat,
      monate: monate.map((m) => ({ monat: m.monat, gebuehr: r2(m.summe), asins: m.asins })),
      laender: laender.map((l) => ({ land: l.land, gebuehr: r2(l.summe) })),
      asins: asins.map((a) => ({ asin: a.asin, titel: a.titel ?? undefined, gebuehr: r2(a.summe), bestand_schnitt: r2(a.bestand), je_stueck: a.bestand > 0 ? r2(a.summe / a.bestand) : null, zuschlag_auslastung: a.zuschlag ? r2(a.zuschlag) : undefined, link: abs(ctx, `/produkte?q=${a.asin}`) })),
      hinweis: "Geschätzte Gebühren laut Amazon (Bericht „Monthly Storage Fees“); bereits in der Amazon-Abrechnung enthalten.",
    });
  },
});

export const DATEI_IMPORT = [importLink, importStatusTool, importe, umsatzsteuer, umsatzsteuerOssTool, lagergebuehren];
