"use client";

import { useEffect, useRef, useState } from "react";
import type { IdeaPoster } from "@/db/schema";
import { BODY_FONT, downloadFiles, drawImage, fitFont, FONT, type Loaded, loadFonts, loadImages, roundRect, shareFiles, toBlob, wrap } from "@/components/canvas-kit";
import { jpegsToPdf } from "@/lib/pdf";

// Themen-Plakat (A4) aus den KI-Ideen: große Kacheln mit Foto, „Einzeln“ und Packungs-Spendenempfehlung,
// darunter Gruppen weiterer Produkte und ein Band mit dem Schlusssatz. Fotos und Beträge kommen aus der Verteilung.

export type PosterTile = { name: string; image: string | null; single: string; pack: string | null; packLabel: string | null };
export type PosterGroup = { titel: string; text: string; images: string[] };

const W = 1240;
const H = 1754;

type Theme = { bg: string; band: string; bandInk: string; head: string; headInk: string; badge: string; ink: string; paper: string; deco: string[] };
const THEMES: Record<IdeaPoster["thema"], Theme> = {
  winter: { bg: "#f6efe4", band: "#a8471c", bandInk: "#fff", head: "#c96a2b", headInk: "#fff", badge: "#c62828", ink: "#2b1a10", paper: "#fff3d6", deco: ["❄", "🍂"] },
  herbst: { bg: "#fbf1e3", band: "#b5561a", bandInk: "#fff", head: "#d0812c", headInk: "#fff", badge: "#9c2b1d", ink: "#2b1a10", paper: "#fff3d6", deco: ["🍂", "🍁"] },
  halloween: { bg: "#2a1f33", band: "#e8711c", bandInk: "#1b1020", head: "#6b3fa0", headInk: "#fff", badge: "#e8711c", ink: "#fff", paper: "#f6e7c8", deco: ["🎃", "🦇"] },
  weihnachten: { bg: "#fbf4ec", band: "#b71c1c", bandInk: "#fff", head: "#1f6b34", headInk: "#fff", badge: "#b71c1c", ink: "#2b1a10", paper: "#fff8e6", deco: ["🎄", "⭐"] },
  fruehling: { bg: "#f2f8ec", band: "#4f9a3a", bandInk: "#fff", head: "#e07aa5", headInk: "#fff", badge: "#c2185b", ink: "#1e2b16", paper: "#fffdf0", deco: ["🌷", "🌼"] },
  ostern: { bg: "#f6f7ea", band: "#7cb342", bandInk: "#fff", head: "#f2a516", headInk: "#2b1a10", badge: "#d84315", ink: "#1e2b16", paper: "#fffdf0", deco: ["🐣", "🌷"] },
  sommer: { bg: "#eef7fb", band: "#1c8fc0", bandInk: "#fff", head: "#f2a516", headInk: "#1b2b33", badge: "#e53935", ink: "#14242c", paper: "#fffbe6", deco: ["☀", "🍉"] },
  allgemein: { bg: "#f3f7f2", band: "#1f7a4d", bandInk: "#fff", head: "#2a6f97", headInk: "#fff", badge: "#c62828", ink: "#14231a", paper: "#fffbe6", deco: ["♥"] },
};

function textLines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, lines: number, color: string, font = BODY_FONT, weight = "600", align: CanvasTextAlign = "left") {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  const out = wrap(ctx, text, maxW, lines);
  out.forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.22));
  return out.length * size * 1.22;
}

function photo(ctx: CanvasRenderingContext2D, img: HTMLImageElement | undefined, x: number, y: number, w: number, h: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 10);
  ctx.clip();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, w, h);
  if (img) drawImage(ctx, img, x + 6, y + 6, w - 12, h - 12, "contain");
  ctx.restore();
}

function decorate(ctx: CanvasRenderingContext2D, t: Theme) {
  // Ein paar Symbole am Rand (Schneeflocken, Blätter …) – dezent, damit nichts verdeckt wird.
  const spots = [[40, 60], [W - 70, 70], [30, H - 230], [W - 60, H - 240], [W / 2, 30]];
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  spots.forEach(([x, y], i) => {
    ctx.font = `${48 + (i % 2) * 18}px sans-serif`;
    ctx.fillText(t.deco[i % t.deco.length], x, y);
  });
  ctx.restore();
}

export function drawPoster(canvas: HTMLCanvasElement, p: IdeaPoster, tiles: PosterTile[], groups: PosterGroup[], imgs: Loaded) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const t = THEMES[p.thema] ?? THEMES.allgemein;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  decorate(ctx, t);

  // Kopf: Schild mit Titel, rechts ein Zettel mit der Notiz
  const pad = 56;
  const noteW = p.notiz ? 300 : 0;
  const signW = W - pad * 2 - (noteW ? noteW + 24 : 0);
  ctx.save();
  ctx.translate(pad, 70);
  ctx.rotate(-0.012);
  ctx.fillStyle = t.band;
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 18;
  roundRect(ctx, 0, 0, signW, 210, 26);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.font = `86px ${FONT}`;
  const title = wrap(ctx, p.titel, signW - 60, 2);
  const size = Math.min(...title.map((l) => fitFont(ctx, l, signW - 60, title.length > 1 ? 74 : 92)));
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = t.bandInk;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  title.forEach((l, i) => ctx.fillText(l, signW / 2, 105 + (i - (title.length - 1) / 2) * size * 1.05));
  ctx.restore();
  if (p.notiz) {
    ctx.save();
    ctx.translate(W - pad - noteW, 60);
    ctx.rotate(0.03);
    ctx.fillStyle = t.paper;
    ctx.shadowColor = "rgba(0,0,0,.2)";
    ctx.shadowBlur = 12;
    ctx.fillRect(0, 0, noteW, 230);
    ctx.shadowColor = "transparent";
    textLines(ctx, p.notiz, noteW / 2, 26, noteW - 40, 27, 6, "#3b2a1a", BODY_FONT, "700", "center");
    ctx.restore();
  }
  let y = 300;
  if (p.untertitel) y += textLines(ctx, p.untertitel, W / 2, y, W - pad * 2 - 80, 30, 2, t.ink, BODY_FONT, "700", "center") + 18;

  // Bereiche: Kacheln, Gruppen, Schlussband
  const footerH = 150;
  const groupH = groups.length ? 300 : 0;
  const gridTop = y + 6;
  const gridBottom = H - footerH - groupH - (groups.length ? 34 : 20);
  const n = Math.max(1, tiles.length);
  const cols = n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 22;
  const tw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const th = Math.min(tw * 1.25, (gridBottom - gridTop - gap * (rows - 1)) / rows);
  const gridH = th * rows + gap * (rows - 1);
  const top = gridTop + (gridBottom - gridTop - gridH) / 2;
  tiles.forEach((tile, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const x = pad + ((cols - inRow) * (tw + gap)) / 2 + (i % cols) * (tw + gap);
    const ty = top + r * (th + gap);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.18)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "#fffaf2";
    roundRect(ctx, x, ty, tw, th, 18);
    ctx.fill();
    ctx.restore();
    // Kopf mit Produktname
    const headH = Math.max(46, th * 0.13);
    ctx.save();
    roundRect(ctx, x, ty, tw, headH, 18);
    ctx.clip();
    ctx.fillStyle = t.head;
    ctx.fillRect(x, ty, tw, headH);
    ctx.restore();
    const ns = fitFont(ctx, tile.name, tw - 30, Math.round(headH * 0.5));
    ctx.font = `${ns}px ${FONT}`;
    ctx.fillStyle = t.headInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tile.name, x + tw / 2, ty + headH / 2);
    // Foto
    const footH = Math.max(80, th * 0.24);
    photo(ctx, tile.image ? imgs.get(tile.image) : undefined, x + 12, ty + headH + 10, tw - 24, th - headH - footH - 16);
    // Unten: Einzeln + ggf. Packung
    const fy = ty + th - footH;
    const boxW = tile.pack ? (tw - 36) * 0.42 : tw - 24;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,.15)";
    ctx.lineWidth = 2;
    roundRect(ctx, x + 12, fy, boxW, footH - 12, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#3b2a1a";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ls = Math.round(footH * 0.2);
    ctx.font = `700 ${ls}px ${BODY_FONT}`;
    ctx.fillText("Einzeln", x + 12 + boxW / 2, fy + footH * 0.1);
    const ps = fitFont(ctx, tile.single || "–", boxW - 16, Math.round(footH * 0.4));
    ctx.font = `${ps}px ${FONT}`;
    ctx.fillText(tile.single || "–", x + 12 + boxW / 2, fy + footH * 0.36);
    if (tile.pack) {
      const bx = x + 24 + boxW;
      const bw = tw - 36 - boxW;
      ctx.save();
      ctx.translate(bx + bw / 2, fy + (footH - 12) / 2);
      ctx.rotate(-0.03);
      ctx.fillStyle = t.badge;
      roundRect(ctx, -bw / 2, -(footH - 12) / 2, bw, footH - 12, 14);
      ctx.fill();
      ctx.fillStyle = "#fff";
      const label = tile.packLabel || "ganze Packung";
      ctx.font = `700 ${fitFont(ctx, label, bw - 16, ls, "700", BODY_FONT)}px ${BODY_FONT}`;
      ctx.fillText(label, 0, -(footH - 12) / 2 + footH * 0.08);
      ctx.font = `${fitFont(ctx, tile.pack, bw - 16, Math.round(footH * 0.42))}px ${FONT}`;
      ctx.fillText(tile.pack, 0, -(footH - 12) / 2 + footH * 0.32);
      ctx.restore();
    }
  });

  // Gruppen weiterer Produkte
  if (groups.length) {
    const gy = H - footerH - groupH - 14;
    const gw = (W - pad * 2 - gap * (groups.length - 1)) / groups.length;
    groups.forEach((g, i) => {
      const gx = pad + i * (gw + gap);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.15)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#fffaf2";
      roundRect(ctx, gx, gy, gw, groupH, 16);
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, gx, gy, gw, 58, 16);
      ctx.clip();
      ctx.fillStyle = t.band;
      ctx.fillRect(gx, gy, gw, 58);
      ctx.restore();
      ctx.font = `${fitFont(ctx, g.titel, gw - 24, 28)}px ${FONT}`;
      ctx.fillStyle = t.bandInk;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(g.titel, gx + gw / 2, gy + 29);
      const pics = g.images.slice(0, 3);
      const pw = pics.length ? (gw - 24 - (pics.length - 1) * 8) / pics.length : 0;
      pics.forEach((src, k) => photo(ctx, imgs.get(src), gx + 12 + k * (pw + 8), gy + 68, pw, 130));
      textLines(ctx, g.text, gx + gw / 2, gy + (pics.length ? 206 : 74), gw - 30, 22, pics.length ? 4 : 8, "#3b2a1a", BODY_FONT, "600", "center");
    });
  }

  // Schlussband
  const by = H - footerH + 10;
  ctx.save();
  ctx.translate(W / 2, by + 60);
  ctx.rotate(-0.01);
  ctx.fillStyle = t.badge;
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 14;
  roundRect(ctx, -W / 2 + 70, -55, W - 140, 110, 22);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const end = `♥  ${p.schluss}  ♥`;
  ctx.font = `${fitFont(ctx, end, W - 220, 40)}px ${FONT}`;
  ctx.fillText(end, 0, 2);
  ctx.restore();
}

export function PosterStudio({ poster, tiles, groups, fileBase }: { poster: IdeaPoster; tiles: PosterTile[]; groups: PosterGroup[]; fileBase: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [p, setP] = useState(poster);
  const [imgs, setImgs] = useState<Loaded | null>(null);
  const [message, setMessage] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare("canShare" in navigator && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await loadFonts();
      const l = await loadImages([...tiles.map((t) => t.image), ...groups.flatMap((g) => g.images)]);
      if (alive) setImgs(l);
    })();
    return () => {
      alive = false;
    };
  }, [tiles, groups]);

  useEffect(() => {
    // Beim Tippen kurz warten, dann neu zeichnen
    if (!imgs || !canvas.current) return;
    const c = canvas.current;
    const timer = setTimeout(() => drawPoster(c, p, tiles, groups, imgs), 250);
    return () => clearTimeout(timer);
  }, [imgs, p, tiles, groups]);

  const jpg = async () => new File([await toBlob(canvas.current!)], `${fileBase}-plakat.jpg`, { type: "image/jpeg" });
  const pdf = async () => {
    const data = new Uint8Array(await (await toBlob(canvas.current!)).arrayBuffer());
    return new File([jpegsToPdf([{ jpeg: data, width: W, height: H }], { a4: true }) as BlobPart], `${fileBase}-plakat.pdf`, { type: "application/pdf" });
  };
  const field = (k: "titel" | "untertitel" | "notiz" | "schluss", label: string) => (
    <div className="field" style={{ flex: "1 1 200px" }}>
      <label className="label">{label}</label>
      <input className="input input-compact" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {field("titel", "Überschrift")}
        {field("untertitel", "Unterzeile")}
        {field("notiz", "Zettel")}
        {field("schluss", "Band unten")}
      </div>
      <canvas ref={canvas} style={{ width: "100%", maxWidth: 520, aspectRatio: `${W} / ${H}`, borderRadius: 8, background: "var(--row)", display: "block" }} />
      {!imgs && <div className="small muted">Lade Fotos …</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canShare && (
          <button className="btn btn-primary btn-small" type="button" disabled={!imgs} onClick={async () => (await shareFiles([await jpg()], p.titel)) || setMessage("Teilen geht in diesem Browser nicht – bitte speichern.")}>
            Teilen …
          </button>
        )}
        <button className="btn btn-small" type="button" disabled={!imgs} onClick={async () => downloadFiles([await jpg()])}>Als Bild speichern</button>
        <button className="btn btn-small" type="button" disabled={!imgs} onClick={async () => downloadFiles([await pdf()])}>Als PDF (A4)</button>
      </div>
      {message && <div className="small muted">{message}</div>}
      <div className="small muted">Fotos und Spendenempfehlungen kommen aus der Verteilung – Packungen bei den Produkten unter „Packung“ eintragen. Texte oben lassen sich ändern.</div>
    </div>
  );
}
