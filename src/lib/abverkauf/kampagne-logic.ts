// B34.3a/b/3.6 reine Logik: Zielgruppen, MHD-Prüfung (Mindestrestlaufzeit), Umkreis um das Lager, USt-ID-Format,
// Adressprüfung vor dem Briefversand, Kostenvorschau, Tageslimit/Budget, Lagerkostenrechner und die Textprüfung der
// AdelPrep-Beilage (eigene Firma, keine unbelegten Angaben). Keine Rechtsberatung.

export type Zielgruppe = "amazon_haendler" | "friseure" | "spielwaren" | "adelprep_lager" | "sonstige";

export type ZielgruppeDef = {
  name: string;
  /** Vorschlag für den Lead-Filter „Branche“ (Teilwort in der Kategorie). */
  branche: string | null;
  umkreisKm: number | null;
  /** Kosmetik u. ä.: jede Position braucht MHD + Charge, sonst wird sie nicht angeboten. */
  mhdPflicht: boolean;
  /** Absender des Briefs: eigene Firma oder die AdelPrep-Firma (eigener Brief, eigenes Impressum). */
  absender: "eigen" | "adelprep";
  hinweise: string[];
  textVorlage: string;
};

const HINWEIS_DSGVO = "Datenschutzhinweis nach Art. 14 DSGVO steht in jedem Brief (Quelle, Zweck, Speicherdauer, Widerspruch) – Leads nur aus öffentlichen Quellen per CSV, kein Scraping durch das Seller-System.";
const HINWEIS_VERTRIEB = "Vertriebsbeschränkungen prüfen: selektiver Vertrieb (z. B. Profi-Produkte nur an Fachbetriebe), Markenrechte, Verträge mit dem Lieferanten.";

export const ZIELGRUPPEN: Record<Zielgruppe, ZielgruppeDef> = {
  amazon_haendler: {
    name: "Amazon-Händler (Ladenhüter)",
    branche: null,
    umkreisKm: null,
    mhdPflicht: false,
    absender: "eigen",
    hinweise: [HINWEIS_VERTRIEB, "Nur Ware mit Wiederverkaufsrecht anbieten; Preise netto zzgl. USt., Mindestmengen nennen.", HINWEIS_DSGVO],
    textVorlage: "wir haben Restposten neuer, originalverpackter Markenware abzugeben – die Positionen finden Sie unten bzw. in der Preisliste. Alle Preise netto zzgl. USt., Staffelpreise ab den genannten Mengen.",
  },
  friseure: {
    name: "Friseure (Haarpflege)",
    branche: "friseur",
    umkreisKm: 50,
    mhdPflicht: true,
    absender: "eigen",
    hinweise: [
      "Kosmetik: MHD bzw. PAO und Chargennummer auf jeder Packung, Kennzeichnung auf Deutsch (EU-Kosmetikverordnung); Ware unter der Mindestrestlaufzeit wird nicht angeboten.",
      HINWEIS_VERTRIEB,
      "Gewerbenachweis (USt-ID) vor der ersten Lieferung.",
      HINWEIS_DSGVO,
    ],
    textVorlage: "für Ihren Salon können wir Haarpflege-Markenware aus Restbeständen anbieten – originalverpackt, mit ausreichender Restlaufzeit (MHD je Position angegeben). Alle Preise netto zzgl. USt.",
  },
  spielwaren: {
    name: "Spielwarenhändler (lokal)",
    branche: "spielwaren",
    umkreisKm: 50,
    mhdPflicht: false,
    absender: "eigen",
    hinweise: ["Spielzeug: CE-Kennzeichnung, Warn- und Altershinweise auf Deutsch, Hersteller-/Importeurangaben (GPSR).", HINWEIS_VERTRIEB, HINWEIS_DSGVO],
    textVorlage: "als Händler aus der Region haben wir Restposten neuer Markenspielwaren abzugeben – originalverpackt, mit CE-Kennzeichnung. Abholung oder Lieferung nach Absprache. Alle Preise netto zzgl. USt.",
  },
  adelprep_lager: {
    name: "Lager & Logistik (AdelPrep, eigener Brief)",
    branche: null,
    umkreisKm: 100,
    mhdPflicht: false,
    absender: "adelprep",
    hinweise: [
      "Eigener Brief der Logistik-Firma: eigener Absender, eigenes Impressum, eigener Datenschutzhinweis – nicht mit dem Restposten-Brief mischen.",
      "Vor dem Versand klären: Kapazität, Versicherung, Gefahrgut, Mindestmenge, AGB (Liste unten).",
      "Keine unbelegten Angaben (Fläche, Stellplätze, NDA, Gefahrgut) – erst nach Rückfrage. „Kostenlose Zählung“ gibt es nicht – nie verwenden.",
      HINWEIS_DSGVO,
    ],
    textVorlage: "Sie suchen Lagerfläche oder einen Dienstleister für Wareneingang, Lagerung und Versand? Wir lagern Ihre Ware auf Paletten ein und übernehmen auf Wunsch die Vorbereitung für Amazon FBA. Preise netto zzgl. USt. – gern erstellen wir Ihnen ein Angebot.",
  },
  sonstige: {
    name: "Sonstige",
    branche: null,
    umkreisKm: null,
    mhdPflicht: false,
    absender: "eigen",
    hinweise: [HINWEIS_VERTRIEB, HINWEIS_DSGVO],
    textVorlage: "wir haben Restposten neuer, originalverpackter Ware abzugeben. Alle Preise netto zzgl. USt.",
  },
};

export const OFFENE_PUNKTE_LAGER = ["Kapazität (freie Palettenplätze)", "Versicherung der eingelagerten Ware", "Gefahrgut (ja/nein, LQ)", "Mindestmenge / Mindestlaufzeit", "AGB / Lagervertrag"] as const;

// ---- MHD -----------------------------------------------------------------------------------------------------------

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function plusMonate(tag: string, n: number): string {
  const [y, m, d] = tag.split("-").map(Number);
  const z = new Date(Date.UTC(y, m - 1 + n, 1));
  const letzter = new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth(), Math.min(d, letzter))));
}

/** „2027-05“ → letzter Tag des Monats; „05/2027“ und „31.05.2027“ werden verstanden. */
export function mhdNorm(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t);
  if (m) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : iso(new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)));
  m = /^(\d{1,2})[./](\d{4})$/.exec(t);
  if (m) return iso(new Date(Date.UTC(Number(m[2]), Number(m[1]), 0)));
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Wird die Position angeboten? MHD muss mindestens `mindestMonate` nach heute liegen; bei Pflicht auch Charge. */
export function mhdPruefen(o: { mhd: string | null; charge: string | null }, heute: string, mindestMonate: number, pflicht: boolean): { ok: boolean; grund: string | null } {
  const mhd = mhdNorm(o.mhd);
  if (!mhd) return pflicht ? { ok: false, grund: "MHD fehlt – nicht angeboten" } : { ok: true, grund: null };
  if (pflicht && !o.charge?.trim()) return { ok: false, grund: "Charge fehlt – nicht angeboten" };
  const grenze = plusMonate(heute, Math.max(0, mindestMonate));
  if (mhd < grenze) return { ok: false, grund: `MHD ${mhd.split("-").reverse().join(".")} unter Mindestrestlaufzeit ${mindestMonate} Monate (bis ${grenze.split("-").reverse().join(".")}) – nicht angeboten` };
  return { ok: true, grund: null };
}

// ---- Umkreis -------------------------------------------------------------------------------------------------------

export type Punkt = { lat: number; lng: number };

/** Luftlinie in km (Haversine). */
export function entfernungKm(a: Punkt, b: Punkt): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

export type LeadFilter = { branche?: string | null; plz?: string | null; umkreisKm?: number | null; groesse?: string | null; status?: string[] | null; nurAdelprep?: boolean };
export type FilterLead = { kategorie: string | null; plz: string | null; lat: number | null; lng: number | null; groesse: string | null; status: string; adelprep: boolean };

export function leadImFilter(l: FilterLead, f: LeadFilter, lager: Punkt | null): { ok: boolean; km: number | null; grund: string | null } {
  if (l.status === "gesperrt") return { ok: false, km: null, grund: "gesperrt" };
  if (f.status?.length && !f.status.includes(l.status)) return { ok: false, km: null, grund: `Status ${l.status}` };
  if (f.nurAdelprep && !l.adelprep) return { ok: false, km: null, grund: "nicht Zielgruppe AdelPrep" };
  if (f.branche?.trim() && !(l.kategorie ?? "").toLowerCase().includes(f.branche.trim().toLowerCase())) return { ok: false, km: null, grund: "andere Branche" };
  if (f.plz?.trim() && !(l.plz ?? "").startsWith(f.plz.trim())) return { ok: false, km: null, grund: "andere PLZ" };
  if (f.groesse?.trim() && (l.groesse ?? "") !== f.groesse.trim()) return { ok: false, km: null, grund: "andere Größe" };
  const km = lager && l.lat !== null && l.lng !== null ? entfernungKm(lager, { lat: l.lat, lng: l.lng }) : null;
  if (f.umkreisKm && f.umkreisKm > 0) {
    if (!lager) return { ok: false, km, grund: "Lager-Standort fehlt (Einstellungen)" };
    if (km === null) return { ok: false, km, grund: "ohne Koordinaten" };
    if (km > f.umkreisKm) return { ok: false, km, grund: `${km} km entfernt` };
  }
  return { ok: true, km, grund: null };
}

// ---- USt-ID (Gewerbenachweis) ---------------------------------------------------------------------------------------

const UST_FORMAT: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/, CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/, DK: /^DK\d{8}$/, EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/, ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^FI\d{8}$/, FR: /^FR[A-Z0-9]{2}\d{9}$/, HR: /^HR\d{11}$/, HU: /^HU\d{8}$/, IE: /^IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/,
  IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/, LV: /^LV\d{11}$/, MT: /^MT\d{8}$/, NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/, SE: /^SE\d{12}$/, SI: /^SI\d{8}$/, SK: /^SK\d{10}$/, XI: /^XI(\d{9}|\d{12})$/,
};

export function ustIdFormat(roh: string | null | undefined): { ok: boolean; norm: string | null; land: string | null; grund: string | null } {
  const norm = (roh ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  if (!norm) return { ok: false, norm: null, land: null, grund: "USt-ID fehlt" };
  const land = norm.slice(0, 2);
  const re = UST_FORMAT[land];
  if (!re) return { ok: false, norm, land, grund: `Ländercode ${land} unbekannt` };
  return re.test(norm) ? { ok: true, norm, land, grund: null } : { ok: false, norm, land, grund: `Format für ${land} passt nicht` };
}

// ---- Adressprüfung vor dem Briefversand ------------------------------------------------------------------------------

const PLZ: Record<string, RegExp> = { DE: /^\d{5}$/, AT: /^\d{4}$/, CH: /^\d{4}$/, BE: /^\d{4}$/, DK: /^\d{4}$/, LU: /^(L-)?\d{4}$/i, NL: /^\d{4}\s?[A-Z]{2}$/i, FR: /^\d{5}$/, IT: /^\d{5}$/, ES: /^\d{5}$/, PL: /^\d{2}-\d{3}$/, CZ: /^\d{3}\s?\d{2}$/, SE: /^\d{3}\s?\d{2}$/ };

export type AdressLead = { firma: string; strasse: string | null; plz: string | null; ort: string | null; land: string; status: string; rechtsgrundlage: string | null };

/** Pflichtfelder, PLZ passend zum Land, Sperrliste, Rechtsgrundlage, Dublette (gleiche Anschrift schon im Versand). */
export function adressePruefen(l: AdressLead, ctx: { gesperrt: boolean; dublette: boolean }): { ok: boolean; fehler: string[] } {
  const fehler: string[] = [];
  if (!l.firma?.trim()) fehler.push("Firma fehlt");
  if (!l.strasse?.trim()) fehler.push("Straße fehlt");
  if (!l.plz?.trim()) fehler.push("PLZ fehlt");
  if (!l.ort?.trim()) fehler.push("Ort fehlt");
  const land = (l.land || "DE").toUpperCase();
  if (!/^[A-Z]{2}$/.test(land)) fehler.push("Land unklar");
  else if (l.plz?.trim() && PLZ[land] && !PLZ[land].test(l.plz.trim())) fehler.push(`PLZ ${l.plz} passt nicht zu ${land}`);
  if (ctx.gesperrt || l.status === "gesperrt") fehler.push("auf der Sperrliste");
  if (!l.rechtsgrundlage?.trim()) fehler.push("Rechtsgrundlage fehlt");
  if (ctx.dublette) fehler.push("gleiche Anschrift ist schon im Versand (Dublette)");
  return { ok: fehler.length === 0, fehler };
}

/** Vergleichbarer Schlüssel einer Anschrift (Dubletten im Versand). */
export const anschriftSchluessel = (l: { firma: string; strasse: string | null; plz: string | null }) => [l.firma, l.strasse ?? "", l.plz ?? ""].map((x) => x.toLowerCase().replace(/[^a-z0-9äöüß]/g, "")).join("|");

// ---- Kosten, Tageslimit, Budget ------------------------------------------------------------------------------------

export type BriefPreis = { grund: number | null; jeWeitereSeite: number | null };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Preis je Brief = Grundpreis (1. Blatt) + je weitere Seite. Ohne hinterlegten Preis: null (Versand gesperrt). */
export function briefKosten(seiten: number, p: BriefPreis): number | null {
  if (p.grund === null || !(p.grund >= 0)) return null;
  return r2(p.grund + Math.max(0, seiten - 1) * (p.jeWeitereSeite ?? 0));
}

export function kostenVorschau(seitenJeBrief: number[], p: BriefPreis): { jeBrief: (number | null)[]; summe: number | null } {
  const jeBrief = seitenJeBrief.map((s) => briefKosten(s, p));
  return { jeBrief, summe: jeBrief.some((x) => x === null) ? null : r2(jeBrief.reduce<number>((n, x) => n + (x ?? 0), 0)) };
}

export function limitPruefen(o: { heute: number; tageslimit: number; bisherKosten: number; budget: number | null; neu: number; neuKosten: number }): { ok: boolean; grund: string | null } {
  if (o.heute + o.neu > o.tageslimit) return { ok: false, grund: `Tageslimit ${o.tageslimit} Briefe (heute schon ${o.heute})` };
  if (o.budget !== null && o.bisherKosten + o.neuKosten > o.budget + 0.001) return { ok: false, grund: `Gesamtbudget ${o.budget.toFixed(2).replace(".", ",")} € würde überschritten (bisher ${o.bisherKosten.toFixed(2).replace(".", ",")} €)` };
  return { ok: true, grund: null };
}

// ---- Lagerkostenrechner (Europalette) --------------------------------------------------------------------------------

/** Europalette 1,20 × 0,80 m, 1,50 m hoch = 1,44 m³. */
export const EUROPALETTE_M3 = 1.44;

export function lagerkosten(o: { paletten: number; preisJePaletteMonat: number | null; preisJeM3Monat?: number | null }): { m3: number; jeM3Monat: number | null; jePaletteMonat: number | null; monat: number | null } {
  const m3 = r2(o.paletten * EUROPALETTE_M3);
  const jePalette = o.preisJePaletteMonat ?? (o.preisJeM3Monat != null ? r2(o.preisJeM3Monat * EUROPALETTE_M3) : null);
  const jeM3 = o.preisJeM3Monat ?? (jePalette !== null ? r2(jePalette / EUROPALETTE_M3) : null);
  return { m3, jeM3Monat: jeM3, jePaletteMonat: jePalette, monat: jePalette !== null ? r2(jePalette * o.paletten) : null };
}

// ---- AdelPrep-Beilage: Textprüfung -------------------------------------------------------------------------------------

/** `zaehlung` ist veraltet (11.11.: kostenlose Zählung gibt es nicht) und wird nicht mehr ausgewertet. */
export type BeilageBestaetigt = { flaeche: boolean; nda: boolean; gefahrgut: boolean; zaehlung?: boolean };

/** „Zählung/EAN-Prüfung kostenlos“ in allen Varianten (auch mit Wörtern dazwischen, z. B. „… bei direktem FBA-Versand kostenlos“). */
const KOSTENLOSE_ZAEHLUNG = /(kostenlos|kostenfrei|gratis|umsonst|ohne\s+aufpreis|inklusive|inkl\.)[^.!?\n]{0,60}z(ä|ae)hl|z(ä|ae)hl\w*[^.!?\n]{0,80}(kostenlos|kostenfrei|gratis|umsonst|ohne\s+aufpreis|inklusive|inkl\.)/i;

const UNBELEGT: { key: "flaeche" | "nda" | "gefahrgut"; re: RegExp; text: string }[] = [
  { key: "flaeche", re: /\b\d[\d.]*\s?(?:m²|qm\b|m2\b|quadratmeter)|\b\d[\d.]*\s?(?:paletten(?:stell)?pl(?:ä|ae)tze|paletten\b)/i, text: "Fläche/Palettenplätze" },
  { key: "nda", re: /\bNDA\b|geheimhaltungsvereinbarung|verschwiegenheitsvereinbarung/i, text: "NDA" },
  { key: "gefahrgut", re: /gefahrgut|\bLQ\b|limited\s+quantit/i, text: "Gefahrgut/LQ" },
];

/**
 * Prüft den Beilagen-Text: keine „all-in“-/„Komplettpreis“-Formulierung, Preise netto und je Artikel; unbelegte
 * Angaben (Fläche, NDA, Gefahrgut) nur, wenn sie nach Rückfrage bestätigt sind; „kostenlose Zählung“ nie (gibt es
 * nicht, Ludwig 11.11.). Fehler = die Beilage wird nicht beigelegt.
 */
export function beilageLint(text: string, bestaetigt: BeilageBestaetigt): { fehler: string[]; hinweise: string[] } {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  if (/all[\s-]?in(clusive)?\b/i.test(text)) fehler.push("„all-in“ vermeiden – stattdessen „ab … € netto je Artikel“");
  if (/komplettpreis|pauschalpreis|alles\s+inklusive/i.test(text)) fehler.push("„Komplettpreis“/„alles inklusive“ vermeiden – Leistungen und Preis je Artikel nennen");
  const preis = /\d+([.,]\d{1,2})?\s?(€|eur\b|euro\b)/i.test(text);
  if (preis && !/netto/i.test(text)) fehler.push("Preise als netto kennzeichnen (zzgl. USt.)");
  if (preis && !/je\s+artikel|pro\s+artikel|je\s+stück|pro\s+stück/i.test(text)) hinweise.push("Preis „je Artikel“ angeben");
  for (const u of UNBELEGT) if (u.re.test(text) && !bestaetigt[u.key]) fehler.push(`Angabe „${u.text}“ nicht belegt – erst nach Rückfrage verwenden (in den Einstellungen bestätigen)`);
  if (KOSTENLOSE_ZAEHLUNG.test(text)) fehler.push("„kostenlose Zählung“ gibt es nicht – Zählung und EAN-Prüfung werden berechnet; Aussage streichen");
  return { fehler, hinweise };
}

export type BeilageFirma = { firma: string; strasse: string; plz: string; ort: string; email: string; telefon: string; web: string; impressum: string; datenschutz: string };

/** Fehlt etwas für einen eigenen Brief (Absender, Impressum, Datenschutz, Text)? */
export function beilageVollstaendig(f: BeilageFirma, text: string): string[] {
  const fehlt: string[] = [];
  if (!f.firma.trim()) fehlt.push("Firmenname");
  if (!f.strasse.trim() || !f.plz.trim() || !f.ort.trim()) fehlt.push("Anschrift");
  if (!f.email.trim() && !f.telefon.trim()) fehlt.push("Kontakt (E-Mail oder Telefon)");
  if (!f.impressum.trim()) fehlt.push("Impressum");
  if (!text.trim()) fehlt.push("Textbaustein");
  return fehlt;
}

// ---- Nachfassen ------------------------------------------------------------------------------------------------------

export const nachfassFaellig = (versendetAm: Date | null, beantwortet: boolean, heute: Date, tage: number | null) => !!tage && tage > 0 && !!versendetAm && !beantwortet && heute.getTime() - versendetAm.getTime() >= tage * 86_400_000;
