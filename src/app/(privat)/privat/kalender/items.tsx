import Link from "next/link";
import { STATUS_LABEL } from "@/lib/private/logic";
import { CAL_KIND_LABEL, type CalItem, type CalKind, type DayItem } from "@/lib/private/kalender";
import { occurrenceAction, setStatusAction } from "../eintrag-actions";

/** Farben je Art – der Name der Art und der Status stehen immer zusätzlich als Text dabei. */
export const KIND_COLOR: Record<CalKind, string> = {
  termin: "#1f5fae",
  kinder: "#0d9488",
  auszeit: "#7c3aed",
  ausschlafen: "#4f46e5",
  paarzeit: "#c2410c",
  naehe: "#be185d",
  streicheln: "#db2777",
  massage: "#9d174d",
  periode: "#b91c1c",
  extern: "#6e6e73",
};
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
      {showStatus && <span className="pk-st">{CAL_KIND_LABEL[item.kind]}{statusText(item) && item.kind !== "periode" && item.kind !== "extern" ? ` · ${statusText(item)}` : item.kind === "extern" && item.calendar ? ` · ${item.calendar}` : ""}</span>}
      {time && <span className="pk-time">{time}</span>}
      <span className="pk-title">{quiet ? "\u00a0" : `${item.title}${cont ? " (Fortsetzung)" : ""}`}</span>
    </>
  );
  const style = { "--c": colorOf(item) } as React.CSSProperties;
  const label = `${item.title} – ${CAL_KIND_LABEL[item.kind]}${item.status ? `, ${statusText(item)}` : ""}`;
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
      <span><i className="geplant" /> gestrichelt = geplant (zählt noch nicht)</span>
      <span><i /> gefüllt = stattgefunden</span>
      <span style={{ textDecoration: "line-through" }}>ausgefallen</span>
    </div>
  );
}
