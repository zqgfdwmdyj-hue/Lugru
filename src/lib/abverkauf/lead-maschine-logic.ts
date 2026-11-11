// B35 Lead-Maschine – reine Logik (ohne Datenbank und Netz): Anreichern, Dubletten, Abgleich mit Bestandsdaten,
// Bewertung je Zielgruppe, Schutzregeln für Chargen, Budget je Lauf/Monat, robots.txt und Captcha-Erkennung.
// Automatisch sind Finden, Anreichern, Bewerten, Zuordnen und Brief-Vorbereiten – nie der Versand.
// Hinweis: `norm` entfernt Umlaut-Punkte („ü“ → „u“) – Muster deshalb ohne Umlaute bzw. mit beiden Schreibweisen.
// Keine Firmennamen, Preise oder Marken aus echten Daten im Code: Listen (Konfliktbranchen, Großmarken, eigene
// Sperrnamen) trägt der Inhaber in den Einstellungen ein.

import { entfernungKm, type Punkt, type Zielgruppe } from "./kampagne-logic";
import { firmaNorm, norm } from "./logic";

// ---- Anreichern ---------------------------------------------------------------------------------------------------

const RECHTSFORMEN: [RegExp, string][] = [
  [/\bgmbh\s*&\s*co\.?\s*kg\b/i, "GmbH & Co. KG"],
  [/\bug\b.*haftungsbeschr|\bug\s*\(haftungsbeschr|\bug\b/i, "UG"],
  [/\bgmbh\b/i, "GmbH"],
  [/\bag\b/i, "AG"],
  [/\bkg\b/i, "KG"],
  [/\bohg\b/i, "OHG"],
  [/\be\.\s?k\.?(?=\s|$)|\beingetragene[rn]? kauf/i, "e.K."],
  [/\bgbr\b/i, "GbR"],
  [/\be\.\s?v\.?(?=\s|$)/i, "e.V."],
  [/\b(ltd|limited)\b/i, "Ltd."],
  [/\bs\.?r\.?l\.?\b/i, "S.r.l."],
  [/\bb\.?v\.?\b/i, "B.V."],
];

/** Rechtsform aus dem Firmennamen („Test GmbH & Co. KG“ → „GmbH & Co. KG“), sonst null. */
export function rechtsformAus(firma: string): string | null {
  for (const [re, name] of RECHTSFORMEN) if (re.test(firma)) return name;
  return null;
}

/** Domain einer Website („https://www.test.example/impressum“ → „test.example“), sonst null. */
export function domainAus(website: string | null | undefined): string | null {
  const w = (website ?? "").trim();
  if (!w) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return /\./.test(h) && !/^(\d+\.){3}\d+$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

/** USt-IdNr. normiert („DE 123 456 789“ → „DE123456789“), nur plausible Formate. */
export function ustNorm(roh: string | null | undefined): string | null {
  const t = (roh ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  return /^(DE\d{9}|AT U\d{8}|ATU\d{8}|FR[0-9A-Z]{2}\d{9}|IT\d{11}|ES[0-9A-Z]\d{7}[0-9A-Z]|NL\d{9}B\d{2}|BE0?\d{9,10}|PL\d{10}|CZ\d{8,10}|CHE\d{9}(MWST|TVA|IVA)?|LU\d{8}|DK\d{8}|SE\d{12}|IE\d{7}[A-Z]{1,2}|PT\d{9})$/.test(t) ? t.replace(/^AT U/, "ATU") : null;
}

/** Handelsregister: „Amtsgericht Musterstadt HRB 12345“ → { typ: "HRB", nr: "12345", gericht: "musterstadt" }. */
export function registerAus(roh: string | null | undefined): { typ: string; nr: string; gericht: string | null } | null {
  const t = (roh ?? "").replace(/\s+/g, " ");
  const m = /\b(HR[AB]|GnR|PR|VR)\s*[:.]?\s*(\d{1,7})\s*([A-Z]{0,2})\b/i.exec(t);
  if (!m) return null;
  const g = /(?:amtsgericht|registergericht|ag)\s+([A-Za-zÄÖÜäöüß.\- ]{3,40}?)(?=[,;]|\s+(?:HR[AB]|GnR|PR|VR)\b|$)/i.exec(t);
  return { typ: m[1].toUpperCase().replace("GNR", "GnR"), nr: `${m[2]}${m[3] ? ` ${m[3].toUpperCase()}` : ""}`, gericht: g ? norm(g[1]) : null };
}

/** Anzeigeform „HRB 12345 (Amtsgericht musterstadt)“. */
export const registerText = (r: ReturnType<typeof registerAus>) => (r ? `${r.typ} ${r.nr}${r.gericht ? ` (AG ${r.gericht})` : ""}` : null);

// ---- Dubletten ----------------------------------------------------------------------------------------------------

export type DublettenLead = { firma: string; plz: string | null; strasse?: string | null; website?: string | null; ustId?: string | null; registerNr?: string | null };

/** Schlüssel, über die zwei Datensätze dieselbe Firma sind: Name+PLZ, Website-Domain, USt-IdNr., Handelsregister (mit Gericht). */
export function dublettenSchluessel(l: DublettenLead): string[] {
  const keys: string[] = [];
  const name = firmaNorm(l.firma);
  if (name) keys.push(`name:${name}|${(l.plz ?? "").replace(/\s/g, "")}`);
  const d = domainAus(l.website);
  // Marktplatz-/Baukasten-Domains sind keine Firmen-Website
  if (d && !/(^|\.)(amazon|ebay|etsy|facebook|instagram|google|wixsite|jimdo|business\.site|linktr)\./.test(`${d}.`)) keys.push(`web:${d}`);
  const u = ustNorm(l.ustId);
  if (u) keys.push(`ust:${u}`);
  const r = registerAus(l.registerNr);
  if (r?.gericht) keys.push(`hr:${r.typ}${r.nr.replace(/\s/g, "")}|${r.gericht}`);
  return keys;
}

/**
 * Datensätze in Gruppen gleicher Firmen zusammenfassen (Union-Find über die Schlüssel). Rückgabe: Indexgruppen,
 * die erste Zahl ist der Datensatz, der bleibt (der erste in der Liste).
 */
export function dublettenGruppen(liste: DublettenLead[]): number[][] {
  const eltern = liste.map((_, i) => i);
  const finde = (i: number): number => (eltern[i] === i ? i : (eltern[i] = finde(eltern[i])));
  const erster = new Map<string, number>();
  liste.forEach((l, i) => {
    for (const k of dublettenSchluessel(l)) {
      const j = erster.get(k);
      if (j === undefined) erster.set(k, i);
      else {
        const a = finde(i);
        const b = finde(j);
        if (a !== b) eltern[Math.max(a, b)] = Math.min(a, b);
      }
    }
  });
  const gruppen = new Map<number, number[]>();
  liste.forEach((_, i) => {
    const w = finde(i);
    gruppen.set(w, [...(gruppen.get(w) ?? []), i]);
  });
  return [...gruppen.values()];
}

/** Zusammenführen: leere Felder des bestehenden Datensatzes aus dem neuen füllen (nichts überschreiben). */
export function zusammenfuehren<T extends Record<string, unknown>>(alt: T, neu: Partial<T>): { ergebnis: T; ergaenzt: string[] } {
  const ergebnis = { ...alt };
  const ergaenzt: string[] = [];
  for (const [k, v] of Object.entries(neu)) {
    const a = (alt as Record<string, unknown>)[k];
    if ((a === null || a === undefined || a === "") && v !== null && v !== undefined && v !== "") {
      (ergebnis as Record<string, unknown>)[k] = v;
      ergaenzt.push(k);
    }
  }
  return { ergebnis, ergaenzt };
}

// ---- Abgleich mit Bestandsdaten (Lieferanten, Kunden, Palettenkunden, Mitbewerber, eigene Sperrliste) -------------

export type BestandArt = "lieferant" | "b2b_kunde" | "palettenkunde" | "kunde" | "sperrname" | "mitbewerber";
export const BESTAND_TEXT: Record<BestandArt, string> = { lieferant: "eigener Lieferant", b2b_kunde: "B2B-Kunde", palettenkunde: "Palettenkunde", kunde: "Kunde (Rechnung)", sperrname: "eigene Sperrliste", mitbewerber: "Mitbewerber" };
export type BestandEintrag = { art: BestandArt; name: string; ustId?: string | null; domain?: string | null };

/** Trifft der Lead einen Bestandseintrag? Gleicher Name (ohne Rechtsform), gleiche USt-IdNr. oder gleiche Domain. */
export function bestandTreffer(l: { firma: string; ustId?: string | null; website?: string | null }, bestand: BestandEintrag[]): BestandEintrag | null {
  const name = firmaNorm(l.firma);
  const u = ustNorm(l.ustId);
  const d = domainAus(l.website);
  for (const b of bestand) {
    const bn = firmaNorm(b.name);
    if (bn && name && (bn === name || (bn.length >= 6 && (` ${name} `).includes(` ${bn} `)))) return b;
    if (u && ustNorm(b.ustId) === u) return b;
    if (d && b.domain && domainAus(b.domain) === d) return b;
  }
  return null;
}

// ---- Bewertung ------------------------------------------------------------------------------------------------------

export type LeadZiel = "abverkauf" | "friseure" | "spielwaren" | "fba_prep" | "lager";
export const ZIELE: LeadZiel[] = ["abverkauf", "friseure", "spielwaren", "fba_prep", "lager"];
export const ZIEL_TEXT: Record<LeadZiel, string> = { abverkauf: "B2B-Abverkauf (Ladenhüter)", friseure: "Friseure", spielwaren: "Spielwaren lokal", fba_prep: "AdelPrep FBA-Prep", lager: "AdelPrep Lager & Logistik" };
/** Welche Kampagnen-Zielgruppe einen Brief schreibt (FBA-Prep = Abverkaufsbrief + AdelPrep-Beilage). */
export const ZIEL_ZIELGRUPPE: Record<LeadZiel, Zielgruppe> = { abverkauf: "amazon_haendler", friseure: "friseure", spielwaren: "spielwaren", fba_prep: "amazon_haendler", lager: "adelprep_lager" };

export type BewertungLead = {
  firma: string;
  kategorie: string | null;
  marken: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  website: string | null;
  ustId: string | null;
  quelleTyp: string | null;
  lat: number | null;
  lng: number | null;
  groesse: string | null;
  stueckJeArtikel: number | null;
  anzahlAsins: number | null;
  mitarbeiter: number | null;
  letzteAktivitaet: string | null;
  adelprep: boolean;
  konfliktFreigabe: boolean;
};

export type BewertungKontext = {
  heute: string;
  lager: Punkt | null;
  /** Ladenhüter im Bestand: Titel (Marke/Kategorie stecken meist im Titel) und gebundenes Kapital. */
  ladenhueter: { titel: string; kapital: number | null }[];
  bestand: BestandEintrag[];
  adelprepAbStueck: number;
  konfliktbranchen: string[];
  grossmarken: string[];
  lagerbedingungen: string[];
  umkreisLokalKm: number;
  umkreisLagerKm: number;
};

export type Bewertung = {
  punkte: Record<LeadZiel, number>;
  erreichbar: boolean;
  nutzen: number;
  prioritaet: number;
  empfZiel: LeadZiel | null;
  empfBeilage: boolean;
  markierungen: string[];
  ausschluss: string | null;
  km: number | null;
  rechtsform: string | null;
};

const STOP = new Set(["und", "oder", "fuer", "mit", "der", "die", "das", "set", "stueck", "stuck", "pack", "packung", "neu", "original", "groesse", "grosse", "farbe", "test", "erfunden", "artikel", "gmbh", "teile", "zubehoer", "zubehor"]);
const woerter = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
const enthaelt = (text: string, begriffe: string[]) => {
  const t = ` ${norm(text)} `;
  // Wortanfang reicht („wein“ trifft „Weinhandel“), kurze Begriffe (< 4 Zeichen) nur als ganzes Wort
  return begriffe.map((b) => norm(b)).filter(Boolean).find((b) => t.includes(` ${b} `) || (b.length >= 4 && t.includes(` ${b}`))) ?? null;
};

const RE = {
  friseur: /friseur|frisoer|frisor|salon|haar|barber|coiffeur|hair/,
  spielwaren: /spielwar|spielzeug|toys?\b|spiele|modellbau|kinderspiel/,
  amazon: /amazon|fba|marketplace|marktplatz|online ?(h(ae|a)ndler|handel|shop)|e ?commerce|onlineshop|versandhandel/,
  lagerbedarf: /online|shop|versand|hersteller|herstellung|produktion|manufaktur|import|grosshandel|e ?commerce|messe|event|handwerk|lager|saison/,
  mitbewerber: /prep ?cent|prepcenter|fulfil|logistik|lagerhaus|spedition|kontraktlogistik|lagerdienst/,
  frisch: /frischware|frische (ware|lebensmittel)|obst|gem(ue|u)se|metzgerei|fleischerei|b(ae|a)ckerei|konditorei/,
  insolvenz: /insolvenz|in liquidation|\bi l\b|\bi\.l\./,
};

/**
 * Bewertung eines Leads: Punkte je Zielgruppe (0–100), Erreichbarkeit (Postadresse), Nutzen (0–1), Priorität =
 * Fit × Erreichbarkeit × Nutzen, empfohlene Kampagne und Beilage, Markierungen und Ausschlussgrund.
 */
export function leadBewerten(l: BewertungLead, ctx: BewertungKontext): Bewertung {
  const text = norm(`${l.firma} ${l.kategorie ?? ""} ${l.marken ?? ""}`);
  const kat = norm(`${l.kategorie ?? ""} ${l.marken ?? ""}`);
  const markierungen: string[] = [];
  let ausschluss: string | null = null;
  const erreichbar = !!(l.strasse?.trim() && l.plz?.trim() && l.ort?.trim());
  const km = ctx.lager && l.lat !== null && l.lng !== null ? entfernungKm(ctx.lager, { lat: l.lat, lng: l.lng }) : null;
  const rechtsform = rechtsformAus(l.firma);

  // Schutzregeln (Ausschluss vor Bewertung)
  const treffer = bestandTreffer(l, ctx.bestand);
  if (treffer) ausschluss = `Bestand: ${BESTAND_TEXT[treffer.art]} („${treffer.name}“) – nicht als Lead anschreiben`;
  if (!ausschluss && RE.insolvenz.test(` ${text} `)) ausschluss = "Insolvenz/Liquidation – nicht aufnehmen";
  if (!ausschluss && RE.frisch.test(text)) ausschluss = "Frischware – nicht aufnehmen";
  const konflikt = enthaelt(text, ctx.konfliktbranchen);
  if (!ausschluss && konflikt && !l.konfliktFreigabe) ausschluss = `Konfliktbranche („${konflikt}“) – nur per Freigabe`;
  if (!ausschluss && !erreichbar && !l.website?.trim() && !ustNorm(l.ustId)) ausschluss = "Unklare Firmenzuordnung (keine Adresse, Website oder USt-IdNr.) – nicht aufnehmen";
  if (!ausschluss && !rechtsform && !kat.trim() && !l.website?.trim() && /^[\p{L}'.-]+(\s+[\p{L}'.-]+){1,3}$/u.test(l.firma.trim())) ausschluss = "Vermutlich Privatperson – kein B2B";
  const lagerHinweis = enthaelt(text, ctx.lagerbedingungen);
  if (lagerHinweis) markierungen.push(`Lagerbedingungen klären („${lagerHinweis}“)`);
  const mitbewerber = RE.mitbewerber.test(kat);
  if (mitbewerber) markierungen.push("Mitbewerber (Prep/Logistik)");
  if (!erreichbar) markierungen.push("ohne vollständige Postadresse – nicht im Versand");

  const punkte: Record<LeadZiel, number> = { abverkauf: 0, friseure: 0, spielwaren: 0, fba_prep: 0, lager: 0 };
  const nutzen: Record<LeadZiel, number> = { abverkauf: 0, friseure: 0.5, spielwaren: 0.5, fba_prep: 0, lager: 0.5 };
  const amazonSignal = RE.amazon.test(kat) || ["keepa", "helium10"].includes(l.quelleTyp ?? "") || (l.anzahlAsins ?? 0) > 0;
  const lokal = (fit: number) => (km === null ? fit * 0.7 : km <= ctx.umkreisLokalKm ? fit : fit * 0.3);

  // B2B-Abverkauf: Kategorie/Marken passen zu Ladenhütern im Bestand
  if (ctx.ladenhueter.length && !mitbewerber) {
    const leadW = woerter(`${l.kategorie ?? ""} ${l.marken ?? ""}`);
    let treffer2 = 0;
    let kapital = 0;
    for (const h of ctx.ladenhueter) {
      const hw = woerter(h.titel);
      // gleiches Wort oder Wortteil („puzzle“ ↔ „Testpuzzle“, „holz“ ↔ „Holzspielzeug“)
      const n = [...leadW].filter((w) => hw.has(w) || [...hw].some((x) => x.includes(w) || w.includes(x))).length;
      if (n) {
        treffer2 += n;
        kapital += h.kapital ?? 0;
      }
    }
    punkte.abverkauf = Math.min(100, (amazonSignal || RE.lagerbedarf.test(kat) ? 30 : 15) + treffer2 * 25);
    if (!treffer2) punkte.abverkauf = amazonSignal ? 20 : 0;
    nutzen.abverkauf = Math.min(1, kapital / 2000);
  }
  // Friseure / Spielwaren lokal (Branche + Umkreis)
  if (RE.friseur.test(kat)) punkte.friseure = Math.round(lokal(100));
  if (RE.spielwaren.test(kat)) punkte.spielwaren = Math.round(lokal(100));
  // AdelPrep FBA-Prep: Amazon-Händler mit großen Stückzahlen je Artikel
  if (amazonSignal && !mitbewerber) {
    const s = l.stueckJeArtikel;
    let fit = s === null ? 40 : s >= ctx.adelprepAbStueck ? Math.min(100, 80 + Math.round(s / 50)) : 20;
    const gross = enthaelt(l.firma + " " + (l.marken ?? ""), ctx.grossmarken);
    if (gross || (l.mitarbeiter ?? 0) >= 250) {
      fit = Math.round(fit * 0.2);
      markierungen.push(gross ? `Großmarke mit eigener Logistik („${gross}“) – abgewertet` : "Großes Unternehmen (≥ 250 Mitarbeiter) – abgewertet");
    } else if ((s !== null && s < 20) || (l.anzahlAsins !== null && l.anzahlAsins <= 2)) {
      fit = Math.round(fit * 0.3);
      markierungen.push("Kleinst-Händler – abgewertet");
    }
    if (l.letzteAktivitaet && /^\d{4}-\d{2}-\d{2}/.test(l.letzteAktivitaet) && Date.parse(ctx.heute) - Date.parse(l.letzteAktivitaet.slice(0, 10)) > 730 * 86_400_000) {
      fit = Math.round(fit * 0.3);
      markierungen.push("Amazon-Aktivität nur aus Artikeln > 2 Jahre – niedrige Priorität");
    }
    punkte.fba_prep = fit;
    nutzen.fba_prep = s === null ? 0.4 : Math.min(1, s / 500);
  }
  // AdelPrep Lager & Logistik: Firmen im Umkreis mit Lagerbedarf
  if (!mitbewerber && (RE.lagerbedarf.test(kat) || amazonSignal || l.groesse === "mittel" || l.groesse === "gross" || l.groesse === "groß")) {
    if (km !== null && km <= ctx.umkreisLagerKm) punkte.lager = Math.round(60 + 40 * (1 - km / ctx.umkreisLagerKm));
    else if (km === null) punkte.lager = 30;
  }

  if (ausschluss) for (const z of ZIELE) punkte[z] = 0;
  const empf = ZIELE.reduce<LeadZiel | null>((best, z) => (punkte[z] > 0 && (!best || punkte[z] > punkte[best]) ? z : best), null);
  const n = empf ? nutzen[empf] : 0;
  const prioritaet = empf && erreichbar ? Math.round(punkte[empf] * (0.5 + 0.5 * n)) : 0;
  const empfBeilage = !ausschluss && !mitbewerber && (punkte.fba_prep >= 60 || l.adelprep);
  return { punkte, erreichbar, nutzen: Math.round(n * 100) / 100, prioritaet, empfZiel: empf, empfBeilage, markierungen, ausschluss, km, rechtsform };
}

// ---- Schutzregeln für Chargen -----------------------------------------------------------------------------------

export const plusMonateIso = (iso: string, monate: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + monate);
  return d.toISOString().slice(0, 10);
};

export type SperrLead = { status: string; rechtsgrundlage: string | null; ausschluss: string | null; markierungen: string[]; erreichbar: boolean; letzterBriefAm: string | null; prioritaet: number; quelleGesperrt: string | null; offenerEntwurf: boolean };

/** Darf der Lead in eine Charge? Grund, wenn nicht (Reihenfolge: härteste Sperre zuerst). */
export function chargeSperre(l: SperrLead, o: { heute: string; mindestabstandMonate: number; standard: boolean }): string | null {
  if (l.status === "gesperrt") return "auf der Sperrliste (Widerspruch/Abmeldung)";
  if (l.ausschluss) return l.ausschluss;
  if (l.quelleGesperrt) return l.quelleGesperrt;
  if (!l.rechtsgrundlage?.trim()) return "Rechtsgrundlage fehlt";
  if (!l.erreichbar) return "ohne vollständige Postadresse";
  if (l.letzterBriefAm && o.mindestabstandMonate > 0 && plusMonateIso(l.letzterBriefAm, o.mindestabstandMonate) > o.heute) return `Mindestabstand: letzter Brief am ${l.letzterBriefAm.split("-").reverse().join(".")} (höchstens 1 Brief in ${o.mindestabstandMonate} Monaten)`;
  if (l.offenerEntwurf) return "hat schon einen offenen Entwurf";
  if (o.standard && l.markierungen.some((m) => m.startsWith("Lagerbedingungen klären"))) return "Lagerbedingungen klären – nicht in der Standard-Charge";
  if (o.standard && l.prioritaet <= 0) return "keine passende Kampagne (Priorität 0)";
  return null;
}

// ---- Budget, robots.txt, Captcha, Impressum -------------------------------------------------------------------

/** Budget je Lauf und Monat: wie viel darf dieser Lauf höchstens kosten? null = nicht laufen (mit Grund). */
export function laufBudget(o: { budgetLauf: number | null; budgetMonat: number | null; monatBisher: number }): { erlaubt: number | null; grund: string | null } {
  if (!o.budgetLauf || o.budgetLauf <= 0) return { erlaubt: null, grund: "Budget je Lauf fehlt (Einstellungen)" };
  if (!o.budgetMonat || o.budgetMonat <= 0) return { erlaubt: null, grund: "Monatsbudget fehlt (Einstellungen)" };
  const rest = Math.round((o.budgetMonat - o.monatBisher) * 100) / 100;
  if (rest <= 0) return { erlaubt: null, grund: `Monatsbudget erreicht (${o.monatBisher.toFixed(2)} von ${o.budgetMonat.toFixed(2)})` };
  return { erlaubt: Math.min(o.budgetLauf, rest), grund: null };
}

/** Stufe 2 freigegeben? (Datum der rechtlichen Prüfung eingetragen) */
export function stufe2Sperre(q: { rechtlichGeprueftAm: string | null }): string | null {
  return q.rechtlichGeprueftAm ? null : "Stufe 2 gesperrt – rechtliche Prüfung noch nicht eingetragen (Leads → Quellen)";
}

/** Google-Places-Suchen aus den Einstellungen: je Zeile „Begriff | Ort/PLZ | Radius km“ (Ort und Radius optional), höchstens 20. */
export function placesSuchenLesen(text: string): { begriff: string; ort: string; radiusKm: number | null }[] {
  return text
    .split(/\r?\n/)
    .map((z) => z.split("|").map((x) => x.trim()))
    .filter((t) => t[0])
    .slice(0, 20)
    .map((t) => {
      const r = Number((t[2] ?? "").replace(",", "."));
      return { begriff: t[0].slice(0, 80), ort: (t[1] ?? "").slice(0, 80), radiusKm: t[2] && Number.isFinite(r) && r > 0 ? r : null };
    });
}

export const LEAD_USER_AGENT = "SellerSystem-Leadsuche/1.0 (Impressum-Abruf; hoechstens 1 Abruf je 6 s)";

/** robots.txt: darf unser Abruf (eigener User-Agent bzw. „*“) diesen Pfad lesen? Längste Regel gewinnt. */
export function robotsErlaubt(robots: string | null, pfad: string, agent = "SellerSystem-Leadsuche"): boolean {
  if (!robots) return true;
  type Gruppe = { agents: string[]; regeln: { allow: boolean; pfad: string }[] };
  const gruppen: Gruppe[] = [];
  let akt: Gruppe | null = null;
  let regelnBegonnen = false;
  for (const zeileRoh of robots.split(/\r?\n/)) {
    const zeile = zeileRoh.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(zeile);
    if (!m) continue;
    const feld = m[1].toLowerCase();
    const wert = m[2].trim();
    if (feld === "user-agent") {
      if (!akt || regelnBegonnen) {
        akt = { agents: [], regeln: [] };
        gruppen.push(akt);
        regelnBegonnen = false;
      }
      akt.agents.push(wert.toLowerCase());
    } else if ((feld === "allow" || feld === "disallow") && akt) {
      regelnBegonnen = true;
      if (feld === "disallow" && !wert) continue;
      akt.regeln.push({ allow: feld === "allow", pfad: wert });
    }
  }
  const a = agent.toLowerCase();
  const gruppe = gruppen.find((g) => g.agents.some((x) => x !== "*" && a.includes(x))) ?? gruppen.find((g) => g.agents.includes("*"));
  if (!gruppe) return true;
  const passt = (regel: string) => {
    const re = new RegExp(`^${regel.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    return re.test(pfad);
  };
  const treffer = gruppe.regeln.filter((r) => passt(r.pfad)).sort((x, y) => y.pfad.length - x.pfad.length || Number(y.allow) - Number(x.allow));
  return treffer.length ? treffer[0].allow : true;
}

/** Captcha oder Sperrseite? Dann Quelle für diesen Lauf überspringen und melden – nicht erneut versuchen. */
export function istCaptcha(status: number, html: string): boolean {
  if (status === 429) return true;
  return /captcha|recaptcha|hcaptcha|cf-chl|challenge-platform|are you a robot|bist du ein mensch|sind sie ein mensch|ungewöhnliche[nr]? (datenverkehr|aktivität)|unusual traffic|access denied|zugriff verweigert/i.test(html.slice(0, 200_000)) && (status === 403 || status === 503 || status === 200 || status === 401);
}

/** Längste gültige USt-IdNr. am Anfang (Folgetext wie „E-Mail“ direkt dahinter abschneiden). */
function ustLaengste(roh: string): string | null {
  const t = roh.toUpperCase().replace(/[\s.\-/]/g, "");
  for (let n = t.length; n >= 8; n--) {
    const u = ustNorm(t.slice(0, n));
    if (u) return u;
  }
  return null;
}

/** Fakten aus einer Impressumsseite: USt-IdNr., Handelsregister, Postadresse (Straße, PLZ, Ort). */
export function impressumFakten(html: string): { ustId: string | null; registerNr: string | null; strasse: string | null; plz: string | null; ort: string | null } {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr|address)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
  const ust = /(?:USt[-.\s]*Id[-.\s]*Nr\.?|Umsatzsteuer[-\s]*(?:Identifikations)?(?:nummer|ID)|VAT(?:\s*(?:ID|No\.?|Number))?)\s*[:.]?\s*((?:DE|AT|FR|IT|ES|NL|BE|PL|CZ|LU|DK|SE|IE|PT)[ \t]*U?[\dA-Z \t]{8,14})/i.exec(text);
  const reg = /((?:Amtsgericht|Registergericht)[^\n]{0,60}?(?:HR[AB]|GnR)\s*[:.]?\s*\d{1,7}[^\n]{0,4}|(?:HR[AB]|GnR)\s*[:.]?\s*\d{1,7}[^\n]{0,60})/i.exec(text);
  const adr = /([A-ZÄÖÜ][\wäöüß.\- ]{2,40}?\s\d{1,4}\s?[a-z]?)\s*[\n,]\s*(\d{5})\s+([A-ZÄÖÜ][\wäöüß.\- ]{1,40})/.exec(text);
  const r = reg ? registerAus(reg[1]) : null;
  return {
    ustId: ust ? ustLaengste(ust[1]) : null,
    registerNr: r ? registerText(r) : null,
    strasse: adr ? adr[1].trim() : null,
    plz: adr ? adr[2] : null,
    ort: adr ? adr[3].trim().replace(/\s+(Deutschland|Germany)$/i, "") : null,
  };
}

// ---- Berichte -------------------------------------------------------------------------------------------------

/** Zeile für den Morgenbericht – nur wenn es etwas zu sagen gibt. */
export function leadsMorgenZeile(o: { neu7: number; entwuerfe: number; kostenMonat: number; anfragen7: number; ruecklauf7: number }): string | null {
  const teile = [
    o.entwuerfe ? `${o.entwuerfe} Brief-Entwürfe warten auf Freigabe` : null,
    o.neu7 ? `${o.neu7} neue Leads (7 T)` : null,
    o.anfragen7 || o.ruecklauf7 ? `${o.anfragen7 + o.ruecklauf7} Rückmeldungen (7 T)` : null,
    o.kostenMonat > 0 ? `Lead-Kosten Monat ${o.kostenMonat.toFixed(2).replace(".", ",")} €` : null,
  ].filter(Boolean);
  return teile.length ? `Leads: ${teile.join(", ")}` : null;
}
