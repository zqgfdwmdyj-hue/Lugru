import { describe, expect, it } from "vitest";
import { contentIssues, fixYears } from "@/lib/brands/content-check";

// Content-Plan: Jahreszahl und Anlass – erfundene Beiträge.
const post = (over: Partial<{ hook: string; script: string | null; caption: string | null; hashtags: string | null; shots: string[] }> = {}) => ({ hook: "Gruselige Süßigkeiten-Box", script: null, caption: "Unsere Box für Halloween", hashtags: "#halloween2025 #candy", shots: [], ...over });

describe("Content-Plan prüfen", () => {
  it("veraltete Jahreszahl im Hashtag", () => {
    const i = contentIssues(post(), "2026-10-20", "2026-10-27");
    expect(i).toEqual([expect.objectContaining({ kind: "jahr", fromYear: "2025", toYear: "2026" })]);
    const fixed = fixYears(post(), i);
    expect(fixed.hashtags).toBe("#halloween2026 #candy");
    expect(contentIssues(fixed, "2026-10-20", "2026-10-27")).toEqual([]);
  });
  it("Anlass am geplanten Tag vorbei", () => {
    const i = contentIssues(post({ hashtags: "#halloween2026" }), "2026-11-05", "2026-10-27");
    expect(i).toEqual([expect.objectContaining({ kind: "anlass", text: expect.stringContaining("Halloween (31.10.2026)") })]);
  });
  it("ohne Datum: Jahr von heute; alte Gründungsjahre und Zahlen ohne Jahresbezug bleiben", () => {
    expect(contentIssues(post({ hashtags: "#halloween2026", caption: "Seit 2012 · 2000 Bonbons" }), null, "2026-10-27")).toEqual([]);
    expect(contentIssues(post({ hashtags: "#weihnachten2024" }), null, "2026-10-27")).toEqual([expect.objectContaining({ fromYear: "2024" })]);
  });
});
