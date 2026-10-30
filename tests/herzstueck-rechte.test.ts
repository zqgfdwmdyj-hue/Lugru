import { describe, expect, it, vi } from "vitest";

// Herzstück-Werkzeuge: registriert (erscheinen über tools/list ohne Neustart), ändernd nur wo vorgesehen,
// Assistenz (VA) ohne Geld/Privat, Fristen nur mit Privat-Freigabe.
vi.mock("server-only", () => ({}));

const LESEND = ["deal_pruefen", "tagesplan", "fristen", "buchhaltung_status", "feierabend"];
const AENDERND = ["aufgabe_verschieben", "aufgabe_zuweisen"];

describe("Herzstück – Werkzeuge und Rechte", async () => {
  const { ALL_TOOLS } = await import("@/lib/assistant/registry");
  const { toolAllowed } = await import("@/lib/assistant/permissions");
  const va = { role: "staff" as const, areas: ["start", "posteingang", "kalender", "amazon", "wissen"], readOnly: false, privateAccess: false };
  const owner = { role: "owner" as const, areas: null, readOnly: false, privateAccess: true };
  const t = (n: string) => ALL_TOOLS.find((x) => x.name === n)!;

  it("alle registriert; nur aufgabe_verschieben und aufgabe_zuweisen ändern", () => {
    for (const n of LESEND) expect(t(n)?.write, n).toBe(false);
    for (const n of AENDERND) expect(t(n)?.write, n).toBe(true);
    expect(new Set(ALL_TOOLS.map((x) => x.name)).size).toBe(ALL_TOOLS.length);
  });
  it("Assistenz: Tagesplan/Feierabend ja, Buchhaltung/Fristen/Deal-Ampel nein; zuweisen nur Inhaber", () => {
    const erlaubt = ALL_TOOLS.filter((x) => toolAllowed({ session: va, canWrite: true, privat: false }, x)).map((x) => x.name);
    for (const n of ["tagesplan", "feierabend", "aufgabe_verschieben"]) expect(erlaubt, n).toContain(n);
    for (const n of ["buchhaltung_status", "fristen", "deal_pruefen", "aufgabe_zuweisen"]) expect(erlaubt, n).not.toContain(n);
  });
  it("fristen nur über die Privat-Freigabe", () => {
    expect(toolAllowed({ session: owner, canWrite: false, privat: true }, t("fristen"))).toBe(true);
    expect(toolAllowed({ session: owner, canWrite: false, privat: false }, t("fristen"))).toBe(false);
  });
});
