import { describe, expect, it } from "vitest";
import { markeErkennen, risikoPruefen, type RisikoDaten } from "@/lib/deal-eingang/risiko-logic";

// Deal-Eingang Abschnitt 4 „Risiken“ mit erfundenen Marken, Lieferanten und Fällen.

const leer: RisikoDaten = { hazmat: new Set(), ip: [], echtheit: [], vertrieb: [] };
const z = (o: Partial<{ asin: string; titel: string | null; marke: string | null; quelle: string | null }> = {}) => ({ asin: "B0TEST0001", titel: "Testmarke Pflegeset 3er", marke: null, quelle: null, ...o });

describe("Marke erkennen", () => {
  it("Angabe aus der Nachricht hat Vorrang, sonst bekannte Marke im Titel (auch zusammengesetzt, längste gewinnt)", () => {
    expect(markeErkennen("Testmarke", "Anders Pro Set", ["Anders"])).toBe("Testmarke");
    expect(markeErkennen(null, "L'Oréal Test Pflege 200ml", ["L'Oréal", "Test"])).toBe("L'Oréal");
    expect(markeErkennen(null, "Testmarke Pro Haarspray", ["Testmarke", "Testmarke Pro"])).toBe("Testmarke Pro");
    expect(markeErkennen(null, "Unbekannt Set", ["Testmarke"])).toBeNull();
    expect(markeErkennen(null, "Testmarkenset", ["Testmarke"])).toBeNull();
  });
});

describe("Risiken", () => {
  it("ohne Daten nichts – außer einem Gefahrgut-Hinweis aus dem Titel (nur Hinweis, keine Ampel)", () => {
    expect(risikoPruefen(z(), leer)).toEqual({ rot: [], gelb: [], hinweise: [], marke: null });
    const r = risikoPruefen(z({ titel: "Testmarke Haarspray 6x 300ml" }), leer);
    expect(r.rot).toEqual([]);
    expect(r.gelb).toEqual([]);
    expect(r.hinweise[0]).toMatch(/^Gefahrgut möglich \(„Haarspray“\)/);
  });
  it("Gefahrgut laut Produktstamm → Gelb", () => {
    expect(risikoPruefen(z(), { ...leer, hazmat: new Set(["B0TEST0001"]) }).gelb[0]).toMatch(/^Gefahrgut \(laut Produktstamm\)/);
  });
  it("Rechteinhaber-Beschwerde: offen zur ASIN → Rot mit Fallnummer; erledigt → Gelb; nur Marke → Gelb", () => {
    const offen = risikoPruefen(z(), { ...leer, ip: [{ asins: ["B0TEST0001"], marke: null, offen: true, fallnummer: "1000000001" }] });
    expect(offen.rot).toEqual(["Offene Rechteinhaber-Beschwerde zu dieser ASIN (Fall 1000000001)."]);
    const alt = risikoPruefen(z(), { ...leer, ip: [{ asins: ["B0TEST0001"], marke: null, offen: false, fallnummer: null }] });
    expect(alt.rot).toEqual([]);
    expect(alt.gelb[0]).toContain("Frühere Rechteinhaber-Beschwerde");
    const marke = risikoPruefen(z({ asin: "B0TEST0002" }), { ...leer, ip: [{ asins: ["B0TEST0009"], marke: "Testmarke", offen: true, fallnummer: null }] });
    expect(marke.marke).toBe("Testmarke");
    expect(marke.gelb).toEqual(["Marke Testmarke: Rechteinhaber-Beschwerde bekannt (Fall-Zentrale)."]);
  });
  it("Echtheits-Ordner ohne Rechnung → Hinweis (Alias zählt)", () => {
    const r = risikoPruefen(z({ titel: "Roesle Testpfanne 28 cm" }), { ...leer, echtheit: [{ marke: "Rösle", aliase: ["Roesle"], belege: 0 }] });
    expect(r.hinweise).toEqual(["Echtheits-Ordner Rösle: noch keine Rechnung als Nachweis hinterlegt."]);
    expect(risikoPruefen(z({ titel: "Roesle Testpfanne" }), { ...leer, echtheit: [{ marke: "Rösle", aliase: ["Roesle"], belege: 2 }] }).hinweise).toEqual([]);
  });
  it("Selektiver Vertrieb: Lieferant (= Quelle) verbietet Marktplatz → Rot; andere Quelle, Marke gesperrt → Gelb; ungeklärt → Hinweis", () => {
    const vertrieb = [{ lieferant: "Testgroßhandel", marken: ["Testmarke"], wiederverkaufErlaubt: true, marktplatzErlaubt: false }];
    expect(risikoPruefen(z({ quelle: "testgroßhandel" }), { ...leer, vertrieb }).rot).toEqual(["Lieferant Testgroßhandel erlaubt keinen Verkauf auf Marktplätzen (selektiver Vertrieb)."]);
    const andere = risikoPruefen(z({ quelle: "Konrad" }), { ...leer, vertrieb });
    expect(andere.rot).toEqual([]);
    expect(andere.gelb).toEqual(["Marke Testmarke: selektiver Vertrieb – laut Testgroßhandel kein Verkauf auf Marktplätzen."]);
    const offen = risikoPruefen(z({ quelle: "Testgroßhandel" }), { ...leer, vertrieb: [{ ...vertrieb[0], marktplatzErlaubt: null }] });
    expect(offen.hinweise).toEqual(["Vertriebsfreigabe bei Testgroßhandel ungeklärt (B2B → Lieferanten-Freigaben)."]);
    expect(risikoPruefen(z({ quelle: "Testgroßhandel" }), { ...leer, vertrieb: [{ ...vertrieb[0], marktplatzErlaubt: true, wiederverkaufErlaubt: false }] }).rot[0]).toContain("keinen Wiederverkauf");
  });
});
