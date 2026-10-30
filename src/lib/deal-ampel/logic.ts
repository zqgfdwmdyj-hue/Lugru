// Deal-Ampel (Einkaufs-Prüfung) – reine Logik: Gewinn je Land beim aktuellen Buy-Box-Preis und beim 90-Tage-Mittel
// (USt je Land), realistischer Abverkauf (Verkäufe ÷ (Angebote + 1)), empfohlene Menge für 30–45 Tage, Ampel mit
// kurzer Begründung. Die Marktdaten (Keepa/Amazon) kommen aus dem Service.

import { kundenGewinn, type KundenRechnung } from "@/lib/b2b/logic";

export type DealAmpelEinstellungen = {
  /** Zielmarge in % vom Netto-Verkaufspreis. */
  zielMarge: number;
  /** Abverkauf der Menge höchstens in so vielen Tagen. */
  maxAbverkaufTage: number;
  /** Ab so vielen Angeboten (FBA + FBM) rot. */
  maxAngebote: number;
  /** Amazon selbst hält die Buy Box in so viel % der Zeit → gelb; ab 80 % rot. */
  amazonMaxProzent: number;
  /** Aktueller Preis so viel % unter dem 90-Tage-Mittel → gelb, doppelt so viel → rot. */
  preisverfallProzent: number;
  /** Eigene Nebenkosten je Stück (Prep, Versand ins Lager). */
  nebenkosten: number;
  laender: string[];
};

export const DEAL_AMPEL_STANDARD: DealAmpelEinstellungen = { zielMarge: 15, maxAbverkaufTage: 45, maxAngebote: 15, amazonMaxProzent: 50, preisverfallProzent: 10, nebenkosten: 0, laender: ["DE", "FR", "IT", "ES"] };

export type LandMarkt = {
  land: string;
  /** Buy Box brutto in EUR: aktuell, Ø 90 Tage, Tief 12 Monate. */
  vkEur: number | null;
  vk90Eur: number | null;
  tief12Eur: number | null;
  mwstSatz: number;
  verkaeufeMonat: number | null;
  angebote: number | null;
  amazonProzent: number | null;
  aktionsmuster: string | null;
  fehler: string | null;
  /** Gebühren dieses Landes laut Amazon (sonst die Pauschale aus den Einstellungen). */
  gebuehren?: { provision: number; fba: number } | null;
};

export type LandErgebnis = LandMarkt & { aktuell: KundenRechnung | null; schnitt90: KundenRechnung | null };

export type Ampel = "gruen" | "gelb" | "rot";
export const AMPEL_TEXT: Record<Ampel, string> = { gruen: "Grün – kaufen", gelb: "Gelb – genau prüfen", rot: "Rot – eher nicht" };

const r2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const pz = (n: number | null | undefined) => (n === null || n === undefined ? "–" : String(n).replace(".", ","));

/** EK netto aus der Eingabe (brutto → netto mit deutscher USt). */
export const ekNettoAus = (ek: number, istNetto: boolean, ust = 0.19) => (istNetto ? ek : r2(ek / (1 + ust)));

/** Gewinn je Stück in einem Land beim aktuellen Preis und beim 90-Tage-Mittel. */
export function rechneLand(m: LandMarkt, pauschal: { provision: number; fba: number }, ekNetto: number, nebenkosten: number): LandErgebnis {
  const g = m.gebuehren ?? pauschal;
  const rechne = (vk: number | null) => (vk === null || vk <= 0 ? null : kundenGewinn({ vkBrutto: vk, mwstSatz: m.mwstSatz, provision: g.provision, fbaGebuehr: g.fba, kundenpreis: ekNetto, prepGebuehr: nebenkosten }));
  return { ...m, aktuell: rechne(m.vkEur), schnitt90: rechne(m.vk90Eur ?? m.vkEur) };
}

/** Realistischer Abverkauf: unser Anteil = Verkäufe ÷ (Angebote + 1); Menge für 30–45 Tage; Tage für die Wunschmenge. */
export function abverkauf(verkaeufeMonat: number | null, angebote: number | null, menge: number | null): { unsProMonat: number | null; empfohlen: { von: number; bis: number } | null; tage: number | null } {
  if (verkaeufeMonat === null || verkaeufeMonat <= 0) return { unsProMonat: null, empfohlen: null, tage: null };
  const uns = verkaeufeMonat / ((angebote ?? 0) + 1);
  const empfohlen = { von: Math.max(1, Math.floor(uns)), bis: Math.max(1, Math.floor(uns * 1.5)) };
  return { unsProMonat: r2(uns), empfohlen, tage: menge && uns > 0 ? Math.round((menge / uns) * 30) : null };
}

/** Grobe Marktgröße je Land im Verhältnis zu Deutschland (für Schätzungen, wenn ein Land keine Verkaufsdaten hat). */
export const MARKTGROESSE: Record<string, number> = { DE: 1, UK: 0.8, FR: 0.45, IT: 0.4, ES: 0.35, NL: 0.1, PL: 0.08, SE: 0.06, BE: 0.04, IE: 0.03 };

/**
 * Verkäufe je Monat schätzen, wenn sie im Land fehlen: aus dem Land mit Daten (bevorzugt DE) über die Marktgröße.
 * Ergebnis mit Herkunft, damit es als geschätzt gekennzeichnet werden kann.
 */
export function verkaeufeSchaetzen(land: string, laender: Pick<LandMarkt, "land" | "verkaeufeMonat">[]): { wert: number; aus: string } | null {
  const ziel = MARKTGROESSE[land];
  if (!ziel) return null;
  const quellen = laender.filter((l) => l.land !== land && l.verkaeufeMonat !== null && l.verkaeufeMonat > 0 && MARKTGROESSE[l.land]).sort((a, b) => (a.land === "DE" ? -1 : b.land === "DE" ? 1 : MARKTGROESSE[b.land] - MARKTGROESSE[a.land]));
  const q = quellen[0];
  if (!q) return null;
  return { wert: Math.max(1, Math.round((q.verkaeufeMonat! * ziel) / MARKTGROESSE[q.land])), aus: q.land };
}

/** Bestes Land: höchster Gewinn beim 90-Tage-Mittel (ohne Mittel: aktueller Preis). */
export function bestesLand(l: LandErgebnis[]): LandErgebnis | null {
  const wert = (x: LandErgebnis) => (x.schnitt90 ?? x.aktuell)?.gewinn ?? null;
  return l.filter((x) => wert(x) !== null).sort((a, b) => wert(b)! - wert(a)!)[0] ?? null;
}

/**
 * Ampel: Rot bei Marge unter Ziel beim 90-Tage-Mittel, Amazon dauerhaft in der Buy Box (≥ 80 %), starkem Preisverfall
 * oder zu vielen Angeboten. Grün nur, wenn Marge ≥ Ziel (auch aktuell), Abverkauf in der Frist und kein Preisverfall.
 * Sonst Gelb. Begründung in 2–3 Sätzen.
 */
export function dealAmpel(laender: LandErgebnis[], menge: number | null, e: DealAmpelEinstellungen): { ampel: Ampel; bestes: LandErgebnis | null; rot: string[]; gelb: string[]; begruendung: string; abverkauf: ReturnType<typeof abverkauf>; verkaeufeGeschaetzt: { wert: number; aus: string } | null } {
  const b = bestesLand(laender);
  if (!b) {
    const grund = laender.find((x) => x.fehler)?.fehler ?? "keine Marktdaten";
    return { ampel: "rot", bestes: null, rot: [`Kein Gewinn berechenbar (${grund}).`], gelb: [], begruendung: `Keine verwertbaren Marktdaten (${grund}) – so nicht kaufen.`, abverkauf: abverkauf(null, null, menge), verkaeufeGeschaetzt: null };
  }
  const rot: string[] = [];
  const gelb: string[] = [];
  const m90 = b.schnitt90 ?? b.aktuell!;
  const mAkt = b.aktuell ?? m90;
  if ((m90.marge ?? -999) < e.zielMarge) rot.push(`Marge beim 90-Tage-Mittel nur ${pz(m90.marge)} % (Ziel ${e.zielMarge} %).`);
  else if ((mAkt.marge ?? -999) < e.zielMarge) gelb.push(`Beim aktuellen Preis nur ${pz(mAkt.marge)} % Marge – der Preis liegt gerade unter dem Mittel.`);
  if (b.amazonProzent !== null && b.amazonProzent >= 80) rot.push(`Amazon hält die Buy Box ${b.amazonProzent} % der Zeit.`);
  else if (b.amazonProzent !== null && b.amazonProzent >= e.amazonMaxProzent) gelb.push(`Amazon hält die Buy Box ${b.amazonProzent} % der Zeit.`);
  // Hoher Amazon-Anteil in einem anderen Land: mindestens Gelb (Amazon drückt den Preis oft EU-weit).
  for (const l of laender) if (l.land !== b.land && l.amazonProzent !== null && l.amazonProzent >= Math.max(e.amazonMaxProzent, 80)) gelb.push(`Amazon hält in ${l.land} die Buy Box ${pz(l.amazonProzent)} % der Zeit.`);
  if (b.vkEur !== null && b.vk90Eur !== null && b.vk90Eur > 0) {
    const verfall = Math.round(((b.vk90Eur - b.vkEur) / b.vk90Eur) * 100);
    if (verfall >= e.preisverfallProzent * 2) rot.push(`Starker Preisverfall: aktuell ${verfall} % unter dem 90-Tage-Mittel.`);
    else if (verfall >= e.preisverfallProzent) gelb.push(`Preis ${verfall} % unter dem 90-Tage-Mittel.`);
  }
  if (b.angebote !== null && b.angebote > e.maxAngebote) rot.push(`${b.angebote} Angebote (mehr als ${e.maxAngebote}).`);
  // Aktionspreise in irgendeinem Land drücken den Preis auch anderswo – alle nennen.
  for (const l of laender) if (l.aktionsmuster) gelb.push(`Aktionsmuster ${l.land}: ${l.aktionsmuster}`);
  const geschaetzt = b.verkaeufeMonat === null ? verkaeufeSchaetzen(b.land, laender) : null;
  const verkaeufe = b.verkaeufeMonat ?? geschaetzt?.wert ?? null;
  const a = abverkauf(verkaeufe, b.angebote, menge);
  if (a.unsProMonat === null) gelb.push("Verkäufe je Monat unbekannt – Abverkauf nicht abschätzbar.");
  else if (a.tage !== null && a.tage > e.maxAbverkaufTage) gelb.push(`Abverkauf der Menge dauert etwa ${a.tage} Tage (Ziel ≤ ${e.maxAbverkaufTage}).`);
  const ampel: Ampel = rot.length ? "rot" : gelb.length ? "gelb" : "gruen";

  const satz1 = `Bestes Land ${b.land}: ${eur(m90.gewinn)} Gewinn je Stück beim 90-Tage-Mittel (${pz(m90.marge)} % Marge, ROI ${pz(m90.roi)} %)${b.aktuell && b.schnitt90 ? `, aktuell ${eur(b.aktuell.gewinn)}` : ""}.`;
  const satz2 =
    a.unsProMonat !== null
      ? `Realistisch etwa ${Math.round(a.unsProMonat)} Stück im Monat (${verkaeufe} Verkäufe${geschaetzt ? ` – geschätzt aus ${geschaetzt.aus} über die Marktgröße` : ""}, ${b.angebote ?? "?"} Angebote) – empfohlen ${a.empfohlen!.von}–${a.empfohlen!.bis} Stück${a.tage !== null ? `, die Wunschmenge reicht für etwa ${a.tage} Tage` : ""}.`
      : "Verkäufe je Monat unbekannt.";
  const satz3 = rot.length ? `Dagegen: ${rot.join(" ")}` : gelb.length ? `Achtung: ${gelb.join(" ")}` : "Keine Warnzeichen.";
  return { ampel, bestes: b, rot, gelb, begruendung: [satz1, satz2, satz3].join(" "), abverkauf: a, verkaeufeGeschaetzt: geschaetzt };
}

/** ASIN oder EAN aus der Eingabe (ASIN, EAN, Amazon-Link). */
export function leseCode(roh: string): { asin: string } | { ean: string } | null {
  const s = roh.trim();
  const ausLink = /(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})(?:[/?]|$)/i.exec(s)?.[1];
  if (ausLink) return { asin: ausLink.toUpperCase() };
  if (/^[A-Z0-9]{10}$/i.test(s) && /[A-Z]/i.test(s)) return { asin: s.toUpperCase() };
  const ziffern = s.replace(/[\s-]/g, "");
  if (/^\d{8}$|^\d{12,14}$/.test(ziffern)) return { ean: ziffern };
  if (/^\d{9}[\dX]$/i.test(ziffern)) return { asin: ziffern.toUpperCase() };
  return null;
}
