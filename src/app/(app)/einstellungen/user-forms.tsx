"use client";

import { useActionState } from "react";
import { addUser, changePassword, type UserState } from "./actions";

export function AddUserForm() {
  const [state, action, pending] = useActionState<UserState, FormData>(addUser, null);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 140px auto", gap: 8, alignItems: "end" }}>
        <div className="field"><label className="label" htmlFor="u-email">E-Mail</label><input className="input" id="u-email" name="email" type="email" required /></div>
        <div className="field"><label className="label" htmlFor="u-name">Name</label><input className="input" id="u-name" name="name" /></div>
        <div className="field"><label className="label" htmlFor="u-role">Rolle</label>
          <select className="select" id="u-role" name="role" defaultValue="staff"><option value="staff">Mitarbeiter</option><option value="owner">Inhaber</option></select>
        </div>
        <button className="btn" type="submit" disabled={pending}>Hinzufügen</button>
      </div>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<UserState, FormData>(changePassword, null);
  return (
    <form action={action} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <div className="field" style={{ width: 280 }}><label className="label" htmlFor="pw">Neues Passwort</label><input className="input" id="pw" name="password" type="password" autoComplete="new-password" required minLength={10} /></div>
      <button className="btn" type="submit" disabled={pending}>Ändern</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
    </form>
  );
}
