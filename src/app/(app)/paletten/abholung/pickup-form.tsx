"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useSubmitKey } from "@/lib/use-submit-key";
import { pickupAction, type PickupState } from "../actions";
import { CameraScan } from "../scan";

type Pallet = { id: string; code: string; customer: string | null; location: string | null; contents: string | null };

/** Unterschrift mit Finger oder Maus – als PNG. */
function SignaturePad({ onChange }: { onChange: (png: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange("");
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <canvas
        ref={canvas}
        className="sig-pad"
        data-testid="signature"
        aria-label="Unterschriftsfeld"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 0.1, p.y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (dirty.current) onChange(e.currentTarget.toDataURL("image/png"));
        }}
        onPointerCancel={() => (drawing.current = false)}
      />
      <button className="btn btn-small" type="button" onClick={clear} style={{ alignSelf: "flex-start" }}>Unterschrift löschen</button>
    </div>
  );
}

export function PickupForm({ pallets, gone = [], customers, today, preselect }: { pallets: Pallet[]; gone?: { code: string; outAt: string; cancelled: boolean }[]; customers: string[]; today: string; preselect?: string }) {
  const [state, action] = useActionState<PickupState, FormData>(pickupAction, null);
  const [pending, start] = useTransition();
  const submitKey = useSubmitKey();
  useEffect(() => {
    if (state) submitKey.settled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const [customer, setCustomer] = useState(preselect ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickedBy, setPickedBy] = useState("");
  const [camera, setCamera] = useState(false);
  const [signature, setSignature] = useState("");
  // Die Unterschrift gilt genau für diese Auswahl, diesen Abholer und dieses Datum – ändert sich etwas, neu unterschreiben.
  const [date, setDate] = useState(today);
  const [signedKey, setSignedKey] = useState("");
  const [padKey, setPadKey] = useState(0);
  const list = useMemo(() => pallets.filter((p) => !customer || (p.customer ?? "") === customer), [pallets, customer]);

  const add = (code: string) => {
    const c = code.trim();
    const p = pallets.find((x) => x.code.toLowerCase() === c.toLowerCase());
    if (!p) {
      const g = gone.find((x) => x.code.toLowerCase() === c.toLowerCase());
      const d = (iso: string) => iso.split("-").reverse().join(".");
      return setScanMsg({ ok: false, text: g ? (g.cancelled ? `„${g.code}“ wurde storniert – nicht im Lager.` : `„${g.code}“ ist schon ausgelagert (am ${d(g.outAt)}).`) : `„${c}“ ist unbekannt – unter dieser Nummer ist nichts eingelagert.` });
    }
    if (selected.has(p.id)) return setScanMsg({ ok: false, text: `${p.code} ist schon ausgewählt (doppelt gescannt).` });
    setSelected((s) => new Set(s).add(p.id));
    if (customer && (p.customer ?? "") !== customer) setCustomer("");
    setScanMsg({ ok: true, text: `${p.code} dazu${p.location ? ` (Platz ${p.location})` : ""}${p.customer ? ` · ${p.customer}` : ""}.` });
  };
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    for (const id of selected) fd.append("ids", id);
    fd.set("signature", signature);
    fd.set("signedCodes", chosenCodes.join(","));
    submitKey.stamp(fd);
    start(() => action(fd));
  }
  if (state?.ok && state.id) {
    return (
      <div className="notice notice-ok stack" data-testid="pickup-done" style={{ gap: 8 }}>
        <div>{state.message}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-primary btn-small" href={`/paletten/abholschein/${state.id}`} target="_blank" rel="noreferrer" data-testid="pickup-pdf">Abholschein öffnen (PDF)</a>
          <a className="btn btn-small" href="/paletten/abholung">Nächste Abholung</a>
        </div>
      </div>
    );
  }
  const chosen = pallets.filter((p) => selected.has(p.id));
  const chosenCodes = [...chosen].map((p) => p.code).sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  const currentKey = JSON.stringify([chosenCodes, pickedBy.trim(), date]);
  const signatureValid = Boolean(signature) && signedKey === currentKey;
  const signatureStale = Boolean(signature) && signedKey !== currentKey;
  const resetSignature = () => { setSignature(""); setSignedKey(""); setPadKey((k) => k + 1); };
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 12 }} data-testid="pickup-form">
      <div className="priv-grid">
        <div className="field">
          <label className="label" htmlFor="pu-customer">Kunde</label>
          <select className="select" id="pu-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">alle</option>
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label className="label" htmlFor="pu-scan">Palette scannen</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" id="pu-scan" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (scan.trim()) add(scan); setScan(""); } }} autoComplete="off" placeholder="Nummer + Enter" style={{ flex: 1, minWidth: 0 }} />
            <button className="btn" type="button" onClick={() => setCamera((c) => !c)}>Kamera</button>
          </div>
        </div>
      </div>
      {camera && <CameraScan onCode={(c) => { setCamera(false); add(c); }} onClose={() => setCamera(false)} />}
      {scanMsg && (
        <div className={`scan-status ${scanMsg.ok ? "scan-ok" : "scan-err"}`} role="status" aria-live="assertive" data-testid="pickup-scan-msg">
          <span className="scan-icon" aria-hidden="true">{scanMsg.ok ? "✓" : "✗"}</span>
          <div>{scanMsg.text}</div>
        </div>
      )}
      <div className="stack" style={{ gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span className="label">{list.length} eingelagert{customer ? ` bei ${customer}` : ""} – {chosen.length} ausgewählt</span>
          {list.length > 0 && <button className="btn-link small" type="button" onClick={() => setSelected(new Set([...selected, ...list.map((p) => p.id)]))}>alle auswählen</button>}
        </div>
        <div className="pick-chips" data-testid="pickup-list">
          {list.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.code}{p.location ? ` · ${p.location}` : ""}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="priv-grid">
        <div className="field"><label className="label" htmlFor="pu-by">Abgeholt von</label><input className="input" id="pu-by" name="pickedBy" required autoComplete="off" placeholder="Name des Fahrers" value={pickedBy} onChange={(e) => setPickedBy(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="pu-plate">Kennzeichen (optional)</label><input className="input" id="pu-plate" name="plate" autoComplete="off" /></div>
        <div className="field"><label className="label" htmlFor="pu-date">Datum</label><input className="input" id="pu-date" name="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="field"><label className="label" htmlFor="pu-note">Hinweis (optional)</label><input className="input" id="pu-note" name="note" autoComplete="off" placeholder="z. B. eine Palette mit beschädigter Folie" /></div>
      {chosen.length > 0 && (() => {
        const byCustomer = new Map<string, number>();
        for (const p of chosen) byCustomer.set(p.customer ?? "ohne Kunde", (byCustomer.get(p.customer ?? "ohne Kunde") ?? 0) + 1);
        return (
          <div className="notice notice-info stack" style={{ gap: 4 }} data-testid="pickup-summary">
            <strong>Zusammenfassung: {chosen.length} Palette{chosen.length === 1 ? "" : "n"}</strong>
            <div className="small">Kunde{byCustomer.size === 1 ? "" : "n"}: {[...byCustomer].map(([c, n]) => `${c} (${n})`).join(", ")}</div>
            <div className="small num">{[...chosen].sort((a, b) => a.code.localeCompare(b.code, "de", { numeric: true })).map((p) => `${p.code}${p.location ? ` (${p.location})` : ""}`).join(", ")}</div>
            {byCustomer.size > 1 && <div className="small" style={{ color: "var(--warn)" }} data-testid="pickup-mixed">⚠ Paletten von {byCustomer.size} Kunden – bitte prüfen, ob das so stimmt.</div>}
            <div className="small">Abholer: {pickedBy.trim() || <span style={{ color: "var(--warn)" }}>noch nicht eingetragen</span>} · Datum: {date ? date.split("-").reverse().join(".") : "–"}</div>
          </div>
        );
      })()}
      <div className="field">
        <span className="label">Unterschrift Abholer ({chosen.length} Palette{chosen.length === 1 ? "" : "n"} übernommen)</span>
        <div className="small muted">Erst Auswahl, Abholer und Datum prüfen, dann unterschreiben – die Unterschrift gilt nur für genau diese Zusammenfassung.</div>
        <SignaturePad key={padKey} onChange={(png) => { setSignature(png); setSignedKey(png ? currentKey : ""); }} />
        {signatureStale && (
          <div className="notice notice-warn small" data-testid="signature-stale">
            Nach der Unterschrift wurde etwas geändert (Paletten, Abholer oder Datum) – bitte neu unterschreiben.{" "}
            <button className="btn btn-small" type="button" onClick={resetSignature}>Unterschrift löschen</button>
          </div>
        )}
      </div>
      <button className="btn btn-primary pal-big-btn" type="submit" disabled={pending || !chosen.length || !signatureValid || !pickedBy.trim()} style={{ alignSelf: "flex-start" }} data-testid="pickup-submit">
        {pending ? "Speichere …" : `${chosen.length} Palette${chosen.length === 1 ? "" : "n"} auslagern & Abholschein erstellen`}
      </button>
      {state && !state.ok && <div className="notice notice-warn" data-testid="pickup-error">{state.message}</div>}
    </form>
  );
}
