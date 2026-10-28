import { describe, expect, it } from "vitest";
import { classifyMail, describeRule, extractDeadlineDays, extractReferences, isUncertainRule } from "@/lib/inbox/classify";

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

  it.each([
    [amazon, "Ihre Zahlungsmethode wurde abgelehnt", "payment_problem"],
    [amazon, "Aktion erforderlich: Aktualisieren Sie Ihre Zahlungsinformationen", "payment_problem"],
    [amazon, "Ihr Verkäuferkonto weist einen negativen Saldo auf", "payment_problem"],
    ["eBay <ebay@ebay.de>", "Ihre eBay-Rechnung ist überfällig", "payment_problem"],
    ["eBay <ebay@ebay.de>", "Lastschrift für Ihre Verkäufergebühren fehlgeschlagen", "payment_problem"],
    [amazon, "Ihre Auszahlung konnte nicht durchgeführt werden", "payment_hold"],
    [amazon, "Bankkonto für Auszahlungen ungültig", "payment_hold"],
    ["Amazon <seller@amazon.com>", "Action needed: your payment method was declined", "payment_problem"],
  ])("Zahlungsproblem: %s / %s → kritisch (%s)", (from, subject, topic) => {
    const c = classifyMail({ from, subject, body: "" });
    expect([c.category, c.topic, c.relevant]).toEqual(["critical", topic, true]);
  });
  it("Zahlungsproblem nur im Text → kritisch (unsicher); harmlose Zahlungs-Hinweise bleiben Info", () => {
    const body = classifyMail({ from: amazon, subject: "Wichtige Information zu Ihrem Konto", body: "Leider ist die Zahlung Ihrer Verkäufergebühren fehlgeschlagen. Bitte prüfen Sie Ihre Karte." });
    expect([body.category, body.topic, body.uncertain]).toEqual(["critical", "payment_problem", true]);
    const ok = classifyMail({ from: "eBay <ebay@ebay.de>", subject: "Verkauft – jetzt versenden", body: "Der Käufer hat bezahlt. Zahlung erhalten am 28.10." });
    expect([ok.category, ok.topic]).toEqual(["info", "order_info"]);
    const payout = classifyMail({ from: amazon, subject: "Ihre Auszahlung ist unterwegs", body: "Wir haben 1.234,56 € an Ihre Bank überwiesen." });
    expect(payout.category).toBe("info");
  });
  it("Zahlungsprobleme auch von Bank, PayPal, Hosting – andere Mails dieser Absender nicht", () => {
    const pp = classifyMail({ from: "PayPal <service@paypal.de>", subject: "Ihre Zahlung wurde abgelehnt", body: "" });
    expect([pp.relevant, pp.category, pp.topic, pp.source]).toEqual([true, "critical", "payment_problem", null]);
    const host = classifyMail({ from: "Hoster <billing@hoster.example>", subject: "Zahlungserinnerung zu Rechnung R-2026-10", body: "" });
    expect([host.relevant, host.category]).toEqual([true, "critical"]);
    const news = classifyMail({ from: "PayPal <news@paypal.de>", subject: "Neue Funktionen für Ihr Geschäftskonto", body: "Zahlung fehlgeschlagen? Nicht mit uns." });
    expect(news.relevant).toBe(false);
  });
  it("Letztes Netz: Geld-Wort + Problem-Wort ohne Regel → zu erledigen statt Info", () => {
    const c = classifyMail({ from: amazon, subject: "Hinweis zu Ihrem Verkäuferkonto", body: "Die Gebühren für September sind weiterhin offen." });
    expect([c.category, c.topic, c.uncertain]).toEqual(["action", "payment_problem", true]);
  });

  it("Registrierungsrückfrage ist keine Käufernachricht", () => {
    const c = classifyMail({ from: "Amazon <noreply@marketplace.amazon.de>", subject: "Rückfrage zu Ihrer Registrierung als Verkäufer", body: "" });
    expect([c.topic, c.category, c.uncertain]).toEqual(["registration", "action", false]);
    const v = classifyMail({ from: amazon, subject: "Bitte bestätigen", body: "Wir benötigen weitere Angaben zur Verifizierung Ihrer Identität." });
    expect([v.topic, v.uncertain]).toEqual(["registration", true]);
    expect(isUncertainRule(v.rule)).toBe(true);
  });

  it("eindeutiger Betreff gewinnt gegen Stichwort im Text", () => {
    const c = classifyMail({ from: amazon, subject: "Neuer A-bis-z-Garantieantrag", body: "Der Käufer hat sich verifiziert." });
    expect([c.topic, c.uncertain]).toEqual(["a_to_z", false]);
  });

  it("kennzeichnet unsichere Zuordnungen", () => {
    const fromOnly = classifyMail({ from: "Kunde <abc@marketplace.amazon.de>", subject: "Hallo", body: "" });
    expect([fromOnly.topic, fromOnly.uncertain]).toEqual(["buyer_message", true]);
    expect(describeRule(fromOnly.rule)).toBe("automatisch: Käufernachricht (nur Absender erkannt)");
    const none = classifyMail({ from: amazon, subject: "Hallo", body: "Text" });
    expect([none.topic, none.uncertain, isUncertainRule(none.rule)]).toEqual(["other", true, true]);
    const sure = classifyMail({ from: amazon, subject: "Ihre Auszahlung ist unterwegs", body: "" });
    expect([sure.uncertain, isUncertainRule(sure.rule), describeRule(sure.rule)]).toEqual([false, false, "automatisch: Auszahlung / Abrechnung"]);
    expect(describeRule("von Hand")).toBe("von Hand korrigiert");
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
