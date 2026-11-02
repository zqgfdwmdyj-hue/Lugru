// Familienkalender: Wen betrifft ein Termin – mich, die Familie oder nur den Partner bzw. die Partnerin? Reine Logik
// (tests/betrifft.test.ts). Von Hand gesetzt geht vor; sonst erkennt das System den Vornamen im Titel
// („Tom Zahnarzt“, „Ina: Yoga“); ohne Hinweis gilt „Familie“ (wie bisher: betrifft beide).

import type { PartnerKey } from "./logic";

export type Betrifft = PartnerKey | "familie";
export type BetrifftQuelle = "gesetzt" | "titel" | "standard";
export const BETRIFFT_WERTE: readonly Betrifft[] = ["a", "b", "familie"];
export const istBetrifft = (v: unknown): v is Betrifft => v === "a" || v === "b" || v === "familie";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Vorname als ganzes Wort (auch „Ina:“, „(Tom)“, „Toms“ nicht – nur exakt). */
const wort = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, "iu");

/** Erkennung am Titel: genau ein Vorname → diese Person; beide Namen oder „Familie/alle“ → Familie; sonst unbekannt. */
export function betrifftAusTitel(titel: string, partner: { a: string; b: string }): Betrifft | null {
  const t = titel ?? "";
  const vorname = (n: string) => (n ?? "").trim().split(/\s+/)[0] ?? "";
  const a = vorname(partner.a);
  const b = vorname(partner.b);
  const hatA = a.length >= 2 && wort(a).test(t);
  const hatB = b.length >= 2 && wort(b).test(t);
  if (hatA && hatB) return "familie";
  if (/(?<![\p{L}])(familie|alle|gemeinsam)(?![\p{L}])/iu.test(t)) return "familie";
  if (hatA) return "a";
  if (hatB) return "b";
  return null;
}

/** Endgültige Zuordnung: gesetzt > Titel > Familie. */
export function betrifftAufloesen(gesetzt: Betrifft | null | undefined, titel: string, partner: { a: string; b: string }): { wert: Betrifft; quelle: BetrifftQuelle } {
  if (gesetzt && istBetrifft(gesetzt)) return { wert: gesetzt, quelle: "gesetzt" };
  const t = betrifftAusTitel(titel, partner);
  return t ? { wert: t, quelle: "titel" } : { wert: "familie", quelle: "standard" };
}

/** Personen für Filter und Zählungen im Privatkalender. */
export const personenVon = (b: Betrifft): PartnerKey[] => (b === "familie" ? ["a", "b"] : [b]);

/** Betrifft nur die andere Person (nicht mich) – dann blockt der Termin meinen Tag nicht. Ohne eigene Zuordnung: nie. */
export const nurAndere = (b: Betrifft, ich: PartnerKey | null | undefined): boolean => !!ich && b !== "familie" && b !== ich;

/** Kurzer Text für die Anzeige („nur Tom“, „Familie“). */
export const betrifftText = (b: Betrifft, partner: { a: string; b: string }) => (b === "familie" ? "Familie" : `nur ${b === "a" ? partner.a : partner.b}`);
