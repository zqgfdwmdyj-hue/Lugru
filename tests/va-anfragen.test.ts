import { describe, expect, it } from "vitest";
import { bedarfAusText, bereitsErstattet, threadAntwortArt } from "@/lib/va/logic";
import { fallnummerInAntwort } from "@/lib/va/automatik-logic";

// Befund 03.11.: Bitten der VA mitten im Satz, eigene Threads, „bereits erstattet“ – erfundene Kennungen.

describe("Bitte der VA erkennen (auch mitten im Satz)", () => {
  it.each([
    "Hi, The sourcing cost not approved yet, i need invoice for fix the price first and to open the case",
    "I need these Invoice for open reevaluation please B0TEST0001 B0TEST0002",
    "NEED PROOF DELIVERY ORDER & INVOICE for answering ongoing case",
    "hello, kindly provide the delivery note",
    "please send the POD",
    "waiting for your invoice",
    "Ich brauche die Rechnung",
  ])("„%s“ → Rückfrage", (t) => expect(threadAntwortArt(t)).toBe("rueckfrage"));
  it("Erledigt und Notiz bleiben", () => {
    expect(threadAntwortArt("done ✅")).toBe("erledigt");
    expect(threadAntwortArt("Paket ist angekommen")).toBe("notiz");
    expect(threadAntwortArt("not yet done")).toBe("notiz");
  });
  it("„bereits erstattet“ ist kein „erledigt“", () => {
    expect(threadAntwortArt("hi, it's already be done with first reimbursement id 1234567890 at 31 July")).toBe("notiz");
  });
});

describe("Was braucht die VA?", () => {
  it("Rechnung mit mehreren ASINs", () => {
    expect(bedarfAusText("I need these Invoice for open reevaluation please b0test0001 B0TEST0002 B0TEST0001")).toEqual({ rechnung: true, nachweis: false, asins: ["B0TEST0001", "B0TEST0002"], fnskus: [], sendung: null });
  });
  it("Liefernachweis + Rechnung + Sendung", () => {
    const b = bedarfAusText("NEED PROOF DELIVERY ORDER & INVOICE for FBA1TESTX9Y and X00TEST001");
    expect(b).toMatchObject({ rechnung: true, nachweis: true, sendung: "FBA1TESTX9Y", fnskus: ["X00TEST001"] });
  });
});

describe("Bereits erstattet", () => {
  it("mit Erstattungs-ID, die keine Fallnummer ist", () => {
    const t = "hi, it's already be done with first reimbursement id 1234567890 at 31 July 2026";
    expect(bereitsErstattet(t)).toEqual({ erstattungsId: "1234567890" });
    expect(fallnummerInAntwort(t)).toBeNull();
  });
  it("Fallnummer bleibt erkannt", () => {
    expect(fallnummerInAntwort("case 12345678901 submitted, reimbursement id 1234567890")).toBe("12345678901");
    expect(bereitsErstattet("case submitted 12345678901")).toBeNull();
  });
});
