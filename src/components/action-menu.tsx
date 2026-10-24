"use client";

import { useEffect, useRef } from "react";

/**
 * „⋯“-Menü für seltene Aktionen einer Zeile (die häufige Aktion bleibt sichtbar daneben).
 * Schließt bei Klick daneben oder mit Escape.
 */
export function ActionMenu({ children, label = "⋯", title = "Weitere Aktionen", testid }: { children: React.ReactNode; label?: string; title?: string; testid?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="action-menu" data-testid={testid}>
      <summary aria-label={title} title={title}>{label}</summary>
      <div className="action-menu-list" role="menu">{children}</div>
    </details>
  );
}
