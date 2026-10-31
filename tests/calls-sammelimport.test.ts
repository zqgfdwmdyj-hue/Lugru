import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createZip } from "@/lib/ebay/export/zip";
import { leseZip } from "@/lib/zip-lesen";
import { callTitelUndDatum, datumAusText, inhaltKennung, kiAuftrag, linksMitKontext } from "@/lib/calls/logic";
import { docxText, odtText, textAusCallDateien, textDatei, untertitelText } from "@/lib/calls/dateien";

// Alle Inhalte erfunden.
const ID1 = "TESTDOC000000000000000001";
const ID2 = "TESTDOC000000000000000002";
const doc = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

const docx = (absaetze: string) =>
  createZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: `<?xml version="1.0"?><w:document><w:body>${absaetze}</w:body></w:document>` },
  ]);

describe("Datum erkennen (Dateinamen, Google Meet, Discord)", () => {
  it("verschiedene Schreibweisen", () => {
    expect(datumAusText("Wochen-Call – 2026/09/12 18:00 CEST – Transkript", "x")).toBe("2026-09-12");
    expect(datumAusText("Wochen_Call_2026_09_12", "x")).toBe("2026-09-12");
    expect(datumAusText("Call vom 12. Sept. 2026", "x")).toBe("2026-09-12");
    expect(datumAusText("Call vom 3. März 2026", "x")).toBe("2026-03-03");
    expect(datumAusText("Meeting Sep 12, 2026", "x")).toBe("2026-09-12");
    expect(datumAusText("Ludwig — 12.09.26, 17:56", "x")).toBe("2026-09-12");
    expect(datumAusText("Version 2026-13-01", "x")).toBe("x");
    expect(datumAusText("12 Teilnehmer 2026", null)).toBeNull();
  });
});

describe("Links mit Umfeld (Linkliste oder kopierte Discord-Nachrichten)", () => {
  it("Titel aus der Link-Zeile, Datum aus der Kopfzeile davor, keine Doppel", () => {
    const text = [`Ludwig (Test) — 05.09.2026 17:56`, doc(ID1), "", `Bea (Test) — 12.09.2026 18:01`, `Wochen-Call Deal-Gruppe ${doc(ID2)}`, `nochmal ${doc(ID1)}`].join("\n");
    expect(linksMitKontext(text)).toEqual([
      { docId: ID1, titel: null, datum: "2026-09-05" },
      { docId: ID2, titel: "Wochen-Call Deal-Gruppe", datum: "2026-09-12" },
    ]);
  });
});

describe("Titel und Datum je importiertem Call", () => {
  it("Bezeichnung + Datum aus dem Dateinamen", () => {
    expect(callTitelUndDatum({ name: "Call 2026-09-12.docx", text: "Transkript …", bezeichnung: "Wochen-Call Deal-Gruppe", art: "gruppe", ersatzDatum: "2026-10-29" })).toEqual({ titel: "Wochen-Call Deal-Gruppe 12.09.2026", datum: "2026-09-12", datumGeraten: false });
  });
  it("ohne Bezeichnung: Dateiname; Datum aus dem Transkript-Anfang", () => {
    expect(callTitelUndDatum({ name: "ordner/Temu und Retouren.txt", text: "Notizen vom 19.09.2026\nA: Hallo", art: "gruppe", ersatzDatum: "2026-10-29" })).toMatchObject({ titel: "Temu und Retouren", datum: "2026-09-19", datumGeraten: false });
  });
  it("Änderungsdatum aus dem ZIP, sonst heute (als geraten markiert)", () => {
    expect(callTitelUndDatum({ name: "call.txt", text: "A: Hallo", art: "gruppe", ersatzDatum: "2026-10-29", geaendert: "2026-09-26" }).datum).toBe("2026-09-26");
    expect(callTitelUndDatum({ name: null, text: "A: Hallo zusammen", art: "gruppe", ersatzDatum: "2026-10-29" })).toEqual({ titel: "A: Hallo zusammen", datum: "2026-10-29", datumGeraten: true });
  });
  it("Hinweis aus der Link-Zeile hat Vorrang", () => {
    expect(callTitelUndDatum({ titelHinweis: "Wochen-Call", datumHinweis: "2026-09-05", text: "Call 01.01.2026", art: "gruppe", ersatzDatum: "2026-10-29" })).toMatchObject({ titel: "Wochen-Call", datum: "2026-09-05" });
  });
});

describe("Inhalts-Kennung gegen Doppel aus verschiedenen Quellen", () => {
  const basis = Array.from({ length: 40 }, (_, i) => `Sprecher ${i % 3}: Testsatz Nummer ${i} über Deals, Retouren und Lager.`).join("\n");
  it("gleich trotz anderer Zeilenumbrüche, Satzzeichen und Leerzeichen", () => {
    const anders = basis.replace(/\n/g, "\n\n").replace(/\./g, " .").replace(/:/g, " –");
    expect(inhaltKennung(anders)).toBe(inhaltKennung(basis));
  });
  it("anderer Inhalt → andere Kennung; zu kurz → keine", () => {
    expect(inhaltKennung(basis.replace("Nummer 5", "Nummer 55"))).not.toBe(inhaltKennung(basis));
    expect(inhaltKennung("Kurz.")).toBeNull();
  });
});

describe("KI-Auftrag je Art", () => {
  it("Deal-Gruppe: nur Ludwigs Aufgaben", () => {
    const a = kiAuftrag("Wochen-Call", "2026-09-12", "Hallo", "gruppe");
    expect(a).toContain("Wochen-Calls einer Deal-Gruppe");
    expect(a).toContain("Aufgaben anderer Teilnehmer weglassen");
    expect(kiAuftrag("Call", "2026-09-12", "Hallo")).toContain("Calls mit dem Amazon-Consultant");
  });
});

describe("Dateien lesen", () => {
  it("ZIP: mehrere Dateien und Änderungsdatum", () => {
    const zip = createZip([{ name: "a.txt", data: "Eins" }, { name: "ordner/b.txt", data: "Zwei ü" }], new Date(2026, 8, 12, 18, 0));
    const e = leseZip(zip);
    expect(e.map((x) => [x.name, x.daten.toString("utf8"), x.geaendert])).toEqual([
      ["a.txt", "Eins", "2026-09-12"],
      ["ordner/b.txt", "Zwei ü", "2026-09-12"],
    ]);
    expect(() => leseZip(Buffer.from("kein zip"))).toThrow("Keine gültige ZIP-Datei");
  });
  it("Word: Absätze, Tabs, Sonderzeichen; gelöschte Änderungen nicht", () => {
    const d = docx('<w:p><w:r><w:t>Anna (Test):</w:t></w:r><w:r><w:tab/><w:t>Deals &amp; Preise &lt;neu&gt;</w:t></w:r></w:p><w:del><w:r><w:delText>alt</w:delText></w:r></w:del><w:p><w:r><w:t>Zweite Zeile</w:t><w:br/><w:t>Umbruch</w:t></w:r></w:p>');
    expect(docxText(d)).toBe("Anna (Test):\tDeals & Preise <neu>\nZweite Zeile\nUmbruch\n");
  });
  it("ODT, Untertitel, Windows-1252", () => {
    const odt = createZip([{ name: "content.xml", data: '<office:document-content><text:h>Titel</text:h><text:p>A<text:s text:c="2"/>B<text:tab/>C</text:p></office:document-content>' }]);
    expect(odtText(odt)).toBe("Titel\nA  B\tC\n");
    expect(untertitelText("WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Anna (Test)>Hallo zusammen\n\n2\n00:00:03.000 --> 00:00:05.000\n<v Anna (Test)>Hallo zusammen\n")).toBe("Anna (Test): Hallo zusammen");
    expect(textDatei(new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65]))).toBe("Grüße");
    expect(textDatei(new TextEncoder().encode("﻿Hallo"))).toBe("Hallo");
  });
  it("ZIP mit Word, Text, PDF; Mac-Reste übersprungen, unbekannte Dateien gemeldet", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText("Wochen-Call Testtranskript im PDF", { x: 50, y: 700, font, size: 12 });
    const pdfBytes = await pdf.save();
    const zip = createZip([
      { name: "Calls/Call 2026-09-05.docx", data: docx("<w:p><w:r><w:t>Transkript eins</w:t></w:r></w:p>") },
      { name: "Calls/Call 2026-09-12.txt", data: "Transkript zwei" },
      { name: "Calls/Call 2026-09-19.pdf", data: pdfBytes },
      { name: "__MACOSX/Calls/._Call 2026-09-12.txt", data: "x" },
      { name: "Calls/bild.png", data: "png" },
    ]);
    const r = await textAusCallDateien([{ name: "calls.zip", daten: zip }]);
    expect(r.dateien.map((d) => d.name)).toEqual(["Call 2026-09-05.docx", "Call 2026-09-12.txt", "Call 2026-09-19.pdf"]);
    expect(r.dateien[0].text.trim()).toBe("Transkript eins");
    expect(r.dateien[2].text).toContain("Wochen-Call Testtranskript im PDF");
    expect(r.fehler).toEqual(["bild.png: Dateiart nicht unterstützt (Word, PDF, Text, Untertitel oder ZIP)"]);
  });
  it("kaputte Datei: Fehler je Datei, der Rest geht weiter", async () => {
    const r = await textAusCallDateien([
      { name: "kaputt.docx", daten: new TextEncoder().encode("kein word") },
      { name: "ok.md", daten: new TextEncoder().encode("# Call\nInhalt") },
    ]);
    expect(r.dateien.map((d) => d.name)).toEqual(["ok.md"]);
    expect(r.fehler[0]).toMatch(/^kaputt\.docx: nicht lesbar/);
  });
});
