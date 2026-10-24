"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { checkOutPallet, inventoryAction, type InventoryState } from "../actions";
import { CameraScan } from "../scan";

const KEY = "paletten.inventur";

/** Inventur: alles im Lager abscannen (Handscanner oder Kamera), dann mit dem Bestand abgleichen. */
export function InventoryForm() {
  const [state, action] = useActionState<InventoryState, FormData>(inventoryAction, null);
  const [pending, start] = useTransition();
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Gescannte Liste übersteht ein Neuladen (nur in diesem Browser). Gespeichert wird nur bei
  // Änderungen – sonst überschreibt beim Start die leere Liste den gespeicherten Stand.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(saved)) setCodes(saved.map(String));
    } catch {}
  }, []);
  const update = (fn: (list: string[]) => string[]) =>
    setCodes((list) => {
      const next = fn(list);
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });

  const add = (c: string) => {
    const v = c.trim();
    if (!v) return;
    update((list) => (list.some((x) => x.toLowerCase() === v.toLowerCase()) ? list : [v, ...list]));
    setCode("");
    input.current?.focus();
  };
  const compare = () => {
    const fd = new FormData();
    fd.set("codes", JSON.stringify(codes));
    start(() => action(fd));
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="field">
        <label className="label" htmlFor="inv-code">Palette scannen (Handscanner: einfach nacheinander scannen)</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input ref={input} className="input" id="inv-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(code); } }} autoFocus autoComplete="off" placeholder="Nummer + Enter" style={{ fontSize: 20, fontFamily: "var(--mono)", flex: 1, minWidth: 0 }} />
          <button className="btn" type="button" onClick={() => setCamera((c) => !c)}>Kamera</button>
        </div>
      </div>
      {camera && <CameraScan onCode={(c) => { add(c); setCamera(false); }} onClose={() => setCamera(false)} />}
      <div className="small"><strong data-testid="inv-count">{codes.length}</strong> gescannt{codes.length ? `: ${codes.slice(0, 12).join(", ")}${codes.length > 12 ? " …" : ""}` : ""}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="button" onClick={compare} disabled={pending || !codes.length} data-testid="inv-compare">{pending ? "Gleiche ab …" : "Mit Bestand abgleichen"}</button>
        {codes.length > 0 && <button className="btn" type="button" onClick={() => { if (confirm("Gescannte Liste leeren?")) update(() => []); }}>Liste leeren</button>}
      </div>
      {state && (
        <div className={`notice ${state.ok && !state.missing?.length && !state.unknown?.length ? "notice-ok" : "notice-warn"} stack`} style={{ gap: 8 }} data-testid="inv-result">
          <strong>{state.message}</strong>
          {state.missing && state.missing.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="small">Im System eingelagert, aber nicht gescannt (fehlt oder schon weg?):</span>
              {state.missing.map((p) => (
                <div key={p.id} className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="inv-missing">
                  <Link href={`/paletten/${p.id}`}><strong>{p.code}</strong></Link>
                  <span className="muted">{[p.location && `Platz ${p.location}`, p.customer].filter(Boolean).join(" · ")}</span>
                  <form action={checkOutPallet}><input type="hidden" name="id" value={p.id} /><button className="btn btn-small" type="submit">Ist raus</button></form>
                </div>
              ))}
            </div>
          )}
          {state.unknown && state.unknown.length > 0 && (
            <div className="small" data-testid="inv-unknown">Gescannt, aber nicht eingelagert: <strong>{state.unknown.join(", ")}</strong> – oben unter „Lager“ einlagern.</div>
          )}
        </div>
      )}
    </div>
  );
}
