// E-Mail-Adresse einer Firma finden – reine Logik (HTML → Adressen, Bewertung), ohne Netz.
// Grundlage: Deutsche Firmen müssen im Impressum eine E-Mail nennen (§ 5 DDG). Adressen
// sind oft verschleiert: „info [at] firma [dot] de“, HTML-Codes, Cloudflare-Schutz.

import { validEmail } from "./logic";

export type FoundEmail = { email: string; how: string; page: string };

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", commat: "@", period: ".", "#64": "@", "#46": "." };
const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITY[n.toLowerCase()] ?? m);

/** Cloudflare „Email Address Obfuscation“: erstes Byte ist der Schlüssel, Rest XOR. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Bilddateien („logo@2x.png“), Platzhalter und Dienstleister-Adressen sind keine Kontakt-Adressen. */
const JUNK = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example\.(com|org)|domain\.(com|de)|email\.(com|de)|ihre-?domain|yourdomain|sentry|wixpress|.*\.sentry\.io)/i;

const clean = (e: string) => e.trim().replace(/^mailto:/i, "").split("?")[0].replace(/[.,;:)]+$/, "").toLowerCase();

/** Alle E-Mail-Adressen einer Seite – auch verschleierte. */
export function extractEmails(html: string, page: string): FoundEmail[] {
  const out = new Map<string, FoundEmail>();
  const add = (raw: string | null | undefined, how: string) => {
    if (!raw) return;
    const e = clean(decodeURIComponent(raw.replace(/%(?![0-9a-f]{2})/gi, "%25")));
    if (validEmail(e) && !JUNK.test(e) && e.length <= 80 && !out.has(e)) out.set(e, { email: e, how, page });
  };
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) add(decodeCfEmail(m[1]), "Cloudflare-geschützt");
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) add(decodeCfEmail(m[1]), "Cloudflare-geschützt");
  const decoded = decodeEntities(html);
  for (const m of decoded.matchAll(/mailto:([^"'<>\s]+)/gi)) add(m[1], "Link");
  for (const m of decoded.matchAll(/"email"\s*:\s*"([^"]+)"/gi)) add(m[1], "Strukturdaten");
  // Sichtbarer Text (Tags raus), dann normale und verschleierte Schreibweisen.
  const text = decoded.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) add(m[0], "Text");
  const AT = String.raw`\s*(?:\[\s*(?:at|ät|@)\s*\]|\(\s*(?:at|ät|@)\s*\)|\{\s*at\s*\}|\s(?:at|ät)\s|\s@\s)\s*`;
  const DOT = String.raw`\s*(?:\[\s*(?:dot|punkt|\.)\s*\]|\(\s*(?:dot|punkt|\.)\s*\)|\{\s*dot\s*\}|\s(?:dot|punkt)\s|\.)\s*`;
  const obf = new RegExp(String.raw`([a-z0-9._%+-]+)${AT}([a-z0-9-]+(?:${DOT}[a-z0-9-]+)*)${DOT}([a-z]{2,10})\b`, "gi");
  for (const m of text.matchAll(obf)) {
    const domain = m[2].replace(new RegExp(DOT, "gi"), ".");
    add(`${m[1]}@${domain}.${m[3]}`, "verschleiert");
  }
  return [...out.values()];
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const baseDomain = (h: string) => h.split(".").slice(-2).join(".");

/** Je höher, desto besser für eine Einkaufsanfrage; negativ = nicht verwenden. */
export function rankEmail(f: FoundEmail, siteUrl: string | null): number {
  const [local, domain] = f.email.split("@");
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|webmaster|hostmaster)$/.test(local)) return -100;
  if (/datenschutz|privacy|dsb|dpo|gdpr|dsgvo|jobs?|karriere|career|bewerbung|recruit|presse|press|media|newsletter|unsubscribe|compliance|legal|rechnung|invoice|buchhaltung|accounting/.test(local)) return -20;
  let score = 0;
  const site = siteUrl ? host(siteUrl) : "";
  if (site && (domain === site || baseDomain(domain) === baseDomain(site))) score += 50;
  if (/einkauf|purchas|procure|b2b|haendler|händler|handel|wholesale|grosshandel|großhandel|trade|vertrieb|sales|verkauf|order|bestell|reseller|partner/.test(local)) score += 30;
  else if (/^(info|kontakt|contact|office|mail|hallo|hello|service|kundenservice|shop|team|zentrale|post)$/.test(local)) score += 20;
  else if (/^[a-z]+([.-][a-z]+)?$/.test(local)) score += 10;
  if (/impressum|imprint|legal|kontakt|contact/i.test(f.page)) score += 10;
  if (f.how === "Link") score += 3;
  return score;
}

export function bestEmail(found: FoundEmail[], siteUrl: string | null): FoundEmail | null {
  const ranked = found.map((f) => ({ f, s: rankEmail(f, siteUrl) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
  return ranked[0]?.f ?? null;
}

/** „AllesfurHaare.DE Dresden GmbH“ → allesfurhaare.de */
export function domainFromName(name: string): string | null {
  const m = /\b([a-z0-9][a-z0-9-]{1,62}\.(?:de|com|eu|at|ch|net|shop|store|nl|it|fr|es|pl|co\.uk|info|biz|online))\b/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

/** Links zu Impressum, Kontakt, B2B/Händler auf derselben Website – die wichtigsten zuerst. */
export function contactLinks(html: string, pageUrl: string): string[] {
  const site = host(pageUrl);
  const found: { url: string; w: number }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().toLowerCase();
    let url: string;
    try {
      url = new URL(decodeEntities(m[1]), pageUrl).toString().split("#")[0];
    } catch {
      continue;
    }
    if (host(url) !== site || /^mailto:|^tel:/i.test(url)) continue;
    const hay = `${label} ${url.toLowerCase()}`;
    const w = /impressum|imprint|legal[-_ ]?notice|anbieterkennzeichnung/.test(hay) ? 3 : /kontakt|contact/.test(hay) ? 2 : /haendler|händler|b2b|wholesale|grosshandel|großhandel|reseller|ueber-uns|über uns|about/.test(hay) ? 1 : 0;
    if (w) found.push({ url, w });
  }
  return [...new Map(found.sort((a, b) => b.w - a.w).map((f) => [f.url, f])).keys()].slice(0, 6);
}

/** Übliche Pfade, falls die Startseite keine Links verrät (z. B. per JavaScript gebaut). */
export const FALLBACK_PATHS = ["/impressum", "/kontakt", "/impressum.html", "/kontakt.html", "/imprint", "/contact", "/pages/impressum", "/pages/contact", "/legal-notice"];
