import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { closestPhoto, photoHash, photoMatch, usableHash } from "@/lib/image-hash";

// Testfotos als SVG gezeichnet: Packung in einer Farbe mit Etikett, optional mit Preis darunter.
const pack = (color: string, label: string, opts: { price?: string; x?: number } = {}) =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8e2d6"/><stop offset="1" stop-color="#a89f8f"/></linearGradient></defs>
      <rect width="900" height="900" fill="url(#g)"/>
      <rect x="${opts.x ?? 225}" y="110" width="450" height="590" rx="30" fill="${color}"/>
      <rect x="${(opts.x ?? 225) + 45}" y="270" width="360" height="180" rx="12" fill="#fff"/>
      <text x="${(opts.x ?? 225) + 225}" y="380" font-size="44" text-anchor="middle" font-family="Arial" font-weight="bold">${label}</text>
      ${opts.price ? `<text x="450" y="830" font-size="80" text-anchor="middle" font-family="Arial" font-weight="bold" fill="#fff">${opts.price}</text>` : ""}
    </svg>`),
  )
    .jpeg({ quality: 90 })
    .toBuffer();

describe("Foto-Fingerabdruck", () => {
  it("erkennt dasselbe Foto in anderer Größe, Qualität und Format", async () => {
    const original = await pack("#d9a441", "Haferflocken");
    const h = await photoHash(original);
    expect(usableHash(h)).toBe(true);
    const variants = [
      await sharp(original).resize(400).jpeg({ quality: 40 }).toBuffer(),
      await sharp(original).resize(1280).png().toBuffer(),
      await sharp(original).modulate({ brightness: 1.08 }).webp({ quality: 60 }).toBuffer(),
    ];
    for (const v of variants) expect(photoMatch(h, await photoHash(v))).toBe("gleich");
  });

  it("hält verschiedene Produkte auseinander", async () => {
    const a = await photoHash(await pack("#d9a441", "Haferflocken"));
    const others = [
      await pack("#c0392b", "Tomatensoße"),
      await pack("#2e86c1", "Reiswaffeln", { x: 120 }),
      await pack("#d9a441", "Haferflocken", { x: 330 }),
    ];
    for (const o of others) expect(photoMatch(a, await photoHash(o))).not.toBe("gleich");
  });

  it("nimmt das passende Foto und ignoriert leere Bilder", async () => {
    const blank = await photoHash(await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fff" } }).jpeg().toBuffer());
    expect(usableHash(blank)).toBe(false);
    const h = await photoHash(await pack("#d9a441", "Haferflocken"));
    const h2 = await photoHash(await sharp(await pack("#d9a441", "Haferflocken")).resize(500).jpeg({ quality: 50 }).toBuffer());
    const t = await photoHash(await pack("#c0392b", "Tomatensoße"));
    expect(closestPhoto(h, [{ id: "t", hash: t }, { id: "h", hash: h2 }, { id: "b", hash: blank }])?.id).toBe("h");
    expect(closestPhoto(blank, [{ id: "b", hash: blank }])).toBeNull();
  });
});
