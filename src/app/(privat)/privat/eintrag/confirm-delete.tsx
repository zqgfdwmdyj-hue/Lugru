"use client";

import { useState } from "react";

/** Löschen mit Rückfrage (zweiter Tipp) – nichts verschwindet aus Versehen. */
export function ConfirmDelete({ action, id, kind, back, linked }: { action: (fd: FormData) => Promise<void>; id: string; kind: string; back: string; linked: boolean }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button type="button" className="btn btn-small" onClick={() => setAsk(true)} data-testid="entry-delete" style={{ alignSelf: "flex-start" }}>Eintrag löschen …</button>;
  return (
    <form action={action} className="notice notice-warn small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="back" value={back} />
      <span>Wirklich löschen?{linked ? " Der verknüpfte Eintrag (Kinderzeit/Auszeit) wird mit gelöscht." : ""}</span>
      <button className="btn btn-small" type="submit" data-testid="entry-delete-confirm">Ja, löschen</button>
      <button className="btn btn-small" type="button" onClick={() => setAsk(false)}>Abbrechen</button>
    </form>
  );
}
