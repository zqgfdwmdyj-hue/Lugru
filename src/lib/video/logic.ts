import FILTER from "../../../unter-der-decke/filter.json";
import type { SchrittStand, VideoFreigabe, VideoKosten, VideoSchritt } from "@/db/tables/video";

// B36 Video-Pipeline – reine Logik (ohne Datenbank): Schrittfolge, Freigabe-Punkte, Kostenschätzung, Filter, Worker-
// Status. Der Worker (Python, unter-der-decke/) macht die eigentliche Arbeit; hier steht nur, was als Nächstes dran ist.

export const SCHRITTE: VideoSchritt[] = ["research", "script", "voice", "visuals", "render", "package", "upload"];
export const SCHRITT_TEXT: Record<VideoSchritt, string> = { research: "Recherche", script: "Skript", voice: "Sprache", visuals: "Bilder", render: "Render", package: "Paket", upload: "Upload (privat)" };
export const FREIGABE_TEXT: Record<VideoFreigabe, string> = { gliederung: "Gliederung + Quellen", skript: "Skript", vorschau: "Vorschau-Video + Thumbnail + Titel" };
/** Nach welchem Schritt welcher Freigabe-Punkt kommt (B36.3). */
export const FREIGABE_NACH: Partial<Record<VideoSchritt, VideoFreigabe>> = { research: "gliederung", script: "skript", package: "vorschau" };
export const FREIGABE_VOR: Record<VideoFreigabe, VideoSchritt> = { gliederung: "script", skript: "voice", vorschau: "upload" };

/** Mindestens frei auf dem Worker, sonst kein Lauf (B36.6); Warnung, wenn der Worker so lange schweigt. */
export const WORKER_MIN_FREI_GB = 3;
export const WORKER_STILL_MIN = 10;

export const naechsterNach = (s: VideoSchritt): VideoSchritt | null => SCHRITTE[SCHRITTE.indexOf(s) + 1] ?? null;

/** Was passiert, wenn der Worker einen Schritt fertig meldet: Freigabe abwarten, weitermachen oder fertig. */
export function nachSchritt(s: VideoSchritt, o: { freigaben: Record<VideoFreigabe, boolean>; freigegeben: Partial<Record<VideoFreigabe, string>>; hochladen: boolean }): { status: "laeuft" | "freigabe" | "fertig"; schritt: VideoSchritt; freigabeOffen: VideoFreigabe | null } {
  const f = FREIGABE_NACH[s];
  if (f && o.freigaben[f] !== false && !o.freigegeben[f]) return { status: "freigabe", schritt: FREIGABE_VOR[f], freigabeOffen: f };
  const weiter = naechsterNach(s);
  if (!weiter) return { status: "fertig", schritt: s, freigabeOffen: null };
  // Upload nur mit Schalter „Privat hochladen“ – sonst ist der Auftrag nach dem Paket fertig.
  if (weiter === "upload" && !o.hochladen) return { status: "fertig", schritt: "upload", freigabeOffen: null };
  return { status: "laeuft", schritt: weiter, freigabeOffen: null };
}

/** Fortschritt in Prozent über alle Schritte (fertige zählen voll, der laufende anteilig nach Szenen). */
export function fortschrittProzent(schritte: Partial<Record<VideoSchritt, SchrittStand>>, mitUpload: boolean): number {
  const liste = mitUpload ? SCHRITTE : SCHRITTE.filter((s) => s !== "upload");
  let summe = 0;
  for (const s of liste) {
    const st = schritte[s];
    if (st?.status === "fertig") summe += 1;
    else if (st?.status === "laeuft" && st.fortschritt?.gesamt) summe += Math.min(1, st.fortschritt.fertig / st.fortschritt.gesamt);
  }
  return Math.round((summe / liste.length) * 100);
}

// ---- Worker-Status -------------------------------------------------------------------------------------------------

export function workerStand(zuletzt: Date | null, jetzt = new Date()): { online: boolean; minuten: number | null; warnung: boolean; text: string } {
  if (!zuletzt) return { online: false, minuten: null, warnung: true, text: "Worker noch nie gesehen" };
  const minuten = Math.floor((jetzt.getTime() - zuletzt.getTime()) / 60_000);
  const online = minuten < WORKER_STILL_MIN;
  const zeit = zuletzt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
  return { online, minuten, warnung: !online, text: online ? `Worker zuletzt gesehen: ${zeit}` : `Worker zuletzt gesehen: ${zeit} – seit ${minuten} Min. keine Meldung (PC aus?) – Aufträge warten` };
}

/** Anzeige-Status: läuft beim Worker, der seit 10 Min. schweigt → „wartet (Worker aus)“. */
export function anzeigeStatus(status: string, workerOnline: boolean): string {
  if (status === "laeuft" && !workerOnline) return "wartet (Worker aus)";
  return ({ wartet: "wartet", laeuft: "läuft", freigabe: "Freigabe nötig", fertig: "fertig", fehler: "Fehler", abgebrochen: "abgebrochen" } as Record<string, string>)[status] ?? status;
}

// ---- Start-Zeitpunkt -----------------------------------------------------------------------------------------------

/** „sofort“ → null, „nacht“ → heute 23:00 (Berlin; danach sofort), sonst ein Zeitpunkt aus dem Formular. */
export function startAbAus(wahl: string, zeitpunkt: string | null, jetzt = new Date()): Date | null {
  if (wahl === "nacht") {
    const tag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(jetzt);
    const versatz = berlinVersatzMin(jetzt);
    const d = new Date(Date.parse(`${tag}T23:00:00Z`) - versatz * 60_000);
    return d > jetzt ? d : null;
  }
  if (wahl === "zeitpunkt" && zeitpunkt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(zeitpunkt)) {
    const d = new Date(Date.parse(`${zeitpunkt.slice(0, 16)}:00Z`) - berlinVersatzMin(jetzt) * 60_000);
    return Number.isFinite(d.getTime()) && d > jetzt ? d : null;
  }
  return null;
}

function berlinVersatzMin(d: Date): number {
  const teile = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" }).formatToParts(d);
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(teile.find((t) => t.type === "timeZoneName")?.value ?? "GMT+1");
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 60;
}

// ---- Kosten -------------------------------------------------------------------------------------------------------

/** Preise in US-Dollar (so rechnen die Anbieter ab). Leer = unbekannt → Schätzung nennt den fehlenden Preis.
 *  Claude leer = Listenpreis des gewählten Modells (siehe VIDEO_MODELLE). */
export type VideoPreise = { claudeEingabeJeMio: number | null; claudeAusgabeJeMio: number | null; websucheJe1000: number | null; elevenlabsJe1000Zeichen: number | null; bildJeStueck: number | null };
export const VIDEO_PREISE_STANDARD: VideoPreise = { claudeEingabeJeMio: null, claudeAusgabeJeMio: null, websucheJe1000: 10, elevenlabsJe1000Zeichen: null, bildJeStueck: null };

/** Wählbare Claude-Modelle für Recherche/Skript/Paket mit Listenpreis ($ je Mio. Tokens Eingabe/Ausgabe). */
export const VIDEO_MODELLE = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", eingabe: 4, ausgabe: 20, hinweis: "beste Recherche und Texte (empfohlen)" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", eingabe: 2, ausgabe: 10, hinweis: "günstiger, etwas schwächer bei Quellen und Stil" },
} as const;
export type VideoModell = keyof typeof VIDEO_MODELLE;
export const VIDEO_MODELL_STANDARD: VideoModell = "claude-opus-5-5";
export const istVideoModell = (m: unknown): m is VideoModell => typeof m === "string" && m in VIDEO_MODELLE;

/** Claude-Preis: eingetragener Preis, sonst Listenpreis des Modells (unbekanntes Modell → Opus-Preis, lieber zu hoch). */
export function claudePreis(p: VideoPreise, modell?: string | null): { eingabe: number; ausgabe: number } {
  const liste = VIDEO_MODELLE[istVideoModell(modell) ? modell : VIDEO_MODELL_STANDARD];
  return { eingabe: p.claudeEingabeJeMio ?? liste.eingabe, ausgabe: p.claudeAusgabeJeMio ?? liste.ausgabe };
}

/** Typischer Lauf (10–12 Min.): ~1.600 Wörter ≈ 10.500 Zeichen Sprache, ~26 Szenen/Bilder, ~6 Websuchen, ~60k/15k Tokens. */
export const TYPISCH = { zeichen: 10_500, bilder: 26, websuchen: 6, eingabeTokens: 60_000, ausgabeTokens: 15_000 };

export function kostenSchaetzung(p: VideoPreise, menge = TYPISCH, modell: string | null = VIDEO_MODELL_STANDARD): { summe: number; positionen: { art: string; betrag: number | null }[]; fehlend: string[] } {
  const c = claudePreis(p, modell);
  const pos = [
    { art: "Claude (Recherche, Skript, Paket)", betrag: (menge.eingabeTokens / 1e6) * c.eingabe + (menge.ausgabeTokens / 1e6) * c.ausgabe },
    { art: "Websuche", betrag: p.websucheJe1000 !== null ? (menge.websuchen / 1000) * p.websucheJe1000 : null },
    { art: "Sprache (ElevenLabs)", betrag: p.elevenlabsJe1000Zeichen !== null ? (menge.zeichen / 1000) * p.elevenlabsJe1000Zeichen : null },
    { art: "Bilder (gpt-image-1)", betrag: p.bildJeStueck !== null ? menge.bilder * p.bildJeStueck : null },
  ];
  return { summe: Math.round(pos.reduce((a, x) => a + (x.betrag ?? 0), 0) * 100) / 100, positionen: pos.map((x) => ({ ...x, betrag: x.betrag === null ? null : Math.round(x.betrag * 100) / 100 })), fehlend: pos.filter((x) => x.betrag === null).map((x) => x.art) };
}

/** Kosten eines Anbieter-Aufrufs aus der Antwort (Tokens, Websuchen, Zeichen, Bilder). */
export function kostenPosition(anbieter: "anthropic" | "elevenlabs" | "openai", p: VideoPreise, m: { eingabe?: number; ausgabe?: number; websuchen?: number; zeichen?: number; bilder?: number; modell?: string | null }, am = new Date()): VideoKosten[] {
  const iso = am.toISOString();
  const r = (x: number) => Math.round(x * 10_000) / 10_000;
  if (anbieter === "anthropic") {
    const out: VideoKosten[] = [];
    const tok = (m.eingabe ?? 0) + (m.ausgabe ?? 0);
    const c = claudePreis(p, m.modell);
    if (tok) out.push({ anbieter: "Claude", art: istVideoModell(m.modell) ? `Tokens (${VIDEO_MODELLE[m.modell].name})` : "Tokens", menge: tok, einheit: "Tokens", betrag: r(((m.eingabe ?? 0) / 1e6) * c.eingabe + ((m.ausgabe ?? 0) / 1e6) * c.ausgabe), am: iso });
    if (m.websuchen) out.push({ anbieter: "Claude", art: "Websuche", menge: m.websuchen, einheit: "Suchen", betrag: p.websucheJe1000 !== null ? r((m.websuchen / 1000) * p.websucheJe1000) : null, am: iso });
    return out;
  }
  if (anbieter === "elevenlabs") return [{ anbieter: "ElevenLabs", art: "Sprache", menge: m.zeichen ?? 0, einheit: "Zeichen", betrag: p.elevenlabsJe1000Zeichen !== null ? r(((m.zeichen ?? 0) / 1000) * p.elevenlabsJe1000Zeichen) : null, am: iso }];
  return [{ anbieter: "OpenAI", art: "Bild", menge: m.bilder ?? 1, einheit: "Bilder", betrag: p.bildJeStueck !== null ? r((m.bilder ?? 1) * p.bildJeStueck) : null, am: iso }];
}

export const kostenSumme = (k: VideoKosten[]) => Math.round(k.reduce((a, x) => a + (x.betrag ?? 0), 0) * 10_000) / 10_000;

/** Nutzungszahlen aus einer Claude-Antwort (JSON oder Server-Sent Events). */
export function claudeNutzung(text: string): { eingabe: number; ausgabe: number; websuchen: number } {
  let eingabe = 0;
  let ausgabe = 0;
  let websuchen = 0;
  const nimm = (u: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; server_tool_use?: { web_search_requests?: number } } | undefined) => {
    if (!u) return;
    if (typeof u.input_tokens === "number") eingabe = Math.max(eingabe, u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0));
    if (typeof u.output_tokens === "number") ausgabe = Math.max(ausgabe, u.output_tokens);
    if (u.server_tool_use?.web_search_requests) websuchen = Math.max(websuchen, u.server_tool_use.web_search_requests);
  };
  const t = text.trim();
  if (t.startsWith("{")) {
    try {
      nimm((JSON.parse(t) as { usage?: Parameters<typeof nimm>[0] }).usage);
    } catch {
      /* unvollständig */
    }
    return { eingabe, ausgabe, websuchen };
  }
  for (const zeile of t.split(/\r?\n/)) {
    if (!zeile.startsWith("data:")) continue;
    try {
      const ev = JSON.parse(zeile.slice(5).trim()) as { type?: string; message?: { usage?: Parameters<typeof nimm>[0] }; usage?: Parameters<typeof nimm>[0] };
      if (ev.type === "message_start") nimm(ev.message?.usage);
      if (ev.type === "message_delta") nimm(ev.usage);
    } catch {
      /* keine JSON-Zeile */
    }
  }
  return { eingabe, ausgabe, websuchen };
}

// ---- Filter (Bildideen, Titel) -------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
const trifft = (text: string, woerter: string[]) => {
  const t = ` ${norm(text).replace(/[^a-z0-9 ]+/g, " ")} `;
  return woerter.find((w) => t.includes(` ${norm(w).trim()}`)) ?? null;
};

/** Titel mit expliziten Begriffen (Nacktheit, Porno …) – „Sex“ als Thema bleibt erlaubt. */
export const titelTreffer = (titel: string) => trifft(titel, FILTER.titel);
/** Bildidee nicht erlaubt? (streng: zusätzlich Bett, Kuss, Berührung …) */
export const bildTreffer = (idee: string, streng: boolean) => trifft(idee, streng ? [...FILTER.bild, ...FILTER.bild_streng] : FILTER.bild);
export const ERSATZ_BILDIDEE = FILTER.ersatz_bildidee;

// ---- Anzeige ------------------------------------------------------------------------------------------------------

export const dauerText = (sek: number | null | undefined) => (sek === null || sek === undefined ? "–" : `${Math.floor(sek / 60)}:${String(Math.round(sek % 60)).padStart(2, "0")}`);
export const kapitelZeile = (k: { start: number; titel: string }) => `${dauerText(k.start)} ${k.titel}`;
export const usd = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);

/** Kanal-Kurzname aus dem Namen (für Ordner im Worker). */
export const slugAus = (name: string) =>
  norm(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "kanal";
