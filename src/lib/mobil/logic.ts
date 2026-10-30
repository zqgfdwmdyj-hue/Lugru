// Handy & Tesla (B13): reine Logik – Anrufe erkennen und in die Fahrzeit legen, vorlesbare Ansagen, Ziel erkennen,
// SMS-Antwort-Codes, Fahrtenbuch-Vorschlag, Verspätung, Scan-Ansage. Alles vorlesetauglich: kurze Sätze, keine
// Tabellen, Zahlen gerundet. Nichts hier sendet, kauft oder ändert etwas.

// ---- Anrufe ------------------------------------------------------------------------------------------------

const ANRUF = /\b(anrufen|zurückrufen|zurueckrufen|telefonieren|anruf|telefonat|call)\b/i;
export const istAnruf = (titel: string) => ANRUF.test(titel);

/** Telefonnummer aus einem Text („+49 170 1234567“, „0170/1234567“, „030 123456-0“) – normalisiert, sonst null. */
export function telefonAus(text: string): string | null {
  const m = /(?:\+|00)\d[\d\s/().-]{6,18}\d|\b0\d{2,5}[\s/.-]?\d[\d\s/.-]{3,12}\d\b/.exec(text);
  if (!m) return null;
  const roh = m[0].replace(/[^\d+]/g, "").replace(/^00/, "+");
  return roh.replace(/\D/g, "").length >= 7 ? roh : null;
}

/** Wen anrufen? „DHL Geschäftskunden anrufen“ → „DHL Geschäftskunden“, „Konrad zurückrufen wegen …“ → „Konrad“. */
export function anrufName(titel: string): string {
  const t = titel.replace(/^(bitte\s+)?(anrufen|zurückrufen|telefonieren)\s*[:-]?\s*/i, "").replace(/\s*\b(wegen|zu|zum|zur|bzgl\.?|betreffend)\b.*$/i, "");
  return (t.replace(/\b(anrufen|zurückrufen|zurueckrufen|telefonieren|anruf|call)\b/gi, "").replace(/\s+/g, " ").trim() || titel).slice(0, 60);
}

export type AnrufAufgabe = { id: string; titel: string; prioritaet: "critical" | "normal" | "low"; faellig: string | null; telefon: string | null };

const RANG = { critical: 0, normal: 1, low: 2 } as const;

/** Anrufe für eine Fahrt: wichtige und fällige zuerst, je Anruf ~5 Minuten, höchstens so viele wie Zeit da ist. */
export function anrufeFuerFahrt(anrufe: AnrufAufgabe[], minuten: number, heute: string, jeAnruf = 5): AnrufAufgabe[] {
  const n = Math.max(0, Math.floor(minuten / jeAnruf));
  return [...anrufe].sort((a, b) => RANG[a.prioritaet] - RANG[b.prioritaet] || Number((b.faellig ?? "9") <= heute) - Number((a.faellig ?? "9") <= heute) || (a.faellig ?? "9999").localeCompare(b.faellig ?? "9999")).slice(0, n);
}

const liste = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} und ${xs[xs.length - 1]}`);

/** „20 Minuten Fahrt. 2 Anrufe: Konrad und DHL Geschäftskunden.“ */
export function fahrtAnsage(minuten: number | null, anrufe: { titel: string }[]): string {
  const fahrt = minuten ? `${Math.round(minuten / 5) * 5 || minuten} Minuten Fahrt.` : "Gute Fahrt.";
  if (!anrufe.length) return `${fahrt} Keine Anrufe offen.`;
  return `${fahrt} ${anrufe.length === 1 ? "1 Anruf" : `${anrufe.length} Anrufe`}: ${liste(anrufe.map((a) => anrufName(a.titel)))}.`;
}

/** „Anruf erledigt: Konrad, Notiz: nimmt 60 Stück“ → Name und Notiz. */
export function anrufErledigtLesen(text: string): { name: string; notiz: string | null } | null {
  const m = /^\s*(?:anruf\s+)?erledigt\s*[:,-]?\s*([^,]+?)\s*(?:,\s*(?:notiz\s*[:,-]?\s*)?(.+))?\s*$/i.exec(text);
  if (!m || !m[1].trim()) return null;
  return { name: m[1].trim().slice(0, 60), notiz: m[2]?.trim().slice(0, 500) || null };
}

/** Passende Anruf-Aufgabe zu einem gesprochenen Namen (Teilwort, Groß/klein egal). */
export function anrufFinden<T extends { titel: string }>(anrufe: T[], name: string): T | null {
  const n = name.toLowerCase().trim();
  if (!n) return null;
  return anrufe.find((a) => anrufName(a.titel).toLowerCase() === n) ?? anrufe.find((a) => a.titel.toLowerCase().includes(n)) ?? null;
}

// ---- Ziel erkennen und Briefing -------------------------------------------------------------------------------

export type ZielArt = "lager" | "prep" | "palettenlager" | "lieferant" | "post" | "zuhause" | "sonst";
export type Orte = { lager: string[]; prep: string[]; palettenlager: string[]; zuhause: string | null; lieferanten: { id: string; name: string; adresse: string | null }[] };

const norm = (s: string) => s.toLowerCase().replace(/str\./g, "straße").replace(/strasse/g, "straße").replace(/[^a-z0-9äöüß]+/g, " ").trim();
/** Gleicher Ort? Teiltext oder alle Wörter des kürzeren (mind. 2, z. B. Straße + Nummer) kommen im längeren vor. */
const enthaelt = (ziel: string, ort: string) => {
  const a = norm(ziel);
  const b = norm(ort);
  if (b.length < 4 || !a) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = a.split(" ");
  const wb = b.split(" ");
  const [kurz, lang] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  return kurz.length >= 2 && kurz.every((w) => lang.has(w));
};

/** Ziel (Kalender-Ort, Navi-Ziel oder Termin-Titel) einordnen. */
export function zielArt(ziel: string | null, o: Orte): { art: ZielArt; lieferantId: string | null } {
  if (!ziel?.trim()) return { art: "sonst", lieferantId: null };
  if (o.zuhause && enthaelt(ziel, o.zuhause)) return { art: "zuhause", lieferantId: null };
  if (/\bzuhause\b|\bnach hause\b|\bheim\b/i.test(ziel)) return { art: "zuhause", lieferantId: null };
  if (o.prep.some((p) => enthaelt(ziel, p)) || /prep\s*center/i.test(ziel)) return { art: "prep", lieferantId: null };
  if (o.palettenlager.some((p) => enthaelt(ziel, p)) || /palettenlager/i.test(ziel)) return { art: "palettenlager", lieferantId: null };
  if (o.lager.some((p) => enthaelt(ziel, p)) || /\blager\b/i.test(ziel)) return { art: "lager", lieferantId: null };
  // Name nur als ganze Wörter („Test“ passt nicht zu „Testlieferant“).
  const l = o.lieferanten.find((x) => (x.adresse && enthaelt(ziel, x.adresse)) || (x.name.length >= 3 && ` ${norm(ziel)} `.includes(` ${norm(x.name)} `)));
  if (l) return { art: "lieferant", lieferantId: l.id };
  if (/\b(post|dhl|packstation|paketshop|filiale)\b/i.test(ziel)) return { art: "post", lieferantId: null };
  return { art: "sonst", lieferantId: null };
}

/** Zahl zum Vorlesen: 4,2 → „4 Euro 20“, 1234 → „1.234 Euro“. */
export function euroSprechen(n: number): string {
  const r = Math.round(n * 100) / 100;
  const e = Math.trunc(r);
  const c = Math.round(Math.abs(r - e) * 100);
  return `${r < 0 && e === 0 ? "minus " : ""}${e.toLocaleString("de-DE")} Euro${c && Math.abs(r) < 100 ? ` ${c}` : ""}`;
}

export type BriefingDaten = {
  art: ZielArt;
  name?: string | null;
  remissionen?: number;
  retouren?: number;
  fbmOffen?: number;
  palettenHeute?: number;
  mitnehmen?: string[];
  bestellvorschlaege?: { stueck: number; summe: number } | null;
  preislisteVom?: string | null;
  offeneRechnungen?: number;
  labelsHeute?: number;
  feierabend?: { erledigt: number; offen: number; morgen: string[] } | null;
  morgen?: { wichtig: string[]; umsatzGestern: number | null; gewinnGestern: number | null } | null;
};

const satz = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

/** Vorlesbares Briefing (≤ 60 Sekunden ≈ 130 Wörter) passend zum Ziel. */
export function briefingText(d: BriefingDaten): string {
  const s: string[] = [];
  switch (d.art) {
    case "lager":
    case "prep":
    case "palettenlager":
      s.push(d.art === "prep" ? "Prep Center." : d.art === "palettenlager" ? "Palettenlager." : "Lager.");
      if (d.remissionen || d.retouren) s.push(`Zur Prüfung: ${[d.remissionen ? satz(d.remissionen, "Remission", "Remissionen") : "", d.retouren ? satz(d.retouren, "Retoure", "Retouren") : ""].filter(Boolean).join(" und ")}.`);
      if (d.fbmOffen) s.push(`${satz(d.fbmOffen, "offener FBM-Auftrag", "offene FBM-Aufträge")}.`);
      if (d.palettenHeute) s.push(`${satz(d.palettenHeute, "Paletten-Anlieferung", "Paletten-Anlieferungen")} heute.`);
      if (d.mitnehmen?.length) s.push(`Mitnehmen: ${liste(d.mitnehmen.slice(0, 4))}.`);
      break;
    case "lieferant":
      s.push(`${d.name ?? "Lieferant"}.`);
      if (d.bestellvorschlaege?.stueck) s.push(`Offene Bestellvorschläge: ${d.bestellvorschlaege.stueck} Stück für ${euroSprechen(d.bestellvorschlaege.summe)}.`);
      else s.push("Keine offenen Bestellvorschläge.");
      if (d.preislisteVom) s.push(`Letzte Preisliste vom ${dm(d.preislisteVom)}.`);
      if (d.offeneRechnungen) s.push(`${satz(d.offeneRechnungen, "offene Rechnung", "offene Rechnungen")}.`);
      break;
    case "post":
      s.push(d.labelsHeute ? `Post: ${satz(d.labelsHeute, "Paket", "Pakete")} für heute.` : "Post: heute keine Pakete offen.");
      break;
    case "zuhause":
      if (d.feierabend) {
        s.push(`Feierabend. Heute erledigt: ${d.feierabend.erledigt}. Offen: ${d.feierabend.offen}.`);
        if (d.feierabend.morgen.length) s.push(`Morgen: ${liste(d.feierabend.morgen.slice(0, 3))}.`);
      } else s.push("Feierabend.");
      break;
    default:
      if (d.morgen) {
        if (d.morgen.umsatzGestern !== null) s.push(`Gestern ${euroSprechen(d.morgen.umsatzGestern)} Umsatz${d.morgen.gewinnGestern !== null ? `, ${euroSprechen(d.morgen.gewinnGestern)} Gewinn` : ""}.`);
        if (d.morgen.wichtig.length) s.push(`Heute wichtig: ${liste(d.morgen.wichtig.slice(0, 3))}.`);
      }
  }
  if (s.length <= 1 && d.art !== "zuhause" && d.art !== "post") s.push("Sonst nichts Besonderes.");
  return s.join(" ").slice(0, 900);
}

// ---- SMS mit Antwort-Codes -----------------------------------------------------------------------------------

export type SmsCode = { code: "VA" | "SPAETER" | "OK" | "KAUFEN" | "GEKAUFT" | "unklar"; menge: number | null; ref: string | null; preis?: number | null };

/** Antwort lesen: „VA“, „später“, „ok“, „kaufen 20“ – optional mit Kurz-Code „[F12]“ bzw. „F12“. */
export function smsAntwort(text: string): SmsCode {
  const ref = /\[?\b([A-Z]\d{1,4})\b\]?/.exec(text.toUpperCase())?.[1] ?? null;
  const t = text.trim().toLowerCase().replace(/\[?\b[a-z]\d{1,4}\b\]?/, "").trim();
  if (/^va\b/.test(t)) return { code: "VA", menge: null, ref };
  if (/^(später|spaeter|morgen)\b/.test(t)) return { code: "SPAETER", menge: null, ref };
  if (/^(ok|okay|gelesen|danke)\b/.test(t)) return { code: "OK", menge: null, ref };
  // „gekauft 60 zu 19,50“: Ludwig meldet einen selbst getätigten Kauf (Abschnitt 10) – bestellt wird nie automatisch.
  const g = /^gekauft\s*(\d{1,5})?(?:\s*(?:stk|stück)?\.?)?(?:\s*(?:zu|à|a|je|für)?\s*(\d{1,5}(?:[.,]\d{1,2})?))?/.exec(t);
  if (g) return { code: "GEKAUFT", menge: g[1] ? Number(g[1]) : null, ref, preis: g[2] ? Number(g[2].replace(",", ".")) : null };
  const k = /^kaufen\s*(\d{1,5})?/.exec(t);
  if (k) return { code: "KAUFEN", menge: k[1] ? Number(k[1]) : null, ref };
  return { code: "unklar", menge: null, ref };
}

/** SMS-Text: kurz, vorlesbar, ohne Kunden- oder Privatdaten, mit Antwort-Codes und Kurz-Code am Ende. */
export function smsText(kern: string, ref: string, codes: string[] = ["VA", "SPÄTER"]): string {
  const k = kern.replace(/\s+/g, " ").trim().replace(/[.!]?$/, ".");
  return `${k.slice(0, 200)} Antwort: ${codes.join(" / ")}. [${ref}]`;
}

/**
 * Darf jetzt eine SMS raus? Nicht in Ruhezeiten oder Privat-Sperrzeiten (außer rot markierte Konto-Themen) und
 * höchstens `limit` am Tag.
 */
export function smsErlaubt(o: { uhrzeit: string; ruheVon: string; ruheBis: string; inSperrzeit: boolean; rot: boolean; heuteGesendet: number; limit: number }): { ok: boolean; grund: string | null } {
  if (o.heuteGesendet >= o.limit) return { ok: false, grund: "Tageslimit erreicht" };
  const inRuhe = o.ruheVon > o.ruheBis ? o.uhrzeit >= o.ruheVon || o.uhrzeit < o.ruheBis : o.uhrzeit >= o.ruheVon && o.uhrzeit < o.ruheBis;
  if (o.rot) return { ok: true, grund: null };
  if (inRuhe) return { ok: false, grund: "Ruhezeit" };
  if (o.inSperrzeit) return { ok: false, grund: "Familienzeit" };
  return { ok: true, grund: null };
}

// ---- Verspätung und Fahrtenbuch -------------------------------------------------------------------------------

/** Verspätung in Minuten (gerundet auf 5), wenn die Ankunft später als Termin + Toleranz ist – sonst null. */
export function verspaetung(ankunft: Date, termin: Date, toleranzMin = 10): number | null {
  const min = Math.round((ankunft.getTime() - termin.getTime()) / 60_000);
  return min > toleranzMin ? Math.max(5, Math.round(min / 5) * 5) : null;
}

export const verspaetungsText = (min: number) => `Guten Tag, ich verspäte mich leider um ca. ${min} Minuten. Viele Grüße`;

export type Fahrt = { start: string; ziel: string | null; beginn: string; km: number };

/** Fahrtenbuch-Vorschlag: Fahrten zu Lager, Prep Center, Palettenlager, Lieferant, Post → geschäftlich; Rest privat ohne Ziel-Details. */
export function fahrtVorschlag(f: Fahrt, o: Orte, termin: { titel: string } | null): { art: "geschaeftlich" | "privat"; zweck: string | null; zielAnzeige: string } {
  const z = zielArt(f.ziel, o);
  const geschaeft = z.art !== "sonst" && z.art !== "zuhause";
  if (!geschaeft) return { art: "privat", zweck: null, zielAnzeige: "privat" };
  const name = z.art === "lieferant" ? (o.lieferanten.find((l) => l.id === z.lieferantId)?.name ?? "Lieferant") : { lager: "Lager", prep: "Prep Center", palettenlager: "Palettenlager", post: "Post/DHL" }[z.art as "lager" | "prep" | "palettenlager" | "post"];
  return { art: "geschaeftlich", zweck: termin?.titel ?? `Fahrt zu ${name}`, zielAnzeige: f.ziel ?? name };
}

// ---- Scan: Ansage ---------------------------------------------------------------------------------------------

const LAND = { DE: "Deutschland", FR: "Frankreich", IT: "Italien", ES: "Spanien", NL: "Niederlande", PL: "Polen", SE: "Schweden", BE: "Belgien", IE: "Irland" } as Record<string, string>;
const AMPEL = { gruen: "Grün", gelb: "Gelb", rot: "Rot" } as Record<string, string>;

/** „Grün. Frankreich. 4 Euro 20 pro Stück, ROI 28 Prozent. 12 Angebote. Nimm 15.“ */
export function scanAnsage(r: { ampel: string; land: string | null; gewinnStueck: number | null; roi: number | null; angebote: number | null; menge: number | null; grund?: string | null }): string {
  const s = [`${AMPEL[r.ampel] ?? r.ampel}.`];
  if (r.land) s.push(`${LAND[r.land] ?? r.land}.`);
  if (r.gewinnStueck !== null) s.push(`${euroSprechen(r.gewinnStueck)} pro Stück${r.roi !== null ? `, ROI ${Math.round(r.roi)} Prozent` : ""}.`);
  if (r.angebote !== null) s.push(`${r.angebote} ${r.angebote === 1 ? "Angebot" : "Angebote"}.`);
  if (r.ampel === "rot" && r.grund) s.push(`${r.grund.replace(/[.]$/, "")}.`);
  else if (r.menge) s.push(`Nimm ${r.menge}.`);
  return s.join(" ");
}
