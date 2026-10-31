import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { familyEventPrefill, type EventPrefill } from "@/lib/private/calendar-data";
import { defaultStatus, isDay, memberLabels } from "@/lib/private/logic";
import type { RitualEntry } from "@/lib/private/kalender";
import { loadEntries, myPartner, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { ADOPT_ARTEN, ART_LABEL, EntryForm, FAMILY_ARTEN, type Art } from "../entry-form";
import { KIND_COLOR, KindDot } from "../kalender/items";
import type { CalKind } from "@/lib/private/kalender";
import { PrivatHead, dmy, weekday } from "../ui";

const ARTEN: Art[] = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit", "naehe", "zuwendung", "periode"];
const COLOR: Record<Art, string> = { ...KIND_COLOR, zuwendung: KIND_COLOR.streicheln } as Record<Art, string>;

/** Vorbelegung aus einem Familienkalender-Termin – je Art im passenden Feld (Was, Notiz, Titel). */
function adoptData(art: Art, ev: EventPrefill, today: string): Record<string, unknown> {
  const status = defaultStatus(ev.day, today);
  if (art === "termin") return { day: ev.day, time: ev.from, to: ev.to, title: ev.title.slice(0, 120), with: "familie", person: "beide", status };
  const base = { day: ev.day, from: ev.to ? ev.from : undefined, to: ev.to, status };
  return art === "auszeit" || art === "ausschlafen" ? { ...base, note: ev.title } : { ...base, what: ev.title };
}

/**
 * Ein zentraler Knopf für alles: Art wählen → Formular. Der Tag kommt aus dem Kalender mit (`tag`).
 * `vom`: Termin aus dem Familienkalender übernehmen (z. B. Eishockey als Paarzeit) – Tag, Uhrzeit und Titel
 * sind vorbelegt; danach ersetzt der Privat-Eintrag den Termin im Privatkalender.
 */
export default async function EintragenPage({ searchParams }: { searchParams: Promise<{ art?: string; tag?: string; vom?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const today = todayIso();
  const ev = sp.vom ? await familyEventPrefill(session, sp.vom) : null;
  const day = ev?.day ?? (isDay(sp.tag) ? sp.tag! : today);
  const scoped = session.privateScope === "familie" ? FAMILY_ARTEN : ARTEN;
  const arten = ev ? ADOPT_ARTEN.filter((a) => scoped.includes(a)) : scoped;
  const art = arten.find((a) => a === sp.art) ?? null;
  const settings = await privateSettings(session.tenantId);
  const me = myPartner(settings, session);
  const [members, rituals] = await Promise.all([
    art === "periode" ? privateMembers(session.tenantId) : Promise.resolve([]),
    art === "zuwendung" ? loadEntries<RitualEntry>(session, ["ritual"]) : Promise.resolve([]),
  ]);
  const labels = memberLabels(members);
  const others = members.filter((m) => m.userId !== session.userId).map((m) => ({ userId: m.userId, label: labels.get(m.userId) ?? m.login }));
  const ritual = rituals.find((r) => r.data.active && (!r.data.until || r.data.until >= today))?.data ?? null;
  const href = (a: Art) => (ev ? `/privat/eintragen?art=${a}&vom=${encodeURIComponent(sp.vom!)}` : `/privat/eintragen?art=${a}${day !== today ? `&tag=${day}` : ""}`);

  return (
    <>
      <PrivatHead active="eintragen" title={ev ? "Termin übernehmen" : "Eintragen"} />
      {sp.vom && !ev && (
        <div className="notice notice-warn small" data-testid="adopt-missing">
          Diesen Termin gibt es nicht mehr – der Familienkalender wurde inzwischen abgeglichen. <Link href={`/privat/kalender?tag=${day}`}>Im Kalender erneut antippen</Link>.
        </div>
      )}
      {ev && (
        <section className="card card-pad stack" style={{ gap: 6 }} data-testid="adopt-event">
          <div className="small muted">Aus dem Kalender „{ev.calendar}“</div>
          <div>
            <strong>{weekday(ev.day)}, {dmy(ev.day)} · {ev.from ? `${ev.from}${ev.to ? `–${ev.to}` : ""}` : "ganztägig"}</strong> {ev.title}
          </div>
          <div className="small muted">Was ist das für euch? Art wählen – Tag, Uhrzeit und Titel sind schon eingetragen. Danach steht der Termin als diese Art im Privatkalender (ohne Doppel). Im Familienkalender selbst ändert sich nichts.</div>
        </section>
      )}
      <section className="card card-pad stack" style={{ gap: 12 }}>
        {ev ? (
          <div className="small"><strong>Übernehmen als:</strong></div>
        ) : (
          <div className="small muted">Für {day === today ? "heute" : `${weekday(day)}, ${dmy(day)}`} – Datum lässt sich im Formular ändern. Zukünftiges wird als „geplant“ eingetragen und zählt erst nach Bestätigung.</div>
        )}
        <nav className="pk-art" aria-label={ev ? "Übernehmen als" : "Was eintragen?"} data-testid="art-picker">
          {arten.map((a) => (
            <Link key={a} href={href(a)} className={a === art ? "active" : ""} aria-current={a === art ? "page" : undefined} style={{ "--c": COLOR[a] } as React.CSSProperties} data-testid={`art-${a}`}>
              <KindDot kind={(a === "zuwendung" ? "streicheln" : a) as CalKind} />{ART_LABEL[a]}
            </Link>
          ))}
        </nav>
      </section>
      {art ? (
        <section className="card card-pad stack" data-testid={`form-${art}`}>
          <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}><KindDot kind={(art === "zuwendung" ? "streicheln" : art) as CalKind} />{ART_LABEL[art]}</h2>
          <EntryForm art={art} today={today} day={day} settings={settings} me={me} members={others} ritual={ritual} {...(ev ? { data: adoptData(art, ev, today), fromEvent: ev.ref } : {})} />
        </section>
      ) : (
        <p className="small muted">{ev ? "Bitte oben wählen, als was ihr den Termin übernehmen möchtet." : "Bitte oben wählen, was du eintragen möchtest."}</p>
      )}
      {art === "zuwendung" && !ritual && session.privateScope !== "familie" && (
        <div className="small">Feste Abende? <Link href="/privat/ritual">„Unser Abendritual“ als Wochenvorlage anlegen →</Link></div>
      )}
    </>
  );
}
