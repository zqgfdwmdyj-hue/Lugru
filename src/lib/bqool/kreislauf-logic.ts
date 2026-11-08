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

const cent = (n: number) => Math.round(n * 100);
const geld = (n: number | null) => (n === null ? "–" : n.toFixed(2).replace(".", ","));

/** Nachkontrolle: Regel und Min je hochgeladener SKU gegen das BQool-Ist (Schlüssel „Land|SKU“). */
export function nachkontrolle(hochgeladen: { land: string; sku: string; regel: string; min: number }[], ist: Map<string, { regel: string | null; min: number | null }>): BqoolKontrolle {
  const abweichungen: BqoolKontrolle["abweichungen"] = [];
  for (const z of hochgeladen) {
    const i = ist.get(`${z.land}|${z.sku}`);
    if (!i) {
      abweichungen.push({ land: z.land, sku: z.sku, text: "nicht im BQool-Export" });
      continue;
    }
    const teile: string[] = [];
    if ((i.regel ?? "").trim().toLowerCase() !== z.regel.trim().toLowerCase()) teile.push(`Regel „${i.regel ?? "–"}“ statt „${z.regel}“`);
    if (i.min === null || cent(i.min) !== cent(z.min)) teile.push(`Min ${geld(i.min)} statt ${geld(z.min)}`);
    if (teile.length) abweichungen.push({ land: z.land, sku: z.sku, text: teile.join(", ") });
  }
  const ok = hochgeladen.length - abweichungen.length;
  const text = !hochgeladen.length ? "Nichts hochgeladen – nichts zu prüfen." : abweichungen.length ? `${mehr(abweichungen.length, "Abweichung", "Abweichungen")} bei ${mehr(hochgeladen.length, "SKU", "SKUs")} – Min/Regel in BQool anders als hochgeladen.` : `Min und Regel stimmen bei allen ${mehr(hochgeladen.length, "SKU", "SKUs")}.`;
  return { geprueft: hochgeladen.length, ok, abweichungen, text };
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
