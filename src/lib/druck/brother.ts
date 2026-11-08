// Brother-QL-Rasterprotokoll (QL-800, QL-1100 und Netzwerk-Geschwister) – reine Logik, ohne Bibliotheken.
// Aus einem Graustufenbild (0 = schwarz, 255 = weiß) wird der komplette Befehlsstrom: Initialisieren, Medium,
// Schneiden, je Bildzeile ein Rasterbefehl, Druck. Der Druckagent schickt die Bytes unverändert an den Drucker.
// Grundlage: Brother „Raster Command Reference“ QL-800/QL-1100 (Befehle ESC i z, ESC i M, ESC i K, ESC i d, g).

export type DruckerModell = "QL-800" | "QL-1100";

export type Medium = {
  id: string;
  text: string;
  breiteMm: number;
  /** 0 = Endlosband. */
  laengeMm: number;
  art: "endlos" | "etikett";
  /** Druckbare Punkte quer (Bildbreite in px). */
  punkteBreite: number;
  /** Druckbare Punkte längs (Bildhöhe in px, bei Endlos 0 = beliebig). */
  punkteLaenge: number;
  /** Rechter Rand in Punkten (Lage des Bildes auf dem Druckkopf). */
  randRechts: number;
  modelle: DruckerModell[];
};

export const MEDIEN: Medium[] = [
  { id: "62x29", text: "DK-11209 62 × 29 mm", breiteMm: 62, laengeMm: 29, art: "etikett", punkteBreite: 696, punkteLaenge: 271, randRechts: 12, modelle: ["QL-800", "QL-1100"] },
  { id: "62", text: "DK-22205 62 mm endlos", breiteMm: 62, laengeMm: 0, art: "endlos", punkteBreite: 696, punkteLaenge: 0, randRechts: 12, modelle: ["QL-800", "QL-1100"] },
  { id: "102x152", text: "DK-11241 102 × 152 mm", breiteMm: 102, laengeMm: 152, art: "etikett", punkteBreite: 1164, punkteLaenge: 1660, randRechts: 12, modelle: ["QL-1100"] },
  // Werte für DK-11247 aus dem Datenblatt abgeleitet; bei Versatz im Agenten unter „medien“ anpassen.
  { id: "103x164", text: "DK-11247 103 × 164 mm", breiteMm: 103, laengeMm: 164, art: "etikett", punkteBreite: 1200, punkteLaenge: 1822, randRechts: 12, modelle: ["QL-1100"] },
];

/** Druckkopf je Modell: Punkte quer, Bytes je Rasterzeile, zusätzlicher rechter Versatz, Länge des Rücksetz-Blocks. */
export const KOPF: Record<DruckerModell, { punkte: number; bytes: number; versatz: number; leer: number }> = {
  "QL-800": { punkte: 720, bytes: 90, versatz: 0, leer: 200 },
  "QL-1100": { punkte: 1296, bytes: 162, versatz: 44, leer: 400 },
};

export function mediumFuer(id: string, extra: Medium[] = []): Medium | null {
  return [...extra, ...MEDIEN].find((m) => m.id === id) ?? null;
}

export function modellFuer(text: string | null | undefined): DruckerModell | null {
  const t = String(text ?? "").toUpperCase();
  if (/QL-?1[01]\d\d/.test(t)) return "QL-1100";
  if (/QL-?8\d\d/.test(t)) return "QL-800";
  return null;
}

export type Graubild = { breite: number; hoehe: number; pixel: Uint8Array };

const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** Eine Bildzeile → Rasterbytes (gespiegelt, rechts mit Rand, 1 = schwarz, höchstes Bit zuerst). */
export function rasterZeile(bild: Graubild, y: number, modell: DruckerModell, medium: Medium, schwelle = 128): Uint8Array {
  const k = KOPF[modell];
  const out = new Uint8Array(k.bytes);
  const x0 = k.punkte - bild.breite - medium.randRechts - k.versatz;
  for (let ix = 0; ix < bild.breite; ix++) {
    if (bild.pixel[y * bild.breite + ix] >= schwelle) continue;
    const cx = x0 + ix;
    if (cx < 0 || cx >= k.punkte) continue;
    const m = k.punkte - 1 - cx;
    out[m >> 3] |= 0x80 >> (m & 7);
  }
  return out;
}

/** Kompletter Druckauftrag: alle Seiten (Bilder) × Anzahl Kopien, Schnitt nach jedem Etikett. */
export function brotherRaster(seiten: Graubild[], modell: DruckerModell, medium: Medium, o: { anzahl?: number; schwelle?: number } = {}): Uint8Array {
  if (!seiten.length) throw new Error("Kein Druckbild");
  if (!medium.modelle.includes(modell)) throw new Error(`Medium ${medium.text} passt nicht in den ${modell}`);
  const k = KOPF[modell];

  const bytes: Uint8Array[] = [];
  const push = (a: number[]) => bytes.push(Uint8Array.from(a));
  push(new Array(k.leer).fill(0)); // Rücksetzen (Puffer leeren)
  push([0x1b, 0x40]); // ESC @ Initialisieren
  push([0x1b, 0x69, 0x61, 0x01]); // ESC i a 1: Rastermodus
  const folge = Array.from({ length: Math.max(1, o.anzahl ?? 1) }, () => seiten).flat();
  folge.forEach((bild, i) => {
    if (bild.breite > medium.punkteBreite) throw new Error(`Druckbild ${bild.breite} px breiter als ${medium.punkteBreite} px (${medium.text})`);
    const hoehe = medium.art === "etikett" ? medium.punkteLaenge : bild.hoehe;
    const art = medium.art === "endlos" ? 0x0a : 0x0b;
    // ESC i z: gültige Angaben (Art, Breite, Länge, Wiederherstellung), Medium, Breite/Länge mm, Rasterzeilen, Seite
    push([0x1b, 0x69, 0x7a, 0x80 | 0x02 | 0x04 | (medium.art === "etikett" ? 0x08 : 0), art, medium.breiteMm, medium.laengeMm, ...le32(hoehe), i === 0 ? 0 : 1, 0x00]);
    push([0x1b, 0x69, 0x4d, 0x40]); // ESC i M: automatisch schneiden
    push([0x1b, 0x69, 0x41, 0x01]); // ESC i A: nach jedem Etikett
    push([0x1b, 0x69, 0x4b, 0x08]); // ESC i K: Schnitt am Ende
    push([0x1b, 0x69, 0x64, ...le16(medium.art === "endlos" ? 35 : 0)]); // ESC i d: Vorschub-Rand
    push([0x4d, 0x00]); // M 0: keine Kompression
    for (let y = 0; y < hoehe; y++) {
      const zeile = y < bild.hoehe ? rasterZeile(bild, y, modell, medium, o.schwelle) : new Uint8Array(k.bytes);
      bytes.push(Uint8Array.from([0x67, 0x00, k.bytes]));
      bytes.push(zeile);
    }
    push([i === folge.length - 1 ? 0x1a : 0x0c]); // letzte Seite: Drucken mit Vorschub, sonst Seitenwechsel
  });

  const laenge = bytes.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(laenge);
  let p = 0;
  for (const b of bytes) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
