import FILTER from "../../../unter-der-decke/filter.json";
import type { SchrittStand, VideoFreigabe, VideoKosten, VideoSchritt } from "@/db/tables/video";

// B36 Video-Pipeline – reine Logik (ohne Datenbank): Schrittfolge, Freigabe-Punkte, Kostenschätzung, Filter, Worker-
// Status. Der Worker (Python, unter-der-decke/) macht die eigentliche Arbeit; hier steht nur, was als Nächstes dran ist.

export const SCHRITTE: VideoSchritt[] = ["research", "script", "voice", "visuals", "render", "package", "upload"];
export const SCHRITT_TEXT: Record<VideoSchritt, string> = { research: "Recherche", script: "Skript", voice: "Sprache", visuals: "Bilder", render: "Render", package: "Paket", upload: "Upload (privat)", story: "Story" };
export const FREIGABE_TEXT: Record<VideoFreigabe, string> = { gliederung: "Gliederung + Quellen", skript: "Skript", szenen: "Szenen-Übersicht (Motive)", vorschau: "Vorschau-Video + Thumbnail + Titel", story: "Story-Vorschau" };
/** Nach welchem Schritt welcher Freigabe-Punkt kommt (B36.3; Szenen-Übersicht vor dem Render: B36.9). */
export const FREIGABE_NACH: Partial<Record<VideoSchritt, VideoFreigabe>> = { research: "gliederung", script: "skript", visuals: "szenen", package: "vorschau" };
export const FREIGABE_VOR: Record<VideoFreigabe, VideoSchritt> = { gliederung: "script", skript: "voice", szenen: "render", vorschau: "upload", story: "story" };
/** Ohne Eintrag im Kanal: die drei Freigaben aus B36.3 an, die Szenen-Übersicht (neu mit B36.9) aus. */
export const FREIGABE_STANDARD: Record<VideoFreigabe, boolean> = { gliederung: true, skript: true, szenen: false, vorschau: true, story: true };
export const freigabeAktiv = (freigaben: Partial<Record<VideoFreigabe, boolean>>, f: VideoFreigabe) => freigaben[f] ?? FREIGABE_STANDARD[f];

/** Bildstile je Kanal. */
export const VIDEO_STILE = {
  vollbild: { name: "Vollbild", hinweis: "ein Symbolbild je Szene, Untertitel eingebrannt" },
  whiteboard: { name: "Whiteboard-Collage", hinweis: "3–5 Cartoon-Motive je Szene auf Weiß, Hand zeichnet mit, Texte in fester Schrift, Untertitel als YouTube-Untertitel" },
} as const;
export type VideoStil = keyof typeof VIDEO_STILE;
export const istVideoStil = (x: unknown): x is VideoStil => typeof x === "string" && x in VIDEO_STILE;
/** Whiteboard: im Mittel 4 Motive je Szene (Schätzung ohne Wiederverwendung aus der Bibliothek = Obergrenze). */
export const MOTIVE_JE_SZENE = 4;
/** B36.10 Whiteboard-Tempo: kurze Szenen (1–2 Sätze, 6–12 s Sprecherzeit) → bei 10–12 Min. 55–80 Szenen. */
export const WB_SZENEN = [55, 80] as const;
/** Zeichenzeit je Motiv nach Kanalprofil „Tempo“ (Sekunden). */
export const TEMPO_SEK = { ruhig: 2.5, normal: 2.0, schnell: 1.5 } as const;
/** Neue (zu bezahlende) Motive je kurzer Szene im Schnitt – der Rest kehrt aus vorigen Szenen/der Bibliothek wieder. */
export const NEUE_MOTIVE_JE_SZENE = 1.5;
/** Layout-Vorlagen der Collage (B36.9.1). */
export const WHITEBOARD_LAYOUTS = ["3er", "4er", "5er", "figur-liste", "gegenueberstellung"] as const;

/** Figuren-Zeilen „kurzname: Beschreibung“ → Liste (Schlüssel a–z, 0–9, -). */
export function figurenAus(text: string | null | undefined): { key: string; beschreibung: string }[] {
  const out: { key: string; beschreibung: string }[] = [];
  for (const zeile of (text ?? "").split(/\r?\n/)) {
    const m = /^\s*([^:]{2,40}):\s*(.{3,300})$/.exec(zeile);
    if (!m) continue;
    const key = slugAus(m[1]).slice(0, 40);
    if (key && !out.some((f) => f.key === key)) out.push({ key, beschreibung: m[2].trim() });
  }
  return out.slice(0, 12);
}

/** Mindestens frei auf dem Worker, sonst kein Lauf (B36.6); Warnung, wenn der Worker so lange schweigt. */
export const WORKER_MIN_FREI_GB = 3;
/** Aktuelle Worker-Version (unter-der-decke/udd/__init__.py). Ab 1.2.0: Instagram-Stories (B37) und Whiteboard-Takt nach
 *  Wortzeiten (B36.10) – ältere Worker bekommen keine Stories. 1.2.1: mehr Platz für Claude-Antworten (abgeschnitten →
 *  ein neuer Versuch mit doppeltem Platz). */
export const WORKER_VERSION_AKTUELL = "1.2.1";

/** Mindest-Platz (max_tokens) je Claude-Aufruf über die Brücke: Opus 5.5 und Sonnet 5.5 denken immer mit, und das Denken
 *  zählt zu max_tokens (ebenso der Filter-Code der Websuche). Ältere Worker schickten 1.200–6.000 → „Antwort abgeschnitten
 *  (max_tokens)“. max_tokens ist nur eine Obergrenze – bezahlt wird, was Claude wirklich schreibt. */
export const CLAUDE_PLATZ_MIN = 16000;
/** Hebt max_tokens einer Claude-Anfrage auf mindestens CLAUDE_PLATZ_MIN; null = nichts zu ändern. */
export function claudeMitPlatz(body: Record<string, unknown>): Record<string, unknown> | null {
  const n = body.max_tokens;
  if (typeof n !== "number" || n >= CLAUDE_PLATZ_MIN) return null;
  return { ...body, max_tokens: CLAUDE_PLATZ_MIN };
}
/** Mindestversion für Stories (B37) und „Im neuen Takt neu machen“ (B36.10) – ältere Worker kennen beides nicht. */
export const WORKER_AB_TAKT = "1.2.0";
/** true, wenn der Worker eine ältere Version als „ab“ meldet (oder gar keine). */
export function workerVeraltet(version: string | null | undefined, ab: string = WORKER_VERSION_AKTUELL): boolean {
  const teile = (v: string) => v.split(".").map((x) => Number.parseInt(x, 10) || 0);
  if (!version) return true;
  const [a, b] = [teile(version), teile(ab)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}
export const WORKER_STILL_MIN = 10;

export const naechsterNach = (s: VideoSchritt): VideoSchritt | null => SCHRITTE[SCHRITTE.indexOf(s) + 1] ?? null;

/** Was passiert, wenn der Worker einen Schritt fertig meldet: Freigabe abwarten, weitermachen oder fertig. */
export function nachSchritt(s: VideoSchritt, o: { freigaben: Partial<Record<VideoFreigabe, boolean>>; freigegeben: Partial<Record<VideoFreigabe, string>>; hochladen: boolean }): { status: "laeuft" | "freigabe" | "fertig"; schritt: VideoSchritt; freigabeOffen: VideoFreigabe | null } {
  const f = FREIGABE_NACH[s];
  if (f && freigabeAktiv(o.freigaben, f) && !o.freigegeben[f]) return { status: "freigabe", schritt: FREIGABE_VOR[f], freigabeOffen: f };
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
/** motivJeStueck: Preis je Einzelmotiv (Whiteboard, 1024×1024) – leer = Preis je Bild. */
export type VideoPreise = { claudeEingabeJeMio: number | null; claudeAusgabeJeMio: number | null; websucheJe1000: number | null; elevenlabsJe1000Zeichen: number | null; bildJeStueck: number | null; motivJeStueck?: number | null };
export const VIDEO_PREISE_STANDARD: VideoPreise = { claudeEingabeJeMio: null, claudeAusgabeJeMio: null, websucheJe1000: 10, elevenlabsJe1000Zeichen: null, bildJeStueck: null, motivJeStueck: null };
export const motivPreis = (p: VideoPreise) => p.motivJeStueck ?? p.bildJeStueck;

/** Wählbare Claude-Modelle für Recherche/Skript/Paket mit Listenpreis ($ je Mio. Tokens Eingabe/Ausgabe). */
export const VIDEO_MODELLE = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", eingabe: 4, ausgabe: 20, hinweis: "beste Recherche und Texte (empfohlen)" },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", eingabe: 2, ausgabe: 10, hinweis: "günstiger, etwas schwächer bei Quellen und Stil" },
} as const;
export type VideoModell = keyof typeof VIDEO_MODELLE;
export const VIDEO_MODELL_STANDARD: VideoModell = "claude-opus-5-5";
export const istVideoModell = (m: unknown): m is VideoModell => typeof m === "string" && m in VIDEO_MODELLE;

/** OpenAI-Bildmodelle (Stand 13.11.2026 – gpt-image-1 hat OpenAI am 23.10.2026 abgeschaltet, gpt-image-1.5/-1-mini
 *  folgen am 01.12.2026). Die Anbieter-Brücke setzt das Modell selbst (Worker-Angabe zählt nicht); fehlt das gewählte im
 *  OpenAI-Konto, nimmt sie das nächste dieser Liste. */
export const BILD_MODELLE = {
  "gpt-image-2.5-flare": { name: "GPT Image 2.5 Flare", hinweis: "schnell, für Szenenbilder (empfohlen)" },
  "gpt-image-2.5-sunburst": { name: "GPT Image 2.5 Sunburst", hinweis: "genauer, gut mit Stil-Referenzbildern" },
  "gpt-image-2": { name: "GPT Image 2", hinweis: "Listenpreis ca. 0,04 $ je Bild (medium); transparente Motive nur Vorschau" },
} as const;
export type BildModell = keyof typeof BILD_MODELLE;
export const BILD_MODELL_STANDARD: BildModell = "gpt-image-2.5-flare";
export const istBildModell = (m: unknown): m is BildModell => typeof m === "string" && m in BILD_MODELLE;
export const bildModellName = (m: string | null | undefined) => (istBildModell(m) ? BILD_MODELLE[m].name : (m ?? "OpenAI"));

/** Reihenfolge der Versuche: gewähltes Modell, dann die übrigen. „zuerst“ = zuletzt funktionierendes (spart Fehlversuche). */
export function bildModellReihenfolge(gewaehlt: string | null | undefined, zuerst?: string | null): BildModell[] {
  const start = istBildModell(gewaehlt) ? gewaehlt : BILD_MODELL_STANDARD;
  const liste = [start, ...(Object.keys(BILD_MODELLE) as BildModell[]).filter((m) => m !== start)];
  return istBildModell(zuerst) ? [zuerst, ...liste.filter((m) => m !== zuerst)] : liste;
}

/** OpenAI-Antwort „Modell gibt es (im Konto) nicht / nicht freigeschaltet / abgeschaltet“ → nächstes Modell versuchen.
 *  Eine Ablehnung wegen des Inhalts (Moderation) zählt nicht – die behandelt der Worker (Ersatzmotiv). */
export function bildModellFehlt(status: number, text: string): boolean {
  if (![400, 403, 404].includes(status)) return false;
  if (/moderation|safety|content.?policy/i.test(text)) return false;
  if (/model_not_found/i.test(text)) return true;
  return /model/i.test(text) && /does not exist|not found|not have access|no access|must be verified|verif|not available|unavailable|not supported|deprecated|shut ?down|retired/i.test(text);
}

/** Klare Meldung bei abgelehntem Schlüssel (401) – ohne Teile des Schlüssels aus der Anbieter-Antwort. */
export function schluesselAbgelehnt(anbieter: "anthropic" | "elevenlabs" | "openai"): string {
  const ort = { anthropic: ["Claude", "KI (Claude)"], elevenlabs: ["ElevenLabs", "ElevenLabs (Sprache für Videos)"], openai: ["OpenAI", "OpenAI (Bilder für Videos)"] }[anbieter];
  return `${ort[0]}-Schlüssel abgelehnt (HTTP 401) – unter Anbindungen → ${ort[1]} den API-Key neu eintragen${anbieter === "openai" ? " und „Verbindung testen“" : ""}.`;
}

/** Claude-Preis: eingetragener Preis, sonst Listenpreis des Modells (unbekanntes Modell → Opus-Preis, lieber zu hoch). */
export function claudePreis(p: VideoPreise, modell?: string | null): { eingabe: number; ausgabe: number } {
  const liste = VIDEO_MODELLE[istVideoModell(modell) ? modell : VIDEO_MODELL_STANDARD];
  return { eingabe: p.claudeEingabeJeMio ?? liste.eingabe, ausgabe: p.claudeAusgabeJeMio ?? liste.ausgabe };
}

/** Sprechtempo der Stimme (ElevenLabs, Deutsch): ~145 Wörter je Minute. */
export const WOERTER_JE_MIN = 145;
/** Skriptlänge fest für alle Kanäle (Entscheidung 12.11.): 1.500–1.700 Wörter ≈ 10–12 Min. Sprechzeit. Ersetzt die
 *  frühere Länge je Kanalprofil (Spalten laenge_min/laenge_max bleiben in der Datenbank, werden aber nicht mehr benutzt). */
export const SKRIPT_WOERTER = [1500, 1700] as const;
export type LaengeZiel = { minuten: [number, number]; sekunden: [number, number]; woerter: [number, number]; szenen: [number, number]; szenenJePunkt: [number, number] };

/** Ziele für jedes Video: Wörter (fest), daraus Minuten, Sekunden, Szenen (50–100 Wörter je Szene). Eine Quelle für Seite, Schätzung und Worker. */
export function laengeZiel(): LaengeZiel {
  const w: [number, number] = [SKRIPT_WOERTER[0], SKRIPT_WOERTER[1]];
  const sek: [number, number] = [Math.round((w[0] / WOERTER_JE_MIN) * 60), Math.round((w[1] / WOERTER_JE_MIN) * 60)];
  return { minuten: [Math.round(sek[0] / 60), Math.round(sek[1] / 60)], sekunden: sek, woerter: w, szenen: [Math.ceil(w[0] / 100), Math.floor(w[1] / 50)], szenenJePunkt: [2, 4] };
}

/** Typischer Lauf: Zeichen Sprache (~6,6 je Wort), Bilder (1 je ~65 Wörter), Websuchen (Gliederung 3 + je Punkt bis 3),
 *  Tokens (abschnittsweise: ~12 kurze Aufrufe mit Gliederung/Quellen als Kontext).
 *  Whiteboard: statt eines Bildes je Szene ~4 Einzelmotive (ohne Wiederverwendung gerechnet = Obergrenze). */
export function typischFuer(stil: string | null = "vollbild") {
  const z = laengeZiel();
  const w = (z.woerter[0] + z.woerter[1]) / 2;
  const k = (x: number) => Math.round(x / 1000) * 1000;
  const szenen = Math.round(w / 65);
  const wb = stil === "whiteboard";
  // Whiteboard (B36.10): ~68 kurze Szenen, je ~1,5 neue Motive (Obergrenze der Schätzung ohne Bibliothek)
  const wbSzenen = (WB_SZENEN[0] + WB_SZENEN[1]) / 2;
  return { zeichen: Math.round((w * 6.6) / 100) * 100, bilder: wb ? 0 : szenen, motive: wb ? Math.round(wbSzenen * NEUE_MOTIVE_JE_SZENE) : 0, websuchen: 12, eingabeTokens: k(80_000 + w * 20), ausgabeTokens: k(5_000 + w * 6) };
}

/** Typischer Lauf (1.500–1.700 Wörter): ~10.600 Zeichen Sprache, ~25 Bilder, ~112k/15k Tokens. */
export const TYPISCH = typischFuer();

/**
 * B36.10 „Im neuen Takt neu machen“ (fertiges Whiteboard-Video): Gliederung und Quellen bleiben (keine Websuche, keine
 * Recherche), Skript in kurzen Szenen + Paket neu (Claude, ca. 70.000 Tokens Eingabe / 6.000 Ausgabe), Sprache neu mit
 * Wortzeiten (alle Zeichen – neue Szenen-Aufteilung), Motive nur neue: die bisherigen liegen in der Kanal-Bibliothek.
 */
/**
 * Anbieter-Störung (Claude, ElevenLabs oder OpenAI kurz nicht erreichbar, z. B. „HTTP 503: credential validation failed“):
 * Der Worker hat schon 2/4/8/16 s wiederholt. Dann versucht das Seller-System den Schritt selbst noch einmal – nach 10,
 * 30 und 60 Minuten –, bevor er als Fehler stehen bleibt. Fertige Teile bleiben, nichts wird doppelt bezahlt. Nicht bei
 * abgelehntem Schlüssel (401/403) oder abgelehntem Inhalt – da hilft Warten nicht.
 */
export const AUTO_NEU_MIN = [10, 30, 60] as const;
export function anbieterStoerung(fehler: string | null | undefined): boolean {
  const t = fehler ?? "";
  if (/\bHTTP 40[13]\b|Schlüssel abgelehnt/i.test(t)) return false;
  return /nach \d+ Versuchen nicht geklappt/.test(t) || /\bHTTP (429|5\d\d)\b/.test(t);
}
/** Zeitpunkt des nächsten automatischen Versuchs (null = keiner mehr bzw. keine Störung). */
export function autoNeuUm(fehler: string | null | undefined, bisher: number, jetzt = new Date()): Date | null {
  if (!anbieterStoerung(fehler)) return null;
  const min = AUTO_NEU_MIN[bisher];
  return min === undefined ? null : new Date(jetzt.getTime() + min * 60_000);
}

/** „Im neuen Takt neu machen“ geht, sobald kein Lauf aktiv ist: fertig, Fehler, wartet auf eine Freigabe (z. B. die
 *  Vorschau gefiel nicht) oder abgebrochen. */
export const taktNeuMoeglich = (status: string) => status === "fertig" || status === "fehler" || status === "freigabe" || status === "abgebrochen";

export function taktNeuSchaetzung(p: VideoPreise, modell: string | null, zeichen: number, bekannteMotive: number): { summe: number; positionen: { art: string; betrag: number | null }[]; neueMotive: number; fehlend: string[] } {
  const c = claudePreis(p, modell);
  const neueMotive = Math.max(10, Math.round(((WB_SZENEN[0] + WB_SZENEN[1]) / 2) * NEUE_MOTIVE_JE_SZENE) - bekannteMotive);
  const positionen = [
    { art: "Claude (Skript in kurzen Szenen, Paket)", betrag: (70_000 / 1e6) * c.eingabe + (6_000 / 1e6) * c.ausgabe },
    { art: `Sprache mit Wortzeiten (${zeichen.toLocaleString("de-DE")} Zeichen)`, betrag: p.elevenlabsJe1000Zeichen !== null ? (zeichen / 1000) * p.elevenlabsJe1000Zeichen : null },
    { art: `neue Motive (ca. ${neueMotive}, ${bekannteMotive} aus der Bibliothek)`, betrag: motivPreis(p) != null ? neueMotive * (motivPreis(p) as number) : null },
  ];
  const fehlend = positionen.filter((x) => x.betrag === null).map((x) => x.art.split(" (")[0]);
  return { summe: Math.round(positionen.reduce((n, x) => n + (x.betrag ?? 0), 0) * 100) / 100, positionen, neueMotive, fehlend };
}

export function kostenSchaetzung(p: VideoPreise, menge: ReturnType<typeof typischFuer> = TYPISCH, modell: string | null = VIDEO_MODELL_STANDARD, bildModell: string | null = BILD_MODELL_STANDARD): { summe: number; positionen: { art: string; betrag: number | null }[]; fehlend: string[] } {
  const c = claudePreis(p, modell);
  const bm = bildModellName(bildModell);
  const pos = [
    { art: "Claude (Recherche, Skript, Paket)", betrag: (menge.eingabeTokens / 1e6) * c.eingabe + (menge.ausgabeTokens / 1e6) * c.ausgabe },
    { art: "Websuche", betrag: p.websucheJe1000 !== null ? (menge.websuchen / 1000) * p.websucheJe1000 : null },
    { art: "Sprache (ElevenLabs)", betrag: p.elevenlabsJe1000Zeichen !== null ? (menge.zeichen / 1000) * p.elevenlabsJe1000Zeichen : null },
    ...(menge.bilder > 0 ? [{ art: `Bilder (${bm})`, betrag: p.bildJeStueck !== null ? menge.bilder * p.bildJeStueck : null }] : []),
    ...(menge.motive > 0 ? [{ art: `Motive (${bm}, ca. ${menge.motive} neue)`, betrag: motivPreis(p) != null ? menge.motive * (motivPreis(p) as number) : null }] : []),
  ];
  return { summe: Math.round(pos.reduce((a, x) => a + (x.betrag ?? 0), 0) * 100) / 100, positionen: pos.map((x) => ({ ...x, betrag: x.betrag === null ? null : Math.round(x.betrag * 100) / 100 })), fehlend: pos.filter((x) => x.betrag === null).map((x) => x.art) };
}

/** Kosten eines Anbieter-Aufrufs aus der Antwort (Tokens, Websuchen, Zeichen, Bilder). */
export function kostenPosition(anbieter: "anthropic" | "elevenlabs" | "openai", p: VideoPreise, m: { eingabe?: number; ausgabe?: number; websuchen?: number; zeichen?: number; bilder?: number; motiv?: boolean; modell?: string | null; bildModell?: string | null }, am = new Date()): VideoKosten[] {
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
  const preis = m.motiv ? motivPreis(p) : p.bildJeStueck;
  return [{ anbieter: "OpenAI", art: `${m.motiv ? "Motiv" : "Bild"}${m.bildModell ? ` (${bildModellName(m.bildModell)})` : ""}`, menge: m.bilder ?? 1, einheit: m.motiv ? "Motive" : "Bilder", betrag: preis != null ? r((m.bilder ?? 1) * preis) : null, am: iso }];
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
