import "server-only";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { EXPORT_LAENDER, type ExportLand } from "@/lib/bqool/export-logic";
import { bqoolExportErzeugen, bqoolVorschau } from "@/lib/bqool/export-service";
import { defineTool } from "../types";
import { abs, berlinDateTime, json } from "./common";

// BQool-Dateien aus dem System (Bauauftrag B7 Teil 3): Vorschau lesen; Export erzeugen nur auf ausdrücklichen Wunsch.

export const bqoolExportVorschauTool = defineTool({
  name: "bqool_export_vorschau",
  title: "BQool-Export: Vorschau",
  description:
    "Was ein BQool-Export je Land ändern würde: Anzahl SKUs, neu/geändert/gleich, Regelwechsel (Ist in BQool → Soll im System, z. B. ia/Abverkauf/Liquidation), größte Min-Änderungen, Warnungen (Min über Buy Box × 1,2, Min unter Break-even), SKUs ohne EK (nicht in der Datei), Vorschläge der Kapital-Ampel und Abweichungen Ist ↔ Soll. Dazu liquidation (B31.6): Regelwechsel auf „Liquidation“, weil der gewünschte Min unter dem effektiven Min der Margen-Regel liegt (alte Regel → Liquidation, Min alt → neu, Marge neu, Break-even, Buy Box; nie unter Break-even ohne Freigabe „Verlust akzeptiert bis x €“), Stand des Tests mit einer SKU, aktive Liquidationen und Vorschläge „zurück auf die ursprüngliche Regel“ (Buy Box 14 Tage über effektivem Min + 3 %). Dazu leiter (B31.6b/B31.7/B31.8): offene Vorschläge der Regel-Leiter (ia → Abverkauf → Liquidation → zurück auf Abverkauf), Schnelldreher, gebrauchte Ware mit Zielpreis/Min gebraucht, SKUs ohne Zustand (nicht in der Datei). B33: effektiver Min = BQool-Formel P(m) = (F + C/(1+v)) / (1/(1+v) − r − m) mit FBA-Gebühr und Provision des Landes (gebuehren.quelle: BQool-Liste, Amazon-Gebührenvorschau oder Produkt = DE-Schätzung); min_reset = BQool überschreibt den Min täglich (ia/Abverkauf – Datei-Min wirkt nur bis zum nächsten Reset); Stufen ohne feste Marge („Lowest Price + x %“, Sales Maximizer) haben keinen effektiven Min. Für „Was würde sich bei BQool ändern?“, „Welche SKUs fehlen im BQool-Export?“.",
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
          .map((z) => ({ sku: z.sku, titel: z.titel ?? undefined, regel_ist: z.istRegel, regel_soll: z.regel, stufe: z.stufe ?? undefined, min_ist: z.istMin, min_datei: z.min, max: z.max, cost: z.cost, effektiver_min: z.effMin, effektiver_min_text: z.effMinText ?? undefined, marge_prozent: z.marge, stufe_text: z.stufeText ?? undefined, min_reset: z.minReset || undefined, gebuehren: { fba: z.fba, provision: z.provision, quelle: z.gebuehren.quelle, geschaetzt: z.gebuehren.geschaetzt || undefined, preisstufen: z.gebuehren.staffel || undefined }, buybox: z.buybox, warnungen: z.warnungen.length ? z.warnungen : undefined, buybox_erklaerung: z.erklaerung ?? undefined, art: z.art, zustand: z.zustand !== "neu" ? z.zustand : undefined, zielpreis_gebraucht: z.zielpreis ?? undefined, min_gebraucht: z.minGebraucht ?? undefined, schnelldreher: z.schnelldreher || undefined, schnelldreher_boden: z.boden ?? undefined, break_even: z.breakEven })),
      })),
      ek_fehlt: { anzahl: new Set(v.ekFehlt.map((x) => x.sku)).size, skus: [...new Set(v.ekFehlt.map((x) => x.sku))].slice(0, 50) },
      vorschlaege_kapital_ampel: v.vorschlaege.slice(0, 20),
      abgleich: { anzahl: v.abgleich.length, faelle: v.abgleich.slice(0, 30).map((f) => f.text) },
      letzter_export: v.letzterExport ? { am: berlinDateTime(v.letzterExport.am), anzahl: v.letzterExport.anzahl, download: abs(ctx, `/repricer/bqool/datei?export=${v.letzterExport.id}`) } : null,
      // B31.6: Min in der Datei ≥ effektiver Min; darunter nur mit Regel „Liquidation“
      hinweis: "B33.2: Bei Margen-Regeln (ia, Abverkauf) überschreibt BQool den Min einmal täglich mit P(Marge der Altersstufe) – Min-Korrekturen per Datei wirken dort nicht; Steuerhebel sind Regel (Rule Name), Max, Cost, Aktiv/Pause und bei Liquidation der Min. Reine Min-Abweichungen bei diesen Regeln zählen nicht als Änderung. Gewünschter Min darunter → Regel „Liquidation“ mit festem Min (Untergrenze Break-even, darunter nur mit Freigabe). Bei Liquidation zählt die Untergrenze.",
      liquidation: await (async () => {
        const s = await getSettings(ctx.session.tenantId);
        const { liquidationsStand } = await import("@/lib/bqool/liquidation");
        const st = await liquidationsStand(ctx.session.tenantId);
        const wechsel = v.laender.flatMap((l) => l.zeilen.filter((z) => z.liquidation === "neu" && (z.regelWechsel || z.art === "neu")));
        return {
          test: s.bqool.liquidationTest.bestanden ? { bestanden: true, am: s.bqool.liquidationTest.am, sku: s.bqool.liquidationTest.sku, land: s.bqool.liquidationTest.land, von_hand: s.bqool.liquidationTest.vonHand || undefined } : { bestanden: false, hinweis: "Erst eine SKU von Hand mit Liquidation hochladen und nach dem nächsten BQool-Lauf prüfen – bis dahin kommen Regelwechsel nicht in die Datei." },
          regelwechsel: wechsel.slice(0, i.limit).map((z) => ({ land: z.land, sku: z.sku, titel: z.titel ?? undefined, regel_alt: z.istRegel, regel_vorher: z.regelVorher, regel_neu: z.regel, min_alt: z.istMin, min_gewuenscht: z.minGewuenscht, min_neu: z.min, effektiver_min: z.effMin, marge_neu_prozent: z.margeNeu, break_even: z.breakEven, buybox: z.buybox, wartet_auf_test: z.wartetAufTest || undefined, regelwechsel: z.regelWechsel })),
          aktiv: st.anzahl,
          unter_break_even: st.unterBreakEven,
          rueckkehr_vorgeschlagen: st.zeilen.filter((r) => r.status === "zurueck_vorgeschlagen").map((r) => ({ land: r.land, sku: r.sku, zurueck_auf: r.regelVorher, buybox_ueber_seit: r.ueberSeit })),
        };
      })(),
      // B31.6b/B31.7/B31.8: Regel-Leiter (Vorschläge zur Freigabe), Zustand unbekannt (nicht in der Datei)
      leiter: await (async () => {
        const { vorschlaegeOffen, VORSCHLAG_TEXT } = await import("@/lib/bqool/leiter");
        const offen = await vorschlaegeOffen(ctx.session.tenantId);
        const st = (await getSettings(ctx.session.tenantId)).bqool.leiterStand;
        return {
          stand: st ? { am: st.am, stufe_2: st.stufe2, stufe_3: st.stufe3, stufe_3_unter_break_even: st.unterBe, schnelldreher_unter_min: st.schnellUnterMin, gebrauchte_mit_neupreis_min: st.gebrauchtNeupreis } : "noch kein Lauf",
          vorschlaege: offen.slice(0, i.limit).map((x) => ({ land: x.land, sku: x.sku, vorschlag: VORSCHLAG_TEXT[x.art as keyof typeof VORSCHLAG_TEXT] ?? x.art, von: x.vonRegel ?? undefined, nach: x.nachRegel ?? undefined, min: x.min ?? undefined, gruende: x.gruende })),
          zustand_unbekannt: { anzahl: new Set(v.zustandUnbekannt.map((u) => u.sku)).size, skus: [...new Set(v.zustandUnbekannt.map((u) => u.sku))].slice(0, 30) },
        };
      })(),
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
  stufe: "rot",
  seite: "/repricer/bqool",
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

// B32 Listing-Check: Befunde nur lesen. Freigaben laufen über die Seite (BQool-Upload B31.2), nie über Claude.
export const listingCheckTool = defineTool({
  name: "listing_check",
  title: "Listing-Check: Befunde",
  description:
    "Ergebnis des täglichen Listing-Checks (B32): offene Befunde nach Euro-Potenzial (fehlende Verkäufe × Marge je Monat, Schätzung) – z. B. Min über Buy Box, Max unter Buy Box, Listing pausiert, Schnelldreher ohne Schutz, Preisband/Regel passt nicht – mit Land, SKU/ASIN, Zahlen und Vorschlag; Stand des letzten Laufs (Stufe A/B/C, Keepa-Abrufe, „Check unvollständig“, BQool-Stand alt) und Trefferquote der Freigaben. Keepa-Zahlen sind Marktdaten, keine eigenen Verkäufe. Nur lesen – Freigeben/Ablehnen auf der Seite. Für „Welche Listings verlieren Geld?“, „Was hat der Listing-Check gefunden?“.",
  area: ["buchhaltung", "amazon"],
  write: false,
  quelle: { text: "Seller-System (BQool-Ist, Kapital-Ampel, Keepa für Stufe A, sellerboard-Tageswerte mit einem Tag Verzug)" },
  input: z.object({ befund: z.number().int().min(1).max(10).optional().describe("Nur diese Befund-Nummer (1–10)"), limit: z.number().int().min(1).max(100).default(20) }),
  run: async (ctx, i) => {
    const { befundeOffen, checkTrefferquote, BEFUND_TITEL } = await import("@/lib/bqool/listing-check");
    const [st, alle, tq] = await Promise.all([getSettings(ctx.session.tenantId).then((s) => s.bqool.listingCheckStand), befundeOffen(ctx.session.tenantId), checkTrefferquote(ctx.session.tenantId).catch(() => null)]);
    const liste = i.befund ? alle.filter((b) => (b.daten as { nr?: number }).nr === i.befund) : alle;
    const jeNr: Record<string, number> = {};
    for (const b of alle) {
      const nr = (b.daten as { nr?: number }).nr ?? 0;
      const k = `${nr} ${BEFUND_TITEL[nr] ?? ""}`.trim();
      jeNr[k] = (jeNr[k] ?? 0) + 1;
    }
    return json({
      stand: st
        ? { am: berlinDateTime(new Date(st.am)), geprueft: st.geprueft, stufe_a: st.stufeA, stufe_b: st.stufeB, stufe_c: st.stufeC, keepa_abrufe: st.keepaAbrufe, neu: st.neu, offen: st.offen, unvollstaendig: st.unvollstaendig || undefined, bqool_stand_alt: st.bqoolAlt || undefined }
        : "noch kein Lauf",
      offen: alle.length,
      je_befund: jeNr,
      befunde: liste.slice(0, i.limit).map((b) => {
        const d = b.daten as { nr?: number; befund?: string; titel?: string; asin?: string | null; zahlen?: Record<string, unknown>; stufe?: string };
        return { land: b.land, sku: b.sku, asin: d.asin ?? undefined, titel: d.titel ? String(d.titel).slice(0, 60) : undefined, befund: `${d.nr} ${d.befund ?? ""}`.trim(), stufe: d.stufe, zahlen: d.zahlen, vorschlag: (b.gruende ?? []).join(" "), potenzial_euro_monat: b.potenzial ?? 0 };
      }),
      trefferquote: tq && tq.freigaben ? { freigaben_aelter_14_tage: tq.freigaben, mit_mehr_verkaeufen: tq.mitVerkauf, quote_prozent: tq.quote } : undefined,
      hinweis: "Freigaben nur auf der Seite; sie gehen über den nächsten BQool-Upload, nie direkt in BQool.",
      link: abs(ctx, "/repricer/listing-check"),
      datenstand: { quelle: "Listing-Check (Seller-System)", stand: st ? berlinDateTime(new Date(st.am)) ?? "" : "kein Lauf", abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const BQOOL = [bqoolExportVorschauTool, bqoolExportErzeugenTool, listingCheckTool];
