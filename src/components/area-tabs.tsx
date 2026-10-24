"use client";

import Link from "next/link";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { toggleFavoriteAction } from "@/app/(app)/nav-actions";
import type { Favorite } from "@/db/schema";
import { useNav, type NavAccess } from "./sidebar-nav";

function StarButton({ on }: { on: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`fav-toggle${on ? " on" : ""}`} disabled={pending} aria-pressed={on} title={on ? "Aus Favoriten entfernen" : "Als Favorit merken"} data-testid="fav-toggle">
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
  // Ohne eigene Filter in der Adresse: nur der Menüpunkt (Standard-Filter gehören nicht in den Namen).
  const own = new URLSearchParams(itemHref.split("?")[1] ?? "");
  if ([...new URLSearchParams(search).keys()].every((k) => own.has(k))) return itemLabel;
  const chips = [...document.querySelectorAll("main .chip.active")]
    .map((c) => (c.textContent ?? "").replace(/\s*·\s*\d+\s*$/, "").trim())
    .filter((t) => t && t !== "Alle" && t !== itemLabel);
  return [itemLabel, ...new Set(chips)].join(" · ");
}

/**
 * Reiter des aktuellen Bereichs über dem Seiteninhalt (z. B. Finanzen: Gewinn · Cash Flow · Rechnungen …)
 * und der Stern für „als Favorit merken“. Privat hat eigene Reiter.
 */
export function AreaTabs({ favorites = [], canFavorite, ...access }: NavAccess & { favorites?: Favorite[]; canFavorite: boolean }) {
  const { pathname, search, active } = useNav(access);
  const label = useRef<HTMLInputElement>(null);
  if (pathname === "/privat" || pathname.startsWith("/privat/")) return null;
  const section = active?.section;
  const href = `${pathname}${search.toString() ? `?${search}` : ""}`;
  const isFav = favorites.some((f) => f.href === href);
  const tabs = section && !section.helper && section.items.length > 1 ? section.items : [];
  if (!section && !canFavorite) return null;
  return (
    <div className="area-bar" style={{ ["--g" as string]: section?.color ?? "#5b6670" }} data-testid="area-bar">
      {section && !section.helper && <span className="area-name">{section.label}</span>}
      {tabs.length > 0 && (
        <nav className="area-tabs" aria-label={`${section!.label}: Unterseiten`} data-testid="area-tabs">
          {tabs.map((it) => {
            const on = active!.item.href === it.href;
            return (
              <Link key={it.href} href={it.href} className={`area-tab${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
                {it.label}
              </Link>
            );
          })}
        </nav>
      )}
      {canFavorite && (
        <form
          action={toggleFavoriteAction}
          className="fav-form"
          onSubmit={() => {
            if (label.current) label.current.value = favoriteLabel(pathname, search.toString(), active?.item.href, active?.item.label).slice(0, 80);
          }}
        >
          <input type="hidden" name="href" value={href} />
          <input type="hidden" name="label" ref={label} defaultValue={active?.item.label ?? ""} />
          <StarButton on={isFav} />
        </form>
      )}
    </div>
  );
}
