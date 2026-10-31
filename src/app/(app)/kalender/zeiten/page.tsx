import Link from "next/link";
import { requireArea } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { WOCHENTAG_TEXT } from "@/lib/zeit/bloecke";
import { ladeBloecke, wochenRueckblick } from "@/lib/zeit/service";
import { blockAnlegenAction, blockLoeschenAction, blockUmschaltenAction } from "./actions";

// Feste freie Zeiten (Sperrzeit mit höchster Priorität) und reservierte Kapazität; Wochenrückblick.

const dmy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);
const tage = (w: number[]) => w.map((x) => WOCHENTAG_TEXT[x]).join(", ");

export default async function ZeitenPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireArea("kalender");
  const sp = await searchParams;
  const heute = todayIso();
  const [alle, rueck] = await Promise.all([ladeBloecke(session.tenantId), wochenRueckblick(session.tenantId, session.userId, heute)]);
  const frei = alle.filter((b) => b.art === "frei" && b.userId === session.userId);
  const reserviert = alle.filter((b) => b.art === "reserviert");
  const owner = session.role === "owner";
  const eingehalten = rueck.filter((r) => r.eingehalten).length;

  const Formular = ({ art }: { art: "frei" | "reserviert" }) => (
    <form action={blockAnlegenAction} className="stack" style={{ gap: 8, marginTop: 10 }}>
      <input type="hidden" name="art" value={art} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label className="small">Bezeichnung<input name="titel" placeholder={art === "frei" ? "z. B. Freier Abend" : "z. B. Retouren-Prüfung"} /></label>
        <label className="small">ab Uhrzeit (leer = ganzer Tag)<input name="von_zeit" placeholder="18:00" style={{ width: 90 }} /></label>
        {art === "reserviert" && <label className="small">Stunden je Tag<input name="stunden" defaultValue="2" inputMode="decimal" style={{ width: 70 }} /></label>}
        <label className="small">gültig ab<input name="ab" placeholder="TT.MM.JJJJ" style={{ width: 110 }} /></label>
        <label className="small">bis<input name="bis" placeholder="TT.MM.JJJJ" style={{ width: 110 }} /></label>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} className="small">
        {[1, 2, 3, 4, 5, 6, 7].map((w) => (
          <label key={w}><input type="checkbox" name="wt" value={w} defaultChecked={art === "reserviert" ? w <= 5 : false} /> {WOCHENTAG_TEXT[w]}</label>
        ))}
      </div>
      <div><button className="btn" type="submit" data-testid={`zeit-anlegen-${art}`}>Hinzufügen</button></div>
    </form>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link href="/kalender">Kalender</Link></div>
          <h1>Freie Zeiten</h1>
        </div>
      </div>
      {sp.meldung && <div className="notice notice-ok small" style={{ marginBottom: 12 }} role="status">{sp.meldung}</div>}

      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>Meine festen freien Zeiten</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Sperrzeit mit höchster Priorität: Geschäftliche Aufgaben, die auf einen freien Tag fallen würden, verschiebt das System automatisch auf den nächsten Arbeitstag. Ausnahme: Frist heute und „wichtig“ – dann fragt die Startseite nach.
        </p>
        {frei.length === 0 ? (
          <p className="small muted">Noch keine freien Zeiten.</p>
        ) : (
          <div className="stack" style={{ gap: 6 }} data-testid="zeiten-frei">
            {frei.map((b) => (
              <div key={b.id} className="small" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", opacity: b.aktiv ? 1 : 0.55 }} data-testid="zeit-block">
                <span>🌙 <strong>{b.titel}</strong> · {tage(b.wochentage)} · {b.ganztags ? "ganzer Tag" : `ab ${b.vonZeit}`}{b.gueltigVon || b.gueltigBis ? ` · ${dmy(b.gueltigVon) ?? "…"} – ${dmy(b.gueltigBis) ?? "…"}` : ""}{b.aktiv ? "" : " · pausiert"}</span>
                <form action={blockUmschaltenAction}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">{b.aktiv ? "pausieren" : "aktivieren"}</button></form>
                <form action={blockLoeschenAction}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">entfernen</button></form>
              </div>
            ))}
          </div>
        )}
        <Formular art="frei" />
      </section>

      <section className="card card-pad" style={{ marginBottom: 14 }} data-testid="zeiten-rueckblick">
        <h2 style={{ marginTop: 0 }}>Wochenrückblick</h2>
        {rueck.length === 0 ? (
          <p className="small muted">In den letzten 7 Tagen lag keine freie Zeit.</p>
        ) : (
          <>
            <p className="small" style={{ marginTop: 0 }}><strong>{eingehalten} von {rueck.length}</strong> freien Zeiten eingehalten (keine geschäftliche Aufgabe erledigt).</p>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {rueck.map((r) => (
                <li key={`${r.tag}-${r.titel}`}>{dmy(r.tag)} · {r.titel}: {r.eingehalten ? "eingehalten ✓" : `${r.erledigt} Aufgabe${r.erledigt === 1 ? "" : "n"} erledigt`}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Reservierte Zeiten</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Kapazität, die im Tagesplan freigehalten wird – z. B. für die Retouren-Prüfung in der Retourenwelle im Januar.</p>
        {reserviert.length === 0 ? (
          <p className="small muted">Keine.</p>
        ) : (
          <div className="stack" style={{ gap: 6 }} data-testid="zeiten-reserviert">
            {reserviert.map((b) => (
              <div key={b.id} className="small" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", opacity: b.aktiv ? 1 : 0.55 }}>
                <span>⏳ <strong>{b.titel}</strong> · {tage(b.wochentage)} · {String(b.stunden ?? 0).replace(".", ",")} Std.{b.gueltigVon || b.gueltigBis ? ` · ${dmy(b.gueltigVon) ?? "…"} – ${dmy(b.gueltigBis) ?? "…"}` : ""}{b.link && <> · <Link href={b.link}>öffnen</Link></>}</span>
                {owner && (
                  <>
                    <form action={blockUmschaltenAction}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">{b.aktiv ? "pausieren" : "aktivieren"}</button></form>
                    <form action={blockLoeschenAction}><input type="hidden" name="id" value={b.id} /><button className="btn-link small" type="submit">entfernen</button></form>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {owner && <Formular art="reserviert" />}
      </section>
    </>
  );
}
