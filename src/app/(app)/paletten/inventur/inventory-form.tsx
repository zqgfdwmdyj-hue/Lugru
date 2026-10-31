"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { finishInventoryAction, inventoryAction, type InventoryState } from "../actions";
import { CameraScan } from "../scan";

const KEY = "paletten.inventur";
type Decision = "raus" | "da" | "klaeren" | "ignorieren" | "einlagern";

/**
 * Inventur: alles im Lager abscannen (Handscanner oder Kamera), mit dem Bestand abgleichen, jede Abweichung
 * einzeln entscheiden und dann abschließen. Doppelt Gescanntes zählt einmal und wird angezeigt.
 */
export function InventoryForm({ expected }: { expected: number }) {
  const [state, action] = useActionState<InventoryState, FormData>(inventoryAction, null);
  const [done, finish] = useActionState<InventoryState, FormData>(finishInventoryAction, null);
  const [pending, start] = useTransition();
  const [scans, setScans] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [camera, setCamera] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const input = useRef<HTMLInputElement>(null);

  // Gescannte Liste übersteht ein Neuladen (nur in diesem Browser). Gespeichert wird nur bei Änderungen.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(saved)) setScans(saved.map(String));
    } catch {}
  }, []);
  const update = (fn: (list: string[]) => string[]) =>
    setScans((list) => {
      const next = fn(list);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  useEffect(() => {
    if (done?.ok) {
      update(() => []);
      setDecisions({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const unique = [...new Map(scans.map((c) => [c.toLowerCase(), c])).values()];
  const times = (c: string) => scans.filter((x) => x.toLowerCase() === c.toLowerCase()).length;
  const add = (c: string) => {
    const v = c.trim();
    if (!v) return;
    const n = times(v);
    update((list) => [v, ...list]);
    setLast(n ? { ok: false, text: `${v} doppelt gescannt (${n + 1}×) – zählt einmal.` } : { ok: true, text: `${v} erfasst.` });
    setCode("");
    input.current?.focus();
  };
  const compare = () => {
    const fd = new FormData();
    fd.set("codes", JSON.stringify(scans));
    setDecisions({});
    start(() => action(fd));
  };
  const decide = (c: string, d: Decision) => setDecisions((x) => ({ ...x, [c.toLowerCase()]: d }));
  const open = [...(state?.missing?.map((p) => p.code) ?? []), ...(state?.unknown ?? [])];
  const undecided = open.filter((c) => !decisions[c.toLowerCase()]).length;
  const close = () => {
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ codes: scans, decisions }));
    start(() => finish(fd));
  };
  const Btn = ({ c, d, label }: { c: string; d: Decision; label: string }) => (
    <button type="button" className={`btn btn-small${decisions[c.toLowerCase()] === d ? " btn-primary" : ""}`} aria-pressed={decisions[c.toLowerCase()] === d} onClick={() => decide(c, d)}>{label}</button>
  );

  if (done?.ok) {
    return (
      <div className="notice notice-ok stack" style={{ gap: 8 }} data-testid="inv-done">
        <strong>{done.message}</strong>
        <a className="btn btn-small" href="/paletten/inventur" style={{ alignSelf: "flex-start" }}>Neue Inventur</a>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="small">Erwartet laut System: <strong data-testid="inv-expected">{expected}</strong> Paletten</div>
      <div className="field">
        <label className="label" htmlFor="inv-code">Palette scannen (Handscanner: einfach nacheinander scannen)</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input ref={input} className="input" id="inv-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(code); } }} autoFocus autoComplete="off" placeholder="Nummer + Enter" style={{ fontSize: 20, fontFamily: "var(--mono)", flex: 1, minWidth: 0 }} />
          <button className="btn" type="button" onClick={() => setCamera((c) => !c)}>Kamera</button>
        </div>
      </div>
      {camera && <CameraScan onCode={(c) => { add(c); setCamera(false); }} onClose={() => setCamera(false)} />}
      {last && (
        <div className={`scan-status ${last.ok ? "scan-ok" : "scan-warn"}`} role="status" aria-live="assertive" data-testid="inv-last">
          <span className="scan-icon" aria-hidden="true">{last.ok ? "✓" : "⚠"}</span>
          <div>{last.text}</div>
        </div>
      )}
      <div className="small">
        <strong data-testid="inv-count">{unique.length}</strong> gescannt{scans.length > unique.length ? ` (${scans.length - unique.length} doppelt)` : ""}
        {unique.length ? `: ${unique.slice(0, 12).join(", ")}${unique.length > 12 ? " …" : ""}` : ""}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary pal-big-btn" type="button" onClick={compare} disabled={pending || !scans.length} data-testid="inv-compare">{pending ? "Gleiche ab …" : "Mit Bestand abgleichen"}</button>
        {scans.length > 0 && <button className="btn" type="button" onClick={() => { if (confirm("Gescannte Liste leeren?")) { update(() => []); setLast(null); } }}>Liste leeren</button>}
      </div>
      {state && (
        <div className={`notice ${state.ok && !state.missing?.length && !state.unknown?.length ? "notice-ok" : "notice-warn"} stack`} style={{ gap: 10 }} data-testid="inv-result">
          <strong>{state.message}</strong>
          {state.ok && (
            <div className="small" data-testid="inv-summary">
              Erwartet {state.expected} · gefunden {state.found?.length ?? 0} · fehlen {state.missing?.length ?? 0} · unbekannt {state.unknown?.length ?? 0} · doppelt gescannt {state.duplicates?.length ?? 0}
            </div>
          )}
          {state.missing && state.missing.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small"><strong>Fehlen</strong> – im System eingelagert, aber nicht gescannt. Bitte je Palette entscheiden:</span>
              {state.missing.map((p) => (
                <div key={p.id} className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="inv-missing">
                  <Link href={`/paletten/${p.id}`}><strong>{p.code}</strong></Link>
                  <span className="muted">{[p.location && `Platz ${p.location}`, p.customer].filter(Boolean).join(" · ")}</span>
                  <Btn c={p.code} d="raus" label="ist raus (auslagern)" />
                  <Btn c={p.code} d="da" label="doch da" />
                  <Btn c={p.code} d="klaeren" label="klären" />
                </div>
              ))}
            </div>
          )}
          {state.unknown && state.unknown.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="small"><strong>Unbekannt</strong> – gescannt, aber nicht eingelagert:</span>
              {state.unknown.map((c) => (
                <div key={c} className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} data-testid="inv-unknown">
                  <strong>{c}</strong>
                  <a className="btn btn-small" href={`/paletten?aktion=ein&code=${encodeURIComponent(c)}#scan`} target="_blank" rel="noreferrer" onClick={() => decide(c, "einlagern")}>einlagern …</a>
                  <Btn c={c} d="ignorieren" label="ignorieren" />
                </div>
              ))}
            </div>
          )}
          {state.duplicates && state.duplicates.length > 0 && (
            <div className="small" data-testid="inv-duplicates">Doppelt gescannt (zählt einmal): {state.duplicates.map((d) => `${d.code} (${d.times}×)`).join(", ")}</div>
          )}
          {state.ok && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary" type="button" onClick={close} disabled={pending || undecided > 0} data-testid="inv-finish">Inventur abschließen</button>
              <span className="small muted">{undecided ? `Noch ${undecided} Abweichung${undecided === 1 ? "" : "en"} zu entscheiden.` : "Alles entschieden – alles landet im Verlauf der Paletten."}</span>
            </div>
          )}
          {done && !done.ok && <div className="small" style={{ color: "var(--danger)" }}>{done.message}</div>}
        </div>
      )}
    </div>
  );
}
