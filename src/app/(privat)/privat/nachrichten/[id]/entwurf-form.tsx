"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// Antwortentwurf am Handy: großes Textfeld, unten feste Leiste „Senden · Bearbeiten · Später“. Senden = ein Tipp.

function Knopf({ op, children, cls, testid }: { op: string; children: React.ReactNode; cls: string; testid: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={cls} name="op" value={op} type="submit" disabled={pending} data-testid={testid}>
      {pending ? "…" : children}
    </button>
  );
}

export function EntwurfForm({ id, text, action, anrede }: { id: string; text: string; action: (fd: FormData) => Promise<void>; anrede: "du" | "sie" }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (bearbeiten) ref.current?.focus();
  }, [bearbeiten]);
  return (
    <form action={action} className="stack nachricht-entwurf" style={{ gap: 8 }} data-testid="nachricht-entwurf-form">
      <input type="hidden" name="id" value={id} />
      <div className="between small muted">
        <span>Antwortentwurf · wird erst gesendet, wenn du „Senden“ tippst</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button className={`chip${anrede === "sie" ? " active" : ""}`} name="op" value="sie" type="submit" formNoValidate>Sie</button>
          <button className={`chip${anrede === "du" ? " active" : ""}`} name="op" value="du" type="submit" formNoValidate>Du</button>
        </span>
      </div>
      <textarea ref={ref} className="input" name="text" rows={12} defaultValue={text} readOnly={!bearbeiten} onFocus={() => setBearbeiten(true)} style={{ fontSize: 15, lineHeight: 1.45 }} data-testid="nachricht-entwurf" />
      <div className="nachricht-leiste">
        <Knopf op="senden" cls="btn btn-primary" testid="nachricht-senden">Senden</Knopf>
        {bearbeiten ? (
          <Knopf op="speichern" cls="btn" testid="nachricht-speichern">Speichern</Knopf>
        ) : (
          <button className="btn" type="button" onClick={() => setBearbeiten(true)} data-testid="nachricht-bearbeiten">
            Bearbeiten
          </button>
        )}
        <Knopf op="spaeter" cls="btn" testid="nachricht-spaeter">Später</Knopf>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button className="btn-link small" name="op" value="neu" type="submit" formNoValidate>Entwurf neu erstellen</button>
        <button className="btn-link small" name="op" value="erledigt" type="submit" formNoValidate data-testid="nachricht-erledigt">Ohne Antwort erledigt</button>
      </div>
    </form>
  );
}

/** Push-Karten zu dieser Nachricht schließen, sobald sie offen ist (Handy/Desktop). */
export function KartenSchliessen({ link }: { link: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications())
      .then((liste) => liste.filter((n) => typeof n.data?.link === "string" && n.data.link.startsWith(link)).forEach((n) => n.close()))
      .catch(() => null);
  }, [link]);
  return null;
}
