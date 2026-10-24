import type { PriceBox } from "@/db/schema";
import { hasSeveralPrices, plausibleBox, type PrintedInfo } from "@/lib/printed-price";

// Eine gemeinsame Preislogik für Produktliste, Prüfen, Collage, Aushang, Messenger und Social Media.
// Grundsatz: Ausgegeben wird immer die gespeicherte Spendenempfehlung. Ein im Foto erkannter Preis oder ein
// KI-Vorschlag überstimmt sie nie still – Abweichungen erscheinen unter „Prüfen“, bis jemand entscheidet.
// Ohne Server- und Datenbankabhängigkeiten, damit es im Browser läuft und testbar ist.

/** Neutrale Kategorie für frisch hochgeladene Fotos – die KI darf sie ersetzen, bestätigte Kategorien nicht. */
export const UNSORTED_CATEGORY = "Noch zuordnen";

// ---------- Abgabeeinheit ----------

export const UNITS = {
  stueck: { label: "Einzelstück", hint: "z. B. ein Riegel, eine Dose" },
  packung: { label: "Mehrfachpackung", hint: "z. B. 6er-Pack" },
  karton: { label: "Karton", hint: "ganzer Karton / ganze Kiste" },
} as const;
export type Unit = keyof typeof UNITS;
export const isUnit = (v: unknown): v is Unit => typeof v === "string" && v in UNITS;

export type UnitInfo = { unit: string | null; unitCount: number | null; priceNote?: string | null };

/** „Einzelstück“, „6er-Pack“, „Karton (24 Stück)“ – leer, wenn keine Einheit festgelegt ist. */
export function unitLabel(unit: string | null | undefined, count: number | null | undefined): string {
  const n = count && count > 1 ? count : null;
  if (unit === "stueck") return "Einzelstück";
  if (unit === "packung") return n ? `${n}er-Pack` : "Packung";
  if (unit === "karton") return n ? `Karton (${n} Stück)` : "Karton";
  return "";
}

/**
 * Was vor dem Preis steht: der freie Zusatz („je 6er Pack“), sonst aus der Abgabeeinheit („je“, „6er-Pack“,
 * „Karton (24 St.)“). So steht es gleich in Collage, Aushang, Messenger und Social Media.
 */
export function pricePrefix(i: UnitInfo): string {
  const note = i.priceNote?.trim();
  if (note) return note;
  const n = i.unitCount && i.unitCount > 1 ? i.unitCount : null;
  if (i.unit === "stueck") return "je";
  if (i.unit === "packung") return n ? `${n}er-Pack` : "Packung";
  if (i.unit === "karton") return n ? `Karton (${n} St.)` : "Karton";
  return "";
}

/** Abgabeeinheit aus bisherigem Zusatz oder Variante raten – nur als Vorschlag, wird nie still gespeichert. */
export function guessUnit(priceNote: string | null | undefined, variant: string | null | undefined): { unit: Unit; count: number | null } | null {
  const t = `${priceNote ?? ""} ${variant ?? ""}`.toLowerCase();
  if (!t.trim()) return null;
  const pack = /(\d{1,3})\s*er[\s-]*(?:pack|packung|pck|set|tray)?\b/.exec(t) ?? /(\d{1,3})\s*[x×]\s*\d/.exec(t);
  if (/karton|kiste|\btray\b|palette/.test(t)) {
    const n = /(\d{1,3})\s*(?:stück|st\.?|dosen|flaschen|packungen|riegel)\b/.exec(t) ?? pack;
    return { unit: "karton", count: n ? Number(n[1]) : null };
  }
  if (pack && Number(pack[1]) > 1) return { unit: "packung", count: Number(pack[1]) };
  if (/einzel|\bje\b|stück|\bst\.?\b/.test(t)) return { unit: "stueck", count: null };
  return null;
}

// ---------- Packungsgrößen vergleichen ----------

/** Gesamtmenge aus „240 g“, „1,5 l“, „6 x 125 g“, „5×23g“ – in g bzw. ml. */
export function parseSize(text: string | null | undefined): { total: number; base: "g" | "ml" } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, ".");
  const unit = (u: string) => (u === "kg" ? [1000, "g"] : u === "g" || u === "gr" ? [1, "g"] : u === "l" ? [1000, "ml"] : u === "cl" ? [10, "ml"] : [1, "ml"]) as [number, "g" | "ml"];
  const multi = /(\d{1,3})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|l)(?![a-zäöü])/.exec(t);
  if (multi) {
    const [f, base] = unit(multi[3]);
    return { total: Number(multi[1]) * Number(multi[2]) * f, base };
  }
  const single = /(\d+(?:\.\d+)?)\s*(kg|gr|g|ml|cl|l)(?![a-zäöü])/.exec(t);
  if (!single) return null;
  const [f, base] = unit(single[2]);
  const total = Number(single[1]) * f;
  return total > 0 ? { total, base } : null;
}

const fmtSize = (s: { total: number; base: string }) => (s.total >= 1000 ? `${String(+(s.total / 1000).toFixed(2)).replace(".", ",")} ${s.base === "g" ? "kg" : "l"}` : `${Math.round(s.total)} ${s.base}`);

/** Hinweise der KI, dass das Ergebnis nicht genau passt. */
const UNSURE = /unbekannt|unsicher|alternativ|ähnlich|nicht (?:exakt|genau|eindeutig)|vermutlich|nächst|nicht gefunden|keine genaue|möglicherweise|evtl\.|eventuell|ungefähr|nicht sicher|andere (?:größe|packung)/i;

export type Comparability = { level: "passt" | "abweichend" | "unklar"; reason: string };

/**
 * Passt der Handelspreis bzw. KI-Vorschlag zur eigenen Packung? Nur „passt“ gilt als vergleichbar.
 * Beispiel: eigenes Produkt 240 g, Angebot 77 g → „abweichend“.
 */
export function comparability(ownVariant: string | null | undefined, check: { recognizedVariant?: string | null; summary?: string | null; offers?: { title: string }[] | null }): Comparability {
  const own = parseSize(ownVariant);
  const offerTitle = check.offers?.[0]?.title ?? "";
  const other = parseSize(offerTitle) ?? parseSize(check.recognizedVariant);
  const unsure = check.summary ? UNSURE.exec(check.summary) : null;
  if (own && other && own.base === other.base) {
    const ratio = other.total / own.total;
    if (ratio < 0.9 || ratio > 1.1) return { level: "abweichend", reason: `Handel ${fmtSize(other)}, eigenes Produkt ${fmtSize(own)}` };
    if (unsure) return { level: "unklar", reason: `KI-Hinweis: „${sentenceAround(check.summary!, unsure.index)}“` };
    return { level: "passt", reason: `gleiche Größe (${fmtSize(own)})` };
  }
  if (unsure) return { level: "unklar", reason: `KI-Hinweis: „${sentenceAround(check.summary!, unsure.index)}“` };
  if (!own && !other) return { level: "unklar", reason: "Packungsgröße unbekannt" };
  if (!own) return { level: "unklar", reason: `Eigene Packungsgröße fehlt (Handel: ${fmtSize(other!)})` };
  return { level: "unklar", reason: `Größe im Handel unbekannt (eigenes Produkt: ${fmtSize(own)})` };
}

function sentenceAround(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf(".", at - 1) + 1, 0);
  const endDot = text.indexOf(".", at);
  const s = text.slice(start, endDot < 0 ? text.length : endDot + 1).trim();
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

// ---------- MHD ----------

const MHD_CATEGORIES = new Set(["Lebensmittel", "Getränke inkl. Pfand", "Babyprodukte"]);

/** Braucht das Produkt ein MHD? Festgelegt pro Produkt, sonst nach Kategorie. „Noch zuordnen“ zählt noch nicht. */
export function mhdRelevant(p: { category: string; mhdMode?: string | null }): boolean {
  if (p.mhdMode === "ja") return true;
  if (p.mhdMode === "nein") return false;
  return MHD_CATEGORIES.has(p.category);
}

// ---------- Ausgegebener Preis und Preis im Foto ----------

export type PhotoReading = { status: string | null; price: number | null; text: string | null; box: unknown } | null;
export type PriceInput = { price: number | null; priceSource?: string | null; priceConfirmed?: boolean | null; priceOverPhotoFileId?: string | null };

export type PriceState = {
  /** Dieser Preis erscheint in allen Ausgaben. */
  price: number | null;
  /** Im Foto erkannter Preis (oder null). */
  printed: PrintedInfo;
  photo: "keiner" | "wird-gelesen" | "gleich" | "mehrere" | "ohne-betrag" | "fehlt-eingetragen" | "abweichend" | "abweichend-geloest";
  /** Braucht eine Entscheidung (Foto und Angabe widersprechen sich). */
  conflict: boolean;
  /** Die Fotoerkennung ist wahrscheinlich falsch (z. B. „50 €“ statt „50 Cent“). */
  suspicious: boolean;
  /** Preis von einem Menschen eingetragen oder bestätigt. */
  confirmed: boolean;
  /**
   * Collage/Social Media: „drucken“ = Preis normal aufs Bild; „foto“ = steht schon richtig im Foto, nicht doppelt;
   * „aufkleber“ = eingetragenen Preis als Feld über den alten Preis im Foto setzen.
   */
  plan: "drucken" | "foto" | "aufkleber";
  /** Der alte Preis im Foto bleibt neben dem gedruckten sichtbar (Lage im Foto unbekannt). */
  oldVisible: boolean;
};

export function printedFrom(imageFileId: string | null | undefined, photo: PhotoReading): PrintedInfo {
  return imageFileId && photo?.text ? { price: photo.price, text: photo.text, box: (photo.box as PriceBox | null) ?? null } : null;
}

export function priceState(item: PriceInput, imageFileId: string | null | undefined, photo: PhotoReading): PriceState {
  const price = item.price;
  const confirmed = price !== null && !!item.priceConfirmed;
  const base: PriceState = { price, printed: null, photo: "keiner", conflict: false, suspicious: false, confirmed, plan: "drucken", oldVisible: false };
  if (imageFileId && photo?.status === "pending") return { ...base, photo: "wird-gelesen" };
  const printed = printedFrom(imageFileId, photo);
  if (!printed) return base;
  const suspicious = printed.price !== null && (printed.price >= 20 || (price !== null && price > 0 && (printed.price / price >= 8 || price / printed.price >= 8)));
  const s = { ...base, printed, suspicious };
  if (hasSeveralPrices(printed.text)) return { ...s, photo: "mehrere", plan: "foto" };
  if (printed.price === null) return { ...s, photo: "ohne-betrag", plan: "foto" };
  if (price === null) return { ...s, photo: "fehlt-eingetragen", conflict: true, plan: "foto" };
  if (Math.abs(printed.price - price) < 0.005) return { ...s, photo: "gleich", plan: "foto" };
  const resolved = !!imageFileId && item.priceOverPhotoFileId === imageFileId;
  const plan = plausibleBox(printed.box) ? "aufkleber" : "drucken";
  return { ...s, photo: resolved ? "abweichend-geloest" : "abweichend", conflict: !resolved, plan, oldVisible: plan === "drucken" };
}

// ---------- Prüfstatus einer Zeile ----------

export type Issue = { key: IssueKey; label: string; level: "fehlt" | "pruefen" };
export type IssueKey = "name" | "preis" | "konflikt" | "preis-unbestaetigt" | "ki-angaben" | "kategorie" | "mhd" | "foto" | "vergleich";

export const ISSUE_FILTERS: { key: IssueKey; label: string }[] = [
  { key: "konflikt", label: "Preiswiderspruch" },
  { key: "preis", label: "Ohne Preis" },
  { key: "name", label: "Ohne Namen" },
  { key: "preis-unbestaetigt", label: "Preis unbestätigt" },
  { key: "ki-angaben", label: "KI-Angaben prüfen" },
  { key: "vergleich", label: "Preisvergleich unsicher" },
  { key: "kategorie", label: "Kategorie zuordnen" },
  { key: "mhd", label: "MHD fehlt" },
  { key: "foto", label: "Ohne Foto" },
];

export function itemIssues(o: {
  unnamed: boolean;
  product: { category: string; mhdMode?: string | null; reviewNote?: string | null; imageFileId: string | null };
  item: { bestBefore: string | null; inCollage: boolean };
  state: PriceState;
  compare?: Comparability | null;
}): Issue[] {
  const out: Issue[] = [];
  if (o.unnamed) out.push({ key: "name", label: "Name fehlt", level: "fehlt" });
  if (o.state.conflict) out.push({ key: "konflikt", label: o.state.photo === "fehlt-eingetragen" ? "Preis nur im Foto" : "Preis ≠ Foto", level: "pruefen" });
  if (o.state.price === null && !o.state.conflict) out.push({ key: "preis", label: "Preis fehlt", level: "fehlt" });
  if (o.state.price !== null && !o.state.confirmed) out.push({ key: "preis-unbestaetigt", label: "Preis unbestätigt", level: "pruefen" });
  if (o.product.reviewNote && !o.unnamed) out.push({ key: "ki-angaben", label: "KI-Angaben prüfen", level: "pruefen" });
  if (o.compare && o.compare.level !== "passt") out.push({ key: "vergleich", label: o.compare.level === "abweichend" ? "Größe ≠ Handel" : "Vergleich unsicher", level: "pruefen" });
  if (o.product.category === UNSORTED_CATEGORY) out.push({ key: "kategorie", label: "Kategorie fehlt", level: "fehlt" });
  if (!o.item.bestBefore && mhdRelevant(o.product)) out.push({ key: "mhd", label: "MHD fehlt", level: "fehlt" });
  if (!o.product.imageFileId && o.item.inCollage) out.push({ key: "foto", label: "Foto fehlt", level: "fehlt" });
  return out;
}
