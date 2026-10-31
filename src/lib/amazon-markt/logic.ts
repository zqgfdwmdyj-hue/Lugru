// Amazon je Land: Buy-Box-Anteil (Bericht „Sales and Traffic“), Listung (Bericht „Alle Angebote“), Lageralter und
// Aufschlag für lange Lagerung (Bericht „Bestandsplanung“) und Angebote live (Pricing-API getItemOffers).
// Reine Logik ohne Datenbank: Berichte lesen und Antworten verdichten, damit testbar.

export const MARKTPLATZ_IDS = {
  DE: "A1PA6795UKMFR9",
  FR: "A13V1IB3VIYZZH",
  IT: "APJ6JRA9NG5V4",
  ES: "A1RKKUPIHCS9HS",
  NL: "A1805IZSGTT6HS",
  BE: "AMEN7PMS3EDWL",
  PL: "A1C3SOZRARQ6R3",
  SE: "A2NODRKZP88ZB9",
  UK: "A1F83G8C2ARO7P",
  IE: "A28R8C7NBKEWEA",
} as const;
export type Land = keyof typeof MARKTPLATZ_IDS;
export const LAENDER = Object.keys(MARKTPLATZ_IDS) as Land[];
export const landVonId = (id: string): Land | null => (Object.entries(MARKTPLATZ_IDS).find(([, v]) => v === id)?.[0] as Land | undefined) ?? null;
/** Amazon selbst als Verkäufer je Land (Händler-ID). */
export const AMAZON_VERKAEUFER: Partial<Record<Land, string>> = { DE: "A3JWKAKR8XB7XF", FR: "A1X6FK5RDHNB96", IT: "A11IL2PNWYJU7H", ES: "A1AT7YVPFBWXBL", NL: "A17D2BRD4YMT0X", BE: "A3Q3FYJVX702M2", PL: "A2R2221NX79QZP", SE: "ANU9KP01APNAG", UK: "A3P5ROKL5A1OLE", IE: "A2QHQAREJ10JUZ" };

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[€$£\s]/g, "").trim();
  if (!s) return null;
  // Komma hinter dem letzten Punkt → deutsch (1.234,50 / 9,99); mehrere Punkt-Gruppen → Tausender (1.234.567);
  // sonst ist der Punkt das Dezimalzeichen (0.125, 1.143, 1,234.50) – Amazon-Berichte rechnen oft mit 3 Stellen.
  if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// ---- Sales and Traffic (JSON) --------------------------------------------------------------------

export type BuyboxZeile = { asin: string; elternAsin: string | null; sku: string | null; sitzungen: number | null; seitenaufrufe: number | null; buyboxProzent: number | null; kaufquoteProzent: number | null; einheiten: number | null; umsatz: number | null; waehrung: string | null };

/** GET_SALES_AND_TRAFFIC_REPORT (asinGranularity CHILD oder SKU) → Zeilen je ASIN, Zeitraum und Marktplatz. */
export function leseSalesTraffic(doc: unknown): { land: Land | null; von: string | null; bis: string | null; zeilen: BuyboxZeile[] } {
  const d = (doc ?? {}) as { reportSpecification?: { dataStartTime?: string; dataEndTime?: string; marketplaceIds?: string[] }; salesAndTrafficByAsin?: Record<string, unknown>[] };
  const spec = d.reportSpecification ?? {};
  const zeilen: BuyboxZeile[] = [];
  for (const e of d.salesAndTrafficByAsin ?? []) {
    const asin = (e.childAsin ?? e.asin ?? e.parentAsin) as string | undefined;
    if (!asin) continue;
    const s = (e.salesByAsin ?? {}) as { unitsOrdered?: number; orderedProductSales?: { amount?: number; currencyCode?: string } };
    const t = (e.trafficByAsin ?? {}) as { sessions?: number; pageViews?: number; buyBoxPercentage?: number; unitSessionPercentage?: number };
    zeilen.push({
      asin,
      elternAsin: (e.parentAsin as string | undefined) ?? null,
      sku: (e.sku as string | undefined) ?? null,
      sitzungen: num(t.sessions),
      seitenaufrufe: num(t.pageViews),
      buyboxProzent: num(t.buyBoxPercentage),
      kaufquoteProzent: num(t.unitSessionPercentage),
      einheiten: num(s.unitsOrdered),
      umsatz: r2(num(s.orderedProductSales?.amount)),
      waehrung: s.orderedProductSales?.currencyCode ?? null,
    });
  }
  const day = (x?: string) => (x ? x.slice(0, 10) : null);
  return { land: spec.marketplaceIds?.[0] ? landVonId(spec.marketplaceIds[0]) : null, von: day(spec.dataStartTime), bis: day(spec.dataEndTime), zeilen };
}

// ---- Alle Angebote (Flatfile, teils in Landessprache) ----------------------------------------------

export type ListingZeile = { sku: string; asin: string | null; titel: string | null; preis: number | null; menge: number | null; status: "aktiv" | "inaktiv" | "unvollstaendig" | null; versand: "FBA" | "FBM" | null; erstellt: string | null };

const SPALTE = {
  sku: ["sellersku", "handlersku", "haendlersku", "skuvendeur", "skuvenditore", "skudelvendedor", "merchantsku", "sku"],
  asin: ["asin1", "asin"],
  titel: ["itemname", "artikelbezeichnung", "artikelname", "nomdelarticle", "nomedellarticolo", "nombredelproducto", "titel"],
  preis: ["price", "preis", "prix", "prezzo", "precio"],
  menge: ["quantity", "menge", "quantite", "quantita", "cantidad"],
  status: ["status", "statut", "stato", "estado"],
  versand: ["fulfillmentchannel", "versender", "versandkanal", "canaldexpedition", "canaledievasione", "canaldegestionlogistica", "canaldelogistica"],
  erstellt: ["opendate", "erstellungsdatum", "datedecreation", "datadicreazione", "fechadecreacion"],
} as const;

export function leseListings(headers: string[], rows: string[][]): ListingZeile[] {
  const n = headers.map(norm);
  const col = (k: keyof typeof SPALTE) => n.findIndex((h) => (SPALTE[k] as readonly string[]).includes(h));
  const c = Object.fromEntries((Object.keys(SPALTE) as (keyof typeof SPALTE)[]).map((k) => [k, col(k)])) as Record<keyof typeof SPALTE, number>;
  if (c.sku < 0) return [];
  const g = (r: string[], k: keyof typeof SPALTE) => (c[k] >= 0 ? (r[c[k]] ?? "").trim() : "");
  return rows
    .map((r): ListingZeile | null => {
      const sku = g(r, "sku");
      if (!sku) return null;
      const st = norm(g(r, "status"));
      const vs = g(r, "versand").toUpperCase();
      const asin = g(r, "asin").toUpperCase();
      return {
        sku,
        asin: /^[A-Z0-9]{10}$/.test(asin) ? asin : null,
        titel: g(r, "titel").slice(0, 300) || null,
        preis: num(g(r, "preis")),
        menge: num(g(r, "menge")),
        status: /^(active|aktiv|actif|attivo|activo)/.test(st) ? "aktiv" : /^(inactive|inaktiv|inactif|inattivo|inactivo)/.test(st) ? "inaktiv" : /^(incomplete|unvollst|incomplet|incompleto)/.test(st) ? "unvollstaendig" : null,
        versand: vs.startsWith("AMAZON") || vs === "AFN" ? "FBA" : vs === "DEFAULT" || vs === "MFN" || vs.includes("MERCHANT") ? "FBM" : null,
        erstellt: g(r, "erstellt").slice(0, 10) || null,
      };
    })
    .filter((x): x is ListingZeile => x !== null);
}

/**
 * Wo fehlt eine Listung? Je SKU (bzw. ASIN) die Länder, in denen sie aktiv ist, und die Länder der Anbindung, in
 * denen sie fehlt oder inaktiv ist. Nur SKUs, die irgendwo aktiv sind.
 */
export function fehlendeListungen(je: Partial<Record<Land, ListingZeile[]>>, laender: Land[]) {
  const sku = new Map<string, { asin: string | null; titel: string | null; aktiv: Land[]; inaktiv: Land[]; fehlt: Land[] }>();
  for (const l of laender) for (const z of je[l] ?? []) {
    const e = sku.get(z.sku) ?? { asin: z.asin, titel: z.titel, aktiv: [], inaktiv: [], fehlt: [] };
    e.asin ??= z.asin;
    e.titel ??= z.titel;
    (z.status === "aktiv" ? e.aktiv : e.inaktiv).push(l);
    sku.set(z.sku, e);
  }
  const out: { sku: string; asin: string | null; titel: string | null; aktiv: Land[]; inaktiv: Land[]; fehlt: Land[] }[] = [];
  for (const [s, e] of sku) {
    if (!e.aktiv.length) continue;
    e.fehlt = laender.filter((l) => je[l] !== undefined && !e.aktiv.includes(l) && !e.inaktiv.includes(l));
    if (e.fehlt.length || e.inaktiv.length) out.push({ sku: s, ...e });
  }
  return out.sort((a, b) => b.fehlt.length + b.inaktiv.length - (a.fehlt.length + a.inaktiv.length) || a.sku.localeCompare(b.sku));
}

// ---- Bestandsplanung: Lageralter und Aufschlag -------------------------------------------------------

export type AlterZeile = {
  sku: string;
  asin: string | null;
  fnsku: string | null;
  titel: string | null;
  verfuegbar: number | null;
  /** Stück je Altersstufe in Tagen, z. B. {"0-90": 12, "91-180": 3, "181-270": 0, …} – wie im Bericht. */
  alter: Record<string, number>;
  stueckMitAufschlag: number | null;
  aufschlagGeschaetzt: number | null;
  lagerkostenNaechsterMonat: number | null;
  empfehlung: string | null;
  gesundheit: string | null;
  waehrung: string | null;
  stichtag: string | null;
};

/** GET_FBA_INVENTORY_PLANNING_DATA → Zeilen. Spalten „inv-age-…“, „estimated-ais-…“ und „quantity-to-be-charged-ais-…“ werden summiert. */
export function leseBestandsplanung(headers: string[], rows: string[][]): AlterZeile[] {
  const h = headers.map((x) => x.trim().toLowerCase());
  const i = (name: string) => h.indexOf(name);
  const ageCols = h.map((x, j) => [x, j] as const).filter(([x]) => /^inv-age-/.test(x));
  // Feinere Stufen (0-30, 31-60, 61-90) nur, wenn es keine grobe 0-90 gibt – sonst doppelt.
  const grob = new Set(ageCols.map(([x]) => x));
  const nutzen = ageCols.filter(([x]) => !(/^inv-age-(0-to-30|31-to-60|61-to-90)-days$/.test(x) && grob.has("inv-age-0-to-90-days")) && !(/^inv-age-(181-to-330|331-to-365)-days$/.test(x) && grob.has("inv-age-181-to-270-days")));
  const aisCols = h.map((x, j) => [x, j] as const).filter(([x]) => /^estimated-ais-/.test(x));
  const qtyAisCols = h.map((x, j) => [x, j] as const).filter(([x]) => /^quantity-to-be-charged-ais-/.test(x));
  const g = (r: string[], name: string) => (i(name) >= 0 ? (r[i(name)] ?? "").trim() : "");
  const sum = (r: string[], cols: (readonly [string, number])[]) => {
    const v = cols.map(([, j]) => num(r[j])).filter((n): n is number => n !== null);
    return v.length ? r2(v.reduce((a, b) => a + b, 0)) : null;
  };
  return rows
    .map((r): AlterZeile | null => {
      const sku = g(r, "sku");
      if (!sku) return null;
      const alter: Record<string, number> = {};
      for (const [x, j] of nutzen) {
        const n = num(r[j]);
        if (n !== null) alter[x.replace(/^inv-age-/, "").replace(/-days$/, "").replace(/-to-/g, "-").replace("-plus", "+")] = n;
      }
      const asin = g(r, "asin").toUpperCase();
      return {
        sku,
        asin: /^[A-Z0-9]{10}$/.test(asin) ? asin : null,
        fnsku: g(r, "fnsku") || null,
        titel: g(r, "product-name").slice(0, 300) || null,
        verfuegbar: num(g(r, "available")),
        alter,
        stueckMitAufschlag: sum(r, qtyAisCols),
        aufschlagGeschaetzt: sum(r, aisCols),
        lagerkostenNaechsterMonat: r2(num(g(r, "estimated-storage-cost-next-month"))),
        empfehlung: g(r, "recommended-action") || null,
        gesundheit: g(r, "fba-inventory-level-health-status") || null,
        waehrung: g(r, "currency") || null,
        stichtag: g(r, "snapshot-date").slice(0, 10) || null,
      };
    })
    .filter((x): x is AlterZeile => x !== null);
}

/** Stück, die älter als 180 Tage sind (dafür berechnet Amazon den Aufschlag). */
export const alterUeber180 = (alter: Record<string, number>) => Object.entries(alter).reduce((n, [k, v]) => (/^(181|2\d\d|3\d\d|365)/.test(k) ? n + v : n), 0);

// ---- Angebote live (getItemOffers) -------------------------------------------------------------------

export type AngeboteLive = {
  buyboxPreis: number | null;
  buyboxBei: "uns" | "Amazon" | "FBA-Händler" | "FBM-Händler" | "niemand" | "unbekannt";
  buyboxVerkaeufer: string | null;
  angeboteGesamt: number | null;
  angeboteFba: number | null;
  angeboteFbm: number | null;
  niedrigsterFba: number | null;
  niedrigsterFbm: number | null;
  amazonBietetMit: boolean;
  rang: number | null;
  waehrung: string | null;
  angebote: { verkaeufer: string; wir: boolean; amazon: boolean; preis: number | null; versand: number | null; fba: boolean; buybox: boolean; bewertung_prozent: number | null }[];
};

type Money = { Amount?: number; CurrencyCode?: string };
type Offer = { SellerId?: string; MyOffer?: boolean; ListingPrice?: Money; Shipping?: Money; IsFulfilledByAmazon?: boolean; IsBuyBoxWinner?: boolean; SellerFeedbackRating?: { SellerPositiveFeedbackRating?: number } };

/** Antwort von GET /products/pricing/v0/items/{asin}/offers → verdichtet. `eigeneId` = unsere Händler-ID (falls bekannt). */
export function verdichteAngebote(payload: unknown, land: Land, eigeneId: string | null): AngeboteLive {
  const p = ((payload as { payload?: unknown })?.payload ?? payload ?? {}) as { Summary?: Record<string, unknown>; Offers?: Offer[] };
  const s = (p.Summary ?? {}) as { TotalOfferCount?: number; NumberOfOffers?: { condition?: string; fulfillmentChannel?: string; OfferCount?: number }[]; LowestPrices?: { condition?: string; fulfillmentChannel?: string; LandedPrice?: Money }[]; BuyBoxPrices?: { condition?: string; LandedPrice?: Money }[]; SalesRankings?: { Rank?: number }[] };
  const neu = (c?: string) => !c || c.toLowerCase() === "new";
  const amazonId = AMAZON_VERKAEUFER[land];
  const count = (ch: string) => (s.NumberOfOffers ?? []).filter((o) => neu(o.condition) && o.fulfillmentChannel === ch).reduce((n, o) => n + (o.OfferCount ?? 0), 0);
  const lowest = (ch: string) => r2(num((s.LowestPrices ?? []).find((o) => neu(o.condition) && o.fulfillmentChannel === ch)?.LandedPrice?.Amount));
  const offers = p.Offers ?? [];
  const winner = offers.find((o) => o.IsBuyBoxWinner);
  const bb = (s.BuyBoxPrices ?? []).find((b) => neu(b.condition));
  const wir = (o: Offer) => Boolean(o.MyOffer) || (eigeneId !== null && o.SellerId === eigeneId);
  const buyboxBei: AngeboteLive["buyboxBei"] = winner ? (wir(winner) ? "uns" : winner.SellerId === amazonId ? "Amazon" : winner.IsFulfilledByAmazon ? "FBA-Händler" : "FBM-Händler") : bb ? "unbekannt" : "niemand";
  return {
    buyboxPreis: r2(num(bb?.LandedPrice?.Amount)) ?? (winner ? r2((num(winner.ListingPrice?.Amount) ?? 0) + (num(winner.Shipping?.Amount) ?? 0)) : null),
    buyboxBei,
    buyboxVerkaeufer: winner?.SellerId ?? null,
    angeboteGesamt: typeof s.TotalOfferCount === "number" ? s.TotalOfferCount : null,
    angeboteFba: s.NumberOfOffers ? count("Amazon") : null,
    angeboteFbm: s.NumberOfOffers ? count("Merchant") : null,
    niedrigsterFba: lowest("Amazon"),
    niedrigsterFbm: lowest("Merchant"),
    amazonBietetMit: offers.some((o) => o.SellerId === amazonId),
    rang: s.SalesRankings?.[0]?.Rank ?? null,
    waehrung: bb?.LandedPrice?.CurrencyCode ?? offers[0]?.ListingPrice?.CurrencyCode ?? null,
    angebote: offers.slice(0, 20).map((o) => ({
      verkaeufer: o.SellerId ?? "?",
      wir: wir(o),
      amazon: o.SellerId === amazonId,
      preis: r2(num(o.ListingPrice?.Amount)),
      versand: r2(num(o.Shipping?.Amount)),
      fba: Boolean(o.IsFulfilledByAmazon),
      buybox: Boolean(o.IsBuyBoxWinner),
      bewertung_prozent: num(o.SellerFeedbackRating?.SellerPositiveFeedbackRating),
    })),
  };
}
