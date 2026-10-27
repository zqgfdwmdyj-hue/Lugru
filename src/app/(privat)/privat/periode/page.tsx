import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { memberLabels, type PartnerKey } from "@/lib/private/logic";
import { periodDays, type PeriodEntry } from "@/lib/private/kalender";
import { loadEntries, myPartner, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { EntryForm } from "../entry-form";
import { PrivatHead, dmy } from "../ui";

/** Perioden als Liste (auch rückwirkend nachtragen und korrigieren); im Kalender als durchgehender Zeitraum. */
export default async function PeriodePage() {
  const session = await requirePrivate({ full: true });
  const today = todayIso();
  const [periods, s, members] = await Promise.all([loadEntries<PeriodEntry>(session, ["periode"]), privateSettings(session.tenantId), privateMembers(session.tenantId)]);
  const labels = memberLabels(members);
  const others = members.filter((m) => m.userId !== session.userId).map((m) => ({ userId: m.userId, label: labels.get(m.userId) ?? m.login }));
  const sorted = [...periods].sort((a, b) => b.data.start.localeCompare(a.data.start));
  const name = (p: PartnerKey) => s.partners[p];
  return (
    <>
      <PrivatHead active="periode" title="Periode" />
      <p className="small muted">Sichtbar nur für die Person, die sie einträgt – und für Konten, die sie ausdrücklich freigibt. Nie im geschäftlichen oder in einem geteilten Kalender.</p>
      <section className="card card-pad stack" data-testid="period-list">
        <h2>Eingetragen</h2>
        {sorted.length === 0 ? <p className="small muted">Noch nichts eingetragen.</p> : (
          <ul className="pk-list">
            {sorted.map((p) => (
              <li key={p.id}>
                <Link href={`/privat/eintrag/${p.id}`} style={{ color: "inherit" }}>
                  <strong>{dmy(p.data.start)}{p.data.end ? ` – ${dmy(p.data.end)}` : " – läuft"}</strong> · {periodDays(p.data, today)} Tag{periodDays(p.data, today) === 1 ? "" : "e"} · {name(p.data.person)}
                </Link>
                {p.userId !== session.userId && <span className="small muted"> · für dich freigegeben</span>}
                {p.data.note && <div className="small muted">{p.data.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card card-pad stack">
        <h2>Neu eintragen</h2>
        <EntryForm art="periode" today={today} day={today} settings={s} me={myPartner(s, session)} members={others} />
      </section>
    </>
  );
}
