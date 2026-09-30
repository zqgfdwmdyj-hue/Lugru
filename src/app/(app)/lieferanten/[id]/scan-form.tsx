"use client";

import { useActionState, useState } from "react";
import { bookmarkletHref } from "@/lib/suppliers/scan";
import { keepaFeedAction, scanFeedAction, type ScanState } from "../actions";

type Mode = "link" | "einfuegen" | "datei";

export function ScanForm({ feedId, usdRate, hasAi }: { feedId: string; usdRate: number | null; hasAi: boolean }) {
  const [state, action, pending] = useActionState<ScanState, FormData>(scanFeedAction, null);
  const [mode, setMode] = useState<Mode>("einfuegen");
  const [copied, setCopied] = useState(false);
  // React setzt javascript:-Links nicht über Props – deshalb direkt am Element, bei jedem Einblenden neu
  // (der Kasten wird beim Wechsel der Reiter neu aufgebaut).
  const bookmarkRef = (el: HTMLAnchorElement | null) => el?.setAttribute("href", bookmarkletHref());
  const copyCode = async () => {
    const code = bookmarkletHref();
    // Über http (ohne https) gibt es navigator.clipboard nicht – dann der alte Weg.
    const ok = await navigator.clipboard?.writeText(code).then(() => true, () => false);
    if (!ok) {
      const t = document.createElement("textarea");
      t.value = code;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
  };

  return (
    <form action={action} className="card card-pad stack" style={{ gap: 10 }}>
      <input type="hidden" name="feedId" value={feedId} />
      <h2>Seite oder Liste scannen</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            ["einfuegen", "Einfügen"],
            ["link", "Link"],
            ["datei", "Foto / PDF"],
          ] as const
        ).map(([m, l]) => (
          <button key={m} type="button" className={`chip${mode === m ? " active" : ""}`} onClick={() => setMode(m)}>{l}</button>
        ))}
      </div>

      {mode === "einfuegen" && (
        <>
          <details className="small" open>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Shops mit Bot-Schutz (z. B. CandyHero): Lesezeichen einrichten – einmalig</summary>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Lesezeichenleiste einblenden: <kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>B</kbd></li>
              <li>
                Diesen Knopf mit gedrückter Maustaste in die Leiste <strong>ziehen</strong>:{" "}
                <a ref={bookmarkRef} className="btn btn-small" draggable onClick={(e) => e.preventDefault()} title="In die Lesezeichenleiste ziehen – nicht klicken">→ Seller-System</a>
              </li>
              <li>
                Klappt das Ziehen nicht: <button type="button" className="btn btn-small" onClick={copyCode}>{copied ? "Code kopiert ✓" : "Code kopieren"}</button> → Rechtsklick auf die Lesezeichenleiste → „Seite hinzufügen …“ → Name „→ Seller-System“, bei URL den Code einfügen → Speichern.
              </li>
            </ol>
            <div className="muted" style={{ marginTop: 6 }}>
              Benutzen: im Shop eine Kategorie- oder Produktseite öffnen → Lesezeichen in der Leiste anklicken → Meldung „… Produkte erfasst und kopiert“ → hier einfügen (Strg+V) → „Scannen und übernehmen“.
              Alternativ Seite markieren (Strg+A), kopieren (Strg+C) und einfügen{hasAi ? "" : " (braucht den KI-Schlüssel)"}.
            </div>
          </details>
          <textarea className="textarea" name="text" rows={4} placeholder="Hier einfügen (Strg+V) …" style={{ fontSize: 12, minHeight: 90 }} />
        </>
      )}
      {mode === "link" && (
        <>
          <input className="input" name="url" type="url" placeholder="https://shop.example.com/collections/…" />
          <div className="small muted">Klappt bei Shops ohne Bot-Schutz; Shopify-Shops liefern den ganzen Katalog mit Barcodes.</div>
        </>
      )}
      {mode === "datei" && (
        <>
          <input className="input" name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" aria-label="Foto oder PDF" />
          <div className="small muted">Preisliste, Rechnung, Katalogseite oder Screenshot – die KI liest Artikel, UPC/EAN, Preise.{hasAi ? "" : " Braucht den KI-Schlüssel (Anbindungen → KI)."}</div>
        </>
      )}

      <div className="field">
        <label className="label" htmlFor="usd">Kurs: 1 US-$ = … €</label>
        <input className="input" id="usd" name="usdRate" inputMode="decimal" defaultValue={usdRate ? usdRate.toFixed(4).replace(".", ",") : ""} placeholder="z. B. 0,92" style={{ maxWidth: 140 }} />
        <span className="small muted">Tageskurs der EZB, änderbar. Dollar-Preise werden damit in € umgerechnet.</span>
      </div>
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Lese … (bei KI bis 1–2 Minuten)" : "Scannen und übernehmen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </form>
  );
}

export function KeepaCheck({ feedId, hasKeepa, withEan, withoutEan }: { feedId: string; hasKeepa: boolean; withEan: number; withoutEan: number }) {
  const [state, action, pending] = useActionState<ScanState, FormData>(keepaFeedAction, null);
  return (
    <form action={action} className="card card-pad stack" style={{ gap: 8 }}>
      <input type="hidden" name="feedId" value={feedId} />
      <h2>Lohnt sich das auf Amazon?</h2>
      <div className="small muted">
        Sucht die {withEan} Artikel mit EAN/UPC auf amazon.de (Keepa, 1 Token je Artikel) und rechnet Gewinn nach Provision und FBA-Gebühr.
        {!hasKeepa && " Dafür unter Anbindungen → Keepa den Schlüssel eintragen."}
      </div>
      {withoutEan > 0 && (
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <input type="checkbox" name="byTitle" defaultChecked={!withEan} />
          <span>Auch die {withoutEan} ohne EAN per Titel suchen (je ca. 10 Tokens, max. 20 pro Durchgang – Treffer bitte gegenprüfen)</span>
        </label>
      )}
      <button className="btn" type="submit" disabled={pending || !hasKeepa || !(withEan || withoutEan)}>{pending ? "Prüfe …" : "Mit Keepa prüfen"}</button>
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </form>
  );
}
