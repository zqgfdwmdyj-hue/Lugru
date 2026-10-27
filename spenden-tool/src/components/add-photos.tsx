"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addProductPhotos } from "@/app/(app)/actions";
import { shrink } from "./image-form";

/**
 * „Weitere Fotos“ für ein vorhandenes Produkt (Rückseite, Zutaten, MHD …): werden Infofotos – kein neuer Artikel.
 */
export function AddPhotos({ productId, label = "📷 Weitere Fotos hinzufügen" }: { productId: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [status, setStatus] = useState("");
  return (
    <span className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          let added = 0;
          let skipped = 0;
          try {
            for (let i = 0; i < files.length; i += 4) {
              setStatus(`Lade Foto ${i + 1}–${Math.min(i + 4, files.length)} von ${files.length} …`);
              const fd = new FormData();
              for (const f of files.slice(i, i + 4)) fd.append("photos", await shrink(f));
              const r = await addProductPhotos(productId, fd);
              added += r.added;
              skipped += r.skipped;
            }
            setStatus(`${added} Foto(s) hinzugefügt${skipped ? `, ${skipped} übersprungen (schon vorhanden oder nicht lesbar)` : ""}.`);
            router.refresh();
          } catch {
            setStatus("Hochladen fehlgeschlagen – bitte erneut versuchen.");
          }
        }}
      />
      <button type="button" className="btn btn-small" onClick={() => input.current?.click()} title="Rückseite, Zutaten, MHD … – wird kein neuer Artikel">{label}</button>
      {status && <span className="muted">{status}</span>}
    </span>
  );
}
