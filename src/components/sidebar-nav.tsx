"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { favoritenSortierenAction } from "@/app/(app)/nav-actions";
import {
  activeItem,
  badgeSumme,
  MAX_FAVORITEN,
  NAV_OPEN_COOKIE,
  navBloecke,
  navCounters,
  sichtbareNebenseiten,
  startZustand,
  visibleNav,
  zustandAlsCookie,
  type NavCounts,
  type NavItem,
  type NavSection,
  type NavZustand,
} from "@/lib/nav";
import type { Favorite } from "@/db/schema";

export type { NavCounts };

export type NavAccess = { isOwner: boolean; areas: string[] | null; privateAccess?: boolean };

/** Sichtbare Bereiche für diese Person – gleiche Regeln wie im Proxy (canAccess). */
export function useNav({ isOwner, areas, privateAccess = false }: NavAccess) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { sections, nebenseiten } = useMemo(() => {
    const allowed = (p: string) => canAccess({ role: isOwner ? "owner" : "staff", areas, privateAccess }, areaForPath(p));
    return { sections: visibleNav(allowed, isOwner), nebenseiten: sichtbareNebenseiten(allowed, isOwner) };
  }, [isOwner, areas, privateAccess]);
  const active = activeItem(sections, pathname, search);
  return { pathname, search, sections, nebenseiten, active };
}

function Zahl({ n, alert }: { n: number; alert: boolean }) {
  if (!n) return null;
  return <span className={`nav-badge${alert ? "" : " quiet"}`}>{n}</span>;
}

const merken = (z: NavZustand) => {
  document.cookie = `${NAV_OPEN_COOKIE}=${zustandAlsCookie(z)}; path=/; max-age=31536000; samesite=lax`;
};

const istDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 901px)").matches;

/** Favoriten (bis 8): per Ziehen sortierbar, mit Tastatur Alt+↑/↓. Die Reihenfolge wird beim Benutzer gespeichert. */
function Favoriten({ favorites, currentHref }: { favorites: Favorite[]; currentHref: string }) {
  const [liste, setListe] = useState(favorites.slice(0, MAX_FAVORITEN));
  const [quelle, setQuelle] = useState(favorites);
  if (quelle !== favorites) {
    setQuelle(favorites);
    setListe(favorites.slice(0, MAX_FAVORITEN));
  }
  const [, starten] = useTransition();
  const ziehe = useRef<number | null>(null);
  const [ueber, setUeber] = useState<number | null>(null);
  const verschiebe = (von: number, nach: number) => {
    if (von === nach || nach < 0 || nach >= liste.length) return;
    const neu = [...liste];
    const [f] = neu.splice(von, 1);
    neu.splice(nach, 0, f);
    setListe(neu);
    starten(() => favoritenSortierenAction(neu.map((x) => x.href)));
  };
  if (!liste.length) return null;
  return (
    <div className="nav-favs" data-testid="nav-favorites">
      <div className="nav-favs-head" title="Ziehen zum Sortieren (oder Alt+↑/↓)">★ Favoriten</div>
      {liste.map((f, i) => (
        <Link
          key={f.href}
          href={f.href}
          draggable
          onDragStart={(e) => {
            ziehe.current = i;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", f.href);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setUeber(i);
          }}
          onDragLeave={() => setUeber((u) => (u === i ? null : u))}
          onDrop={(e) => {
            e.preventDefault();
            setUeber(null);
            if (ziehe.current !== null) verschiebe(ziehe.current, i);
            ziehe.current = null;
          }}
          onDragEnd={() => setUeber(null)}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              verschiebe(i, i + (e.key === "ArrowUp" ? -1 : 1));
            }
          }}
          className={`nav-link nav-fav${f.href === currentHref ? " active" : ""}${ueber === i ? " drop" : ""}`}
          aria-current={f.href === currentHref ? "page" : undefined}
          data-testid="nav-fav"
        >
          <span>{f.label}</span>
          <span className="nav-griff" aria-hidden="true">⋮⋮</span>
        </Link>
      ))}
    </div>
  );
}

const ZULETZT_KEY = "nav-zuletzt";
type Besuch = { href: string; label: string };

/** „Zuletzt besucht“ (5): nur in diesem Browser gemerkt, nie Privat. */
function ZuletztBesucht({ currentHref, label }: { currentHref: string; label: string | null }) {
  const [liste, setListe] = useState<Besuch[]>([]);
  useEffect(() => {
    if (currentHref.startsWith("/privat")) return;
    const lesen = (): Besuch[] => {
      try {
        const v = JSON.parse(localStorage.getItem(ZULETZT_KEY) ?? "[]") as unknown;
        return Array.isArray(v) ? (v as Besuch[]).filter((b) => b && typeof b.href === "string" && typeof b.label === "string") : [];
      } catch {
        return [];
      }
    };
    const schreiben = (b: Besuch[]) => {
      try {
        localStorage.setItem(ZULETZT_KEY, JSON.stringify(b.slice(0, 6)));
      } catch {
        /* Speicher voll oder gesperrt – dann eben ohne Verlauf */
      }
    };
    // Sofort merken (auch bei schnellem Weiterklicken); Detailseiten bekommen die Überschrift nachgetragen.
    const alt = lesen().filter((b) => b.href !== currentHref);
    schreiben([{ href: currentHref, label: (label ?? document.title.split(" – ")[0] ?? currentHref).slice(0, 80) }, ...alt]);
    setListe(alt.slice(0, 5));
    if (label) return;
    const t = setTimeout(() => {
      const h1 = document.querySelector("main h1")?.textContent?.trim();
      if (h1) schreiben(lesen().map((b) => (b.href === currentHref ? { ...b, label: h1.slice(0, 80) } : b)));
    }, 400);
    return () => clearTimeout(t);
  }, [currentHref, label]);
  if (!liste.length) return null;
  return (
    <details className="nav-zuletzt" data-testid="nav-zuletzt">
      <summary>Zuletzt besucht</summary>
      {liste.map((b) => (
        <Link key={b.href} href={b.href} className="nav-link">
          <span>{b.label}</span>
        </Link>
      ))}
    </details>
  );
}

/**
 * Seitenleiste: fester Kopf (Favoriten, „Zuletzt besucht“, Zähler-Chips), darunter die Gruppen als Akkordeon – immer
 * nur eine offen; längere Gruppen haben einklappbare Untergruppen. Beim Seitenwechsel öffnen sich Gruppe und Untergruppe
 * des aktiven Eintrags. Zustand im Cookie (der Server zeichnet ihn gleich richtig). Im Privatbereich ist nur „Privat“
 * offen. `schmal`: nur Gruppen-Symbole; Zeigen/Tippen öffnet ein Flyout mit den Einträgen der Gruppe.
 */
export function SidebarNav({ counts, favorites = [], gemerkt = [], privatBereich = false, schmal = false, ...access }: NavAccess & { counts: NavCounts; favorites?: Favorite[]; gemerkt?: string[]; privatBereich?: boolean; schmal?: boolean }) {
  const { pathname, search, sections, active } = useNav(access);
  const aktivGruppe = active?.section.key ?? (pathname === "/" ? "heute" : null);
  const aktivUnter = active?.item.unter ?? null;
  const [zustand, setZustand] = useState<NavZustand>(() => startZustand(gemerkt, { gruppe: aktivGruppe, unter: aktivUnter }, privatBereich));
  // Seitenwechsel: Gruppe und Untergruppe des aktiven Eintrags öffnen – die anderen Gruppen klappen zu.
  const schluessel = `${aktivGruppe}|${aktivUnter}`;
  const [letzter, setLetzter] = useState(schluessel);
  if (letzter !== schluessel) {
    setLetzter(schluessel);
    if (aktivGruppe && !privatBereich) {
      const unter = new Set(zustand.unter);
      if (aktivUnter) unter.add(`${aktivGruppe}.${aktivUnter}`);
      setZustand({ gruppe: aktivGruppe, unter });
    }
  }
  const [flyout, setFlyout] = useState<{ key: string; top: number } | null>(null);
  const zu = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auf dem Handy das Menü nach dem Seitenwechsel wieder schließen; Flyout schließen.
  useEffect(() => {
    const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
    if (t) t.checked = false;
    setFlyout(null);
  }, [pathname, search]);
  useEffect(() => {
    if (!flyout) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFlyout(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [flyout]);

  const setze = (z: NavZustand) => {
    setZustand(z);
    if (!privatBereich) merken(z);
  };
  const flyoutAuf = (key: string, el: HTMLElement) => {
    if (zu.current) clearTimeout(zu.current);
    setFlyout({ key, top: Math.max(8, Math.min(el.getBoundingClientRect().top, window.innerHeight - 200)) });
  };
  const flyoutZu = () => {
    if (zu.current) clearTimeout(zu.current);
    zu.current = setTimeout(() => setFlyout(null), 180);
  };
  const gruppeKlick = (key: string, el: HTMLElement) => {
    if (schmal && istDesktop()) {
      if (flyout?.key === key) setFlyout(null);
      else flyoutAuf(key, el);
      return;
    }
    setze({ ...zustand, gruppe: zustand.gruppe === key ? null : key });
  };
  const unterKlick = (k: string) => {
    const unter = new Set(zustand.unter);
    if (unter.has(k)) unter.delete(k);
    else unter.add(k);
    setze({ ...zustand, unter });
  };

  const counters = navCounters(sections, counts);
  const isActive = (s: NavSection, it: NavItem) => active?.section.key === s.key && active.item.href === it.href;
  const currentHref = `${pathname}${search.toString() ? `?${search}` : ""}`;
  const link = (s: NavSection, it: NavItem) => (
    <Link key={it.href} href={it.href} className={`nav-link${isActive(s, it) ? " active" : ""}`} aria-current={isActive(s, it) ? "page" : undefined}>
      <span>{it.label}</span>
      {it.badge && <Zahl n={counts[it.badge]} alert={Boolean(it.alert)} />}
    </Link>
  );

  return (
    <nav aria-label="Hauptnavigation" className="main-nav">
      <div className="nav-kopf" data-testid="nav-kopf">
        {!privatBereich && <Favoriten favorites={favorites} currentHref={currentHref} />}
        {!privatBereich && <ZuletztBesucht currentHref={currentHref} label={active && active.item.href.split("?")[0] === pathname ? active.item.label : null} />}
        {counters.length > 0 && !privatBereich && (
          <div className="nav-counters" data-testid="nav-counters">
            {counters.map((c) => (
              <Link key={c.href} href={c.href} className={`nav-counter${c.alert && c.n > 0 ? " alert" : ""}`} style={{ ["--g" as string]: c.color }} title={`${c.label}: ${c.n}${c.alert && c.n > 0 ? " – Handlungsbedarf" : ""}`} data-testid="nav-chip">
                <span>{c.label}</span>
                <b>{c.n}</b>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="nav-gruppen" data-testid="nav-gruppen">
        {sections.map((s) => {
          const color = { ["--g" as string]: s.color };
          const current = aktivGruppe === s.key;
          const isOpen = zustand.gruppe === s.key;
          const summe = badgeSumme(s.items, counts);
          const bloecke = navBloecke(s);
          return (
            <div
              key={s.key}
              className={`nav-group${current ? " current" : ""}${isOpen ? " open" : ""}${s.key === "privat" ? " nav-privat" : ""}`}
              style={color}
              data-section={s.key}
              onMouseEnter={(e) => schmal && istDesktop() && flyoutAuf(s.key, e.currentTarget)}
              onMouseLeave={() => schmal && flyoutZu()}
            >
              <button type="button" className="nav-head" aria-expanded={isOpen} aria-controls={`nav-${s.key}`} onClick={(e) => gruppeKlick(s.key, e.currentTarget)} title={s.label}>
                <span>{s.icon && <span className="nav-ico" aria-hidden="true">{s.icon}</span>}{s.label}</span>
                <span className="nav-head-end">
                  {!isOpen && <Zahl n={summe.n} alert={summe.alert} />}
                  <span className="nav-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                </span>
              </button>
              {/* Eingeklappt bleiben die Links im Dokument (versteckt) – Suche, Tests und Bildschirmleser finden sie. */}
              <div id={`nav-${s.key}`} className="nav-items" hidden={!isOpen}>
                {bloecke.map((b) => {
                  if (!b.unter) return <div key="direkt" className="nav-block">{b.items.map((it) => link(s, it))}</div>;
                  const k = `${s.key}.${b.unter.key}`;
                  const uOffen = zustand.unter.has(k);
                  const uSumme = badgeSumme(b.items, counts);
                  return (
                    <div key={k} className={`nav-unter${uOffen ? " open" : ""}${aktivGruppe === s.key && aktivUnter === b.unter.key ? " current" : ""}`} data-unter={b.unter.key}>
                      <button type="button" className="nav-unter-head" aria-expanded={uOffen} aria-controls={`nav-${s.key}-${b.unter.key}`} onClick={() => unterKlick(k)}>
                        <span><span className="nav-caret" aria-hidden="true">{uOffen ? "▾" : "▸"}</span>{b.unter.label}</span>
                        {!uOffen && <Zahl n={uSumme.n} alert={uSumme.alert} />}
                      </button>
                      <div id={`nav-${s.key}-${b.unter.key}`} className="nav-block" hidden={!uOffen}>
                        {b.items.map((it) => link(s, it))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {schmal && flyout?.key === s.key && (
                <div className="nav-flyout" style={{ top: flyout.top }} data-testid="nav-flyout" onMouseEnter={() => zu.current && clearTimeout(zu.current)}>
                  <div className="nav-flyout-head">{s.label}</div>
                  {bloecke.map((b) => (
                    <div key={b.unter?.key ?? "direkt"} className="nav-flyout-block">
                      {b.unter && <div className="nav-flyout-unter">{b.unter.label}</div>}
                      {b.items.map((it) => link(s, it))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
