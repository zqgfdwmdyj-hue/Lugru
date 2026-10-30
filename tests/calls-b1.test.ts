import { describe, expect, it } from "vitest";
import { artAusTeilnehmern, KEIN_TRANSKRIPT, kiWissenAuftrag, leseArchivExport, ohneTranskript, zusammenfassungAlsText } from "@/lib/calls/logic";

// B1 – Calls: Export nur mit Zusammenfassung → Wissen aus der Zusammenfassung; Gruppen-Call ab 3 Teilnehmern;
// Google-Doc-ID aus dem Export (sourceDocId), damit ein späterer Link-Import das Transkript nachträgt.

const DOC = "1TESTdocIdAbCdEfGhIjKlMnOpQrStUv";

describe("Archiv-Export ohne Transkript", () => {
  const roh = {
    date: "2026-09-17",
    sourceDocId: DOC,
    summary: {
      overview: "Wochen-Call der Deal-Gruppe (erfunden): Erfahrungen mit Testmarke, Q4-Planung.",
      participants: ["Anna Test", "Ben Test", "Cora Test", "Dirk Test"],
      topics: [{ name: "Testmarke", points: ["Preise ab Oktober stabil", "Lieferant X liefert in 5 Tagen"] }],
      todos: [{ task: "Testlieferanten anschreiben", owner: "Ludwig" }],
      decisions: ["Q4: Fokus auf drei Testmarken"],
    },
  };
  it("sourceDocId → Kennung und Google-Docs-Link; 4 Teilnehmer → Gruppen-Call mit passendem Titel", () => {
    const { calls } = leseArchivExport(roh);
    expect(calls[0]).toMatchObject({ externeId: DOC, art: "gruppe", titel: "Deal-Gruppe 17.09.2026", quelleUrl: `https://docs.google.com/document/d/${DOC}/edit`, transkript: "" });
    expect(leseArchivExport({ ...roh, summary: { ...roh.summary, participants: ["Ludwig", "Consultant"] } }).calls[0].art).toBe("consultant");
  });
  it("Zusammenfassung + Punkte als Text, Prompt sagt „Zusammenfassung“", () => {
    const c = leseArchivExport(roh).calls[0];
    const text = zusammenfassungAlsText(c.zusammenfassung, c.punkte);
    expect(text).toMatch(/Überblick: Wochen-Call/);
    expect(text).toMatch(/Teilnehmer: Anna Test, Ben Test/);
    expect(text).toMatch(/- To-do: Testlieferanten anschreiben/);
    expect(text).toMatch(/- Entscheidung: Q4/);
    const p = kiWissenAuftrag({ titel: c.titel, datum: c.datum, art: c.art, transkript: text }, ["amazon"], [], "zusammenfassung");
    expect(p).toMatch(/die Zusammenfassung \(ein Transkript gibt es nicht\)/);
    expect(p).toMatch(/Zusammenfassung \(zitat: wörtlich aus dieser Zusammenfassung\):/);
  });
  it("ohneTranskript: Platzhalter oder sehr kurz", () => {
    expect(ohneTranskript(KEIN_TRANSKRIPT)).toBe(true);
    expect(ohneTranskript("kurz")).toBe(true);
    expect(ohneTranskript("x ".repeat(300))).toBe(false);
    expect(artAusTeilnehmern(3)).toBe("gruppe");
    expect(artAusTeilnehmern(2)).toBe("consultant");
  });
});
