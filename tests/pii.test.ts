import { beforeAll, describe, expect, it } from "vitest";
import { encryptedBytea, encryptedJson, encryptedText, invoiceJson } from "@/db/tables/encrypted";
import { INVOICE_PII_PATHS, isSealedBytes, isSealedPii, openBytes, openJsonPaths, openPii, sealBytes, sealJsonPaths, sealPii } from "@/lib/pii";

beforeAll(() => {
  process.env.APP_SECRET ??= "test-geheimnis-mindestens-32-zeichen-lang!";
});

describe("Empfängerdaten verschlüsseln", () => {
  it("Text: AES-256-GCM, jedes Mal anderer Chiffretext, zurück zum Klartext", () => {
    const a = sealPii("Max Beispiel, Weg 3, 54321 Beispielort");
    const b = sealPii("Max Beispiel, Weg 3, 54321 Beispielort");
    expect(a).toMatch(/^pii:v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("Beispiel");
    expect(openPii(a)).toBe("Max Beispiel, Weg 3, 54321 Beispielort");
    expect(sealPii(a)).toBe(a);
  });

  it("Altbestand im Klartext wird beim Lesen durchgereicht", () => {
    expect(openPii("Erika Muster")).toBe("Erika Muster");
    expect(openBytes(Buffer.from("%PDF-1.4"))).toEqual(Buffer.from("%PDF-1.4"));
  });

  it("veränderter Chiffretext fällt auf (Integritätsschutz)", () => {
    const s = sealPii("Erika Muster");
    const parts = s.split(".");
    const data = Buffer.from(parts[3], "base64url");
    data[0] ^= 1;
    expect(() => openPii([...parts.slice(0, 3), data.toString("base64url")].join("."))).toThrow();
  });

  it("anderer APP_SECRET kann nicht entschlüsseln", () => {
    const s = sealPii("Erika Muster");
    const old = process.env.APP_SECRET;
    process.env.APP_SECRET = "ein-ganz-anderes-geheimnis-mit-32-zeichen";
    try {
      expect(() => openPii(s)).toThrow();
    } finally {
      process.env.APP_SECRET = old;
    }
    expect(openPii(s)).toBe("Erika Muster");
  });

  it("Dateien (Versandetiketten) mit Kennung", () => {
    const pdf = Buffer.from("%PDF-1.4 Versandetikett Erika Muster");
    const sealed = sealBytes(pdf);
    expect(isSealedBytes(sealed)).toBe(true);
    expect(sealed.includes("Erika")).toBe(false);
    expect(openBytes(sealed)).toEqual(pdf);
    expect(sealBytes(sealed)).toBe(sealed);
  });

  it("Rechnung: Käuferfelder verschlüsselt, Beträge/Datum/b2b bleiben lesbar", () => {
    const inv = {
      number: "2026-0001",
      date: "2026-10-01",
      totalGross: 59.98,
      buyer: { name: "Erika Muster", lines: ["Weg 3", "54321 Beispielort"] },
      buyerEmail: "erika@example.com",
      b2b: { taxCase: "domestic", buyerAddress: { street: "Weg 3" }, buyerVatId: "DE123456789", lines: [{ description: "Socken" }] },
    };
    const sealed = sealJsonPaths(inv, INVOICE_PII_PATHS);
    const text = JSON.stringify(sealed);
    expect(text).not.toMatch(/Erika|Weg 3|DE123456789|erika@/);
    expect(sealed).toMatchObject({ number: "2026-0001", date: "2026-10-01", totalGross: 59.98, b2b: { taxCase: "domestic", lines: [{ description: "Socken" }] } });
    expect(isSealedPii(sealed.pii)).toBe(true);
    expect(inv.buyer.name).toBe("Erika Muster"); // Original unverändert
    expect(openJsonPaths(sealed)).toEqual(inv);
    expect(sealJsonPaths(sealed, INVOICE_PII_PATHS)).toBe(sealed);
  });

  it("Spaltentypen verschlüsseln beim Schreiben und entschlüsseln beim Lesen", () => {
    const col = (b: unknown) => (b as { config: { customTypeParams: { toDriver: (v: unknown) => unknown; fromDriver: (v: unknown) => unknown } } }).config.customTypeParams;

    const tx = col(encryptedText("buyer_name"));
    expect(tx.fromDriver(tx.toDriver("Erika Muster"))).toBe("Erika Muster");

    const js = col(encryptedJson<{ name1: string }>("ship_to"));
    const stored = JSON.parse(js.toDriver({ name1: "Erika Muster", city: "Beispielort" }) as string);
    expect(isSealedPii(stored)).toBe(true);
    expect(js.fromDriver(stored)).toEqual({ name1: "Erika Muster", city: "Beispielort" });
    expect(js.fromDriver({ name1: "Altbestand" })).toEqual({ name1: "Altbestand" });

    const inv = col(invoiceJson("data"));
    const raw = JSON.parse(inv.toDriver({ number: "1", buyer: { name: "Erika" } }) as string);
    expect(raw.number).toBe("1");
    expect(raw.buyer).toBeUndefined();
    expect(inv.fromDriver(raw)).toEqual({ number: "1", buyer: { name: "Erika" } });

    const by = col(encryptedBytea("data"));
    expect(by.fromDriver(by.toDriver(Buffer.from("PDF")))).toEqual(Buffer.from("PDF"));
  });
});
