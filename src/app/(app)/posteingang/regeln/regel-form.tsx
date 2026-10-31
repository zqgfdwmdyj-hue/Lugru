"use client";

import { useActionState, useState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { regelAnlegen, type RegelState } from "./actions";

export function RegelForm({ themen, personen, vorgabe }: { themen: [string, string][]; personen: { id: string; name: string }[]; vorgabe: { absender?: string; betreff?: string } }) {
  const [state, action, pending] = useActionState<RegelState, FormData>(regelAnlegen, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: true });
  const [aktion, setAktion] = useState("archivieren");
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 8 }} data-testid="regel-form">
      <div className="grid-2" style={{ gap: 8 }}>
        <div className="field">
          <label className="label" htmlFor="r-absender">Absender enthält</label>
          <input className="input" id="r-absender" name="absender" placeholder="z. B. @newsletter.example oder info@" defaultValue={vorgabe.absender ?? ""} maxLength={120} />
        </div>
        <div className="field">
          <label className="label" htmlFor="r-betreff">Betreff enthält</label>
          <input className="input" id="r-betreff" name="betreff" placeholder="z. B. Ihre Rechnung" defaultValue={vorgabe.betreff ?? ""} maxLength={120} />
        </div>
        <div className="field">
          <label className="label" htmlFor="r-thema">Thema (Einstufung)</label>
          <select className="input" id="r-thema" name="thema" defaultValue="">
            <option value="">– egal –</option>
            {themen.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="r-aktion">Dann</label>
          <select className="input" id="r-aktion" name="aktion" value={aktion} onChange={(e) => setAktion(e.target.value)}>
            <option value="archivieren">automatisch archivieren</option>
            <option value="aufgabe">als Aufgabe anlegen</option>
            <option value="weiterleiten">an Zuständigen (Aufgabe mit Person)</option>
          </select>
        </div>
        {aktion === "weiterleiten" && (
          <div className="field">
            <label className="label" htmlFor="r-person">Zuständig</label>
            <select className="input" id="r-person" name="zustaendigId" required defaultValue="">
              <option value="" disabled>Person wählen …</option>
              {personen.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div><button className="btn btn-primary btn-small" type="submit" disabled={pending}>{pending ? "Speichere …" : "Regel speichern"}</button></div>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-error"}`} role="status">{state.message}</div>}
    </form>
  );
}
