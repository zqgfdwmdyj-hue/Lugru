"use client";

import Link from "next/link";
import { useEffect } from "react";
import { areaForPath, canAccess } from "@/lib/auth/areas";
import { usePathname, useSearchParams } from "next/navigation";

export type NavCounts = { tasks: number; inbox: number; orders: number; claims: number; invoices: number; amazonTodos: number };

type Item = { href: string; label: string; badge?: number; alert?: boolean };
type Group = { head?: string; items: Item[] };

/** Farbe je Bereich – Streifen links und leichte Tönung, damit man die Gruppen auf einen Blick trennt. */
const GROUP_COLOR: Record<string, string> = {
  "": "#5b6670",
  WaWi: "#1f7a5c",
  Marken: "#c2410c",
  eBay: "#2563eb",
  "Amazon FBA": "#d97706",
  "Einkauf & Buchhaltung": "#7c3aed",
  Service: "#db2777",
  Geld: "#15803d",
  System: "#475569",
};

export function SidebarNav({ counts, isOwner, areas }: { counts: NavCounts; isOwner: boolean; areas: string[] | null }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const gesperrt = search.get("gesperrt") === "1";
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
        { href: "/board", label: "Board" },
        { href: "/wissen", label: "Wissen" },
      ],
    },
    {
      head: "WaWi",
      items: [
        { href: "/auftraege", label: "Aufträge & Versand", badge: counts.orders },
        { href: "/einkauf", label: "Einkauf" },
        { href: "/einkauf/beschaffungsanalyse", label: "Dropship-Trackings" },
        { href: "/chargen", label: "Chargen & Artikel" },
        { href: "/bestand", label: "Bestand & Inventur" },
        { href: "/artikel", label: "Artikelstamm" },
        { href: "/listings", label: "Listings" },
        { href: "/lieferanten", label: "Lieferanten-Feeds" },
        { href: "/lieferanten/abfrage", label: "Lieferanten-Abfrage" },
        { href: "/lieferanten/chancen", label: "Chancen" },
        { href: "/lieferanten/finden", label: "Großhändler finden" },
      ],
    },
    {
      head: "Marken",
      items: [
        { href: "/marken", label: "Ideen & Saison" },
        { href: "/marken/content", label: "Content-Plan" },
        { href: "/marken/shop", label: "Shop-Analyse" },
        { href: "/marken/profile", label: "Markenprofile" },
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
        { href: "/rechnungen", label: "Eingangsrechnungen", badge: counts.invoices },
        { href: "/rechnungen/belege", label: "Belege scannen" },
        { href: "/rechnungen/ausgang", label: "Ausgangsrechnungen" },
        { href: "/rechnungen/kunden", label: "Kunden" },
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
    if (href === "/rechnungen") return pathname === "/rechnungen" || (pathname.startsWith("/rechnungen/") && !/^\/rechnungen\/(ausgang|kunden|belege)(\/|$)/.test(pathname));
    if (href === "/einkauf") return pathname === "/einkauf" || (pathname.startsWith("/einkauf/") && !/^\/einkauf\/beschaffungsanalyse(\/|$)/.test(pathname));
    if (href === "/marken") return pathname === "/marken" || pathname.startsWith("/marken/ideen");
    if (href === "/lieferanten") return pathname === "/lieferanten" || (pathname.startsWith("/lieferanten/") && !/^\/lieferanten\/(finden|abfrage|chancen)(\/|$)/.test(pathname));
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  };

  // Mitarbeiter sehen nur freigegebene Bereiche.
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => canAccess({ role: isOwner ? "owner" : "staff", areas }, areaForPath(it.href.split("?")[0]))) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav aria-label="Hauptnavigation">
      {gesperrt && <div className="nav-locked">Dieser Bereich ist für dich nicht freigegeben.</div>}
      {visible.map((g, i) => (
        <div key={i} className="nav-group" style={{ ["--g" as string]: GROUP_COLOR[g.head ?? ""] ?? "#8a8f95" }}>
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
