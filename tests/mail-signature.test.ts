import { describe, expect, it } from "vitest";
import { hasSignOff, signatureFor, withSignature } from "@/lib/mail/signature";

const SIG = "Mit freundlichen Grüßen\nMax Mustermann\nTesthandel GmbH\nTel. 0351 123456";

describe("Signaturen", () => {
  it("hängt die Signatur des Postfachs an", () => {
    expect(withSignature("Guten Tag,\n\nbitte senden Sie uns Ihre Preisliste.\n", SIG)).toBe(`Guten Tag,\n\nbitte senden Sie uns Ihre Preisliste.\n\n${SIG}`);
  });

  it("nicht doppelt, wenn der Text schon eine Grußformel hat (alte Entwürfe)", () => {
    const old = "Guten Tag,\n\nbitte Preisliste.\n\nMit freundlichen Grüßen\nAlt GmbH";
    expect(hasSignOff(old)).toBe(true);
    expect(withSignature(old, SIG)).toBe(old);
    expect(hasSignOff("Wir grüßen die Branche mit freundlichen Worten.")).toBe(false);
  });

  it("englische Mails bekommen „Kind regards“", () => {
    expect(signatureFor(SIG, "en")).toBe("Kind regards\nMax Mustermann\nTesthandel GmbH\nTel. 0351 123456");
    expect(signatureFor(SIG, "de")).toBe(SIG);
    expect(signatureFor("  ", "de")).toBeNull();
    expect(signatureFor("Max\r\nFirma", "de")).toBe("Max\nFirma");
  });

  it("ohne Signatur bleibt der Text, wie er ist", () => {
    expect(withSignature("Hallo\n\n", null)).toBe("Hallo");
  });
});
