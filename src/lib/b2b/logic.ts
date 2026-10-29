// B2B-Deals – reine Logik ohne Datenbank, damit testbar: Rechenhilfe (unser Verdienst, Gewinn/ROI des Kunden je
// Land), Mengengrenzen gegen Preiskampf, Prüfung einer Reservierung, Aufteilung bei Fehlmenge, Steuer (Reverse
// Charge), Aktionsmuster im Preisverlauf, Erfolgskontrolle, Deal-Blatt als Text.

import type { DealStatus, ReservierungStatus } from "@/db/tables/b2b";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// ---- Länder ----------------------------------------------------------------------------------------

/** Umsatzsteuer je Amazon-Land (Normalsatz) – der Kunde verkauft dort brutto. */
export const MWST: Record<string, number> = { DE: 0.19, FR: 0.2, IT: 0.22, ES: 0.21, NL: 0.21, BE: 0.21, PL: 0.23, SE: 0.25, UK: 0.2, IE: 0.23, AT: 0.2 };
export const EU = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "EL", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]);

// ---- Rechenhilfe -----------------------------------------------------------------------------------

export type Verdienst = { proStueck: number; gesamt: number | null; prozentAufEk: number | null; negativ: boolean };

/** Unser Verdienst: Kundenpreis − EK − anteilige Versandkosten (je Stück und bei voller Menge). */
export function unserVerdienst(o: { ek: number; kundenpreis: number; versandAnteil?: number | null; menge?: number | null }): Verdienst {
  const pro = r4(o.kundenpreis - o.ek - (o.versandAnteil ?? 0));
  return { proStueck: r2(pro), gesamt: o.menge ? r2(pro * o.menge) : null, prozentAufEk: o.ek > 0 ? r2((pro / o.ek) * 100) : null, negativ: pro < 0 };
}

export type KundenRechnung = { vkNetto: number; gebuehren: number; kosten: number; gewinn: number; roi: number | null; marge: number | null };

/**
 * Gewinn des Kunden je verkauftem Stück in einem Land (Prognose): Buy-Box-Preis brutto → netto (MwSt des Landes),
 * minus Amazon-Gebühren (Provision auf den Bruttopreis + FBA), minus Kundenpreis und Prep-Gebühr.
 * Fremdwährung vorher in EUR umrechnen.
 */
export function kundenGewinn(o: { vkBrutto: number; mwstSatz: number; provision: number; fbaGebuehr: number; kundenpreis: number; prepGebuehr?: number | null }): KundenRechnung {
  const vkNetto = o.vkBrutto / (1 + o.mwstSatz);
  const gebuehren = o.vkBrutto * o.provision + o.fbaGebuehr;
  const kosten = o.kundenpreis + (o.prepGebuehr ?? 0);
  const gewinn = vkNetto - gebuehren - kosten;
  return { vkNetto: r2(vkNetto), gebuehren: r2(gebuehren), kosten: r2(kosten), gewinn: r2(gewinn), roi: kosten > 0 ? r2((gewinn / kosten) * 100) : null, marge: vkNetto > 0 ? r2((gewinn / vkNetto) * 100) : null };
}

export type Warnung = { art: "unser_minus" | "kunde_roi" | "kein_preis" | "eigene_konkurrenz" | "aktionsmuster" | "freigabe_fehlt"; text: string };

/** Warnungen zur Preisfindung: Kunde unter Mindest-ROI im besten Land, wir im Minus, kein Kundenpreis. */
export function preisWarnungen(o: { verdienst: Verdienst | null; besterRoi: number | null; minRoiProzent: number; kundenpreis: number | null }): Warnung[] {
  const w: Warnung[] = [];
  if (o.kundenpreis === null) w.push({ art: "kein_preis", text: "Kundenpreis fehlt – ohne Preis kein Freischalten." });
  if (o.verdienst?.negativ) w.push({ art: "unser_minus", text: `Unser Verdienst ist negativ (${o.verdienst.proStueck.toFixed(2).replace(".", ",")} € je Stück).` });
  if (o.besterRoi !== null && o.besterRoi < o.minRoiProzent) w.push({ art: "kunde_roi", text: `Kunde landet höchstens bei ${o.besterRoi.toFixed(0)} % ROI (Mindest-ROI ${o.minRoiProzent.toFixed(0)} %).` });
  return w;
}

// ---- Mengengrenzen ---------------------------------------------------------------------------------

/** Vorschlag max. Gesamtmenge: Verkäufe/Monat im besten Land × Faktor − eigener Bestand (nie unter 0). */
export function mengenVorschlag(o: { verkaeufeBesterMarkt: number | null; faktor: number; eigenerBestand: number }): number | null {
  if (o.verkaeufeBesterMarkt === null) return null;
  return Math.max(0, Math.floor(o.verkaeufeBesterMarkt * o.faktor) - Math.max(0, o.eigenerBestand));
}

const AKTIV: ReservierungStatus[] = ["reserviert", "vorkasse_offen", "bezahlt", "bestellt", "angekommen", "an_prep", "erledigt"];
export const reservierungAktiv = (s: ReservierungStatus) => AKTIV.includes(s);

export type DealGrenzen = { status: DealStatus; frist: string | null; mindestmengeKunde: number; maxGesamt: number | null; maxProKunde: number | null; maxKunden: number | null };
export type AndereReservierung = { kundeId: string; menge: number; status: ReservierungStatus };

/** Was ein Kunde noch reservieren kann (Restmenge, Grenze je Kunde, Kunden je ASIN). */
export function reservierbar(d: DealGrenzen, alle: AndereReservierung[], kundeId: string, heute: string) {
  const aktiv = alle.filter((r) => reservierungAktiv(r.status));
  const andere = aktiv.filter((r) => r.kundeId !== kundeId);
  const vergeben = andere.reduce((n, r) => n + r.menge, 0);
  const rest = d.maxGesamt === null ? null : Math.max(0, d.maxGesamt - vergeben);
  const kunden = new Set(andere.map((r) => r.kundeId)).size;
  const hatSchon = aktiv.some((r) => r.kundeId === kundeId);
  const offen = d.status === "aktiv" && (!d.frist || d.frist >= heute);
  const kundenVoll = d.maxKunden !== null && !hatSchon && kunden >= d.maxKunden;
  const max = Math.min(rest ?? Infinity, d.maxProKunde ?? Infinity);
  return { offen, rest, kunden, kundenVoll, max: Number.isFinite(max) ? max : null, min: d.mindestmengeKunde };
}

/** Prüft eine Reservierung. Fehler auf Deutsch, so wie sie der Kunde im Portal sieht. */
export function pruefeReservierung(d: DealGrenzen, alle: AndereReservierung[], kundeId: string, menge: number, heute: string, bedingungen: boolean): { ok: true } | { ok: false; fehler: string } {
  const r = reservierbar(d, alle, kundeId, heute);
  if (!r.offen) return { ok: false, fehler: d.frist && d.frist < heute ? "Die Reservierungsfrist ist abgelaufen." : "Dieser Deal ist nicht (mehr) offen." };
  if (!bedingungen) return { ok: false, fehler: "Bitte die Bedingungen bestätigen (Vorkasse, Markenfreigabe selbst geprüft, Prognose ohne Garantie)." };
  if (!Number.isInteger(menge) || menge <= 0) return { ok: false, fehler: "Bitte eine Menge eingeben." };
  if (r.kundenVoll) return { ok: false, fehler: "Für diesen Deal sind schon genug Händler dabei (Schutz vor Preiskampf)." };
  if (menge < r.min) return { ok: false, fehler: `Mindestens ${r.min} Stück.` };
  if (r.rest !== null && menge > r.rest) return { ok: false, fehler: r.rest === 0 ? "Leider ausverkauft." : `Nur noch ${r.rest} Stück frei.` };
  if (d.maxProKunde !== null && menge > d.maxProKunde) return { ok: false, fehler: `Höchstens ${d.maxProKunde} Stück je Kunde.` };
  return { ok: true };
}

/** Anteil vergeben (für „fast weg“). */
export function vergebenAnteil(maxGesamt: number | null, alle: AndereReservierung[]): number | null {
  if (!maxGesamt) return null;
  return alle.filter((r) => reservierungAktiv(r.status)).reduce((n, r) => n + r.menge, 0) / maxGesamt;
}

// ---- Fehlmenge -------------------------------------------------------------------------------------

export type Zuteilbar = { id: string; menge: number; zeit: string | number | Date };

/**
 * Wareneingang auf die Reservierungen verteilen. Eigene Menge (übernommene Restmenge) wird zuerst gekürzt.
 * „anteilig“: nach Bruchteilen (größter Rest bekommt das Stück, bei Gleichstand die frühere Reservierung);
 * „zeitpunkt“: frühere Reservierungen werden zuerst voll bedient.
 */
export function teileZu(res: Zuteilbar[], eingang: number, regel: "anteilig" | "zeitpunkt", eigeneMenge = 0): { je: Record<string, number>; eigen: number; fehlt: number } {
  const soll = res.reduce((n, r) => n + r.menge, 0);
  const verfuegbar = Math.max(0, eingang);
  const eigen = Math.max(0, Math.min(eigeneMenge, verfuegbar - soll));
  let fuerKunden = Math.min(soll, verfuegbar - eigen);
  const je: Record<string, number> = {};
  const nachZeit = [...res].sort((a, b) => new Date(a.zeit).getTime() - new Date(b.zeit).getTime());
  if (fuerKunden >= soll) {
    for (const r of res) je[r.id] = r.menge;
  } else if (regel === "zeitpunkt") {
    for (const r of nachZeit) {
      je[r.id] = Math.min(r.menge, fuerKunden);
      fuerKunden -= je[r.id];
    }
  } else {
    const roh = nachZeit.map((r, i) => ({ r, i, exakt: soll ? (r.menge * fuerKunden) / soll : 0 }));
    for (const x of roh) je[x.r.id] = Math.floor(x.exakt);
    let rest = fuerKunden - roh.reduce((n, x) => n + je[x.r.id], 0);
    for (const x of [...roh].sort((a, b) => b.exakt - Math.floor(b.exakt) - (a.exakt - Math.floor(a.exakt)) || a.i - b.i)) {
      if (rest <= 0) break;
      if (je[x.r.id] < x.r.menge) {
        je[x.r.id]++;
        rest--;
      }
    }
  }
  return { je, eigen, fehlt: Math.max(0, soll + eigeneMenge - verfuegbar) };
}

// ---- Steuer ----------------------------------------------------------------------------------------

export type Steuer = { art: "inland" | "reverse_charge"; satz: number; hinweis: string | null };

/**
 * Reverse Charge nur für Firmenkunden in einem anderen EU-Land mit per VIES bestätigter USt-IdNr.; sonst
 * deutscher Satz. (Ob die Ware dafür das Land verlassen muss, klärt der Steuerberater – Hinweis wird angezeigt.)
 */
export function steuerFuer(o: { kundeLand: string; ustId: string | null; ustGueltig: boolean | null; firmaLand: string; satz: number }): Steuer {
  const land = o.kundeLand.toUpperCase();
  if (land !== o.firmaLand.toUpperCase() && EU.has(land) && o.ustId && o.ustGueltig === true) {
    return { art: "reverse_charge", satz: 0, hinweis: "Innergemeinschaftliche Lieferung (Reverse Charge) – nur, wenn die Ware in ein anderes EU-Land gelangt; bei Versand an ein FBA-Lager im eigenen Land mit dem Steuerberater klären." };
  }
  if (land !== o.firmaLand.toUpperCase() && EU.has(land) && o.ustId && o.ustGueltig !== true) {
    return { art: "inland", satz: o.satz, hinweis: "USt-IdNr. nicht (gültig) geprüft – deshalb mit Umsatzsteuer." };
  }
  return { art: "inland", satz: o.satz, hinweis: null };
}

/** „DE 123456789“, „fr12345678901“ → Land + Nummer für VIES. */
export function zerlegeUstId(roh: string | null | undefined): { land: string; nummer: string } | null {
  const s = (roh ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^([A-Z]{2})([0-9A-Z]{2,13})$/.exec(s);
  if (!m) return null;
  return { land: m[1] === "GR" ? "EL" : m[1], nummer: m[2] };
}

// ---- Aktionsmuster ---------------------------------------------------------------------------------

/**
 * Fällt der Preis regelmäßig auf ein ähnliches Tief (z. B. Aktionen)? Aus Tageswerten (älteste zuerst): Phasen,
 * in denen der Preis ≥ `schwelle` unter dem Median liegt. Ab zwei solchen Phasen mit ähnlichem Tief → Warnung.
 */
export function aktionsmuster(tage: (number | null)[], schwelle = 0.15): { anzahl: number; tief: number; text: string } | null {
  const werte = tage.filter((x): x is number => x !== null && x > 0);
  if (werte.length < 60) return null;
  const sortiert = [...werte].sort((a, b) => a - b);
  const median = sortiert[Math.floor(sortiert.length / 2)];
  const grenze = median * (1 - schwelle);
  const phasen: number[] = [];
  let tiefInPhase: number | null = null;
  for (const v of tage) {
    if (v !== null && v <= grenze) tiefInPhase = Math.min(tiefInPhase ?? v, v);
    else if (v !== null && tiefInPhase !== null) {
      phasen.push(tiefInPhase);
      tiefInPhase = null;
    }
  }
  if (tiefInPhase !== null) phasen.push(tiefInPhase);
  if (phasen.length < 2) return null;
  const tief = [...phasen].sort((a, b) => a - b)[Math.floor(phasen.length / 2)];
  const aehnlich = phasen.filter((p) => Math.abs(p - tief) / tief <= 0.08).length;
  if (aehnlich < 2) return null;
  return { anzahl: phasen.length, tief: r2(tief), text: `Preis fällt regelmäßig auf ca. ${r2(tief).toFixed(2).replace(".", ",")} € (${phasen.length}× in 12 Monaten, sonst um ${r2(median).toFixed(2).replace(".", ",")} €).` };
}

/** 12-Monats-Tief aus Tageswerten. */
export const tief12 = (tage: (number | null)[]) => {
  const w = tage.filter((x): x is number => x !== null && x > 0);
  return w.length ? Math.min(...w) : null;
};

// ---- Erfolgskontrolle ------------------------------------------------------------------------------

/** Wie prognostiziert (±10 %), besser oder schlechter – anhand des Ø-Buy-Box-Preises. */
export function bewerte(prognose: number | null, ist: number | null): { bewertung: "wie_prognostiziert" | "besser" | "schlechter" | "keine_daten"; abweichungProzent: number | null } {
  if (!prognose || ist === null) return { bewertung: "keine_daten", abweichungProzent: null };
  const a = r2(((ist - prognose) / prognose) * 100);
  return { bewertung: Math.abs(a) <= 10 ? "wie_prognostiziert" : a > 0 ? "besser" : "schlechter", abweichungProzent: a };
}

/** Deal-Bilanz: Trefferquote (wie prognostiziert oder besser) und Ø-Abweichung. */
export function bilanz(k: { bewertung: string; abweichungProzent: number | null }[]) {
  const mit = k.filter((x) => x.bewertung !== "keine_daten");
  const treffer = mit.filter((x) => x.bewertung !== "schlechter").length;
  const abw = mit.map((x) => x.abweichungProzent).filter((x): x is number => x !== null);
  return { anzahl: mit.length, trefferquote: mit.length ? r2((treffer / mit.length) * 100) : null, abweichungSchnitt: abw.length ? r2(abw.reduce((a, b) => a + b, 0) / abw.length) : null };
}

// ---- Status ----------------------------------------------------------------------------------------

export const DEAL_STATUS_TEXT: Record<DealStatus, string> = { entwurf: "Entwurf", aktiv: "offen", geschlossen: "geschlossen", bestellt: "bestellt", angekommen: "angekommen", verteilt: "verteilt", erledigt: "erledigt", verfallen: "verfallen" };
export const RES_STATUS_TEXT: Record<ReservierungStatus, string> = { reserviert: "reserviert", vorkasse_offen: "Vorkasse offen", bezahlt: "bezahlt", bestellt: "bestellt", angekommen: "angekommen", an_prep: "an Prep übergeben", erledigt: "erledigt", storniert: "storniert", erstattet: "erstattet" };

/** Sammelbestellung fällig? MOQ erreicht (bezahlt bzw. reserviert) oder Frist vorbei. */
export function bestellungFaellig(o: { moq: number; reserviert: number; bezahlt: number; nurBezahlte: boolean; frist: string | null; heute: string }): { faellig: boolean; grund: "moq" | "frist" | null; mengeOk: boolean } {
  const menge = o.nurBezahlte ? o.bezahlt : o.reserviert;
  const mengeOk = menge >= o.moq;
  if (mengeOk) return { faellig: true, grund: "moq", mengeOk };
  if (o.frist && o.frist < o.heute) return { faellig: true, grund: "frist", mengeOk };
  return { faellig: false, grund: null, mengeOk };
}

// ---- Deal-Blatt (Text für Chat/Discord) ------------------------------------------------------------

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `${n.toFixed(2).replace(".", ",")} €`);

export function dealBlattText(d: {
  nr: number;
  titel: string;
  asin: string;
  marke: string | null;
  kundenpreisNetto: number | null;
  mindestmengeKunde: number;
  maxProKunde: number | null;
  rest: number | null;
  frist: string | null;
  laender: { land: string; vk: number | null; gewinn: number | null; roi: number | null; verkaeufe: number | null; angebote: number | null }[];
  link: string;
}): string {
  const zeilen = d.laender
    .filter((l) => l.vk !== null)
    .map((l) => `${l.land}: VK ${eur(l.vk)} · Gewinn ${eur(l.gewinn)} · ROI ${l.roi === null ? "–" : `${l.roi.toFixed(0)} %`}${l.verkaeufe !== null ? ` · ~${l.verkaeufe}/Monat` : ""}${l.angebote !== null ? ` · ${l.angebote} Angebote` : ""}`);
  return [
    `Deal #${d.nr}: ${d.titel}${d.marke ? ` (${d.marke})` : ""}`,
    `ASIN ${d.asin} · Preis ${eur(d.kundenpreisNetto)} netto/Stück · ab ${d.mindestmengeKunde} Stück${d.maxProKunde ? `, max. ${d.maxProKunde}` : ""}${d.rest !== null ? ` · noch ${d.rest} frei` : ""}${d.frist ? ` · Frist ${d.frist.split("-").reverse().join(".")}` : ""}`,
    ...zeilen,
    "Prognose ohne Garantie. Markenfreigabe im eigenen Amazon-Konto vor der Reservierung prüfen.",
    d.link,
  ].join("\n");
}
