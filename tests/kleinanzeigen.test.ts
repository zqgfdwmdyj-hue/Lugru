import { describe, expect, it } from "vitest";
import { kaPreis, kaTitel, kategorieVorschlag, kleinanzeigenEntwurf, zustandText, KA_TITEL_MAX } from "@/lib/kleinanzeigen/logic";

// Kleinanzeigen-Entwurf aus einem (erfundenen) eBay-Angebot: Titel ≤ 65, Text ohne eBay-Sätze, Preis in ganzen Euro,
// Kategorie-Vorschlag, Zustand, höchstens 20 Bilder.

const basis = {
  title: "Testmarke Bratpfanne 28 cm Edelstahl induktionsgeeignet NEU OVP Blitzversand Rechnung mit MwSt",
  price: 24.9,
  categoryName: "Haushalt > Kochen & Genießen > Töpfe & Pfannen",
  conditionName: "Neu",
  conditionId: "1000",
  images: Array.from({ length: 22 }, (_, i) => `https://i.ebayimg.example/bild-${i + 1}.jpg`),
  descriptionText: "Hochwertige Pfanne aus Edelstahl.\nSpülmaschinengeeignet.\nZahlung per PayPal innerhalb von 7 Tagen.\nBitte beachten Sie unsere eBay-Bewertungen.\nArtikelstandort: Musterstadt",
  aspects: { Marke: ["Testmarke"], Durchmesser: ["28 cm"], EAN: ["4006381333931"], Herstellernummer: ["Nicht zutreffend"] },
  brand: "Testmarke",
  ean: "4006381333931",
};

describe("Kleinanzeigen-Entwurf", () => {
  it("Titel auf 65 Zeichen an der Wortgrenze, Füllwörter weg", () => {
    const t = kaTitel(basis.title);
    expect(t.length).toBeLessThanOrEqual(KA_TITEL_MAX);
    expect(t).not.toMatch(/Blitzversand|Rechnung mit MwSt/i);
    expect(t.startsWith("Testmarke Bratpfanne 28 cm Edelstahl")).toBe(true);
    expect(t).not.toMatch(/\s$/);
    expect(kaTitel("Kurzer Titel")).toBe("Kurzer Titel");
  });
  it("Preis in ganzen Euro", () => {
    expect(kaPreis(24.9)).toBe(25);
    expect(kaPreis(24.49)).toBe(24);
    expect(kaPreis(0.2)).toBe(1);
  });
  it("Kategorie aus der eBay-Kategorie, sonst aus dem Titel, sonst keine", () => {
    expect(kategorieVorschlag("Haushalt > Kochen & Genießen > Töpfe & Pfannen", "x")).toBe("Haus & Garten > Küche & Esszimmer");
    expect(kategorieVorschlag(null, "Bluetooth Kopfhörer Test")).toBe("Elektronik > Audio & Hifi");
    expect(kategorieVorschlag("Sonstiges", "Unbekanntes Ding")).toBeNull();
  });
  it("Zustand in Kleinanzeigen-Worten", () => {
    expect(zustandText("Neu", "1000")).toBe("Neu");
    expect(zustandText("Neu: Sonstige (siehe Artikelbeschreibung)", "1500")).toBe("Sehr gut");
    expect(zustandText("Gebraucht", "3000")).toBe("Gut");
    expect(zustandText("Als Ersatzteil / defekt", "7000")).toBe("Defekt");
  });
  it("vollständiger Entwurf: Text ohne eBay-Sätze, Merkmale ohne EAN/„Nicht zutreffend“, 20 Bilder, Hinweise", () => {
    const e = kleinanzeigenEntwurf(basis);
    expect(e.preis).toBe(25);
    expect(e.preisText).toBe("25 €");
    expect(e.zustand).toBe("Neu");
    expect(e.kategorie).toBe("Haus & Garten > Küche & Esszimmer");
    expect(e.bilder).toHaveLength(20);
    expect(e.text).toContain("Zustand: Neu und originalverpackt.");
    expect(e.text).toContain("Hochwertige Pfanne aus Edelstahl.");
    expect(e.text).toContain("• Durchmesser: 28 cm");
    expect(e.text).not.toMatch(/PayPal|eBay|Artikelstandort|4006381333931|Nicht zutreffend/);
    expect(e.text).toContain("Versand möglich.");
    expect(e.text).toContain("Gewerblicher Verkauf");
    expect(e.hinweise.join(" ")).toMatch(/Titel auf 65 Zeichen gekürzt.*20 von 22 Bildern.*ganze Euro.*gewerblicher Anbieter/);
  });
  it("Optionen: VB, Abholung, privat ohne Gewerbe-Zeile; ohne Bilder ein Hinweis", () => {
    const e = kleinanzeigenEntwurf({ ...basis, images: [] }, { preisArt: "VB", abholungOrt: "Musterstadt", gewerblich: false });
    expect(e.preisText).toBe("25 € VB");
    expect(e.text).toContain("Abholung in Musterstadt möglich.");
    expect(e.text).not.toContain("Gewerblicher Verkauf");
    expect(e.hinweise).toContain("Keine Bilder im eBay-Angebot – Fotos selbst aufnehmen.");
  });
});
