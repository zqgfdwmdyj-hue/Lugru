import { describe, expect, it } from "vitest";
import { bucketOf, freshness, groupOf, planDay, type TaskLite } from "@/lib/today/logic";

// Tagesübersicht: Zeitfenster, Priorität, Bündelung. Fiktive Aufgaben.

const TODAY = "2026-10-24";
let n = 0;
const task = (p: Partial<TaskLite>): TaskLite => ({ id: `t${++n}`, title: `Aufgabe ${n}`, notes: null, dueDate: null, priority: "normal", category: "eigene", systemKey: null, link: null, createdAt: new Date("2026-10-01"), ...p });

describe("Zeitfenster", () => {
  it("überfällig, heute, diese Woche, später, ohne Datum", () => {
    expect(bucketOf({ dueDate: "2026-10-23" }, TODAY)).toBe("ueberfaellig");
    expect(bucketOf({ dueDate: TODAY }, TODAY)).toBe("heute");
    expect(bucketOf({ dueDate: "2026-10-31" }, TODAY)).toBe("woche");
    expect(bucketOf({ dueDate: "2026-11-01" }, TODAY)).toBe("spaeter");
    expect(bucketOf({ dueDate: null }, TODAY)).toBe("ohne");
  });
});

describe("Bündelung", () => {
  it("gleichartige automatische Aufgaben werden zu Arbeitsvorräten, einzelne bleiben einzeln", () => {
    expect(groupOf({ systemKey: "lead-followup:123", category: "einkauf" })?.label).toBe("Lieferanten nachfassen");
    expect(groupOf({ systemKey: null, category: "eigene" })).toBeNull();
    const tasks = [
      ...Array.from({ length: 30 }, (_, i) => task({ systemKey: `lead-followup:${i}`, category: "einkauf", dueDate: i < 3 ? "2026-10-20" : "2026-10-28", link: `/board?lead=${i}` })),
      task({ systemKey: "removal-receipts:1", dueDate: TODAY }),
      task({ title: "Steuerberater anrufen", dueDate: TODAY, category: "geld" }),
    ];
    const p = planDay(tasks, TODAY);
    expect(p.bundles).toHaveLength(1);
    expect(p.bundles[0].label).toBe("Lieferanten nachfassen");
    expect(p.bundles[0].tasks).toHaveLength(30);
    expect(p.bundles[0].overdue).toBe(3);
    expect(p.bundles[0].href).toBe("/board");
    // Eine einzelne Remission bleibt eine Aufgabe (kein Vorrat aus 1).
    expect(p.top.map((t) => t.title)).toContain("Steuerberater anrufen");
    expect(p.top.some((t) => t.systemKey === "removal-receipts:1")).toBe(true);
    expect(p.counts.ueberfaellig).toBe(3);
  });
  it("Ideen (Marken) landen eingeklappt, nicht in den wichtigsten", () => {
    const p = planDay([task({ category: "marken", dueDate: TODAY }), task({ systemKey: "research-new:1", dueDate: TODAY })], TODAY);
    expect(p.ideas).toHaveLength(2);
    expect(p.top).toHaveLength(0);
  });
});

describe("Priorität", () => {
  it("kritisch zuerst und separat, höchstens 8 wichtigste, überfällig vor heute vor Woche", () => {
    const tasks = [
      task({ title: "kritisch", priority: "critical" }),
      ...Array.from({ length: 12 }, (_, i) => task({ title: `w${i}`, dueDate: "2026-10-29" })),
      task({ title: "heute", dueDate: TODAY }),
      task({ title: "überfällig", dueDate: "2026-10-10" }),
      task({ title: "später", dueDate: "2026-12-01" }),
      task({ title: "ohne" }),
    ];
    const p = planDay(tasks, TODAY);
    expect(p.critical.map((t) => t.title)).toEqual(["kritisch"]);
    expect(p.top).toHaveLength(8);
    expect(p.top[0].title).toBe("überfällig");
    expect(p.top[1].title).toBe("heute");
    expect(p.later.map((t) => t.title)).toContain("später");
    expect(p.later.map((t) => t.title)).toContain("w8");
    expect(p.noDate.map((t) => t.title)).toEqual(["ohne"]);
  });
  it("Versand und Geld vor Marken bei gleicher Fälligkeit", () => {
    const p = planDay([task({ title: "eigene", dueDate: TODAY, category: "eigene" }), task({ title: "versand", dueDate: TODAY, category: "versand" })], TODAY);
    expect(p.top[0].title).toBe("versand");
  });
});

describe("Datenstand", () => {
  it("fehlt, veraltet, aktuell", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const f = freshness(
      [
        { key: "a", label: "Bestand", last: null, maxAgeDays: 2, href: "/import" },
        { key: "b", label: "Abrechnung", last: new Date("2026-09-28T10:00:00Z"), maxAgeDays: 16, href: "/import" },
        { key: "c", label: "Ledger", last: new Date("2026-10-23T10:00:00Z"), maxAgeDays: 7, href: "/import" },
      ],
      now,
    );
    expect(f.map((x) => [x.missing, x.stale])).toEqual([[true, false], [false, true], [false, false]]);
  });
});
