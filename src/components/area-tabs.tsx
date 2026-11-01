"use client";

import Link from "next/link";
import { SUBPAGES, activeSubpage } from "@/lib/nav";
import { useNav, type NavAccess } from "./sidebar-nav";

/**
 * Unterseiten einer Seite (Paletten-Lager, Uhren) als Reiter über dem Inhalt. Bereiche und Seiten stehen nur noch in
 * der Seitenleiste – keine zweite Menüzeile; Stern, Suche und Glocke sitzen in der Leiste oben.
 */
export function AreaTabs(access: NavAccess) {
  const { pathname, search, active } = useNav(access);
  const sub = active ? SUBPAGES[active.item.href] : undefined;
  if (!sub || !active) return null;
  const subOn = activeSubpage(sub, pathname, search);
  return (
    <div className="area-bar" style={{ ["--g" as string]: active.section.color }} data-testid="area-bar" data-area={active.section.key}>
      <span className="area-name">{active.item.label}</span>
      <nav className="area-tabs" aria-label={`${active.item.label}: Unterseiten`} data-testid="sub-tabs">
        {sub.map((it) => {
          const on = subOn?.href === it.href;
          return (
            <Link key={it.href} href={it.href} className={`area-tab${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
