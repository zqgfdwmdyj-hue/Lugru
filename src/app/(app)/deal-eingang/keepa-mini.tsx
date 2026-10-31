import type { MiniChart } from "@/lib/deal-eingang/chart-logic";
// Keepa-Mini-Chart (Buy Box, gestrichelt Amazon) aus dem Zwischenspeicher – Deal-Eingang und Lugru Deals.

import { formatEuro } from "@/lib/numbers";

const eur = (n: number | null | undefined) => (n === null || n === undefined ? "–" : formatEuro(n));

export function KeepaMini({ chart, land, stand }: { chart: MiniChart; land: string; stand: Date }) {
  const w = 280;
  const h = 60;
  return (
    <figure style={{ margin: 0 }} data-testid="de-chart" data-land={land}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Buy Box ${land} der letzten ${chart.tage} Tage`} style={{ maxWidth: 420, height: 60, display: "block", background: "var(--surface-2)", borderRadius: 6 }}>
        {chart.amazonPfad && <path d={chart.amazonPfad} fill="none" stroke="var(--c-amazon, #ff9900)" strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
        <path d={chart.pfad} fill="none" stroke="var(--accent, #0f766e)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="small muted">
        Keepa {land}, Buy Box {chart.von.slice(5).split("-").reverse().join(".")}–{chart.bis.slice(5).split("-").reverse().join(".")}: aktuell {eur(chart.letzter)} · Ø {eur(chart.schnitt)} · Tief {eur(chart.min)} · Hoch {eur(chart.max)}
        {chart.amazonPfad ? " · gestrichelt: Amazon" : ""} · Stand {stand.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}
      </figcaption>
    </figure>
  );
}
