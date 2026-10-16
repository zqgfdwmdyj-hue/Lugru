"use client";

import { useState } from "react";

const NEW = "__neu__";

/**
 * Auswahlliste für die Kategorie – zeigt immer alle Kategorien (ein Textfeld mit Vorschlägen zeigt nur,
 * was zum schon eingetragenen Text passt). „Neue Kategorie …“ öffnet ein Textfeld.
 */
export function CategorySelect({ name, value, categories, id, compact = false, label }: { name: string; value: string; categories: string[]; id?: string; compact?: boolean; label?: string }) {
  const options = categories.includes(value) || !value ? categories : [...categories, value];
  const [custom, setCustom] = useState(false);
  const cls = `${compact ? "input input-compact" : "select"}`;
  if (custom) {
    return (
      <span style={{ display: "flex", gap: 4, minWidth: 0 }}>
        <input className={compact ? "input input-compact" : "input"} id={id} name={name} autoFocus placeholder="Neue Kategorie" aria-label={label ?? "Neue Kategorie"} style={{ minWidth: 0 }} />
        <button className="btn btn-small" type="button" onClick={() => setCustom(false)} title="Zurück zur Liste">×</button>
      </span>
    );
  }
  return (
    <select className={cls} id={id} name={name} defaultValue={value || options[0]} aria-label={label ?? "Kategorie"} onChange={(e) => e.target.value === NEW && setCustom(true)} style={{ minWidth: 0 }}>
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value={NEW}>Neue Kategorie …</option>
    </select>
  );
}
