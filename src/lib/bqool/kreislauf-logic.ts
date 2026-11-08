// B31.2 Täglicher BQool-Kreislauf – reine Logik (tests/bqool-kreislauf.test.ts): Fristen für die Freigabe, wann
// automatisch hochgeladen werden darf, Texte für Push und Morgenbericht, BQool-Rückmeldung nach dem Upload lesen und
// die Nachkontrolle (Ist 30 Minuten später gegen die hochgeladene Datei).

import type { BqoolKontrolle, BqoolLaufZusammenfassung, BqoolUploadLand } from "@/db/tables/bqool";

export const KREISLAUF_UHRZEIT = "06:00";
/** Nachkontrolle frühestens so viele Minuten nach dem Upload. */
export const KONTROLLE_MINUTEN = 30;

const BERLIN = "Europe/Berlin";
export const tagBerlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: BERLIN }).format(d);
export const uhrBerlin = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: BERLIN, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** Zeitpunkt „Tag HH:MM“ in Berlin (Sommer-/Winterzeit richtig). */
export function berlinZeit(tag: string, hhmm: string): Date {
  const roh = new Date(`${tag}T${hhmm}:00Z`);
  const wand = new Intl.DateTimeFormat("sv-SE", { timeZone: BERLIN, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(roh);
  const versatz = new Date(`${wand.replace(" ", "T")}:00Z`).getTime() - roh.getTime();
  return new Date(roh.getTime() - versatz);
}

/**
 * Freigabe-Fristen: Erinnerung ab 12:00, Verfall ab 18:00 (Berlin) – bei einem späten Lauf (z. B. „Jetzt starten“ am
 * Nachmittag) frühestens 2 bzw. 6 Stunden nach der Meldung, damit Zeit zum Freigeben bleibt.
 */
export function freigabeFristen(erstellt: Date): { erinnerung: Date; verfall: Date } {
  const tag = tagBerlin(erstellt);
  const t = erstellt.getTime();
  return { erinnerung: new Date(Math.max(berlinZeit(tag, "12:00").getTime(), t + 2 * 3_600_000)), verfall: new Date(Math.max(berlinZeit(tag, "18:00").getTime(), t + 6 * 3_600_000)) };
}

/**
 * Darf ohne Freigabe hochgeladen werden? Nur wenn Ludwig „täglich automatisch hochladen“ eingeschaltet UND das
 * Min-Verhalten in BQool bestätigt hat – und nie bei Regelwechsel oder Min unter Break-even.
 */
export function autoFreigabe(o: { automatisch: boolean; minGeprueft: boolean; regelWechsel: number; unterBreakEven: number }): { ok: boolean; grund: string } {
  if (!o.automatisch) return { ok: false, grund: "Freigabe nötig (automatisch hochladen ist aus)" };
  if (!o.minGeprueft) return { ok: false, grund: "Freigabe nötig – Min-Verhalten in BQool noch nicht bestätigt" };
  if (o.regelWechsel) return { ok: false, grund: `Freigabe nötig – ${o.regelWechsel} Regelwechsel` };
  if (o.unterBreakEven) return { ok: false, grund: `Freigabe nötig – ${o.unterBreakEven}× Min unter Break-even` };
  return { ok: true, grund: "automatisch freigegeben (kein Regelwechsel, kein Min unter Break-even)" };
}

const REIHE = ["DE", "FR", "IT", "ES", "NL", "BE", "PL", "SE", "UK"];
const rang = (l: string) => (REIHE.indexOf(l) < 0 ? 99 : REIHE.indexOf(l));

/** „DE 133 / FR 114 / IT 122 / ES 85“ */
export function jeLandText(je: Record<string, number>): string {
  return Object.entries(je)
    .sort((a, b) => rang(a[0]) - rang(b[0]))
    .map(([l, n]) => `${l} ${n.toLocaleString("de-DE")}`)
    .join(" / ");
}

const mehr = (n: number, eins: string, viele: string) => `${n.toLocaleString("de-DE")} ${n === 1 ? eins : viele}`;

/** „DE 133 / FR 114 / IT 122 / ES 85 Änderungen, 7 Regelwechsel, 44 Warnungen“ */
export function freigabeText(z: BqoolLaufZusammenfassung): string {
  return `${jeLandText(z.jeLand)} Änderungen, ${mehr(z.regelWechsel, "Regelwechsel", "Regelwechsel")}, ${mehr(z.warnungen, "Warnung", "Warnungen")}${z.liquidation ? ` (davon ${z.liquidation} auf Liquidation wegen Min unter Marge)` : ""}${z.unterBreakEven ? `, ${z.unterBreakEven}× Min unter Break-even` : ""}`;
}

const ZAHL = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+)`;
const zahl = (s: string) => Number(s.replace(/[.,]/g, ""));
const UEBERNOMMEN = [
  new RegExp(`${ZAHL}\\s*(?:rows?|records?|skus?|listings?|items?|zeilen|datensätze|artikel)?\\s*(?:were\\s+|wurden\\s+)?(?:successfully\\s+|erfolgreich\\s+)?(?:succeeded|successful|success|updated|imported|processed|übernommen|aktualisiert|importiert|verarbeitet)`, "i"),
  new RegExp(`(?:success(?:ful)?|succeeded|updated|erfolgreich|übernommen|aktualisiert)\\s*[:=]\\s*${ZAHL}`, "i"),
];
const FEHLER_ANZ = [new RegExp(`${ZAHL}\\s*(?:rows?|records?|skus?|listings?|items?|zeilen)?\\s*(?:failed|errors?|fehler(?:haft)?|abgelehnt|rejected)`, "i"), new RegExp(`(?:failed|errors?|fehler|abgelehnt|rejected)\\s*[:=]\\s*${ZAHL}`, "i")];
const FEHLER_WORT = /error|fehler|invalid|failed|rejected|abgelehnt|nicht (?:gefunden|übernommen)|not found|missing/i;

/**
 * BQool-Rückmeldung nach dem Upload lesen: Anzahl übernommen und Fehler (wenn BQool sie nennt) sowie Fehlerzeilen –
 * Zeilen der Seite, die eine SKU aus der Datei und ein Fehlerwort enthalten.
 */
export function rueckmeldungLesen(text: string, skus: string[]): { uebernommen: number | null; fehler: number | null; fehlerZeilen: { sku: string; text: string }[] } {
  const erste = (res: RegExp[]) => {
    for (const re of res) {
      const m = re.exec(text);
      if (m) return zahl(m[1]);
    }
    return null;
  };
  const bekannt = [...new Set(skus.filter(Boolean))].sort((a, b) => b.length - a.length);
  const fehlerZeilen: { sku: string; text: string }[] = [];
  const gesehen = new Set<string>();
  for (const zeile of text.split(/\r?\n/)) {
    if (!FEHLER_WORT.test(zeile)) continue;
    const sku = bekannt.find((s) => zeile.includes(s));
    if (!sku || gesehen.has(sku)) continue;
    gesehen.add(sku);
    fehlerZeilen.push({ sku, text: zeile.trim().slice(0, 200) });
  }
  const fehler = erste(FEHLER_ANZ);
  return { uebernommen: erste(UEBERNOMMEN), fehler: fehler ?? (fehlerZeilen.length ? fehlerZeilen.length : null), fehlerZeilen };
}

// ---- B33.6 Processing Report der Uploads und BQool-Zeit ---------------------------------------------------------

/**
 * Fehlerzeilen aus einem BQool-„Processing Report“ (Text, HTML oder Tab-Datei): Zeilen mit Fehlerwort; SKU aus „SKU: …“,
 * „SellerSKU“-Spalte oder bekannter SKU. Ohne erkennbare SKU steht „?“.
 */
export function processingReportZeilen(roh: string, skus: string[] = []): { sku: string; text: string }[] {
  const text = roh
    .replace(/<\/(tr|p|div|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const zeilen = text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const kopf = zeilen.find((z) => z.includes("\t") && z.split("\t").some((h) => /^(seller\s*sku|sku)$/i.test(h.trim())));
  const spalte = kopf ? kopf.split("\t").findIndex((h) => /^(seller\s*sku|sku)$/i.test(h.trim())) : -1;
  const bekannt = [...new Set(skus.filter(Boolean))].sort((a, b) => b.length - a.length);
  const out: { sku: string; text: string }[] = [];
  for (const z of zeilen) {
    if (z === kopf || !FEHLER_WORT.test(z) || /^\d+\s*(errors?|fehler)\s*$/i.test(z) || /view processing report|processing report/i.test(z)) continue;
    const ausSpalte = spalte >= 0 && z.includes("\t") ? (z.split("\t")[spalte] ?? "").trim() : "";
    const sku = bekannt.find((x) => z.includes(x)) || ausSpalte || /\bSKU\b[:\s]+([A-Za-z0-9._\-]+)/i.exec(z)?.[1] || "?";
    out.push({ sku, text: z.replace(/\t+/g, " · ").slice(0, 200) });
  }
  return out;
}

/** BQool-Versatz „+02:00“ → Minuten (Standard 120: BQool zeigt UTC+02:00, im November 1 Stunde später als Deutschland). */
export function versatzMinuten(v: string | null | undefined): number {
  const m = /([+-])\s*(\d{1,2})(?::?(\d{2}))?/.exec(v ?? "");
  if (!m) return 120;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/**
 * Zeitangabe aus BQool („11/07/2026 3:32 PM“, „2026-11-07 15:32“, „07.11.2026 15:32“) in UTC (ISO) und deutsche Zeit
 * („07.11., 14:32“). null, wenn nicht lesbar.
 */
export function bqoolZeit(roh: string, versatz = 120): { iso: string; berlin: string } | null {
  let j: number, mo: number, t: number, h: number, mi: number;
  let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(roh);
  if (m) {
    [mo, t, j, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
    if (m[6]) h = (h % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0);
  } else if ((m = /(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})/.exec(roh))) {
    [j, mo, t, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  } else if ((m = /(\d{1,2})\.(\d{1,2})\.(\d{4})[ ,]+(\d{1,2}):(\d{2})/.exec(roh))) {
    [t, mo, j, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  } else return null;
  const utc = Date.UTC(j, mo - 1, t, h, mi) - versatz * 60_000;
  if (!Number.isFinite(utc)) return null;
  const d = new Date(utc);
  const tag = tagBerlin(d);
  return { iso: d.toISOString(), berlin: `${tag.slice(8, 10)}.${tag.slice(5, 7)}., ${uhrBerlin(d)}` };
}

export type UploadFehler = { land: string; zeitBqool: string; zeitDe: string | null; iso: string | null; datei: string | null; fehlerAnzahl: number | null; zeilen: { sku: string; text: string }[] };

/** Hinweistext je Upload: „DE 07.11., 14:32 (BQool 3:32 PM): 1 Fehler – TEST-SKU-1: Invalid Min Price“. */
export function uploadFehlerText(f: UploadFehler): string {
  const zeit = f.zeitDe ? `${f.zeitDe} (BQool ${f.zeitBqool})` : f.zeitBqool;
  const n = f.fehlerAnzahl ?? f.zeilen.length;
    const rest = (z: { sku: string; text: string }) => {
    const i = z.sku !== "?" ? z.text.indexOf(z.sku) : -1;
    return (i >= 0 ? z.text.slice(i + z.sku.length) : z.text).replace(/^[\s·:–-]+/, "");
  };
  return `${f.land} ${zeit}${f.datei ? ` ${f.datei}` : ""}: ${n} Fehler${f.zeilen.length ? ` – ${f.zeilen.map((z) => `${z.sku}: ${rest(z)}`).join(" · ")}` : " – Inhalt nicht lesbar"}`;
}

const cent = (n: number) => Math.round(n * 100);
const geld = (n: number | null) => (n === null ? "–" : n.toFixed(2).replace(".", ","));

export const RESET_HINWEIS = "Min wird täglich zurückgesetzt – kein Fehler";

/**
 * Nachkontrolle: Regel und Min je hochgeladener SKU gegen das BQool-Ist (Schlüssel „Land|SKU“), mit Min vorher/Datei/
 * nachher (B33.6). Bei Regeln mit täglichem Margen-Reset (ia, Abverkauf) ist ein anderer Min kein Fehler, sondern ein
 * Hinweis; bei Liquidation (fester Min) und Regeln ohne Reset ist er ein Fehler.
 */
export function nachkontrolle(hochgeladen: { land: string; sku: string; regel: string; min: number; minVorher?: number | null; minReset?: boolean }[], ist: Map<string, { regel: string | null; min: number | null }>): BqoolKontrolle {
  const abweichungen: BqoolKontrolle["abweichungen"] = [];
  const hinweise: NonNullable<BqoolKontrolle["hinweise"]> = [];
  const minVergleich: NonNullable<BqoolKontrolle["minVergleich"]> = [];
  for (const z of hochgeladen) {
    const i = ist.get(`${z.land}|${z.sku}`);
    const vorher = z.minVorher ?? null;
    if (!i) {
      abweichungen.push({ land: z.land, sku: z.sku, text: "nicht im BQool-Export" });
      minVergleich.push({ land: z.land, sku: z.sku, regel: z.regel, vorher, datei: z.min, nachher: null, status: "fehlt" });
      continue;
    }
    const teile: string[] = [];
    const regelGleich = (i.regel ?? "").trim().toLowerCase() === z.regel.trim().toLowerCase();
    if (!regelGleich) teile.push(`Regel „${i.regel ?? "–"}“ statt „${z.regel}“`);
    const minGleich = i.min !== null && cent(i.min) === cent(z.min);
    const vn = `Min vorher ${geld(vorher)} / Datei ${geld(z.min)} / nachher ${geld(i.min)}`;
    let status: "gleich" | "reset" | "fehler" = "gleich";
    if (!minGleich) {
      if (z.minReset && regelGleich && i.min !== null) {
        status = "reset";
        hinweise.push({ land: z.land, sku: z.sku, text: `${vn} – ${RESET_HINWEIS}` });
      } else {
        status = "fehler";
        teile.push(`${vn}${z.minReset ? "" : " – Min hätte stehen bleiben müssen"}`);
      }
    }
    minVergleich.push({ land: z.land, sku: z.sku, regel: z.regel, vorher, datei: z.min, nachher: i.min, status: teile.length ? "fehler" : status });
    if (teile.length) abweichungen.push({ land: z.land, sku: z.sku, text: teile.join(", ") });
  }
  const ok = hochgeladen.length - abweichungen.length;
  const reset = hinweise.length ? ` ${mehr(hinweise.length, "SKU", "SKUs")} mit anderem Min bei Regel mit täglichem Reset – kein Fehler.` : "";
  const text = !hochgeladen.length ? "Nichts hochgeladen – nichts zu prüfen." : abweichungen.length ? `${mehr(abweichungen.length, "Abweichung", "Abweichungen")} bei ${mehr(hochgeladen.length, "SKU", "SKUs")} – Min/Regel in BQool anders als hochgeladen.${reset}` : `Min und Regel stimmen bei allen ${mehr(hochgeladen.length, "SKU", "SKUs")}.${reset}`;
  return { geprueft: hochgeladen.length, ok, abweichungen, text, minVergleich, hinweise };
}

/** Übernommen je Land (BQool-Rückmeldung, sonst die Zeilen der Datei, wenn der Upload ok war). */
export function uebernommenJeLand(u: BqoolUploadLand[]): { jeLand: Record<string, number>; fehler: number } {
  const jeLand: Record<string, number> = {};
  let fehler = 0;
  for (const x of u) {
    if (x.ok || x.unklar) jeLand[x.land] = x.uebernommen ?? x.zeilen;
    fehler += x.fehler ?? x.fehlerZeilen.length;
  }
  return { jeLand, fehler };
}

export type LaufKurz = {
  freigabe: string | null;
  freigabeAm: Date | null;
  uploadStatus: string | null;
  upload: BqoolUploadLand[] | null;
  zusammenfassung: BqoolLaufZusammenfassung | null;
  phase: string;
  fehler?: string | null;
};

/**
 * Morgenbericht: „BQool-Upload gestern: freigegeben 12:10, DE 133 / FR 114 … übernommen, 0 Fehler“ bzw. „wartet auf
 * Freigabe“ (heutiger Lauf). null = nichts zu melden.
 */
export function morgenZeile(gestern: LaufKurz | null, heute: LaufKurz | null): string | null {
  const teile: string[] = [];
  if (gestern) {
    if (gestern.upload?.length && gestern.uploadStatus) {
      const u = uebernommenJeLand(gestern.upload);
      const wie = gestern.freigabe === "automatisch" ? `automatisch ${gestern.freigabeAm ? uhrBerlin(gestern.freigabeAm) : ""}`.trim() : `freigegeben ${gestern.freigabeAm ? uhrBerlin(gestern.freigabeAm) : ""}`.trim();
      teile.push(`BQool-Upload gestern: ${wie}, ${Object.keys(u.jeLand).length ? `${jeLandText(u.jeLand)} übernommen` : "nichts übernommen"}, ${mehr(u.fehler, "Fehler", "Fehler")}${gestern.uploadStatus === "pruefen" ? " (Bestätigung bitte prüfen)" : gestern.uploadStatus === "fehler" ? " (Upload abgebrochen)" : ""}`);
    } else if (gestern.freigabe === "verfallen") teile.push("BQool-Upload gestern: nicht freigegeben (verfallen)");
    else if (gestern.freigabe === "nicht_noetig") teile.push("BQool gestern: keine Änderungen");
    else if (gestern.phase === "abgebrochen") teile.push(`BQool gestern: abgebrochen${gestern.fehler ? ` – ${gestern.fehler.slice(0, 80)}` : ""}`);
  }
  if (heute?.freigabe === "offen") teile.push(`BQool-Upload wartet auf Freigabe${heute.zusammenfassung ? ` (${jeLandText(heute.zusammenfassung.jeLand)})` : ""}`);
  return teile.length ? teile.join(" · ") : null;
}

/** „heute 06:05“, „gestern 06:05“, „30.10., 06:05“, „noch nie“. */
export function standText(am: Date | null, jetzt = new Date()): string {
  if (!am) return "noch nie";
  const tag = tagBerlin(am);
  const heute = tagBerlin(jetzt);
  const gestern = tagBerlin(new Date(jetzt.getTime() - 86_400_000));
  if (tag === heute) return `heute ${uhrBerlin(am)}`;
  if (tag === gestern) return `gestern ${uhrBerlin(am)}`;
  return `${tag.slice(8, 10)}.${tag.slice(5, 7)}., ${uhrBerlin(am)}`;
}
