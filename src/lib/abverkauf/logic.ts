// B34.3 B2B-Abverkauf von Ladenhütern – reine Logik: Kandidaten, Preise mit Staffeln, Leads aus CSV, Kontaktweg/
// Rechtslage (E-Mail-Sperre), Brieftext mit Datenschutzhinweis nach Art. 14 DSGVO, Antworten zuordnen,
// Erfolg je Charge. Keine Rechtsberatung – vor Massenversand rechtlich prüfen lassen.

import { createHash } from "node:crypto";
import type { BeilageBestaetigt, BeilageFirma, BriefPreis } from "./kampagne-logic";

/** B34.3.6 Beilage der Logistik-Firma (AdelPrep): eigener Brief mit eigenem Absender, Impressum, Datenschutz. Leer bis eingetragen. */
export type AdelprepEinstellungen = BeilageFirma & { text: string; standardBeilegen: boolean; bestaetigt: BeilageBestaetigt };
/** B34.3a Briefversand über einen Anbieter. Preise hier (nicht im Code), live nur mit AV-Vertrag. */
export type BriefversandEinstellungen = {
  anbieter: "ebrief" | "letterxpress" | "epost";
  live: boolean;
  avVertrag: boolean;
  avDatum: string | null;
  tageslimit: number;
  budget: number | null;
  farbe: boolean;
  duplex: boolean;
  preise: Record<"ebrief" | "letterxpress" | "epost", BriefPreis>;
};
/** B34.3b Lager-Standort für den Umkreis und Preis je Palette (Lagerkostenrechner). */
export type LagerEinstellungen = { name: string; lat: number | null; lng: number | null; preisJePaletteMonat: number | null };

export type AbverkaufEinstellungen = {
  /** „Rechtlich geprüft“: erst dann E-Mails an Fremdkontakte (mit dokumentierter Einwilligung). */
  rechtlichGeprueft: boolean;
  tageslimit: number;
  aufschlagProzent: number;
  staffeln: { ab: number; rabattProzent: number }[];
  kriterien: { reichweiteTage: number; lagerTage: number; kapital: number };
  loeschfristTage: number;
  adelprep: AdelprepEinstellungen;
  briefversand: BriefversandEinstellungen;
  lager: LagerEinstellungen;
};

const OHNE_PREIS: BriefPreis = { grund: null, jeWeitereSeite: null };

export const ABVERKAUF_STANDARD: AbverkaufEinstellungen = {
  rechtlichGeprueft: false,
  tageslimit: 20,
  aufschlagProzent: 10,
  staffeln: [
    { ab: 10, rabattProzent: 3 },
    { ab: 50, rabattProzent: 6 },
  ],
  kriterien: { reichweiteTage: 90, lagerTage: 60, kapital: 300 },
  loeschfristTage: 180,
  // Firmendaten der Logistik-Firma trägt der Inhaber ein – nichts davon im Code.
  adelprep: { firma: "", strasse: "", plz: "", ort: "", email: "", telefon: "", web: "", impressum: "", datenschutz: "", text: "", standardBeilegen: false, bestaetigt: { flaeche: false, zaehlung: false, nda: false, gefahrgut: false } },
  // Preise je Anbieter trägt der Inhaber ein (laut Preisseite) – ohne Preis keine Kostenvorschau und kein Versand.
  briefversand: { anbieter: "ebrief", live: false, avVertrag: false, avDatum: null, tageslimit: 20, budget: null, farbe: false, duplex: false, preise: { ebrief: OHNE_PREIS, letterxpress: OHNE_PREIS, epost: OHNE_PREIS } },
  lager: { name: "", lat: null, lng: null, preisJePaletteMonat: null },
};

export const CHARGE_MAX = 20;
export const RECHTSGRUNDLAGE_BRIEF = "Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse: Angebot an Gewerbetreibende per Post)";
export const ZWECK = "Angebot von Restposten an Händler (B2B)";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ladenhüter: Reichweite über 90 Tage oder Lagerdauer über 60 Tage – und mehr als 300 € Kapital gebunden. */
export function istKandidat(z: { reichweite: number | null; aeltesteTage: number | null; kapital: number | null }, k = ABVERKAUF_STANDARD.kriterien): { ja: boolean; grund: string } {
  const kap = z.kapital ?? 0;
  const rw = z.reichweite !== null && z.reichweite > k.reichweiteTage;
  const alt = z.aeltesteTage !== null && z.aeltesteTage > k.lagerTage;
  const ja = kap > k.kapital && (rw || alt);
  const teile = [rw ? (z.reichweite! >= 9999 ? "keine Verkäufe" : `Reichweite ${Math.round(z.reichweite!)} T`) : null, alt ? `Lagerdauer ${z.aeltesteTage} T` : null, `${Math.round(kap)} € Kapital`].filter(Boolean);
  return { ja, grund: teile.join(" · ") };
}

/** Preis = Break-even + Aufschlag; Staffeln mit Rabatt, nie unter Break-even. */
export function preisPosition(breakEven: number, aufschlagProzent: number, staffeln: { ab: number; rabattProzent: number }[]): { preis: number; staffel: { ab: number; preis: number }[] } {
  const preis = r2(breakEven * (1 + Math.max(0, aufschlagProzent) / 100));
  const staffel = [...staffeln]
    .filter((s) => s.ab > 1 && s.rabattProzent > 0)
    .sort((a, b) => a.ab - b.ab)
    .map((s) => ({ ab: s.ab, preis: Math.max(r2(breakEven), r2(preis * (1 - s.rabattProzent / 100))) }));
  return { preis, staffel };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const firmaNorm = (f: string) => norm(f).replace(/\b(gmbh|ug|ag|kg|ohg|e k|ek|gbr|co|haftungsbeschraenkt|inh)\b/g, "").replace(/\s+/g, " ").trim();
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 40);

/** Schlüssel für Dubletten und Sperrliste (nur Prüfsummen, keine Klartextdaten). */
export const leadSchluessel = (firma: string, plz: string | null) => sha(`firma|${firmaNorm(firma)}|${(plz ?? "").replace(/\s/g, "")}`);
export const mailSchluessel = (email: string) => sha(`mail|${email.trim().toLowerCase()}`);

export type LeadEingabe = { firma: string; strasse: string | null; plz: string | null; ort: string | null; land: string; kategorie: string | null; email: string | null; emailQuelle: string | null; website: string | null; adelprep: boolean; lat: number | null; lng: number | null; groesse: string | null };

const SPALTE: Record<keyof LeadEingabe | "adresse", RegExp> = {
  firma: /^(firma|firmenname|name|title|titel|unternehmen|company|business name|haendler)$/,
  strasse: /^(strasse|street|strasse hausnummer|street address)$/,
  adresse: /^(adresse|anschrift|address|full address|vollstaendige adresse)$/,
  plz: /^(plz|postleitzahl|postal code|postalcode|zip|zip code)$/,
  ort: /^(ort|stadt|city|town)$/,
  land: /^(land|country|country code|countrycode)$/,
  kategorie: /^(kategorie|category|category name|categoryname|branche|categories)$/,
  email: /^(e mail|email|emails|e mails|mail)$/,
  emailQuelle: /^(e mail quelle|email quelle|quelle e mail|email source|e mail source|emailquelle)$/,
  website: /^(website|webseite|web|url|domain|homepage)$/,
  adelprep: /^(adelprep|zielgruppe adelprep|lager logistik|zielgruppe lager)$/,
  lat: /^(lat|latitude|breitengrad|location lat)$/,
  lng: /^(lng|lon|long|longitude|lae?ngengrad|location lng)$/,
  groesse: /^(groe?sse|size|betriebsgroe?sse|unternehmensgroe?sse)$/,
};
const janein = (v: string) => /^(ja|j|yes|y|x|1|true|wahr)$/i.test(v.trim());
const koordinate = (v: string, max: number) => {
  const n = Number(v.trim().replace(",", "."));
  return v.trim() && Number.isFinite(n) && Math.abs(n) <= max ? Math.round(n * 1e6) / 1e6 : null;
};

/**
 * Leads aus einer CSV (z. B. Apify-Export). E-Mail nur, wenn eine Spalte „E-Mail-Quelle“ das Impressum nennt –
 * sonst wird die E-Mail verworfen (Brief bleibt möglich). Ohne Firma oder ohne Ort/PLZ: Zeile verworfen.
 */
export function leadsAusTabelle(headers: string[], rows: string[][]): { leads: LeadEingabe[]; verworfen: string[]; ohneMail: number } {
  const h = headers.map(norm);
  const idx = Object.fromEntries(Object.entries(SPALTE).map(([k, re]) => [k, h.findIndex((x) => re.test(x))])) as Record<keyof typeof SPALTE, number>;
  const z = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  const leads: LeadEingabe[] = [];
  const verworfen: string[] = [];
  let ohneMail = 0;
  if (idx.firma < 0) return { leads, verworfen: ["Spalte „Firma“ (bzw. name/title) fehlt."], ohneMail };
  rows.forEach((r, n) => {
    const firma = z(r, idx.firma).slice(0, 200);
    let strasse = z(r, idx.strasse) || null;
    let plz = z(r, idx.plz) || null;
    let ort = z(r, idx.ort) || null;
    const adresse = z(r, idx.adresse);
    if (adresse && (!plz || !ort)) {
      const m = /^(.*?),?\s*(\d{5})\s+([^,]+)/.exec(adresse);
      if (m) {
        strasse ??= m[1].replace(/,\s*$/, "").trim() || null;
        plz ??= m[2];
        ort ??= m[3].trim();
      }
    }
    if (!firma) return void verworfen.push(`Zeile ${n + 2}: ohne Firma`);
    if (!plz && !ort) return void verworfen.push(`Zeile ${n + 2} (${firma}): ohne Anschrift`);
    const mailRoh = z(r, idx.email).split(/[,;\s]+/).find((x) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x)) ?? null;
    const quelle = z(r, idx.emailQuelle) || null;
    const email = mailRoh && quelle && /impressum|imprint/i.test(quelle) ? mailRoh.toLowerCase() : null;
    if (mailRoh && !email) ohneMail++;
    leads.push({ firma, strasse: strasse?.slice(0, 200) ?? null, plz: plz?.slice(0, 10) ?? null, ort: ort?.slice(0, 100) ?? null, land: (z(r, idx.land) || "DE").slice(0, 2).toUpperCase(), kategorie: z(r, idx.kategorie).slice(0, 120) || null, email, emailQuelle: email ? quelle!.slice(0, 200) : null, website: z(r, idx.website).slice(0, 300) || null, adelprep: janein(z(r, idx.adelprep)), lat: koordinate(z(r, idx.lat), 90), lng: koordinate(z(r, idx.lng), 180), groesse: z(r, idx.groesse).toLowerCase().slice(0, 20) || null });
  });
  return { leads, verworfen, ohneMail };
}

/**
 * E-Mail erlaubt? Bestandskunden ja. Fremdkontakte nur, wenn „Rechtlich geprüft“ an ist UND eine Einwilligung
 * dokumentiert ist (UWG § 7). Standard ist der Brief. Keine Rechtsberatung.
 */
export function mailErlaubt(l: { bestandskunde: boolean; einwilligung: string | null; email: string | null }, rechtlichGeprueft: boolean): { erlaubt: boolean; grund: string } {
  if (!l.email) return { erlaubt: false, grund: "keine E-Mail-Adresse (aus dem Impressum) hinterlegt" };
  if (l.bestandskunde) return { erlaubt: true, grund: "Bestandskunde" };
  if (!rechtlichGeprueft) return { erlaubt: false, grund: "E-Mail an Fremdkontakte gesperrt – „Rechtlich geprüft“ ist aus (Einstellungen)" };
  if (!l.einwilligung?.trim()) return { erlaubt: false, grund: "keine dokumentierte Einwilligung – bitte per Brief" };
  return { erlaubt: true, grund: `Einwilligung: ${l.einwilligung.trim()}` };
}

export type Absender = { name: string; strasse: string; plz: string; ort: string; email: string; telefon: string };

const datumDe = (iso: string) => iso.split("-").reverse().join(".");

/** Datenschutzhinweis nach Art. 14 DSGVO (Daten nicht beim Empfänger erhoben) – kurz, für Brief und E-Mail. */
export function datenschutzHinweis(a: Absender, l: { quelle: string; quelleDatum: string; loeschenAm: string }): string {
  return [
    "Datenschutzhinweis nach Art. 14 DSGVO:",
    `Verantwortlich: ${[a.name, [a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "), a.email].filter(Boolean).join(", ")}.`,
    `Ihre Firmendaten (Name, Geschäftsanschrift${"" /* E-Mail nur aus dem Impressum */}) stammen aus öffentlich zugänglichen Quellen (${l.quelle}, Stand ${datumDe(l.quelleDatum)}).`,
    `Zweck: einmaliges Angebot von Restposten an Gewerbetreibende. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse).`,
    `Speicherdauer: bis ${datumDe(l.loeschenAm)}, danach gelöscht – bei Widerspruch sofort.`,
    `Sie können jederzeit widersprechen sowie Auskunft, Berichtigung, Löschung und Einschränkung verlangen; Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde.`,
    `Abmelden: kurze Nachricht an ${a.email || "die oben genannte Adresse"} mit „keine Angebote“ – wir nehmen Sie auf unsere Sperrliste und schreiben Sie nicht mehr an.`,
  ].join(" ");
}

/** Standard-Anschreiben (ohne KI). Nur Angebot und Kontakt – keine internen Gründe, keine Einkaufspreise. */
export function anschreibenVorlage(o: { firma: string; kategorie: string | null; absender: Absender; positionen: { titel: string; menge: number; preis: number }[]; code: string }): { betreff: string; text: string } {
  const liste = o.positionen.slice(0, 8).map((p) => `– ${p.titel}: ${p.menge} Stück, ${p.preis.toFixed(2).replace(".", ",")} € netto je Stück`);
  return {
    betreff: `Restposten-Angebot für ${o.firma} (${o.code})`,
    text: [
      "Sehr geehrte Damen und Herren,",
      "",
      `wir haben einige Restposten neuer, originalverpackter Markenware abzugeben${o.kategorie ? ` – vielleicht passend für Ihr Sortiment (${o.kategorie})` : ""}:`,
      ...liste,
      o.positionen.length > 8 ? `– und ${o.positionen.length - 8} weitere Artikel (siehe Preisliste)` : "",
      "",
      "Alle Preise netto zzgl. USt., solange Vorrat reicht, Staffelpreise auf Anfrage bzw. laut Preisliste. Bei Interesse antworten Sie einfach unter Angabe des Bezugs oben.",
      "",
      "Mit freundlichen Grüßen",
      o.absender.name,
      [o.absender.telefon, o.absender.email].filter(Boolean).join(" · "),
    ]
      .filter((x, i, a) => !(x === "" && a[i - 1] === ""))
      .join("\n"),
  };
}

/** Anschreiben einer Kampagne: fester Brieftext der Kampagne, Positionen (nur angebotene), Hinweis auf QR-Code/Link. */
export function kampagneAnschreiben(o: { betreff: string; brieftext: string; absender: Absender; positionen: { titel: string; menge: number; preis: number }[]; code: string; firma: string }): { betreff: string; text: string } {
  const liste = o.positionen.slice(0, 8).map((p) => `– ${p.titel}: ${p.menge} Stück, ${p.preis.toFixed(2).replace(".", ",")} € netto je Stück`);
  return {
    betreff: `${o.betreff} (${o.code})`,
    text: [
      "Sehr geehrte Damen und Herren,",
      "",
      o.brieftext.trim(),
      ...(liste.length ? ["", ...liste, o.positionen.length > 8 ? `– und ${o.positionen.length - 8} weitere Artikel (siehe Anfrageseite)` : ""] : []),
      "",
      `Am schnellsten fragen Sie über den QR-Code bzw. den Link unten an (Bezug ${o.code}) – oder antworten Sie einfach mit diesem Bezug.`,
      "",
      "Mit freundlichen Grüßen",
      o.absender.name,
      [o.absender.telefon, o.absender.email].filter(Boolean).join(" · "),
    ]
      .filter((x, i, a) => !(x === "" && a[i - 1] === ""))
      .join("\n"),
  };
}

/** KI-Auftrag für einen Entwurf je Händler – nur Angebot und Kategorie, nichts Internes. */
export function kiAuftrag(o: { firma: string; kategorie: string | null; positionen: { titel: string; menge: number; preis: number }[]; absender: string }): string {
  return [
    "Schreibe ein kurzes, sachliches Geschäftsanschreiben (deutsch, Sie-Form, höchstens 120 Wörter) an einen Händler mit einem Restposten-Angebot.",
    `Empfänger: ${o.firma}${o.kategorie ? ` (Branche: ${o.kategorie})` : ""}. Absender: ${o.absender}.`,
    `Artikel: ${o.positionen.slice(0, 8).map((p) => `${p.titel} (${p.menge} Stück, ${p.preis.toFixed(2)} € netto)`).join("; ")}.`,
    "Keine Superlative, kein Zeitdruck, keine Angaben zu Einkaufspreisen, Gewinnen oder Gründen des Verkaufs. Nur der Brieftext ohne Betreff und ohne Grußformel-Platzhalter.",
  ].join("\n");
}

const CODE = /\bAV-([A-Z0-9]{4,8})\b/i;
export const codeAus = (s: string) => CODE.exec(s)?.[0]?.toUpperCase() ?? null;
export const istAbmeldung = (s: string) => /(keine (angebote|werbung|post|e-?mails)|abmelden|abbestellen|unsubscribe|widerspruch|widerspreche|bitte (streichen|löschen))/i.test(s);

/** Erfolg je Charge: Rücklauf (Antworten ÷ versendet), Umsatz, Marge. */
export function chargeErfolg(a: { status: string; umsatz: number | null; marge: number | null }[]): { versendet: number; beantwortet: number; ruecklaufProzent: number | null; umsatz: number; marge: number } {
  const versendet = a.filter((x) => x.status === "versendet" || x.status === "beantwortet").length;
  const beantwortet = a.filter((x) => x.status === "beantwortet").length;
  return { versendet, beantwortet, ruecklaufProzent: versendet ? Math.round((beantwortet / versendet) * 100) : null, umsatz: r2(a.reduce((n, x) => n + (x.umsatz ?? 0), 0)), marge: r2(a.reduce((n, x) => n + (x.marge ?? 0), 0)) };
}

/** Tageslimit: wie viele dürfen heute noch freigegeben werden? */
export const tagesRest = (heuteFreigegeben: number, limit: number) => Math.max(0, Math.min(CHARGE_MAX, limit - heuteFreigegeben));
