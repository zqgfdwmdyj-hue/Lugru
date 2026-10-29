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
