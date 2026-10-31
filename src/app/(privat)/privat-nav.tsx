"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { FAMILY_TABS, GROUPS, MAIN_NAV } from "./privat/nav-data";

/** Hauptpunkte als gleich breite Felder (am Handy ohne seitliches Scrollen) + „Alle Bereiche“. */
export function PrivatNav({ family }: { family: boolean }) {
  const path = usePathname() ?? "/privat";
  const more = useRef<HTMLDetailsElement>(null);
  // Nach dem Wechsel der Seite „Alle Bereiche“ wieder zuklappen.
  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [path]);
  const main = MAIN_NAV.filter((m) => !family || !("full" in m && m.full));
  const isActive = (key: string, href: string) =>
    key === "heute" ? path === "/privat" : key === "kalender" ? path.startsWith("/privat/kalender") || path.startsWith("/privat/eintrag/") : path.startsWith(href);
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => !family || FAMILY_TABS.has(t.key)) })).filter((g) => g.tabs.length);
  return (
    <>
      <nav className="pnav" aria-label="Privat" data-testid="priv-nav" style={{ gridTemplateColumns: `repeat(${main.length}, minmax(0, 1fr))` }}>
        {main.map((m) => {
          const active = isActive(m.key, m.href);
          return (
            <Link key={m.key} href={m.href} className={`pnav-item${active ? " active" : ""}${m.key === "eintragen" ? " pnav-add" : ""}`} aria-current={active ? "page" : undefined} data-testid={`pnav-${m.key}`}>
              <span className="pnav-icon" aria-hidden="true">{m.icon}</span>
              <span className="pnav-label">{m.label}</span>
            </Link>
          );
        })}
      </nav>
      <details className="pnav-more" ref={more} data-testid="priv-areas">
        <summary>Alle Bereiche</summary>
        <div className="pnav-more-grid">
          {groups.map((g) => (
            <div key={g.key} className="stack" style={{ gap: 4 }}>
              <div className="small muted" style={{ fontWeight: 700 }}>{g.label}</div>
              {g.tabs.map((t) => (
                <Link key={t.key} href={t.href} className="pnav-more-link" aria-current={path === t.href ? "page" : undefined}>{t.label}</Link>
              ))}
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
