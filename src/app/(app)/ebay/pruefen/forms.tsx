"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "./actions";

/** Knopf mit Rückmeldung (z. B. „Angebote laden“, „KI-Vorschlag holen“). */
export function ActionButton({
  action,
  label,
  pending: pendingLabel,
  itemId,
  primary = false,
  testid,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  label: string;
  pending: string;
  itemId?: string;
  primary?: boolean;
  testid?: string;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={dispatch} style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid={testid}>
      {itemId && <input type="hidden" name="itemId" value={itemId} />}
      <button className={`btn ${primary ? "btn-primary" : ""}`} type="submit" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </button>
      {state && (
        <span className="small" role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid={testid ? `${testid}-result` : undefined}>
          {state.message}
        </span>
      )}
    </form>
  );
}

type AspectField = { name: string; required: boolean; values: string[]; selectionOnly: boolean; multi: boolean; suggested: string };

/**
 * „Bei eBay ändern“: Titel (mit Zeichenzähler), fehlende Merkmale, Preis, Preisvorschlag.
 * Vorbelegt mit dem KI-Vorschlag bzw. dem Preisvorschlag – vor dem Senden alles prüfen und anpassen.
 */
export function ReviseForm({
  action,
  itemId,
  title,
  suggestedTitle,
  aspects,
  price,
  suggestedPrice,
  canPrice,
  bestOffer,
  canBestOffer,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  itemId: string;
  title: string;
  suggestedTitle: string | null;
  aspects: AspectField[];
  price: number;
  suggestedPrice: number | null;
  canPrice: boolean;
  bestOffer: boolean;
  canBestOffer: boolean;
}) {
  const [state, dispatch, pending] = useActionState<ActionState, FormData>(action, null);
  const [t, setT] = useState(suggestedTitle ?? title);
  const [p, setP] = useState(price.toFixed(2).replace(".", ","));
  const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
  return (
    <form
      action={dispatch}
      className="stack"
      style={{ gap: 14 }}
      data-testid="revise-form"
      onSubmit={(e) => {
        if (!window.confirm("Die Änderungen jetzt bei eBay übernehmen? Das Angebot wird sofort geändert.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="itemId" value={itemId} />
      <div className="field">
        <label className="label" htmlFor="rv-title">
          Titel <span className="muted small" data-testid="title-count">({t.length}/80)</span>
        </label>
        <input className="input" id="rv-title" name="title" value={t} maxLength={80} onChange={(e) => setT(e.target.value)} autoComplete="off" />
        <div className="small muted" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>Bisher: {title}</span>
          {suggestedTitle && suggestedTitle !== t && (
            <button type="button" className="btn-link small" onClick={() => setT(suggestedTitle)}>KI-Titel einsetzen</button>
          )}
          {t !== title && (
            <button type="button" className="btn-link small" onClick={() => setT(title)}>zurück zum bisherigen</button>
          )}
        </div>
      </div>

      {aspects.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="label">Fehlende Merkmale <span className="muted small">(leer lassen = nicht ändern; mehrere Werte mit ; trennen)</span></div>
          <div className="rev-aspects">
            {aspects.map((a, i) => (
              <div className="field" key={a.name}>
                <label className="label small" htmlFor={`rv-a-${i}`}>
                  {a.name}
                  {a.required ? <span className="tag tag-danger" style={{ marginLeft: 6 }}>Pflicht</span> : null}
                </label>
                <input className="input" id={`rv-a-${i}`} name={`a:${a.name}`} defaultValue={a.suggested} list={a.values.length ? `rv-l-${i}` : undefined} autoComplete="off" placeholder={a.selectionOnly ? "Wert aus der Liste" : ""} />
                {a.values.length > 0 && (
                  <datalist id={`rv-l-${i}`}>
                    {a.values.slice(0, 200).map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rev-aspects">
        {canPrice ? (
          <div className="field">
            <label className="label" htmlFor="rv-price">Preis (ohne Versand)</label>
            <input className="input" id="rv-price" name="price" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
            <div className="small muted">
              Bisher {euro(price)}
              {suggestedPrice !== null && (
                <>
                  {" · "}
                  <button type="button" className="btn-link small" onClick={() => setP(suggestedPrice.toFixed(2).replace(".", ","))} data-testid="use-price">
                    Vorschlag {euro(suggestedPrice)} einsetzen
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="small muted">Preis bei Angeboten mit Varianten bitte je Variante ändern.</div>
        )}
        {canBestOffer && (
          <div className="field">
            <span className="label">Preisvorschlag</span>
            <input type="hidden" name="bestOfferField" value="1" />
            <label className="check">
              <input type="checkbox" name="bestOffer" defaultChecked={bestOffer} /> Käufer dürfen einen Preis vorschlagen
            </label>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Ändere bei eBay …" : "Bei eBay ändern"}
        </button>
        {state && (
          <span className="small" role="status" style={{ color: state.ok ? "var(--ok)" : "var(--danger)" }} data-testid="revise-form-result">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
