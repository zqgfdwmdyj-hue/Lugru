"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UploadResult } from "@/app/(app)/actions";
import { shrink } from "./image-form";

const BATCH = 4;

/**
 * Fotos hinzufügen: öffnet am Handy Kamera oder Fotomediathek. Die Fotos werden einzeln verkleinert und
 * in Portionen zu je 4 hochgeladen – so geht auch eine große Auswahl (50+ Fotos) durch, ohne dass
 * das Handy den Speicher sprengt oder eine einzelne riesige Anfrage abbricht.
 */
export function PhotoUpload({ eventId, action, variant = "button" }: { eventId: string; action: (fd: FormData) => Promise<UploadResult>; variant?: "button" | "card" }) {
  const input = useRef<HTMLInputElement>(null);
  const category = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(files: File[]) {
    setReport(null);
    const total = files.length;
    let added = 0;
    let reused = 0;
    const rejected: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < total; i += BATCH) {
      const part = files.slice(i, i + BATCH);
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("category", category.current?.value || "Lebensmittel");
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
        rejected.push(...res.rejected);
      } else failed.push(...part.map((f) => f.name));
    }
    setStatus("");
    router.refresh();
    const parts = [`${added} neu`];
    if (reused) parts.push(`${reused} schon vorhanden (wiedererkannt, nicht doppelt angelegt)`);
    if (rejected.length) parts.push(`${rejected.length} nicht lesbar – bitte als JPG/PNG: ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? " …" : ""}`);
    if (failed.length) parts.push(`${failed.length} nicht hochgeladen (Verbindung?) – bitte diese erneut auswählen`);
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
        <div className="small muted">Beliebig viele Fotos auf einmal – jedes wird ein Produkt in dieser Verteilung. Schon einmal hochgeladene Fotos werden wiedererkannt.</div>
        <div className="field"><label className="label" htmlFor="pc">Kategorie für neue Produkte</label><input ref={category} className="input" id="pc" list="spenden-kategorien" defaultValue="Lebensmittel" /></div>
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
