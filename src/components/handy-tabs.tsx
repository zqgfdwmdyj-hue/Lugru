"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { HANDY_TABS, matchScore } from "@/lib/nav";
import type { NavAccess } from "./sidebar-nav";

/** Tab-Leiste unten am Handy: Heute · Scan · Deals · Aufgaben · Mehr (öffnet die Schublade mit der ganzen Leiste). */
export function HandyTabs({ isOwner, areas, privateAccess = false }: NavAccess) {
  const pathname = usePathname();
  const search = useSearchParams();
  const darf = (href: string) => canAccess({ role: isOwner ? "owner" : "staff", areas, privateAccess }, areaForPath(href.split("?")[0]));
  const tabs = HANDY_TABS.filter((t) => darf(t.href));
  const scores = tabs.map((t) => matchScore({ href: t.href }, pathname, search));
  const best = Math.max(0, ...scores);
  return (
    <nav className="handy-tabs" aria-label="Schnellzugriff" data-testid="handy-tabs">
      {tabs.map((t, i) => {
        const on = best > 0 && scores[i] === best;
        return (
          <Link key={t.href} href={t.href} className={`handy-tab${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
            <span aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </Link>
        );
      })}
      <label htmlFor="nav-toggle" className="handy-tab" data-testid="handy-mehr">
        <span aria-hidden="true">☰</span>
        <span>Mehr</span>
      </label>
    </nav>
  );
}
