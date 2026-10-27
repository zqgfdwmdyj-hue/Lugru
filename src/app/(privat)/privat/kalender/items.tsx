import Link from "next/link";
import { textOn } from "@/lib/calendar/colors";
import { STATUS_LABEL } from "@/lib/private/logic";
import { KIND_STYLE, STATUS_ICON } from "@/lib/private/kind-style";
import { CAL_KIND_LABEL, type CalItem, type CalKind, type DayItem } from "@/lib/private/kalender";
import { occurrenceAction, setStatusAction } from "../eintrag-actions";

/** Farben je Art – der Name der Art und der Status stehen immer zusätzlich als Text (und Symbol) dabei. */
export const KIND_COLOR: Record<CalKind, string> = Object.fromEntries(Object.entries(KIND_STYLE).map(([k, v]) => [k, v.color])) as Record<CalKind, string>;
export const colorOf = (i: Pick<CalItem, "kind" | "color">) => (i.kind === "extern" && i.color ? i.color : KIND_COLOR[i.kind]);

/** Text zum Status: „geplant“, „stattgefunden“, „ausgefallen“, bei Serien zusätzlich „ausgelassen“. */
export function statusText(i: Pick<CalItem, "status" | "kind" | "virtual" | "calendar"> & { skipped?: boolean }) {
  if (i.kind === "extern") return i.calendar ? `Kalender ${i.calendar}` : CAL_KIND_LABEL.extern;
  if (i.kind === "periode") return CAL_KIND_LABEL.periode;
  if (!i.status) return "";
  if (i.skipped) return "ausgelassen";
  return `${STATUS_LABEL[i.status]}${i.virtual ? " · Abendritual" : ""}`;
}

/** Ein Eintrag im Kalender: gestrichelt = geplant, gefüllt = stattgefunden, durchgestrichen = ausgefallen. */
export function ItemChip({ item, isNew, showStatus = true, day }: { item: DayItem; isNew?: boolean; showStatus?: boolean; day?: string }) {
  const st = item.status ?? "stattgefunden";
  const cls = `pk-item st-${st}${item.endDay && item.endDay !== item.day ? ` pk-span part-${item.part ?? "single"}` : ""}${isNew ? " pk-new" : ""}`;
  const cont = item.part === "mid" || item.part === "end";
  const time = cont ? null : item.from ? `${item.from}${item.to ? `–${item.to}` : ""}` : null;
  // Monatsansicht: mehrtägige Einträge als durchgehender Balken – Text nur am Anfang und montags.
  const quiet = cont && !showStatus && day !== undefined && new Date(`${day}T12:00:00Z`).getUTCDay() !== 1;
  const body = (
    <>
      {showStatus && (
        <span className="pk-st">
          {item.kind === "extern" && item.abbr ? <b className="cal-abbr" style={{ "--c": colorOf(item), "--t": textOn(colorOf(item)) } as React.CSSProperties}>{item.abbr}</b> : <span aria-hidden="true">{KIND_STYLE[item.kind].icon} </span>}
          {item.kind === "extern" && item.calendar ? `Kalender ${item.calendar}` : CAL_KIND_LABEL[item.kind]}
          {item.status && item.kind !== "periode" && item.kind !== "extern" ? <> · <span className="pk-sym" aria-hidden="true">{item.skipped ? "✕" : STATUS_ICON[item.status]}</span> {statusText(item)}</> : ""}
          {item.fromCalendar ? <span className="pk-from" data-testid="pk-from"> · aus Kalender {item.fromCalendar}</span> : null}
          {item.kind === "extern" && item.href ? <span className="pk-adopt" aria-hidden="true">übernehmen ›</span> : null}
        </span>
      )}
      {!showStatus && !quiet && (item.kind === "extern" && item.abbr ? <b className="cal-abbr" style={{ "--c": colorOf(item), "--t": textOn(colorOf(item)) } as React.CSSProperties}>{item.abbr}</b> : <span aria-hidden="true">{item.status && item.kind !== "extern" && item.kind !== "periode" ? (item.skipped ? "✕" : STATUS_ICON[item.status]) : KIND_STYLE[item.kind].icon} </span>)}
      {time && <span className="pk-time">{time}</span>}
      <span className="pk-title">{quiet ? "\u00a0" : `${item.title}${cont ? " (Fortsetzung)" : ""}`}</span>
    </>
  );
  const style = { "--c": colorOf(item) } as React.CSSProperties;
  const label = `${item.title} – ${CAL_KIND_LABEL[item.kind]}${item.status ? `, ${statusText(item)}` : ""}${item.fromCalendar ? `, aus Kalender ${item.fromCalendar}` : ""}${item.kind === "extern" && item.href ? " – antippen, um ihn als Paarzeit, Kinderzeit … zu übernehmen" : ""}`;
  return item.href ? (
    <Link href={item.href} className={cls} style={style} aria-label={label} data-testid="pk-item" data-kind={item.kind} data-status={item.status ?? ""} data-new={isNew ? "1" : undefined}>{body}</Link>
  ) : (
    <span className={cls} style={style} aria-label={label} data-testid="pk-item" data-kind={item.kind}>{body}</span>
  );
}

/** Schnell bestätigen: stattgefunden / ausgefallen (Serie zusätzlich: auslassen). Nur bei planbaren Einträgen. */
export function StatusButtons({ item, today }: { item: CalItem; today: string }) {
  if (!item.status || item.kind === "naehe" || item.kind === "periode" || item.kind === "extern") return null;
  const future = item.day > today;
  if (item.virtual) {
    const key = decodeURIComponent(item.href.split("vorkommen=")[1] ?? "");
    return (
      <div className="pk-row-actions" data-testid="pk-actions">
        {!future && (
          <form action={occurrenceAction}>
            <input type="hidden" name="vorkommen" value={key} />
            <button className="btn btn-small" name="op" value="stattgefunden" type="submit">✓ stattgefunden</button>
          </form>
        )}
        <form action={occurrenceAction}>
          <input type="hidden" name="vorkommen" value={key} />
          <button className="btn btn-small" name="op" value={future ? "auslassen" : "ausgefallen"} type="submit">{future ? "auslassen" : "ausgefallen"}</button>
        </form>
        <Link className="btn btn-small" href={item.href}>verschieben …</Link>
      </div>
    );
  }
  if (!item.id) return null;
  const options = (["stattgefunden", "ausgefallen", "geplant"] as const).filter((s) => s !== item.status && !(s === "stattgefunden" && future));
  return (
    <div className="pk-row-actions" data-testid="pk-actions">
      {options.map((s) => (
        <form key={s} action={setStatusAction}>
          <input type="hidden" name="id" value={item.id} />
          <button className="btn btn-small" name="status" value={s} type="submit">{s === "stattgefunden" ? "✓ stattgefunden" : s === "ausgefallen" ? "ausgefallen" : "wieder geplant"}</button>
        </form>
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="pk-legend" data-testid="pk-legend">
      <span><i className="geplant" /> ○ geplant – farbiger Rahmen, zählt noch nicht</span>
      <span><i /> ✓ stattgefunden – gefüllt</span>
      <span><i className="ausgefallen" /> ✕ ausgefallen</span>
    </div>
  );
}

/** Farbpunkte mit Symbol je Art (für Filter, Eintragen und Rückblick). */
export function KindDot({ kind }: { kind: CalKind }) {
  return <span className="kind-dot" style={{ "--c": KIND_STYLE[kind].color } as React.CSSProperties} aria-hidden="true">{KIND_STYLE[kind].icon}</span>;
}
