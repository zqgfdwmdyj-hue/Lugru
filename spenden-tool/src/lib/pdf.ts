// Kleinster möglicher PDF-Baukasten: mehrere JPEG-Bilder als Seiten einer Datei – ohne zusätzliche Bibliothek.
// So lassen sich alle Collage-Bilder mit einem Klick als eine Datei speichern (Safari fragt sonst bei jedem Bild
// nach und verwirft weitere Downloads).

export type PdfPage = { jpeg: Uint8Array; width: number; height: number };

/** Seitengröße in Punkt (1/72 Zoll): A4 hoch, sonst A4-Breite mit dem Seitenverhältnis des Bildes. */
export function pageSize(width: number, height: number, a4: boolean): { w: number; h: number } {
  const W = 595.28;
  if (a4) return { w: W, h: 841.89 };
  return { w: W, h: Math.round(((W * height) / width) * 100) / 100 };
}

export function jpegsToPdf(pages: PdfPage[], opts: { a4?: boolean } = {}): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1 = Katalog, 2 = Seitenliste, danach je Seite: Seite, Inhalt, Bild
  const pageObj = (i: number) => 3 + i * 3;
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const { w, h } = pageSize(p.width, p.height, !!opts.a4);
    // Bild einpassen und mittig setzen
    const s = Math.min(w / p.width, h / p.height);
    const dw = p.width * s;
    const dh = p.height * s;
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${((w - dw) / 2).toFixed(2)} ${((h - dh) / 2).toFixed(2)} cm /Im0 Do Q`;
    object(pageObj(i), () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pageObj(i) + 2} 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`),
    );
    object(pageObj(i) + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(pageObj(i) + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push("\nendstream");
    });
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
