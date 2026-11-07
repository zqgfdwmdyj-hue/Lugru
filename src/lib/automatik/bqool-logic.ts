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

/** B31.5: Berichtsseiten („Listing Performance“, „Daily Sales“) je Land – DE eingetragen, FR/IT/ES abgeleitet. */
export function bqoolBerichtAdressen(cfg: Record<string, string | null | undefined>, feld: "leistungUrl" | "tagesUrl", laender: readonly string[]): { land: string; url: string }[] {
  const de = (cfg[feld] ?? "").trim() || null;
  return laender.map((land) => ({ land, url: bqoolAbleiten(de, land as BqoolLand) })).filter((x): x is { land: string; url: string } => !!x.url);
}

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

export type BqoolLandErgebnis = {
  land: string;
  datei: string;
  zeilen: number;
  ok: boolean;
  fehler?: string;
  /** Hochgeladen, aber keine Bestätigung erkannt – kein Fehler, bitte in BQool prüfen. */
  unklar?: boolean;
  wie?: string;
  /** B31.2: Rückmeldung von BQool – Anzahl übernommen/fehlerhaft (wenn genannt) und Fehlerzeilen mit SKU. */
  uebernommen?: number | null;
  fehlerAnzahl?: number | null;
  fehlerZeilen?: { sku: string; text: string }[];
};

/** SKUs einer BQool-Datei (Spalte „SellerSKU“). */
export function bqoolSkus(text: string): string[] {
  const zeilen = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const kopf = (zeilen[1] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  const i = kopf.indexOf("sellersku");
  return i < 0 ? [] : zeilen.slice(2).map((z) => (z.split("\t")[i] ?? "").trim()).filter(Boolean);
}

/** „DE: 824 Zeilen hochgeladen · FR: Fehler Login“ */
export const zeilenText = (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Zeile" : "Zeilen"}`;

export function bqoolErgebnisText(r: BqoolLandErgebnis[]): string {
  const rm = (x: BqoolLandErgebnis) => (x.uebernommen !== undefined && x.uebernommen !== null ? `, ${x.uebernommen.toLocaleString("de-DE")} übernommen` : "") + (x.fehlerAnzahl ? `, ${x.fehlerAnzahl} Fehlerzeile${x.fehlerAnzahl === 1 ? "" : "n"}` : "");
  return r.map((x) => (x.ok ? `${x.land}: ${zeilenText(x.zeilen)} hochgeladen${rm(x)}` : x.unklar ? `${x.land}: ${zeilenText(x.zeilen)} hochgeladen, Bestätigung nicht erkannt – bitte in BQool prüfen` : `${x.land}: Fehler – ${x.fehler ?? "unbekannt"}`)).join(" · ");
}

type ProtokollEintrag = { zeit: string; land?: string; ok?: boolean; unklar?: boolean };

/** Status einer Übertragung aus dem jeweils letzten Upload je Land (nach Bestätigen von Hand neu berechnet). */
export function bqoolStatusAusProtokoll(protokoll: ProtokollEintrag[]): "fertig" | "teilweise" | "fehler" | "pruefen" | null {
  const letzte = new Map<string, ProtokollEintrag>();
  for (const p of [...protokoll].filter((x) => x.land).sort((a, b) => a.zeit.localeCompare(b.zeit))) letzte.set(p.land!, p);
  const l = [...letzte.values()];
  if (!l.length) return null;
  const fehler = l.filter((x) => !x.ok && !x.unklar).length;
  const ok = l.filter((x) => x.ok).length;
  if (fehler) return ok || l.some((x) => x.unklar) ? "teilweise" : "fehler";
  return l.some((x) => x.unklar) ? "pruefen" : "fertig";
}

/** B31.2: Export-Seite je Land (Ist holen: „Repricing Central File – Full Template“ bzw. „Manage Listings“). */
export const bqoolExportFeld = (land: BqoolLand) => (land === "DE" ? "exportUrl" : `exportUrl${land}`);

/** B31.2: Export-Adresse je Land: eigenes Feld, sonst (FR/IT/ES) aus der DE-Adresse abgeleitet (amazonde → amazonfr). */
export function bqoolExportAdressen(cfg: Record<string, string | null | undefined>): BqoolAdresse[] {
  const de = (cfg.exportUrl ?? "").trim() || null;
  return BQOOL_LAENDER.map((land) => {
    const eigen = (cfg[bqoolExportFeld(land)] ?? "").trim() || null;
    if (eigen) return { land, url: eigen, abgeleitet: false };
    const ab = BQOOL_ABGELEITET.has(land) ? bqoolAbleiten(de, land) : null;
    return { land, url: ab, abgeleitet: Boolean(ab) };
  });
}
