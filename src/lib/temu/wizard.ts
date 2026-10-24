// Temu-Assistent: Stand je eBay-Angebot in fünf klaren Zuständen und was noch fehlt, bevor es zu
// Temu kann. Reine Logik (auch im Browser genutzt) – die Pflichtangaben entsprechen temuGoodsProblems.

import type { TemuPackage } from "./goods";

export type WizardStatus = "entwurf" | "unvollstaendig" | "in-arbeit" | "veroeffentlicht" | "fehlgeschlagen";

export const WIZARD_STATUS: Record<WizardStatus, { label: string; cls: string; hint: string }> = {
  entwurf: { label: "Entwurf", cls: "tag-neutral", hint: "Alles da – kann zu Temu." },
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

/** Zustand eines Angebots im Assistenten. */
export function wizardStatus(c: WizardInput, price: number, pack: Partial<TemuPackage>, opts: { allowHttp?: boolean } = {}): { status: WizardStatus; missing: string[]; reason: string | null } {
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
  return { status: missing.length ? "unvollstaendig" : "entwurf", missing, reason: null };
}

/** Paket: Angabe in der Zeile → Werte des Angebots → Standardpaket. */
export function packOf(row: Partial<Record<keyof TemuPackage, number | undefined>>, own: Partial<TemuPackage>, std: Partial<TemuPackage>): Partial<TemuPackage> {
  const keys: (keyof TemuPackage)[] = ["weightG", "lengthCm", "widthCm", "heightCm"];
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? own[k] ?? std[k]]).filter(([, v]) => v !== undefined)) as Partial<TemuPackage>;
}
