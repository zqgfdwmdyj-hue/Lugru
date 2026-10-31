// Navigation: Hauptbereiche nach Arbeitsabläufen (Versand, Amazon, eBay & Temu, B2B, Lager, Einkauf, Service,
// Finanzen, Marken), Privat als eigener Bereich und feste Hilfsfunktionen.
// Eine Quelle für Seitenleiste, Bereichs-Reiter und Handy-Menü. Ohne Server-Abhängigkeiten.

export type NavCounts = { tasks: number; inbox: number; orders: number; claims: number; invoices: number; amazonTodos: number; pallets: number };

/** Aufgeklappte Bereiche als Cookie – so rendert schon der Server den gemerkten Zustand (kein Springen). */
export const NAV_OPEN_COOKIE = "nav-open";

export type NavItem = {
  href: string;
  label: string;
  badge?: keyof NavCounts;
  /** Rot statt grau – Zähler, die Handlungsbedarf bedeuten. */
  alert?: boolean;
  /** Nur für Inhaber (Einstellungen, Amazon-ToDos …). */
  owner?: boolean;
  /** Zusätzliche Adressen, unter denen der Punkt aktiv ist (z. B. Aufgabenliste mit Bereichsfilter). */
  also?: (path: string, q: URLSearchParams) => boolean;
  /** Kurzname für die Zählerzeile oben in der Seitenleiste („Aufgaben 5“). */
  short?: string;
};

export type NavSection = { key: string; label: string; color: string; icon?: string; items: NavItem[]; helper?: boolean };

export const NAV: NavSection[] = [
  {
    key: "heute",
    label: "Heute",
    color: "var(--area-heute)",
    icon: "📋",
    items: [
      { href: "/", label: "Tagesübersicht", badge: "tasks", alert: true, short: "Aufgaben" },
      { href: "/?ansicht=liste", label: "Alle Aufgaben", also: (p, q) => p === "/" && Boolean(q.get("kat") && q.get("kat") !== "alle") },
      { href: "/kalender/tagesplan", label: "Tagesplan" },
      { href: "/delegation", label: "Delegation", owner: true },
      { href: "/kalender/feierabend", label: "Feierabend" },
      { href: "/uploads", label: "Uploads (alles hochladen)" },
      { href: "/posteingang", label: "Posteingang", badge: "inbox", alert: true },
      { href: "/schnell", label: "Schnellerfassung (Sprache)" },
      { href: "/scan", label: "Scan mit Ampel" },
      { href: "/kalender", label: "Termine" },
      { href: "/kalender/fahrten", label: "Fahrtenbuch", owner: true },
      { href: "/rechtsfaelle", label: "Rechtsfälle (Anwalt)", owner: true },
    ],
  },
  {
    // Nur was mit dem Verschicken von Aufträgen zu tun hat – Marktplätze und Amazon haben eigene Bereiche.
    key: "verkauf",
    label: "Aufträge & Versand",
    color: "var(--area-verkauf)",
    icon: "🚚",
    items: [
      { href: "/auftraege", label: "Aufträge", badge: "orders", short: "Versand" },
      { href: "/auftraege/lieferschein", label: "Labels: Warensendung & DHL" },
      { href: "/auftraege/prep-center", label: "Prep Center: Versand je Monat" },
    ],
  },
  {
    key: "amazon",
    label: "Amazon",
    color: "var(--area-amazon)",
    icon: "🅰️",
    items: [
      { href: "/amazon-faelle", label: "Fall-Zentrale", owner: true },
      { href: "/amazon-todos", label: "Amazon-ToDos", badge: "amazonTodos", alert: true, owner: true },
      { href: "/inbound", label: "FBA-Inbound" },
      { href: "/sas", label: "SAS-Programm" },
      { href: "/repricer", label: "Repricer (BQool)" },
      { href: "/amazon-business", label: "Amazon Business" },
      { href: "/echtheit", label: "Echtheits-Ordner" },
      { href: "/calls", label: "Calls (Consultant & Gruppe)" },
    ],
  },
  {
    // Angebote auf den Marktplätzen (eBay, Temu) – gleiche Farbfamilie wie „Aufträge & Versand“ (Verkauf).
    key: "marktplaetze",
    label: "eBay & Temu",
    color: "var(--area-verkauf)",
    icon: "🏷️",
    items: [
      { href: "/listings", label: "Angebote (alle Kanäle)" },
      { href: "/ebay", label: "Neues eBay-Angebot" },
      { href: "/ebay/pruefen", label: "eBay-Angebote prüfen" },
      { href: "/ebay?ansicht=artikel", label: "eBay-Artikel & Gewinn" },
      { href: "/ebay?ansicht=verlauf", label: "eBay-Verlauf" },
      { href: "/listings/temu", label: "eBay → Temu / Wawi" },
      { href: "/listings/temu#rechner", label: "Temu-Rechner" },
    ],
  },
  {
    // Deals für Prep-Kunden: eigener Geschäftszweig – gleiche Farbfamilie wie „Einkauf“.
    key: "b2b",
    label: "B2B-Handel",
    color: "var(--area-einkauf)",
    icon: "🤝",
    items: [
      { href: "/b2b", label: "Deals" },
      { href: "/b2b/preislisten", label: "Preislisten je Land" },
      { href: "/b2b/kunden", label: "B2B-Kunden" },
      { href: "/b2b/lieferanten", label: "Lieferanten-Freigaben" },
      { href: "/b2b/bilanz", label: "Bilanz" },
    ],
  },
  {
    key: "produkte",
    label: "Produkte & Lager",
    color: "var(--area-produkte)",
    icon: "📦",
    items: [
      { href: "/produkte", label: "Produkte" },
      { href: "/chargen", label: "Chargen" },
      { href: "/bestand", label: "Bestand & Inventur" },
      { href: "/artikel", label: "Artikelstamm (eigene Marken)" },
      { href: "/paletten", label: "Paletten-Lager (Kunden)", badge: "pallets", alert: true, short: "Paletten-Meldungen" },
    ],
  },
  {
    key: "einkauf",
    label: "Einkauf & Lieferanten",
    color: "var(--area-einkauf)",
    icon: "🛒",
    items: [
      { href: "/deal-eingang", label: "Deal-Eingang (WhatsApp teilen)" },
      { href: "/lieferanten/deal-ampel", label: "Deal-Ampel (Einkauf prüfen)" },
      { href: "/einkauf", label: "Einkauf & Wareneingang" },
      { href: "/einkauf/ek-import", label: "EK-Import (→ sellerboard)" },
      { href: "/einkauf/beschaffungsanalyse", label: "Dropship-Trackings" },
      { href: "/lieferanten", label: "Lieferanten-Feeds" },
      { href: "/lieferanten/abfrage", label: "Lieferanten-Abfrage" },
      { href: "/lieferanten/chancen", label: "Chancen" },
      { href: "/lieferanten/finden", label: "Großhändler finden" },
      { href: "/board", label: "Kontakt-Board" },
    ],
  },
  {
    key: "service",
    label: "Service & Ansprüche",
    color: "var(--area-service)",
    icon: "🛟",
    items: [
      { href: "/retouren", label: "Retouren" },
      { href: "/ansprueche", label: "Ansprüche", badge: "claims" },
      { href: "/remissionen", label: "Remissionen" },
      { href: "/remissionen/pruefungen", label: "Retouren-Station & Fälle" },
      { href: "/faelle", label: "Fälle & A-bis-Z" },
      { href: "/bewertungen", label: "Bewertungen" },
    ],
  },
  {
    key: "finanzen",
    label: "Finanzen",
    color: "var(--area-finanzen)",
    icon: "💶",
    items: [
      { href: "/gewinn", label: "Gewinn" },
      { href: "/cashflow", label: "Liquidität" },
      { href: "/hebel", label: "Hebel: Umsatz & Marge" },
      { href: "/kapital", label: "Kapital-Ampel" },
      { href: "/verlust", label: "Verlust-Stopp" },
      { href: "/buchhaltung", label: "Buchhaltung (Abgleich, DATEV)" },
      { href: "/rechnungen", label: "Eingangsrechnungen", badge: "invoices", short: "Belege prüfen" },
      { href: "/rechnungen/belege", label: "Belege scannen" },
      { href: "/rechnungen/ausgang", label: "Ausgangsrechnungen" },
      { href: "/ebay?ansicht=rechnungen", label: "eBay-Rechnungen" },
      { href: "/rechnungen/kunden", label: "Kunden" },
      { href: "/export", label: "COG-Export" },
    ],
  },
  {
    key: "marken",
    label: "Marken & Content",
    color: "var(--area-marken)",
    icon: "🎨",
    items: [
      { href: "/marken", label: "Ideen & Saison" },
      { href: "/marken/content", label: "Content-Plan" },
      { href: "/marken/shop", label: "Shop-Analyse" },
      { href: "/marken/profile", label: "Markenprofile" },
      { href: "/marken/uhren", label: "Uhren: Buy & Flip" },
    ],
  },
  { key: "privat", label: "Privat", color: "var(--area-privat)", icon: "🔒", items: [{ href: "/privat", label: "Privat" }] },
  {
    key: "hilfe",
    label: "Hilfsfunktionen",
    color: "var(--area-hilfe)",
    icon: "🧰",
    helper: true,
    items: [
      { href: "/wissen", label: "Wissen" },
      { href: "/import", label: "Daten importieren" },
      { href: "/einstellungen", label: "Einstellungen", owner: true },
      { href: "/anbindungen", label: "Anbindungen", owner: true },
      { href: "/einstellungen/claude", label: "Claude & KI-Assistent", owner: true },
      { href: "/einstellungen/handy", label: "Handy & Tesla", owner: true },
      { href: "/ebay?ansicht=einstellungen", label: "eBay-Einstellungen", owner: true },
    ],
  },
];

/**
 * Unterseiten einzelner Menüpunkte (dritte Ebene). Sie stehen nur als Reiter über dem Inhalt, nicht in der
 * Seitenleiste – so zeigt jede Leiste genau eine Ebene: Seitenleiste = Bereiche und Seiten, Reiter = Unterseiten.
 */
export const SUBPAGES: Record<string, NavItem[]> = {
  "/marken/uhren": [
    { href: "/marken/uhren", label: "Übersicht" },
    { href: "/marken/uhren/lernen", label: "Lernen" },
    { href: "/marken/uhren/rechner", label: "Rechner" },
    { href: "/marken/uhren/deals", label: "Deals" },
    { href: "/marken/uhren/preise", label: "Marktpreise" },
  ],
  "/paletten": [
    { href: "/paletten", label: "Lager" },
    { href: "/paletten/sendungen", label: "Sendungen" },
    { href: "/paletten/lagerplan", label: "Lagerplan" },
    { href: "/paletten/abholung", label: "Abholung" },
    { href: "/paletten/inventur", label: "Inventur" },
    { href: "/paletten/abrechnung", label: "Abrechnung" },
    { href: "/paletten/kunden", label: "Kunden & Preise" },
    { href: "/paletten/uebersicht", label: "Auswertung" },
  ],
};

/** Aktive Unterseite: bester Treffer (Paletten-Detail /paletten/<id> gehört zu „Lager“). */
export function activeSubpage(items: NavItem[], path: string, q: URLSearchParams): NavItem | null {
  let best: { item: NavItem; score: number } | null = null;
  for (const item of items) {
    const score = matchScore(item, path, q);
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

/**
 * Wie gut passt ein Menüpunkt zur aktuellen Adresse? 0 = gar nicht. Genaue Treffer und Punkte mit
 * passender Ansicht schlagen Präfix-Treffer; der längste Pfad gewinnt (/ebay/pruefen vor /ebay).
 */
export function matchScore(item: Pick<NavItem, "href" | "also">, path: string, q: URLSearchParams): number {
  if (item.href.includes("#")) return 0; // Sprungmarken (Temu-Rechner) nie als aktive Seite
  const [hrefPath, rest = ""] = item.href.split("?");
  if (item.also?.(path, q)) return 3000 + hrefPath.length;
  const want = new URLSearchParams(rest);
  const keys = [...want.keys()];
  if (keys.length) {
    if (path !== hrefPath) return 0;
    return keys.every((k) => q.get(k) === want.get(k)) ? 2000 + hrefPath.length : 0;
  }
  if (path === hrefPath) return 1000 + hrefPath.length;
  if (hrefPath !== "/" && path.startsWith(`${hrefPath}/`)) return hrefPath.length;
  return 0;
}

/** Der aktive Menüpunkt (bestes Ergebnis über alle Bereiche) – oder null. */
export function activeItem(sections: NavSection[], path: string, q: URLSearchParams): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem; score: number } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const score = matchScore(item, path, q);
      if (score > 0 && (!best || score > best.score)) best = { section, item, score };
    }
  }
  return best && { section: best.section, item: best.item };
}

/** Bereiche mit den Punkten, die diese Person sehen darf (Bereichs-Rechte, Inhaber-Punkte). */
export function visibleNav(allowed: (path: string) => boolean, isOwner: boolean): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((it) => (!it.owner || isOwner) && allowed(it.href.split(/[?#]/)[0])) })).filter((s) => s.items.length > 0);
}

export type NavCounter = { href: string; label: string; n: number; alert: boolean; color: string; section: string };

/**
 * Zählerzeile oben in der Seitenleiste: alle Punkte mit Zähler > 0 aus den sichtbaren Bereichen – rote
 * (Handlungsbedarf) zuerst, dann nach Anzahl. So sind wichtige Zahlen erreichbar, ohne Bereiche aufzuklappen.
 */
export function navCounters(sections: NavSection[], counts: NavCounts): NavCounter[] {
  const out: NavCounter[] = [];
  for (const s of sections) {
    for (const it of s.items) {
      const n = it.badge ? counts[it.badge] : 0;
      if (n > 0) out.push({ href: it.href, label: it.short ?? it.label, n, alert: Boolean(it.alert), color: s.color, section: s.key });
    }
  }
  return out.sort((a, b) => Number(b.alert) - Number(a.alert) || b.n - a.n);
}

/**
 * Aufgeklappte Bereiche: der aktuelle (außer man hat ihn selbst zugeklappt) und was seit dem letzten
 * Seitenwechsel von Hand geöffnet wurde. Früher besuchte Bereiche bleiben nicht offen – die Leiste bleibt kurz.
 */
export function openSections(activeKey: string | null, manual: ReadonlySet<string>, closedActive: boolean): Set<string> {
  const out = new Set(manual);
  if (activeKey && !closedActive) out.add(activeKey);
  return out;
}
