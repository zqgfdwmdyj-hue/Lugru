import sharp from "sharp";

// „Fingerabdruck“ eines Fotos zum Wiedererkennen – auch wenn dasselbe Foto verkleinert, neu gespeichert, per WhatsApp
// verschickt oder von HEIC in JPG umgewandelt wurde. Zwei Teile:
//  - Kanten: Graubild 32×32, davon nur die feinen Unterschiede (Schrift, Konturen) – Verläufe und Helligkeit zählen nicht.
//  - Farben: Farbbild 8×8, an Helligkeit und Kontrast angeglichen.
// Beides muss passen, damit zwei Fotos als dasselbe gelten.

const G = 32;
const C = 8;
const LEN = G * G + C * C * 3;

/** Grenzwerte: Kanten-Übereinstimmung (Korrelation, 1 = identisch) und Farbabstand (mittlere Abweichung 0–255). */
export const SAME = { edges: 0.85, colour: 10 };
export const SIMILAR = { edges: 0.7, colour: 14 };

export async function photoHash(data: Buffer): Promise<string | null> {
  try {
    const base = sharp(data, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
    const grey = await base.clone().resize(G, G, { fit: "fill" }).grayscale().raw().toBuffer();
    const colour = await base.clone().resize(C, C, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
    if (grey.length !== G * G || colour.length !== C * C * 3) return null;
    return Buffer.concat([grey, colour]).toString("base64");
  } catch {
    return null;
  }
}

type Vec = { edges: Float32Array; colour: Float32Array } | null;

function prepare(hash: string): Vec {
  const px = Buffer.from(hash, "base64");
  if (px.length !== LEN) return null;
  // Kanten: Bild minus weichgezeichnetes Bild (3×3), dann auf Mittel 0 / Länge 1 bringen.
  const hp = new Float32Array(G * G);
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < G && xx >= 0 && xx < G) {
            s += px[yy * G + xx];
            n++;
          }
        }
      }
      hp[y * G + x] = px[y * G + x] - s / n;
    }
  }
  let mean = 0;
  for (const v of hp) mean += v;
  mean /= hp.length;
  let norm = 0;
  for (let i = 0; i < hp.length; i++) {
    hp[i] -= mean;
    norm += hp[i] ** 2;
  }
  norm = Math.sqrt(norm);
  // Kaum Kanten (einfarbig, fast leer): nicht vergleichbar.
  if (norm < 40) return null;
  for (let i = 0; i < hp.length; i++) hp[i] /= norm;

  const col = px.subarray(G * G);
  let cm = 0;
  for (const v of col) cm += v;
  cm /= col.length;
  let cs = 0;
  for (const v of col) cs += (v - cm) ** 2;
  cs = Math.max(Math.sqrt(cs / col.length), 4);
  const colour = Float32Array.from(col, (v) => ((v - cm) / cs) * 48 + 128);
  return { edges: hp, colour };
}

const cache = new Map<string, Vec>();
function vec(hash: string): Vec {
  let v = cache.get(hash);
  if (v === undefined) {
    v = prepare(hash);
    if (cache.size > 20000) cache.clear();
    cache.set(hash, v);
  }
  return v;
}

export type Likeness = { edges: number; colour: number };

/** Wie ähnlich sind zwei Fotos? null, wenn nicht vergleichbar. */
export function likeness(a: string, b: string): Likeness | null {
  const x = vec(a);
  const y = vec(b);
  if (!x || !y) return null;
  let e = 0;
  for (let i = 0; i < x.edges.length; i++) e += x.edges[i] * y.edges[i];
  let c = 0;
  for (let i = 0; i < x.colour.length; i++) c += Math.abs(x.colour[i] - y.colour[i]);
  return { edges: e, colour: c / x.colour.length };
}

export function usableHash(h: string | null | undefined): h is string {
  return !!h && vec(h) !== null;
}

export function photoMatch(a: string | null, b: string | null): "gleich" | "ähnlich" | null {
  if (!a || !b) return null;
  const l = likeness(a, b);
  if (!l) return null;
  if (l.edges >= SAME.edges && l.colour <= SAME.colour) return "gleich";
  if (l.edges >= SIMILAR.edges && l.colour <= SIMILAR.colour) return "ähnlich";
  return null;
}

/** Ähnlichstes Foto aus der Liste (oder null, wenn keines ähnlich genug ist). */
export function closestPhoto<T extends { hash: string | null }>(hash: string | null, candidates: T[]): (T & { match: "gleich" | "ähnlich"; edges: number }) | null {
  if (!usableHash(hash)) return null;
  let best: (T & { match: "gleich" | "ähnlich"; edges: number }) | null = null;
  for (const c of candidates) {
    const match = photoMatch(hash, c.hash);
    if (!match) continue;
    const edges = likeness(hash, c.hash!)!.edges;
    if (!best || (match === "gleich" && best.match !== "gleich") || (match === best.match && edges > best.edges)) best = { ...c, match, edges };
  }
  return best;
}
