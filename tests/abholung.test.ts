import { describe, expect, it } from "vitest";
import {
  abholungPruefen,
  abholZusammenfassung,
  datumLesen,
  dhlAntwortLesen,
  dhlAuftrag,
  dhlFehlerText,
  dhlStornoLesen,
  feiertage,
  fensterLesen,
  istAbholtag,
  naechsterAbholtag,
  ortFinden,
  upsAntwortLesen,
  upsAuftrag,
  vorschlagNoetig,
  zeitNorm,
  type AbholEingabe,
} from "@/lib/abholung/logic";
import type { AbholOrt } from "@/db/schema";

// Bauauftrag Abholung DHL/UPS – reine Logik. Alle Daten erfunden.

const ORT: AbholOrt = { key: "testfirma", name: "Testfirma GmbH", strasse: "Musterweg", hausnr: "1", plz: "12345", ort: "Musterstadt", kontakt: "Erika Test", telefon: "0123 456789", email: "abholung@example.com", dhlKundennummer: "1234567890", von: "09:00", bis: "16:00", hinweis: "Bitte am Tor klingeln", standard: true };
const ORT2: AbholOrt = { ...ORT, key: "zweitlager", name: "Zweitlager Test KG", standard: undefined };
// Freitag, 06.11.2026, 14:00 Berlin
const FR = new Date("2026-11-06T13:00:00Z");
const e = (x: Partial<AbholEingabe> = {}): AbholEingabe => ({ dienst: "dhl", datum: "2026-11-07", von: "10:00", bis: "12:00", pakete: 12, paletten: 0, ort: ORT, ...x });

describe("Abholung – Datum und Zeitfenster aus Sprache", () => {
  it("heute, morgen, übermorgen, Wochentag, ISO, TT.MM.", () => {
    expect(datumLesen("heute", FR)).toBe("2026-11-06");
    expect(datumLesen("morgen", FR)).toBe("2026-11-07");
    expect(datumLesen("Übermorgen", FR)).toBe("2026-11-08");
    expect(datumLesen("Montag", FR)).toBe("2026-11-09");
    expect(datumLesen("freitag", FR)).toBe("2026-11-13");
    expect(datumLesen("2026-11-10", FR)).toBe("2026-11-10");
    expect(datumLesen("10.11.", FR)).toBe("2026-11-10");
    expect(datumLesen("2.1.", FR)).toBe("2027-01-02");
    expect(datumLesen("10.11.26", FR)).toBe("2026-11-10");
    expect(datumLesen("31.02.", FR)).toBeNull();
    expect(datumLesen("irgendwann", FR)).toBeNull();
  });
  it("Fenster „10-12“, „10 bis 12 Uhr“, „9.30–11:45“", () => {
    expect(fensterLesen("10-12")).toEqual({ von: "10:00", bis: "12:00" });
    expect(fensterLesen("10 bis 12 Uhr")).toEqual({ von: "10:00", bis: "12:00" });
    expect(fensterLesen("von 9.30 – 11:45")).toEqual({ von: "09:30", bis: "11:45" });
    expect(fensterLesen("vormittags")).toBeNull();
    expect(zeitNorm("1030")).toBe("10:30");
    expect(zeitNorm("25")).toBeNull();
  });
  it("Feiertage (bundesweit + Bayern) und Abholtage", () => {
    const f = feiertage(2026);
    expect(f).toContain("2026-04-03"); // Karfreitag
    expect(f).toContain("2026-06-04"); // Fronleichnam
    expect(f).toContain("2026-11-01");
    expect(istAbholtag("dhl", "2026-11-07")).toBe(true); // Samstag
    expect(istAbholtag("ups", "2026-11-07")).toBe(false);
    expect(istAbholtag("dhl", "2026-11-08")).toBe(false); // Sonntag
    expect(istAbholtag("dhl", "2026-12-25")).toBe(false);
  });
  it("nächster Abholtag: DHL morgen (Sa), UPS Montag; nach 22 Uhr übermorgen", () => {
    expect(naechsterAbholtag("dhl", FR)).toBe("2026-11-07");
    expect(naechsterAbholtag("ups", FR)).toBe("2026-11-09");
    expect(naechsterAbholtag("dhl", new Date("2026-11-05T21:30:00Z"))).toBe("2026-11-07"); // Do 22:30 → Sa
  });
});

describe("Abholung – Prüfen", () => {
  it("gültige DHL-Buchung mit Hinweisen (kein festes Fenster, >10 Pakete = Anfrage)", () => {
    const p = abholungPruefen(e(), FR);
    expect(p.fehler).toEqual([]);
    expect(p.hinweise.join(" ")).toContain("keine feste Uhrzeit");
    expect(p.hinweise.join(" ")).toContain("Mehr als 10 Pakete");
  });
  it("Fehler: Vergangenheit, heute (DHL), Sonntag, Feiertag, >30 Tage, kein Paket, bis vor von", () => {
    expect(abholungPruefen(e({ datum: "2026-11-05" }), FR).fehler.join(" ")).toContain("Vergangenheit");
    expect(abholungPruefen(e({ datum: "2026-11-06" }), FR).fehler.join(" ")).toContain("nicht am selben Tag");
    expect(abholungPruefen(e({ datum: "2026-11-08" }), FR).fehler.join(" ")).toContain("Sonntag");
    expect(abholungPruefen(e({ datum: "2026-12-25" }), FR).fehler.join(" ")).toContain("Feiertag");
    expect(abholungPruefen(e({ datum: "2026-12-30" }), FR).fehler.join(" ")).toContain("30 Tage");
    expect(abholungPruefen(e({ pakete: 0 }), FR).fehler.join(" ")).toContain("Mindestens ein Paket");
    expect(abholungPruefen(e({ von: "12:00", bis: "10:00" }), FR).fehler.join(" ")).toContain("nach „von“");
    expect(abholungPruefen(e({ datum: "2026-11-07" }), new Date("2026-11-06T21:30:00Z")).fehler.join(" ")).toContain("Nach 22 Uhr");
  });
  it("unvollständiger Abholort und falsche Kundennummer", () => {
    expect(abholungPruefen(e({ ort: { ...ORT, telefon: "", plz: "123" } }), FR).fehler.join(" ")).toMatch(/PLZ.*Telefon/);
    expect(abholungPruefen(e({ ort: { ...ORT, dhlKundennummer: "12345" } }), FR).fehler.join(" ")).toContain("10 Ziffern");
  });
  it("UPS: Samstag nicht, Fenster und Konto nötig, Gewicht geschätzt", () => {
    const u = (x: Partial<AbholEingabe>) => e({ dienst: "ups", datum: "2026-11-09", ...x });
    expect(abholungPruefen(u({ datum: "2026-11-07" }), FR, { upsKonto: "A1B2C3" }).fehler.join(" ")).toContain("Samstag");
    expect(abholungPruefen(u({ von: null, bis: null }), FR, { upsKonto: "A1B2C3" }).fehler.join(" ")).toContain("Zeitfenster");
    expect(abholungPruefen(u({}), FR).fehler.join(" ")).toContain("Kontonummer");
    const ok = abholungPruefen(u({}), FR, { upsKonto: "A1B2C3" });
    expect(ok.fehler).toEqual([]);
    expect(ok.hinweise.join(" ")).toContain("5 kg je Paket");
  });
  it("Zusammenfassung für die Rückfrage", () => {
    expect(abholZusammenfassung(e())).toBe("DHL-Abholung am Sa, 07.11.2026, 10:00–12:00 Uhr, 12 Pakete – Testfirma GmbH, Musterweg 1, 12345 Musterstadt");
  });
  it("Abholort aus Text: Schlüssel, Teil des Namens, Standard", () => {
    expect(ortFinden([ORT, ORT2], "zweitlager")?.key).toBe("zweitlager");
    expect(ortFinden([ORT, ORT2], "Testfirma")?.key).toBe("testfirma");
    expect(ortFinden([ORT, ORT2], null)?.key).toBe("testfirma");
    expect(ortFinden([ORT, ORT2], "Unbekannt")).toBeNull();
    expect(ortFinden([{ ...ORT2 }], "")?.key).toBe("zweitlager");
    // Schlüssel eines Orts steckt im Namen eines anderen: der genauere gewinnt
    const LAGER: AbholOrt = { ...ORT, key: "lager", name: "Lager GmbH", standard: undefined };
    const NEU: AbholOrt = { ...ORT, key: "lager-x1-gmbh", name: "Lager X1 GmbH", standard: undefined };
    expect(ortFinden([LAGER, NEU], "Lager X1")?.key).toBe("lager-x1-gmbh");
    expect(ortFinden([LAGER, NEU], "Lager")?.key).toBe("lager");
  });
});

describe("Abholung – Anfragen und Antworten", () => {
  it("DHL: je Paket ein Eintrag, Öffnungszeit, Kundennummer, Hinweis ≤ 100", () => {
    const b = dhlAuftrag(e({ pakete: 3, paletten: 1, gewichtKg: 25, hinweis: "x".repeat(150) }));
    expect(b.customerDetails).toEqual({ accountNumber: "1234567890" });
    expect(b.pickupLocation.pickupAddress).toMatchObject({ name1: "Testfirma GmbH", addressStreet: "Musterweg", addressHouse: "1", postalCode: "12345", country: "DE" });
    expect(b.pickupLocation.businessHours).toEqual([{ timeFrom: "10:00", timeUntil: "12:00" }]);
    expect(b.pickupDetails.pickupDate).toEqual({ type: "Date", value: "2026-11-07" });
    expect(b.pickupDetails.totalWeight).toEqual({ uom: "kg", value: 25 });
    expect(b.pickupDetails.comment).toHaveLength(100);
    expect(b.shipmentDetails.shipments).toEqual([{ transportationType: "PAKET", size: "M" }, { transportationType: "PAKET", size: "M" }, { transportationType: "PAKET", size: "M" }, { transportationType: "PALETTEN" }]);
  });
  it("DHL-Antwort: orderID, EMA = angefragt, Fehlertexte, Storno", () => {
    expect(dhlAntwortLesen({ confirmation: { type: "ORDERPICKUP", value: { orderID: "a".repeat(32), pickupDate: "2026-11-07", freeOfCharge: true, pickupType: "BDA" } } })).toEqual({ status: "gebucht", bestaetigung: "a".repeat(32), datum: "2026-11-07", abholArt: "BDA", kostenpflichtig: false });
    expect(dhlAntwortLesen({ confirmation: { value: { orderID: "b".repeat(32), pickupType: "EMA" } } })?.status).toBe("angefragt");
    expect(dhlAntwortLesen({})).toBeNull();
    expect(dhlFehlerText(422, [{ title: "Ungültige Postleitzahl", detail: "PLZ fehlt" }])).toBe("DHL: Ungültige Postleitzahl: PLZ fehlt");
    expect(dhlFehlerText(401, null)).toContain("Zugang");
    expect(dhlStornoLesen({ confirmedCancellations: [{ orderID: "x" }], failedCancellations: [] }, "x").ok).toBe(true);
    expect(dhlStornoLesen({ confirmedCancellations: [], failedCancellations: [{ orderID: "x", message: "zu spät" }] }, "x")).toEqual({ ok: false, text: "DHL konnte nicht stornieren: zu spät." });
  });
  it("UPS: Konto, Zeiten HHMM, Datum JJJJMMTT, Gewicht geschätzt, PRN", () => {
    const b = upsAuftrag(e({ dienst: "ups", datum: "2026-11-09", pakete: 4 }), "a1b2c3").PickupCreationRequest;
    expect(b.Shipper.Account).toEqual({ AccountNumber: "A1B2C3", AccountCountryCode: "DE" });
    expect(b.PickupDateInfo).toEqual({ ReadyTime: "1000", CloseTime: "1200", PickupDate: "20261109" });
    expect(b.PickupPiece).toEqual([{ ServiceCode: "011", Quantity: "4", DestinationCountryCode: "DE", ContainerCode: "01" }]);
    expect(b.TotalWeight).toEqual({ Weight: "20", UnitOfMeasurement: "KGS" });
    expect(b.PickupAddress.AddressLine).toEqual(["Musterweg 1"]);
    expect(upsAntwortLesen({ PickupCreationResponse: { PRN: "2929602E9CP" } })?.bestaetigung).toBe("2929602E9CP");
    expect(upsAntwortLesen({})).toBeNull();
  });
  it("Vorschlag erst bei mehr als n Labels und ohne Buchung", () => {
    expect(vorschlagNoetig({ labels: 6, schwelle: 5, gebucht: false })).toBe(true);
    expect(vorschlagNoetig({ labels: 5, schwelle: 5, gebucht: false })).toBe(false);
    expect(vorschlagNoetig({ labels: 9, schwelle: 5, gebucht: true })).toBe(false);
  });
});
