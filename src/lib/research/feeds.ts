// Nachrichten-Feeds lesen (RSS 2.0 und Atom) – für die Themen-Recherche der Wissensdatenbank.

import { find, findAll, parseXml, textOf, type XmlNode } from "@/lib/calendar/xml";

export type FeedItem = { title: string; link: string; published: string | null; source: string | null; snippet: string };

/** Google-News-Suche als RSS: Treffer der letzten `days` Tage, deutschsprachig. */
export function googleNewsUrl(topic: string, days: number): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${topic} when:${Math.max(1, Math.round(days))}d`)}&hl=de&gl=DE&ceid=DE:de`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

const child = (n: XmlNode, name: string) => n.children.find((c) => c.name === name);

export function parseFeed(xml: string): { title: string | null; items: FeedItem[] } {
  const root = parseXml(xml);
  const channel = find(root, "channel");
  const feed = find(root, "feed");
  const out: FeedItem[] = [];
  if (channel) {
    for (const it of findAll(channel, "item")) {
      const source = child(it, "source");
      let title = stripHtml(textOf(child(it, "title")));
      const src = source ? textOf(source) : null;
      // Google News hängt „ - Quelle" an den Titel.
      if (src && title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3));
      const date = textOf(child(it, "pubdate")) || textOf(child(it, "date"));
      const snippet = stripHtml(textOf(child(it, "description")));
      out.push({
        title,
        link: textOf(child(it, "link")) || textOf(child(it, "guid")),
        published: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
        source: src,
        // Bei Google News wiederholt die Beschreibung nur Titel und Quelle – dann weglassen.
        snippet: snippet.startsWith(title) ? "" : snippet.slice(0, 400),
      });
    }
    return { title: textOf(child(channel, "title")) || null, items: out.filter((i) => i.title && i.link) };
  }
  if (feed) {
    const feedTitle = textOf(child(feed, "title")) || null;
    for (const e of findAll(feed, "entry")) {
      const links = e.children.filter((c) => c.name === "link");
      const link = links.find((l) => !l.attrs?.rel || l.attrs.rel === "alternate")?.attrs?.href ?? links[0]?.attrs?.href ?? "";
      const date = textOf(child(e, "published")) || textOf(child(e, "updated"));
      out.push({
        title: stripHtml(textOf(child(e, "title"))),
        link,
        published: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
        source: feedTitle,
        snippet: stripHtml(textOf(child(e, "summary")) || textOf(child(e, "content"))).slice(0, 400),
      });
    }
    return { title: feedTitle, items: out.filter((i) => i.title && i.link) };
  }
  return { title: null, items: [] };
}

/** Vergleichsschlüssel für Dubletten: dieselbe Meldung erscheint oft bei mehreren Quellen. */
export function titleKey(title: string): string {
  return title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}
