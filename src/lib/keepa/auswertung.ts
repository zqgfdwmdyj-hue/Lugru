// Keepa-Produktdaten auswerten – für die Claude-Werkzeuge „keepa_produkt“ und „keepa_vergleich“.
// Aus dem Keepa-Produkt (mit stats=180, days=365, buybox=1) wird ein kompakter Stand: aktuelle Werte, Kennzahlen
// über 30/90/180 Tage, ein Wert je Tag und der Buy-Box-Verlauf. Reine Logik ohne Datenbank, damit testbar.
//
// Keepa-Eigenheiten (laut Keepa-API):
// - Zeit in „Keepa-Minuten“: Unix-Zeit (ms) = (keepaZeit + 21564000) × 60000
// - Preise in Cent der Landeswährung, −1 = kein Angebot (z. B. nicht auf Lager), bei Anzahl/Rang −1 = keine Daten
// - csv-Index: 0 Amazon, 1 Neu, 3 Verkaufsrang, 11 Anzahl Neu-Angebote, 18 Buy Box (Zeit, Preis, Versand),
//   34 Anzahl Neu-Angebote FBA, 35 Anzahl Neu-Angebote FBM
// - Buy-Box-Preis = Preis + Versand („landed price“)

export const MARKTPLAETZE = {
  DE: { domain: 3, amazonId: "A3JWKAKR8XB7XF", waehrung: "EUR", host: "www.amazon.de" },
  FR: { domain: 4, amazonId: "A1X6FK5RDHNB96", waehrung: "EUR", host: "www.amazon.fr" },
  IT: { domain: 8, amazonId: "A11IL2PNWYJU7H", waehrung: "EUR", host: "www.amazon.it" },
  ES: { domain: 9, amazonId: "A1AT7YVPFBWXBL", waehrung: "EUR", host: "www.amazon.es" },
  UK: { domain: 2, amazonId: "A3P5ROKL5A1OLE", waehrung: "GBP", host: "www.amazon.co.uk" },
} as const;
export type Marktplatz = keyof typeof MARKTPLAETZE;
export const MARKTPLATZ_LISTE = Object.keys(MARKTPLAETZE) as Marktplatz[];
/** Amazon-Länder, die Keepa nicht abdeckt (Keepa: US, UK, DE, FR, JP, CA, IT, ES, IN, MX, BR). */
export const OHNE_KEEPA = ["NL", "BE", "PL", "SE"] as const;

const K = { AMAZON: 0, RANK: 3, COUNT_NEW: 11, BUY_BOX: 18, COUNT_FBA: 34, COUNT_FBM: 35 } as const;
const TAG = 86_400_000;
export const FENSTER = [30, 90, 180] as const;
export const VERLAUF_TAGE = 365;

export const keepaMs = (t: number) => (t + 21_564_000) * 60_000;

/** Zeitreihe: [Unix-ms, Wert]; null = kein Angebot bzw. keine Daten. */
export type Punkt = [number, number | null];

/** csv-Feld als Zeitreihe; mit Versand: Preis + Versand (Versand < 0 zählt als 0). */
export function reihe(csv: unknown, mitVersand = false): Punkt[] {
  if (!Array.isArray(csv)) return [];
  const step = mitVersand ? 3 : 2;
  const out: Punkt[] = [];
  for (let i = 0; i + step - 1 < csv.length; i += step) {
    const t = csv[i];
    const v = csv[i + 1];
    if (typeof t !== "number" || typeof v !== "number") continue;
    let val: number | null = v < 0 ? null : v;
    if (mitVersand && val !== null) {
      const s = csv[i + 2];
      val += typeof s === "number" && s > 0 ? s : 0;
    }
    out.push([keepaMs(t), val]);
  }
  return out;
}

/** Wert zur Zeit `ms`: null = kein Angebot/keine Daten, undefined = vor dem ersten bekannten Wert. */
export function wertBei(r: Punkt[], ms: number): number | null | undefined {
  let lo = 0;
  let hi = r.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (r[mid][0] <= ms) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit < 0 ? undefined : r[hit][1];
}

export type Spanne = { schnitt: number | null; min: number | null; max: number | null };

/**
 * Was im Zeitraum [von, bis] galt: zeitgewichteter Schnitt, Minimum, Maximum (nur Zeiten mit Wert) und der Anteil
 * der Zeit ohne Wert in % (bei Amazon: nicht auf Lager). Zeit vor dem ersten bekannten Wert zählt nicht.
 */
export function fenster(r: Punkt[], von: number, bis: number): Spanne & { ohneProzent: number | null } {
  let min: number | null = null;
  let max: number | null = null;
  let summe = 0;
  let mitWert = 0;
  let ohne = 0;
  const seg = (v: number | null | undefined, a: number, b: number) => {
    if (b <= a || v === undefined) return;
    if (v === null) ohne += b - a;
    else {
      summe += v * (b - a);
      mitWert += b - a;
      min = min === null ? v : Math.min(min, v);
      max = max === null ? v : Math.max(max, v);
    }
  };
  let cur = wertBei(r, von);
  let t = von;
  for (const [ms, v] of r) {
    if (ms <= von) continue;
    if (ms > bis) break;
    seg(cur, t, ms);
    cur = v;
    t = ms;
  }
  seg(cur, t, bis);
  const gesamt = mitWert + ohne;
  return { schnitt: mitWert ? summe / mitWert : null, min, max, ohneProzent: gesamt ? Math.round((ohne / gesamt) * 1000) / 10 : null };
}

/** Buy-Box-Verlauf: [Unix-ms, Verkäufer-ID]; „-1“ = niemand hatte die Buy Box, „-2“ = unbekannter (neuer) Verkäufer. */
export type BbPunkt = [number, string];
export function bbReihe(h: unknown): BbPunkt[] {
  if (!Array.isArray(h)) return [];
  const out: BbPunkt[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) {
    const t = Number(h[i]);
    if (Number.isFinite(t) && typeof h[i + 1] === "string") out.push([keepaMs(t), h[i + 1] as string]);
  }
  return out;
}

export type BbStats = Record<string, { anteil: number; fba: boolean }>;
export type BbAnteile = {
  zeitraum_tage: number;
  grundlage: "verlauf" | "keepa_statistik_180_tage";
  amazon_prozent: number;
  fba_prozent: number;
  fbm_prozent: number;
  unbekannt_prozent: number;
  keine_buybox_prozent: number;
  verkaeufer: { verkaeufer_id: string; art: "Amazon" | "FBA" | "FBM" | "unbekannt"; anteil_prozent: number }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Wer hatte die Buy Box im Zeitraum (zeitgewichtet): Amazon selbst, Drittanbieter FBA bzw. FBM, unbekannt, niemand.
 * FBA/FBM laut Keepa-Statistik je Verkäufer. Ohne Verlauf: Keepa-Statistik der letzten 180 Tage.
 */
export function buyboxAnteile(hist: BbPunkt[], stats: BbStats | null, amazonId: string, von: number, bis: number): BbAnteile | null {
  const art = (id: string): BbAnteile["verkaeufer"][number]["art"] | "keine" => (id === amazonId ? "Amazon" : id === "-1" ? "keine" : stats?.[id] ? (stats[id].fba ? "FBA" : "FBM") : "unbekannt");
  const zeit = new Map<string, number>();
  let gesamt = 0;
  if (hist.length) {
    let cur: string | undefined;
    for (const [ms, id] of hist) if (ms <= von) cur = id;
    let t = von;
    const add = (id: string | undefined, a: number, b: number) => {
      if (id === undefined || b <= a) return;
      zeit.set(id, (zeit.get(id) ?? 0) + b - a);
      gesamt += b - a;
    };
    for (const [ms, id] of hist) {
      if (ms <= von) continue;
      if (ms > bis) break;
      add(cur, t, ms);
      cur = id;
      t = ms;
    }
    add(cur, t, bis);
  }
  const ausVerlauf = gesamt > 0;
  if (!ausVerlauf) {
    if (!stats || !Object.keys(stats).length) return null;
    for (const [id, s] of Object.entries(stats)) {
      zeit.set(id, s.anteil);
      gesamt += s.anteil;
    }
    if (gesamt <= 0) return null;
  }
  const p = (n: number) => r1((n / gesamt) * 100);
  const sum = { Amazon: 0, FBA: 0, FBM: 0, unbekannt: 0, keine: 0 };
  for (const [id, ms] of zeit) sum[art(id)] += ms;
  const verkaeufer = [...zeit.entries()]
    .filter(([id]) => id !== "-1")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, ms]) => ({ verkaeufer_id: id === "-2" ? "unbekannt" : id, art: art(id) as BbAnteile["verkaeufer"][number]["art"], anteil_prozent: p(ms) }));
  return {
    zeitraum_tage: ausVerlauf ? Math.round((bis - von) / TAG) : 180,
    grundlage: ausVerlauf ? "verlauf" : "keepa_statistik_180_tage",
    amazon_prozent: p(sum.Amazon),
    fba_prozent: p(sum.FBA),
    fbm_prozent: p(sum.FBM),
    unbekannt_prozent: p(sum.unbekannt),
    keine_buybox_prozent: p(sum.keine),
    verkaeufer,
  };
}

// ---- Tage (Europe/Berlin) ----------------------------------------------------------------------

const berlinTag = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(ms));
const versatzMin = (ms: number) => {
  const z = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(z);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
};
/** Letzte Millisekunde des Tages in Berlin. */
export function tagesende(day: string): number {
  const naiv = Date.parse(`${day}T23:59:59.999Z`);
  return naiv - versatzMin(naiv) * 60_000;
}
const tagMinus = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) - n * TAG).toISOString().slice(0, 10);

// ---- Stand eines Produkts ----------------------------------------------------------------------

export type Kennzahlen = { buybox: Spanne; amazon: Spanne; rang: Spanne; amazon_nicht_auf_lager_prozent: number | null };
export type VerlaufZeile = [tag: string, buybox: number | null, amazon: number | null, angebote: number | null, rang: number | null];
export type KeepaStand = {
  asin: string;
  marktplatz: Marktplatz;
  waehrung: "EUR" | "GBP";
  titel: string | null;
  /** Wann Keepa das Produkt zuletzt aktualisiert hat (ISO). */
  keepa_aktualisiert: string | null;
  aktuell: {
    buybox: number | null;
    amazon: number | null;
    amazon_status: "auf Lager" | "nicht auf Lager" | "kein Amazon-Angebot" | "Vorbestellung" | "später lieferbar" | "unbekannt";
    angebote_neu: number | null;
    angebote_fba: number | null;
    angebote_fbm: number | null;
    verkaufsrang: number | null;
    /** Amazon-Angabe „x+ im letzten Monat gekauft“ (Mindestwert), null = keine Angabe. */
    monatlich_verkauft: number | null;
  };
  kennzahlen: Record<"30" | "90" | "180", Kennzahlen>;
  /** Ein Wert je Tag (Stand am Tagesende, Europe/Berlin), älteste zuerst, bis zu 365 Tage. */
  verlauf: VerlaufZeile[];
  buybox_verlauf: BbPunkt[];
  buybox_stats: BbStats | null;
};

const preis = (cent: number | null | undefined) => (cent == null ? null : Math.round(cent) / 100);
const ganz = (n: number | null | undefined) => (n == null ? null : Math.round(n));
const statWert = (arr: unknown, i: number) => (Array.isArray(arr) && typeof arr[i] === "number" && arr[i] >= 0 ? (arr[i] as number) : null);
const statProzent = (arr: unknown, i: number) => (Array.isArray(arr) && typeof arr[i] === "number" && arr[i] >= 0 ? (arr[i] as number) : null);

/** Keepa-Produkt → kompakter Stand; null, wenn Keepa zur ASIN nichts hat. */
export function standAusKeepa(p: Record<string, unknown> | null | undefined, mp: Marktplatz, now: number): KeepaStand | null {
  if (!p || typeof p.asin !== "string") return null;
  const csv = (Array.isArray(p.csv) ? p.csv : []) as unknown[];
  const stats = (p.stats ?? {}) as Record<string, unknown>;
  const bb = reihe(csv[K.BUY_BOX], true);
  const amz = reihe(csv[K.AMAZON]);
  const rang = reihe(csv[K.RANK]);
  const angebote = reihe(csv[K.COUNT_NEW]);
  const fba = reihe(csv[K.COUNT_FBA]);
  const fbm = reihe(csv[K.COUNT_FBM]);
  if (!p.title && !bb.length && !amz.length && !rang.length && !angebote.length) return null;

  const jetzt = (r: Punkt[], idx: number) => {
    const v = wertBei(r, now);
    return v === undefined ? statWert(stats.current, idx) : v;
  };
  const amazonJetzt = jetzt(amz, K.AMAZON);
  const verf = typeof p.availabilityAmazon === "number" ? p.availabilityAmazon : -1;
  const amazonStatus: KeepaStand["aktuell"]["amazon_status"] =
    amazonJetzt !== null && amazonJetzt > 0 ? (verf === 1 ? "Vorbestellung" : verf === 3 || verf === 4 ? "später lieferbar" : "auf Lager") : amz.length ? "nicht auf Lager" : verf === -1 ? "kein Amazon-Angebot" : "unbekannt";

  const kennzahlen = {} as KeepaStand["kennzahlen"];
  for (const d of FENSTER) {
    const von = now - d * TAG;
    const fb = fenster(bb, von, now);
    const fa = fenster(amz, von, now);
    const fr = fenster(rang, von, now);
    // Schnitt: Keepas eigener gewichteter Mittelwert, wenn vorhanden – sonst aus dem Verlauf berechnet.
    const avg = stats[`avg${d}`];
    const oos = d === 180 ? stats.outOfStockPercentageInInterval : stats[`outOfStockPercentage${d}`];
    kennzahlen[String(d) as "30" | "90" | "180"] = {
      buybox: { schnitt: preis(statWert(avg, K.BUY_BOX) ?? fb.schnitt), min: preis(fb.min), max: preis(fb.max) },
      amazon: { schnitt: preis(statWert(avg, K.AMAZON) ?? fa.schnitt), min: preis(fa.min), max: preis(fa.max) },
      rang: { schnitt: ganz(statWert(avg, K.RANK) ?? fr.schnitt), min: ganz(fr.min), max: ganz(fr.max) },
      amazon_nicht_auf_lager_prozent: !amz.length && amazonStatus === "kein Amazon-Angebot" ? null : (statProzent(oos, K.AMAZON) ?? fa.ohneProzent),
    };
  }

  const heute = berlinTag(now);
  const verlauf: VerlaufZeile[] = [];
  for (let i = VERLAUF_TAGE - 1; i >= 0; i--) {
    const tag = tagMinus(heute, i);
    const ms = i === 0 ? now : tagesende(tag);
    const w = (r: Punkt[]) => wertBei(r, ms) ?? null;
    verlauf.push([tag, preis(w(bb)), preis(w(amz)), w(angebote), w(rang)]);
  }

  const rawStats = (stats.buyBoxStats ?? null) as Record<string, { percentageWon?: number; isFBA?: boolean }> | null;
  const bbStats: BbStats | null = rawStats ? Object.fromEntries(Object.entries(rawStats).map(([id, s]) => [id, { anteil: Number(s?.percentageWon ?? 0), fba: Boolean(s?.isFBA) }])) : null;
  const ms = typeof p.monthlySold === "number" && p.monthlySold > 0 ? p.monthlySold : null;
  const lu = typeof p.lastUpdate === "number" && p.lastUpdate > 0 ? new Date(keepaMs(p.lastUpdate)).toISOString() : null;

  return {
    asin: p.asin,
    marktplatz: mp,
    waehrung: MARKTPLAETZE[mp].waehrung,
    titel: typeof p.title === "string" ? p.title.slice(0, 200) : null,
    keepa_aktualisiert: lu,
    aktuell: {
      buybox: preis(jetzt(bb, K.BUY_BOX)),
      amazon: preis(amazonJetzt),
      amazon_status: amazonStatus,
      angebote_neu: jetzt(angebote, K.COUNT_NEW),
      angebote_fba: jetzt(fba, K.COUNT_FBA),
      angebote_fbm: jetzt(fbm, K.COUNT_FBM),
      verkaufsrang: jetzt(rang, K.RANK),
      monatlich_verkauft: ms,
    },
    kennzahlen,
    verlauf,
    buybox_verlauf: bbReihe(p.buyBoxSellerIdHistory).filter(([t]) => t >= now - VERLAUF_TAGE * TAG - 30 * TAG),
    buybox_stats: bbStats,
  };
}
