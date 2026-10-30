import "server-only";
import { z } from "zod";
import { AMPEL_TEXT } from "@/lib/deal-ampel/logic";
import { dealPruefen } from "@/lib/deal-ampel/service";
import { defineTool } from "../types";
import { abs, json } from "./common";

// Herzstück-Werkzeuge (Bauauftrag Modul 1–12): Deal-Ampel, Tagesplan, Fristen, Buchhaltung, Delegieren, Feierabend.

export const dealPruefenTool = defineTool({
  name: "deal_pruefen",
  title: "Deal-Ampel: Einkauf prüfen",
  description:
    "Bewertet einen Einkauf (z. B. Deal aus der Deal-Gruppe) in Sekunden: ASIN, EAN oder Amazon-Link + Einkaufspreis (+ Menge). Je Land Gewinn/Marge beim aktuellen Buy-Box-Preis und beim 90-Tage-Mittel (USt je Land), Verkäufe/Monat, Angebote, Amazon-Anteil, Tief der letzten 12 Monate und Aktionsmuster; empfohlene Menge für 30–45 Tage; Ampel grün/gelb/rot mit Begründung. Für „Lohnt sich das?“, „Soll ich das kaufen?“.",
  area: "lieferanten",
  write: false,
  quelle: { text: "Keepa (DE/FR/IT/ES/UK), Amazon-Angebote (SP-API), Gebühren aus dem Seller-System" },
  input: z.object({
    code: z.string().trim().min(8).max(300).describe("ASIN, EAN oder Amazon-Link"),
    ek: z.number().positive().describe("Einkaufspreis je Stück in €"),
    ek_ist_netto: z.boolean().default(false).describe("true = Preis ohne USt; Standard brutto"),
    menge: z.number().int().positive().optional().describe("geplante Menge"),
    laender: z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(8).optional().describe("z. B. [\"DE\",\"FR\"]; sonst laut Einstellungen"),
  }),
  run: async (ctx, i) => {
    const r = await dealPruefen(ctx.session.tenantId, { code: i.code, ek: i.ek, ekIstNetto: i.ek_ist_netto, menge: i.menge ?? null, laender: i.laender });
    return json({
      asin: r.asin,
      titel: r.titel ?? undefined,
      ampel: AMPEL_TEXT[r.ampel],
      begruendung: r.begruendung,
      rot: r.rot.length ? r.rot : undefined,
      gelb: r.gelb.length ? r.gelb : undefined,
      ek_netto: r.ekNetto,
      empfohlene_menge: r.abverkauf.empfohlen ? `${r.abverkauf.empfohlen.von}–${r.abverkauf.empfohlen.bis} Stück (30–45 Tage)` : undefined,
      abverkauf_tage_fuer_menge: r.abverkauf.tage ?? undefined,
      bestes_land: r.bestes?.land,
      laender: r.laender.map((l) => ({
        land: l.land,
        buybox_eur: l.vkEur,
        schnitt_90_eur: l.vk90Eur,
        tief_12_monate_eur: l.tief12Eur,
        gewinn_jetzt: l.aktuell?.gewinn ?? null,
        gewinn_schnitt_90: l.schnitt90?.gewinn ?? null,
        marge_schnitt_90_prozent: l.schnitt90?.marge ?? null,
        roi_schnitt_90_prozent: l.schnitt90?.roi ?? null,
        verkaeufe_monat: l.verkaeufeMonat,
        angebote: l.angebote,
        amazon_prozent: l.amazonProzent,
        aktionsmuster: l.aktionsmuster ?? undefined,
        fehler: l.fehler ?? undefined,
      })),
      eigener_bestand: r.eigen ?? undefined,
      gebuehren: { provision_prozent: Math.round(r.gebuehren.provision * 100), fba: r.gebuehren.fba, geschaetzt: r.gebuehren.geschaetzt || undefined },
      hinweise: r.hinweise.length ? r.hinweise : undefined,
      link: abs(ctx, `/lieferanten/deal-ampel?code=${encodeURIComponent(r.asin)}&ek=${encodeURIComponent(String(i.ek).replace(".", ","))}&netto=${i.ek_ist_netto ? "1" : "0"}${i.menge ? `&menge=${i.menge}` : ""}`),
    });
  },
});

export const HERZSTUECK = [dealPruefenTool];
