import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { jpegsToPdf, pageSize } from "@/lib/pdf";

describe("PDF aus Collage-Bildern", () => {
  it("baut eine gültige Datei mit einer Seite je Bild", async () => {
    const jpeg = async (color: string) => new Uint8Array(await sharp({ create: { width: 400, height: 500, channels: 3, background: color } }).jpeg().toBuffer());
    const pdf = jpegsToPdf([{ jpeg: await jpeg("#c00"), width: 400, height: 500 }, { jpeg: await jpeg("#0c0"), width: 400, height: 500 }]);
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Count 2");
    // Jeder Eintrag der Querverweistabelle zeigt genau auf den Anfang seines Objekts.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(xref).split("\n").slice(3).filter((l) => / n $/.test(l));
    entries.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10)), Number(l.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });

  it("nimmt für A4 das echte Format, sonst das Bildverhältnis", () => {
    expect(pageSize(1080, 1350, true)).toEqual({ w: 595.28, h: 841.89 });
    expect(pageSize(1080, 1350, false).h).toBeCloseTo(744.1, 1);
  });
});
