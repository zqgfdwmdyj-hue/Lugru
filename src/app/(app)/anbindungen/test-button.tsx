"use client";

import { useActionState } from "react";
import { testIntegrationAction, type TestState } from "./actions";

/** B24: Verweis auf das Fehler-Bildschirmfoto als Link (öffnet in neuem Tab). */
function mitLinks(text: string) {
  const teile = text.split(/(\/import\/debug\/[a-z0-9-]+\.png)/);
  return teile.map((t, i) => (i % 2 ? <a key={i} href={t} target="_blank" rel="noopener" data-testid="debug-link">Bildschirmfoto öffnen</a> : t));
}

export function TestButton({ provider }: { provider: string }) {
  const [state, action, pending] = useActionState<TestState, FormData>(testIntegrationAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="provider" value={provider} />
      <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Teste …" : "Verbindung testen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`} style={{ overflowWrap: "anywhere" }}>{mitLinks(state.message)}</div>}
    </form>
  );
}
