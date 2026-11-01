// „Kaufen mit einem Tap“ – reine Logik: Shop-Profile, Kauf-Link (Amazon-Warenkorb bzw. Produktseite), Menge,
// Gutscheincode aus dem Post, Kauf-Nummer („Kaufen 17“) und Monatsrahmen. Kein automatischer Einkauf: das System
// bereitet den Link vor, Ludwig tippt „Jetzt kaufen“. Keine Zahlungsdaten, keine Logins, kein Headless-Browser.

export const LINK_ARTEN = ["warenkorb_link", "produktseite", "suche"] as const;
export type LinkArt = (typeof LINK_ARTEN)[number];

export type ShopProfil = {
  /** Lieferantenkürzel wie in der SKU (MEDIA, NOTIN, AMZDE …). */
  kuerzel: string;
  name: string;
  /** Domains ohne „www.“ – passt auch auf Unterdomains. */
  domains: string[];
  linkArt: LinkArt;
  /** Platzhalter: {asin}, {menge}, {suche}, {url}. Leer = Produktseite aus dem Post. */
  linkMuster: string | null;
  hinweis: string | null;
  /** Payback bei diesem Shop: wie (Hinweis im Push); leer = kein Payback. */
  payback: string | null;
  aktiv: boolean;
};

const amazon = (land: string, tld: string): ShopProfil => ({
  kuerzel: `AMZ${land}`,
  name: `Amazon.${land}`,
  domains: [`amazon.${tld}`],
  linkArt: "warenkorb_link",
  linkMuster: `https://www.amazon.${tld}/gp/aws/cart/add.html?ASIN.1={asin}&Quantity.1={menge}`,
  hinweis: null,
  // Stand 11/2026: keine feste Verknüpfung im Amazon-Konto – Punkte nur, wenn der Einkauf in der PAYBACK-App bzw.
  // auf payback.de startet (Warenkorb leer). Gewerbe-/Großmengenkäufe sind laut Bedingungen ausgenommen.
  payback: land === "DE" ? "Einkauf in der PAYBACK-App starten (Warenkorb vorher leer) – feste Verknüpfung gibt es nicht" : null,
  aktiv: true,
});

const seite = (kuerzel: string, name: string, domains: string[], hinweis: string | null = null): ShopProfil => ({ kuerzel, name, domains, linkArt: "produktseite", linkMuster: null, hinweis, payback: null, aktiv: true });

/** Start-Profile: Amazon je Land mit Warenkorb-Link, alle anderen Produktseite + Hinweis. */
export const STANDARD_SHOPS: ShopProfil[] = [
  amazon("DE", "de"),
  amazon("FR", "fr"),
  amazon("IT", "it"),
  amazon("ES", "es"),
  seite("MEDIA", "MediaMarkt", ["mediamarkt.de"]),
  seite("SATUR", "Saturn", ["saturn.de"]),
  seite("NOTIN", "Notino", ["notino.de"]),
  seite("DOUGL", "Douglas", ["douglas.de"]),
  seite("FLACO", "Flaconi", ["flaconi.de"]),
  seite("MUELL", "Müller", ["mueller.de"]),
  seite("PARFU", "Parfumdreams", ["parfumdreams.de"]),
];

export const istAmazon = (p: Pick<ShopProfil, "kuerzel"> | null | undefined) => !!p && /^AMZ[A-Z]{2}$/.test(p.kuerzel);

/** Gespeicherte Profile überschreiben die Start-Profile gleichen Kürzels; neue kommen dazu. */
export function profileZusammen(eigene: ShopProfil[]): ShopProfil[] {
  const m = new Map(STANDARD_SHOPS.map((p) => [p.kuerzel, p]));
  for (const p of eigene) m.set(p.kuerzel.toUpperCase(), { ...p, kuerzel: p.kuerzel.toUpperCase() });
  return [...m.values()];
}

const hostVon = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Profil zu einem Link bzw. einer Domain (auch Unterdomain); nur aktive. */
export function profilFuer(urlOderHost: string | null | undefined, profile: ShopProfil[]): ShopProfil | null {
  if (!urlOderHost) return null;
  const host = /^https?:\/\//i.test(urlOderHost) ? hostVon(urlOderHost) : urlOderHost.toLowerCase().replace(/^www\./, "");
  if (!host) return null;
  return profile.find((p) => p.aktiv && p.domains.some((d) => host === d || host.endsWith(`.${d}`))) ?? null;
}

/** Amazon-Profil für ein Land (DE/FR/IT/ES …). */
export const amazonProfil = (land: string | null | undefined, profile: ShopProfil[]) => profile.find((p) => p.aktiv && p.kuerzel === `AMZ${(land ?? "DE").toUpperCase()}`) ?? null;

/**
 * Menge im Link: Empfehlung der Deal-Ampel, begrenzt durch „max. Stück“ des Deals und – falls gesetzt – das Budget
 * je Deal (0 = keine Grenze). Mindestens 1.
 */
export function kaufMenge(empfohlen: number | null, o: { maxMenge?: number | null; budgetJeDeal?: number | null; ekNetto?: number | null } = {}): number {
  let n = Math.max(1, Math.floor(empfohlen ?? 1));
  if (o.maxMenge && o.maxMenge > 0) n = Math.min(n, Math.floor(o.maxMenge));
  if (o.budgetJeDeal && o.budgetJeDeal > 0 && o.ekNetto && o.ekNetto > 0) n = Math.min(n, Math.floor(o.budgetJeDeal / o.ekNetto));
  return Math.max(1, n);
}

export type KaufLink = {
  url: string;
  /** Produktseite, falls der Warenkorb-Link ohne Artikel öffnet. */
  fallbackUrl: string | null;
  art: LinkArt;
  /** true nur bei Amazon-Warenkorb-Link: „Warenkorb vorbereitet“. Sonst „Produktseite öffnen“. */
  warenkorb: boolean;
  hinweis: string | null;
};

const fuellen = (muster: string, w: Record<string, string>) => muster.replace(/\{(asin|menge|suche|url)\}/g, (_, k: string) => w[k] ?? "");

/**
 * Link zum Kaufen nach Profil: Warenkorb-Link (Amazon: ASIN + Menge), Produktseite (Link aus dem Post bzw.
 * Amazon-Produktseite) oder Suche. Muster mit Platzhaltern, die wir nicht füllen können (z. B. Shopify-Variante),
 * fallen auf die Produktseite zurück.
 */
export function kaufLink(p: ShopProfil, d: { asin: string | null; menge: number; produktUrl: string | null; suche?: string | null }): KaufLink | null {
  const amz = istAmazon(p);
  const tld = p.domains[0] ?? "amazon.de";
  const amazonSeite = amz && d.asin ? `https://www.${tld}/dp/${d.asin}` : null;
  const produkt = d.produktUrl ?? amazonSeite;
  const mengeHinweis = `Menge ${d.menge} auf der Seite wählen`;
  const werte = { asin: d.asin ?? "", menge: String(d.menge), suche: encodeURIComponent(d.suche ?? ""), url: d.produktUrl ?? "" };
  const offen = (m: string) => /\{(?!asin|menge|suche|url)[a-z_]+\}/i.test(m);
  if (p.linkArt === "warenkorb_link" && p.linkMuster && !offen(p.linkMuster) && (!p.linkMuster.includes("{asin}") || d.asin) && (!p.linkMuster.includes("{url}") || d.produktUrl)) {
    return { url: fuellen(p.linkMuster, werte), fallbackUrl: produkt, art: "warenkorb_link", warenkorb: amz, hinweis: amz ? p.hinweis : [mengeHinweis, p.hinweis].filter(Boolean).join(" · ") };
  }
  if (p.linkArt === "suche" && p.linkMuster && d.suche && !offen(p.linkMuster)) {
    return { url: fuellen(p.linkMuster, werte), fallbackUrl: null, art: "suche", warenkorb: false, hinweis: [mengeHinweis, p.hinweis].filter(Boolean).join(" · ") };
  }
  const url = p.linkMuster && p.linkArt === "produktseite" && !offen(p.linkMuster) && (!p.linkMuster.includes("{url}") || d.produktUrl) && (!p.linkMuster.includes("{asin}") || d.asin) ? fuellen(p.linkMuster, werte) : produkt;
  if (!url) return null;
  return { url, fallbackUrl: null, art: "produktseite", warenkorb: false, hinweis: [mengeHinweis, p.hinweis].filter(Boolean).join(" · ") };
}

/** Erster Shop-Link im Text, der kein Amazon-, Discord-, Keepa- oder Werkzeug-Link ist. */
export function shopLinkAus(text: string): string | null {
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const host = hostVon(url);
    if (!host) continue;
    if (/(^|\.)amazon\.|amzn\.|discord(app)?\.com|wa\.me|whatsapp\.com|keepa\.com|profitpath|arbitrageone|sellerboard|selleramp/.test(host)) continue;
    return url;
  }
  return null;
}

const KEIN_CODE = new Set(["CODE", "GUTSCHEIN", "COUPON", "RABATT", "VOUCHER", "PROMO", "NICHT", "KEIN", "KEINE", "NONE", "AKTIV", "INKL", "MWST", "BRUTTO", "NETTO", "VERSAND"]);

/** Gutscheincode aus dem Post („Code: BLACK10“, „Gutscheincode BLACK10“, „Coupon: …“). */
export function gutscheinAus(text: string): string | null {
  const re = /(?:gutschein(?:-?code)?|rabatt-?code|promo-?code|coupon(?:-?code)?|voucher|code)\s*[:=]?\s*[„"'`»]?([A-Za-z0-9][A-Za-z0-9_-]{2,23})/gi;
  for (const m of text.matchAll(re)) {
    const c = m[1];
    // Codes stehen in Großbuchstaben/Ziffern; Wörter wie „im Warenkorb“ zählen nicht.
    if (c !== c.toUpperCase() || KEIN_CODE.has(c) || !/[A-Z]/.test(c) || c.length < 4) continue;
    return c;
  }
  return null;
}

/** Kleinste freie Kauf-Nummer (1–999) – Nummern der letzten 24 Std. sind belegt. */
export function kaufNummerFrei(belegt: Iterable<number>): number {
  const b = new Set(belegt);
  for (let n = 1; n < 1000; n++) if (!b.has(n)) return n;
  return 1000 + Math.floor(Math.random() * 9000);
}

export const KAUF_NR_STUNDEN = 24;
export const kaufNrGueltig = (am: Date | string | null | undefined, jetzt = new Date()) => !!am && jetzt.getTime() - new Date(am).getTime() < KAUF_NR_STUNDEN * 3600_000;

const eur0 = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;

/** „diesen Monat eingekauft: 83.400 € von ~150.000 €“ – Orientierung, keine Sperre. */
export function monatsrahmenText(summe: number, rahmen: number): string {
  if (!(rahmen > 0)) return `diesen Monat eingekauft: ${eur0(summe)}`;
  const t = `diesen Monat eingekauft: ${eur0(summe)} von ~${eur0(rahmen)}`;
  return summe > rahmen ? `${t} (Rahmen überschritten – nur Hinweis)` : t;
}
