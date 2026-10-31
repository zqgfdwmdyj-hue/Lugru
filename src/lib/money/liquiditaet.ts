// Liquiditätsvorschau (8 Wochen) – reine Logik: Posten aus allen Quellen auf Wochen verteilen, Kontostand
// fortschreiben, tiefsten Stand je Woche gegen die Mindestreserve prüfen (Ampel), Steuertermine erzeugen.

import { addDaysIso } from "@/lib/dates";
import { weekStart } from "./cashflow";

export type PostenArt = "amazon" | "ebay" | "temu" | "b2b" | "rechnung" | "einkauf" | "wareneinkauf" | "vorschlag" | "grosshaendler" | "kreditkarte" | "fixkosten" | "steuer" | "plan" | "szenario";
export const POSTEN_TEXT: Record<PostenArt, string> = {
  amazon: "Amazon-Auszahlung",
  ebay: "eBay-Auszahlung",
  temu: "Temu-Auszahlung",
  b2b: "B2B-Forderung",
  rechnung: "Lieferantenrechnung",
  wareneinkauf: "Wareneinkauf (Ø aus Rechnungen)",
  einkauf: "Einkauf (angelegt/bestellt)",
  vorschlag: "Möglicher Einkauf (nicht freigegeben)",
  grosshaendler: "Großhändler (B2B-Deal)",
  kreditkarte: "Kreditkarte",
  fixkosten: "Fixkosten",
  steuer: "Steuern",
  plan: "Geplant",
  szenario: "Was wäre wenn",
};

/** „nichtEingerechnet“: nur zur Info in der Woche (z. B. Bestellvorschläge vor der Freigabe) – ändert den Kontostand nicht. */
export type Posten = { datum: string; betrag: number; label: string; art: PostenArt; geschaetzt: boolean; nichtEingerechnet?: boolean };
export type Ampel = "gruen" | "gelb" | "rot";
/** „moeglich“: Summe der nicht eingerechneten möglichen Einkäufe der Woche (Bestellvorschläge vor der Freigabe). */
export type LiqWoche = { start: string; ende: string; anfang: number | null; zu: number; ab: number; endeSaldo: number | null; tiefster: number | null; ampel: Ampel | null; posten: Posten[]; moeglich: number };

/**
 * Wochen ab der aktuellen (Mo–So). Posten vor heute zählen nicht (schon gebucht oder überfällig → heute).
 * Ampel je Woche aus dem tiefsten Stand in der Woche: unter Reserve rot, unter 1,5 × Reserve gelb.
 */
export function liquiditaetWochen(o: { heute: string; wochen: number; start: number | null; posten: Posten[]; reserve: number; ueberfaelligHeute?: boolean }): LiqWoche[] {
  const erste = weekStart(o.heute);
  const ende = addDaysIso(erste, o.wochen * 7 - 1);
  const im = o.posten
    .map((p) => (p.datum < o.heute && o.ueberfaelligHeute !== false && p.art !== "amazon" ? { ...p, datum: o.heute } : p))
    .filter((p) => p.datum >= o.heute && p.datum <= ende)
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.betrag - b.betrag));
  let saldo = o.start;
  const out: LiqWoche[] = [];
  for (let i = 0; i < o.wochen; i++) {
    const s = addDaysIso(erste, i * 7);
    const e = addDaysIso(s, 6);
    const posten = im.filter((p) => p.datum >= s && p.datum <= e);
    const anfang = saldo;
    let tiefster = saldo;
    let zu = 0;
    let ab = 0;
    let moeglich = 0;
    // Abflüsse eines Tages vor den Zuflüssen desselben Tages – vorsichtig gerechnet.
    for (const p of posten) {
      if (p.nichtEingerechnet) {
        moeglich += -p.betrag;
        continue;
      }
      if (p.betrag >= 0) zu += p.betrag;
      else ab += -p.betrag;
      if (saldo !== null) {
        saldo += p.betrag;
        if (tiefster === null || saldo < tiefster) tiefster = saldo;
      }
    }
    const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
    const ampel: Ampel | null = tiefster === null ? null : tiefster < o.reserve ? "rot" : tiefster < o.reserve * 1.5 ? "gelb" : "gruen";
    out.push({ start: s, ende: e, anfang: r2(anfang), zu: r2(zu)!, ab: r2(ab)!, endeSaldo: r2(saldo), tiefster: r2(tiefster), ampel, posten, moeglich: r2(moeglich)! });
  }
  return out;
}

export type SteuerTermin = { name: string; betrag: number; monate: number[]; tag: number };

/** „alle“, „1-12“, „3,6,9,12“, „quartal“ → Monatsnummern. */
export function leseMonate(roh: string): number[] {
  const s = roh.trim().toLowerCase();
  if (!s || s === "alle" || s === "monatlich") return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  if (s === "quartal" || s === "quartalsweise") return [1, 4, 7, 10];
  const out = new Set<number>();
  for (const teil of s.split(/[,;\s]+/)) {
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(teil);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let x = Math.min(a, b); x <= Math.max(a, b); x++) if (x >= 1 && x <= 12) out.add(x);
  }
  return [...out].sort((a, b) => a - b);
}

/** Steuertermine im Zeitraum (Tag im Monat, fällt er aufs Wochenende → nächster Montag). */
export function steuerPosten(termine: SteuerTermin[], von: string, bis: string): Posten[] {
  const out: Posten[] = [];
  const [vj, vm] = von.split("-").map(Number);
  for (const t of termine) {
    if (!(t.betrag > 0)) continue;
    for (let i = 0; i < 4; i++) {
      const jahr = vj + Math.floor((vm - 1 + i) / 12);
      const monat = ((vm - 1 + i) % 12) + 1;
      if (!t.monate.includes(monat)) continue;
      const letzter = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
      let d = `${jahr}-${String(monat).padStart(2, "0")}-${String(Math.min(Math.max(1, t.tag), letzter)).padStart(2, "0")}`;
      const wt = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (wt === 6) d = addDaysIso(d, 2);
      if (wt === 0) d = addDaysIso(d, 1);
      if (d >= von && d <= bis) out.push({ datum: d, betrag: -Math.abs(t.betrag), label: t.name, art: "steuer", geschaetzt: true });
    }
  }
  return out;
}

/** Gleichmäßige Auszahlungen (eBay/Temu zahlen laufend aus): Wochenbetrag jeweils mittwochs. */
export function woechentlich(o: { betragProWoche: number; heute: string; wochen: number; label: string; art: PostenArt }): Posten[] {
  if (!(o.betragProWoche > 0)) return [];
  const erste = weekStart(o.heute);
  return Array.from({ length: o.wochen }, (_, i) => addDaysIso(erste, i * 7 + 2))
    .filter((d) => d >= o.heute)
    .map((d) => ({ datum: d, betrag: Math.round(o.betragProWoche * 100) / 100, label: o.label, art: o.art, geschaetzt: true }));
}

/** Erste Woche, in der die Reserve unterschritten wird (oder null). */
export const ersteRoteWoche = (w: LiqWoche[]) => w.find((x) => x.ampel === "rot") ?? null;

/**
 * B15.6: üblicher Wareneinkauf je Woche (Ø der Warenrechnungen) als Planposten – je Woche nur der Rest, der nicht
 * schon durch konkret angelegte Einkäufe/Lieferantenrechnungen dieser Woche gedeckt ist (sonst doppelt). Freitags.
 */
export function wareneinkaufPlan(o: { proWoche: number; heute: string; wochen: number; konkret: Posten[] }): Posten[] {
  if (!(o.proWoche > 0)) return [];
  const erste = weekStart(o.heute);
  const out: Posten[] = [];
  for (let i = 0; i < o.wochen; i++) {
    const von = addDaysIso(erste, i * 7);
    const bis = addDaysIso(von, 6);
    const schon = o.konkret.filter((p) => (p.art === "einkauf" || p.art === "rechnung" || p.art === "grosshaendler") && p.datum >= von && p.datum <= bis && !p.nichtEingerechnet).reduce((n, p) => n - Math.min(0, p.betrag), 0);
    const rest = Math.round((o.proWoche - schon) * 100) / 100;
    const tag = addDaysIso(von, 4) < o.heute ? o.heute : addDaysIso(von, 4);
    if (rest > 0 && tag <= bis) out.push({ datum: tag, betrag: -rest, label: `Wareneinkauf (Ø ${Math.round(o.proWoche).toLocaleString("de-DE")} €/Woche aus Rechnungen${schon > 0 ? ", abzüglich angelegter Einkäufe" : ""})`, art: "wareneinkauf", geschaetzt: true });
  }
  return out;
}

/** Alter des Kontostands in Tagen (null = unbekannt). Ab 7 Tagen warnt die Liquidität. */
export const kontostandAlter = (stand: string | null, heute: string) => (stand ? Math.round((Date.parse(`${heute}T12:00:00Z`) - Date.parse(`${stand.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null);
