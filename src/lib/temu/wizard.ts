// Temu-Assistent: Stand je eBay-Angebot in sechs klaren Zuständen und was noch fehlt, bevor es zu
// Temu kann. Reine Logik (auch im Browser genutzt) – die Pflichtangaben entsprechen temuGoodsProblems.

import type { TemuPackage } from "./goods";

export type WizardStatus = "entwurf" | "pruefen" | "unvollstaendig" | "in-arbeit" | "veroeffentlicht" | "fehlgeschlagen";

/** „vollständig ausgefüllt“ (pruefen) ist nicht dasselbe wie „geprüft“ (entwurf = bereit). */
export const WIZARD_STATUS: Record<WizardStatus, { label: string; cls: string; hint: string }> = {
  entwurf: { label: "bereit", cls: "tag-ok", hint: "Vollständig und geprüft – kann zu Temu." },
  pruefen: { label: "prüfen", cls: "tag-warn", hint: "Alles ausgefüllt, aber noch nicht geprüft – z. B. Paket nur aus dem Standard. Tatsächliche Versandmaße bestätigen." },
  unvollstaendig: { label: "unvollständig", cls: "tag-warn", hint: "Es fehlen Angaben, bevor Temu das Angebot annimmt." },
  "in-arbeit": { label: "in Arbeit", cls: "tag-info", hint: "Wird übertragen oder Temu prüft noch." },
  veroeffentlicht: { label: "veröffentlicht", cls: "tag-ok", hint: "Bei Temu aktiv." },
  fehlgeschlagen: { label: "fehlgeschlagen", cls: "tag-danger", hint: "Übertragung oder Temu meldet einen Fehler – Grund in der Zeile." },
};

export type WizardInput = {
  title: string;
  image: string | null;
  price: number;
  variations: number;
  condition: string | null;
  pack: Partial<TemuPackage>;
  temu: { status: string | null; error: string | null } | null;
  job: { status: string; message: string | null } | null;
};

/** Was fehlt? `price` = Temu-Preis nach Rechner oder eigener Eingabe (bei Varianten der kleinste). */
export function missingFor(c: WizardInput, price: number, pack: Partial<TemuPackage>, opts: { allowHttp?: boolean } = {}): string[] {
  const out: string[] = [];
  if (!c.title.trim()) out.push("Titel");
  if (!c.image) out.push("Bild");
  else if (!(opts.allowHttp ? /^https?:\/\//i : /^https:\/\//i).test(c.image)) out.push("Bild nicht öffentlich (https)");
  if (!(price > 0)) out.push("Preis");
  if (!(Number(pack.weightG) > 0)) out.push("Gewicht");
  if (!(Number(pack.lengthCm) > 0 && Number(pack.widthCm) > 0 && Number(pack.heightCm) > 0)) out.push("Paketmaße");
  if (c.condition && c.condition !== "NEW") out.push("nur Neuware");
  return out;
}

/** Woher ein Paketwert kommt: in der Zeile eingetragen, aus Artikelstamm/Produkt bzw. letztem Versuch, oder Standardpaket. */
export type PackSource = "zeile" | "artikel" | "standard";
export const PACK_SOURCE_LABEL: Record<PackSource, string> = { zeile: "in der Zeile eingetragen", artikel: "aus Artikelstamm/Produkt", standard: "Standardpaket" };
const PACK_KEYS: (keyof TemuPackage)[] = ["weightG", "lengthCm", "widthCm", "heightCm"];

/** Quelle des Pakets insgesamt: „standard“, sobald auch nur ein Wert aus dem Standardpaket kommt. */
export function packSource(row: Partial<Record<keyof TemuPackage, number | undefined>>, own: Partial<TemuPackage>): PackSource {
  if (PACK_KEYS.every((k) => row[k] !== undefined)) return "zeile";
  if (PACK_KEYS.every((k) => row[k] !== undefined || own[k] !== undefined)) return "artikel";
  return "standard";
}

/**
 * Plausibilität: nennt der Titel eine Länge in cm (z. B. „Kochmesser 20 cm“), die größer ist als die längste
 * Paketseite, passt das Paket nicht. Gibt die Länge zurück, sonst null.
 */
export function sizeConflict(title: string, pack: Partial<TemuPackage>): number | null {
  const sides = [pack.lengthCm, pack.widthCm, pack.heightCm].map(Number).filter((n) => n > 0);
  if (sides.length < 3) return null;
  const sizes = [...title.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:-\s*)?cm\b/gi)].map((m) => Number(m[1].replace(",", "."))).filter((n) => n > 0 && n < 500);
  if (!sizes.length) return null;
  const longest = Math.max(...sizes);
  return longest > Math.max(...sides) ? longest : null;
}

/**
 * Was vor der Freigabe noch geprüft werden muss: Paket nur aus dem Standard oder Titel nennt eine größere
 * Länge als das Paket. Erledigt, sobald jemand die tatsächlichen Versandmaße bestätigt (`confirmed`).
 */
export function needsCheck(c: Pick<WizardInput, "title">, pack: Partial<TemuPackage>, source: PackSource, confirmed: boolean): string[] {
  if (confirmed) return [];
  const out: string[] = [];
  const conflict = sizeConflict(c.title, pack);
  if (conflict) out.push(`Paket kleiner als im Titel genannt (${String(conflict).replace(".", ",")} cm) – Maße prüfen`);
  if (source === "standard") out.push("Versandmaße bestätigen (nur Standardpaket)");
  return out;
}

/** Zustand eines Angebots im Assistenten. `check` = offene Prüfpunkte (needsCheck) – dann „prüfen“ statt „bereit“. */
export function wizardStatus(c: WizardInput, price: number, pack: Partial<TemuPackage>, opts: { allowHttp?: boolean; check?: string[] } = {}): { status: WizardStatus; missing: string[]; reason: string | null } {
  if (c.job?.status === "fehler") return { status: "fehlgeschlagen", missing: [], reason: c.job.message };
  if (c.job && (c.job.status === "wartet" || c.job.status === "läuft")) return { status: "in-arbeit", missing: [], reason: c.job.status === "läuft" ? "wird übertragen" : "wartet in der Warteschlange" };
  if (c.temu) {
    const st = (c.temu.status ?? "").toUpperCase();
    if (st === "ACTIVE") return { status: "veroeffentlicht", missing: [], reason: null };
    // Bei Temu angelegt, aber dort fehlen Angaben (z. B. Kategorie-Pflichtmerkmale) – im Seller Center ergänzen.
    if (st === "INCOMPLETE" || st === "DRAFT") return { status: "unvollstaendig", missing: ["bei Temu ergänzen"], reason: c.temu.error };
    if (st === "DELETED") return { status: "fehlgeschlagen", missing: [], reason: "bei Temu gelöscht" };
    if (st === "INACTIVE") return { status: "in-arbeit", missing: [], reason: "bei Temu inaktiv" };
    if (c.temu.error) return { status: "fehlgeschlagen", missing: [], reason: c.temu.error };
    return { status: "in-arbeit", missing: [], reason: "Temu meldet den Stand noch" };
  }
  const missing = missingFor(c, price, pack, opts);
  if (missing.length) return { status: "unvollstaendig", missing, reason: null };
  if (opts.check?.length) return { status: "pruefen", missing: opts.check, reason: null };
  return { status: "entwurf", missing: [], reason: null };
}

/** Paket: Angabe in der Zeile → Werte des Angebots → Standardpaket. */
export function packOf(row: Partial<Record<keyof TemuPackage, number | undefined>>, own: Partial<TemuPackage>, std: Partial<TemuPackage>): Partial<TemuPackage> {
  const keys: (keyof TemuPackage)[] = ["weightG", "lengthCm", "widthCm", "heightCm"];
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? own[k] ?? std[k]]).filter(([, v]) => v !== undefined)) as Partial<TemuPackage>;
}
