"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { scanPallet, type ScanState } from "./actions";
import { PhotoPicker, type PickedPhoto } from "./photos";

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

type Mode = "ein" | "aus" | "suchen";
const MODES: { key: Mode; label: string }[] = [
  { key: "ein", label: "Einlagern" },
  { key: "aus", label: "Auslagern" },
  { key: "suchen", label: "Suchen" },
];
const dmy = (iso: string) => iso.split("-").reverse().join(".");

export function PalletScan({ customers, locations, today }: { customers: string[]; locations: string[]; today: string }) {
  const [state, action] = useActionState<ScanState, FormData>(scanPallet, null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<Mode>("ein");
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [more, setMore] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const m = localStorage.getItem("paletten.mode");
      if (m === "ein" || m === "aus" || m === "suchen") setMode(m);
    } catch {}
  }, []);
  useEffect(() => {
    if (state?.ok) {
      setCode("");
      if (mode === "ein") {
        setPhotos([]);
        form.current?.querySelectorAll<HTMLInputElement>("#pal-location, #pal-contents, #pal-weight, #pal-note").forEach((i) => (i.value = ""));
      }
    }
    input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const pick = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem("paletten.mode", m); } catch {}
    input.current?.focus();
  };
  const onCamera = (c: string) => {
    setCamera(false);
    setCode(c);
    setTimeout(() => form.current?.requestSubmit(), 30);
  };
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (mode === "ein") for (const p of photos) fd.append("photos", p.file, p.file.name);
    start(() => action(fd));
  }
  const f = state?.found;

  return (
    <form ref={form} onSubmit={submit} className="card card-pad stack" style={{ gap: 12 }} data-testid="pal-scan">
      <input type="hidden" name="mode" value={mode} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {MODES.map((m) => (
          <button key={m.key} type="button" className={`btn${mode === m.key ? " btn-primary" : ""}`} onClick={() => pick(m.key)} aria-pressed={mode === m.key}>{m.label}</button>
        ))}
      </div>

      <div className="field">
        <label className="label" htmlFor="pal-code">
          {mode === "ein" ? "Palettennummer scannen oder eingeben (leer = Nummer wird vergeben)" : mode === "aus" ? "Palettennummer scannen oder eingeben" : "Palette scannen – zeigt Stellplatz, Kunde und Inhalt"}
        </label>
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
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div className="field">
              <label className="label" htmlFor="pal-customer">Kunde</label>
              <input className="input" id="pal-customer" name="customer" list="pal-customers" autoComplete="off" />
              <datalist id="pal-customers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field">
              <label className="label" htmlFor="pal-location">Stellplatz</label>
              <input className="input" id="pal-location" name="location" list="pal-locations" autoComplete="off" placeholder="z. B. B-03" autoCapitalize="characters" />
              <datalist id="pal-locations">{locations.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field">
              <label className="label" htmlFor="pal-count">Anzahl Paletten</label>
              <input className="input" id="pal-count" name="count" type="number" min={1} max={100} defaultValue={1} disabled={code.trim() !== ""} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label className="label" htmlFor="pal-contents">Inhalt</label>
              <input className="input" id="pal-contents" name="contents" autoComplete="off" placeholder="z. B. 48 Kartons Shampoo" />
            </div>
            <div className="field">
              <label className="label" htmlFor="pal-weight">Gewicht (kg)</label>
              <input className="input" id="pal-weight" name="weightKg" inputMode="decimal" autoComplete="off" />
            </div>
          </div>
          {more ? (
            <div className="field">
              <label className="label" htmlFor="pal-note">Notiz</label>
              <input className="input" id="pal-note" name="note" autoComplete="off" />
            </div>
          ) : (
            <button className="btn-link small" type="button" onClick={() => setMore(true)} style={{ alignSelf: "flex-start" }}>+ Notiz</button>
          )}
          <div className="field">
            <span className="label">Fotos (Zustand, Lieferschein)</span>
            <PhotoPicker photos={photos} onChange={setPhotos} />
          </div>
        </>
      )}
      {mode !== "suchen" && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field">
            <label className="label" htmlFor="pal-date">{mode === "ein" ? "Eingelagert am" : "Ausgelagert am"}</label>
            <input className="input" id="pal-date" name="date" type="date" defaultValue={today} max={today} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Speichere …" : mode === "ein" ? "Einlagern – Timer starten" : "Auslagern – Timer stoppen"}
          </button>
        </div>
      )}
      {mode === "suchen" && (
        <button className="btn btn-primary" type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>{pending ? "Suche …" : "Suchen"}</button>
      )}

      {state && (
        <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} data-testid="pal-result">
          {f ? (
            <div className="stack" style={{ gap: 4 }}>
              <div style={{ fontSize: 18 }}>
                <strong>{f.code}</strong> · Stellplatz <strong data-testid="pal-found-location">{f.location ?? "–"}</strong>
              </div>
              <div className="small">
                {f.customer ?? "ohne Kunde"} · seit {dmy(f.inAt)} ({f.days} Tage) · {f.chargeableFrom <= today ? `kostenpflichtig seit ${dmy(f.chargeableFrom)}` : `frei bis ${dmy(f.chargeableFrom)}`}
                {f.contents ? ` · ${f.contents}` : ""}
                {f.weightKg ? ` · ${String(f.weightKg).replace(".", ",")} kg` : ""}
                {f.photos ? ` · ${f.photos} Foto${f.photos === 1 ? "" : "s"}` : ""}
              </div>
              <Link className="small" href={`/paletten/${f.id}`}>Details öffnen</Link>
            </div>
          ) : (
            <>
              {state.message}
              {state.ok && mode === "ein" && state.codes?.length ? (
                <> · <a href={`/etikett/palette?codes=${encodeURIComponent(state.codes.join(","))}`} target="_blank" rel="noreferrer">Etikett{state.codes.length > 1 ? "en" : ""} drucken</a></>
              ) : null}
            </>
          )}
          {state.warn && <div className="small" style={{ marginTop: 4, color: "var(--danger)" }} data-testid="pal-warn">{state.warn}</div>}
        </div>
      )}
    </form>
  );
}
