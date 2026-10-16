"use client";

import { useActionState } from "react";
import { changeOwnPassword, createUser, type FormState, updateUser } from "./actions";

function Message({ state }: { state: FormState }) {
  if (!state) return null;
  return <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>;
}

export function CreateUserForm({ first }: { first: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createUser, null);
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 8 }}>
      <h2>{first ? "Ersten Admin anlegen" : "Neuer Zugang"}</h2>
      {first && <div className="small muted">Sobald der erste Admin angelegt ist, gilt das Team-Passwort nicht mehr – danach meldet sich jede Person mit eigenem Namen und Passwort an.</div>}
      <div className="field"><label className="label" htmlFor="nu-name">Name</label><input className="input" id="nu-name" name="name" required placeholder="z. B. Anna Müller" /></div>
      <div className="field"><label className="label" htmlFor="nu-login">Anmeldename (optional)</label><input className="input" id="nu-login" name="login" autoCapitalize="none" placeholder="sonst aus dem Namen, z. B. anna.müller" /></div>
      <div className="field"><label className="label" htmlFor="nu-pw">Passwort (mind. 8 Zeichen)</label><input className="input" id="nu-pw" name="password" type="text" autoComplete="new-password" required minLength={8} /></div>
      <label className="small"><input type="checkbox" name="isAdmin" defaultChecked={first} disabled={first} /> Admin (darf Zugänge verwalten und aufräumen)</label>
      {first && <input type="hidden" name="isAdmin" value="on" />}
      <Message state={state} />
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Lege an …" : "Zugang anlegen"}</button>
    </form>
  );
}

export function UserRow({ user, self }: { user: { id: string; name: string; login: string; isAdmin: boolean; active: boolean; lastLogin: string }; self: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateUser, null);
  return (
    <form action={action} className="user-row">
      <input type="hidden" name="userId" value={user.id} />
      <div style={{ minWidth: 160, flex: "1 1 160px" }}>
        <input className="input input-compact" name="name" defaultValue={user.name} aria-label="Name" />
        <div className="small muted" style={{ marginTop: 2 }}>{user.login}{self ? " · du" : ""} · zuletzt angemeldet: {user.lastLogin}</div>
      </div>
      <input className="input input-compact" name="password" type="text" autoComplete="new-password" placeholder="neues Passwort" aria-label="Neues Passwort" style={{ width: 150 }} />
      <label className="small"><input type="checkbox" name="isAdmin" defaultChecked={user.isAdmin} /> Admin</label>
      <label className="small"><input type="checkbox" name="active" defaultChecked={user.active} /> aktiv</label>
      <button className="btn btn-small" type="submit" disabled={pending}>Speichern</button>
      {state && <div style={{ flexBasis: "100%" }}><Message state={state} /></div>}
    </form>
  );
}

export function OwnPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changeOwnPassword, null);
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 8, maxWidth: 420 }}>
      <h2>Passwort ändern</h2>
      <div className="field"><label className="label" htmlFor="pw-cur">Bisheriges Passwort</label><input className="input" id="pw-cur" name="current" type="password" autoComplete="current-password" required /></div>
      <div className="field"><label className="label" htmlFor="pw-new">Neues Passwort (mind. 8 Zeichen)</label><input className="input" id="pw-new" name="next" type="password" autoComplete="new-password" required minLength={8} /></div>
      <div className="field"><label className="label" htmlFor="pw-rep">Neues Passwort wiederholen</label><input className="input" id="pw-rep" name="repeat" type="password" autoComplete="new-password" required minLength={8} /></div>
      <Message state={state} />
      <button className="btn btn-primary" type="submit" disabled={pending}>Passwort ändern</button>
    </form>
  );
}
