// Bauauftrag Rechnungsstation – reine Logik ohne Datenbank und ohne Browser-APIs:
// 1) Kamerabild: Blatt erkennen (Ränder), Bewegung/Stillstand, Auslöser je Blatt, Entzerren (Homographie).
// 2) KI: Beleg lesen (Kamera) bzw. PDF-Stapel trennen und lesen (Einzugsscanner), Antworten prüfen.
// 3) Ampel, Mehrseiter (zweites Blatt ≤ 5 s mit gleicher Rechnungsnummer), Duplikate, Zuordnung zu Einkäufen.

// ── 1) Kamerabild ─────────────────────────────────────────────────────────────

export type Punkt = { x: number; y: number };

/** RGBA → Graustufen (Luma). */
export function graustufen(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  return g;
}

/** Mittlere Helligkeitsänderung zweier Bilder (0–255) – Maß für Bewegung. */
export function bewegung(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || !a.length) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Schwelle nach Otsu (trennt helles Blatt von der dunklen Ablage). */
export function otsu(g: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of g) hist[v]++;
  const n = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, schwelle = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const zwischen = wB * wF * (mB - mF) ** 2;
    if (zwischen > best) {
      best = zwischen;
      schwelle = t;
    }
  }
  return schwelle;
}

const flaeche = (q: Punkt[]) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;

/**
 * Blatt im (verkleinerten) Graubild finden: helle Fläche auf kontrastreicher Ablage. Ecken = äußerste helle Punkte
 * entlang der Diagonalen (oben links, oben rechts, unten rechts, unten links). null, wenn kein Blatt erkennbar ist.
 */
export function blattFinden(g: Uint8Array, w: number, h: number): { ecken: Punkt[]; anteil: number } | null {
  const t = otsu(g);
  // Zu wenig Kontrast (leere Ablage, alles gleich hell) → kein Blatt.
  let min = 255, max = 0;
  for (const v of g) { if (v < min) min = v; if (v > max) max = v; }
  if (max - min < 40) return null;
  let n = 0;
  let tl = { x: 0, y: 0, s: Infinity }, br = { x: 0, y: 0, s: -Infinity }, tr = { x: 0, y: 0, s: -Infinity }, bl = { x: 0, y: 0, s: Infinity };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y * w + x] <= t) continue;
      n++;
      const s1 = x + y, s2 = x - y;
      if (s1 < tl.s) tl = { x, y, s: s1 };
      if (s1 > br.s) br = { x, y, s: s1 };
      if (s2 > tr.s) tr = { x, y, s: s2 };
      if (s2 < bl.s) bl = { x, y, s: s2 };
    }
  }
  const anteil = n / (w * h);
  if (anteil < 0.05 || anteil > 0.97) return null;
  const ecken = [tl, tr, br, bl].map(({ x, y }) => ({ x, y }));
  // Viereck muss das Blatt halbwegs füllen (sonst Streulicht/Hand) und groß genug sein.
  const a = flaeche(ecken);
  if (a < 0.05 * w * h || n / a < 0.7) return null;
  return { ecken, anteil };
}

export type AusloeserZustand = { stillSeit: number | null; bereit: boolean; letzteBewegung: number };
export const AUSLOESER_START: AusloeserZustand = { stillSeit: null, bereit: true, letzteBewegung: 0 };
export const AUSLOESER = { still: 3, bewegt: 10, stillMs: 900, aenderung: 8 } as const;

/**
 * Auslöser je Blatt: Blatt erkannt + Bild steht ≥ 0,9 s still → auslösen. Danach erst wieder, wenn sich etwas bewegt
 * hat (Hand legt das nächste Blatt) und das neue Standbild sich vom zuletzt aufgenommenen unterscheidet.
 */
export function ausloeserSchritt(z: AusloeserZustand, m: { bewegung: number; blatt: boolean; abstandZumLetzten: number | null }, jetzt: number): { zustand: AusloeserZustand; ausloesen: boolean } {
  let { stillSeit, bereit } = z;
  const letzteBewegung = m.bewegung >= AUSLOESER.bewegt ? jetzt : z.letzteBewegung;
  if (!bereit && m.bewegung >= AUSLOESER.bewegt) bereit = true;
  if (m.bewegung <= AUSLOESER.still && m.blatt) stillSeit ??= jetzt;
  else stillSeit = null;
  const neuesBild = m.abstandZumLetzten === null || m.abstandZumLetzten >= AUSLOESER.aenderung;
  if (bereit && stillSeit !== null && jetzt - stillSeit >= AUSLOESER.stillMs && neuesBild) {
    return { zustand: { stillSeit: null, bereit: false, letzteBewegung }, ausloesen: true };
  }
  return { zustand: { stillSeit, bereit, letzteBewegung }, ausloesen: false };
}

/** Homographie, die die vier Punkte `von` auf `nach` abbildet (8×8-Gleichungssystem, Gauß). */
export function homographie(von: Punkt[], nach: Punkt[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = von[i], { x: u, y: v } = nach[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error("Ecken liegen auf einer Linie.");
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

export const abbilden = (H: number[], p: Punkt): Punkt => {
  const d = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d };
};

const abstand = (a: Punkt, b: Punkt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Zielgröße des entzerrten Bildes aus den Kantenlängen (lange Kante höchstens `maxLang` Pixel). */
export function zielGroesse(ecken: Punkt[], maxLang = 2200): { w: number; h: number } {
  const [tl, tr, br, bl] = ecken;
  const w0 = (abstand(tl, tr) + abstand(bl, br)) / 2;
  const h0 = (abstand(tl, bl) + abstand(tr, br)) / 2;
  const f = Math.min(1, maxLang / Math.max(w0, h0, 1));
  return { w: Math.max(1, Math.round(w0 * f)), h: Math.max(1, Math.round(h0 * f)) };
}

/**
 * Entzerren: für jedes Zielpixel die Stelle im Quellbild (inverse Homographie, nächster Nachbar). Ecken im
 * Maßstab des Quellbildes. RGBA rein, RGBA raus.
 */
export function entzerren(quelle: { daten: Uint8ClampedArray | Uint8Array; w: number; h: number }, ecken: Punkt[], ziel: { w: number; h: number }): Uint8ClampedArray<ArrayBuffer> {
  const H = homographie([{ x: 0, y: 0 }, { x: ziel.w - 1, y: 0 }, { x: ziel.w - 1, y: ziel.h - 1 }, { x: 0, y: ziel.h - 1 }], ecken);
  const out = new Uint8ClampedArray(new ArrayBuffer(ziel.w * ziel.h * 4));
  for (let y = 0; y < ziel.h; y++) {
    for (let x = 0; x < ziel.w; x++) {
      const d = H[6] * x + H[7] * y + H[8];
      const sx = Math.round((H[0] * x + H[1] * y + H[2]) / d), sy = Math.round((H[3] * x + H[4] * y + H[5]) / d);
      const o = (y * ziel.w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= quelle.w || sy >= quelle.h) { out[o + 3] = 255; continue; }
      const q = (sy * quelle.w + sx) * 4;
      out[o] = quelle.daten[q]; out[o + 1] = quelle.daten[q + 1]; out[o + 2] = quelle.daten[q + 2]; out[o + 3] = 255;
    }
  }
  return out;
}

/** Ecken aus dem verkleinerten Analysebild auf das volle Bild hochrechnen. */
export const eckenSkalieren = (ecken: Punkt[], f: number) => ecken.map((p) => ({ x: p.x * f, y: p.y * f }));

// ── 2) KI ─────────────────────────────────────────────────────────────────────

export const BELEG_ARTEN = ["rechnung", "kassenzettel", "lieferschein", "gutschrift", "sonstiges"] as const;
export type BelegArt = (typeof BELEG_ARTEN)[number];
export type Position = { asin: string | null; ean: string | null; artikel: string | null; menge: number | null; ek: number | null };
export type BelegFakten = {
  art: BelegArt;
  lieferant: string | null;
  nummer: string | null;
  bestellnummer: string | null;
  datum: string | null;
  netto: number | null;
  brutto: number | null;
  ust: { satz: number; betrag: number }[];
  positionen: Position[];
  zahlungszielTage: number | null;
  faelligAm: string | null;
  zahlungsart: string | null;
  /** Blatt ohne eigenen Rechnungskopf (Fortsetzung der vorigen Seite). */
  folgeseite: boolean;
  unsicher: string[];
};
export const FELDER_UNSICHER = ["lieferant", "nummer", "datum", "netto", "brutto", "ust", "positionen", "zahlungsziel", "zahlungsart"] as const;

const FELDER_JSON = `{"art":"rechnung|kassenzettel|lieferschein|gutschrift|sonstiges","lieferant":"Firma bzw. Händler","rechnungsnummer":"…","bestellnummer":"… oder null","datum":"JJJJ-MM-TT","netto":12.34,"brutto":14.68,"ust":[{"satz":19,"betrag":2.34}],"positionen":[{"asin":"B0… oder null","ean":"13 Ziffern oder null","artikel":"Bezeichnung","menge":2,"ek":6.17}],"zahlungsziel_tage":14,"faellig_am":"JJJJ-MM-TT oder null","zahlungsart":"Karte|Bar|Überweisung|PayPal|… oder null","unsicher":["datum"]}`;

/** Kamera: ein Blatt (Foto, entzerrt). Erste Zeile ist die Erkennungsmarke für den Testdienst. */
export const STATION_PROMPT = `Lies den Beleg von der Rechnungsstation (Foto eines Blatts: Rechnung, Kassenzettel, Lieferschein oder Gutschrift).
Lies NUR ab, was dort steht – nichts erfinden, nichts rechnen außer zum Prüfen. Antworte ausschließlich mit JSON:
${FELDER_JSON.replace(/}$/, ',"folgeseite":false}')}
- "unsicher": Felder, die schlecht lesbar oder geraten sind (lieferant, nummer, datum, netto, brutto, ust, positionen, zahlungsziel, zahlungsart).
- Kassenzettel (Thermopapier): Datum, Händler, Brutto, USt-Sätze (7/19 %) und Zahlungsart; Positionen nur, wenn lesbar.
- "folgeseite": true, wenn das Blatt keinen eigenen Rechnungskopf hat (Seite 2 einer Rechnung) – dann Rechnungsnummer nur, wenn sie oben/unten steht.
Unlesbares als null. Ist es kein Beleg: {"art":"sonstiges","unsicher":["lieferant","brutto","datum"]}`;

/** Einzugsscanner: eine PDF mit vielen Belegen – an den Rechnungsnummern trennen und je Beleg lesen. */
export const PDF_STAPEL_PROMPT = (seiten: number, ab = 1) => `Lies den PDF-Stapel vom Einzugsscanner (${seiten} Seiten${ab > 1 ? `, Seite 1 dieses Teils = Seite ${ab} des Stapels` : ""}). Er enthält mehrere Belege hintereinander.
Trenne an den Rechnungsnummern bzw. Rechnungsköpfen: Seiten mit derselben Rechnungsnummer (Seite 2 ohne eigenen Kopf) gehören zum selben Beleg.
Lies NUR ab, was dort steht – nichts erfinden. Antworte ausschließlich mit JSON:
{"belege":[{"seiten":[1,2],${FELDER_JSON.slice(1)}]}
Jede Seite gehört zu genau einem Beleg; Seitenzahlen beziehen sich auf diesen Teil (1 = erste Seite). Unlesbares als null.`;

const zahl = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[€\s]/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const text = (v: unknown, max = 120) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, max) : null);
const iso = (v: unknown, heute: Date) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "2000-01-01" && new Date(v) <= new Date(heute.getTime() + 400 * 86_400_000) ? v : null);

function jsonAus(antwort: string): Record<string, unknown> | null {
  const s = antwort.indexOf("{"), e = antwort.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(antwort.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Ein Beleg-Objekt aus der KI-Antwort prüfen (Unsinniges fällt weg, Datum in der Zukunft = unsicher). */
export function faktenAus(o: Record<string, unknown>, heute = new Date()): BelegFakten {
  const art = (BELEG_ARTEN as readonly string[]).includes(String(o.art)) ? (o.art as BelegArt) : "sonstiges";
  const unsicher = new Set((Array.isArray(o.unsicher) ? o.unsicher : []).map(String).filter((f) => (FELDER_UNSICHER as readonly string[]).includes(f)));
  const datum = iso(o.datum, heute);
  if (o.datum && !datum) unsicher.add("datum");
  if (datum && datum > heute.toISOString().slice(0, 10)) unsicher.add("datum");
  const ust = (Array.isArray(o.ust) ? o.ust : [])
    .map((u) => ({ satz: zahl((u as Record<string, unknown>)?.satz) ?? NaN, betrag: zahl((u as Record<string, unknown>)?.betrag) ?? NaN }))
    .filter((u) => Number.isFinite(u.satz) && Number.isFinite(u.betrag) && u.satz >= 0 && u.satz <= 25);
  const positionen = (Array.isArray(o.positionen) ? o.positionen : []).slice(0, 200).map((p0) => {
    const p = (p0 ?? {}) as Record<string, unknown>;
    const asin = text(p.asin, 10)?.toUpperCase() ?? null;
    const ean = text(p.ean, 14)?.replace(/\D/g, "") ?? null;
    return { asin: asin && /^B0[A-Z0-9]{8}$/.test(asin) ? asin : null, ean: ean && /^\d{8,14}$/.test(ean) ? ean : null, artikel: text(p.artikel, 200), menge: zahl(p.menge), ek: zahl(p.ek) };
  });
  const brutto = zahl(o.brutto);
  const tage = zahl(o.zahlungsziel_tage);
  return {
    art,
    lieferant: text(o.lieferant),
    nummer: text(o.rechnungsnummer, 60),
    bestellnummer: text(o.bestellnummer, 60),
    datum,
    netto: zahl(o.netto),
    brutto: brutto !== null && Math.abs(brutto) < 10_000_000 ? brutto : null,
    ust,
    positionen,
    zahlungszielTage: tage !== null && tage >= 0 && tage <= 365 ? Math.round(tage) : null,
    faelligAm: iso(o.faellig_am, heute),
    zahlungsart: text(o.zahlungsart, 30),
    folgeseite: o.folgeseite === true,
    unsicher: [...unsicher],
  };
}

export function stationAntwortLesen(antwort: string, heute = new Date()): BelegFakten | null {
  const o = jsonAus(antwort);
  return o ? faktenAus(o, heute) : null;
}

/**
 * PDF-Stapel: Belege mit Seitenbereichen. Jede Seite genau einmal; nicht genannte Seiten werden eigene (rote)
 * Belege, damit nichts verloren geht. Seiten werden auf den ganzen Stapel umgerechnet (`ab`).
 */
export function stapelAntwortLesen(antwort: string, seiten: number, ab = 1, heute = new Date()): { seiten: number[]; fakten: BelegFakten | null }[] {
  const o = jsonAus(antwort);
  const belege = Array.isArray(o?.belege) ? (o!.belege as Record<string, unknown>[]) : [];
  const vergeben = new Set<number>();
  const out: { seiten: number[]; fakten: BelegFakten | null }[] = [];
  for (const b of belege) {
    const s = (Array.isArray(b?.seiten) ? b.seiten : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= seiten && !vergeben.has(n));
    if (!s.length) continue;
    s.sort((a, c) => a - c).forEach((n) => vergeben.add(n));
    out.push({ seiten: s.map((n) => n + ab - 1), fakten: faktenAus(b, heute) });
  }
  for (let n = 1; n <= seiten; n++) if (!vergeben.has(n)) out.push({ seiten: [n + ab - 1], fakten: null });
  return out.sort((a, c) => a.seiten[0] - c.seiten[0]);
}

// ── 3) Ampel, Mehrseiter, Duplikate, Zuordnung ───────────────────────────────

export type Ampel = "gruen" | "gelb" | "rot";
export const AMPEL_TEXT: Record<Ampel, string> = { gruen: "klar", gelb: "unsicher", rot: "unklar" };

/** Rechnungsnummer vergleichbar machen (Groß, nur Buchstaben/Ziffern). */
export const nummerNorm = (n: string | null | undefined) => (n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Rot = nicht automatisch weitergeben (Prüfung nötig): kein Beleg, Betrag oder Datum fehlt, Duplikat.
 * Gelb = gelesen, aber Felder unsicher oder Summen passen nicht → sofort an Stotax, mit Vermerk.
 */
export function ampelVon(f: BelegFakten | null, o: { duplikat?: boolean } = {}): { ampel: Ampel; gruende: string[] } {
  if (!f) return { ampel: "rot", gruende: ["nicht gelesen"] };
  const rot: string[] = [];
  if (f.art === "sonstiges") rot.push("kein Beleg erkannt");
  if (f.brutto === null) rot.push("Betrag fehlt");
  if (!f.datum) rot.push("Datum fehlt");
  if (!f.lieferant) rot.push("Lieferant fehlt");
  if (o.duplikat) rot.push("Rechnungsnummer schon erfasst");
  if (rot.length) return { ampel: "rot", gruende: rot };
  const gelb: string[] = f.unsicher.map((u) => `${u} unsicher`);
  if (f.art !== "kassenzettel" && f.art !== "lieferschein" && !f.nummer) gelb.push("Rechnungsnummer fehlt");
  if (f.netto !== null && f.brutto !== null && f.ust.length) {
    const summe = f.netto + f.ust.reduce((s, u) => s + u.betrag, 0);
    if (Math.abs(summe - f.brutto) > 0.05) gelb.push("Netto + USt ≠ Brutto");
  }
  return gelb.length ? { ampel: "gelb", gruende: gelb } : { ampel: "gruen", gruende: [] };
}

/** Mehrseiter: zweites Blatt ≤ 5 s nach dem vorigen mit gleicher Rechnungsnummer (oder Folgeseite ohne Kopf). */
export const MEHRSEITER_MS = 5000;
export function gehoertZumVorigen(vorher: { nummer: string | null; aufgenommenAm: number } | null, neu: { nummer: string | null; folgeseite: boolean; aufgenommenAm: number }): boolean {
  if (!vorher) return false;
  const dt = neu.aufgenommenAm - vorher.aufgenommenAm;
  if (dt < 0 || dt > MEHRSEITER_MS) return false;
  const a = nummerNorm(vorher.nummer), b = nummerNorm(neu.nummer);
  return (a !== "" && a === b) || (neu.folgeseite && b === "");
}

/** Zwei Belegfakten (Seite 1 + Folgeseite) zusammenführen: Kopf von Seite 1, Summen von der letzten Seite. */
export function seitenZusammen(a: BelegFakten, b: BelegFakten): BelegFakten {
  return {
    ...a,
    netto: b.netto ?? a.netto,
    brutto: b.brutto ?? a.brutto,
    ust: b.ust.length ? b.ust : a.ust,
    positionen: [...a.positionen, ...b.positionen],
    zahlungszielTage: a.zahlungszielTage ?? b.zahlungszielTage,
    faelligAm: a.faelligAm ?? b.faelligAm,
    zahlungsart: a.zahlungsart ?? b.zahlungsart,
    unsicher: [...new Set([...a.unsicher, ...b.unsicher])],
  };
}

const woerter = (s: string | null | undefined) =>
  new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !["gmbh", "ag", "kg", "co", "ug", "mbh", "ohg", "ek", "e", "k", "de", "eu", "sarl", "ltd", "inc", "the", "und"].includes(w)),
  );

/** Namensähnlichkeit 0–1 (Anteil gemeinsamer Wörter, Rechtsform egal). */
export function namensNaehe(a: string | null | undefined, b: string | null | undefined): number {
  const x = woerter(a), y = woerter(b);
  if (!x.size || !y.size) return 0;
  let g = 0;
  for (const w of x) if (y.has(w) || [...y].some((v) => v.length >= 4 && w.length >= 4 && (v.startsWith(w) || w.startsWith(v)))) g++;
  return g / Math.min(x.size, y.size);
}

export type Kandidat = { art: "bestellung" | "b2b"; id: string; text: string; lieferant: string | null; betrag: number | null; datum: string | null; nummer: string | null };
const tageZwischen = (a: string, b: string) => Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000;

/** Punktzahl 0–1: Lieferant (40 %), Betrag (40 %), Datum (20 %); gleiche Bestellnummer zählt voll. */
export function zuordnungsPunkte(f: Pick<BelegFakten, "lieferant" | "brutto" | "netto" | "datum" | "bestellnummer" | "nummer">, k: Kandidat): number {
  if (k.nummer && (nummerNorm(k.nummer) === nummerNorm(f.bestellnummer) || nummerNorm(k.nummer) === nummerNorm(f.nummer)) && nummerNorm(k.nummer).length >= 4) return 1;
  const name = namensNaehe(f.lieferant, k.lieferant);
  let betrag = 0;
  const soll = k.betrag;
  if (soll !== null) {
    const ist = k.art === "b2b" ? (f.netto ?? f.brutto) : (f.brutto ?? f.netto);
    if (ist !== null) {
      const d = Math.abs(ist - soll);
      betrag = d <= Math.max(0.05, soll * 0.005) ? 1 : d <= soll * 0.03 ? 0.5 : 0;
    }
  }
  let datum = 0;
  if (f.datum && k.datum) {
    const t = tageZwischen(f.datum, k.datum);
    datum = t <= 3 ? 1 : t <= 14 ? 0.6 : t <= 45 ? 0.3 : 0;
  }
  return Math.round((0.4 * name + 0.4 * betrag + 0.2 * datum) * 100) / 100;
}

/** Beste Zuordnung: mindestens 0,7 Punkte und eindeutig (Abstand zum Zweiten ≥ 0,1). */
export function besteZuordnung(f: Parameters<typeof zuordnungsPunkte>[0], kandidaten: Kandidat[]): { kandidat: Kandidat; punkte: number } | null {
  const r = kandidaten.map((k) => ({ kandidat: k, punkte: zuordnungsPunkte(f, k) })).sort((a, b) => b.punkte - a.punkte);
  if (!r.length || r[0].punkte < 0.7) return null;
  if (r[1] && r[0].punkte - r[1].punkte < 0.1) return null;
  return r[0];
}

/** Text für die Volltextsuche (VA/`wissen` finden Rechnungen am ASIN). */
export function suchText(f: BelegFakten): string {
  const asins = [...new Set(f.positionen.map((p) => p.asin).filter(Boolean))];
  const eans = [...new Set(f.positionen.map((p) => p.ean).filter(Boolean))];
  return [
    f.art === "kassenzettel" ? "Kassenzettel" : null,
    asins.length ? `ASIN: ${asins.join(", ")}` : null,
    eans.length ? `EAN: ${eans.join(", ")}` : null,
    f.positionen.filter((p) => p.artikel).slice(0, 10).map((p) => `${p.menge ?? "?"}× ${p.artikel}${p.ek !== null ? ` à ${p.ek.toFixed(2).replace(".", ",")} €` : ""}`).join("; ") || null,
    f.zahlungsart ? `bezahlt: ${f.zahlungsart}` : null,
    f.ust.length ? `USt ${f.ust.map((u) => `${u.satz} %`).join("/")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Vermerk für Stotax bei gelben Belegen (automatisch erfasst, Felder unsicher). */
export const stotaxVermerk = (ampel: Ampel, gruende: string[]) => (ampel === "gelb" ? `Vermerk: automatisch erfasst (Rechnungsstation), nicht von Hand geprüft – ${gruende.join(", ")}.` : null);

/** Zusammenfassung am Stapelende. */
export function stapelSumme(belege: { brutto: number | null; ampel: Ampel | null }[]): { n: number; summe: number; unklar: number; gelb: number } {
  return {
    n: belege.length,
    summe: Math.round(belege.reduce((s, b) => s + (b.brutto ?? 0), 0) * 100) / 100,
    unklar: belege.filter((b) => b.ampel === "rot" || b.ampel === null).length,
    gelb: belege.filter((b) => b.ampel === "gelb").length,
  };
}

/** Fälligkeit aus Datum + Zahlungsziel (falls nicht ausdrücklich angegeben). */
export function faelligkeit(f: Pick<BelegFakten, "datum" | "zahlungszielTage" | "faelligAm">): string | null {
  if (f.faelligAm) return f.faelligAm;
  if (!f.datum || f.zahlungszielTage === null) return null;
  const d = new Date(`${f.datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + f.zahlungszielTage);
  return d.toISOString().slice(0, 10);
}

/** Betreff/Text für Mail2Select – mit Vermerk, wenn Felder unsicher waren und niemand geprüft hat. */
export function stotaxMailStation(b: { vendor: string | null; invoiceNumber: string | null; invoiceDate: string | null; totalGross: number | null; totalNet: number | null; ust: { satz: number; betrag: number }[]; zahlungsart: string | null; docType: string; ampel: string | null; pruefGruende: string[]; geprueft: boolean; seiten: number; source: string }) {
  const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const datum = b.invoiceDate ? b.invoiceDate.split("-").reverse().join(".") : null;
  const art = b.docType === "quittung" ? "Kassenbeleg" : b.docType === "gutschrift" ? "Gutschrift" : b.docType === "lieferschein" ? "Lieferschein" : "Rechnung";
  const vermerk = !b.geprueft ? stotaxVermerk((b.ampel as Ampel) ?? "gelb", b.pruefGruende) : null;
  return {
    subject: [art, datum, b.vendor, b.invoiceNumber, b.totalGross !== null ? euro(b.totalGross) : null].filter(Boolean).join(" – "),
    text: [
      `${art}${b.vendor ? ` von ${b.vendor}` : ""}${datum ? ` vom ${datum}` : ""}${b.invoiceNumber ? `, Nr. ${b.invoiceNumber}` : ""}`,
      b.totalGross !== null ? `Brutto: ${euro(b.totalGross)}${b.totalNet !== null ? ` · Netto: ${euro(b.totalNet)}` : ""}${b.ust.length ? ` (${b.ust.map((u) => `USt ${u.satz} %: ${euro(u.betrag)}`).join(", ")})` : ""}` : "",
      b.zahlungsart ? `Bezahlt: ${b.zahlungsart}` : "",
      b.seiten > 1 ? `${b.seiten} Seiten` : "",
      vermerk ?? (b.geprueft ? "Von Hand geprüft." : ""),
      `Erfasst mit der Rechnungsstation (${b.source === "ordner" ? "Einzugsscanner" : "Kamera"}) des Seller-Systems.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
