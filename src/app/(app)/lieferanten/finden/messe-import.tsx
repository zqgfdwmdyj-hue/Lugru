"use client";

import { useEffect, useState } from "react";
import { fairDataAction } from "./actions";

export function MesseBookmark({ href }: { href: string }) {
  // React setzt javascript:-Links nicht über Props.
  const ref = (el: HTMLAnchorElement | null) => el?.setAttribute("href", href);
  return (
    <a ref={ref} className="btn btn-small" draggable onClick={(e) => e.preventDefault()} title="In die Lesezeichenleiste ziehen – nicht klicken" data-testid="messe-bookmark">
      → Seller-System Messe
    </a>
  );
}

/**
 * Nimmt die Ausstellerliste vom Lesezeichen entgegen (die Messeseite kann jede Adresse haben).
 * Deshalb kein automatisches Übernehmen – erst nach Klick auf „Aussteller übernehmen“.
 */
export function MesseReceiver() {
  const [data, setData] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string" || !e.data.startsWith('{"messeImport":1')) return;
      (e.source as Window | null)?.postMessage("sellersys-ok", e.origin);
      setData(e.data);
      setFrom(new URL(e.origin).hostname);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <form action={fairDataAction} onSubmit={() => setPending(true)} className="stack" style={{ gap: 8 }} data-testid="messe-receiver">
      {from && <div className="notice notice-info small" data-testid="messe-received">Ausstellerliste von <strong>{from}</strong> empfangen ({Math.round(data.length / 1000)} k Zeichen). Prüfen und übernehmen:</div>}
      <label className="label" htmlFor="messe-data">{from ? "Empfangene Daten" : "Oder: Ausstellerliste einfügen (auf der Messeseite Strg+A, Strg+C)"}</label>
      <textarea className="textarea" id="messe-data" name="data" value={data} onChange={(e) => { setData(e.target.value); setFrom(null); }} placeholder="Strg+V" style={{ fontSize: 12, minHeight: 56, height: 64 }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" name="fair" placeholder="Messe, z. B. Ambiente 2027" style={{ maxWidth: 220 }} aria-label="Messe" />
        <input className="input" name="categories" placeholder="nur Kategorien (optional)" style={{ maxWidth: 220 }} aria-label="Kategorien" />
        <button className="btn btn-primary" type="submit" disabled={pending || data.trim().length < 40}>{pending ? "Übernehme …" : "Aussteller übernehmen"}</button>
      </div>
    </form>
  );
}
