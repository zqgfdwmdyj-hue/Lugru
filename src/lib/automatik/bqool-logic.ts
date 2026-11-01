// B23: BQool-Upload je Land – reine Logik. BQool hat je Marktplatz eine eigene Upload-Seite
// (…/repricing/amazonde/upload, …/amazonfr/upload …). FR/IT/ES werden aus der DE-Adresse vorbelegt, weitere Länder
// nur, wenn eingetragen (leer = nicht hochladen).

export const BQOOL_LAENDER = ["DE", "FR", "IT", "ES", "NL", "BE", "PL", "SE", "UK"] as const;
export type BqoolLand = (typeof BQOOL_LAENDER)[number];
/** Diese Länder werden aus der DE-Adresse abgeleitet, wenn kein eigenes Feld gefüllt ist. */
export const BQOOL_ABGELEITET = new Set<BqoolLand>(["FR", "IT", "ES"]);

/** Konfigurationsfeld je Land (DE ist das bisherige Feld „uploadUrl“). */
export const bqoolFeld = (land: BqoolLand) => (land === "DE" ? "uploadUrl" : `uploadUrl${land}`);

/** Aus der DE-Adresse die Adresse eines anderen Landes ableiten (amazonde → amazonfr); null, wenn nicht möglich. */
export function bqoolAbleiten(deUrl: string | null | undefined, land: BqoolLand): string | null {
  if (!deUrl) return null;
  if (land === "DE") return deUrl;
  const code = land === "UK" ? "uk" : land.toLowerCase();
  return /amazonde/i.test(deUrl) ? deUrl.replace(/amazonde/i, `amazon${code}`) : null;
}

export type BqoolAdresse = { land: BqoolLand; url: string | null; abgeleitet: boolean };

/** Upload-Adresse je Land: eigenes Feld, sonst (FR/IT/ES) aus DE abgeleitet. */
export function bqoolUploadAdressen(cfg: Record<string, string | null | undefined>): BqoolAdresse[] {
  const de = (cfg.uploadUrl ?? "").trim() || null;
  return BQOOL_LAENDER.map((land) => {
    const eigen = (cfg[bqoolFeld(land)] ?? "").trim() || null;
    if (eigen) return { land, url: eigen, abgeleitet: false };
    const ab = BQOOL_ABGELEITET.has(land) ? bqoolAbleiten(de, land) : null;
    return { land, url: ab, abgeleitet: Boolean(ab) };
  });
}

/** Datenzeilen einer BQool-Datei (ohne die zwei Kopfzeilen und Leerzeilen). */
export function bqoolZeilen(text: string): number {
  return Math.max(0, text.split("\n").filter((z) => z.trim()).length - 2);
}

export type BqoolLandErgebnis = { land: string; datei: string; zeilen: number; ok: boolean; fehler?: string };

/** „DE: 824 Zeilen hochgeladen · FR: Fehler Login“ */
export const zeilenText = (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Zeile" : "Zeilen"}`;

export function bqoolErgebnisText(r: BqoolLandErgebnis[]): string {
  return r.map((x) => (x.ok ? `${x.land}: ${zeilenText(x.zeilen)} hochgeladen` : `${x.land}: Fehler – ${x.fehler ?? "unbekannt"}`)).join(" · ");
}
