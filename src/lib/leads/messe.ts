// Messe-Ausstellerverzeichnisse auslesen – reine Logik (HTML/Text → Aussteller), ohne Netz.
// IAW (Köln, Aktionswaren-Ordermesse) hat ein festes Format und wird ohne KI gelesen; andere
// Verzeichnisse liefern Text + Links, die die KI in eine Ausstellerliste übersetzt.

import { countryName, validEmail } from "./logic";

export type Exhibitor = {
  name: string;
  booth: string | null;
  country: string | null;
  city: string | null;
  zip: string | null;
  street: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  categories: string[];
  description: string | null;
  detailUrl: string | null;
};

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

/** HTML → Textzeilen (Skripte/Styles raus). */
export function htmlLines(html: string): string[] {
  return decode(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td|th|dt|dd|a)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const empty = (name: string): Exhibitor => ({ name, booth: null, country: null, city: null, zip: null, street: null, website: null, email: null, phone: null, categories: [], description: null, detailUrl: null });

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** Webadresse normalisieren („www.x.de“ → https://www.x.de/). */
export function normUrl(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const explicit = /^https?:\/\//i.test(s);
    const u = new URL(explicit ? s : `https://${s}`);
    // Ohne http(s):// muss es nach einer Domain aussehen („kein“ ist kein Link).
    return explicit || u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---- IAW --------------------------------------------------------------------------------------

export const isIawDirectory = (html: string) => /av_AusstellerBlock_Aussteller/.test(html);

/** Liste (Blockansicht): Name, Halle/Stand, Link zur Detailseite. */
export function parseIawList(html: string, pageUrl: string): Exhibitor[] {
  const out: Exhibitor[] = [];
  const re = /<a[^>]+href="([^"]*av_detail=[^"]+)"[^>]*class="av_AusstellerBlock_Aussteller"[\s\S]*?<\/a>/g;
  for (const m of html.matchAll(re)) {
    const block = m[0];
    const name = decode(/<h4>([\s\S]*?)<\/h4>/.exec(block)?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const booth = decode(/av_AusstellerStandBlock">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? "").replace(/\s+/g, " ").trim() || null;
    const e = empty(name);
    e.booth = booth;
    e.detailUrl = new URL(decode(m[1]), pageUrl).toString();
    out.push(e);
  }
  return out;
}

/** Seitenzahlen der Liste (…?av_page=N). */
export function iawPageUrls(html: string, pageUrl: string): string[] {
  const nums = new Set<number>();
  for (const m of html.matchAll(/[?&]av_page=(\d+)/g)) nums.add(Number(m[1]));
  const base = new URL(pageUrl);
  return [...nums]
    .filter((n) => n > 1)
    .sort((a, b) => a - b)
    .map((n) => {
      const u = new URL(base.toString());
      u.hash = "";
      u.searchParams.set("av_page", String(n));
      return u.toString();
    });
}

/** Messe-Name aus dem Seitentitel („Aussteller | JS-Messe 2027“ → „JS-Messe 2027“) – Bindestriche im Namen bleiben. */
export function fairFromTitle(title: string | null | undefined): string {
  const parts = (title ?? "").split(/\s+[|–—-]\s+|\|/).map((x) => x.trim()).filter(Boolean);
  return parts.filter((p) => !/^(aussteller(verzeichnis|liste)?|exhibitors?( list| directory)?)$/i.test(p)).slice(-1)[0] ?? "";
}

/** Name der Messe aus der Auswahl („Herbst 2026“). */
export function iawFairName(html: string): string {
  const val = /getElementById\("selectMesse"\)\.value="(\d+)"/.exec(html)?.[1];
  const label = val ? new RegExp(`<option value="${val}"[^>]*>([^<]+)</option>`).exec(html)?.[1] : null;
  return `IAW ${label ? decode(label).trim() : ""}`.trim();
}

/** Detailseite: Name, Stand, Beschreibung, Kategorien, Anschrift, Web, Telefon, Kontakt-E-Mail. */
export function parseIawDetail(html: string): Partial<Exhibitor> {
  const detail = /<div class="av_Detail">([\s\S]*)/.exec(html)?.[1];
  if (!detail) return {};
  const text = (h: string | undefined) => (h ? decode(h.replace(/<span class="pipe"><\/span>/g, ", ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "");
  const name = text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(detail)?.[1]) || undefined;
  const booth = text(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(detail)?.[1]) || null;
  const description = text(/<div class="text[^"]*">([\s\S]*?)<\/div>/.exec(detail)?.[1]).slice(0, 400) || null;
  const categories = [...detail.matchAll(/<span class="ico_desc">([\s\S]*?)<\/span>/g)].map((m) => text(m[1])).filter(Boolean);
  const contact = /<div class="contact_details[^"]*">([\s\S]*?)(?:<h4|<form|$)/.exec(detail)?.[1] ?? "";
  const website = normUrl(/Web:\s*<a[^>]+href="([^"]+)"/.exec(contact)?.[1] ?? /Web:\s*([^<\s]+)/.exec(contact)?.[1]);
  const phone = text(/Telefon:\s*([^<]+)/.exec(contact)?.[1]) || null;
  const mail = decode(/name="mailto"\s+value="([^"]+)"/.exec(detail)?.[1] ?? /data-p1="([^"]+@[^"]+)"/.exec(detail)?.[1] ?? "").trim();
  // Anschrift: Zeilen vor „Web:“/„Telefon:“, letzte Zeile „PLZ Ort, LAND“.
  const addrHtml = contact.replace(/^[\s\S]*?<\/h2>/, "").split(/<p>|Web:|Telefon:/)[0];
  const addr = addrHtml.split(/<br\s*\/?>/i).map((l) => text(l)).filter(Boolean);
  let street: string | null = null;
  let zip: string | null = null;
  let city: string | null = null;
  let country: string | null = null;
  const last = addr[addr.length - 1];
  const m = last ? /^(?:\.\s*)?(?:([A-Z]{0,2}-?\d[\dA-Z-]{2,8}(?: [A-Z]{2})?)\s+)?(.+?),\s*([^,]+?)\s*$/.exec(last) : null;
  if (m) {
    zip = m[1]?.trim() || null;
    city = m[2].trim();
    country = countryName(titleCase(m[3].trim()));
    street = addr.slice(0, -1).join(", ") || null;
  } else if (addr.length) {
    street = addr.join(", ");
  }
  return { name, booth, description, categories, website, phone, email: validEmail(mail) ? mail.toLowerCase() : null, street, zip, city, country };
}

// ---- Andere Verzeichnisse (KI) ---------------------------------------------------------------

export function exhibitorPrompt(fair: string, text: string, links: { t: string; h: string }[]): string {
  return [
    `Hier ist der Text einer Aussteller-Liste der Messe „${fair}“ (aus einem Online-Ausstellerverzeichnis kopiert). Lies alle ausstellenden Firmen heraus.`,
    "Regeln: Nur Aussteller (keine Navigation, Werbung, Sponsoren-Logos ohne Firma, Messeveranstalter, Kategorien). Nichts erfinden – fehlende Angaben null.",
    "Stand/Halle, Land, Ort, Website, E-Mail, Telefon und Produktkategorien nur, wenn sie im Text stehen. detailUrl: passender Link aus der Linkliste (Detailseite des Ausstellers), sonst null.",
    'Antworte NUR mit JSON: {"exhibitors":[{"name":"…","booth":"Halle 6, Stand B 23","country":"DE","city":"…","website":"…","email":"…","phone":"…","categories":["…"],"detailUrl":"…"}]}',
    "",
    "TEXT:",
    text,
    "",
    "LINKS (Text → Adresse):",
    links.map((l) => `${l.t} → ${l.h}`).join("\n"),
  ].join("\n");
}

const s = (v: unknown, max = 200) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, max) : null);

export function parseExhibitorJson(text: string): Exhibitor[] {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  let o: { exhibitors?: unknown };
  try {
    o = JSON.parse(text.slice(a, b + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(o.exhibitors)) return [];
  return o.exhibitors.flatMap((x) => {
    const r = x as Record<string, unknown>;
    const name = s(r.name, 200);
    if (!name || name.length < 2) return [];
    const email = s(r.email);
    return [{
      ...empty(name),
      booth: s(r.booth, 80),
      country: countryName(s(r.country, 60)),
      city: s(r.city, 80),
      website: normUrl(s(r.website, 300)),
      email: validEmail(email) ? email.toLowerCase() : null,
      phone: s(r.phone, 60),
      categories: Array.isArray(r.categories) ? r.categories.map((c) => s(c, 60)).filter((c): c is string => Boolean(c)).slice(0, 12) : [],
      detailUrl: normUrl(s(r.detailUrl, 500)),
    }];
  });
}

/** Text in Stücke für die KI teilen – an Zeilengrenzen. */
export function chunkText(text: string, size = 24_000): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > size && cur) {
      out.push(cur);
      cur = "";
    }
    cur += `${line}\n`;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export type MessePayload = { url: string | null; title: string; text: string; links: { t: string; h: string }[] };

/** Daten vom Messe-Lesezeichen prüfen. */
export function parseMessePayload(raw: string): MessePayload | null {
  try {
    const o = JSON.parse(raw.trim()) as Record<string, unknown>;
    if (o.messeImport !== 1 || typeof o.text !== "string" || o.text.trim().length < 20) return null;
    const links = Array.isArray(o.links)
      ? o.links
          .flatMap((l) => {
            const r = l as Record<string, unknown>;
            return typeof r.t === "string" && typeof r.h === "string" && /^https?:\/\//.test(r.h) ? [{ t: r.t.slice(0, 120), h: r.h.slice(0, 500) }] : [];
          })
          .slice(0, 4000)
      : [];
    return { url: typeof o.url === "string" ? o.url.slice(0, 500) : null, title: typeof o.title === "string" ? o.title.slice(0, 160) : "", text: o.text.slice(0, 600_000), links };
  } catch {
    return null;
  }
}

/** Nur Aussteller aus passenden Kategorien (z. B. „Drogerie|Lebensmittel“) – ohne Kategorie-Angabe bleiben alle. */
export function matchesCategories(e: Pick<Exhibitor, "categories" | "description">, filter: string): boolean {
  const words = filter.split(/[|,;]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return true;
  if (!e.categories.length && !e.description) return true;
  const hay = `${e.categories.join(" ")} ${e.description ?? ""}`.toLowerCase();
  return words.some((w) => hay.includes(w));
}
