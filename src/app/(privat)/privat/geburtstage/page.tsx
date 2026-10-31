import { todayIso } from "@/lib/dates";
import { ART_TEXT, demnaechst, naechstesMal, type Jahrestag } from "@/lib/private/familie-termine";
import { loadEntries, requirePrivate } from "@/lib/private/service";
import { PrivatHead, dmy } from "../ui";
import { jahrestagLoeschenAction, jahrestagSpeichernAction } from "./actions";

// Geburtstage & Jahrestage (Modul 9): Liste mit Beziehung und Geschenkideen; Erinnerung 14 Tage vorher (mit Idee)
// und 3 Tage vorher (Karte/Anruf) – als Mitteilung nur an Personen mit vollem Privat-Zugang.

const anzeige = (d: string) => (d.length === 5 ? `${d.slice(3, 5)}.${d.slice(0, 2)}.` : dmy(d));

export default async function GeburtstagePage({ searchParams }: { searchParams: Promise<{ meldung?: string; bearbeiten?: string }> }) {
  const session = await requirePrivate({ full: true });
  const sp = await searchParams;
  const heute = todayIso();
  const alle = await loadEntries<Jahrestag>(session, ["geburtstag"]);
  const bald = demnaechst(alle, heute, 30);
  const sortiert = [...alle].sort((a, b) => naechstesMal(a.data.datum, heute).tag.localeCompare(naechstesMal(b.data.datum, heute).tag));
  const edit = sp.bearbeiten ? alle.find((e) => e.id === sp.bearbeiten) : undefined;
  const v = edit?.data;
  return (
    <>
      <PrivatHead active="geburtstage" title="Geburtstage & Jahrestage" />
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}
      {bald.length > 0 && (
        <div className="notice notice-info small" style={{ marginBottom: 12 }} data-testid="jt-bald">
          <strong>In den nächsten 30 Tagen:</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {bald.map((e) => <li key={e.id}>{dmy(e.tag)} – {ART_TEXT[e.data.art]} {e.data.name}{e.jahre ? ` (${e.jahre})` : ""}{e.inTagen === 0 ? " – heute" : ` – in ${e.inTagen} Tagen`}{e.data.ideen ? ` · Idee: ${e.data.ideen.split(/\r?\n/)[0]}` : ""}</li>)}
          </ul>
        </div>
      )}
      <section className="card card-pad" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>{edit ? `${v!.name} bearbeiten` : "Neu"}</h2>
        <form action={jahrestagSpeichernAction} className="stack" style={{ gap: 8 }} data-testid="jt-form">
          {edit && <input type="hidden" name="id" value={edit.id} />}
          <div className="grid-2" style={{ gap: 8 }}>
            <div className="field"><label className="label" htmlFor="jt-name">Name</label><input className="input" id="jt-name" name="name" required maxLength={80} defaultValue={v?.name ?? ""} /></div>
            <div className="field"><label className="label" htmlFor="jt-art">Art</label><select className="input" id="jt-art" name="art" defaultValue={v?.art ?? "geburtstag"}><option value="geburtstag">Geburtstag</option><option value="jahrestag">Jahrestag</option></select></div>
            <div className="field"><label className="label" htmlFor="jt-datum">Datum (z. B. 14.03. oder 14.03.1990)</label><input className="input" id="jt-datum" name="datum" required defaultValue={v ? anzeige(v.datum).replace(/\.$/, ".") : ""} /></div>
            <div className="field"><label className="label" htmlFor="jt-bez">Beziehung</label><input className="input" id="jt-bez" name="beziehung" maxLength={60} placeholder="z. B. Mutter, Freundin, Hochzeitstag" defaultValue={v?.beziehung ?? ""} /></div>
          </div>
          <label className="small"><input type="checkbox" name="jahr" value="1" defaultChecked={!v || v.datum.length > 5} /> Jahr merken (Alter bzw. Jahre anzeigen)</label>
          <div className="field"><label className="label" htmlFor="jt-ideen">Geschenkideen (eine je Zeile)</label><textarea className="input" id="jt-ideen" name="ideen" rows={3} maxLength={1000} defaultValue={v?.ideen ?? ""} /></div>
          <div><button className="btn btn-primary btn-small" type="submit">Speichern</button></div>
        </form>
      </section>
      <section className="card" style={{ overflow: "auto" }}>
        <table className="table small" data-testid="jt-liste">
          <thead><tr><th>Nächstes Mal</th><th>Wer</th><th>Ideen</th><th /></tr></thead>
          <tbody>
            {sortiert.length === 0 && <tr><td colSpan={4} className="muted">Noch nichts eingetragen.</td></tr>}
            {sortiert.map((e) => {
              const n = naechstesMal(e.data.datum, heute);
              return (
                <tr key={e.id}>
                  <td className="num">{dmy(n.tag)}</td>
                  <td>{ART_TEXT[e.data.art]} {e.data.name}{n.jahre ? ` (${n.jahre})` : ""}{e.data.beziehung ? <div className="muted">{e.data.beziehung}</div> : null}</td>
                  <td style={{ whiteSpace: "pre-line" }}>{e.data.ideen ?? "–"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a className="btn-link small" href={`/privat/geburtstage?bearbeiten=${e.id}`}>bearbeiten</a>{" "}
                    <form action={jahrestagLoeschenAction} style={{ display: "inline" }}><input type="hidden" name="id" value={e.id} /><button className="btn-link small" type="submit">löschen</button></form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
