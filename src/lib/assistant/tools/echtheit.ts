import "server-only";
import { z } from "zod";
import { ABDECKUNG_TEXT } from "@/lib/echtheit/logic";
import { markenListe, markeFinden, markenOrdner } from "@/lib/echtheit/service";
import { canAccess } from "@/lib/auth/areas";
import { defineTool } from "../types";
import { abs, json } from "./common";

// Echtheits-Ordner je Marke (nur lesen).

export const markenBelege = defineTool({
  name: "marken_belege",
  title: "Echtheits-Ordner: Belege je Marke",
  description:
    "Einkaufsnachweise je Marke für Echtheits- oder Rechteinhaber-Beschwerden: Rechnungen (Text-Treffer, über Chargen verknüpft oder von Hand zugeordnet), Abdeckung verkaufte Stück (12 Monate) gegen gekaufte Stück mit Rechnung je SKU, Lücken und offene Amazon-Fälle (Echtheit/Konto). Ohne „marke“: Übersicht aller Ordner. Mit Link zum Audit-Paket (ZIP + PDF).",
  area: "amazon",
  write: false,
  quelle: { text: "Rechnungen und Chargen im Seller-System, sellerboard (verkaufte Stück je Monat), Amazon-ToDos aus Systemmails" },
  input: z.object({
    marke: z.string().trim().min(2).max(80).optional().describe("Markenname (oder Schreibweise); leer = alle Ordner"),
  }),
  run: async (ctx, i) => {
    if (!i.marke) {
      const liste = await markenListe(ctx.session.tenantId, ctx.today);
      return json({
        zeitraum_verkauf: "letzte 12 Monate",
        ordner: liste.map((o) => ({
          marke: o.marke.marke,
          rechnungen: o.summe.belege,
          zu_pruefen: o.summe.pruefen || undefined,
          artikel: o.summe.skus,
          abdeckung_prozent: o.abdeckung.quote,
          luecken: o.abdeckung.luecken,
          offene_faelle: o.summe.offeneFaelle,
          link: abs(ctx, `/echtheit/${o.marke.id}`),
        })),
        hinweis: liste.length ? undefined : "Noch kein Echtheits-Ordner angelegt.",
        link: abs(ctx, "/echtheit"),
      });
    }
    const m = await markeFinden(ctx.session.tenantId, i.marke);
    if (!m) return json({ gefunden: false, hinweis: `Kein Echtheits-Ordner für „${i.marke}“. Anlegen unter Echtheits-Ordner.`, link: abs(ctx, "/echtheit") });
    const o = await markenOrdner(ctx.session.tenantId, m.id, ctx.today);
    if (!o) return json({ gefunden: false, link: abs(ctx, "/echtheit") });
    const zaehlt = o.belege.filter((b) => b.urteil !== "falsch");
    // Beträge nur mit Zugriff auf die Buchhaltung.
    const betraege = canAccess(ctx.session, "buchhaltung");
    return json({
      marke: o.marke.marke,
      schreibweisen: o.marke.aliase.length ? o.marke.aliase : undefined,
      zeitraum_verkauf: "letzte 12 Monate",
      abdeckung: { prozent: o.abdeckung.quote, verkauft: o.abdeckung.verkauft, gekauft_mit_rechnung: o.abdeckung.gekauftBelegt, gekauft_ohne_rechnung: o.abdeckung.gekauftOhneBeleg, luecken: o.abdeckung.luecken },
      artikel: o.abdeckung.zeilen.slice(0, 50).map((z) => ({ sku: z.sku, asin: z.asin ?? undefined, name: z.name ?? undefined, verkauft: z.verkauft, mit_rechnung: z.gekauftBelegt, ohne_rechnung: z.gekauftOhneBeleg || undefined, status: ABDECKUNG_TEXT[z.status] })),
      rechnungen: zaehlt.slice(0, 50).map((b) => ({ datum: b.invoiceDate, lieferant: b.vendor, nummer: b.invoiceNumber, brutto: betraege ? b.totalGross : undefined, nachweis: b.art === "charge" ? "über Charge" : b.art === "manuell" ? "von Hand" : b.art === "sicher" ? "Rechnungsposition" : b.art === "pruefen" ? "prüfen" : "im Text", bestaetigt: b.urteil === "stimmt" || b.art === "manuell" || undefined })),
      rechnungen_gesamt: zaehlt.length,
      faelle: o.faelle.map((f) => ({ art: f.kategorie, betreff: f.betreff, status: f.status === "open" ? "offen" : "erledigt", frist: f.frist ?? undefined, asins: f.asins.length ? f.asins : undefined })),
      audit_paket: abs(ctx, `/echtheit/${o.marke.id}/paket`),
      link: abs(ctx, `/echtheit/${o.marke.id}`),
    });
  },
});

export const ECHTHEIT = [markenBelege];
