import { describe, expect, it } from "vitest";
import {
  aktionsmuster,
  bestellungFaellig,
  bewerte,
  bilanz,
  dealBlattText,
  kundenGewinn,
  mengenVorschlag,
  preisWarnungen,
  pruefeReservierung,
  reservierbar,
  steuerFuer,
  teileZu,
  tief12,
  unserVerdienst,
  vergebenAnteil,
  zerlegeUstId,
  type DealGrenzen,
} from "@/lib/b2b/logic";

// Erfundene Zahlen.

describe("Rechenhilfe", () => {
  it("unser Verdienst je Stück, gesamt und in % auf EK", () => {
    expect(unserVerdienst({ ek: 10, kundenpreis: 11.5, versandAnteil: 0.3, menge: 100 })).toEqual({ proStueck: 1.2, gesamt: 120, prozentAufEk: 12, negativ: false });
    expect(unserVerdienst({ ek: 10, kundenpreis: 9.9 })).toMatchObject({ proStueck: -0.1, gesamt: null, negativ: true });
  });

  it("Gewinn/ROI des Kunden: brutto → netto, Provision auf brutto, FBA, Kundenpreis + Prep", () => {
    // 29,99 € brutto in DE: netto 25,20; Gebühren 4,50 + 3,50 = 8,00; Kosten 11,50 + 0,60
    const k = kundenGewinn({ vkBrutto: 29.99, mwstSatz: 0.19, provision: 0.15, fbaGebuehr: 3.5, kundenpreis: 11.5, prepGebuehr: 0.6 });
    expect(k).toEqual({ vkNetto: 25.2, gebuehren: 8, kosten: 12.1, gewinn: 5.1, roi: 42.18, marge: 20.25 });
  });

  it("Warnungen: Kunde unter Mindest-ROI, wir im Minus, kein Preis", () => {
    expect(preisWarnungen({ verdienst: unserVerdienst({ ek: 10, kundenpreis: 11 }), besterRoi: 30, minRoiProzent: 15, kundenpreis: 11 })).toEqual([]);
    const w = preisWarnungen({ verdienst: unserVerdienst({ ek: 10, kundenpreis: 9 }), besterRoi: 12, minRoiProzent: 15, kundenpreis: 9 }).map((x) => x.art);
    expect(w).toEqual(["unser_minus", "kunde_roi"]);
    expect(preisWarnungen({ verdienst: null, besterRoi: null, minRoiProzent: 15, kundenpreis: null }).map((x) => x.art)).toEqual(["kein_preis"]);
  });
});

describe("Mengengrenzen und Reservierung", () => {
  it("Vorschlag: Verkäufe/Monat × Faktor − eigener Bestand", () => {
    expect(mengenVorschlag({ verkaeufeBesterMarkt: 120, faktor: 1, eigenerBestand: 20 })).toBe(100);
    expect(mengenVorschlag({ verkaeufeBesterMarkt: 50, faktor: 0.5, eigenerBestand: 40 })).toBe(0);
    expect(mengenVorschlag({ verkaeufeBesterMarkt: null, faktor: 1, eigenerBestand: 0 })).toBeNull();
  });

  const d: DealGrenzen = { status: "aktiv", frist: "2026-11-10", mindestmengeKunde: 10, maxGesamt: 100, maxProKunde: 50, maxKunden: 3 };
  const heute = "2026-11-01";
  const r = (kundeId: string, menge: number, status = "reserviert" as const) => ({ kundeId, menge, status });

  it("Restmenge, Grenze je Kunde, max. Kunden je ASIN", () => {
    expect(pruefeReservierung(d, [], "k1", 20, heute, true)).toEqual({ ok: true });
    expect(pruefeReservierung(d, [], "k1", 5, heute, true)).toEqual({ ok: false, fehler: "Mindestens 10 Stück." });
    expect(pruefeReservierung(d, [], "k1", 60, heute, true)).toEqual({ ok: false, fehler: "Höchstens 50 Stück je Kunde." });
    expect(pruefeReservierung(d, [r("k2", 50), r("k3", 40)], "k1", 20, heute, true)).toEqual({ ok: false, fehler: "Nur noch 10 Stück frei." });
    expect(pruefeReservierung(d, [r("k2", 50), r("k3", 50)], "k1", 10, heute, true)).toEqual({ ok: false, fehler: "Leider ausverkauft." });
    expect(pruefeReservierung(d, [r("k2", 10), r("k3", 10), r("k4", 10)], "k1", 10, heute, true)).toEqual({ ok: false, fehler: "Für diesen Deal sind schon genug Händler dabei (Schutz vor Preiskampf)." });
    // eigene frühere Reservierung zählt nicht gegen sich selbst; stornierte zählen nicht
    expect(pruefeReservierung(d, [r("k1", 50), r("k2", 40)], "k1", 50, heute, true)).toEqual({ ok: true });
    expect(pruefeReservierung(d, [r("k2", 90, "storniert" as never)], "k1", 50, heute, true)).toEqual({ ok: true });
    expect(reservierbar(d, [r("k2", 50)], "k1", heute)).toMatchObject({ rest: 50, kunden: 1, max: 50, min: 10, offen: true });
  });

  it("Frist, Status, Bedingungen", () => {
    expect(pruefeReservierung(d, [], "k1", 20, "2026-11-11", true)).toEqual({ ok: false, fehler: "Die Reservierungsfrist ist abgelaufen." });
    expect(pruefeReservierung({ ...d, status: "geschlossen" }, [], "k1", 20, heute, true)).toEqual({ ok: false, fehler: "Dieser Deal ist nicht (mehr) offen." });
    expect(pruefeReservierung(d, [], "k1", 20, heute, false).ok).toBe(false);
    expect(pruefeReservierung(d, [], "k1", 2.5, heute, true)).toEqual({ ok: false, fehler: "Bitte eine Menge eingeben." });
  });

  it("„fast weg“-Anteil", () => {
    expect(vergebenAnteil(100, [r("a", 50), r("b", 30), r("c", 30, "storniert" as never)])).toBe(0.8);
    expect(vergebenAnteil(null, [])).toBeNull();
  });
});

describe("Fehlmenge aufteilen", () => {
  const res = [
    { id: "a", menge: 50, zeit: "2026-11-01T10:00:00Z" },
    { id: "b", menge: 30, zeit: "2026-11-01T09:00:00Z" },
    { id: "c", menge: 20, zeit: "2026-11-02T08:00:00Z" },
  ];
  it("alles da → jeder bekommt seine Menge", () => expect(teileZu(res, 100, "anteilig")).toEqual({ je: { a: 50, b: 30, c: 20 }, eigen: 0, fehlt: 0 }));
  it("anteilig, Reste nach größtem Bruchteil, Gleichstand → frühere Reservierung", () => {
    // 97 von 100: a 48,5 · b 29,1 · c 19,4 → 48/29/19 = 96, Rest 1 an a (0,5)
    expect(teileZu(res, 97, "anteilig")).toEqual({ je: { a: 49, b: 29, c: 19 }, eigen: 0, fehlt: 3 });
    // 99: a 49,5 b 29,7 c 19,8 → 49/29/19=97, Rest 2: c (0,8), b (0,7)
    expect(teileZu(res, 99, "anteilig").je).toEqual({ a: 49, b: 30, c: 20 });
  });
  it("nach Reservierungszeitpunkt: frühere zuerst voll", () => expect(teileZu(res, 90, "zeitpunkt").je).toEqual({ b: 30, a: 50, c: 10 }));
  it("eigene Restmenge wird zuerst gekürzt", () => {
    expect(teileZu(res, 105, "anteilig", 10)).toEqual({ je: { a: 50, b: 30, c: 20 }, eigen: 5, fehlt: 5 });
    expect(teileZu(res, 99, "anteilig", 10)).toMatchObject({ eigen: 0, fehlt: 11 });
  });
  it("Summe der Zuteilung = Eingang (ohne Überzuteilung)", () => {
    for (const ein of [0, 1, 33, 64, 100, 140]) {
      const t = teileZu(res, ein, "anteilig");
      const summe = Object.values(t.je).reduce((n, x) => n + x, 0);
      expect(summe).toBe(Math.min(100, ein));
      for (const r of res) expect(t.je[r.id]).toBeLessThanOrEqual(r.menge);
    }
  });
});

describe("Steuer", () => {
  const f = { firmaLand: "DE", satz: 0.19 };
  it("Reverse Charge nur bei EU-Ausland + geprüfter USt-IdNr.", () => {
    expect(steuerFuer({ ...f, kundeLand: "FR", ustId: "FR12345678901", ustGueltig: true })).toMatchObject({ art: "reverse_charge", satz: 0 });
    expect(steuerFuer({ ...f, kundeLand: "FR", ustId: "FR12345678901", ustGueltig: null })).toMatchObject({ art: "inland", satz: 0.19 });
    expect(steuerFuer({ ...f, kundeLand: "FR", ustId: "FR12345678901", ustGueltig: false })).toMatchObject({ art: "inland", satz: 0.19 });
    expect(steuerFuer({ ...f, kundeLand: "DE", ustId: "DE123456789", ustGueltig: true })).toMatchObject({ art: "inland", satz: 0.19, hinweis: null });
    expect(steuerFuer({ ...f, kundeLand: "CH", ustId: "CHE123", ustGueltig: true })).toMatchObject({ art: "inland" });
  });
  it("USt-IdNr. zerlegen", () => {
    expect(zerlegeUstId("fr 12 345 678 901")).toEqual({ land: "FR", nummer: "12345678901" });
    expect(zerlegeUstId("GR123456789")).toEqual({ land: "EL", nummer: "123456789" });
    expect(zerlegeUstId("12345")).toBeNull();
  });
});

describe("Aktionsmuster, Erfolgskontrolle, Bestellung, Deal-Blatt", () => {
  const tage = (normal: number, aktionen: [number, number, number][]) => {
    const t: (number | null)[] = Array.from({ length: 365 }, () => normal);
    for (const [von, bis, preis] of aktionen) for (let i = von; i < bis; i++) t[i] = preis;
    return t;
  };
  it("regelmäßiges Tief erkannt (wie Philips i9000), einmalige Aktion nicht", () => {
    const a = aktionsmuster(tage(199.99, [[40, 47, 149.99], [130, 135, 152], [250, 256, 149.99]]));
    expect(a).toMatchObject({ anzahl: 3, tief: 149.99 });
    expect(a!.text).toContain("149,99 €");
    expect(aktionsmuster(tage(199.99, [[40, 47, 149.99]]))).toBeNull();
    expect(aktionsmuster(tage(199.99, []))).toBeNull();
    expect(tief12([null, 5, 3, null, 4])).toBe(3);
  });
  it("Erfolgskontrolle ±10 % und Bilanz", () => {
    expect(bewerte(20, 21)).toEqual({ bewertung: "wie_prognostiziert", abweichungProzent: 5 });
    expect(bewerte(20, 23)).toEqual({ bewertung: "besser", abweichungProzent: 15 });
    expect(bewerte(20, 15)).toEqual({ bewertung: "schlechter", abweichungProzent: -25 });
    expect(bewerte(null, 15).bewertung).toBe("keine_daten");
    expect(bilanz([{ bewertung: "besser", abweichungProzent: 15 }, { bewertung: "schlechter", abweichungProzent: -25 }, { bewertung: "wie_prognostiziert", abweichungProzent: 4 }, { bewertung: "keine_daten", abweichungProzent: null }])).toEqual({ anzahl: 3, trefferquote: 66.67, abweichungSchnitt: -2 });
  });
  it("Sammelbestellung fällig bei MOQ (bezahlt) oder Fristende", () => {
    expect(bestellungFaellig({ moq: 100, reserviert: 120, bezahlt: 80, nurBezahlte: true, frist: "2026-11-10", heute: "2026-11-01" })).toEqual({ faellig: false, grund: null, mengeOk: false });
    expect(bestellungFaellig({ moq: 100, reserviert: 120, bezahlt: 100, nurBezahlte: true, frist: "2026-11-10", heute: "2026-11-01" })).toMatchObject({ faellig: true, grund: "moq" });
    expect(bestellungFaellig({ moq: 100, reserviert: 120, bezahlt: 80, nurBezahlte: false, frist: null, heute: "2026-11-01" })).toMatchObject({ faellig: true, grund: "moq" });
    expect(bestellungFaellig({ moq: 100, reserviert: 50, bezahlt: 50, nurBezahlte: true, frist: "2026-10-31", heute: "2026-11-01" })).toEqual({ faellig: true, grund: "frist", mengeOk: false });
  });
  it("Deal-Blatt als Text mit Hinweisen", () => {
    const t = dealBlattText({ nr: 7, titel: "Testpfanne 28 cm", asin: "B0TEST0001", marke: "Testmarke", kundenpreisNetto: 11.5, mindestmengeKunde: 10, maxProKunde: 50, rest: 40, frist: "2026-11-10", laender: [{ land: "DE", vk: 29.99, gewinn: 5.1, roi: 42.1, verkaeufe: 120, angebote: 6 }, { land: "NL", vk: null, gewinn: null, roi: null, verkaeufe: null, angebote: null }], link: "https://example.invalid/portal/deals/x" });
    expect(t).toContain("Deal #7: Testpfanne 28 cm (Testmarke)");
    expect(t).toContain("11,50 € netto/Stück · ab 10 Stück, max. 50 · noch 40 frei · Frist 10.11.2026");
    expect(t).toContain("DE: VK 29,99 € · Gewinn 5,10 € · ROI 42 % · ~120/Monat · 6 Angebote");
    expect(t).not.toContain("NL:");
    expect(t).toContain("Markenfreigabe im eigenen Amazon-Konto");
  });
});
