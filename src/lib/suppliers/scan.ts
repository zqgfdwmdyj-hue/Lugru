// Lieferanten-Seiten und -Listen „scannen“: Produkte aus strukturierten Seitendaten (JSON-LD, Shopify),
// aus einer Browser-Erfassung (Lesezeichen) oder per KI aus Text/Foto/PDF. Ohne Server-Abhängigkeiten.

import { extractJsonArray } from "@/lib/brands/ai";

export type ScannedItem = {
  sku: string;
  title: string;
  ean: string | null;
  price: number | null;
  currency: string;
  pack: string | null;
  url: string | null;
  imageUrl: string | null;
  stock: number | null;
};

/** Browser-Erfassung aus dem Lesezeichen. */
export type Capture = {
  sellerCapture: 1;
  url: string;
  title?: string;
  jsonld?: unknown[];
  items?: { href: string; name?: string; text: string; img: string | null }[];
  text?: string;
};

// ---- Kennungen, Preise ------------------------------------------------------------------------

/** EAN-13 aus UPC-12/EAN-8/13/GTIN-14; sonst null. US-Süßigkeiten tragen meist UPC-12 → „0“ davor. */
export function normalizeEan(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12) return `0${d}`;
  if (d.length === 14 && d.startsWith("0")) return d.slice(1);
  if (d.length === 8 || d.length === 13 || d.length === 14) return d;
  return null;
}

export function currencyOf(text: string, fallback = "USD"): string {
  if (/€|\bEUR\b/i.test(text)) return "EUR";
  if (/£|\bGBP\b/i.test(text)) return "GBP";
  if (/\$|\bUSD\b/i.test(text)) return "USD";
  return fallback;
}

const PRICE_RE = /(?:\$|€|£|USD|EUR)\s?(\d{1,5}(?:[.,]\d{3})*[.,]\d{2})|(\d{1,5}(?:[.,]\d{3})*[.,]\d{2})\s?(?:\$|€|£|USD|EUR)/i;

export function priceOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  let s = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lc = s.lastIndexOf(",");
  const ld = s.lastIndexOf(".");
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc > -1) s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}

export type PackInfo = {
  /** Verkaufseinheiten je Karton/Lieferung (EK gilt für den ganzen Karton). */
  caseQty: number;
  /** Inhalt einer Verkaufseinheit (z. B. 5 Riegel im „5 Pack“) – nur Info. */
  inner: number | null;
  /** Größe einer Einheit, z. B. „9g“. */
  unitSize: string | null;
};

/**
 * Kartongröße aus Titel/Link lesen. „(24 x 9g)“, „box of 24“, „case-of-12“, „24ct“ = 24 Einheiten im Karton;
 * „5 Pack“ / „60 Pack (936g)“ = Inhalt einer Einheit (der Karton hat dann 1 Einheit, falls sonst nichts dasteht).
 */
export function packInfo(title: string, url?: string | null): PackInfo {
  const slug = url ? decodeURIComponent(url.split("?")[0].split("/").pop() ?? "").replace(/-/g, " ") : "";
  const text = `${title} ${slug}`;
  const times = title.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?\s?(?:g|kg|ml|l|oz|cl))\b/i);
  const caseOf = text.match(/\b(?:box|case|pack|karton|packung) of (\d+)\b/i) ?? text.match(/\b(\d+)\s?(?:ct|count)\b/i) ?? text.match(/\b(\d+)\s?(?:stk|stück)\b/i);
  const inner = title.match(/\b(\d+)\s?(?:pack|pk|er[- ]?pack|pcs|pieces)\b/i);
  const size = times?.[2] ?? title.match(/\((\d+(?:[.,]\d+)?\s?(?:g|kg|ml|l|oz))\)/i)?.[1] ?? null;
  const n = Number(times?.[1] ?? caseOf?.[1] ?? 1);
  return { caseQty: n > 0 && n < 10000 ? n : 1, inner: inner ? Number(inner[1]) : null, unitSize: size ? size.replace(/\s/g, "") : null };
}

/** Kurztext für die Spalte „pack“: „24 × 9g“, „Karton 18 · je 5er-Pack“. */
export function packOf(title: string, url?: string | null): string | null {
  const p = packInfo(title, url);
  if (p.caseQty <= 1 && !p.inner) return null;
  const parts = [p.caseQty > 1 ? (p.unitSize ? `${p.caseQty} × ${p.unitSize}` : `${p.caseQty} Einheiten`) : null, p.inner ? `je ${p.inner}er-Pack` : null].filter(Boolean);
  return parts.join(" · ");
}

/** Suchbegriff für amazon.de: ohne Karton-/Größenangaben. */
export function searchTerm(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*[-–|]\s*\d+\s?(ct|count|pack|pk)\b.*$/i, "")
    .replace(/\b(box|case|pack) of \d+\b/gi, "")
    .replace(/\b\d+(\.\d+)?\s?(oz|g|ml)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Stabile Lieferanten-Artikelnummer: eigene Nummer, sonst EAN, sonst Pfad der Produktseite, sonst Titel. */
export function skuFor(i: { sku?: string | null; ean?: string | null; url?: string | null; title: string }): string {
  const own = String(i.sku ?? "").trim();
  if (own) return own.slice(0, 80);
  if (i.ean) return i.ean;
  if (i.url) {
    try {
      const last = new URL(i.url).pathname.split("/").filter(Boolean).pop();
      if (last) return slug(decodeURIComponent(last));
    } catch {
      /* kein gültiger Link */
    }
  }
  return slug(i.title) || "artikel";
}

function absolute(href: unknown, base: string | undefined): string | null {
  if (typeof href !== "string" || !href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function item(p: Omit<Partial<ScannedItem>, "ean"> & { title: string; ean?: unknown }, fallbackCurrency: string): ScannedItem {
  const title = p.title.replace(/\s+/g, " ").trim().slice(0, 300);
  const ean = normalizeEan(p.ean);
  return {
    sku: skuFor({ sku: p.sku, ean, url: p.url, title }),
    title,
    ean,
    price: p.price ?? null,
    currency: p.currency || fallbackCurrency,
    pack: p.pack ?? packOf(title, p.url),
    url: p.url ?? null,
    imageUrl: p.imageUrl ?? null,
    stock: p.stock ?? null,
  };
}

/** Doppelte (gleiche Artikelnummer) zusammenfassen – die Variante mit mehr Angaben gewinnt. */
export function dedupe(items: ScannedItem[]): ScannedItem[] {
  const score = (i: ScannedItem) => Number(Boolean(i.ean)) * 4 + Number(i.price !== null) * 2 + Number(Boolean(i.imageUrl));
  const map = new Map<string, ScannedItem>();
  for (const i of items) {
    const prev = map.get(i.sku);
    if (!prev || score(i) > score(prev)) map.set(i.sku, i);
  }
  return [...map.values()];
}

// ---- Strukturierte Seitendaten -----------------------------------------------------------------

type Obj = Record<string, unknown>;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isType = (o: Obj, t: string) => asArr(o["@type"]).some((x) => String(x).toLowerCase() === t.toLowerCase());

/** Produkte aus JSON-LD (Product, ProductGroup, ItemList, @graph). */
export function fromJsonLd(blocks: unknown[], baseUrl?: string): ScannedItem[] {
  const out: ScannedItem[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const o = node as Obj;
    if (isType(o, "Product")) {
      const offer = asArr(o.offers).flatMap((x) => (x && typeof x === "object" && isType(x as Obj, "AggregateOffer") ? [x, ...asArr((x as Obj).offers)] : [x]))[0] as Obj | undefined;
      const title = String(o.name ?? "").trim();
      if (title) {
        const img = asArr(o.image)[0];
        const avail = String(offer?.availability ?? "");
        out.push(
          item(
            {
              title,
              sku: typeof o.sku === "string" ? o.sku : typeof o.mpn === "string" ? o.mpn : undefined,
              ean: o.gtin13 ?? o.gtin12 ?? o.gtin14 ?? o.gtin8 ?? o.gtin ?? null,
              price: priceOf(offer?.price ?? offer?.lowPrice),
              currency: typeof offer?.priceCurrency === "string" ? offer.priceCurrency.toUpperCase() : undefined,
              url: absolute(o.url ?? offer?.url, baseUrl),
              imageUrl: absolute(typeof img === "object" && img ? (img as Obj).url : img, baseUrl),
              stock: /OutOfStock|SoldOut/i.test(avail) ? 0 : null,
            } as Partial<ScannedItem> & { title: string },
            "USD",
          ),
        );
      }
      asArr(o.hasVariant).forEach((v) => visit(v, depth + 1));
      return;
    }
    for (const key of ["@graph", "itemListElement", "item", "mainEntity"]) if (o[key]) visit(o[key], depth + 1);
  };
  blocks.forEach((b) => visit(b, 0));
  return out;
}

/** Shopify-Shops liefern unter /products.json alle Artikel mit Barcode – ohne HTML zu lesen. */
export function fromShopify(json: unknown, origin: string): ScannedItem[] {
  const products = ((json as { products?: Obj[] })?.products ?? []) as Obj[];
  return products.flatMap((p) => {
    const variants = asArr(p.variants) as Obj[];
    const img = (asArr(p.images)[0] as Obj | undefined)?.src;
    return variants.map((v) => {
      const vt = String(v.title ?? "");
      const title = `${p.title}${vt && vt !== "Default Title" ? ` – ${vt}` : ""}`;
      return item({ title, sku: typeof v.sku === "string" ? v.sku : undefined, ean: v.barcode, price: priceOf(v.price), url: `${origin}/products/${p.handle}`, imageUrl: typeof img === "string" ? img : null, stock: v.available === false ? 0 : null }, "USD");
    });
  });
}

/** JSON-LD-Blöcke aus rohem HTML. */
export function jsonLdFromHtml(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* kaputtes JSON-LD überspringen */
    }
  }
  return out;
}

// ---- Browser-Erfassung (Lesezeichen) -----------------------------------------------------------

export function parseCapture(text: string): Capture | null {
  const t = text.trim();
  if (!t.startsWith("{") || !t.includes('"sellerCapture"')) return null;
  try {
    const c = JSON.parse(t) as Capture;
    return c.sellerCapture === 1 && typeof c.url === "string" ? c : null;
  } catch {
    return null;
  }
}

const NOISE = /^(add to (cart|bag)|in den warenkorb|quick (view|shop)|sale|new|sold out|ausverkauft|out of stock|in stock|choose options|select options|\d+ reviews?|★+|[-–|]|save \S+)$/i;

/** Produktkacheln der Erfassung ohne KI deuten: Preis per Muster, Titel = längster sinnvoller Textteil. */
export function fromCards(cards: NonNullable<Capture["items"]>, pageText = ""): ScannedItem[] {
  const fallback = currencyOf(pageText);
  return cards.flatMap((c) => {
    const m = c.text.match(PRICE_RE);
    if (!m) return [];
    const parts = c.text.split(/\s*\|\s*|\n/).map((s) => s.trim()).filter((s) => s && !NOISE.test(s) && !PRICE_RE.test(s) && !/^\$|^€/.test(s));
    const name = c.name?.trim();
    const title = name && name.length >= 3 && !PRICE_RE.test(name) ? name : parts.sort((a, b) => b.length - a.length)[0];
    if (!title || title.length < 3) return [];
    return [item({ title, price: priceOf(m[1] ?? m[2]), currency: currencyOf(m[0], fallback), url: c.href, imageUrl: c.img, stock: /sold out|out of stock|ausverkauft/i.test(c.text) ? 0 : null }, fallback)];
  });
}

/** Das Lesezeichen: sammelt auf der offenen Seite Produktkacheln, JSON-LD und Text und kopiert alles. */
export const BOOKMARKLET_SOURCE = `(()=>{const P=/(?:\\$|€|£|USD|EUR)\\s?\\d+[.,]\\d{2}|\\d+[.,]\\d{2}\\s?(?:\\$|€|£)/g;const seen=new Set(),items=[];
const hrefs=el=>new Set([...el.querySelectorAll('a[href]')].map(x=>x.href.split('#')[0])).size;
document.querySelectorAll('a[href]').forEach(a=>{const h=a.href.split('#')[0];if(seen.has(h)||!/^https?:/.test(h))return;let el=a;for(let i=0;i<7&&el;i++){const t=(el.innerText||'').trim();if(t.length>700)break;const n=(t.match(P)||[]).length;if(n>=2&&hrefs(el)>=2)break;if(n){const img=el.querySelector('img');const name=[...el.querySelectorAll('a[href]')].filter(x=>x.href.split('#')[0]===h).map(x=>(x.innerText||x.title||'').trim()).sort((x,y)=>y.length-x.length)[0]||'';seen.add(h);items.push({href:h,name:name.slice(0,300),text:t.replace(/\\s*\\n\\s*/g,' | ').slice(0,500),img:img?(img.currentSrc||img.src||null):null});return}el=el.parentElement}});
const ld=[...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>{try{return JSON.parse(s.textContent)}catch(e){return null}}).filter(Boolean);
const s=JSON.stringify({sellerCapture:1,url:location.href,title:document.title,jsonld:ld,items:items.slice(0,500),text:document.body.innerText.slice(0,60000)});
const ok=()=>alert('Seller-System: '+items.length+' Produkte erfasst und kopiert. Jetzt im Seller-System unter Lieferanten-Feeds einfügen.');
navigator.clipboard.writeText(s).then(ok,()=>{const t=document.createElement('textarea');t.value=s;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();ok()})})()`;

export const bookmarkletHref = () => `javascript:${encodeURIComponent(BOOKMARKLET_SOURCE.replace(/\n/g, ""))}`;

// ---- KI ---------------------------------------------------------------------------------------

export const SCAN_INSTRUCTIONS = [
  "Du liest eine Lieferanten-/Großhändler-Preisliste, Rechnung oder Shop-Seite und listest ALLE Produkte darin auf.",
  "Pro Produkt: sku (Artikelnummer des Lieferanten, falls sichtbar), title (vollständiger Produktname inkl. Größe/Gewicht), ean (UPC/EAN/Barcode, nur Ziffern, nur wenn sichtbar), price (Einkaufspreis je Verkaufseinheit als Zahl), currency (USD/EUR/GBP), pack (Inhalt der Verkaufseinheit, z. B. „24 Stk“ oder „Case of 12“), url (Produktlink, falls vorhanden), stock (Menge, falls angegeben; 0 wenn ausverkauft).",
  "Nichts erfinden: fehlende Angaben als null. Navigation, Werbung, Versandkosten und Summenzeilen weglassen.",
  'Antworte NUR mit einem JSON-Array: [{"sku":null,"title":"…","ean":null,"price":2.49,"currency":"USD","pack":null,"url":null,"stock":null}]',
].join("\n");

export function scanPromptForText(text: string, source?: string): string {
  return `${SCAN_INSTRUCTIONS}\n${source ? `Quelle: ${source}\n` : ""}\n--- INHALT ---\n${text}`;
}

export function parseScan(text: string, baseUrl?: string, fallbackCurrency = "USD"): ScannedItem[] {
  return extractJsonArray(text).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Obj;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!title) return [];
    const stock = typeof r.stock === "number" && r.stock >= 0 ? Math.round(r.stock) : null;
    return [
      item(
        {
          title,
          sku: typeof r.sku === "string" ? r.sku : typeof r.sku === "number" ? String(r.sku) : undefined,
          ean: r.ean ?? null,
          price: priceOf(r.price),
          currency: typeof r.currency === "string" && /^[A-Z]{3}$/i.test(r.currency) ? r.currency.toUpperCase() : undefined,
          pack: typeof r.pack === "string" && r.pack.trim() ? r.pack.trim().slice(0, 60) : undefined,
          url: absolute(r.url, baseUrl),
          stock,
        } as Partial<ScannedItem> & { title: string },
        fallbackCurrency,
      ),
    ];
  });
}

/** Langen Text in Stücke teilen (an Zeilengrenzen), damit die KI nichts abschneidet. */
export function chunkText(text: string, size = 25_000, max = 6): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest && out.length < max) {
    if (rest.length <= size) {
      out.push(rest);
      break;
    }
    const cut = rest.lastIndexOf("\n", size);
    const at = cut > size * 0.5 ? cut : size;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trim();
  }
  return out;
}

/** Umrechnen in EUR (Kurs = EUR je Fremdwährungseinheit). */
export function toEur(price: number | null, currency: string, rates: Record<string, number>): number | null {
  if (price === null) return null;
  if (currency === "EUR") return price;
  const r = rates[currency];
  return r ? Math.round(price * r * 100) / 100 : null;
}

/** EZB-Tageskurse (XML, „1 EUR = x Währung“) → EUR je Einheit der Fremdwährung. */
export function parseEcb(xml: string): Record<string, number> {
  const rates: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const perEur = Number(m[2]);
    if (perEur > 0) rates[m[1]] = Math.round((1 / perEur) * 1e6) / 1e6;
  }
  return rates;
}
