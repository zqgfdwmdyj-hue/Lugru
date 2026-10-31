import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireArea } from "@/lib/auth/session";
import { TOPIC_LABEL, type Topic } from "@/lib/inbox/classify";
import { getSettings } from "@/lib/settings";
import { teamMitglieder } from "@/lib/board/service";
import { posteingangEinstellungen, regelLoeschen, regelUmschalten } from "./actions";
import { RegelForm } from "./regel-form";

const AKTION_TEXT = { archivieren: "automatisch archivieren", aufgabe: "als Aufgabe", weiterleiten: "an Zuständigen" } as const;

export default async function RegelnPage({ searchParams }: { searchParams: Promise<{ absender?: string; betreff?: string }> }) {
  const session = await requireArea("posteingang");
  const sp = await searchParams;
  const R = schema.mailRegeln;
  const [regeln, team, settings] = await Promise.all([
    db.select().from(R).where(eq(R.tenantId, session.tenantId)).orderBy(asc(R.createdAt)),
    teamMitglieder(session.tenantId),
    getSettings(session.tenantId),
  ]);
  const name = (id: string | null) => (id ? (team.find((t) => t.id === id)?.name ?? team.find((t) => t.id === id)?.email ?? "?") : "");
  const cfg = settings.posteingang;

  return (
    <>
      <div className="page-head"><div><div className="crumb"><Link href="/posteingang">Posteingang</Link></div><h1>Regeln je Absender/Thema</h1></div></div>
      <div className="row">
        <div style={{ flexGrow: 1, minWidth: 0 }} className="stack">
          <section className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Neue Regel</h2>
            <RegelForm themen={(Object.entries(TOPIC_LABEL) as [Topic, string][]).filter(([k]) => k !== "other")} personen={team.map((t) => ({ id: t.id, name: t.name ?? t.email }))} vorgabe={{ absender: sp.absender, betreff: sp.betreff }} />
          </section>
          <section className="card" style={{ overflow: "auto" }}>
            <table className="table" data-testid="regel-liste">
              <thead><tr><th>Wenn</th><th>Dann</th><th className="num">Treffer</th><th></th></tr></thead>
              <tbody>
                {regeln.length === 0 && <tr><td colSpan={4} className="muted">Noch keine eigenen Regeln.</td></tr>}
                {regeln.map((r) => (
                  <tr key={r.id} style={r.aktiv ? undefined : { opacity: 0.55 }}>
                    <td className="small">
                      {[r.absender && `Absender enthält „${r.absender}“`, r.betreff && `Betreff enthält „${r.betreff}“`, r.thema && `Thema: ${TOPIC_LABEL[r.thema as Topic] ?? r.thema}`].filter(Boolean).join(" · ")}
                    </td>
                    <td className="small">{AKTION_TEXT[r.aktion]}{r.zustaendigId ? ` (${name(r.zustaendigId)})` : ""}{!r.aktiv && <span className="tag" style={{ marginLeft: 6 }}>aus</span>}</td>
                    <td className="num">{r.treffer}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <form action={regelUmschalten} style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><button className="btn-link small" type="submit">{r.aktiv ? "ausschalten" : "einschalten"}</button></form>{" "}
                      <form action={regelLoeschen} style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><button className="btn-link small" type="submit">löschen</button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <aside className="col-side">
          {session.role === "owner" && (
            <section className="card card-pad">
              <h2 style={{ marginTop: 0 }}>Automatisch</h2>
              <form action={posteingangEinstellungen} className="stack" style={{ gap: 8 }} data-testid="posteingang-einstellungen">
                <label className="small"><input type="checkbox" name="autoArchiv" defaultChecked={cfg.autoArchiv} /> Newsletter und Versand-/Lieferbestätigungen beim Eingang archivieren (Bestell-Mails bleiben für den Versand-Abgleich)</label>
                <label className="small"><input type="checkbox" name="terminMails" defaultChecked={cfg.terminMails} /> Termin-Mails (Arzt/Doctolib, Handwerker, Amt, Schule) in den Privatkalender statt in den Posteingang</label>
                <div className="field"><label className="label" htmlFor="vorabend">Vorabend-Erinnerung ab</label><input className="input" id="vorabend" name="vorabendUm" type="time" defaultValue={cfg.vorabendUm} /></div>
                <div className="field"><label className="label" htmlFor="abfahrt">Abfahrt … Minuten vor dem Termin</label><input className="input" id="abfahrt" name="abfahrtVorher" type="number" min={0} max={240} defaultValue={cfg.abfahrtVorher} /></div>
                <div><button className="btn btn-small" type="submit">Speichern</button></div>
              </form>
            </section>
          )}
          <section className="card card-pad small muted">
            Regeln greifen beim Eingang neuer Mails. Alle angegebenen Bedingungen müssen passen; es gilt die erste passende Regel in der Liste (älteste zuerst). „an Zuständigen“ legt eine Aufgabe mit dieser Person an (Delegieren). Archivierte Mails bleiben unter „Archiv“ auffindbar.
          </section>
        </aside>
      </div>
    </>
  );
}
