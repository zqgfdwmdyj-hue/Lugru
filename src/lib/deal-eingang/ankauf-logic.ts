import type { DealAnkauf } from "@/db/tables/deal-eingang";

// B34.4 Ankauf als Ausstiegsweg: Ware an einen Ankäufer verkaufen statt über Amazon. Gewinn = Ankaufspreis − EK +
// Rückvergütung, dazu Marge, ROI, Zahlungsziel und ROI p. a. – beide Wege nebeneinander. B34.5: Checkliste beim Kauf
// (Warnung, kein Stopp), Aufgabe „Ankauf bestätigen“, Ausgang für die Lernschleife. Nur intern (Insider-Wissen).

export const ANKAUF_AUSGANG = { angekauft: "angekauft", liegt: "liegt noch", verlust: "Verlust" } as const;
export type AnkaufAusgang = keyof typeof ANKAUF_AUSGANG;
export const istAnkaufAusgang = (x: unknown): x is AnkaufAusgang => typeof x === "string" && x in ANKAUF_AUSGANG;
export const LEGIT_CHECK = { offen: "offen", bestanden: "bestanden", nicht_bestanden: "nicht bestanden" } as const;
export const istLegitCheck = (x: unknown): x is DealAnkauf["legitCheck"] => typeof x === "string" && x in LEGIT_CHECK;
/** Ohne Angabe: Geld vom Ankäufer nach 7 Tagen. */
export const ANKAUF_ZAHLUNGSZIEL_STANDARD = 7;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export const ankaufAktiv = (a: DealAnkauf | null | undefined): a is DealAnkauf => !!a && a.preis !== null && a.preis > 0;

export function ankaufLeer(): DealAnkauf {
  return { zeile: null, preis: null, ankaeufer: null, legitCheck: "offen", legitNotiz: null, mengeAngemeldet: null, annahmefrist: null, zahlungszielTage: null, rueckverguetungProzent: 0, ausgang: null, ausgangAm: null, ausgangNotiz: null, geaendertAm: new Date().toISOString(), ankauftBestaetigtAm: null, versandfrist: null };
}

export type Ausstieg = { gewinnStk: number | null; gewinnGesamt: number | null; marge: number | null; roi: number | null; tage: number | null; roiPa: number | null };

function ausstieg(gewinnStk: number | null, erloes: number | null, ek: number | null, tage: number | null, menge: number | null): Ausstieg {
  const g = gewinnStk === null ? null : r2(gewinnStk);
  const roi = g !== null && ek && ek > 0 ? r1((g / ek) * 100) : null;
  return {
    gewinnStk: g,
    gewinnGesamt: g !== null && menge ? r2(g * menge) : null,
    marge: g !== null && erloes && erloes > 0 ? r1((g / erloes) * 100) : null,
    roi,
    tage: tage && tage > 0 ? Math.round(tage) : null,
    roiPa: roi !== null && tage && tage > 0 ? Math.round((roi * 365) / tage) : null,
  };
}

/**
 * Amazon (bestes Land: Gewinn je Stück aus der Deal-Prüfung, Marge vom Buy-Box-Preis brutto, Umschlagszeit) gegen
 * Ankauf (Ankaufspreis netto, Marge vom Ankaufspreis, Zahlungsziel). Die Rückvergütung (% vom EK) zählt bei beiden.
 * „Besser“ nach ROI p. a. (Kapital schneller zurück), bei Gleichstand nach Gewinn gesamt.
 */
export function ausstiegVergleich(o: {
  ek: number | null;
  menge: number | null;
  rueckProzent: number;
  amazon: { gewinnStk: number | null; vkBrutto: number | null; tage: number | null };
  ankauf: { preis: number | null; tage: number | null };
}): { amazon: Ausstieg; ankauf: Ausstieg; besser: "amazon" | "ankauf" | null; text: string } {
  const rueck = o.ek && o.rueckProzent > 0 ? (o.ek * o.rueckProzent) / 100 : 0;
  const amazon = ausstieg(o.amazon.gewinnStk === null ? null : o.amazon.gewinnStk + rueck, o.amazon.vkBrutto, o.ek, o.amazon.tage, o.menge);
  const ankauf = ausstieg(o.ankauf.preis !== null && o.ek !== null ? o.ankauf.preis - o.ek + rueck : null, o.ankauf.preis, o.ek, o.ankauf.tage ?? ANKAUF_ZAHLUNGSZIEL_STANDARD, o.menge);
  let besser: "amazon" | "ankauf" | null = null;
  if (amazon.roiPa !== null && ankauf.roiPa !== null && amazon.roiPa !== ankauf.roiPa) besser = ankauf.roiPa > amazon.roiPa ? "ankauf" : "amazon";
  else if (amazon.gewinnStk !== null && ankauf.gewinnStk !== null && amazon.gewinnStk !== ankauf.gewinnStk) besser = ankauf.gewinnStk > amazon.gewinnStk ? "ankauf" : "amazon";
  else if (amazon.gewinnStk === null && ankauf.gewinnStk !== null) besser = "ankauf";
  let text: string;
  if (ankauf.gewinnStk === null) text = "Für den Vergleich fehlen Ankaufspreis oder EK.";
  else if (amazon.gewinnStk === null) text = `Ankauf: ${eur(ankauf.gewinnStk)} je Stück, Geld nach ${ankauf.tage} Tagen – für Amazon fehlen Zahlen (bitte „Neu prüfen“).`;
  else {
    const diff = r2(ankauf.gewinnStk - amazon.gewinnStk);
    const jeStk = diff === 0 ? "gleicher Gewinn je Stück" : `Ankauf ${eur(Math.abs(diff))} ${diff > 0 ? "mehr" : "weniger"} je Stück`;
    const zeit = amazon.tage && ankauf.tage ? `, Geld nach ${ankauf.tage} statt ${amazon.tage} Tagen` : "";
    const pa = amazon.roiPa !== null && ankauf.roiPa !== null ? ` – ROI p. a. ${ankauf.roiPa} % statt ${amazon.roiPa} %` : "";
    const fazit = besser === "ankauf" ? "Ankauf lohnt sich eher" : besser === "amazon" ? "Amazon lohnt sich eher" : "beide Wege gleichauf";
    text = `${fazit}: ${jeStk}${zeit}${pa}.${ankauf.gewinnStk <= 0 ? " Ankauf bringt keinen Gewinn – nur zur Schadensbegrenzung." : ""}`;
  }
  return { amazon, ankauf, besser, text };
}

export type CheckPunkt = { punkt: string; ok: boolean; hinweis: string };

/** „Kauft noch an“ gilt als aktuell, wenn die Bestätigung des Ankäufers höchstens so viele Tage alt ist. */
export const ANKAUF_BESTAETIGUNG_TAGE = 7;
const tageZwischen = (von: string, bis: string) => Math.round((Date.parse(`${bis}T12:00:00Z`) - Date.parse(`${von}T12:00:00Z`)) / 86_400_000);

/** B34.5 Checkliste beim „Gekauft“ eines Ankauf-Deals (Warnung, kein Stopp). */
export function ankaufCheckliste(a: DealAnkauf, menge: number | null, heute: string): CheckPunkt[] {
  const angemeldet = a.mengeAngemeldet ?? 0;
  const fristAbgelaufen = !!a.annahmefrist && a.annahmefrist < heute;
  const bestaetigt = a.ankauftBestaetigtAm ?? null;
  const bestAlter = bestaetigt ? tageZwischen(bestaetigt, heute) : null;
  const versand = a.versandfrist ?? null;
  const versandVorbei = !!versand && versand < heute;
  return [
    { punkt: "Ankäufer festgelegt", ok: !!a.ankaeufer?.trim(), hinweis: a.ankaeufer?.trim() ? a.ankaeufer.trim() : "noch kein Ankäufer eingetragen" },
    { punkt: "Menge beim Ankäufer angemeldet", ok: a.mengeAngemeldet !== null && a.mengeAngemeldet > 0 && (menge === null || angemeldet >= menge), hinweis: a.mengeAngemeldet === null ? "Menge noch nicht angemeldet – sonst kann der Ankäufer die Annahme verweigern" : menge !== null && angemeldet < menge ? `nur ${angemeldet} von ${menge} Stk angemeldet` : `${angemeldet} Stk angemeldet` },
    { punkt: "Ankäufer kauft noch an", ok: bestAlter !== null && bestAlter >= 0 && bestAlter <= ANKAUF_BESTAETIGUNG_TAGE, hinweis: !bestaetigt ? "nicht bestätigt – beim Ankäufer nachfragen und Datum eintragen" : bestAlter! > ANKAUF_BESTAETIGUNG_TAGE ? `Bestätigung vom ${dmy(bestaetigt)} ist älter als ${ANKAUF_BESTAETIGUNG_TAGE} Tage` : `bestätigt am ${dmy(bestaetigt)}` },
    { punkt: "Annahmefrist bekannt", ok: !!a.annahmefrist && !fristAbgelaufen, hinweis: !a.annahmefrist ? "Annahmefrist fehlt" : fristAbgelaufen ? `Annahmefrist ${dmy(a.annahmefrist)} ist abgelaufen` : `bis ${dmy(a.annahmefrist)}` },
    { punkt: "Versandfrist bekannt", ok: !!versand && !versandVorbei, hinweis: !versand ? "Versandfrist fehlt – bis wann muss die Ware beim Ankäufer sein?" : versandVorbei ? `Versandfrist ${dmy(versand)} ist vorbei` : `Versand bis ${dmy(versand)}` },
    { punkt: "Rang/Legit-Check bestanden", ok: a.legitCheck === "bestanden", hinweis: a.legitCheck === "bestanden" ? "bestanden" : a.legitCheck === "nicht_bestanden" ? "nicht bestanden – Vorsicht" : "noch offen" },
  ];
}

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Warntext für die Meldung nach „Gekauft“ – null, wenn alles erledigt ist. */
export function ankaufWarnung(punkte: CheckPunkt[]): string | null {
  const offen = punkte.filter((p) => !p.ok);
  return offen.length ? `Ankauf-Deal – bitte prüfen: ${offen.map((p) => `${p.punkt} (${p.hinweis})`).join(" · ")}.` : null;
}

/** Frist der Aufgabe „Ankauf bestätigen“: früheste offene Frist (Annahme- bzw. Versandfrist), sonst in 2 Tagen. */
export function ankaufFrist(a: DealAnkauf, heute: string): string {
  const offen = [a.annahmefrist, a.versandfrist ?? null].filter((x): x is string => !!x && x >= heute).sort();
  if (offen.length) return offen[0];
  const d = new Date(`${heute}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString().slice(0, 10);
}

/** Wissenseintrag „Ankaufserver“ (Einzelmeinung aus dem Wochen-Call, ungeprüft) – nur intern. */
export const ANKAUF_WISSEN = {
  title: "Ankaufserver als Ausstiegsweg (Einzelmeinung, ungeprüft)",
  body: [
    "Statt über Amazon zu verkaufen, kann Ware zu einem festen Ankaufspreis an einen Ankäufer (z. B. Ankaufserver auf Discord) gehen.",
    "Vorteil: Geld schneller zurück (Zahlungsziel statt Umschlagszeit bei Amazon), kein Preisverfall- und Retourenrisiko.",
    "Risiken: Menge vorher beim Ankäufer anmelden (sonst kann die Annahme verweigert werden), vor dem Kauf bestätigen lassen, dass er noch ankauft (Datum), Annahme- und Versandfrist einhalten, Rang/Legit-Check des Ankäufers prüfen, Zahlungsziel klären.",
    "Einsteiger bekommen kaum Deals: Ankaufserver bedienen zuerst bekannte Verkäufer mit Rang – als Neuer eher kleine Mengen und mit wenig Erwartung starten.",
    "Im Seller-System: Deal-Eingang → Deal → „Ausstieg: Amazon oder Ankauf“ (Vergleich, Checkliste beim Kauf, Aufgabe „Ankauf bestätigen“).",
    "Keine Kauf-Bots, kein automatisches Mitlesen fremder Discord-Server – das Seller-System liest nur Kanäle, die du selbst abonniert und unter Anbindungen eingetragen hast.",
    "Einzelmeinung aus dem Wochen-Call vom 04.11.2026 – nicht allgemein geprüft.",
  ].join("\n\n"),
  quelleDatum: "2026-11-04",
  quelleWer: "Gruppe – Einzelmeinung",
} as const;
