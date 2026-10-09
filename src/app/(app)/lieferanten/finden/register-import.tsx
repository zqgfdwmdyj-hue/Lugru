"use client";

import { useEffect, useRef, useState } from "react";
import { importRegisterDataAction } from "./actions";

export function RegisterBookmark({ href }: { href: string }) {
  // React setzt javascript:-Links nicht über Props.
  const ref = (el: HTMLAnchorElement | null) => el?.setAttribute("href", href);
  return (
    <a ref={ref} className="btn btn-small" draggable onClick={(e) => e.preventDefault()} title="In die Lesezeichenleiste ziehen – nicht klicken" data-testid="register-bookmark">
      → Seller-System Register
    </a>
  );
}

/** Nimmt die Daten vom Register-Lesezeichen entgegen (aus dem anderen Tab oder per Einfügen). */
export function RegisterReceiver({ allowedOrigin }: { allowedOrigin: string }) {
  const [data, setData] = useState("");
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const sent = useRef(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== allowedOrigin) return;
      if (typeof e.data !== "string" || !e.data.startsWith('{"lucidImport":1')) return;
      (e.source as Window | null)?.postMessage("sellersys-ok", e.origin);
      if (sent.current) return;
      sent.current = true;
      setData(e.data);
      setTimeout(() => form.current?.requestSubmit(), 50);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [allowedOrigin]);

  return (
    <form ref={form} action={importRegisterDataAction} onSubmit={() => setPending(true)} className="stack" style={{ gap: 8 }} data-testid="register-receiver">
      <label className="label" htmlFor="reg-data">Daten einfügen (falls sie nicht von selbst kommen)</label>
      <textarea className="textarea" id="reg-data" name="data" rows={3} value={data} onChange={(e) => setData(e.target.value)} placeholder="Strg+V – Daten vom Lesezeichen" style={{ fontSize: 12, minHeight: 56, height: 64 }} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" name="onlyActive" value="on" defaultChecked /> nur aktive Registrierungen
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending || !data.trim()}>{pending ? "Übernehme …" : "Übernehmen"}</button>
      </div>
    </form>
  );
}
