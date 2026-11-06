import { describe, expect, it } from "vitest";
import { anredeAus, antwortBetreff, betreffKern, entwurfLesen, entwurfVorlage, freieSlots, istMassenmail, persoenlichEinstufen, siehtNachPersonAus, tageImText, terminBezug, terminFinden, zusammenfassungVorlage } from "@/lib/inbox/persoenlich-logic";

// Persönliche Mails: alles mit erfundenen Namen und Adressen (example.com/example.invalid).

const HEUTE = "2026-11-06"; // Freitag
const inhaber = { vorname: "Ina", nachname: "Inhaber" };

describe("Massen- und Systemmails", () => {
  it("Listen-Kopf, Bulk, Auto-Submitted, noreply, Abmelde-Link", () => {
    expect(istMassenmail({ listUnsubscribe: "<mailto:x@example.com>" }, "news@shop.example")).toBe(true);
    expect(istMassenmail({ precedence: "bulk" }, "a@example.com")).toBe(true);
    expect(istMassenmail({ autoSubmitted: "auto-generated" }, "a@example.com")).toBe(true);
    expect(istMassenmail({ autoSubmitted: "no" }, "petra.probe@example.com")).toBe(false);
    expect(istMassenmail({}, "Doctolib <no-reply@doctolib.example>")).toBe(true);
    expect(istMassenmail({}, "a@example.com", "Viele Grüße\nNewsletter abbestellen: hier")).toBe(true);
    expect(istMassenmail({}, "petra.probe@example.com", "Hallo Ina, ich muss leider absagen.")).toBe(false);
  });
});

describe("persönlich oder geschäftlich", () => {
  it("Absage einer Person mit persönlicher Anrede → persönlich", () => {
    const e = persoenlichEinstufen({ adresse: "petra.probe@example.com", name: "Petra Probe", betreff: "Termin morgen", text: "Hallo Ina,\nich muss den Termin morgen leider absagen, ich bin krank.\nViele Grüße\nPetra", inhaber });
    expect(e.stufe).toBe("persoenlich");
  });
  it("Praxis per Mail → persönlich; Freemail ohne Inhalt → unsicher", () => {
    expect(persoenlichEinstufen({ adresse: "anmeldung@praxis-test.example", name: "Praxis Dr. Testmann", betreff: "Ihr Termin", text: "Sehr geehrte Frau Inhaber, Ihr Termin am Montag muss leider ausfallen.", inhaber }).stufe).toBe("persoenlich");
    expect(persoenlichEinstufen({ adresse: "max.muster@gmail.com", name: "Max Muster", betreff: "Hallo", text: "Kurze Frage: wie geht es?", inhaber }).stufe).toBe("persoenlich");
    expect(persoenlichEinstufen({ adresse: "m.muster@example.com", name: "Max Muster", betreff: "Frage", text: "Kurze Frage zu nächster Woche.", inhaber }).stufe).toBe("unsicher");
  });
  it("Firma, Funktionsadresse oder Geschäftsinhalt → nicht persönlich", () => {
    expect(persoenlichEinstufen({ adresse: "info@grosshandel-test.example", name: "Testhandel GmbH", betreff: "Preisliste November", text: "anbei unsere Preisliste mit ASIN und EK.", inhaber }).stufe).toBe("nein");
    expect(persoenlichEinstufen({ adresse: "max.muster@gmail.com", name: "Max Muster", betreff: "Angebot Paletten", text: "Ich hätte 3 Paletten Ware als B2B-Angebot, Preisliste anbei.", inhaber }).stufe).not.toBe("persoenlich");
    expect(siehtNachPersonAus("Petra Probe")).toBe(true);
    expect(siehtNachPersonAus("Shop Team")).toBe(false);
    expect(siehtNachPersonAus("info")).toBe(false);
  });
});

describe("Anrede", () => {
  it("früher geduzt → Du; sonst aus der Mail; Standard Sie", () => {
    expect(anredeAus({ eingang: "Sehr geehrte Frau Inhaber", frueher: ["Hallo Petra,\nklar, gern."] })).toBe("du");
    expect(anredeAus({ eingang: "Hallo Ina, kannst du morgen? Ich melde mich bei dir." })).toBe("du");
    expect(anredeAus({ eingang: "Sehr geehrte Frau Inhaber, leider muss ich Ihnen absagen." })).toBe("sie");
    expect(anredeAus({ eingang: "Termin morgen fällt aus." })).toBe("sie");
    expect(anredeAus({ eingang: "Hallo, kannst du?", gemerkt: "sie" })).toBe("sie");
  });
});

describe("Termin-Bezug", () => {
  it("relative Tage: heute, morgen, übermorgen, Wochentage", () => {
    expect(tageImText("bis morgen", HEUTE).map((x) => x.iso)).toEqual(["2026-11-07"]);
    expect(tageImText("übermorgen", HEUTE).map((x) => x.iso)).toEqual(["2026-11-08"]);
    expect(tageImText("heute morgen kam die Post", HEUTE).map((x) => x.iso)).toEqual(["2026-11-06"]);
    expect(tageImText("am Dienstag um 10", HEUTE).map((x) => x.iso)).toEqual(["2026-11-10"]);
  });
  it("Absage wegen Krankheit (morgen)", () => {
    expect(terminBezug("ich muss den Termin morgen leider absagen, bin krank.", HEUTE)).toEqual({ art: "absage", tag: "2026-11-07", uhrzeit: null, neuerTag: null, neueUhrzeit: null });
  });
  it("Verschiebung mit altem und neuem Tag; Vorschlag; Bestätigung", () => {
    expect(terminBezug("Können wir den Termin vom 10.11. auf den 12.11. um 15:00 verschieben?", HEUTE)).toMatchObject({ art: "verschiebung", tag: "2026-11-10", neuerTag: "2026-11-12", neueUhrzeit: "15:00" });
    expect(terminBezug("Hätten Sie Dienstag um 10:30 Zeit für einen Termin?", HEUTE)).toMatchObject({ art: "vorschlag", neuerTag: "2026-11-10", neueUhrzeit: "10:30" });
    expect(terminBezug("Ich bestätige den Termin am 12.11. um 09:00.", HEUTE)).toMatchObject({ art: "bestaetigung", tag: "2026-11-12", uhrzeit: "09:00" });
    expect(terminBezug("Danke für das Paket!", HEUTE)).toBeNull();
  });
  it("findet den Termin über Tag und Namen – sonst keinen", () => {
    const termine = [
      { id: "a", data: { day: "2026-11-07", time: "10:00", title: "Physio Probe", status: "geplant" } },
      { id: "b", data: { day: "2026-11-07", time: "15:00", title: "Zahnarzt", status: "geplant" } },
      { id: "c", data: { day: "2026-11-09", time: "09:00", title: "Coaching Probe", status: "geplant" } },
    ];
    expect(terminFinden(termine, { tag: "2026-11-07", name: "Petra Probe", adresse: "petra.probe@example.com", heute: HEUTE })?.id).toBe("a");
    expect(terminFinden(termine, { tag: "2026-11-07", name: "Max Muster", adresse: "max@example.com", heute: HEUTE })).toBeNull();
    expect(terminFinden(termine, { tag: null, name: "Petra Probe", adresse: "x@example.com", heute: HEUTE })?.id).toBe("a");
  });
});

describe("Entwurf und Zusammenfassung", () => {
  it("Vorlage: Absage → gute Besserung + neuer Termin, Unterschrift; Du-Form", () => {
    const t = terminBezug("muss morgen leider absagen, bin krank", HEUTE);
    const sie = entwurfVorlage({ anrede: "sie", name: "Petra Probe", adresse: "petra.probe@example.com", termin: t, slots: [], unterschrift: "Ina Inhaber" });
    expect(sie).toMatch(/^Guten Tag Petra Probe,/);
    expect(sie).toContain("gute Besserung");
    expect(sie.trim().endsWith("Ina Inhaber")).toBe(true);
    const du = entwurfVorlage({ anrede: "du", name: "Petra Probe", adresse: "p@example.com", termin: t, slots: freieSlots([], HEUTE), unterschrift: "Ina" });
    expect(du).toMatch(/^Hallo Petra,/);
    expect(du).toContain("Montag, 09.11. um 10:00 Uhr");
  });
  it("freie Slots meiden belegte Zeiten und Wochenenden", () => {
    expect(freieSlots([{ day: "2026-11-09", time: "09:30", to: "11:00" }], HEUTE)).toEqual([{ tag: "2026-11-09", uhrzeit: "14:00" }, { tag: "2026-11-10", uhrzeit: "10:00" }]);
  });
  it("KI-Antwort lesen, Zusammenfassung ohne KI, Betreff", () => {
    expect(entwurfLesen('```json\n{"zusammenfassung":"Absage morgen","entwurf":"Hallo"}\n```')).toEqual({ zusammenfassung: "Absage morgen", entwurf: "Hallo" });
    expect(entwurfLesen("kein JSON")).toBeNull();
    expect(zusammenfassungVorlage("Hallo Ina,\nich muss den Termin morgen leider absagen. Bin krank.")).toBe("ich muss den Termin morgen leider absagen.");
    expect(betreffKern("AW: Re: Termin morgen")).toBe("termin morgen");
    expect(antwortBetreff("Termin morgen")).toBe("Re: Termin morgen");
    expect(antwortBetreff("AW: Termin")).toBe("AW: Termin");
  });
});

describe("Morgenbericht und Meldearten", () => {
  it("persönliche Nachrichten nur als Anzahl, vorne", async () => {
    const { morgenText, MELDE_ARTEN } = await import("@/lib/push/logic");
    expect(morgenText({ ueberNacht: 0, fristen: 2, wichtig: 0, paletten: 0, persoenlich: 1 })).toBe("1 persönliche Nachricht wartet · 2 Fristen heute.");
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 0, persoenlich: 3 })).toBe("3 persönliche Nachrichten warten.");
    expect(morgenText({ ueberNacht: 0, fristen: 0, wichtig: 0, paletten: 0 })).toBe("Nichts Dringendes – guten Start!");
    expect(MELDE_ARTEN.map((a) => a.key)).toEqual(expect.arrayContaining(["persoenlich", "mail_entwurf"]));
  });
});
