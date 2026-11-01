"use client";

import { useState } from "react";
import { NAV_SCHMAL_COOKIE, type NavCounts } from "@/lib/nav";
import type { Favorite } from "@/db/schema";
import { SidebarNav, type NavAccess } from "./sidebar-nav";

/**
 * Linke Seitenleiste (~240 px), auf dem Desktop einklappbar auf Symbole (gemerkt), auf dem Handy eine Schublade von
 * links (Knopf „Mehr“ in der Tab-Leiste bzw. ☰ oben).
 */
export function AppSidebar({ schmal: start, foot, ...props }: NavAccess & { counts: NavCounts; favorites: Favorite[]; gemerkt: string[]; privatBereich: boolean; schmal: boolean; foot: React.ReactNode }) {
  const [schmal, setSchmal] = useState(start);
  const umschalten = (wert?: boolean) => {
    const neu = wert ?? !schmal;
    setSchmal(neu);
    document.cookie = `${NAV_SCHMAL_COOKIE}=${neu ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector(".shell")?.classList.toggle("shell-schmal", neu);
  };
  return (
    <aside className={`sidebar${schmal ? " schmal" : ""}`} data-testid="seitenleiste">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-mark" src="/icons/mark.svg" alt="" width={28} height={28} />
        <span className="brand-text">Seller-System</span>
        <button type="button" className="nav-einklappen" onClick={() => umschalten()} aria-pressed={schmal} title={schmal ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"} aria-label={schmal ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"} data-testid="nav-einklappen">
          {schmal ? "»" : "«"}
        </button>
      </div>
      <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
      <label htmlFor="nav-toggle" className="nav-burger">☰ Menü</label>
      <label htmlFor="nav-toggle" className="nav-backdrop" aria-hidden="true" />
      <div className="nav-drawer">
        <label htmlFor="nav-toggle" className="nav-close">✕ Schließen</label>
        <SidebarNav {...props} schmal={schmal} aufklappen={() => umschalten(false)} />
        {foot}
      </div>
    </aside>
  );
}
