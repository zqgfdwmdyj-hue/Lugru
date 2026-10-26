import { isPlaceholderName } from "@/lib/layout";
import { parseSize } from "@/lib/price-logic";

// Vorder- und Rückseite desselben Produkts erkennen: Pro Foto entsteht beim Hochladen zunächst ein Produkt. Zeigen zwei
// Fotos einer Verteilung offensichtlich dasselbe Produkt (gleicher oder enthaltener Name, keine abweichende Größe),
// schlägt „Prüfen“ vor, sie zusammenzuführen – die Rückseite wird dann nur noch Infofoto. Nie automatisch.

/** „Funny-frisch Jumpys Paprika“ → ["funny", "frisch", "jumpys", "paprika"] */
export function nameTokens(name: string): string[] {
  return name
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2);
}

export type SideInput = { itemId: string; productId: string; name: string; variant: string | null; side?: string | null; distinctFrom?: string[] | null; hasPhoto: boolean };
export type BacksidePair = { front: string; back: string; reason: string };

/** Sind das wahrscheinlich zwei Fotos desselben Produkts? Gibt die Begründung zurück, sonst null. */
export function sameProduct(a: { name: string; variant: string | null }, b: { name: string; variant: string | null }): string | null {
  if (isPlaceholderName(a.name) || isPlaceholderName(b.name)) return null;
  // Unterschiedliche Größen sind unterschiedliche Produkte (z. B. Tomaten 2 kg und 5 kg).
  const sa = parseSize(a.variant);
  const sb = parseSize(b.variant);
  if (sa && sb && (sa.base !== sb.base || Math.abs(sa.total - sb.total) / Math.max(sa.total, sb.total) > 0.1)) return null;
  if (!sa && !sb && a.variant && b.variant && nameTokens(a.variant).join(" ") !== nameTokens(b.variant).join(" ")) return null;
  const ta = new Set(nameTokens(a.name));
  const tb = new Set(nameTokens(b.name));
  if (!ta.size || !tb.size) return null;
  const common = [...ta].filter((t) => tb.has(t)).length;
  if (common === ta.size && common === tb.size) return "gleicher Name";
  // Ein Name ist ganz im anderen enthalten (Rückseite oft ohne Sorte) – mindestens zwei gemeinsame Wörter.
  if (common === Math.min(ta.size, tb.size) && common >= 2) return "Name enthalten";
  return null;
}

/**
 * Paare aus Vorder- und Rückseite in einer Verteilung. Jedes Produkt höchstens einmal; „Sind verschiedene Produkte“
 * (distinctFrom) wird beachtet. Vorderseite: laut KI „vorne“, sonst das Foto mit mehr Namensangaben, sonst das frühere.
 */
export function backsideCandidates(rows: SideInput[]): BacksidePair[] {
  const out: BacksidePair[] = [];
  const used = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (used.has(a.productId) || !a.hasPhoto) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (used.has(b.productId) || !b.hasPhoto || a.productId === b.productId) continue;
      if (a.distinctFrom?.includes(b.productId) || b.distinctFrom?.includes(a.productId)) continue;
      const reason = sameProduct(a, b);
      if (!reason) continue;
      let [front, back] = [a, b];
      if (a.side === "hinten" && b.side !== "hinten") [front, back] = [b, a];
      else if (!(b.side === "hinten" && a.side !== "hinten") && nameTokens(b.name).length > nameTokens(a.name).length) [front, back] = [b, a];
      out.push({ front: front.itemId, back: back.itemId, reason: back.side === "hinten" ? `${reason}, KI: Rückseite` : reason });
      used.add(a.productId);
      used.add(b.productId);
      break;
    }
  }
  return out;
}
