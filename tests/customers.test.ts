import { describe, expect, it } from "vitest";
import { normalizeCustomer, suggestCustomerNumber } from "@/lib/invoices/customer-logic";

describe("Kundenstamm", () => {
  it("bereinigt Eingaben", () => {
    const { value, problems } = normalizeCustomer({ name: " Salon Wien GmbH ", street: "Ring 1", zip: "1010", city: "Wien", country: "at", vatId: "atu 1234 5678", email: " Einkauf@Salon.example " });
    expect(problems).toEqual([]);
    expect(value).toMatchObject({ name: "Salon Wien GmbH", country: "AT", vatId: "ATU12345678", email: "einkauf@salon.example" });
    expect(value.contact).toBeUndefined();
  });

  it("meldet fehlende oder falsche Angaben", () => {
    const p = normalizeCustomer({ name: "", street: "", zip: "1", city: "X", country: "Österreich", vatId: "123", email: "kaputt" }).problems.join(" ");
    expect(p).toMatch(/Firmenname fehlt/);
    expect(p).toMatch(/Anschrift unvollständig/);
    expect(p).toMatch(/Länderkürzel/);
    expect(p).toMatch(/USt-IdNr\./);
    expect(p).toMatch(/E-Mail-Adresse ungültig/);
  });

  it("schlägt die nächste Kundennummer vor", () => {
    expect(suggestCustomerNumber(["K-1007", "K-1003"])).toBe("K-1008");
    expect(suggestCustomerNumber(["10045"])).toBe("10046");
    expect(suggestCustomerNumber(["ohne", "KD-2026-012"], 2026)).toBe("KD-2026-013");
    expect(suggestCustomerNumber([])).toBeNull();
  });
});
