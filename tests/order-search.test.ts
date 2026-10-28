import { describe, expect, it } from "vitest";
import { orderMatches } from "@/lib/orders/search-logic";

// Auftragssuche – erfundene Kunden.
const o = { externalId: "399-0000001-0000001", name1: "Jörg Weißmüller", name2: "c/o Testfirma", street: "Musterstr.", zip: "12345", city: "Musterstadt", items: "E2E-SKU Testsocken Größe:L" };

describe("Auftragssuche", () => {
  it("Name ohne Umlaute/ß, Groß-/Kleinschreibung egal, Teilwörter", () => {
    expect(orderMatches(o, "jorg weiss")).toBe(true);
    expect(orderMatches(o, "Weißmüller")).toBe(true);
    expect(orderMatches(o, "WEISSMULLER")).toBe(true);
    expect(orderMatches(o, "weissmueller")).toBe(true);
    expect(orderMatches(o, "joerg")).toBe(true);
  });
  it("alle Wörter müssen passen", () => {
    expect(orderMatches(o, "jörg musterstadt")).toBe(true);
    expect(orderMatches(o, "jörg berlin")).toBe(false);
  });
  it("Bestellnummer, PLZ, Artikel", () => {
    expect(orderMatches(o, "0000001-0000001")).toBe(true);
    expect(orderMatches(o, "12345")).toBe(true);
    expect(orderMatches(o, "testsocken")).toBe(true);
    expect(orderMatches(o, "")).toBe(false);
  });
});
