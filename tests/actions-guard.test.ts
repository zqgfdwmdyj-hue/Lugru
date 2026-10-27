import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Nur-ansehen-Konten werden in requireSession abgewiesen. Das hält nur, wenn jede Server Action die
// Sitzung über requireSession/requireArea/requireOwner holt – direkt oder über eine Hilfsfunktion der Datei.

// requirePrivate (src/lib/private/service.ts) ruft selbst requireSession auf, requireFlip
// (src/lib/watches/service.ts) requireArea("marken").
const GUARD = /\brequire(Session|Area|Owner|Private|Flip)\(/;
const FREE = new Set(["src/app/login/actions.ts:login", "src/app/login/actions.ts:logout"]);

function functionBodies(src: string) {
  const out = new Map<string, string>();
  const re = /(?:export\s+)?async\s+function\s+(\w+)\s*\(|(?:export\s+)?const\s+(\w+)\s*=\s*async\s*\(/g;
  const starts = [...src.matchAll(re)].map((m) => ({ name: m[1] ?? m[2], at: m.index! }));
  starts.forEach((s, i) => out.set(s.name, src.slice(s.at, starts[i + 1]?.at ?? src.length)));
  return out;
}

describe("Server Actions prüfen die Sitzung (Grundlage für „Nur ansehen“)", () => {
  const files = globSync("src/**/*.{ts,tsx}").filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
  it("findet die Action-Dateien", () => expect(files.length).toBeGreaterThan(20));
  it("jede exportierte Action ruft require…() auf (auch über eine Hilfsfunktion)", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const bodies = functionBodies(src);
      const guarded = (name: string, seen = new Set<string>()): boolean => {
        const body = bodies.get(name) ?? "";
        if (GUARD.test(body)) return true;
        seen.add(name);
        return [...bodies.keys()].some((h) => !seen.has(h) && new RegExp(`\\b${h}\\(`).test(body) && guarded(h, seen));
      };
      for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
        if (!FREE.has(`${f}:${m[1]}`) && !guarded(m[1])) missing.push(`${f}:${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
