"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { scanPallet, type ScanState } from "./actions";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/** Kamera-Scan über die BarcodeDetector-API (Chrome/Android, Safari ab iOS 17). */
function CameraScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o?: object) => Detector }).BarcodeDetector;
    if (!Ctor) {
      setError("Dieser Browser kann keine Codes mit der Kamera lesen. Bitte Nummer eintippen oder Handscanner nutzen.");
      return;
    }
    const detector = new Ctor();
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const hits = await detector.detect(video.current).catch(() => []);
          if (hits[0]?.rawValue) {
            onCode(hits[0].rawValue.trim());
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setError("Kein Zugriff auf die Kamera.");
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {error ? <div className="notice notice-warn">{error}</div> : <video ref={video} muted playsInline style={{ width: "100%", maxWidth: 420, borderRadius: 8, background: "#000" }} />}
      <button className="btn btn-small" type="button" onClick={onClose} style={{ alignSelf: "flex-start" }}>Kamera schließen</button>
    </div>
  );
}

export function PalletScan({ customers, today }: { customers: string[]; today: string }) {
  const [state, action, pending] = useActionState<ScanState, FormData>(scanPallet, null);
  const [mode, setMode] = useState<"ein" | "aus">("ein");
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const m = localStorage.getItem("paletten.mode");
      if (m === "ein" || m === "aus") setMode(m);
    } catch {}
  }, []);
  useEffect(() => {
    if (state?.ok) setCode("");
    input.current?.focus();
  }, [state]);

  const pick = (m: "ein" | "aus") => {
    setMode(m);
    try { localStorage.setItem("paletten.mode", m); } catch {}
    input.current?.focus();
  };
  const onCamera = (c: string) => {
    setCamera(false);
    setCode(c);
    setTimeout(() => form.current?.requestSubmit(), 30);
  };

  return (
    <form ref={form} action={action} className="card card-pad stack" style={{ gap: 12 }}>
      <input type="hidden" name="mode" value={mode} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={`btn${mode === "ein" ? " btn-primary" : ""}`} onClick={() => pick("ein")} aria-pressed={mode === "ein"}>Einlagern</button>
        <button type="button" className={`btn${mode === "aus" ? " btn-primary" : ""}`} onClick={() => pick("aus")} aria-pressed={mode === "aus"}>Auslagern</button>
      </div>

      <div className="field">
        <label className="label" htmlFor="pal-code">{mode === "ein" ? "Palettennummer scannen oder eingeben (leer = Nummer wird vergeben)" : "Palettennummer scannen oder eingeben"}</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={input}
            id="pal-code"
            name="code"
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="off"
            placeholder={mode === "ein" ? "z. B. P-0001" : "Palette scannen …"}
            style={{ fontSize: 20, fontFamily: "var(--mono)", flex: 1, minWidth: 0 }}
          />
          <button className="btn" type="button" onClick={() => setCamera((c) => !c)} title="Code mit der Handykamera scannen">Kamera</button>
        </div>
      </div>
      {camera && <CameraScan onCode={onCamera} onClose={() => setCamera(false)} />}

      {mode === "ein" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div className="field">
            <label className="label" htmlFor="pal-customer">Kunde</label>
            <input className="input" id="pal-customer" name="customer" list="pal-customers" autoComplete="off" />
            <datalist id="pal-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="field">
            <label className="label" htmlFor="pal-count">Anzahl Paletten</label>
            <input className="input" id="pal-count" name="count" type="number" min={1} max={100} defaultValue={1} disabled={code.trim() !== ""} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pal-note">Notiz</label>
            <input className="input" id="pal-note" name="note" autoComplete="off" />
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field">
          <label className="label" htmlFor="pal-date">{mode === "ein" ? "Eingelagert am" : "Ausgelagert am"}</label>
          <input className="input" id="pal-date" name="date" type="date" defaultValue={today} max={today} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Speichere …" : mode === "ein" ? "Einlagern – Timer starten" : "Auslagern – Timer stoppen"}
        </button>
      </div>

      {state && (
        <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} data-testid="pal-result">
          {state.message}
          {state.ok && mode === "ein" && state.codes?.length ? (
            <> · <a href={`/etikett/palette?codes=${encodeURIComponent(state.codes.join(","))}`} target="_blank" rel="noreferrer">Etikett{state.codes.length > 1 ? "en" : ""} drucken</a></>
          ) : null}
        </div>
      )}
    </form>
  );
}
