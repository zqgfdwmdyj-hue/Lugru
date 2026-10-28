"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { syncDriveAction, uploadInvoices, type InvState } from "./actions";

export function DriveSync() {
  const [state, action, pending] = useActionState<InvState, FormData>(syncDriveAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Hole Rechnungen …" : "Aus Google Drive abrufen"}</button>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
    </form>
  );
}

export function InvoiceUpload() {
  const [state, action, pending] = useActionState<InvState, FormData>(uploadInvoices, null);
  // Bei einem Fehler bleiben die ausgewählten Dateien stehen; nach Erfolg leert sich die Auswahl.
  const keep = useKeepForm(state, action, { resetOnSuccess: true });
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 6 }} data-testid="inv-upload">
      <label className="label" htmlFor="inv-files">PDFs hochladen</label>
      <input className="input" id="inv-files" name="files" type="file" accept="application/pdf,.pdf" multiple required />
      <button className="btn btn-primary btn-small" type="submit" disabled={pending}>{pending ? "Lese …" : "Hochladen"}</button>
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
    </form>
  );
}
