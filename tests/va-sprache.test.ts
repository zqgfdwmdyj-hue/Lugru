import { describe, expect, it } from "vitest";
import { aufgabenText, erinnerungText, rechnungenText, regelEinordnung, threadAntwortArt } from "@/lib/va/logic";
import { datum, GLOSSAR_STANDARD, glossarAlsText, glossarAusText, glossarErsetzen, notizFuerSprache, schuetzen, spracheErkennen, uebersetzungsAuftrag, wiederherstellen } from "@/lib/va/sprache";

// Erfundene Texte, keine echten Daten.
describe("Schutz vor der Übersetzung", () => {
  it("SKUs, ASINs, Bestell-/Fall-/Sendungsnummern, Beträge, Links und Erwähnungen werden Platzhalter", () => {
    const t = "Anspruch für Sendung FBA15M4H707G, ASIN B0999B7CCM, SKU: TEST-NIKE-1, Bestellung 302-1234567-1234567, Fall 22907365031, 19,90 € – https://example.invalid/x <@700000000000000001>";
    const { text, teile } = schuetzen(t);
    expect(text).not.toMatch(/FBA15M4H707G|B0999B7CCM|TEST-NIKE-1|302-1234567|22907365031|19,90 €|https:|<@/);
    expect(teile).toEqual(expect.arrayContaining(["FBA15M4H707G", "B0999B7CCM", "302-1234567-1234567", "22907365031", "19,90 €", "https://example.invalid/x"]));
    expect(wiederherstellen(text, teile)).toBe(t);
  });
  it("verlorener oder erfundener Platzhalter → null (dann bleibt das Original)", () => {
    const { text, teile } = schuetzen("Rechnung für B0999B7CCM und Fall 22907365031");
    expect(wiederherstellen(text.replace("⟦1⟧", ""), teile)).toBeNull();
    expect(wiederherstellen(`${text} ⟦9⟧`, teile)).toBeNull();
  });
});

describe("Sprache, Glossar, Datum", () => {
  it("erkennt Englisch und Deutsch", () => {
    expect(spracheErkennen("Can you send me the invoice for B0999B7CCM? Also please check the case 22907365031.")).toBe("en");
    expect(spracheErkennen("Kannst du mir bitte die Rechnung für den Fall schicken?")).toBe("de");
    expect(spracheErkennen("👍")).toBeNull();
  });
  it("Glossar steht im KI-Auftrag; Text-Format der Einstellungen hin und zurück", () => {
    const a = uebersetzungsAuftrag("Remission ⟦0⟧ prüfen", "en", GLOSSAR_STANDARD);
    expect(a).toContain("Remission → removal order");
    expect(a).toContain("Anspruch → reimbursement claim");
    expect(a).toContain("⟦0⟧");
    expect(glossarAusText(glossarAlsText(GLOSSAR_STANDARD))).toEqual(GLOSSAR_STANDARD);
    expect(glossarAusText("Kaputt\nFehlmenge = shortage\n = leer")).toEqual({ Fehlmenge: "shortage" });
    expect(glossarErsetzen("Fehlmenge in der Sendung", GLOSSAR_STANDARD, "en")).toBe("shortage in der shipment");
  });
  it("Datum für die VA: „Nov 2“, im anderen Jahr mit Jahr", () => {
    expect(datum("2026-11-02", "en", 2026)).toBe("Nov 2");
    expect(datum("2027-01-15", "en", 2026)).toBe("Jan 15, 2027");
    expect(datum("2026-11-02", "de", 2026)).toBe("02.11.2026");
  });
  it("Fall-Paket für die englische VA ohne deutschen Amazon-Text", () => {
    const n = "Zu tun:\n1. Hochladen\n\nText DE:\nSehr geehrtes Team …\n\nText EN:\nDear team …\n\nBelege:\n- RE-1";
    expect(notizFuerSprache(n, "en")).not.toContain("Sehr geehrtes");
    expect(notizFuerSprache(n, "en")).toContain("Text EN:\nDear team");
    expect(notizFuerSprache(n, "de")).toBe(n);
  });
});

describe("Bot-Texte auf Englisch", () => {
  it("Aufgabe, Erinnerung, Rechnungen", () => {
    const t = aufgabenText({ titel: "File reimbursement claim", faellig: "2026-11-02", prioritaet: "critical", notiz: null, zusatz: null, link: null, anleitungen: [{ titel: "How to", schritte: ["Open report"], autoUebersetzt: true }], anhaenge: [], vaId: "1", sprache: "en" });
    expect(t).toContain("📋 **New task: File reimbursement claim**");
    expect(t).toMatch(/Due: Nov 2(, 2026)? · Priority: 🔴 important/);
    expect(t).toContain("📖 **Instructions: How to** _(auto-translated)_");
    expect(t).toContain("When done");
    expect(erinnerungText("heute", "X", "2026-11-02", null, "en")).toContain("Due today");
    expect(rechnungenText("Nike B0999B7CCM", [{ datum: "2026-10-20", lieferant: "Test GmbH", nummer: "RE-1", datei: null }], 1, "en")).toMatch(/Invoices for Nike B0999B7CCM: 1[\s\S]*No\. RE-1[\s\S]*File attached/);
    // Deutsch unverändert
    expect(aufgabenText({ titel: "X", faellig: null, prioritaet: "normal", notiz: null, zusatz: null, link: null, anleitungen: [], anhaenge: [] })).toContain("📋 **Neue Aufgabe: X**");
  });
  it("englische Antworten der VA: erledigt, Rückfrage, Bitte, Smalltalk", () => {
    expect(threadAntwortArt("Done ✅")).toBe("erledigt");
    expect(threadAntwortArt("not done yet")).toBe("notiz");
    expect(threadAntwortArt("Should I escalate the case?")).toBe("rueckfrage");
    expect(regelEinordnung("Can you send me the invoice for B0999B7CCM?", "2026-10-30", []).anfrage?.typ).toBe("rechnung");
    expect(regelEinordnung("Thanks!", "2026-10-30", []).art).toBe("smalltalk");
    expect(regelEinordnung("Should I file the claim?", "2026-10-30", []).art).toBe("frage");
    expect(regelEinordnung("Please check this until tomorrow", "2026-10-30", []).faellig).toBe("2026-10-31");
  });
});
