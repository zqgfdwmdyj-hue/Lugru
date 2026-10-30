// Navigation in „Privat“: oben fünf Hauptpunkte (Heute · Kalender · Eintragen · Rückblick · Einstellungen),
// die Detailseiten bleiben über „Alle Bereiche“ und die Reiter ihrer Gruppe erreichbar.

export const MAIN_NAV = [
  { key: "heute", href: "/privat", label: "Heute", icon: "☀️" },
  { key: "kalender", href: "/privat/kalender", label: "Kalender", icon: "📅" },
  { key: "eintragen", href: "/privat/eintragen", label: "Eintragen", icon: "＋" },
  { key: "rueckblick", href: "/privat/rueckblick", label: "Rückblick", icon: "↺", full: true },
  { key: "einstellungen", href: "/privat/einstellungen", label: "Einstellungen", icon: "⚙︎" },
] as const;

/** Detailseiten in Gruppen. `month`: Seiten mit Monatsfilter. */
export const GROUPS = [
  {
    key: "heute",
    label: "Alltag",
    tabs: [
      { key: "start", href: "/privat", label: "Heute" },
      { key: "aufgaben", href: "/privat/aufgaben", label: "Aufgaben & Termine" },
      { key: "routinen", href: "/privat/routinen", label: "Routinen" },
      { key: "fristen", href: "/privat/fristen", label: "Fristen & Verträge" },
    ],
  },
  {
    key: "paar",
    label: "Partnerschaft",
    tabs: [
      { key: "paar", href: "/privat/paar", label: "Nähe", month: true },
      { key: "ritual", href: "/privat/ritual", label: "Abendritual" },
      { key: "paarzeit", href: "/privat/paar/paarzeit", label: "Paarzeit", month: true },
      { key: "danke", href: "/privat/paar/wertschaetzung", label: "Wertschätzung" },
      { key: "geburtstage", href: "/privat/geburtstage", label: "Geburtstage & Jahrestage" },
      { key: "gespraech", href: "/privat/paar/gespraech", label: "Paar-Gespräch" },
    ],
  },
  {
    key: "familie",
    label: "Familienalltag",
    tabs: [
      { key: "kinder", href: "/privat/kinder", label: "Kinderzeit", month: true },
      { key: "ausschlafen", href: "/privat/ausschlafen", label: "Ausschlafen", month: true },
      { key: "auszeit", href: "/privat/auszeit", label: "Auszeit", month: true },
      { key: "familie", href: "/privat/familie", label: "Wer kümmert sich" },
      { key: "familienaufgaben", href: "/privat/familienaufgaben", label: "Familien-Aufgaben" },
      { key: "schulbriefe", href: "/privat/schulbriefe", label: "Briefe Schule/Kita" },
    ],
  },
  {
    key: "gesundheit",
    label: "Gesundheit",
    tabs: [
      { key: "periode", href: "/privat/periode", label: "Periode" },
      { key: "tagebuch", href: "/privat/tagebuch", label: "ADHS-Tagebuch" },
      { key: "bericht", href: "/privat/tagebuch/bericht", label: "Arztbericht" },
    ],
  },
  {
    key: "mehr",
    label: "Mehr",
    tabs: [
      { key: "kalender", href: "/privat/kalender", label: "Kalender" },
      { key: "eintragen", href: "/privat/eintragen", label: "Eintragen" },
      { key: "rueckblick", href: "/privat/rueckblick", label: "Rückblick", month: true },
      { key: "wissen", href: "/privat/wissen", label: "Wissen" },
      { key: "geld", href: "/privat/geld", label: "Geld" },
      { key: "einstellungen", href: "/privat/einstellungen", label: "Einstellungen" },
    ],
  },
] as const;
export type PrivatTab = (typeof GROUPS)[number]["tabs"][number]["key"];
/** Seiten für Personen mit Umfang „familie“ (nur gemeinsame Familieninfos). */
export const FAMILY_TABS = new Set<PrivatTab>(["start", "kalender", "eintragen", "kinder", "ausschlafen", "auszeit", "familie", "familienaufgaben", "einstellungen"]);
