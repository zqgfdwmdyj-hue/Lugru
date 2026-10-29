// Bereiche des Systems für Mitarbeiter-Rechte: Der Inhaber sieht alles; ein Mitarbeiter sieht
// alles oder nur die freigegebenen Bereiche (und bei „Marken“ ggf. nur bestimmte Marken).
// Ohne Server-Abhängigkeiten – wird in proxy.ts, Seiten und Server Actions genutzt.

export type AreaKey = "start" | "posteingang" | "kalender" | "wissen" | "wawi" | "paletten" | "artikel" | "lieferanten" | "marken" | "ebay" | "amazon" | "buchhaltung" | "service" | "geld" | "b2b" | "privat";

export const AREAS: { key: AreaKey; label: string; paths: string[]; home: string }[] = [
  { key: "start", label: "Start & Aufgaben", paths: ["/"], home: "/" },
  { key: "posteingang", label: "Posteingang", paths: ["/posteingang"], home: "/posteingang" },
  { key: "kalender", label: "Kalender", paths: ["/kalender"], home: "/kalender" },
  { key: "wissen", label: "Wissen", paths: ["/wissen"], home: "/wissen" },
  { key: "wawi", label: "WaWi (Aufträge, Einkauf, Produkte, Chargen, Bestand, Listings, Import)", paths: ["/auftraege", "/einkauf", "/chargen", "/bestand", "/listings", "/import", "/produkte"], home: "/auftraege" },
  { key: "paletten", label: "Paletten-Lager (Paletten ein- und auslagern, Monatsabrechnung)", paths: ["/paletten", "/etikett/palette"], home: "/paletten" },
  { key: "artikel", label: "Artikelstamm (eigene Produkte, Bilder, Texte, Amazon/eBay)", paths: ["/artikel"], home: "/artikel" },
  { key: "lieferanten", label: "Lieferanten-Feeds und Großhändler finden (Scannen, Keepa-Prüfung, Boxen, Einkaufsanfragen)", paths: ["/lieferanten"], home: "/lieferanten" },
  { key: "marken", label: "Marken (Ideen, Content, Shop-Analyse, Uhren: Buy & Flip)", paths: ["/marken"], home: "/marken" },
  { key: "ebay", label: "eBay", paths: ["/ebay", "/api/ebay"], home: "/ebay" },
  { key: "amazon", label: "Amazon FBA (ToDos, Inbound, Ansprüche, Remissionen, SAS-Programm, Consultant-Calls, Echtheits-Ordner, Amazon Business)", paths: ["/amazon-todos", "/inbound", "/ansprueche", "/remissionen", "/sas", "/echtheit", "/amazon-business", "/calls"], home: "/amazon-todos" },
  { key: "buchhaltung", label: "Einkauf & Buchhaltung (Rechnungen, COG-Export, Repricer)", paths: ["/rechnungen", "/export", "/repricer"], home: "/rechnungen" },
  { key: "service", label: "Service (Retouren, Fälle, Bewertungen)", paths: ["/retouren", "/faelle", "/bewertungen"], home: "/retouren" },
  { key: "geld", label: "Geld (Gewinn, Liquidität, Hebel, Kapital, Verlust-Stopp)", paths: ["/gewinn", "/cashflow", "/hebel", "/kapital", "/verlust"], home: "/gewinn" },
  { key: "b2b", label: "B2B-Deals (Deals für Prep-Kunden, B2B-Kunden, Sammelbestellungen)", paths: ["/b2b"], home: "/b2b" },
  // Eigenes Recht (memberships.privateAccess) – nie Teil von „alle Bereiche“, auch nicht beim Inhaber.
  { key: "privat", label: "Privat (Paar, Kinder, Therapie, Tagebuch)", paths: ["/privat"], home: "/privat" },
];

/** Bereiche, die man Mitarbeitern über die Bereichs-Auswahl freigeben kann („Privat“ nicht – eigener Schalter). */
export const STAFF_AREAS = AREAS.filter((a) => a.key !== "privat");
export const AREA_KEYS = STAFF_AREAS.map((a) => a.key);

/** Zu welchem Bereich gehört ein Pfad? null = kein Bereich (Login, Einstellungen des Inhabers …). */
export function areaForPath(pathname: string): AreaKey | null {
  for (const a of AREAS) {
    for (const p of a.paths) {
      if (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)) return a.key;
    }
  }
  return null;
}

export type Access = { role: "owner" | "staff"; areas: string[] | null; privateAccess?: boolean; readOnly?: boolean };

/** Inhaber und Mitarbeiter ohne Einschränkung dürfen alles – außer „Privat“, das braucht den eigenen Zugang. */
export function canAccess(a: Access, area: AreaKey | null): boolean {
  // Nur-ansehen-Konten (Prüfer, Testzugang) nie – auch wenn „Privat“ versehentlich freigegeben ist.
  if (area === "privat") return a.privateAccess === true && a.readOnly !== true;
  if (area === null || a.role === "owner" || a.areas === null) return true;
  // Lieferanten-Feeds und Artikelstamm hängen an der WaWi – wer WaWi hat, sieht sie mit.
  return a.areas.includes(area) || ((area === "lieferanten" || area === "artikel") && a.areas.includes("wawi"));
}

/** Wohin nach dem Login bzw. bei einem gesperrten Bereich? */
export function homeFor(a: Access): string {
  if (a.role === "owner" || a.areas === null || a.areas.includes("start")) return "/";
  return STAFF_AREAS.find((x) => a.areas!.includes(x.key))?.home ?? (canAccess(a, "privat") ? "/privat" : "/kein-zugriff");
}

/** Marken, die ein Mitarbeiter sehen darf: null = alle. */
export function brandAllowed(brandIds: string[] | null, role: "owner" | "staff", brandId: string): boolean {
  return role === "owner" || brandIds === null || brandIds.includes(brandId);
}

/**
 * Darf ein Eintrag mit diesem Link angezeigt werden (Aufgaben, Kalender)? Prüft den Bereich
 * und bei Marken-Links (…?marke=<id>) die Marken-Freigabe.
 */
export function linkAllowed(a: Access & { brandIds: string[] | null }, link: string): boolean {
  const [path, query] = link.split("?");
  if (!canAccess(a, areaForPath(path))) return false;
  const marke = new URLSearchParams(query ?? "").get("marke");
  return !marke || brandAllowed(a.brandIds, a.role, marke);
}
