import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { safe } from "@/lib/ebay/invoices/pdf";

// Abholschein (A4): welche Paletten wer wann abgeholt hat – mit Unterschrift des Abholers.

export type PickupPdfInput = {
  sender: { name?: string; street?: string; houseNo?: string; zip?: string; city?: string; phone?: string; email?: string };
  number: string;
  day: string;
  customer: string | null;
  pickedBy: string;
  plate?: string | null;
  note?: string | null;
  pallets: { code: string; location?: string | null; contents?: string | null; inAt: string }[];
  signaturePng?: Uint8Array | null;
  /** Abholung zurückgenommen – der Schein bleibt erhalten, ist aber deutlich markiert. */
  cancelled?: string | null;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.82, 0.84, 0.88);
const date = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export async function buildPickupPdf(input: PickupPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Abholschein ${input.number}`);
  doc.setProducer("Seller-System");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const W = A4.w - 2 * M;
  const text = (t: string, x: number, size = 10, font: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y, size, font, color });
  const fit = (t: string, font: PDFFont, size: number, max: number) => {
    let s = safe(t);
    while (s.length > 1 && font.widthOfTextAtSize(s, size) > max) s = s.slice(0, -1);
    return s;
  };

  const s = input.sender;
  text(s.name || "Palettenlager", M, 13, bold);
  y -= 14;
  const addr = [[s.street, s.houseNo].filter(Boolean).join(" "), [s.zip, s.city].filter(Boolean).join(" "), s.phone, s.email].filter(Boolean).join(" · ");
  if (addr) { text(addr, M, 8.5, reg, MUTED); y -= 12; }
  y -= 26;
  text("Abholschein", M, 20, bold);
  if (input.cancelled) text(`ZURÜCKGENOMMEN – ${input.cancelled}`, M + 150, 12, bold, rgb(0.7, 0.14, 0.1));
  y -= 26;
  const meta: [string, string][] = [
    ["Nr.", input.number],
    ["Datum", date(input.day)],
    ["Kunde", input.customer ?? "–"],
    ["Abgeholt von", input.pickedBy],
    ...(input.plate ? ([["Kennzeichen", input.plate]] as [string, string][]) : []),
    ["Anzahl Paletten", String(input.pallets.length)],
  ];
  for (const [k, v] of meta) {
    text(k, M, 10, reg, MUTED);
    text(v, M + 110, 10, bold);
    y -= 15;
  }
  y -= 12;
  const cols = { code: M, place: M + 110, what: M + 190, inn: M + W - 70 };
  const header = () => {
    text("Palette", cols.code, 9, bold, MUTED);
    text("Stellplatz", cols.place, 9, bold, MUTED);
    text("Inhalt", cols.what, 9, bold, MUTED);
    text("Eingelagert", cols.inn, 9, bold, MUTED);
    y -= 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + W, y: y + 2 }, thickness: 0.6, color: LINE });
    y -= 12;
  };
  header();
  for (const p of input.pallets) {
    if (y < 190) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - M;
      header();
    }
    text(fit(p.code, bold, 10, 105), cols.code, 10, bold);
    text(p.location ?? "–", cols.place, 10);
    text(fit(p.contents ?? "", reg, 9.5, cols.inn - cols.what - 10), cols.what, 9.5);
    text(date(p.inAt), cols.inn, 9.5);
    y -= 15;
  }
  if (input.note) {
    y -= 8;
    text(fit(`Hinweis: ${input.note}`, reg, 9.5, W), M, 9.5);
    y -= 14;
  }
  y -= 20;
  text("Die oben genannten Paletten wurden vollständig und in äußerlich ordnungsgemäßem Zustand übernommen.", M, 9.5);
  y -= 70;
  if (input.signaturePng) {
    try {
      const img = await doc.embedPng(input.signaturePng);
      const h = 60;
      const w = Math.min(220, (img.width / img.height) * h);
      page.drawImage(img, { x: M, y: y + 4, width: w, height: h });
    } catch {
      // ohne Bild weiter
    }
  }
  page.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 0.8, color: INK });
  page.drawLine({ start: { x: M + W - 160, y }, end: { x: M + W, y }, thickness: 0.8, color: INK });
  y -= 12;
  text(`Unterschrift ${input.pickedBy}`, M, 8.5, reg, MUTED);
  text(`Ort, Datum: ${date(input.day)}`, M + W - 160, 8.5, reg, MUTED);
  return doc.save();
}
