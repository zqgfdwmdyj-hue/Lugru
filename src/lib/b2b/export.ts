import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { safe } from "@/lib/ebay/invoices/pdf";
import type { ExportZeile } from "./ablauf";

// Übergabe an das Prep-Tool: neutrale Spalten (das Tool selbst können wir nicht ändern). CSV mit Semikolon und
// UTF-8-BOM (Excel öffnet Umlaute richtig), XLSX und PDF als Packliste je Kunde.

export const EXPORT_SPALTEN = ["Kunde", "Amazon-Name", "Land", "Deal", "ASIN", "EAN", "Titel", "Menge"] as const;
const werte = (z: ExportZeile) => [z.kunde, z.amazonName ?? "", z.land, String(z.deal), z.asin, z.ean ?? "", z.titel, String(z.menge)];

export function exportCsv(zeilen: ExportZeile[]): string {
  const zelle = (roh: string) => {
    // Formeln aus fremden Texten (z. B. „=HYPERLINK(…)“ im Titel) nicht ausführen lassen
    const v = /^[=+\-@\t]/.test(roh) && !/^-?\d+([.,]\d+)?$/.test(roh) ? `'${roh}` : roh;
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + [EXPORT_SPALTEN.join(";"), ...zeilen.map((z) => werte(z).map(zelle).join(";"))].join("\r\n") + "\r\n";
}

export function exportXlsx(zeilen: ExportZeile[]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([[...EXPORT_SPALTEN], ...zeilen.map((z) => [z.kunde, z.amazonName ?? "", z.land, z.deal, z.asin, z.ean ?? "", z.titel, z.menge])]);
  ws["!cols"] = [{ wch: 28 }, { wch: 20 }, { wch: 6 }, { wch: 6 }, { wch: 12 }, { wch: 15 }, { wch: 50 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Prep");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function exportPdf(zeilen: ExportZeile[], o: { titel: string; firma: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(o.titel);
  doc.setProducer("Seller-System");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 40;
  const nachKunde = new Map<string, ExportZeile[]>();
  for (const z of zeilen) nachKunde.set(z.kunde, [...(nachKunde.get(z.kunde) ?? []), z]);
  if (!nachKunde.size) nachKunde.set("–", []);
  for (const [kunde, liste] of nachKunde) {
    const page = doc.addPage([595.28, 841.89]);
    let y = 800;
    const t = (s: string, x: number, size = 10, f = reg) => page.drawText(safe(s), { x, y, size, font: f, color: rgb(0.1, 0.12, 0.16) });
    t(o.firma || "Prep-Übergabe", M, 11, bold);
    y -= 26;
    t(`${o.titel} – ${kunde}`, M, 16, bold);
    y -= 16;
    if (liste[0]?.amazonName) {
      t(`Amazon-Konto: ${liste[0].amazonName} · Land ${liste[0].land}`, M, 10);
      y -= 14;
    }
    y -= 12;
    const x = [M, M + 50, M + 140, M + 245, M + 470];
    ["Deal", "ASIN", "EAN", "Titel", "Menge"].forEach((h, i) => page.drawText(h, { x: x[i], y, size: 9, font: bold }));
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: 555, y }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) });
    y -= 14;
    for (const z of liste) {
      let titel = safe(z.titel);
      while (titel.length > 3 && reg.widthOfTextAtSize(titel, 9) > 215) titel = titel.slice(0, -2);
      [`#${z.deal}`, z.asin, z.ean ?? "–", titel, String(z.menge)].forEach((v, i) => page.drawText(safe(v), { x: x[i], y, size: 9, font: i === 4 ? bold : reg }));
      y -= 15;
    }
    y -= 20;
    t(`Summe: ${liste.reduce((n, z) => n + z.menge, 0)} Stück`, M, 11, bold);
    y = 60;
    t("Geprüft / übernommen: ______________________   Datum: __________", M, 10);
  }
  return doc.save();
}
