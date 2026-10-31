// B19.6: Deal-Blatt als Bild (SVG, 1080 px breit – zum Teilen in Chats). Gleiche Inhalte wie das PDF: Artikel, Preis,
// Mengen, Frist, Prognose je Land. Bewusst ohne EK, ohne eigenen Verdienst, ohne Insider-Infos.

import type { BlattPdfInput } from "./blatt-pdf";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (n: number | null) => (n === null ? "–" : `${n.toFixed(2).replace(".", ",")} €`);
const pz = (n: number | null) => (n === null ? "–" : `${Math.round(n)} %`);

/** Zeilen umbrechen (grob nach Zeichen), höchstens `max` Zeilen. */
function umbruch(text: string, breite: number, max: number): string[] {
  const out: string[] = [];
  let z = "";
  for (const w of text.split(/\s+/)) {
    if ((z + " " + w).trim().length > breite) {
      out.push(z.trim());
      z = w;
    } else z = `${z} ${w}`;
  }
  if (z.trim()) out.push(z.trim());
  return out.length > max ? [...out.slice(0, max - 1), `${out[max - 1].slice(0, breite - 1)}…`] : out;
}

export function blattBild(i: BlattPdfInput): string {
  const W = 1080;
  const zeilen: string[] = [];
  let y = 90;
  const text = (x: number, s: string, o: { size?: number; bold?: boolean; color?: string; anchor?: string } = {}) =>
    zeilen.push(`<text x="${x}" y="${y}" font-size="${o.size ?? 28}" font-weight="${o.bold ? 700 : 400}" fill="${o.color ?? "#1a1f29"}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}>${esc(s)}</text>`);
  text(60, `Deal ${i.nr}`, { size: 30, color: "#6b7587" });
  if (i.firma.handelsname || i.firma.name) text(W - 60, i.firma.handelsname || i.firma.name || "", { size: 26, color: "#6b7587", anchor: "end" });
  y += 60;
  for (const l of umbruch(i.titel, 52, 3)) {
    text(60, l, { size: 40, bold: true });
    y += 52;
  }
  y += 6;
  text(60, [i.marke, `ASIN ${i.asin}`, i.ean ? `EAN ${i.ean}` : null].filter(Boolean).join(" · "), { size: 26, color: "#6b7587" });
  y += 70;
  text(60, "Preis netto je Stück", { size: 26, color: "#6b7587" });
  text(W - 60, eur(i.preis), { size: 48, bold: true, anchor: "end" });
  y += 56;
  text(60, [`ab ${i.mindestmenge} Stück`, i.maxProKunde ? `max. ${i.maxProKunde} je Kunde` : null, i.rest !== null ? `noch ${i.rest} verfügbar` : null, i.frist ? `bis ${i.frist.split("-").reverse().join(".")}` : null].filter(Boolean).join(" · "), { size: 28 });
  y += 60;
  zeilen.push(`<line x1="60" y1="${y}" x2="${W - 60}" y2="${y}" stroke="#d1d6e0" stroke-width="2"/>`);
  y += 50;
  const spalten = [60, 230, 420, 610, 800, W - 60];
  ["Land", "Buy Box", "Gewinn/Stk", "ROI", "Verk./Monat"].forEach((h, k) => text(spalten[k], h, { size: 24, color: "#6b7587", anchor: k ? "end" : undefined }));
  // rechtsbündige Spalten: Ende der Spalte
  y += 44;
  for (const l of i.laender.slice(0, 8)) {
    const werte = [l.land, eur(l.vk), eur(l.gewinn), pz(l.roi), l.verkaeufe === null ? "–" : `${l.verkaeufe}+`];
    werte.forEach((v, k) => text(k ? spalten[k + 1] - 20 : spalten[0], v, { size: 28, bold: k === 2, anchor: k ? "end" : undefined }));
    y += 44;
  }
  y += 20;
  if (i.hinweis) {
    for (const l of umbruch(i.hinweis, 70, 3)) {
      text(60, l, { size: 24, color: "#6b7587" });
      y += 34;
    }
  }
  y += 20;
  text(60, "Reservieren im Kundenportal:", { size: 24, color: "#6b7587" });
  y += 36;
  text(60, i.link, { size: 24, color: "#1f5fbf" });
  y += 40;
  text(60, `Stand ${i.stand.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} · Prognose ohne Gewähr`, { size: 22, color: "#6b7587" });
  const H = y + 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/><rect x="0" y="0" width="${W}" height="12" fill="#1f5fbf"/>${zeilen.join("")}</svg>`;
}
