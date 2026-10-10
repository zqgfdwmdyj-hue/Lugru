"use client";

import { useEffect, useRef, useState } from "react";
import { cleanReport, ROLE_LABEL, type CleanResult } from "@/lib/purchasing/beschaffungsanalyse";

type Item = { name: string; result?: CleanResult; error?: string };
const KEY = "beschaffungsanalyse.adresse";

/** Datei lesen – Amazon liefert UTF-8; falls doch Windows-1252, zweiter Versuch. */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

const outName = (name: string) => `${name.replace(/\.(csv|txt)$/i, "")}_bereinigt.csv`;

export function Cleaner() {
  const input = useRef<HTMLInputElement>(null);
  const [terms, setTerms] = useState("Bremerhaven");
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const files = useRef<File[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setTerms(saved);
    } catch {}
    try {
      setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [new File(["x"], "x.csv", { type: "text/csv" })] }));
    } catch {}
  }, []);

  const run = async (list: File[], t = terms) => {
    files.current = list;
    const words = t.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    setItems(
      await Promise.all(
        list.map(async (f): Promise<Item> => {
          if (/\.xlsx?$/i.test(f.name)) return { name: f.name, error: "Excel-Datei – bitte den Bericht in Amazon als CSV herunterladen." };
          try {
            return { name: f.name, result: cleanReport(await readText(f), words) };
          } catch (e) {
            return { name: f.name, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      ),
    );
  };
  const saveTerms = (v: string) => {
    setTerms(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {}
    if (files.current.length) void run(files.current, v);
  };
  const download = (it: Item) => {
    const url = URL.createObjectURL(new Blob([it.result!.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = outName(it.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const share = async (it: Item) => {
    try {
      await navigator.share({ files: [new File([it.result!.csv], outName(it.name), { type: "text/csv" })], title: outName(it.name) });
    } catch {}
  };

  return (
    <section className="card card-pad stack" style={{ gap: 10 }} data-testid="ba-cleaner">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void run([...e.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Bericht auswählen"
        style={{ border: `2px dashed ${over ? "var(--accent)" : "var(--border)"}`, borderRadius: 10, padding: 18, textAlign: "center", cursor: "pointer" }}
      >
        <div><strong>Bericht „Sendungen“ (CSV)</strong> hierher ziehen oder antippen</div>
        <div className="small muted">mehrere Länder auf einmal möglich – je Datei kommt eine bereinigte Datei heraus</div>
      </div>
      <input ref={input} type="file" multiple accept=".csv,.txt,text/csv" style={{ display: "none" }} data-testid="ba-file" onChange={(e) => e.target.files && void run([...e.target.files])} />
      <div className="field" style={{ maxWidth: 420 }}>
        <label className="label" htmlFor="ba-terms">Ankauf-Adresse enthält (mehrere mit Komma)</label>
        <input className="input" id="ba-terms" value={terms} onChange={(e) => saveTerms(e.target.value)} placeholder="z. B. Bremerhaven, 27568" />
      </div>

      {items.map((it, i) => (
        <div key={i} className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }} data-testid="ba-result">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <strong className="small" style={{ overflowWrap: "anywhere" }}>{it.name}</strong>
            {it.result && it.result.kept > 0 && (
              <div style={{ display: "flex", gap: 6 }}>
                {canShare && <button type="button" className="btn btn-small btn-primary" onClick={() => void share(it)}>Teilen (Discord)</button>}
                <button type="button" className={`btn btn-small${canShare ? "" : " btn-primary"}`} onClick={() => download(it)} data-testid="ba-download">Herunterladen</button>
              </div>
            )}
          </div>
          {it.error && <div className="notice notice-error small">{it.error}</div>}
          {it.result && (
            <>
              <div className="small" data-testid="ba-summary">
                {it.result.language ? `Bericht ${it.result.language}` : "Sprache nicht erkannt"} · {it.result.total} Zeilen · <strong>{it.result.kept} an die Ankauf-Adresse</strong> · {it.result.removed} andere entfernt
                {it.result.withoutTracking > 0 && <span className="muted"> · {it.result.withoutTracking} noch ohne Sendungsnummer (z. B. storniert/unterwegs)</span>}
              </div>
              {it.result.missing.length > 0 && (
                <div className="notice notice-warn small">Im Bericht fehlen Pflichtspalten: {it.result.missing.map((m) => ROLE_LABEL[m]).join(", ")} – in Amazon Business in der Spaltenauswahl ergänzen{it.result.missing.includes("address") ? " (ohne Versandadresse kann nichts bereinigt werden)" : ""}.</div>
              )}
              {it.result.kept === 0 && !it.result.missing.includes("address") && <div className="notice notice-warn small">Keine Bestellung an „{terms}“ gefunden – Adresse oben prüfen.</div>}
              {it.result.kept > 0 && (
                <div style={{ overflow: "auto", maxHeight: 320 }}>
                  <table className="table">
                    <thead><tr><th>Bestellnummer</th><th>Sendung</th><th>Datum</th><th className="right">Menge</th><th>ASIN</th><th>Titel</th></tr></thead>
                    <tbody>
                      {it.result.preview.map((p, j) => (
                        <tr key={j}>
                          <td className="num small">{p.order}</td>
                          <td className="num small">{p.tracking || <span className="muted">–</span>}</td>
                          <td className="num small">{p.date}</td>
                          <td className="num right small">{p.qty}</td>
                          <td className="num small">{p.asin}</td>
                          <td className="small" style={{ minWidth: 180 }}>{p.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
