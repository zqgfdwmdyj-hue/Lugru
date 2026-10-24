// Texte für Instagram und TikTok aus den Daten einer Verteilung – ohne KI, sofort und kostenlos.

import { outputPrice } from "@/lib/layout";

export type SocialProduct = { name: string; variant: string | null; price: number | null; priceNote: string | null; unit?: string | null; unitCount?: number | null };
export type SocialEvent = { title: string; dateLabel: string; weekdayLong: string; eventTime: string | null; location: string | null };

const BASE_TAGS = ["foodsharing", "lebensmittelretten", "spenden", "nachhaltigkeit", "zerowaste", "rettenstattwegwerfen"];

/** „#musterstadt“ aus einem Ort; Umlaute bleiben, Leerzeichen und Sonderzeichen fallen weg. */
export function hashtag(text: string): string {
  const t = text.toLocaleLowerCase("de-DE").replace(/[^a-z0-9äöüß]+/g, "");
  return t ? `#${t}` : "";
}

/** Gleicher Preistext wie auf der Collage – aus der gemeinsamen Preislogik. */
export function priceLabel(p: SocialProduct): string {
  return outputPrice(p);
}

function productLine(p: SocialProduct): string {
  const name = [p.name, p.variant].filter(Boolean).join(" ");
  const price = priceLabel(p);
  return price ? `${name} – ${price}` : name;
}

/** Wann und wo, z. B. „Samstag, 12.10. um 11 Uhr in Musterstadt“. */
export function whenWhere(e: SocialEvent): string {
  const date = e.dateLabel.replace(/^\w+,\s*/, "").replace(/\d{4}$/, "").replace(/\.$/, ".");
  return `${e.weekdayLong}, ${date}${e.eventTime ? ` um ${e.eventTime}` : ""}${e.location ? ` in ${e.location}` : ""}`;
}

export function instagramCaption(e: SocialEvent, products: SocialProduct[], extraTags: string[] = [], maxList = 10): string {
  const shown = products.slice(0, maxList);
  const rest = products.length - shown.length;
  const tags = [...BASE_TAGS.map((t) => `#${t}`), ...(e.location ? [hashtag(e.location)] : []), ...extraTags.map(hashtag)].filter(Boolean);
  return [
    `🥫 ${e.title} – ${whenWhere(e)}!`,
    "",
    "Dank eurer Spenden können wir retten 💚 Diesmal unter anderem dabei:",
    ...shown.map((p) => `• ${productLine(p)}`),
    ...(rest > 0 ? [`…und ${rest} weitere Produkte.`] : []),
    "",
    "Alle Preise sind Spendenempfehlungen. Kommt vorbei und sagt es weiter!",
    "",
    [...new Set(tags)].join(" "),
  ].join("\n");
}

/** TikTok: kürzer, Hashtags direkt dahinter. */
export function tiktokCaption(e: SocialEvent, products: SocialProduct[], extraTags: string[] = []): string {
  const top = products.slice(0, 3).map((p) => p.name).join(", ");
  const tags = ["foodsharing", "lebensmittelretten", "spenden", "fyp", "nachhaltig"].map((t) => `#${t}`);
  if (e.location) tags.push(hashtag(e.location));
  tags.push(...extraTags.map(hashtag).filter(Boolean));
  return `${whenWhere(e)}: ${products.length} gerettete Produkte gegen kleine Spende 💚 ${top ? `u. a. ${top}` : ""}`.trim() + `\n${[...new Set(tags)].join(" ")}`;
}

/** Formate in der Social-Media-Ansicht – es wird immer nur eines angezeigt. */
export const SOCIAL_FORMATS = [
  { key: "story", label: "Instagram-Story", hint: "Ankündigung 9:16" },
  { key: "feed", label: "Feed-Beitrag", hint: "Titelbild 4:5" },
  { key: "karussell", label: "Karussell", hint: "ein Produkt pro Bild" },
  { key: "story-produkte", label: "Story-Serie", hint: "Highlights einzeln" },
  { key: "preisliste", label: "Preisliste als Bild", hint: "wie der Aushang" },
  { key: "video", label: "Video (Reel/TikTok)", hint: "9:16 ohne Ton" },
  { key: "texte", label: "Texte", hint: "Instagram & TikTok" },
] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number]["key"];
export const isSocialFormat = (v: unknown): v is SocialFormat => SOCIAL_FORMATS.some((f) => f.key === v);
