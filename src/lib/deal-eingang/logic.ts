// Deal-Eingang (WhatsApp → Teilen → Seller-System) – reine Logik: KI-Auftrag und Antwort lesen, einfache
// Erkennung ohne KI, Packungsgröße, maximaler EK für den Ziel-ROI, Ampel des Eingangs, Push-Text, Antwort-Entwurf,
// Trefferquote je Quelle. Die Marktdaten kommen aus der Deal-Ampel (Modul 4).

import type { DealAngebot } from "@/db/tables/deal-eingang";

export type Angebot = DealAngebot;

export type Ampel = "gruen" | "gelb" | "rot";
export const AMPEL_EMOJI: Record<Ampel, string> = { gruen: "🟢", gelb: "🟡", rot: "🔴" };

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const zahl = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.replace(/[€\s]/g, "").replace(/EUR/i, "");
  const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const ASIN = /^(B0[A-Z0-9]{8}|\d{9}[\dX])$/;

/** Auftrag an die KI (Text, Screenshot oder PDF einer Händler-Nachricht). */
export function kiErkennungAuftrag(text: string): string {
  return [
    "Erkenne die Angebote in dieser Nachricht eines Großhändlers bzw. Deal-Anbieters (oft aus WhatsApp: Text, Screenshot oder PDF).",
    "Je Angebot eine Zeile. Nur was dasteht – nichts erfinden. Unbekanntes = null.",
    'Antworte NUR mit JSON: {"quelle":"Absender, falls erkennbar (z. B. Name in WhatsApp), sonst null","angebote":[{"asin":null,"ean":null,"name":"Artikelname","marke":null,"ek":12.5,"ek_netto":true,"waehrung":"EUR","menge":null,"moq":null,"staffel":"ab 50: 12,00","versand":null,"lieferzeit":null,"zahlung":null,"gueltig_bis":"JJJJ-MM-TT oder null","zustand":"neu|B-Ware|null","packung":6}]}',
    "ek_netto: true wenn „netto“/„zzgl. MwSt“ dasteht, false bei „brutto“/„inkl. MwSt“, sonst null. packung = Stück je Verkaufseinheit (6er/6x/6 Stück), sonst null.",
    text ? `Nachricht:\n${text.slice(0, 20_000)}` : "Nachricht: siehe Bild/Datei.",
  ].join("\n");
}

function angebotAus(o: Record<string, unknown>): Angebot | null {
  const asin = str(o.asin, 10).toUpperCase();
  const ean = str(o.ean, 14).replace(/\D/g, "");
  const name = str(o.name ?? o.artikel ?? o.titel, 300) || null;
  if (!ASIN.test(asin) && !/^\d{8}$|^\d{12,14}$/.test(ean) && !name) return null;
  const ekNetto = o.ek_netto === true || o.ekNetto === true ? true : o.ek_netto === false || o.ekNetto === false ? false : null;
  const packung = zahl(o.packung);
  return {
    asin: ASIN.test(asin) ? asin : null,
    ean: /^\d{8}$|^\d{12,14}$/.test(ean) ? ean : null,
    name,
    marke: str(o.marke, 120) || null,
    ek: zahl(o.ek),
    ekNetto,
    waehrung: (str(o.waehrung, 3) || "EUR").toUpperCase(),
    menge: zahl(o.menge),
    moq: zahl(o.moq),
    staffel: str(o.staffel, 200) || null,
    versand: str(o.versand, 120) || null,
    lieferzeit: str(o.lieferzeit, 120) || null,
    zahlung: str(o.zahlung, 120) || null,
    gueltigBis: /^\d{4}-\d{2}-\d{2}$/.test(str(o.gueltig_bis ?? o.gueltigBis, 10)) ? str(o.gueltig_bis ?? o.gueltigBis, 10) : null,
    zustand: str(o.zustand, 40) || null,
    packung: packung && packung >= 1 && packung <= 500 ? Math.round(packung) : null,
  };
}

/** KI-Antwort lesen (robust gegen Text drumherum). */
export function leseKiAngebote(antwort: string): { quelle: string | null; angebote: Angebot[] } {
  const json = /\{[\s\S]*\}/.exec(antwort)?.[0];
  if (!json) return { quelle: null, angebote: [] };
  try {
    const o = JSON.parse(json) as { quelle?: unknown; angebote?: unknown[] };
    const angebote = (Array.isArray(o.angebote) ? o.angebote : []).slice(0, 500).map((x) => angebotAus((x ?? {}) as Record<string, unknown>)).filter((x): x is Angebot => !!x);
    return { quelle: str(o.quelle, 80) || null, angebote };
  } catch {
    return { quelle: null, angebote: [] };
  }
}

/** Packungsgröße aus Text: „6x“, „6er“, „6 Stück“, „6-Pack“, „Pack of 6“, „x6“. */
export function packungAus(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const m = /(\d{1,3})\s*(?:x(?!\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|m)\b)|er\b|er[- ]?pack|[- ]?pack\b|\s?stück|\s?stk\b)/.exec(t) ?? /pack(?:ung)?\s*(?:of|à|a|mit)\s*(\d{1,3})/.exec(t) ?? /\bx\s?(\d{1,3})\b/.exec(t);
  const n = m ? Number(m[1]) : null;
  return n && n >= 1 && n <= 500 ? n : null;
}

/** Warnung, wenn die Packungsgröße im Angebot nicht zum Amazon-Titel passt (1er vs. 6er). */
export function packungsWarnung(angebot: { packung: number | null; name: string | null }, titel: string | null): string | null {
  const a = angebot.packung ?? packungAus(angebot.name);
  if (!a || a < 2) return null;
  const t = packungAus(titel);
  if (t === a) return null;
  return `Packungsgröße prüfen: Angebot ${a}er, Amazon-Titel ${t ? `${t}er` : "ohne Mengenangabe"}.`;
}

/** Einfache Erkennung ohne KI: Zeilen mit ASIN/EAN/Artikel und Preis („19,50 netto ab 50 Stk“). */
export function einfacheErkennung(text: string): Angebot[] {
  const out: Angebot[] = [];
  for (const roh of text.split(/\r?\n/)) {
    const z = roh.replace(/^\[[^\]]*\]\s*[^:]{1,40}:\s*/, "").trim();
    if (z.length < 6) continue;
    const asin = /\b(B0[A-Z0-9]{8})\b/.exec(z.toUpperCase())?.[1] ?? null;
    const ean = /\b(\d{13}|\d{8})\b/.exec(z)?.[1] ?? null;
    const preis = /(\d{1,5}(?:[.,]\d{2}))\s*(?:€|eur|euro)?\s*(netto|brutto|zzgl\.?|inkl\.?)?/i.exec(z.replace(/\b\d{13}\b|\b\d{8}\b/g, ""));
    if (!preis || (!asin && !ean && !/[a-zäöü]{3}/i.test(z))) continue;
    const ek = zahl(preis[1]);
    const art = (preis[2] ?? "").toLowerCase();
    const menge = /(?:ab|min\.?|moq)\s*(\d{1,6})\s*(?:stk|stück|pcs|st\.?)?/i.exec(z)?.[1] ?? /(\d{1,6})\s*(?:stk|stück|pcs)\b/i.exec(z)?.[1] ?? null;
    const name = z.slice(0, preis.index).replace(/\b(B0[A-Z0-9]{8}|\d{13}|\d{8})\b/gi, "").replace(/[-–:|,;]+\s*$/, "").trim() || null;
    out.push({ asin, ean, name, marke: null, ek, ekNetto: art.startsWith("netto") || art.startsWith("zzgl") ? true : art.startsWith("brutto") || art.startsWith("inkl") ? false : null, waehrung: "EUR", menge: menge ? Number(menge) : null, moq: menge ? Number(menge) : null, staffel: null, versand: null, lieferzeit: null, zahlung: null, gueltigBis: null, zustand: null, packung: packungAus(name) });
  }
  return out;
}

/** Absender aus einem geteilten WhatsApp-Text („[30.10.26, 14:02] Konrad: …“ oder „Konrad: …“). */
export function quelleAusText(text: string): string | null {
  const m = /^\s*\[[^\]]+\]\s*([^:\n]{2,40}):/m.exec(text) ?? /^\s*([A-ZÄÖÜ][\wäöüß.-]{1,20}(?:\s[A-ZÄÖÜ][\wäöüß.-]{1,20})?):\s/m.exec(text);
  return m ? m[1].trim() : null;
}

/** Höchster EK netto, bei dem der Ziel-ROI noch erreicht wird: (VK netto − Gebühren − Prep) ÷ (1 + ROI). */
export function maxEk(o: { vkNetto: number; gebuehren: number; prep: number; zielRoi: number }): number | null {
  const rest = o.vkNetto - o.gebuehren - o.prep;
  if (!(rest > 0)) return null;
  return Math.floor((rest / (1 + o.zielRoi / 100)) * 100) / 100;
}

export type ZeilenPruefung = {
  ampel: Ampel;
  gruende: string[];
  titel: string | null;
  asin: string | null;
  bestesLand: string | null;
  roi: number | null;
  gewinn: number | null;
  angebote: number | null;
  amazonProzent: number | null;
  empfohlen: number | null;
  ekNetto: number | null;
  maxEk: { land: string; ek: number }[];
  kapitalbedarf: number | null;
};

/** Gründe sortiert (Rot vor Gelb), höchstens drei. */
export function dreiGruende(rot: string[], gelb: string[]): string[] {
  return [...rot, ...gelb].slice(0, 3);
}

/** Ampel des ganzen Eingangs = beste Zeile (ein grünes Angebot reicht, um hinzuschauen); Zusammenfassung „5 geprüft: 2 🟢, 1 🟡, 2 🔴“. */
export function eingangAmpel(zeilen: { ampel: Ampel }[]): { ampel: Ampel | null; text: string } {
  const n = { gruen: 0, gelb: 0, rot: 0 };
  for (const z of zeilen) n[z.ampel]++;
  const ampel = !zeilen.length ? null : n.gruen ? "gruen" : n.gelb ? "gelb" : "rot";
  return { ampel, text: `${zeilen.length} geprüft: ${n.gruen} 🟢, ${n.gelb} 🟡, ${n.rot} 🔴` };
}

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Push-Text für ein Angebot (Beispiel im Bauauftrag) bzw. die Zusammenfassung bei mehreren. */
export function pushText(zeilen: (ZeilenPruefung & { name: string | null })[]): string {
  if (!zeilen.length) return "Keine Angebote erkannt – bitte im Deal-Eingang ansehen.";
  if (zeilen.length > 1) return eingangAmpel(zeilen).text;
  const z = zeilen[0];
  const teile = [`${AMPEL_EMOJI[z.ampel]} ${(z.titel ?? z.name ?? z.asin ?? "Angebot").slice(0, 40)}`];
  if (z.ekNetto) teile.push(`EK ${eur(z.ekNetto)}`);
  if (z.bestesLand && z.roi !== null) teile.push(`bestes Land ${z.bestesLand}: ROI ${Math.round(z.roi)} %${z.gewinn !== null ? `, ${eur(z.gewinn)}/Stk` : ""}`);
  if (z.angebote !== null) teile.push(`${z.angebote} Angebote${z.amazonProzent !== null ? (z.amazonProzent >= 50 ? `, Amazon ${z.amazonProzent} %` : z.amazonProzent > 0 ? "" : ", Amazon nicht drin") : ""}`);
  if (z.empfohlen) teile.push(`Empf. ${z.empfohlen} Stk${z.kapitalbedarf ? ` (${Math.round(z.kapitalbedarf).toLocaleString("de-DE")} €)` : ""}`);
  if (!z.ekNetto && z.maxEk.length) teile.push(`lohnt bis EK ${eur(z.maxEk[0].ek)} netto (${z.maxEk[0].land})`);
  if (z.gruende.length && z.ampel !== "gruen") teile.push(z.gruende[0]);
  return teile.join(" · ");
}

/** Antwort an den Händler: Zusage zur empfohlenen Menge oder Gegenangebot mit max. EK. */
export function antwortEntwurf(z: { name: string | null; titel: string | null; ampel: Ampel; empfohlen: number | null; ekNetto: number | null; maxEk: { land: string; ek: number }[] }, lieferbisDatum?: string | null): string {
  const was = z.name ?? z.titel ?? "den Artikel";
  const max = z.maxEk[0]?.ek ?? null;
  if (z.ampel !== "rot" && z.empfohlen && z.ekNetto && (max === null || z.ekNetto <= max)) return `Hallo, ich nehme ${z.empfohlen} Stk ${was} zu ${eur(z.ekNetto)} netto${lieferbisDatum ? `, Lieferung bis ${lieferbisDatum.split("-").reverse().join(".")}` : ""}. Bitte kurz bestätigen. Danke!`;
  if (max !== null) return `Hallo, danke für das Angebot ${was}. Zu ${z.ekNetto ? eur(z.ekNetto) : "dem Preis"} passt es für mich leider nicht – bei ${eur(max)} netto${z.empfohlen ? ` würde ich ${z.empfohlen} Stk` : ""} nehmen. Geht das?`;
  return `Hallo, danke für das Angebot ${was} – passt aktuell leider nicht.`;
}

export type EingangFuerQuote = { quelle: string | null; status: string; zeilen: { ampel: Ampel; roi: number | null }[] };

/** Trefferquote je Absender: Deals, gekauft, verworfen, grüne Zeilen, Ø ROI (Prognose) der gekauften. */
export function trefferquote(eingaenge: EingangFuerQuote[]) {
  const je = new Map<string, { quelle: string; eingaenge: number; angebote: number; gruen: number; gekauft: number; verworfen: number; roiSumme: number; roiN: number }>();
  for (const e of eingaenge) {
    const q = e.quelle?.trim() || "unbekannt";
    const x = je.get(q) ?? { quelle: q, eingaenge: 0, angebote: 0, gruen: 0, gekauft: 0, verworfen: 0, roiSumme: 0, roiN: 0 };
    x.eingaenge++;
    x.angebote += e.zeilen.length;
    x.gruen += e.zeilen.filter((z) => z.ampel === "gruen").length;
    if (e.status === "gekauft" || e.status === "b2b" || e.status === "bestellvorschlag") {
      x.gekauft++;
      for (const z of e.zeilen) if (z.roi !== null) (x.roiSumme += z.roi), x.roiN++;
    }
    if (e.status === "verworfen") x.verworfen++;
    je.set(q, x);
  }
  return [...je.values()].map((x) => ({ quelle: x.quelle, eingaenge: x.eingaenge, angebote: x.angebote, gruen: x.gruen, gekauft: x.gekauft, verworfen: x.verworfen, roiPrognose: x.roiN ? Math.round(x.roiSumme / x.roiN) : null })).sort((a, b) => b.eingaenge - a.eingaenge);
}

const woerter = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9äöüß ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w)));

/**
 * Bester Treffer der Titelsuche bzw. EAN-Abfrage: gleiche Packungsgröße zuerst, dann die meisten gemeinsamen Wörter.
 * sicher = genau ein Treffer passt in Packung und hat ≥ 60 % der Wörter des Angebots.
 */
export function waehleTreffer(angebot: { name: string | null; packung: number | null }, kandidaten: { asin: string; titel: string; packung: number | null }[]): { asin: string; titel: string; sicher: boolean } | null {
  if (!kandidaten.length) return null;
  const pack = angebot.packung ?? packungAus(angebot.name);
  const w = woerter(angebot.name ?? "");
  const bewertet = kandidaten.map((k) => {
    const kp = k.packung ?? packungAus(k.titel);
    const passt = pack === null ? true : kp === pack || (pack === 1 && kp === null);
    const tw = woerter(k.titel);
    const gemeinsam = w.size ? [...w].filter((x) => tw.has(x)).length / w.size : 0;
    return { ...k, passt, gemeinsam };
  });
  bewertet.sort((a, b) => Number(b.passt) - Number(a.passt) || b.gemeinsam - a.gemeinsam);
  const best = bewertet[0];
  const passende = bewertet.filter((b) => b.passt && b.gemeinsam >= 0.6);
  return { asin: best.asin, titel: best.titel, sicher: best.passt && best.gemeinsam >= 0.6 && passende.length === 1 };
}

/** Empfohlene Menge: Abverkauf für höchstens N Tage minus eigener Bestand und Ware unterwegs (nie negativ). */
export function empfohleneMenge(unsProMonat: number | null, tage: number, eigen: { bestand: number; unterwegs: number } | null): number | null {
  if (unsProMonat === null || unsProMonat <= 0) return null;
  const ziel = Math.floor((unsProMonat * tage) / 30);
  return Math.max(0, ziel - (eigen ? eigen.bestand + eigen.unterwegs : 0));
}

/** Ampel einer Zeile aus roten und gelben Gründen. */
export function zeilenAmpel(rot: string[], gelb: string[]): Ampel {
  return rot.length ? "rot" : gelb.length ? "gelb" : "gruen";
}

/** Ab so vielen Zeilen (oder bei XLSX/CSV) geht der Eingang als Preisliste an den Preislisten-Scanner. */
export function istPreisliste(o: { zeilen: number; tabellen: number; ab: number }): boolean {
  return o.tabellen > 0 || o.zeilen >= o.ab;
}

/** Erkannte Angebote als Tabelle für den Preislisten-Import (Spalten wie eine Großhändler-Liste). */
export function angeboteAlsTabelle(angebote: Angebot[]): { headers: string[]; rows: string[][] } {
  const headers = ["Artikelnummer", "EAN", "ASIN", "Bezeichnung", "EK netto", "MOQ"];
  const rows = angebote.map((a, i) => [a.ean ?? a.asin ?? `Z${i + 1}`, a.ean ?? "", a.asin ?? "", [a.marke, a.name].filter(Boolean).join(" "), a.ek !== null ? String(a.ekNetto === false ? Math.round((a.ek / 1.19) * 100) / 100 : a.ek).replace(".", ",") : "", a.moq !== null ? String(a.moq) : ""]);
  return { headers, rows };
}
