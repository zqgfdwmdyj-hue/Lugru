import { describe, expect, it } from "vitest";
import { bqoolAbleiten, bqoolErgebnisText, bqoolUploadAdressen, bqoolZeilen } from "@/lib/automatik/bqool-logic";

// B23 – erfundene Adressen.
const DE = "https://bqool.example/repricing/amazonde/upload";

describe("B23 – BQool-Upload-Seite je Land", () => {
  it("FR/IT/ES aus DE abgeleitet, eigenes Feld geht vor, NL & Co. nur wenn eingetragen", () => {
    const a = bqoolUploadAdressen({ uploadUrl: DE, uploadUrlIT: "https://bqool.example/repricing/italien/upload", uploadUrlNL: "https://bqool.example/repricing/amazonnl/upload" });
    const m = Object.fromEntries(a.map((x) => [x.land, x]));
    expect(m.DE).toEqual({ land: "DE", url: DE, abgeleitet: false });
    expect(m.FR).toEqual({ land: "FR", url: "https://bqool.example/repricing/amazonfr/upload", abgeleitet: true });
    expect(m.IT).toEqual({ land: "IT", url: "https://bqool.example/repricing/italien/upload", abgeleitet: false });
    expect(m.ES.url).toBe("https://bqool.example/repricing/amazones/upload");
    expect(m.NL.url).toBe("https://bqool.example/repricing/amazonnl/upload");
    expect(m.PL.url).toBeNull();
  });
  it("ohne „amazonde“ in der DE-Adresse wird nichts geraten", () => {
    expect(bqoolAbleiten("https://bqool.example/upload", "FR")).toBeNull();
    expect(bqoolUploadAdressen({ uploadUrl: "https://bqool.example/upload" }).find((x) => x.land === "FR")?.url).toBeNull();
  });
  it("Zeilen ohne Kopf; Ergebnis je Land", () => {
    expect(bqoolZeilen("FileType…\nChannel\tSellerSKU\nAmazon DE\tA\nAmazon DE\tB\n")).toBe(2);
    expect(bqoolErgebnisText([{ land: "DE", datei: "d", zeilen: 824, ok: true }, { land: "FR", datei: "f", zeilen: 10, ok: false, fehler: "Login" }])).toBe("DE: 824 Zeilen hochgeladen · FR: Fehler – Login");
  });
});
