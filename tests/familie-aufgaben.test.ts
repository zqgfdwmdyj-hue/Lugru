import { describe, expect, it } from "vitest";
import { abhaken, fairness, fuerMich, gruppeVon, naechsteFaelligkeit, vorschlagZustaendig, type FamilienAufgabe } from "@/lib/private/familie-aufgaben";

// Familien-Aufgabenliste: Wiederholung, Gruppen, Fairness. Erfundene Aufgaben.

const auf = (x: Partial<FamilienAufgabe>): FamilienAufgabe => ({ titel: "Test", zustaendig: "beide", faellig: null, wiederholung: "einmal", kategorie: "haushalt", erledigt: [], ...x });
const HEUTE = "2026-10-29";

describe("Wiederholung", () => {
  it("wöchentlich, monatlich (Monatsende), jährlich – immer nach heute", () => {
    expect(naechsteFaelligkeit("woechentlich", "2026-10-28", HEUTE)).toBe("2026-11-04");
    expect(naechsteFaelligkeit("monatlich", "2026-01-31", "2026-02-01")).toBe("2026-02-28");
    expect(naechsteFaelligkeit("monatlich", "2026-08-15", HEUTE)).toBe("2026-11-15");
    expect(naechsteFaelligkeit("jaehrlich", "2026-03-01", HEUTE)).toBe("2027-03-01");
    expect(naechsteFaelligkeit("einmal", "2026-10-01", HEUTE)).toBe("2026-10-01");
  });
  it("abhaken: einmalig abgeschlossen, wiederkehrend nächste Fälligkeit + Erledigung gemerkt", () => {
    expect(abhaken(auf({ faellig: "2026-10-29" }), "b", HEUTE)).toMatchObject({ abgeschlossen: true, erledigt: [{ am: HEUTE, von: "b" }] });
    const kita = abhaken(auf({ titel: "Kita-Beitrag", wiederholung: "monatlich", faellig: "2026-10-01", kategorie: "geld" }), "a", HEUTE);
    expect(kita).toMatchObject({ faellig: "2026-11-01", erledigt: [{ am: HEUTE, von: "a" }] });
    expect(kita.abgeschlossen).toBeUndefined();
  });
});

describe("Gruppen und Filter", () => {
  it("überfällig, diese Woche, später, ohne Datum, erledigt", () => {
    expect(gruppeVon(auf({ faellig: "2026-10-28" }), HEUTE)).toBe("ueberfaellig");
    expect(gruppeVon(auf({ faellig: "2026-11-05" }), HEUTE)).toBe("woche");
    expect(gruppeVon(auf({ faellig: "2026-11-06" }), HEUTE)).toBe("spaeter");
    expect(gruppeVon(auf({}), HEUTE)).toBe("ohne");
    expect(gruppeVon(auf({ abgeschlossen: true, faellig: "2026-10-01" }), HEUTE)).toBe("erledigt");
  });
  it("„meine“: mir zugeordnet oder beide", () => {
    expect(fuerMich(auf({ zustaendig: "a" }), "a")).toBe(true);
    expect(fuerMich(auf({ zustaendig: "b" }), "a")).toBe(false);
    expect(fuerMich(auf({ zustaendig: "beide" }), "b")).toBe(true);
  });
});

describe("Fairness (optional)", () => {
  it("zählt Erledigungen der letzten 30 Tage je Person und Kategorie", () => {
    const liste = [
      auf({ kategorie: "kinder", erledigt: [{ am: "2026-10-20", von: "a" }, { am: "2026-10-21", von: "b" }, { am: "2026-09-01", von: "b" }] }),
      auf({ kategorie: "geld", erledigt: [{ am: "2026-10-25", von: "a" }] }),
    ];
    expect(fairness(liste, HEUTE)).toEqual({ a: 2, b: 1, jeKategorie: { kinder: { a: 1, b: 1 }, geld: { a: 1, b: 0 } } });
  });
  it("Vorschlag „zuständig“ erst ab 3 Erledigungen und deutlichem Übergewicht", () => {
    const liste = [auf({ kategorie: "arzt", erledigt: [{ am: "2026-10-01", von: "b" }, { am: "2026-10-02", von: "b" }, { am: "2026-10-03", von: "b" }, { am: "2026-10-04", von: "a" }] })];
    expect(vorschlagZustaendig(liste, "arzt")).toBe("b");
    expect(vorschlagZustaendig(liste, "geld")).toBe("beide");
  });
});
