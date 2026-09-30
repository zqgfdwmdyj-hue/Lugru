import "server-only";
import { parseEcb } from "@/lib/suppliers/scan";

// Tageskurse der EZB (kostenlos, ohne Schlüssel). Ergebnis: EUR je Einheit der Fremdwährung.

const URL_ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
let cache: { at: number; rates: Record<string, number> } | null = null;

export async function eurRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < 6 * 3600_000) return cache.rates;
  try {
    const res = await fetch(process.env.ECB_RATES_URL || URL_ECB, { signal: AbortSignal.timeout(10_000) });
    const rates = parseEcb(await res.text());
    if (rates.USD) cache = { at: Date.now(), rates };
    return rates;
  } catch {
    return cache?.rates ?? { EUR: 1 };
  }
}
