import { describe, expect, it } from "vitest";
import { comparability, guessUnit, itemIssues, mhdRelevant, parseSize, pricePrefix, priceState, unitLabel, UNSORTED_CATEGORY } from "@/lib/price-logic";
import { flyerSections, outputPrice } from "@/lib/layout";

const FILE = "11111111-1111-1111-1111-111111111111";
const reading = (text: string, price: number | null, box: unknown = { x: 0.1, y: 0.8, w: 0.5, h: 0.12 }) => ({ status: "done", text, price, box });

describe("priceState – gespeicherte Spendenempfehlung gilt überall", () => {
  it("ohne Preis im Foto: normal drucken", () => {
    const s = priceState({ price: 2.5, priceConfirmed: true }, FILE, null);
    expect(s).toMatchObject({ price: 2.5, photo: "keiner", conflict: false, plan: "drucken", confirmed: true });
  });
  it("gleicher Preis im Foto: nicht doppelt drucken", () => {
    expect(priceState({ price: 0.5, priceConfirmed: true }, FILE, reading("Je 50 Cent", 0.5))).toMatchObject({ photo: "gleich", plan: "foto", conflict: false });
  });
  it("abweichender Fotopreis überstimmt den eingetragenen nicht, sondern ist ein Widerspruch", () => {
    // Bialetti: Foto „Je 50€“ erkannt, eingetragen 2,50 €
    const s = priceState({ price: 2.5, priceConfirmed: true }, FILE, reading("Je 50€", 50));
    expect(s.price).toBe(2.5);
    expect(s.conflict).toBe(true);
    expect(s.suspicious).toBe(true);
    expect(s.plan).toBe("aufkleber");
  });
  it("„eingetragenen Preis bestätigen“ löst den Widerspruch für genau dieses Foto", () => {
    const s = priceState({ price: 2.5, priceConfirmed: true, priceOverPhotoFileId: FILE }, FILE, reading("2 €", 2));
    expect(s).toMatchObject({ conflict: false, photo: "abweichend-geloest", plan: "aufkleber" });
    expect(priceState({ price: 2.5, priceOverPhotoFileId: "anderes-foto" }, FILE, reading("2 €", 2)).conflict).toBe(true);
  });
  it("ohne glaubwürdige Lage: Preis normal drucken, alter bleibt sichtbar", () => {
    expect(priceState({ price: 1 }, FILE, reading("2 €", 2, null))).toMatchObject({ plan: "drucken", oldVisible: true });
  });
  it("Preis nur im Foto, nicht eingetragen: zur Entscheidung", () => {
    expect(priceState({ price: null }, FILE, reading("60 Cent", 0.6))).toMatchObject({ conflict: true, photo: "fehlt-eingetragen" });
  });
  it("mehrere Preise im Foto: Foto behalten, kein Widerspruch", () => {
    expect(priceState({ price: 5 }, FILE, reading("2kg 5€ / 5kg 10€", 5))).toMatchObject({ photo: "mehrere", conflict: false, plan: "foto" });
  });
  it("Foto wird noch gelesen", () => {
    expect(priceState({ price: 1 }, FILE, { status: "pending", text: null, price: null, box: null }).photo).toBe("wird-gelesen");
  });
  it("Fotopreis ohne Produktfoto zählt nicht", () => {
    expect(priceState({ price: 1 }, null, reading("2 €", 2)).photo).toBe("keiner");
  });
});

describe("Abgabeeinheit", () => {
  it("Beschriftung", () => {
    expect(unitLabel("packung", 6)).toBe("6er-Pack");
    expect(unitLabel("karton", 24)).toBe("Karton (24 Stück)");
    expect(unitLabel("stueck", null)).toBe("Einzelstück");
    expect(unitLabel(null, null)).toBe("");
  });
  it("freier Zusatz gewinnt, sonst aus der Einheit", () => {
    expect(pricePrefix({ unit: "packung", unitCount: 6, priceNote: null })).toBe("6er-Pack");
    expect(pricePrefix({ unit: "stueck", unitCount: null })).toBe("je");
    expect(pricePrefix({ unit: "packung", unitCount: 6, priceNote: "je Pack" })).toBe("je Pack");
  });
  it("gleicher Text in Aushang und Collage", () => {
    const i = { price: 0.4, unit: "stueck", unitCount: null, packNote: "ganzer Karton", packPrice: 5 };
    expect(outputPrice(i)).toBe("je 40 Cent");
    expect(outputPrice(i, "flyer")).toBe("je 0,40€");
    const [sec] = flyerSections([{ name: "Zebra Riegel", variant: "23 g", category: "Lebensmittel", ...i }]);
    expect(sec.lines[0].price).toBe("je 0,40€ · ganzer Karton 5€");
  });
  it("„Noch zuordnen“ erscheint im Aushang als „Sonstiges“", () => {
    expect(flyerSections([{ name: "X", variant: null, category: UNSORTED_CATEGORY, price: 1 }])[0].category).toBe("Sonstiges");
  });
  it("raten aus Zusatz/Variante", () => {
    expect(guessUnit("je 6er pack", "120 g")).toEqual({ unit: "packung", count: 6 });
    expect(guessUnit(null, "23 g (Einzelriegel)")).toEqual({ unit: "stueck", count: null });
    expect(guessUnit("ganzer Karton", "24 Dosen")).toEqual({ unit: "karton", count: 24 });
    expect(guessUnit(null, "500 g")).toBeNull();
  });
});

describe("Packungsgrößen vergleichen", () => {
  it("parseSize", () => {
    expect(parseSize("240 g")).toEqual({ total: 240, base: "g" });
    expect(parseSize("1,5 l")).toEqual({ total: 1500, base: "ml" });
    expect(parseSize("5 x 23g Riegel")).toEqual({ total: 115, base: "g" });
    expect(parseSize("Einzelriegel")).toBeNull();
  });
  it("Ülker Halley: 240 g gegen 77 g → nicht vergleichbar", () => {
    const c = comparability("240 g", { offers: [{ title: "Ülker Halley 77g" }], summary: "Kekse mit Marshmallow." });
    expect(c.level).toBe("abweichend");
    expect(c.reason).toContain("77 g");
  });
  it("gleiche Größe passt, KI-Unsicherheit macht unklar", () => {
    expect(comparability("120 g", { offers: [{ title: "HiPP Snackie 120g" }], summary: "Passt." }).level).toBe("passt");
    expect(comparability("120 g", { offers: [{ title: "HiPP Snackie 120g" }], summary: "Genaue Packungsgröße unbekannt." }).level).toBe("unklar");
    expect(comparability(null, { offers: [], summary: null }).level).toBe("unklar");
  });
});

describe("MHD und Prüfstatus", () => {
  it("MHD nur für relevante Produkte", () => {
    expect(mhdRelevant({ category: "Lebensmittel" })).toBe(true);
    expect(mhdRelevant({ category: "Spielzeug" })).toBe(false);
    expect(mhdRelevant({ category: "Spielzeug", mhdMode: "ja" })).toBe(true);
    expect(mhdRelevant({ category: "Lebensmittel", mhdMode: "nein" })).toBe(false);
  });
  it("Spielzeug ohne MHD ist fertig", () => {
    const state = priceState({ price: 1, priceConfirmed: true }, FILE, null);
    expect(itemIssues({ unnamed: false, product: { category: "Spielzeug", imageFileId: FILE }, item: { bestBefore: null, inCollage: true }, state })).toEqual([]);
  });
  it("unbestätigter Fotopreis und fehlendes MHD", () => {
    const state = priceState({ price: 0.5, priceConfirmed: false, priceSource: "foto" }, FILE, reading("50 Cent", 0.5));
    const keys = itemIssues({ unnamed: false, product: { category: "Lebensmittel", imageFileId: FILE }, item: { bestBefore: null, inCollage: true }, state }).map((i) => i.key);
    expect(keys).toEqual(["preis-unbestaetigt", "mhd"]);
  });
});
