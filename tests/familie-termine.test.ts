import { describe, expect, it } from "vitest";
import { datumOk, demnaechst, erinnerungHeute, naechstesMal, paarzeitVorschlag } from "@/lib/private/familie-termine";

// Erfundene Namen und Ideen.
const H = "2026-10-30"; // Freitag

describe("Paarzeit-Rhythmus", () => {
  const ideen = [
    { text: "Neue Idee", angelegt: 2 },
    { text: "Älteste Idee", angelegt: 1 },
    { text: "Erledigt", done: true, angelegt: 0 },
  ];
  it("überschritten → Idee (älteste offene), freie Abende Fr/Sa zuerst, Betreuung", () => {
    const v = paarzeitVorschlag({ letztes: "2026-10-01", geplant: [], heute: H, zielTage: 14, ideen, belegt: new Set(["2026-10-31"]), kinder: true })!;
    expect(v.seitTagen).toBe(29);
    expect(v.idee).toBe("Älteste Idee");
    expect(v.abende).toEqual(["2026-11-06", "2026-11-07", "2026-11-13"]);
    expect(v.hinweis).toContain("Betreuung");
  });
  it("nichts, wenn geplant, nicht überschritten oder aus", () => {
    expect(paarzeitVorschlag({ letztes: "2026-10-01", geplant: ["2026-11-02"], heute: H, zielTage: 14, ideen, belegt: new Set(), kinder: false })).toBeNull();
    expect(paarzeitVorschlag({ letztes: "2026-10-25", geplant: [], heute: H, zielTage: 14, ideen, belegt: new Set(), kinder: false })).toBeNull();
    expect(paarzeitVorschlag({ letztes: "2026-10-01", geplant: [], heute: H, zielTage: 0, ideen, belegt: new Set(), kinder: false })).toBeNull();
  });
});

describe("Geburtstage & Jahrestage", () => {
  it("Datum prüfen, nächstes Mal mit Alter, 29.02.", () => {
    expect(datumOk("03-14")).toBe(true);
    expect(datumOk("1990-03-14")).toBe(true);
    expect(datumOk("13-01")).toBe(false);
    expect(naechstesMal("1990-03-14", H)).toEqual({ tag: "2027-03-14", jahre: 37 });
    expect(naechstesMal("11-13", H)).toEqual({ tag: "2026-11-13", jahre: null });
    expect(naechstesMal("02-29", "2027-01-01").tag).toBe("2027-02-28");
  });
  it("Erinnerung 14 Tage (mit Idee), 3 Tage (Karte/Anruf), am Tag", () => {
    const j = { name: "Testperson", datum: "1980-11-13", art: "geburtstag" as const, ideen: "Buch\nSchal" };
    expect(erinnerungHeute(j, H)).toMatchObject({ stufe: 14, text: expect.stringContaining("Geschenkidee: Buch") });
    expect(erinnerungHeute(j, "2026-11-10")).toMatchObject({ stufe: 3, text: expect.stringContaining("Karte") });
    expect(erinnerungHeute(j, "2026-11-13")).toMatchObject({ stufe: 0 });
    expect(erinnerungHeute(j, "2026-11-01")).toBeNull();
    expect(erinnerungHeute({ name: "Wir", datum: "2015-11-13", art: "jahrestag" }, H)?.text).toContain("(11 Jahre)");
  });
  it("demnächst sortiert", () => {
    const l = [{ data: { name: "B", datum: "12-01", art: "geburtstag" as const } }, { data: { name: "A", datum: "11-02", art: "geburtstag" as const } }, { data: { name: "C", datum: "06-01", art: "geburtstag" as const } }];
    expect(demnaechst(l, H, 40).map((x) => x.data.name)).toEqual(["A", "B"]);
  });
});
