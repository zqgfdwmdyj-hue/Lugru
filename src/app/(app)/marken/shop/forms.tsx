"use client";

import { useActionState } from "react";
import { addProductAction, listingAction, refreshAction, tiktokImportAction, type ShopState } from "./actions";

const Notice = ({ s }: { s: ShopState }) => (s ? <div className={`notice small ${s.ok ? "notice-ok" : "notice-warn"}`}>{s.message}</div> : null);

export function AddProduct({ brandId }: { brandId: string }) {
  const [s, a, p] = useActionState<ShopState, FormData>(addProductAction, null);
  return (
    <form action={a} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="brandId" value={brandId} />
      <textarea className="textarea" name="asins" placeholder={"ASINs oder Amazon-Links (auch amzn.eu), mehrere möglich"} style={{ minHeight: 60 }} />
      <div><button className="btn btn-small" type="submit" disabled={p}>{p ? "Hole Daten …" : "Eigene Produkte hinzufügen"}</button></div>
      <Notice s={s} />
    </form>
  );
}

export function RefreshButton() {
  const [s, a, p] = useActionState<ShopState, FormData>(refreshAction, null);
  return (
    <form action={a} className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
      <button className="btn" type="submit" disabled={p}>{p ? "Aktualisiere …" : "Keepa-Daten jetzt aktualisieren"}</button>
      <Notice s={s} />
    </form>
  );
}

export function ListingButton({ id, again }: { id: string; again: boolean }) {
  const [s, a, p] = useActionState<ShopState, FormData>(listingAction, null);
  return (
    <form action={a} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={id} />
      <div><button className="btn btn-small" type="submit" disabled={p}>{p ? "Schreibt Vorschlag …" : again ? "KI: neuen Listing-Vorschlag" : "KI: Listing verbessern"}</button></div>
      {s && !s.ok && <Notice s={s} />}
    </form>
  );
}

export function TikTokImport({ brandId }: { brandId: string }) {
  const [s, a, p] = useActionState<ShopState, FormData>(tiktokImportAction, null);
  return (
    <form action={a} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="brandId" value={brandId} />
      <input className="input" type="file" name="file" accept=".csv,.xlsx,.xls" required />
      <div><button className="btn btn-small" type="submit" disabled={p}>{p ? "Lese …" : "TikTok-Export übernehmen"}</button></div>
      <Notice s={s} />
    </form>
  );
}
