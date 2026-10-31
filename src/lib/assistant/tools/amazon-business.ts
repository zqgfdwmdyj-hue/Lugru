import "server-only";
import { z } from "zod";
import { b2bAuswertung, staffelKandidaten } from "@/lib/amazon-business/service";
import { defineTool } from "../types";
import { abs, json } from "./common";

// Amazon Business (nur lesen): B2B-Werte je ASIN und Zeitraum, Stand der Staffelpreise.

export const b2bAuswertungTool = defineTool({
  name: "b2b_auswertung",
  title: "Amazon Business: B2B-Auswertung",
  description:
    "Amazon Business je Land und Zeitraum: B2B-Umsatz, Anteil am Gesamtumsatz, B2B-Besuche, Kaufquote und Buy-Box-Anteil B2B – gesamt und je ASIN (stärkste zuerst), dazu Staffelpreise (Vorschlag/freigegeben/übertragen) mit Gewinn je Stufe. Zeitraum: „letzte“ (jüngster je Land), „JJJJ-MM“ oder „JJJJ-MM-TT:JJJJ-MM-TT“.",
  area: "amazon",
  write: false,
  quelle: { text: "Amazon-Bericht „Sales and Traffic“ (Schnittstelle, 30 Tage) bzw. hochgeladener Geschäftsbericht; Staffelpreise im Seller-System" },
  input: z.object({
    zeitraum: z.string().trim().max(25).optional().describe("„letzte“ (Standard), „JJJJ-MM“ oder „von:bis“"),
    land: z.enum(["DE", "FR", "IT", "ES", "NL", "BE", "PL", "SE", "UK", "IE"]).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  run: async (ctx, i) => {
    const a = await b2bAuswertung(ctx.session.tenantId, { zeitraum: i.zeitraum, land: i.land });
    const laender = [];
    for (const l of a.laender) {
      const st = (await staffelKandidaten(ctx.session.tenantId, l.periode.land)).filter((k) => k.gespeichert);
      laender.push({
        land: l.periode.land,
        zeitraum: { von: l.periode.von, bis: l.periode.bis, quelle: l.periode.quelle === "api" ? "Schnittstelle" : "Upload" },
        summen: { umsatz: l.summen.umsatz, umsatz_b2b: l.summen.umsatzB2b, anteil_b2b_prozent: l.summen.anteilProzent, besuche_b2b: l.summen.sitzungenB2b, einheiten_b2b: l.summen.einheitenB2b, kaufquote_b2b_prozent: l.summen.kaufquoteB2b, buybox_b2b_prozent: l.summen.buyboxB2b },
        asins: l.zeilen.slice(0, i.limit).map((z) => ({ asin: z.asin, sku: z.sku ?? undefined, titel: z.titel ?? undefined, besuche_b2b: z.sitzungenB2b, besuche: z.sitzungen, einheiten_b2b: z.einheitenB2b, umsatz_b2b: z.umsatzB2b, buybox_b2b: z.buyboxB2b })),
        staffelpreise: st.map((k) => ({ sku: k.sku, business_preis: k.gespeichert!.businessPreis, status: k.gespeichert!.status, stufen: k.gespeichert!.stufen.filter((s) => s.ok).map((s) => ({ ab: s.ab, preis: s.preis, gewinn: s.gewinn })), fehler: k.gespeichert!.fehler ?? undefined })),
        link: abs(ctx, `/amazon-business?land=${l.periode.land}`),
      });
    }
    return json({
      gesamt: { umsatz: a.gesamt.umsatz, umsatz_b2b: a.gesamt.umsatzB2b, anteil_b2b_prozent: a.gesamt.anteilProzent, buybox_b2b_prozent: a.gesamt.buyboxB2b },
      laender,
      verfuegbare_zeitraeume: [...new Set(a.perioden.map((p) => `${p.land} ${p.von}:${p.bis}`))].slice(0, 20),
      hinweis: laender.length ? undefined : "Für diesen Zeitraum liegen keine B2B-Werte vor.",
      link: abs(ctx, "/amazon-business"),
    });
  },
});

export const AMAZON_BUSINESS = [b2bAuswertungTool];
