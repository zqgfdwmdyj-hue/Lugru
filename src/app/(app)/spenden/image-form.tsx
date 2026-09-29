"use client";

import { useRef, useState, useTransition } from "react";

const MAX_SIDE = 1600;

/** Verkleinert Handyfotos vor dem Hochladen (lange Seite max. 1600 px, JPEG). */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    if (!blob || (blob.size >= file.size && file.type === "image/jpeg")) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Formular mit Foto-Feldern: Bilder werden im Browser verkleinert und dann an die Server-Aktion
 * geschickt. Nach dem Absenden wird das Formular geleert.
 */
export function ImageForm({ action, children, className, style, busyLabel = "Lade hoch …", reset = true }: {
  action: (fd: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  busyLabel?: string;
  reset?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState("");
  return (
    <form
      ref={ref}
      className={className}
      style={style}
      aria-busy={pending}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const raw = new FormData(form, submitter);
        const out = new FormData();
        const entries = [...raw.entries()];
        const fileCount = entries.filter(([, v]) => v instanceof File && v.size > 0).length;
        let done = 0;
        for (const [k, v] of entries) {
          if (v instanceof File) {
            if (!v.size) continue;
            setProgress(fileCount > 1 ? `Bereite Fotos vor … ${++done}/${fileCount}` : "Bereite Foto vor …");
            out.append(k, await shrink(v));
          } else out.append(k, v);
        }
        setProgress("");
        start(async () => {
          await action(out);
          if (reset) ref.current?.reset();
        });
      }}
    >
      <fieldset disabled={pending || !!progress} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
        {children}
      </fieldset>
      {(pending || progress) && <div className="notice notice-info">{progress || busyLabel}</div>}
    </form>
  );
}
