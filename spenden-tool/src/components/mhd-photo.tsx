"use client";

import { useRef, useState } from "react";
import type { MhdState } from "@/app/(app)/actions";
import { shrink } from "./image-form";

/** Knopf „MHD-Foto“ in einer Zeile: Foto vom aufgedruckten Datum, wird abgelesen und eingetragen. */
export function MhdPhoto({ itemId, fileId, action }: { itemId: string; fileId: string | null; action: (fd: FormData) => Promise<MhdState> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<MhdState>(null);
  const current = state?.fileId ?? fileId;
  return (
    <div className="small" style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setState(null);
          const fd = new FormData();
          fd.set("photo", await shrink(f));
          try {
            const res = await action(fd);
            setState(res);
            // Erkanntes Datum sofort ins Feld der Zeile schreiben
            const field = document.querySelector<HTMLInputElement>(`input[name="mhd_${itemId}"]`);
            if (res?.date && field) field.value = res.date;
          } catch {
            setState({ ok: false, message: "Hochladen fehlgeschlagen – bitte erneut versuchen." });
          }
          setBusy(false);
        }}
      />
      <button className="btn-link small" type="button" disabled={busy} onClick={() => input.current?.click()} title="Foto vom aufgedruckten MHD – wird nicht auf der Collage gezeigt">
        {busy ? "lese MHD …" : current ? "📷 MHD neu" : "📷 MHD-Foto"}
      </button>
      {current && (
        <a href={`/datei/${current}`} target="_blank" rel="noreferrer" title="MHD-Foto ansehen">
          <img src={`/datei/${current}`} alt="MHD-Foto" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4, verticalAlign: "middle" }} />
        </a>
      )}
      {state && <span style={{ color: state.ok ? "var(--ok)" : "var(--warn)", flexBasis: "100%" }}>{state.message}</span>}
    </div>
  );
}
