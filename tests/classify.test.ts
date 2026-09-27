import { describe, expect, it } from "vitest";
import { classifyMail, extractDeadlineDays, extractReferences } from "@/lib/inbox/classify";

const amazon = "Amazon Seller Central <seller-notification@amazon.de>";

describe("classifyMail", () => {
  it.each([
    [amazon, "Wichtig: Ihr Verkäuferkonto – Handlungsbedarf beim Kontozustand", "critical", "account_health"],
    [amazon, "Angebot deaktiviert: Rechnungen anfordern für ASIN B0TEST0001", "critical", "listing_blocked"],
    [amazon, "Ihre Auszahlung wurde zurückgehalten", "critical", "payment_hold"],
    [amazon, "Neuer A-bis-z-Garantieantrag für Bestellung 302-1234567-1234567", "action", "a_to_z"],
    ["eBay <ebay@ebay.de>", "Ein Käufer hat einen Fall eröffnet: Artikel nicht erhalten", "action", "ebay_case"],
    ["Kunde <abc@marketplace.amazon.de>", "Frage zum Artikel", "action", "buyer_message"],
    [amazon, "Problem mit Ihrer Sendung FBA15ABCDEFG – Abweichung beim Wareneingang", "action", "inbound_problem"],
    [amazon, "Ihre Auszahlung ist unterwegs", "info", "payout_info"],
    [amazon, "Verkauft, jetzt versenden: Bestellung 302-1234567-1234567", "info", "order_info"],
    [amazon, "Seller University: Webinar zum Prime Day", "noise", "marketing"],
  ])("%s / %s → %s", (from, subject, category, topic) => {
    const c = classifyMail({ from, subject, body: "" });
    expect([c.category, c.topic]).toEqual([category, topic]);
  });

  it("ignoriert Mails ohne Marktplatz-Absender", () => {
    expect(classifyMail({ from: "freund@web.de", subject: "Kontozustand", body: "" }).relevant).toBe(false);
  });

  it("findet Referenzen", () => {
    expect(extractReferences("Bestellung 302-1234567-7654321, ASIN B0TEST0001, Fall-ID: 12345678901, Sendung FBA15ABCDEFG")).toEqual({
      amazonOrder: "302-1234567-7654321",
      asin: "B0TEST0001",
      caseId: "12345678901",
      fbaShipment: "FBA15ABCDEFG",
    });
  });

  it("liest Fristen aus dem Text", () => {
    const today = new Date("2026-09-27T00:00:00Z");
    expect(extractDeadlineDays("Bitte antworten Sie innerhalb von 3 Tagen", today)).toBe(3);
    expect(extractDeadlineDays("bis zum 30.09.2026 einreichen", today)).toBe(3);
  });
});
