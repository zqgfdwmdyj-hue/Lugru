import "server-only";
import { teilen } from "./logic";

// Discord-REST für den VA-Kanal (Bot-Token nur auf dem Server; nie in Meldungen oder Protokollen).

export type DcNachricht = {
  id: string;
  channel_id: string;
  type?: number;
  content?: string;
  timestamp?: string;
  author?: { id: string; bot?: boolean; username?: string };
  attachments?: { id: string; filename: string; url: string; content_type?: string; size?: number }[];
  reactions?: { emoji: { name: string | null }; count: number; me?: boolean }[];
  thread?: { id: string };
};

export type DcDatei = { name: string; daten: Buffer; typ: string };

const BASIS = () => (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
/** Nachricht ohne Push-Benachrichtigung (Ruhezeit). */
const STILL = 1 << 12;

export class DiscordFehler extends Error {
  constructor(
    msg: string,
    public status: number,
  ) {
    super(msg);
  }
}

export function discord(token: string) {
  async function anfrage<T>(method: string, pfad: string, body?: unknown, form?: FormData, versuch = 0): Promise<T> {
    const res = await fetch(`${BASIS()}${pfad}`, {
      method,
      headers: { Authorization: `Bot ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && versuch < 2) {
      const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(200, (j.retry_after ?? 1) * 1000))));
      return anfrage(method, pfad, body, form, versuch + 1);
    }
    if (!res.ok) {
      const hinweis = res.status === 401 ? "Bot-Token ungültig" : res.status === 403 ? "dem Bot fehlen Rechte im VA-Kanal" : res.status === 404 ? "Kanal oder Nachricht nicht gefunden" : `HTTP ${res.status}`;
      throw new DiscordFehler(`Discord: ${hinweis}.`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    ich: () => anfrage<{ id: string; username?: string }>("GET", "/users/@me"),
    kanal: (id: string) => anfrage<{ id: string; name?: string; guild_id?: string; type?: number }>("GET", `/channels/${encodeURIComponent(id)}`),
    /** Öffentlicher Thread ohne Startnachricht (Aufgaben). */
    threadAnlegen: (kanalId: string, name: string) => anfrage<{ id: string }>("POST", `/channels/${encodeURIComponent(kanalId)}/threads`, { name, type: 11, auto_archive_duration: 10080 }),
    /** Thread an einer Nachricht der VA (Anfragen im Kanal). */
    threadAnNachricht: (kanalId: string, nachrichtId: string, name: string) => anfrage<{ id: string }>("POST", `/channels/${encodeURIComponent(kanalId)}/messages/${encodeURIComponent(nachrichtId)}/threads`, { name, auto_archive_duration: 10080 }),
    /** Text senden (lange Texte in mehreren Nachrichten), optional mit Dateien an der letzten. Liefert die ID der ersten Nachricht. */
    async senden(kanalId: string, text: string, o: { erwaehnen?: string | null; still?: boolean; dateien?: DcDatei[] } = {}): Promise<string> {
      const teile = teilen(text);
      let erste = "";
      for (let i = 0; i < teile.length; i++) {
        const payload = {
          content: teile[i],
          allowed_mentions: { parse: [] as string[], users: o.erwaehnen && i === 0 ? [o.erwaehnen] : [] },
          ...(o.still ? { flags: STILL } : {}),
        };
        const dateien = i === teile.length - 1 ? (o.dateien ?? []).slice(0, 10) : [];
        let m: DcNachricht;
        if (dateien.length) {
          const f = new FormData();
          f.append("payload_json", JSON.stringify({ ...payload, attachments: dateien.map((d, n) => ({ id: n, filename: d.name })) }));
          dateien.forEach((d, n) => f.append(`files[${n}]`, new Blob([new Uint8Array(d.daten)], { type: d.typ }), d.name));
          m = await anfrage<DcNachricht>("POST", `/channels/${encodeURIComponent(kanalId)}/messages`, undefined, f);
        } else m = await anfrage<DcNachricht>("POST", `/channels/${encodeURIComponent(kanalId)}/messages`, payload);
        if (!erste) erste = m.id;
      }
      return erste;
    },
    /** Neue Nachrichten nach `nach` (aufsteigend sortiert, seitenweise). Ohne `nach`: nur die neueste (für den Startpunkt). */
    async neue(kanalId: string, nach: string | null, max = 300): Promise<DcNachricht[]> {
      if (!nach) return anfrage<DcNachricht[]>("GET", `/channels/${encodeURIComponent(kanalId)}/messages?limit=1`);
      const alle: DcNachricht[] = [];
      let cursor = nach;
      while (alle.length < max) {
        const seite = await anfrage<DcNachricht[]>("GET", `/channels/${encodeURIComponent(kanalId)}/messages?after=${cursor}&limit=50`);
        if (!seite.length) break;
        seite.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        alle.push(...seite);
        cursor = seite[seite.length - 1].id;
        if (seite.length < 50) break;
      }
      return alle;
    },
    nachricht: (kanalId: string, id: string) => anfrage<DcNachricht>("GET", `/channels/${encodeURIComponent(kanalId)}/messages/${encodeURIComponent(id)}`),
  };
}

/** Anhang der VA herunterladen (nur Discord-CDN bzw. Testdienst; höchstens 20 MB). */
export async function anhangLaden(url: string): Promise<Buffer | null> {
  const erlaubt = /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(url) || (process.env.TESTDIENSTE_URL ? url.startsWith(process.env.TESTDIENSTE_URL) : false);
  if (!erlaubt) return null;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  return b.length <= 20 * 1024 * 1024 ? b : null;
}
