import { describe, expect, it, vi } from "vitest";

// Teil 2 – Zugänge: Die Assistenz (Mitarbeiter ohne „Geld“/„Privat“) bekommt keine Finanz- oder Privatwerkzeuge;
// die neuen Lese-Werkzeuge sind registriert (erscheinen ohne Neustart über tools/list).
vi.mock("server-only", () => ({}));

const NEU = ["liquiditaet", "kapital_ampel", "verlust_stopp", "marken_belege", "b2b_auswertung", "calls", "call_aufgaben", "calls_durchsuchen", "privat_finanzen"];

describe("Teil 2 – Werkzeuge und Rechte", async () => {
  const { ALL_TOOLS } = await import("@/lib/assistant/registry");
  const { toolAllowed } = await import("@/lib/assistant/permissions");
  const va = { role: "staff" as const, areas: ["start", "posteingang", "kalender", "wawi", "amazon", "wissen"], readOnly: false, privateAccess: false };

  it("alle neuen Werkzeuge sind registriert und nur lesend", () => {
    for (const n of NEU) {
      const t = ALL_TOOLS.find((x) => x.name === n);
      expect(t, n).toBeDefined();
      expect(t!.write, n).toBe(false);
    }
  });
  it("Assistenz: keine Geld- und Privatwerkzeuge, aber Calls/Echtheit (Amazon)", () => {
    const erlaubt = ALL_TOOLS.filter((t) => toolAllowed({ session: va, canWrite: true, privat: false }, t)).map((t) => t.name);
    for (const n of ["liquiditaet", "kapital_ampel", "verlust_stopp", "privat_finanzen"]) expect(erlaubt, n).not.toContain(n);
    for (const n of ["calls", "call_aufgaben", "calls_durchsuchen", "marken_belege", "b2b_auswertung"]) expect(erlaubt, n).toContain(n);
    expect(ALL_TOOLS.filter((t) => t.area === "privat").every((t) => !toolAllowed({ session: va, canWrite: true, privat: true }, t))).toBe(true);
  });
  it("Volltextsuche in Calls nur mit Bereich Amazon", () => {
    const suche = ALL_TOOLS.find((t) => t.name === "calls_durchsuchen")!;
    const ohneAmazon = { role: "staff" as const, areas: ["start", "wissen"], readOnly: false, privateAccess: false };
    expect(toolAllowed({ session: ohneAmazon, canWrite: false, privat: false }, suche)).toBe(false);
  });
  it("privat_finanzen nur über die Privat-Freigabe", () => {
    const pf = ALL_TOOLS.find((t) => t.name === "privat_finanzen")!;
    const owner = { role: "owner" as const, areas: null, readOnly: false, privateAccess: true };
    expect(toolAllowed({ session: owner, canWrite: false, privat: true }, pf)).toBe(true);
    expect(toolAllowed({ session: owner, canWrite: false, privat: false }, pf)).toBe(false);
  });
});
