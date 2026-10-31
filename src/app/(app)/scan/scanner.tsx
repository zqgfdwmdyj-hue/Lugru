"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { scanAction, type ScanState } from "./actions";

// Scanner im Laden/beim Großhändler (B13): Kamera (BarcodeDetector, falls das Handy es kann) oder Eingabe, Preis,
// Ergebnis groß mit Ampel + Vorlesen; Liste der Sitzung (nur auf diesem Gerät); ohne Netz wird der Scan gemerkt.

type Merk = { code: string; preis: number; ampel?: string; text?: string; zeit: number };
const KEY = "scan-sitzung";
const lesen = (): Merk[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Merk[];
  } catch {
    return [];
  }
};
const schreiben = (l: Merk[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(l.slice(-50)));
  } catch {}
};
const sprechen = (t: string) => {
  try {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "de-DE";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
};
const FARBE: Record<string, string> = { gruen: "var(--ok)", gelb: "var(--warn)", rot: "var(--danger)" };
const TEXT: Record<string, string> = { gruen: "GRÜN", gelb: "GELB", rot: "ROT" };

export function Scanner() {
  const [state, action, pending] = useActionState<ScanState, FormData>(scanAction, null);
  const [liste, setListe] = useState<Merk[]>([]);
  const [kamera, setKamera] = useState(false);
  const [vorlesen, setVorlesen] = useState(true);
  const code = useRef<HTMLInputElement>(null);
  const preis = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => setListe(lesen()), []);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      const neu = [...lesen().filter((x) => !(x.code === state.code && !x.ampel)), { code: state.code, preis: state.preis, ampel: state.r.ampel, text: state.r.vorlesen, zeit: Date.now() }];
      schreiben(neu);
      setListe(neu);
      if (vorlesen) sprechen(state.r.vorlesen);
    }
  }, [state, vorlesen]);

  // Kamera: nur wenn der Browser BarcodeDetector kann (Chrome/Android, neuere iOS); sonst Eingabe/Handscanner.
  useEffect(() => {
    if (!kamera) return;
    let stop = false;
    let stream: MediaStream | null = null;
    const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) {
      setKamera(false);
      alert("Dieser Browser kann keine Barcodes lesen – bitte eingeben oder den Kurzbefehl „Scan“ nutzen.");
      return;
    }
    const det = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (!video.current) return;
      video.current.srcObject = stream;
      await video.current.play();
      while (!stop) {
        const r = await det.detect(video.current).catch(() => []);
        if (r[0]?.rawValue) {
          if (code.current) code.current.value = r[0].rawValue;
          preis.current?.focus();
          break;
        }
        await new Promise((x) => setTimeout(x, 250));
      }
      setKamera(false);
    })().catch(() => setKamera(false));
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [kamera]);

  const offlineMerken = (e: React.FormEvent<HTMLFormElement>) => {
    if (navigator.onLine) return;
    e.preventDefault();
    const c = code.current?.value.trim();
    const p = Number((preis.current?.value ?? "").replace(",", "."));
    if (!c) return;
    const neu = [...lesen(), { code: c, preis: p, zeit: Date.now() }];
    schreiben(neu);
    setListe(neu);
    alert("Kein Netz – Scan gemerkt, später „prüfen“ tippen.");
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <form action={action} onSubmit={offlineMerken} className="card card-pad stack" style={{ gap: 8 }} data-testid="scan-form">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input ref={code} className="input" name="code" inputMode="numeric" placeholder="EAN / ASIN" aria-label="EAN oder ASIN" style={{ flexGrow: 1, minWidth: 160, fontSize: 20 }} defaultValue={state && !state.ok ? (state.code ?? "") : ""} />
          <button type="button" className="btn" onClick={() => setKamera(true)}>📷 Kamera</button>
        </div>
        {kamera && <video ref={video} playsInline muted style={{ width: "100%", maxHeight: 240, background: "#000", borderRadius: 8 }} />}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input ref={preis} className="input" name="preis" inputMode="decimal" placeholder="Preis €" aria-label="Preis" style={{ width: 130, fontSize: 20 }} />
          <input className="input" name="menge" inputMode="numeric" placeholder="Menge" aria-label="Menge" style={{ width: 100 }} />
          <label className="small"><input type="checkbox" name="netto" /> netto</label>
          <label className="small"><input type="checkbox" checked={vorlesen} onChange={(e) => setVorlesen(e.target.checked)} /> vorlesen</label>
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending} style={{ fontSize: 18 }}>{pending ? "Prüfe …" : "Prüfen"}</button>
      </form>
      {state && !state.ok && <div className="notice notice-warn" role="status">{state.fehler}</div>}
      {state?.ok && (
        <section className="card card-pad stack" style={{ gap: 6, borderLeft: `8px solid ${FARBE[state.r.ampel]}` }} data-testid="scan-ergebnis">
          <div style={{ fontSize: 32, fontWeight: 800, color: FARBE[state.r.ampel] }}>{TEXT[state.r.ampel]}{state.r.land ? ` · ${state.r.land}` : ""}</div>
          <div style={{ fontSize: 20 }}>{state.r.gewinn_stueck !== null ? `${state.r.gewinn_stueck.toFixed(2).replace(".", ",")} € / Stück` : "–"}{state.r.roi !== null ? ` · ROI ${Math.round(state.r.roi)} %` : ""}{state.r.empfohlene_menge ? ` · nimm ${state.r.empfohlene_menge}` : ""}</div>
          <div className="small muted">{state.r.titel ?? state.r.asin} · {state.r.angebote ?? "?"} Angebote{state.r.amazon_anteil !== null ? ` · Amazon ${Math.round(state.r.amazon_anteil)} %` : ""}{state.r.eigener_bestand ? ` · eigener Bestand ${state.r.eigener_bestand.bestand}` : ""}</div>
          <div className="small">{state.r.begruendung}</div>
          {state.r.hinweise.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{state.r.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          <div><button type="button" className="btn btn-small" onClick={() => sprechen(state.r.vorlesen)}>🔊 Vorlesen</button> <span className="small muted" data-testid="scan-vorlesen">{state.r.vorlesen}</span></div>
        </section>
      )}
      {liste.length > 0 && (
        <section className="card card-pad small" data-testid="scan-liste">
          <div className="between"><strong>Diese Sitzung ({liste.length})</strong><button type="button" className="btn-link small" onClick={() => { schreiben([]); setListe([]); }}>leeren</button></div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {[...liste].reverse().map((x) => <li key={x.zeit}>{x.code} · {x.preis ? `${x.preis.toFixed(2).replace(".", ",")} €` : "?"} · {x.ampel ? TEXT[x.ampel] : "noch nicht geprüft (offline)"}</li>)}
          </ul>
          <div className="muted" style={{ marginTop: 6 }}>Übernehmen: im Deal-Eingang „Einfügen“ oder per Claude („scan_pruefen“ → in Bestellvorschläge).</div>
        </section>
      )}
    </div>
  );
}
