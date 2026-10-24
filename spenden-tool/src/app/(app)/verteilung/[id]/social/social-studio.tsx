"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { BAND, BODY_FONT, brushBand, downloadFiles, drawPhoto, drawSticker, fitFont, FONT, GREEN, INK, type Loaded, loadFonts, loadImages, PINK, roundRect, shareFiles, toBlob, wrap } from "@/components/canvas-kit";
import type { FlyerSection } from "@/lib/layout";
import type { PrintedInfo } from "@/lib/printed-price";
import type { PriceState } from "@/lib/price-logic";
import { instagramCaption, priceLabel, SOCIAL_FORMATS as FORMATS, type SocialFormat, tiktokCaption, type SocialEvent } from "@/lib/social";
import { saveHighlights, saveSocialSettings } from "@/app/(app)/actions";

/** plan: gemeinsame Preislogik – „foto“: Preis steht schon richtig im Foto, „aufkleber“: über den alten setzen. */
export type SocialItem = { id: string; image: string | null; name: string; variant: string | null; price: number | null; priceNote: string | null; unit?: string | null; unitCount?: number | null; caption: string | null; printed: PrintedInfo; plan: PriceState["plan"] };
export type SocialData = SocialEvent & { subtitle: string | null; dateShort: string; weekdayShort: string; fileBase: string };

type Ctx = CanvasRenderingContext2D;
type Template = { key: string; title: string; hint: string; w: number; h: number; count: number; draw: (ctx: Ctx, i: number) => void };

const STORY = { w: 1080, h: 1920 };
const FEED = { w: 1080, h: 1350 };

// ---------- Zeichnen ----------

function textCenter(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, family = FONT, weight = "") {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

/** Grüne Preis-Plakette. */
function priceBadge(ctx: Ctx, text: string, cx: number, cy: number, size: number, maxW: number) {
  if (!text) return;
  const s = fitFont(ctx, text, maxW - size, size);
  const w = ctx.measureText(text).width + s * 1.1;
  const h = s * 1.5;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = s * 0.4;
  ctx.fillStyle = GREEN;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${s}px ${FONT}`;
  ctx.fillText(text, cx, cy + s * 0.05);
}

function tile(ctx: Ctx, p: SocialItem, img: HTMLImageElement | undefined, x: number, y: number, w: number, h: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.06);
  ctx.clip();
  if (img) drawPhoto(ctx, img, x, y, w, h, p.printed?.box);
  else {
    ctx.fillStyle = "#eef3f5";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(w * 0.09)}px ${FONT}`;
    wrap(ctx, p.name, w * 0.85, 3).forEach((l, k, all) => ctx.fillText(l, x + w / 2, y + h / 2 + (k - (all.length - 1) / 2) * w * 0.11));
  }
  ctx.restore();
  // Gemeinsame Preislogik: steht der Preis schon richtig im Foto, nicht doppelt; weicht er ab, Aufkleber über den alten.
  // „ersetzen“: alter Preis lässt sich nicht verdecken → kein zweiter Preis daneben.
  if (img && (p.plan === "foto" || p.plan === "ersetzen")) return;
  if (img && p.plan === "aufkleber" && p.printed?.box && drawSticker(ctx, img, x, y, w, h, "contain", p.printed.box, priceLabel(p), GREEN)) return;
  priceBadge(ctx, priceLabel(p), x + w / 2, y + h - Math.min(w, h) * 0.1, Math.round(Math.min(w, h) * 0.1), w * 0.9);
}

/** Kopf mit Farbband, Titel und Datum – für Story und Feed. */
function header(ctx: Ctx, d: SocialData, W: number, top: number, bandH: number) {
  brushBand(ctx, W * 0.04, top, W * 0.92, bandH, BAND);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const title = d.title.toUpperCase();
  ctx.font = `${Math.round(bandH * 0.3)}px ${FONT}`;
  const lines = wrap(ctx, title, W * 0.8, 2);
  const size = Math.min(...lines.map((l) => fitFont(ctx, l, W * 0.8, Math.round(bandH * (lines.length > 1 ? 0.26 : 0.34)))));
  ctx.font = `${size}px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(l, W * 0.1, top + bandH * 0.42 + i * size * 1.05));
  if (d.subtitle) {
    ctx.font = `${Math.round(bandH * 0.075)}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(d.subtitle.toUpperCase(), W * 0.9, top + bandH * 0.86);
  }
  // Datumskasten rechts unter dem Band
  const boxW = W * 0.46;
  const boxH = bandH * 0.52;
  const bx = W - boxW - W * 0.06;
  const by = top + bandH * 0.9;
  ctx.save();
  ctx.translate(bx + boxW / 2, by + boxH / 2);
  ctx.rotate(-0.02);
  ctx.fillStyle = PINK;
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  ctx.restore();
  textCenter(ctx, `${d.weekdayShort.toUpperCase()} ${d.dateShort}`, bx + boxW / 2, by + boxH * 0.47, Math.round(boxH * 0.34), INK);
  const second = [d.eventTime, d.location].filter(Boolean).join(" · ");
  if (second) {
    const s = fitFont(ctx, second, boxW * 0.9, Math.round(boxH * 0.2));
    textCenter(ctx, second, bx + boxW / 2, by + boxH * 0.82, s, INK);
  }
  return by + boxH;
}

function footer(ctx: Ctx, W: number, H: number, text: string) {
  if (!text) return;
  const s = fitFont(ctx, text, W * 0.86, Math.round(W * 0.034), "600", BODY_FONT);
  textCenter(ctx, text, W / 2, H - W * 0.05, s, "#56606a", BODY_FONT, "600");
}

function drawAnnounce(ctx: Ctx, d: SocialData, items: SocialItem[], imgs: Loaded, W: number, H: number, handle: string, total: number) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const story = H / W > 1.5;
  const bottomOfHead = header(ctx, d, W, H * 0.04, story ? H * 0.2 : H * 0.23);
  const cols = story ? 2 : 3;
  const rows = story ? 3 : 2;
  const pick = items.slice(0, cols * rows);
  const gap = W * 0.03;
  const line = `${total} Produkte gegen kleine Spende`;
  const lineSize = fitFont(ctx, line, W * 0.86, Math.round(W * 0.05));
  const lineBase = H - (handle ? W * 0.12 : W * 0.06);
  const areaTop = bottomOfHead + H * 0.025;
  const areaBottom = lineBase - lineSize * 1.4;
  const tw = (W * 0.92 - gap * (cols - 1)) / cols;
  const th = Math.min(tw * (story ? 1.1 : 1), (areaBottom - areaTop - gap * (rows - 1)) / rows);
  const startY = areaTop + (areaBottom - areaTop - (th * rows + gap * (rows - 1))) / 2;
  pick.forEach((p, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    tile(ctx, p, p.image ? imgs.get(p.image) : undefined, W * 0.04 + c * (tw + gap), startY + r * (th + gap), tw, th);
  });
  textCenter(ctx, line, W / 2, lineBase, lineSize, INK);
  footer(ctx, W, H, handle);
}

function drawProduct(ctx: Ctx, d: SocialData, p: SocialItem, img: HTMLImageElement | undefined, W: number, H: number, handle: string, counter: string) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const story = H / W > 1.5;
  // Kopfzeile mit Datum
  const barH = H * (story ? 0.07 : 0.075);
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, W, barH);
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `${Math.round(barH * 0.36)}px ${FONT}`;
  ctx.fillText(`${d.weekdayShort.toUpperCase()} ${d.dateShort}${d.eventTime ? ` · ${d.eventTime}` : ""}`, W * 0.05, barH / 2);
  ctx.textAlign = "right";
  if (counter) ctx.fillText(counter, W * 0.95, barH / 2);
  // Von unten nach oben: Account, Preis, Collage-Text, Variante, Name – das Foto bekommt den Rest.
  const nameSize = Math.round(W * (story ? 0.07 : 0.06));
  ctx.font = `${nameSize}px ${FONT}`;
  const nameLines = wrap(ctx, p.name, W * 0.88, 2);
  // Steht der Preis schon richtig im Foto, keine zweite Plakette; weicht er ab, kommt ein Aufkleber über den alten.
  const sticker = !!img && p.plan === "aufkleber" && !!p.printed?.box;
  const price = img && (p.plan === "foto" || p.plan === "ersetzen" || sticker) ? "" : priceLabel(p);
  const badge = Math.round(W * (story ? 0.085 : 0.066));
  const gap = W * 0.025;
  let bottom = H - (handle ? W * 0.11 : W * 0.04);
  const place: (() => void)[] = [];
  if (price) {
    const cy = bottom - badge * 0.75;
    place.push(() => priceBadge(ctx, price, W / 2, cy, badge, W * 0.8));
    bottom -= badge * 1.5 + gap;
  }
  if (p.caption) {
    const base = bottom - W * 0.008;
    place.push(() => {
      const s = fitFont(ctx, p.caption!, W * 0.86, Math.round(W * 0.034), "600", BODY_FONT);
      textCenter(ctx, p.caption!, W / 2, base, s, "#56606a", BODY_FONT, "600");
    });
    bottom -= W * 0.05;
  }
  if (p.variant) {
    const base = bottom - W * 0.008;
    place.push(() => textCenter(ctx, p.variant!, W / 2, base, Math.round(W * 0.04), "#56606a", BODY_FONT, "600"));
    bottom -= W * 0.055;
  }
  for (let k = nameLines.length - 1; k >= 0; k--) {
    const base = bottom - nameSize * 0.2;
    const line = nameLines[k];
    place.push(() => textCenter(ctx, line, W / 2, base, fitFont(ctx, line, W * 0.88, nameSize), INK));
    bottom -= nameSize * 1.12;
  }
  const photoH = Math.max(H * 0.3, bottom - gap - barH);
  if (img) {
    drawPhoto(ctx, img, 0, barH, W, photoH, p.printed?.box);
    if (sticker && !drawSticker(ctx, img, 0, barH, W, photoH, "contain", p.printed!.box!, priceLabel(p), GREEN)) priceBadge(ctx, priceLabel(p), W / 2, barH + photoH - badge, badge, W * 0.8);
  } else {
    ctx.fillStyle = "#eef3f5";
    ctx.fillRect(0, barH, W, photoH);
  }
  place.forEach((f) => f());
  footer(ctx, W, H, handle);
}

/** Preisliste (wie der Aushang) als Story-Bilder; teilt auf mehrere Seiten auf. */
function layoutPriceList(sections: FlyerSection[], W: number, H: number) {
  type Row = { kind: "head" | "line" | "sub"; text: string; right: string };
  const rows: Row[] = [];
  for (const s of sections) {
    rows.push({ kind: "head", text: s.category.toUpperCase(), right: "" });
    for (const l of s.lines) {
      rows.push({ kind: "line", text: l.text, right: [l.price, l.mhd].filter(Boolean).join(" · ") });
      for (const x of l.sub) rows.push({ kind: "sub", text: x.text, right: [x.price, x.mhd].filter(Boolean).join(" · ") });
    }
  }
  const lineH = { head: W * 0.075, line: W * 0.056, sub: W * 0.048 };
  const pages: Row[][] = [[]];
  let y = 0;
  const avail = H * 0.66;
  for (const r of rows) {
    if (y + lineH[r.kind] > avail && pages[pages.length - 1].length) {
      pages.push([]);
      y = 0;
    }
    pages[pages.length - 1].push(r);
    y += lineH[r.kind];
  }
  return { pages: pages.filter((p) => p.length), lineH };
}

function drawPriceList(ctx: Ctx, d: SocialData, page: ReturnType<typeof layoutPriceList>["pages"][number], lineH: Record<string, number>, W: number, H: number, handle: string, counter: string) {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  let y = header(ctx, d, W, H * 0.03, H * 0.17) + H * 0.05;
  for (const r of page) {
    ctx.textBaseline = "alphabetic";
    if (r.kind === "head") {
      y += lineH.head * 0.35;
      ctx.fillStyle = INK;
      ctx.textAlign = "left";
      ctx.font = `${Math.round(W * 0.046)}px ${FONT}`;
      ctx.fillText(r.text, W * 0.07, y);
      y += lineH.head * 0.65;
      continue;
    }
    const size = Math.round(r.kind === "line" ? W * 0.038 : W * 0.032);
    const left = r.kind === "line" ? W * 0.1 : W * 0.15;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(left - W * 0.025, y - size * 0.35, size * 0.16, 0, Math.PI * 2);
    if (r.kind === "line") ctx.fill();
    else {
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.font = `600 ${size}px ${BODY_FONT}`;
    ctx.textAlign = "right";
    const rightW = r.right ? ctx.measureText(r.right).width : 0;
    ctx.fillText(r.right, W * 0.93, y);
    ctx.textAlign = "left";
    const s = fitFont(ctx, r.text, W * 0.93 - left - rightW - W * 0.04, size, "600", BODY_FONT);
    ctx.fillText(r.text, left, y);
    ctx.font = `600 ${s}px ${BODY_FONT}`;
    y += lineH[r.kind];
  }
  if (counter) textCenter(ctx, counter, W / 2, H - W * 0.11, Math.round(W * 0.03), "#56606a", BODY_FONT, "600");
  footer(ctx, W, H, handle);
}

// ---------- Oberfläche ----------

function Preview({ t, i, ready }: { t: Template; i: number; ready: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !ready) return;
    const scale = 0.28;
    c.width = Math.round(t.w * scale);
    c.height = Math.round(t.h * scale);
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    t.draw(ctx, i);
  }, [t, i, ready]);
  return <canvas ref={ref} style={{ width: "100%", aspectRatio: `${t.w} / ${t.h}`, borderRadius: 6, background: "var(--row)", display: "block" }} />;
}

async function renderFiles(t: Template, fileBase: string, only?: number): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < t.count; i++) {
    if (only !== undefined && i !== only) continue;
    const c = document.createElement("canvas");
    c.width = t.w;
    c.height = t.h;
    t.draw(c.getContext("2d")!, i);
    out.push(new File([await toBlob(c)], `${fileBase}-${t.key}${t.count > 1 ? `-${String(i + 1).padStart(2, "0")}` : ""}.jpg`, { type: "image/jpeg" }));
    c.width = c.height = 0;
  }
  return out;
}

function videoMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"]) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

const USES_HIGHLIGHTS: SocialFormat[] = ["story", "feed", "karussell", "story-produkte", "video", "texte"];

export function SocialStudio({ eventId, data, items, sections, format: initialFormat, highlightIds, settings, warnings }: {
  eventId: string;
  data: SocialData;
  items: SocialItem[];
  sections: FlyerSection[];
  format: SocialFormat;
  highlightIds: string[];
  settings: { handle: string; tags: string };
  warnings: string[];
}) {
  const [format, setFormat] = useState<SocialFormat>(initialFormat);
  const [imgs, setImgs] = useState<Loaded | null>(null);
  const [handle, setHandle] = useState(settings.handle);
  const [tags, setTags] = useState(settings.tags);
  // Alle gespeicherten Highlights behalten – auch von Produkten, die gerade nicht auf der Collage sind.
  const [picked, setPicked] = useState<string[]>(highlightIds);
  const visiblePicked = picked.filter((id) => items.some((i) => i.id === id));
  const [highlights, setHighlights] = useState(6);
  const [message, setMessage] = useState("");
  const [video, setVideo] = useState<{ busy: boolean; progress: number; url?: string; file?: File }>({ busy: false, progress: 0 });
  const [secondsPer, setSecondsPer] = useState(1.5);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare("canShare" in navigator && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
  }, []);
  // Gewähltes Format in der Adresse merken (Zurück-Knopf, Lesezeichen).
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set("format", format);
    history.replaceState(history.state, "", u);
  }, [format]);
  // Erst nach kurzer Tipp-Pause neu zeichnen – sonst rechnet jede Taste alle Vorschauen neu (langsam am Handy).
  const [drawHandle, setDrawHandle] = useState(settings.handle);
  useEffect(() => {
    const t = setTimeout(() => setDrawHandle(handle), 500);
    return () => clearTimeout(t);
  }, [handle]);
  // Account und Hashtags fürs ganze Team speichern (statt nur in diesem Browser).
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const t = setTimeout(() => void saveSocialSettings({ handle, tags }).catch(() => {}), 900);
    return () => clearTimeout(t);
  }, [handle, tags]);
  const firstPick = useRef(true);
  useEffect(() => {
    if (firstPick.current) {
      firstPick.current = false;
      return;
    }
    const t = setTimeout(() => void saveHighlights(eventId, picked).catch(() => setMessage("Highlights konnten nicht gespeichert werden.")), 600);
    return () => clearTimeout(t);
  }, [eventId, picked]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await loadFonts();
      const l = await loadImages(items.map((i) => i.image));
      if (alive) setImgs(l);
    })();
    return () => {
      alive = false;
    };
  }, [items]);

  // Reihenfolge: ausgewählte Highlights in ihrer Reihenfolge, dann Produkte mit Foto, dann ohne.
  const ordered = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const first = picked.map((id) => byId.get(id)).filter((i): i is SocialItem => !!i);
    const rest = items.filter((i) => !picked.includes(i.id));
    return [...first, ...rest.filter((i) => i.image), ...rest.filter((i) => !i.image)];
  }, [items, picked]);
  const extraTags = tags.split(/[\s,#]+/).filter(Boolean);
  const hl = visiblePicked.length ? ordered.slice(0, visiblePicked.length) : ordered.slice(0, highlights);

  const templates = useMemo<Template[]>(() => {
    if (!imgs) return [];
    const img = (p: SocialItem) => (p.image ? imgs.get(p.image) : undefined);
    const carousel = ordered.slice(0, 19);
    const list = layoutPriceList(sections, STORY.w, STORY.h);
    return [
      { key: "story", title: "Story – Ankündigung", hint: "9:16 für Instagram-/Facebook-Story und TikTok", ...STORY, count: 1, draw: (ctx) => drawAnnounce(ctx, data, ordered, imgs, STORY.w, STORY.h, drawHandle, items.length) },
      { key: "feed", title: "Feed-Beitrag – Titelbild", hint: "4:5 für den Instagram-Feed", ...FEED, count: 1, draw: (ctx) => drawAnnounce(ctx, data, ordered, imgs, FEED.w, FEED.h, drawHandle, items.length) },
      {
        key: "karussell",
        title: "Karussell – ein Produkt pro Bild",
        hint: `4:5, zum Wischen im Feed. Titelbild + bis zu 19 Produkte${ordered.length > 19 ? ` (von ${ordered.length})` : ""}`,
        ...FEED,
        count: carousel.length + 1,
        draw: (ctx, i) => (i === 0 ? drawAnnounce(ctx, data, ordered, imgs, FEED.w, FEED.h, drawHandle, items.length) : drawProduct(ctx, data, carousel[i - 1], img(carousel[i - 1]), FEED.w, FEED.h, drawHandle, `${i}/${carousel.length}`)),
      },
      {
        key: "story-produkte",
        title: "Story-Serie – ein Produkt pro Story",
        hint: `9:16, die ${hl.length} Highlights`,
        ...STORY,
        count: hl.length,
        draw: (ctx, i) => drawProduct(ctx, data, hl[i], img(hl[i]), STORY.w, STORY.h, drawHandle, `${i + 1}/${hl.length}`),
      },
      {
        key: "preisliste",
        title: "Preisliste als Bild",
        hint: "9:16, der Aushang zum Posten (mit MHD)",
        ...STORY,
        count: list.pages.length,
        draw: (ctx, i) => drawPriceList(ctx, data, list.pages[i], list.lineH, STORY.w, STORY.h, drawHandle, list.pages.length > 1 ? `Seite ${i + 1}/${list.pages.length}` : ""),
      },
    ];
  }, [imgs, ordered, hl, sections, data, drawHandle, items.length]);

  /** Vor dem Speichern/Teilen: offene Punkte nennen und nachfragen. */
  const okToExport = () => !warnings.length || confirm(`Vor dem Export bitte beachten:\n\n• ${warnings.join("\n• ")}\n\nTrotzdem speichern?`);
  const save = async (t: Template, only?: number) => okToExport() && downloadFiles(await renderFiles(t, data.fileBase, only));
  const share = async (t: Template) => {
    if (!okToExport()) return;
    const files = await renderFiles(t, data.fileBase);
    if (!(await shareFiles(files, data.title))) setMessage("Teilen geht in diesem Browser nicht – bitte speichern und in der App hochladen.");
  };

  /** Reel/TikTok: Titelbild, dann jedes Highlight, dann die Preisliste – als Video aufgenommen. */
  async function makeVideo() {
    const mime = videoMime();
    if (!mime || !imgs) {
      setMessage("Dieser Browser kann keine Videos erzeugen – bitte Chrome, Edge oder Safari (aktuell) verwenden.");
      return;
    }
    if (!okToExport()) return;
    const W = STORY.w;
    const H = STORY.h;
    const slides: { draw: (c: Ctx) => void; secs: number }[] = [
      { draw: (c) => drawAnnounce(c, data, ordered, imgs, W, H, handle, items.length), secs: 2.5 },
      ...hl.map((p, i) => ({ draw: (c: Ctx) => drawProduct(c, data, p, p.image ? imgs.get(p.image) : undefined, W, H, handle, `${i + 1}/${hl.length}`), secs: secondsPer })),
      ...(templates.find((t) => t.key === "preisliste")?.count ? [{ draw: (c: Ctx) => templates.find((t) => t.key === "preisliste")!.draw(c, 0), secs: 3 }] : []),
    ];
    const stage = document.createElement("canvas");
    stage.width = W;
    stage.height = H;
    const sctx = stage.getContext("2d")!;
    const stream = stage.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    setVideo({ busy: true, progress: 0 });
    rec.start(500);
    const total = slides.reduce((n, s) => n + s.secs, 0);
    let elapsed = 0;
    for (const s of slides) {
      // Folie einmal vorzeichnen, dann leicht heranzoomen (wirkt lebendiger).
      const pre = document.createElement("canvas");
      pre.width = W;
      pre.height = H;
      s.draw(pre.getContext("2d")!);
      const start = performance.now();
      while (performance.now() - start < s.secs * 1000) {
        const t = (performance.now() - start) / (s.secs * 1000);
        const z = 1 + 0.04 * t;
        sctx.fillStyle = "#fff";
        sctx.fillRect(0, 0, W, H);
        sctx.drawImage(pre, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
        setVideo((v) => ({ ...v, progress: Math.min(1, (elapsed + t * s.secs) / total) }));
        await new Promise((r) => setTimeout(r, 1000 / 30));
      }
      elapsed += s.secs;
      pre.width = pre.height = 0;
    }
    rec.stop();
    await done;
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    const file = new File(chunks, `${data.fileBase}-reel.${ext}`, { type: mime.split(";")[0] });
    setVideo({ busy: false, progress: 1, url: URL.createObjectURL(file), file });
    if (ext === "webm") setMessage("Hinweis: Dieser Browser speichert das Video als WebM. Instagram/TikTok nehmen MP4 – am besten mit Chrome (aktuell) oder Safari erstellen.");
  }

  const ig = instagramCaption(data, ordered, extraTags);
  const tt = tiktokCaption(data, ordered, extraTags);
  const t = templates.find((x) => x.key === format);
  const move = (id: string, d: -1 | 1) =>
    setPicked((prev) => {
      const i = prev.indexOf(id);
      // Mit dem nächsten sichtbaren Highlight tauschen (ausgeblendete bleiben, wo sie sind).
      let j = i + d;
      while (j >= 0 && j < prev.length && !items.some((x) => x.id === prev[j])) j += d;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@600&display=swap" precedence="default" />
      <div className="format-chips" role="tablist" aria-label="Format">
        {FORMATS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={format === f.key} className={`format-chip${format === f.key ? " active" : ""}`} onClick={() => setFormat(f.key)}>
            <strong>{f.label}</strong><span>{f.hint}</span>
          </button>
        ))}
      </div>

      <section className="card card-pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label className="label" htmlFor="sh">Euer Account (unten auf den Bildern)</label>
          <input className="input" id="sh" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@foodsharing_musterstadt" />
        </div>
        {format === "texte" && (
          <div className="field" style={{ minWidth: 200, flex: 1 }}>
            <label className="label" htmlFor="st">Eigene Hashtags</label>
            <input className="input" id="st" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="z. B. musterstadt tafel" />
          </div>
        )}
        {(format === "story-produkte" || format === "video") && visiblePicked.length === 0 && (
          <div className="field">
            <label className="label" htmlFor="sp">Anzahl Highlights</label>
            <select className="select" id="sp" value={highlights} onChange={(e) => setHighlights(Number(e.target.value))}>
              {[3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n} Produkte</option>)}
            </select>
          </div>
        )}
        <span className="small muted" style={{ paddingBottom: 10 }}>Account und Hashtags gelten fürs ganze Team.</span>
      </section>

      {USES_HIGHLIGHTS.includes(format) && (
        <details className="card card-pad highlight-picker" open={visiblePicked.length > 0 || undefined}>
          <summary><strong>Highlights auswählen und sortieren</strong> <span className="small muted">{visiblePicked.length ? `${visiblePicked.length} ausgewählt – kommen zuerst` : "keine ausgewählt – es gilt die Reihenfolge der Produktliste (Fotos zuerst)"}</span></summary>
          {visiblePicked.length > 0 && (
            <ol className="hl-order">
              {visiblePicked.map((id, i) => {
                const it = items.find((x) => x.id === id);
                if (!it) return null;
                return (
                  <li key={id}>
                    {it.image ? <img src={`${it.image}?w=200`} alt="" className="thumb thumb-sm" /> : <span className="thumb thumb-sm" />}
                    <span className="wrap-anywhere" style={{ flex: 1 }}>{it.name}</span>
                    <button type="button" className="btn btn-small" onClick={() => move(id, -1)} disabled={i === 0} aria-label="Nach vorne">↑</button>
                    <button type="button" className="btn btn-small" onClick={() => move(id, 1)} disabled={i === visiblePicked.length - 1} aria-label="Nach hinten">↓</button>
                    <button type="button" className="btn btn-small" onClick={() => setPicked((p) => p.filter((x) => x !== id))} aria-label="Entfernen">✕</button>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="hl-grid">
            {items.filter((i) => !picked.includes(i.id)).map((i) => (
              <button key={i.id} type="button" className="hl-pick" onClick={() => setPicked((p) => [...p, i.id])} title="Als Highlight hinzufügen">
                {i.image ? <img src={`${i.image}?w=200`} alt="" /> : <span className="thumb-empty">kein Foto</span>}
                <span>{i.name}</span>
              </button>
            ))}
          </div>
        </details>
      )}

      {warnings.length > 0 && <div className="notice notice-warn"><strong>Vor dem Export:</strong> {warnings.join(" · ")}</div>}
      {message && <div className="notice notice-warn">{message}</div>}
      {!imgs && format !== "texte" && <div className="notice notice-info">Lade Fotos …</div>}

      {t && (
        <section className="card card-pad stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div><h2>{t.title}</h2><div className="small muted">{t.hint} · {t.count} {t.count === 1 ? "Bild" : "Bilder"}</div></div>
            <div style={{ display: "flex", gap: 6 }}>
              {canShare && <button className="btn btn-small btn-primary" type="button" onClick={() => share(t)}>Teilen …</button>}
              <button className={`btn btn-small${canShare ? "" : " btn-primary"}`} type="button" onClick={() => save(t)}>{t.count > 1 ? `Alle ${t.count} speichern` : "Speichern"}</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${t.h > t.w * 1.5 ? 140 : 170}px, 1fr))`, gap: 10 }}>
            {Array.from({ length: Math.min(t.count, 20) }, (_, i) => (
              <button key={i} type="button" onClick={() => save(t, i)} title="Dieses Bild speichern" style={{ border: 0, padding: 0, background: "none", cursor: "pointer" }}>
                <Preview t={t} i={i} ready={!!imgs} />
              </button>
            ))}
            {t.count > 20 && <div className="small muted" style={{ alignSelf: "center" }}>+ {t.count - 20} weitere</div>}
          </div>
        </section>
      )}

      {format === "video" && imgs && (
        <section className="card card-pad stack" style={{ gap: 10 }}>
          <div><h2>Video für Reels & TikTok</h2><div className="small muted">9:16 · Titelbild, dann {hl.length} Highlights, dann die Preisliste · ohne Ton (Musik in der App hinzufügen)</div></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="small" htmlFor="vs">Sekunden pro Produkt</label>
            <select className="select" id="vs" value={secondsPer} onChange={(e) => setSecondsPer(Number(e.target.value))} style={{ width: 90 }} disabled={video.busy}>
              {[1, 1.5, 2, 3].map((s) => <option key={s} value={s}>{String(s).replace(".", ",")} s</option>)}
            </select>
            <button className="btn btn-primary" type="button" onClick={makeVideo} disabled={video.busy}>{video.busy ? `Nehme auf … ${Math.round(video.progress * 100)} %` : "Video erstellen"}</button>
            {video.file && !video.busy && (
              <>
                <button className="btn" type="button" onClick={() => downloadFiles([video.file!])}>Video speichern</button>
                {canShare && <button className="btn" type="button" onClick={async () => { if (!(await shareFiles([video.file!], data.title))) setMessage("Teilen geht in diesem Browser nicht – bitte speichern."); }}>Teilen …</button>}
              </>
            )}
          </div>
          {video.busy && <div className="small muted">Das Video wird in Echtzeit aufgenommen (ca. {Math.round(2.5 + hl.length * secondsPer + 3)} Sekunden). Bitte den Tab geöffnet lassen.</div>}
          {video.url && !video.busy && <video src={video.url} controls playsInline style={{ width: 220, borderRadius: 8, background: "#000" }} />}
        </section>
      )}

      {format === "texte" && (
        <section className="card card-pad stack" style={{ gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><h2>Text für Instagram</h2><CopyButton text={ig} label="Kopieren" /></div>
          <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--sans)", background: "var(--surface-2)", padding: 12, borderRadius: 8, maxHeight: 260, overflow: "auto" }}>{ig}</pre>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}><h2>Text für TikTok</h2><CopyButton text={tt} label="Kopieren" /></div>
          <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "var(--sans)", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>{tt}</pre>
        </section>
      )}
    </>
  );
}
