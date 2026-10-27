import Link from "next/link";
import { textOn } from "@/lib/calendar/colors";
import { todayIso } from "@/lib/dates";
import { addDays, isDay, monthGrid, shiftMonth, type PartnerKey } from "@/lib/private/logic";
import { CAL_KIND_LABEL, INTIMATE_KINDS, filterItems, itemsByDay, weekDays, type CalKind } from "@/lib/private/kalender";
import { privateCalendar } from "@/lib/private/calendar-data";
import { requirePrivate } from "@/lib/private/service";
import { PrivatHead, dm, dmy, monthLabel, weekday } from "../ui";
import { ItemChip, KIND_COLOR, Legend, StatusButtons } from "./items";
import { KIND_STYLE } from "@/lib/private/kind-style";

// Gemeinsamer Privatkalender: Woche (Standard), Monat, Tagesliste. Alles aus den vorhandenen Einträgen –
// nichts wird doppelt erfasst. Filter nach Person und Art; jeder Eintrag lässt sich öffnen und ändern.

type View = "woche" | "monat" | "tag";
const ALL_KINDS: CalKind[] = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit", "naehe", "streicheln", "massage", "periode", "extern"];
const FAMILY_KINDS: CalKind[] = ["kinder", "auszeit", "ausschlafen", "extern"];
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

type SP = { ansicht?: string; tag?: string; person?: string; art?: string; neu?: string; ok?: string };

export default async function PrivatKalenderPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const today = todayIso();
  const view: View = sp.ansicht === "monat" || sp.ansicht === "tag" ? sp.ansicht : "woche";
  const anchor = isDay(sp.tag) ? sp.tag! : today;
  const family = session.privateScope === "familie";
  const kindsAllowed = family ? FAMILY_KINDS : ALL_KINDS;
  const person: PartnerKey | null = sp.person === "a" || sp.person === "b" ? sp.person : null;
  const picked = new Set((sp.art ?? "").split(",").filter((k): k is CalKind => (kindsAllowed as string[]).includes(k)));

  const month = anchor.slice(0, 7);
  const grid = monthGrid(month);
  const week = weekDays(anchor);
  const [from, to] = view === "monat" ? [grid[0], grid[grid.length - 1]] : view === "woche" ? [week[0], week[6]] : [anchor, anchor];
  const cal = await privateCalendar(session, from, to, today);
  const names = cal.settings.partners;
  const visible = filterItems(
    cal.items.filter((i) => kindsAllowed.includes(i.kind) && (!family || !INTIMATE_KINDS.has(i.kind))),
    { person, kinds: picked.size ? picked : null },
  );
  const byDay = itemsByDay(visible, from, to);

  // Links: Ansicht, Tag, Filter bleiben erhalten.
  const q = (o: Partial<Record<keyof SP, string | null>>) => {
    const p = new URLSearchParams();
    const merged = { ansicht: view === "woche" ? null : view, tag: anchor === today ? null : anchor, person, art: picked.size ? [...picked].join(",") : null, ...o };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/privat/kalender${s ? `?${s}` : ""}`;
  };
  const step = view === "monat" ? (n: number) => `${shiftMonth(month, n)}-01` : view === "woche" ? (n: number) => addDays(anchor, 7 * n) : (n: number) => addDays(anchor, n);
  const toggleKind = (k: CalKind) => {
    const next = new Set(picked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return q({ art: next.size ? [...next].join(",") : null });
  };
  const title = view === "monat" ? monthLabel(month) : view === "woche" ? `Woche ${dm(week[0])}–${dmy(week[6])}` : `${weekday(anchor)}, ${dmy(anchor)}`;
  const newItem = sp.neu ? visible.find((i) => i.id === sp.neu) ?? cal.items.find((i) => i.id === sp.neu) : undefined;
  const addHref = (d: string) => `/privat/eintragen?tag=${d}`;

  return (
    <>
      <PrivatHead active="kalender" title="Kalender" />
      {sp.ok && (
        <div className="notice notice-ok small" role="status" data-testid="pk-saved">
          {sp.ok}
          {newItem?.href ? <> · <Link href={newItem.href}>Eintrag öffnen</Link></> : null}
          {sp.neu && !visible.some((i) => i.id === sp.neu) && newItem ? " (durch den Filter gerade ausgeblendet)" : null}
        </div>
      )}
      {cal.rhythm && !family && (
        <div className="small" data-testid="pk-rhythm">
          <strong>{cal.ritual?.data.title}:</strong> {cal.rhythm.count}/{cal.rhythm.target} Streicheleinheiten seit der letzten Massage{cal.rhythm.due ? " – Massage ist dran" : ""}
          {cal.rhythm.lastMassage ? <span className="muted"> · letzte Massage {dmy(cal.rhythm.lastMassage)}</span> : null}
          <span className="muted"> · zählt nur Bestätigtes</span>
        </div>
      )}

      <section className="card card-pad stack" style={{ gap: 12 }}>
        <div className="pk-toolbar">
          <div className="pk-seg" role="tablist" aria-label="Ansicht" data-testid="pk-views">
            <Link href={q({ ansicht: null })} className={view === "woche" ? "active" : ""} aria-current={view === "woche" ? "page" : undefined}>Woche</Link>
            <Link href={q({ ansicht: "monat" })} className={view === "monat" ? "active" : ""} aria-current={view === "monat" ? "page" : undefined}>Monat</Link>
            <Link href={q({ ansicht: "tag" })} className={view === "tag" ? "active" : ""} aria-current={view === "tag" ? "page" : undefined}>Tag</Link>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Link className="btn btn-small" href={q({ tag: step(-1) })} aria-label="Zurück">‹</Link>
            <Link className="btn btn-small" href={q({ tag: null })}>Heute</Link>
            <Link className="btn btn-small" href={q({ tag: step(1) })} aria-label="Weiter">›</Link>
          </div>
        </div>
        <h2 data-testid="pk-title">{title}</h2>

        <div className="pk-filters" data-testid="pk-filters">
          <div className="priv-tabs" aria-label="Person">
            <Link href={q({ person: null })} className={`chip${!person ? " active" : ""}`}>Alle</Link>
            {(["a", "b"] as const).map((p) => (
              <Link key={p} href={q({ person: p })} className={`chip${person === p ? " active" : ""}`} data-testid={`pk-person-${p}`}>{names[p]}</Link>
            ))}
          </div>
          <details open={picked.size > 0}>
            <summary className="small" style={{ cursor: "pointer" }}>Arten filtern{picked.size ? ` (${picked.size} gewählt)` : ""}</summary>
            <div className="priv-tabs" style={{ marginTop: 6 }}>
              {kindsAllowed.map((k) => (
                <Link key={k} href={toggleKind(k)} className={`chip kind-chip${picked.has(k) ? " active" : ""}`} style={{ "--c": KIND_COLOR[k] } as React.CSSProperties} data-testid={`pk-kind-${k}`}><span aria-hidden="true">{KIND_STYLE[k].icon} </span>{CAL_KIND_LABEL[k]}</Link>
              ))}
              {picked.size > 0 && <Link href={q({ art: null })} className="chip">alle Arten</Link>}
            </div>
          </details>
        </div>
        <Legend />

        {view === "woche" && (
          <div className="pk-week" data-testid="pk-week">
            {week.map((d) => {
              const list = byDay.get(d) ?? [];
              return (
                <div key={d} className={`pk-wday${d === today ? " pk-today" : ""}`} data-testid={`pk-day-${d}`}>
                  <div className="pk-wday-head">
                    <Link href={q({ ansicht: "tag", tag: d })} style={{ color: "inherit", textDecoration: "none" }}>
                      {weekday(d)} <span className="pk-num">{Number(d.slice(8, 10))}</span>
                    </Link>
                    <Link href={addHref(d)} className="pk-add-day" aria-label={`Am ${dmy(d)} eintragen`}>＋</Link>
                  </div>
                  {list.length === 0 ? <span className="small muted">–</span> : list.map((i) => <ItemChip key={`${i.key}:${d}`} item={i} isNew={Boolean(sp.neu && i.id === sp.neu)} />)}
                </div>
              );
            })}
          </div>
        )}

        {view === "monat" && (
          <div className="cal-grid pk-month" data-testid="pk-month">
            {WD.map((w) => <div key={w} className="cal-wd">{w}</div>)}
            {grid.map((d) => {
              const list = byDay.get(d) ?? [];
              const out = !d.startsWith(month);
              return (
                <div key={d} className={`cal-day${out ? " cal-out" : ""}${d === today ? " cal-today" : ""}`} data-testid={`pk-day-${d}`}>
                  <Link href={q({ ansicht: "tag", tag: d })} className="cal-num" style={{ color: "inherit", textDecoration: "none" }} aria-label={`${weekday(d)}, ${dmy(d)} – ${list.length} Einträge`}>{Number(d.slice(8, 10))}</Link>
                  <div className="cal-items">
                    {list.slice(0, 4).map((i) => <ItemChip key={`${i.key}:${d}`} item={i} day={d} showStatus={false} isNew={Boolean(sp.neu && i.id === sp.neu)} />)}
                    {list.length > 4 && <Link className="cal-more" href={q({ ansicht: "tag", tag: d })}>+{list.length - 4} weitere</Link>}
                  </div>
                  <Link href={q({ ansicht: "tag", tag: d })} className="pk-dots" aria-hidden="true" tabIndex={-1}>
                    {list.slice(0, 6).map((i) => <i key={`${i.key}:${d}`} className={i.status === "geplant" ? "geplant" : ""} style={{ "--c": i.kind === "extern" && i.color ? i.color : KIND_COLOR[i.kind] } as React.CSSProperties} />)}
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        {view === "tag" && (
          <div data-testid="pk-daylist">
            {(byDay.get(anchor) ?? []).length === 0 ? (
              <p className="muted small">Für diesen Tag ist nichts eingetragen{picked.size || person ? " (mit diesem Filter)" : ""}.</p>
            ) : (
              <ul className="pk-list">
                {(byDay.get(anchor) ?? []).map((i) => (
                  <li key={i.key}>
                    <div className="pk-row">
                      <div className="small muted">{i.from ? `${i.from}${i.to ? `–${i.to}` : ""}` : i.endDay ? "ganztägig" : "–"}</div>
                      <div style={{ minWidth: 0 }}>
                        <ItemChip item={i} isNew={Boolean(sp.neu && i.id === sp.neu)} />
                        {i.endDay && i.endDay !== i.day && <div className="small muted" style={{ marginTop: 3 }}>{dmy(i.day)} bis {dmy(i.endDay)}</div>}
                        {i.note && <div className="small muted" style={{ marginTop: 3 }}>{i.note}</div>}
                        <StatusButtons item={i} today={today} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link className="big-add" href={addHref(view === "tag" || anchor !== today ? anchor : today)} data-testid="pk-add">＋ Eintragen</Link>
          {cal.externCalendars.length > 0 && (
            <span className="small muted" data-testid="pk-extern-legend">
              Aus euren verbundenen Kalendern (nur lesen, geschäftliche ausgeblendet):{" "}
              {cal.externCalendars.map((c) => <span key={c.name} style={{ marginRight: 8, whiteSpace: "nowrap" }}><b className="cal-abbr" style={{ "--c": c.color, "--t": textOn(c.color) } as React.CSSProperties}>{c.abbr}</b>{c.name}</span>)}
            </span>
          )}
        </div>
      </section>
    </>
  );
}
