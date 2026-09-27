// Liest die Informationen aus, die in den SKUs aus Arbitrage One stecken.
//
// Bekannte Schemata:
//   A    SHOP_EK_VK_TTMON_ASIN            KAUFL_84.03_127.08_27SEP_B0TEST0004
//   B    SHOP_VK_TTMON_ASIN_EKBRUTTO      FLACO_57.36_16SEP_B0TEST0003_42.93
//   C    SHOP_TTMONJJ_ASIN_EKBRUTTO_VK    AMZFR_24SEP26_B0TEST0008_305.99_470.00
//   RET  RET_CODE_LPN_TTMONJJ_KANAL       RET_3_LPNHK100000002_16JUL25_FBA
//        ältere Retouren auch als A/B mit "RET" als Shop, z. B. RET_3.72_21NOV_B0TEST0007_0.10
//
// A und B enthalten kein Jahr. Das Jahr wird dann geschätzt (letztes Jahr, in dem das
// Datum nicht nach dem Stichtag liegt) und als geschätzt markiert.

export type SkuSchema = "A" | "B" | "C" | "RET" | "UNKNOWN";

export type ParsedSku = {
  schema: SkuSchema;
  supplierCode: string | null;
  asin: string | null;
  /** ISO-Datum (JJJJ-MM-TT) des Einkaufs bzw. der Retoure. */
  date: string | null;
  dateEstimated: boolean;
  costNet: number | null;
  costGross: number | null;
  targetPrice: number | null;
  ret: { code: string; lpn: string | null; channel: string | null } | null;
};

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, MRZ: 3, APR: 4, MAY: 5, MAI: 5, JUN: 6, JUL: 7,
  AUG: 8, SEP: 9, OCT: 10, OKT: 10, NOV: 11, DEC: 12, DEZ: 12,
};

const NUM = String.raw`\d+(?:\.\d+)?`;
const ASIN = String.raw`[A-Z0-9]{10}`;
const SHOP = String.raw`[A-Z0-9]+`;

const RE_A = new RegExp(`^(${SHOP})_(${NUM})_(${NUM})_(\\d{2}[A-Z]{3})_(${ASIN})$`, "i");
const RE_B = new RegExp(`^(${SHOP})_(${NUM})_(\\d{2}[A-Z]{3})_(${ASIN})_(${NUM})$`, "i");
const RE_C = new RegExp(`^(${SHOP})_(\\d{2}[A-Z]{3}\\d{2})_(${ASIN})_(${NUM})_(${NUM})$`, "i");
const RE_DATE_YY = /^(\d{2})([A-Z]{3})(\d{2})$/i;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function iso(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function validDay(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function month(token: string): number | null {
  return MONTHS[token.toUpperCase()] ?? null;
}

/** "24SEP26" → "2026-09-24" */
export function parseDateWithYear(token: string): string | null {
  const m = RE_DATE_YY.exec(token);
  if (!m) return null;
  const mo = month(m[2]);
  const d = Number(m[1]);
  const y = 2000 + Number(m[3]);
  if (!mo || !validDay(y, mo, d)) return null;
  return iso(y, mo, d);
}

/** "27SEP" ohne Jahr → spätestes Jahr, in dem das Datum nicht nach dem Stichtag liegt. */
export function estimateDateWithoutYear(token: string, reference: Date): string | null {
  const m = /^(\d{2})([A-Z]{3})$/i.exec(token);
  if (!m) return null;
  const mo = month(m[2]);
  const d = Number(m[1]);
  if (!mo) return null;
  const refIso = reference.toISOString().slice(0, 10);
  for (let y = reference.getUTCFullYear(); y >= reference.getUTCFullYear() - 5; y--) {
    if (!validDay(y, mo, d)) continue; // 29. Februar
    const candidate = iso(y, mo, d);
    if (candidate <= refIso) return candidate;
  }
  return null;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function parseLegacyReturn(s: string, reference: Date, vat: number): ParsedSku | null {
  const a = RE_A.exec(s);
  if (a) {
    const date = estimateDateWithoutYear(a[4], reference);
    return {
      ...empty("RET"),
      costNet: Number(a[2]),
      targetPrice: Number(a[3]),
      date,
      dateEstimated: date !== null,
      asin: a[5].toUpperCase(),
      ret: { code: "", lpn: null, channel: null },
    };
  }
  const b = RE_B.exec(s);
  if (b) {
    const gross = Number(b[5]);
    const date = estimateDateWithoutYear(b[3], reference);
    return {
      ...empty("RET"),
      targetPrice: Number(b[2]),
      date,
      dateEstimated: date !== null,
      asin: b[4].toUpperCase(),
      costGross: gross,
      costNet: round4(gross / (1 + vat)),
      ret: { code: "", lpn: null, channel: null },
    };
  }
  return null;
}

const empty = (schema: SkuSchema): ParsedSku => ({
  schema,
  supplierCode: null,
  asin: null,
  date: null,
  dateEstimated: false,
  costNet: null,
  costGross: null,
  targetPrice: null,
  ret: null,
});

export function parseSku(
  sku: string,
  opts: { reference: Date; vatRate?: number },
): ParsedSku {
  const s = sku.trim();
  const vat = opts.vatRate ?? 0.19;

  if (/^RET_/i.test(s)) {
    // Ältere Retouren-SKUs folgen Schema A oder B mit "RET" als Shop.
    const legacy = parseLegacyReturn(s, opts.reference, vat);
    if (legacy) return legacy;
    const parts = s.split("_");
    const out = empty("RET");
    const lpn = parts.find((p) => /^LPN/i.test(p)) ?? null;
    const dateIdx = parts.findIndex((p, i) => i > 0 && RE_DATE_YY.test(p));
    out.date = dateIdx > 0 ? parseDateWithYear(parts[dateIdx]) : null;
    out.ret = {
      code: parts[1] ?? "",
      lpn,
      channel: dateIdx > 0 && parts[dateIdx + 1] ? parts[dateIdx + 1] : null,
    };
    return out;
  }

  let m = RE_C.exec(s);
  if (m) {
    const gross = Number(m[4]);
    return {
      ...empty("C"),
      supplierCode: m[1].toUpperCase(),
      date: parseDateWithYear(m[2]),
      asin: m[3].toUpperCase(),
      costGross: gross,
      costNet: round4(gross / (1 + vat)),
      targetPrice: Number(m[5]),
    };
  }

  m = RE_A.exec(s);
  if (m) {
    const date = estimateDateWithoutYear(m[4], opts.reference);
    return {
      ...empty("A"),
      supplierCode: m[1].toUpperCase(),
      costNet: Number(m[2]),
      targetPrice: Number(m[3]),
      date,
      dateEstimated: date !== null,
      asin: m[5].toUpperCase(),
    };
  }

  m = RE_B.exec(s);
  if (m) {
    const gross = Number(m[5]);
    const date = estimateDateWithoutYear(m[3], opts.reference);
    return {
      ...empty("B"),
      supplierCode: m[1].toUpperCase(),
      targetPrice: Number(m[2]),
      date,
      dateEstimated: date !== null,
      asin: m[4].toUpperCase(),
      costGross: gross,
      costNet: round4(gross / (1 + vat)),
    };
  }

  const out = empty("UNKNOWN");
  const first = s.split("_")[0];
  if (s.includes("_") && /^[A-Z][A-Z0-9]{1,9}$/i.test(first)) out.supplierCode = first.toUpperCase();
  return out;
}
