import { describe, expect, it } from "vitest";
import { callTitelAus, htmlText, jsonTranskriptText, nachrichtLink, sprecherAus, transkriptKandidat, transkriptLinks } from "@/lib/calls/live-logic";
import { ABRUF_PLAN, naechsterLauf, naechsterText, taeglichFaellig } from "@/lib/today/abruf-plan";

// Erfundene Nachrichten.
describe("B21 – Transkript erkennen", () => {
  it("Anhänge (.vtt, .docx …), mehrere = ein Call; Bilder zählen nicht; über 25 MB getrennt", () => {
    const k = transkriptKandidat({ id: "1", content: "Wochen-Call 30.10.", attachments: [{ filename: "teil1.vtt", size: 1000 }, { filename: "teil2.docx", size: 2000 }, { filename: "foto.png", size: 10 }, { filename: "gross.pdf", size: 30 * 1024 * 1024 }] });
    expect(k?.anhaenge.map((a) => a.filename)).toEqual(["teil1.vtt", "teil2.docx"]);
    expect(k?.zuGross.map((a) => a.filename)).toEqual(["gross.pdf"]);
    expect(transkriptKandidat({ id: "2", content: "Kurze Frage an alle", attachments: [{ filename: "bild.jpg" }] })).toBeNull();
  });

  it("langer Text (> 2.000 Zeichen) und Links (Google Doc, Notion, Fireflies, tl;dv, Otter)", () => {
    expect(transkriptKandidat({ id: "3", content: "a".repeat(2001) })?.langerText).toBe(true);
    expect(transkriptKandidat({ id: "4", content: "a".repeat(1999) })).toBeNull();
    const links = transkriptLinks("Doc https://docs.google.com/document/d/ABCDEFGHIJKLMNOPQRSTUVWXYZ012/edit · https://www.notion.so/team/Call-123 · https://app.fireflies.ai/view/Call::abc · https://tldv.io/app/meetings/xyz · https://otter.ai/u/abc");
    expect(links.map((l) => l.art)).toEqual(["google_doc", "notion", "fireflies", "tldv", "otter"]);
  });

  it("Titel, Sprecher, JSON-Export, Link zur Nachricht, HTML → Text", () => {
    expect(callTitelAus({ id: "5", content: "Consultant-Call 30.10.2026\nhttps://x.y/z" })).toBe("Consultant-Call 30.10.2026");
    expect(callTitelAus({ id: "6", content: "", attachments: [{ filename: "wochen_call-2026-10-30.vtt" }] })).toBe("wochen call 2026 10 30");
    expect(sprecherAus("Anna: Hallo\nBen: Hi\nAnna: Gut\nBen: Ja\nCarla: einmal")).toEqual(["Anna", "Ben"]);
    expect(sprecherAus("<v Consultant>Hallo\n<v Consultant>Weiter\n<v Ludwig>Ok\n<v Ludwig>Gut")).toEqual(["Consultant", "Ludwig"]);
    expect(jsonTranskriptText(JSON.stringify({ sentences: [{ speaker_name: "Anna", text: "Hallo" }, { speaker_name: "Ben", text: "Hi" }] }))).toBe("Anna: Hallo\nBen: Hi");
    expect(nachrichtLink("5001", "8001", "9001")).toBe("https://discord.com/channels/5001/8001/9001");
    expect(htmlText("<p>Hallo&nbsp;Welt</p><script>x()</script><div>Zwei</div>")).toBe("Hallo Welt\nZwei");
  });
});

describe("B21.5 – Auslöser, letzter und nächster Lauf", () => {
  const jetzt = new Date("2026-10-31T16:00:00Z"); // 17:00 Berlin
  it("live: sofort bei Eingang", () => {
    expect(naechsterLauf(ABRUF_PLAN["Call-Archiv (Discord live)"], new Date(), jetzt)).toBeNull();
    expect(naechsterText(ABRUF_PLAN["Call-Archiv (Discord live)"], null, jetzt)).toBe("sofort bei Eingang");
  });
  it("täglich 06:00: heute schon gelaufen → morgen 06:00; noch nicht → jetzt fällig", () => {
    const plan = ABRUF_PLAN["Call-Archiv (Discord, Sicherheitsnetz)"];
    expect(naechsterText(plan, new Date("2026-10-31T05:01:00Z"), jetzt)).toBe("01.11. 06:00");
    expect(naechsterText(plan, new Date("2026-10-30T05:01:00Z"), jetzt)).toBe("jetzt fällig");
    expect(taeglichFaellig("06:00", new Date("2026-10-30T05:01:00Z"), jetzt)).toBe(true);
    expect(taeglichFaellig("06:00", new Date("2026-10-31T05:01:00Z"), jetzt)).toBe(false);
    expect(taeglichFaellig("06:00", null, new Date("2026-10-31T04:00:00Z"))).toBe(false); // 05:00 Berlin
  });
  it("Abstand: letzter + Abstand", () => {
    expect(naechsterText(ABRUF_PLAN["Gruppen-Kanäle (Discord)"], new Date("2026-10-31T15:30:00Z"), jetzt)).toBe("heute 17:30");
    expect(naechsterText(undefined, null, jetzt)).toBe("laut Plan");
  });
});
