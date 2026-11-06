import { describe, expect, it } from "vitest";
import {
  abbilden,
  AUSLOESER,
  AUSLOESER_START,
  ampelVon,
  ausloeserSchritt,
  besteZuordnung,
  bewegung,
  blattFinden,
  entzerren,
  faelligkeit,
  faktenAus,
  gehoertZumVorigen,
  homographie,
  namensNaehe,
  nummerNorm,
  seitenZusammen,
  stapelAntwortLesen,
  stapelSumme,
  stationAntwortLesen,
  stotaxMailStation,
  suchText,
  zielGroesse,
  zuordnungsPunkte,
  type BelegFakten,
  type Kandidat,
} from "@/lib/rechnungsstation/logic";

// Bauauftrag Rechnungsstation – reine Logik. Alle Daten erfunden.

const W = 160, H = 120;
/** Dunkle Ablage mit hellem (gedrehtem) Viereck – wie ein Blatt im Analysebild. */
function bild(quad: { x: number; y: number }[] | null, rauschen = 0): Uint8Array {
  const g = new Uint8Array(W * H).fill(30);
  if (quad) {
    const innen = (px: number, py: number) => {
      let s = 0;
      for (let i = 0; i < 4; i++) {
        const a = quad[i], b = quad[(i + 1) % 4];
        const c = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
        if (c !== 0) { if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false; }
      }
      return true;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (innen(x, y)) g[y * W + x] = 230;
  }
  if (rauschen) for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, g[i] + ((i * 7919) % (2 * rauschen + 1)) - rauschen));
  return g;
}
const BLATT = [{ x: 40, y: 15 }, { x: 125, y: 22 }, { x: 118, y: 108 }, { x: 33, y: 100 }];

const fakten = (x: Partial<BelegFakten> = {}): BelegFakten => ({ art: "rechnung", lieferant: "Testgroßhandel GmbH", nummer: "RE-1001", bestellnummer: null, datum: "2026-11-02", netto: 100, brutto: 119, ust: [{ satz: 19, betrag: 19 }], positionen: [], zahlungszielTage: 14, faelligAm: null, zahlungsart: "Überweisung", folgeseite: false, unsicher: [], ...x });

describe("Rechnungsstation – Kamerabild", () => {
  it("Blatt auf dunkler Ablage erkennen, Ecken in der richtigen Reihenfolge", () => {
    const b = blattFinden(bild(BLATT), W, H)!;
    expect(b).not.toBeNull();
    const [tl, tr, br, bl] = b.ecken;
    for (const [p, soll] of [[tl, BLATT[0]], [tr, BLATT[1]], [br, BLATT[2]], [bl, BLATT[3]]] as const) {
      expect(Math.abs(p.x - soll.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(p.y - soll.y)).toBeLessThanOrEqual(3);
    }
    expect(blattFinden(bild(null), W, H)).toBeNull(); // leere Ablage
    expect(blattFinden(bild([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]), W, H)).toBeNull(); // zu klein
  });
  it("Bewegung: gleiches Bild 0, anderes Bild deutlich", () => {
    expect(bewegung(bild(BLATT), bild(BLATT))).toBe(0);
    expect(bewegung(bild(null), bild(BLATT))).toBeGreaterThan(AUSLOESER.bewegt);
  });
  it("Auslöser: erst nach Stillstand, je Blatt einmal, nächstes Blatt nach Bewegung", () => {
    let z = AUSLOESER_START;
    let ausgeloest = 0;
    const schritt = (bew: number, blatt: boolean, t: number, abstand: number | null) => {
      const r = ausloeserSchritt(z, { bewegung: bew, blatt, abstandZumLetzten: abstand }, t);
      z = r.zustand;
      if (r.ausloesen) ausgeloest++;
      return r.ausloesen;
    };
    // Hand legt Blatt (Bewegung), dann still → nach 0,9 s auslösen
    expect(schritt(40, true, 0, null)).toBe(false);
    expect(schritt(1, true, 200, null)).toBe(false);
    expect(schritt(1, true, 700, null)).toBe(false);
    expect(schritt(1, true, 1200, null)).toBe(true);
    // Blatt bleibt liegen → kein zweites Foto
    for (let t = 1400; t < 4000; t += 200) schritt(1, true, t, 0);
    expect(ausgeloest).toBe(1);
    // Nächstes Blatt obendrauf: Bewegung, dann still, Bild anders als das letzte
    schritt(30, true, 4200, 25);
    schritt(1, true, 4400, 25);
    schritt(1, true, 5400, 25);
    expect(ausgeloest).toBe(2);
    // Bewegung ohne neues Bild (Hand zuckt) → nicht noch einmal
    schritt(30, true, 6000, 2);
    schritt(1, true, 6200, 2);
    schritt(1, true, 7400, 2);
    expect(ausgeloest).toBe(2);
  });
  it("Homographie bildet die Ecken genau ab, Entzerren füllt das Zielbild", () => {
    const ziel = [{ x: 0, y: 0 }, { x: 99, y: 0 }, { x: 99, y: 139 }, { x: 0, y: 139 }];
    const Hm = homographie(BLATT, ziel);
    for (let i = 0; i < 4; i++) {
      const p = abbilden(Hm, BLATT[i]);
      expect(p.x).toBeCloseTo(ziel[i].x, 6);
      expect(p.y).toBeCloseTo(ziel[i].y, 6);
    }
    const g = bild(BLATT);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < g.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g[i]; rgba[i * 4 + 3] = 255; }
    const gr = zielGroesse(blattFinden(g, W, H)!.ecken);
    expect(gr.h).toBeGreaterThan(gr.w); // hochkant wie das Blatt
    const out = entzerren({ daten: rgba, w: W, h: H }, blattFinden(g, W, H)!.ecken, gr);
    let hell = 0;
    for (let i = 0; i < out.length; i += 4) if (out[i] > 128) hell++;
    expect(hell / (gr.w * gr.h)).toBeGreaterThan(0.9); // fast nur noch Papier, keine Ablage
    expect(zielGroesse([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }], 2200)).toEqual({ w: 1650, h: 2200 });
  });
});

describe("Rechnungsstation – KI-Antworten", () => {
  const heute = new Date("2026-11-06T12:00:00Z");
  it("Beleg lesen: Zahlen, ASIN/EAN prüfen, Unsinn verwerfen, Zukunftsdatum unsicher", () => {
    const f = stationAntwortLesen(`Hier: {"art":"rechnung","lieferant":"Testgroßhandel GmbH","rechnungsnummer":"RE-1001","datum":"2026-11-02","netto":"100,00","brutto":119,"ust":[{"satz":19,"betrag":19}],"positionen":[{"asin":"b0test0001","ean":"4000000000017","artikel":"Testsocken","menge":10,"ek":2.1},{"asin":"XYZ","ean":"12","artikel":"Kaputt","menge":"x","ek":null}],"zahlungsziel_tage":14,"unsicher":["datum","quatsch"]}`, heute)!;
    expect(f).toMatchObject({ art: "rechnung", lieferant: "Testgroßhandel GmbH", nummer: "RE-1001", netto: 100, brutto: 119, zahlungszielTage: 14, unsicher: ["datum"] });
    expect(f.positionen[0]).toEqual({ asin: "B0TEST0001", ean: "4000000000017", artikel: "Testsocken", menge: 10, ek: 2.1 });
    expect(f.positionen[1]).toMatchObject({ asin: null, ean: null, menge: null });
    expect(faktenAus({ art: "kassenzettel", datum: "2027-03-01", brutto: 5 }, heute).unsicher).toContain("datum");
    expect(stationAntwortLesen("kein json")).toBeNull();
  });
  it("PDF-Stapel: Seiten je Beleg, jede Seite genau einmal, Fehlendes als eigener Beleg, Teil-Versatz", () => {
    const r = stapelAntwortLesen(JSON.stringify({ belege: [{ seiten: [1, 2], rechnungsnummer: "A-1", art: "rechnung" }, { seiten: [2, 3], rechnungsnummer: "A-2", art: "rechnung" }, { seiten: [9], rechnungsnummer: "X" }] }), 4);
    expect(r.map((b) => b.seiten)).toEqual([[1, 2], [3], [4]]);
    expect(r[2].fakten).toBeNull();
    expect(stapelAntwortLesen(JSON.stringify({ belege: [{ seiten: [1], art: "rechnung" }] }), 1, 31).map((b) => b.seiten)).toEqual([[31]]);
  });
});

describe("Rechnungsstation – Ampel, Mehrseiter, Zuordnung", () => {
  it("Ampel: grün, gelb (unsicher / Summe passt nicht / Nummer fehlt), rot (Betrag, Datum, Lieferant, Duplikat, kein Beleg)", () => {
    expect(ampelVon(fakten())).toEqual({ ampel: "gruen", gruende: [] });
    expect(ampelVon(fakten({ unsicher: ["datum"] })).ampel).toBe("gelb");
    expect(ampelVon(fakten({ netto: 90 })).gruende).toContain("Netto + USt ≠ Brutto");
    expect(ampelVon(fakten({ nummer: null })).gruende).toContain("Rechnungsnummer fehlt");
    expect(ampelVon(fakten({ art: "kassenzettel", nummer: null })).ampel).toBe("gruen");
    expect(ampelVon(fakten({ brutto: null })).ampel).toBe("rot");
    expect(ampelVon(fakten({ datum: null })).gruende).toContain("Datum fehlt");
    expect(ampelVon(fakten(), { duplikat: true }).gruende).toContain("Rechnungsnummer schon erfasst");
    expect(ampelVon(fakten({ art: "sonstiges" })).ampel).toBe("rot");
    expect(ampelVon(null).ampel).toBe("rot");
  });
  it("Mehrseiter: ≤ 5 s und gleiche Nummer (oder Folgeseite ohne Nummer)", () => {
    expect(gehoertZumVorigen({ nummer: "RE-1001", aufgenommenAm: 0 }, { nummer: "re 1001", folgeseite: false, aufgenommenAm: 4000 })).toBe(true);
    expect(gehoertZumVorigen({ nummer: "RE-1001", aufgenommenAm: 0 }, { nummer: "RE-1001", folgeseite: false, aufgenommenAm: 6000 })).toBe(false);
    expect(gehoertZumVorigen({ nummer: "RE-1001", aufgenommenAm: 0 }, { nummer: "RE-1002", folgeseite: true, aufgenommenAm: 2000 })).toBe(false);
    expect(gehoertZumVorigen({ nummer: "RE-1001", aufgenommenAm: 0 }, { nummer: null, folgeseite: true, aufgenommenAm: 2000 })).toBe(true);
    expect(gehoertZumVorigen(null, { nummer: "RE-1", folgeseite: false, aufgenommenAm: 0 })).toBe(false);
    const z = seitenZusammen(fakten({ brutto: null, netto: null, positionen: [{ asin: "B0TEST0001", ean: null, artikel: "A", menge: 1, ek: 1 }] }), fakten({ nummer: null, brutto: 238, netto: 200, positionen: [{ asin: "B0TEST0002", ean: null, artikel: "B", menge: 1, ek: 1 }] }));
    expect(z).toMatchObject({ nummer: "RE-1001", brutto: 238, netto: 200 });
    expect(z.positionen).toHaveLength(2);
  });
  it("Zuordnung: Lieferant + Betrag + Datum, Bestellnummer zählt voll, nur eindeutig", () => {
    const k = (x: Partial<Kandidat>): Kandidat => ({ art: "bestellung", id: "1", text: "Bestellung PO-1", lieferant: "Testgroßhandel", betrag: 119, datum: "2026-11-01", nummer: null, ...x });
    expect(zuordnungsPunkte(fakten(), k({}))).toBe(1);
    expect(zuordnungsPunkte(fakten(), k({ betrag: 300 }))).toBeLessThan(0.7);
    expect(zuordnungsPunkte(fakten({ bestellnummer: "AO-55501" }), k({ lieferant: "Anders", betrag: 1, nummer: "AO-55501" }))).toBe(1);
    expect(zuordnungsPunkte(fakten({ netto: 100 }), k({ art: "b2b", betrag: 100 }))).toBe(1); // B2B netto
    expect(besteZuordnung(fakten(), [k({ id: "a" }), k({ id: "b", lieferant: "Sonstwer AG", betrag: 50 })])?.kandidat.id).toBe("a");
    expect(besteZuordnung(fakten(), [k({ id: "a" }), k({ id: "b" })])).toBeNull(); // zwei gleich gute → nicht raten
    expect(namensNaehe("Testgroßhandel GmbH & Co. KG", "TESTGROSSHANDEL")).toBe(1);
    expect(nummerNorm(" re-1001/a ")).toBe("RE1001A");
  });
  it("Suchtext mit ASIN/EAN (VA findet die Rechnung), Fälligkeit, Stapelsumme, Stotax-Vermerk", () => {
    const f = fakten({ positionen: [{ asin: "B0TEST0001", ean: "4000000000017", artikel: "Testsocken", menge: 10, ek: 2.1 }] });
    expect(suchText(f)).toContain("ASIN: B0TEST0001");
    expect(suchText(f)).toContain("10× Testsocken à 2,10 €");
    expect(faelligkeit(f)).toBe("2026-11-16");
    expect(stapelSumme([{ brutto: 10, ampel: "gruen" }, { brutto: 5.5, ampel: "rot" }, { brutto: null, ampel: null }])).toEqual({ n: 3, summe: 15.5, unklar: 2, gelb: 0 });
    const m = stotaxMailStation({ vendor: "Testgroßhandel GmbH", invoiceNumber: "RE-1001", invoiceDate: "2026-11-02", totalGross: 119, totalNet: 100, ust: [{ satz: 19, betrag: 19 }], zahlungsart: null, docType: "rechnung", ampel: "gelb", pruefGruende: ["datum unsicher"], geprueft: false, seiten: 2, source: "station" });
    expect(m.subject.replace(/\s/g, " ")).toBe("Rechnung – 02.11.2026 – Testgroßhandel GmbH – RE-1001 – 119,00 €");
    expect(m.text).toContain("Vermerk: automatisch erfasst");
    expect(m.text).toContain("2 Seiten");
    expect(stotaxMailStation({ vendor: "Markt", invoiceNumber: null, invoiceDate: "2026-11-02", totalGross: 5, totalNet: null, ust: [], zahlungsart: "Bar", docType: "quittung", ampel: "rot", pruefGruende: ["Lieferant fehlt"], geprueft: true, seiten: 1, source: "ordner" }).text).toContain("Von Hand geprüft.");
  });
});
