import "server-only";
import { z } from "zod";
import { lugruKanalStand } from "@/lib/lugru-deals/discord";
import { lugruHistorieStand } from "@/lib/lugru-deals/historie";
import { lugruDeal, lugruListe, lugruStatistikFuer } from "@/lib/lugru-deals/liste";
import { defineTool } from "../types";
import { abs, isoDate, json, uuid } from "./common";

// Lugru Deals: die in der Deal-Gruppe geposteten Deals (Discord gelesen bzw. aus Lugru Deals übertragen) mit
// Reaktionen als Anzahl, Ampel, Deal-Wert und eigenen Käufen. Nur lesen; Bewerten über deal_bewerten (Deal-Eingang).

const QUELLE = { text: "Lugru Deals (Weg A: von der Lugru-Deals-App übertragen; Weg B: Deal-Kanäle in Discord gelesen) + Deal-Eingang", jobs: ["Lugru Deals (Discord)", "Lugru Deals: History", "Lugru Deals: History → Deal-Eingang"] };

/** Wege und Import-Stand für lugru_deals/lugru_statistik (Weg A = App schickt, Weg B = Seller-System liest Discord). */
async function importStand(tenantId: string) {
  const [stand, eingang] = await Promise.all([lugruKanalStand(tenantId), lugruHistorieStand(tenantId)]);
  const ausApp = stand.deals - stand.ausDiscord;
  return {
    weg: ausApp > 0 ? (stand.kanaele.length ? "A + B" : "A (Lugru-Deals-App schickt jeden Deal)") : stand.kanaele.length ? "B (Discord-Kanäle)" : "keiner eingerichtet",
    deals_gesamt: stand.deals,
    aus_app: ausApp,
    aus_discord: stand.ausDiscord,
    zuletzt_von_app: stand.appZuletzt,
    zaehlbasis: "Deals im Deal-Eingang mit Ampel (gleiche Basis wie Lugru-Seite, Kachel „Anteil grün“, deal_quellen und Deal-Eingang)",
    im_deal_eingang_mit_ampel: eingang.mitAmpel,
    fortschritt: `${eingang.mitAmpel} / ${eingang.gesamt}`,
    fortschritt_stand: eingang.stand ? eingang.stand.toISOString() : null,
    ampel_im_eingang: { gruen: eingang.gruen, gelb: eingang.gelb, rot: eingang.rot, anteil_gruen_prozent: eingang.anteilGruen },
    noch_alte_ampel_regeln: eingang.alteRegeln || undefined,
    ohne_testkanaele: eingang.gesamt,
    kanaele: stand.kanaele.length ? stand.kanaele.map((k) => ({ kanal: k.kanal, history_fertig: k.historieFertig, history_bis: k.historieBis, fehler: k.fehler ?? undefined })) : undefined,
    hinweis:
      ausApp === 0 && !stand.kanaele.length
        ? "Noch kein Weg eingerichtet – Anbindungen → „Lugru Deals“: Schlüssel für die Lugru-Deals-App (Weg A) oder Kanal-IDs mit Bot (Weg B)."
        : eingang.mitAmpel < eingang.gesamt
          ? `${eingang.gesamt - eingang.mitAmpel} ältere Deals werden noch in den Deal-Eingang nachgetragen (neueste zuerst, ohne Push, bis alle drin sind).`
          : undefined,
  };
}

export const lugruDealsTool = defineTool({
  name: "lugru_deals",
  title: "Lugru Deals: Liste",
  description:
    "Gepostete Deals der Lugru-Gruppe (neueste zuerst) mit Kanal, ASIN, Shop, EK/VK/Gewinn laut Post, Reaktionen je Emoji (nur Anzahl, ✅ = Gruppen-Käufe; bei Weg A nur ✅/❌, dann mit reaktionen_hinweis), Ampel, Deal-Wert 0–100, Eintrag im Deal-Eingang und ob Ludwig selbst gekauft hat. Testkanäle („test“, „test1“) nur mit mit_test. Filter: seit (Datum), ampel, gekauft (eigener Kauf), min_wert, kanal, suche (Titel/ASIN/Shop).",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({
    seit: isoDate.optional(),
    bis: isoDate.optional(),
    ampel: z.enum(["gruen", "gelb", "rot"]).optional(),
    gekauft: z.boolean().optional(),
    min_wert: z.number().min(0).max(100).optional(),
    kanal: z.string().trim().max(80).optional(),
    suche: z.string().trim().max(60).optional(),
    mit_test: z.boolean().default(false).describe("auch Deals aus Testkanälen"),
    limit: z.number().int().min(1).max(200).default(30),
  }),
  run: async (ctx, i) => {
    const r = await lugruListe(ctx.session.tenantId, { von: i.seit, bis: i.bis, ampel: i.ampel, gekauft: i.gekauft ?? null, minWert: i.min_wert ?? null, kanal: i.kanal, suche: i.suche, limit: i.limit, mitTest: i.mit_test });
    const imp = await importStand(ctx.session.tenantId);
    return json({
      gesamt: r.gesamt,
      deals: r.deals.map((d) => ({ ...d, link: abs(ctx, `/deal-eingang/lugru/${d.id}`), link_eingang: d.eingang_id ? abs(ctx, `/deal-eingang/${d.eingang_id}`) : undefined })),
      import: imp,
      hinweis: imp.hinweis,
      link: abs(ctx, "/deal-eingang/lugru"),
    });
  },
});

export const lugruDealTool = defineTool({
  name: "lugru_deal",
  title: "Lugru Deals: ein Deal",
  description:
    "Ein Lugru-Deal (id aus lugru_deals): Post-Zahlen, Reaktionen je Emoji (Anzahl), Keepa-Schnappschuss zum Zeitpunkt des Postens (Buy Box jetzt/Ø30/90/180, Einbrüche, Angebote + Trend, Amazon-Anteil, Rang), Ampel, Deal-Wert mit Top-3 dafür/dagegen, 3–5 ähnliche frühere Deals, eigene Entscheidung/Ergebnis und weitere Posts derselben ASIN.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({ id: uuid }),
  run: async (ctx, i) => {
    const d = await lugruDeal(ctx.session.tenantId, i.id);
    if (!d) return { text: "Lugru-Deal nicht gefunden.", isError: true };
    return json({ ...d, link: abs(ctx, `/deal-eingang/lugru/${d.id}`), link_eingang: d.eingang_id ? abs(ctx, `/deal-eingang/${d.eingang_id}`) : undefined });
  },
});

export const lugruStatistikTool = defineTool({
  name: "lugru_statistik",
  title: "Lugru Deals: Statistik",
  description:
    "Statistik der Lugru-Deals im Zeitraum (Standard 90 Tage, steht in „zeitraum“): Deals und je Woche, Reaktionen (Summe, Ø je Deal, häufigste Emojis), Gruppen-Käufe (✅), Anteil grün (Zählbasis wie Lugru-Seite und deal_quellen: Deals im Deal-Eingang mit Ampel, im Zeitraum), eigene Käufe, Ø realer ROI (sellerboard), beste Marken/Kategorien (Keepa) und Deals je Kanal; dazu „gesamt“ = alle Deals seit dem ersten Post (wie deal_quellen). Testkanäle nur mit mit_test. Nur Anzahlen, keine Namen.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({ von: isoDate.optional(), bis: isoDate.optional(), mit_test: z.boolean().default(false) }),
  run: async (ctx, i) => {
    const s = await lugruStatistikFuer(ctx.session.tenantId, { von: i.von, bis: i.bis, mitTest: i.mit_test });
    const imp = await importStand(ctx.session.tenantId);
    return json({ ...s, zeitraum_hinweis: `Zahlen oben für ${s.zeitraum.von} bis ${s.zeitraum.bis}; „gesamt“ für alle Deals seit ${s.gesamt.seit ?? "Beginn"}.`, import: imp, link: abs(ctx, "/deal-eingang/lugru") });
  },
});

export const LUGRU = [lugruDealsTool, lugruDealTool, lugruStatistikTool];
