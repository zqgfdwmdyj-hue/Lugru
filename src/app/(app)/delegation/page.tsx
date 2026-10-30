import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { REGEL_VORLAGEN } from "@/lib/delegieren/logic";
import { delegationWoche, personen, zustaendigkeitenAnwenden } from "@/lib/delegieren/service";
import { getSettings } from "@/lib/settings";
import { externAction, regelAction, vorschlagAction } from "./actions";

// Delegieren: wer macht was (intern/extern), Regeln je Aufgabentyp (beim ersten Mal bestätigen), Woche je Person.

const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "–");

export default async function DelegationPage({ searchParams }: { searchParams: Promise<{ meldung?: string }> }) {
  const session = await requireOwner();
  const sp = await searchParams;
  const heute = todayIso();
  const [{ vorschlaege }, ps, woche, s] = await Promise.all([zustaendigkeitenAnwenden(session.tenantId), personen(session.tenantId), delegationWoche(session.tenantId, heute), getSettings(session.tenantId)]);
  const name = new Map(ps.map((p) => [p.key, p.name]));
  const vorlage = new Map(REGEL_VORLAGEN.map((v) => [v.typ, v.text]));
  const andere = ps.filter((p) => p.key !== `user:${session.userId}`);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">Heute</div>
          <h1>Delegation</h1>
          <div className="small muted">Arbeit abgeben: wer ist zuständig, was läuft automatisch, was ist überfällig. Die Assistenz sieht nur ihre Bereiche – keinen Privatbereich, keine Kontodaten.</div>
        </div>
        <Link className="btn" href="/delegation/va" data-testid="deleg-va">VA (Discord)</Link>
      </div>
      {sp.meldung && <div className="notice notice-ok small" role="status" style={{ marginBottom: 12 }}>{sp.meldung}</div>}

      {vorschlaege.length > 0 && (
        <section className="card card-pad" style={{ marginBottom: 14 }} data-testid="deleg-vorschlaege">
          <h2 style={{ marginTop: 0 }}>Abgeben? ({vorschlaege.length})</h2>
          <p className="small muted">Für diese Aufgabentypen gibt es eine Regel, die noch nicht bestätigt ist. „Immer“ bestätigt die Regel – künftige Aufgaben dieser Art gehen dann automatisch.</p>
          <table className="table small">
            <tbody>
              {vorschlaege.map((v) => (
                <tr key={v.id}>
                  <td>{v.title}</td>
                  <td>→ <strong>{name.get(v.person) ?? v.person}</strong> <span className="muted">({vorlage.get(v.typ) ?? v.typ})</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form action={vorschlagAction} style={{ display: "inline-flex", gap: 4 }}>
                      <input type="hidden" name="id" value={v.id} />
                      <input type="hidden" name="typ" value={v.typ} />
                      <button className="btn btn-small" name="was" value="einmal" type="submit">ja</button>
                      <button className="btn btn-small btn-primary" name="was" value="immer" type="submit" data-testid="deleg-immer">ja, immer</button>
                      <button className="btn btn-small" name="was" value="selbst" type="submit">mache ich selbst</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card card-pad" style={{ marginBottom: 14 }} data-testid="deleg-woche">
        <h2 style={{ marginTop: 0 }}>Diese Woche je Person</h2>
        {woche.zeilen.length === 0 ? (
          <p className="small muted">Noch nichts abgegeben. Zuständig setzen geht im <Link href="/board?b=todos">Aufgaben-Board</Link>, per Regel unten oder über Claude („aufgabe_zuweisen“).</p>
        ) : (
          <table className="table small">
            <thead>
              <tr><th>Person</th><th className="right">offen</th><th className="right">überfällig</th><th className="right">erledigt (7 Tage)</th><th className="right">neu (7 Tage)</th><th>älteste Frist</th></tr>
            </thead>
            <tbody>
              {woche.zeilen.map((z) => (
                <tr key={z.person}>
                  <td>{z.name}</td>
                  <td className="num right">{z.offen}</td>
                  <td className="num right" style={z.ueberfaellig ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{z.ueberfaellig}</td>
                  <td className="num right">{z.erledigtWoche}</td>
                  <td className="num right">{z.neuWoche}</td>
                  <td>{dmy(z.aelteste)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {woche.ueberfaellig.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="small">Überfällige abgegebene Aufgaben ({woche.ueberfaellig.length})</summary>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {woche.ueberfaellig.map((a) => <li key={a.id}>{a.link ? <Link href={a.link}>{a.titel}</Link> : a.titel} · {a.person} · fällig {dmy(a.faellig)}</li>)}
            </ul>
          </details>
        )}
      </section>

      <section className="card card-pad" style={{ marginBottom: 14 }} data-testid="deleg-regeln">
        <h2 style={{ marginTop: 0 }}>Regeln: Aufgabentyp → Person</h2>
        {s.delegieren.regeln.length > 0 && (
          <table className="table small" style={{ marginBottom: 10 }}>
            <tbody>
              {s.delegieren.regeln.map((r) => (
                <tr key={r.typ}>
                  <td>{vorlage.get(r.typ) ?? r.typ} <span className="muted">({r.typ})</span></td>
                  <td>→ {name.get(r.person) ?? r.person}</td>
                  <td>{r.bestaetigt ? <span className="tag tag-ok">automatisch</span> : <span className="tag tag-warn">fragt beim ersten Mal</span>}</td>
                  <td>
                    <form action={regelAction}>
                      <input type="hidden" name="typ" value={r.typ} />
                      <input type="hidden" name="loeschen" value="1" />
                      <button className="btn-link small" type="submit">entfernen</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={regelAction} className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            Aufgabentyp
            <select name="vorlage" defaultValue={REGEL_VORLAGEN[0].typ} data-testid="deleg-vorlage">
              {REGEL_VORLAGEN.map((v) => <option key={v.typ} value={v.typ}>{v.text}</option>)}
            </select>
          </label>
          <label>oder eigener Typ<input name="typ" placeholder="titel:lieferant" style={{ width: 160 }} /></label>
          <label>
            Person
            <select name="person" required data-testid="deleg-person">
              {andere.map((p) => <option key={p.key} value={p.key}>{p.name}{p.art === "extern" ? " (extern)" : ""}</option>)}
            </select>
          </label>
          <button className="btn" type="submit" data-testid="deleg-regel-speichern">Regel anlegen</button>
        </form>
      </section>

      <details className="card card-pad">
        <summary><strong>Externe Zuständige</strong> <span className="small muted">– ohne eigenes Konto (nur Name)</span></summary>
        <form action={externAction} className="small" style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 260 }}>Namen (kommagetrennt)<input name="extern" defaultValue={s.delegieren.extern.join(", ")} /></label>
          <button className="btn" type="submit">Speichern</button>
        </form>
        <p className="small muted">Interne Personen (z. B. die Assistenz) bekommen ein eigenes Konto unter Einstellungen → Benutzer – mit nur ihren Bereichen.</p>
      </details>
    </>
  );
}
