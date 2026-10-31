// Tagesübersicht: Aufgaben nach Zeitfenster einordnen, nach Dringlichkeit gewichten und gleichartige,
// automatisch erzeugte Aufgaben zu Arbeitsvorräten bündeln. Reine Logik – Abfragen in der Startseite.

export type TaskLite = {
  id: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  priority: "critical" | "normal" | "low";
  category: string;
  systemKey: string | null;
  link: string | null;
  createdAt: Date;
};

export type Bucket = "ueberfaellig" | "heute" | "woche" | "spaeter" | "ohne";
/** Eine Zeitlogik überall (Zähler, Blöcke, Liste): „Nächste 7 Tage“ = morgen bis in 7 Tagen, „Später“ = danach. */
export const BUCKET_LABEL: Record<Bucket, string> = { ueberfaellig: "Überfällig", heute: "Heute", woche: "Nächste 7 Tage", spaeter: "Später", ohne: "Ohne Datum" };

const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000);

export function bucketOf(t: Pick<TaskLite, "dueDate">, today: string): Bucket {
  if (!t.dueDate) return "ohne";
  const d = daysBetween(today, t.dueDate);
  if (d < 0) return "ueberfaellig";
  if (d === 0) return "heute";
  if (d <= 7) return "woche";
  return "spaeter";
}

/** Wirtschaftliche Bedeutung je Bereich (grob): Versand und Geld vor Einkauf und Marken. */
const CATEGORY_WEIGHT: Record<string, number> = { versand: 15, geld: 12, amazon: 9, ebay: 9, support: 8, einkauf: 5, eigene: 6, system: 3, marken: 0 };

export function scoreOf(t: TaskLite, today: string): number {
  let s = CATEGORY_WEIGHT[t.category] ?? 4;
  if (t.priority === "critical") s += 100;
  if (t.priority === "low") s -= 10;
  if (t.dueDate) {
    const d = daysBetween(today, t.dueDate);
    if (d < 0) s += 50 + Math.min(-d, 30);
    else if (d === 0) s += 40;
    else if (d <= 7) s += 20 - d;
  }
  return s;
}

/** Systemschlüssel automatischer Ideen (auch als SQL-Muster für Zähler genutzt). */
export const IDEA_KEY_PATTERN = "^(idea|research|content|box-auto|brand)";

/** Arbeitsvorräte: automatisch erzeugte Aufgaben gleicher Art (Schlüssel-Anfang) gehören zusammen. */
type GroupDef = { label: string; href: string; ideas?: boolean };
const GROUPS: [RegExp, GroupDef][] = [
  [/^lead-(followup|reply)/, { label: "Lieferanten nachfassen", href: "/board" }],
  [/^invoices?-review|^lots-without-invoice|^accountone-ek|^cost-conflicts/, { label: "Rechnungen & EK prüfen", href: "/rechnungen" }],
  [/^removal/, { label: "Remissionen bestätigen", href: "/remissionen" }],
  [/^claims/, { label: "Ansprüche bearbeiten", href: "/ansprueche" }],
  [/^cases/, { label: "Fälle bearbeiten", href: "/faelle" }],
  [/^returns|^ret(nr|dmg|wrong)/, { label: "Retouren prüfen", href: "/retouren" }],
  [/^stock-manual|^oversold|^below|^unsellable/, { label: "Bestand korrigieren", href: "/bestand" }],
  [/^mail/, { label: "Posteingang", href: "/posteingang" }],
  [/^amazon-todo/, { label: "Amazon-ToDos", href: "/amazon-todos" }],
  [new RegExp(IDEA_KEY_PATTERN), { label: "Ideen, Saison & Content", href: "/marken", ideas: true }],
  [/^pallet/, { label: "Paletten-Lager", href: "/paletten" }],
  [/^temu/, { label: "Temu", href: "/listings/temu" }],
];

/**
 * Unverbindliche Vorschläge (automatisch erzeugte Ideen, Box-Vorschläge, KI-Content, Recherche): keine
 * Pflichtaufgaben – sie zählen nicht als überfällig, nicht in den Zeitfenstern und nicht im Kalender.
 * Selbst angelegte Aufgaben (ohne Systemschlüssel) sind immer verbindlich.
 */
export function isIdeaTask(t: Pick<TaskLite, "systemKey" | "category">): boolean {
  return t.systemKey !== null && Boolean(groupOf(t)?.ideas);
}

export function groupOf(t: Pick<TaskLite, "systemKey" | "category">): (GroupDef & { key: string }) | null {
  if (t.category === "marken") return { key: "ideen", label: "Ideen, Saison & Content", href: "/marken", ideas: true };
  if (!t.systemKey) return null;
  for (const [re, g] of GROUPS) if (re.test(t.systemKey)) return { ...g, key: g.label };
  return null;
}

export type Bundle = { key: string; label: string; href: string; tasks: TaskLite[]; overdue: number; next: string | null };

export type DayPlan = {
  critical: TaskLite[];
  top: TaskLite[];
  bundles: Bundle[];
  ideas: TaskLite[];
  /** Alle verbindlichen Aufgaben mit Fälligkeit nach den nächsten 7 Tagen – gleich dem Zähler „Später“. */
  later: TaskLite[];
  /** Alle verbindlichen Aufgaben ohne Fälligkeit – gleich dem Zähler „Ohne Datum“. */
  noDate: TaskLite[];
  /** Verbindliche Aufgaben bis in 7 Tagen, die nicht oben stehen (gebündelt oder über der Höchstzahl). */
  soonElsewhere: number;
  counts: Record<Bucket, number>;
};

/** Zähler je Zeitfenster – nur verbindliche Aufgaben (Ideen zählen nicht). Gleiche Zahl in Liste und Startseite. */
export function bucketCounts(tasks: Pick<TaskLite, "dueDate" | "systemKey" | "category">[], today: string): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { ueberfaellig: 0, heute: 0, woche: 0, spaeter: 0, ohne: 0 };
  for (const t of tasks) if (!isIdeaTask(t)) counts[bucketOf(t, today)]++;
  return counts;
}

/**
 * Tagesplan: kritische Aufgaben, die wichtigsten (höchstens `topMax`) mit Fälligkeit bis Ende der Woche,
 * gebündelte Arbeitsvorräte (ab 2 gleichartigen), Ideen sowie „Später“ und „Ohne Datum“ zum Einklappen.
 */
export function planDay(tasks: TaskLite[], today: string, topMax = 8): DayPlan {
  const counts = bucketCounts(tasks, today);
  const byGroup = new Map<string, { def: GroupDef & { key: string }; tasks: TaskLite[] }>();
  for (const t of tasks) {
    const g = groupOf(t);
    if (!g || t.priority === "critical") continue;
    if (g.ideas && !isIdeaTask(t)) continue; // selbst angelegte Marken-Aufgabe: verbindlich, nicht bei den Ideen
    const e = byGroup.get(g.key) ?? { def: g, tasks: [] };
    e.tasks.push(t);
    byGroup.set(g.key, e);
  }
  const bundled = new Set<string>();
  const ideas: TaskLite[] = [];
  const bundles: Bundle[] = [];
  for (const { def, tasks: list } of byGroup.values()) {
    if (def.ideas) {
      for (const t of list) bundled.add(t.id);
      ideas.push(...list);
      continue;
    }
    if (list.length < 2) continue;
    for (const t of list) bundled.add(t.id);
    const dues = list.map((t) => t.dueDate).filter((d): d is string => Boolean(d)).sort();
    bundles.push({ key: def.key, label: def.label, href: commonHref(list) ?? def.href, tasks: list.sort((a, b) => scoreOf(b, today) - scoreOf(a, today)), overdue: list.filter((t) => bucketOf(t, today) === "ueberfaellig").length, next: dues[0] ?? null });
  }
  bundles.sort((a, b) => b.overdue - a.overdue || b.tasks.length - a.tasks.length);
  const rest = tasks.filter((t) => !bundled.has(t.id));
  const critical = rest.filter((t) => t.priority === "critical").sort((a, b) => scoreOf(b, today) - scoreOf(a, today));
  const candidates = rest.filter((t) => t.priority !== "critical" && ["ueberfaellig", "heute", "woche"].includes(bucketOf(t, today)));
  const top = candidates.sort((a, b) => scoreOf(b, today) - scoreOf(a, today)).slice(0, topMax);
  const shown = new Set([...critical, ...top].map((t) => t.id));
  const binding = tasks.filter((t) => !isIdeaTask(t));
  const soon = binding.filter((t) => ["ueberfaellig", "heute", "woche"].includes(bucketOf(t, today)));
  return {
    critical,
    top,
    bundles,
    ideas: ideas.sort((a, b) => +b.createdAt - +a.createdAt),
    // „Später“ und „Ohne Datum“ zeigen die ganze Menge des Zählers (auch Aufgaben aus Arbeitsvorräten).
    later: binding.filter((t) => bucketOf(t, today) === "spaeter").sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    noDate: binding.filter((t) => t.dueDate === null).sort((a, b) => scoreOf(b, today) - scoreOf(a, today) || +b.createdAt - +a.createdAt),
    soonElsewhere: soon.filter((t) => !shown.has(t.id)).length,
    counts,
  };
}

/** Gemeinsamer Pfad der Links (ohne Abfrage) – dann führt der Arbeitsvorrat genau dorthin. */
function commonHref(list: TaskLite[]): string | null {
  const paths = list.map((t) => t.link?.split(/[?#]/)[0] ?? null);
  if (paths.some((p) => !p)) return null;
  return paths.every((p) => p === paths[0]) ? paths[0] : null;
}

// ---- Datenstand ----------------------------------------------------------------------------------

export type Freshness = { key: string; label: string; last: Date | null; maxAgeDays: number; href: string; stale: boolean; missing: boolean };

export type AreaState = "fehler" | "fehlt" | "veraltet" | "unvollstaendig" | "ersatz" | "aktuell";
export const AREA_STATE_LABEL: Record<AreaState, string> = { fehler: "Fehler", fehlt: "fehlt", veraltet: "veraltet", unvollstaendig: "unvollständig", ersatz: "Ersatzquelle", aktuell: "aktuell" };

/**
 * Ersatzquelle für einen fehlenden/veralteten Bericht (z. B. FBA-Bestand aus sellerboard): wofür sie reicht
 * und wofür der Bericht weiterhin nötig ist.
 */
export type Substitute = { label: string; last: Date; covers: string[]; needs: string[] };

/** FBA-Bestand: was der sellerboard-Bestand abdeckt und was nur der Amazon-Bestandsbericht liefert. */
export const FBA_SUBSTITUTE = {
  covers: ["Bestand & Lagerwert", "Produktseiten", "Repricer", "Nachbestellung", "Hebel (Ladenhüter)"],
  needs: ["nicht verkaufbare Einheiten (Remissionen, Warnung „unverkäuflich“)", "Aufteilung „unterwegs“ in angelegt / versendet / in Annahme"],
};

/** Zustand je Bereich und die passende nächste Aktion (Text + Ziel). */
export function areaStep(a: { key: string; missing: boolean; stale: boolean; error: string | null; via?: string; empty?: boolean; substitute?: Substitute | null }): { state: AreaState; step: string | null; href: string | null } {
  const report = a.key.startsWith("report:");
  const job = a.key.startsWith("job:");
  if (a.error) return { state: "fehler", step: job ? "Anbindung prüfen und Abruf neu starten" : "Fehler ansehen und erneut importieren", href: job ? "/anbindungen" : "/import#upload" };
  if ((a.missing || a.stale) && a.substitute)
    return {
      state: "ersatz",
      step: `${a.missing ? "Bericht fehlt" : "Bericht veraltet"}; ${a.substitute.label} – reicht für: ${a.substitute.covers.join(", ")}. Bericht weiter nötig für: ${a.substitute.needs.join("; ")}.`,
      href: "/anbindungen?p=amazon_sp#amazon_sp",
    };
  if (a.missing) return { state: "fehlt", step: report ? "Bericht automatisch holen lassen (Anbindungen → Amazon) oder unten hochladen" : job ? "Anbindung einrichten" : "Export hochladen", href: report ? "/anbindungen?p=amazon_sp#amazon_sp" : job ? "/anbindungen" : "/import#upload" };
  if (a.empty) return { state: "unvollstaendig", step: "Letzter Bericht war leer – Zeitraum prüfen und neu holen", href: "/import#upload" };
  if (a.stale) return { state: "veraltet", step: report && a.via === "api" ? "Automatischer Abruf hängt – Anbindung prüfen" : report ? "Neuen Bericht hochladen oder automatisch holen lassen" : job ? "Abruf läuft nicht mehr – Anbindung prüfen" : "Neuen Export hochladen", href: report && a.via !== "api" ? "/import#upload" : "/anbindungen" };
  return { state: "aktuell", step: null, href: null };
}

/** Veraltet, wenn älter als `maxAgeDays`; fehlt, wenn es nie Daten gab. */
export function freshness(items: Omit<Freshness, "stale" | "missing">[], now: Date): Freshness[] {
  return items.map((i) => ({ ...i, missing: i.last === null, stale: i.last !== null && now.getTime() - i.last.getTime() > i.maxAgeDays * 86_400_000 }));
}
