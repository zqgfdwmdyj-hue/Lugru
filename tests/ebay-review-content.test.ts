import { describe, expect, it } from "vitest";
import { amazonContentFrom, cleanImages, descriptionFromParts, isEbayHosted, MAX_IMAGES, sanitizeDescription } from "@/lib/ebay-review/content";
import { reviseXml, revisionSummary } from "@/lib/ebay-review/logic";

describe("Amazon-Inhalte (Keepa) fürs eBay-Angebot", () => {
  it("übersetzt Bilder, Stichpunkte und Merkmale – nur, was Amazon nennt", () => {
    const c = amazonContentFrom({
      asin: "B0TESTBILD",
      title: "Testmarke Thermobecher 500 ml",
      imagesCSV: "41aaa.jpg,51bbb.jpg,41aaa.jpg",
      features: ["Hält 12 h warm", " ", "Spülmaschinenfest"],
      description: "Ein Becher.",
      brand: "Testmarke",
      color: "Schwarz",
      model: "TB-500",
      numberOfItems: -1,
      size: "x".repeat(80),
    });
    expect(c.images).toEqual(["https://m.media-amazon.com/images/I/41aaa.jpg", "https://m.media-amazon.com/images/I/51bbb.jpg"]);
    expect(c.bullets).toEqual(["Hält 12 h warm", "Spülmaschinenfest"]);
    expect(c.aspects).toEqual({ Marke: "Testmarke", Modell: "TB-500", Farbe: "Schwarz" });
    expect(c.amazonUrl).toBe("https://www.amazon.de/dp/B0TESTBILD");
  });

  it("Beschreibung aus Teilen: maskiert HTML, Absätze und Zeilenumbrüche", () => {
    const html = descriptionFromParts({ heading: "Becher <XL>", bullets: ["a & b"], text: "Zeile 1\nZeile 2\n\nAbsatz 2" });
    expect(html).toBe("<h2>Becher &lt;XL&gt;</h2>\n<ul><li>a &amp; b</li></ul>\n<p>Zeile 1<br>Zeile 2</p>\n<p>Absatz 2</p>");
  });
});

describe("Beschreibung säubern", () => {
  it("entfernt aktive Inhalte, lässt normales HTML stehen", () => {
    const dirty = `<style>p{color:red}</style><p onclick="x()">Hallo <b>Welt</b> – Version one = gut</p><script>alert(1)</script><SCRIPT src=x><iframe src="https://x"></iframe><a href="javascript:evil()">x</a><img src="https://i.ebayimg.com/a.jpg" onerror='y()'><!-- k --><form><input name=a></form>`;
    const clean = sanitizeDescription(dirty);
    expect(clean).toContain("<p>Hallo <b>Welt</b> – Version one = gut</p>");
    expect(clean).toContain("<style>p{color:red}</style>");
    expect(clean).toContain('<img src="https://i.ebayimg.com/a.jpg">');
    expect(clean).not.toMatch(/script|alert|iframe|onclick|onerror|javascript:|<form|<input|<!--/i);
    expect(clean).toContain('<a href="#">x</a>');
  });
});

describe("Bilderliste", () => {
  it("nur https, keine Doppelten, höchstens 24", () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://i.ebayimg.com/${i}.jpg`);
    const r = cleanImages(["http://fremd.example/a.jpg", " https://i.ebayimg.com/0.jpg ", ...many, "ftp://x"]);
    expect(r.images).toHaveLength(MAX_IMAGES);
    expect(r.images[0]).toBe("https://i.ebayimg.com/0.jpg");
    expect(r.dropped).toContain("http://fremd.example/a.jpg");
    expect(r.dropped).toContain("ftp://x");
    expect(r.dropped).toContain("https://i.ebayimg.com/29.jpg");
  });
  it("erkennt bei eBay gehostete Bilder", () => {
    expect(isEbayHosted("https://i.ebayimg.com/00/s/abc/$_57.JPG")).toBe(true);
    expect(isEbayHosted("https://m.media-amazon.com/images/I/41a.jpg")).toBe(false);
  });
});

describe("Änderung senden (Trading API)", () => {
  it("Bilder und Beschreibung im Rumpf, CDATA sicher", () => {
    const x = reviseXml("110000000001", { images: ["https://i.ebayimg.com/a.jpg?x=1&y=2"], description: "<p>a]]>b</p>" });
    expect(x).toContain("<PictureDetails><PictureURL>https://i.ebayimg.com/a.jpg?x=1&amp;y=2</PictureURL></PictureDetails>");
    expect(x).toContain("<Description><![CDATA[<p>a]]&gt;b</p>]]></Description>");
  });
  it("Zusammenfassung nennt Bilder und Beschreibung", () => {
    expect(revisionSummary({ title: "T", price: 1, bestOffer: false, images: ["a"] }, { images: ["a", "b"], description: "x" })).toEqual(["Bilder: 1 → 2", "Beschreibung geändert"]);
  });
});

describe("Prüfrunde 2: Marke im Titel, Arten von Hinweisen", () => {
  it("SanDisk wird gefunden – auch mit ®, Firmenzusatz oder anderer Schreibweise", async () => {
    const { brandInTitle } = await import("@/lib/ebay-review/logic");
    expect(brandInTitle("SanDisk Ultra 128 GB microSDXC", "SanDisk")).toBe(true);
    expect(brandInTitle("SANDISK Extreme 64GB", "SanDisk®")).toBe(true);
    expect(brandInTitle("Sandisk Ultra 128 GB", "SanDisk Corporation")).toBe(true);
    expect(brandInTitle("Speicherkarte 128 GB", "SanDisk")).toBe(false);
    expect(brandInTitle("Dr. Oetker Backpulver", "Dr.Oetker")).toBe(true);
  });
  it("Fehler und Pflicht getrennt von Empfehlungen; Meldung nennt Marke und Titel", async () => {
    const { issueKind, titleIssues } = await import("@/lib/ebay-review/logic");
    expect(issueKind("merkmale-pflicht")).toBe("pflicht");
    expect(issueKind("beschreibung-aktiv")).toBe("fehler");
    expect(issueKind("bilder-wenig")).toBe("empfehlung");
    const i = titleIssues({ title: "Speicherkarte 128 GB microSDXC Class 10 für Kamera und Handy schnell", conditionId: "1000", brand: "SanDisk" }).find((x) => x.key === "titel-marke");
    expect(i?.text).toMatch(/„SanDisk“ – im Titel „Speicherkarte 128 GB/);
  });
});
