"use client";

import { useMemo, useState } from "react";

export type UnitRow = {
  itemId: string;
  title: string;
  thumb: string | null;
  priceText: string;
  note: string | null;
  unit: string;
  count: number | null;
  /** Vorschlag ist eindeutig und plausibel – darf vorausgewählt werden. */
  sure: boolean;
  hasSuggestion: boolean;
  problem: string | null;
};

const FILTERS = [
  { key: "", label: "Alle" },
  { key: "sicher", label: "Eindeutiger Vorschlag" },
  { key: "unsicher", label: "Unsicherer Vorschlag" },
  { key: "ohne", label: "Ohne Vorschlag" },
] as const;

/**
 * „Abgabeeinheit offen“ unter „Prüfen“: einklappbar, mit Suche und Filter. Vorausgewählt sind nur eindeutige,
 * plausible Vorschläge; der Knopf nennt genau, wie viele Einheiten übernommen werden.
 */
export function UnitReview({ rows, units }: { rows: UnitRow[]; units: Record<string, string> }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(rows.filter((r) => r.sure).map((r) => r.itemId)));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("");
  const visible = useMemo(() => {
    const words = q.toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
    return new Set(
      rows
        .filter((r) => words.every((w) => r.title.toLocaleLowerCase("de-DE").includes(w)))
        .filter((r) => (filter === "sicher" ? r.sure : filter === "unsicher" ? r.hasSuggestion && !r.sure : filter === "ohne" ? !r.hasSuggestion : true))
        .map((r) => r.itemId),
    );
  }, [rows, q, filter]);
  const toggle = (id: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const hiddenChecked = [...checked].filter((id) => !visible.has(id)).length;
  const sureCount = rows.filter((r) => r.sure).length;

  return (
    <details className="card review-block" id="einheiten" open={rows.length <= 10 || undefined}>
      <summary className="card-head">
        <h2>Abgabeeinheit offen ({rows.length})</h2>
        <span className="small muted">{sureCount} eindeutige Vorschläge · aufklappen zum Bestätigen</span>
      </summary>
      <div className="small muted" style={{ padding: "8px 14px 0" }}>
        Worauf bezieht sich die Spendenempfehlung – ein Stück, eine Packung (wie viele?) oder ein Karton? Vorausgewählt sind nur eindeutige Vorschläge (z. B. „6er-Pack“, „6 x 125 g“). Unsichere Vorschläge – etwa „Einzelstück“ bei einem hohen Betrag – bitte einzeln ansehen. Das ist getrennt von der Bestätigung des Preises.
      </div>
      <div className="review-tools">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produkt suchen …" aria-label="In offenen Einheiten suchen" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
          {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <button type="button" className="btn btn-small" onClick={() => setChecked((p) => new Set([...p, ...rows.filter((r) => r.sure && visible.has(r.itemId)).map((r) => r.itemId)]))}>Eindeutige sichtbare auswählen</button>
        <button type="button" className="btn btn-small" onClick={() => setChecked(new Set())}>Auswahl aufheben</button>
      </div>
      <div className="check-list">
        {rows.map((r) => (
          <div key={r.itemId} className="check-row unit-row" hidden={!visible.has(r.itemId)}>
            <input type="checkbox" name="itemId" value={r.itemId} checked={checked.has(r.itemId)} onChange={(e) => toggle(r.itemId, e.target.checked)} aria-label={`${r.title} bestätigen`} />
            {r.thumb ? <img src={r.thumb} alt="" className="thumb" style={{ width: 44, height: 44 }} loading="lazy" /> : <span className="thumb thumb-empty" style={{ width: 44, height: 44 }}>–</span>}
            <span className="check-text">
              <strong className="wrap-anywhere">{r.title}</strong>
              <span className="small muted">
                {r.priceText}
                {r.note ? ` · Zusatz „${r.note}“` : ""}
                {r.hasSuggestion ? (r.sure ? " · eindeutiger Vorschlag" : " · unsicherer Vorschlag – bitte prüfen") : " · kein Vorschlag"}
              </span>
              {r.problem && <span className="small warn-text">{r.problem}</span>}
            </span>
            <span className="unit-inputs">
              <select className="select select-compact" name={`unit_${r.itemId}`} defaultValue={r.unit} aria-label="Abgabeeinheit" onChange={() => toggle(r.itemId, true)}>
                <option value="">nicht angeben</option>
                {Object.entries(units).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <input className="input input-compact num" name={`unitcount_${r.itemId}`} defaultValue={r.count ?? ""} placeholder="Stück" inputMode="numeric" aria-label="Stück je Einheit" style={{ width: 70 }} onChange={() => toggle(r.itemId, true)} />
            </span>
          </div>
        ))}
        {visible.size === 0 && <div className="small muted" style={{ padding: "10px 14px" }}>Keine Treffer.</div>}
      </div>
      <div className="review-foot">
        <span className="small muted">{checked.size === 0 ? "Nichts ausgewählt." : `${checked.size} ausgewählt${hiddenChecked ? `, davon ${hiddenChecked} gerade ausgeblendet` : ""}.`}</span>
        <button className="btn btn-primary" type="submit" disabled={checked.size === 0}>
          {checked.size === 1 ? "1 Abgabeeinheit bestätigen" : `${checked.size} Abgabeeinheiten bestätigen`}
        </button>
      </div>
    </details>
  );
}
