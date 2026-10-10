import { PDFDocument } from "pdf-lib";

// Kassenzettel/Belege: Fotos → ein PDF (eine Seite je Foto), KI liest Händler/Datum/Betrag,
// Betreff und Dateiname für Stotax (Mail2Select legt jede Mail-Anlage als eigenen Beleg ab –
// deshalb alle Fotos eines Zettels in EIN PDF).

export type ReceiptImage = { bytes: Uint8Array; type: string };

/** Seitenbreite DIN A4 (pt); Höhe folgt dem Foto – lange Kassenzettel bleiben am Stück lesbar. */
const PAGE_W = 595;
const MAX_H = 14_000;

export async function buildReceiptPdf(images: ReceiptImage[], meta: { title?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title ?? "Beleg");
  doc.setProducer("Seller-System");
  for (const img of images) {
    const embedded = /png$/i.test(img.type) ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const scale = PAGE_W / embedded.width;
    let w = PAGE_W;
    let h = embedded.height * scale;
    if (h > MAX_H) {
      w = (PAGE_W * MAX_H) / h;
      h = MAX_H;
    }
    const page = doc.addPage([PAGE_W, h]);
    page.drawImage(embedded, { x: (PAGE_W - w) / 2, y: 0, width: w, height: h });
  }
  return doc.save();
}

export type ReceiptFacts = {
  vendor: string | null;
  date: string | null;
  totalGross: number | null;
  totalNet: number | null;
  vat: { rate: number; amount: number }[];
  payment: string | null;
  category: string | null;
};

export const RECEIPT_PROMPT = `Das Bild/PDF ist ein Kassenzettel oder eine Quittung (evtl. über mehrere Fotos verteilt).
Lies NUR ab, was dort steht – nichts erfinden. Antworte ausschließlich mit JSON:
{"vendor":"Händler, z. B. REWE Markt GmbH","date":"JJJJ-MM-TT","total_gross":23.45,"total_net":19.71,"vat":[{"rate":19,"amount":3.74}],"payment":"Karte|Bar|…","category":"kurz, z. B. Büromaterial, Verpackung, Tanken, Bewirtung"}
Unlesbares als null. Ist es kein Beleg: {"error":"kein Beleg"}`;

const num = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[€\s]/g, "");
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** KI-Antwort → geprüfte Angaben (Unsinniges fällt weg). */
export function parseReceiptAi(text: string, today = new Date()): ReceiptFacts | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (o.error) return null;
  const date = typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && new Date(o.date) <= new Date(today.getTime() + 86_400_000) && o.date >= "2000-01-01" ? o.date : null;
  const str = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const vat = Array.isArray(o.vat)
    ? (o.vat as Record<string, unknown>[]).map((v) => ({ rate: num(v.rate) ?? NaN, amount: num(v.amount) ?? NaN })).filter((v) => Number.isFinite(v.rate) && Number.isFinite(v.amount))
    : [];
  const gross = num(o.total_gross);
  return {
    vendor: str(o.vendor),
    date,
    totalGross: gross !== null && gross > 0 && gross < 1_000_000 ? gross : null,
    totalNet: num(o.total_net),
    vat,
    payment: str(o.payment, 30),
    category: str(o.category, 40),
  };
}

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const deDate = (iso: string) => iso.split("-").reverse().join(".");

/** „Beleg_2026-10-10_REWE_23,45EUR.pdf“ */
export function receiptFileName(f: Pick<ReceiptFacts, "vendor" | "date" | "totalGross">, fallbackDate: string): string {
  const parts = ["Beleg", f.date ?? fallbackDate, f.vendor?.split(/\s+/).slice(0, 3).join("-"), f.totalGross !== null ? `${f.totalGross.toFixed(2).replace(".", ",")}EUR` : null];
  return `${parts.filter(Boolean).join("_")}.pdf`.replace(/[^\wäöüÄÖÜß,.-]+/g, "_").replace(/_+/g, "_");
}

/** Betreff/Text für Mail2Select – der Steuerberater sieht gleich, worum es geht. */
export function receiptMail(f: ReceiptFacts, fallbackDate: string, note?: string | null) {
  const date = deDate(f.date ?? fallbackDate);
  return {
    subject: ["Beleg", date, f.vendor, f.totalGross !== null ? euro(f.totalGross) : null].filter(Boolean).join(" – "),
    text: [
      `Beleg vom ${date}${f.vendor ? ` – ${f.vendor}` : ""}`,
      f.totalGross !== null ? `Brutto: ${euro(f.totalGross)}${f.vat.length ? ` (${f.vat.map((v) => `USt ${v.rate} %: ${euro(v.amount)}`).join(", ")})` : ""}` : "",
      f.payment ? `Bezahlt: ${f.payment}` : "",
      f.category ? `Art: ${f.category}` : "",
      note ? `Notiz: ${note}` : "",
      "Fotografiert und gesendet mit dem Seller-System.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
