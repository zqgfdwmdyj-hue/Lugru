import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { safe } from "@/lib/ebay/invoices/pdf";
import type { ChargeLike, PalletLike, PalletRates } from "./billing";

// Monatsaufstellung Palettenlager für einen Kunden (A4-PDF + Mailtext). Keine Rechnung – nur die
// Übersicht, was im Monat angefallen ist.

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const statementMonthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }).replace(/[  ]/g, " ");
const date = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

export type StatementPallet = PalletLike & { code: string; location?: string | null; contents?: string | null };
export type StatementGroup = {
  customer: string;
  rates: PalletRates;
  lines: { pallet: StatementPallet; days: number; storage: number; inFee: number; outFee: number; amount: number }[];
  services: { charge: ChargeLike & { palletCode?: string | null }; amount: number }[];
  storage: number;
  fees: number;
  servicesTotal: number;
  total: number;
};
export type StatementSender = { name?: string; street?: string; houseNo?: string; zip?: string; city?: string; email?: string; phone?: string };

const A4 = { w: 595.28, h: 841.89 };
const M = { left: 50, right: 45, top: 48, bottom: 60 };
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.82, 0.84, 0.88);
const ACCENT = rgb(0.055, 0.42, 0.37);

export async function buildStatementPdf(input: { sender: StatementSender; month: string; group: StatementGroup; today: string; vat?: { rate: number; pricesAre: "netto" | "brutto" } }): Promise<Uint8Array> {
  const { sender, month, group: g } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Palettenaufstellung ${statementMonthLabel(month)} – ${g.customer}`);
  doc.setProducer("Seller-System");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M.top;
  const W = A4.w - M.left - M.right;
  const text = (t: string, x: number, size = 9, font: PDFFont = reg, color = INK) => page.drawText(safe(t), { x, y, size, font, color });
  const right = (t: string, xRight: number, size = 9, font: PDFFont = reg, color = INK) => {
    const s = safe(t);
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color });
  };
  const fit = (t: string, font: PDFFont, size: number, max: number) => {
    let s = safe(t);
    if (font.widthOfTextAtSize(s, size) <= max) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
    return `${s}…`;
  };
  const rule = () => page.drawLine({ start: { x: M.left, y: y + 4 }, end: { x: M.left + W, y: y + 4 }, thickness: 0.6, color: LINE });

  // Kopf
  text(sender.name || "Palettenlager", M.left, 13, bold);
  y -= 13;
  const addr = [[sender.street, sender.houseNo].filter(Boolean).join(" "), [sender.zip, sender.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const contact = [sender.email, sender.phone].filter(Boolean).join(" · ");
  if (addr) { text(addr, M.left, 8.5, reg, MUTED); y -= 11; }
  if (contact) { text(contact, M.left, 8.5, reg, MUTED); y -= 11; }
  y -= 22;
  text(`Palettenaufstellung ${statementMonthLabel(month)}`, M.left, 17, bold, ACCENT);
  y -= 20;
  text(`Kunde: ${g.customer}`, M.left, 11, bold);
  right(`Stand ${date(input.today)}`, M.left + W, 9, reg, MUTED);
  y -= 14;
  const r = g.rates;
  const cond = [
    `${euro(r.pricePerMonth)} je Stellplatz und Monat (${r.mode === "monat" ? "je angefangenem Monat" : "tagesgenau anteilig"})`,
    `${r.freeDays} Tage kostenfrei`,
    r.inFee ? `Einlagern ${euro(r.inFee)}` : "",
    r.outFee ? `Auslagern ${euro(r.outFee)}` : "",
  ].filter(Boolean).join(" · ");
  text(cond, M.left, 8.5, reg, MUTED);
  y -= 24;

  // Tabelle Paletten
  const cols = { code: M.left, place: M.left + 70, inn: M.left + 200, out: M.left + 262, days: M.left + 350, storage: M.left + 410, fees: M.left + 460, sum: M.left + W };
  const header = () => {
    text("Palette", cols.code, 8.5, bold, MUTED);
    text("Stellplatz / Inhalt", cols.place, 8.5, bold, MUTED);
    text("Ein", cols.inn, 8.5, bold, MUTED);
    text("Aus", cols.out, 8.5, bold, MUTED);
    right("Tage", cols.days, 8.5, bold, MUTED);
    right("Lager", cols.storage, 8.5, bold, MUTED);
    right("Ein/Aus", cols.fees, 8.5, bold, MUTED);
    right("Summe", cols.sum, 8.5, bold, MUTED);
    y -= 6;
    rule();
    y -= 10;
  };
  const ensure = (h: number) => {
    if (y - h > M.bottom) return;
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - M.top;
    header();
  };
  if (g.lines.length) {
    text("Paletten", M.left, 11, bold);
    y -= 16;
    header();
    for (const l of [...g.lines].sort((a, b) => a.pallet.code.localeCompare(b.pallet.code, "de", { numeric: true }))) {
      ensure(14);
      const info = [l.pallet.location, l.pallet.contents].filter(Boolean).join(" · ");
      text(fit(l.pallet.code, bold, 9, 66), cols.code, 9, bold);
      text(fit(info || "–", reg, 8.5, 124), cols.place, 8.5, reg, info ? INK : MUTED);
      text(date(l.pallet.inAt), cols.inn, 8.5);
      text(l.pallet.outAt ? date(l.pallet.outAt) : "noch da", cols.out, 8.5, reg, l.pallet.outAt ? INK : MUTED);
      right(String(l.days), cols.days, 9);
      right(l.storage ? euro(l.storage) : "–", cols.storage, 9);
      right(l.inFee + l.outFee ? euro(l.inFee + l.outFee) : "–", cols.fees, 9);
      right(euro(l.amount), cols.sum, 9, bold);
      y -= 14;
    }
    y -= 4;
  }

  if (g.services.length) {
    ensure(40);
    y -= 6;
    text("Zusatzleistungen", M.left, 11, bold);
    y -= 16;
    text("Datum", cols.code, 8.5, bold, MUTED);
    text("Leistung", cols.place, 8.5, bold, MUTED);
    right("Menge", cols.days, 8.5, bold, MUTED);
    right("Preis", cols.fees, 8.5, bold, MUTED);
    right("Summe", cols.sum, 8.5, bold, MUTED);
    y -= 6;
    rule();
    y -= 10;
    for (const s of [...g.services].sort((a, b) => a.charge.day.localeCompare(b.charge.day))) {
      ensure(14);
      text(date(s.charge.day), cols.code, 8.5);
      text(fit(`${s.charge.description}${s.charge.palletCode ? ` (${s.charge.palletCode})` : ""}`, reg, 9, 270), cols.place, 9);
      right(String(s.charge.quantity).replace(".", ","), cols.days, 9);
      right(euro(s.charge.unitPrice), cols.fees, 9);
      right(euro(s.amount), cols.sum, 9, bold);
      y -= 14;
    }
  }

  // Summen
  ensure(80);
  y -= 8;
  rule();
  y -= 12;
  const sumLine = (label: string, value: number, strong = false) => {
    text(label, cols.storage - 120, strong ? 11 : 9, strong ? bold : reg, strong ? INK : MUTED);
    right(euro(value), cols.sum, strong ? 11 : 9, strong ? bold : reg);
    y -= strong ? 16 : 13;
  };
  sumLine(`Lagerung (${g.lines.filter((l) => l.storage > 0).length} Paletten)`, g.storage);
  if (g.fees) sumLine("Ein- und Auslagern", g.fees);
  if (g.servicesTotal) sumLine("Zusatzleistungen", g.servicesTotal);
  if (input.vat) {
    const { rate, pricesAre } = input.vat;
    const pct = `${String(Math.round(rate * 1000) / 10).replace(".", ",")} %`;
    if (pricesAre === "netto") {
      const tax = Math.round(g.total * rate * 100) / 100;
      sumLine("Gesamt netto", g.total);
      sumLine(`zzgl. USt ${pct}`, tax);
      sumLine("Gesamt brutto", Math.round((g.total + tax) * 100) / 100, true);
    } else {
      const tax = Math.round((g.total - g.total / (1 + rate)) * 100) / 100;
      sumLine("Gesamt brutto", g.total, true);
      sumLine(`darin USt ${pct}`, tax);
    }
  } else sumLine("Gesamt", g.total, true);
  y -= 16;
  text("Diese Aufstellung ist keine Rechnung.", M.left, 8.5, reg, MUTED);
  return doc.save();
}

/** Betreff und Text der Mail an den Kunden. */
export function statementMail(input: { customer: string; month: string; group: Pick<StatementGroup, "lines" | "total">; company?: string; signature?: string | null }) {
  const label = statementMonthLabel(input.month);
  const open = input.group.lines.filter((l) => !l.pallet.outAt).length;
  const subject = `Palettenaufstellung ${label}${input.company ? ` – ${input.company}` : ""}`;
  const text = [
    "Guten Tag,",
    "",
    `anbei die Aufstellung Ihrer Palettenstellplätze für ${label}: ${input.group.lines.length} Palette${input.group.lines.length === 1 ? "" : "n"}, Summe ${euro(input.group.total)}.`,
    open ? `Zum Monatsende stehen noch ${open} Palette${open === 1 ? "" : "n"} bei uns im Lager.` : "",
    "",
    "Bei Fragen melden Sie sich gern.",
    "",
    input.signature?.trim() || ["Viele Grüße", input.company].filter(Boolean).join("\n"),
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  const filename = `Palettenaufstellung-${input.month}-${input.customer.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "Kunde"}.pdf`;
  return { subject, text, filename };
}
