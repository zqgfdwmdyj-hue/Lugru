"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { aiCaseTextAction, type AiCaseState } from "../actions";

export function AiCaseText({ id }: { id: string }) {
  const [state, action, pending] = useActionState<AiCaseState, FormData>(aiCaseTextAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="id" value={id} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-small" type="submit" name="lang" value="de" disabled={pending}>{pending ? "KI schreibt …" : "Mit KI formulieren"}</button>
        <button className="btn btn-small" type="submit" name="lang" value="en" disabled={pending}>… auf Englisch</button>
        <span className="small muted">nutzt nur die Nachweise oben – vor dem Absenden kurz gegenlesen</span>
      </div>
      {state && !state.ok && <div className="notice notice-warn">{state.message}</div>}
      {state?.ok && state.text && (
        <>
          <div className="between"><strong className="small">KI-Vorschlag</strong><CopyButton text={state.text} /></div>
          <div className="snippet article-body" style={{ fontSize: 14 }} data-testid="ai-case-text">{state.text}</div>
        </>
      )}
    </form>
  );
}
