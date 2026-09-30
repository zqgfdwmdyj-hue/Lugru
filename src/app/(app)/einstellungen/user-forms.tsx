"use client";

import { useActionState } from "react";
import { addUser, changePassword, updateAccess, type UserState } from "./actions";

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

export function AccessForm({ userId, areas, brandIds, allAreas, brands }: { userId: string; areas: string[] | null; brandIds: string[] | null; allAreas: { key: string; label: string }[]; brands: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<UserState, FormData>(updateAccess, null);
  return (
    <form action={action} className="stack" style={{ gap: 10, padding: "10px 0" }}>
      <input type="hidden" name="userId" value={userId} />
      <div className="stack" style={{ gap: 4 }}>
        <strong className="small">Bereiche</strong>
        <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="areaMode" value="all" defaultChecked={areas === null} /> alle Bereiche</label>
        <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="areaMode" value="some" defaultChecked={areas !== null} /> nur diese:</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 4, paddingLeft: 22 }}>
          {allAreas.map((a) => (
            <label key={a.key} className="small" style={{ display: "flex", gap: 6 }}>
              <input type="checkbox" name="areas" value={a.key} defaultChecked={areas?.includes(a.key) || (a.key === "lieferanten" && areas?.includes("wawi"))} /> {a.label}
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
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-small" type="submit" disabled={pending}>Rechte speichern</button>
        {state && <span className="small" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }}>{state.message}</span>}
      </div>
    </form>
  );
}
