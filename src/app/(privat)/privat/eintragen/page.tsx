import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { isDay, memberLabels } from "@/lib/private/logic";
import type { RitualEntry } from "@/lib/private/kalender";
import { loadEntries, myPartner, privateMembers, privateSettings, requirePrivate } from "@/lib/private/service";
import { ART_LABEL, EntryForm, FAMILY_ARTEN, type Art } from "../entry-form";
import { KIND_COLOR } from "../kalender/items";
import { PrivatHead, dmy, weekday } from "../ui";

const ARTEN: Art[] = ["termin", "kinder", "auszeit", "ausschlafen", "paarzeit", "naehe", "zuwendung", "periode"];
const COLOR: Record<Art, string> = { ...KIND_COLOR, zuwendung: KIND_COLOR.streicheln } as Record<Art, string>;

/** Ein zentraler Knopf für alles: Art wählen → Formular. Der Tag kommt aus dem Kalender mit (`tag`). */
export default async function EintragenPage({ searchParams }: { searchParams: Promise<{ art?: string; tag?: string }> }) {
  const session = await requirePrivate();
  const sp = await searchParams;
  const today = todayIso();
  const day = isDay(sp.tag) ? sp.tag! : today;
  const arten = session.privateScope === "familie" ? FAMILY_ARTEN : ARTEN;
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
  const href = (a: Art) => `/privat/eintragen?art=${a}${day !== today ? `&tag=${day}` : ""}`;

  return (
    <>
      <PrivatHead active="eintragen" title="Eintragen" />
      <section className="card card-pad stack" style={{ gap: 12 }}>
        <div className="small muted">Für {day === today ? "heute" : `${weekday(day)}, ${dmy(day)}`} – Datum lässt sich im Formular ändern. Zukünftiges wird als „geplant“ eingetragen und zählt erst nach Bestätigung.</div>
        <nav className="pk-art" aria-label="Was eintragen?" data-testid="art-picker">
          {arten.map((a) => (
            <Link key={a} href={href(a)} className={a === art ? "active" : ""} aria-current={a === art ? "page" : undefined} style={{ "--c": COLOR[a] } as React.CSSProperties} data-testid={`art-${a}`}>
              <i aria-hidden="true" />{ART_LABEL[a]}
            </Link>
          ))}
        </nav>
      </section>
      {art ? (
        <section className="card card-pad stack" data-testid={`form-${art}`}>
          <h2>{ART_LABEL[art]}</h2>
          <EntryForm art={art} today={today} day={day} settings={settings} me={me} members={others} ritual={ritual} />
        </section>
      ) : (
        <p className="small muted">Bitte oben wählen, was du eintragen möchtest.</p>
      )}
      {art === "zuwendung" && !ritual && session.privateScope !== "familie" && (
        <div className="small">Feste Abende? <Link href="/privat/ritual">„Unser Abendritual“ als Wochenvorlage anlegen →</Link></div>
      )}
    </>
  );
}
