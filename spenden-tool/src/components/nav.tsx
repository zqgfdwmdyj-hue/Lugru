"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Verteilungen", icon: "📅", area: "produkte" },
  { href: "/produkte", label: "Produkte", icon: "📦", area: "produkte" },
  { href: "/statistik", label: "Statistik", icon: "📊", area: "ergebnisse" },
];

export function Nav({ admin = false }: { admin?: boolean }) {
  const pathname = usePathname();
  // Auf dem Handy das aufgeklappte Menü nach dem Seitenwechsel schließen.
  useEffect(() => {
    const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [pathname]);
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/verteilung") : pathname.startsWith(href));
  return (
    <nav aria-label="Hauptnavigation">
      {[...ITEMS, ...(admin ? [{ href: "/verwaltung", label: "Verwaltung", icon: "⚙", area: "neutral" }] : []), { href: "/konto", label: "Mein Konto", icon: "👤", area: "neutral" }].map((i) => (
        <Link key={i.href} href={i.href} className={`nav-link nav-${i.area}${active(i.href) ? " active" : ""}`} aria-current={active(i.href) ? "page" : undefined}>
          <span><span aria-hidden="true" className="nav-icon">{i.icon}</span> {i.label}</span>
        </Link>
      ))}
    </nav>
  );
}
