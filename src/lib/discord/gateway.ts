import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration } from "@/lib/integrations/store";
import { assertOutbound } from "@/lib/testenv";
import { recordJob } from "@/lib/today/jobs";
import type { DiscordNachricht } from "@/lib/calls/live-logic";

// B21: Live-Verbindung zu Discord (Gateway, WebSocket). Neue und bearbeitete Nachrichten im Call-Kanal kommen sofort
// an (MESSAGE_CREATE / MESSAGE_UPDATE) und werden direkt verarbeitet. Eine Verbindung je Bot-Token; der Zeitplan ist
// nur noch Sicherheitsnetz (täglich 06:00). Benötigt im Discord-Entwicklerportal „Message Content Intent“.

const DISCORD = () => (process.env.DISCORD_API_BASE_URL || "https://discord.com/api/v10").replace(/\/$/, "");
/** GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT */
export const INTENTS = 1 | (1 << 9) | (1 << 15);
export const LIVE_VERBINDUNG = "Discord live-Verbindung";
export const EMPFANGEN_JOB = "Call-Kanal (Discord live): empfangen";

type Zustand = "verbinde" | "verbunden" | "getrennt" | "fehler";
type Verbindung = {
  token: string;
  ws: WebSocket | null;
  zustand: Zustand;
  seit: Date | null;
  fehler: string | null;
  seq: number | null;
  sessionId: string | null;
  resumeUrl: string | null;
  herz: ReturnType<typeof setInterval> | null;
  ackOffen: boolean;
  versuche: number;
  stopp: boolean;
  /** Zuletzt empfangene Nachricht je Mandant (für „zuletzt empfangen“). */
  empfangen: Map<string, Date>;
};

const g = globalThis as unknown as { __discordLive?: { verbindungen: Map<string, Verbindung>; timer: ReturnType<typeof setInterval> | null; gestartet: boolean } };
const zustand = () => (g.__discordLive ??= { verbindungen: new Map(), timer: null, gestartet: false });

/** Mandanten mit Call-Kanal: Token → [{ Mandant, Kanal }]. */
async function ziele(): Promise<Map<string, { tenantId: string; kanalId: string }[]>> {
  const rows = await db.select({ tenantId: schema.integrations.tenantId }).from(schema.integrations).where(eq(schema.integrations.provider, "discord_calls"));
  const out = new Map<string, { tenantId: string; kanalId: string }[]>();
  for (const r of rows) {
    const cfg = await getIntegration(r.tenantId, "discord_calls").catch(() => null);
    if (!cfg?.botToken || !cfg.kanalId) continue;
    const t = String(cfg.botToken);
    out.set(t, [...(out.get(t) ?? []), { tenantId: r.tenantId, kanalId: String(cfg.kanalId) }]);
  }
  return out;
}

const fehlerText = (code: number, grund: string) =>
  code === 4004
    ? "Bot-Token ungültig – unter Anbindungen → Discord – Call-Kanal neu eintragen."
    : code === 4014
      ? "Discord lehnt die Live-Verbindung ab: im Entwicklerportal (Bot → Privileged Gateway Intents) „Message Content Intent“ einschalten."
      : code === 4013
        ? "Ungültige Intents für die Live-Verbindung."
        : `Live-Verbindung getrennt (${code}${grund ? `: ${grund}` : ""}).`;

async function protokoll(token: string, fehler: string | null) {
  for (const z of (await ziele()).get(token) ?? []) await recordJob(z.tenantId, LIVE_VERBINDUNG, fehler);
}

/** Eingegangene Nachricht an die passenden Mandanten geben (nur deren Call-Kanal). */
async function nachricht(v: Verbindung, typ: "MESSAGE_CREATE" | "MESSAGE_UPDATE", d: DiscordNachricht) {
  if (!d?.id || !d.channel_id) return;
  const passende = ((await ziele()).get(v.token) ?? []).filter((z) => z.kanalId === d.channel_id);
  if (!passende.length) return;
  const { callNachrichtVerarbeiten } = await import("@/lib/calls/live");
  for (const z of passende) {
    v.empfangen.set(z.tenantId, new Date());
    await recordJob(z.tenantId, EMPFANGEN_JOB, null);
    let m = d;
    // Bearbeitet, aber ohne Inhalt/Anhänge im Ereignis (z. B. nur Vorschau geändert): Nachricht vollständig holen.
    if (typ === "MESSAGE_UPDATE" && m.content === undefined && m.attachments === undefined) {
      const r = await fetch(`${DISCORD()}/channels/${d.channel_id}/messages/${d.id}`, { headers: { Authorization: `Bot ${v.token}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (r?.ok) m = { ...(await r.json()), guild_id: d.guild_id };
      else continue;
    }
    await callNachrichtVerarbeiten(z.tenantId, m, { bearbeitet: typ === "MESSAGE_UPDATE", quelle: "live" }).catch((e) => console.error("[Discord live]", e instanceof Error ? e.message : e));
  }
}

function senden(v: Verbindung, op: number, d: unknown) {
  if (v.ws && v.ws.readyState === 1) v.ws.send(JSON.stringify({ op, d }));
}

function aufraeumen(v: Verbindung) {
  if (v.herz) clearInterval(v.herz);
  v.herz = null;
  try {
    v.ws?.close(1000);
  } catch {
    /* schon zu */
  }
  v.ws = null;
}

async function verbinden(v: Verbindung) {
  if (v.stopp) return;
  v.zustand = "verbinde";
  try {
    let url = v.resumeUrl;
    if (!url) {
      const r = await fetch(`${DISCORD()}/gateway/bot`, { headers: { Authorization: `Bot ${v.token}` }, signal: AbortSignal.timeout(15_000) });
      if (r.status === 401) throw Object.assign(new Error(fehlerText(4004, "")), { endgueltig: true });
      if (!r.ok) throw new Error(`Discord: Gateway nicht erreichbar (${r.status})`);
      url = String(((await r.json()) as { url?: string }).url ?? "");
      if (!url) throw new Error("Discord: keine Gateway-Adresse erhalten");
    }
    const ziel = new URL(`${url.replace(/\/$/, "")}/?v=10&encoding=json`);
    assertOutbound(ziel.hostname);
    const ws = new WebSocket(ziel.href);
    v.ws = ws;
    ws.onmessage = (ev) => {
      let p: { op: number; d: unknown; s: number | null; t: string | null };
      try {
        p = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (p.s !== null && p.s !== undefined) v.seq = p.s;
      if (p.op === 10) {
        const intervall = Number((p.d as { heartbeat_interval?: number }).heartbeat_interval) || 41_250;
        v.ackOffen = false;
        if (v.herz) clearInterval(v.herz);
        v.herz = setInterval(() => {
          // Keine Bestätigung auf den letzten Herzschlag → Verbindung hängt: neu verbinden (mit Fortsetzen).
          if (v.ackOffen) {
            aufraeumen(v);
            neuVerbinden(v, 1_000);
            return;
          }
          v.ackOffen = true;
          senden(v, 1, v.seq);
        }, intervall);
        if (v.sessionId && v.resumeUrl) senden(v, 6, { token: v.token, session_id: v.sessionId, seq: v.seq });
        else senden(v, 2, { token: v.token, intents: INTENTS, properties: { os: "linux", browser: "seller-system", device: "seller-system" } });
      } else if (p.op === 11) v.ackOffen = false;
      else if (p.op === 1) senden(v, 1, v.seq);
      else if (p.op === 7) {
        aufraeumen(v);
        neuVerbinden(v, 500);
      } else if (p.op === 9) {
        // Sitzung ungültig: neu anmelden (nicht fortsetzen).
        v.sessionId = null;
        v.resumeUrl = null;
        aufraeumen(v);
        neuVerbinden(v, 2_000);
      } else if (p.op === 0) {
        if (p.t === "READY") {
          const d = p.d as { session_id?: string; resume_gateway_url?: string };
          v.sessionId = d.session_id ?? null;
          v.resumeUrl = d.resume_gateway_url ?? null;
        }
        if (p.t === "READY" || p.t === "RESUMED") {
          v.zustand = "verbunden";
          v.seit = new Date();
          v.fehler = null;
          v.versuche = 0;
          void protokoll(v.token, null);
        }
        if (p.t === "MESSAGE_CREATE" || p.t === "MESSAGE_UPDATE") void nachricht(v, p.t, p.d as DiscordNachricht);
      }
    };
    ws.onclose = (ev) => {
      if (v.ws !== ws) return;
      aufraeumen(v);
      if (v.stopp) return;
      const endgueltig = [4004, 4010, 4011, 4012, 4013, 4014].includes(ev.code);
      v.zustand = endgueltig ? "fehler" : "getrennt";
      v.fehler = fehlerText(ev.code, ev.reason);
      if ([4007, 4009].includes(ev.code)) {
        v.sessionId = null;
        v.resumeUrl = null;
      }
      void protokoll(v.token, v.fehler);
      if (!endgueltig) neuVerbinden(v);
    };
    ws.onerror = () => {
      /* onclose folgt */
    };
  } catch (e) {
    v.zustand = (e as { endgueltig?: boolean }).endgueltig ? "fehler" : "getrennt";
    v.fehler = e instanceof Error ? e.message : String(e);
    v.resumeUrl = null;
    void protokoll(v.token, v.fehler);
    if (v.zustand !== "fehler") neuVerbinden(v);
  }
}

function neuVerbinden(v: Verbindung, ms?: number) {
  if (v.stopp) return;
  v.versuche++;
  const warten = ms ?? Math.min(5 * 60_000, 2_000 * 2 ** Math.min(v.versuche, 8));
  setTimeout(() => void verbinden(v), warten).unref?.();
}

/** Verbindungen an die eingerichteten Call-Kanäle anpassen (neue Tokens verbinden, entfernte trennen). */
export async function discordLiveAbgleich(): Promise<void> {
  const s = zustand();
  const soll = await ziele();
  for (const [token, v] of s.verbindungen) {
    if (!soll.has(token)) {
      v.stopp = true;
      aufraeumen(v);
      s.verbindungen.delete(token);
    } else if (v.zustand === "fehler" && v.versuche < 3 && !v.ws) {
      // Nach Korrektur (z. B. Intent eingeschaltet) erneut versuchen – höchstens ein paar Mal von selbst.
      v.versuche++;
      void verbinden(v);
    }
  }
  for (const token of soll.keys()) {
    if (s.verbindungen.has(token)) continue;
    const v: Verbindung = { token, ws: null, zustand: "verbinde", seit: null, fehler: null, seq: null, sessionId: null, resumeUrl: null, herz: null, ackOffen: false, versuche: 0, stopp: false, empfangen: new Map() };
    s.verbindungen.set(token, v);
    void verbinden(v);
  }
}

/** Beim Serverstart: Live-Verbindung aufbauen und jede Minute an die Anbindungen anpassen. */
export function startDiscordLive() {
  const s = zustand();
  if (s.gestartet) return;
  s.gestartet = true;
  const lauf = () => void discordLiveAbgleich().catch((e) => console.error("[Discord live]", e instanceof Error ? e.message : e));
  setTimeout(lauf, 5_000);
  s.timer = setInterval(lauf, 60_000);
  console.log("[Discord live] Call-Kanal wird live gelesen (sobald eingerichtet).");
}

/** Stand für Anbindungen, `calls` und `anbindungen_status`. */
export async function discordLiveStatus(tenantId: string): Promise<{ aktiv: boolean; zustand: Zustand | "aus"; seit: Date | null; zuletztEmpfangen: Date | null; fehler: string | null }> {
  const s = zustand();
  const cfg = await getIntegration(tenantId, "discord_calls").catch(() => null);
  const v = cfg?.botToken ? s.verbindungen.get(String(cfg.botToken)) : undefined;
  // „zuletzt empfangen“ überdauert einen Neustart (Protokoll), der Verbindungszustand nicht.
  const [j] = await db.select({ am: schema.jobRuns.lastOkAt }).from(schema.jobRuns).where(and(eq(schema.jobRuns.tenantId, tenantId), eq(schema.jobRuns.name, EMPFANGEN_JOB)));
  const empfangen = v?.empfangen.get(tenantId) ?? j?.am ?? null;
  if (!s.gestartet || !v) return { aktiv: false, zustand: "aus", seit: null, zuletztEmpfangen: empfangen, fehler: null };
  return { aktiv: true, zustand: v.zustand, seit: v.seit, zuletztEmpfangen: empfangen, fehler: v.fehler };
}
