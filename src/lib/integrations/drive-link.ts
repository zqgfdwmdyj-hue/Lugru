// Öffentliche Drive-Ordner: Link zerlegen und die eingebettete Ordneransicht lesen (ohne Server-Abhängigkeiten).

/** Ordner-ID aus einem Freigabelink (…/drive/folders/<ID>?usp=sharing, …?id=<ID>) oder die ID selbst. */
export function folderIdFromLink(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) ?? s.match(/[?&]id=([\w-]{10,})/) ?? s.match(/^([\w-]{19,})$/);
  return m ? m[1] : null;
}

export type PublicEntry = { id: string; name: string; folder: boolean; modified: string | null };

const unescapeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Liest die Einträge der eingebetteten Ordneransicht (drive.google.com/embeddedfolderview). */
export function parseEmbeddedFolder(html: string): PublicEntry[] {
  const out: PublicEntry[] = [];
  const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]*)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>(?:[\s\S]*?flip-entry-last-modified"><div>([^<]*)<\/div>)?/g;
  for (const m of html.matchAll(re)) {
    out.push({ id: m[1], name: unescapeHtml(m[3].trim()), folder: m[2].includes("/folders/"), modified: m[4]?.trim() || null });
  }
  return out;
}

