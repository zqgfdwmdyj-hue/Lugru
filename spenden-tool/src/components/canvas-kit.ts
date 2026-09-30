"use client";

// Gemeinsame Zeichen-Bausteine für Collage und Social-Media-Vorlagen (Canvas im Browser).

export const FONT = '"Archivo Black", "Arial Black", Impact, sans-serif';
export const BODY_FONT = '"Archivo", "Arial", sans-serif';
export const BAND = "#bfe3ef";
export const PINK = "#f2e1da";
export const INK = "#1b1d1f";
export const GREEN = "#1f7a4d";

export type Loaded = Map<string, HTMLImageElement>;

/** Fotos laden; kaputte oder fehlende werden übersprungen (dann Textkachel). */
export async function loadImages(urls: (string | null)[]): Promise<Loaded> {
  const map: Loaded = new Map();
  await Promise.all(
    [...new Set(urls.filter((u): u is string => !!u))].map(async (u) => {
      const img = new Image();
      img.src = u;
      try {
        await img.decode();
        map.set(u, img);
      } catch {
        // Bild fehlt oder ist kaputt
      }
    }),
  );
  return map;
}

export async function loadFonts() {
  try {
    await Promise.race([Promise.all([document.fonts.load(`40px "Archivo Black"`), document.fonts.load(`600 40px "Archivo"`)]), new Promise((r) => setTimeout(r, 2500))]);
  } catch {}
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Bild in ein Rechteck zeichnen: „cover“ füllt (schneidet ab), „contain“ zeigt es ganz. */
export function drawImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, mode: "cover" | "contain") {
  const s = mode === "cover" ? Math.max(w / img.naturalWidth, h / img.naturalHeight) : Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Foto ganz zeigen, dahinter dasselbe Foto unscharf als Hintergrund. */
export function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = "blur(28px) brightness(0.9)";
  drawImage(ctx, img, x - 40, y - 40, w + 80, h + 80, "cover");
  ctx.filter = "none";
  drawImage(ctx, img, x, y, w, h, "contain");
  ctx.restore();
}

/** Schriftgröße so wählen, dass der Text in die Breite passt. */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = "", family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 10 && ctx.measureText(text).width > maxWidth) {
    s = Math.floor(s * 0.92);
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/\s*\S*$/, "") + " …";
    return cut;
  }
  return lines;
}

/** Unregelmäßiges Farbband wie auf dem Aushang. */
export function brushBand(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const pts = [[0.01, 0.18], [0.12, 0.06], [0.3, 0.1], [0.52, 0.02], [0.74, 0.08], [0.97, 0], [1, 0.4], [0.98, 0.78], [0.8, 0.9], [0.55, 0.84], [0.3, 1], [0.08, 0.88], [0, 0.62]];
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h)));
  ctx.closePath();
  ctx.fill();
}

export function toBlob(canvas: HTMLCanvasElement, type = "image/jpeg"): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Bild konnte nicht erzeugt werden"))), type, 0.92));
}

export async function downloadFiles(files: File[]) {
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Teilen-Menü des Handys (Instagram, TikTok, WhatsApp …); false, wenn der Browser das nicht kann. */
export async function shareFiles(files: File[], title: string): Promise<boolean> {
  if (!navigator.canShare?.({ files })) return false;
  try {
    await navigator.share({ files, title });
  } catch {
    // abgebrochen
  }
  return true;
}
