"use client";

import { useRef, useState, useTransition } from "react";
import { shrink } from "./image-form";

/**
 * Großer Knopf „Fotos hinzufügen“: öffnet am Handy direkt Kamera oder Fotomediathek,
 * lädt die ausgewählten Fotos sofort hoch (vorher verkleinert).
 */
export function QuickPhotos({ eventId, action }: { eventId: string; action: (fd: FormData) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [pending, start] = useTransition();
  const busy = pending || !!status;
  return (
    <div className="quick-photos-wrap">
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
          const fd = new FormData();
          fd.set("eventId", eventId);
          fd.set("category", "Lebensmittel");
          for (let i = 0; i < files.length; i++) {
            setStatus(`Bereite Fotos vor … ${i + 1}/${files.length}`);
            fd.append("photos", await shrink(files[i]));
          }
          setStatus("");
          start(() => action(fd));
        }}
      />
      <button className="btn btn-primary quick-photos" type="button" disabled={busy} onClick={() => input.current?.click()}>
        📷 {busy ? status || "Lade hoch …" : "Fotos hinzufügen"}
      </button>
    </div>
  );
}
