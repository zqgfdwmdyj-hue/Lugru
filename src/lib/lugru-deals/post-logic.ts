// Lugru-Deal-Posts aus Discord lesen (Weg B: das Seller-System liest die Deal-Kanäle selbst). Gleiches Format wie
// in Lugru Deals (internal/altpost): Stichworte EK:/VK:/Gewinn:, nicht die Emojis – die sehen je nach Gerät anders aus.
//
//   🛒 Testprodukt @everyone
//   🏬 [testshop.de](https://…)
//   💰 EK: 99.99 € Brutto inkl. Versand
//   💸 VK: 164.99 €  [Amazon.DE](https://www.amazon.de/dp/B0…)
//   ℹ️ Amazon.DE: 50+ Verkäufe
//   🤑 Gewinn: 30.9 € / 19 % Marge
//
// Reine Logik ohne Datenbank. Gespeichert werden nur Zahlen, nie Namen oder IDs von Mitgliedern.

export type LugruPost = {
  titel: string;
  asin: string | null;
  /** ASIN nicht aus einem Amazon-Link, sondern frei im Text gefunden. */
  asinUnsicher: boolean;
  quellmarkt: string;
  zielmarkt: string;
  shop: string | null;
  shopUrl: string | null;
  lieferant: string | null;
  ekEur: number | null;
  ekNetto: boolean;
  ekNotiz: string | null;
  vkEur: number | null;
  verkaeufeMonat: number | null;
  gewinnEur: number;
  margeProzent: number;
  panEuGewinnEur: number | null;
  maxMenge: number | null;
  ausverkauft: boolean;
};

const LINK = /\[([^\]]*)\]\(<?(https?:\/\/[^)>\s]+)>?\)|<?(https?:\/\/[^\s<>)]+)>?/g;
const ASIN_LINK = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
const ASIN_FREI = /\b(B0[A-Z0-9]{8})\b/;
const AMAZON_HOST = /(?:^|\.)amazon\.(de|fr|it|es|co\.uk|com|nl|pl|se|com\.be)$/i;
const AMAZON_TEXT = /amazon\.(de|fr|it|es|nl|pl|se|be|uk)\b/i;
const ZAHL = /[-−–]?\s?\d[\d.,]*/;
const PROZENT = /([-−–]?\s?\d[\d.,]*)\s*%/;
const ERWAEHNUNG = /@everyone|@here|<@[!&]?\d+>/g;
const EIGEN_EMOJI = /<a?:\w+:\d+>|:[a-z0-9_+-]+:/g;
const SALES = /(\d[\d.]*)\s*\+?\s*(?:verk|sales|sold)/i;
const MENGE = /max\.?\s*(\d+)/i;

/** Deutsche und englische Schreibweisen: 99,99 · 99.99 · 1.299,99 · 1,299.99 · 30.9 · −5,77. */
export function zahl(roh: string): number | null {
  let s = roh.replace(/[−–]/g, "-").replace(/\s/g, "").replace(/[.,]+$/, "");
  const punkt = s.lastIndexOf(".");
  const komma = s.lastIndexOf(",");
  if (punkt >= 0 && komma >= 0) s = komma > punkt ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (komma >= 0) s = (s.match(/,/g)?.length ?? 0) === 1 && s.length - komma - 1 !== 3 ? s.replace(",", ".") : s.replace(/,/g, "");
  else if (punkt >= 0 && ((s.match(/\./g)?.length ?? 0) > 1 || s.length - punkt - 1 === 3)) s = s.replace(/\./g, "");
  const f = Number(s);
  return s !== "" && s !== "-" && Number.isFinite(f) ? f : null;
}

const cent = (f: number) => Math.round(f * 100);

function linksAus(z: string): string[] {
  const out: string[] = [];
  for (const m of z.matchAll(LINK)) out.push(m[2] || m[3]);
  return out.filter(Boolean);
}

function ohneEmoji(z: string): string {
  return z.replace(EIGEN_EMOJI, "").replace(/^[^0-9A-Za-zÀ-ɏ]+/u, "");
}

/** Alle Lesarten des ersten Betrags hinter dem Trenner (in Cent): „7.848“ = 7848 € oder 7,848 €. */
function betragKandidaten(zIn: string, trenner = ":"): number[] {
  let z = zIn;
  const i = z.indexOf(trenner);
  if (i >= 0) z = z.slice(i + trenner.length);
  z = z.replace(LINK, "").replace(new RegExp(PROZENT.source, "g"), "");
  const roh = ZAHL.exec(z)?.[0];
  if (!roh) return [];
  const f = zahl(roh);
  if (f === null) return [];
  const out = [cent(f)];
  const s = roh.replace(/[−–]/g, "-").replace(/\s/g, "").replace(/[.,]+$/, "");
  for (const [sep, andere] of [[".", ","], [",", "."]] as const) {
    if (s.split(sep).length === 2 && !s.includes(andere) && s.length - s.lastIndexOf(sep) - 1 === 3) {
      const g = Number(s.replace(sep, "."));
      if (Number.isFinite(g) && cent(g) !== out[0]) out.push(cent(g));
    }
  }
  return out;
}

const prozentAus = (z: string) => {
  const m = PROZENT.exec(z);
  return m ? (zahl(m[1]) ?? 0) : 0;
};

function marktCode(tld: string): string {
  const t = tld.toLowerCase();
  if (t === "co.uk" || t === "uk") return "UK";
  if (t === "com.be" || t === "be") return "BE";
  if (t === "com") return "US";
  return t.toUpperCase();
}

const landAusHost = (host: string) => ["de", "fr", "it", "es"].find((l) => host.endsWith(`.${l}`))?.toUpperCase() ?? "DE";

function margeNach(marge: number, gewinn: number, vk: number): number {
  if (marge >= -100 && marge <= 100 && !(marge === 0 && gewinn !== 0)) return marge;
  if (vk <= 0) return 0;
  return Math.round((gewinn * 1000) / vk) / 10;
}

/** Einen Discord-Post lesen. null, wenn er nicht nach einem Deal aussieht (ohne Titel oder ohne Gewinnzeile). */
export function lugruPostLesen(textIn: string): LugruPost | null {
  const roh = String(textIn ?? "").replace(/\r/g, "");
  const ausverkauft = /AUSVERKAUFT/i.test(roh);
  const text = roh.replace(/~~/g, "");
  const zeilen = text
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z && !/AUSVERKAUFT/i.test(z));
  if (zeilen.length < 2) return null;

  let titel = ohneEmoji(zeilen[0].replace(ERWAEHNUNG, "")).replace(/\*\*/g, "").trim();
  let gewinnGefunden = false;
  let ekK: number[] = [];
  let vkK: number[] = [];
  let gewK: number[] = [];
  let panK: number[] = [];
  let ekCent = 0;
  let ekNotiz: string | null = null;
  let ekNetto = false;
  let marge = 0;
  let zielmarkt = "";
  let verkaeufe: number | null = null;
  let maxMenge: number | null = null;
  let lieferant: string | null = null;
  const shopLinks: { url: string; name: string | null }[] = [];
  let alleLinks: string[] = [];

  zeilen.forEach((z, i) => {
    const klein = z.toLowerCase();
    const links = linksAus(z);
    alleLinks.push(...links);
    if (i === 0) return;
    if (/pan[- ]?eu/.test(klein)) {
      const k = betragKandidaten(z);
      if (k.length) panK = k;
    } else if (klein.includes("gewinn") || klein.includes("profit")) {
      const k = betragKandidaten(z);
      if (k.length && !gewinnGefunden) {
        gewK = k;
        gewinnGefunden = true;
        marge = prozentAus(z);
      }
    } else if (klein.includes("ek:") || klein.startsWith("ek ") || klein.includes("einkauf:")) {
      const k = betragKandidaten(z);
      if (k.length) {
        ekK = k;
        ekCent = k[0];
        const nach = z.slice(z.indexOf(":") + 1);
        const loc = ZAHL.exec(nach);
        ekNotiz = (loc ? nach.slice((loc.index ?? 0) + loc[0].length) : nach).trim().replace(/^[€\s]+/, "").trim() || null;
        ekNetto = klein.includes("netto");
      }
    } else if (klein.includes("vk:") || klein.includes("verkauf:")) {
      const k = betragKandidaten(z);
      if (k.length) vkK = k;
      const t = AMAZON_TEXT.exec(z);
      if (t) zielmarkt = marktCode(t[1]);
      for (const l of links) {
        try {
          const h = AMAZON_HOST.exec(new URL(l).hostname);
          if (h && !zielmarkt) zielmarkt = marktCode(h[1]);
        } catch {
          /* kein gültiger Link */
        }
      }
      // Der Verkaufslink zuerst, wenn die ASIN gesucht wird.
      alleLinks = [...links, ...alleLinks];
    } else if (SALES.test(z)) {
      const m = SALES.exec(z);
      if (m) verkaeufe = Number(m[1].replace(/\./g, "")) || null;
    } else if (klein.includes("max") && klein.includes("stück")) {
      const m = MENGE.exec(z);
      if (m) maxMenge = Number(m[1]) || null;
    } else if (/arbitrageone|profitpath|keepa/.test(klein)) {
      /* Werkzeug-Links, kein Shop */
    } else if (ekCent === 0 && links.length) {
      // Linkzeilen vor dem EK sind die Einkaufsquellen.
      for (const m of z.matchAll(LINK)) shopLinks.push({ url: m[2] || m[3], name: m[1] || null });
    } else if (ekCent === 0 && !lieferant && !links.length && i === 1) {
      lieferant = ohneEmoji(z).trim() || null;
    }
  });
  if (!titel || !gewinnGefunden) return null;

  // Lesart wählen, die zusammenpasst: Gewinn je Stück nie größer als der VK.
  const vkCent = vkK[0] ?? 0;
  const passt = (c: number) => (vkCent > 0 ? Math.abs(c) <= vkCent : Math.abs(c) <= 1_000_000);
  const gewinnCent = gewK.find(passt);
  if (gewinnCent === undefined) return null;
  const panCent = panK.length ? (panK.find(passt) ?? null) : null;
  const ek = ekK.find((c) => vkCent === 0 || c <= 3 * vkCent) ?? (ekCent || null);

  let asin: string | null = null;
  let asinUnsicher = false;
  for (const l of alleLinks) {
    const m = ASIN_LINK.exec(l);
    if (m) {
      asin = m[1].toUpperCase();
      break;
    }
  }
  if (!asin) {
    const m = ASIN_FREI.exec(text);
    if (m) {
      asin = m[1];
      asinUnsicher = true;
    }
  }
  const ohneAsin = titel.replace(new RegExp(ASIN_FREI.source, "g"), "").split(/\s+/).filter(Boolean).join(" ");
  if (ohneAsin) titel = ohneAsin;

  let quellmarkt = "DE";
  let shop: string | null = null;
  let shopUrl: string | null = null;
  if (shopLinks.length) {
    lieferant = null;
    try {
      const u = new URL(shopLinks[0].url);
      const host = u.hostname.toLowerCase();
      const h = AMAZON_HOST.exec(host);
      if (h) {
        quellmarkt = marktCode(h[1]);
        shop = `Amazon.${h[1].toUpperCase()}`;
      } else {
        shopUrl = shopLinks[0].url;
        quellmarkt = landAusHost(host);
        shop = (shopLinks[0].name && !/^https?:/i.test(shopLinks[0].name) ? shopLinks[0].name : host.replace(/^www\./, "")).slice(0, 80);
      }
    } catch {
      /* kein gültiger Link */
    }
  }
  if (!shop && lieferant) shop = (lieferant as string).slice(0, 80);

  return {
    titel: titel.slice(0, 300),
    asin,
    asinUnsicher,
    quellmarkt,
    zielmarkt: zielmarkt || "DE",
    shop,
    shopUrl,
    lieferant,
    ekEur: ek !== null ? ek / 100 : null,
    ekNetto,
    ekNotiz,
    vkEur: vkCent ? vkCent / 100 : null,
    verkaeufeMonat: verkaeufe,
    gewinnEur: gewinnCent / 100,
    margeProzent: margeNach(marge, gewinnCent, vkCent),
    panEuGewinnEur: panCent !== null ? panCent / 100 : null,
    maxMenge,
    ausverkauft,
  };
}

// ---- Reaktionen ------------------------------------------------------------------------------------------------

export type DiscordReaktion = { emoji?: { id?: string | null; name?: string | null }; count?: number; me?: boolean };

/** Reaktionen als Anzahl je Emoji (Server-Emojis mit Namen). Eigene Reaktion des Bots zählt nicht mit. */
export function reaktionenZaehlen(liste: DiscordReaktion[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of liste ?? []) {
    const name = r.emoji?.name;
    if (!name) continue;
    const n = Math.max(0, (r.count ?? 0) - (r.me ? 1 : 0));
    if (n) out[name] = (out[name] ?? 0) + n;
  }
  return out;
}

export const EMOJI_GEKAUFT = ["✅", "✔️", "☑️", "🛒"];
export const EMOJI_WEG = ["❌", "🚫", "⛔"];

/** Käufe (✅) und „nicht mehr verfügbar“ (❌) aus den Reaktionen – eigene Emojis aus den Einstellungen zusätzlich. */
export function kaeufeAus(r: Record<string, number>, o: { gekauft?: string[]; weg?: string[] } = {}) {
  const sum = (namen: string[]) => namen.reduce((s, n) => s + (r[n] ?? 0), 0);
  return { kaeufe: sum([...EMOJI_GEKAUFT, ...(o.gekauft ?? [])]), nichtVerfuegbar: sum([...EMOJI_WEG, ...(o.weg ?? [])]), summe: Object.values(r).reduce((s, n) => s + n, 0) };
}

/** Link zur Discord-Nachricht. */
export const nachrichtLink = (guildId: string | null | undefined, kanalId: string, nachrichtId: string) => (guildId ? `https://discord.com/channels/${guildId}/${kanalId}/${nachrichtId}` : null);

/** Zeitpunkt aus einer Discord-ID (Snowflake) – falls die Nachricht keinen Zeitstempel mitbringt. */
export const zeitAusId = (id: string) => new Date(Number((BigInt(id) >> 22n) + 1420070400000n));

/** Wie oft die Reaktionen nachgezogen werden: in den ersten 48 Std. alle 5 Min., bis 30 Tage stündlich, danach nicht. */
export function reaktionenFaellig(gepostet: Date, zuletzt: Date | null, jetzt: Date): boolean {
  const alter = jetzt.getTime() - gepostet.getTime();
  if (alter > 30 * 86_400_000) return false;
  const abstand = alter <= 48 * 3600_000 ? 5 * 60_000 : 3600_000;
  return !zuletzt || jetzt.getTime() - zuletzt.getTime() >= abstand - 15_000;
}

/** Schlüssel zum Zusammenfassen doppelter Deals: gleiche ASIN + gleicher Shop innerhalb von 24 Std. */
export const dublettenSchluessel = (p: Pick<LugruPost, "asin" | "shop">) => (p.asin ? `${p.asin}|${(p.shop ?? "").toLowerCase()}` : null);
