import { describe, expect, it } from "vitest";
import { callWissenText, kiWissenAuftrag, leseKiWissen, trefferImText, werNormal, wissenPruefen } from "@/lib/calls/logic";
import { KNOWLEDGE_CATEGORIES } from "@/lib/knowledge/categories";
import { wissenSichtbar } from "@/lib/knowledge/sichtbar";

// Alle Inhalte erfunden.
const call = { titel: "Wochen-Call Testgruppe 12.09.2026", datum: "2026-09-12", art: "gruppe" as const, transkript: "Anna (Test): Hallo zusammen …" };

describe("KI-Auftrag Wissen aus Calls", () => {
  it("Insider-Wissen, Kategorien, bekannte Titel gegen Doppel", () => {
    const a = kiWissenAuftrag(call, KNOWLEDGE_CATEGORIES, ["Temu sperrt bei Lieferverzug (Test)"]);
    expect(a).toContain("Wochen-Calls einer Deal-Gruppe");
    expect(a).toContain("Insider-Wissen");
    expect(a).toContain("TikTok Shop & Temu");
    expect(a).toContain("- Temu sperrt bei Lieferverzug (Test)");
    expect(a).toContain("„Ergänzung: …“");
    expect(a).toContain('"art":"tipp|quelle|regel|warnung|erfahrung"');
    expect(a).toContain("Name des Teilnehmers");
    expect(a).toContain("Call: Wochen-Call Testgruppe 12.09.2026 am 2026-09-12");
    expect(kiWissenAuftrag({ ...call, art: "consultant" }, KNOWLEDGE_CATEGORIES, [])).not.toContain("Schon im Wissen");
  });
});

describe("KI-Antwort Wissen prüfen", () => {
  it("nur vollständige Einträge, keine Doppel, Kategorie bekannt oder „Aus Calls“", () => {
    const antwort = `Hier: ${JSON.stringify({
      wissen: [
        { titel: "Prep-Center X (Test) nimmt 0,40 € je Einheit", inhalt: "Erfundener Testinhalt mit genug Text für einen Eintrag.", kategorie: "fba prep & versand", stichworte: ["Prep", "Prep", "Kosten", "a", "b", "c", "d", "e"], zitat: "0,40 je Einheit", einschaetzung: "bestaetigt", art: "quelle", wer: "Anna (Test)" },
        { titel: "prep-center x (test) nimmt 0,40 € je einheit", inhalt: "Doppelt – fällt raus, auch wenn der Text lang genug ist.", kategorie: "Lieferanten" },
        { titel: "Kurz", inhalt: "zu kurz" },
        { titel: "Gerücht über neue Gebühr (Test)", inhalt: "Erfundener Testinhalt: angeblich kommt eine neue Gebühr.", kategorie: "Unbekannt", einschaetzung: "egal" },
      ],
    })}`;
    const w = leseKiWissen(antwort, KNOWLEDGE_CATEGORIES);
    expect(w).toEqual([
      { titel: "Prep-Center X (Test) nimmt 0,40 € je Einheit", inhalt: "Erfundener Testinhalt mit genug Text für einen Eintrag.", kategorie: "FBA Prep & Versand", stichworte: ["Prep", "Kosten", "a", "b", "c", "d"], zitat: "0,40 je Einheit", einschaetzung: "bestaetigt", art: "quelle", wer: "Gruppe – Anna (Test)" },
      { titel: "Gerücht über neue Gebühr (Test)", inhalt: "Erfundener Testinhalt: angeblich kommt eine neue Gebühr.", kategorie: "Aus Calls", stichworte: [], zitat: null, einschaetzung: "einzelmeinung", art: "tipp", wer: "Gruppe" },
    ]);
    expect(leseKiWissen("kein json", KNOWLEDGE_CATEGORIES)).toEqual([]);
    const viele = { wissen: Array.from({ length: 40 }, (_, i) => ({ titel: `Eintrag Nummer ${i}`, inhalt: "Erfundener Testinhalt, lang genug." })) };
    expect(leseKiWissen(JSON.stringify(viele), KNOWLEDGE_CATEGORIES)).toHaveLength(25);
  });
  it("Text mit Einschätzung und Quelle", () => {
    expect(callWissenText({ titel: "T", inhalt: "Inhalt.", kategorie: "Aus Calls", stichworte: [], zitat: "wörtlich", einschaetzung: "unsicher", art: "warnung", wer: "Consultant" }, call)).toBe("Inhalt.\n\nWarnung · gesagt von: Consultant · Einschätzung: unsicher/Gerücht\n\nQuelle: „Wochen-Call Testgruppe 12.09.2026“ vom 12.09.2026 – „wörtlich“");
  });
  it("wer hat es gesagt – einheitlich", () => {
    expect(werNormal("der Consultant", "consultant")).toBe("Consultant");
    expect(werNormal("ich", "gruppe")).toBe("Ludwig");
    expect(werNormal("Ludwig", "consultant")).toBe("Ludwig");
    expect(werNormal("Ben (Test)", "gruppe")).toBe("Gruppe – Ben (Test)");
    expect(werNormal("gruppe", "gruppe")).toBe("Gruppe");
    expect(werNormal(null, "gruppe")).toBe("Gruppe");
    expect(werNormal("unklar", "consultant")).toBeNull();
    expect(werNormal("Ben (Test)", "consultant")).toBe("Ben (Test)");
  });
  it("Haltbarkeit: älter als 6 Monate und seitdem nicht geprüft → prüfen", () => {
    expect(wissenPruefen("2026-09-12", null, "2026-10-30")).toBe(false);
    expect(wissenPruefen("2026-03-01", null, "2026-10-30")).toBe(true);
    expect(wissenPruefen("2026-03-01", new Date("2026-10-01T10:00:00Z"), "2026-10-30")).toBe(false);
    expect(wissenPruefen("2026-03-01", new Date("2026-03-05T10:00:00Z"), "2026-10-30")).toBe(true);
    expect(wissenPruefen(null, null, "2026-10-30")).toBe(false);
  });
});

describe("Volltextsuche im Transkript", () => {
  const text = `Anna (Test): Wir reden heute über Temu.\n${"Füllsatz ohne Bedeutung. ".repeat(40)}\nBen (Test): Bei Temu gab es eine Sperre wegen Lieferverzug.\n${"Noch mehr Füllsatz. ".repeat(40)}\nAnna (Test): Die Sperre war nach drei Tagen weg.`;
  it("Wörter zählen, beste Stellen zuerst nach Position", () => {
    const r = trefferImText(text, "temu SPERRE");
    expect(r.woerter).toBe(2);
    expect(r.treffer).toBe(4);
    expect(r.ausschnitte.length).toBeGreaterThanOrEqual(2);
    expect(r.ausschnitte.some((a) => a.includes("Bei Temu gab es eine Sperre wegen Lieferverzug"))).toBe(true);
  });
  it("nichts gefunden / leere Suche", () => {
    expect(trefferImText(text, "Kaufland")).toEqual({ woerter: 0, treffer: 0, ausschnitte: [] });
    expect(trefferImText(text, "!")).toEqual({ woerter: 0, treffer: 0, ausschnitte: [] });
  });
});

describe("Sichtbarkeit: Wissen aus Calls nur, wer die Calls sehen darf", () => {
  it("Inhaber und Bereich Amazon sehen alles, andere nicht", () => {
    expect(wissenSichtbar({ role: "owner", areas: null })).toBeUndefined();
    expect(wissenSichtbar({ role: "staff", areas: null })).toBeUndefined();
    expect(wissenSichtbar({ role: "staff", areas: ["wissen", "amazon"] })).toBeUndefined();
    expect(wissenSichtbar({ role: "staff", areas: ["wissen", "start"] })).toBeDefined();
  });
});
