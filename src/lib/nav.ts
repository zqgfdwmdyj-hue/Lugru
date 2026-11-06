// Navigation links (Umbau 06.11.: „seller-system-menue-umbau“): Heute · Einkauf & Deals · Amazon · eBay & Temu ·
// Lager & Versand · Finanzen · B2B · Marken & Content · Team & Verwaltung · Privat · Einstellungen – 11 Gruppen,
// 82 Einträge, längere Gruppen mit einklappbaren Untergruppen (zweite Ebene). Eine Quelle für Seitenleiste,
// Strg+K-Suche, Unterseiten-Reiter und Handy-Leiste. Ohne Server-Abhängigkeiten. Alte Adressen bleiben gültig.

export type NavCounts = { tasks: number; inbox: number; claims: number; invoices: number; amazonTodos: number };

/** Offene Gruppe und Untergruppen als Cookie („finanzen,finanzen.rechnungen“) – so zeichnet schon der Server richtig. */
export const NAV_OPEN_COOKIE = "nav-open";

export type NavItem = {
  href: string;
  label: string;
  /** Zahl am Eintrag – nur Tagesübersicht, Posteingang, Amazon-ToDos, Ansprüche, Eingangsrechnungen. */
  badge?: keyof NavCounts;
  /** Rot statt grau – Zähler, die Handlungsbedarf bedeuten. */
  alert?: boolean;
  /** Nur für Inhaber (Einstellungen, Amazon-ToDos …). */
  owner?: boolean;
  /** Zusätzliche Adressen, unter denen der Punkt aktiv ist (z. B. Anbindungen unter Einstellungen). */
  also?: (path: string, q: URLSearchParams) => boolean;
  /** Kurzname (Zähler-Chips oben, Favoriten). */
  short?: string;
  /** Für Seiten ohne eigenen Bereich: sichtbar, wenn einer dieser Pfade erlaubt ist. */
  sichtbarMit?: string[];
  /** Untergruppe (Schlüssel aus `NavSection.untergruppen`); ohne = direkt in der Gruppe. */
  unter?: string;
};

export type NavUntergruppe = { key: string; label: string };
export type NavSection = { key: string; label: string; color: string; icon?: string; items: NavItem[]; untergruppen?: NavUntergruppe[] };

// Rechnungsstation hat keinen eigenen Bereich: sichtbar für Service (VA), Buchhaltung und Geld.
const STATION = ["/versand", "/rechnungen", "/buchhaltung"];

export const NAV: NavSection[] = [
  {
    key: "heute",
    label: "Heute",
    color: "var(--area-heute)",
    icon: "📋",
    items: [
      { href: "/", label: "Tagesübersicht", badge: "tasks", alert: true, short: "Aufgaben" },
      { href: "/kalender/tagesplan", label: "Tagesplan (Anrufe)" },
      { href: "/kalender", label: "Termine" },
      { href: "/posteingang", label: "Posteingang", badge: "inbox", alert: true },
      { href: "/uploads", label: "Uploads" },
      { href: "/schnell", label: "Schnellerfassung" },
      { href: "/kalender/feierabend", label: "Feierabend" },
      { href: "/kalender/fahrten", label: "Fahrtenbuch", owner: true },
    ],
  },
  {
    key: "einkauf",
    label: "Einkauf & Deals",
    color: "var(--area-einkauf)",
    icon: "🛒",
    untergruppen: [{ key: "lieferanten", label: "Lieferanten" }],
    items: [
      { href: "/deal-eingang", label: "Deal-Eingang" },
      { href: "/deal-eingang/lugru", label: "Lugru Deals" },
      { href: "/lieferanten/deal-ampel", label: "Deal-Ampel" },
      { href: "/scan", label: "Scanner" },
      { href: "/einkauf/vorschlaege", label: "Bestellvorschläge" },
      { href: "/einkauf", label: "Einkauf & Wareneingang" },
      { href: "/einkauf/ek-import", label: "EK-Import (→ sellerboard)" },
      { href: "/einkauf/beschaffungsanalyse", label: "Dropship-Trackings" },
      { href: "/lieferanten", label: "Feeds", unter: "lieferanten" },
      { href: "/lieferanten/abfrage", label: "Abfrage", unter: "lieferanten" },
      { href: "/lieferanten/chancen", label: "Chancen", unter: "lieferanten" },
      { href: "/lieferanten/finden", label: "Großhändler finden", unter: "lieferanten" },
      { href: "/board", label: "Kontakt-Board", unter: "lieferanten" },
    ],
  },
  {
    key: "amazon",
    label: "Amazon",
    color: "var(--area-amazon)",
    icon: "🅰️",
    untergruppen: [{ key: "faelle", label: "Fälle & Erstattungen" }, { key: "angebote", label: "Angebote & Lager" }],
    items: [
      { href: "/amazon-faelle", label: "Fall-Zentrale", owner: true, unter: "faelle" },
      { href: "/amazon-todos", label: "Amazon-ToDos", badge: "amazonTodos", alert: true, owner: true, unter: "faelle" },
      { href: "/ansprueche", label: "Ansprüche", badge: "claims", unter: "faelle" },
      { href: "/faelle", label: "Fälle & A-bis-Z", unter: "faelle" },
      { href: "/echtheit", label: "Echtheits-Ordner", unter: "faelle" },
      { href: "/repricer", label: "Repricer (BQool)", unter: "angebote" },
      { href: "/listings", label: "Listungen (alle Kanäle)", unter: "angebote" },
      { href: "/inbound", label: "FBA-Inbound", unter: "angebote" },
      { href: "/sas", label: "SAS-Programm", unter: "angebote" },
      { href: "/bewertungen", label: "Bewertungen", unter: "angebote" },
      { href: "/amazon-business", label: "Amazon Business", unter: "angebote" },
    ],
  },
  {
    key: "marktplaetze",
    label: "eBay & Temu",
    color: "var(--area-verkauf)",
    icon: "🏷️",
    items: [
      // Artikel & Gewinn, Verlauf, Rechnungen und Einstellungen sind Reiter (Symbole) auf der eBay-Seite.
      { href: "/ebay", label: "eBay" },
      { href: "/ebay/pruefen", label: "Angebote prüfen" },
      { href: "/listings/temu", label: "Temu / Wawi" },
    ],
  },
  {
    key: "lager",
    label: "Lager & Versand",
    color: "var(--area-produkte)",
    icon: "📦",
    untergruppen: [{ key: "lager", label: "Lager" }, { key: "versand", label: "Versand" }, { key: "retouren", label: "Retouren" }],
    items: [
      { href: "/bestand", label: "Bestand & Inventur", unter: "lager" },
      { href: "/produkte", label: "Produkte", unter: "lager" },
      { href: "/artikel", label: "Artikelstamm", unter: "lager" },
      { href: "/chargen", label: "Chargen", unter: "lager" },
      { href: "/paletten", label: "Paletten-Lager", unter: "lager" },
      { href: "/auftraege", label: "Aufträge & Versand", unter: "versand" },
      { href: "/auftraege/lieferschein", label: "Labels: Warensendung & DHL", unter: "versand" },
      { href: "/versand/label", label: "Label aus Chat (DHL)", unter: "versand" },
      { href: "/versand/abholung", label: "Abholung DHL/UPS", unter: "versand" },
      { href: "/auftraege/prep-center", label: "Prep Center: Versand je Monat", unter: "versand" },
      { href: "/remissionen/pruefungen", label: "Retouren-Station & Fälle", unter: "retouren" },
      { href: "/retouren", label: "Retouren", unter: "retouren" },
      { href: "/remissionen", label: "Remissionen", unter: "retouren" },
    ],
  },
  {
    key: "finanzen",
    label: "Finanzen",
    color: "var(--area-finanzen)",
    icon: "💶",
    untergruppen: [{ key: "rechnungen", label: "Rechnungen" }],
    items: [
      { href: "/gewinn", label: "Gewinn" },
      { href: "/cashflow", label: "Liquidität" },
      { href: "/kapital", label: "Kapital-Ampel" },
      { href: "/hebel", label: "Hebel: Umsatz & Marge" },
      { href: "/verlust", label: "Verlust-Stopp" },
      { href: "/buchhaltung", label: "Buchhaltung (Abgleich, DATEV)" },
      { href: "/import", label: "Importe" },
      { href: "/export", label: "COG-Export" },
      { href: "/rechnungen", label: "Eingangsrechnungen", badge: "invoices", short: "Belege", unter: "rechnungen" },
      { href: "/rechnungen/belege", label: "Belege scannen", unter: "rechnungen" },
      { href: "/rechnungsstation", label: "Rechnungsstation (Kamera)", sichtbarMit: STATION, unter: "rechnungen" },
      { href: "/rechnungsstation/pruefen", label: "Rechnungsstation: Prüfliste", sichtbarMit: STATION, unter: "rechnungen" },
      { href: "/rechnungen/ausgang", label: "Ausgangsrechnungen", unter: "rechnungen" },
      { href: "/rechnungen/kunden", label: "Kunden", unter: "rechnungen" },
    ],
  },
  {
    key: "b2b",
    label: "B2B",
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
  {
    // Ersetzt „Delegation“ und „Wissen & Calls“ (jede unter 4 Einträgen) und nimmt die Rechtsfälle auf.
    key: "team",
    label: "Team & Verwaltung",
    color: "var(--area-service)",
    icon: "🧰",
    items: [
      { href: "/delegation", label: "VA & Delegation", owner: true },
      { href: "/wissen", label: "Wissen" },
      { href: "/calls", label: "Calls (Consultant & Gruppe)" },
      { href: "/rechtsfaelle", label: "Rechtsfälle (Anwalt)", owner: true },
    ],
  },
  {
    // Eigener Block, farblich abgesetzt – nur für Konten mit Privat-Zugriff (canAccess „privat“).
    key: "privat",
    label: "Privat",
    color: "var(--area-privat)",
    icon: "🔒",
    items: [
      { href: "/privat", label: "Übersicht" },
      { href: "/privat/kalender", label: "Kalender" },
      { href: "/privat/eintragen", label: "Eintragen" },
      { href: "/privat/nachrichten", label: "Nachrichten" },
      { href: "/privat/rueckblick", label: "Rückblick" },
      { href: "/privat/einstellungen", label: "Einstellungen" },
    ],
  },
  {
    key: "einstellungen",
    label: "Einstellungen",
    color: "var(--area-hilfe)",
    icon: "⚙️",
    items: [
      // Ein Eintrag – Anbindungen, KI-Assistent, Hintergrund & Importe, Geräte, Shop-Profile, Abholung und Testumgebung sind Reiter darauf.
      { href: "/einstellungen", label: "Einstellungen", owner: true, also: (p) => p === "/anbindungen" || p.startsWith("/anbindungen/") },
    ],
  },
];

/**
 * Seiten ohne eigenen Menüeintrag (Reiter/Kacheln auf ihrer Hauptseite): bleiben direkt aufrufbar und über Strg+K
 * findbar – mit dem Ort, an dem sie jetzt stehen.
 */
export type Nebenseite = { href: string; label: string; wo: string; owner?: boolean };
export const NEBENSEITEN: Nebenseite[] = [
  { href: "/ebay?ansicht=artikel", label: "eBay-Artikel & Gewinn", wo: "eBay & Temu › eBay (Reiter)" },
  { href: "/ebay?ansicht=verlauf", label: "eBay-Verlauf", wo: "eBay & Temu › eBay (Reiter)" },
  { href: "/ebay?ansicht=rechnungen", label: "eBay-Rechnungen", wo: "eBay & Temu › eBay (Reiter)" },
  { href: "/ebay?ansicht=einstellungen", label: "eBay-Einstellungen", wo: "eBay & Temu › eBay (Reiter)", owner: true },
  { href: "/listings/temu#rechner", label: "Temu-Rechner", wo: "eBay & Temu › Temu / Wawi" },
  { href: "/?ansicht=liste", label: "Alle Aufgaben", wo: "Heute › Tagesübersicht" },
  { href: "/kalender/tagesplan?anrufe=1", label: "Anrufe", wo: "Heute › Tagesplan (Anrufe)" },
  { href: "/anbindungen", label: "Anbindungen", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/claude", label: "Claude & KI-Assistent", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/hintergrund", label: "Hintergrund-Abrufe & Importe", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/handy", label: "Handy & Tesla", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/watch", label: "Apple Watch", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/benachrichtigungen", label: "Benachrichtigungen", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/shop-profile", label: "Shop-Profile & Payback", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/abholung", label: "Abholorte (DHL/UPS)", wo: "Einstellungen (Reiter)", owner: true },
  { href: "/einstellungen/testumgebung", label: "Testumgebung", wo: "Einstellungen (Reiter)", owner: true },
];

/** Die fünf Zähler-Chips oben in der Seitenleiste, in fester Reihenfolge. */
export const ZAEHLER_CHIPS: { href: string; label: string }[] = [
  { href: "/", label: "Aufgaben" },
  { href: "/amazon-todos", label: "Amazon-ToDos" },
  { href: "/posteingang", label: "Posteingang" },
  { href: "/rechnungen", label: "Belege" },
  { href: "/ansprueche", label: "Ansprüche" },
];

/** Höchstens so viele Einträge je Block (direkte Einträge einer Gruppe bzw. einer Untergruppe). */
export const MAX_BLOCK = 8;

/** Einträge einer Gruppe in Blöcken: erst die direkten, dann je Untergruppe (leere fallen weg). */
export function navBloecke(s: NavSection): { unter: NavUntergruppe | null; items: NavItem[] }[] {
  const direkt = s.items.filter((it) => !it.unter);
  const out: { unter: NavUntergruppe | null; items: NavItem[] }[] = direkt.length ? [{ unter: null, items: direkt }] : [];
  for (const u of s.untergruppen ?? []) {
    const items = s.items.filter((it) => it.unter === u.key);
    if (items.length) out.push({ unter: u, items });
  }
  return out;
}

/** „Amazon › Angebote & Lager“ – wo ein Eintrag im Menü steht. */
export function navOrt(s: NavSection, it: NavItem): string {
  const u = it.unter ? s.untergruppen?.find((x) => x.key === it.unter) : undefined;
  return u ? `${s.label} › ${u.label}` : s.label;
}

/** Höchstens so viele Favoriten (Stern) – ganz oben in der Seitenleiste, per Ziehen sortierbar. */
export const MAX_FAVORITEN = 8;

/** Tab-Leiste unten am Handy: Heute · Scan · Deals · Aufgaben · Mehr (öffnet die Schublade). */
export const HANDY_TABS: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Heute", icon: "📋" },
  { href: "/scan", label: "Scan", icon: "📷" },
  { href: "/deal-eingang", label: "Deals", icon: "🛒" },
  { href: "/?ansicht=liste", label: "Aufgaben", icon: "✅" },
];

/** Seitenleiste schmal (nur Symbole) – als Cookie, damit schon der Server richtig zeichnet. */
export const NAV_SCHMAL_COOKIE = "nav-schmal";

/** Gemerkte offene Gruppe und Untergruppen aus dem Cookie („finanzen,finanzen.rechnungen“). */
export function offeneAusCookie(wert: string | undefined | null): string[] {
  return (wert ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z][a-z0-9]{1,19}(\.[a-z][a-z0-9]{1,19})?$/.test(s)).slice(0, 20);
}

export type NavZustand = { gruppe: string | null; unter: Set<string> };

/**
 * Start-Zustand (Akkordeon): genau eine Gruppe offen – die der aktuellen Seite, sonst die gemerkte, sonst „Heute“.
 * Untergruppen: gemerkte plus die des aktuellen Eintrags (Schlüssel „gruppe.unter“). Im Privatbereich nur „Privat“.
 */
export function startZustand(gemerkt: string[], aktiv: { gruppe: string | null; unter?: string | null }, privatBereich: boolean): NavZustand {
  if (privatBereich) return { gruppe: "privat", unter: new Set() };
  const unter = new Set(gemerkt.filter((k) => k.includes(".")));
  if (aktiv.gruppe && aktiv.unter) unter.add(`${aktiv.gruppe}.${aktiv.unter}`);
  const gruppe = aktiv.gruppe ?? gemerkt.find((k) => !k.includes(".") && k !== "privat") ?? "heute";
  return { gruppe, unter };
}

/** Zustand als Cookie-Wert (Privat wird nie gemerkt). */
export function zustandAlsCookie(z: NavZustand): string {
  return [z.gruppe && z.gruppe !== "privat" ? z.gruppe : null, ...z.unter].filter(Boolean).slice(0, 20).join(",");
}

/**
 * Unterseiten einzelner Menüpunkte (dritte Ebene). Sie stehen nur als Reiter über dem Inhalt, nicht in der
 * Seitenleiste – so zeigt jede Leiste genau eine Ebene: Seitenleiste = Bereiche und Seiten, Reiter = Unterseiten.
 */
export const SUBPAGES: Record<string, NavItem[]> = {
  // Einstellungen: ein Menüeintrag, Unterseiten als Reiter (Abschnitte der Hauptseite über die Sprungleiste dort).
  "/einstellungen": [
    { href: "/einstellungen", label: "Allgemein" },
    { href: "/anbindungen", label: "Anbindungen" },
    { href: "/einstellungen/claude", label: "KI-Assistent" },
    { href: "/einstellungen/hintergrund", label: "Hintergrund & Importe" },
    { href: "/einstellungen/handy", label: "Geräte: Handy & Tesla" },
    { href: "/einstellungen/watch", label: "Apple Watch" },
    { href: "/einstellungen/benachrichtigungen", label: "Benachrichtigungen" },
    { href: "/einstellungen/shop-profile", label: "Shop-Profile" },
    { href: "/einstellungen/abholung", label: "Abholung" },
    { href: "/einstellungen/testumgebung", label: "Testumgebung" },
  ],
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

/** Bereiche mit den Punkten, die diese Person sehen darf (Bereichs-Rechte, Inhaber-Punkte); leere Gruppen fallen weg. */
export function visibleNav(allowed: (path: string) => boolean, isOwner: boolean): NavSection[] {
  const darf = (it: Pick<NavItem, "owner" | "sichtbarMit" | "href">) => (!it.owner || isOwner) && (it.sichtbarMit ? it.sichtbarMit.some(allowed) : allowed(it.href.split(/[?#]/)[0]));
  return NAV.map((s) => {
    const items = s.items.filter(darf);
    return { ...s, items, untergruppen: s.untergruppen?.filter((u) => items.some((it) => it.unter === u.key)) };
  }).filter((s) => s.items.length > 0);
}

/** Seiten ohne Menüeintrag, die diese Person sehen darf (für die Suche). */
export function sichtbareNebenseiten(allowed: (path: string) => boolean, isOwner: boolean): Nebenseite[] {
  return NEBENSEITEN.filter((n) => (!n.owner || isOwner) && allowed(n.href.split(/[?#]/)[0]));
}

export type NavCounter = { href: string; label: string; n: number; alert: boolean; color: string; section: string };

/**
 * Zähler-Chips oben in der Seitenleiste: die fünf festen (Aufgaben, Amazon-ToDos, Posteingang, Belege, Ansprüche),
 * soweit die Person den Punkt sehen darf – immer an derselben Stelle, auch bei 0.
 */
export function navCounters(sections: NavSection[], counts: NavCounts): NavCounter[] {
  const out: NavCounter[] = [];
  for (const c of ZAEHLER_CHIPS) {
    for (const s of sections) {
      const it = s.items.find((i) => i.href === c.href && i.badge);
      if (it?.badge) out.push({ href: c.href, label: c.label, n: counts[it.badge], alert: Boolean(it.alert), color: s.color, section: s.key });
    }
  }
  return out;
}

/** Summe der Zähler einer Liste von Einträgen (für zugeklappte Gruppen- und Untergruppen-Köpfe). */
export function badgeSumme(items: NavItem[], counts: NavCounts): { n: number; alert: boolean } {
  let n = 0;
  let alert = false;
  for (const it of items) {
    const v = it.badge ? counts[it.badge] : 0;
    n += v;
    if (v > 0 && it.alert) alert = true;
  }
  return { n, alert };
}
