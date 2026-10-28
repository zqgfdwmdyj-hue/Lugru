"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { activeItem, NAV_OPEN_COOKIE, navCounters, openSections, visibleNav, type NavCounts, type NavItem, type NavSection } from "@/lib/nav";
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

export function SidebarNav({ counts, favorites = [], ...access }: NavAccess & { counts: NavCounts; favorites?: Favorite[] }) {
  const { pathname, search, sections, active } = useNav(access);
  const activeKey = active?.section.key ?? (pathname === "/" ? "heute" : null);
  // Aufgeklappt: nur der aktuelle Bereich und was man seit dem letzten Bereichswechsel selbst geöffnet hat –
  // früher besuchte Bereiche klappen wieder zu, damit die Leiste kurz bleibt.
  const [manual, setManual] = useState<Set<string>>(() => new Set());
  const [closedActive, setClosedActive] = useState(false);
  const [lastKey, setLastKey] = useState(activeKey);
  if (lastKey !== activeKey) {
    setLastKey(activeKey);
    setManual(new Set());
    setClosedActive(false);
  }
  const open = openSections(activeKey, manual, closedActive);
  // Früher gemerkte, dauerhaft offene Bereiche (Cookie) aufräumen – Favoriten übernehmen diese Rolle.
  useEffect(() => {
    if (document.cookie.includes(`${NAV_OPEN_COOKIE}=`)) document.cookie = `${NAV_OPEN_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }, []);
  // Auf dem Handy das Menü nach dem Seitenwechsel wieder schließen.
  useEffect(() => {
    const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [pathname, search]);

  const toggle = (key: string) => {
    if (key === activeKey) setClosedActive(open.has(key));
    setManual((prev) => {
      const next = new Set(prev);
      if (next.has(key) || key === activeKey) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const main = sections.filter((s) => !s.helper);
  const counters = navCounters(main, counts);
  const helpers = sections.filter((s) => s.helper);
  const isActive = (s: NavSection, it: NavItem) => active?.section.key === s.key && active.item.href === it.href;
  const currentHref = `${pathname}${search.toString() ? `?${search}` : ""}`;

  return (
    <nav aria-label="Hauptnavigation" className="main-nav">
      {counters.length > 0 && (
        <div className="nav-counters" data-testid="nav-counters">
          {counters.map((c) => (
            <Link key={c.href} href={c.href} className={`nav-counter${c.alert ? " alert" : ""}`} style={{ ["--g" as string]: c.color }} title={`${c.label}: ${c.n}${c.alert ? " – Handlungsbedarf" : ""}`}>
              <span>{c.label}</span>
              <b>{c.n}</b>
            </Link>
          ))}
        </div>
      )}
      {favorites.length > 0 && (
        <div className="nav-favs" data-testid="nav-favorites">
          <div className="nav-favs-head">★ Favoriten</div>
          {favorites.map((f) => (
            <Link key={f.href} href={f.href} className={`nav-link${f.href === currentHref ? " active" : ""}`} aria-current={f.href === currentHref ? "true" : undefined}>
              <span>{f.label}</span>
            </Link>
          ))}
        </div>
      )}
      {main.map((s) => {
        const color = { ["--g" as string]: s.color };
        const current = activeKey === s.key;
        // Bereiche, die nur aus sich selbst bestehen (Privat), sind direkt ein Link.
        if (s.items.length === 1 && s.items[0].label === s.label) {
          const it = s.items[0];
          return (
            <div key={s.key} className={`nav-group single${current ? " current" : ""}`} style={color} data-section={s.key}>
              <Link href={it.href} className={`nav-link nav-section-link${current ? " active" : ""}`} aria-current={current ? "page" : undefined}>
                <span>{s.icon && <span className="nav-ico" aria-hidden="true">{s.icon}</span>}{s.label}</span>
                <Badge item={it} counts={counts} />
              </Link>
            </div>
          );
        }
        const isOpen = open.has(s.key);
        const sum = s.items.reduce((n, it) => n + (it.badge ? counts[it.badge] : 0), 0);
        const alert = s.items.some((it) => it.alert && it.badge && counts[it.badge] > 0);
        return (
          <div key={s.key} className={`nav-group${current ? " current" : ""}${isOpen ? " open" : ""}`} style={color} data-section={s.key}>
            <button type="button" className="nav-head" aria-expanded={isOpen} aria-controls={`nav-${s.key}`} onClick={() => toggle(s.key)}>
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
      {helpers.map((s) => (
        <div key={s.key} className="nav-helpers" data-section={s.key}>
          {s.items.map((it) => (
            <Link key={it.href} href={it.href} className={`nav-link small${isActive(s, it) ? " active" : ""}`} aria-current={isActive(s, it) ? "page" : undefined}>
              <span>{it.label}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
