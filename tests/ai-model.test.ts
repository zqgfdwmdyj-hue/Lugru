import { describe, expect, it } from "vitest";
import { CHEAP_MODEL, SMART_MODEL, modelFor, requestBody } from "@/lib/ai/claude";

describe("KI-Modellwahl", () => {
  it("ausgewogen ist Vorgabe: Haiku für Mails, Sonnet für Content", () => {
    expect(modelFor({}, "simple")).toBe(CHEAP_MODEL);
    expect(modelFor(null, "creative")).toBe(SMART_MODEL);
  });
  it("sparsam und Qualität gelten überall", () => {
    expect(modelFor({ tier: "sparsam" }, "creative")).toBe(CHEAP_MODEL);
    expect(modelFor({ tier: "qualitaet" }, "simple")).toBe(SMART_MODEL);
  });
  it("eigenes Modell überschreibt die Stufe", () => {
    expect(modelFor({ tier: "sparsam", model: " claude-opus-5-5 " }, "simple")).toBe("claude-opus-5-5");
  });
  it("Haiku ohne effort, Sonnet 5.x mit niedriger effort und Luft für das Denken", () => {
    expect(requestBody(CHEAP_MODEL, "x", 1000, "simple")).toEqual({ model: CHEAP_MODEL, max_tokens: 1000, messages: [{ role: "user", content: "x" }] });
    const s = requestBody(SMART_MODEL, "x", 4000, "creative");
    expect(s.max_tokens).toBe(7000);
    expect(s.output_config).toEqual({ effort: "medium" });
    expect(requestBody("claude-sonnet-5", "x", 900, "simple").output_config).toEqual({ effort: "low" });
  });
});
