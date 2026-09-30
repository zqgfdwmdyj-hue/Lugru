"use client";

import { useActionState, useState } from "react";
import { marketHelium10Action, marketKeepaAction, saveBrandAction, saveIdeaAction, suggestContentAction, suggestIdeasAction, type BrandState } from "./actions";

function Notice({ state }: { state: BrandState }) {
  if (!state) return null;
  return <div className={`notice small ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>;
}

export function SuggestIdeas({ brandId, occasion, label = "KI: 5 Ideen vorschlagen", withWish = false }: { brandId: string; occasion?: string; label?: string; withWish?: boolean }) {
  const [state, action, pending] = useActionState<BrandState, FormData>(suggestIdeasAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="brandId" value={brandId} />
      {occasion && <input type="hidden" name="occasion" value={occasion} />}
      {withWish && <textarea className="textarea" name="wish" placeholder="Optional: Wunsch oder Richtung, z. B. „Box unter 25 €“, „Mystery-Box“, „Uhrenetui aus Leder für 3 Uhren“" style={{ minHeight: 60 }} />}
      <div><button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Sucht Trends und denkt nach … (bis 1 Min.)" : label}</button></div>
      <Notice state={state} />
    </form>
  );
}

export function SuggestContent({ brandId, ideaId, withTopic = false }: { brandId: string; ideaId?: string; withTopic?: boolean }) {
  const [state, action, pending] = useActionState<BrandState, FormData>(suggestContentAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="brandId" value={brandId} />
      {ideaId && <input type="hidden" name="ideaId" value={ideaId} />}
      {withTopic && <input className="input" name="topic" placeholder="Thema, z. B. „Takis-Geschmackstest“ oder „Uhrenrolle für die Reise“" />}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select className="input" name="platform" defaultValue="tiktok" style={{ width: "auto" }} aria-label="Plattform">
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube / Shorts</option>
          <option value="instagram">Instagram Reels</option>
        </select>
        <button className="btn btn-small" type="submit" disabled={pending}>{pending ? "Schreibt Skripte …" : "KI: Video-Ideen erstellen"}</button>
      </div>
      <Notice state={state} />
    </form>
  );
}

export function CopyButton({ text, label = "Kopieren" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "✓ Kopiert" : label}
    </button>
  );
}

export function SaveForm({ children, kind }: { children: React.ReactNode; kind: "idea" | "brand" }) {
  const [state, action, pending] = useActionState<BrandState, FormData>(kind === "idea" ? saveIdeaAction : saveBrandAction, null);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      {children}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Speichere …" : "Speichern"}</button>
        <Notice state={state} />
      </div>
    </form>
  );
}

export function MarketForms({ ideaId, term }: { ideaId: string; term: string }) {
  const [kState, kAction, kPending] = useActionState<BrandState, FormData>(marketKeepaAction, null);
  const [hState, hAction, hPending] = useActionState<BrandState, FormData>(marketHelium10Action, null);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <form action={kAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input type="hidden" name="id" value={ideaId} />
        <input className="input" name="term" defaultValue={term} placeholder="Suchbegriff wie auf Amazon" style={{ flex: "1 1 240px" }} aria-label="Suchbegriff" />
        <button className="btn btn-small" type="submit" disabled={kPending}>{kPending ? "Frage Keepa …" : "Ähnliche Produkte (Keepa)"}</button>
      </form>
      <Notice state={kState} />
      <details className="small">
        <summary style={{ cursor: "pointer" }}>Oder Helium-10-Export hochladen (Xray → Export)</summary>
        <form action={hAction} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <input type="hidden" name="id" value={ideaId} />
          <input className="input" name="file" type="file" accept=".csv,.xlsx,.xls" required style={{ flex: "1 1 240px" }} />
          <button className="btn btn-small" type="submit" disabled={hPending}>{hPending ? "Lese …" : "Übernehmen"}</button>
        </form>
        <Notice state={hState} />
      </details>
    </div>
  );
}
