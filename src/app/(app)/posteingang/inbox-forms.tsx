"use client";

import { useActionState } from "react";
import { syncNow, uploadEml, type InboxState } from "./actions";

export function SyncButton() {
  const [state, action, pending] = useActionState<InboxState, FormData>(syncNow, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <button className="btn" type="submit" disabled={pending}>{pending ? "Rufe ab …" : "Jetzt abrufen"}</button>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </form>
  );
}

export function EmlUpload() {
  const [state, action, pending] = useActionState<InboxState, FormData>(uploadEml, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <label className="label" htmlFor="eml">Mails als .eml hochladen (zum Testen)</label>
      <input className="input" id="eml" name="files" type="file" accept=".eml,message/rfc822" multiple required />
      <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Lese …" : "Hochladen"}</button>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
    </form>
  );
}
