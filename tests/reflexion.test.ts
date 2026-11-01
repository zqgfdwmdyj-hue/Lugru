import { describe, expect, it } from "vitest";
import { eintragPatch } from "@/lib/private/aendern-logic";
import { fuerNaechsteSitzung, kalenderwoche, letzteSitzung, nachTag, naechsteSitzung, wochenAuswahl } from "@/lib/private/rueckblick-logic";

// B22.1 – erfundene Einträge.
const d = (iso: string, h = 12) => new Date(`${iso}T${String(h).padStart(2, "0")}:00:00Z`);

describe("B22.1 – Sitzungen aus Privatkalender und Kalender", () => {
  const termine = [
    { day: "2026-10-15", with: "paar" as const },
    { day: "2026-10-29", with: "sonst" as const, title: "Paartherapie (Praxis)" },
    { day: "2026-11-12", with: "sonst" as const, title: "Paarberatung" },
    { day: "2026-11-05", with: "arzt" as const, title: "Zahnarzt" },
    { day: "2026-11-03", with: "paar" as const, status: "ausgefallen" as const },
  ];
  it("letzte = letzter Paartherapie-Termin vor heute (auch nur mit Titel aus dem Kalender)", () => {
    expect(letzteSitzung(termine, "2026-11-01")).toBe("2026-10-29");
  });
  it("nächste = erster kommender, ausgefallene und andere Termine zählen nicht", () => {
    expect(naechsteSitzung(termine, "2026-11-01")).toBe("2026-11-12");
    expect(naechsteSitzung([{ day: "2026-11-01", with: "paar" }], "2026-11-01")).toBe("2026-11-01");
    expect(naechsteSitzung([{ day: "2026-11-01", with: "paar", status: "stattgefunden" }], "2026-11-01")).toBeNull();
  });
});

describe("B22.1 – Beobachtungen nach Tag, Zettel für die nächste Sitzung", () => {
  it("nach Tag, am selben Tag in Eingabereihenfolge (Zeile 1–4, dann korrigierte Zeile 2)", () => {
    const e = [
      { id: "z2neu", data: { day: "2026-10-30" }, createdAt: d("2026-10-30", 21) },
      { id: "z1", data: { day: "2026-10-30" }, createdAt: d("2026-10-30", 20) },
      { id: "alt", data: { day: "2026-10-28" }, createdAt: d("2026-10-31", 8) },
    ];
    expect(nachTag(e).map((x) => x.id)).toEqual(["alt", "z1", "z2neu"]);
  });
  it("offen = zugeordnete Sitzung steht noch aus bzw. ohne Zuordnung nach der letzten Sitzung geschrieben", () => {
    const z = [
      { id: "a", data: { day: "2026-10-27", text: "für 29.10.", sitzung: "2026-10-29" }, createdAt: d("2026-10-27") },
      { id: "b", data: { day: "2026-10-30", text: "für die nächste", sitzung: "2026-11-12" }, createdAt: d("2026-10-30") },
      { id: "c", data: { day: "2026-10-31", text: "ohne Datum" }, createdAt: d("2026-10-31") },
      { id: "d", data: { day: "2026-10-20", text: "alt ohne Datum" }, createdAt: d("2026-10-20") },
    ];
    expect(fuerNaechsteSitzung(z, { bis: "2026-11-01", letzte: "2026-10-29" }).map((x) => x.id)).toEqual(["b", "c"]);
    // Rückblick auf die Woche vor der Sitzung am 29.10.: der Zettel „a“ war offen
    expect(fuerNaechsteSitzung(z, { bis: "2026-10-28", letzte: "2026-10-15" }).map((x) => x.id)).toEqual(["d", "a"]);
  });
});

describe("B22.1 – Woche wählbar, jeden Tag", () => {
  it("Kalenderwoche nach ISO", () => {
    expect(kalenderwoche("2026-10-26")).toBe(44);
    expect(kalenderwoche("2026-11-01")).toBe(44);
    expect(kalenderwoche("2026-01-01")).toBe(1);
    expect(kalenderwoche("2027-01-01")).toBe(53);
  });
  it("Auswahl: laufende Woche bis heute, davor ganze Wochen Mo–So", () => {
    const w = wochenAuswahl("2026-11-03", 3); // Dienstag
    expect(w[0]).toEqual({ label: "KW 45 · 02.11.–08.11. (laufend)", von: "2026-11-02", bis: "2026-11-03" });
    expect(w[1]).toEqual({ label: "KW 44 · 26.10.–01.11.", von: "2026-10-26", bis: "2026-11-01" });
    expect(w[2].von).toBe("2026-10-19");
  });
});

describe("B22.1 – Reflexion ändern (Claude)", () => {
  it("Text und Sitzung ändern, leere Sitzung entfernt sie, Text Pflicht", () => {
    const alt = { day: "2026-10-30", text: "Zettel", sitzung: "2026-11-12" };
    const r = eintragPatch("reflexion", alt, { text: "Neuer Zettel", sitzung: "2026-11-19" }, "2026-11-01");
    expect(r).toEqual({ ok: true, daten: { day: "2026-10-30", text: "Neuer Zettel", sitzung: "2026-11-19" }, felder: ["text", "sitzung"] });
    const ohne = eintragPatch("reflexion", alt, { sitzung: "" }, "2026-11-01");
    expect(ohne.ok && "sitzung" in ohne.daten).toBe(false);
    expect(eintragPatch("reflexion", alt, { text: " " }, "2026-11-01").ok).toBe(false);
    expect(eintragPatch("beobachtung", { day: "2026-10-30", text: "x", aboutUserId: "u" }, { sitzung: "2026-11-12" }, "2026-11-01").ok).toBe(false);
  });
});
