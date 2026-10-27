"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Reiter einer Verteilung – nach Arbeitsablauf: Produkte → Prüfen → Ausgabe, dazu Einstellungen. */
export function EventTabs({ id, open, past, results, total }: { id: string; open: number; past: boolean; results: number; total: number }) {
  const path = usePathname();
  const base = `/verteilung/${id}`;
  // Jeder Bereich hat seine Farbe (siehe globals.css „Farbsystem“): Produkte blau, Prüfen bernstein, Ausgabe violett,
  // Ergebnisse türkis.
  // Zähler mit eigener Bedeutung: „79 offen“ = Produkte mit offenen Punkten, „0/79“ = Ergebnisse erfasst/gesamt.
  const tabs: { href: string; label: string; icon: string; area: string; short?: string; badge?: string; badgeLabel?: string; active: boolean }[] = [
    { href: base, label: "Produkte", icon: "📦", area: "produkte", active: path === base },
    { href: `${base}/pruefen`, label: "Prüfen", icon: "🔍", area: "pruefen", badge: open ? `${open} offen` : undefined, badgeLabel: `${open} Produkte mit offenen Punkten`, active: path.startsWith(`${base}/pruefen`) },
    { href: `${base}/ausgabe`, label: "Ausgabe", icon: "🖨", area: "ausgabe", active: ["/ausgabe", "/collage", "/social", "/ideen"].some((s) => path.startsWith(base + s)) },
    // Nach der Verteilung: Ergebnisse erfassen (Zahl = noch ohne Rückmeldung)
    ...(past ? [{ href: `${base}/ergebnisse`, label: "Ergebnisse", icon: "📊", area: "ergebnisse", badge: `${total - results}/${total}`, badgeLabel: `${total - results} von ${total} Ergebnissen erfasst`, active: path.startsWith(`${base}/ergebnisse`) }] : []),
    { href: `${base}/einstellungen`, label: "Einstellungen", icon: "⚙", area: "neutral", short: "⚙", active: path.startsWith(`${base}/einstellungen`) },
  ];
  return (
    <nav className="tabs" aria-label="Bereiche der Verteilung">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`tab tab-${t.area}${t.active ? " active" : ""}`} aria-current={t.active ? "page" : undefined}>
          {t.short ? <><span className="tab-long"><span aria-hidden="true">{t.icon}</span> {t.label}</span><span className="tab-short" aria-label={t.label}>{t.short}</span></> : <><span aria-hidden="true" className="tab-icon">{t.icon}</span>{t.label}</>}
          {t.badge ? <span className="tab-badge" title={t.badgeLabel}><span aria-hidden="true">{t.badge}</span><span className="sr-only">{t.badgeLabel}</span></span> : null}
        </Link>
      ))}
    </nav>
  );
}
