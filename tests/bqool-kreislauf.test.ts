// B31.2 Täglicher BQool-Kreislauf – reine Logik. Erfundene SKUs.
import { describe, expect, it } from "vitest";
import { autoFreigabe, berlinZeit, freigabeFristen, freigabeText, jeLandText, morgenZeile, nachkontrolle, rueckmeldungLesen, standText, uebernommenJeLand } from "@/lib/bqool/kreislauf-logic";
import { bqoolExportAdressen } from "@/lib/automatik/bqool-logic";

const berlin = (s: string) => new Date(s);

describe("Freigabe-Fristen", () => {
  it("06:00-Lauf: Erinnerung 12:00, Verfall 18:00 (Winter- und Sommerzeit)", () => {
    const f = freigabeFristen(berlin("2026-11-07T06:05:00+01:00"));
    expect(f.erinnerung.toISOString()).toBe(berlin("2026-11-07T12:00:00+01:00").toISOString());
    expect(f.verfall.toISOString()).toBe(berlin("2026-11-07T18:00:00+01:00").toISOString());
    expect(berlinZeit("2026-07-01", "18:00").toISOString()).toBe(berlin("2026-07-01T18:00:00+02:00").toISOString());
  });
  it("später Lauf (Jetzt starten 15:00): Erinnerung frühestens nach 2 Std., Verfall nach 6 Std.", () => {
    const f = freigabeFristen(berlin("2026-11-07T15:00:00+01:00"));
    expect(f.erinnerung.toISOString()).toBe(berlin("2026-11-07T17:00:00+01:00").toISOString());
    expect(f.verfall.toISOString()).toBe(berlin("2026-11-07T21:00:00+01:00").toISOString());
  });
});

describe("Automatisch hochladen", () => {
  const an = { automatisch: true, minGeprueft: true, regelWechsel: 0, unterBreakEven: 0 };
  it("Standard: Freigabe nötig; automatisch nur mit bestätigtem Min-Verhalten, ohne Regelwechsel und Min unter Break-even", () => {
    expect(autoFreigabe({ ...an, automatisch: false }).ok).toBe(false);
    expect(autoFreigabe({ ...an, minGeprueft: false })).toEqual({ ok: false, grund: "Freigabe nötig – Min-Verhalten in BQool noch nicht bestätigt" });
    expect(autoFreigabe({ ...an, regelWechsel: 7 }).grund).toBe("Freigabe nötig – 7 Regelwechsel");
    expect(autoFreigabe({ ...an, unterBreakEven: 2 }).grund).toBe("Freigabe nötig – 2× Min unter Break-even");
    expect(autoFreigabe(an).ok).toBe(true);
  });
});

describe("Texte", () => {
  it("Push: Änderungen je Land in fester Reihenfolge, Regelwechsel, Warnungen", () => {
    expect(jeLandText({ ES: 85, DE: 133, IT: 122, FR: 114 })).toBe("DE 133 / FR 114 / IT 122 / ES 85");
    expect(freigabeText({ jeLand: { DE: 133, FR: 114, IT: 122, ES: 85 }, gesamt: 454, regelWechsel: 7, warnungen: 44, unterBreakEven: 0 })).toBe("DE 133 / FR 114 / IT 122 / ES 85 Änderungen, 7 Regelwechsel, 44 Warnungen");
    expect(freigabeText({ jeLand: { DE: 1 }, gesamt: 1, regelWechsel: 1, warnungen: 1, unterBreakEven: 1 })).toBe("DE 1 Änderungen, 1 Regelwechsel, 1 Warnung, 1× Min unter Break-even");
  });
  it("Morgenbericht: gestern hochgeladen bzw. verfallen, heute wartet", () => {
    const upload = [
      { land: "DE", ok: true, zeilen: 133, uebernommen: 133, fehler: 0, fehlerZeilen: [], text: "" },
      { land: "FR", ok: true, zeilen: 114, uebernommen: null, fehler: null, fehlerZeilen: [], text: "" },
    ];
    const gestern = { freigabe: "freigegeben", freigabeAm: berlin("2026-11-06T12:10:00+01:00"), uploadStatus: "fertig", upload, zusammenfassung: null, phase: "fertig" };
    expect(morgenZeile(gestern, null)).toBe("BQool-Upload gestern: freigegeben 12:10, DE 133 / FR 114 übernommen, 0 Fehler");
    const heute = { freigabe: "offen", freigabeAm: null, uploadStatus: null, upload: null, zusammenfassung: { jeLand: { DE: 5, FR: 2 }, gesamt: 7, regelWechsel: 0, warnungen: 0, unterBreakEven: 0 }, phase: "freigabe" };
    expect(morgenZeile({ ...gestern, upload: null, uploadStatus: null, freigabe: "verfallen" }, heute)).toBe("BQool-Upload gestern: nicht freigegeben (verfallen) · BQool-Upload wartet auf Freigabe (DE 5 / FR 2)");
    expect(morgenZeile(null, null)).toBeNull();
    expect(uebernommenJeLand([{ land: "DE", ok: false, zeilen: 3, uebernommen: null, fehler: null, fehlerZeilen: [{ sku: "X", text: "x" }], text: "" }])).toEqual({ jeLand: {}, fehler: 1 });
  });
  it("Datenstand: heute / gestern / Datum", () => {
    const jetzt = berlin("2026-11-07T09:00:00+01:00");
    expect(standText(berlin("2026-11-07T06:05:00+01:00"), jetzt)).toBe("heute 06:05");
    expect(standText(berlin("2026-11-06T06:05:00+01:00"), jetzt)).toBe("gestern 06:05");
    expect(standText(berlin("2026-10-30T14:12:00+01:00"), jetzt)).toBe("30.10., 14:12");
    expect(standText(null, jetzt)).toBe("noch nie");
  });
});

describe("BQool-Rückmeldung nach dem Upload", () => {
  const skus = ["TEST-BQ-1", "TEST-BQ-10", "TEST-BQ-2"];
  it("Anzahl übernommen und Fehlerzeilen mit SKU", () => {
    const r = rueckmeldungLesen("Import erfolgreich: BQool_DE.txt übernommen – 2 Zeilen übernommen, 1 Fehler\nZeile 4: SKU TEST-BQ-10 – Invalid Min Price", skus);
    expect(r).toEqual({ uebernommen: 2, fehler: 1, fehlerZeilen: [{ sku: "TEST-BQ-10", text: "Zeile 4: SKU TEST-BQ-10 – Invalid Min Price" }] });
    expect(rueckmeldungLesen("Success: 1,234 · Failed: 0", skus)).toEqual({ uebernommen: 1234, fehler: 0, fehlerZeilen: [] });
    expect(rueckmeldungLesen("Your file has been submitted.", skus)).toEqual({ uebernommen: null, fehler: null, fehlerZeilen: [] });
  });
});

describe("Nachkontrolle", () => {
  it("Min und Regel je SKU gegen das BQool-Ist", () => {
    const hoch = [
      { land: "DE", sku: "A", regel: "ia", min: 380.84 },
      { land: "DE", sku: "B", regel: "Abverkauf DE", min: 20 },
      { land: "FR", sku: "A", regel: "Abverkauf", min: 30 },
    ];
    const ist = new Map([
      ["DE|A", { regel: "ia", min: 380.84 }],
      ["DE|B", { regel: "ia", min: 19.5 }],
    ]);
    const k = nachkontrolle(hoch, ist);
    expect(k.geprueft).toBe(3);
    expect(k.ok).toBe(1);
    expect(k.abweichungen).toEqual([
      { land: "DE", sku: "B", text: "Regel „ia“ statt „Abverkauf DE“, Min vorher – / Datei 20,00 / nachher 19,50 – Min hätte stehen bleiben müssen" },
      { land: "FR", sku: "A", text: "nicht im BQool-Export" },
    ]);
    expect(nachkontrolle(hoch.slice(0, 1), ist).text).toBe("Min und Regel stimmen bei allen 1 SKU.");
  });
});

describe("Export-Seiten je Land", () => {
  it("FR/IT/ES aus der DE-Adresse abgeleitet, eigenes Feld hat Vorrang", () => {
    const a = bqoolExportAdressen({ exportUrl: "https://bq.example.invalid/repricing/amazonde/download", exportUrlIT: "https://bq.example.invalid/it" });
    expect(a.slice(0, 4).map((x) => [x.land, x.url, x.abgeleitet])).toEqual([
      ["DE", "https://bq.example.invalid/repricing/amazonde/download", false],
      ["FR", "https://bq.example.invalid/repricing/amazonfr/download", true],
      ["IT", "https://bq.example.invalid/it", false],
      ["ES", "https://bq.example.invalid/repricing/amazones/download", true],
    ]);
  });
});

describe("Morgenbericht-Text", () => {
  it("BQool-Zeile steht vorn (nur Inhaber)", async () => {
    const { morgenText } = await import("@/lib/push/logic");
    expect(morgenText({ ueberNacht: 0, fristen: 1, wichtig: 0, paletten: 0, bqool: "BQool-Upload gestern: freigegeben 12:10, DE 3 übernommen, 0 Fehler" })).toBe("BQool-Upload gestern: freigegeben 12:10, DE 3 übernommen, 0 Fehler · 1 Frist heute.");
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 0, bqool: null })).toBe("Nichts Dringendes – guten Start!");
  });
});
