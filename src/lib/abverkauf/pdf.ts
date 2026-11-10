import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { safe } from "@/lib/ebay/invoices/pdf";
import type { AbverkaufPosition } from "@/db/tables/abverkauf";
import type { Absender } from "./logic";

// B34.3 PDFs für Händler: Preisliste (ohne EK, ohne Break-even, ohne interne Gründe) und Serienbrief (je Händler
// eine Seite mit Absender, Anschrift, Text und Datenschutzhinweis nach Art. 14 DSGVO).

const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.82, 0.84, 0.88);
const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

function schreiber(page: PDFPage, reg: PDFFont) {
  const umbruch = (t: string, size: number, font: PDFFont, max: number) => {
    const zeilen: string[] = [];
    for (const absatz of t.split("\n")) {
      let z = "";
      for (const w of safe(absatz).split(/\s+/).filter(Boolean)) {
        const probe = z ? `${z} ${w}` : w;
        if (font.widthOfTextAtSize(probe, size) > max && z) {
          zeilen.push(z);
          z = w;
        } else z = probe;
      }
      zeilen.push(z);
    }
    return zeilen;
  };
  const text = (t: string, x: number, y: number, size = 10, font: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y, size, font, color });
  return { umbruch, text };
}

export async function preislistePdf(o: { absender: Absender; positionen: AbverkaufPosition[]; stand: Date }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Restposten-Preisliste");
  doc.setProducer("Seller-System");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([A4.w, A4.h]);
  let w = schreiber(page, reg);
  let y = A4.h - M;
  w.text(o.absender.name || "Restposten", M, y, 13, bold);
  y -= 14;
  const kontakt = [[o.absender.strasse, [o.absender.plz, o.absender.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "), o.absender.email, o.absender.telefon].filter(Boolean).join(" · ");
  if (kontakt) w.text(kontakt, M, y, 8.5, reg, MUTED);
  y -= 34;
  w.text("Restposten-Preisliste", M, y, 20, bold);
  y -= 16;
  w.text(`Stand ${o.stand.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} · Preise netto je Stück zzgl. USt. · solange Vorrat reicht · freibleibend`, M, y, 9, reg, MUTED);
  y -= 26;
  const spalten = [M, M + 280, M + 340, M + 410];
  const kopf = () => {
    w.text("Artikel", spalten[0], y, 9, bold);
    w.text("Menge", spalten[1], y, 9, bold);
    w.text("Preis", spalten[2], y, 9, bold);
    w.text("Staffel", spalten[3], y, 9, bold);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.6, color: LINE });
    y -= 14;
  };
  kopf();
  for (const p of o.positionen) {
    const titel = w.umbruch(p.titel, 9, reg, 270);
    const staffel = p.staffel.map((s) => `ab ${s.ab}: ${eur(s.preis)}`);
    const hoehe = Math.max(titel.length, staffel.length, 1) * 12 + (p.asin ? 11 : 0) + 6;
    if (y - hoehe < M + 30) {
      page = doc.addPage([A4.w, A4.h]);
      w = schreiber(page, reg);
      y = A4.h - M;
      kopf();
    }
    let yy = y;
    for (const z of titel) {
      w.text(z, spalten[0], yy, 9);
      yy -= 12;
    }
    if (p.asin) w.text(`ASIN ${p.asin}`, spalten[0], yy, 7.5, reg, MUTED);
    w.text(String(p.menge), spalten[1], y, 9);
    w.text(eur(p.preis), spalten[2], y, 9, bold);
    staffel.forEach((s, i) => w.text(s, spalten[3], y - i * 12, 8.5));
    y -= hoehe;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4.w - M, y: y + 4 }, thickness: 0.3, color: LINE });
  }
  y -= 10;
  if (y < M + 40) {
    page = doc.addPage([A4.w, A4.h]);
    w = schreiber(page, reg);
    y = A4.h - M;
  }
  for (const z of w.umbruch("Neuware, originalverpackt. Lieferung ab Lager nach Zahlungseingang; Versandkosten nach Absprache. Anfragen bitte mit Artikel und Menge per E-Mail oder Telefon.", 8.5, reg, A4.w - 2 * M)) {
    w.text(z, M, y, 8.5, reg, MUTED);
    y -= 11;
  }
  return doc.save();
}

/** B34.3.6 Beilage der Logistik-Firma: eigener Brief (eigenes Blatt) mit eigenem Absender, Impressum und Datenschutzhinweis. */
export type Beilage = { absender: Absender & { web?: string }; betreff: string; text: string; impressum: string; datenschutz: string };
/** B34.3b QR-Code/Kurzlink zur Anfrageseite mit Kampagnen-ID. */
export type BriefQr = { png: Uint8Array; url: string; kampagne: string };
export type Brief = { anschrift: string[]; betreff: string; text: string; datenschutz: string; code: string; qr?: BriefQr | null; beilage?: Beilage | null; eigenerName?: string; /** anderer Briefkopf (Kampagne der Logistik-Firma) */ kopf?: Absender | null };

/** Seiten je Brief (für Kostenvorschau): 1 Blatt Anschreiben + 1 Blatt Beilage. */
export const briefSeiten = (b: Pick<Brief, "beilage">) => 1 + (b.beilage ? 1 : 0);

export async function serienbriefPdf(o: { absender: Absender; datum: Date; briefe: Brief[] }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Serienbrief Restposten");
  doc.setProducer("Seller-System");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const b of o.briefe) {
    const k = b.kopf ?? o.absender;
    const absenderZeile = [k.name, k.strasse, [k.plz, k.ort].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    const page = doc.addPage([A4.w, A4.h]);
    const w = schreiber(page, reg);
    let y = A4.h - 45;
    w.text(k.name, M, y, 12, bold);
    y -= 13;
    w.text([k.email, k.telefon].filter(Boolean).join(" · "), M, y, 8.5, reg, MUTED);
    // Anschriftfeld (DIN 5008, Fenster links)
    y = A4.h - 140;
    w.text(absenderZeile, M, y, 7, reg, MUTED);
    y -= 14;
    for (const z of b.anschrift) {
      w.text(z, M, y, 10.5);
      y -= 13;
    }
    y = A4.h - 270;
    w.text(o.datum.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }), A4.w - M - 70, y + 20, 9.5);
    w.text(b.betreff, M, y, 11, bold);
    y -= 22;
    for (const z of w.umbruch(b.text, 10, reg, A4.w - 2 * M)) {
      w.text(z, M, y, 10);
      y -= 13;
    }
    // Datenschutzhinweis unten im Kasten
    const ds = w.umbruch(b.datenschutz, 7.5, reg, A4.w - 2 * M - 16);
    const h = ds.length * 9.5 + 14;
    page.drawRectangle({ x: M, y: M - 6, width: A4.w - 2 * M, height: h, borderColor: LINE, borderWidth: 0.6 });
    let yy = M - 6 + h - 14;
    for (const z of ds) {
      w.text(z, M + 8, yy, 7.5, reg, MUTED);
      yy -= 9.5;
    }
    w.text(b.code, A4.w - M - 60, M - 20, 7, reg, MUTED);
    if (b.qr) {
      // QR-Code rechts über dem Datenschutz-Kasten, darunter Kurzlink und Kampagnen-ID
      const bild = await doc.embedPng(b.qr.png);
      const g = 78;
      const qy = M - 6 + h + 14;
      page.drawImage(bild, { x: A4.w - M - g, y: qy + 12, width: g, height: g });
      w.text(`Anfrage: ${b.qr.url}`, M, qy + 4, 8, reg, INK);
      w.text(`Kampagne ${b.qr.kampagne} · Bezug ${b.code}`, M, qy - 7, 7, reg, MUTED);
    }
    if (b.beilage) await beilageSeite(doc, reg, bold, b, b.beilage, o.datum);
  }
  return doc.save();
}

/** Eigenes Blatt der Logistik-Firma – nicht mit dem Anschreiben vermischt: eigener Kopf, Absender, Impressum, Datenschutz. */
async function beilageSeite(doc: PDFDocument, reg: PDFFont, bold: PDFFont, b: Brief, x: Beilage, datum: Date) {
  const page = doc.addPage([A4.w, A4.h]);
  const w = schreiber(page, reg);
  const a = x.absender;
  let y = A4.h - 45;
  w.text(a.name, M, y, 12, bold);
  y -= 13;
  w.text([a.email, a.telefon, a.web].filter(Boolean).join(" · "), M, y, 8.5, reg, MUTED);
  y -= 12;
  w.text(`Eigenes Schreiben der ${a.name}${b.eigenerName ? ` – nicht von ${b.eigenerName}` : ""}.`, M, y, 7.5, reg, MUTED);
  y = A4.h - 140;
  w.text([a.name, a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join(" · "), M, y, 7, reg, MUTED);
  y -= 14;
  for (const z of b.anschrift) {
    w.text(z, M, y, 10.5);
    y -= 13;
  }
  y = A4.h - 270;
  w.text(datum.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }), A4.w - M - 70, y + 20, 9.5);
  w.text(x.betreff, M, y, 11, bold);
  y -= 22;
  for (const z of w.umbruch(["Sehr geehrte Damen und Herren,", "", x.text.trim(), "", "Mit freundlichen Grüßen", a.name].join("\n"), 10, reg, A4.w - 2 * M)) {
    w.text(z, M, y, 10);
    y -= 13;
  }
  // Fuß: Impressum und Datenschutzhinweis der Logistik-Firma
  const ds = w.umbruch(x.datenschutz, 7, reg, A4.w - 2 * M - 16);
  const imp = w.umbruch(`Impressum: ${x.impressum.replace(/\s*\n\s*/g, " · ")}`, 7, reg, A4.w - 2 * M - 16);
  const h = (ds.length + imp.length) * 9 + 20;
  page.drawRectangle({ x: M, y: M - 6, width: A4.w - 2 * M, height: h, borderColor: LINE, borderWidth: 0.6 });
  let yy = M - 6 + h - 13;
  for (const z of [...imp, "", ...ds]) {
    if (z) w.text(z, M + 8, yy, 7, reg, MUTED);
    yy -= 9;
  }
}

/** QR-Code als PNG (bwip-js). */
export async function qrPng(text: string): Promise<Uint8Array> {
  const bwipjs = (await import("bwip-js/node")).default;
  return new Uint8Array(await bwipjs.toBuffer({ bcid: "qrcode", text, scale: 4, paddingwidth: 2, paddingheight: 2 }));
}
