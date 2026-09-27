"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href?: string; label: string; badge?: number; soon?: boolean };
type Group = { head?: string; items: Item[] };

export function SidebarNav({ openTasks }: { openTasks: number }) {
  const pathname = usePathname();
  const groups: Group[] = [
    {
      items: [
        { href: "/", label: "Start", badge: openTasks },
        { label: "Posteingang", soon: true },
        { href: "/wissen", label: "Wissen" },
      ],
    },
    {
      head: "WaWi",
      items: [
        { label: "Aufträge", soon: true },
        { href: "/chargen", label: "Chargen & Artikel" },
        { label: "Bestand & Inventur", soon: true },
        { label: "Listings", soon: true },
      ],
    },
    { head: "Amazon FBA", items: [{ label: "Inbound", soon: true }, { label: "Ansprüche", soon: true }] },
    {
      head: "Einkauf & Buchhaltung",
      items: [
        { href: "/einkauf", label: "Import Arbitrage One" },
        { href: "/export", label: "COG-Export" },
      ],
    },
    {
      head: "Service",
      items: [
        { label: "Retouren", soon: true },
        { label: "Fälle & A-bis-Z", soon: true },
        { label: "Bewertungen", soon: true },
      ],
    },
    { head: "Geld", items: [{ label: "Gewinn & Cash Flow", soon: true }] },
  ];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav aria-label="Hauptnavigation">
      {groups.map((g, i) => (
        <div key={i}>
          {g.head && <div className="nav-head">{g.head}</div>}
          {g.items.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} className={`nav-link${isActive(item.href) ? " active" : ""}`}>
                <span>{item.label}</span>
                {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </Link>
            ) : (
              <span key={item.label} className="nav-link soon" title="Kommt in einer späteren Ausbaustufe">
                <span>{item.label}</span>
                <span className="nav-soon">bald</span>
              </span>
            ),
          )}
        </div>
      ))}
    </nav>
  );
}
