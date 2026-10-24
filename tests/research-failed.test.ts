import { describe, expect, it } from "vitest";
import { isFailedResearchBody, isFailedSummary } from "@/lib/research/summary";

// Fehlgeschlagene KI-Zusammenfassungen erkennen. Fiktive Texte.

describe("fehlgeschlagene Recherche", () => {
  it("Ablehnungen und leere Antworten", () => {
    expect(isFailedSummary("Ich kann diese Zusammenfassung nicht erstellen, da …")).toBe(true);
    expect(isFailedSummary("Leider kann ich das nicht.")).toBe(true);
    expect(isFailedSummary("I can't summarize these articles.")).toBe(true);
    expect(isFailedSummary("")).toBe(true);
    expect(isFailedSummary("• Amazon ändert die FBA-Gebühren ab März …")).toBe(false);
  });
  it("gespeicherte Einträge", () => {
    expect(isFailedResearchBody("ZUSAMMENFASSUNG (KI)\nIch kann diese Zusammenfassung nicht erstellen.\n\nNEUE ARTIKEL (3)")).toBe(true);
    expect(isFailedResearchBody("ZUSAMMENFASSUNG (KI)\n• Neue Regeln für Verpackung\n\nNEUE ARTIKEL (3)")).toBe(false);
    expect(isFailedResearchBody("NEUE ARTIKEL (3)\n\n[1] Titel")).toBe(false);
  });
});
