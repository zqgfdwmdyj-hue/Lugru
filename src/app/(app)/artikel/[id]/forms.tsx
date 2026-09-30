"use client";

import { useActionState, type ReactNode } from "react";
import { amazonAction, ebayAction, ebayCategoriesAction, generateTextsAction, productTypesAction, saveArticleAction, setEbayCategoryAction, setProductTypeAction, uploadImagesAction, type ArticleState } from "../actions";

function Notice({ state }: { state: ArticleState }) {
  if (!state) return null;
  return (
    <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"} small`}>
      {state.message}
      {state.link && <> – <a href={state.link}>öffnen</a></>}
    </div>
  );
}

export function SaveForm({ id, children }: { id: string; children: ReactNode }) {
  const [state, action, pending] = useActionState<ArticleState, FormData>(saveArticleAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <input type="hidden" name="id" value={id} />
      {children}
      <div className="save-bar" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0", display: "flex", gap: 10, alignItems: "center", borderTop: "1px solid var(--border)" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Speichere …" : "Artikel speichern"}</button>
        <Notice state={state} />
      </div>
    </form>
  );
}

export function ImageUpload({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ArticleState, FormData>(uploadImagesAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <input className="input" type="file" name="images" multiple accept="image/jpeg,image/png,image/webp" aria-label="Bilder" />
      <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Lade hoch …" : "Bilder hochladen"}</button>
      <Notice state={state} />
    </form>
  );
}

export function AiTextsButton({ id, hasAi }: { id: string; hasAi: boolean }) {
  const [state, action, pending] = useActionState<ArticleState, FormData>(generateTextsAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-small" type="submit" disabled={pending || !hasAi} title={hasAi ? "" : "KI-Schlüssel fehlt (Anbindungen → KI)"}>{pending ? "Schreibe …" : "KI: Titel, Stichpunkte & Beschreibung schreiben"}</button>
      <Notice state={state} />
    </form>
  );
}

/** Suche mit Auswahlliste (Amazon-Produkttyp, eBay-Kategorie). */
export function OptionSearch({ id, kind, placeholder }: { id: string; kind: "producttype" | "ebaycat"; placeholder: string }) {
  const [state, action, pending] = useActionState<ArticleState, FormData>(kind === "producttype" ? productTypesAction : ebayCategoriesAction, null);
  const setAction = kind === "producttype" ? setProductTypeAction : setEbayCategoryAction;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <form action={action} style={{ display: "flex", gap: 6 }}>
        <input type="hidden" name="id" value={id} />
        <input className="input" name="q" placeholder={placeholder} style={{ flex: 1 }} />
        <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Suche …" : "Vorschläge"}</button>
      </form>
      {state && !state.options?.length && <Notice state={state} />}
      {state?.options?.map((o) => (
        <form key={o.id} action={setAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name={kind === "producttype" ? "productType" : "categoryId"} value={o.id} />
          <input type="hidden" name="categoryName" value={o.name} />
          <button className="btn-link small" type="submit" style={{ textAlign: "left" }}>{o.name}{kind === "ebaycat" ? ` (${o.id})` : ""}</button>
        </form>
      ))}
    </div>
  );
}

export function AmazonButtons({ id, ready }: { id: string; ready: boolean }) {
  const [state, action, pending] = useActionState<ArticleState, FormData>(amazonAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-small" type="submit" name="op" value="pruefen" disabled={pending}>Mit Amazon prüfen</button>
        <button className="btn btn-small btn-primary" type="submit" name="op" value="senden" disabled={pending || !ready} title={ready ? "" : "Erst prüfen – ohne Fehler"}>An Amazon senden</button>
        <button className="btn btn-small" type="submit" name="op" value="status" disabled={pending}>Status abrufen</button>
      </div>
      {pending && <div className="small muted">Amazon antwortet …</div>}
      <Notice state={state} />
    </form>
  );
}

export function EbayButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<ArticleState, FormData>(ebayAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-small btn-primary" type="submit" disabled={pending || disabled}>{pending ? "Lade Bilder zu eBay …" : "Als Entwurf ins eBay-Tool"}</button>
      <Notice state={state} />
    </form>
  );
}
