"use client";

import { useState } from "react";

/** Löschen mit Rückfrage (zweiter Tipp) – nichts verschwindet aus Versehen. */
export function ConfirmDelete({ action, id, kind, back, linked, series }: { action: (fd: FormData) => Promise<void>; id: string; kind: string; back: string; linked: boolean; series?: { count: number; following: number } | null }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button type="button" className="btn btn-small" onClick={() => setAsk(true)} data-testid="entry-delete" style={{ alignSelf: "flex-start" }}>Eintrag löschen …</button>;
  return (
    <form action={action} className="notice notice-warn small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="back" value={back} />
      <span>Wirklich löschen?{linked ? " Der verknüpfte Eintrag (Kinderzeit/Auszeit) wird mit gelöscht." : ""}</span>
      {series && (
        <span className="pick-chips" role="radiogroup" aria-label="Was löschen?" data-testid="delete-scope">
          <label><input type="radio" name="umfang" value="dieser" defaultChecked /><span>nur diesen Termin</span></label>
          <label><input type="radio" name="umfang" value="folgende" /><span>diesen und alle folgenden ({series.following})</span></label>
          <label><input type="radio" name="umfang" value="alle" /><span>ganze Serie ({series.count})</span></label>
        </span>
      )}
      <button className="btn btn-small" type="submit" data-testid="entry-delete-confirm">Ja, löschen</button>
      <button className="btn btn-small" type="button" onClick={() => setAsk(false)}>Abbrechen</button>
    </form>
  );
}
