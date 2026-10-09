import { sparkPath, type PricePoint } from "@/lib/suppliers/prices";

/** Kleine Treppenkurve für Preisverläufe (EK/VK). */
export function Spark({ points, w = 80, h = 18, color = "var(--accent, #0f766e)" }: { points: PricePoint[]; w?: number; h?: number; color?: string }) {
  const d = sparkPath(points, w, h);
  if (!d) return <span className="muted small">–</span>;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Preisverlauf" style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

/** „vor 5 Min“, „vor 3 h“, „vor 16 T“. */
export function ago(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return "–";
  const min = Math.max(0, Math.round((now - new Date(d).getTime()) / 60_000));
  if (min < 60) return `vor ${min} Min`;
  if (min < 48 * 60) return `vor ${Math.round(min / 60)} h`;
  return `vor ${Math.round(min / 1440)} T`;
}
