"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Reiter einer Verteilung – nach Arbeitsablauf: Produkte → Prüfen → Ausgabe, dazu Einstellungen. */
export function EventTabs({ id, open }: { id: string; open: number }) {
  const path = usePathname();
  const base = `/verteilung/${id}`;
  const tabs = [
    { href: base, label: "Produkte", active: path === base },
    { href: `${base}/pruefen`, label: "Prüfen", badge: open, active: path.startsWith(`${base}/pruefen`) },
    { href: `${base}/ausgabe`, label: "Ausgabe", active: ["/ausgabe", "/collage", "/social", "/ideen"].some((s) => path.startsWith(base + s)) },
    { href: `${base}/einstellungen`, label: "Einstellungen", active: path.startsWith(`${base}/einstellungen`) },
  ];
  return (
    <nav className="tabs" aria-label="Bereiche der Verteilung">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`tab${t.active ? " active" : ""}`} aria-current={t.active ? "page" : undefined}>
          {t.label}
          {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
