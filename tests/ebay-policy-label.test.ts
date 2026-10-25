import { describe, expect, it } from "vitest";
import { cleanPolicyName, serviceName, shippingPolicyLabel } from "@/lib/ebay/policy-label";

describe("Versandprofile verständlich", () => {
  it("automatisch erzeugter Name → Dienstleister, Preis, Bearbeitungszeit", () => {
    expect(shippingPolicyLabel({ id: "1", name: "Pauschal:DHL Paket(4,99 €),3 Werktage#5123456789", service: "DE_DHLPaket", cost: 4.99, handlingDays: 3 })).toBe("DHL Paket · 4,99 € · Versand in 3 Werktagen");
    expect(shippingPolicyLabel({ id: "2", name: "Flat:Hermes Paket(EUR 0.00),1 business day#6234567890", service: "DE_HermesPaket", freeShipping: true, handlingDays: 1 })).toBe("Hermes Paket · kostenlos · Versand in 1 Werktag");
  });
  it("eigener Profilname bleibt als Zusatz, ohne ID", () => {
    expect(shippingPolicyLabel({ id: "3", name: "Großpakete Spedition#7234567890", service: "DE_Spedition", cost: 39, handlingDays: 5 })).toBe("Spedition · 39,00 € · Versand in 5 Werktagen („Großpakete Spedition“)");
    expect(cleanPolicyName("Standard#1234567890")).toBe("Standard");
  });
  it("unbekannte Versandart aus dem Code lesbar", () => {
    expect(serviceName("DE_MeinKurierExpress")).toBe("Mein Kurier Express");
  });
  it("ohne Details: bereinigter Name", () => {
    expect(shippingPolicyLabel({ id: "4", name: "Versand Standard#1234567890" })).toBe("Versand Standard");
  });
});
