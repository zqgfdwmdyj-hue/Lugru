"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { activeItem, MAX_FAVORITEN, NAV_OPEN_COOKIE, navCounters, startOffen, visibleNav, type NavCounts, type NavItem, type NavSection } from "@/lib/nav";
import type { Favorite } from "@/db/schema";

export type { NavCounts };

export type NavAccess = { isOwner: boolean; areas: string[] | null; privateAccess?: boolean };

/** Sichtbare Bereiche für diese Person – gleiche Regeln wie im Proxy (canAccess). */
export function useNav({ isOwner, areas, privateAccess = false }: NavAccess) {
  const pathname = usePathname();
  const search = useSearchParams();
  const sections = useMemo(() => visibleNav((p) => canAccess({ role: isOwner ? "owner" : "staff", areas, privateAccess }, areaForPath(p)), isOwner), [isOwner, areas, privateAccess]);
  const active = activeItem(sections, pathname, search);
  return { pathname, search, sections, active };
}

function Badge({ item, counts }: { item: Pick<NavItem, "badge" | "alert">; counts: NavCounts }) {
  const n = item.badge ? counts[item.badge] : 0;
  if (!n) return null;
  return <span className={`nav-badge${item.alert ? "" : " quiet"}`}>{n}</span>;
}

const merken = (offen: Set<string>) => {
  document.cookie = `${NAV_OPEN_COOKIE}=${[...offen].filter((k) => k !== "privat").join(",")}; path=/; max-age=31536000; samesite=lax`;
};

/**
 * Seitenleiste: Favoriten (bis 6) ganz oben, darunter die Gruppen in fester Reihenfolge, auf-/zuklappbar – der Zustand
 * wird gemerkt (Cookie, damit schon der Server ihn zeichnet). Im Privatbereich sind die geschäftlichen Gruppen zu und der
 * Privat-Block offen. `schmal`: nur Symbole (Desktop, per CSS) – ein Klick auf ein Symbol klappt die Leiste wieder aus.
 */
export function SidebarNav({ counts, favorites = [], gemerkt = [], privatBereich = false, schmal = false, aufklappen, ...access }: NavAccess & { counts: NavCounts; favorites?: Favorite[]; gemerkt?: string[]; privatBereich?: boolean; schmal?: boolean; aufklappen?: () => void }) {
  const { pathname, search, sections, active } = useNav(access);
  const activeKey = active?.section.key ?? (pathname === "/" ? "heute" : null);
  const [offen, setOffen] = useState<Set<string>>(() => startOffen(gemerkt, activeKey, privatBereich));
  // Neuer Bereich: dessen Gruppe aufklappen (andere bleiben, wie man sie gelassen hat).
  const [letzter, setLetzter] = useState(activeKey);
  if (letzter !== activeKey) {
    setLetzter(activeKey);
    if (activeKey && !offen.has(activeKey) && !privatBereich) setOffen(new Set([...offen, activeKey]));
  }
  // Auf dem Handy das Menü nach dem Seitenwechsel wieder schließen.
  useEffect(() => {
    const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [pathname, search]);

  const toggle = (key: string) => {
    const next = new Set(offen);
    // Schmale Leiste (nur Symbole, Desktop): Klick auf ein Symbol klappt die Leiste aus und öffnet die Gruppe.
    if (schmal && aufklappen && window.matchMedia("(min-width: 901px)").matches) {
      aufklappen();
      next.add(key);
    } else if (next.has(key)) next.delete(key);
    else next.add(key);
    setOffen(next);
    if (!privatBereich) merken(next);
  };

  const counters = navCounters(sections, counts);
  const isActive = (s: NavSection, it: NavItem) => active?.section.key === s.key && active.item.href === it.href;
  const currentHref = `${pathname}${search.toString() ? `?${search}` : ""}`;
  const favs = favorites.slice(0, MAX_FAVORITEN);

  return (
    <nav aria-label="Hauptnavigation" className="main-nav">
      {favs.length > 0 && (
        <div className="nav-favs" data-testid="nav-favorites">
          <div className="nav-favs-head">★ Favoriten</div>
          {favs.map((f) => (
            <Link key={f.href} href={f.href} className={`nav-link${f.href === currentHref ? " active" : ""}`} aria-current={f.href === currentHref ? "true" : undefined}>
              <span>{f.label}</span>
            </Link>
          ))}
        </div>
      )}
      {counters.length > 0 && !privatBereich && (
        <div className="nav-counters" data-testid="nav-counters">
          {counters.map((c) => (
            <Link key={c.href} href={c.href} className={`nav-counter${c.alert ? " alert" : ""}`} style={{ ["--g" as string]: c.color }} title={`${c.label}: ${c.n}${c.alert ? " – Handlungsbedarf" : ""}`}>
              <span>{c.label}</span>
              <b>{c.n}</b>
            </Link>
          ))}
        </div>
      )}
      {sections.map((s) => {
        const color = { ["--g" as string]: s.color };
        const current = activeKey === s.key;
        const isOpen = offen.has(s.key);
        const sum = s.items.reduce((n, it) => n + (it.badge ? counts[it.badge] : 0), 0);
        const alert = s.items.some((it) => it.alert && it.badge && counts[it.badge] > 0);
        return (
          <div key={s.key} className={`nav-group${current ? " current" : ""}${isOpen ? " open" : ""}${s.key === "privat" ? " nav-privat" : ""}`} style={color} data-section={s.key}>
            <button type="button" className="nav-head" aria-expanded={isOpen} aria-controls={`nav-${s.key}`} onClick={() => toggle(s.key)} title={s.label}>
              <span>{s.icon && <span className="nav-ico" aria-hidden="true">{s.icon}</span>}{s.label}</span>
              <span className="nav-head-end">
                {!isOpen && sum > 0 && <span className={`nav-badge${alert ? "" : " quiet"}`}>{sum}</span>}
                <span className="nav-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
              </span>
            </button>
            {/* Eingeklappt bleiben die Links im Dokument (versteckt) – Suche, Tests und Bildschirmleser finden sie. */}
            <div id={`nav-${s.key}`} hidden={!isOpen}>
              {s.items.map((it) => (
                <Link key={it.href} href={it.href} className={`nav-link${isActive(s, it) ? " active" : ""}`} aria-current={isActive(s, it) ? "page" : undefined}>
                  <span>{it.label}</span>
                  <Badge item={it} counts={counts} />
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
