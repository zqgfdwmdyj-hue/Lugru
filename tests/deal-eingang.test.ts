import { describe, expect, it } from "vitest";
import { angeboteAlsTabelle, antwortEntwurf, dreiGruende, einfacheErkennung, eingangAmpel, empfohleneMenge, istPreisliste, leseKiAngebote, maxEk, packungAus, packungsWarnung, pushText, quelleAusText, trefferquote, waehleTreffer, zeilenAmpel, type ZeilenPruefung } from "@/lib/deal-eingang/logic";

// Deal-Eingang (WhatsApp teilen → prüfen): reine Logik mit erfundenen Angeboten.

describe("Erkennung ohne KI", () => {
  it("„Testmarke Pearl Styler 6x 150ml 19,50 netto ab 50 Stk“ → Name, EK netto, Menge, 6er", () => {
    const [a] = einfacheErkennung("Testmarke Pearl Styler 6x 150ml 19,50 netto ab 50 Stk");
    expect(a).toMatchObject({ name: "Testmarke Pearl Styler 6x 150ml", ek: 19.5, ekNetto: true, menge: 50, moq: 50, packung: 6 });
  });
  it("WhatsApp-Zeilen mit Zeitstempel/Absender; EAN-Zeile; Zeilen ohne Preis fallen weg", () => {
    const text = ["[30.10.26, 14:02] Testhändler: Hallo, heute im Angebot:", "[30.10.26, 14:02] Testhändler: 4006381333931 Testkabel 2m 4,20 €", "[30.10.26, 14:03] Testhändler: B0TEST0001 Testsocken 3,10 brutto"].join("\n");
    const r = einfacheErkennung(text);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ ean: "4006381333931", ek: 4.2, ekNetto: null });
    expect(r[1]).toMatchObject({ asin: "B0TEST0001", ek: 3.1, ekNetto: false });
    expect(quelleAusText(text)).toBe("Testhändler");
  });
  it("Packungsgröße aus verschiedenen Schreibweisen", () => {
    expect(packungAus("Shampoo 6er Pack")).toBe(6);
    expect(packungAus("Pack of 12")).toBe(12);
    expect(packungAus("Duschgel x4")).toBe(4);
    expect(packungAus("Haarspray 300ml")).toBeNull();
    expect(packungAus("2x 150ml")).toBe(2);
  });
});

describe("KI-Antwort lesen", () => {
  it("JSON mit Text drumherum; ungültige Codes werden verworfen, netto/brutto bleibt erhalten", () => {
    const r = leseKiAngebote('Hier: {"quelle":"Testhändler","angebote":[{"asin":"B0TEST0001","ean":null,"name":"Testsocken","ek":"3,10","ek_netto":true,"packung":1},{"asin":"xx","ean":"123","name":null},{"ean":"4006381333931","name":"Testkabel","ek":4.2,"ek_netto":false,"gueltig_bis":"2026-11-05"}]} Ende');
    expect(r.quelle).toBe("Testhändler");
    expect(r.angebote).toHaveLength(2);
    expect(r.angebote[0]).toMatchObject({ asin: "B0TEST0001", ek: 3.1, ekNetto: true });
    expect(r.angebote[1]).toMatchObject({ ean: "4006381333931", ekNetto: false, gueltigBis: "2026-11-05" });
    expect(leseKiAngebote("kein JSON").angebote).toEqual([]);
  });
});

describe("Zuordnung und Packungsgröße", () => {
  const kandidaten = [
    { asin: "B0TESTW001", titel: "Testmarke Pearl Styler 150ml (erfunden)", packung: null },
    { asin: "B0TESTW006", titel: "Testmarke Pearl Styler 150ml 6er Pack (erfunden)", packung: 6 },
  ];
  it("6er-Angebot → 6er-ASIN, sicher", () => {
    expect(waehleTreffer({ name: "Testmarke Pearl Styler 6x 150ml", packung: 6 }, kandidaten)).toMatchObject({ asin: "B0TESTW006", sicher: true });
  });
  it("Einzelstück → 1er-ASIN; kein Treffer → null", () => {
    expect(waehleTreffer({ name: "Testmarke Pearl Styler 150ml", packung: null }, kandidaten)?.asin).toBe("B0TESTW001");
    expect(waehleTreffer({ name: "x", packung: null }, [])).toBeNull();
  });
  it("Warnung bei 6er-Angebot und 1er-Titel", () => {
    expect(packungsWarnung({ packung: 6, name: "Testmarke 6x" }, "Testmarke Pearl Styler 150ml")).toMatch(/Angebot 6er, Amazon-Titel ohne Mengenangabe/);
    expect(packungsWarnung({ packung: 6, name: null }, "Testmarke 6er Pack")).toBeNull();
    expect(packungsWarnung({ packung: null, name: "Testmarke" }, "Testmarke")).toBeNull();
  });
});

describe("Rechnen", () => {
  it("max. EK für Ziel-ROI 20 %: (25 − 8 − 0,5) ÷ 1,2 = 13,75", () => {
    expect(maxEk({ vkNetto: 25, gebuehren: 8, prep: 0.5, zielRoi: 20 })).toBe(13.75);
    expect(maxEk({ vkNetto: 5, gebuehren: 8, prep: 0, zielRoi: 20 })).toBeNull();
  });
  it("empfohlene Menge: 60 Tage Abverkauf minus Bestand und unterwegs", () => {
    expect(empfohleneMenge(30, 60, null)).toBe(60);
    expect(empfohleneMenge(30, 60, { bestand: 20, unterwegs: 10 })).toBe(30);
    expect(empfohleneMenge(30, 60, { bestand: 200, unterwegs: 0 })).toBe(0);
    expect(empfohleneMenge(null, 60, null)).toBeNull();
  });
  it("Ampel und höchstens drei Gründe (Rot zuerst)", () => {
    expect(zeilenAmpel([], [])).toBe("gruen");
    expect(zeilenAmpel([], ["g"])).toBe("gelb");
    expect(zeilenAmpel(["r"], ["g"])).toBe("rot");
    expect(dreiGruende(["r1", "r2"], ["g1", "g2"])).toEqual(["r1", "r2", "g1"]);
  });
  it("Preisliste ab 15 Zeilen oder bei Tabellen-Datei", () => {
    expect(istPreisliste({ zeilen: 14, tabellen: 0, ab: 15 })).toBe(false);
    expect(istPreisliste({ zeilen: 15, tabellen: 0, ab: 15 })).toBe(true);
    expect(istPreisliste({ zeilen: 1, tabellen: 1, ab: 15 })).toBe(true);
    const t = angeboteAlsTabelle([{ asin: null, ean: "4006381333931", name: "Testkabel", marke: "Testmarke", ek: 11.9, ekNetto: false, waehrung: "EUR", menge: null, moq: 10, staffel: null, versand: null, lieferzeit: null, zahlung: null, gueltigBis: null, zustand: null, packung: null }]);
    expect(t.rows[0]).toEqual(["4006381333931", "4006381333931", "", "Testmarke Testkabel", "10", "10"]);
  });
});

const zeile = (z: Partial<ZeilenPruefung> & { name?: string | null }): ZeilenPruefung & { name: string | null } => ({ ampel: "gruen", gruende: [], titel: null, asin: "B0TEST0001", bestesLand: "FR", roi: 28, gewinn: 3.9, angebote: 12, amazonProzent: 0, empfohlen: 60, ekNetto: 19.5, maxEk: [{ land: "FR", ek: 22.4 }], kapitalbedarf: 1170, name: "Testmarke 6er", ...z });

describe("Rückmeldung", () => {
  it("Push für ein Angebot wie im Bauauftrag", () => {
    expect(pushText([zeile({})])).toBe("🟢 Testmarke 6er · EK 19,50 € · bestes Land FR: ROI 28 %, 3,90 €/Stk · 12 Angebote, Amazon nicht drin · Empf. 60 Stk (1.170 €)");
  });
  it("Ohne EK: „lohnt bis EK …“; Rot mit erstem Grund", () => {
    expect(pushText([zeile({ ekNetto: null, roi: null, gewinn: null, empfohlen: null, ampel: "gelb", gruende: ["EK fehlt"] })])).toMatch(/lohnt bis EK 22,40 € netto \(FR\) · EK fehlt$/);
    expect(pushText([zeile({ ampel: "rot", gruende: ["Bestand reicht 200 Tage"] })])).toMatch(/^🔴 .* · Bestand reicht 200 Tage$/);
  });
  it("Mehrere Angebote: Zusammenfassung; Eingangs-Ampel = beste Zeile", () => {
    const z = [zeile({}), zeile({ ampel: "gelb" }), zeile({ ampel: "rot" }), zeile({ ampel: "rot" }), zeile({})];
    expect(pushText(z)).toBe("5 geprüft: 2 🟢, 1 🟡, 2 🔴");
    expect(eingangAmpel(z).ampel).toBe("gruen");
    expect(eingangAmpel([]).ampel).toBeNull();
  });
  it("Antwort-Entwurf: Zusage oder Gegenangebot mit max. EK", () => {
    expect(antwortEntwurf(zeile({}), "2026-11-10")).toBe("Hallo, ich nehme 60 Stk Testmarke 6er zu 19,50 € netto, Lieferung bis 10.11.2026. Bitte kurz bestätigen. Danke!");
    expect(antwortEntwurf(zeile({ ampel: "rot", ekNetto: 25, maxEk: [{ land: "FR", ek: 22.4 }] }))).toMatch(/bei 22,40 € netto würde ich 60 Stk nehmen/);
  });
  it("Trefferquote je Quelle", () => {
    const q = trefferquote([
      { quelle: "Testhändler", status: "gekauft", zeilen: [{ ampel: "gruen", roi: 24 }] },
      { quelle: "Testhändler", status: "verworfen", zeilen: [{ ampel: "rot", roi: 5 }] },
      { quelle: "Testhändler", status: "bestellvorschlag", zeilen: [{ ampel: "gelb", roi: 20 }] },
      { quelle: null, status: "neu", zeilen: [] },
    ]);
    expect(q[0]).toEqual({ quelle: "Testhändler", eingaenge: 3, angebote: 3, gruen: 1, gekauft: 2, verworfen: 1, roiPrognose: 22 });
    expect(q[1].quelle).toBe("unbekannt");
  });
});
