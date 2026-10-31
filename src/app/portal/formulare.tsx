"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { anmeldenAction, einladungAction, passwortAendernAction, reservierenAction, type PortalStand } from "./actions";

const Hinweis = ({ s, id }: { s: PortalStand; id: string }) => (s ? <div className={`notice ${s.ok ? "notice-ok" : "notice-warn"}`} data-testid={id}>{s.text}</div> : null);

export function AnmeldeFormular() {
  const [s, aktion] = useActionState<PortalStand, FormData>(anmeldenAction, null);
  return (
    <form action={aktion} className="card card-pad stack" style={{ gap: 12, maxWidth: 380 }}>
      <div className="field"><label className="label" htmlFor="email">E-Mail</label><input className="input" id="email" name="email" type="email" autoComplete="username" required /></div>
      <div className="field"><label className="label" htmlFor="passwort">Passwort</label><input className="input" id="passwort" name="passwort" type="password" autoComplete="current-password" required /></div>
      <Hinweis s={s} id="portal-login-fehler" />
      <SubmitButton label="Anmelden" pendingLabel="Melde an …" testId="portal-anmelden" />
    </form>
  );
}

export function EinladungFormular({ token }: { token: string }) {
  const [s, aktion] = useActionState<PortalStand, FormData>(einladungAction, null);
  return (
    <form action={aktion} className="card card-pad stack" style={{ gap: 12, maxWidth: 380 }}>
      <input type="hidden" name="token" value={token} />
      <div className="field"><label className="label" htmlFor="pw1">Neues Passwort (mind. 10 Zeichen)</label><input className="input" id="pw1" name="passwort" type="password" autoComplete="new-password" minLength={10} required /></div>
      <div className="field"><label className="label" htmlFor="pw2">Passwort wiederholen</label><input className="input" id="pw2" name="passwort2" type="password" autoComplete="new-password" minLength={10} required /></div>
      <Hinweis s={s} id="einladung-fehler" />
      <SubmitButton label="Passwort festlegen" pendingLabel="Speichere …" testId="passwort-festlegen" />
    </form>
  );
}

export function ReservierFormular({ dealId, min, max, menge, aendern }: { dealId: string; min: number; max: number | null; menge: number | null; aendern: boolean }) {
  const [s, aktion] = useActionState<PortalStand, FormData>(reservierenAction, null);
  return (
    <form action={aktion} className="stack" style={{ gap: 10 }} data-testid="reservieren">
      <input type="hidden" name="dealId" value={dealId} />
      <div className="field">
        <label className="label" htmlFor="menge">Menge (Stück)</label>
        <input className="input" id="menge" name="menge" type="number" inputMode="numeric" min={1} defaultValue={menge ?? min} style={{ width: 120 }} required data-testid="reservieren-menge" />
        <span className="small muted">mind. {min}{max !== null ? `, höchstens ${max}` : ""}</span>
      </div>
      <label className="check small" style={{ alignItems: "flex-start" }}>
        <input type="checkbox" name="bedingungen" required data-testid="reservieren-bedingungen" />
        <span>Ich reserviere verbindlich und zahle per Vorkasse nach Rechnung. Die Markenfreigabe in meinem Amazon-Konto habe ich selbst geprüft. Die Prognose ist ohne Garantie. Bei Fehlmenge des Großhändlers wird gekürzt und gutgeschrieben.</span>
      </label>
      <Hinweis s={s} id="reservieren-ergebnis" />
      <div><SubmitButton label={aendern ? "Menge ändern" : "Verbindlich reservieren"} pendingLabel="Reserviere …" testId="reservieren-absenden" /></div>
    </form>
  );
}

export function PasswortFormular() {
  const [s, aktion] = useActionState<PortalStand, FormData>(passwortAendernAction, null);
  return (
    <form action={aktion} className="stack" style={{ gap: 10, maxWidth: 380 }}>
      <div className="field"><label className="label" htmlFor="alt">Bisheriges Passwort</label><input className="input" id="alt" name="alt" type="password" autoComplete="current-password" required /></div>
      <div className="field"><label className="label" htmlFor="neu">Neues Passwort (mind. 10 Zeichen)</label><input className="input" id="neu" name="neu" type="password" autoComplete="new-password" minLength={10} required /></div>
      <Hinweis s={s} id="passwort-ergebnis" />
      <div><SubmitButton className="btn" label="Passwort ändern" pendingLabel="Speichere …" /></div>
    </form>
  );
}
