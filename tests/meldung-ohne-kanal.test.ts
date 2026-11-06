import { describe, expect, it } from "vitest";
import { ohneMeldung } from "@/lib/orders/bestaetigung-logic";

describe("Meldung offen – Kanäle ohne Plattform (Wunsch 06.11.)", () => {
  it("WhatsApp und von Hand: nichts zu melden; Marktplätze schon", () => {
    expect(ohneMeldung("whatsapp")).toBe(true);
    expect(ohneMeldung("manual")).toBe(true);
    for (const k of ["amazon", "ebay", "temu", "kleinanzeigen", "shop", "b2b"]) expect(ohneMeldung(k)).toBe(false);
  });
});
