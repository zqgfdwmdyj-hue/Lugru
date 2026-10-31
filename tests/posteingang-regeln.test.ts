import { describe, expect, it } from "vitest";
import { classifyMail, mailVorschlag, regelFuer, type MailRegel } from "@/lib/inbox/classify";

// Erfundene Absender und Mails.
const T = new Date("2026-10-30T10:00:00Z");

describe("Posteingang auf null – Einstufung", () => {
  it("Zahlung abgelehnt in EU-Sprachen, Konto gesperrt, Behörde → wichtig", () => {
    const ita = classifyMail({ from: "Billing <billing@marketplace.example>", subject: "Pagamento rifiutato", body: "Il pagamento è stato rifiutato." }, T);
    expect(ita.category).toBe("critical");
    const fr = classifyMail({ from: "Abo <noreply@saas.example>", subject: "Paiement refusé pour votre abonnement", body: "" }, T);
    expect(fr).toMatchObject({ relevant: true, category: "critical" });
    expect(classifyMail({ from: "PayDienst <service@pay.example>", subject: "Ihr Konto wurde eingeschränkt", body: "" }, T)).toMatchObject({ relevant: true, category: "critical", topic: "account_health" });
    expect(classifyMail({ from: "Finanzamt <post@finanzamt.example>", subject: "Bescheid über Umsatzsteuer – Frist 14 Tage", body: "" }, T)).toMatchObject({ relevant: true, category: "critical", topic: "behoerde" });
  });
  it("Antwort eines bekannten Lieferanten ist wichtig, unbekannter Absender bleibt draußen", () => {
    const m = { from: "Vertrieb <sales@grosshandel.example>", subject: "AW: Anfrage Preisliste Q4", body: "Anbei unsere Preise." };
    expect(classifyMail(m, T, { lieferant: true })).toMatchObject({ relevant: true, category: "critical", topic: "lieferant_antwort" });
    expect(classifyMail({ ...m, subject: "Neue Aktion" }, T, { lieferant: true })).toMatchObject({ category: "action", topic: "lieferant_antwort" });
    expect(classifyMail(m, T).relevant).toBe(false);
  });
});

describe("Posteingang auf null – Regeln und Vorschlag", () => {
  const regeln: MailRegel[] = [
    { id: "r0", absender: null, betreff: null, thema: null, aktion: "archivieren", aktiv: true },
    { id: "r1", absender: "@newsletter.example", betreff: null, thema: null, aktion: "archivieren", aktiv: true },
    { id: "r2", absender: null, betreff: "rechnung", thema: "other", aktion: "weiterleiten", aktiv: true },
    { id: "r3", absender: "@aus.example", betreff: null, thema: null, aktion: "aufgabe", aktiv: false },
  ];
  it("erste passende aktive Regel; leere Regeln und inaktive zählen nicht", () => {
    expect(regelFuer({ from: "Info <info@newsletter.example>", subject: "Neu", topic: "marketing" }, regeln)?.id).toBe("r1");
    expect(regelFuer({ from: "x@y.example", subject: "Ihre Rechnung 123", topic: "other" }, regeln)?.id).toBe("r2");
    expect(regelFuer({ from: "x@y.example", subject: "Ihre Rechnung 123", topic: "payout_info" }, regeln)).toBeNull();
    expect(regelFuer({ from: "a@aus.example", subject: "Hallo", topic: null }, regeln)).toBeNull();
  });
  it("Vorschlag je Mail", () => {
    expect(mailVorschlag({ category: "noise", topic: "marketing", archived: false })).toBe("archivieren");
    expect(mailVorschlag({ category: "critical", topic: "payment_problem", archived: false })).toBe("aufgabe");
    expect(mailVorschlag({ category: "action", topic: "buyer_message", archived: false })).toBe("antworten");
    expect(mailVorschlag({ category: "critical", topic: "lieferant_antwort", archived: false })).toBe("antworten");
    expect(mailVorschlag({ category: "action", topic: "other", archived: false, regelAktion: "weiterleiten" })).toBe("weiterleiten");
    expect(mailVorschlag({ category: "critical", topic: "other", archived: true })).toBe("erledigt");
  });
});
