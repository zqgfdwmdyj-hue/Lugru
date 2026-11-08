import { execFileSync } from "node:child_process";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { mediumFuer } from "@/lib/druck/brother";
import { RASTER, zellen } from "@/lib/druck/logic";

vi.mock("server-only", () => ({}));

// PDFs aus Seller Central → Druckbilder (poppler + sharp). Erfundene Inhalte (FBA15TEST…, X00TEST…).

const popplerDa = (() => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const mm = (x: number) => (x / 25.4) * 72;

async function kartonlabels(seiten: number) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= seiten; i++) {
    const p = doc.addPage([288, 432]);
    p.drawText(`FBA15TEST01X U00000${i}`, { x: 20, y: 380, size: 16, font: f });
    p.drawRectangle({ x: 20, y: 200, width: 248, height: 120, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

async function fnskuBogen(belegt: number) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  const r = RASTER["27"];
  for (let i = 0; i < belegt; i++) {
    const s = i % r.spalten;
    const z = Math.floor(i / r.spalten);
    const x = mm(r.randLinksMm + s * (r.breiteMm + r.abstandXMm)) + 8;
    const yOben = mm(r.randObenMm + z * (r.hoeheMm + r.abstandYMm));
    p.drawRectangle({ x, y: 841.89 - yOben - 40, width: 120, height: 25, color: rgb(0, 0, 0) });
    p.drawText(`X00TEST${String(i).padStart(3, "0")}`, { x, y: 841.89 - yOben - 55, size: 9, font: f });
  }
  return doc.save();
}

describe.skipIf(!popplerDa)("Seller-Central-PDFs", () => {
  it("Kartonlabels 102 × 152: Art, Sendungsnummer, je Seite ein 102-mm-Druckbild", async () => {
    const { pdfErkennen, seitenAlsEtiketten } = await import("@/lib/druck/pdf");
    const pdf = await kartonlabels(3);
    const e = await pdfErkennen(pdf);
    expect(e).toMatchObject({ art: "kartonlabel", seiten: 3, sendungsnummer: "FBA15TEST01X", raster: null });
    const m = mediumFuer("102x152")!;
    const bilder = await seitenAlsEtiketten(pdf, m);
    expect(bilder.length).toBe(3);
    for (const b of bilder) {
      expect(b.breite).toBe(1164);
      expect(b.hoehe).toBe(1660);
      expect(b.pixel.some((p) => p < 128)).toBe(true);
    }
  }, 60_000);

  it("FNSKU-Bogen A4 (27er): nur belegte Felder werden zu 62-mm-Etiketten", async () => {
    const { pdfErkennen, bogenAlsEtiketten } = await import("@/lib/druck/pdf");
    const pdf = await fnskuBogen(5);
    const e = await pdfErkennen(pdf);
    expect(e.art).toBe("fnsku_bogen");
    expect(e.fnskus).toBe(5);
    expect(e.raster?.id).toBe("27");
    const bilder = await bogenAlsEtiketten(pdf, RASTER["27"], mediumFuer("62x29")!);
    expect(bilder.length).toBe(5);
    expect(bilder[0]).toMatchObject({ breite: 696, hoehe: 271 });
    expect(zellen(RASTER["27"], 300).length).toBe(27);
  }, 60_000);

  it("A4 ohne FNSKU → unbekannt; andere Größe → 102-mm-Label", async () => {
    const { pdfErkennen } = await import("@/lib/druck/pdf");
    const a4 = await PDFDocument.create();
    a4.addPage([595.28, 841.89]);
    expect((await pdfErkennen(await a4.save())).art).toBe("unbekannt");
    const dhl = await PDFDocument.create();
    dhl.addPage([mm(100), mm(199)]);
    expect((await pdfErkennen(await dhl.save())).art).toBe("label_102");
  }, 60_000);
});

describe("Druckbilder", () => {
  it("PNG → Graustufen in Mediengröße (weißer Rand, Seitenverhältnis bleibt)", async () => {
    const sharp = (await import("sharp")).default;
    const { pngZuGraubild, graubildZuPng } = await import("@/lib/druck/etiketten");
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#000000" } }).png().toBuffer();
    const g = await pngZuGraubild(png, 696, 271);
    expect(g).toMatchObject({ breite: 696, hoehe: 271 });
    expect(g.pixel[0]).toBe(255); // Rand oben links weiß (Seitenverhältnis 2:1 → seitlich Rand)
    expect(g.pixel[135 * 696 + 348]).toBe(0); // Mitte schwarz
    const zurueck = await sharp(await graubildZuPng(g)).metadata();
    expect([zurueck.width, zurueck.height]).toEqual([696, 271]);
  });
});
