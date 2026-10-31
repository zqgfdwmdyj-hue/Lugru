"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addPalletPhotos, type PhotoState } from "./actions";

const MAX_SIDE = 1600;

/** Foto vom Handy verkleinern (JPEG) – schneller hochgeladen, reicht als Nachweis völlig. */
export async function compressPhoto(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Foto nicht lesbar"))), "image/jpeg", 0.8));
    return new File([blob], (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    // Kann der Browser das Bild nicht lesen (z. B. HEIC am PC), geht das Original – der Server prüft den Typ.
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type PickedPhoto = { key: number; url: string; file: File };

/** Fotos aufnehmen oder auswählen, mit Vorschau und Entfernen. */
export function PhotoPicker({ photos, onChange, max = 8 }: { photos: PickedPhoto[]; onChange: (p: PickedPhoto[]) => void; max?: number }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function add(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const next = [...photos];
    for (const f of Array.from(list).slice(0, Math.max(0, max - photos.length))) {
      const file = await compressPhoto(f);
      next.push({ key: Date.now() + Math.random(), url: URL.createObjectURL(file), file });
    }
    onChange(next);
    setBusy(false);
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-small" type="button" onClick={() => camera.current?.click()} disabled={busy || photos.length >= max}>📷 Foto aufnehmen</button>
        <button className="btn btn-small" type="button" onClick={() => gallery.current?.click()} disabled={busy || photos.length >= max}>Aus Galerie</button>
        {busy && <span className="small muted">Foto wird vorbereitet …</span>}
        <input ref={camera} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} data-testid="pal-photo-camera" />
        <input ref={gallery} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} data-testid="pal-photo-file" />
      </div>
      {photos.length > 0 && (
        <div className="pal-thumbs">
          {photos.map((p) => (
            <div key={p.key} className="pal-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="Foto der Palette" />
              <button type="button" aria-label="Foto entfernen" onClick={() => { URL.revokeObjectURL(p.url); onChange(photos.filter((x) => x.key !== p.key)); }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Weitere Fotos zu einer eingelagerten Palette (Detailseite). */
export function AddPhotos({ palletId }: { palletId: string }) {
  const [state, action] = useActionState<PhotoState, FormData>(addPalletPhotos, null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (state?.ok) setPhotos([]);
  }, [state]);
  function save() {
    const fd = new FormData();
    fd.set("palletId", palletId);
    for (const p of photos) fd.append("photos", p.file, p.file.name);
    start(() => action(fd));
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <PhotoPicker photos={photos} onChange={setPhotos} />
      {photos.length > 0 && (
        <button className="btn btn-primary btn-small" type="button" onClick={save} disabled={pending} style={{ alignSelf: "flex-start" }} data-testid="pal-photo-save">
          {pending ? "Speichere …" : `${photos.length} Foto${photos.length === 1 ? "" : "s"} speichern`}
        </button>
      )}
      {state && <div className={`notice ${state.ok ? "notice-ok" : "notice-warn"}`}>{state.message}</div>}
    </div>
  );
}
