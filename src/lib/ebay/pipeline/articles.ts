import type { ListingAttempt, Settings } from '../types';
import { estimateFee, resolveFeeRate } from './fees';
import { roundCents } from './money';
import { computeProfit } from './profit';
import { parseSource } from './source';

/**
 * Ein Artikel ist keine eigene Tabelle, sondern eine Gruppierung über den
 * Artikelschlüssel: Außer seiner Identität hat er nichts zu speichern, was
 * nicht schon an den Versuchen hängt.
 */
export interface Article {
  key: string;
  ean?: string;
  epid?: string;
  title?: string;
  imageUrl?: string;
  /** Summe der gekauften Einheiten über alle Einkäufe. */
  purchasedUnits: number;
  /** Summe aus Einheiten × Stückpreis. */
  purchaseValue: number;
  /** Nur über Versuche mit Einkaufspreis; sonst undefined. */
  avgPurchasePrice?: number;
  merchants: string[];
  /**
   * Ø Gewinn **je Stück** über die Versuche mit Einkaufspreis — nach
   * Umsatzsteuer, Provision und Versand. Gewichtet nach gekauften Einheiten,
   * genau wie `avgPurchasePrice`: ein Einkauf mit 100 Stück prägt den Schnitt
   * stärker als einer mit einem Stück. So passen die beiden Durchschnitte in
   * einer Zeile zusammen, und Ø Gewinn × gekaufte Einheiten ist der Gewinn,
   * der im Bestand steckt.
   *
   * Achtung: gerechnet wird mit den **aktuell gültigen** Einstellungen, nicht
   * mit denen zum Zeitpunkt des Verkaufs. Ändert sich der USt-Satz, ein
   * Gebührensatz oder die Versandpauschale, verschieben sich rückwirkend auch
   * die Werte alter Versuche. Ein Schnappschuss je Versuch wäre die Alternative
   * — dafür müssten Gebühr, USt und Versand beim Anlegen mitgespeichert werden.
   */
  avgProfit?: number;
  listingCount: number;
  publishedCount: number;
  lastPrice?: number;
  firstAt: string;
  lastAt: string;
}

/**
 * Einmal beim Anlegen gesetzt und danach unveränderlich: ein
 * Katalogtreffer-Wechsel ändert die ePID, der Artikel darf davon
 * nicht nachträglich umziehen.
 */
export function articleKey(input: { ean?: string; epid?: string; id: number }): string {
  const ean = (input.ean ?? '').trim();
  if (ean !== '') return `ean:${ean}`;
  const epid = (input.epid ?? '').trim();
  if (epid !== '') return `epid:${epid}`;
  return `attempt:${input.id}`;
}

/** Gespeicherter Schlüssel, sonst abgeleitet — so erscheint auch Altbestand in der Liste. */
export function keyOf(attempt: ListingAttempt): string {
  return attempt.articleKey ?? articleKey(attempt);
}

/**
 * Die Einstellungen kommen als Parameter statt aus der Datenbank — so bleibt
 * die Funktion rein und testbar, kann aber den echten Gewinn ausweisen.
 */
export function groupArticles(attempts: ListingAttempt[], settings: Settings): Article[] {
  const byKey = new Map<string, ListingAttempt[]>();
  for (const a of attempts) {
    const key = keyOf(a);
    const list = byKey.get(key);
    if (list) list.push(a);
    else byKey.set(key, [a]);
  }

  const articles: Article[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const newest = sorted[sorted.length - 1];

    let purchasedUnits = 0;
    let purchaseValue = 0;
    let pricedUnits = 0;
    let profitSum = 0;
    let profitUnits = 0;
    const merchants: string[] = [];

    for (const a of sorted) {
      const units = a.purchasedUnits ?? 0;
      purchasedUnits += units;
      if (a.purchasePrice !== undefined) {
        // Ohne Stückzahl zählt der Einkauf als eine Einheit — sonst fiele der Preis unter den Tisch.
        const effective = units > 0 ? units : 1;
        purchaseValue += effective * a.purchasePrice;
        pricedUnits += effective;
        const rate = resolveFeeRate(a.categoryId, a.condition, settings);
        const profit = computeProfit({
          salePrice: a.price,
          purchasePrice: a.purchasePrice,
          fee: estimateFee(a.price, rate, settings),
          shipping: settings.shippingAssumption,
          vatPercentage: settings.vatPercentage,
        });
        if (profit) {
          profitSum += profit.profit * effective;
          profitUnits += effective;
        }
      }
      // Groß-/Kleinschreibung darf keine Dubletten erzeugen („METRO" vs. „Metro");
      // die erste Schreibweise gewinnt.
      const source = a.purchaseSource ? parseSource(a.purchaseSource) : null;
      if (source && !merchants.some((m) => m.toLowerCase() === source.merchant.toLowerCase())) {
        merchants.push(source.merchant);
      }
    }

    // Ein Rückwärtslauf statt je Feld eine Kopie der Liste umzudrehen.
    let title: string | undefined;
    let imageUrl: string | undefined;
    for (let i = sorted.length - 1; i >= 0 && (title === undefined || imageUrl === undefined); i--) {
      title ??= sorted[i].title;
      imageUrl ??= sorted[i].imageUrls?.[0];
    }

    articles.push({
      key,
      ean: sorted.find((a) => a.ean)?.ean,
      epid: newest.epid,
      title,
      imageUrl,
      purchasedUnits,
      purchaseValue: roundCents(purchaseValue),
      avgPurchasePrice: pricedUnits > 0 ? roundCents(purchaseValue / pricedUnits) : undefined,
      merchants,
      avgProfit: profitUnits > 0 ? roundCents(profitSum / profitUnits) : undefined,
      listingCount: sorted.length,
      publishedCount: sorted.filter((a) => a.status === 'published').length,
      lastPrice: newest.price,
      firstAt: sorted[0].createdAt,
      lastAt: newest.createdAt,
    });
  }

  return articles.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
