"use client";

import { useActionState } from "react";
import { testIntegrationAction, type TestState } from "./actions";

export function TestButton({ provider }: { provider: string }) {
  const [state, action, pending] = useActionState<TestState, FormData>(testIntegrationAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="provider" value={provider} />
      <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Teste …" : "Verbindung testen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`}>{state.message}</div>}
    </form>
  );
}
