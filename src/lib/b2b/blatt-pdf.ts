import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { safe } from "@/lib/ebay/invoices/pdf";

// Deal-Blatt (A4) für Kunden: Artikel, Preis, Mengen, Frist, Prognose je Land, Hinweise. Enthält bewusst keinen EK
// und keinen eigenen Verdienst – darf an Kunden weitergegeben werden.

export type BlattPdfInput = {
  firma: { name?: string; handelsname?: string; strasse?: string; plz?: string; ort?: string; email?: string; telefon?: string };
  nr: number;
  titel: string;
  asin: string;
  ean: string | null;
  marke: string | null;
  preis: number | null;
  mindestmenge: number;
  maxProKunde: number | null;
  rest: number | null;
  frist: string | null;
  hinweis: string | null;
  laender: { land: string; vk: number | null; gewinn: number | null; roi: number | null; verkaeufe: number | null; angebote: number | null }[];
  link: string;
  stand: Date;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.82, 0.84, 0.88);
const eur = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
const datum = (iso: string) => iso.split("-").reverse().join(".");

export async function blattPdf(i: BlattPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Deal ${i.nr}`);
  doc.setProducer("Seller-System");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const W = A4.w - 2 * M;
  const text = (t: string, x: number, size = 10, font: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y, size, font, color });
  const umbruch = (t: string, size: number, font: PDFFont, max: number) => {
    const zeilen: string[] = [];
    let z = "";
    for (const w of safe(t).split(/\s+/)) {
      const probe = z ? `${z} ${w}` : w;
      if (font.widthOfTextAtSize(probe, size) > max && z) {
        zeilen.push(z);
        z = w;
      } else z = probe;
    }
    if (z) zeilen.push(z);
    return zeilen;
  };

  const f = i.firma;
  text(f.handelsname || f.name || "B2B-Deals", M, 13, bold);
  y -= 14;
  const kontakt = [f.handelsname && f.name ? f.name : null, [f.strasse, [f.plz, f.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "), f.email, f.telefon].filter(Boolean).join(" · ");
  if (kontakt) {
    text(kontakt, M, 8.5, reg, MUTED);
    y -= 12;
  }
  y -= 24;
  text(`Deal #${i.nr}`, M, 20, bold);
  y -= 22;
  for (const z of umbruch(i.titel, 12, bold, W)) {
    text(z, M, 12, bold);
    y -= 15;
  }
  text(`ASIN ${i.asin}${i.ean ? ` · EAN ${i.ean}` : ""}${i.marke ? ` · ${i.marke}` : ""}`, M, 9, reg, MUTED);
  y -= 26;

  const meta: [string, string][] = [
    ["Preis", `${eur(i.preis)} netto je Stück (zzgl. USt bzw. Reverse Charge)`],
    ["Menge", `ab ${i.mindestmenge} Stück${i.maxProKunde ? `, höchstens ${i.maxProKunde} je Kunde` : ""}${i.rest !== null ? ` · noch ${i.rest} frei` : ""}`],
    ["Reservieren bis", i.frist ? datum(i.frist) : "–"],
    ["Zahlung", "Vorkasse nach Rechnung – bestellt wird erst nach Zahlungseingang"],
  ];
  for (const [k, v] of meta) {
    text(k, M, 10, bold);
    text(v, M + 110, 10);
    y -= 16;
  }
  y -= 14;
  text("Prognose je Marktplatz", M, 12, bold);
  y -= 16;
  const spalten = [M, M + 60, M + 160, M + 260, M + 340, M + 420];
  const kopf = ["Land", "Buy Box", "Gewinn/Stück", "ROI", "Verk./Monat", "Angebote"];
  kopf.forEach((h, n) => page.drawText(h, { x: spalten[n], y, size: 9, font: bold, color: MUTED }));
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.6, color: LINE });
  y -= 13;
  for (const l of i.laender) {
    const werte = [l.land, eur(l.vk), eur(l.gewinn), l.roi === null ? "–" : `${l.roi.toFixed(0)} %`, l.verkaeufe === null ? "–" : `~${l.verkaeufe}`, l.angebote === null ? "–" : String(l.angebote)];
    werte.forEach((v, n) => page.drawText(safe(v), { x: spalten[n], y, size: 10, font: n === 0 ? bold : reg, color: INK }));
    y -= 15;
  }
  if (!i.laender.length) {
    text("Noch keine Prognose.", M, 10, reg, MUTED);
    y -= 15;
  }
  y -= 6;
  for (const z of umbruch("Gewinn des Kunden je Stück: Buy-Box-Preis netto (USt des Landes) minus Amazon-Provision und FBA-Gebühr minus Preis und Prep-Gebühr. Alle Werte sind eine Prognose ohne Garantie – Preise können fallen.", 8.5, reg, W)) {
    text(z, M, 8.5, reg, MUTED);
    y -= 11;
  }
  y -= 14;
  if (i.hinweis) {
    text("Hinweis", M, 10, bold);
    y -= 14;
    for (const z of umbruch(i.hinweis, 10, reg, W)) {
      text(z, M, 10);
      y -= 13;
    }
    y -= 10;
  }
  text("Wichtig", M, 10, bold);
  y -= 14;
  for (const z of [
    "Markenfreigabe (Ungating) bitte vor der Reservierung im eigenen Amazon-Konto prüfen.",
    "Reservierung ist verbindlich; Rechnung als Vorkasse. Bei Fehlmenge des Großhändlers wird gekürzt und gutgeschrieben.",
    "Die Ware geht an das Prep Center; von dort an das Amazon-Lager des Kunden.",
  ]) {
    for (const zz of umbruch(`• ${z}`, 9.5, reg, W)) {
      text(zz, M, 9.5);
      y -= 13;
    }
  }
  y -= 14;
  text(`Reservieren im Kundenportal: ${i.link}`, M, 10, bold);
  y = M - 10;
  text(`Stand ${i.stand.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}`, M, 8, reg, MUTED);
  return doc.save();
}
