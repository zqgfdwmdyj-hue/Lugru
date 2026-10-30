import "server-only";
import { z } from "zod";
import { EXPORT_LAENDER, type ExportLand } from "@/lib/bqool/export-logic";
import { bqoolExportErzeugen, bqoolVorschau } from "@/lib/bqool/export-service";
import { defineTool } from "../types";
import { abs, berlinDateTime, json } from "./common";

// BQool-Dateien aus dem System (Bauauftrag B7 Teil 3): Vorschau lesen; Export erzeugen nur auf ausdrücklichen Wunsch.

export const bqoolExportVorschauTool = defineTool({
  name: "bqool_export_vorschau",
  title: "BQool-Export: Vorschau",
  description:
    "Was ein BQool-Export je Land ändern würde: Anzahl SKUs, neu/geändert/gleich, Regelwechsel (Ist in BQool → Soll im System, z. B. ia/Abverkauf/Liquidation), größte Min-Änderungen, Warnungen (Min über Buy Box × 1,2, Min unter Break-even), SKUs ohne EK (nicht in der Datei), Vorschläge der Kapital-Ampel und Abweichungen Ist ↔ Soll. Für „Was würde sich bei BQool ändern?“, „Welche SKUs fehlen im BQool-Export?“.",
  area: ["buchhaltung", "amazon"],
  write: false,
  quelle: { text: "Seller-System (EK, Gebühren, Regel-Katalog) + hochgeladene BQool-Dateien (Ist)" },
  input: z.object({ land: z.enum(EXPORT_LAENDER).optional().describe("Nur dieses Land"), limit: z.number().int().min(1).max(100).default(20) }),
  run: async (ctx, i) => {
    const v = await bqoolVorschau(ctx.session.tenantId, { laender: i.land ? [i.land] : undefined });
    return json({
      laender: v.laender.map((l) => ({
        land: l.land,
        skus: l.zeilen.length,
        neu: l.neu,
        geaendert: l.geaendert,
        gleich: l.gleich,
        regelwechsel: l.regelWechsel,
        mit_warnung: l.mitWarnung,
        verglichen_mit: l.vergleichMit === "bqool" ? `BQool-Datei vom ${berlinDateTime(l.istStand)}` : l.vergleichMit === "export" ? "letzter eigener Export" : "nichts (noch kein Ist-Stand)",
        groesste_aenderungen: l.zeilen
          .filter((z) => z.art !== "gleich" || z.warnungen.length)
          .slice(0, i.limit)
          .map((z) => ({ sku: z.sku, titel: z.titel ?? undefined, regel_ist: z.istRegel, regel_soll: z.regel, min_ist: z.istMin, min_datei: z.min, max: z.max, cost: z.cost, effektiver_min: z.effMin, marge_prozent: z.marge, buybox: z.buybox, warnungen: z.warnungen.length ? z.warnungen : undefined, buybox_erklaerung: z.erklaerung ?? undefined, art: z.art })),
      })),
      ek_fehlt: { anzahl: new Set(v.ekFehlt.map((x) => x.sku)).size, skus: [...new Set(v.ekFehlt.map((x) => x.sku))].slice(0, 50) },
      vorschlaege_kapital_ampel: v.vorschlaege.slice(0, 20),
      abgleich: { anzahl: v.abgleich.length, faelle: v.abgleich.slice(0, 30).map((f) => f.text) },
      letzter_export: v.letzterExport ? { am: berlinDateTime(v.letzterExport.am), anzahl: v.letzterExport.anzahl, download: abs(ctx, `/repricer/bqool/datei?export=${v.letzterExport.id}`) } : null,
      hinweis: "Bei Margen-Regeln rechnet BQool den Mindestpreis selbst (Cost + Mindestmarge); Min in der Datei ist dort nur ein Sicherheitsnetz. Bei Liquidation zählt die Untergrenze.",
      link: abs(ctx, "/repricer/bqool"),
      datenstand: { quelle: "Seller-System + BQool-Dateien", stand: v.laender.map((l) => `${l.land}: ${l.istStand ? berlinDateTime(l.istStand) : "kein Ist"}`).join(", "), abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const bqoolExportErzeugenTool = defineTool({
  name: "bqool_export_erzeugen",
  title: "BQool-Dateien erzeugen",
  description:
    "Erzeugt die BQool-Dateien je Land (Format repricing 1.2.5) und gibt Download-Links zurück. Nur auf ausdrücklichen Wunsch. Ändert nichts bei BQool – Ludwig lädt die Dateien selbst hoch. Standard: nur Änderungen.",
  area: "buchhaltung",
  write: true,
  quelle: { text: "Seller-System (EK, Regeln)" },
  input: z.object({ laender: z.array(z.enum(EXPORT_LAENDER)).min(1).default(["DE", "FR", "IT", "ES"]), nur_aenderungen: z.boolean().default(true) }),
  run: async (ctx, i) => {
    const r = await bqoolExportErzeugen(ctx.session.tenantId, ctx.session.userId, { laender: i.laender as ExportLand[], nurAenderungen: i.nur_aenderungen });
    return json({
      erzeugt: true,
      anzahl: r.anzahl,
      zip: abs(ctx, `/repricer/bqool/datei?export=${r.id}`),
      dateien: Object.keys(r.anzahl).map((l) => ({ land: l, link: abs(ctx, `/repricer/bqool/datei?export=${r.id}&land=${l}`) })),
      hinweis: "Dateien bei BQool hochladen (Repricing → Upload). Freigabe-Seite mit Warnungen: Link.",
      link: abs(ctx, `/repricer/bqool?export=${r.id}`),
    });
  },
  summary: (i) => `BQool-Dateien erzeugen (${(i.laender ?? []).join(", ")}${i.nur_aenderungen === false ? ", alles" : ", nur Änderungen"})`,
});

export const BQOOL = [bqoolExportVorschauTool, bqoolExportErzeugenTool];
