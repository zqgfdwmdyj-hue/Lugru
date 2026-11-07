"use client";

import Link from "next/link";
import { useActionState } from "react";
import { berichtLandAction, type LandState } from "./actions";

const LAENDER = ["DE", "FR", "IT", "ES"] as const;

/** B31.5 Rückfrage beim Upload eines BQool-Berichts: „Welches Land?“ – Vorschlag als Hauptknopf. */
export function LandRueckfrage({ id, vorschlag }: { id: string; vorschlag: string | null }) {
  const [state, action, pending] = useActionState<LandState, FormData>(berichtLandAction, null);
  if (state?.ok)
    return (
      <div className="small" data-testid="land-ergebnis" style={{ marginTop: 6 }}>
        ✓ {state.text} {state.link && <Link href={state.link}>Ansehen →</Link>}
      </div>
    );
  return (
    <form action={action} className="row small" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }} data-testid="land-rueckfrage">
      <input type="hidden" name="id" value={id} />
      <span>Welches Land?</span>
      {LAENDER.map((l) => (
        <button key={l} type="submit" name="land" value={l} disabled={pending} className={`btn btn-small${l === vorschlag ? " btn-primary" : ""}`} data-testid={`land-${l}`}>
          {l}
          {l === vorschlag ? " (Vorschlag)" : ""}
        </button>
      ))}
      {state && !state.ok && <span style={{ color: "var(--danger)" }}>{state.text}</span>}
    </form>
  );
}
