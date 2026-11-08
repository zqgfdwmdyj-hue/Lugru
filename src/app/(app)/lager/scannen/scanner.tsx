"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ScanErgebnis, ScanZustand } from "@/lib/druck/scanner";
import { scanAction } from "./actions";

// Vollbild-Arbeitsplatz für den Bluetooth-Handscanner: Das Eingabefeld hat immer den Fokus; Ton und Blitz melden
// ok/Fehler, damit man nicht auf den Bildschirm schauen muss.

function ton(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new Ctx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = ok ? 1200 : 220;
    g.gain.value = 0.15;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + (ok ? 0.12 : 0.45));
  } catch {
    /* ohne Ton */
  }
}

export function Scanner() {
  const feld = useRef<HTMLInputElement>(null);
  const [zustand, setZustand] = useState<ScanZustand>({ modus: "normal", sku: null, menge: 0 });
  const [erg, setErg] = useState<ScanErgebnis | null>(null);
  const [blitz, setBlitz] = useState<"ok" | "fehler" | null>(null);
  const [laeuft, starte] = useTransition();
  useEffect(() => {
    const i = setInterval(() => document.activeElement !== feld.current && feld.current?.focus(), 800);
    feld.current?.focus();
    return () => clearInterval(i);
  }, []);
  const senden = (wert: string) =>
    starte(async () => {
      const r = await scanAction(zustand, wert);
      setErg(r);
      setZustand(r.zustand);
      setBlitz(r.ok ? "ok" : "fehler");
      ton(r.ok);
      setTimeout(() => setBlitz(null), 350);
    });
  const a = erg?.anzeige.artikel;
  const modusText = { normal: "Artikel scannen", wareneingang: `Wareneingang${zustand.sku ? ` · ${zustand.sku} × ${zustand.menge}` : ""}`, retoure: "Retoure – LPN scannen", stellplatz: "Stellplatz scannen" }[zustand.modus];
  return (
    <div data-testid="scanner" data-modus={zustand.modus} style={{ minHeight: "70vh", display: "flex", flexDirection: "column", gap: 16, padding: 16, borderRadius: 12, transition: "background .2s", background: blitz === "ok" ? "rgba(26,127,55,.25)" : blitz === "fehler" ? "rgba(192,57,43,.3)" : "var(--surface, #fff)" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 22 }} data-testid="scanner-modus">{modusText}</strong>
        <button className="btn btn-sm" type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>Vollbild</button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const w = feld.current?.value ?? "";
          if (feld.current) feld.current.value = "";
          if (w.trim()) senden(w);
        }}
      >
        <input ref={feld} className="input" autoComplete="off" inputMode="none" aria-label="Scan" placeholder="scannen …" data-testid="scanner-eingabe" style={{ fontSize: 28, width: "100%", padding: 12 }} disabled={false} />
      </form>
      {erg && <div data-testid="scanner-meldung" data-ok={erg.ok ? "1" : "0"} style={{ fontSize: 24, fontWeight: 600, color: erg.ok ? "inherit" : "var(--danger, #c0392b)" }}>{laeuft ? "…" : erg.text}</div>}
      {a && (
        <div className="card card-pad" data-testid="scanner-artikel" style={{ fontSize: 20 }}>
          <div style={{ fontWeight: 700 }}>{a.titel ?? a.asin ?? a.sku}</div>
          <div className="small muted">SKU {a.sku} · FNSKU {a.fnsku ?? "–"} · ASIN {a.asin ?? "–"}{a.ean ? ` · EAN ${a.ean}` : ""}</div>
          <div className="row" style={{ gap: 24, marginTop: 8, flexWrap: "wrap" }}>
            <span>Eigenes Lager: <b data-testid="scanner-bestand">{a.eigenesLager}</b>{a.fach ? ` (Fach ${a.fach})` : ""}</span>
            <span>FBA: <b>{a.fba}</b></span>
            <span>Offene Sendung: <b>{a.sendung ?? "–"}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
