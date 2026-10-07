"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CollageSettings } from "@/db/schema";
import { balancedPages, bestGrid, COLLAGE_FORMATS, collagePrice, PER_PAGE_CHOICES } from "@/lib/layout";
import { saveCollageSettings } from "@/app/(app)/actions";
import { saveTileStyles } from "@/app/(app)/actions";
import { TILE_COLORS, TILE_POSITIONS, type TileColor, type TilePosition, type TileStyle, tileStyle } from "@/lib/layout";
import { BAND, drawBlurBackground, drawImage, fitFont, FONT, imageRect, type Loaded, loadImages, roundRect, wrap } from "@/components/canvas-kit";
import { type PrintedInfo, printedPlan } from "@/lib/printed-price";

export type CollageTile = { id: string; productId: string; image: string | null; name: string; price: number | null; priceNote: string | null; caption: string | null; printed: PrintedInfo; style: TileStyle };
type Rect = { productId: string; x: number; y: number; w: number; h: number };

function drawTile(ctx: CanvasRenderingContext2D, tile: CollageTile, img: HTMLImageElement | undefined, x: number, y: number, w: number, h: number, s: CollageSettings) {
  const st = tileStyle(tile.style);
  const colors = TILE_COLORS[st.color];
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
  // Lage der Schrift: festgelegt pro Produkt – sonst unten, bzw. oben, wenn unten schon ein Preis im Foto steht.
  const autoTop = img && plan !== "normal" && (tile.printed?.box ? tile.printed.box.y + tile.printed.box.h / 2 > 0.45 : true);
  const vert = !img ? "m" : st.custom ? st.pos[0] : autoTop ? "o" : "u";
  const horiz = st.custom ? st.pos[1] : "m";
  const pad = w * 0.06;
  const maxW = w - pad * 2;

  const lines: { text: string; size: number; isPrice?: boolean }[] = [];
  if (!img || s.showName) {
    ctx.font = `${Math.round(side * (img ? 0.06 : 0.085))}px ${FONT}`;
    for (const l of wrap(ctx, tile.name, maxW, img ? 2 : 4)) lines.push({ text: l, size: side * (img ? 0.06 : 0.085) });
  }
  if (note && !inline && plan === "normal") lines.push({ text: note, size: side * 0.09 });
  if (priceLine) lines.push({ text: priceLine, size: side * 0.16, isPrice: true });
  if (tile.caption) {
    ctx.font = `${Math.round(side * 0.055)}px ${FONT}`;
    for (const l of wrap(ctx, tile.caption, maxW, 3)) lines.push({ text: l, size: side * 0.055 });
  }
  const field = img ? colors.field : null;
  // Mit farbigem Feld etwas kleiner, damit das Feld in die Kachel passt.
  const sized = lines.map((l) => ({ ...l, size: fitFont(ctx, l.text, maxW - (field && l.isPrice ? l.size * 0.6 : 0), Math.round(l.size * (field && l.isPrice ? 0.85 : 1))) }));
  const lineH = (l: { size: number; isPrice?: boolean }) => l.size * (field && l.isPrice ? 1.45 : 1.12);
  const total = sized.reduce((n, l) => n + lineH(l), 0);

  if (img && total > 0 && colors.veil !== "none") {
    // Verlauf hinter der Schrift, damit sie auf jedem Foto lesbar ist (dunkel für helle Schrift, hell für dunkle).
    const tint = colors.veil === "dark" ? "0,0,0" : "255,255,255";
    const gh = Math.min(h, total + h * 0.25);
    if (vert === "m") {
      const g = ctx.createLinearGradient(0, y + (h - gh) / 2, 0, y + (h + gh) / 2);
      g.addColorStop(0, `rgba(${tint},0)`);
      g.addColorStop(0.5, `rgba(${tint},0.5)`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y + (h - gh) / 2, w, gh);
    } else {
      const g = vert === "o" ? ctx.createLinearGradient(0, y + gh, 0, y) : ctx.createLinearGradient(0, y + h - gh, 0, y + h);
      g.addColorStop(0, `rgba(${tint},0)`);
      g.addColorStop(1, `rgba(${tint},0.62)`);
      ctx.fillStyle = g;
      ctx.fillRect(x, vert === "o" ? y : y + h - gh, w, gh);
    }
  }

  let ty = vert === "m" ? y + (h - total) / 2 : vert === "o" ? y + pad * 0.8 : y + h - pad * 0.8 - total;
  const align = horiz === "l" ? "left" : horiz === "r" ? "right" : "center";
  const tx = horiz === "l" ? x + pad : horiz === "r" ? x + w - pad : x + w / 2;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  for (const l of sized) {
    ctx.font = `${l.size}px ${FONT}`;
    const lh = lineH(l);
    if (field && l.isPrice) {
      // Preis auf farbigem Feld
      const tw = ctx.measureText(l.text).width;
      const fw = tw + l.size * 0.7;
      const fx = align === "left" ? tx - l.size * 0.35 : align === "right" ? tx - tw - l.size * 0.35 : tx - fw / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = l.size * 0.3;
      ctx.fillStyle = field;
      roundRect(ctx, Math.max(x + 2, fx), ty, Math.min(fw, w - 4), l.size * 1.32, l.size * 0.25);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = colors.text;
      ctx.fillText(l.text, tx, ty + l.size * 0.2);
    } else {
      if (img) {
        // Name und Zusatz bei Feld-Farben weiß mit Schatten, sonst in der gewählten Farbe.
        const plain = colors.field !== null;
        ctx.fillStyle = plain ? "#fff" : colors.text;
        ctx.shadowColor = plain ? "rgba(0,0,0,0.6)" : colors.shadow;
        ctx.shadowBlur = l.size * 0.25;
        ctx.shadowOffsetY = l.size * 0.04;
      } else ctx.fillStyle = "#1b1d1f";
      ctx.fillText(l.text, tx, ty);
      ctx.shadowColor = "transparent";
    }
    ty += lh;
  }
  ctx.restore();
}

function drawPage(canvas: HTMLCanvasElement, tiles: CollageTile[], images: Loaded, s: CollageSettings, header: { title: string; date: string }, pageLabel: string): Rect[] {
  const rects: Rect[] = [];
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
    rects.push({ productId: tile.productId, x: x / W, y: y / H, w: tw / W, h: th / H });
  });
  return rects;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erzeugt werden"))), "image/jpeg", 0.9));
}

export function CollageEditor({ eventId, tiles, initial, header, fileBase }: { eventId: string; tiles: CollageTile[]; initial: CollageSettings; header: { title: string; date: string }; fileBase: string }) {
  const [s, setS] = useState<CollageSettings>(initial);
  const [images, setImages] = useState<Loaded | null>(null);
  const [message, setMessage] = useState("");
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  // Preis-Lage und -Farbe je Produkt (auf ein Bild tippen → einstellen).
  const [styles, setStyles] = useState<Record<string, TileStyle>>(() => Object.fromEntries(tiles.map((t) => [t.productId, t.style ?? {}])));
  const [selected, setSelected] = useState<string | null>(null);
  const [rects, setRects] = useState<Rect[][]>([]);
  const styled = useMemo(() => tiles.map((t) => ({ ...t, style: styles[t.productId] ?? {} })), [tiles, styles]);
  const pages = useMemo(() => balancedPages(styled, s.perPage), [styled, s.perPage]);
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
    setRects(pages.map((p, i) => {
      const c = canvases.current[i];
      return c ? drawPage(c, p, images, s, header, pages.length > 1 ? `${i + 1}/${pages.length}` : "") : [];
    }));
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
  const pick = (page: number, e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    const hit = rects[page]?.find((r) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h);
    setSelected(hit && hit.productId !== selected ? hit.productId : null);
  };
  const changeStyle = (ids: string[], style: TileStyle | null) => {
    setStyles((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, style ?? {}])) }));
    void saveTileStyles(ids, style).catch(() => setMessage("Einstellung konnte nicht gespeichert werden – bitte Seite neu laden."));
  };
  const sel = selected ? tiles.find((t) => t.productId === selected) : null;
  const selStyle = selected ? tileStyle(styles[selected]) : null;
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
      {images && !sel && <div className="small muted">Tipp: Auf ein Produkt in der Collage tippen, um dort Lage und Farbe des Preises festzulegen.</div>}
      {sel && selStyle && (
        <section className="card card-pad tile-style" style={{ position: "sticky", top: 8, zIndex: 5, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 160 }}>
            <div className="label">Preis bei</div>
            <strong>{sel.name}</strong>
            {sel.printed && <div className="small muted" style={{ maxWidth: 220 }}>Preis steht schon im Foto ({sel.printed.text}) – die Einstellung gilt für Name und Text.</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn btn-small" type="button" onClick={() => changeStyle([sel.productId], null)} disabled={!selStyle.custom}>Automatisch</button>
              <button className="btn btn-small" type="button" onClick={() => changeStyle(tiles.map((t) => t.productId), { pos: selStyle.pos, color: selStyle.color })} title="Diese Lage und Farbe für alle Bilder der Collage">Für alle Bilder</button>
              <button className="btn btn-small" type="button" onClick={() => setSelected(null)}>Fertig</button>
            </div>
          </div>
          <div>
            <div className="label">Lage</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 36px)", gap: 4 }}>
              {TILE_POSITIONS.map((p) => (
                <button key={p} type="button" aria-label={`Lage ${p}`} aria-pressed={selStyle.custom && selStyle.pos === p} onClick={() => changeStyle([sel.productId], { pos: p as TilePosition, color: selStyle.color })}
                  style={{ width: 36, height: 30, borderRadius: 6, border: "1px solid #8a949c", cursor: "pointer", background: selStyle.pos === p ? "#1f7a4d" : "#fff" }} />
              ))}
            </div>
          </div>
          <div>
            <div className="label">Farbe</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 400 }}>
              {(Object.keys(TILE_COLORS) as TileColor[]).map((c) => {
                const col = TILE_COLORS[c];
                return (
                  <button key={c} type="button" title={col.label} aria-label={`Farbe ${col.label}`} aria-pressed={selStyle.color === c} onClick={() => changeStyle([sel.productId], { pos: selStyle.pos, color: c })}
                    style={{ minWidth: 40, height: 30, padding: "0 8px", borderRadius: 6, cursor: "pointer", fontWeight: 800, fontSize: 13, color: col.text, background: col.field ?? (col.veil === "dark" ? "#55606a" : "#e9e6dd"), border: selStyle.color === c ? "3px solid #ffd60a" : "1px solid #8a949c", boxShadow: selStyle.color === c ? "0 0 0 1px #1b1d1f" : "none" }}>
                    Aa
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
      {!images && <div className="notice notice-info">Lade Fotos …</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {pages.map((p, i) => (
          <figure key={`${s.perPage}-${i}`} className="card" style={{ margin: 0, padding: 10 }}>
            <div style={{ position: "relative" }}>
              <canvas ref={(el) => { canvases.current[i] = el; }} onClick={(e) => pick(i, e)} style={{ width: "100%", aspectRatio: `${fmt.width} / ${fmt.height}`, display: "block", borderRadius: 6, background: "var(--row)", cursor: "pointer" }} />
              {rects[i]?.filter((r) => r.productId === selected).map((r) => (
                <div key={r.productId} style={{ position: "absolute", left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, outline: "3px solid #ffd60a", borderRadius: 6, pointerEvents: "none", boxShadow: "0 0 0 2px #1b1d1f" }} />
              ))}
            </div>
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
