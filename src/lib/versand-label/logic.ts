// DHL-Label aus Chat/Screenshot (Bauauftrag Push-Handy/DHL-Label, Teil B) – reine Logik (tests/versand-label.test.ts):
// Adresse aus eingefügtem Text lesen, Produkte und Services, Gewichtsklassen, Gefahrgut-Regeln (nur LQ/EQ bei DHL Paket),
// Kosten laut hinterlegter Preisliste, Tracking-Link und Textbaustein für WhatsApp/Kleinanzeigen.

export type Empfaenger = {
  name: string;
  name2?: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  /** ISO-2 (DE, AT …). */
  land: string;
  telefon?: string;
  email?: string;
  /** Packstation/Postfiliale: Nummer der Station und Postnummer des Empfängers. */
  packstation?: string;
  postnummer?: string;
};

export type Erkannt = { adresse: Empfaenger; unsicher: (keyof Empfaenger)[]; quelle: "ki" | "regeln" };

const LAENDER: Record<string, string> = {
  deutschland: "DE", germany: "DE", de: "DE", d: "DE",
  österreich: "AT", oesterreich: "AT", austria: "AT", at: "AT", a: "AT",
  schweiz: "CH", switzerland: "CH", ch: "CH",
  niederlande: "NL", netherlands: "NL", nl: "NL", belgien: "BE", belgium: "BE", be: "BE",
  frankreich: "FR", france: "FR", fr: "FR", italien: "IT", italy: "IT", it: "IT", spanien: "ES", spain: "ES", es: "ES",
  polen: "PL", poland: "PL", pl: "PL", luxemburg: "LU", lu: "LU", dänemark: "DK", daenemark: "DK", dk: "DK",
};

const PLZ_LAENGE: Record<string, number> = { DE: 5, AT: 4, CH: 4, BE: 4, LU: 4, DK: 4, NL: 6, FR: 5, IT: 5, ES: 5, PL: 6 };

const GRUSS = /^(hallo|hi|hey|moin|servus|guten (tag|morgen|abend)|lieben? gr|liebe gr|vg|lg|mfg|danke|vielen dank|gerne|super|ok(ay)?|ja|nein|bitte|anbei|hier( ist)? (die|meine) adresse|meine adresse|adresse|lieferadresse|versandadresse|an:?)\b/i;
const LABEL = /^\s*(name|empfänger|empfaenger|an|straße|strasse|str\.?|adresse|anschrift|plz(\s*\/?\s*ort)?|ort|stadt|land|tel(efon)?|handy|mobil|e-?mail|mail|packstation|postnummer|postnr\.?)\s*[:\-]\s*/i;
const ZEITSTEMPEL = /^\s*\[?\d{1,2}[./]\d{1,2}\.?(?:\d{2,4})?,?\s*\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?(?:[^:\d\s][^:]{0,29}:\s+)?/;
const TELEFON = /(?:\+|00)\d{2}[\d\s/()-]{6,}\d|\b0\d{2,5}[\s/-]?\d[\d\s/-]{4,}\d\b/;
const MAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const STR_HNR = /^(.+?\D)\s*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)\s*$/;

/** Text einer Chat-Nachricht ohne Zeitstempel/Absender-Präfix („[12.03., 14:22] Max: …“). */
function zeilenAus(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n|(?<=\S)\s*[|;]\s*(?=\S)/)
    .map((z) => z.replace(ZEITSTEMPEL, "").trim())
    .map((z) => z.replace(/[,;]+$/, "").trim())
    .filter(Boolean);
}

const gross = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Adresse aus eingefügtem Text (WhatsApp, Kleinanzeigen, E-Mail): Name, Straße + Hausnummer, PLZ + Ort, Land, Telefon,
 * Mail, Packstation/Postnummer. Was nicht sicher erkannt ist, steht in `unsicher` (Feld gelb markieren).
 */
export function adresseAusText(text: string): Erkannt {
  const a: Empfaenger = { name: "", strasse: "", hausnummer: "", plz: "", ort: "", land: "DE" };
  const unsicher = new Set<keyof Empfaenger>();
  const rest: string[] = [];
  let zeilen = zeilenAus(text);
  // Eine Zeile mit Kommas („Max Muster, Teststr. 1, 12345 Musterstadt“) aufteilen.
  if (zeilen.length <= 2) zeilen = zeilen.flatMap((z) => (z.split(",").length >= 3 ? z.split(",").map((x) => x.trim()) : [z]));
  for (const roh of zeilen) {
    let z = roh;
    const mail = MAIL.exec(z);
    if (mail) {
      a.email ??= mail[0];
      z = z.replace(mail[0], "").trim();
    }
    const label = LABEL.exec(z)?.[1]?.toLowerCase() ?? null;
    if (label) z = z.replace(LABEL, "").trim();
    const tel = TELEFON.exec(z);
    if (tel && (label?.startsWith("tel") || label === "handy" || label === "mobil" || !/\d{5}\s+\p{L}/u.test(z))) {
      a.telefon ??= tel[0].replace(/[^\d+]/g, "").replace(/^00/, "+");
      z = z.replace(tel[0], "").replace(/^(tel(efon)?|handy|mobil)\.?:?\s*/i, "").trim();
    }
    if (!z) continue;
    const ps = /\b(packstation|postfiliale|paketshop)\s*(?:nr\.?\s*)?(\d{3})\b/i.exec(z);
    if (ps) {
      a.packstation = `${/postfiliale/i.test(ps[1]) ? "Postfiliale" : "Packstation"} ${ps[2]}`;
      z = z.replace(ps[0], "").trim();
    }
    const pn = /\b(?:postnummer|postnr\.?|kundennummer)\s*:?\s*(\d{6,10})\b/i.exec(roh) ?? (label?.startsWith("post") ? /(\d{6,10})/.exec(z) : null);
    if (pn) {
      a.postnummer = pn[1];
      z = z.replace(pn[0], "").replace(pn[1], "").trim();
      if (!z) continue;
    }
    if (label === "land" || (LAENDER[z.toLowerCase()] && z.length > 2)) {
      a.land = LAENDER[z.toLowerCase()] ?? a.land;
      continue;
    }
    const plzOrt = /^(?:(D|A|CH|DE|AT)\s*-\s*)?(\d{4,6})\s+(\p{L}[\p{L} .'()-]*?)(?:(?:\s*,\s*|\s+)(\p{L}+))?$/u.exec(z);
    if (plzOrt && !a.plz && (label === null || label.startsWith("plz") || label === "ort" || label === "stadt")) {
      a.plz = plzOrt[2];
      const landWort = plzOrt[4] && LAENDER[plzOrt[4].toLowerCase()];
      a.ort = gross(landWort ? plzOrt[3] : [plzOrt[3], plzOrt[4]].filter(Boolean).join(" "));
      if (landWort) a.land = landWort;
      else if (plzOrt[1]) a.land = LAENDER[plzOrt[1].toLowerCase()] ?? a.land;
      continue;
    }
    if (label === "name" || label === "empfänger" || label === "empfaenger" || label === "an") {
      a.name = gross(z);
      continue;
    }
    const sh = STR_HNR.exec(z);
    if (sh && !a.strasse && (label === null || /^(straße|strasse|str|adresse|anschrift)/.test(label)) && /\p{L}{3,}/u.test(sh[1])) {
      a.strasse = gross(sh[1]).replace(/\bstr\.?$/i, "straße").replace(/str\.$/i, "straße");
      a.hausnummer = sh[2].replace(/\s+/g, "");
      continue;
    }
    if (label && /^(straße|strasse|str|adresse|anschrift)/.test(label)) {
      a.strasse = gross(z);
      unsicher.add("hausnummer");
      continue;
    }
    rest.push(z);
  }
  // Name: erste übrige Zeile, die nach einem Namen aussieht (2–4 Wörter, keine Grußformel, keine Ziffern).
  if (!a.name) {
    const kandidat = rest.find((z) => !GRUSS.test(z) && !/\d/.test(z) && /^\p{L}[\p{L}.'-]*(\s+\p{L}[\p{L}.'-]*){1,3}$/u.test(z));
    if (kandidat) a.name = gross(kandidat);
    else unsicher.add("name");
  }
  const rest2 = rest.filter((z) => z !== a.name && !GRUSS.test(z));
  // c/o, Firma, Zusatz → name2 (unsicher, bitte prüfen)
  const zusatz = rest2.find((z) => /^(c\/o|bei|firma|z\.\s?hd\.?|zhd)/i.test(z));
  if (zusatz) a.name2 = gross(zusatz);
  if (a.packstation) {
    a.strasse = a.packstation;
    a.hausnummer = a.packstation.replace(/\D/g, "");
    if (!a.postnummer) unsicher.add("postnummer");
  }
  for (const f of pflichtFehlend(a)) unsicher.add(f);
  if (a.plz && PLZ_LAENGE[a.land] && a.plz.length !== PLZ_LAENGE[a.land]) unsicher.add("plz");
  return { adresse: a, unsicher: [...unsicher], quelle: "regeln" };
}

/** Pflichtfelder, die fehlen. */
export function pflichtFehlend(a: Empfaenger): (keyof Empfaenger)[] {
  const f: (keyof Empfaenger)[] = [];
  if (!a.name.trim()) f.push("name");
  if (!a.strasse.trim()) f.push("strasse");
  if (!a.hausnummer.trim()) f.push("hausnummer");
  if (!a.plz.trim()) f.push("plz");
  if (!a.ort.trim()) f.push("ort");
  if (/packstation|postfiliale/i.test(a.strasse) && !a.postnummer) f.push("postnummer");
  return f;
}

/** KI-Antwort (JSON) → Adresse; fehlende/unsichere Felder bleiben markiert. */
export function adresseAusKi(json: unknown): Erkannt | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const s = (k: string) => (typeof j[k] === "string" ? (j[k] as string).trim().slice(0, 120) : "");
  const land = s("land").toUpperCase();
  const a: Empfaenger = {
    name: s("name"),
    name2: s("name2") || undefined,
    strasse: s("strasse"),
    hausnummer: s("hausnummer"),
    plz: s("plz").replace(/\s/g, ""),
    ort: s("ort"),
    land: /^[A-Z]{2}$/.test(land) ? land : (LAENDER[land.toLowerCase()] ?? "DE"),
    telefon: s("telefon").replace(/[^\d+]/g, "") || undefined,
    email: MAIL.exec(s("email"))?.[0],
    packstation: s("packstation") || undefined,
    postnummer: s("postnummer").replace(/\D/g, "") || undefined,
  };
  if (a.packstation && !/\D/.test(a.packstation)) a.packstation = `Packstation ${a.packstation}`;
  if (a.packstation && !a.strasse) {
    a.strasse = a.packstation;
    a.hausnummer = a.packstation.replace(/\D/g, "");
  }
  const felder = new Set<keyof Empfaenger>(Array.isArray(j.unsicher) ? (j.unsicher as string[]).filter((x): x is keyof Empfaenger => x in a || ["name", "strasse", "hausnummer", "plz", "ort", "land", "telefon", "email", "packstation", "postnummer"].includes(x)) : []);
  for (const f of pflichtFehlend(a)) felder.add(f);
  if (a.plz && PLZ_LAENGE[a.land] && a.plz.length !== PLZ_LAENGE[a.land]) felder.add("plz");
  if (!a.name && !a.strasse && !a.plz) return null;
  return { adresse: a, unsicher: [...felder], quelle: "ki" };
}

/** Auftrag an die KI (Bild oder Text). Antwort nur JSON. */
export const KI_AUFTRAG = (text: string) =>
  [
    "Lies die Versandadresse aus dieser Nachricht bzw. diesem Bild (WhatsApp, Kleinanzeigen, Zettel).",
    'Antworte nur mit JSON: {"name","name2","strasse","hausnummer","plz","ort","land" (ISO-2),"telefon","email","packstation","postnummer","unsicher":[Feldnamen, die du nicht sicher lesen konntest]}.',
    "Leere Felder als \"\". Keine Grüße, keine Absender-Namen aus dem Chat-Kopf als Empfänger, außer es ist eindeutig die Adresse.",
    text ? `Nachricht:\n${text.slice(0, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

// ---- Produkte, Services, Kosten ----------------------------------------------------------------------------------

export const VERSAND_PRODUKTE = [
  { key: "paket_2", titel: "DHL Paket bis 2 kg", bisKg: 2, dhl: "V01PAK" },
  { key: "paket_5", titel: "DHL Paket bis 5 kg", bisKg: 5, dhl: "V01PAK" },
  { key: "paket_10", titel: "DHL Paket bis 10 kg", bisKg: 10, dhl: "V01PAK" },
  { key: "paket_20", titel: "DHL Paket bis 20 kg", bisKg: 20, dhl: "V01PAK" },
  { key: "paket_31_5", titel: "DHL Paket bis 31,5 kg", bisKg: 31.5, dhl: "V01PAK" },
  { key: "paeckchen", titel: "Päckchen (DHL Kleinpaket)", bisKg: 1, dhl: "kleinpaket" },
  { key: "warensendung", titel: "Warensendung (Internetmarke)", bisKg: 1, dhl: null },
  { key: "retoure", titel: "Retourenlabel (DHL Paket an uns)", bisKg: 31.5, dhl: "V01PAK" },
] as const;
export type ProduktKey = (typeof VERSAND_PRODUKTE)[number]["key"];
export const istProdukt = (v: unknown): v is ProduktKey => VERSAND_PRODUKTE.some((p) => p.key === v);

/** Passendes DHL Paket zur Gewichtsklasse (über 31,5 kg: nur per Spedition). */
export function paketFuerGewicht(kg: number): ProduktKey | null {
  if (!(kg > 0)) return "paket_2";
  return (VERSAND_PRODUKTE.find((p) => p.key.startsWith("paket_") && kg <= p.bisKg)?.key as ProduktKey | undefined) ?? null;
}

export type Services = { versicherung?: number | null; alterssicht?: "A16" | "A18" | null };
export const VERSICHERUNG_MAX = 2500;

/** Kosten laut hinterlegter Preisliste (€ netto) – null = Preis nicht hinterlegt. */
export function kosten(produkt: ProduktKey, s: Services, preise: Record<string, number>): number | null {
  const basis = produkt === "retoure" ? (preise.retoure ?? preise.paket_2) : preise[produkt];
  if (basis === undefined || basis === null) return null;
  let k = basis;
  if (s.versicherung && s.versicherung > 500) k += preise.versicherung ?? 0;
  if (s.alterssicht) k += preise.alterssicht ?? 0;
  return Math.round(k * 100) / 100;
}

// ---- Gefahrgut ---------------------------------------------------------------------------------------------------

export type Gefahrgut = { lq?: boolean; un?: string; klasse?: string; mengeJePackstueck?: string; lithium?: "UN3481" | "UN3091" | null; vollgefahrgut?: boolean };
export type GefahrgutErgebnis = { erlaubt: boolean; fehler: string[]; hinweise: string[]; kennzeichen: ("lq" | "lithium")[] };

export const SPEDITION = "Nicht mit DHL Paket – bitte per Spedition (Gefahrgut-Spediteur) versenden.";
/** Klassen, die DHL Paket nicht befördert: 1 (explosiv), 6.2 (ansteckungsgefährlich), 7 (radioaktiv). */
const GESPERRT = /^(1(\.\d)?[A-Z]?|6\.2|7)$/;

/**
 * Gefahrgut für DHL Paket: nur begrenzte Mengen (LQ) bzw. freigestellte Mengen (EQ) und Lithium-Batterien in
 * Ausrüstung. Klasse 1, 6.2, 7 und Vollgefahrgut sind gesperrt („per Spedition“). LQ braucht UN-Nummer, Klasse und
 * Menge je Packstück; das LQ-Kennzeichen (Raute) muss auf den Karton.
 */
export function gefahrgutPruefen(g: Gefahrgut, gewichtKg: number): GefahrgutErgebnis {
  const fehler: string[] = [];
  const hinweise: string[] = [];
  const kennzeichen: ("lq" | "lithium")[] = [];
  const klasse = (g.klasse ?? "").trim().replace(",", ".").replace(/^klasse\s*/i, "").toUpperCase();
  if (g.vollgefahrgut) fehler.push(`Vollgefahrgut: ${SPEDITION}`);
  if (klasse && GESPERRT.test(klasse)) fehler.push(`Klasse ${klasse}: ${SPEDITION}`);
  if (g.lq) {
    const un = (g.un ?? "").toUpperCase().replace(/\s/g, "");
    if (!/^(UN)?\d{4}$/.test(un)) fehler.push("UN-Nummer fehlt (4 Ziffern, z. B. UN1950).");
    if (!klasse) fehler.push("Klasse fehlt (z. B. 2.1, 3, 8, 9).");
    if (!(g.mengeJePackstueck ?? "").trim()) fehler.push("Menge je Packstück fehlt (z. B. 6 × 0,5 L).");
    // ADR 3.4.2: Versandstück mit begrenzten Mengen höchstens 30 kg brutto.
    if (gewichtKg > 30) fehler.push("LQ-Versandstück höchstens 30 kg brutto.");
    kennzeichen.push("lq");
    hinweise.push("DHL Paket: nur begrenzte Mengen (LQ) bzw. freigestellte Mengen (EQ). Das LQ-Kennzeichen (Raute, mind. 100 × 100 mm) muss gut sichtbar auf den Karton.");
  }
  if (g.lithium) {
    kennzeichen.push("lithium");
    hinweise.push(`${g.lithium} (Lithium-${g.lithium === "UN3091" ? "Metall" : "Ionen"}-Batterien in Ausrüstung): Batterie-Kennzeichen mit UN-Nummer und Telefonnummer auf den Karton.`);
  }
  return { erlaubt: fehler.length === 0, fehler, hinweise, kennzeichen };
}

// ---- Tracking und Textbaustein -----------------------------------------------------------------------------------

export const trackingLink = (nr: string) => `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(nr)}`;

/** Textbaustein für WhatsApp/Kleinanzeigen („Dein Paket ist unterwegs: …“). */
export function versandText(o: { name: string; nr: string; kanal: string }): string {
  const vorname = o.name.trim().split(/\s+/)[0] ?? "";
  const anrede = o.kanal === "b2b" ? "Hallo," : `Hallo${vorname ? ` ${vorname}` : ""},`;
  return `${anrede}\ndein Paket ist unterwegs: ${trackingLink(o.nr)}\n(Sendungsnummer ${o.nr})\nViele Grüße`;
}

export const KANAELE = [
  { key: "kleinanzeigen", titel: "Kleinanzeigen" },
  { key: "whatsapp", titel: "WhatsApp" },
  { key: "b2b", titel: "B2B" },
] as const;
export type Kanal = (typeof KANAELE)[number]["key"];
export const istKanal = (v: unknown): v is Kanal => KANAELE.some((k) => k.key === v);

export const ZAHLUNGSARTEN = ["PayPal", "Überweisung", "Bar", "Kleinanzeigen „Sicher bezahlen“", "Rechnung"] as const;

/** Preise je Produkt (Schlüssel wie VERSAND_PRODUKTE.key, dazu „versicherung“, „alterssicht“) in € netto – leer = nicht hinterlegt. */
export const VERSAND_PREISE_STANDARD: Record<string, number> = {};
