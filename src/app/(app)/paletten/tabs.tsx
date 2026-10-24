/** Belegung als Balken (z. B. 38 von 50 Stellplätzen). */
export function Occupancy({ used, capacity }: { used: number; capacity: number }) {
  if (!capacity) return null;
  const pct = Math.min(100, Math.round((used / capacity) * 100));
  const tone = pct >= 95 ? "var(--danger)" : pct >= 80 ? "var(--warn)" : "var(--accent)";
  return (
    <div className="pal-bar" role="meter" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used} aria-label="Belegte Stellplätze">
      <span style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}
