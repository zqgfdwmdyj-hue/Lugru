import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { todayIso } from "@/lib/dates";
import { memberLabels, statusOf, STATUS_LABEL } from "@/lib/private/logic";
import { periodDays, type PeriodEntry, type RitualEntry } from "@/lib/private/kalender";
import { seriesInfo } from "@/lib/private/serie";
import { canEdit, loadEntries, loadEntry, myPartner, privateMembers, privateSettings, requirePrivate, type PrivateKind } from "@/lib/private/service";
import { deleteEntryAction } from "../../actions";
import { ConfirmDelete } from "../confirm-delete";
import { ART_LABEL, EntryForm, type Art } from "../../entry-form";
import { EndPeriod } from "../end-period";
import { PrivatHead, dmy, weekday } from "../../ui";

/** Art der Daten → Formular. Andere Arten (Aufgaben, Tagebuch …) haben ihre eigenen Seiten. */
const ART_OF: Partial<Record<PrivateKind, Art>> = { termin: "termin", kinder: "kinder", auszeit: "auszeit", ausschlafen: "ausschlafen", paarzeit: "paarzeit", intim: "naehe", zuwendung: "zuwendung", periode: "periode" };
const OWN_PAGE: Partial<Record<PrivateKind, string>> = { aufgabe: "/privat/aufgaben", tagebuch: "/privat/tagebuch", routine: "/privat/routinen", zustaendig: "/privat/familie", danke: "/privat/paar/wertschaetzung", stimmung: "/privat/paar/wertschaetzung", gespraech: "/privat/paar/gespraech", dateidee: "/privat/paar/paarzeit", ritual: "/privat/ritual" };

/** Detailseite: jeder Kalendereintrag lässt sich öffnen, ändern und löschen. */
export default async function EintragPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const session = await requirePrivate();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const entry = await loadEntry<Record<string, unknown>>(session, id);
  if (!entry) notFound();
  const art = ART_OF[entry.kind];
  if (!art) redirect(OWN_PAGE[entry.kind] ?? "/privat");
  const today = todayIso();
  const settings = await privateSettings(session.tenantId);
  const day = (entry.data.day as string | undefined) ?? (entry.data.start as string | undefined) ?? today;
  const editable = canEdit(session, entry);
  const linkId = entry.data.linkId as string | undefined;
  const repeatId = entry.data.repeatId as string | undefined;
  const [members, linked, rituals, siblings] = await Promise.all([
    art === "periode" ? privateMembers(session.tenantId) : Promise.resolve([]),
    linkId && (entry.kind === "kinder" || entry.kind === "auszeit") ? loadEntries<{ linkId?: string; person?: "a" | "b" | "beide" }>(session, [entry.kind === "kinder" ? "auszeit" : "kinder"]) : Promise.resolve([]),
    art === "zuwendung" ? loadEntries<RitualEntry>(session, ["ritual"]) : Promise.resolve([]),
    repeatId ? loadEntries<{ day: string; repeatId?: string; repeatEvery?: number; exception?: boolean; status?: string }>(session, [entry.kind]) : Promise.resolve([]),
  ]);
  const repeat = repeatId ? seriesInfo(siblings, siblings.find((x) => x.id === entry.id) ?? (entry as unknown as (typeof siblings)[number])) : null;
  const labels = memberLabels(members);
  const others = members.filter((m) => m.userId !== session.userId).map((m) => ({ userId: m.userId, label: labels.get(m.userId) ?? m.login }));
  const link = linked.find((l) => l.data.linkId === linkId);
  const linkedPerson = link?.data.person;
  const linkedName = link ? `${entry.kind === "kinder" ? "Auszeit" : "Kinderzeit"} ${linkedPerson === "a" || linkedPerson === "b" ? settings.partners[linkedPerson] : linkedPerson === "beide" ? "beide zusammen" : ""}`.trim() : null;
  // Verknüpfung widersprüchlich (z. B. Auszeit und Kinderzeit bei derselben Person)?
  const linkBroken = Boolean(link && (link.data.person === entry.data.person || link.data.person === "beide" || entry.data.person === "beide"));
  const seriesId = entry.data.seriesId as string | undefined;
  const series = seriesId ? rituals.find((r) => r.id === seriesId) : undefined;
  const back = `/privat/kalender?tag=${day}`;
  const status = art === "periode" || art === "naehe" ? null : statusOf(entry.data as { status?: string });
  const period = art === "periode" ? (entry.data as unknown as PeriodEntry) : null;

  return (
    <>
      <PrivatHead active="kalender" title={ART_LABEL[art]} />
      <div className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href={back}>← Kalender ({weekday(day)}, {dmy(day)})</Link>
        {series && <Link href="/privat/ritual">Ganze Serie „{series.data.title}“ ändern</Link>}
      </div>
      {sp.ok && <div className="notice notice-ok small" role="status">{sp.ok}</div>}
      <section className="card card-pad stack" data-testid="entry-detail">
        <div className="small muted" data-testid="entry-meta">
          {status ? <>Status: <strong>{STATUS_LABEL[status]}</strong>{status === "geplant" ? " – zählt erst, wenn es stattgefunden hat" : status === "ausgefallen" ? " – zählt nicht" : ""}</> : null}
          {period ? <>Periode {dmy(period.start)}{period.end ? ` bis ${dmy(period.end)}` : " – läuft"} · {periodDays(period, today)} Tag{periodDays(period, today) === 1 ? "" : "e"}</> : null}
          {linkedName ? <> · 🔗 verknüpft mit {linkedName}</> : null}
          {repeat ? <span data-testid="entry-series"> · 🔁 Serie ({repeat.position}/{repeat.count}){entry.data.exception ? " – einzeln geändert (Ausnahme)" : ""}</span> : null}
          {linkBroken ? <span className="tag tag-warn" style={{ marginLeft: 6 }} data-testid="link-broken"><Link href="/privat/pruefen">passt nicht zusammen – prüfen</Link></span> : null}
          {entry.data.fromEvent ? <span data-testid="entry-from-event"> · aus dem Familienkalender übernommen (dort unverändert; löschen zeigt den Termin wieder als Familientermin)</span> : null}
        </div>
        {editable ? (
          <>
            {period && !period.end && <EndPeriod id={entry.id} today={today} />}
            <EntryForm art={art} today={today} day={day} settings={settings} me={myPartner(settings, session)} id={entry.id} data={entry.data} members={others} ritual={series?.data ?? null} linkedName={linkedName} series={repeat} />
            <ConfirmDelete action={deleteEntryAction} id={entry.id} kind={entry.kind} back={back} linked={Boolean(linkId)} series={repeat} />
          </>
        ) : (
          <p className="small muted">Diesen Eintrag kann nur die Person ändern, die ihn angelegt hat.</p>
        )}
      </section>
    </>
  );
}
