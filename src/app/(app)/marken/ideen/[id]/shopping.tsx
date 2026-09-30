"use client";

import { useActionState, useState } from "react";
import { purchaseIdeaAction, type BrandState } from "../../actions";

/** Alle Produktseiten öffnen und Liste kopieren – im Browser des Nutzers. */
export function ShoppingTools({ urls, text }: { urls: string[]; text: string }) {
  const [copied, setCopied] = useState(false);
  const openAll = () => {
    // Nur der erste Tab ist sicher erlaubt; weitere blockt Chrome ggf. – dann Pop-ups für diese Seite erlauben.
    for (const u of urls) window.open(u, "_blank", "noopener");
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
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {urls.length > 0 && <button type="button" className="btn btn-small" onClick={openAll}>Alle {urls.length} Produktseiten öffnen</button>}
      <button type="button" className="btn btn-small" onClick={copy}>{copied ? "Liste kopiert ✓" : "Einkaufsliste kopieren"}</button>
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
