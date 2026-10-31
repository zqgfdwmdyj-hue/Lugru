import "server-only";
import { z } from "zod";
import { lugruKanalStand } from "@/lib/lugru-deals/discord";
import { lugruDeal, lugruListe, lugruStatistikFuer } from "@/lib/lugru-deals/liste";
import { defineTool } from "../types";
import { abs, isoDate, json, uuid } from "./common";

// Lugru Deals: die in der Deal-Gruppe geposteten Deals (Discord gelesen bzw. aus Lugru Deals übertragen) mit
// Reaktionen als Anzahl, Ampel, Deal-Wert und eigenen Käufen. Nur lesen; Bewerten über deal_bewerten (Deal-Eingang).

const QUELLE = { text: "Lugru Deals (Deal-Kanäle in Discord, vom Seller-System gelesen) + Deal-Eingang", jobs: ["Lugru Deals (Discord)", "Lugru Deals: History"] };

export const lugruDealsTool = defineTool({
  name: "lugru_deals",
  title: "Lugru Deals: Liste",
  description:
    "Gepostete Deals der Lugru-Gruppe (neueste zuerst) mit Kanal, ASIN, Shop, EK/VK/Gewinn laut Post, Reaktionen je Emoji (nur Anzahl, ✅ = Gruppen-Käufe), Ampel, Deal-Wert 0–100 und ob Ludwig selbst gekauft hat. Filter: seit (Datum), ampel, gekauft (eigener Kauf), min_wert, kanal, suche (Titel/ASIN/Shop).",
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
    limit: z.number().int().min(1).max(200).default(30),
  }),
  run: async (ctx, i) => {
    const r = await lugruListe(ctx.session.tenantId, { von: i.seit, bis: i.bis, ampel: i.ampel, gekauft: i.gekauft ?? null, minWert: i.min_wert ?? null, kanal: i.kanal, suche: i.suche, limit: i.limit });
    const stand = await lugruKanalStand(ctx.session.tenantId);
    return json({
      gesamt: r.gesamt,
      deals: r.deals.map((d) => ({ ...d, link: abs(ctx, `/deal-eingang/lugru/${d.id}`) })),
      import: { deals_gesamt: stand.deals, aus_discord: stand.ausDiscord, kanaele: stand.kanaele.map((k) => ({ kanal: k.kanal, history_fertig: k.historieFertig, history_bis: k.historieBis, fehler: k.fehler ?? undefined })) },
      hinweis: stand.kanaele.length ? undefined : "Noch keine Deal-Kanäle eingerichtet – Anbindungen → „Lugru Deals“: Kanal-IDs und Bot.",
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
    "Statistik der Lugru-Deals im Zeitraum (Standard 90 Tage): Deals gesamt und je Woche, Reaktionen (Summe, Ø je Deal, häufigste Emojis), Gruppen-Käufe (✅), Anteil grün, eigene Käufe, Ø realer ROI (sellerboard), beste Marken/Kategorien und Deals je Kanal. Nur Anzahlen, keine Namen.",
  area: "dealeingang",
  write: false,
  quelle: QUELLE,
  input: z.object({ von: isoDate.optional(), bis: isoDate.optional() }),
  run: async (ctx, i) => {
    const s = await lugruStatistikFuer(ctx.session.tenantId, { von: i.von, bis: i.bis });
    return json({ ...s, link: abs(ctx, "/deal-eingang/lugru") });
  },
});

export const LUGRU = [lugruDealsTool, lugruDealTool, lugruStatistikTool];
