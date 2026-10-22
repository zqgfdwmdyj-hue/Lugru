import Link from "next/link";

const TABS = [
  { key: "lager", href: "/paletten", label: "Lager" },
  { key: "kunden", href: "/paletten/kunden", label: "Kunden & Preise" },
  { key: "uebersicht", href: "/paletten/uebersicht", label: "Übersicht" },
] as const;

export function PalletTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="Paletten-Lager" data-testid="pal-tabs">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={`chip${t.key === active ? " active" : ""}`} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

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
