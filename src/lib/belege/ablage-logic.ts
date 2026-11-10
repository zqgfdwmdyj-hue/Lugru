// B34.2 Beleg-Ablage aus dem Download-Ordner – reine Logik: Zielname JJJJ-MM-TT_Lieferant_Betrag_Rechnungsnr,
// Ordner Monat/Lieferant, Dubletten (gleiche Datei bzw. gleiche Nummer + Betrag), Lieferant aus dem Text,
// Entgeltabschluss der Bank im Kontoauszug.

export type BelegFakten = { lieferant: string | null; datum: string | null; betrag: number | null; nummer: string | null };

/** Für Datei- und Ordnernamen: keine Pfadzeichen, Leerzeichen → „-“, Länge begrenzt. */
export function namensTeil(s: string | null | undefined, max = 40): string {
  const t = (s ?? "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "")
    .replace(/ /g, "-");
  return t.slice(0, max).replace(/-+$/g, "");
}

const betragText = (n: number) => Math.abs(n).toFixed(2).replace(".", ",");

/** „2026-11-03_Testlieferant-GmbH_119,00_RE-1001.pdf“ – fehlende Teile werden benannt statt weggelassen. */
export function zielName(f: BelegFakten, endung: string): string {
  const e = endung.startsWith(".") ? endung.toLowerCase() : `.${endung.toLowerCase()}`;
  return [f.datum ?? "ohne-Datum", namensTeil(f.lieferant) || "unbekannt", f.betrag !== null ? betragText(f.betrag) : "ohne-Betrag", namensTeil(f.nummer, 30) || "ohne-Nr"].join("_") + e;
}

/** Ordner je Monat und Lieferant: „2026-11/Testlieferant-GmbH“ (ohne Datum: Monat des Eingangs). */
export function zielOrdner(f: BelegFakten, eingang: string): string {
  return `${(f.datum ?? eingang).slice(0, 7)}/${namensTeil(f.lieferant) || "unbekannt"}`;
}

/** Rechnungsnummer vergleichbar machen: groß, nur Buchstaben/Ziffern. */
export const nummerNorm = (n: string | null | undefined) => (n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export type Vorhanden = { id: string; hash: string | null; nummer: string | null; betrag: number | null; pfad?: string | null };

/** Dublette? Gleiche Prüfsumme oder gleiche Rechnungsnummer + gleicher Betrag (auf den Cent). */
export function dubletteVon(neu: { hash: string; nummer: string | null; betrag: number | null }, alle: Vorhanden[]): { id: string; grund: string } | null {
  const h = alle.find((a) => a.hash && a.hash === neu.hash);
  if (h) return { id: h.id, grund: "gleiche Datei (Prüfsumme)" };
  const n = nummerNorm(neu.nummer);
  if (n.length >= 3 && neu.betrag !== null) {
    const m = alle.find((a) => nummerNorm(a.nummer) === n && a.betrag !== null && Math.abs(Math.abs(a.betrag) - Math.abs(neu.betrag!)) < 0.005);
    if (m) return { id: m.id, grund: `gleiche Rechnungsnummer ${neu.nummer} und Betrag ${betragText(neu.betrag)} €` };
  }
  return null;
}

const FIRMA = /\b(GmbH(\s*&\s*Co\.?\s*KG)?|AG|KG|OHG|UG(\s*\(haftungsbeschränkt\))?|e\.\s?K\.|GbR|SE|Ltd\.?|Limited|Inc\.?|LLC|S\.?à\s?r\.?l\.?|S\.?A\.?R\.?L\.?|S\.?r\.?l\.?|S\.?L\.?|B\.?V\.?|Sp\.\s?z\s?o\.?o\.?)\b/;

/**
 * Lieferant aus dem Rechnungstext: zuerst ein bekannter Lieferant (Stammdaten), sonst die erste Zeile mit
 * Rechtsform in den ersten 30 Zeilen – die eigene Firma (Empfänger) wird übersprungen.
 */
export function lieferantAusText(text: string, o: { bekannt?: string[]; eigene?: string[] } = {}): string | null {
  const t = text.replace(/ /g, " ");
  const klein = t.toLowerCase();
  const eigen = (o.eigene ?? []).map((x) => x.toLowerCase().trim()).filter((x) => x.length >= 3);
  const bekannt = (o.bekannt ?? []).filter((b) => b && b.trim().length >= 4).sort((a, b) => b.length - a.length);
  for (const b of bekannt) if (klein.includes(b.toLowerCase()) && !eigen.some((e) => b.toLowerCase().includes(e))) return b.trim();
  const zeilen = t.split(/\r?\n/).map((z) => z.trim()).filter(Boolean).slice(0, 30);
  for (const z of zeilen) {
    if (!FIRMA.test(z) || z.length > 80) continue;
    if (eigen.some((e) => z.toLowerCase().includes(e))) continue;
    if (/rechnung an|lieferadresse|empfänger|kunde|bill to|ship to/i.test(z)) continue;
    // nur den Namen bis einschließlich Rechtsform, ohne Straße dahinter
    const m = new RegExp(`^(.*?${FIRMA.source})`).exec(z);
    return (m?.[1] ?? z).replace(/[,;·|].*$/, "").trim().slice(0, 60);
  }
  return null;
}

// ---- Entgeltabschluss der Bank ----------------------------------------------------------------------------------

const ENTGELT = /(entgeltabschluss|rechnungsabschluss|abrechnung (der )?entgelte|entgelte (für|vom|im)|entgeltaufstellung|kontoführungsentgelt|abschluss(rechnung)? per)/i;

/** Seite des Kontoauszugs mit dem Entgeltabschluss (0-basiert) – null, wenn keine. */
export function entgeltSeite(seiten: string[]): number | null {
  const i = seiten.findIndex((s) => ENTGELT.test(s) && /\d,\d{2}/.test(s));
  return i >= 0 ? i : null;
}

const zahl = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const iso = (d: string) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{2,4})$/.exec(d);
  return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}` : null;
};

/** Betrag, Abschlussdatum und Zeitraum aus der Entgelt-Seite. */
export function entgeltAusText(text: string): { betrag: number; datum: string | null; zeitraum: string | null; bank: string | null } | null {
  if (!ENTGELT.test(text)) return null;
  const t = text.replace(/ /g, " ");
  const summe = /(summe(\s+der)?\s+entgelte|entgelte\s+gesamt|gesamtbetrag|summe|abschlussbetrag|belastung|zu\s+lasten)[^\d\n-]{0,40}(-?\s?\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(t);
  const alle = [...t.matchAll(/(-?\s?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR|€)?\s*[-S]?(?=\s|$)/g)].map((m) => zahl(m[1].replace(/\s/g, "")));
  const betrag = summe ? Math.abs(zahl(summe[3].replace(/\s/g, ""))) : alle.length ? Math.abs(alle[alle.length - 1]) : null;
  if (betrag === null || !(betrag > 0)) return null;
  const zr = /(\d{2}\.\d{2}\.\d{2,4})\s*(?:-|–|bis)\s*(\d{2}\.\d{2}\.\d{2,4})/.exec(t);
  const per = /(?:abschluss|per|zum|stichtag)\s*(\d{2}\.\d{2}\.\d{2,4})/i.exec(t);
  const datum = iso(per?.[1] ?? zr?.[2] ?? /(\d{2}\.\d{2}\.\d{4})/.exec(t)?.[1] ?? "");
  const bank = /\b((?:Sparkasse|Volksbank|Raiffeisenbank|Kreissparkasse|Stadtsparkasse)(?:[ \t-]+[A-ZÄÖÜ][\wäöüß-]*){0,3}|Commerzbank|Deutsche Bank|Postbank|HypoVereinsbank|Unicredit|DKB|ING|N26|Kontist|Qonto|Fyrst|Penta|Targobank|Santander|Consorsbank|Comdirect)\b/i.exec(t)?.[1]?.trim() ?? null;
  return { betrag: Math.round(betrag * 100) / 100, datum, zeitraum: zr ? `${zr[1]}–${zr[2]}` : null, bank };
}
