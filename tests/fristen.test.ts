import { describe, expect, it } from "vitest";
import { alsErledigt, fixkostenVertraege, fristenBis, naechsteFrist, naechsterReifenwechsel, vertragsfrist, type FristEintrag, type Vertrag } from "@/lib/private/fristen";

// Modul 7 – Vorsorge, Fristen & Verträge (erfundene Einträge).

const HEUTE = "2026-10-30";

describe("Vorsorge", () => {
  it("Zahnarzt alle 6 Monate: fällig in 3 Wochen → Vorschlag „buchen?“", () => {
    const f = naechsteFrist({ typ: "vorsorge", was: "Zahnarzt", person: "Ludwig", intervallMonate: 6, zuletzt: "2026-05-20" }, HEUTE)!;
    expect(f.datum).toBe("2026-11-20");
    expect(f.erinnern).toBe(true);
    expect(f.vorschlag).toBe("Zahnarzt Ludwig fällig in 3 Wochen – buchen?");
  });
  it("gebuchter Termin: keine Erinnerung; nach „erledigt“ rückt die nächste Frist um das Intervall weiter", () => {
    const e: FristEintrag = { typ: "vorsorge", was: "Zahnarzt", person: "Ludwig", intervallMonate: 6, zuletzt: "2026-05-20", gebuchtAm: "2026-11-18" };
    expect(naechsteFrist(e, HEUTE)).toMatchObject({ datum: "2026-11-18", erinnern: false, vorschlag: null });
    const neu = { ...e, ...alsErledigt(e, "2026-11-18") } as FristEintrag;
    expect(naechsteFrist(neu, "2026-11-18")!.datum).toBe("2027-05-18");
  });
  it("noch nie erfasst → heute fällig mit Hinweis", () => {
    const f = naechsteFrist({ typ: "vorsorge", was: "Augenarzt", person: "Alexandra", intervallMonate: 24 }, HEUTE)!;
    expect(f).toMatchObject({ datum: HEUTE, erinnern: true });
    expect(f.vorschlag).toMatch(/letzten Termin eintragen/);
  });
});

describe("Dokumente und Fahrzeuge", () => {
  it("Reisepass: 12 Wochen Vorlauf", () => {
    expect(naechsteFrist({ typ: "dokument", was: "Reisepass", person: "Ludwig", ablauf: "2027-01-10" }, HEUTE)!.erinnern).toBe(true);
    expect(naechsteFrist({ typ: "dokument", was: "Reisepass", person: "Ludwig", ablauf: "2027-06-10" }, HEUTE)!.erinnern).toBe(false);
  });
  it("Reifenwechsel Oktober/April", () => {
    expect(naechsterReifenwechsel("2026-10-30")).toEqual({ datum: "2026-10-01", text: "Winterreifen" });
    expect(naechsterReifenwechsel("2026-11-05")).toEqual({ datum: "2027-04-01", text: "Sommerreifen" });
    expect(naechsterReifenwechsel("2026-03-20")).toEqual({ datum: "2026-04-01", text: "Sommerreifen" });
    const reifen: FristEintrag = { typ: "fahrzeug", fahrzeug: "Model Y", was: "reifen" };
    expect(naechsteFrist(reifen, HEUTE)).toMatchObject({ ueberfaellig: true });
    const erledigt = { ...reifen, ...alsErledigt(reifen, HEUTE) } as FristEintrag;
    expect(naechsteFrist(erledigt, HEUTE)).toMatchObject({ ueberfaellig: false, vorschlag: null });
  });
  it("TÜV: nach „erledigt“ zwei Jahre weiter", () => {
    const t: FristEintrag = { typ: "fahrzeug", fahrzeug: "Model Y", was: "tuev", faellig: "2026-11-15" };
    expect(naechsteFrist(t, HEUTE)!.vorschlag).toMatch(/TÜV\/HU Model Y fällig in 2 Wochen/);
    expect((alsErledigt(t, HEUTE) as { faellig: string }).faellig).toBe("2028-11-15");
  });
});

describe("Verträge & Abos", () => {
  const handy: Vertrag = { typ: "vertrag", anbieter: "Testfunk", was: "Handyvertrag", kostenMonat: 29.99, laufzeitBis: "2027-01-31", verlaengerungMonate: 1, kuendigungsfristWochen: 4, erinnerungWochen: 6 };
  it("letzter Kündigungstag = Laufzeitende − Frist; Erinnerung X Wochen vorher", () => {
    expect(vertragsfrist(handy, HEUTE)).toEqual({ ende: "2027-01-31", kuendigenBis: "2027-01-03" });
    expect(naechsteFrist(handy, HEUTE)!.erinnern).toBe(false);
    expect(naechsteFrist(handy, "2026-11-25")!.vorschlag).toBe("Testfunk: Kündigungsfrist endet in 6 Wochen – behalten oder kündigen?");
  });
  it("verpasste Kündigung → Laufzeit hat sich verlängert", () => {
    expect(vertragsfrist(handy, "2027-01-10")).toEqual({ ende: "2027-02-28", kuendigenBis: "2027-01-31" });
  });
  it("Fixkosten je Monat privat/Firma; gekündigte nach Ende nicht mehr", () => {
    const v: Vertrag[] = [handy, { ...handy, anbieter: "Testcloud", kostenMonat: 12, firma: true }, { ...handy, anbieter: "Alt", kostenMonat: 50, gekuendigtZum: "2026-09-30" }];
    expect(fixkostenVertraege(v, HEUTE)).toEqual({ privat: 29.99, firma: 12 });
  });
});

describe("Liste bis Datum", () => {
  it("überfällige und im Vorlauf immer, sonst bis Datum; privat/geschäftlich getrennt", () => {
    const e = [
      { id: "1", data: { typ: "garantie", was: "Waschmaschine", bis: "2027-08-01" } as FristEintrag },
      { id: "2", data: { typ: "dokument", was: "Personalausweis", person: "Ludwig", ablauf: "2026-12-01" } as FristEintrag },
      { id: "3", data: { typ: "vertrag", anbieter: "Testcloud", was: "Software", kostenMonat: 12, laufzeitBis: "2026-12-31", kuendigungsfristWochen: 4, firma: true } as FristEintrag },
    ];
    expect(fristenBis(e, HEUTE, "2026-12-31", "privat").map((x) => x.id)).toEqual(["2"]);
    expect(fristenBis(e, HEUTE, "2026-12-31", "geschaeft").map((x) => x.id)).toEqual(["3"]);
    expect(fristenBis(e, HEUTE, "2027-12-31").map((x) => x.id)).toEqual(["2", "3", "1"]);
  });
});
