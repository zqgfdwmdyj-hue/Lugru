import { describe, expect, it } from "vitest";
import { ohneMeldung } from "@/lib/orders/bestaetigung-logic";
import { MELDUNG_MAX_VERSUCHE, meldungNachholen, temuSendungsnummer, untrackedPost } from "@/lib/orders/tracking";

// Wunsch 14.11.: Temu wie eBay automatisch melden (auch Briefsendungen), offene Meldungen automatisch nachholen.

const jetzt = new Date("2026-11-14T12:00:00Z");
const offen = { channel: "temu", fulfillment: "FBM", status: "shipped", shippedAt: new Date("2026-11-13T12:00:00Z"), trackingUploadedAt: null, trackingUploadManuell: false, trackingUploadError: "Testfehler", trackingUploadVersuche: 1 };

describe("Versandmeldung – Warensendung ohne Sendungsverfolgung", () => {
  it("Amazon, eBay und Temu melden auch ohne Nummer (Deutsche Post), andere Kanäle nicht", () => {
    for (const channel of ["amazon", "ebay", "temu"]) expect(untrackedPost({ channel, carrier: "Deutsche Post", trackingNumber: null, status: "shipped" }), channel).toBe(true);
    expect(untrackedPost({ channel: "kleinanzeigen", carrier: "Deutsche Post", trackingNumber: null, status: "shipped" })).toBe(false);
    expect(untrackedPost({ channel: "temu", carrier: "DHL", trackingNumber: null, status: "shipped" })).toBe(false);
  });
  it("Temu: eigene Nummer vor Frankier-ID; Frankier-ID nur bei Deutsche Post; sonst keine Nummer", () => {
    expect(temuSendungsnummer({ trackingNumber: " 00340434TEST1 ", carrier: "DHL" }, "A0TEST")).toBe("00340434TEST1");
    expect(temuSendungsnummer({ trackingNumber: null, carrier: "Deutsche Post" }, "A0TEST01")).toBe("A0TEST01");
    expect(temuSendungsnummer({ trackingNumber: null, carrier: "DHL" }, "A0TEST01")).toBeNull();
    expect(temuSendungsnummer({ trackingNumber: null, carrier: "Deutsche Post" }, null)).toBeNull();
  });
});

describe("Versandmeldung – automatisch nachholen", () => {
  it("offene Meldung der letzten 14 Tage mit Fehler → ja", () => {
    expect(meldungNachholen(offen, ohneMeldung, jetzt)).toBe(true);
    expect(meldungNachholen({ ...offen, status: "delivered" }, ohneMeldung, jetzt)).toBe(true);
  });
  it("nicht bei: schon gemeldet, von Hand geschlossen, ohne Fehler, ohne Kanal, zu viele Versuche, zu alt, nicht versendet, FBA", () => {
    expect(meldungNachholen({ ...offen, trackingUploadedAt: jetzt }, ohneMeldung, jetzt)).toBe(false);
    expect(meldungNachholen({ ...offen, trackingUploadManuell: true }, ohneMeldung, jetzt)).toBe(false);
    expect(meldungNachholen({ ...offen, trackingUploadError: null }, ohneMeldung, jetzt)).toBe(false);
    expect(meldungNachholen({ ...offen, channel: "whatsapp" }, ohneMeldung, jetzt)).toBe(false);
    expect(meldungNachholen({ ...offen, trackingUploadVersuche: MELDUNG_MAX_VERSUCHE }, ohneMeldung, jetzt)).toBe(false);
    expect(meldungNachholen({ ...offen, shippedAt: new Date("2026-10-30T12:00:00Z") }, ohneMeldung, jetzt)).toBe(false);
    expect(meldungNachholen({ ...offen, status: "label_created" }, ohneMeldung, jetzt)).toBe(false);
    expect(meldungNachholen({ ...offen, fulfillment: "FBA" }, ohneMeldung, jetzt)).toBe(false);
  });
});
