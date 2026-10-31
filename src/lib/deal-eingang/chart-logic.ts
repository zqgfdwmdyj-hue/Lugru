// Keepa-Mini-Chart der Detailseite (Abschnitt 5): Buy Box der letzten 90 Tage als Linie, Ø und Tief im Zeitraum.
// Nur aus dem Zwischenspeicher – das Ansehen einer Seite kostet keine Keepa-Tokens.

export type VerlaufZeile = [tag: string, buybox: number | null, amazon: number | null, angebote: number | null, rang: number | null];
export type MiniChart = { pfad: string; amazonPfad: string | null; min: number; max: number; schnitt: number; letzter: number; von: string; bis: string; tage: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Linie als SVG-Pfad (x = Tag im Zeitraum, y = Preis; oben = teuer). null bei weniger als 2 Werten. */
export function miniChart(verlauf: VerlaufZeile[], o: { bis: string; tage?: number; breite?: number; hoehe?: number }): MiniChart | null {
  const tage = o.tage ?? 90;
  const w = o.breite ?? 280;
  const h = o.hoehe ?? 60;
  const ende = Date.parse(`${o.bis}T00:00:00Z`);
  const start = ende - tage * 86_400_000;
  const von = new Date(start).toISOString().slice(0, 10);
  const zeilen = verlauf.filter((r) => r[0] >= von && r[0] <= o.bis);
  const bb = zeilen.filter((r) => typeof r[1] === "number" && r[1]! > 0) as [string, number, number | null, number | null, number | null][];
  if (bb.length < 2) return null;
  const amz = zeilen.filter((r) => typeof r[2] === "number" && r[2]! > 0);
  const werte = [...bb.map((r) => r[1]), ...amz.map((r) => r[2]!)];
  const min = Math.min(...werte);
  const max = Math.max(...werte);
  const span = max - min || 1;
  const x = (tag: string) => r2(((Date.parse(`${tag}T00:00:00Z`) - start) / (ende - start)) * w);
  const y = (v: number) => r2(h - 2 - ((v - min) / span) * (h - 4));
  const pfadAus = (punkte: [string, number][]) => punkte.map(([t, v], i) => `${i ? "L" : "M"}${x(t)} ${y(v)}`).join(" ");
  const bbWerte = bb.map((r) => r[1]);
  return {
    pfad: pfadAus(bb.map((r) => [r[0], r[1]])),
    amazonPfad: amz.length >= 2 ? pfadAus(amz.map((r) => [r[0], r[2]!])) : null,
    min: r2(Math.min(...bbWerte)),
    max: r2(Math.max(...bbWerte)),
    schnitt: r2(bbWerte.reduce((n, v) => n + v, 0) / bbWerte.length),
    letzter: r2(bbWerte[bbWerte.length - 1]),
    von: bb[0][0],
    bis: bb[bb.length - 1][0],
    tage,
  };
}
