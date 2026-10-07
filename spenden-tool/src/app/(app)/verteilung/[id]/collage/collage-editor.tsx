"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CollageSettings } from "@/db/schema";
import { balancedPages, bestGrid, COLLAGE_FORMATS, collagePrice, PER_PAGE_CHOICES } from "@/lib/layout";
import { saveCollageSettings } from "@/app/(app)/actions";
import { BAND, drawBlurBackground, drawImage, fitFont, FONT, imageRect, type Loaded, loadImages, roundRect, wrap } from "@/components/canvas-kit";
import { type PrintedInfo, printedPlan } from "@/lib/printed-price";

export type CollageTile = { id: string; image: string | null; name: string; price: number | null; priceNote: string | null; caption: string | null; printed: PrintedInfo };

function drawTile(ctx: CanvasRenderingContext2D, tile: CollageTile, img: HTMLImageElement | undefined, x: number, y: number, w: number, h: number, s: CollageSettings) {
  const side = Math.min(w, h);
  ctx.save();
  roundRect(ctx, x, y, w, h, side * 0.035);
  ctx.clip();
  if (img) {
    if (s.fit === "contain") {
      // Hintergrund: dasselbe Foto unscharf und abgedunkelt, darüber das ganze Foto.
      drawBlurBackground(ctx, img, x, y, w, h, "blur(24px) brightness(0.85)", tile.printed?.box);
      drawImage(ctx, img, x, y, w, h, "contain");
    } else drawImage(ctx, img, x, y, w, h, "cover");
  } else {
    ctx.fillStyle = "#e9e6dd";
    ctx.fillRect(x, y, w, h);
  }

  const price = collagePrice(tile.price);
  const note = tile.priceNote?.trim() ?? "";
  // Kurzer Zusatz („je“) in dieselbe Zeile, längerer („3er Packung“) darüber.
  const inline = note && note.length <= 4;
  const fullPrice = inline ? `${note.charAt(0).toUpperCase()}${note.slice(1)} ${price}` : price;
  // Steht der Preis schon im Foto, nicht doppelt drucken – bei neuem Preis den alten überdecken.
  let plan = img ? printedPlan(tile.printed) : "normal";
  if (img && plan === "keep" && tile.printed?.box && s.fit === "cover" && fullPrice) {
    // „Kachel füllen“ schneidet Ränder ab – ist der alte Preis dadurch angeschnitten, neu drucken.
    const r = imageRect(img, x, y, w, h, "cover");
    const b = tile.printed.box;
    const bx = r.x + b.x * r.w, by = r.y + b.y * r.h, bw = b.w * r.w, bh = b.h * r.h;
    const vis = (Math.max(0, Math.min(bx + bw, x + w) - Math.max(bx, x)) * Math.max(0, Math.min(by + bh, y + h) - Math.max(by, y))) / (bw * bh);
    if (vis < 0.8) plan = "normal";
  }
  const priceLine = plan === "normal" ? fullPrice : "";
  // Alter Preis unten im Foto: Name und Text nach oben, damit nichts übereinanderliegt.
  const top = img && plan !== "normal" && (tile.printed?.box ? tile.printed.box.y + tile.printed.box.h / 2 > 0.45 : true);
  const pad = w * 0.06;
  const maxW = w - pad * 2;

  const lines: { text: string; size: number; weight?: string }[] = [];
  if (!img || s.showName) {
    ctx.font = `${Math.round(side * (img ? 0.06 : 0.085))}px ${FONT}`;
    for (const l of wrap(ctx, tile.name, maxW, img ? 2 : 4)) lines.push({ text: l, size: side * (img ? 0.06 : 0.085) });
  }
  if (note && !inline && plan === "normal") lines.push({ text: note, size: side * 0.09 });
  if (priceLine) lines.push({ text: priceLine, size: side * 0.16 });
  if (tile.caption) {
    ctx.font = `${Math.round(side * 0.055)}px ${FONT}`;
    for (const l of wrap(ctx, tile.caption, maxW, 3)) lines.push({ text: l, size: side * 0.055 });
  }
  const sized = lines.map((l) => ({ ...l, size: fitFont(ctx, l.text, maxW, Math.round(l.size)) }));
  const total = sized.reduce((n, l) => n + l.size * 1.12, 0);

  if (img && total > 0) {
    // Dunkler Verlauf (unten, bzw. oben), damit die Schrift auf jedem Foto lesbar ist.
    const gh = Math.min(h, total + h * 0.25);
    const g = top ? ctx.createLinearGradient(0, y + gh, 0, y) : ctx.createLinearGradient(0, y + h - gh, 0, y + h);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = g;
    ctx.fillRect(x, top ? y : y + h - gh, w, gh);
  }

  let ty = !img ? y + (h - total) / 2 : top ? y + pad * 0.8 : y + h - pad * 0.8 - total;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const l of sized) {
    ctx.font = `${l.size}px ${FONT}`;
    if (img) {
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = l.size * 0.25;
      ctx.shadowOffsetY = l.size * 0.04;
    } else ctx.fillStyle = "#1b1d1f";
    ctx.fillText(l.text, x + w / 2, ty);
    ty += l.size * 1.12;
  }
  ctx.restore();
}

function drawPage(canvas: HTMLCanvasElement, tiles: CollageTile[], images: Loaded, s: CollageSettings, header: { title: string; date: string }, pageLabel: string) {
  const { width: W, height: H } = COLLAGE_FORMATS[s.format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const pad = Math.round(W * 0.018);
  const gap = Math.round(W * 0.014);
  let top = pad;
  if (s.header) {
    const hh = Math.round(H * 0.08);
    ctx.fillStyle = BAND;
    ctx.fillRect(0, 0, W, hh);
    ctx.fillStyle = "#1b1d1f";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const size = fitFont(ctx, header.title.toUpperCase(), W * 0.6, Math.round(hh * 0.36));
    ctx.fillText(header.title.toUpperCase(), pad * 1.5, hh / 2);
    ctx.textAlign = "right";
    ctx.font = `${Math.round(size * 0.85)}px ${FONT}`;
    ctx.fillText([header.date, pageLabel].filter(Boolean).join(" · "), W - pad * 1.5, hh / 2);
    top = hh + pad;
  }
  const areaW = W - pad * 2;
  const areaH = H - top - pad;
  const { cols, rows } = bestGrid(tiles.length, areaW, areaH);
  const tw = (areaW - gap * (cols - 1)) / cols;
  const th = (areaH - gap * (rows - 1)) / rows;
  tiles.forEach((tile, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // Unvollständige letzte Zeile mittig setzen.
    const inRow = r === rows - 1 ? tiles.length - r * cols : cols;
    const offset = ((cols - inRow) * (tw + gap)) / 2;
    const x = pad + offset + c * (tw + gap);
    const y = top + r * (th + gap);
    drawTile(ctx, tile, tile.image ? images.get(tile.image) : undefined, x, y, tw, th, s);
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erzeugt werden"))), "image/jpeg", 0.9));
}

export function CollageEditor({ eventId, tiles, initial, header, fileBase }: { eventId: string; tiles: CollageTile[]; initial: CollageSettings; header: { title: string; date: string }; fileBase: string }) {
  const [s, setS] = useState<CollageSettings>(initial);
  const [images, setImages] = useState<Loaded | null>(null);
  const [message, setMessage] = useState("");
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const pages = useMemo(() => balancedPages(tiles, s.perPage), [tiles, s.perPage]);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare("canShare" in navigator && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Schrift laden, sonst zeichnet das Canvas mit der Ersatzschrift.
      try {
        await Promise.race([document.fonts.load(`40px "Archivo Black"`), new Promise((r) => setTimeout(r, 2500))]);
      } catch {}
      const loaded = await loadImages(tiles.map((t) => t.image));
      if (alive) setImages(loaded);
    })();
    return () => {
      alive = false;
    };
  }, [tiles]);

  useEffect(() => {
    if (!images) return;
    pages.forEach((p, i) => {
      const c = canvases.current[i];
      if (c) drawPage(c, p, images, s, header, pages.length > 1 ? `${i + 1}/${pages.length}` : "");
    });
  }, [images, pages, s, header]);

  // Einstellungen an der Verteilung merken (leicht verzögert).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void saveCollageSettings(eventId, s).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [eventId, s]);

  const files = async (only?: number) => {
    const out: File[] = [];
    for (let i = 0; i < pages.length; i++) {
      if (only !== undefined && i !== only) continue;
      const c = canvases.current[i];
      if (c) out.push(new File([await toBlob(c)], `${fileBase}-${i + 1}.jpg`, { type: "image/jpeg" }));
    }
    return out;
  };
  const download = async (only?: number) => {
    for (const f of await files(only)) {
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const share = async () => {
    const list = await files();
    if (!navigator.canShare?.({ files: list })) {
      setMessage("Teilen wird von diesem Browser nicht unterstützt – bitte „Alle speichern“ nutzen.");
      return;
    }
    try {
      await navigator.share({ files: list, title: header.title });
    } catch {
      // Abgebrochen
    }
  };
  const set = <K extends keyof CollageSettings>(k: K, v: CollageSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const fmt = COLLAGE_FORMATS[s.format];

  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap" precedence="default" />
      <section className="card card-pad" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field">
          <label className="label" htmlFor="pp">Produkte pro Bild</label>
          <select className="select" id="pp" value={s.perPage} onChange={(e) => set("perPage", Number(e.target.value))}>
            {PER_PAGE_CHOICES.map((n) => <option key={n} value={n}>{n} ({Math.ceil(tiles.length / n)} {Math.ceil(tiles.length / n) === 1 ? "Bild" : "Bilder"})</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="ff">Format</label>
          <select className="select" id="ff" value={s.format} onChange={(e) => set("format", e.target.value as CollageSettings["format"])}>
            {Object.entries(COLLAGE_FORMATS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="fi">Fotos</label>
          <select className="select" id="fi" value={s.fit} onChange={(e) => set("fit", e.target.value as CollageSettings["fit"])}>
            <option value="contain">ganz zeigen</option>
            <option value="cover">Kachel füllen (schneidet Ränder ab)</option>
          </select>
        </div>
        <label className="small" style={{ paddingBottom: 10 }}><input type="checkbox" checked={s.showName} onChange={(e) => set("showName", e.target.checked)} /> Produktnamen</label>
        <label className="small" style={{ paddingBottom: 10 }}><input type="checkbox" checked={s.header} onChange={(e) => set("header", e.target.checked)} /> Kopfzeile mit Datum</label>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: "flex", gap: 8 }}>
          {canShare && <button className="btn btn-primary" type="button" onClick={share} disabled={!images}>Teilen …</button>}
          <button className={`btn${canShare ? "" : " btn-primary"}`} type="button" onClick={() => download()} disabled={!images}>{pages.length > 1 ? `Alle ${pages.length} speichern` : "Bild speichern"}</button>
        </div>
      </section>
      {message && <div className="notice notice-warn">{message}</div>}
      {!images && <div className="notice notice-info">Lade Fotos …</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {pages.map((p, i) => (
          <figure key={`${s.perPage}-${i}`} className="card" style={{ margin: 0, padding: 10 }}>
            <canvas ref={(el) => { canvases.current[i] = el; }} style={{ width: "100%", aspectRatio: `${fmt.width} / ${fmt.height}`, display: "block", borderRadius: 6, background: "var(--row)" }} />
            <figcaption style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }} className="small muted">
              <span>Bild {i + 1} · {p.length} Produkte</span>
              <button className="btn btn-small" type="button" onClick={() => download(i)} disabled={!images}>Speichern</button>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="small muted">Die Aufteilung passt sich automatisch an: Die Produkte werden gleichmäßig auf die Bilder verteilt und das Raster so gewählt, dass die Fotos möglichst groß sind. Auf dem Handy öffnet „Teilen …“ direkt WhatsApp, Signal oder Telegram.</div>
    </>
  );
}
