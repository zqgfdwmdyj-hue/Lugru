import { describe, expect, it } from "vitest";
import {
  aufgabenText,
  eindeutig,
  erinnerungFaellig,
  faelligAus,
  hauptliste,
  inRuhezeit,
  leseEinordnung,
  lokal,
  naechsterWerktag,
  ohneBetraege,
  passendeAufgabe,
  reaktionsArt,
  rechnungenText,
  regelEinordnung,
  teilen,
  threadAntwortArt,
  trefferZeile,
  vaHeuteText,
} from "@/lib/va/logic";

const HEUTE = "2026-10-30"; // Freitag

describe("VA – Texte", () => {
  it("teilt lange Texte unter 2000 Zeichen", () => {
    const t = Array.from({ length: 100 }, (_, i) => `Zeile ${i} ${"x".repeat(40)}`).join("\n");
    const s = teilen(t);
    expect(s.length).toBeGreaterThan(1);
    expect(s.every((x) => x.length <= 1900)).toBe(true);
    expect(s.join("\n")).toBe(t);
    expect(teilen("y".repeat(4000)).every((x) => x.length <= 1900)).toBe(true);
  });

  it("Aufgabentext mit Erwähnung, Frist, Anleitung und Hinweis auf ✅", () => {
    const t = aufgabenText({ titel: "Remission prüfen", faellig: "2026-11-02", prioritaet: "critical", notiz: "3 Pakete", zusatz: "Bitte heute", link: null, anleitungen: [{ titel: "Remissionen", schritte: ["Bericht öffnen", "Pakete zählen"] }], anhaenge: ["foto.jpg"], vaId: "700000000000000001" });
    expect(t).toContain("<@700000000000000001>");
    expect(t).toContain("02.11.2026");
    expect(t).toContain("🔴 wichtig");
    expect(t).toContain("1. Bericht öffnen");
    expect(t).toContain("📎 Anhänge: foto.jpg");
    expect(t).toContain("✅");
  });

  it("entfernt Beträge für fremde Bereiche", () => {
    expect(ohneBetraege("Verlust 12,50 € je Stück, gesamt 1.234,00 EUR")).toBe("Verlust [Betrag] je Stück, gesamt [Betrag]");
  });
});

describe("VA – Antworten im Thread", () => {
  it("erkennt erledigt, Rückfrage und Notiz", () => {
    expect(threadAntwortArt("erledigt")).toBe("erledigt");
    expect(threadAntwortArt("✅ alles raus")).toBe("erledigt");
    expect(threadAntwortArt("Noch nicht erledigt, Paket fehlt")).toBe("notiz");
    expect(threadAntwortArt("Welche Adresse soll ich nehmen?")).toBe("rueckfrage");
    expect(threadAntwortArt("❓")).toBe("rueckfrage");
    expect(threadAntwortArt("Habe 2 von 3 gemacht")).toBe("notiz");
  });

  it("Reaktionen ohne die des Bots", () => {
    expect(reaktionsArt([{ emoji: { name: "✅" }, count: 1, me: false }]).erledigt).toBe(true);
    expect(reaktionsArt([{ emoji: { name: "✅" }, count: 1, me: true }]).erledigt).toBe(false);
    expect(reaktionsArt([{ emoji: { name: "❓" }, count: 1 }]).frage).toBe(true);
    expect(reaktionsArt(undefined)).toEqual({ erledigt: false, frage: false });
  });
});

describe("VA – Einordnung", () => {
  it("Rechnungs-Anfrage mit Marke und ASIN (Regeln)", () => {
    const e = regelEinordnung("Brauche die Rechnung für Nike B0999B7CCM", HEUTE, []);
    expect(e.art).toBe("bitte");
    expect(e.anfrage).toMatchObject({ typ: "rechnung", asin: "B0999B7CCM", marke: "Nike" });
  });

  it("Entscheidungsfrage ohne Daten-Anfrage", () => {
    const e = regelEinordnung("Soll ich den Fall bei Amazon nochmal eskalieren?", HEUTE, []);
    expect(e.art).toBe("frage");
    expect(e.anfrage).toBeNull();
  });

  it("Sendung, Smalltalk, Info mit passender Aufgabe", () => {
    expect(regelEinordnung("Wie viele fehlen bei FBA15ABCD12?", HEUTE, []).anfrage).toMatchObject({ typ: "sendung", sendung: "FBA15ABCD12" });
    expect(regelEinordnung("Danke! 👍", HEUTE, []).art).toBe("smalltalk");
    const info = regelEinordnung("Die Remission von Testmarke ist angekommen, Pakete gezählt", HEUTE, ["Remission Testmarke prüfen", "Rechnung anfordern"]);
    expect(info.art).toBe("info");
    expect(info.aufgabe).toBe(1);
  });

  it("liest die KI-Antwort und prüft Felder", () => {
    const e = leseEinordnung('Hier: {"art":"bitte","titel":"Rechnung","faellig":"2026-11-03","anfrage":{"typ":"rechnung","asin":"b0999b7ccm","marke":"Nike"},"aufgabe":null}', "x", HEUTE);
    expect(e?.anfrage?.asin).toBe("B0999B7CCM");
    expect(e?.faellig).toBe("2026-11-03");
    expect(leseEinordnung('{"art":"unsinn"}', "x", HEUTE)).toBeNull();
    expect(leseEinordnung('{"art":"frage","faellig":"2020-01-01"}', "Frage?", HEUTE)?.faellig).toBeNull();
  });

  it("Fälligkeit aus dem Text, sonst nächster Werktag", () => {
    expect(faelligAus("bis morgen bitte", HEUTE)).toBe("2026-10-31");
    expect(faelligAus("bis Montag", HEUTE)).toBe("2026-11-02");
    expect(faelligAus("bis 05.11.", HEUTE)).toBe("2026-11-05");
    expect(faelligAus("irgendwann", HEUTE)).toBeNull();
    expect(naechsterWerktag(HEUTE)).toBe("2026-11-02");
  });

  it("passende Aufgabe nur bei genug gemeinsamen Wörtern", () => {
    expect(passendeAufgabe("Rechnung Testlieferant angefragt", ["Remission prüfen", "Rechnung beim Testlieferant anfordern"])).toBe(2);
    expect(passendeAufgabe("Hallo", ["Remission prüfen"])).toBeNull();
  });
});

describe("VA – Zeiten und Erinnerungen", () => {
  it("lokale Zeit und Ruhezeit über Mitternacht", () => {
    expect(lokal(new Date("2026-10-30T05:30:00Z"), "Europe/Berlin")).toEqual({ datum: "2026-10-30", zeit: "06:30" });
    expect(lokal(new Date("2026-10-30T05:30:00Z"), "Asia/Manila")).toEqual({ datum: "2026-10-30", zeit: "13:30" });
    expect(inRuhezeit("06:30", "20:00", "08:00")).toBe(true);
    expect(inRuhezeit("21:00", "20:00", "08:00")).toBe(true);
    expect(inRuhezeit("12:00", "20:00", "08:00")).toBe(false);
    expect(inRuhezeit("13:00", "12:00", "14:00")).toBe(true);
  });

  it("Erinnerung am Fälligkeitstag einmal, überfällig täglich", () => {
    const b = { heute: HEUTE, letzte: null, ruhe: false, ueberfaelligTaeglich: true };
    expect(erinnerungFaellig({ ...b, faellig: HEUTE })).toBe("heute");
    expect(erinnerungFaellig({ ...b, faellig: HEUTE, letzte: HEUTE })).toBeNull();
    expect(erinnerungFaellig({ ...b, faellig: HEUTE, ruhe: true })).toBeNull();
    expect(erinnerungFaellig({ ...b, faellig: "2026-10-28" })).toBe("ueberfaellig");
    expect(erinnerungFaellig({ ...b, faellig: "2026-10-28", ueberfaelligTaeglich: false })).toBeNull();
    expect(erinnerungFaellig({ ...b, faellig: "2026-11-02" })).toBeNull();
  });

  it("Feierabend-Zeile", () => {
    expect(vaHeuteText({ erledigt: 6, rueckfragen: 2, auto: 3 })).toBe("VA heute: 6 erledigt, 2 Rückfragen, 3 automatisch beantwortet");
    expect(vaHeuteText({ erledigt: 0, rueckfragen: 1, auto: 0, offen: 1 })).toContain("1 Rückfrage,");
  });
});

describe("VA – Antworten aus Ergebnissen", () => {
  it("Hauptliste, Zeile ohne Links/IDs, Eindeutigkeit", () => {
    const r = { datenstand: {}, sendungen: [{ id: "123e4567-e89b-12d3-a456-426614174000", name: "Testsendung", fehlmenge: 2, link: "https://x" }] };
    const l = hauptliste(r)!;
    expect(l).toHaveLength(1);
    expect(trefferZeile(l[0])).toBe("• name: Testsendung · fehlmenge: 2");
    expect(hauptliste({ produkte: [] })).toEqual([]);
    expect(eindeutig(0, true)).toBe("keins");
    expect(eindeutig(2, true)).toBe("ok");
    expect(eindeutig(4, true)).toBe("mehrdeutig");
    expect(eindeutig(5, false)).toBe("ok");
  });

  it("Rechnungs-Antwort", () => {
    const t = rechnungenText("Nike B0999B7CCM", [{ datum: "2026-09-01", lieferant: "Testlieferant", nummer: "RE-1", datei: "re1.pdf" }], 1);
    expect(t).toContain("01.09.2026 · Testlieferant · Nr. RE-1");
    expect(t).toContain("Datei hängt an");
  });
});
