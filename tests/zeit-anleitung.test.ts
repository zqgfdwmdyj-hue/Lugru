import { describe, expect, it } from "vitest";
import { anleitungenFuer, anleitungPasst, anleitungText, leseAnleitung, normTypen, pruefungFaellig } from "@/lib/knowledge/anleitung";
import { freierTag, naechsterArbeitstag, reserviertAm, retourenwelle, rueckblick, standardFreiZeiten, verschiebePlan, wochentag, type Block } from "@/lib/zeit/bloecke";

// Anleitungen (SOPs) und Zeitblöcke (freie Zeiten, reservierte Kapazität). Erfundene Daten.

describe("Anleitungen", () => {
  const felder = leseAnleitung((k) => ({ a_zweck: "Remissionen sauber einbuchen", a_wann: "wenn eine Remission ankommt", a_wer: "Assistenz", a_schritte: "1. Paket scannen\n2) Zustand prüfen\n- Foto machen", a_zugaenge: "Seller Central", a_fehler: "", a_typen: "amazon\nschluessel:remission\nTitel: Rücksendung" })[k]);
  it("liest Felder, nummerierte Schritte, Aufgabentypen", () => {
    expect(felder.schritte).toEqual(["Paket scannen", "Zustand prüfen", "Foto machen"]);
    expect(felder.aufgabenTypen).toEqual(["kategorie:amazon", "schluessel:remission", "titel:rücksendung"]);
    expect(anleitungText(felder)).toContain("Schritte:\n1. Paket scannen\n2. Zustand prüfen\n3. Foto machen");
    expect(anleitungText(felder)).not.toContain("Häufige Fehler");
  });
  it("normalisiert Typen", () => {
    expect(normTypen(["Ebay", "Kategorie: Versand", "Inventur"])).toEqual(["kategorie:ebay", "kategorie:versand", "titel:inventur"]);
  });
  it("passt zu Kategorie, Systemschlüssel oder Titel", () => {
    expect(anleitungPasst({ title: "Paket prüfen", category: "amazon", systemKey: null }, ["kategorie:amazon"])).toBe(true);
    expect(anleitungPasst({ title: "x", category: "ebay", systemKey: "remission-123" }, ["schluessel:remission"])).toBe(true);
    expect(anleitungPasst({ title: "Rücksendung erfassen", category: "eigene", systemKey: null }, ["titel:rücksendung"])).toBe(true);
    expect(anleitungPasst({ title: "Rechnung", category: "geld", systemKey: null }, ["kategorie:amazon", "titel:rücksendung"])).toBe(false);
    expect(anleitungenFuer({ title: "Rechnung", category: "geld", systemKey: null }, [{ id: "a", anleitung: { ...felder, aufgabenTypen: ["kategorie:geld"] } }, { id: "b", anleitung: null }])).toEqual(["a"]);
  });
  it("Prüfung fällig nach 6 Monaten oder wenn nie geprüft", () => {
    const jetzt = new Date("2026-10-29T10:00:00Z");
    expect(pruefungFaellig(null, jetzt)).toBe(true);
    expect(pruefungFaellig(new Date("2026-05-01T10:00:00Z"), jetzt)).toBe(false);
    expect(pruefungFaellig(new Date("2026-04-01T10:00:00Z"), jetzt)).toBe(true);
  });
});

const block = (b: Partial<Block>): Block => ({ id: "x", art: "frei", titel: "Frei", userId: null, wochentage: [], ganztags: true, vonZeit: null, bisZeit: null, gueltigVon: null, gueltigBis: null, stunden: null, link: null, aktiv: true, ...b });

describe("Freie Zeiten", () => {
  const sonntag = block({ titel: "Freier Wochenendtag", wochentage: [7], userId: "ludwig" });
  const abend = block({ titel: "Freier Abend", wochentage: [3], ganztags: false, vonZeit: "18:00" });
  it("Wochentag und freier Tag", () => {
    expect(wochentag("2026-11-01")).toBe(7);
    expect(freierTag([sonntag, abend], "2026-11-01")).toBe(true);
    expect(freierTag([sonntag, abend], "2026-11-04")).toBe(false); // Abend zählt nicht als ganzer Tag
    expect(naechsterArbeitstag([sonntag], "2026-11-01")).toBe("2026-11-02");
  });
  it("verschiebt aus dem freien Tag – außer Frist heute + wichtig (Rückfrage); andere Zuständige bleiben", () => {
    const a = (id: string, dueDate: string, priority = "normal", assigneeId: string | null = null) => ({ id, dueDate, priority, category: "amazon", assigneeId, status: "open" });
    const r = verschiebePlan([a("1", "2026-11-01"), a("2", "2026-11-01", "critical"), a("3", "2026-11-02"), a("4", "2026-11-01", "normal", "va"), a("5", "2026-10-25")], [sonntag], "2026-11-01");
    expect(r.rueckfragen).toEqual(["2"]);
    expect(r.verschieben).toEqual([{ id: "1", von: "2026-11-01", nach: "2026-11-02" }]);
    // nicht heute, aber wichtig → trotzdem verschieben
    expect(verschiebePlan([a("6", "2026-11-08", "critical")], [sonntag], "2026-11-01").verschieben).toEqual([{ id: "6", von: "2026-11-08", nach: "2026-11-09" }]);
  });
  it("Rückblick: erledigte Aufgaben im freien Block = nicht eingehalten", () => {
    const erledigt = [
      { completedAt: new Date("2026-10-28T19:30:00Z"), category: "amazon" }, // Mi 20:30 Berlin → im freien Abend
      { completedAt: new Date("2026-10-28T10:00:00Z"), category: "amazon" }, // Mi Vormittag → zählt nicht
    ];
    const r = rueckblick([sonntag, abend], erledigt, "2026-10-29");
    expect(r).toEqual([
      { tag: "2026-10-25", titel: "Freier Wochenendtag", eingehalten: true, erledigt: 0 },
      { tag: "2026-10-28", titel: "Freier Abend", eingehalten: false, erledigt: 1 },
    ]);
  });
  it("Standard: ein Abend + ein Wochenendtag", () => {
    expect(standardFreiZeiten().map((b) => [b.titel, b.wochentage, b.ganztags])).toEqual([["Freier Abend", [3], false], ["Freier Wochenendtag", [7], true]]);
  });
});

describe("Retourenwelle Januar", () => {
  it("Reservierung ab 15.12., Meilenstein erster Montag im Januar", () => {
    expect(retourenwelle("2026-10-29")).toEqual({ reserviertAb: "2026-12-15", reserviertBis: "2027-01-31", meilenstein: "2027-01-04" });
    expect(retourenwelle("2027-01-10").reserviertAb).toBe("2026-12-15");
  });
  it("reservierte Stunden je Tag (werktags im Zeitraum)", () => {
    const r = block({ art: "reserviert", titel: "Retouren-Prüfung", wochentage: [1, 2, 3, 4, 5], gueltigVon: "2026-12-15", gueltigBis: "2027-01-31", stunden: 2 });
    expect(reserviertAm([r], "2026-12-15").stunden).toBe(2);
    expect(reserviertAm([r], "2026-12-14").stunden).toBe(0);
    expect(reserviertAm([r], "2026-12-19").stunden).toBe(0); // Samstag
  });
});
