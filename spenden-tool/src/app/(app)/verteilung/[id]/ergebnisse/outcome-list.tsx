"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { setOutcome, setOutcomes } from "@/app/(app)/actions";

type Outcome = "weg" | "wenig" | "viel";
export type OutcomeRow = { id: string; name: string; variant: string | null; image: string | null; category: string; stock: string | null; outcome: Outcome | null };
type Filter = "offen" | "erfasst" | Outcome | "alle";

/** Ergebnis-Knöpfe: Farbe, Symbol und Text – der gewählte ist ausgefüllt. */
const BUTTONS: { k: Outcome; label: string; icon: string }[] = [
  { k: "weg", label: "alles weg", icon: "✓" },
  { k: "wenig", label: "wenig übrig", icon: "◐" },
  { k: "viel", label: "viel übrig", icon: "✕" },
];
const FILTERS: { k: Filter; label: string }[] = [
  { k: "offen", label: "Noch offen" },
  { k: "erfasst", label: "Erfasst" },
  { k: "weg", label: "Alles weg" },
  { k: "wenig", label: "Wenig übrig" },
  { k: "viel", label: "Viel übrig" },
  { k: "alle", label: "Alle" },
];

/**
 * Ergebnisse erfassen: Suche, Kategorie und Status filtern sofort; ein Tipp speichert sofort (wird gleich angezeigt,
 * bei einem Fehler zurückgenommen). Fortschritt und Filter bleiben beim Scrollen oben sichtbar.
 */
export function OutcomeList({ eventId, rows, stockLabels, initial }: { eventId: string; rows: OutcomeRow[]; stockLabels: Record<string, string>; initial: { status?: string; q?: string; kat?: string } }) {
  const [q, setQ] = useState(initial.q ?? "");
  const [cat, setCat] = useState(initial.kat ?? "");
  const [filter, setFilter] = useState<Filter>(() =>
    FILTERS.some((x) => x.k === initial.status) ? (initial.status as Filter) : rows.some((r) => !r.outcome) ? "offen" : "alle",
  );
  // Sofort angezeigte Änderungen (bis der Server sie bestätigt hat)
  const [local, setLocal] = useState<Record<string, Outcome | null>>({});
  // Gerade geänderte Zeilen bleiben stehen, auch wenn sie nicht mehr zum Filter passen – sonst springt die Liste.
  const [sticky, setSticky] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [, start] = useTransition();

  // Filter im Link merken (Zurück-Taste, Neuladen) – der Server liest ihn beim Laden wieder ein.
  useEffect(() => {
    const u = new URL(window.location.href);
    for (const [k, v] of [["status", filter], ["q", q], ["kat", cat]] as const) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
    window.history.replaceState(null, "", u);
  }, [filter, q, cat]);

  const outcomeOf = (r: OutcomeRow) => (r.id in local ? local[r.id] : r.outcome);
  const all = rows.map((r) => ({ ...r, outcome: outcomeOf(r) }));
  const done = all.filter((r) => r.outcome).length;
  const counts = { weg: 0, wenig: 0, viel: 0 } as Record<Outcome, number>;
  for (const r of all) if (r.outcome) counts[r.outcome]++;
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))].sort((a, b) => a.localeCompare(b, "de")), [rows]);
  const needle = q.trim().toLocaleLowerCase("de-DE");
  const matchesFilter = (o: Outcome | null) => filter === "alle" || (filter === "offen" ? !o : filter === "erfasst" ? !!o : o === filter);
  const shown = all.filter(
    (r) =>
      (!needle || `${r.name} ${r.variant ?? ""}`.toLocaleLowerCase("de-DE").includes(needle)) &&
      (!cat || r.category === cat) &&
      (matchesFilter(r.outcome) || sticky.has(r.id)),
  );
  const shownOpen = shown.filter((r) => !r.outcome);

  const choose = (id: string, v: Outcome | null) => {
    const before = local;
    setError("");
    setLocal((m) => ({ ...m, [id]: v }));
    setSticky((s) => new Set(s).add(id));
    start(async () => {
      try {
        await setOutcome(id, v);
      } catch {
        setLocal(before);
        setError("Konnte nicht gespeichert werden – bitte erneut tippen (Verbindung?).");
      }
    });
  };
  // Grundeinstellung: offene zuerst (sind alle erfasst: alle). „Filter zurücksetzen“ führt dorthin zurück.
  const baseFilter: Filter = all.some((r) => !r.outcome) ? "offen" : "alle";
  const filtered = !!(q.trim() || cat || filter !== baseFilter);
  const resetFilters = () => {
    setQ("");
    setCat("");
    setFilter(baseFilter);
    setSticky(new Set());
  };
  const changeFilter = (f: Filter) => {
    setFilter(f);
    setSticky(new Set());
  };
  const bulk = () => {
    if (!shownOpen.length) return;
    if (!window.confirm(`${shownOpen.length} angezeigte offene Produkte auf „alles weg“ setzen?`)) return;
    const ids = shownOpen.map((r) => r.id);
    setLocal((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, "weg" as const])) }));
    start(async () => {
      try {
        await setOutcomes(eventId, ids, "weg");
      } catch {
        setError("Konnte nicht gespeichert werden – bitte erneut versuchen.");
      }
    });
  };
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;

  return (
    <section className="card outcome-list">
      <div className="outcome-sticky">
        <div className="outcome-progress">
          <strong>{done} von {rows.length} erfasst</strong>
          <span className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={done} aria-label="Fortschritt">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="outcome-counts">
            <span className="tag tag-ok">{counts.weg} alles weg</span>
            <span className="tag tag-warn">{counts.wenig} wenig übrig</span>
            <span className="tag tag-danger">{counts.viel} viel übrig</span>
            <span className="tag tag-neutral">{rows.length - done} noch offen</span>
          </span>
        </div>
        <div className="outcome-filters">
          <input className="input" type="search" placeholder="Produkt suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Produkt suchen" />
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Kategorie">
            <option value="">Alle Kategorien</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {filtered && (
            <button type="button" className="btn outcome-reset-filters" onClick={resetFilters} aria-label="Filter zurücksetzen" title="Suche, Kategorie und Status zurücksetzen">
              ✕ <span>Filter zurücksetzen</span>
            </button>
          )}
        </div>
        <div className="summary-chips" role="group" aria-label="Status">
          {FILTERS.map((f) => (
            <button key={f.k} type="button" className={`chip${filter === f.k ? " active" : ""}`} aria-pressed={filter === f.k} onClick={() => changeFilter(f.k)}>
              {f.label} ({f.k === "alle" ? rows.length : f.k === "offen" ? rows.length - done : f.k === "erfasst" ? done : counts[f.k]})
            </button>
          ))}
        </div>
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="outcome-meta small muted">
        <span>{shown.length} angezeigt</span>
        {shownOpen.length > 1 && <button type="button" className="btn btn-small" onClick={bulk}>Angezeigte offene ({shownOpen.length}): „alles weg“</button>}
      </div>
      {shown.length === 0 && (
        <div className="card-pad muted">
          {done === rows.length && !filtered ? "✓ Für alle Produkte ist ein Ergebnis erfasst." : "Keine Produkte für diese Suche/Filter."}{" "}
          {filtered && <button type="button" className="btn btn-small" onClick={resetFilters}>✕ Filter zurücksetzen</button>}
        </div>
      )}
      <ul className="outcome-items">
        {shown.map((r) => (
          <li key={r.id} className={`outcome-item outcome-is-${r.outcome ?? "offen"}`}>
            {r.image ? <img src={`${r.image}?w=200`} alt="" className="thumb outcome-thumb" loading="lazy" /> : <span className="thumb thumb-empty outcome-thumb">–</span>}
            <span className="outcome-text">
              <strong className="outcome-name">{r.name}{r.variant ? ` · ${r.variant}` : ""}</strong>
              <span className="small muted">
                {r.category}
                {r.stock ? ` · Bestand vorher: ${stockLabels[r.stock] ?? r.stock}` : ""}
              </span>
              <span className={`small outcome-state outcome-state-${r.outcome ?? "offen"}`}>
                {r.outcome ? `${BUTTONS.find((b) => b.k === r.outcome)!.icon} erfasst: ${BUTTONS.find((b) => b.k === r.outcome)!.label}` : "○ noch offen"}
              </span>
            </span>
            <span className="outcome-buttons" role="group" aria-label={`Ergebnis für ${r.name}`}>
              {BUTTONS.map((b) => (
                <button key={b.k} type="button" className={`btn outcome-btn outcome-${b.k}${r.outcome === b.k ? " active" : ""}`} aria-pressed={r.outcome === b.k} onClick={() => choose(r.id, r.outcome === b.k ? r.outcome : b.k)}>
                  <span aria-hidden="true">{b.icon}</span> {b.label}
                </button>
              ))}
              {r.outcome && (
                <button type="button" className="btn-link outcome-reset" onClick={() => choose(r.id, null)}>
                  ↺ zurücksetzen
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
