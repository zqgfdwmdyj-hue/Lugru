"use client";

import { useRef, useState } from "react";

// Ablagefläche für PDFs: Datei hineinziehen (Drag-and-Drop) oder auswählen.

export function PdfAblage() {
  const eingabe = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [drueber, setDrueber] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrueber(true);
      }}
      onDragLeave={() => setDrueber(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrueber(false);
        const f = e.dataTransfer.files?.[0];
        if (f && eingabe.current) {
          const dt = new DataTransfer();
          dt.items.add(f);
          eingabe.current.files = dt.files;
          setName(f.name);
        }
      }}
      style={{ border: `2px dashed ${drueber ? "var(--accent, #0e6b5f)" : "var(--border, #ccc)"}`, borderRadius: 10, padding: 24, textAlign: "center" }}
      data-testid="pdf-ablage"
    >
      <div>{name ? `📄 ${name}` : "PDF hierher ziehen oder auswählen"}</div>
      <input ref={eingabe} type="file" name="datei" accept="application/pdf,.pdf" onChange={(e) => setName(e.target.files?.[0]?.name ?? null)} data-testid="pdf-datei" style={{ marginTop: 8 }} />
    </div>
  );
}
