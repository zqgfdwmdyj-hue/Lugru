import Link from "next/link";
import { lockAction } from "./actions";

const TABS = [
  { key: "start", href: "/privat", label: "Übersicht" },
  { key: "paar", href: "/privat/paar", label: "Paar" },
  { key: "kinder", href: "/privat/kinder", label: "Kinderzeit" },
  { key: "ausschlafen", href: "/privat/ausschlafen", label: "Ausschlafen" },
  { key: "aufgaben", href: "/privat/aufgaben", label: "Aufgaben & Termine" },
  { key: "tagebuch", href: "/privat/tagebuch", label: "ADHS-Tagebuch" },
  { key: "wissen", href: "/privat/wissen", label: "Wissen" },
  { key: "einstellungen", href: "/privat/einstellungen", label: "Einstellungen" },
] as const;
export type PrivatTab = (typeof TABS)[number]["key"];

/** Kopf aller Privat-Seiten: Titel, Reiter und – mit PIN – „Sperren“. */
export function PrivatHead({ active, title, pin, sub }: { active: PrivatTab; title: string; pin: boolean; sub?: React.ReactNode }) {
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
      <nav className="priv-tabs" aria-label="Privat" data-testid="priv-tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} className={`chip${t.key === active ? " active" : ""}`} aria-current={t.key === active ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
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
