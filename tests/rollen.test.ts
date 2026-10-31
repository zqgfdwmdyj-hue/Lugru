import { describe, expect, it } from "vitest";
import { PRIVAT_LABEL, rolleVon, vorlageFelder, zugriffsWarnungen, type Mitglied } from "@/lib/auth/rollen";

// B19.2 – erfundene Konten.
const m = (o: Partial<Mitglied>): Mitglied => ({ userId: "u1", email: "test", name: null, role: "staff", areas: null, readOnly: false, privateAccess: false, privateScope: "voll", lastLoginAt: new Date("2026-10-28T10:00:00Z"), ...o });
const JETZT = new Date("2026-10-31T12:00:00Z");

describe("Rollen-Vorlagen", () => {
  it("VA: Aufgaben, Amazon, Service – kein Privat; Familie: keine Bereiche, Privat nur Familie", () => {
    expect(vorlageFelder("va", { role: "staff", areas: null })).toEqual({ role: "staff", areas: ["start", "amazon", "service"], readOnly: false, privateAccess: false });
    expect(vorlageFelder("familie", { role: "owner", areas: null })).toEqual({ role: "staff", areas: [], readOnly: false, privateAccess: true, privateScope: "familie" });
    expect(vorlageFelder("inhaber", { role: "staff", areas: [] })).toEqual({ role: "owner", areas: null, readOnly: false });
    // Vom Inhaber zum Mitarbeiter: erst einmal keine Bereiche
    expect(vorlageFelder("mitarbeiter", { role: "owner", areas: null }).areas).toEqual([]);
    expect(vorlageFelder("mitarbeiter", { role: "staff", areas: ["wawi"] }).areas).toEqual(["wawi"]);
  });
  it("erkennt die Vorlage am Stand", () => {
    expect(rolleVon(m({ role: "owner" }))).toBe("inhaber");
    expect(rolleVon(m({ areas: ["service", "start", "amazon"] }))).toBe("va");
    expect(rolleVon(m({ areas: ["start", "amazon", "service"], privateAccess: true }))).toBe("mitarbeiter");
    expect(rolleVon(m({ areas: [], privateAccess: true, privateScope: "familie" }))).toBe("familie");
    expect(rolleVon(m({ areas: null }))).toBe("mitarbeiter");
  });
});

describe("Warnungen in der Benutzerliste", () => {
  it("Privat voll bei Nicht-Inhaber rot, weiteres Inhaber-Konto, alle Bereiche, Konto der VA", () => {
    const w = zugriffsWarnungen(
      [
        m({ userId: "ich", role: "owner", privateAccess: true }),
        m({ userId: "t", email: "test", privateAccess: true, privateScope: "voll" }),
        m({ userId: "p", email: "partnerin", role: "owner", lastLoginAt: JETZT }),
        m({ userId: "d", email: "du@firma.example", role: "owner", lastLoginAt: null }),
        m({ userId: "v", email: "va@va.example", areas: null }),
        m({ userId: "f", email: "fam", areas: [], privateAccess: true, privateScope: "familie" }),
        m({ userId: "r", email: "pruefer", areas: null, readOnly: true, privateAccess: true }),
      ],
      "ich",
      { jetzt: JETZT, vaLogin: "VA@va.example" },
    );
    const fuer = (id: string) => w.filter((x) => x.userId === id);
    expect(fuer("t").find((x) => x.text.includes("Privat „voll“ bei Nicht-Inhaber"))?.stufe).toBe("rot");
    expect(fuer("p")[0]).toMatchObject({ stufe: "gelb" });
    expect(fuer("p")[0].text).toContain("Nur Familie");
    expect(fuer("d")[0]).toMatchObject({ stufe: "rot" });
    expect(fuer("d")[0].text).toContain("nie angemeldet – entfernen?");
    expect(fuer("v").map((x) => x.stufe)).toEqual(["gelb", "rot"]);
    expect(fuer("f")).toEqual([]);
    expect(fuer("r")).toEqual([]);
    expect(fuer("ich")).toEqual([]);
  });
  it("Privat-Spalte", () => {
    expect(PRIVAT_LABEL(m({ privateAccess: true, privateScope: "familie" }))).toBe("nur Familie");
    expect(PRIVAT_LABEL(m({ privateAccess: true, readOnly: true }))).toBe("gesperrt (nur ansehen)");
    expect(PRIVAT_LABEL(m({}))).toBe("kein");
  });
});

describe("B20.1 – Zugriffsrechte hart", () => {
  it("Privat „voll“ nur für Inhaber", async () => {
    const { privatStufeErlaubt } = await import("@/lib/auth/rollen");
    expect(privatStufeErlaubt("owner", "voll")).toBe(true);
    expect(privatStufeErlaubt("staff", "voll")).toBe(false);
    expect(privatStufeErlaubt("staff", "familie")).toBe(true);
    expect(privatStufeErlaubt("staff", "aus")).toBe(true);
  });

  it("Mitarbeiter-Vorlage nimmt Privat „voll“ weg, „nur Familie“ bleibt", async () => {
    const { vorlageFelder } = await import("@/lib/auth/rollen");
    expect(vorlageFelder("mitarbeiter", { role: "owner", areas: null, privateAccess: true, privateScope: "voll" }).privateAccess).toBe(false);
    expect(vorlageFelder("mitarbeiter", { role: "staff", areas: ["start"], privateAccess: true, privateScope: "familie" }).privateAccess).toBeUndefined();
  });

  it("nie angemeldet und älter als 30 Tage → deaktivieren; ein aktiver Inhaber bleibt immer", async () => {
    const { nieAngemeldetZuDeaktivieren } = await import("@/lib/auth/rollen");
    const jetzt = new Date("2026-10-31T12:00:00Z");
    const alt = new Date("2026-09-01T12:00:00Z");
    const neu = new Date("2026-10-20T12:00:00Z");
    const ms = [
      { userId: "ich", role: "owner" as const, lastLoginAt: jetzt, createdAt: alt, deaktiviertAm: null },
      { userId: "test", role: "staff" as const, lastLoginAt: null, createdAt: alt, deaktiviertAm: null },
      { userId: "frisch", role: "staff" as const, lastLoginAt: null, createdAt: neu, deaktiviertAm: null },
      { userId: "genutzt", role: "staff" as const, lastLoginAt: alt, createdAt: alt, deaktiviertAm: null },
      { userId: "schon", role: "staff" as const, lastLoginAt: null, createdAt: alt, deaktiviertAm: alt },
      { userId: "inhaber2", role: "owner" as const, lastLoginAt: null, createdAt: alt, deaktiviertAm: null },
    ];
    expect(nieAngemeldetZuDeaktivieren(ms, { jetzt }).sort()).toEqual(["inhaber2", "test"]);
    // Ohne aktiven, schon angemeldeten Inhaber: kein Inhaber-Konto deaktivieren
    expect(nieAngemeldetZuDeaktivieren(ms.filter((m) => m.userId !== "ich"), { jetzt })).toEqual(["test"]);
  });

  it("Dialog-Zähler: nur Nicht-Inhaber mit Privat „voll“ (nicht nur-ansehen)", async () => {
    const { privatVollBeiNichtInhaber } = await import("@/lib/auth/rollen");
    expect(privatVollBeiNichtInhaber([
      { role: "owner", privateAccess: true, privateScope: "voll", readOnly: false },
      { role: "staff", privateAccess: true, privateScope: "voll", readOnly: false },
      { role: "staff", privateAccess: true, privateScope: "voll", readOnly: true },
      { role: "staff", privateAccess: true, privateScope: "familie", readOnly: false },
    ])).toBe(1);
  });
});
