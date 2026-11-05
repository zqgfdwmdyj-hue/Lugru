import { describe, expect, it } from "vitest";
import { DAUMEN_GRUENDE_HOCH, type DealMerkmale } from "@/db/tables/deal-eingang";
import { freischaltungLink, landKennzahlen, margeBrutto, maxEkMarge, realeMarge } from "@/lib/deal-eingang/logic";
import { szenarioRechnen, verkaeufeBeiPreis, verkaeufeHinweis, type PreisTag } from "@/lib/deal-eingang/szenario-logic";
import { dealWert, eigenesLabel, grundAusAntwort, grundBeitraege, grundFrageText, lernBericht, type HistorieDeal } from "@/lib/deal-eingang/wert-logic";
import { adresseAusAbsender, bestellmailFuerAntwort, bestellmailText, lieferantFuerQuelle, rechnungErkannt, sendungsnummerAus, type DealLieferant } from "@/lib/deal-eingang/bestellmail-logic";
import { kaufText } from "@/lib/deal-eingang/kauf-logic";
import { MARKTPLAETZE, standAusKeepa, verkaeufeAusRang } from "@/lib/keepa/auswertung";

// Nachtrag B28 – nur erfundene Daten (Testartikel, Testlieferant, example.com).

describe("B28.1 Marge", () => {
  it("Marge = Gewinn ÷ Buy Box brutto, eine Nachkommastelle", () => {
    expect(margeBrutto(8.5, 79)).toBe(10.8);
    expect(margeBrutto(null, 79)).toBeNull();
    expect(margeBrutto(5, 0)).toBeNull();
  });
  it("max. EK für Ziel-Marge = Rest − Ziel × VK brutto (abgerundet), sonst null", () => {
    // VK 79 € brutto, Rest (VK netto − Gebühren − Prep) 44,20 € → 10 % Marge: 44,20 − 7,90 = 36,30
    expect(maxEkMarge({ rest: 44.2, vkBrutto: 79, zielMarge: 10 })).toBe(36.3);
    expect(maxEkMarge({ rest: 5, vkBrutto: 79, zielMarge: 10 })).toBeNull();
  });
  it("Länderzeile: Ø 90 T vor Buy Box, alter Datensatz ohne Rest → Gewinn + EK", () => {
    const k = landKennzahlen({ vkEur: 79, vk90Eur: 70, gewinn: 7, rest: null }, 25, 10);
    expect(k.marge).toBe(10);
    expect(k.maxEkMarge).toBe(25); // Rest 32 − 7 = 25
  });
  it("reale Marge aus dem Ergebnis (realer Gewinn ÷ Umsatz brutto)", () => {
    expect(realeMarge({ realerGewinn: 120, verkauft: 20, oVk: 60 })).toBe(10);
    expect(realeMarge({ realerGewinn: 120, verkauft: 0, oVk: 60 })).toBeNull();
  });
  it("Kaufen-Push nennt Marge vor ROI", () => {
    const t = kaufText({ titel: "Testpfanne 24 cm", name: null, ekNetto: 25, bestesLand: "DE", roi: 23, marge: 12, gewinn: 5.8, empfohlen: 20, kapitalbedarf: 500, maxEk: [], gueltigBis: null }, { nr: 3, ampel: "gruen" });
    expect(t).toContain("DE: Marge 12 %, ROI 23 %");
  });
});

describe("B28.4 Freischaltung und Verkäufe/Monat", () => {
  it("Link auf „Angebot hinzufügen“ im Seller Central je Land", () => {
    expect(freischaltungLink("B0TEST0001")).toBe("https://sellercentral.amazon.de/abis/listing/syh?asin=B0TEST0001&ref_=xx_addlisting_dnav_xx#offer");
    expect(freischaltungLink("B0TEST0001", "FR")).toContain("sellercentral.amazon.fr");
  });
  const NOW = Date.parse("2026-11-05T12:00:00Z");
  const km = (tage: number) => Math.round((NOW - tage * 86_400_000) / 60_000) - 21_564_000;
  it("„gekauft“: aktuelle Angabe, sonst letzter Wert der Historie (≤ 60 Tage)", () => {
    const st = standAusKeepa({ asin: "B0TEST0001", title: "Testprodukt (erfunden)", csv: [], monthlySoldHistory: [km(90), 50, km(20), 200] }, "DE", NOW)!;
    expect(st.aktuell.monatlich_verkauft).toBe(200);
    expect(st.aktuell.monatlich_verkauft_aus).toBe("verlauf");
    const alt = standAusKeepa({ asin: "B0TEST0001", title: "Testprodukt (erfunden)", csv: [], monthlySoldHistory: [km(90), 50] }, "DE", NOW)!;
    expect(alt.aktuell.monatlich_verkauft).toBeNull();
    const amazon = standAusKeepa({ asin: "B0TEST0001", title: "Testprodukt (erfunden)", csv: [], monthlySold: 100, monthlySoldHistory: [km(20), 200] }, "DE", NOW)!;
    expect(amazon.aktuell.monatlich_verkauft).toBe(100);
    expect(amazon.aktuell.monatlich_verkauft_aus).toBe("amazon");
  });
  it("Schätzung aus dem Verkaufsrang: Keepa-Rang-Drops, sonst Tage mit Rangverbesserung (30 T)", () => {
    const st = standAusKeepa({ asin: "B0TEST0001", title: "Testprodukt (erfunden)", csv: [], stats: { salesRankDrops30: 12 } }, "DE", NOW)!;
    expect(verkaeufeAusRang(st)).toBe(12);
    const verlauf = Array.from({ length: 31 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, null, null, null, i % 3 === 0 ? 1000 : 2000] as [string, null, null, null, number]);
    expect(verkaeufeAusRang({ aktuell: { ...st.aktuell, rang_drops_30: null }, verlauf })).toBe(10);
    expect(MARKTPLAETZE.DE.amazonId).toBeTruthy();
  });
});

describe("B28.2 Preis-Szenario", () => {
  it("Gewinn/Marge/ROI bei frei gewähltem VK (Provision auf brutto)", () => {
    // 56 € brutto, 19 % USt, 15 % Provision, FBA 6 €, Prep 0,50 €, EK 25 € netto
    const r = szenarioRechnen({ vkBrutto: 56, mwstSatz: 0.19, provision: 0.15, fba: 6, prep: 0.5, ekNetto: 25 });
    expect(r.gewinn).toBeCloseTo(56 / 1.19 - 8.4 - 6 - 25.5, 2);
    expect(r.marge).toBe(Math.round((r.gewinn / 56) * 1000) / 10);
    expect(r.roi).toBe(Math.round((r.gewinn / 25.5) * 1000) / 10);
  });
  const tage = (n: number, f: (i: number) => [number | null, number | null]): PreisTag[] =>
    Array.from({ length: n }, (_, i) => {
      const [bb, rang] = f(i);
      return [new Date(Date.UTC(2025, 10, 6) + i * 86_400_000).toISOString().slice(0, 10), bb, rang];
    });
  // 365 Tage: Tag 240–330 bei 57,99 € (Rang 1.000), sonst 79 € (Rang 4.000)
  const verlauf = tage(365, (i) => (i >= 240 && i <= 330 ? [57.99, 1000] : [79, 4000]));
  it("letzter Zeitraum im Preisband ±7 % und Verkäufe aus dem Keepa-„gekauft“-Verlauf", () => {
    const hist: [string, number][] = [[verlauf[235][0], 100], [verlauf[260][0], 300]];
    const v = verkaeufeBeiPreis(verlauf, 56, { verkauftVerlauf: hist })!;
    expect(v.von).toBe(verlauf[240][0]);
    expect(v.bis).toBe(verlauf[330][0]);
    expect(v.tage).toBe(91);
    expect(v.quelle).toBe("keepa");
    expect(v.wert).toBeGreaterThan(100);
    expect(verkaeufeHinweis(v)).toMatch(/^Bei diesem Preis zuletzt \d\d\.\d\d\.–\d\d\.\d\d\. \(91 Tage\): ca\. \d+ Verkäufe\/Monat \(Keepa „gekauft“\)\.$/);
  });
  it("ohne Keepa-Verlauf: aktuelle Verkäufe × Rang-Verhältnis (besserer Rang → mehr)", () => {
    const v = verkaeufeBeiPreis(verlauf, 56, { aktuellVerkaeufe: 30 })!;
    expect(v.quelle).toBe("rang");
    expect(v.wert).toBe(120); // 30 × 4000 / 1000
  });
  it("Preis kam nicht vor → Hinweis", () => {
    expect(verkaeufeBeiPreis(verlauf, 40)).toBeNull();
    expect(verkaeufeHinweis(null)).toContain("nicht vor");
  });
});

describe("B28.3 Gründe bei 👍", () => {
  const LAND = DAUMEN_GRUENDE_HOCH[1];
  const basis: Partial<DealMerkmale> = { roi: 30, marge: 12, schwankung90: 10, amazonAnteil: 10, monatlichVerkauft: 50, angebote: 8, angeboteMinLand: 1, angeboteMinLandName: "IT", marke: "Testmarke" };
  const frueher = (gruende: string[], label = 0.9): HistorieDeal => ({ id: "x", quelle: "eigen", titel: "Testdeal", asin: "B0TEST0009", datum: "2026-10-01", merkmale: { ...basis, roi: 25 }, label, gewicht: 1.1, ergebnis: "👍", daumen: "hoch", gruende });
  it("begründetes 👍 zählt mehr als unbegründetes", () => {
    const ohne = eigenesLabel({ status: "neu", daumen: "hoch", realerRoi: null }, 20)!;
    const mit = eigenesLabel({ status: "neu", daumen: "hoch", realerRoi: null, begruendet: true }, 20)!;
    expect(mit.gewicht).toBeGreaterThan(ohne.gewicht);
    expect(mit.label).toBeGreaterThan(ohne.label);
  });
  it("Grund „In einem Land kein/nur 1 Angebot“ trifft zu → Plus mit Text", () => {
    const b = grundBeitraege(basis, [frueher([LAND])]);
    expect(b).toHaveLength(1);
    expect(b[0].punkte).toBe(5);
    expect(b[0].text).toContain("IT: 1 Angebot");
    expect(grundBeitraege({ ...basis, angeboteMinLand: 4 }, [frueher([LAND])])).toHaveLength(0);
  });
  it("Deal-Wert eines ähnlichen Deals steigt, wenn ein 👍 mit diesem Grund begründet wurde", () => {
    const ohneGrund = dealWert(basis, { zielRoi: 20, ampel: "gruen", historie: [frueher([], 0.8)] });
    const mitGrund = dealWert(basis, { zielRoi: 20, ampel: "gruen", historie: [frueher([LAND])] });
    expect(mitGrund.wert).toBeGreaterThan(ohneGrund.wert);
    expect(mitGrund.dafuer[0]).toContain("👍-Grund");
  });
  it("👎-Grund senkt (z. B. „Chart instabil“ bei schwankendem Chart)", () => {
    const h: HistorieDeal = { ...frueher([]), daumen: "runter", gruende: ["Chart instabil"], label: 0 };
    const b = grundBeitraege({ ...basis, schwankung90: 25 }, [h]);
    expect(b[0].punkte).toBe(-5);
  });
  it("Discord: Zahl-Reaktionen und Text-Antworten", () => {
    expect(grundFrageText()).toContain(`2️⃣ ${LAND}`);
    expect(grundAusAntwort([{ name: "2️⃣", anzahl: 1 }, { name: "5️⃣", anzahl: 0 }], [])).toEqual({ gruende: [LAND], freitext: null });
    expect(grundAusAntwort([], ["1, 3"])).toEqual({ gruende: [DAUMEN_GRUENDE_HOCH[0], DAUMEN_GRUENDE_HOCH[2]], freitext: null });
    expect(grundAusAntwort([], ["Marke läuft super bei mir"]).freitext).toBe("Marke läuft super bei mir");
  });
  it("Lernbericht zählt Gründe, begründete und unbegründete 👍, Freitexte", () => {
    const b = lernBericht(
      [
        { id: "a", titel: "Test A", datum: "2026-10-02", wert: 80, status: "neu", daumen: "hoch", realerRoi: null, gruende: [LAND] },
        { id: "b", titel: "Test B", datum: "2026-10-03", wert: 60, status: "neu", daumen: "hoch", realerRoi: null, gruende: [] },
        { id: "c", titel: "Test C", datum: "2026-10-04", wert: 40, status: "verworfen", daumen: "runter", realerRoi: null, gruende: ["Saison"], freitext: "zu spät im Jahr" },
      ],
      { schwelle: 70, zielRoi: 20 },
    );
    expect(b.gruende.hoch).toEqual([{ grund: LAND, anzahl: 1 }]);
    expect(b.gruende.runter).toEqual([{ grund: "Saison", anzahl: 1 }]);
    expect(b.gruende.hochBegruendet).toBe(1);
    expect(b.gruende.hochOhneGrund).toBe(1);
    expect(b.gruende.freitexte[0].text).toBe("zu spät im Jahr");
  });
});

describe("B28.5 Bestellmail", () => {
  const L: DealLieferant = { supplierId: "s1", name: "Testgroßhandel GmbH", email: "bestellung@example.com", ansprechpartner: "Herr Test", zahlungsweg: "Überweisung Vorkasse", rechnungMitEan: true, dealQuellen: ["Testgroßhandel GmbH", "Test-WhatsApp"] };
  it("Lieferant zur Deal-Quelle (Stichwort, Name oder Ansprechpartner)", () => {
    expect(lieferantFuerQuelle("Herr Test", [L])?.supplierId).toBe("s1");
    expect(lieferantFuerQuelle("test-whatsapp deals", [L])?.supplierId).toBe("s1");
    expect(lieferantFuerQuelle("ProfitPath", [L])).toBeNull();
    expect(lieferantFuerQuelle(null, [L])).toBeNull();
  });
  it("Mailtext: Artikel mit ASIN, Verpackung, 84 × 25 € netto, Adresse, Rechnung mit EAN, Sendungsnummer", () => {
    const m = bestellmailText({
      lieferant: L,
      firma: { adresse: "Test GmbH\nTeststraße 1\n12345 Teststadt", ustId: "DE000000000", telefon: null, email: null },
      artikel: { titel: "Testpfanne 24 cm", asin: "B0TEST0001", ean: "4000000000001", menge: 84, preisNetto: 25, zustand: "neu", verpackung: "eingeschweisst" },
    });
    expect(m.betreff).toBe("Bestellung Test GmbH: 84 × Testpfanne 24 cm (ASIN B0TEST0001)");
    expect(m.text).toContain("Hallo Herr Test,");
    expect(m.text).toContain("ASIN: B0TEST0001");
    expect(m.text).toContain("Zustand/Verpackung: neu, eingeschweißt");
    expect(m.text).toContain("Menge: 84 Stück");
    expect(m.text).toContain("Preis: 25,00 € netto je Stück, gesamt 2.100,00 € netto");
    expect(m.text).toContain("Test GmbH, Teststraße 1, 12345 Teststadt, USt-IdNr. DE000000000");
    expect(m.text).toContain("EAN je Position");
    expect(m.text).toContain("Zahlung: Überweisung Vorkasse");
    expect(m.text).toContain("Sendungsnummer");
  });
  it("Sendungsnummer nach Stichwort bzw. eindeutigem Format, EAN allein zählt nicht", () => {
    expect(sendungsnummerAus("Ware ist raus, Sendungsnummer: 0034 0434 1234 5678 90")).toBe("003404341234567890");
    expect(sendungsnummerAus("Tracking JJD000390007000000001")).toBe("JJD000390007000000001");
    expect(sendungsnummerAus("EAN 4000000000001 wie besprochen")).toBeNull();
  });
  it("Rechnung im Anhang bzw. Betreff", () => {
    expect(rechnungErkannt("AW: Bestellung", ["Rechnung_2026-123.pdf"])).toBe(true);
    expect(rechnungErkannt("Invoice 123", [])).toBe(true);
    expect(rechnungErkannt("AW: Bestellung", ["foto.jpg"])).toBe(false);
  });
  it("Antwort zuordnen: In-Reply-To, sonst Absender + ASIN im Betreff (60 Tage)", () => {
    const g = [{ id: "m1", an: "bestellung@example.com", messageId: "<deal-bestellung-m1@example.com>", betreff: "Bestellung Test GmbH: 84 × Testpfanne (ASIN B0TEST0001)", asin: "B0TEST0001", gesendetAm: new Date("2026-11-01T10:00:00Z") }];
    const am = new Date("2026-11-02T10:00:00Z");
    expect(bestellmailFuerAntwort({ fromAddress: "x@example.org", subject: "egal", antwortAuf: ["<deal-bestellung-m1@example.com>"], receivedAt: am }, g)).toBe("m1");
    expect(bestellmailFuerAntwort({ fromAddress: "Bestellung@Example.com", subject: "AW: Ihre Bestellung B0TEST0001", antwortAuf: [], receivedAt: am }, g)).toBe("m1");
    expect(bestellmailFuerAntwort({ fromAddress: "andere@example.com", subject: "AW: Ihre Bestellung B0TEST0001", antwortAuf: [], receivedAt: am }, g)).toBeNull();
    expect(bestellmailFuerAntwort({ fromAddress: "bestellung@example.com", subject: "B0TEST0001", antwortAuf: [], receivedAt: new Date("2027-02-01T10:00:00Z") }, g)).toBeNull();
  });
  it("Adresse aus dem Versand-Absender", () => {
    expect(adresseAusAbsender({ name1: "Test GmbH", street: "Teststraße", houseNo: "1", zip: "12345", city: "Teststadt" })).toBe("Test GmbH\nTeststraße 1\n12345 Teststadt");
    expect(adresseAusAbsender(null)).toBe("");
  });
});
