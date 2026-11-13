import type { InstagramProfil, StoryInhaltsart, StoryThema } from "@/db/tables/video";
import { beilageLint, type BeilageBestaetigt } from "@/lib/abverkauf/kampagne-logic";
import { claudePreis, motivPreis, type VideoPreise } from "./logic";

// B37 Instagram-Stories (reine Logik, ohne Datenbank): Zeitplan, Themenwahl, Textregeln, Freigabe-Modus, Monatslimit,
// Zugangs-Ablauf. Fakten, Preise und Firmendaten kommen nur aus dem Kanalprofil (von Ludwig gepflegt) – nie aus dem Code.

export const STORY_ARTEN: Record<StoryInhaltsart, { name: string; werbung: boolean; hinweis: string }> = {
  preis: { name: "Preis-Story", werbung: true, hinweis: "Preis je Artikel netto, „all-in“ nur mit Aufzählung der Leistungen, Karton getrennt" },
  leistung: { name: "Leistungs-Story", werbung: true, hinweis: "eine Leistung mit den bestätigten Eckdaten aus den Fakten" },
  tipp: { name: "Prep-Tipp", werbung: false, hinweis: "kurzer Praxistipp für Amazon-Händler, keine Rechts- oder Steuerberatung" },
  einblick: { name: "Einblick", werbung: false, hinweis: "eigenes Lager-Foto ohne Personen; ohne neues Foto eine Illustration" },
  umfrage: { name: "Frage/Umfrage", werbung: false, hinweis: "Frage mit Umfrage-Sticker – den Sticker setzt du in der Instagram-App" },
  cta: { name: "Call-to-Action", werbung: true, hinweis: "Aufruf zur Anfrage über den Hinweis/Link aus dem Kanalprofil" },
};
export const istStoryArt = (x: unknown): x is StoryInhaltsart => typeof x === "string" && x in STORY_ARTEN;

export const FREIGABE_MODI = { jedes_mal: "Vorschau jedes Mal", stichprobe: "nur Stichprobe (jede 5. Story)", automatisch: "automatisch (ohne Freigabe)" } as const;
export type FreigabeModus = keyof typeof FREIGABE_MODI;
export const STICHPROBE_JEDE = 5;

/** Profil mit Vorgaben (täglich 12:00, 1 Story, alle Inhaltsarten, Freigabe jedes Mal, Hand-Animation an). */
export function profilMitVorgaben(p: InstagramProfil | null | undefined): Required<Omit<InstagramProfil, "monatslimit" | "hinweis" | "fakten">> & Pick<InstagramProfil, "monatslimit" | "hinweis" | "fakten"> {
  const q = p ?? {};
  const tage = (q.tage ?? [1, 2, 3, 4, 5, 6, 7]).filter((t) => Number.isInteger(t) && t >= 1 && t <= 7);
  const uhrzeiten = (q.uhrzeiten ?? ["12:00"]).filter((u) => /^([01]\d|2[0-3]):[0-5]\d$/.test(u));
  return {
    tage: [...new Set(tage)].sort(),
    uhrzeiten: uhrzeiten.length ? [...new Set(uhrzeiten)].sort() : ["12:00"],
    inhaltsarten: (q.inhaltsarten ?? (Object.keys(STORY_ARTEN) as StoryInhaltsart[])).filter(istStoryArt),
    farben: q.farben ?? { grund: "#ffffff", akzent: "#d62828", text: "#181818" },
    hand: q.hand !== false,
    hinweis: q.hinweis ?? null,
    werbung: q.werbung !== false,
    freigabeModus: q.freigabeModus === "stichprobe" || q.freigabeModus === "automatisch" ? q.freigabeModus : "jedes_mal",
    monatslimit: typeof q.monatslimit === "number" && q.monatslimit >= 0 ? q.monatslimit : null,
    fakten: q.fakten ?? null,
    themen: (q.themen ?? []).filter((t) => t && typeof t.text === "string" && t.text.trim() && istStoryArt(t.art)),
  };
}

/** „12:00, 18:30“ → ["12:00", "18:30"] (ungültige Angaben fallen weg). */
export function uhrzeitenAus(text: string | null | undefined): string[] {
  return [...new Set((text ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map((x) => (/^\d{1,2}$/.test(x) ? `${x.padStart(2, "0")}:00` : x.length === 4 ? `0${x}` : x)).filter((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)))].sort();
}

/** Themenliste aus Zeilen „art: Text“ (art = preis/leistung/tipp/einblick/umfrage/cta; ohne Angabe: tipp). Bestehende
 *  Themen behalten Kennung und „zuletzt genutzt“, wenn der Text gleich bleibt. */
export function themenAus(text: string, vorher: StoryThema[] = []): StoryThema[] {
  const alt = new Map(vorher.map((t) => [`${t.art}|${t.text}`, t]));
  const out: StoryThema[] = [];
  for (const zeile of text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean).slice(0, 100)) {
    const m = /^([a-zäöü-]+)\s*:\s*(.+)$/i.exec(zeile);
    const roh = m?.[1].toLowerCase().replace("frage", "umfrage").replace("call-to-action", "cta");
    const art: StoryInhaltsart = roh && istStoryArt(roh) ? roh : "tipp";
    const t = (m && istStoryArt(roh) ? m[2] : zeile).trim().slice(0, 300);
    const bekannt = alt.get(`${art}|${t}`);
    out.push(bekannt ?? { id: `t${(out.length + 1).toString(36)}${Math.random().toString(36).slice(2, 7)}`, text: t, art, genutztAm: null });
  }
  return out;
}

export const themenText = (themen: StoryThema[]) => themen.map((t) => `${t.art}: ${t.text}`).join("\n");

const BERLIN = "Europe/Berlin";
function berlinVersatzMin(d: Date): number {
  const teile = new Intl.DateTimeFormat("en-US", { timeZone: BERLIN, timeZoneName: "shortOffset" }).formatToParts(d);
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(teile.find((t) => t.type === "timeZoneName")?.value ?? "GMT+1");
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 60;
}
/** Wochentag in Berlin, 1 = Montag … 7 = Sonntag. */
function wochentag(tag: string): number {
  const d = new Date(`${tag}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Post-Zeitpunkte (UTC) im Fenster [von, bis] nach Zeitplan (Tage, Uhrzeiten Berlin). */
export function slots(p: { tage: number[]; uhrzeiten: string[] }, von: Date, bis: Date): Date[] {
  const out: Date[] = [];
  const start = new Date(von.getTime() - 86_400_000);
  for (let t = start.getTime(); t <= bis.getTime() + 86_400_000; t += 86_400_000) {
    const tag = new Intl.DateTimeFormat("sv-SE", { timeZone: BERLIN }).format(new Date(t));
    if (!p.tage.includes(wochentag(tag))) continue;
    for (const u of p.uhrzeiten) {
      const roh = new Date(`${tag}T${u}:00Z`);
      const d = new Date(roh.getTime() - berlinVersatzMin(roh) * 60_000);
      if (d >= von && d <= bis && !out.some((x) => x.getTime() === d.getTime())) out.push(d);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Nächstes Thema: zuerst nie genutzte, sonst das am längsten nicht genutzte – nur erlaubte Inhaltsarten. „Einblick“ nur,
 * wenn ein ungenutztes Foto da ist (der Anteil richtet sich so nach der Zahl neuer Fotos); sonst bekommt ein
 * Einblick-Thema eine Illustration, wenn kein anderes Thema mehr übrig ist.
 */
export function naechstesThema(themen: StoryThema[], erlaubt: StoryInhaltsart[], fotosFrei: number, schonGeplant: string[] = []): StoryThema | null {
  const kandidaten = themen.filter((t) => erlaubt.includes(t.art) && !schonGeplant.includes(t.id));
  const sortiert = [...kandidaten].sort((a, b) => (a.genutztAm ?? "").localeCompare(b.genutztAm ?? "") || themen.indexOf(a) - themen.indexOf(b));
  return sortiert.find((t) => t.art !== "einblick" || fotosFrei > 0) ?? sortiert[0] ?? null;
}

/** Freigabe nötig? „jedes Mal“ immer; „Stichprobe“ jede 5. Story (und immer bei Regel-Treffern); „automatisch“ nie. */
export function freigabeNoetig(modus: FreigabeModus, nr: number, regelTreffer: number): boolean {
  if (regelTreffer > 0) return true;
  if (modus === "automatisch") return false;
  if (modus === "stichprobe") return nr % STICHPROBE_JEDE === 1;
  return true;
}

const VERSICHERUNG = /versicher|haftpflicht|warenversicherung|abgesichert gegen/i;
const MARKEN = /\b(amazon[- ]?logo|prime[- ]?logo|ebay[- ]?logo)\b/i;
const HEIL = /\b(garantiert|100\s?%\s?sicher|risikofrei|ohne risiko)\b/i;

/**
 * Regeln für Story-Texte (B37.4/B37.7 + B34.3): Beilagen-Regeln (all-in nur mit Aufzählung, kein Komplettpreis, Zählung
 * nie kostenlos/Pflicht, Preise netto, unbelegte Angaben), keine Aussagen zur Versicherung, keine fremden Logos, nichts
 * Irreführendes; Werbekennzeichnung bei Preis/Leistung/CTA, wenn im Kanal eingeschaltet. Leer = in Ordnung.
 */
export function storyRegeln(text: string, o: { art: StoryInhaltsart; werbungAn: boolean; werbungGesetzt: boolean; bestaetigt?: BeilageBestaetigt }): string[] {
  const fehler = [...beilageLint(text, o.bestaetigt ?? { flaeche: false, nda: false, gefahrgut: false }).fehler];
  if (VERSICHERUNG.test(text)) fehler.push("Keine Aussagen zur Versicherung der Ware (es gibt keine Warenversicherung durch das Prep-Center)");
  if (MARKEN.test(text)) fehler.push("Keine fremden Marken/Logos verwenden");
  if (HEIL.test(text)) fehler.push("Nichts Irreführendes („garantiert“, „risikofrei“ …)");
  if (o.werbungAn && STORY_ARTEN[o.art].werbung && !o.werbungGesetzt) fehler.push("Werbekennzeichnung „Werbung“ fehlt");
  return fehler;
}

/** Kosten-Schätzung je Story ($): ein kurzer Claude-Aufruf (Text) + ein Motiv (entfällt bei Foto oder wiederverwendetem Motiv). */
export function storyKosten(p: VideoPreise, modell: string | null, mitMotiv = true): { summe: number; fehlend: string[] } {
  const c = claudePreis(p, modell);
  const text = (3_000 / 1e6) * c.eingabe + (500 / 1e6) * c.ausgabe;
  const motiv = mitMotiv ? motivPreis(p) : 0;
  return { summe: Math.round((text + (motiv ?? 0)) * 1000) / 1000, fehlend: mitMotiv && motiv == null ? ["Preis je Motiv/Bild"] : [] };
}

/** Monatslimit: erreicht, wenn die Kosten des Monats ≥ Limit sind (kein Limit = nie). */
export function limitErreicht(monatKosten: number, limit: number | null | undefined, naechste = 0): boolean {
  return typeof limit === "number" && limit >= 0 && monatKosten + naechste > limit + 1e-9;
}

/** Instagram-Zugang: Warnung 7 Tage vor Ablauf, danach „abgelaufen“ (Meldung statt Fehler). */
export function tokenStand(bis: Date | null, jetzt = new Date()): { stand: "fehlt" | "ok" | "bald" | "abgelaufen"; tage: number | null } {
  if (!bis) return { stand: "fehlt", tage: null };
  const tage = Math.floor((bis.getTime() - jetzt.getTime()) / 86_400_000);
  if (bis.getTime() <= jetzt.getTime()) return { stand: "abgelaufen", tage };
  return { stand: tage < 7 ? "bald" : "ok", tage };
}

/** Wiederholung beim Posten: höchstens 3 Wiederholungen nach 5, 15, 45 Minuten, danach Meldung. */
export const POST_WARTEN_MIN = [5, 15, 45] as const;
export function naechsterVersuch(versuche: number, jetzt = new Date()): Date | null {
  const w = POST_WARTEN_MIN[versuche - 1];
  return w === undefined ? null : new Date(jetzt.getTime() + w * 60_000);
}

export const STORY_STATUS_TEXT: Record<string, string> = { geplant: "geplant (wird automatisch gepostet)", manuell: "bereit – von Hand posten", gepostet: "gepostet", fehler: "nicht gepostet" };
