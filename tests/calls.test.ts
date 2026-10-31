import { describe, expect, it } from "vitest";
import { ausschnitt, datumAusText, googleDocId, googleDocLinks, istEigeneAufgabe, kiAuftrag, leseKiPunkte, zitatPosition } from "@/lib/calls/logic";

// Call-Archiv: Links erkennen, KI-Antwort prüfen, Fundstelle finden. Erfundene Inhalte.

describe("Links und Datum", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  it("Google-Doc-ID aus Links, auch mehrere in einer Nachricht", () => {
    expect(googleDocId(`https://docs.google.com/document/d/${id}/edit?usp=sharing`)).toBe(id);
    expect(googleDocId(`https://docs.google.com/document/u/0/d/${id}/edit`)).toBe(id);
    expect(googleDocId("https://example.com/x")).toBeNull();
    expect(googleDocLinks(`Call 1: https://docs.google.com/document/d/${id}/edit und nochmal <https://docs.google.com/document/d/${id}/view>`)).toEqual([id]);
  });
  it("Datum aus Titel", () => {
    expect(datumAusText("Consultant-Call 21.10.2026", "2026-10-29")).toBe("2026-10-21");
    expect(datumAusText("Call 2026-10-14 Notizen", "2026-10-29")).toBe("2026-10-14");
    expect(datumAusText("Call", "2026-10-29")).toBe("2026-10-29");
  });
});

describe("KI-Antwort", () => {
  it("nur gültige Arten, Frist geprüft, Doppel raus, Text um JSON herum egal", () => {
    const antwort = `Hier: {"punkte":[
      {"art":"aufgabe","text":"Markenliste für den Audit schicken","verantwortlich":"ich","frist":"2026-10-30","zitat":"schick mir bis Freitag die Liste"},
      {"art":"aufgabe","text":"Markenliste für den Audit schicken","verantwortlich":"ich","frist":null,"zitat":null},
      {"art":"frage","text":"Gilt der Rabatt auch für Bundles?","verantwortlich":null,"frist":"bald","zitat":""},
      {"art":"unsinn","text":"x"},
      {"art":"entscheidung","text":"Black-Week-Deals nur mit Gewinn","verantwortlich":"null"}
    ]} Ende`;
    const p = leseKiPunkte(antwort);
    expect(p).toEqual([
      { art: "aufgabe", text: "Markenliste für den Audit schicken", verantwortlich: "ich", frist: "2026-10-30", zitat: "schick mir bis Freitag die Liste" },
      { art: "frage", text: "Gilt der Rabatt auch für Bundles?", verantwortlich: null, frist: null, zitat: null },
      { art: "entscheidung", text: "Black-Week-Deals nur mit Gewinn", verantwortlich: null, frist: null, zitat: null },
    ]);
    expect(leseKiPunkte("kein json")).toEqual([]);
  });
  it("Aufgaben des Consultants werden keine eigenen Aufgaben", () => {
    expect(istEigeneAufgabe({ art: "aufgabe", verantwortlich: "ich" })).toBe(true);
    expect(istEigeneAufgabe({ art: "aufgabe", verantwortlich: null })).toBe(true);
    expect(istEigeneAufgabe({ art: "aufgabe", verantwortlich: "Consultant" })).toBe(false);
    expect(istEigeneAufgabe({ art: "frage", verantwortlich: "ich" })).toBe(false);
  });
  it("Auftrag enthält Call und Transkript", () => {
    const a = kiAuftrag("Call Test", "2026-10-21", "Hallo zusammen");
    expect(a).toContain("Call: Call Test am 2026-10-21");
    expect(a).toContain("Hallo zusammen");
  });
});

describe("Call-Stelle", () => {
  const t = "Consultant: Hallo Ludwig.\nLudwig: Hallo!\nConsultant: Schick mir bis Freitag   die Liste der zehn Marken.\nLudwig: Mache ich.";
  it("findet das Zitat unscharf und zeigt den Ausschnitt", () => {
    const pos = zitatPosition(t, "schick mir bis freitag die Liste");
    expect(pos).not.toBeNull();
    expect(ausschnitt(t, pos, 120)).toContain("Schick mir bis Freitag die Liste");
    expect(zitatPosition(t, "steht nicht drin und ist lang genug")).toBeNull();
    expect(zitatPosition(t, null)).toBeNull();
  });
});

describe("Umzug aus dem bisherigen Call-Archiv", async () => {
  const { leseArchivExport, leseKiZusammenfassung, fristAus } = await import("@/lib/calls/logic");
  const call = {
    id: "c20260101-TEST01",
    date: "2026-01-14",
    title: "Test-Call (erfunden)",
    sourceUrl: "https://docs.google.com/document/d/TESTDOC00000000000000001/edit",
    summary: {
      title: "x",
      overview: "Erfundener Überblick.",
      topics: [{ name: "Lager", points: ["Punkt A"] }, { name: "", points: [] }],
      decisions: ["Retouren selbst prüfen"],
      todos: [{ task: "Testliste schicken", owner: "Ludwig", due: "bis 16.01." }, "Ohne Details", { task: "", owner: "x" }],
      open_questions: ["Gilt das auch für FR?"],
      participants: ["Ludwig", "Consultant"],
    },
  };
  it("ein Call mit Zusammenfassung; To-dos, Entscheidungen, Fragen → Punkte; Transkript aus chunks", () => {
    const r = leseArchivExport({ calls: [call], chunks: [{ callId: call.id, n: 1, text: "Teil 2." }, { callId: call.id, n: 0, text: "Teil 1. " }] });
    expect(r.fehler).toBeNull();
    const c = r.calls[0];
    expect(c).toMatchObject({ externeId: call.id, datum: "2026-01-14", titel: "Test-Call (erfunden)", quelleUrl: call.sourceUrl, transkript: "Teil 1. Teil 2." });
    expect(c.zusammenfassung).toEqual({ ueberblick: "Erfundener Überblick.", teilnehmer: ["Ludwig", "Consultant"], themen: [{ name: "Lager", punkte: ["Punkt A"] }] });
    expect(c.punkte).toEqual([
      { art: "aufgabe", text: "Testliste schicken", verantwortlich: "Ludwig", frist: "2026-01-16", zitat: null },
      { art: "aufgabe", text: "Ohne Details", verantwortlich: null, frist: null, zitat: null },
      { art: "entscheidung", text: "Retouren selbst prüfen", verantwortlich: null, frist: null, zitat: null },
      { art: "frage", text: "Gilt das auch für FR?", verantwortlich: null, frist: null, zitat: null },
    ]);
  });
  it("auch als einzelnes Objekt oder Liste; fremde Links und kaputtes Datum werden ignoriert", () => {
    expect(leseArchivExport({ ...call, transcript: "Text" }).calls[0].transkript).toBe("Text");
    expect(leseArchivExport([{ ...call, sourceUrl: "https://example.com/x" }]).calls[0].quelleUrl).toBeNull();
    expect(leseArchivExport({ date: "14.01.2026" }).fehler).toContain("Keine Calls");
  });
  it("Frist aus freier Angabe, KI-Zusammenfassung lesen", () => {
    expect(fristAus("2026-02-03", "2026-01-14")).toBe("2026-02-03");
    expect(fristAus("Freitag", "2026-01-14")).toBeNull();
    expect(leseKiZusammenfassung('{"ueberblick":"Ü","teilnehmer":["A"],"themen":[{"name":"T","punkte":["p"]}],"punkte":[]}')).toEqual({ ueberblick: "Ü", teilnehmer: ["A"], themen: [{ name: "T", punkte: ["p"] }] });
    expect(leseKiZusammenfassung('{"punkte":[]}')).toBeNull();
  });
});
