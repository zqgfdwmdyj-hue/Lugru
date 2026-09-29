import { describe, expect, it } from "vitest";
import { deadlineFromText, noiseReason, parseTriage, todosClosedBy, triageByRules, triagePrompt, type TriageMail } from "@/lib/amazon-todos/logic";

// Beispielmails ohne persönliche Daten.
const mail = (over: Partial<TriageMail> = {}): TriageMail => ({ key: "<a@amazon.de>", from: "Amazon Seller Central <seller-notification@amazon.de>", subject: "Handlungsbedarf", date: "2026-09-01T08:00:00Z", text: "", ...over });

describe("Grobfilter", () => {
  it("lässt Rauschen weg und Aufforderungen durch", () => {
    expect(noiseReason({ from: "auto-confirm@amazon.de", subject: "Ihre Bestellung" })).toMatch(/Absender/);
    expect(noiseReason({ from: "seller-notification@amazon.de", subject: "[CASE 1234] Antwort" })).toMatch(/Betreff/);
    expect(noiseReason({ from: "seller-notification@amazon.de", subject: "Automatische Remission für 3 Artikel" })).toMatch(/Betreff/);
    expect(noiseReason({ from: "seller-notification@amazon.de", subject: "Einladung zum Webinar" })).toMatch(/Betreff/);
    expect(noiseReason({ from: "Käufer <abc@marketplace.amazon.de>", subject: "Frage" })).toBe("kein Amazon-Systemabsender");
    expect(noiseReason({ from: "seller-notification@amazon.de", subject: "Produktsicherheit: Unterlagen erforderlich" })).toBeNull();
  });
});

describe("KI-Triage", () => {
  const mails = [mail({ key: "<1@a>" }), mail({ key: "<2@a>" }), mail({ key: "<3@a>", text: "betrifft B0TEST0001" })];

  it("baut den Auftrag mit gekürztem Text", () => {
    const p = triagePrompt([mail({ text: "x".repeat(2000) })]);
    expect(p).toContain("(id <a@amazon.de>)");
    expect(p).not.toContain("x".repeat(901));
  });

  it("liest die Antwort auch in einem Codeblock und ergänzt ASINs aus der Mail", () => {
    const text = '```json\n[{"id":"<1@a>","relevant":true,"aktion_noetig":true,"kategorie":"Produkt-Sicherheit","prioritaet":"hoch","frist":"2026-10-01","asins":["b0test0009"],"zusammenfassung":"GPSR-Unterlagen hochladen."},{"id":"<2@a>","relevant":false,"aktion_noetig":false,"kategorie":"werbung","prioritaet":"niedrig","frist":"","asins":[],"zusammenfassung":""},{"id":"<3@a>","relevant":true,"aktion_noetig":false,"kategorie":"freigabe_info","prioritaet":"niedrig","frist":"irgendwann","asins":[],"zusammenfassung":"Bestand freigegeben."}]\n```';
    const r = parseTriage(text, mails);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ key: "<1@a>", category: "produkt_sicherheit", priority: "high", deadline: "2026-10-01", asins: ["B0TEST0009"], actionNeeded: true });
    expect(r[1]).toMatchObject({ relevant: false, priority: "low" });
    expect(r[2]).toMatchObject({ deadline: null, asins: ["B0TEST0001"], category: "freigabe_info" });
  });

  it("nimmt bei abgeschnittener Antwort die vollständigen Einträge, der Rest bleibt für den nächsten Lauf", () => {
    const text = '[{"id":"<1@a>","relevant":true,"aktion_noetig":true,"kategorie":"claim","prioritaet":"mittel","frist":"","asins":[],"zusammenfassung":"A"},{"id":"<2@a>","relevant":tr';
    const r = parseTriage(text, mails);
    expect(r.map((x) => x.key)).toEqual(["<1@a>"]);
    expect(parseTriage("Leider kann ich das nicht.", mails)).toEqual([]);
  });
});

describe("Ohne KI", () => {
  it("erkennt Kategorie, Frist und ASINs", () => {
    const r = triageByRules(mail({ subject: "Echtheitsprüfung für Ihren Lagerbestand", text: "Bitte reichen Sie innerhalb von 30 Tagen Rechnungen für ASIN B0TEST0002 ein." }));
    expect(r).toMatchObject({ category: "echtheitspruefung", priority: "high", deadline: "2026-10-01", asins: ["B0TEST0002"], actionNeeded: true });
    expect(triageByRules(mail({ subject: "Ihr Bestand wurde freigegeben", text: "B0TEST0002" }))).toMatchObject({ category: "freigabe_info", actionNeeded: false });
  });

  it("liest Fristen aus deutschem und englischem Text", () => {
    expect(deadlineFromText("Bitte bis zum 5.11.2026 einreichen", "2026-09-01")).toBe("2026-11-05");
    expect(deadlineFromText("Please act by October 12, 2026.", "2026-09-01")).toBe("2026-10-12");
    expect(deadlineFromText("Kein Datum", "2026-09-01")).toBeNull();
  });
});

describe("Automatisch erledigen", () => {
  it("schließt ältere offene Aufgaben zur selben ASIN, aber keine Claims", () => {
    const open = [
      { id: "a", category: "echtheitspruefung", asins: ["B0TEST0002"], receivedAt: "2026-08-01" },
      { id: "b", category: "claim", asins: ["B0TEST0002"], receivedAt: "2026-08-01" },
      { id: "c", category: "reaktivierung", asins: ["B0TEST0003"], receivedAt: "2026-08-01" },
      { id: "d", category: "reaktivierung", asins: ["B0TEST0002"], receivedAt: "2026-09-20" },
    ];
    expect(todosClosedBy({ category: "freigabe_info", asins: ["B0TEST0002"], receivedAt: "2026-09-10" }, open)).toEqual(["a"]);
    expect(todosClosedBy({ category: "claim", asins: ["B0TEST0002"], receivedAt: "2026-09-10" }, open)).toEqual([]);
  });
});

describe("Übernahme aus dem Retouren-Tool", () => {
  it("übersetzt Status, Priorität, Frist, ASINs und Message-ID", async () => {
    const { mapLegacyTodo } = await import("@/lib/amazon-todos/legacy");
    expect(mapLegacyTodo({ message_id: "abc@amazon.de", datum: "2026-08-01T09:00:00.000Z", absender: "seller-notification@amazon.de", betreff: "Echtheitsprüfung", kategorie: "echtheitspruefung", prioritaet: "hoch", frist: "2026-08-31", asins: "B0TEST0001, b0test0002,kaputt", zusammenfassung: "Rechnungen einreichen.", status: "offen", notiz: "Rechnung liegt im Drive" })).toMatchObject({
      messageKey: "<abc@amazon.de>",
      priority: "high",
      deadline: "2026-08-31",
      asins: ["B0TEST0001", "B0TEST0002"],
      status: "open",
      note: "Rechnung liegt im Drive",
      closedBy: null,
    });
    const info = mapLegacyTodo({ message_id: "<x@y>", datum: "2026-08-02 10:00:00", kategorie: "freigabe_info", prioritaet: "niedrig", status: "erledigt", frist: "", updated_at: "2026-08-03 12:00:00" });
    expect(info).toMatchObject({ messageKey: "<x@y>", status: "done", infoOnly: true, deadline: null });
    expect(info!.receivedAt.toISOString()).toBe("2026-08-02T10:00:00.000Z");
    expect(mapLegacyTodo({ message_id: "" })).toBeNull();
  });
});
