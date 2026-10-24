import "server-only";
import { cache } from "react";
import { isPlaceholderName } from "@/lib/layout";
import { comparability, type Comparability, itemIssues, type Issue, priceState, type PriceState } from "@/lib/price-logic";
import { latestPriceChecks, loadEvent, loadEventItems } from "@/lib/service";

/**
 * Eine Verteilung mit allem, was die Reiter Produkte, Prüfen und Ausgabe brauchen – pro Anfrage nur einmal geladen
 * (Layout und Seite teilen sich das Ergebnis).
 */
export const loadEventView = cache(async (id: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const event = await loadEvent(id);
  if (!event) return null;
  const items = await loadEventItems(id);
  const checks = await latestPriceChecks(items.map((r) => r.product.id));
  const rows = items.map((r) => {
    const state = priceState(r.item, r.product.imageFileId, r.photo);
    const check = checks.get(r.product.id);
    const priced = check?.status === "done" && check.mode !== "erkennen" && check.lowestPrice !== null;
    const compare: Comparability | null = priced ? comparability(r.product.variant, check) : null;
    const unnamed = isPlaceholderName(r.product.name);
    // Unsicherer Preisvergleich ist nur ein Thema, solange der Preis von der KI stammt und niemand ihn bestätigt hat –
    // oder noch gar kein Preis da ist und der KI-Vorschlag übernommen werden könnte.
    // Andere Packungsgröße als im Handel zeigen wir immer – die Empfehlung bezieht sich womöglich auf eine andere Einheit.
    const compareMatters = !!compare && (compare.level === "abweichend" || (r.item.priceSource === "ki" && !r.item.priceConfirmed) || r.item.price === null);
    const issues: Issue[] = itemIssues({ unnamed, product: r.product, item: r.item, state, compare: compareMatters ? compare : null });
    // KI-Vorschlag, der übernommen werden kann (nur ohne Preis und ohne Preis im Foto)
    const suggestion = priced && check.suggestedPrice !== null && !state.printed ? check.suggestedPrice : null;
    return { ...r, state, check, compare, unnamed, issues, suggestion };
  });
  const busy = [...checks.values()].some((c) => c.status === "pending" || c.status === "running") || rows.some((r) => r.state.photo === "wird-gelesen");
  return { event, rows, busy };
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
