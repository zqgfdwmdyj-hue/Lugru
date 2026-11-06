"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toggleFavoriteAction } from "@/app/(app)/nav-actions";
import type { Favorite } from "@/db/schema";
import { MAX_FAVORITEN } from "@/lib/nav";
import { BefehlsSuche } from "./befehls-suche";
import { useNav, type NavAccess } from "./sidebar-nav";

export type Glocke = { neu: number; liste: { id: string; titel: string; text: string; link: string | null; zeit: string }[] };

function StarButton({ on, voll }: { on: boolean; voll: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`fav-toggle${on ? " on" : ""}`} disabled={pending || (!on && voll)} aria-pressed={on} title={on ? "Aus Favoriten entfernen" : voll ? `Höchstens ${MAX_FAVORITEN} Favoriten – erst einen entfernen` : "Als Favorit merken"} data-testid="fav-toggle">
      <span aria-hidden="true">{on ? "★" : "☆"}</span>
      <span className="fav-toggle-text">{on ? "Favorit" : "Merken"}</span>
    </button>
  );
}

/**
 * Bezeichnung für einen Favoriten: auf einer Menü-Seite der Menüpunkt plus aktive Filter
 * („Aufträge & Versand · Label erstellt“), auf Unterseiten (Details) die Überschrift der Seite.
 */
function favoriteLabel(pathname: string, search: string, itemHref?: string, itemLabel?: string): string {
  const h1 = document.querySelector("main h1")?.textContent?.trim();
  if (!itemHref || !itemLabel) return h1 || pathname;
  if (pathname !== itemHref.split("?")[0]) return h1 || itemLabel;
  const own = new URLSearchParams(itemHref.split("?")[1] ?? "");
  if ([...new URLSearchParams(search).keys()].every((k) => own.has(k))) return itemLabel;
  const chips = [...document.querySelectorAll("main .chip.active")]
    .map((c) => (c.textContent ?? "").replace(/\s*·\s*\d+\s*$/, "").trim())
    .filter((t) => t && t !== "Alle" && t !== itemLabel);
  return [itemLabel, ...new Set(chips)].join(" · ");
}

/**
 * Oben nur noch: Suche (⌘K / Strg+K), Stern (aktuelle Seite als Favorit), Glocke (Pushs) und Benutzer.
 * Keine zweite Menüzeile – Bereiche und Seiten stehen in der Seitenleiste.
 */
export function TopBar({ favorites, canFavorite, glocke, name, firma, owner, abmelden, serverSuche, privatBereich, ...access }: NavAccess & { favorites: Favorite[]; canFavorite: boolean; glocke: Glocke; name: string; firma: string; owner: boolean; abmelden: React.ReactNode; serverSuche: boolean; privatBereich: boolean }) {
  const { pathname, search, sections, nebenseiten, active } = useNav(access);
  const label = useRef<HTMLInputElement>(null);
  const [neu, setNeu] = useState(glocke.neu);
  const href = `${pathname}${search.toString() ? `?${search}` : ""}`;
  const isFav = favorites.some((f) => f.href === href);
  const [istMac, setIstMac] = useState(false);
  useEffect(() => setIstMac(/mac|iphone|ipad/i.test(navigator.platform)), []);
  return (
    <div className="top-bar" data-testid="top-bar">
      <button type="button" className="bs-knopf" onClick={() => window.dispatchEvent(new Event("befehls-suche"))} data-testid="bs-knopf" aria-label="Suchen">
        <span aria-hidden="true">🔍</span>
        <span className="bs-knopf-text">Seite, ASIN, Aufgabe …</span>
        <kbd className="bs-kbd">{istMac ? "⌘K" : "Strg+K"}</kbd>
      </button>
      <BefehlsSuche sections={sections} nebenseiten={nebenseiten} favorites={favorites} serverSuche={serverSuche} />
      <div className="top-bar-rechts">
        {canFavorite && !privatBereich && (
          <form
            action={toggleFavoriteAction}
            className="fav-form"
            onSubmit={() => {
              if (label.current) label.current.value = favoriteLabel(pathname, search.toString(), active?.item.href, active?.item.label).slice(0, 80);
            }}
          >
            <input type="hidden" name="href" value={href} />
            <input type="hidden" name="label" ref={label} defaultValue={active?.item.label ?? ""} />
            <StarButton on={isFav} voll={favorites.length >= MAX_FAVORITEN} />
          </form>
        )}
        <details
          className="glocke"
          data-testid="glocke"
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open && neu > 0) {
              setNeu(0);
              void fetch("/api/meldungen/gesehen", { method: "POST" }).catch(() => null);
            }
          }}
        >
          <summary aria-label={`Meldungen${neu ? `: ${neu} neu` : ""}`} title="Meldungen (Pushs)">
            <span aria-hidden="true">🔔</span>
            {neu > 0 && <span className="glocke-zahl" data-testid="glocke-zahl">{neu > 99 ? "99+" : neu}</span>}
          </summary>
          <div className="glocke-liste">
            {glocke.liste.length === 0 && <div className="small muted" style={{ padding: 10 }}>Noch keine Meldungen.</div>}
            {glocke.liste.map((m) => {
              const inhalt = (
                <>
                  <strong>{m.titel}</strong>
                  <span className="small">{m.text.split("\n")[0].slice(0, 140)}</span>
                  <span className="small muted">{m.zeit}</span>
                </>
              );
              return m.link?.startsWith("/") ? (
                <Link key={m.id} href={m.link} className="glocke-eintrag">{inhalt}</Link>
              ) : (
                <div key={m.id} className="glocke-eintrag">{inhalt}</div>
              );
            })}
          </div>
        </details>
        <details className="benutzer" data-testid="benutzer">
          <summary title={`${name} · ${firma}`}>
            <span className="benutzer-kreis" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
            <span className="benutzer-name">{name}</span>
          </summary>
          <div className="benutzer-menue">
            <div className="small muted">{firma}</div>
            {owner && <Link href="/einstellungen">Einstellungen</Link>}
            {owner && <Link href="/einstellungen/shop-profile">Shop-Profile & Payback</Link>}
            {abmelden}
          </div>
        </details>
      </div>
    </div>
  );
}
