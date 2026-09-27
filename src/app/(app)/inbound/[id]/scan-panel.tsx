"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { scanAction, type ScanState } from "../actions";

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.35));
  } catch {
    /* ohne Ton */
  }
}

export function ScanPanel({ shipmentId, boxes, disabled }: { shipmentId: string; boxes: { id: string; number: number }[]; disabled: boolean }) {
  const [state, action, pending] = useActionState<ScanState, FormData>(scanAction, null);
  const input = useRef<HTMLInputElement>(null);
  const [boxId, setBoxId] = useState<string>(boxes.at(-1)?.id ?? "");
  const [autoPrint, setAutoPrint] = useState(false);
  const [printSrc, setPrintSrc] = useState<string | null>(null);

  useEffect(() => {
    try {
      setAutoPrint(localStorage.getItem("inbound.autoPrint") === "1");
      const saved = localStorage.getItem(`inbound.box.${shipmentId}`);
      if (saved && boxes.some((b) => b.id === saved)) setBoxId(saved);
    } catch {
      /* egal */
    }
  }, [shipmentId, boxes]);

  useEffect(() => {
    if (!boxes.some((b) => b.id === boxId) && boxes.length) setBoxId(boxes.at(-1)!.id);
  }, [boxes, boxId]);

  useEffect(() => {
    if (!state) return;
    beep(state.ok);
    input.current?.focus();
    if (state.ok && autoPrint && state.last?.fnsku && state.last.quantity > 0) {
      setPrintSrc(`/etikett?skus=${encodeURIComponent(state.last.sku)}:${state.last.quantity}&drucken=1&t=${state.seq}`);
    }
  }, [state, autoPrint]);

  const keepFocus = () => {
    setTimeout(() => {
      const el = document.activeElement;
      if (!el || el === document.body) input.current?.focus();
    }, 150);
  };

  const hidden = (
    <>
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <input type="hidden" name="boxId" value={boxId} />
    </>
  );

  return (
    <div className="card" style={{ padding: "18px 20px", borderWidth: 2, borderColor: "var(--accent)" }}>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {hidden}
        <div className="between" style={{ flexWrap: "wrap" }}>
          <label htmlFor="code" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>Scannen: FNSKU, EAN, SKU oder ASIN · Menge davor möglich, z. B. „6*X001…“</label>
          <div style={{ display: "flex", gap: 14, alignItems: "center", fontSize: 13 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Karton
              <select className="select" style={{ width: 90, padding: "4px 8px" }} value={boxId} onChange={(e) => { setBoxId(e.target.value); try { localStorage.setItem(`inbound.box.${shipmentId}`, e.target.value); } catch {} input.current?.focus(); }}>
                {boxes.map((b) => <option key={b.id} value={b.id}>{b.number}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={autoPrint} onChange={(e) => { setAutoPrint(e.target.checked); try { localStorage.setItem("inbound.autoPrint", e.target.checked ? "1" : "0"); } catch {} input.current?.focus(); }} />
              Etikett sofort drucken
            </label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <label htmlFor="qty" className="sr-only">Menge</label>
          <input id="qty" name="quantity" defaultValue="1" inputMode="numeric" className="input" style={{ width: 80, fontSize: 22, fontFamily: "var(--mono)", textAlign: "center" }} disabled={disabled} />
          <input
            ref={input}
            id="code"
            name="code"
            autoFocus
            autoComplete="off"
            placeholder={disabled ? "Sendung ist abgeschlossen" : "Barcode scannen …"}
            onBlur={keepFocus}
            disabled={disabled || pending}
            className="input"
            style={{ fontFamily: "var(--mono)", fontSize: 24, padding: "10px 14px", background: "var(--surface-2)" }}
          />
          {/* Enter im Scanfeld braucht bei zwei Feldern einen Absende-Knopf */}
          <button type="submit" className="sr-only" tabIndex={-1}>Buchen</button>
        </div>
      </form>

      {state && (
        <div className={`notice ${state.ok ? "notice-ok" : "notice-error"}`} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, fontSize: 14 }}>
          <div style={{ flexGrow: 1 }}>
            <strong>{state.message}</strong>
            {state.last && <span className="num"> · {state.last.fnsku ?? "ohne FNSKU"} · {state.last.sku}</span>}
          </div>
          {state.last && <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{state.last.scanned}{state.last.planned ? ` / ${state.last.planned}` : ""}</div>}
        </div>
      )}

      {state?.options && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {state.options.map((o) => (
            <form key={o.sku} action={action}>
              {hidden}
              <input type="hidden" name="code" value={state.pendingCode} />
              <input type="hidden" name="quantity" value={state.pendingQuantity} />
              <input type="hidden" name="chooseSku" value={o.sku} />
              <button className="btn btn-small" type="submit" style={{ textAlign: "left" }}>
                <span className="num">{o.sku}</span>
                <span className="small muted"> · {o.purchaseDate ?? "?"}{o.fnsku ? "" : " · ohne FNSKU"}</span>
              </button>
            </form>
          ))}
        </div>
      )}
      {printSrc && <iframe key={printSrc} src={printSrc} title="Etikettendruck" style={{ width: 0, height: 0, border: 0, position: "absolute" }} />}
    </div>
  );
}
