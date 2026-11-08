import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { Graubild, Medium } from "./brother";
import { pngZuGraubild } from "./etiketten";
import { fnskusImText, pdfArt, rasterRaten, sendungsnummer, zellen, type Raster } from "./logic";

// PDFs aus Seller Central (FBA-Kartonlabels 102 × 152 mm, FNSKU-Bögen A4 mit 27/40 Etiketten) und 102-mm-Labels
// (DHL/Internetmarke) → Druckbilder. Umwandlung mit poppler (pdftoppm/pdftotext), Zuschnitt mit sharp.

const DPI = 300;

function lauf(cmd: string, args: string[], ms = 60_000): Promise<string> {
  return new Promise((ok, nein) =>
    execFile(cmd, args, { timeout: ms, maxBuffer: 32 << 20 }, (err, out) => {
      if (err) nein((err as NodeJS.ErrnoException).code === "ENOENT" ? new Error("PDF-Umwandlung nicht verfügbar (poppler-utils fehlt auf dem Server)") : err);
      else ok(String(out));
    }),
  );
}

async function mitTemp<T>(pdf: Uint8Array, f: (datei: string, ordner: string) => Promise<T>): Promise<T> {
  const ordner = await mkdtemp(path.join(tmpdir(), "druck-pdf-"));
  try {
    const datei = path.join(ordner, "eingang.pdf");
    await writeFile(datei, pdf);
    return await f(datei, ordner);
  } finally {
    await rm(ordner, { recursive: true, force: true });
  }
}

export type PdfErkennung = { art: "kartonlabel" | "fnsku_bogen" | "label_102" | "unbekannt"; seiten: number; raster: Raster | null; sendungsnummer: string | null; fnskus: number; text: string };

/** Seitengröße + Text → Art der Datei, Raster des Bogens, Sendungsnummer (FBA…). */
export async function pdfErkennen(pdf: Uint8Array): Promise<PdfErkennung> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const seiten = doc.getPages();
  if (!seiten.length) return { art: "unbekannt", seiten: 0, raster: null, sendungsnummer: null, fnskus: 0, text: "" };
  const { width, height } = seiten[0].getSize();
  const text = await mitTemp(pdf, (d) => lauf("pdftotext", ["-layout", d, "-"])).catch(() => "");
  const groesse = pdfArt(width, height);
  const fnskus = fnskusImText(text);
  const proSeite = Math.ceil(fnskus / seiten.length);
  const art = groesse === "kartonlabel" ? "kartonlabel" : groesse === "a4" ? (fnskus > 0 ? "fnsku_bogen" : "unbekannt") : "label_102";
  return { art, seiten: seiten.length, raster: art === "fnsku_bogen" ? rasterRaten(proSeite) : null, sendungsnummer: sendungsnummer(text), fnskus, text };
}

async function seitenPng(pdf: Uint8Array, dpi = DPI): Promise<Buffer[]> {
  return mitTemp(pdf, async (d, ordner) => {
    await lauf("pdftoppm", ["-r", String(dpi), "-png", d, path.join(ordner, "s")], 180_000);
    const dateien = (await readdir(ordner)).filter((n) => /^s-\d+\.png$/.test(n)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
    return Promise.all(dateien.map((n) => readFile(path.join(ordner, n))));
  });
}

/** Jede Seite (Kartonlabel bzw. 102-mm-Label) auf das Medium einpassen. */
export async function seitenAlsEtiketten(pdf: Uint8Array, medium: Medium): Promise<Graubild[]> {
  const pngs = await seitenPng(pdf);
  return Promise.all(pngs.map((p) => pngZuGraubild(p, medium.punkteBreite, medium.punkteLaenge || null)));
}

/** FNSKU-Bogen A4 → einzelne 62-mm-Etiketten (leere Felder werden übersprungen). */
export async function bogenAlsEtiketten(pdf: Uint8Array, raster: Raster, medium: Medium): Promise<Graubild[]> {
  const pngs = await seitenPng(pdf);
  const out: Graubild[] = [];
  for (const p of pngs) {
    const meta = await sharp(p).metadata();
    for (const z of zellen(raster, DPI)) {
      if (z.x + z.b > (meta.width ?? 0) || z.y + z.h > (meta.height ?? 0)) continue;
      const teil = await sharp(p).extract({ left: z.x, top: z.y, width: z.b, height: z.h }).flatten({ background: "#ffffff" }).png().toBuffer();
      const st = await sharp(teil).toColourspace("b-w").stats();
      if ((st.channels[0]?.mean ?? 255) > 252) continue; // leeres Feld
      out.push(await pngZuGraubild(teil, medium.punkteBreite, medium.punkteLaenge || null));
    }
  }
  return out;
}
