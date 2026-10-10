"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { uploadReceiptAction, type UploadState } from "./actions";

type Page = { key: number; url: string; file: File };
const MAX_SIDE = 2000;

/**
 * Foto → JPEG für den Beleg: verkleinert (lesbar, aber kleine Datei), auf Wunsch „Scan-Look“
 * (Graustufen, Kontrast gestreckt – Thermopapier wird gut lesbar).
 */
async function prepare(file: File, scanLook: boolean): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (scanLook) {
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      const hist = new Array(256).fill(0);
      for (let i = 0; i < px.length; i += 4) {
        const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
        px[i] = g;
        hist[g]++;
      }
      // Dunkelste 2 % → schwarz, hellste 10 % → weiß (Papier wird weiß, Schrift satt).
      const n = px.length / 4;
      let lo = 0, hi = 255, acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
      acc = 0;
      for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.1) { hi = v; break; } }
      const span = Math.max(1, hi - lo);
      for (let i = 0; i < px.length; i += 4) {
        const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      ctx.putImageData(d, 0, 0);
    }
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Foto nicht lesbar"))), "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function Scanner({ stotax }: { stotax: string | null }) {
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [scanLook, setScanLook] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<UploadState>(null);

  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.url)), [pages]);

  const add = (files: FileList | null) => {
    if (!files) return;
    const list = [...files];
    const p = list.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (p) {
      setPdf(p);
      setPages([]);
      return;
    }
    setPdf(null);
    setPages((cur) => [...cur, ...list.filter((f) => f.type.startsWith("image/")).map((f, i) => ({ key: Date.now() + i, url: URL.createObjectURL(f), file: f }))]);
    setState(null);
  };

  const upload = async () => {
    setBusy(true);
    setState(null);
    try {
      const fd = new FormData();
      if (pdf) fd.append("pdf", pdf, pdf.name);
      for (const p of pages) fd.append("image", await prepare(p.file, scanLook), "seite.jpg");
      fd.append("note", note);
      const r = await uploadReceiptAction(fd);
      setState(r);
      if (r?.ok) {
        setPages([]);
        setPdf(null);
        setNote("");
        router.refresh();
      }
    } catch (e) {
      setState({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const has = pages.length > 0 || pdf;
  return (
    <section className="card card-pad stack" style={{ gap: 10 }} data-testid="scanner">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" style={{ flex: "1 1 200px", padding: "14px 16px", fontSize: 16 }} onClick={() => camera.current?.click()}>
          📷 {pages.length ? "Weitere Seite fotografieren" : "Beleg fotografieren"}
        </button>
        <button type="button" className="btn" style={{ flex: "1 1 160px" }} onClick={() => gallery.current?.click()}>Foto/PDF auswählen</button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="scan-camera" />
      <input ref={gallery} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="scan-file" />

      {pages.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }} data-testid="scan-pages">
          {pages.map((p, i) => (
            <div key={p.key} style={{ position: "relative", flex: "0 0 auto" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Seite ${i + 1}`} style={{ height: 120, borderRadius: 6, border: "1px solid var(--border)", filter: scanLook ? "grayscale(1) contrast(1.4) brightness(1.1)" : undefined }} />
              <button type="button" className="btn btn-small" style={{ position: "absolute", top: 4, right: 4, padding: "2px 6px" }} onClick={() => setPages(pages.filter((x) => x.key !== p.key))} aria-label={`Seite ${i + 1} entfernen`}>×</button>
            </div>
          ))}
        </div>
      )}
      {pdf && <div className="small" data-testid="scan-pdf">PDF: {pdf.name}</div>}

      {has && (
        <>
          {pages.length > 0 && (
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={scanLook} onChange={(e) => setScanLook(e.target.checked)} /> Scan-Look (Schwarz-Weiß, mehr Kontrast – gut für Thermopapier)
            </label>
          )}
          <div className="field">
            <label className="label" htmlFor="scan-note">Notiz (optional, z. B. Anlass)</label>
            <input className="input" id="scan-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Verpackungsmaterial, Geschäftsessen mit …" maxLength={300} />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void upload()} disabled={busy} data-testid="scan-upload" style={{ padding: "12px 16px" }}>
            {busy ? "Wird hochgeladen …" : `${pages.length > 1 ? `${pages.length} Seiten als ein Beleg` : "Beleg"} speichern${stotax ? " und an Stotax senden" : ""}`}
          </button>
        </>
      )}
      {state && <div className={`notice small ${state.ok ? "notice-ok" : "notice-error"}`} data-testid="scan-msg">{state.message}</div>}
      <div className="small muted">Ein Beleg = alle Fotos eines Zettels (lange Bons in mehreren Teilen fotografieren). {stotax ? `Geht automatisch an ${stotax}.` : "Stotax ist noch nicht eingerichtet – Belege werden nur gespeichert."}</div>
    </section>
  );
}
