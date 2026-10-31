// Kontoauszüge (Sparkasse u. a.) – reine Logik ohne Datenbank: CSV („CSV-CAMT“, „CSV-MT940“, eigene Spalten) und
// CAMT.053 (XML) lesen, wiederkehrende Abbuchungen erkennen (Fixkosten, Kreditkarte, Steuern), Kontostand
// fortschreiben. Gemeinsam für das Geschäftskonto (Liquidität) und das Privatkonto (Privat → Geld).

import { createHash } from "node:crypto";
import { addDaysIso } from "@/lib/dates";
import { parseAmount, parseDate } from "@/lib/numbers";
import { readTable } from "@/lib/tabular";
import { parseXml, xmlAt, xmlList, xmlText, type XmlValue } from "@/lib/xml";

export type Umsatz = {
  schluessel: string;
  konto: string | null;
  buchungstag: string;
  valuta: string | null;
  betrag: number;
  waehrung: string;
  gegenpartei: string;
  iban: string | null;
  zweck: string;
  buchungstext: string | null;
  glaeubigerId: string | null;
  mandat: string | null;
  saldoDanach: number | null;
};
export type Auszug = { format: "csv" | "camt" | "pdf"; konto: string | null; umsaetze: Umsatz[]; salden: { datum: string; saldo: number }[] };

const norm = (h: string) =>
  h
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SPALTEN: Record<string, RegExp> = {
  konto: /^(auftragskonto|iban auftragskonto|eigenes konto|kontonummer auftragskonto)$/,
  buchungstag: /^(buchungstag|buchungsdatum|datum|buchung)$/,
  valuta: /^(valutadatum|valuta|wertstellung|wertstellungsdatum)$/,
  betrag: /^(betrag|betrag eur|umsatz|betrag in eur|umsatz in eur)$/,
  waehrung: /^(waehrung|wahrung|currency)$/,
  gegenpartei: /^(beguenstigter zahlungspflichtiger|begunstigter zahlungspflichtiger|name zahlungsbeteiligter|empfaenger|auftraggeber empfaenger|zahlungspflichtiger empfaenger|gegenpartei)$/,
  iban: /^(kontonummer iban|iban zahlungsbeteiligter|iban|kontonummer)$/,
  zweck: /^(verwendungszweck|zweck|buchungsdetails)$/,
  buchungstext: /^(buchungstext|umsatzart|vorgang)$/,
  glaeubigerId: /^(glaeubiger id|glaubiger id|glaeubiger identifikation)$/,
  mandat: /^(mandatsreferenz|mandat)$/,
  saldo: /^(saldo nach buchung|saldo|kontostand|kontostand nach buchung)$/,
};

const datumIso = (v: string | undefined | null) => (v ? parseDate(v.trim()) : null);

/** Eindeutiger Schlüssel je Umsatz – gleiche Zeilen in einer Datei werden durchgezählt. */
function schluesselFuer(u: Omit<Umsatz, "schluessel">, n: number) {
  return createHash("sha256").update([u.konto ?? "", u.buchungstag, u.betrag.toFixed(2), u.gegenpartei, u.zweck, u.mandat ?? "", n].join("|")).digest("hex").slice(0, 40);
}

function mitSchluessel(liste: Omit<Umsatz, "schluessel">[]): Umsatz[] {
  const gezaehlt = new Map<string, number>();
  return liste.map((u) => {
    const basis = [u.konto, u.buchungstag, u.betrag.toFixed(2), u.gegenpartei, u.zweck].join("|");
    const n = (gezaehlt.get(basis) ?? 0) + 1;
    gezaehlt.set(basis, n);
    return { ...u, schluessel: schluesselFuer(u, n) };
  });
}

export function leseCsv(bytes: Uint8Array): Auszug {
  const t = readTable(bytes);
  const kopf = t.headers.map(norm);
  const spalte = (k: keyof typeof SPALTEN) => kopf.findIndex((h) => SPALTEN[k].test(h));
  const c = Object.fromEntries(Object.keys(SPALTEN).map((k) => [k, spalte(k as keyof typeof SPALTEN)])) as Record<keyof typeof SPALTEN, number>;
  if (c.buchungstag < 0 || c.betrag < 0) throw new Error("Spalten „Buchungstag“ und „Betrag“ nicht gefunden – bitte den Export „CSV-CAMT“ der Sparkasse verwenden.");
  const zelle = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const roh: Omit<Umsatz, "schluessel">[] = [];
  for (const r of t.rows) {
    const tag = datumIso(zelle(r, c.buchungstag));
    const betrag = parseAmount(zelle(r, c.betrag));
    if (!tag || betrag === null) continue;
    roh.push({
      konto: zelle(r, c.konto).replace(/\s/g, "") || null,
      buchungstag: tag,
      valuta: datumIso(zelle(r, c.valuta)),
      betrag,
      waehrung: zelle(r, c.waehrung) || "EUR",
      gegenpartei: zelle(r, c.gegenpartei),
      iban: zelle(r, c.iban).replace(/\s/g, "") || null,
      zweck: zelle(r, c.zweck),
      buchungstext: zelle(r, c.buchungstext) || null,
      glaeubigerId: zelle(r, c.glaeubigerId) || null,
      mandat: zelle(r, c.mandat) || null,
      saldoDanach: c.saldo >= 0 ? parseAmount(zelle(r, c.saldo)) : null,
    });
  }
  const umsaetze = mitSchluessel(roh);
  const konto = umsaetze.find((u) => u.konto)?.konto ?? null;
  // Saldo-Spalte: letzter Stand je Tag (bei mehreren Buchungen am Tag die jüngste Zeile = erste im Export).
  const salden = new Map<string, number>();
  for (const u of umsaetze) if (u.saldoDanach !== null && !salden.has(u.buchungstag)) salden.set(u.buchungstag, u.saldoDanach);
  return { format: "csv", konto, umsaetze, salden: [...salden].map(([datum, saldo]) => ({ datum, saldo })) };
}

const betragAus = (v: XmlValue | undefined, ind: XmlValue | undefined) => {
  const n = parseAmount(xmlText(v));
  if (n === null) return null;
  return xmlText(ind) === "DBIT" ? -Math.abs(n) : Math.abs(n);
};

/** CAMT.053 (Kontoauszug als XML) – mit Salden (CLBD = Schlusssaldo). */
export function leseCamt(text: string): Auszug {
  const doc = parseXml(text);
  const root = xmlAt(doc, "Document", "BkToCstmrStmt") ?? xmlAt(doc, "Document", "BkToCstmrAcctRpt");
  const stmts = xmlList(xmlAt(root, "Stmt") ?? xmlAt(root, "Rpt"));
  if (!stmts.length) throw new Error("Keine CAMT-Kontoauszüge in der Datei gefunden.");
  let konto: string | null = null;
  const roh: Omit<Umsatz, "schluessel">[] = [];
  const salden: { datum: string; saldo: number }[] = [];
  for (const s of stmts) {
    konto ??= xmlText(xmlAt(s, "Acct", "Id", "IBAN")) || null;
    for (const b of xmlList(xmlAt(s, "Bal"))) {
      const art = xmlText(xmlAt(b, "Tp", "CdOrPrtry", "Cd"));
      const saldo = betragAus(xmlAt(b, "Amt"), xmlAt(b, "CdtDbtInd"));
      const datum = xmlText(xmlAt(b, "Dt", "Dt")) || xmlText(xmlAt(b, "Dt", "DtTm")).slice(0, 10);
      if ((art === "CLBD" || art === "CLAV") && saldo !== null && /^\d{4}-\d{2}-\d{2}/.test(datum)) salden.push({ datum: datum.slice(0, 10), saldo });
    }
    for (const e of xmlList(xmlAt(s, "Ntry"))) {
      const betrag = betragAus(xmlAt(e, "Amt"), xmlAt(e, "CdtDbtInd"));
      const tag = (xmlText(xmlAt(e, "BookgDt", "Dt")) || xmlText(xmlAt(e, "BookgDt", "DtTm"))).slice(0, 10);
      if (betrag === null || !/^\d{4}-\d{2}-\d{2}$/.test(tag)) continue;
      const tx = xmlList(xmlAt(e, "NtryDtls", "TxDtls"))[0];
      const soll = betrag < 0;
      const partei = soll ? xmlAt(tx, "RltdPties", "Cdtr") : xmlAt(tx, "RltdPties", "Dbtr");
      const parteiKonto = soll ? xmlAt(tx, "RltdPties", "CdtrAcct", "Id", "IBAN") : xmlAt(tx, "RltdPties", "DbtrAcct", "Id", "IBAN");
      roh.push({
        konto,
        buchungstag: tag,
        valuta: (xmlText(xmlAt(e, "ValDt", "Dt")) || null)?.slice(0, 10) ?? null,
        betrag,
        waehrung: "EUR",
        gegenpartei: xmlText(xmlAt(partei, "Nm")) || xmlText(xmlAt(partei, "Pty", "Nm")),
        iban: xmlText(parteiKonto) || null,
        zweck: xmlList(xmlAt(tx, "RmtInf", "Ustrd")).map(xmlText).join(" ") || xmlText(xmlAt(e, "AddtlNtryInf")),
        buchungstext: xmlText(xmlAt(e, "AddtlNtryInf")) || null,
        glaeubigerId: xmlText(xmlAt(tx, "RltdPties", "Cdtr", "Id", "PrvtId", "Othr", "Id")) || xmlText(xmlAt(tx, "Refs", "CdtrSchmeId")) || null,
        mandat: xmlText(xmlAt(tx, "Refs", "MndtId")) || null,
        saldoDanach: null,
      });
    }
  }
  return { format: "camt", konto, umsaetze: mitSchluessel(roh), salden };
}

export function leseKontoauszug(bytes: Uint8Array): Auszug {
  const anfang = new TextDecoder("utf-8").decode(bytes.slice(0, 600));
  if (/^\s*(﻿)?<\?xml|<Document/.test(anfang)) return leseCamt(new TextDecoder("utf-8").decode(bytes));
  return leseCsv(bytes);
}

// ---- Wiederkehrende Abbuchungen ------------------------------------------------------------------

export type Rhythmus = "woechentlich" | "monatlich" | "quartal" | "jaehrlich";
export type Wiederkehrend = { gruppe: string; name: string; art: "kreditkarte" | "steuer" | "fixkosten"; rhythmus: Rhythmus; betrag: number; letzte: string; naechste: string; anzahl: number; schwankung: number };

/** Gruppenschlüssel: Gläubiger-ID + Mandat (Lastschrift), sonst Name der Gegenpartei vereinfacht. */
export function gruppeVon(u: Pick<Umsatz, "glaeubigerId" | "mandat" | "gegenpartei" | "iban">): string {
  if (u.glaeubigerId && u.mandat) return `sepa:${u.glaeubigerId}|${u.mandat}`;
  const n = norm(u.gegenpartei).replace(/\b(gmbh|ag|se|kg|co|ltd|bv|sarl|e k|ek|ohg|mbh|europe|deutschland|germany|services?)\b/g, "").replace(/\s+/g, " ").trim();
  return n ? `name:${n}` : `iban:${u.iban ?? "?"}`;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function artVon(name: string, zweck = ""): Wiederkehrend["art"] {
  const t = `${name} ${zweck}`;
  if (/american express|\bamex\b|kreditkarte|visa card|mastercard/i.test(t)) return "kreditkarte";
  if (/finanzamt|bundeskasse|steuer|zoll/i.test(t)) return "steuer";
  return "fixkosten";
}

function addMonate(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  const tag = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(tag, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/**
 * Abbuchungen, die regelmäßig wiederkommen (mind. 2× in 13 Monaten, gleicher Rhythmus). Kreditkarte darf im
 * Betrag schwanken, Fixkosten nur ±30 %. Nächster Termin aus dem Rhythmus; nur Gruppen, die noch laufen.
 */
export function erkenneWiederkehrend(umsaetze: Pick<Umsatz, "buchungstag" | "betrag" | "gegenpartei" | "zweck" | "glaeubigerId" | "mandat" | "iban">[], heute: string): Wiederkehrend[] {
  const seit = addDaysIso(heute, -400);
  const gruppen = new Map<string, typeof umsaetze>();
  for (const u of umsaetze) {
    if (u.betrag >= 0 || u.buchungstag < seit) continue;
    const g = gruppeVon(u);
    gruppen.set(g, [...(gruppen.get(g) ?? []), u]);
  }
  const out: Wiederkehrend[] = [];
  for (const [gruppe, liste] of gruppen) {
    if (liste.length < 2) continue;
    // je Tag zusammenfassen (Teilbuchungen)
    const jeTag = new Map<string, number>();
    for (const u of liste) jeTag.set(u.buchungstag, (jeTag.get(u.buchungstag) ?? 0) + u.betrag);
    const tage = [...jeTag.keys()].sort();
    if (tage.length < 2) continue;
    const abst = tage.slice(1).map((t, i) => (Date.parse(t) - Date.parse(tage[i])) / 86_400_000);
    const m = median(abst);
    const rhythmus: Rhythmus | null = m >= 6 && m <= 8 ? "woechentlich" : m >= 25 && m <= 35 ? "monatlich" : m >= 80 && m <= 100 ? "quartal" : m >= 340 && m <= 390 ? "jaehrlich" : null;
    if (!rhythmus) continue;
    const betraege = tage.map((t) => -jeTag.get(t)!);
    const name = liste[liste.length - 1].gegenpartei || gruppe.replace(/^\w+:/, "");
    const art = artVon(name, liste[0].zweck);
    const min = Math.min(...betraege);
    const max = Math.max(...betraege);
    const schwankung = min > 0 ? Math.round(((max - min) / min) * 100) / 100 : 1;
    if (art === "fixkosten" && schwankung > 0.3) continue;
    const letzte = tage[tage.length - 1];
    const step = (d: string) => (rhythmus === "woechentlich" ? addDaysIso(d, 7) : addMonate(d, rhythmus === "monatlich" ? 1 : rhythmus === "quartal" ? 3 : 12));
    let naechste = step(letzte);
    // Läuft die Gruppe noch? Mehr als 1,6 Rhythmen ohne Buchung → beendet.
    if ((Date.parse(heute) - Date.parse(letzte)) / 86_400_000 > m * 1.6) continue;
    while (naechste < heute) naechste = step(naechste);
    // Kreditkarte: Betrag der letzten Abbuchung (schwankt mit den Umsätzen), sonst Median.
    const betrag = Math.round((art === "kreditkarte" ? betraege[betraege.length - 1] : median(betraege)) * 100) / 100;
    out.push({ gruppe, name, art, rhythmus, betrag, letzte, naechste, anzahl: tage.length, schwankung });
  }
  return out.sort((a, b) => b.betrag - a.betrag);
}

/** Termine einer wiederkehrenden Abbuchung im Zeitraum [von, bis]. */
export function termineBis(w: Pick<Wiederkehrend, "naechste" | "rhythmus">, von: string, bis: string): string[] {
  const out: string[] = [];
  let d = w.naechste;
  let n = 0;
  while (d <= bis && n < 60) {
    if (d >= von) out.push(d);
    n++;
    d = w.rhythmus === "woechentlich" ? addDaysIso(w.naechste, 7 * n) : addMonate(w.naechste, (w.rhythmus === "monatlich" ? 1 : w.rhythmus === "quartal" ? 3 : 12) * n);
  }
  return out;
}

/** Kontostand an einem Tag: letzter bekannter Saldo (Anker) plus spätere Umsätze bis zum Tag. */
export function saldoAm(anker: { datum: string; saldo: number } | null, umsaetze: Pick<Umsatz, "buchungstag" | "betrag">[], tag: string): number | null {
  if (!anker) return null;
  const nach = umsaetze.filter((u) => u.buchungstag > anker.datum && u.buchungstag <= tag).reduce((n, u) => n + u.betrag, 0);
  return Math.round((anker.saldo + nach) * 100) / 100;
}
