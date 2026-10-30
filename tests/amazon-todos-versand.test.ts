import { describe, expect, it } from "vitest";
import { noiseReason, pflichtRegel } from "@/lib/amazon-todos/logic";
import { altToDosSchliessen, bestellMailsAbgleichen, bestellnummernAus, istBestellMail, istFbaVersandMail, kategorieGewicht, sammelWiederOeffnen, ueberfaellig, type AuftragKurz } from "@/lib/amazon-todos/versand";

// Erfundene Bestell-Mails und Aufträge (keine echten Daten).
const NOW = Date.parse("2026-10-30T15:00:00Z");
const H = 3_600_000;
const a = (externalId: string, status: string, o: Partial<AuftragKurz> = {}): AuftragKurz => ({ id: `id-${externalId}`, externalId, status, fulfillment: "FBM", shipBy: null, orderDate: "2026-10-29T08:00:00Z", ...o });

describe("Bestell-Mails erkennen (alle EU-Sprachen)", () => {
  it.each([
    "Verkauft, Jetzt liefern: TEST-SKU-1 Testschuh (erfunden)",
    "Verkauft, jetzt versenden: Bestellung 302-1111111-2222222",
    "Sold, ship now: Test mug (fictional)",
    "Venduto, spedisci ora: Tazza di prova",
    "Vendido, envíe ahora: Taza de prueba",
    "Vendido, envía ya: Taza de prueba",
    "Vendu, expédiez : Tasse test",
    "Verkocht, nu verzenden: Testmok",
    "Sprzedano, wyślij teraz: Kubek testowy",
    "Såld, skicka nu: Testmugg",
  ])("%s", (s) => {
    expect(istBestellMail(s)).toBe(true);
    expect(noiseReason({ from: "Amazon <seller-notification@amazon.de>", subject: s })).toContain("Bestell-Mail");
  });
  it("FBA-Versandinfo und keine Verwechslung mit Compliance", () => {
    expect(istFbaVersandMail("Amazon hat Ihre Artikel versandt")).toBe(true);
    expect(istFbaVersandMail("Amazon has shipped your items")).toBe(true);
    expect(istBestellMail("Ihre Angebote wurden deaktiviert")).toBe(false);
    // Pflicht-Muster würde ohne Ausnahme anschlagen – der Dienst prüft Bestell-Mails vorher
    expect(pflichtRegel({ subject: "Verkauft, Jetzt liefern: Testbatterien AA (erfunden)", text: "" })).not.toBeNull();
  });
  it("Bestellnummern 123-1234567-1234567, ohne Doppelte", () => {
    expect(bestellnummernAus("Bestellnummer: 302-1111111-2222222 … Order ID 302-1111111-2222222, 028-3333333-4444444")).toEqual(["302-1111111-2222222", "028-3333333-4444444"]);
    expect(bestellnummernAus("Tel. 0301-1234567")).toEqual([]);
  });
});

describe("Abgleich mit den Aufträgen", () => {
  const auftraege = [a("302-0000001-0000001", "shipped"), a("302-0000002-0000002", "label_created"), a("302-0000003-0000003", "open"), a("302-0000004-0000004", "cancelled")];
  const m = (emailId: string, subject: string, text: string, vorStd = 10) => ({ emailId, subject, text, receivedAt: new Date(NOW - vorStd * H).toISOString() });
  it("versendet/Label/storniert → archivieren; offen → kein ToDo; fehlend erst nach 6 Std.", () => {
    const r = bestellMailsAbgleichen(
      [
        m("e1", "Verkauft, Jetzt liefern: TEST-1", "Bestellnummer: 302-0000001-0000001"),
        m("e2", "Sold, ship now: TEST-2", "Order ID: 302-0000002-0000002"),
        m("e3", "Venduto, spedisci ora: TEST-3", "Numero ordine: 302-0000003-0000003"),
        m("e4", "Vendido, envíe ahora", "Pedido 302-0000004-0000004"),
        m("e5", "Vendu, expédiez", "Commande 302-0000009-0000009", 10),
        m("e6", "Verkocht, nu verzenden", "Bestelling 302-0000008-0000008", 2),
        m("e7", "Amazon hat Ihre Artikel versandt", ""),
        m("e8", "Verkauft, jetzt liefern: ohne Nummer", "Testtext"),
      ],
      auftraege,
      NOW,
    );
    expect(r.archivieren.sort()).toEqual(["e1", "e2", "e4", "e7"]);
    expect(r.offen).toEqual(["302-0000003-0000003"]);
    expect(r.fehlend.map((f) => f.bestellnummer)).toEqual(["302-0000009-0000009"]); // e6 erst 2 Std. alt
  });
  it("überfällig: nur offene FBM nach Versandfrist (sonst Bestelldatum + 2 Tage), älteste zuerst", () => {
    const l = ueberfaellig(
      [
        a("A", "open", { shipBy: "2026-10-29T22:59:00Z" }),
        a("B", "open", { shipBy: "2026-10-31T22:59:00Z" }),
        a("C", "shipped", { shipBy: "2026-10-28T22:59:00Z" }),
        a("D", "open", { shipBy: null, orderDate: "2026-10-27T08:00:00Z" }),
        a("E", "open", { fulfillment: "FBA", shipBy: "2026-10-20T22:59:00Z" }),
      ],
      NOW,
    );
    expect(l.map((x) => x.externalId)).toEqual(["D", "A"]); // D: Bestelldatum + 2 Tage liegt vor A
  });
  it("Altbestand: Bestell-ToDos schließen – mit Grund je Fall; andere bleiben", () => {
    const r = altToDosSchliessen(
      [
        { id: "t1", subject: "Verkauft, Jetzt liefern: TEST-1 NIKE (erfunden)", category: "logistik_info", bodyShort: "Bestellnummer: 302-0000001-0000001" },
        { id: "t2", subject: "Verkauft, Jetzt liefern: TEST-3", category: "logistik_info", bodyShort: "302-0000003-0000003" },
        { id: "t3", subject: "Sold, ship now: TEST-9", category: "logistik_info", bodyShort: "302-0000009-0000009" },
        { id: "t4", subject: "Amazon hat Ihre Artikel versandt", category: "logistik_info", bodyShort: "" },
        { id: "t5", subject: "Ihre Angebote wurden deaktiviert", category: "reaktivierung", bodyShort: "302-0000001-0000001" },
      ],
      auftraege,
    );
    expect(r.map((x) => x.id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(r[0].grund).toContain("versendet");
    expect(r[1].grund).toContain("noch offen");
    expect(r[2].grund).toContain("fehlt im Tool");
  });
  it("Sortierung: Compliance vor Versand-Sammel-ToDo vor Logistik; Sammel-ToDo nur bei neuen Nummern wieder öffnen", () => {
    expect([kategorieGewicht("compliance_epr"), kategorieGewicht("versand_ueberfaellig"), kategorieGewicht("logistik_info")]).toEqual([0, 1, 2]);
    expect(sammelWiederOeffnen(["A", "B"], ["A"])).toBe(false);
    expect(sammelWiederOeffnen(["A"], ["A", "C"])).toBe(true);
  });
});

import { anAmazonBestaetigt, auftragErledigt, erledigbarNachVersand } from "@/lib/amazon-todos/versand";
import { bestaetigungsDatei, carrierCode } from "@/lib/orders/bestaetigung-logic";

describe("B15.1 Versandbestätigung an Amazon", () => {
  it("ToDo erst erledigt, wenn an Amazon bestätigt – intern versendet reicht nicht", () => {
    expect(auftragErledigt({ status: "shipped", bestaetigt: false })).toBe(false);
    expect(auftragErledigt({ status: "shipped", bestaetigt: true })).toBe(true);
    expect(auftragErledigt({ status: "cancelled", bestaetigt: false })).toBe(true);
    expect(auftragErledigt({ status: "open", bestaetigt: true })).toBe(false);
    expect(anAmazonBestaetigt({ trackingUploadedAt: null, externalStatus: "Unshipped" })).toBe(false);
    expect(anAmazonBestaetigt({ trackingUploadedAt: null, externalStatus: "Shipped" })).toBe(true);
    expect(anAmazonBestaetigt({ trackingUploadedAt: "2026-10-30T10:00:00Z", externalStatus: null })).toBe(true);
    const r = erledigbarNachVersand([{ id: "t1", subject: "Verkauft, Jetzt liefern", bestellnummern: ["302-0000000-0000001"], bodyShort: null }], [{ externalId: "302-0000000-0000001", status: "shipped", bestaetigt: false }]);
    expect(r).toEqual({ passend: [], aus: [{ id: "t1", grund: "nicht an Amazon bestätigt" }] });
  });
  it("Datei: Prep Center ohne Sendungsnummer als „Other“, DHL mit Sendungsnummer", () => {
    expect(carrierCode("DHL Paket")).toEqual({ code: "DHL", name: "" });
    expect(carrierCode(null)).toEqual({ code: "Other", name: "Prep Center" });
    const d = bestaetigungsDatei([
      { externalId: "302-0000000-0000001", versendetAm: "2026-10-29T09:00:00Z", tracking: "00340434000000000001", carrier: "DHL" },
      { externalId: "302-0000000-0000002", versendetAm: "2026-10-29T09:00:00Z", tracking: null, carrier: null },
    ]).split("\r\n");
    expect(d[0]).toBe("order-id\torder-item-id\tquantity\tship-date\tcarrier-code\tcarrier-name\ttracking-number\tship-method");
    expect(d[1]).toBe("302-0000000-0000001\t\t\t2026-10-29\tDHL\t\t00340434000000000001\t");
    expect(d[2]).toBe("302-0000000-0000002\t\t\t2026-10-29\tOther\tPrep Center\t\t");
  });
});
