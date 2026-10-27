import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { todayIso } from "@/lib/dates";
import { parseOccurrence, ritualOccurrences, type RitualEntry, type TouchEntry } from "@/lib/private/kalender";
import { loadEntries, privateSettings, requirePrivate } from "@/lib/private/service";
import { occurrenceAction } from "../../eintrag-actions";
import { PrivatHead, dmy, weekday } from "../../ui";
import { MoveOccurrence } from "./move";

/**
 * Ein einzelner Termin aus dem Abendritual (noch ohne eigenen Eintrag): bestätigen, ausfallen lassen,
 * auslassen oder verschieben – nur dieses eine Mal. Die ganze Serie ändert man unter „Abendritual“.
 */
export default async function SeriePage({ searchParams }: { searchParams: Promise<{ vorkommen?: string }> }) {
  const session = await requirePrivate({ full: true });
  const key = (await searchParams).vorkommen ?? "";
  const occ = parseOccurrence(key);
  if (!occ) notFound();
  const [rituals, touches, settings] = await Promise.all([loadEntries<RitualEntry>(session, ["ritual"]), loadEntries<TouchEntry>(session, ["zuwendung"]), privateSettings(session.tenantId)]);
  // Schon bearbeitet? Dann den Eintrag selbst öffnen.
  const done = touches.find((t) => t.data.occurrence === key);
  if (done) redirect(`/privat/eintrag/${done.id}`);
  const ritual = rituals.find((r) => r.id === occ.seriesId);
  const o = ritual ? ritualOccurrences(ritual.id, ritual.data, occ.day, occ.day, new Set()).find((x) => x.key === key) : undefined;
  if (!ritual || !o) notFound();
  const today = todayIso();
  const n = settings.partners;
  const what = o.slot.kind === "massage" ? `${n[o.slot.giver]} massiert ${n[o.slot.receiver]}` : `${n[o.slot.giver]} streichelt ${n[o.slot.receiver]}`;
  const future = o.day > today;

  return (
    <>
      <PrivatHead active="kalender" title={o.slot.kind === "massage" ? "Massage" : "Streicheln"} />
      <div className="small"><Link href={`/privat/kalender?tag=${o.day}`}>← Kalender ({weekday(o.day)}, {dmy(o.day)})</Link></div>
      <section className="card card-pad stack" data-testid="occurrence">
        <div>
          <strong>{what}</strong>
          <div className="small muted">{weekday(o.day)}, {dmy(o.day)}{o.slot.time ? `, ${o.slot.time}` : ""} · aus „{ritual.data.title}“ · Status: geplant (zählt erst nach Bestätigung)</div>
        </div>
        <div className="pk-row-actions">
          {!future && (
            <form action={occurrenceAction}>
              <input type="hidden" name="vorkommen" value={key} />
              <button className="btn btn-primary" name="op" value="stattgefunden" type="submit" data-testid="occ-confirm">✓ Hat stattgefunden</button>
            </form>
          )}
          {!future && (
            <form action={occurrenceAction}>
              <input type="hidden" name="vorkommen" value={key} />
              <button className="btn" name="op" value="ausgefallen" type="submit" data-testid="occ-cancel">Ist ausgefallen</button>
            </form>
          )}
          <form action={occurrenceAction}>
            <input type="hidden" name="vorkommen" value={key} />
            <button className="btn" name="op" value="auslassen" type="submit" data-testid="occ-skip">Diesmal auslassen</button>
          </form>
        </div>
        <MoveOccurrence occurrence={key} day={o.day} time={o.slot.time} today={today} />
        <p className="small muted">Das betrifft nur diesen einen Termin. <Link href="/privat/ritual">Ganze Serie ändern →</Link></p>
      </section>
    </>
  );
}
