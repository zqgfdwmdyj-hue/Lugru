import "server-only";
import { and, eq, ilike, max, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { alterUeber180, fehlendeListungen, LAENDER, verdichteAngebote, type Land, type ListingZeile } from "@/lib/amazon-markt/logic";
import { amazonLaender, itemOffers } from "@/lib/integrations/clients/amazon";
import { defineTool } from "../types";
import { abs, berlinDateTime, json, likeOf } from "./common";

// Amazon je Land: Buy-Box-Anteil, Angebote live, Listung, Lageralter. Nur lesen.

const landSchema = z.enum(LAENDER as [Land, ...Land[]]);
const asinSchema = z.string().trim().regex(/^[A-Za-z0-9]{10}$/, "ASIN mit 10 Zeichen");
const KEIN_ABRUF = "noch nicht abgerufen – kommt automatisch mit dem nächsten Amazon-Abruf (Marktplätze unter Anbindungen → Amazon)";

async function stand(tenantId: string, table: typeof schema.amazonBuybox | typeof schema.amazonListungen | typeof schema.amazonLageralter) {
  const rows = await db.select({ land: table.land, am: max(table.abgerufenAm) }).from(table).where(eq(table.tenantId, tenantId)).groupBy(table.land);
  return rows.map((r) => ({ land: r.land, am: r.am }));
}
const standText = (s: { land: string; am: Date | null }[]) => (s.length ? s.map((x) => `${x.land} ${berlinDateTime(x.am)}`).join(", ") : KEIN_ABRUF);

export const amazonBuybox = defineTool({
  name: "amazon_buybox",
  title: "Amazon: Buy-Box-Anteil je Land",
  description:
    "Buy-Box-Anteil, Sitzungen, Seitenaufrufe, Kaufquote, verkaufte Einheiten und Umsatz je ASIN und Land (letzte 30 Tage, Amazon-Bericht „Sales and Traffic“ – der Geschäftsbericht in Seller Central). Für „Wo verliere ich die Buy Box?“, „Welche ASIN hat viele Besucher, aber wenig Käufe?“. Ersetzt den Download des Geschäftsberichts.",
  area: "amazon",
  write: false,
  quelle: { text: "Amazon-Bericht Sales and Traffic (Geschäftsbericht) über die Schnittstelle" },
  input: z.object({
    land: z.union([z.literal("alle"), landSchema]).default("alle"),
    asin: asinSchema.optional(),
    buybox_unter: z.number().min(0).max(100).optional().describe("Nur ASINs mit Buy-Box-Anteil unter diesem Wert (%)"),
    sortierung: z.enum(["sitzungen", "buybox_aufsteigend", "umsatz"]).default("sitzungen"),
    limit: z.number().int().min(1).max(300).default(60),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const B = schema.amazonBuybox;
    const rows = await db.select().from(B).where(and(eq(B.tenantId, t), i.land !== "alle" ? eq(B.land, i.land) : undefined, i.asin ? or(eq(B.asin, i.asin.toUpperCase()), eq(B.elternAsin, i.asin.toUpperCase())) : undefined));
    const list = rows
      .filter((r) => i.buybox_unter === undefined || (r.buyboxProzent !== null && r.buyboxProzent < i.buybox_unter))
      .sort((a, b) => (i.sortierung === "buybox_aufsteigend" ? (a.buyboxProzent ?? 999) - (b.buyboxProzent ?? 999) : i.sortierung === "umsatz" ? (b.umsatz ?? 0) - (a.umsatz ?? 0) : (b.sitzungen ?? 0) - (a.sitzungen ?? 0)));
    const st = await stand(t, B);
    return json({
      zeitraum: rows[0] ? { von: rows[0].von, bis: rows[0].bis } : undefined,
      anzahl: list.length,
      zeilen: list.slice(0, i.limit).map((r) => ({ land: r.land, asin: r.asin, eltern_asin: r.elternAsin ?? undefined, sku: r.sku ?? undefined, buybox_prozent: r.buyboxProzent, sitzungen: r.sitzungen, seitenaufrufe: r.seitenaufrufe, kaufquote_prozent: r.kaufquoteProzent, einheiten: r.einheiten, umsatz: r.umsatz, waehrung: r.waehrung ?? undefined })),
      hinweis: list.length > i.limit ? `Nur die ersten ${i.limit} von ${list.length}.` : !rows.length ? KEIN_ABRUF : undefined,
      laender_der_anbindung: await amazonLaender(t),
      link: abs(ctx, "/hebel?typ=kaufquote"),
      datenstand: { quelle: "Amazon Sales and Traffic (30 Tage) über die Schnittstelle", stand: standText(st), abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const amazonAngebote = defineTool({
  name: "amazon_angebote",
  title: "Amazon: Angebote live",
  description:
    "Aktuelle Angebote zu einer ASIN direkt von Amazon (Pricing-Schnittstelle): Buy-Box-Preis, wer sie hat (wir, Amazon, FBA- oder FBM-Händler), Anzahl Neu-Angebote FBA/FBM, niedrigste Preise FBA/FBM, ob Amazon selbst mitverkauft, Rang und die Top-Angebote. Ein Land oder „alle“ Länder der Anbindung. Für „Wer hat gerade die Buy Box?“, „Wie viele Angebote gibt es jetzt?“. 10 Min. zwischengespeichert.",
  area: ["amazon", "lieferanten"],
  write: false,
  quelle: { text: "Amazon Pricing-Schnittstelle (live)" },
  input: z.object({ asin: asinSchema, land: z.union([z.literal("alle"), landSchema]).default("DE") }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const asin = i.asin.toUpperCase();
    const laender = i.land === "alle" ? await amazonLaender(t) : [i.land];
    if (!laender.length) return { text: "Amazon ist nicht verbunden oder ohne Marktplätze (Anbindungen → Amazon).", isError: true };
    const out: Record<string, unknown>[] = [];
    let ausSpeicher = 0;
    let aeltester: Date | null = null;
    for (const land of laender) {
      try {
        const r = await itemOffers(t, asin, land);
        if (r.ausSpeicher) ausSpeicher++;
        if (!aeltester || r.abgerufen < aeltester) aeltester = r.abgerufen;
        const a = verdichteAngebote(r.payload, land, r.eigeneId);
        out.push({ land, buybox_preis: a.buyboxPreis, buybox_bei: a.buyboxBei, buybox_verkaeufer: a.buyboxVerkaeufer ?? undefined, angebote_neu: a.angeboteGesamt, angebote_fba: a.angeboteFba, angebote_fbm: a.angeboteFbm, niedrigster_fba: a.niedrigsterFba, niedrigster_fbm: a.niedrigsterFbm, amazon_bietet_mit: a.amazonBietetMit, rang: a.rang ?? undefined, waehrung: a.waehrung ?? undefined, top_angebote: i.land === "alle" ? undefined : a.angebote });
      } catch (e) {
        out.push({ land, fehler: e instanceof Error ? e.message : String(e) });
      }
    }
    return json({
      asin,
      laender: out,
      legende: { buybox_preis: "inklusive Versand", buybox_bei: "uns = unser Angebot hat die Buy Box", fehler: "z. B. ASIN im Land nicht vorhanden oder Marktplatz nicht freigeschaltet" },
      link: abs(ctx, `/lieferanten/abfrage?q=${asin}`),
      datenstand: { quelle: "Amazon Pricing-Schnittstelle (live)", stand: ausSpeicher === out.length && aeltester ? `aus dem Zwischenspeicher (abgerufen ${berlinDateTime(aeltester)}, höchstens 10 Min. alt)` : `gerade bei Amazon abgerufen (${berlinDateTime(new Date())})`, abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const amazonListungen = defineTool({
  name: "amazon_listungen",
  title: "Amazon: Listung je Land",
  description:
    "In welchen Ländern eine SKU/ASIN gelistet und aktiv ist – und wo sie fehlt oder inaktiv ist (Amazon-Bericht „Alle Angebote“ je Land der Anbindung). Standard: nur SKUs, die irgendwo aktiv sind, aber in einem anderen Land fehlen. Für „Ist der Philips in Spanien gelistet?“, „Wo fehlen meine Angebote?“.",
  area: "amazon",
  write: false,
  quelle: { text: "Amazon-Bericht Alle Angebote je Land über die Schnittstelle" },
  input: z.object({ suche: z.string().trim().max(80).optional().describe("SKU, ASIN oder Titel"), ansicht: z.enum(["fehlend", "alle"]).default("fehlend"), limit: z.number().int().min(1).max(300).default(80) }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const L = schema.amazonListungen;
    const rows = await db.select().from(L).where(and(eq(L.tenantId, t), i.suche ? or(ilike(L.sku, likeOf(i.suche)), ilike(L.asin, likeOf(i.suche)), ilike(L.titel, likeOf(i.suche))) : undefined));
    const laender = [...new Set(rows.map((r) => r.land as Land))].sort();
    const je: Partial<Record<Land, ListingZeile[]>> = {};
    for (const l of (await stand(t, L)).map((x) => x.land as Land)) je[l] = [];
    for (const r of rows) (je[r.land as Land] ??= []).push({ sku: r.sku, asin: r.asin, titel: r.titel, preis: r.preis, menge: r.menge, status: r.status as ListingZeile["status"], versand: r.versand as ListingZeile["versand"], erstellt: r.erstellt });
    const st = await stand(t, L);
    const alleLaender = st.map((x) => x.land as Land);
    if (i.ansicht === "fehlend") {
      const f = fehlendeListungen(je, alleLaender);
      return json({ laender_mit_bericht: alleLaender, anzahl: f.length, skus: f.slice(0, i.limit), hinweis: !st.length ? KEIN_ABRUF : f.length > i.limit ? `Nur die ersten ${i.limit} von ${f.length}.` : undefined, legende: { fehlt: "im Bericht dieses Landes gar nicht vorhanden", inaktiv: "vorhanden, aber nicht aktiv (z. B. kein Bestand, gesperrt, unvollständig)" }, link: abs(ctx, "/listings"), datenstand: { quelle: "Amazon Alle Angebote je Land", stand: standText(st), abgerufen: berlinDateTime(new Date()) ?? "" } });
    }
    const bySku = new Map<string, { sku: string; asin: string | null; titel: string | null; laender: Record<string, string> }>();
    for (const r of rows) {
      const e = bySku.get(r.sku) ?? { sku: r.sku, asin: r.asin, titel: r.titel, laender: {} };
      e.laender[r.land] = `${r.status ?? "?"}${r.versand ? ` (${r.versand})` : ""}${r.preis !== null ? ` ${r.preis}` : ""}`;
      bySku.set(r.sku, e);
    }
    const list = [...bySku.values()];
    return json({ laender_mit_bericht: laender, anzahl: list.length, skus: list.slice(0, i.limit), hinweis: !st.length ? KEIN_ABRUF : undefined, link: abs(ctx, "/listings"), datenstand: { quelle: "Amazon Alle Angebote je Land", stand: standText(st), abgerufen: berlinDateTime(new Date()) ?? "" } });
  },
});

export const amazonLageralter = defineTool({
  name: "amazon_lageralter",
  title: "Amazon: Lageralter & Aufschlag",
  description:
    "Wie alt der FBA-Bestand je SKU und Land ist (Stück je Altersstufe in Tagen), wie viele Stück den Aufschlag für lange Lagerung kosten (ab 181 Tagen) und Amazons Schätzung dafür, geschätzte Lagerkosten im nächsten Monat und Amazons Empfehlung (Bericht „Bestandsplanung“). Standard: nur SKUs mit Aufschlag oder Bestand über 180 Tage. Für „Was kostet mich lange Lagerung?“, „Was muss raus, bevor der Aufschlag kommt?“.",
  area: "amazon",
  write: false,
  quelle: { text: "Amazon-Bericht Bestandsplanung (FBA Inventory) über die Schnittstelle" },
  input: z.object({ land: z.union([z.literal("alle"), landSchema]).default("alle"), nur_aufschlag: z.boolean().default(true), suche: z.string().trim().max(80).optional(), limit: z.number().int().min(1).max(300).default(60) }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const A = schema.amazonLageralter;
    const rows = await db.select().from(A).where(and(eq(A.tenantId, t), i.land !== "alle" ? eq(A.land, i.land) : undefined, i.suche ? or(ilike(A.sku, likeOf(i.suche)), ilike(A.asin, likeOf(i.suche)), ilike(A.titel, likeOf(i.suche))) : undefined));
    const list = rows
      .map((r) => ({ r, ueber180: alterUeber180(r.alter) }))
      .filter(({ r, ueber180 }) => !i.nur_aufschlag || (r.aufschlagGeschaetzt ?? 0) > 0 || (r.stueckMitAufschlag ?? 0) > 0 || ueber180 > 0)
      .sort((a, b) => (b.r.aufschlagGeschaetzt ?? 0) - (a.r.aufschlagGeschaetzt ?? 0) || b.ueber180 - a.ueber180);
    const summe = (k: "aufschlagGeschaetzt" | "lagerkostenNaechsterMonat") => Math.round(rows.reduce((n, r) => n + (r[k] ?? 0), 0) * 100) / 100;
    const st = await stand(t, A);
    return json({
      summe: { aufschlag_geschaetzt: summe("aufschlagGeschaetzt"), lagerkosten_naechster_monat: summe("lagerkostenNaechsterMonat"), skus_mit_aufschlag: rows.filter((r) => (r.aufschlagGeschaetzt ?? 0) > 0).length },
      anzahl: list.length,
      zeilen: list.slice(0, i.limit).map(({ r, ueber180 }) => ({ land: r.land, sku: r.sku, asin: r.asin ?? undefined, titel: r.titel ?? undefined, verfuegbar: r.verfuegbar, stueck_je_alter_tage: r.alter, stueck_ueber_180_tage: ueber180, stueck_mit_aufschlag: r.stueckMitAufschlag, aufschlag_geschaetzt: r.aufschlagGeschaetzt, lagerkosten_naechster_monat: r.lagerkostenNaechsterMonat, waehrung: r.waehrung ?? undefined, empfehlung_amazon: r.empfehlung ?? undefined, bestandsgesundheit: r.gesundheit ?? undefined, stichtag: r.stichtag ?? undefined })),
      erklaerung: "Amazon berechnet den Aufschlag für lange Lagerung monatlich für Einheiten, die länger als 180 Tage im Lager sind (je Altersstufe steigend). „aufschlag_geschaetzt“ ist Amazons eigene Schätzung für die nächste Berechnung.",
      hinweis: !rows.length ? KEIN_ABRUF : list.length > i.limit ? `Nur die ersten ${i.limit} von ${list.length}.` : undefined,
      link: abs(ctx, "/remissionen"),
      datenstand: { quelle: "Amazon Bestandsplanung über die Schnittstelle", stand: standText(st), abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const AMAZON_MARKT = [amazonBuybox, amazonAngebote, amazonListungen, amazonLageralter];
