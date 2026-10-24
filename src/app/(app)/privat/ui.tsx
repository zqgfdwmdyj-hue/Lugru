import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { shiftMonth } from "@/lib/private/logic";
import { lockAction } from "./actions";

/**
 * Navigation in Gruppen statt zwölf gleichrangiger Reiter: Heute, Partnerschaft, Familienalltag,
 * Gesundheit – Rückblick, Wissen und Einstellungen unter „Mehr“. `month`: Seiten mit Monatsfilter.
 */
const GROUPS = [
  {
    key: "heute",
    label: "Heute",
    tabs: [
      { key: "start", href: "/privat", label: "Tagesübersicht" },
      { key: "aufgaben", href: "/privat/aufgaben", label: "Aufgaben & Termine" },
      { key: "routinen", href: "/privat/routinen", label: "Routinen" },
    ],
  },
  {
    key: "paar",
    label: "Partnerschaft",
    short: "Paar",
    tabs: [
      { key: "paar", href: "/privat/paar", label: "Nähe", month: true },
      { key: "paarzeit", href: "/privat/paar/paarzeit", label: "Paarzeit", month: true },
      { key: "danke", href: "/privat/paar/wertschaetzung", label: "Wertschätzung" },
      { key: "gespraech", href: "/privat/paar/gespraech", label: "Paar-Gespräch" },
    ],
  },
  {
    key: "familie",
    label: "Familienalltag",
    short: "Familie",
    tabs: [
      { key: "kinder", href: "/privat/kinder", label: "Kinderzeit", month: true },
      { key: "ausschlafen", href: "/privat/ausschlafen", label: "Ausschlafen", month: true },
      { key: "auszeit", href: "/privat/auszeit", label: "Auszeit", month: true },
      { key: "familie", href: "/privat/familie", label: "Wer kümmert sich" },
    ],
  },
  {
    key: "gesundheit",
    label: "Gesundheit",
    tabs: [
      { key: "tagebuch", href: "/privat/tagebuch", label: "ADHS-Tagebuch" },
      { key: "bericht", href: "/privat/tagebuch/bericht", label: "Arztbericht" },
    ],
  },
  {
    key: "mehr",
    label: "Mehr",
    tabs: [
      { key: "rueckblick", href: "/privat/rueckblick", label: "Rückblick", month: true },
      { key: "wissen", href: "/privat/wissen", label: "Wissen" },
      { key: "einstellungen", href: "/privat/einstellungen", label: "Einstellungen" },
    ],
  },
] as const;
export type PrivatTab = (typeof GROUPS)[number]["tabs"][number]["key"];
/** Reiter für Personen mit Umfang „familie“ (nur gemeinsame Familieninfos). */
const FAMILY_TABS = new Set<PrivatTab>(["start", "kinder", "ausschlafen", "auszeit", "familie", "einstellungen"]);

/** Monat in Links mitnehmen (gemeinsamer Monatsfilter für Familienzeiten, Paarzeit und Rückblick). */
const withMonth = (href: string, month: string | undefined, monthly: boolean) => (monthly && month ? `${href}?monat=${month}` : href);

/** Kopf aller Privat-Seiten: Titel, Gruppen mit Unterreitern und – mit PIN – „Sperren“. */
export async function PrivatHead({ active, title, pin, sub, month }: { active: PrivatTab; title: string; pin: boolean; sub?: React.ReactNode; month?: string }) {
  const family = (await getSession())?.privateScope === "familie";
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => !family || FAMILY_TABS.has(t.key)) })).filter((g) => g.tabs.length);
  const current = groups.find((g) => g.tabs.some((t) => t.key === active)) ?? groups[0];
  const monthOf = month && month !== todayIso().slice(0, 7) ? month : undefined;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">🔒 Privat – nur für euch</div>
          <h1>{title}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {sub}
          {pin && (
            <form action={lockAction}>
              <button className="btn btn-small" type="submit" title="Privat sofort sperren (PIN nötig)">Sperren</button>
            </form>
          )}
        </div>
      </div>
      <nav className="priv-nav" aria-label="Privat" data-testid="priv-tabs">
        <div className="priv-groups" role="list">
          {groups.map((g) => {
            const first = g.tabs[0] as { href: string; month?: boolean };
            return (
              <Link key={g.key} role="listitem" href={withMonth(first.href, monthOf, Boolean(first.month))} className={`priv-group${g.key === current.key ? " active" : ""}`} aria-current={g.key === current.key ? "true" : undefined} data-testid={`priv-group-${g.key}`}>
                {"short" in g ? (
                  <>
                    <span className="priv-lg">{g.label}</span>
                    <span className="priv-sm">{g.short}</span>
                  </>
                ) : g.label}
              </Link>
            );
          })}
        </div>
        {current.tabs.length > 1 && (
          <div className="priv-tabs" data-testid="priv-subtabs">
            {current.tabs.map((t) => (
              <Link key={t.key} href={withMonth(t.href, monthOf, "month" in t && Boolean(t.month))} className={`chip${t.key === active ? " active" : ""}`} aria-current={t.key === active ? "page" : undefined}>
                {t.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
    </>
  );
}

/** Monatsfilter (gleich auf allen Seiten mit Monatsauswertung). */
export function MonthNav({ path, month, extra = "" }: { path: string; month: string; extra?: string }) {
  const cur = todayIso().slice(0, 7);
  return (
    <div style={{ display: "flex", gap: 6 }} data-testid="month-nav">
      <Link className="btn btn-small" href={`${path}?monat=${shiftMonth(month, -1)}${extra}`} aria-label="Voriger Monat">‹</Link>
      <span className="btn btn-small" style={{ pointerEvents: "none" }}>{monthLabel(month)}</span>
      {month < cur && <Link className="btn btn-small" href={`${path}?monat=${shiftMonth(month, 1)}${extra}`} aria-label="Nächster Monat">›</Link>}
      {month !== cur && <Link className="btn btn-small" href={`${path}${extra ? `?${extra.slice(1)}` : ""}`}>aktuell</Link>}
    </div>
  );
}

/** Monat aus der Adresse (JJJJ-MM), sonst der aktuelle. */
export const monthParam = (v: string | undefined) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : todayIso().slice(0, 7));

/** Zahl oder „nicht erfasst“ – fehlende Einträge sind keine Null. */
export function Counted({ count, children, empty = "nicht erfasst" }: { count: number; children: React.ReactNode; empty?: string }) {
  return count > 0 ? <>{children}</> : <span className="muted" data-testid="not-recorded">{empty}</span>;
}

/** Bewertung 1–5 als große Knöpfe (am Handy gut zu treffen). */
export function Rating({ name, label, low, high, value }: { name: string; label: string; low?: string; high?: string; value?: number }) {
  return (
    <fieldset className="rate">
      <legend className="label">{label}</legend>
      <div className="rate-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input type="radio" name={name} value={n} defaultChecked={value === n} />
            <span>{n}</span>
          </label>
        ))}
      </div>
      {(low || high) && (
        <div className="rate-ends small muted">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      )}
    </fieldset>
  );
}

/** Mehrfachauswahl als Chips (Checkboxen). */
export function Chips({ name, options, values = [] }: { name: string; options: readonly string[]; values?: string[] }) {
  return (
    <div className="pick-chips">
      {options.map((o) => (
        <label key={o}>
          <input type="checkbox" name={name} value={o} defaultChecked={values.includes(o)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

/** Einfachauswahl als Chips (Radio). */
export function Choice({ name, options, value }: { name: string; options: { value: string; label: string }[]; value?: string }) {
  return (
    <div className="pick-chips">
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} value={o.value} defaultChecked={value === o.value} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
export const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const weekday = (iso: string) => WD[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const hoursLabel = (h: number) => `${String(h).replace(".", ",")} Std.`;
