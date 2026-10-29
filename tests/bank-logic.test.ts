import { describe, expect, it } from "vitest";
import { erkenneWiederkehrend, gruppeVon, leseKontoauszug, saldoAm, termineBis } from "@/lib/bank/logic";

// Kontoauszüge: Sparkasse CSV-CAMT und CAMT.053, wiederkehrende Abbuchungen, Kontostand. Alles erfunden.

const KOPF = '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
const zeile = (tag: string, text: string, zweck: string, gl: string, mandat: string, name: string, betrag: string) => `"DE00123456780000000001";"${tag}";"${tag}";"${text}";"${zweck}";"${gl}";"${mandat}";"";"";"";"";"${name}";"DE00999999990000000002";"TESTDEFFXXX";"${betrag}";"EUR";"Umsatz gebucht"`;

const CSV = [
  KOPF,
  zeile("28.10.26", "GUTSCHR. UEBERWEISUNG", "Amazon Payments Auszahlung", "", "", "AMAZON PAYMENTS EUROPE S.C.A.", "4.210,55"),
  zeile("15.10.26", "LASTSCHRIFT", "Kartenabrechnung", "DE11AMX00000000001", "AMX-TEST-1", "American Express Europe S.A.", "-3.812,40"),
  zeile("01.10.26", "LASTSCHRIFT", "Miete Lager Oktober", "DE22ZZZ00000000002", "LAGER-1", "Test Immobilien GmbH", "-950,00"),
  zeile("15.09.26", "LASTSCHRIFT", "Kartenabrechnung", "DE11AMX00000000001", "AMX-TEST-1", "American Express Europe S.A.", "-2.640,10"),
  zeile("01.09.26", "LASTSCHRIFT", "Miete Lager September", "DE22ZZZ00000000002", "LAGER-1", "Test Immobilien GmbH", "-950,00"),
  zeile("15.08.26", "LASTSCHRIFT", "Kartenabrechnung", "DE11AMX00000000001", "AMX-TEST-1", "American Express Europe S.A.", "-1.990,00"),
  zeile("01.08.26", "LASTSCHRIFT", "Miete Lager August", "DE22ZZZ00000000002", "LAGER-1", "Test Immobilien GmbH", "-950,00"),
  zeile("10.08.26", "UEBERWEISUNG", "USt-VA 06/26", "", "", "Finanzamt Teststadt", "-1.200,00"),
].join("\r\n");

describe("Sparkasse CSV-CAMT", () => {
  const a = leseKontoauszug(new TextEncoder().encode(CSV));
  it("liest Umsätze mit Vorzeichen, Datum, Gegenpartei, Mandat", () => {
    expect(a.format).toBe("csv");
    expect(a.konto).toBe("DE00123456780000000001");
    expect(a.umsaetze).toHaveLength(8);
    const amex = a.umsaetze.find((u) => u.buchungstag === "2026-10-15")!;
    expect(amex).toMatchObject({ betrag: -3812.4, gegenpartei: "American Express Europe S.A.", glaeubigerId: "DE11AMX00000000001", mandat: "AMX-TEST-1" });
    expect(a.umsaetze[0].betrag).toBe(4210.55);
  });
  it("gleiche Datei zweimal → gleiche Schlüssel (kein Doppelimport)", () => {
    const b = leseKontoauszug(new TextEncoder().encode(CSV));
    expect(b.umsaetze.map((u) => u.schluessel)).toEqual(a.umsaetze.map((u) => u.schluessel));
    expect(new Set(a.umsaetze.map((u) => u.schluessel)).size).toBe(8);
  });
  it("erkennt Miete (fix) und Amex (schwankend, letzter Betrag), Steuer einmalig nicht", () => {
    const w = erkenneWiederkehrend(a.umsaetze, "2026-10-29");
    const amex = w.find((x) => x.art === "kreditkarte")!;
    expect(amex).toMatchObject({ rhythmus: "monatlich", betrag: 3812.4, naechste: "2026-11-15", anzahl: 3 });
    const miete = w.find((x) => x.name === "Test Immobilien GmbH")!;
    expect(miete).toMatchObject({ art: "fixkosten", rhythmus: "monatlich", betrag: 950, naechste: "2026-11-01" });
    expect(w.some((x) => x.art === "steuer")).toBe(false);
    expect(termineBis(miete, "2026-10-29", "2026-12-31")).toEqual(["2026-11-01", "2026-12-01"]);
  });
  it("Gruppe: Lastschrift über Gläubiger-ID + Mandat, sonst Name ohne Rechtsform", () => {
    expect(gruppeVon({ glaeubigerId: "X", mandat: "Y", gegenpartei: "egal", iban: null })).toBe("sepa:X|Y");
    expect(gruppeVon({ glaeubigerId: null, mandat: null, gegenpartei: "Muster Software GmbH", iban: null })).toBe(gruppeVon({ glaeubigerId: null, mandat: null, gegenpartei: "MUSTER SOFTWARE", iban: null }));
  });
});

describe("CAMT.053", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>DE00123456780000000001</IBAN></Id></Acct>
<Bal><Tp><CdOrPrtry><Cd>PRCD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">10000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-27</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">13260.55</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-10-28</Dt></Dt></Bal>
<Ntry><Amt Ccy="EUR">4210.55</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-28</Dt></BookgDt><ValDt><Dt>2026-10-28</Dt></ValDt>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>AMAZON PAYMENTS EUROPE</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Auszahlung Test</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">950.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-10-28</Dt></BookgDt>
<NtryDtls><TxDtls><Refs><MndtId>LAGER-1</MndtId></Refs><RltdPties><Cdtr><Nm>Test Immobilien GmbH</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Miete</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
  const a = leseKontoauszug(new TextEncoder().encode(xml));
  it("liest Konto, Schlusssaldo und Umsätze mit Soll/Haben", () => {
    expect(a.format).toBe("camt");
    expect(a.konto).toBe("DE00123456780000000001");
    expect(a.salden).toEqual([{ datum: "2026-10-28", saldo: 13260.55 }]);
    expect(a.umsaetze.map((u) => [u.betrag, u.gegenpartei])).toEqual([
      [4210.55, "AMAZON PAYMENTS EUROPE"],
      [-950, "Test Immobilien GmbH"],
    ]);
  });
});

describe("Kontostand", () => {
  it("Anker + spätere Umsätze", () => {
    expect(saldoAm({ datum: "2026-10-01", saldo: 1000 }, [{ buchungstag: "2026-10-01", betrag: -50 }, { buchungstag: "2026-10-05", betrag: 200 }, { buchungstag: "2026-11-01", betrag: -10 }], "2026-10-31")).toBe(1200);
    expect(saldoAm(null, [], "2026-10-31")).toBeNull();
  });
});
