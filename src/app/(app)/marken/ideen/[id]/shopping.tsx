"use client";

import { useActionState, useState } from "react";
import { purchaseIdeaAction, type BrandState } from "../../actions";

/** Alle Produktseiten öffnen und Liste kopieren – im Browser des Nutzers. */
export function ShoppingTools({ urls, text }: { urls: string[]; text: string }) {
  const [copied, setCopied] = useState(false);
  const [next, setNext] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const open = (u: string) => {
    const w = window.open(u, "_blank");
    if (w) w.opener = null;
    return Boolean(w);
  };
  const openAll = () => {
    // Chrome erlaubt pro Klick meist nur einen neuen Tab – blockierte zählen, dann Schritt für Schritt weiter.
    let opened = 0;
    for (const u of urls) {
      if (!open(u)) break;
      opened++;
    }
    setNext(opened);
    setBlocked(opened < urls.length);
  };
  const openNext = () => {
    if (next < urls.length && open(urls[next])) setNext(next + 1);
  };
  const copy = async () => {
    const ok = await navigator.clipboard?.writeText(text).then(() => true, () => false);
    if (!ok) {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {urls.length > 0 && <button type="button" className="btn btn-small" onClick={openAll}>Alle {urls.length} Produktseiten öffnen</button>}
        {blocked && next < urls.length && (
          <button type="button" className="btn btn-small btn-primary" onClick={openNext}>Nächste öffnen ({next + 1}/{urls.length})</button>
        )}
        <button type="button" className="btn btn-small" onClick={copy}>{copied ? "Liste kopiert ✓" : "Einkaufsliste kopieren"}</button>
      </div>
      {blocked && next < urls.length && (
        <div className="small muted" style={{ maxWidth: 520 }}>
          Chrome hat weitere Tabs blockiert ({next} von {urls.length} geöffnet). Entweder „Nächste öffnen“ weiterklicken – oder einmalig Pop-ups erlauben: rechts in der Adressleiste auf das Symbol mit dem roten Kreuz → „Pop-ups und Weiterleitungen … immer zulassen“ → Fertig, dann „Alle öffnen“ nochmal.
        </div>
      )}
      {blocked && next >= urls.length && <div className="small muted">Alle {urls.length} Seiten geöffnet.</div>}
    </div>
  );
}

export function PurchaseButton({ id, boxes }: { id: string; boxes: number }) {
  const [state, action, pending] = useActionState<BrandState, FormData>(purchaseIdeaAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="boxes" value={boxes} />
      <button className="btn btn-primary btn-small" type="submit" disabled={pending}>{pending ? "Lege an …" : `Als Einkauf anlegen (${boxes} Boxen)`}</button>
      {state && !state.ok && <div className="notice notice-warn small">{state.message}</div>}
    </form>
  );
}
