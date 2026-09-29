"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <div className="field">
        <label className="label" htmlFor="password">Team-Passwort</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      </div>
      {state?.error && <div className="notice notice-error">{state.error}</div>}
      <button className="btn btn-primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
        {pending ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}
