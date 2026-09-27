import type { Condition, Settings } from '../types';
import { roundCents } from './money';

/**
 * eBay-Verkaufsprovision für gewerbliche Verkäufer auf ebay.de.
 * Stand 2026-09-01, inklusive der Umstellung vom 1. Juli 2026.
 * Quelle: https://www.ebay.de/help/selling/fees-credits-invoices/gebuhren-fur-gewerbliche-verkaufer?id=4809
 *
 * Die Sätze sind über keine eBay-API abrufbar (getListingFees liefert nur
 * Einstellgebühren; die Provision entsteht erst beim Verkauf) — deshalb hier
 * als gepflegte Tabelle, versioniert und mit Tests belegt.
 */
export interface FeeRate {
  percent: number;
  /**
   * Ermäßigter Satz für „Neu: Sonstige", „Gebraucht …", Refurbished und
   * „Vom Verkäufer generalüberholt".
   *
   * Fehlt bewusst bei allen gestaffelten Kategorien: eBays Tarifseite führt die
   * Spalte „Verkaufsprovision für Artikel mit bestimmten Artikelzuständen" nur
   * in den Tabellen mit Festsatz (Technik, Business/Büro, Garten/Heimwerker,
   * Musikinstrumente, Standardkategorien). Für Kleidung, Medien, Auto & Motorrad,
   * Uhren, Sammeln und Spielzeug gibt es dort schlicht keinen ermäßigten Satz —
   * dort gilt auch für Gebrauchtware der volle Prozentsatz. Geprüft am 2026-09-01.
   */
  reducedPercent?: number;
  /** Ab diesem Betrag greift `tierPercent` für den übersteigenden Anteil. */
  tierLimit?: number;
  tierPercent?: number;
}

export const DEFAULT_FEE_PERCENT = 14;
export const FEE_FIXED = 0.35;
export const FEE_FIXED_ABOVE = 0.45;
/**
 * eBay: „EUR 0,35 pro Bestellung (EUR 0,45 pro Bestellung für Bestellungen
 * **über** EUR 10,00)". „Über" ist echt größer — bei genau 10,00 € gilt noch
 * der kleine Betrag, deshalb `>` und nicht `>=` in `estimateFee`.
 */
export const FEE_FIXED_THRESHOLD = 10;

/** Artikelzustände, für die eBay den ermäßigten Satz ansetzt. */
const REDUCED_CONDITIONS: Condition[] = ['NEW_OTHER', 'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE'];

function spread(ids: string[], rate: FeeRate): Record<string, FeeRate> {
  return Object.fromEntries(ids.map((id) => [id, rate]));
}

export const CATEGORY_FEES: Record<string, FeeRate> = {
  // Technik-Geräte
  ...spread(
    ['58058', '1245', '171833', '625', '18871', '3323', '15032', '96991', '20710',
     '139971', '11205', '117045', '293', '260783', '260774', '260773'],
    { percent: 7, reducedPercent: 5 }
  ),
  // Technik-Zubehör
  ...spread(
    ['171961', '163769', '9394', '48446', '182094', '15200', '31530', '78997',
     '30090', '176970', '3676', '14961', '54968', '56169'],
    { percent: 12, reducedPercent: 5 }
  ),
  // Standardgebühren
  ...spread(
    ['12576', '9815', '888', '3252', '99', '2984', '14339', '14308', '1281', '11700'],
    { percent: 14, reducedPercent: 5 }
  ),
  ...spread(['159912', '3187'], { percent: 13, reducedPercent: 5 }),
  ...spread(['619'], { percent: 11, reducedPercent: 5 }),
  // Gestaffelt
  ...spread(
    ['11450', '131090', '11232', '11233', '1305', '1249', '267', '353', '26395', '260', '1', '220'],
    { percent: 12, tierLimit: 990, tierPercent: 3 }
  ),
  ...spread(['22128', '8662', '2536', '6747', '262215', '179496'],
    { percent: 11, tierLimit: 990, tierPercent: 3 }),
  ...spread(['179679', '179681', '179680', '11116'],
    { percent: 6.5, tierLimit: 990, tierPercent: 3 }),
  // Shop-abhängige Kategorien: hinterlegt ist die konservativere Variante „ohne Shop".
  ...spread(['171101', '174121', '169423', '258037', '139835', '262101', '262098'],
    { percent: 6.5, tierLimit: 990, tierPercent: 3 }),
  ...spread(['281'], { percent: 16, tierLimit: 990, tierPercent: 3 }),
  ...spread(['260324'], { percent: 14, tierLimit: 990, tierPercent: 3 }),
  ...spread(['260325', '10682', '258031', '260328'],
    { percent: 11, tierLimit: 990, tierPercent: 3 }),
  // Sneaker sind zusätzlich preisabhängig — hier vereinfacht auf den Satz unter EUR 100.
  ...spread(['15709', '95672'], { percent: 12 }),
  // NFTs
  ...spread(['262050', '262051', '262052', '262053', '262054', '262055', '262056'],
    { percent: 5 }),
};

export interface ResolvedFee {
  percent: number;
  tierLimit?: number;
  tierPercent?: number;
  /** false = kein Satz hinterlegt, es greift der Standardsatz. */
  matched: boolean;
}

export function resolveFeeRate(
  categoryId: string | undefined,
  condition: Condition,
  settings: Settings
): ResolvedFee {
  // Ein eigener Satz ist eine einzelne Zahl und gilt für alle Artikelzustände.
  const own = categoryId ? settings.feeCategoryRates?.[categoryId] : undefined;
  if (typeof own === 'number' && Number.isFinite(own)) return { percent: own, matched: true };

  const rate = categoryId ? CATEGORY_FEES[categoryId] : undefined;
  if (!rate) return { percent: settings.feePercent ?? DEFAULT_FEE_PERCENT, matched: false };

  if (REDUCED_CONDITIONS.includes(condition) && rate.reducedPercent !== undefined) {
    return { percent: rate.reducedPercent, matched: true };
  }
  const resolved: ResolvedFee = { percent: rate.percent, matched: true };
  if (rate.tierLimit !== undefined) resolved.tierLimit = rate.tierLimit;
  if (rate.tierPercent !== undefined) resolved.tierPercent = rate.tierPercent;
  return resolved;
}

/**
 * Schätzt die Verkaufsprovision. eBay bemisst am Gesamtbetrag der Transaktion —
 * bei versandkostenfreiem Verkauf ist das der Artikelpreis, weil der Käufer
 * nichts obendrauf zahlt.
 *
 * TODO(versandkosten): Diese Zeile ist eine projektweite Annahme über die
 * Verkaufsform. Sobald Versand extra berechnet wird, muss der **Versanderlös**
 * in die Bemessungsgrundlage — sonst schätzt jeder Aufruf (Anlegen-Formular,
 * Vorschau, Verlauf, Artikelseite) zu niedrig. Die eigenen Versandkosten aus
 * den Einstellungen gehören dort ausdrücklich **nicht** hinein; die sind ein
 * Kostenposten in `computeProfit`.
 */
export function estimateFee(price: number, fee: ResolvedFee, settings: Settings): number {
  const basis = price;
  const variable =
    fee.tierLimit !== undefined && fee.tierPercent !== undefined
      ? (Math.min(basis, fee.tierLimit) * fee.percent) / 100 +
        (Math.max(0, basis - fee.tierLimit) * fee.tierPercent) / 100
      : (basis * fee.percent) / 100;

  const threshold = settings.feeFixedThreshold ?? FEE_FIXED_THRESHOLD;
  const fixed = basis > threshold ? (settings.feeFixedAbove ?? FEE_FIXED_ABOVE) : (settings.feeFixed ?? FEE_FIXED);
  return roundCents(variable + fixed);
}
