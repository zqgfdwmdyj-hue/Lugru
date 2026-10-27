"use client";

import { useRef } from "react";

/** Status einer Marke: Auswahl speichert sofort (kein eigener OK-Knopf je Zeile). */
export function BrandStatusSelect({ id, status, options, action, disabled }: { id: string; status: string; options: [string, string][]; action: (fd: FormData) => Promise<void>; disabled?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form action={action} ref={form}>
      <input type="hidden" name="id" value={id} />
      <select name="status" defaultValue={status} aria-label="Status" disabled={disabled} onChange={() => form.current?.requestSubmit()} className="select" style={{ padding: "2px 6px", fontSize: 13, width: "auto" }} data-testid="sas-brand-status">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <noscript><button className="btn btn-small" type="submit">OK</button></noscript>
    </form>
  );
}
