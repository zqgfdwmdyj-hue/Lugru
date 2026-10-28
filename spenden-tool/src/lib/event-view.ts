import "server-only";
import { cache } from "react";
import { isPlaceholderName } from "@/lib/layout";
import { categoryHint, isMultiUnit, sortIssues, comparability, type Comparability, isDrink, isSecondHand, itemIssues, type Issue, priceState, type PriceState } from "@/lib/price-logic";
import { perPiece, suggestDonationPrice, suggestPackPrice } from "@/lib/pricing";
import { extraPhotos, latestPriceChecks, loadEvent, loadEventItems } from "@/lib/service";
import { backsideCandidates } from "@/lib/backside";

/**
 * Eine Verteilung mit allem, was die Reiter Produkte, Prüfen und Ausgabe brauchen – pro Anfrage nur einmal geladen
 * (Layout und Seite teilen sich das Ergebnis).
 */
export const loadEventView = cache(async (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const event = await loadEvent(id);
  if (!event) return null;
  const items = await loadEventItems(id);
  const [checks, extras] = await Promise.all([latestPriceChecks(items.map((r) => r.product.id)), extraPhotos(items.map((r) => r.product.id))]);
  const rows = items.map((r) => {
    const state = priceState(r.item, r.product.imageFileId, r.photo);
    const check = checks.get(r.product.id);
    const priced = check?.status === "done" && check.mode !== "erkennen" && check.lowestPrice !== null;
    const compare: Comparability | null = priced ? comparability(r.product.variant, check, isMultiUnit(r.item.unit) ? r.item.unitCount : null) : null;
    const unnamed = isPlaceholderName(r.product.name);
    // Unsicherer Preisvergleich ist nur ein Thema, solange der Preis von der KI stammt und niemand ihn bestätigt hat –
    // oder noch gar kein Preis da ist und der KI-Vorschlag übernommen werden könnte.
    // Andere Packungsgröße als im Handel zeigen wir immer – die Empfehlung bezieht sich womöglich auf eine andere Einheit.
    const compareMatters = !!compare && (compare.level === "abweichend" || (r.item.priceSource === "ki" && !r.item.priceConfirmed) || r.item.price === null);
    const aiCategory = check?.status === "done" ? check.recognizedCategory : null;
    const issues: Issue[] = itemIssues({ unnamed, product: r.product, item: r.item, state, compare: compareMatters ? compare : null, aiCategory, multiple: check?.status === "done" && check.multipleProducts });
    const catHint = unnamed ? null : categoryHint(r.product, aiCategory);
    // KI-Vorschlag, der übernommen werden kann (nur ohne Preis und ohne Preis im Foto) – aus dem günstigsten
    // Angebot für Neuware, nie aus B-Ware/Gebrauchtem.
    // Stückpreis aus dem günstigsten Angebot (Kasten/Sixpack ÷ Flaschen) – nie der Liter- oder Kilopreis.
    const fresh = priced ? check.offers.filter((o) => !isSecondHand(o.title, o.shop)).sort((a, b) => perPiece(a) - perPiece(b)) : [];
    const piece = fresh.length ? perPiece(fresh[0]) : null;
    // Abgabe: Einzelstück 1, Packung/Karton mit Stückzahl, sonst wie im Angebot.
    // Abgabe: Einzelstück 1, Packung/Karton/Kasten/Tray/Palette mit Stückzahl (ohne Angabe: wie im Angebot, z. B. Kasten 20).
    const abgabe = isMultiUnit(r.item.unit) ? (r.item.unitCount ?? fresh[0]?.count ?? 1) : r.item.unit === "stueck" ? 1 : (fresh[0]?.count ?? 1);
    const freshSuggestion = piece !== null ? suggestDonationPrice(piece * abgabe) : null;
    const suggestion = priced && freshSuggestion !== null && !state.printed ? freshSuggestion : null;
    // Ganze Packung: 20 % vom Handelspreis (Getränke: normaler Anteil)
    const drink = isDrink(r.product);
    const packSuggestion = suggestPackPrice(piece, r.item.packCount, drink);
    return { ...r, state, check, compare, unnamed, issues, suggestion, packSuggestion, drink, catHint, backPhotos: extras.get(r.product.id) ?? [] };
  });
  // Vorder- und Rückseite desselben Produkts als zwei Produkte? → Vorschlag zum Zusammenführen (nie automatisch).
  const pairs = backsideCandidates(
    rows.map((r) => ({ itemId: r.item.id, productId: r.product.id, name: r.product.name, variant: r.product.variant, side: r.check?.recognizedSide ?? null, distinctFrom: r.product.distinctFrom, hasPhoto: !!r.product.imageFileId })),
  );
  for (const p of pairs) {
    for (const id of [p.front, p.back]) {
      const row = rows.find((r) => r.item.id === id);
      if (row) row.issues.unshift({ key: "rueckseite", label: "Mögliche Rückseite", level: "pruefen" });
    }
  }
  // Wichtigste Hinweise zuerst (Preis/Konflikt vor Prüfen vor Optionalem).
  for (const r of rows) r.issues = sortIssues(r.issues);
  const busy = [...checks.values()].some((c) => c.status === "pending" || c.status === "running") || rows.some((r) => r.state.photo === "wird-gelesen");
  return { event, rows, busy, pairs };
});

export type EventView = NonNullable<Awaited<ReturnType<typeof loadEventView>>>;
export type EventRow = EventView["rows"][number];
export type { PriceState };

/** Kurzer Text zur Herkunft des Preises. */
export function sourceLabel(r: EventRow): string {
  if (r.item.price === null) return "";
  const src = r.item.priceSource === "foto" ? "aus dem Foto" : r.item.priceSource === "ki" ? "KI-Vorschlag" : r.item.priceSource === "vorlage" ? "von früher" : r.item.priceSource === "manuell" ? "eingetragen" : "";
  return r.item.priceConfirmed ? (src ? `${src} · bestätigt` : "bestätigt") : `${src || "Herkunft unbekannt"} · unbestätigt`;
}
