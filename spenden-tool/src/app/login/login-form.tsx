"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ withName }: { withName: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      {withName && (
        <div className="field">
          <label className="label" htmlFor="login">E-Mail oder Name</label>
          <input className="input" id="login" name="login" autoComplete="username" autoCapitalize="none" autoCorrect="off" required autoFocus />
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="password">{withName ? "Passwort" : "Team-Passwort"}</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required autoFocus={!withName} />
      </div>
      {state?.error && <div className="notice notice-error">{state.error}</div>}
      <button className="btn btn-primary" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
        {pending ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}
