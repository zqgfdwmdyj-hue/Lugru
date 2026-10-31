import { describe, expect, it } from "vitest";
import { canAccess, homeFor } from "@/lib/auth/areas";
import { dateStats, nextSleeper, diaryReport, diarySeries, intimStats, kidsHours, kidsOverview, memberLabels, monthGrid, num, partnerHolders, rating, sinceSummary, taskState, weekStart, type DiaryEntry, type TaskEntry, lastTaken, linkIssues } from "@/lib/private/logic";

// Bereich „Privat“: Rechte und Auswertungen. Fiktive Daten.

describe("Zugang Privat", () => {
  it("nur mit eigenem Recht – auch nicht für Inhaber oder „alle Bereiche“", () => {
    expect(canAccess({ role: "owner", areas: null }, "privat")).toBe(false);
    expect(canAccess({ role: "staff", areas: null }, "privat")).toBe(false);
    expect(canAccess({ role: "staff", areas: ["privat"] }, "privat")).toBe(false);
    expect(canAccess({ role: "owner", areas: null, privateAccess: true }, "privat")).toBe(true);
    expect(canAccess({ role: "staff", areas: [], privateAccess: true }, "privat")).toBe(true);
    // andere Bereiche unverändert
    expect(canAccess({ role: "owner", areas: null }, "wawi")).toBe(true);
    expect(canAccess({ role: "staff", areas: [], privateAccess: true }, "wawi")).toBe(false);
  });
  it("Konto nur mit Privat-Zugang landet in Privat", () => {
    expect(homeFor({ role: "staff", areas: [], privateAccess: true })).toBe("/privat");
    expect(homeFor({ role: "staff", areas: [] })).toBe("/kein-zugriff");
    expect(homeFor({ role: "staff", areas: ["paletten"], privateAccess: true })).toBe("/paletten");
  });
});

describe("Kalender und Paar", () => {
  it("Monatsraster ab Montag", () => {
    const g = monthGrid("2026-10");
    expect(g[0]).toBe("2026-09-28");
    expect(g[g.length - 1]).toBe("2026-11-01");
    expect(g.length % 7).toBe(0);
    expect(weekStart("2026-10-24")).toBe("2026-10-19");
  });
  it("Anzahl im Monat, zuletzt, mittlerer Abstand", () => {
    const s = intimStats([{ day: "2026-10-01" }, { day: "2026-10-05" }, { day: "2026-10-05" }, { day: "2026-10-15" }, { day: "2026-09-20" }], "2026-10", "2026-10-24");
    expect(s.inMonth).toBe(4);
    expect(s.last).toBe("2026-10-15");
    expect(s.daysSinceLast).toBe(9);
    // Tage 20.9., 1.10., 5.10., 15.10. → Abstände 11, 4, 10
    expect(s.avgGapDays).toBe(8.3);
    expect(intimStats([], "2026-10", "2026-10-24").daysSinceLast).toBeNull();
  });
});

describe("Paarzeit", () => {
  it("Anzahl, Stunden und Kosten im Monat, zuletzt, Ø Abstand", () => {
    const s = dateStats(
      [
        { day: "2026-10-03", from: "19:00", to: "23:30", sitter: "Babysitterin", costEur: 45 },
        { day: "2026-10-17", hours: 3, sitter: "Oma" },
        { day: "2026-09-19", hours: 2, costEur: 30 },
      ],
      "2026-10",
      "2026-10-24",
    );
    expect(s).toMatchObject({ inMonth: 2, hoursInMonth: 7.5, costInMonth: 45, last: "2026-10-17", daysSinceLast: 7, avgGapDays: 14, last90: 3 });
    expect(dateStats([], "2026-10", "2026-10-24")).toMatchObject({ inMonth: 0, daysSinceLast: null, avgGapDays: null });
  });
});

describe("Ausschlafen", () => {
  it("abwechselnd, außer einer liegt im Monat 2× zurück", () => {
    expect(nextSleeper([], "2026-10")).toBeNull();
    expect(nextSleeper([{ day: "2026-10-18", person: "a" }], "2026-10")).toBe("b");
    expect(nextSleeper([{ day: "2026-10-18", person: "a" }, { day: "2026-10-24", person: "b" }], "2026-10")).toBe("a");
    expect(nextSleeper([{ day: "2026-10-04", person: "a" }, { day: "2026-10-11", person: "a" }, { day: "2026-10-18", person: "b" }, { day: "2026-10-19", person: "a" }], "2026-10")).toBe("b");
    // gleicher Tag: der später eingetragene zählt als letzter
    expect(nextSleeper([{ day: "2026-10-24", person: "b", at: 2 }, { day: "2026-10-24", person: "a", at: 1 }], "2026-10")).toBe("a");
    // Vormonat zählt fürs Abwechseln, nicht für den Ausgleich
    expect(nextSleeper([{ day: "2026-09-27", person: "b" }], "2026-10")).toBe("a");
  });
});

describe("Kinderzeit", () => {
  it("Stunden aus von–bis (auch über Mitternacht) oder Angabe", () => {
    expect(kidsHours({ from: "14:00", to: "16:30" })).toBe(2.5);
    expect(kidsHours({ from: "22:00", to: "01:00" })).toBe(3);
    expect(kidsHours({ hours: 4 })).toBe(4);
    expect(kidsHours({})).toBe(0);
  });
  it("je Person summiert, Tage mit beiden Spalten", () => {
    const o = kidsOverview(
      [
        { day: "2026-10-03", person: "a", from: "10:00", to: "12:00" },
        { day: "2026-10-03", person: "b", hours: 1.5 },
        { day: "2026-10-10", person: "b", from: "09:00", to: "13:00" },
        { day: "2026-09-30", person: "a", hours: 8 },
      ],
      "2026-10",
    );
    expect(o.totals).toEqual({ a: { count: 1, hours: 2 }, b: { count: 2, hours: 5.5 } });
    expect(o.shareA).toBe(27);
    expect(o.days.map((d) => [d.day, d.a.length, d.b.length])).toEqual([["2026-10-03", 1, 1], ["2026-10-10", 0, 1]]);
  });
});

describe("Aufgaben", () => {
  const base: TaskEntry = { title: "Übung", source: "paar", forWhom: "beide", repeat: "einmal" };
  it("einmalig: offen, überfällig, erledigt", () => {
    expect(taskState({ ...base, due: "2026-10-30" }, "2026-10-24").label).toBe("offen");
    expect(taskState({ ...base, due: "2026-10-20" }, "2026-10-24").label).toBe("überfällig");
    expect(taskState({ ...base, done: true }, "2026-10-24")).toMatchObject({ open: false, label: "erledigt" });
  });
  it("täglich: heute abgehakt, Serie, letzte 7 Tage", () => {
    const st = taskState({ ...base, repeat: "taeglich", checks: ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"] }, "2026-10-24");
    expect(st).toMatchObject({ open: false, doneNow: true, streak: 4 });
    expect(st.last7.filter((d) => d.done).length).toBe(4);
    expect(taskState({ ...base, repeat: "taeglich", checks: ["2026-10-22", "2026-10-23"] }, "2026-10-24")).toMatchObject({ open: true, streak: 2, label: "heute noch offen" });
  });
  it("wöchentlich: diese Woche erledigt", () => {
    expect(taskState({ ...base, repeat: "woechentlich", checks: ["2026-10-20"] }, "2026-10-24")).toMatchObject({ open: false, label: "diese Woche erledigt" });
    expect(taskState({ ...base, repeat: "woechentlich", checks: ["2026-10-17"] }, "2026-10-24")).toMatchObject({ open: true });
  });
});

describe("ADHS-Tagebuch", () => {
  const e = (day: string, doseMg: number, focus: number, extra: Partial<DiaryEntry> = {}): DiaryEntry => ({ day, med: "Testmittel", doseMg, focus: focus as 1, mood: 3, ...extra });
  const list = [
    e("2026-10-27", 10, 2, { pulse: 72, weightKg: 82, sideEffects: ["Kopfschmerzen"] }),
    e("2026-10-28", 10, 3, { sideEffects: ["Kopfschmerzen", "wenig Appetit"] }),
    e("2026-11-03", 20, 4, { pulse: 80, bpSys: 128, bpDia: 82, weightKg: 81.2 }),
    e("2026-11-04", 20, 4),
  ];
  it("Bericht: Dosis-Phasen, Mittelwerte, Nebenwirkungen, Gewicht", () => {
    const r = diaryReport(list, "2026-10-26", "2026-11-04");
    expect(r.days).toBe(4);
    expect(r.phases.map((p) => [p.doseMg, p.days, p.focus, p.sideEffects])).toEqual([[10, 2, 2.5, 3], [20, 2, 4, 0]]);
    expect(r.averages.focus).toBe(3.3);
    expect(r.averages.pulse).toBe(76);
    expect(r.sideEffects).toEqual([{ name: "Kopfschmerzen", count: 2 }, { name: "wenig Appetit", count: 1 }]);
    expect(r.weightChange).toBe(-0.8);
    expect(r.vitals.find((v) => v.day === "2026-11-03")?.bp).toBe("128/82");
  });
  it("Bericht ohne Messwerte: Puls, Blutdruck, Gewicht nirgends enthalten (Prüfrunde 3)", () => {
    const r = diaryReport(list, "2026-10-26", "2026-11-04", { vitals: false });
    expect("pulse" in r.averages).toBe(false);
    expect(r.averages.focus).toBe(3.3);
    expect(r.vitals).toEqual([]);
    expect(r.weightChange).toBeNull();
    expect(r.entries.some((e) => e.pulse !== undefined || e.bpSys !== undefined || e.bpDia !== undefined || e.weightKg !== undefined)).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/pulse|bpSys|bpDia|weightKg|128\/82/);
  });
  it("Verlauf: fehlende Tage leer", () => {
    const s = diarySeries(list, "focus", "2026-11-04", 10);
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({ day: "2026-10-26", value: null, doseMg: null });
    expect(s[9]).toEqual({ day: "2026-11-04", value: 4, doseMg: 20 });
  });
  it("Eingaben prüfen", () => {
    expect(rating("4")).toBe(4);
    expect(rating("6")).toBeUndefined();
    expect(num("72,5", 30, 220)).toBe(72.5);
    expect(num("", 0, 10)).toBeUndefined();
    expect(num("999", 0, 10)).toBeUndefined();
  });
});

describe("Seit der letzten Sitzung", () => {
  it("zählt Nähe, Kinderzeit und Aufgaben ab dem Termin", () => {
    const r = sinceSummary({
      since: "2026-10-10",
      today: "2026-10-24",
      intim: [{ day: "2026-10-09" }, { day: "2026-10-12" }, { day: "2026-10-20" }],
      dates: [{ day: "2026-10-05" }, { day: "2026-10-17", hours: 3 }],
      sleep: [{ day: "2026-10-11", person: "a", hours: 2 }, { day: "2026-10-18", person: "b", from: "06:30", to: "09:00" }, { day: "2026-10-25", person: "a", hours: 1 }],
      kids: [{ day: "2026-10-11", person: "a", hours: 2 }, { day: "2026-10-15", person: "b", from: "10:00", to: "11:30" }],
      tasks: [
        { title: "x", source: "paar", forWhom: "beide", repeat: "einmal", done: true, doneAt: "2026-10-15" },
        { title: "y", source: "paar", forWhom: "beide", repeat: "taeglich", checks: ["2026-10-24"] },
        { title: "z", source: "ads", forWhom: "a", repeat: "einmal" },
      ],
    });
    expect(r).toMatchObject({ days: 14, intim: 2, dates: 1, sleepIn: { a: 1, b: 1 }, kidsHours: { a: 2, b: 1.5 }, tasksDone: 2, tasksOpen: 1 });
  });
});

describe("memberLabels / partnerHolders (Prüfrunde 3)", () => {
  const members = [
    { userId: "u1", name: "Ludwig", login: "ludwig" },
    { userId: "u2", name: "Ludwig Grunert", login: "lg@example.com" },
    { userId: "u3", name: "Alexandra", login: "alex" },
    { userId: "u4", name: null, login: "gast" },
  ];
  it("ähnliche Namen bekommen die Anmeldung als Zusatz, andere nicht", () => {
    const l = memberLabels(members);
    expect(l.get("u1")).toBe("Ludwig (Anmeldung: ludwig)");
    expect(l.get("u2")).toBe("Ludwig Grunert (Anmeldung: lg@example.com)");
    expect(l.get("u3")).toBe("Alexandra");
    expect(l.get("u4")).toBe("gast");
    expect(new Set(l.values()).size).toBe(4);
  });
  it("gleiche Namen bleiben getrennt", () => {
    const l = memberLabels([{ userId: "x", name: "Ludwig", login: "a" }, { userId: "y", name: "ludwig ", login: "b" }]);
    expect(l.get("x")).not.toBe(l.get("y"));
  });
  it("vergebene Partner-Rolle eines anderen Kontos wird gemeldet, die eigene nicht", () => {
    const up = { u1: "a" as const, u3: "b" as const };
    expect(partnerHolders(up, members, "u2")).toEqual({ a: "Ludwig (Anmeldung: ludwig)", b: "Alexandra" });
    expect(partnerHolders(up, members, "u1")).toEqual({ b: "Alexandra" });
    // Konto ohne Privat-Zugang (nicht in members) zählt nicht
    expect(partnerHolders({ alt: "a" }, members, "u2")).toEqual({});
  });
});

describe("Zuletzt / Wechsel nur aus Stattgefundenem bis heute", () => {
  it("geplante und künftige Einträge zählen nicht als „zuletzt“", () => {
    const all = [
      { day: "2026-10-20", person: "a" as const, status: "stattgefunden" as const },
      { day: "2026-10-25", person: "b" as const },
      { day: "2026-11-02", person: "b" as const, status: "geplant" as const },
      { day: "2026-11-03", person: "a" as const },
    ];
    expect(lastTaken(all, "2026-10-27")?.day).toBe("2026-10-25");
    expect(nextSleeper(all, "2026-10-27")).toBe("a");
    // Ohne Datum (alte Aufrufe mit Monat): keine Begrenzung nach heute.
    expect(lastTaken(all, "2026-10")?.day).toBe("2026-11-03");
    expect(lastTaken([{ day: "2026-11-02", person: "b" as const, status: "geplant" as const }], "2026-10-27")).toBeNull();
  });
});

describe("Verknüpfte Auszeit/Kinderzeit prüfen", () => {
  const names = { a: "Anna", b: "Ben" };
  const az = (person: "a" | "b", extra: Record<string, unknown> = {}) => ({ id: "az1", data: { day: "2026-10-28", from: "18:00", to: "21:00", status: "geplant" as const, person, linkId: "L1", ...extra } });
  const kz = (person: "a" | "b" | "beide", extra: Record<string, unknown> = {}) => ({ id: "kz1", data: { day: "2026-10-28", from: "18:00", to: "21:00", status: "geplant" as const, person, linkId: "L1", ...extra } });

  it("stimmig: keine Meldung", () => {
    expect(linkIssues([az("b")], [kz("a")], names)).toEqual([]);
  });

  it("beide Seiten bei derselben Person: zwei Varianten, zuletzt bearbeitete Seite zuerst", () => {
    const [i] = linkIssues([az("a", { editedAt: "2026-10-27T10:00:00Z" })], [kz("a", { editedAt: "2026-10-20T10:00:00Z" })], names);
    expect(i.key).toBe("L1:person");
    expect(i.text).toContain("beide bei Anna");
    expect(i.fixes.map((f) => f.label)).toEqual(["Auszeit Anna, Kinder bei Ben", "Auszeit Ben, Kinder bei Anna"]);
    expect(i.fixes[0].changes).toEqual([{ id: "kz1", kind: "kinder", data: expect.objectContaining({ person: "b", linkId: "L1", from: "18:00" }) }]);
    expect(i.fixes[1].changes[0]).toMatchObject({ id: "az1", kind: "auszeit", data: { person: "b" } });
    const [j] = linkIssues([az("a", { editedAt: "2026-10-20T10:00:00Z" })], [kz("a", { editedAt: "2026-10-27T10:00:00Z" })], names);
    expect(j.fixes[0].label).toBe("Auszeit Ben, Kinder bei Anna");
  });

  it("abweichende Zeit oder Planung", () => {
    const [i] = linkIssues([az("b", { to: "22:00" })], [kz("a", { status: "stattgefunden" })], names);
    expect(i.key).toBe("L1:zeit");
    expect(i.fixes).toHaveLength(2);
    expect(i.fixes.some((f) => f.changes[0].kind === "kinder" && f.changes[0].data.to === "22:00" && f.changes[0].data.status === "geplant")).toBe(true);
  });

  it("Partner fehlt, „beide zusammen“ verknüpft, mehrfach verknüpft", () => {
    const [alone] = linkIssues([az("b")], [], names);
    expect(alone.key).toBe("L1:allein");
    expect(alone.fixes[0].changes[0].data).not.toHaveProperty("linkId");
    const [both] = linkIssues([az("b")], [kz("beide")], names);
    expect(both.key).toBe("L1:beide");
    expect(both.fixes[0].changes.every((c) => !("linkId" in c.data))).toBe(true);
    const [many] = linkIssues([az("b"), { ...az("a"), id: "az2" }], [kz("a")], names);
    expect(many.key).toBe("L1:mehrfach");
    expect(many.fixes).toEqual([]);
  });
});
