import { describe, expect, it } from "vitest";
import { personAus, personKey, regelFuer, wochenUebersicht, zuweisungsPlan, type AufgabeZ, type Regel } from "@/lib/delegieren/logic";

// Modul 2 – Delegieren (erfundene Aufgaben).

const VA = "user:11111111-1111-4111-8111-111111111111" as const;
const a = (id: string, o: Partial<AufgabeZ> = {}): AufgabeZ => ({ id, title: "Aufgabe", category: "eigene", systemKey: null, status: "open", dueDate: null, completedAt: null, createdAt: new Date("2026-10-01T10:00:00Z"), assigneeId: null, zustaendigExtern: null, ...o });

describe("Personen", () => {
  it("intern = Konto, extern = Name", () => {
    expect(personKey({ userId: "abc" })).toBe("user:abc");
    expect(personKey({ extern: "Steuerberater" })).toBe("extern:Steuerberater");
    expect(personAus(VA)).toEqual({ userId: VA.slice(5) });
    expect(personAus("extern:Prep Center")).toEqual({ extern: "Prep Center" });
    expect(personAus("user:kaputt")).toBeNull();
  });
});

describe("Regeln: Vorschlag beim ersten Mal, danach automatisch", () => {
  const regeln: Regel[] = [
    { typ: "schluessel:claims", person: VA, bestaetigt: true },
    { typ: "titel:nachfassen", person: "extern:Prep Center", bestaetigt: false },
  ];
  it("passende Regel nach Systemschlüssel oder Titel", () => {
    expect(regelFuer({ title: "3 Erstattungsansprüche einreichen", category: "amazon", systemKey: "claims-open" }, regeln)?.person).toBe(VA);
    expect(regelFuer({ title: "Lieferant Test nachfassen", category: "einkauf", systemKey: null }, regeln)?.bestaetigt).toBe(false);
    expect(regelFuer({ title: "Steuer", category: "geld", systemKey: null }, regeln)).toBeNull();
  });
  it("bestätigt → zuweisen; unbestätigt → Vorschlag; schon zuständig/Ausnahme/erledigt → nichts", () => {
    const p = zuweisungsPlan(
      [
        a("1", { systemKey: "claims-open" }),
        a("2", { title: "Testlieferant nachfassen" }),
        a("3", { systemKey: "claims-open", assigneeId: "x" }),
        a("4", { title: "Kartons nachfassen" }),
        a("5", { systemKey: "claims-open", status: "done" }),
      ],
      regeln,
      new Set(["4"]),
    );
    expect(p.zuweisen).toEqual([{ id: "1", person: VA, typ: "schluessel:claims" }]);
    expect(p.vorschlaege.map((v) => v.id)).toEqual(["2"]);
  });
});

describe("Wochenübersicht je Person", () => {
  it("offen, überfällig, erledigt und neu in den letzten 7 Tagen", () => {
    const z = wochenUebersicht(
      [
        a("1", { assigneeId: VA.slice(5), dueDate: "2026-10-25" }),
        a("2", { assigneeId: VA.slice(5), dueDate: "2026-11-05", createdAt: new Date("2026-10-29T09:00:00Z") }),
        a("3", { assigneeId: VA.slice(5), status: "done", completedAt: new Date("2026-10-28T12:00:00Z") }),
        a("4", { zustaendigExtern: "Steuerberater", dueDate: "2026-11-30" }),
        a("5"),
      ],
      "2026-10-30",
    );
    expect(z[0]).toMatchObject({ person: VA, offen: 2, ueberfaellig: 1, erledigtWoche: 1, neuWoche: 1, aelteste: "2026-10-25" });
    expect(z[1]).toMatchObject({ person: "extern:Steuerberater", offen: 1, ueberfaellig: 0 });
    expect(z).toHaveLength(2);
  });
});
