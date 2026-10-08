"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Verteilungen" },
  { href: "/produkte", label: "Produkte" },
];

export function Nav() {
  const pathname = usePathname();
  // Auf dem Handy das aufgeklappte Menü nach dem Seitenwechsel schließen.
  useEffect(() => {
    const t = document.getElementById("nav-toggle") as HTMLInputElement | null;
    if (t) t.checked = false;
  }, [pathname]);
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/verteilung") : pathname.startsWith(href));
  return (
    <nav aria-label="Hauptnavigation">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={`nav-link${active(i.href) ? " active" : ""}`}>{i.label}</Link>
      ))}
    </nav>
  );
}
