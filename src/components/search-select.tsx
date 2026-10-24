"use client";

import { useMemo, useState } from "react";

export type SearchOption = { value: string; label: string; hint?: string };

/**
 * Auswahl mit Suchfeld für lange Listen (z. B. Lieferanten): tippen filtert die Einträge, die Auswahl bleibt
 * ein normales Formularfeld (`name`). Hinweise wie „ähnlich wie …“ stehen direkt am Eintrag.
 */
export function SearchSelect({ id, name, options, defaultValue = "", emptyLabel = "–", placeholder = "Suchen …" }: { id: string; name: string; options: SearchOption[]; defaultValue?: string; emptyLabel?: string; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [value, setValue] = useState(defaultValue);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return options;
    return options.filter((o) => o.value === value || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(n));
  }, [q, options, value]);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={`${placeholder} (filtert die Liste)`} data-testid={`${id}-search`} />
      <select className="select" id={id} name={name} value={value} onChange={(e) => setValue(e.target.value)} data-testid={id}>
        <option value="">{emptyLabel}</option>
        {shown.map((o) => (
          <option key={o.value} value={o.value}>{o.hint ? `${o.label} · ${o.hint}` : o.label}</option>
        ))}
      </select>
      {q && <span className="small muted">{shown.length} von {options.length} Einträgen</span>}
    </div>
  );
}
