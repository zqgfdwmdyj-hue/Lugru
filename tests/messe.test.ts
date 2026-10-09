import { describe, expect, it } from "vitest";
import { chunkText, fairFromTitle, iawFairName, iawPageUrls, isIawDirectory, matchesCategories, normUrl, parseExhibitorJson, parseIawDetail, parseIawList, parseMessePayload } from "@/lib/leads/messe";
import { assessFinding } from "@/lib/leads/logic";
import { messeBookmarkletSource } from "@/lib/leads/messe-bookmarklet";

// Erfundene Firmen im Aufbau des IAW-Ausstellerverzeichnisses.
const LIST = `<select id="selectMesse"><option value="20262">Herbst 2026</option><option value="20261">Frühjahr 2026</option></select>
<script>document.getElementById("selectMesse").value="20262";</script>
<div class="av_AusstellerBlock">
  <a href="?av_detail=AAA-1" target="_blank" class="av_AusstellerBlock_Aussteller"><div class="av_AusstellerDatenBlock"><div class="av_AusstellerStandBlock">
    Halle 6, Stand B 42
  </div><div class="av_AusstellerNameBlock"><h4>Testimport &amp; Handel GmbH</h4></div></div></a>
  <a href="?av_detail=BBB-2" target="_blank" class="av_AusstellerBlock_Aussteller"><div class="av_AusstellerStandBlock">Halle 9, Stand E 1</div><div class="av_AusstellerNameBlock"><h4>Foto Service Test UG</h4></div></a>
</div>
<a href="/besucher/ausstellerverzeichnis/?av_page=1">1</a><a href="/besucher/ausstellerverzeichnis/?av_page=2#selectMesse">2</a><a href="/besucher/ausstellerverzeichnis/?av_page=3#selectMesse">3</a>`;

const DETAIL = `<div class="av_Detail">
  <h1 style="text-align:center;">Testimport &amp; Handel GmbH</h1>
  <h3 style="text-align:center;">Halle 6<span class="pipe"></span>Stand B 42</h3>
  <div class="av_Box flexed"><div class="text right">Import und Großhandel für Drogerieartikel und Süßwaren.</div></div>
  <div class="av_Box flexed"><h2 class="left">Kategorien</h2><div class="iconset right"><span class="icon"><span class="ico_desc">Drogerie und Kosmetik</span></span><span class="icon"><span class="ico_desc">Lebensmittel und Getränke</span></span></div></div>
  <div class="av_Box flexed"><div class="contact_details left"><h2>Kontaktdaten</h2>
    Teststraße 5<br/>12345 Teststadt, DEUTSCHLAND<p>Web: <a href="http://www.testimport.example" target="_blank">www.testimport.example</a></p><p>Telefon: +49 123 4567<br/>Telefax: +49 123 4568<br/></p>
    <h4>Bitte um Kontakt zum aktuellen Angebot</h4>
    <form class="ausstellerverzeichnis-form" data-p1="einkauf@testimport.example"><input type="hidden" name="mailto" value="einkauf@testimport.example"></form>
  </div></div>
</div>`;

describe("Messe – IAW", () => {
  it("Liste, Seiten, Messe", () => {
    expect(isIawDirectory(LIST)).toBe(true);
    expect(iawFairName(LIST)).toBe("IAW Herbst 2026");
    const list = parseIawList(LIST, "https://messe.example/besucher/ausstellerverzeichnis/");
    expect(list.map((e) => [e.name, e.booth, e.detailUrl])).toEqual([
      ["Testimport & Handel GmbH", "Halle 6, Stand B 42", "https://messe.example/besucher/ausstellerverzeichnis/?av_detail=AAA-1"],
      ["Foto Service Test UG", "Halle 9, Stand E 1", "https://messe.example/besucher/ausstellerverzeichnis/?av_detail=BBB-2"],
    ]);
    expect(iawPageUrls(LIST, "https://messe.example/besucher/ausstellerverzeichnis/")).toEqual([
      "https://messe.example/besucher/ausstellerverzeichnis/?av_page=2",
      "https://messe.example/besucher/ausstellerverzeichnis/?av_page=3",
    ]);
  });
  it("Detailseite: Anschrift, Web, Telefon, Kontakt-E-Mail, Kategorien", () => {
    expect(parseIawDetail(DETAIL)).toEqual({
      name: "Testimport & Handel GmbH",
      booth: "Halle 6, Stand B 42",
      description: "Import und Großhandel für Drogerieartikel und Süßwaren.",
      categories: ["Drogerie und Kosmetik", "Lebensmittel und Getränke"],
      website: "http://www.testimport.example/",
      phone: "+49 123 4567",
      email: "einkauf@testimport.example",
      street: "Teststraße 5",
      zip: "12345",
      city: "Teststadt",
      country: "Deutschland",
    });
    expect(parseIawDetail(DETAIL.replace("12345 Teststadt, DEUTSCHLAND", "1105BM Amsterdam, NIEDERLANDE"))).toMatchObject({ zip: "1105BM", city: "Amsterdam", country: "Niederlande" });
    expect(parseIawDetail("<html>nichts</html>")).toEqual({});
  });
  it("Einschätzung: Importeur hoch, Dienstleister niedrig", () => {
    const imp = assessFinding({ companyName: "Testimport & Handel GmbH", source: "messe", searchBrand: "", fair: "IAW Herbst 2026", categories: ["Drogerie und Kosmetik"], description: "Import und Großhandel", email: "einkauf@testimport.example" });
    const svc = assessFinding({ companyName: "Foto Service Test UG", source: "messe", searchBrand: "", fair: "IAW Herbst 2026", categories: ["Dienstleistungen und E-Commerce"], description: "Produktfotografie für Amazon" });
    expect(imp.kind).toBe("grosshandel");
    expect(imp.score).toBeGreaterThan(svc.score + 30);
    expect(svc.reasons.join()).toMatch(/Dienstleister/);
  });
});

describe("Messe – andere Verzeichnisse", () => {
  it("KI-Antwort, Kategorien-Filter, Daten vom Lesezeichen", () => {
    const list = parseExhibitorJson('Ergebnis: {"exhibitors":[{"name":"Beispiel Distribution BV","booth":"Hall 4.1 C20","country":"NL","website":"beispiel.example","email":"SALES@beispiel.example","categories":["Food"],"detailUrl":"https://fair.example/ex/1"},{"name":"x"},{"name":null}]}');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Beispiel Distribution BV", country: "Niederlande", website: "https://beispiel.example/", email: "sales@beispiel.example", detailUrl: "https://fair.example/ex/1" });
    expect(matchesCategories({ categories: ["Drogerie und Kosmetik"], description: null }, "drogerie, lebensmittel")).toBe(true);
    expect(matchesCategories({ categories: ["Spielwaren"], description: null }, "drogerie|lebensmittel")).toBe(false);
    expect(matchesCategories({ categories: [], description: null }, "drogerie")).toBe(true);
    expect(parseMessePayload(JSON.stringify({ messeImport: 1, url: "https://fair.example/a", title: "Aussteller | Testmesse", text: "Firma A GmbH Halle 1 Stand 2 ...........", links: [{ t: "Firma A", h: "https://fair.example/a/1" }, { t: "x", h: "javascript:void(0)" }] }))).toMatchObject({ title: "Aussteller | Testmesse", links: [{ t: "Firma A" }] });
    expect(parseMessePayload("kein json")).toBeNull();
    expect(chunkText("a\nb\nc", 3)).toEqual(["a\n", "b\n", "c\n"]);
    expect(normUrl("www.test.example")).toBe("https://www.test.example/");
    expect(normUrl("kein link")).toBeNull();
    expect(normUrl("kein")).toBeNull();
    expect(normUrl("http://localhost:8791/a")).toBe("http://localhost:8791/a");
    expect(fairFromTitle("Aussteller | JS-Messe 2027")).toBe("JS-Messe 2027");
    expect(fairFromTitle("Aussteller – Süßwarenmesse Test 2027")).toBe("Süßwarenmesse Test 2027");
    expect(fairFromTitle("Ausstellerverzeichnis | IAW Messe Köln")).toBe("IAW Messe Köln");
  });
  it("Lesezeichen ist gültiges JavaScript", () => {
    const src = messeBookmarkletSource("https://lugruseller.example");
    expect(() => new Function(src.replace(/\n/g, ""))).not.toThrow();
    expect(src).toContain("messeImport:1");
    expect(src).toContain('var O="https://lugruseller.example"');
  });
});
