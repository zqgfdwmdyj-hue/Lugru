"use client";

import { useActionState } from "react";
import { useKeepForm } from "@/components/keep-form";
import { addUser, changePassword, setUserPassword, updateAccess, type UserState } from "./actions";

const noAutoFix = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

export function AddUserForm() {
  const [state, action, pending] = useActionState<UserState, FormData>(addUser, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: true });
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 10 }} data-testid="add-user">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}>
        <div className="field"><label className="label" htmlFor="u-login">Benutzername</label><input className="input" id="u-login" name="login" required minLength={3} maxLength={60} autoComplete="off" placeholder="z. B. lager1" {...noAutoFix} /></div>
        <div className="field"><label className="label" htmlFor="u-name">Name (optional)</label><input className="input" id="u-name" name="name" /></div>
        <div className="field"><label className="label" htmlFor="u-password">Passwort</label><input className="input" id="u-password" name="password" type="text" minLength={8} autoComplete="new-password" placeholder="leer = wird erzeugt" {...noAutoFix} /></div>
        <div className="field"><label className="label" htmlFor="u-role">Rolle</label>
          <select className="select" id="u-role" name="role" defaultValue="staff" data-testid="add-user-rolle"><option value="staff">Mitarbeiter</option><option value="va">VA (Aufgaben, Fälle, Ansprüche, Retouren)</option><option value="familie">Nur Familie</option><option value="owner">Inhaber</option></select>
        </div>
        <button className="btn" type="submit" disabled={pending}>Hinzufügen</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Angemeldet wird mit Benutzername und Passwort – eine E-Mail-Adresse ist nicht nötig. Passwort mindestens 8 Zeichen; leer lassen, dann wird eins erzeugt und hier einmal angezeigt. Neue Konten bekommen nie Zugang zu „Privat“ – außer mit der Rolle „Nur Familie“ (Familienliste, Kinder-Termine, Schulbriefe).</p>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`} data-testid="add-user-result">{state.message}</div>}
    </form>
  );
}

/** Inhaber vergibt einem Benutzer ein neues Passwort. */
export function SetPasswordForm({ userId, login }: { userId: string; login: string }) {
  const [state, action, pending] = useActionState<UserState, FormData>(setUserPassword, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: true });
  return (
    <details data-testid="set-password">
      <summary className="small" style={{ cursor: "pointer" }}>Passwort vergeben</summary>
      <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", paddingTop: 6, justifyContent: "flex-end" }}>
        <input type="hidden" name="userId" value={userId} />
        <input className="input" name="password" type="text" required minLength={8} autoComplete="new-password" aria-label={`Neues Passwort für ${login}`} placeholder="neues Passwort" style={{ width: 170, padding: "5px 8px", fontSize: 13 }} {...noAutoFix} />
        <button className="btn btn-small" type="submit" disabled={pending}>Setzen</button>
        {state && <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.message}</span>}
      </form>
    </details>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<UserState, FormData>(changePassword, null);
  const keep = useKeepForm(state, action, { resetOnSuccess: true });
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <div className="field" style={{ width: 280 }}><label className="label" htmlFor="pw">Neues Passwort</label><input className="input" id="pw" name="password" type="password" autoComplete="new-password" required minLength={10} /></div>
      <button className="btn" type="submit" disabled={pending}>Ändern</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
    </form>
  );
}

export function AccessForm({ userId, areas, brandIds, readOnly, allAreas, brands }: { userId: string; areas: string[] | null; brandIds: string[] | null; readOnly: boolean; allAreas: { key: string; label: string }[]; brands: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<UserState, FormData>(updateAccess, null);
  const keep = useKeepForm(state, action);
  return (
    <form action={action} ref={keep.ref} onSubmit={keep.onSubmit} className="stack" style={{ gap: 10, padding: "10px 0" }}>
      <input type="hidden" name="userId" value={userId} />
      <div className="stack" style={{ gap: 4 }}>
        <strong className="small">Bereiche</strong>
        <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="areaMode" value="all" defaultChecked={areas === null} /> alle Bereiche</label>
        <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="areaMode" value="some" defaultChecked={areas !== null} /> nur diese:</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 4, paddingLeft: 22 }}>
          {allAreas.map((a) => (
            <label key={a.key} className="small" style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" name="areas" value={a.key} defaultChecked={areas?.includes(a.key) || ((a.key === "lieferanten" || a.key === "artikel") && areas?.includes("wawi"))} /> {a.label}
            </label>
          ))}
        </div>
      </div>
      {brands.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <strong className="small">Marken (im Bereich „Marken“)</strong>
          <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="brandMode" value="all" defaultChecked={brandIds === null} /> alle Marken</label>
          <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="brandMode" value="some" defaultChecked={brandIds !== null} /> nur:</label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingLeft: 22 }}>
            {brands.map((b) => (
              <label key={b.id} className="small" style={{ display: "flex", gap: 6 }}>
                <input type="checkbox" name="brands" value={b.id} defaultChecked={brandIds?.includes(b.id)} /> {b.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <input type="checkbox" name="readOnly" defaultChecked={readOnly} style={{ marginTop: 3 }} />
        <span><strong>Nur ansehen</strong> – sieht die freigegebenen Bereiche, kann aber nichts ändern, senden, hochladen oder bei Keepa/Amazon/eBay abfragen (z. B. für Prüfer oder einen Testzugang).</span>
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-primary btn-small" type="submit" disabled={pending}>Rechte speichern</button>
        {state && <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.message}</span>}
      </div>
    </form>
  );
}
