"use client";

import { useActionState, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { changeOwnPassword, type CreateState, createUsers, deleteUser, type FormState, updateUser } from "./actions";

function Message({ state }: { state: FormState }) {
  if (!state) return null;
  return <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>;
}

export function CreateUserForm({ first }: { first: boolean }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createUsers, null);
  const [many, setMany] = useState(false);
  const list = state?.created?.filter((c) => c.password) ?? [];
  const listText = list.map((c) => `${c.name}: Anmeldung mit ${c.email ?? c.login} · Passwort ${c.password}`).join("\n");
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 8 }}>
      <h2>{first ? "Ersten Admin anlegen" : "Zugänge anlegen"}</h2>
      {first && <div className="small muted">Sobald der erste Admin angelegt ist, gilt das Team-Passwort nicht mehr – danach meldet sich jede Person mit eigener E-Mail (oder Namen) und Passwort an.</div>}
      {!first && (
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className={`chip${!many ? " active" : ""}`} onClick={() => setMany(false)}>Eine Person</button>
          <button type="button" className={`chip${many ? " active" : ""}`} onClick={() => setMany(true)}>Mehrere auf einmal</button>
        </div>
      )}
      {many ? (
        <div className="field">
          <label className="label" htmlFor="nu-bulk">Eine Person pro Zeile: Name, E-Mail</label>
          <textarea className="input" id="nu-bulk" name="bulk" rows={6} placeholder={"Anna Müller, anna@beispiel.de\nBen Schulz, ben@beispiel.de\nCarla"} />
          <div className="small muted">E-Mail ist freiwillig. Jede Person bekommt ein eigenes Passwort, das danach einmal angezeigt wird.</div>
        </div>
      ) : (
        <>
          <div className="field"><label className="label" htmlFor="nu-email">E-Mail{first ? "" : " (optional)"}</label><input className="input" id="nu-email" name="email" type="email" autoCapitalize="none" placeholder="name@beispiel.de" /></div>
          <div className="field"><label className="label" htmlFor="nu-name">Name</label><input className="input" id="nu-name" name="name" required={first} placeholder="z. B. Anna Müller" /></div>
          <div className="field">
            <label className="label" htmlFor="nu-pw">Passwort{first ? " (mind. 8 Zeichen)" : " (leer lassen = wird erzeugt)"}</label>
            <input className="input" id="nu-pw" name="password" type="text" autoComplete="new-password" required={first} minLength={8} />
          </div>
        </>
      )}
      {first ? (
        <input type="hidden" name="role" value="admin" />
      ) : (
        <div className="field">
          <label className="label" htmlFor="nu-role">Rolle</label>
          <select className="select" id="nu-role" name="role" defaultValue="helfer">
            <option value="helfer">Helfer (Verteilungen, Produkte, Collagen …)</option>
            <option value="admin">Admin (zusätzlich Zugänge verwalten, aufräumen)</option>
          </select>
        </div>
      )}
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
      {list.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="small"><strong>Bitte jetzt weitergeben – die Passwörter werden nur einmal angezeigt:</strong></div>
          <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--sans)", background: "var(--surface-2)", padding: 10, borderRadius: 8 }}>{listText}</pre>
          <CopyButton text={listText} label="Zugangsdaten kopieren" />
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Lege an …" : many ? "Alle anlegen" : "Zugang anlegen"}</button>
    </form>
  );
}

export function UserRow({ user, self }: { user: { id: string; name: string; login: string; email: string | null; isAdmin: boolean; active: boolean; lastLogin: string }; self: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateUser, null);
  return (
    <form action={action} className="user-row">
      <input type="hidden" name="userId" value={user.id} />
      <div style={{ minWidth: 160, flex: "1 1 160px" }}>
        <input className="input input-compact" name="name" defaultValue={user.name} aria-label="Name" />
        <input className="input input-compact" name="email" type="email" defaultValue={user.email ?? ""} placeholder="E-Mail (optional)" aria-label="E-Mail" style={{ marginTop: 4 }} />
        <div className="small muted" style={{ marginTop: 2 }}>{user.login}{self ? " · du" : ""} · zuletzt angemeldet: {user.lastLogin}</div>
      </div>
      <input className="input input-compact" name="password" type="text" autoComplete="new-password" placeholder="neues Passwort" aria-label="Neues Passwort" style={{ width: 150 }} />
      <label className="small"><input type="checkbox" name="isAdmin" defaultChecked={user.isAdmin} /> Admin</label>
      <label className="small"><input type="checkbox" name="active" defaultChecked={user.active} /> aktiv</label>
      <button className="btn btn-small" type="submit" disabled={pending}>Speichern</button>
      {!self && (
        <button
          className="btn-link small"
          type="submit"
          formAction={deleteUser}
          style={{ color: "var(--danger)" }}
          onClick={(e) => {
            if (!confirm(`Zugang von ${user.name} wirklich entfernen?`)) e.preventDefault();
          }}
        >
          Entfernen
        </button>
      )}
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
