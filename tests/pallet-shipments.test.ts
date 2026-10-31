import { describe, expect, it } from "vitest";
import {
  carrierLabel,
  cleanTrackingNo,
  delayDays,
  groupShipments,
  isOverdue,
  linkExpiry,
  linkState,
  loadText,
  parseDhlTracking,
  publicTimeline,
  safeUrl,
  shiftText,
  statusAfterShift,
  statusLabel,
  trackingLink,
  trackingUpdate,
} from "@/lib/pallets/shipments";

// Speditions-Sendungen im Palettenlager – alle Nummern und Namen erfunden.

describe("Spediteure und Verfolgungs-Links", () => {
  it("Paketdienste mit fertigem Link, Nummer wird kodiert", () => {
    expect(trackingLink({ carrier: "dhl", trackingNo: "00340434000000000001" })).toBe("https://www.dhl.com/de-de/home/tracking.html?tracking-id=00340434000000000001&submit=1");
    expect(trackingLink({ carrier: "dpd", trackingNo: "0123 4567" })).toBe("https://tracking.dpd.de/status/de_DE/parcel/0123%204567");
    expect(trackingLink({ carrier: "ups", trackingNo: "1ZTEST" })).toContain("tracknum=1ZTEST");
  });
  it("Speditionen ohne festes Format: nur mit eigenem Link", () => {
    expect(trackingLink({ carrier: "dachser", trackingNo: "12345" })).toBeNull();
    expect(trackingLink({ carrier: "dachser", trackingNo: "12345", trackingUrl: "https://spedition.example/track?id=12345" })).toBe("https://spedition.example/track?id=12345");
  });
  it("eigener Link schlägt Standard-Link; nur http(s)", () => {
    expect(trackingLink({ carrier: "dhl", trackingNo: "1", trackingUrl: "https://example.org/x" })).toBe("https://example.org/x");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://a b.de")).toBeNull();
    expect(safeUrl("ftp://example.org")).toBeNull();
  });
  it("Name bei „andere“, Nummer ohne Leerzeichen", () => {
    expect(carrierLabel("andere", "Spedition Muster")).toBe("Spedition Muster");
    expect(carrierLabel("andere", "")).toBe("Andere Spedition");
    expect(carrierLabel("schenker")).toBe("DB Schenker / DSV");
    expect(cleanTrackingNo(" 1234 5678 90 ")).toBe("1234567890");
    expect(cleanTrackingNo("   ")).toBeNull();
  });
});

describe("Termin und Status", () => {
  it("Verschiebung als Text mit Tagen und Grund", () => {
    expect(shiftText("2026-10-28", "2026-10-30", "Stau")).toBe("Termin verschoben: 28.10. → 30.10.2026 (+2 Tage) – Stau");
    expect(shiftText("2026-10-30", "2026-10-29")).toBe("Termin verschoben: 30.10. → 29.10.2026 (−1 Tag)");
    expect(shiftText(null, "2026-11-02")).toBe("Termin: 02.11.2026");
    expect(shiftText("2026-11-02", null)).toBe("Termin offen (war 02.11.2026)");
  });
  it("später → verzögert; früher, schon da oder Problem → unverändert", () => {
    expect(statusAfterShift("geplant", "2026-10-28", "2026-10-30")).toBe("verzoegert");
    expect(statusAfterShift("unterwegs", "2026-10-28", "2026-10-30")).toBe("verzoegert");
    expect(statusAfterShift("geplant", "2026-10-30", "2026-10-28")).toBe("geplant");
    expect(statusAfterShift("zugestellt", "2026-10-28", "2026-10-30")).toBe("zugestellt");
    expect(statusAfterShift("problem", "2026-10-28", "2026-10-30")).toBe("problem");
    expect(statusAfterShift("geplant", null, "2026-10-30")).toBe("geplant");
  });
  it("Bezeichnung je Richtung, Verspätung, überfällig", () => {
    expect(statusLabel("zugestellt", "ein")).toBe("angekommen");
    expect(statusLabel("zugestellt", "aus")).toBe("zugestellt");
    expect(delayDays({ firstDate: "2026-10-28", plannedDate: "2026-10-31" })).toBe(3);
    expect(delayDays({ firstDate: "2026-10-28", plannedDate: "2026-10-27" })).toBe(0);
    expect(isOverdue({ status: "geplant", plannedDate: "2026-10-27" }, "2026-10-28")).toBe(true);
    expect(isOverdue({ status: "zugestellt", plannedDate: "2026-10-27" }, "2026-10-28")).toBe(false);
    expect(isOverdue({ status: "geplant", plannedDate: null }, "2026-10-28")).toBe(false);
    expect(loadText({ palletCount: 3, cartonCount: 1 })).toBe("3 Paletten · 1 Karton");
  });
  it("Übersicht: überfällig, heute, 7 Tage, später, erledigt", () => {
    const r = (id: string, plannedDate: string | null, status: "geplant" | "zugestellt" = "geplant") => ({ id, plannedDate, status, direction: "ein" as const });
    const g = groupShipments([r("a", "2026-10-26"), r("b", "2026-10-28"), r("c", "2026-11-03"), r("d", "2026-11-20"), r("e", null), r("f", "2026-10-20", "zugestellt")], "2026-10-28");
    expect([g.overdue, g.today, g.soon, g.later, g.done].map((x) => x.map((y) => y.id))).toEqual([["a"], ["b"], ["c"], ["d", "e"], ["f"]]);
  });
});

describe("DHL-Sendungsverfolgung", () => {
  const json = (statusCode: string, extra: Record<string, unknown> = {}) => ({
    shipments: [{ id: "00340434000000000001", status: { statusCode, status: statusCode.toUpperCase(), description: "Die Sendung wurde im Paketzentrum bearbeitet.", timestamp: "2026-10-28T09:15:00+01:00", location: { address: { addressLocality: "Testhausen" } } }, ...extra }],
  });
  it("liest Status, Ort und Liefertag (deutsche Zeit)", () => {
    expect(parseDhlTracking(json("transit", { estimatedTimeOfDelivery: "2026-10-29T23:30:00Z" }))).toEqual({ code: "transit", text: "Die Sendung wurde im Paketzentrum bearbeitet.", place: "Testhausen", at: "2026-10-28T09:15:00+01:00", eta: "2026-10-30" });
    expect(parseDhlTracking({})).toBeNull();
    expect(parseDhlTracking(json("seltsam"))?.code).toBe("unknown");
  });
  it("unterwegs: Ort + Status, keine Meldung an alle", () => {
    const u = trackingUpdate({ status: "geplant", location: null, plannedDate: "2026-10-29", direction: "ein" }, parseDhlTracking(json("transit"))!);
    expect(u.status).toBe("unterwegs");
    expect(u.location).toBe("Die Sendung wurde im Paketzentrum bearbeitet. (Testhausen)");
    expect(u.events).toHaveLength(1);
    expect(u.events[0].notice).toBe(false);
  });
  it("gleicher Stand → keine neuen Einträge", () => {
    const t = parseDhlTracking(json("transit"))!;
    const u = trackingUpdate({ status: "unterwegs", location: "Die Sendung wurde im Paketzentrum bearbeitet. (Testhausen)", plannedDate: "2026-10-29", direction: "ein" }, t);
    expect(u).toEqual({ events: [] });
  });
  it("neuer Liefertag laut DHL → verschoben + Meldung", () => {
    const u = trackingUpdate({ status: "unterwegs", location: "Die Sendung wurde im Paketzentrum bearbeitet. (Testhausen)", plannedDate: "2026-10-29", direction: "ein" }, parseDhlTracking(json("transit", { estimatedTimeOfDelivery: "2026-10-31T10:00:00Z" }))!);
    expect(u.plannedDate).toBe("2026-10-31");
    expect(u.status).toBe("verzoegert");
    expect(u.events).toEqual([expect.objectContaining({ kind: "termin", notice: true, oldDate: "2026-10-29", newDate: "2026-10-31", text: "Termin verschoben: 29.10. → 31.10.2026 (+2 Tage) – laut DHL" })]);
  });
  it("zugestellt und Problem sind Meldungen; Erledigtes bleibt unberührt", () => {
    const d = trackingUpdate({ status: "unterwegs", location: null, plannedDate: "2026-10-28", direction: "ein" }, parseDhlTracking(json("delivered"))!);
    expect(d.status).toBe("zugestellt");
    expect(d.deliveredAt?.toISOString()).toBe("2026-10-28T08:15:00.000Z");
    expect(d.events[0]).toMatchObject({ notice: true, text: expect.stringContaining("DHL: angekommen") });
    expect(trackingUpdate({ status: "unterwegs", location: null, plannedDate: null, direction: "aus" }, parseDhlTracking(json("failure"))!).status).toBe("problem");
    expect(trackingUpdate({ status: "zugestellt", location: null, plannedDate: null, direction: "aus" }, parseDhlTracking(json("failure"))!)).toEqual({ events: [] });
  });
});

describe("Kunden-Link", () => {
  it("Gültigkeit bis Tagesende, begrenzt auf 1–60 Tage", () => {
    const now = new Date("2026-10-28T10:00:00Z");
    expect(linkExpiry(7, now).toISOString()).toBe("2026-11-04T23:59:00.000Z");
    expect(linkExpiry(500, now).toISOString()).toBe("2026-12-27T23:59:00.000Z");
    expect(linkExpiry(0, now).toISOString()).toBe("2026-11-04T23:59:00.000Z");
  });
  it("aktiv, abgelaufen, zurückgezogen", () => {
    const now = new Date("2026-10-28T10:00:00Z");
    expect(linkState({ expiresAt: new Date("2026-10-29T00:00:00Z"), revokedAt: null }, now)).toBe("aktiv");
    expect(linkState({ expiresAt: new Date("2026-10-27T00:00:00Z"), revokedAt: null }, now)).toBe("abgelaufen");
    expect(linkState({ expiresAt: new Date("2026-10-29T00:00:00Z"), revokedAt: now }, now)).toBe("widerrufen");
  });
  it("Kunde sieht keine internen Einträge und keine Namen", () => {
    const at = new Date("2026-10-28T10:00:00Z");
    const tl = publicTimeline([
      { kind: "angelegt", text: "Versand angelegt", internal: false, createdAt: at, userName: "Erika" },
      { kind: "notiz", text: "Kunde zahlt spät", internal: true, createdAt: at, userName: "Erika" },
    ]);
    expect(tl).toEqual([{ at, text: "Versand angelegt" }]);
    expect(JSON.stringify(tl)).not.toContain("Erika");
  });
});
