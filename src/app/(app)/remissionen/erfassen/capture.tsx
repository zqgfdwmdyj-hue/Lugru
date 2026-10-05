"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { importScAction, type ScImportState } from "../actions";

const ALLOWED = /^https:\/\/sellercentral(-europe|-japan)?\.amazon\.[a-z.]+$/;

export function ScBookmark({ href }: { href: string }) {
  // React setzt javascript:-Links nicht über Props.
  const ref = (el: HTMLAnchorElement | null) => el?.setAttribute("href", href);
  return (
    <a ref={ref} className="btn btn-small" draggable onClick={(e) => e.preventDefault()} title="In die Lesezeichenleiste ziehen – nicht klicken">
      → Seller-System Remissionen
    </a>
  );
}

export function ScCapture() {
  const [state, action, pending] = useActionState<ScImportState, FormData>(importScAction, null);
  const [data, setData] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const sent = useRef(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const devOk = process.env.NODE_ENV !== "production" && /^http:\/\/localhost(:\d+)?$/.test(e.origin);
      if (!ALLOWED.test(e.origin) && !devOk) return;
      if (typeof e.data !== "string" || !e.data.startsWith('{"scRemoval":1')) return;
      (e.source as Window | null)?.postMessage("sellersys-ok", e.origin);
      if (sent.current) return;
      sent.current = true;
      setData(e.data);
      setTimeout(() => form.current?.requestSubmit(), 50);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const r = state?.result;
  return (
    <form ref={form} action={action} className="card card-pad stack" style={{ gap: 10 }}>
      <h2>Erfasste Daten</h2>
      <textarea className="textarea" name="data" rows={5} value={data} onChange={(e) => setData(e.target.value)} placeholder="Hier einfügen (Strg+V) – Daten vom Lesezeichen oder kopierte Auftragsseite" style={{ fontSize: 12, minHeight: 100 }} />
      <button className="btn btn-primary" type="submit" disabled={pending || !data.trim()}>{pending ? "Lese Pakete …" : "Übernehmen und Ansprüche prüfen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`} data-testid="sc-result">{state.message}</div>}
      {r && r.withoutPackages.length > 0 && (
        <div className="small">
          <strong>{r.withoutPackages.length} Seite(n) ohne Paketdaten</strong> – bitte einzeln öffnen, „Alle versendeten Einheiten anzeigen“ wählen und das Lesezeichen dort klicken:
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {r.withoutPackages.slice(0, 30).map((w, i) => (
              <li key={i}>{w.url ? <a href={w.url} target="_blank" rel="noreferrer">{w.orderId ?? w.url}</a> : (w.orderId ?? "eingefügter Text")}</li>
            ))}
          </ul>
        </div>
      )}
      {state?.ok && <Link className="btn" href="/remissionen#haengend">Zu den hängenden Sendungen</Link>}
    </form>
  );
}
