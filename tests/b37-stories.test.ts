import { describe, expect, it } from "vitest";
import { freigabeNoetig, limitErreicht, naechsterVersuch, naechstesThema, profilMitVorgaben, slots, storyKosten, storyRegeln, themenAus, themenText, tokenStand, uhrzeitenAus } from "@/lib/video/story-logic";
import { VIDEO_PREISE_STANDARD } from "@/lib/video/logic";

// B37 Instagram-Stories: reine Logik (Zeitplan, Themen, Regeln, Freigabe, Limit, Zugang). Nur erfundene Testtexte.

describe("B37 Kanalprofil und Zeitplan", () => {
  it("Vorgaben: täglich 12:00, Freigabe jedes Mal, Hand an, Werbung an, alle Inhaltsarten", () => {
    const p = profilMitVorgaben(null);
    expect(p).toMatchObject({ tage: [1, 2, 3, 4, 5, 6, 7], uhrzeiten: ["12:00"], freigabeModus: "jedes_mal", hand: true, werbung: true, monatslimit: null });
    expect(p.inhaltsarten).toEqual(["preis", "leistung", "tipp", "einblick", "umfrage", "cta"]);
    expect(profilMitVorgaben({ uhrzeiten: ["25:00"], freigabeModus: "quatsch" as never, tage: [0, 3, 3, 9] })).toMatchObject({ uhrzeiten: ["12:00"], freigabeModus: "jedes_mal", tage: [3] });
  });

  it("Uhrzeiten aus Text: „12, 18:30; 9:05“ → sortiert, ungültige fallen weg", () => {
    expect(uhrzeitenAus("12, 18:30; 9:05 25:00 abc")).toEqual(["09:05", "12:00", "18:30"]);
    expect(uhrzeitenAus("")).toEqual([]);
  });

  it("Slots: 12:00 Berlin = 11:00 UTC im Winter, 10:00 UTC im Sommer; abgewählte Tage fehlen", () => {
    // 13.11.2026 ist ein Freitag (Winterzeit)
    const w = slots({ tage: [1, 2, 3, 4, 5, 6, 7], uhrzeiten: ["12:00"] }, new Date("2026-11-13T00:00:00Z"), new Date("2026-11-14T23:59:00Z"));
    expect(w.map((d) => d.toISOString())).toEqual(["2026-11-13T11:00:00.000Z", "2026-11-14T11:00:00.000Z"]);
    const s = slots({ tage: [1, 2, 3, 4, 5, 6, 7], uhrzeiten: ["12:00"] }, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T23:59:00Z"));
    expect(s.map((d) => d.toISOString())).toEqual(["2026-07-01T10:00:00.000Z"]);
    // nur Montag bis Freitag: Samstag 14.11. fällt weg
    const werktage = slots({ tage: [1, 2, 3, 4, 5], uhrzeiten: ["12:00", "18:00"] }, new Date("2026-11-13T00:00:00Z"), new Date("2026-11-14T23:59:00Z"));
    expect(werktage.map((d) => d.toISOString())).toEqual(["2026-11-13T11:00:00.000Z", "2026-11-13T17:00:00.000Z"]);
  });
});

describe("B37 Themenliste", () => {
  it("Zeilen „art: Text“, ohne Art = Tipp, „Frage“ = Umfrage; Kennung bleibt bei gleichem Text", () => {
    const t = themenAus("preis: Prep-Preis je Artikel\nLeistung: Lagerung auf Paletten\nFNSKU richtig kleben\nfrage: Wer macht dein Prep?\ncta: Platz frei");
    expect(t.map((x) => x.art)).toEqual(["preis", "leistung", "tipp", "umfrage", "cta"]);
    expect(t[2].text).toBe("FNSKU richtig kleben");
    const genutzt = t.map((x, i) => (i === 0 ? { ...x, genutztAm: "2026-11-10T11:00:00.000Z" } : x));
    const neu = themenAus(themenText(genutzt) + "\neinblick: Blick ins Lager", genutzt);
    expect(neu[0]).toEqual(genutzt[0]);
    expect(neu).toHaveLength(6);
  });

  it("Nächstes Thema: ungenutzte zuerst, dann am längsten nicht genutzt; Einblick nur mit freiem Foto", () => {
    const themen = [
      { id: "a", art: "preis" as const, text: "A", genutztAm: "2026-11-12T11:00:00Z" },
      { id: "b", art: "einblick" as const, text: "B", genutztAm: null },
      { id: "c", art: "tipp" as const, text: "C", genutztAm: "2026-11-10T11:00:00Z" },
    ];
    expect(naechstesThema(themen, ["preis", "einblick", "tipp"], 1)?.id).toBe("b");
    expect(naechstesThema(themen, ["preis", "einblick", "tipp"], 0)?.id).toBe("c"); // kein Foto → nicht Einblick
    expect(naechstesThema(themen, ["preis", "einblick", "tipp"], 0, ["c"])?.id).toBe("a");
    expect(naechstesThema(themen, ["umfrage"], 3)).toBeNull();
  });
});

describe("B37 Regeln (wie B34.3) und Freigabe", () => {
  const ok = (text: string, art: "preis" | "leistung" | "tipp" = "preis", werbung = true) => storyRegeln(text, { art, werbungAn: true, werbungGesetzt: werbung });
  it("sperrt „kostenlose Zählung“, „all-in“ ohne Aufzählung, Komplettpreis, Versicherung, fehlende Werbung", () => {
    expect(ok("Inklusive kostenloser Zählung jeder Einheit.").join(" ")).toMatch(/kostenlose\/inklusive Zählung/);
    expect(ok("Prep all-in 0,59 € netto je Artikel").join(" ")).toMatch(/all-in/);
    expect(ok("Unser Komplettpreis: 0,59 € netto je Artikel").join(" ")).toMatch(/Komplettpreis/);
    expect(ok("Deine Ware ist bei uns versichert.", "leistung").join(" ")).toMatch(/Versicherung/);
    expect(ok("Prep ab 0,59 € je Artikel").join(" ")).toMatch(/netto/);
    expect(ok("Lagerung auf Paletten.", "leistung", false).join(" ")).toMatch(/Werbekennzeichnung/);
    expect(ok("Garantiert risikofrei verkaufen.", "tipp", false).join(" ")).toMatch(/Irreführend/);
  });
  it("lässt korrekte Texte durch (Preis netto je Artikel, all-in mit „Enthalten:“, Tipp ohne Werbung)", () => {
    expect(ok("Prep all-in ab 0,59 € netto je Artikel. Enthalten: Etikett, Polybeutel und Packen.")).toEqual([]);
    expect(ok("Das FNSKU-Etikett gehört auf jede Einheit, nicht auf den Umkarton.", "tipp", false)).toEqual([]);
    expect(storyRegeln("Lagerung auf Paletten.", { art: "leistung", werbungAn: false, werbungGesetzt: false })).toEqual([]); // Kennzeichnung im Kanal aus
  });
  it("Freigabe: jedes Mal immer; Stichprobe jede 5. (1., 6., 11.); automatisch nie – Regel-Treffer immer", () => {
    expect([1, 2, 3].map((n) => freigabeNoetig("jedes_mal", n, 0))).toEqual([true, true, true]);
    expect([1, 2, 5, 6, 11].map((n) => freigabeNoetig("stichprobe", n, 0))).toEqual([true, false, false, true, true]);
    expect(freigabeNoetig("automatisch", 1, 0)).toBe(false);
    expect(freigabeNoetig("automatisch", 2, 1)).toBe(true);
  });
});

describe("B37 Kosten, Limit, Zugang, Wiederholung", () => {
  it("Kosten je Story: Text + Motiv; mit Foto/wiederverwendetem Motiv nur Text", () => {
    const p = { ...VIDEO_PREISE_STANDARD, claudeEingabeJeMio: 4, claudeAusgabeJeMio: 20, motivJeStueck: 0.02 };
    const mit = storyKosten(p, null, true);
    const ohne = storyKosten(p, null, false);
    expect(mit.summe).toBeCloseTo(ohne.summe + 0.02, 3);
    expect(ohne.summe).toBeCloseTo(0.022, 3); // 3.000 Tokens Eingabe + 500 Ausgabe
    expect(ohne.fehlend).toEqual([]);
    expect(storyKosten({ ...VIDEO_PREISE_STANDARD, bildJeStueck: null, motivJeStueck: null }, null, true).fehlend).toEqual(["Preis je Motiv/Bild"]);
  });
  it("Monatslimit: erreicht ab Limit (auch mit der nächsten Story), ohne Limit nie", () => {
    expect(limitErreicht(4.99, 5)).toBe(false);
    expect(limitErreicht(5.01, 5)).toBe(true);
    expect(limitErreicht(4.95, 5, 0.1)).toBe(true);
    expect(limitErreicht(1000, null)).toBe(false);
    expect(limitErreicht(0.01, 0)).toBe(true);
  });
  it("Zugang: Warnung 7 Tage vorher, danach abgelaufen", () => {
    const jetzt = new Date("2026-11-13T12:00:00Z");
    expect(tokenStand(null, jetzt).stand).toBe("fehlt");
    expect(tokenStand(new Date("2026-12-30T12:00:00Z"), jetzt)).toMatchObject({ stand: "ok" });
    expect(tokenStand(new Date("2026-11-18T12:00:00Z"), jetzt)).toMatchObject({ stand: "bald", tage: 5 });
    expect(tokenStand(new Date("2026-11-13T11:00:00Z"), jetzt).stand).toBe("abgelaufen");
  });
  it("Posten: 3 Wiederholungen nach 5/15/45 Minuten, dann keine mehr (Meldung)", () => {
    const t = new Date("2026-11-13T11:00:00Z");
    expect([1, 2, 3].map((v) => (naechsterVersuch(v, t)!.getTime() - t.getTime()) / 60_000)).toEqual([5, 15, 45]);
    expect(naechsterVersuch(4, t)).toBeNull();
  });
});
