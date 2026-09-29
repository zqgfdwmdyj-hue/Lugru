"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type NavCounts = { tasks: number; inbox: number; orders: number; claims: number; invoices: number; amazonTodos: number };

type Item = { href: string; label: string; badge?: number; alert?: boolean };
type Group = { head?: string; items: Item[] };

export function SidebarNav({ counts, isOwner }: { counts: NavCounts; isOwner: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  // Auf dem Handy das aufgeklappte Menü nach dem Seitenwechsel wieder schließen.
  useEffect(() => {
    const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [pathname, search]);
  const groups: Group[] = [
    {
      items: [
        { href: "/", label: "Start", badge: counts.tasks, alert: true },
        { href: "/posteingang", label: "Posteingang", badge: counts.inbox, alert: true },
        { href: "/kalender", label: "Kalender" },
        { href: "/wissen", label: "Wissen" },
      ],
    },
    {
      head: "WaWi",
      items: [
        { href: "/auftraege", label: "Aufträge & Versand", badge: counts.orders },
        { href: "/einkauf", label: "Einkauf" },
        { href: "/chargen", label: "Chargen & Artikel" },
        { href: "/bestand", label: "Bestand & Inventur" },
        { href: "/listings", label: "Listings" },
        { href: "/lieferanten", label: "Lieferanten-Feeds" },
      ],
    },
    {
      head: "eBay",
      items: [
        { href: "/ebay", label: "Neues Angebot" },
        { href: "/ebay?ansicht=artikel", label: "Artikel & Gewinn" },
        { href: "/ebay?ansicht=verlauf", label: "Verlauf" },
        { href: "/ebay?ansicht=rechnungen", label: "Rechnungen (eBay)" },
        ...(isOwner ? [{ href: "/ebay?ansicht=einstellungen", label: "eBay-Einstellungen" }] : []),
      ],
    },
    {
      head: "Amazon FBA",
      items: [
        ...(isOwner ? [{ href: "/amazon-todos", label: "Amazon-ToDos", badge: counts.amazonTodos, alert: true }] : []),
        { href: "/inbound", label: "Inbound" },
        { href: "/ansprueche", label: "Ansprüche", badge: counts.claims },
        { href: "/remissionen", label: "Remissionen" },
      ],
    },
    {
      head: "Einkauf & Buchhaltung",
      items: [
        { href: "/rechnungen", label: "Rechnungen", badge: counts.invoices },
        { href: "/export", label: "COG-Export" },
        { href: "/repricer", label: "Repricer (BQool)" },
      ],
    },
    {
      head: "Service",
      items: [
        { href: "/retouren", label: "Retouren" },
        { href: "/faelle", label: "Fälle & A-bis-Z" },
        { href: "/bewertungen", label: "Bewertungen" },
      ],
    },
    { head: "Geld", items: [{ href: "/gewinn", label: "Gewinn" }, { href: "/cashflow", label: "Cash Flow" }] },
    {
      head: "System",
      items: [
        { href: "/import", label: "Daten importieren" },
        ...(isOwner ? [{ href: "/einstellungen", label: "Einstellungen" }, { href: "/anbindungen", label: "Anbindungen" }] : []),
      ],
    },
  ];

  const isActive = (href: string) => {
    if (href.includes("?")) {
      // Menüpunkte mit Ansicht (eBay): Pfad und Ansicht müssen passen.
      const [p, q] = href.split("?");
      return pathname === p && new URLSearchParams(q).get("ansicht") === search.get("ansicht");
    }
    if (href === "/ebay") return pathname === "/ebay" && !search.get("ansicht");
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav aria-label="Hauptnavigation">
      {groups.map((g, i) => (
        <div key={i}>
          {g.head && <div className="nav-head">{g.head}</div>}
          {g.items.map((item) => (
            <Link key={item.href} href={item.href} className={`nav-link${isActive(item.href) ? " active" : ""}`}>
              <span>{item.label}</span>
              {item.badge ? (
                <span className="nav-badge" style={item.alert ? undefined : { background: "var(--border-strong)", color: "var(--ink)" }}>{item.badge}</span>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
