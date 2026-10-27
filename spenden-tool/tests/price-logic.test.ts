import { describe, expect, it } from "vitest";
import { packText, stripInternal, stripInternalDeep } from "@/lib/price-logic";
import { perPiece, suggestPackPrice } from "@/lib/pricing";
import { categoryHint, productKind, cleanAiText, comparability, guessUnit, isSecondHand, itemIssues, mhdAuto, mhdRelevant, parseSize, pricePrefix, priceState, publicText, splitInternal, unitIssue, unitLabel, UNSORTED_CATEGORY } from "@/lib/price-logic";
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
  it("ohne glaubwürdige Lage: keinen zweiten Preis drucken, sondern neues Foto verlangen", () => {
    expect(priceState({ price: 1 }, FILE, reading("2 €", 2, null))).toMatchObject({ plan: "ersetzen", oldVisible: true });
  });
  it("gleicher Preis im Foto: nur eine Beschriftung (Foto), ungelesene Fotos werden gemeldet", () => {
    expect(priceState({ price: 2 }, FILE, reading("Je 2 €", 2)).plan).toBe("foto");
    expect(priceState({ price: 2 }, FILE, { status: null, text: null, price: null, box: null }).unread).toBe(true);
    // Vom alten Leser ohne Ergebnis gelesen → noch einmal lesen; vom neuen Leser → verlässlich
    expect(priceState({ price: 2 }, FILE, { status: "done", text: null, price: null, box: null }).unread).toBe(true);
    expect(priceState({ price: 2 }, FILE, { status: "done", text: null, price: null, box: null, reader: 2 }).unread).toBe(false);
  });
  it("Preis nur im Foto, nicht eingetragen: zur Entscheidung", () => {
    expect(priceState({ price: null }, FILE, reading("60 Cent", 0.6))).toMatchObject({ conflict: true, photo: "fehlt-eingetragen" });
  });
  it("mehrere Preise im Foto: passt der eingetragene dazu, Foto behalten", () => {
    expect(priceState({ price: 5 }, FILE, reading("2kg 5€ / 5kg 10€", 5))).toMatchObject({ photo: "mehrere", conflict: false, plan: "foto" });
    expect(priceState({ price: 10 }, FILE, reading("2kg 5€ / 5kg 10€", 5)).plan).toBe("foto");
  });
  it("mehrere Preise im Foto, eingetragener passt nicht: drucken und Widerspruch", () => {
    expect(priceState({ price: 7 }, FILE, reading("2kg 5€ / 5kg 10€", 5))).toMatchObject({ conflict: true, plan: "ersetzen", oldVisible: true });
  });
  it("Text ohne Betrag im Foto: eingetragenen Preis drucken", () => {
    expect(priceState({ price: 1 }, FILE, reading("gratis", null as unknown as number))).toMatchObject({ photo: "ohne-betrag", plan: "drucken" });
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
    const i = { price: 0.4, unit: "stueck", unitCount: null, packs: [{ label: "ganzer Karton", price: 5 }] };
    expect(outputPrice(i)).toBe("je 40 Cent");
    expect(outputPrice(i, "flyer")).toBe("je 0,40€");
    const [sec] = flyerSections([{ name: "Zebra Riegel", variant: "23 g", category: "Lebensmittel", ...i }]);
    expect(sec.lines[0].price).toBe("je 0,40€ · ganzer Karton 5€");
  });
  it("„Noch zuordnen“ erscheint im Aushang als „Sonstiges“", () => {
    expect(flyerSections([{ name: "X", variant: null, category: UNSORTED_CATEGORY, price: 1 }])[0].category).toBe("Sonstiges");
  });
  it("raten aus Zusatz/Variante", () => {
    expect(guessUnit("je 6er pack", "120 g")).toEqual({ unit: "packung", count: 6, sure: true });
    expect(guessUnit(null, "23 g (Einzelriegel)")).toEqual({ unit: "stueck", count: null, sure: false });
    expect(guessUnit("ganzer Karton", "24 Dosen")).toEqual({ unit: "karton", count: 24, sure: true });
    expect(guessUnit(null, "500 g")).toBeNull();
    expect(guessUnit(null, "10 Stück")).toEqual({ unit: "packung", count: 10, sure: true });
    expect(guessUnit(null, "6 x 125 g")).toEqual({ unit: "packung", count: 6, sure: true });
  });
  it("Maße, Gewichte, Alter und Modellnummern ergeben keine Stückzahl", () => {
    expect(guessUnit(null, "68 x 64 cm")).toBeNull();
    expect(guessUnit(null, "Schwimmsitz 68 x 64 cm, 1-2 Jahre")).toBeNull();
    expect(guessUnit(null, "240 g")).toBeNull();
    expect(guessUnit(null, "ab 6 Monaten")).toBeNull();
    expect(guessUnit(null, "3-6 Jahre")).toBeNull();
    expect(guessUnit(null, "Modell 2024")).toBeNull();
    expect(guessUnit(null, "Art.-Nr. 12345")).toBeNull();
    expect(guessUnit(null, "Größe 4")).toBeNull();
    expect(guessUnit(null, "150 ml, 0-6 M")).toBeNull();
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
  it("Packung aus Einzelstücken: 5 × 23 g passt zu 5x23g im Handel", () => {
    expect(comparability("23 g (Einzelriegel)", { offers: [{ title: "HiPP Zebra Riegel 5x23g" }] }, 5).level).toBe("passt");
    expect(comparability("23 g (Einzelriegel)", { offers: [{ title: "HiPP Zebra Riegel 5x23g" }] }).level).toBe("abweichend");
  });
  it("gleiche Größe passt, KI-Unsicherheit macht unklar", () => {
    expect(comparability("120 g", { offers: [{ title: "HiPP Snackie 120g" }], summary: "Passt." }).level).toBe("passt");
    expect(comparability("120 g", { offers: [{ title: "HiPP Snackie 120g" }], summary: "Genaue Packungsgröße unbekannt." }).level).toBe("unklar");
    expect(comparability(null, { offers: [], summary: null }).level).toBe("unklar");
  });
});

describe("Produktart, MHD und Kategorie", () => {
  it("Babyzubehör und Schwimmhilfen brauchen kein MHD – auch falsch einsortiert", () => {
    expect(mhdAuto({ category: "Babyprodukte", name: "BEMA Schwimmflügel" }).relevant).toBe(false);
    expect(mhdAuto({ category: "Babyprodukte", name: "NUK Glasflasche", variant: "240 ml" }).relevant).toBe(false);
    expect(mhdAuto({ category: "Lebensmittel", name: "BEMA Schwimmsitz", variant: "68 x 64 cm" }).relevant).toBe(false);
    expect(mhdAuto({ category: "Babyprodukte", name: "HiPP Zebra Riegel" }).relevant).toBe(true);
    expect(mhdAuto({ category: "Babyprodukte", name: "HiPPiS Mixpack" }).relevant).toBe(true);
    expect(mhdAuto({ category: "Babyprodukte", name: "Babybrei Karotte" }).relevant).toBe(true);
    expect(mhdAuto({ category: "Lebensmittel", name: "Eiscreme Vanille" }).relevant).toBe(true);
  });
  it("Babynahrung erkannt, unbekannte Babyprodukte zur Prüfung statt ausgelassen", () => {
    expect(mhdAuto({ category: "Babyprodukte", name: "Bio Desserts Apfel" })).toMatchObject({ relevant: true, unsure: false });
    expect(mhdAuto({ category: "Babyprodukte", name: "Kinder-Set Lotta" })).toMatchObject({ relevant: true, unsure: true });
    const state = priceState({ price: 1, priceConfirmed: true }, FILE, null);
    const keys = itemIssues({ unnamed: false, product: { name: "Kinder-Set Lotta", category: "Babyprodukte", imageFileId: FILE }, item: { bestBefore: null, inCollage: true, unit: "stueck", unitConfirmed: true }, state }).map((i) => i.key);
    expect(keys).toContain("mhd-pruefen");
    expect(keys).not.toContain("mhd");
  });
  it("Gewürze unter Drogerie und Schwimmsitz unter Lebensmittel sind auffällig", () => {
    expect(categoryHint({ name: "Wiberg Chili-Fäden", category: "Drogerie & Haushalt" })?.suggest).toBe("Lebensmittel");
    expect(categoryHint({ name: "Wiberg Classic BBQ", category: "Drogerie & Haushalt" })?.suggest).toBe("Lebensmittel");
    expect(categoryHint({ name: "BEMA Schwimmsitz", category: "Lebensmittel" })?.suggest).toBe("Spielzeug");
    expect(categoryHint({ name: "Spontex Tuchschwämme", category: "Lebensmittel" })?.suggest).toBe("Haushalt");
    expect(categoryHint({ name: "Wiberg Chili-Fäden", category: "Drogerie & Haushalt", categoryChecked: true })).toBeNull();
    expect(categoryHint({ name: "Haferflocken", category: "Lebensmittel" })).toBeNull();
    expect(categoryHint({ name: "Getrocknete Tomaten", category: "Lebensmittel" })).toBeNull();
    expect(categoryHint({ name: "Basmati Reis", category: "Lebensmittel" })).toBeNull();
  });
  it("„Fertig“ übersieht keine Kategorie-Auffälligkeit", () => {
    const state = priceState({ price: 1, priceConfirmed: true }, FILE, null);
    const keys = itemIssues({ unnamed: false, product: { name: "Wiberg Chili-Fäden", category: "Drogerie & Haushalt", imageFileId: FILE }, item: { bestBefore: null, inCollage: true, unit: "stueck", unitConfirmed: true }, state }).map((i) => i.key);
    expect(keys).toContain("kategorie-pruefen");
  });
});

describe("Abgabeeinheit getrennt vom Preis", () => {
  it("bestätigter Preis, aber Einheit offen → eigener Punkt", () => {
    const state = priceState({ price: 4, priceConfirmed: true }, FILE, null);
    const keys = itemIssues({ unnamed: false, product: { name: "HiPP Zebra Riegel", variant: "23 g (Einzelriegel)", category: "Babyprodukte", imageFileId: FILE }, item: { bestBefore: "2026-12-01", inCollage: true, unit: null, unitConfirmed: false }, state }).map((i) => i.key);
    expect(keys).toEqual(["einheit"]);
  });
  it("Einzelstück für 4 € wird hinterfragt", () => {
    expect(unitIssue({ unit: "stueck", unitCount: null, unitConfirmed: true, price: 4 })).toContain("Einzelstück");
    expect(unitIssue({ unit: "packung", unitCount: 5, unitConfirmed: true, price: 4 })).toBeNull();
  });
});

describe("Interne Hinweise und KI-Texte", () => {
  it("Unsicherheiten aus Name/Variante heraushalten", () => {
    expect(splitInternal("500 g (genaue Packungsgröße unbekannt)")).toEqual({ clean: "500 g", notes: ["genaue Packungsgröße unbekannt"] });
    expect(publicText("Kekse, Marke nicht identifiziert")).toBe("Kekse");
    expect(publicText("200 g – alternativ verfügbar in 400 g")).toBe("200 g");
    expect(publicText("Bio Kimchi")).toBe("Bio Kimchi");
    // Sachliche Angaben bleiben öffentlich
    expect(publicText("LED-Kerze, ca. 12 cm Höhe")).toBe("LED-Kerze, ca. 12 cm Höhe");
    expect(splitInternal("ca. 60–80 g").notes).toEqual([]);
    expect(splitInternal("Nudeln, ca. 60–80 g").notes).toEqual([]);
  });
  it("Messenger-/Aushangtext ohne interne Hinweise", () => {
    const [sec] = flyerSections([{ name: "Kekse, Marke nicht identifiziert", variant: "500 g (genaue Packungsgröße unbekannt)", category: "Lebensmittel", price: 1 }]);
    expect(JSON.stringify(sec)).not.toMatch(/unbekannt|identifiziert/);
  });
  it("cite-Tags und B-Ware", () => {
    expect(cleanAiText('Schwimmsitz <cite index="1-2">ab 12,99 €</cite> bei Amazon.')).toBe("Schwimmsitz ab 12,99 € bei Amazon.");
    expect(isSecondHand("BEMA Schwimmsitz – B-Ware", "Amazon")).toBe(true);
    expect(comparability("68 x 64 cm", { offers: [{ title: "Schwimmsitz B-Ware" }], summary: null }).level).toBe("abweichend");
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
    expect(itemIssues({ unnamed: false, product: { name: "Plüsch-Einhorn", category: "Spielzeug", imageFileId: FILE }, item: { bestBefore: null, inCollage: true, unit: "stueck", unitConfirmed: true }, state })).toEqual([]);
  });
  it("unbestätigter Fotopreis und fehlendes MHD", () => {
    const state = priceState({ price: 0.5, priceConfirmed: false, priceSource: "foto" }, FILE, reading("50 Cent", 0.5));
    const keys = itemIssues({ unnamed: false, product: { name: "Haferflocken", category: "Lebensmittel", imageFileId: FILE }, item: { bestBefore: null, inCollage: true, unit: "stueck", unitConfirmed: true }, state }).map((i) => i.key);
    expect(keys).toEqual(["preis-unbestaetigt", "mhd"]);
  });
});

describe("Feinere Kategorien", () => {
  it("Drogerie und Haushalt getrennt, Süßes, Getränke, Tee, Pflege", () => {
    // Haut- und Haarpflege gehören zur Drogerie
    expect(categoryHint({ name: "YEAUTY Tuchmaske", category: "Drogerie & Haushalt" })?.suggest).toBe("Drogerie");
    expect(categoryHint({ name: "Shampoo Kamille", category: "Drogerie & Haushalt" })?.suggest).toBe("Drogerie");
    expect(categoryHint({ name: "Shampoo Kamille", category: "Drogerie" })).toBeNull();
    expect(categoryHint({ name: "Handcreme", category: "Hautpflege" })?.suggest).toBe("Drogerie");
    expect(categoryHint({ name: "Zahnpasta", category: "Drogerie & Haushalt" })?.suggest).toBe("Drogerie");
    expect(categoryHint({ name: "Spülmittel", category: "Drogerie & Haushalt" })?.suggest).toBe("Haushalt");
    expect(categoryHint({ name: "Funny-frisch Jumpys Paprika", category: "Lebensmittel" })?.suggest).toBe("Süßes & Snacks");
    expect(categoryHint({ name: "Kaugummi Minze", category: "Lebensmittel" })?.suggest).toBe("Süßes & Snacks");
    expect(categoryHint({ name: "Tee Kamille", category: "Lebensmittel" })?.suggest).toBe("Tee & Nahrungsergänzung");
    expect(categoryHint({ name: "Magnesium Brausetabletten", category: "Drogerie & Haushalt" })?.suggest).toBe("Tee & Nahrungsergänzung");
    expect(categoryHint({ name: "Eistee Pfirsich", category: "Lebensmittel" })?.suggest).toBe("Getränke inkl. Pfand");
    expect(categoryHint({ name: "HiPP Snackie", category: "Babyprodukte" })).toBeNull();
  });
  it("Produkttyp vor Geschmack", () => {
    expect(categoryHint({ name: "Powerade Golden Mango", category: "Getränke inkl. Pfand" })).toBeNull();
    expect(categoryHint({ name: "Becks Trinkschokoladenpulver", category: "Lebensmittel" })).toBeNull();
    expect(categoryHint({ name: "Mango Chutney", category: "Lebensmittel" })).toBeNull();
    expect(categoryHint({ name: "Powerade Golden Mango", category: "Lebensmittel" })?.suggest).toBe("Getränke inkl. Pfand");
    expect(categoryHint({ name: "Bitzee", category: "Lebensmittel" })?.suggest).toBe("Spielzeug");
    expect(categoryHint({ name: "Baby Einstein Magic Touch Piano", category: "Lebensmittel" })?.suggest).toBe("Spielzeug");
    expect(categoryHint({ name: "Haferflocken", category: "Lebensmittel" })).toBeNull();
  });
  it("Pflegeprodukt mit Duftangabe: Kategorie und MHD gemeinsam richtig", () => {
    const gel = { name: "Schoenenberger ExtraHair Styling Gel", variant: "Bambus & Orange" };
    expect(productKind(gel.name, gel.variant)?.kind).toBe("haarpflege");
    for (const category of ["Drogerie", "Lebensmittel", UNSORTED_CATEGORY]) expect(mhdAuto({ ...gel, category }).relevant).toBe(false);
    expect(categoryHint({ ...gel, category: "Drogerie" })).toBeNull();
    expect(categoryHint({ ...gel, category: "Lebensmittel" })?.suggest).toBe("Drogerie");
    expect(categoryHint({ name: "Schoenenberger ExtraHair Styling Gel – Bambus & Orange", category: "Lebensmittel" })?.suggest).toBe("Drogerie");
    expect(productKind("Balea Shampoo Orange & Ingwer")?.kind).toBe("haarpflege");
    expect(productKind("Duschgel Mango")?.kind).toBe("hautpflege");
    expect(productKind("Bodylotion Kokos")?.kind).toBe("hautpflege");
    expect(mhdAuto({ name: "Haarspray Vanille", category: "Drogerie" }).relevant).toBe(false);
  });
  it("Geschmack allein ändert weder Kategorie noch MHD einer Drogerie-Kategorie", () => {
    expect(categoryHint({ name: "Duftkerze Orange", category: "Haushalt" })).toBeNull();
    expect(mhdAuto({ name: "Raumduft Orange", category: "Haushalt" }).relevant).toBe(false);
    expect(categoryHint({ name: "Orangen Raumspray", category: "Drogerie" })).toBeNull();
    // Unsortiert mit nur einem Geschmack: lieber nachfragen als raten.
    expect(mhdAuto({ name: "Bambus Orange", category: UNSORTED_CATEGORY }).unsure).toBe(true);
    // Echte Lebensmittel bleiben Lebensmittel.
    expect(productKind("Orangensaft")?.kind).toBe("getraenk");
    expect(mhdAuto({ name: "Mango Chutney", category: "Lebensmittel" }).relevant).toBe(true);
    expect(productKind("Nuss-Nougat-Creme")?.kind).not.toBe("hautpflege");
    expect(productKind("Haferflocken")?.kind).toBe("lebensmittel");
  });
  it("Süßes und Tee brauchen ein MHD, Pflege nicht", () => {
    expect(mhdAuto({ category: "Süßes & Snacks", name: "Gummibärchen" }).relevant).toBe(true);
    expect(mhdAuto({ category: "Tee & Nahrungsergänzung", name: "Vitamin C" }).relevant).toBe(true);
    expect(mhdAuto({ category: "Hautpflege", name: "Handcreme" }).relevant).toBe(false);
  });
});

describe("Ganze Packung / Kasten", () => {
  it("Bezeichnung mit Anzahl und Inhalt", () => {
    expect(packText({ packKind: "kasten", packCount: 12 }, true, "0,5 l")).toBe("Kasten (12 × 0,5 l)");
    expect(packText({ packKind: "kasten", packCount: 24 }, true, "330 ml")).toBe("Kasten (24 × 330 ml)");
    expect(packText({ packKind: "karton", packCount: 24 }, false, "23 g")).toBe("Karton (24 St.)");
    expect(packText({ packKind: null, packCount: null }, false)).toBe("ganze Packung");
    expect(packText({ packKind: "karton", packCount: 24, packNote: "ganzer Karton" })).toBe("ganzer Karton");
  });
  it("Vorschlag: 20 % vom Handelspreis der Packung, Getränke mit normalem Anteil", () => {
    // Stückpreis aus einem Kasten-Angebot: 12 Flaschen für 9,60 € → 0,80 € je Flasche (nie der Literpreis)
    expect(perPiece({ price: 9.6, count: 12 })).toBeCloseTo(0.8);
    expect(suggestPackPrice(1, 24, false)).toEqual({ price: 4.8, retail: 24, share: 0.2 });
    expect(suggestPackPrice(0.8, 12, true)).toEqual({ price: 2.4, retail: 9.6, share: 0.25 });
    expect(suggestPackPrice(1, null, false)).toBeNull();
  });
});

describe("Gespeicherte Ideen bereinigen", () => {
  it("Recherche-Anmerkungen raus, Prosa bleibt", () => {
    expect(stripInternal("• Thai Style Nudeln – Marke nicht identifiziert")).toBe("• Thai Style Nudeln");
    expect(stripInternal("Kekse (genaue Packungsgröße unbekannt), Tee")).toBe("Kekse, Tee");
    expect(stripInternal("Das wird wahrscheinlich ein toller Tag – kommt vorbei!")).toBe("Das wird wahrscheinlich ein toller Tag – kommt vorbei!");
    expect(stripInternalDeep({ pakete: [{ produkte: ["Thai Style Nudeln – Marke nicht identifiziert", "Reis"] }], n: 3 })).toEqual({ pakete: [{ produkte: ["Thai Style Nudeln", "Reis"] }], n: 3 });
  });
});

describe("Varianten und Bestand", () => {
  it("listet alle Varianten mit Preis, günstigste zuerst", async () => {
    const { packOffers } = await import("@/lib/price-logic");
    const offers = packOffers({ packKind: "palette", packCount: 600, packPrice: 50, morePacks: [{ kind: "karton", count: 24, price: 5, note: null }, { kind: "tray", count: 6, price: null, note: null }] });
    expect(offers).toEqual([{ label: "Karton (24 St.)", price: 5 }, { label: "Palette (600 St.)", price: 50 }]);
    const { packLabel } = await import("@/lib/layout");
    expect(packLabel(offers)).toBe("Karton (24 St.) 5€ · Palette (600 St.) 50€");
  });
  it("schlägt bei viel Bestand einen günstigeren Preis vor", async () => {
    const { stockPrice } = await import("@/lib/pricing");
    expect(stockPrice(1, "palette")).toEqual({ price: 0.6, factor: 0.6 });
    expect(stockPrice(1, "kartons")).toEqual({ price: 0.9, factor: 0.9 });
    expect(stockPrice(1, "reste")).toBeNull();
    expect(stockPrice(0.1, "palette")).toBeNull();
    expect(stockPrice(null, "palette")).toBeNull();
  });
});
