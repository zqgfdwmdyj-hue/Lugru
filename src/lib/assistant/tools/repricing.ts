import "server-only";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { EXPORT_LAENDER, type ExportLand } from "@/lib/repricing/strategie-logic";
import { HINWEIS_RANG, HINWEIS_TEXT, strategieUebersicht } from "@/lib/repricing/profitguard-logic";
import { exportAuswahl, freigabeNoetig, profitguardExportErzeugen, sollVorschau } from "@/lib/repricing/soll-service";
import { defineTool } from "../types";
import { abs, berlinDateTime, json } from "./common";

// Repricing über ProfitGuard (ProfitPath): Abgleich Soll (Seller-System) ↔ Ist (ProfitGuard-Export), Vorschau und
// Importdatei für ProfitGuard, Listing-Check. Das System sendet nichts an ProfitGuard oder Amazon.

const standText = (am: Date | null) => (am ? berlinDateTime(am) ?? "" : "kein Export");

export const repricer = defineTool({
  name: "repricer",
  title: "Repricer: Abgleich Seller-System ↔ ProfitGuard",
  description:
    "Je SKU und Land: Soll aus dem Seller-System (Strategie Standard/Abverkauf/Liquidation/Schnelldreher, Soll-Min = Break-even mit der Mindestmarge der Altersstufe wie in ProfitGuard, Soll-Max = Min × Faktor bzw. Ziel-VK) neben dem Ist in ProfitGuard (im Repricing ja/nein, Strategie, Min, Max, Preis, Buy Box) aus dem zuletzt eingelesenen ProfitGuard-Export. Auffälligkeiten: SKU mit Bestand nicht im ProfitGuard-Repricing, ProfitGuard-Min unter Soll-Min (außer freigegebener Liquidation), Min über Max, ohne Min/Max, Strategie weicht ab, Preis unter Min. Dazu Stufe der Regel-Leiter, Liquidation bis, Schnelldreher, Zustand, Buy-Box-Anteil je Land (ProfitGuard bzw. Amazon-Geschäftsbericht). Für „Wie steht ProfitGuard?“, „Welche SKUs sind nicht im Repricing?“, „Wo ist der Min zu niedrig?“.",
  area: ["buchhaltung", "amazon"],
  write: false,
  quelle: { text: "ProfitGuard-Export (Datei-Import unter Repricer) + Seller-System (EK, Gebühren, Lageralter, Strategien)" },
  input: z.object({
    ansicht: z.enum(["probleme", "alle"]).default("probleme"),
    marktplatz: z.enum(["alle", ...EXPORT_LAENDER]).default("alle"),
    hinweis: z.enum(["alle", ...HINWEIS_RANG]).default("alle").describe("Nur eine Art von Auffälligkeit"),
    strategie: z.string().trim().max(60).optional().describe("Nur diese Strategie in ProfitGuard („(ohne Strategie)“ für SKUs ohne)"),
    suche: z.string().trim().max(60).optional().describe("SKU, ASIN oder Titel"),
    limit: z.number().int().min(1).max(300).default(80),
  }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const v = await sollVorschau(t, { laender: i.marktplatz === "alle" ? undefined : [i.marktplatz as ExportLand] });
    const s = await getSettings(t);
    const { buyboxAnteilJeLand, profitguardStand } = await import("@/lib/repricing/profitguard-service");
    const { ablaufStand } = await import("@/lib/repricing/leiter-logic");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const [bb, stand, lq] = await Promise.all([buyboxAnteilJeLand(t), profitguardStand(t), db.select().from(schema.repricingLiquidationen).where(eq(schema.repricingLiquidationen.tenantId, t))]);
    const lqJe = new Map(lq.filter((l) => l.status === "aktiv" || l.status === "zurueck_vorgeschlagen").map((l) => [`${l.land}|${l.sku}`, l]));
    const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    const alle = v.laender.flatMap((l) => l.zeilen);
    const q = i.suche?.toLowerCase();
    const list = alle
      .filter((z) => (i.ansicht === "alle" || z.hinweise.length) && (i.hinweis === "alle" || z.hinweise.includes(i.hinweis as (typeof HINWEIS_RANG)[number])) && (!i.strategie || (z.istStrategieName?.trim() || "(ohne Strategie)").toLowerCase() === i.strategie.toLowerCase()) && (!q || [z.sku, z.asin ?? "", z.titel ?? ""].some((x) => x.toLowerCase().includes(q))))
      .sort((a, b) => (a.hinweise[0] ? HINWEIS_RANG.indexOf(a.hinweise[0]) : 99) - (b.hinweise[0] ? HINWEIS_RANG.indexOf(b.hinweise[0]) : 99) || a.sku.localeCompare(b.sku));
    const zaehle = Object.fromEntries(HINWEIS_RANG.map((h) => [h, alle.filter((z) => z.hinweise.includes(h)).length]).filter(([, n]) => n));
    const aeltester = stand.reduce<Date | null>((m, x) => (x.am && (!m || x.am < m) ? x.am : m), null);
    return json({
      eingelesen: stand.length ? stand.map((x) => ({ marktplatz: x.marktplatz, am: berlinDateTime(x.am) })) : "noch kein ProfitGuard-Export eingelesen – in ProfitGuard unter „Export & Import“ exportieren und im Seller-System unter Amazon → Repricer hochladen",
      buybox_anteil: bb.length ? bb.map((x) => ({ land: x.land, prozent: x.anteil, quelle: x.quelle === "profitguard" ? "ProfitGuard" : "Amazon-Geschäftsbericht (30 Tage)", skus: x.skus })) : "kein Buy-Box-Anteil (weder im ProfitGuard-Export noch im Amazon-Geschäftsbericht)",
      anzahl_skus: alle.length,
      auffaelligkeiten: Object.fromEntries(Object.entries(zaehle).map(([k, n]) => [HINWEIS_TEXT[k as keyof typeof HINWEIS_TEXT], n])),
      je_strategie_profitguard: strategieUebersicht(alle.map((z) => ({ istStrategie: z.istStrategieName, imRepricing: z.istImRepricing, land: z.land, hinweise: z.hinweise }))).map((u) => ({ strategie: u.strategie, skus: u.gesamt, im_repricing: u.imRepricing, nicht_im_repricing: u.nichtIm, unbekannt: u.unbekannt || undefined, auffaellig: u.mitHinweis, je_land: u.laender })),
      nur_in_profitguard: v.nurIst.length ? { anzahl: v.nurIst.length, beispiele: v.nurIst.slice(0, 10) } : undefined,
      anzahl: list.length,
      zeilen: list.slice(0, i.limit).map((z) => ({
        land: z.land,
        sku: z.sku,
        asin: z.asin ?? undefined,
        titel: z.titel ?? undefined,
        soll: { strategie: z.regel, strategie_in_profitguard: z.strategieName, min: z.min, max: z.max, marge_stufe_prozent: z.marge ?? undefined, stufe: z.stufe ?? undefined, im_repricing: z.aktiv },
        ist_profitguard: z.istImRepricing === null && z.istMin === null && !z.istStrategieName ? "nicht im Export" : { im_repricing: z.istImRepricing, strategie: z.istStrategieName, min: z.istMin, max: z.istMax, preis: z.istPreis, seit: z.strategieSeit ? z.strategieSeit.toISOString().slice(0, 10) : undefined },
        buybox: z.buybox,
        break_even: z.breakEven,
        min_mit_mindestgewinn: z.systemMin ?? undefined,
        pruefen: z.hinweise.length ? z.hinweise.map((h) => HINWEIS_TEXT[h]) : undefined,
        warnungen: z.warnungen.length ? z.warnungen : undefined,
        liquidation_bis: (() => { const l = lqJe.get(`${z.land}|${z.sku}`); if (!l) return undefined; const a = ablaufStand({ bis: l.bis, dauerhaft: l.dauerhaft, heute, vorwarnTage: s.repricing.leiter.ablaufVorwarnTage }); return a.stand === "dauerhaft" ? "dauerhaft" : l.bis ? { bis: l.bis, rest_tage: a.restTage } : undefined; })(),
        schnelldreher: z.schnelldreher ? { boden_prozent: s.repricing.leiter.schnell.margeBoden } : undefined,
        zustand: z.zustand !== "neu" ? z.zustand : undefined,
        bestand: z.bestand,
      })),
      hinweis: list.length > i.limit ? `Nur die ersten ${i.limit} von ${list.length}.` : undefined,
      legende: { soll_min: "Break-even mit der Mindestmarge der Altersstufe der Strategie (Marge vom Brutto-Preis, USt und Gebühren des Landes) – so rechnet auch ProfitGuard", min_mit_mindestgewinn: "klassischer Mindestpreis EK + Gebühren + Mindestgewinn in € – nur Vergleich", liquidation: "Min darf nur bei freigegebener Liquidation unter dem Soll-Min liegen; unter Break-even nur mit Freigabe „Verlust akzeptiert bis x €“" },
      link: abs(ctx, "/repricer#abgleich"),
      datenstand: { quelle: "ProfitGuard-Export (Datei) + Seller-System", stand: aeltester ? `ProfitGuard-Export: ${standText(aeltester)}${stand.length > 1 ? " (ältester Marktplatz)" : ""}` : "noch kein ProfitGuard-Export", abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const profitguardExportVorschauTool = defineTool({
  name: "profitguard_export_vorschau",
  title: "ProfitGuard-Importdatei: Vorschau",
  description:
    "Was eine ProfitGuard-Importdatei je Land ändern würde (Min/Max/Strategie): Anzahl SKUs, neu/geändert/gleich gegenüber dem letzten ProfitGuard-Export, Strategiewechsel, größte Min-Änderungen, Warnungen (Min über Buy Box × 1,2, Min unter Break-even), ob eine Freigabe nötig ist (Strategiewechsel, neue Liquidation, Min unter Break-even), SKUs ohne EK bzw. ohne Zustand (nicht in der Datei), Vorschläge der Kapital-Ampel, Liquidationen und offene Vorschläge der Regel-Leiter. Für „Was würde sich in ProfitGuard ändern?“.",
  area: ["buchhaltung", "amazon"],
  write: false,
  quelle: { text: "Seller-System (EK, Gebühren, Strategien) + letzter ProfitGuard-Export (Ist)" },
  input: z.object({ land: z.enum(EXPORT_LAENDER).optional().describe("Nur dieses Land"), nur_aenderungen: z.boolean().default(true), limit: z.number().int().min(1).max(100).default(20) }),
  run: async (ctx, i) => {
    const t = ctx.session.tenantId;
    const v = await sollVorschau(t, { laender: i.land ? [i.land] : undefined });
    const { zusammenfassung } = exportAuswahl(v, { nurAenderungen: i.nur_aenderungen });
    const { liquidationsStand } = await import("@/lib/repricing/liquidation");
    const { vorschlaegeOffen, VORSCHLAG_TEXT } = await import("@/lib/repricing/leiter");
    const [st, offen, s] = await Promise.all([liquidationsStand(t), vorschlaegeOffen(t), getSettings(t)]);
    return json({
      datei: { je_land: zusammenfassung.jeLand, gesamt: zusammenfassung.gesamt, strategiewechsel: zusammenfassung.regelWechsel, liquidation_neu: zusammenfassung.liquidation, min_unter_break_even: zusammenfassung.unterBreakEven, freigabe_noetig: freigabeNoetig(zusammenfassung), format: s.repricing.profitguard.format ? "wie der letzte ProfitGuard-Export" : "Standard-CSV (SKU, Marketplace, Min Price, Max Price, Strategy, Repricing) – vor dem ersten Import mit der ProfitGuard-Vorlage abgleichen" },
      laender: v.laender.map((l) => ({
        land: l.land,
        skus: l.zeilen.length,
        neu: l.neu,
        geaendert: l.geaendert,
        gleich: l.gleich,
        strategiewechsel: l.regelWechsel,
        mit_warnung: l.mitWarnung,
        verglichen_mit: l.vergleichMit === "profitguard" ? `ProfitGuard-Export vom ${berlinDateTime(l.istStand)}` : l.vergleichMit === "export" ? "letzte eigene Importdatei" : "nichts (noch kein Ist-Stand)",
        groesste_aenderungen: l.zeilen
          .filter((z) => z.art !== "gleich" || z.warnungen.length)
          .slice(0, i.limit)
          .map((z) => ({ sku: z.sku, titel: z.titel ?? undefined, strategie_ist: z.istStrategieName ?? undefined, strategie_soll: z.strategieName, min_ist: z.istMin, min_soll: z.min, max_soll: z.max, marge_prozent: z.marge, break_even: z.breakEven, buybox: z.buybox, gebuehren: { fba: z.fba, provision: z.provision, quelle: z.gebuehren.quelle, geschaetzt: z.gebuehren.geschaetzt || undefined }, warnungen: z.warnungen.length ? z.warnungen : undefined, art: z.art })),
      })),
      ek_fehlt: { anzahl: new Set(v.ekFehlt.map((x) => x.sku)).size, skus: [...new Set(v.ekFehlt.map((x) => x.sku))].slice(0, 50) },
      zustand_unbekannt: { anzahl: new Set(v.zustandUnbekannt.map((u) => u.sku)).size, skus: [...new Set(v.zustandUnbekannt.map((u) => u.sku))].slice(0, 30) },
      vorschlaege_kapital_ampel: v.vorschlaege.slice(0, 20),
      liquidation: { aktiv: st.anzahl, unter_break_even: st.unterBreakEven, vorgeschlagen: st.vorgeschlagen, rueckkehr_vorgeschlagen: st.rueckkehr },
      leiter_vorschlaege: offen.slice(0, i.limit).map((x) => ({ land: x.land, sku: x.sku, vorschlag: VORSCHLAG_TEXT[x.art as keyof typeof VORSCHLAG_TEXT] ?? x.art, von: x.vonRegel ?? undefined, nach: x.nachRegel ?? undefined, min: x.min ?? undefined, gruende: x.gruende })),
      letzte_datei: v.letzterExport ? { am: berlinDateTime(v.letzterExport.am), anzahl: v.letzterExport.anzahl, download: abs(ctx, `/repricer/profitguard/datei?export=${v.letzterExport.id}`) } : null,
      link: abs(ctx, "/repricer/profitguard"),
      datenstand: { quelle: "Seller-System + ProfitGuard-Export", stand: v.laender.map((l) => `${l.land}: ${l.istStand ? berlinDateTime(l.istStand) : "kein Ist"}`).join(", "), abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const profitguardExportErzeugenTool = defineTool({
  name: "profitguard_export_erzeugen",
  title: "ProfitGuard-Importdatei erzeugen",
  description:
    "Erzeugt die Importdatei für ProfitGuard (Min/Max/Strategie je SKU und Land, im Format des letzten ProfitGuard-Exports) und gibt Download-Links zurück. Nur auf ausdrücklichen Wunsch; mit Strategiewechsel, neuer Liquidation oder Min unter Break-even nur, wenn Ludwig die Freigabe ausdrücklich bestätigt (freigabe_geprueft). Sendet nichts an ProfitGuard oder Amazon – Ludwig importiert die Datei selbst. Standard: nur Änderungen.",
  area: "buchhaltung",
  write: true,
  stufe: "rot",
  seite: "/repricer/profitguard",
  quelle: { text: "Seller-System (EK, Strategien) + letzter ProfitGuard-Export" },
  input: z.object({ laender: z.array(z.enum(EXPORT_LAENDER)).min(1).default(["DE", "FR", "IT", "ES"]), nur_aenderungen: z.boolean().default(true), freigabe_geprueft: z.boolean().default(false).describe("Nur true, wenn Ludwig Strategiewechsel/Liquidation/Min unter Break-even ausdrücklich freigegeben hat") }),
  run: async (ctx, i) => {
    const r = await profitguardExportErzeugen(ctx.session.tenantId, ctx.session.userId, { laender: i.laender as ExportLand[], nurAenderungen: i.nur_aenderungen, freigegeben: i.freigabe_geprueft });
    if (!r.ok) return json({ erzeugt: false, grund: r.text, zusammenfassung: r.zusammenfassung, link: abs(ctx, "/repricer/profitguard") });
    return json({
      erzeugt: true,
      anzahl: r.anzahl,
      alle_laender: abs(ctx, `/repricer/profitguard/datei?export=${r.id}`),
      dateien: Object.keys(r.anzahl).filter((l) => r.anzahl[l]).map((l) => ({ land: l, link: abs(ctx, `/repricer/profitguard/datei?export=${r.id}&land=${l}`) })),
      hinweis: "Datei in ProfitGuard unter „Export & Import“ importieren und danach auf der Seite als importiert bestätigen; der nächste ProfitGuard-Export zeigt, ob alles übernommen wurde.",
      link: abs(ctx, `/repricer/profitguard?export=${r.id}`),
    });
  },
  summary: (i) => `ProfitGuard-Importdatei erzeugen (${(i.laender ?? []).join(", ")}${i.nur_aenderungen === false ? ", alles" : ", nur Änderungen"}${i.freigabe_geprueft ? ", Freigabe geprüft" : ""})`,
});

// B32 Listing-Check: Befunde nur lesen. Freigaben laufen über die Seite (nächste ProfitGuard-Datei), nie über Claude.
export const listingCheckTool = defineTool({
  name: "listing_check",
  title: "Listing-Check: Befunde",
  description:
    "Ergebnis des täglichen Listing-Checks (B32): offene Befunde nach Euro-Potenzial (fehlende Verkäufe × Marge je Monat, Schätzung) – z. B. Min über Buy Box, Max unter Buy Box, nicht im Repricing trotz Bestand, Schnelldreher ohne Schutz, Verkaufspreis unter Min – mit Land, SKU/ASIN, Zahlen und Vorschlag; Stand des letzten Laufs (Stufe A/B/C, Keepa-Abrufe, „Check unvollständig“, ProfitGuard-Stand alt) und Trefferquote der Freigaben. Keepa-Zahlen sind Marktdaten, keine eigenen Verkäufe. Nur lesen – Freigeben/Ablehnen auf der Seite. Für „Welche Listings verlieren Geld?“, „Was hat der Listing-Check gefunden?“.",
  area: ["buchhaltung", "amazon"],
  write: false,
  quelle: { text: "Seller-System (ProfitGuard-Ist, Kapital-Ampel, Keepa für Stufe A, sellerboard-Tageswerte mit einem Tag Verzug)" },
  input: z.object({ befund: z.number().int().min(1).max(11).optional().describe("Nur diese Befund-Nummer (1–11)"), limit: z.number().int().min(1).max(100).default(20) }),
  run: async (ctx, i) => {
    const { befundeOffen, checkTrefferquote, BEFUND_TITEL } = await import("@/lib/repricing/listing-check");
    const [st, alle, tq] = await Promise.all([getSettings(ctx.session.tenantId).then((s) => s.repricing.listingCheckStand), befundeOffen(ctx.session.tenantId), checkTrefferquote(ctx.session.tenantId).catch(() => null)]);
    const liste = i.befund ? alle.filter((b) => (b.daten as { nr?: number }).nr === i.befund) : alle;
    const jeNr: Record<string, number> = {};
    for (const b of alle) {
      const nr = (b.daten as { nr?: number }).nr ?? 0;
      const k = `${nr} ${BEFUND_TITEL[nr] ?? ""}`.trim();
      jeNr[k] = (jeNr[k] ?? 0) + 1;
    }
    return json({
      stand: st
        ? { am: berlinDateTime(new Date(st.am)), geprueft: st.geprueft, stufe_a: st.stufeA, stufe_b: st.stufeB, stufe_c: st.stufeC, keepa_abrufe: st.keepaAbrufe, neu: st.neu, offen: st.offen, unvollstaendig: st.unvollstaendig || undefined, profitguard_stand_alt: st.istAlt || undefined }
        : "noch kein Lauf",
      offen: alle.length,
      je_befund: jeNr,
      befunde: liste.slice(0, i.limit).map((b) => {
        const d = b.daten as { nr?: number; befund?: string; titel?: string; asin?: string | null; zahlen?: Record<string, unknown>; stufe?: string };
        return { land: b.land, sku: b.sku, asin: d.asin ?? undefined, titel: d.titel ? String(d.titel).slice(0, 60) : undefined, befund: `${d.nr} ${d.befund ?? ""}`.trim(), stufe: d.stufe, zahlen: d.zahlen, vorschlag: (b.gruende ?? []).join(" "), potenzial_euro_monat: b.potenzial ?? 0 };
      }),
      trefferquote: tq && tq.freigaben ? { freigaben_aelter_14_tage: tq.freigaben, mit_mehr_verkaeufen: tq.mitVerkauf, quote_prozent: tq.quote } : undefined,
      hinweis: "Freigaben nur auf der Seite; sie stehen in der nächsten ProfitGuard-Importdatei, nie direkt in ProfitGuard.",
      link: abs(ctx, "/repricer/listing-check"),
      datenstand: { quelle: "Listing-Check (Seller-System)", stand: st ? berlinDateTime(new Date(st.am)) ?? "" : "kein Lauf", abgerufen: berlinDateTime(new Date()) ?? "" },
    });
  },
});

export const REPRICING = [repricer, profitguardExportVorschauTool, profitguardExportErzeugenTool, listingCheckTool];
