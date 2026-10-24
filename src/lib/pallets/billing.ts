// Abrechnung der Palettenstellplätze. Ohne Server-Abhängigkeiten, damit es testbar bleibt.
//
// Zählweise: Der Einlagerungstag ist Tag 1, der Auslagerungstag zählt noch mit.
// Kostenfrei sind die ersten `freeDays` Tage (Vorgabe 5) – kostenpflichtig ab Tag 6.
// Abgerechnet wird je Kalendermonat:
//  - "monat":    voller Monatspreis, sobald im Monat mindestens ein kostenpflichtiger Tag liegt
//  - "anteilig": Monatspreis / Tage des Monats × kostenpflichtige Tage im Monat
// Dazu je Palette eine Gebühr fürs Einlagern (im Monat des Einlagerns) und fürs Auslagern (im Monat
// des Auslagerns) sowie Zusatzleistungen (Folieren, Umpacken …) am Tag der Leistung.
// Jeder Kunde kann eigene Konditionen haben; was fehlt, kommt aus dem Standard.

export type PalletBillingMode = "monat" | "anteilig";
export type PalletRates = { pricePerMonth: number; freeDays: number; mode: PalletBillingMode; inFee?: number; outFee?: number };
export type PalletLike = { inAt: string; outAt: string | null };
/** Konditionen, die bis einschließlich Monat `until` (JJJJ-MM) galten – leere Felder = Standard dieses Monats. */
export type RateVersion = { until: string; pricePerMonth: number | null; freeDays: number | null; mode: PalletBillingMode | null; inFee: number | null; outFee: number | null };
/** Eigene Konditionen eines Kunden – leere Felder = Standard. */
export type CustomerRates = {
  name: string;
  pricePerMonth?: number | null;
  freeDays?: number | null;
  mode?: PalletBillingMode | null;
  inFee?: number | null;
  outFee?: number | null;
  rateHistory?: RateVersion[] | null;
};
/** Standard-Konditionen mit Verlauf. */
export type DefaultRates = PalletRates & { rateHistory?: RateVersion[] | null };
export type ChargeLike = { customer: string; day: string; description: string; quantity: number; unitPrice: number };

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const addDays = (iso: string, days: number) => toIso(toMs(iso) + days * DAY);

export const NO_CUSTOMER = "Ohne Kunde";
/** Kunden werden über den Namen zugeordnet – Groß/Klein und Leerzeichen am Rand egal. */
export const customerKey = (name: string | null | undefined) => (name ?? "").trim().toLowerCase();

/** Erster und letzter Tag eines Monats „JJJJ-MM“. */
export function monthRange(month: string): { first: string; last: string; days: number } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}

/** Fassung, die im Monat galt: die früheste aus dem Verlauf mit `until` ≥ Monat, sonst die aktuelle. */
function versionFor<T extends Partial<Omit<RateVersion, "until">>>(current: T, history: RateVersion[] | null | undefined, month: string | undefined): T {
  if (!month || !history?.length) return current;
  const v = [...history].sort((a, b) => a.until.localeCompare(b.until)).find((h) => h.until >= month);
  return v ? ({ ...current, pricePerMonth: v.pricePerMonth, freeDays: v.freeDays, mode: v.mode, inFee: v.inFee, outFee: v.outFee } as T) : current;
}

/**
 * Konditionen für einen Kunden: eigene, sonst Standard. Mit `month` die Fassung, die in diesem Monat galt –
 * so verändert eine Preisänderung keine früheren Abrechnungen.
 */
export function ratesFor(customer: string | null | undefined, defaults: DefaultRates, overrides: Map<string, CustomerRates> = new Map(), month?: string): Required<PalletRates> & { own: boolean } {
  const d = versionFor(defaults as Partial<RateVersion> & DefaultRates, defaults.rateHistory, month);
  const raw = overrides.get(customerKey(customer));
  const o = raw ? versionFor(raw as CustomerRates, raw.rateHistory, month) : undefined;
  return {
    pricePerMonth: o?.pricePerMonth ?? d.pricePerMonth ?? defaults.pricePerMonth,
    freeDays: o?.freeDays ?? d.freeDays ?? defaults.freeDays,
    mode: o?.mode ?? d.mode ?? defaults.mode,
    inFee: o?.inFee ?? d.inFee ?? 0,
    outFee: o?.outFee ?? d.outFee ?? 0,
    own: Boolean(o && (o.pricePerMonth != null || o.freeDays != null || o.mode != null || o.inFee != null || o.outFee != null)),
  };
}

/** Vormonat „JJJJ-MM“. */
export const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

/**
 * Konditionen ändern ab Monat `from`: die bisherige Fassung gilt bis zum Vormonat weiter (Verlauf).
 * Frühere Monate bleiben so abgerechnet, wie sie waren. Liegt `from` vor einer schon gespeicherten
 * Änderung, wird abgelehnt (sonst würde ein abgerechneter Zeitraum still umgedeutet).
 */
export function changeRates(current: Omit<RateVersion, "until">, history: RateVersion[] | null | undefined, from: string): { history: RateVersion[] } | { error: string } {
  const list = [...(history ?? [])].sort((a, b) => a.until.localeCompare(b.until));
  const until = prevMonth(from);
  const last = list[list.length - 1];
  if (last && last.until > until) return { error: `Ab ${last.until} gelten schon geänderte Konditionen – Änderungen frühestens ab dem Monat danach.` };
  if (last && last.until === until) return { history: list };
  return { history: [...list, { until, ...current }].slice(-60) };
}

/** Haben sich preisrelevante Felder geändert? */
export const ratesDiffer = (a: Partial<Omit<RateVersion, "until">>, b: Partial<Omit<RateVersion, "until">>) =>
  (["pricePerMonth", "freeDays", "mode", "inFee", "outFee"] as const).some((k) => (a[k] ?? null) !== (b[k] ?? null));

/** Ab welchem Tag die Palette Geld kostet. */
export function chargeableFrom(inAt: string, freeDays: number): string {
  return addDays(inAt, Math.max(0, freeDays));
}

/** Lagertage bis heute bzw. bis zum Auslagern (Einlagerungstag = Tag 1). */
export function storedDays(p: PalletLike, today: string): number {
  const end = p.outAt ?? today;
  return Math.max(0, Math.round((toMs(end) - toMs(p.inAt)) / DAY) + 1);
}

/**
 * Kostenpflichtige Tage im Monat. Noch eingelagerte Paletten zählen bis Monatsende
 * (so sieht man schon vorher, was am Monatsende abgerechnet wird).
 */
export function chargeableDaysInMonth(p: PalletLike, month: string, freeDays: number): number {
  const { first, last } = monthRange(month);
  const from = Math.max(toMs(chargeableFrom(p.inAt, freeDays)), toMs(first));
  const to = Math.min(p.outAt ? toMs(p.outAt) : Infinity, toMs(last));
  return to < from ? 0 : Math.round((to - from) / DAY) + 1;
}

export function amountForMonth(p: PalletLike, month: string, r: PalletRates): { days: number; amount: number } {
  const days = chargeableDaysInMonth(p, month, r.freeDays);
  if (days === 0) return { days, amount: 0 };
  if (r.mode === "monat") return { days, amount: r.pricePerMonth };
  return { days, amount: round2((r.pricePerMonth / monthRange(month).days) * days) };
}

/** Gebühren im Monat: Einlagern im Monat des Einlagerns, Auslagern im Monat des Auslagerns. */
export function feesForMonth(p: PalletLike, month: string, r: PalletRates): { inFee: number; outFee: number } {
  return {
    inFee: p.inAt.slice(0, 7) === month ? r.inFee ?? 0 : 0,
    outFee: p.outAt && p.outAt.slice(0, 7) === month ? r.outFee ?? 0 : 0,
  };
}

export type PalletBillLine<P extends PalletLike> = { pallet: P; days: number; storage: number; inFee: number; outFee: number; amount: number };
export type ServiceLine<C extends ChargeLike> = { charge: C; amount: number };
export type BillGroup<P extends PalletLike, C extends ChargeLike> = {
  customer: string;
  rates: PalletRates;
  lines: PalletBillLine<P>[];
  services: ServiceLine<C>[];
  storage: number;
  fees: number;
  servicesTotal: number;
  total: number;
};

type RatesInput = PalletRates | ((customer: string | null) => PalletRates);

/**
 * Alle Paletten und Leistungen eines Monats mit Betrag > 0, gruppiert nach Kunde. Ohne `asOf` zählen noch
 * eingelagerte Paletten bis Monatsende (Hochrechnung); mit `asOf` nur, was bis zu diesem Tag angefallen ist.
 */
export function monthlyBill<P extends PalletLike & { customer: string | null }, C extends ChargeLike>(pallets: P[], month: string, rates: RatesInput, charges: C[] = [], opts: { asOf?: string } = {}) {
  const ratesOf = typeof rates === "function" ? rates : () => rates;
  const { first, last } = monthRange(month);
  const asOf = opts.asOf && opts.asOf < last ? opts.asOf : undefined;
  if (asOf && asOf < first) return { groups: [], total: 0, storage: 0, fees: 0, services: 0, count: 0 };
  const groups = new Map<string, BillGroup<P, C>>();
  const groupOf = (name: string | null) => {
    const key = customerKey(name) || customerKey(NO_CUSTOMER);
    let g = groups.get(key);
    if (!g) {
      g = { customer: name?.trim() || NO_CUSTOMER, rates: ratesOf(name), lines: [], services: [], storage: 0, fees: 0, servicesTotal: 0, total: 0 };
      groups.set(key, g);
    }
    return g;
  };
  for (const p of pallets) {
    if (asOf && p.inAt > asOf) continue;
    const r = ratesOf(p.customer);
    const cut = asOf ? { inAt: p.inAt, outAt: p.outAt && p.outAt <= asOf ? p.outAt : asOf } : p;
    const { days, amount: storage } = amountForMonth(cut, month, r);
    const fees = feesForMonth(p, month, r);
    const inFee = fees.inFee;
    const outFee = asOf && !(p.outAt && p.outAt <= asOf) ? 0 : fees.outFee;
    if (days === 0 && inFee === 0 && outFee === 0) continue;
    const g = groupOf(p.customer);
    g.lines.push({ pallet: p, days, storage, inFee, outFee, amount: round2(storage + inFee + outFee) });
    g.storage += storage;
    g.fees += inFee + outFee;
  }
  for (const c of charges) {
    if (c.day < first || c.day > (asOf ?? last)) continue;
    const amount = round2(c.quantity * c.unitPrice);
    if (amount === 0) continue;
    const g = groupOf(c.customer);
    g.services.push({ charge: c, amount });
    g.servicesTotal += amount;
  }
  const list = [...groups.values()]
    .map((g) => ({ ...g, storage: round2(g.storage), fees: round2(g.fees), servicesTotal: round2(g.servicesTotal), total: round2(g.storage + g.fees + g.servicesTotal) }))
    .sort((a, b) => (a.customer === NO_CUSTOMER ? 1 : b.customer === NO_CUSTOMER ? -1 : a.customer.localeCompare(b.customer, "de")));
  const sum = (f: (g: (typeof list)[number]) => number) => round2(list.reduce((s, g) => s + f(g), 0));
  return {
    groups: list,
    total: sum((g) => g.total),
    storage: sum((g) => g.storage),
    fees: sum((g) => g.fees),
    services: sum((g) => g.servicesTotal),
    count: list.reduce((s, g) => s + g.lines.length, 0),
  };
}

/** Nächste freie automatische Nummer (P-0001, P-0002 …). */
export function nextPalletCodes(existing: string[], n: number): string[] {
  let max = 0;
  for (const c of existing) {
    const m = /^P-(\d+)$/i.exec(c.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: n }, (_, i) => `P-${String(max + i + 1).padStart(4, "0")}`);
}

/** Stellplatz einheitlich schreiben: „b 3“ → „B 3“, Leerzeichen am Rand weg. */
export const normalizeLocation = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 40) || null;

/** Zusatzleistungen aus dem Einstellungsfeld: „Folieren = 8“ je Zeile. */
export function parseServices(text: string): { name: string; price: number }[] {
  const out: { name: string; price: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.+?)\s*[=:;]\s*(-?[\d.,]+)\s*(?:€|eur)?\s*$/i.exec(line.trim());
    if (!m) continue;
    const price = Number(m[2].replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (m[1].trim() && Number.isFinite(price) && price >= 0) out.push({ name: m[1].trim().slice(0, 80), price: round2(price) });
  }
  return out.slice(0, 50);
}
export const servicesText = (s: { name: string; price: number }[]) => s.map((x) => `${x.name} = ${String(x.price).replace(".", ",")}`).join("\n");

// ---- Erinnerungen ---------------------------------------------------------------------------------

type OpenPallet = PalletLike & { code: string; customer: string | null };

/**
 * Was als Aufgabe erinnert werden soll:
 * - freie Lagerzeit endet heute oder morgen (je Kunde und Datum, damit der Kunde vorher abholen kann)
 * - Paletten, die schon `longStayDays` oder länger stehen (je Kunde)
 */
export function palletReminders(open: OpenPallet[], today: string, ratesOf: (c: string | null) => PalletRates, opts: { longStayDays: number; remindFreeEnd: boolean }) {
  const freeEnd = new Map<string, { customer: string; lastFreeDay: string; codes: string[] }>();
  const longStay = new Map<string, { customer: string; codes: string[]; maxDays: number }>();
  for (const p of open) {
    if (p.outAt) continue;
    const customer = p.customer?.trim() || NO_CUSTOMER;
    const r = ratesOf(p.customer);
    if (opts.remindFreeEnd && r.freeDays > 0) {
      const lastFreeDay = addDays(chargeableFrom(p.inAt, r.freeDays), -1);
      if (lastFreeDay >= today && lastFreeDay <= addDays(today, 1)) {
        const key = `${customerKey(customer)}|${lastFreeDay}`;
        const e = freeEnd.get(key) ?? { customer, lastFreeDay, codes: [] };
        e.codes.push(p.code);
        freeEnd.set(key, e);
      }
    }
    const days = storedDays(p, today);
    if (opts.longStayDays > 0 && days >= opts.longStayDays) {
      const key = customerKey(customer);
      const e = longStay.get(key) ?? { customer, codes: [], maxDays: 0 };
      e.codes.push(p.code);
      e.maxDays = Math.max(e.maxDays, days);
      longStay.set(key, e);
    }
  }
  const byCode = (a: string, b: string) => a.localeCompare(b, "de", { numeric: true });
  return {
    freeEnd: [...freeEnd.values()].map((e) => ({ ...e, codes: e.codes.sort(byCode) })),
    longStay: [...longStay.values()].map((e) => ({ ...e, codes: e.codes.sort(byCode) })),
  };
}

// ---- Übersicht ------------------------------------------------------------------------------------

/** Paletten, die an einem Tag im Lager stehen (am Auslagerungstag nicht mehr). */
export function occupiedOn(pallets: PalletLike[], day: string): number {
  return pallets.filter((p) => p.inAt <= day && (p.outAt === null || p.outAt > day)).length;
}

/** Letzte `n` Monate bis einschließlich `month`, älteste zuerst. */
export function lastMonths(month: string, n: number): string[] {
  const [y, m] = month.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * Auslastung und Umsatz je Monat und Kunde. Im laufenden Monat zählt die Belegung von heute,
 * sonst die am Monatsende.
 */
export function palletOverview<P extends PalletLike & { customer: string | null }, C extends ChargeLike>(pallets: P[], charges: C[], months: string[], ratesOf: (c: string | null, month?: string) => PalletRates, today: string) {
  const perMonth = months.map((month) => {
    const bill = monthlyBill(pallets, month, (c) => ratesOf(c, month), charges);
    const { last } = monthRange(month);
    const day = last > today ? today : last;
    return { month, occupied: occupiedOn(pallets, day), revenue: bill.total, storage: bill.storage, fees: bill.fees, services: bill.services, groups: bill.groups };
  });
  const customers = new Map<string, { customer: string; open: number; revenue: number; byMonth: Record<string, number> }>();
  for (const m of perMonth) {
    for (const g of m.groups) {
      const key = customerKey(g.customer);
      const c = customers.get(key) ?? { customer: g.customer, open: 0, revenue: 0, byMonth: {} };
      c.revenue = round2(c.revenue + g.total);
      c.byMonth[m.month] = g.total;
      customers.set(key, c);
    }
  }
  for (const p of pallets) {
    if (p.outAt !== null || p.inAt > today) continue;
    const name = p.customer?.trim() || NO_CUSTOMER;
    const key = customerKey(name);
    const c = customers.get(key) ?? { customer: name, open: 0, revenue: 0, byMonth: {} };
    c.open++;
    customers.set(key, c);
  }
  const first = monthRange(months[0]).first;
  const out = pallets.filter((p) => p.outAt && p.outAt >= first);
  const avgStayDays = out.length ? Math.round(out.reduce((s, p) => s + storedDays(p, today), 0) / out.length) : null;
  return {
    months: perMonth.map(({ groups: _g, ...rest }) => rest),
    customers: [...customers.values()].sort((a, b) => b.revenue - a.revenue || b.open - a.open),
    total: round2(perMonth.reduce((s, m) => s + m.revenue, 0)),
    avgStayDays,
  };
}

// ---- Lagerplan & Inventur ---------------------------------------------------------------------------

/**
 * Stellplätze aus dem Einstellungsfeld, eine Angabe je Zeile oder mit Komma:
 * „A-01..A-20“ (Bereich, führende Nullen bleiben), „B1..B5“, oder einzelne Namen („Tor 1“).
 */
export function parseLocations(spec: string): string[] {
  const out: string[] = [];
  for (const raw of spec.split(/[\n,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(.*?)(\d+)\s*(?:\.\.|–|—|bis)\s*(.*?)(\d+)$/i.exec(part);
    if (m && (m[3].trim() === "" || m[3].trim().toUpperCase() === m[1].trim().toUpperCase())) {
      const prefix = m[1].toUpperCase();
      const a = Number(m[2]);
      const b = Number(m[4]);
      const width = m[2].length;
      if (b >= a && b - a < 1000) for (let i = a; i <= b; i++) out.push(`${prefix}${String(i).padStart(width, "0")}`);
      continue;
    }
    const one = normalizeLocation(part);
    if (one) out.push(one);
  }
  return [...new Set(out)].slice(0, 2000);
}

/** Plan gruppiert nach Reihe (Teil vor der Nummer), z. B. „A-“ → [A-01, A-02 …]. */
export function locationRows(plan: string[]): { row: string; places: string[] }[] {
  const rows = new Map<string, string[]>();
  for (const p of plan) {
    const row = /^(.*?)\d+$/.exec(p)?.[1].replace(/[-\s]+$/, "") || p;
    rows.set(row, [...(rows.get(row) ?? []), p]);
  }
  return [...rows.entries()].map(([row, places]) => ({ row, places }));
}

/** Freie Plätze in Plan-Reihenfolge. */
export function freeLocations(plan: string[], occupied: (string | null)[]): string[] {
  const used = new Set(occupied.filter(Boolean) as string[]);
  return plan.filter((p) => !used.has(p));
}

/** Inventur: gescannte Nummern gegen eingelagerte Paletten. */
export function inventoryCompare<P extends { code: string }>(scanned: string[], open: P[]) {
  const seen = new Map<string, string>();
  for (const s of scanned) {
    const c = s.trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  const byCode = new Map(open.map((p) => [p.code.toLowerCase(), p]));
  return {
    found: open.filter((p) => seen.has(p.code.toLowerCase())),
    missing: open.filter((p) => !seen.has(p.code.toLowerCase())),
    unknown: [...seen.entries()].filter(([k]) => !byCode.has(k)).map(([, v]) => v),
    scanned: seen.size,
  };
}
