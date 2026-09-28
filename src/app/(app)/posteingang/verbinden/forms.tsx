"use client";

import { useActionState } from "react";
import { connectImap, finishPaste, type ConnectState, type PasteState } from "./actions";

export function ImapForm() {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectImap, null);
  const s = state?.settings;
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <div className="field">
        <label className="label" htmlFor="address">E-Mail-Adresse</label>
        <input className="input" id="address" name="address" type="email" required autoComplete="off" placeholder="info@deine-firma.de" defaultValue={state?.address ?? ""} key={state?.address ?? ""} />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">Passwort bzw. App-Passwort</label>
        <input className="input" id="password" name="password" type="password" required autoComplete="new-password" />
        <span className="small muted">{state ? "Bitte erneut eingeben. " : ""}Wird verschlüsselt gespeichert und nie wieder angezeigt.</span>
      </div>
      {state && !state.ok && <div className="notice notice-warn small">{state.message}</div>}
      {state?.hint && <div className="notice notice-info small">{state.hint}</div>}
      <details open={Boolean(state?.manual)} key={state ? JSON.stringify(s) : "leer"}>
        <summary className="small" style={{ cursor: "pointer" }}>Server selbst eintragen {s?.provider ? `(erkannt: ${s.provider})` : "(sonst automatisch)"}</summary>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px 130px", gap: 8 }}>
            <input className="input" name="imapHost" placeholder="IMAP-Server" defaultValue={s?.imapHost ?? ""} aria-label="IMAP-Server" />
            <input className="input" name="imapPort" type="number" placeholder="993" defaultValue={s?.imapPort ?? ""} aria-label="IMAP-Port" />
            <select className="input" name="imapSecure" defaultValue={s && !s.imapSecure ? "starttls" : "ssl"} aria-label="IMAP-Verschlüsselung">
              <option value="ssl">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
            </select>
            <input className="input" name="smtpHost" placeholder="SMTP-Server" defaultValue={s?.smtpHost ?? ""} aria-label="SMTP-Server" />
            <input className="input" name="smtpPort" type="number" placeholder="465" defaultValue={s?.smtpPort ?? ""} aria-label="SMTP-Port" />
            <select className="input" name="smtpSecure" defaultValue={s && !s.smtpSecure ? "starttls" : "ssl"} aria-label="SMTP-Verschlüsselung">
              <option value="ssl">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
            </select>
          </div>
          <input className="input" name="user" placeholder="Benutzername (leer = E-Mail-Adresse)" defaultValue={s && s.user !== "" ? s.user : ""} aria-label="Benutzername" />
        </div>
      </details>
      <div><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Prüfe Verbindung …" : "Verbinden"}</button></div>
    </form>
  );
}

export function PasteForm({ provider }: { provider: "google" | "microsoft" }) {
  const [state, action, pending] = useActionState<PasteState, FormData>(finishPaste, null);
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <label className="label" htmlFor={`url-${provider}`}>2. Adresse aus der Browserzeile hier einfügen</label>
      <input className="input" id={`url-${provider}`} name="url" required placeholder="http://localhost/?state=…&code=…" style={{ fontFamily: "var(--mono)", fontSize: 12 }} />
      <div><button className="btn btn-primary btn-small" type="submit" disabled={pending}>{pending ? "Verbinde …" : "Verbinden"}</button></div>
      {state && !state.ok && <div className="notice notice-warn small">{state.message}</div>}
    </form>
  );
}
