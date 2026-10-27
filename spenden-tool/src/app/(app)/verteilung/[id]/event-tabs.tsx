"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Reiter einer Verteilung – nach Arbeitsablauf: Produkte → Prüfen → Ausgabe, dazu Einstellungen. */
export function EventTabs({ id, open, past, results }: { id: string; open: number; past: boolean; results: number }) {
  const path = usePathname();
  const base = `/verteilung/${id}`;
  const tabs: { href: string; label: string; short?: string; badge?: number; active: boolean }[] = [
    { href: base, label: "Produkte", active: path === base },
    { href: `${base}/pruefen`, label: "Prüfen", badge: open, active: path.startsWith(`${base}/pruefen`) },
    { href: `${base}/ausgabe`, label: "Ausgabe", active: ["/ausgabe", "/collage", "/social", "/ideen"].some((s) => path.startsWith(base + s)) },
    // Nach der Verteilung: Ergebnisse erfassen (Zahl = noch ohne Rückmeldung)
    ...(past ? [{ href: `${base}/ergebnisse`, label: "Ergebnisse", badge: results, active: path.startsWith(`${base}/ergebnisse`) }] : []),
    { href: `${base}/einstellungen`, label: "Einstellungen", short: "⚙", active: path.startsWith(`${base}/einstellungen`) },
  ];
  return (
    <nav className="tabs" aria-label="Bereiche der Verteilung">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`tab${t.active ? " active" : ""}`} aria-current={t.active ? "page" : undefined}>
          {t.short ? <><span className="tab-long">{t.label}</span><span className="tab-short" aria-label={t.label}>{t.short}</span></> : t.label}
          {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
