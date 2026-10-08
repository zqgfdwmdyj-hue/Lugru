"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UploadResult } from "@/app/(app)/actions";
import { shrink } from "./image-form";
import { CategorySelect } from "./category-select";

const BATCH = 4;

/**
 * Fotos hinzufügen: öffnet am Handy Kamera oder Fotomediathek. Die Fotos werden einzeln verkleinert und
 * in Portionen zu je 4 hochgeladen – so geht auch eine große Auswahl (50+ Fotos) durch, ohne dass
 * das Handy den Speicher sprengt oder eine einzelne riesige Anfrage abbricht.
 */
export function PhotoUpload({ eventId, action, variant = "button", categories = [], ai = false }: { eventId: string; action: (fd: FormData) => Promise<UploadResult>; variant?: "button" | "card"; categories?: string[]; ai?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const categoryBox = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(files: File[]) {
    setReport(null);
    const total = files.length;
    let added = 0;
    let reused = 0;
    let already = 0;
    let similar = 0;
    const rejected: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < total; i += BATCH) {
      const part = files.slice(i, i + BATCH);
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("category", categoryBox.current?.querySelector<HTMLInputElement | HTMLSelectElement>("[name=category]")?.value || "Lebensmittel");
      for (let j = 0; j < part.length; j++) {
        setStatus(`Foto ${i + j + 1} von ${total} wird vorbereitet …`);
        fd.append("photos", await shrink(part[j]));
      }
      setStatus(`Lade hoch … ${Math.min(i + BATCH, total)} von ${total}`);
      // Bei Netzproblemen einmal wiederholen, dann mit der nächsten Portion weitermachen.
      let res: UploadResult | null = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await action(fd);
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (res) {
        added += res.added;
        reused += res.reused;
        already += res.alreadyInEvent;
        similar += res.similar;
        rejected.push(...res.rejected);
      } else failed.push(...part.map((f) => f.name));
    }
    setStatus("");
    router.refresh();
    const parts = [`${added} neu`];
    if (reused) parts.push(`${reused} schon in der Datenbank (wiedererkannt, nicht doppelt angelegt)`);
    if (already) parts.push(`${already} doppelt – schon in dieser Verteilung, übersprungen`);
    if (similar) parts.push(`${similar} ähnlich wie ein vorhandenes Foto – bitte prüfen (Produkte → Mögliche Doppelte)`);
    if (rejected.length) parts.push(`${rejected.length} nicht lesbar – bitte als JPG/PNG: ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? " …" : ""}`);
    if (failed.length) parts.push(`${failed.length} nicht hochgeladen (Verbindung?) – bitte diese erneut auswählen`);
    if (ai && added) parts.push("aufgedruckte Preise werden im Hintergrund abgelesen");
    setReport({ ok: !rejected.length && !failed.length, text: `${total} Fotos: ${parts.join(" · ")}` });
  }

  const busy = !!status;
  // Warnen, wenn die Seite mitten im Hochladen verlassen wird.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (files.length) void upload(files);
      }}
    />
  );
  const message = (
    <>
      {busy && <div className="notice notice-info">{status} Bitte die Seite geöffnet lassen.</div>}
      {report && <div className={`notice ${report.ok ? "notice-ok" : "notice-warn"}`}>{report.text}</div>}
    </>
  );

  if (variant === "card") {
    return (
      <div className="card card-pad stack" style={{ gap: 8 }}>
        {picker}
        <h2>Fotos hochladen</h2>
        <div className="small muted">Beliebig viele Fotos auf einmal – jedes wird ein Produkt in dieser Verteilung. Doppelte Fotos werden erkannt – auch verkleinert, neu gespeichert oder per WhatsApp verschickt – und nicht doppelt angelegt oder ausgewertet.</div>
        <div className="field" ref={categoryBox}><label className="label" htmlFor="pc">Kategorie für neue Produkte</label><CategorySelect id="pc" name="category" value="Lebensmittel" categories={categories} /></div>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => input.current?.click()}>Fotos auswählen</button>
        {message}
      </div>
    );
  }
  return (
    <div className="quick-photos-wrap stack" style={{ gap: 6 }}>
      {picker}
      <button className="btn btn-primary quick-photos" type="button" disabled={busy} onClick={() => input.current?.click()}>
        📷 {busy ? status : "Fotos hinzufügen"}
      </button>
      {message}
    </div>
  );
}
