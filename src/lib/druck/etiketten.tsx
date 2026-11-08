import "server-only";
import bwipjs from "bwip-js/node";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { Graubild, Medium } from "./brother";
import { STEUER_CODES, type VorlageId } from "./logic";

// Druckbilder der Vorlagen als PNG in Druckerauflösung (300 dpi): 62 × 29 mm = 696 × 271 px, 102 × 152 mm = 1164 × 1660 px.
// Gerendert mit next/og (Schrift eingebaut, keine Systemschriften nötig), Barcodes mit bwip-js.

async function barcode(bcid: string, text: string, hoehe = 12, scale = 3): Promise<string> {
  const png = await bwipjs.toBuffer({ bcid, text, scale, height: hoehe, includetext: false, paddingwidth: 0, paddingheight: 0 });
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

const kurz = (t: string | undefined, n: number) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const eanArt = (t: string) => (/^\d{13}$/.test(t) ? "ean13" : /^\d{8}$/.test(t) ? "ean8" : /^\d{12}$/.test(t) ? "upca" : "code128");

type E = Record<string, string | undefined>;

async function inhalt(vorlage: VorlageId, e: E, b: number, h: number) {
  const voll = { width: b, height: h, display: "flex", flexDirection: "column" as const, background: "#fff", color: "#000", padding: 18, boxSizing: "border-box" as const };
  switch (vorlage) {
    case "fnsku": {
      const bc = await barcode("code128", e.fnsku ?? "");
      return (
        <div style={{ ...voll, padding: "14px 24px", justifyContent: "space-between" }}>
          <img src={bc} style={{ width: b - 48, height: 118 }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 34, fontWeight: 700, letterSpacing: 1 }}>
            <span>{e.fnsku}</span>
            <span>{e.zustand || "Neu"}</span>
          </div>
          <div style={{ display: "flex", fontSize: 22, lineHeight: 1.1, maxHeight: 50, overflow: "hidden" }}>{kurz(e.titel, 90)}</div>
          {e.zusatz ? <div style={{ display: "flex", fontSize: 18 }}>{kurz(e.zusatz, 60)}</div> : null}
        </div>
      );
    }
    case "ean": {
      const bc = await barcode(eanArt(e.ean ?? ""), e.ean ?? "");
      return (
        <div style={{ ...voll, padding: "14px 24px", justifyContent: "space-between" }}>
          <img src={bc} style={{ width: b - 48, height: 120 }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, fontWeight: 700 }}>
            <span>{e.ean}</span>
            <span style={{ fontSize: 22 }}>{kurz(e.sku, 24)}</span>
          </div>
          <div style={{ display: "flex", fontSize: 22, lineHeight: 1.1, maxHeight: 50, overflow: "hidden" }}>{kurz(e.titel, 90)}</div>
        </div>
      );
    }
    case "preis":
      return (
        <div style={{ ...voll, justifyContent: "center", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, textAlign: "center", maxHeight: 64, overflow: "hidden" }}>{kurz(e.titel, 60)}</div>
          <div style={{ display: "flex", fontSize: 120, fontWeight: 700, lineHeight: 1 }}>{e.preis} €</div>
          {e.zusatz ? <div style={{ display: "flex", fontSize: 20 }}>{kurz(e.zusatz, 50)}</div> : null}
        </div>
      );
    case "stellplatz": {
      const bc = await barcode("code128", `FACH-${e.fach ?? ""}`, 10);
      return (
        <div style={{ ...voll, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, lineHeight: 1 }}>{e.fach}</div>
          <img src={bc} style={{ width: b - 80, height: 90 }} />
          <div style={{ display: "flex", fontSize: 22 }}>{kurz(e.text, 50)}</div>
        </div>
      );
    }
    case "retoure": {
      const bc = await barcode("code128", e.retSku ?? "", 10, 2);
      return (
        <div style={{ ...voll, padding: "12px 20px", justifyContent: "space-between" }}>
          <img src={bc} style={{ width: b - 40, height: 100 }} />
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>{kurz(e.retSku, 46)}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}>
            <span>{e.lpn ? `LPN ${e.lpn}` : "Retoure"}</span>
            <span>{kurz(e.titel, 34)}</span>
          </div>
        </div>
      );
    }
    case "lieferschein": {
      const bc = await barcode("code128", e.nummer ?? "", 9);
      return (
        <div style={{ ...voll, justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>{kurz(e.kunde, 30)}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30 }}>
            <span>Lieferschein {e.nummer}</span>
            <span>{e.pakete}</span>
          </div>
          <img src={bc} style={{ width: b - 36, height: 80 }} />
        </div>
      );
    }
    case "palette": {
      const bc = await barcode("code128", e.nummer ?? "", 18, 4);
      return (
        <div style={{ ...voll, padding: 60, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 110, fontWeight: 700, textAlign: "center" }}>{kurz(e.kunde, 18)}</div>
          <div style={{ display: "flex", fontSize: 56 }}>Palette</div>
          <div style={{ display: "flex", fontSize: 220, fontWeight: 700, lineHeight: 1 }}>{e.nummer}</div>
          <img src={bc} style={{ width: b - 160, height: 260 }} />
          <div style={{ display: "flex", fontSize: 44, textAlign: "center" }}>{kurz(e.inhalt, 60)}</div>
        </div>
      );
    }
    case "steuerkarte": {
      const codes = await Promise.all(Object.entries(STEUER_CODES).map(async ([c, t]) => ({ t, bc: await barcode("code128", c, 12, 3) })));
      return (
        <div style={{ ...voll, padding: 50, justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 54, fontWeight: 700 }}>Steuer-Barcodes · Werkbank</div>
          {codes.map((c) => (
            <div key={c.t} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <img src={c.bc} style={{ width: b - 260, height: 150 }} />
              <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>{c.t}</div>
            </div>
          ))}
        </div>
      );
    }
    default:
      return <div style={{ ...voll }}>{vorlage}</div>;
  }
}

/** Druckbild einer Vorlage als PNG in der Größe des Mediums. */
export async function etikettPng(vorlage: VorlageId, eingabe: E, medium: Medium): Promise<Buffer> {
  const b = medium.punkteBreite;
  const h = medium.punkteLaenge || 271;
  const res = new ImageResponse(await inhalt(vorlage, eingabe, b, h), { width: b, height: h });
  return Buffer.from(await res.arrayBuffer());
}

/** PNG (beliebig) → Graustufen in genau Breite × Höhe (weißer Rand, Seitenverhältnis bleibt). */
export async function pngZuGraubild(png: Buffer, breite: number, hoehe: number | null): Promise<Graubild> {
  let s = sharp(png).flatten({ background: "#ffffff" });
  if (hoehe) s = s.resize(breite, hoehe, { fit: "contain", background: "#ffffff" });
  else s = s.resize({ width: breite, fit: "inside", withoutEnlargement: false });
  const { data, info } = await s.toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  const pixel = info.channels === 1 ? new Uint8Array(data) : Uint8Array.from({ length: info.width * info.height }, (_, i) => data[i * info.channels]);
  return { breite: info.width, hoehe: info.height, pixel };
}

/** Graustufenbild → PNG (Vorschau). */
export async function graubildZuPng(g: Graubild): Promise<Buffer> {
  return sharp(Buffer.from(g.pixel), { raw: { width: g.breite, height: g.hoehe, channels: 1 } }).png().toBuffer();
}
