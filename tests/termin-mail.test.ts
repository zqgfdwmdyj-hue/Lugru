import { describe, expect, it } from "vitest";
import { abfahrt, datumsangaben, konfliktMit, passtZu, terminAusMail, terminTitel, uhrzeitNach } from "@/lib/private/termin-mail";

// Erfundene Termin-Mails (keine echten Praxen oder Personen).
const H = "2026-10-30";

describe("Termin-Mails erkennen", () => {
  it("Doctolib-Bestätigung mit Praxis, Adresse, Person und „mitbringen“", () => {
    const t = terminAusMail(
      {
        from: "Doctolib <no-reply@doctolib.de>",
        subject: "Ihr Termin ist bestätigt",
        body: "Ihr Termin am Montag, 3. November 2026 um 09:30 Uhr bei Dr. Testmann ist bestätigt.\nPraxis Dr. Testmann, Musterstraße 12, 12345 Teststadt\nPatient: Alexandra\nBitte bringen Sie Ihre Versichertenkarte mit.",
      },
      H,
    )!;
    expect(t).toMatchObject({ dienst: "doctolib", art: "bestaetigung", tag: "2026-11-03", uhrzeit: "09:30", bei: "Dr. Testmann", adresse: "Musterstraße 12, 12345 Teststadt", person: "Alexandra", mit: "arzt" });
    expect(t.mitbringen).toContain("Versichertenkarte");
    expect(terminTitel(t)).toBe("Arzttermin – Dr. Testmann");
  });
  it("Verschiebung: alter und neuer Tag; Absage; Erinnerung", () => {
    const v = terminAusMail({ from: "praxis@example.invalid", subject: "Ihr Termin wurde verschoben", body: "Ihr Termin bei Dr. Testmann am 03.11.2026 wurde auf den 05.11.2026 um 14:15 Uhr verschoben." }, H)!;
    expect(v).toMatchObject({ art: "verschoben", alterTag: "2026-11-03", tag: "2026-11-05", uhrzeit: "14:15" });
    const a = terminAusMail({ from: "Doctolib <no-reply@doctolib.de>", subject: "Ihr Termin wurde abgesagt", body: "Ihr Termin am 05.11.2026 um 14:15 bei Dr. Testmann wurde abgesagt." }, H)!;
    expect(a).toMatchObject({ art: "abgesagt", tag: "2026-11-05" });
    const e = terminAusMail({ from: "Doctolib <no-reply@doctolib.de>", subject: "Erinnerung: Ihr Termin morgen", body: "Termin am 4.11. um 8:00 bei Praxis Sonnenschein" }, H)!;
    expect(e).toMatchObject({ art: "erinnerung", tag: "2026-11-04", uhrzeit: "08:00" });
  });
  it("Handwerker, Amt, Schule – und keine Termin-Mail", () => {
    expect(terminAusMail({ from: "service@heizung.example", subject: "Wartungstermin Heizung", body: "Unser Techniker kommt am 12.11.2026 zwischen 8:00 und 12:00." }, H)).toMatchObject({ dienst: "handwerker", mit: "sonst", tag: "2026-11-12", uhrzeit: "08:00" });
    expect(terminAusMail({ from: "termin@stadt.example", subject: "Terminbestätigung Bürgeramt", body: "Ihr Termin am 20.11.2026 um 10:40 Uhr im Bürgeramt." }, H)).toMatchObject({ dienst: "amt" });
    expect(terminAusMail({ from: "sekretariat@schule.example", subject: "Einladung Elternabend Klasse 2b", body: "Der Elternabend findet am 18.11.2026 um 19:30 Uhr statt." }, H)).toMatchObject({ dienst: "schule", mit: "familie", uhrzeit: "19:30" });
    expect(terminAusMail({ from: "news@shop.example", subject: "Black Week ab 20.11.", body: "Rabatte!" }, H)).toBeNull();
    expect(terminAusMail({ from: "praxis@example.invalid", subject: "Ihr Rezept liegt bereit", body: "Abholung jederzeit." }, H)).toBeNull();
  });
  it("Datum ohne Jahr in der Vergangenheit → nächstes Jahr; Uhrzeit „um 14 Uhr“", () => {
    expect(datumsangaben("am 5.1. um 14 Uhr", H)[0].iso).toBe("2027-01-05");
    expect(uhrzeitNach("am 5.1. um 14 Uhr", 0)).toBe("14:00");
    expect(passtZu({ day: "2026-11-03", title: "Arzttermin – Dr. Testmann" }, { dienst: "arzt", bei: "Dr. Testmann" }, "2026-11-03")).toBe(true);
    expect(passtZu({ day: "2026-11-04", title: "Arzttermin – Dr. Testmann" }, { dienst: "arzt", bei: "Dr. Testmann" }, "2026-11-03")).toBe(false);
  });
  it("Abfahrt und Überschneidung", () => {
    expect(abfahrt("09:30", 30)).toBe("09:00");
    expect(abfahrt("00:10", 30)).toBe("00:00");
    const andere = [{ day: "2026-11-03", time: "10:30", title: "Elternabend" }, { day: "2026-11-04", time: "09:30", title: "Anderer Tag" }];
    expect(konfliktMit(andere, "2026-11-03", "09:30")).toBe("Elternabend");
    expect(konfliktMit(andere, "2026-11-03", "08:00")).toBeNull();
    expect(konfliktMit(andere, "2026-11-03", null)).toBeNull();
  });
});
