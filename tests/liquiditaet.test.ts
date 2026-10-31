import { describe, expect, it } from "vitest";
import { ersteRoteWoche, leseMonate, liquiditaetWochen, steuerPosten, woechentlich, type Posten } from "@/lib/money/liquiditaet";

// Liquiditätsvorschau: Wochen, Kontostand, Ampel gegen Mindestreserve, Steuertermine. Erfundene Beträge.

const p = (datum: string, betrag: number, art: Posten["art"] = "plan", label: string = art): Posten => ({ datum, betrag, label, art, geschaetzt: false });

describe("Wochen und Ampel", () => {
  it("Woche mit Amex-Abbuchung + großem Einkauf wird rot, wenn die Reserve unterschritten wird", () => {
    // heute Do 29.10.2026 → Wochen ab Mo 26.10.
    const w = liquiditaetWochen({
      heute: "2026-10-29",
      wochen: 8,
      start: 20000,
      reserve: 5000,
      posten: [p("2026-11-03", 6000, "amazon"), p("2026-11-15", -3800, "kreditkarte", "American Express"), p("2026-11-12", -14000, "einkauf", "Großeinkauf Q4"), p("2026-11-17", 6200, "amazon")],
    });
    expect(w.map((x) => x.start)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"]);
    expect(w[0].ampel).toBe("gruen");
    expect(w[1]).toMatchObject({ zu: 6000, ab: 0, endeSaldo: 26000, ampel: "gruen" });
    // 26.000 − 14.000 − 3.800 = 8.200 → unter 1,5 × Reserve (7.500)? nein → gelb erst darunter
    expect(w[2]).toMatchObject({ ab: 17800, endeSaldo: 8200, tiefster: 8200, ampel: "gruen" });
    const knapp = liquiditaetWochen({ heute: "2026-10-29", wochen: 3, start: 12000, reserve: 5000, posten: [p("2026-11-12", -6000, "einkauf"), p("2026-11-15", -3800, "kreditkarte")] });
    expect(knapp[2]).toMatchObject({ tiefster: 2200, ampel: "rot" });
    expect(ersteRoteWoche(knapp)?.start).toBe("2026-11-09");
  });
  it("tiefster Stand innerhalb der Woche zählt, nicht nur das Wochenende", () => {
    const w = liquiditaetWochen({ heute: "2026-11-02", wochen: 1, start: 6000, reserve: 5000, posten: [p("2026-11-03", -4000), p("2026-11-06", 10000, "amazon")] });
    expect(w[0]).toMatchObject({ tiefster: 2000, endeSaldo: 12000, ampel: "rot" });
  });
  it("ohne Startsaldo: Summen ja, Ampel nein; Überfälliges zählt heute", () => {
    const w = liquiditaetWochen({ heute: "2026-10-29", wochen: 1, start: null, reserve: 1000, posten: [p("2026-10-20", -500, "rechnung"), p("2026-10-20", 900, "amazon")] });
    expect(w[0]).toMatchObject({ ab: 500, zu: 0, endeSaldo: null, ampel: null });
  });
});

describe("Steuertermine", () => {
  it("Monate lesen", () => {
    expect(leseMonate("alle")).toHaveLength(12);
    expect(leseMonate("3,6,9,12")).toEqual([3, 6, 9, 12]);
    expect(leseMonate("quartal")).toEqual([1, 4, 7, 10]);
    expect(leseMonate("11-12")).toEqual([11, 12]);
  });
  it("Termine im Zeitraum, Wochenende → Montag", () => {
    const t = steuerPosten([{ name: "USt-Voranmeldung", betrag: 2500, monate: leseMonate("alle"), tag: 10 }, { name: "Gewerbesteuer-Vorauszahlung", betrag: 900, monate: [2, 5, 8, 11], tag: 15 }], "2026-10-29", "2026-12-20");
    // 10.11.2026 = Di, 15.11.2026 = So → Mo 16.11., 10.12.2026 = Do
    expect(t.map((x) => [x.datum, x.betrag, x.label])).toEqual([
      ["2026-11-10", -2500, "USt-Voranmeldung"],
      ["2026-12-10", -2500, "USt-Voranmeldung"],
      ["2026-11-16", -900, "Gewerbesteuer-Vorauszahlung"],
    ]);
  });
});

describe("laufende Auszahlungen", () => {
  it("eBay/Temu je Woche mittwochs, nur ab heute", () => {
    const x = woechentlich({ betragProWoche: 350, heute: "2026-10-29", wochen: 3, label: "eBay", art: "ebay" });
    expect(x.map((y) => y.datum)).toEqual(["2026-11-04", "2026-11-11"]);
  });
});

describe("Bestellvorschläge vor der Freigabe", () => {
  it("stehen als „mögliche Einkäufe“ in der Woche, ändern aber den Kontostand nicht", () => {
    const vorschlag = (datum: string, betrag: number): Posten => ({ datum, betrag, label: "Vorschlag Test-Artikel", art: "vorschlag", geschaetzt: true, nichtEingerechnet: true });
    const w = liquiditaetWochen({ heute: "2026-10-29", wochen: 2, start: 10000, reserve: 5000, posten: [vorschlag("2026-10-01", -90000), vorschlag("2026-11-04", -2000), p("2026-10-30", -1000, "einkauf")] });
    expect(w[0]).toMatchObject({ moeglich: 90000, ab: 1000, endeSaldo: 9000, ampel: "gruen" });
    expect(w[1]).toMatchObject({ moeglich: 2000, ab: 0, endeSaldo: 9000 });
  });
  it("eingeschaltet „einrechnen“: wie ein normaler Abfluss", () => {
    const w = liquiditaetWochen({ heute: "2026-10-29", wochen: 1, start: 10000, reserve: 5000, posten: [{ datum: "2026-10-30", betrag: -6000, label: "Vorschlag", art: "vorschlag", geschaetzt: true }] });
    expect(w[0]).toMatchObject({ moeglich: 0, ab: 6000, ampel: "rot" });
  });
});

describe("B15: Wareneinkauf aus Rechnungen und Kontostand-Alter", () => {
  it("plant den Ø-Wareneinkauf je Woche am Freitag, abzüglich schon angelegter Einkäufe", async () => {
    const { wareneinkaufPlan } = await import("@/lib/money/liquiditaet");
    // heute Do 29.10.2026 → Woche 1 Fr 30.10., Woche 2 Fr 06.11. (dort 1.500 € schon angelegt)
    const plan = wareneinkaufPlan({ proWoche: 2000, heute: "2026-10-29", wochen: 3, konkret: [p("2026-11-04", -1500, "einkauf", "Einkauf (erfunden)")] });
    expect(plan.map((x) => [x.datum, x.betrag])).toEqual([
      ["2026-10-30", -2000],
      ["2026-11-06", -500],
      ["2026-11-13", -2000],
    ]);
    expect(plan.every((x) => x.art === "wareneinkauf" && x.geschaetzt)).toBe(true);
    expect(plan[1].label).toContain("abzüglich");
  });

  it("nichts planen, wenn der Einkauf der Woche den Schnitt schon deckt oder kein Schnitt bekannt ist", async () => {
    const { wareneinkaufPlan } = await import("@/lib/money/liquiditaet");
    expect(wareneinkaufPlan({ proWoche: 1000, heute: "2026-10-29", wochen: 1, konkret: [p("2026-10-28", -1200, "rechnung")] })).toEqual([]);
    expect(wareneinkaufPlan({ proWoche: 0, heute: "2026-10-29", wochen: 4, konkret: [] })).toEqual([]);
  });

  it("am Samstag landet der Posten der laufenden Woche auf heute", async () => {
    const { wareneinkaufPlan } = await import("@/lib/money/liquiditaet");
    const plan = wareneinkaufPlan({ proWoche: 800, heute: "2026-10-31", wochen: 1, konkret: [] });
    expect(plan).toHaveLength(1);
    expect(plan[0].datum).toBe("2026-10-31");
  });

  it("Kontostand-Alter in Tagen", async () => {
    const { kontostandAlter } = await import("@/lib/money/liquiditaet");
    expect(kontostandAlter("2026-10-20", "2026-10-30")).toBe(10);
    expect(kontostandAlter("2026-10-30T08:00:00Z", "2026-10-30")).toBe(0);
    expect(kontostandAlter(null, "2026-10-30")).toBeNull();
  });
});
