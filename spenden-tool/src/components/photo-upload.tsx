"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UploadResult } from "@/app/(app)/actions";
import { shrink } from "./image-form";
import { CategorySelect } from "./category-select";
import { chooseFrontPhoto } from "@/app/(app)/actions";
import { UNSORTED_CATEGORY } from "@/lib/price-logic";

const BATCH = 4;

/**
 * Fotos hinzufügen: öffnet am Handy Kamera oder Fotomediathek. Die Fotos werden einzeln verkleinert und
 * in Portionen zu je 4 hochgeladen – so geht auch eine große Auswahl (50+ Fotos) durch, ohne dass
 * das Handy den Speicher sprengt oder eine einzelne riesige Anfrage abbricht.
 */
export function PhotoUpload({ eventId, action, variant = "button", categories = [], ai = false, autoAi = false }: { eventId: string; action: (fd: FormData) => Promise<UploadResult>; variant?: "button" | "card"; categories?: string[]; ai?: boolean; autoAi?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const categoryBox = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<{ ok: boolean; text: string } | null>(null);
  // einzeln: jedes Foto ein Produkt · paare: Vorder-/Rückseite abwechselnd · ein-produkt: alle Fotos = ein Produkt
  const [mode, setModeState] = useState<"einzeln" | "paare" | "ein-produkt">("einzeln");
  // Gewählte Art merkt sich das Gerät (wer immer Vorder- und Rückseite fotografiert, muss nicht jedes Mal umstellen).
  useEffect(() => {
    try {
      const m = localStorage.getItem("upload-modus");
      if (m === "einzeln" || m === "paare" || m === "ein-produkt") setModeState(m);
    } catch {}
  }, []);
  const setMode = (m: "einzeln" | "paare" | "ein-produkt") => {
    setModeState(m);
    try {
      localStorage.setItem("upload-modus", m);
    } catch {}
  };

  async function upload(files: File[]) {
    setReport(null);
    const total = files.length;
    let added = 0;
    let reused = 0;
    let already = 0;
    let similar = 0;
    let backs = 0;
    let oneProduct: string | null = null;
    const created: string[] = [];
    const rejected: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < total; i += BATCH) {
      const part = files.slice(i, i + BATCH);
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("modus", mode);
      if (mode === "ein-produkt" && oneProduct) fd.set("zu", oneProduct);
      fd.set("category", categoryBox.current?.querySelector<HTMLInputElement | HTMLSelectElement>("[name=category]")?.value || UNSORTED_CATEGORY);
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
        backs += res.backs ?? 0;
        if (mode === "ein-produkt" && res.productId) oneProduct = res.productId;
        created.push(...(res.newIds ?? []));
        rejected.push(...res.rejected);
      } else failed.push(...part.map((f) => f.name));
    }
    // Mehrere Fotos eines Produkts: die KI wählt die Vorderseite als Titelbild.
    if (mode === "ein-produkt" && oneProduct && ai) {
      setStatus(total > 1 ? "KI wählt die Vorderseite als Titelbild …" : "KI wird gestartet …");
      try {
        await chooseFrontPhoto(oneProduct, eventId);
      } catch {}
    }
    setStatus("");
    // Genau ein neues Produkt: gleich dessen Kartei öffnen – zum Kontrollieren, ohne Suchen.
    const single = oneProduct ?? (created.length === 1 ? created[0] : null);
    if (single && added === 1) router.push(`?offen=${single}#p-${single}`, { scroll: true });
    else router.refresh();
    const parts = [`${added} neu`];
    if (mode === "paare" && total % 2 === 1) parts.push("das letzte Foto hatte keine Rückseite – es wurde als eigenes Produkt angelegt (Rückseite später über „Weitere Fotos hinzufügen“ ergänzen)");
    if (backs) parts.push(mode === "ein-produkt" ? `${backs} weitere(s) Foto(s) als Infofoto am selben Produkt` : `${backs} Rückseite(n) als Infofoto zugeordnet`);
    if (reused) parts.push(`${reused} schon in der Datenbank (wiedererkannt, nicht doppelt angelegt)`);
    if (already) parts.push(`${already} doppelt – schon in dieser Verteilung, übersprungen`);
    if (similar) parts.push(`${similar} ähnlich wie ein vorhandenes Foto – bitte prüfen (Produkte → Mögliche Doppelte)`);
    if (rejected.length) parts.push(`${rejected.length} nicht lesbar – bitte als JPG/PNG: ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? " …" : ""}`);
    if (failed.length) parts.push(`${failed.length} nicht hochgeladen (Verbindung?) – bitte diese erneut auswählen`);
    if (ai && added) parts.push(autoAi ? "die KI erkennt die Produkte und füllt Name, Kategorie und Preisvorschlag aus – bitte danach kontrollieren" : "aufgedruckte Preise werden im Hintergrund abgelesen");
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
        <div className="notice notice-info small">
          <strong>So klappt die Erkennung am besten:</strong> jedes Produkt <strong>einzeln</strong> fotografieren (nie zwei verschiedene Produkte auf einem Bild) – und immer Vorderseite und Rückseite bzw. Unterseite, wenn dort das MHD steht. Dann unten „Vorder- und Rückseite abwechselnd“ wählen.
        </div>
        <div className="small muted">Beliebig viele Fotos auf einmal. Doppelte Fotos werden erkannt – auch verkleinert, neu gespeichert oder per WhatsApp verschickt – und nicht doppelt angelegt oder ausgewertet.{autoAi ? " Die KI erkennt danach jedes Produkt selbst und füllt die Felder aus – ihr kontrolliert nur noch." : ""}</div>
        <div className="field" ref={categoryBox}><label className="label" htmlFor="pc">Kategorie für neue Produkte</label><span className="small muted">„{UNSORTED_CATEGORY}“: die KI schlägt eine vor, du ordnest später zu.</span><CategorySelect id="pc" name="category" value={UNSORTED_CATEGORY} categories={categories} /></div>
        <fieldset className="upload-modes">
          <legend className="label">Wie sind die Fotos?</legend>
          <label className="check"><input type="radio" name="upload-modus" checked={mode === "einzeln"} onChange={() => setMode("einzeln")} /> <span>Jedes Foto ist ein eigenes Produkt</span></label>
          <label className="check"><input type="radio" name="upload-modus" checked={mode === "ein-produkt"} onChange={() => setMode("ein-produkt")} /> <span>Alle ausgewählten Fotos sind <strong>ein</strong> Produkt<br /><span className="small muted">z. B. vorne, hinten, Seite – wird ein Artikel; die KI nimmt die Vorderseite als Titelbild, die anderen sind Infofotos.</span></span></label>
          <label className="check"><input type="radio" name="upload-modus" checked={mode === "paare"} onChange={() => setMode("paare")} /> <span>Vorder- und Rückseite abwechselnd<br /><span className="small muted">1. Foto vorne, 2. Foto Rückseite des 1., 3. vorne … – bitte in dieser Reihenfolge auswählen.</span></span></label>
        </fieldset>
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
