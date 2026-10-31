// Call-Transkripte aus Discord sofort verarbeiten (B21) – reine Logik, getestet in tests/calls-live.test.ts:
// Was ist ein Transkript (Anhang, langer Text, Link), Titel/Datum/Sprecher, Link zur Nachricht, Abruf-Pläne.

import { googleDocLinks } from "./logic";

export const TRANSKRIPT_ENDUNGEN = [".txt", ".md", ".vtt", ".srt", ".json", ".docx", ".pdf", ".odt"] as const;
export const MAX_ANHANG_MB = 25;
/** Ab so vielen Zeichen gilt eine Nachricht selbst als Transkript. */
export const LANGER_TEXT = 2000;

export type DiscordAnhang = { id?: string; filename: string; size?: number | string; url?: string; content_type?: string };
export type DiscordNachricht = {
  id: string;
  channel_id?: string;
  guild_id?: string;
  content?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  attachments?: DiscordAnhang[];
  embeds?: { url?: string; title?: string; description?: string }[];
  author?: { id?: string; username?: string; bot?: boolean };
};

export type TranskriptLink = { art: "google_doc" | "notion" | "fireflies" | "tldv" | "otter"; url: string };
export type Kandidat = { anhaenge: DiscordAnhang[]; zuGross: DiscordAnhang[]; links: TranskriptLink[]; langerText: boolean };

const endung = (name: string) => (/\.[a-z0-9]{2,5}$/i.exec(name)?.[0] ?? "").toLowerCase();
const groesse = (a: DiscordAnhang) => Number(a.size ?? 0) || 0;

/** Transkript-Links: Google Doc, Notion, Fireflies, tl;dv, Otter. */
export function transkriptLinks(text: string): TranskriptLink[] {
  const out: TranskriptLink[] = googleDocLinks(text).map((id) => ({ art: "google_doc" as const, url: `https://docs.google.com/document/d/${id}/edit` }));
  const muster: [TranskriptLink["art"], RegExp][] = [
    ["notion", /https?:\/\/(?:www\.)?[\w-]*\.?notion\.(?:so|site)\/[^\s<>)"]+/gi],
    ["fireflies", /https?:\/\/app\.fireflies\.ai\/view\/[^\s<>)"]+/gi],
    ["tldv", /https?:\/\/(?:app\.)?tldv\.io\/app\/meetings\/[^\s<>)"]+/gi],
    ["otter", /https?:\/\/(?:www\.)?otter\.ai\/(?:u|s)\/[^\s<>)"]+/gi],
  ];
  for (const [art, re] of muster) for (const m of text.matchAll(re)) if (!out.some((o) => o.url === m[0])) out.push({ art, url: m[0] });
  return out;
}

/** Ist die Nachricht ein Call-Transkript? Mehrere Anhänge einer Nachricht = ein Call. null = nein. */
export function transkriptKandidat(m: DiscordNachricht): Kandidat | null {
  const dateien = (m.attachments ?? []).filter((a) => (TRANSKRIPT_ENDUNGEN as readonly string[]).includes(endung(a.filename)));
  const zuGross = dateien.filter((a) => groesse(a) > MAX_ANHANG_MB * 1024 * 1024);
  const text = [m.content ?? "", ...(m.embeds ?? []).flatMap((e) => [e.url ?? "", e.title ?? "", e.description ?? ""])].join("\n");
  const links = transkriptLinks(text);
  // Langer Text ohne Links (sonst wäre es nur eine Nachricht mit Link und etwas Text).
  const ohneLinks = (m.content ?? "").replace(/https?:\/\/\S+/g, "").trim();
  const langerText = ohneLinks.length > LANGER_TEXT;
  if (!dateien.length && !links.length && !langerText) return null;
  return { anhaenge: dateien.filter((a) => !zuGross.includes(a)), zuGross, links, langerText };
}

/** Titel aus der ersten Textzeile (ohne Links), sonst aus dem ersten Dateinamen. */
export function callTitelAus(m: DiscordNachricht): string | null {
  const zeile = (m.content ?? "").split("\n").map((z) => z.replace(/https?:\/\/\S+/g, "").trim()).find((z) => z.length >= 3);
  if (zeile && zeile.length <= 150) return zeile;
  const datei = m.attachments?.find((a) => (TRANSKRIPT_ENDUNGEN as readonly string[]).includes(endung(a.filename)));
  return datei ? datei.filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").trim() || null : null;
}

/** Sprecher aus Zeilen wie „Anna: …“ oder VTT „<v Anna>“ – nur Namen, die mindestens zweimal vorkommen. */
export function sprecherAus(text: string): string[] {
  const n = new Map<string, number>();
  for (const m of text.matchAll(/^(?:<v\s+([^>]{2,40})>|([A-ZÄÖÜ][\wÄÖÜäöüß.\- ]{1,30}?)\s*(?:\(\d{1,2}:\d{2}(?::\d{2})?\))?:\s)/gm)) {
    const name = (m[1] ?? m[2] ?? "").trim();
    if (!name || /^(WEBVTT|NOTE|Datum|Titel|Thema|Teilnehmer|http)/i.test(name)) continue;
    n.set(name, (n.get(name) ?? 0) + 1);
  }
  return [...n.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
}

/** JSON-Export (Fireflies, tl;dv …) → Text „Sprecher: Satz“; sonst alle Textfelder. */
export function jsonTranskriptText(roh: string): string {
  let d: unknown;
  try {
    d = JSON.parse(roh);
  } catch {
    return roh;
  }
  const saetze: string[] = [];
  const lauf = (v: unknown, tiefe = 0): void => {
    if (tiefe > 6 || v === null || v === undefined) return;
    if (Array.isArray(v)) {
      for (const x of v) lauf(x, tiefe + 1);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const satz = o.text ?? o.sentence ?? o.raw_text ?? o.content ?? o.transcript;
      const wer = o.speaker_name ?? o.speaker ?? o.name ?? (o.speaker as { name?: unknown } | undefined)?.name;
      if (typeof satz === "string" && satz.trim()) {
        saetze.push(typeof wer === "string" && wer.trim() ? `${wer.trim()}: ${satz.trim()}` : satz.trim());
        return;
      }
      for (const x of Object.values(o)) lauf(x, tiefe + 1);
      return;
    }
    if (typeof v === "string" && v.length > 200) saetze.push(v);
  };
  lauf(d);
  return saetze.join("\n");
}

/** Link zur Nachricht in Discord (für Aufgaben bei Fehlern). */
export const nachrichtLink = (guildId: string | null | undefined, channelId: string, msgId: string) => `https://discord.com/channels/${guildId || "@me"}/${channelId}/${msgId}`;

/** Text aus einer öffentlichen Webseite (HTML → Text), für Transkript-Links ohne eigene Anbindung. */
export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
