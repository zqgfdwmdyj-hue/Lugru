import { describe, expect, it } from "vitest";
import { ANKAUF_WISSEN, ankaufAktiv, ankaufCheckliste, ankaufFrist, ankaufLeer, ankaufWarnung, ausstiegVergleich } from "@/lib/deal-eingang/ankauf-logic";

// B34.4/5 Ankauf als Ausstiegsweg – erfundene Zahlen.

describe("B34.4 Vergleich Amazon / Ankauf", () => {
  it("Gewinn = Ankaufspreis − EK + Rückvergütung, Marge, ROI, Zahlungsziel, ROI p. a.", () => {
    const v = ausstiegVergleich({ ek: 20, menge: 10, rueckProzent: 2, amazon: { gewinnStk: 6, vkBrutto: 40, tage: 73 }, ankauf: { preis: 24, tage: 7 } });
    // Rückvergütung 2 % von 20 € = 0,40 € bei beiden Wegen
    expect(v.amazon).toEqual({ gewinnStk: 6.4, gewinnGesamt: 64, marge: 16, roi: 32, tage: 73, roiPa: 160 });
    expect(v.ankauf).toEqual({ gewinnStk: 4.4, gewinnGesamt: 44, marge: 18.3, roi: 22, tage: 7, roiPa: 1147 });
    expect(v.besser).toBe("ankauf");
    expect(v.text).toBe("Ankauf lohnt sich eher: Ankauf 2,00 € weniger je Stück, Geld nach 7 statt 73 Tagen – ROI p. a. 1147 % statt 160 %.");
  });
  it("ohne Zahlungsziel 7 Tage; Amazon besser, wenn schneller und mehr; Verlust beim Ankauf benannt", () => {
    const v = ausstiegVergleich({ ek: 20, menge: null, rueckProzent: 0, amazon: { gewinnStk: 10, vkBrutto: 50, tage: 20 }, ankauf: { preis: 19, tage: null } });
    expect(v.ankauf.tage).toBe(7);
    expect(v.ankauf.gewinnStk).toBe(-1);
    expect(v.ankauf.gewinnGesamt).toBeNull();
    expect(v.besser).toBe("amazon");
    expect(v.text).toContain("Amazon lohnt sich eher");
    expect(v.text).toContain("nur zur Schadensbegrenzung");
  });
  it("fehlende Zahlen: kein Vergleich bzw. nur Ankauf", () => {
    expect(ausstiegVergleich({ ek: null, menge: 5, rueckProzent: 0, amazon: { gewinnStk: 3, vkBrutto: 30, tage: 40 }, ankauf: { preis: 25, tage: 5 } }).text).toBe("Für den Vergleich fehlen Ankaufspreis oder EK.");
    const nurAnkauf = ausstiegVergleich({ ek: 10, menge: 5, rueckProzent: 0, amazon: { gewinnStk: null, vkBrutto: null, tage: null }, ankauf: { preis: 12, tage: 5 } });
    expect(nurAnkauf.besser).toBe("ankauf");
    expect(nurAnkauf.text).toContain("für Amazon fehlen Zahlen");
  });
});

describe("B34.5 Checkliste beim Kauf", () => {
  const heute = "2026-11-10";
  const a = { ...ankaufLeer(), preis: 24, zeile: 1 };
  it("aktiv nur mit Ankaufspreis", () => {
    expect(ankaufAktiv(ankaufLeer())).toBe(false);
    expect(ankaufAktiv(a)).toBe(true);
    expect(ankaufAktiv(null)).toBe(false);
  });
  it("offene Punkte als Warnung, kein Stopp", () => {
    const c = ankaufCheckliste({ ...a, mengeAngemeldet: 5 }, 10, heute);
    expect(c.map((x) => x.ok)).toEqual([false, false, false, false]);
    expect(c[1].hinweis).toBe("nur 5 von 10 Stk angemeldet");
    const w = ankaufWarnung(c)!;
    expect(w).toMatch(/^Ankauf-Deal – bitte prüfen: Ankäufer festgelegt/);
    expect(w).toContain("Menge beim Ankäufer angemeldet (nur 5 von 10 Stk angemeldet)");
    const alles = ankaufCheckliste({ ...a, ankaeufer: "Testankauf (erfunden)", mengeAngemeldet: 10, annahmefrist: "2026-11-14", legitCheck: "bestanden" }, 10, heute);
    expect(alles.every((x) => x.ok)).toBe(true);
    expect(ankaufWarnung(alles)).toBeNull();
    expect(ankaufCheckliste({ ...a, annahmefrist: "2026-11-01" }, null, heute)[2]).toEqual({ punkt: "Annahmefrist bekannt", ok: false, hinweis: "Annahmefrist 01.11.2026 ist abgelaufen" });
  });
  it("Frist der Aufgabe: Annahmefrist, sonst in 2 Tagen", () => {
    expect(ankaufFrist({ ...a, annahmefrist: "2026-11-14" }, heute)).toBe("2026-11-14");
    expect(ankaufFrist({ ...a, annahmefrist: "2026-11-01" }, heute)).toBe("2026-11-12");
    expect(ankaufFrist(a, heute)).toBe("2026-11-12");
  });
  it("Wissenseintrag ohne Namen, als Einzelmeinung gekennzeichnet", () => {
    expect(ANKAUF_WISSEN.title).toContain("Einzelmeinung");
    expect(ANKAUF_WISSEN.body).toContain("Menge vorher beim Ankäufer anmelden");
    expect(ANKAUF_WISSEN.body).toContain("Keine Kauf-Bots");
  });
});
