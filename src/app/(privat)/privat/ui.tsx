import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { shiftMonth } from "@/lib/private/logic";
import { FAMILY_TABS, GROUPS, type PrivatTab } from "./nav-data";

export type { PrivatTab } from "./nav-data";

/** Monat in Links mitnehmen (gemeinsamer Monatsfilter für Familienzeiten, Paarzeit und Rückblick). */
const withMonth = (href: string, month: string | undefined, monthly: boolean) => (monthly && month ? `${href}?monat=${month}` : href);

/**
 * Kopf aller Privat-Seiten: Bereich, Titel und – auf Detailseiten – die Reiter der Gruppe. Die Hauptnavigation
 * (Heute · Kalender · Eintragen · Rückblick · Einstellungen) und „Sperren“ stehen im Rahmen darüber.
 */
export async function PrivatHead({ active, title, sub, month }: { active: PrivatTab; title: string; pin?: boolean; sub?: React.ReactNode; month?: string }) {
  const family = (await getSession())?.privateScope === "familie";
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => !family || FAMILY_TABS.has(t.key)) })).filter((g) => g.tabs.length);
  const current = groups.find((g) => g.tabs.some((t) => t.key === active));
  const monthOf = month && month !== todayIso().slice(0, 7) ? month : undefined;
  const top = ["start", "kalender", "eintragen", "rueckblick", "einstellungen"].includes(active);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">🔒 Privat{current && !top ? ` › ${current.label}` : ""} – nur für euch</div>
          <h1>{title}</h1>
        </div>
        {sub && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{sub}</div>}
      </div>
      {current && !top && current.tabs.length > 1 && (
        <nav className="priv-tabs" aria-label={current.label} data-testid="priv-subtabs">
          {current.tabs.map((t) => (
            <Link key={t.key} href={withMonth(t.href, monthOf, "month" in t && Boolean(t.month))} className={`chip${t.key === active ? " active" : ""}`} aria-current={t.key === active ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
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
export function Choice({ name, options, value }: { name: string; options: { value: string; label: string; disabled?: boolean }[]; value?: string }) {
  return (
    <div className="pick-chips">
      {options.map((o) => (
        <label key={o.value} style={o.disabled ? { opacity: 0.55 } : undefined}>
          <input type="radio" name={name} value={o.value} defaultChecked={value === o.value} disabled={o.disabled} />
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
/** „inkl. Zeitumstellung +1 Std.“ für Zeitspannen über die Umstellung (2–3 Uhr nachts). */
export const clockShiftLabel = (shift: number) => (shift ? `inkl. Zeitumstellung ${shift > 0 ? "+" : "−"}${hoursLabel(Math.abs(shift))}` : "");

/** Status in Listen: „geplant“ / „ausgefallen“ als Kennzeichen (stattgefunden braucht keins). */
export function StatusTag({ status }: { status?: string }) {
  if (status !== "geplant" && status !== "ausgefallen") return null;
  return <span className={`tag ${status === "geplant" ? "tag-info" : "tag-neutral"}`} style={{ marginLeft: 6 }} data-testid="status-tag">{status === "geplant" ? "geplant – zählt noch nicht" : "ausgefallen"}</span>;
}
