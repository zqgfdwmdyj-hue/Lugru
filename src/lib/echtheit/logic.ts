// Echtheits-Ordner – reine Logik: Marke in Produktnamen/Rechnungen erkennen, Abdeckung gekauft (mit Rechnung)
// gegen verkauft je SKU, Lücken, Dateinamen fürs Audit-Paket.

import { brandKey, brandRegex } from "@/lib/sas/logic";

/** Trifft die Marke (oder eine ihrer Schreibweisen) als ganzes Wort? */
export function markeTrifft(marke: string, aliase: string[], text: string | null | undefined): boolean {
  if (!text) return false;
  const low = text.toLowerCase();
  return [marke, ...aliase].some((m) => {
    const k = brandKey(m);
    return k.length >= 2 && low.includes(k) && brandRegex(m).test(text);
  });
}

export type SkuAbdeckung = {
  sku: string;
  asin: string | null;
  name: string | null;
  /** verkauft in den letzten 12 Monaten (sellerboard). */
  verkauft: number;
  /** gekauft laut Chargen, deren Einkauf mit einer Rechnung verknüpft ist. */
  gekauftBelegt: number;
  /** gekauft laut Chargen ohne verknüpfte Rechnung. */
  gekauftOhneBeleg: number;
};
export type AbdeckungStatus = "belegt" | "teilweise" | "luecke" | "kein_verkauf";
export const ABDECKUNG_TEXT: Record<AbdeckungStatus, string> = { belegt: "belegt", teilweise: "teilweise belegt", luecke: "Lücke", kein_verkauf: "kein Verkauf" };

export function abdeckungStatus(z: Pick<SkuAbdeckung, "verkauft" | "gekauftBelegt">): AbdeckungStatus {
  if (z.verkauft <= 0) return "kein_verkauf";
  if (z.gekauftBelegt <= 0) return "luecke";
  return z.gekauftBelegt >= z.verkauft ? "belegt" : "teilweise";
}

/** Abdeckung der Marke: Anteil verkaufter Stück, die durch belegte Einkäufe gedeckt sind (höchstens 100 %). */
export function abdeckung(zeilen: SkuAbdeckung[]) {
  const mit = zeilen.map((z) => ({ ...z, status: abdeckungStatus(z), fehlt: Math.max(0, z.verkauft - z.gekauftBelegt) }));
  const verkauft = mit.reduce((n, z) => n + z.verkauft, 0);
  const gedeckt = mit.reduce((n, z) => n + Math.min(z.verkauft, z.gekauftBelegt), 0);
  const order: Record<AbdeckungStatus, number> = { luecke: 0, teilweise: 1, belegt: 2, kein_verkauf: 3 };
  return {
    zeilen: mit.sort((a, b) => order[a.status] - order[b.status] || b.fehlt - a.fehlt || b.verkauft - a.verkauft),
    verkauft,
    gekauftBelegt: mit.reduce((n, z) => n + z.gekauftBelegt, 0),
    gekauftOhneBeleg: mit.reduce((n, z) => n + z.gekauftOhneBeleg, 0),
    quote: verkauft > 0 ? Math.round((gedeckt / verkauft) * 1000) / 10 : null,
    luecken: mit.filter((z) => z.status === "luecke" || z.status === "teilweise").length,
  };
}

/** Kategorien der Amazon-ToDos, die zu Echtheit/Rechten/Konto gehören. */
export const FALL_KATEGORIEN = ["echtheitspruefung", "konto", "reaktivierung", "produktsicherheit", "rueckruf"] as const;

/** Dateiname im Audit-Paket: Datum_Lieferant_Nummer.ext, ohne Sonderzeichen. */
export function auditDateiname(b: { datum: string | null; lieferant: string | null; nummer: string | null; original: string }, vergeben: Set<string>): string {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(b.original)?.[1] ?? "pdf").toLowerCase();
  const teil = (s: string | null) => (s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const basis = [b.datum ?? "ohne-datum", teil(b.lieferant) || "lieferant", teil(b.nummer) || "ohne-nr"].join("_");
  let name = `Rechnungen/${basis}.${ext}`;
  for (let i = 2; vergeben.has(name); i++) name = `Rechnungen/${basis}-${i}.${ext}`;
  vergeben.add(name);
  return name;
}

/** CSV der Abdeckung (Semikolon, Excel-tauglich, gegen Formel-Einschleusung abgesichert). */
export function abdeckungCsv(zeilen: (SkuAbdeckung & { status: AbdeckungStatus })[]): string {
  const zelle = (v: string | number | null) => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const kopf = ["SKU", "ASIN", "Produkt", "Verkauft 12 Monate", "Gekauft mit Rechnung", "Gekauft ohne Rechnung", "Status"];
  return [kopf.join(";"), ...zeilen.map((z) => [z.sku, z.asin, z.name, z.verkauft, z.gekauftBelegt, z.gekauftOhneBeleg, ABDECKUNG_TEXT[z.status]].map(zelle).join(";"))].join("\r\n") + "\r\n";
}
