import { describe, expect, it } from "vitest";
import { bqoolErgebnisText, bqoolStatusAusProtokoll } from "@/lib/automatik/bqool-logic";
import { jsonFehler, UPLOAD_ERFOLG, UPLOAD_FEHLER, uploadBewerten } from "@/lib/automatik/upload-logic";

// Befund 02.11.: BQool-Upload hat geklappt, die Automatik meldete „Keine Erfolgsmeldung“. Erfundene Dateinamen.
const VERLAUF = "Upload\nalt_1.txt Completed\nalt_2.txt Failed";
const basis = { vorher: VERLAUF, jetzt: VERLAUF, neu: "", datei: "BQool_DE_2026-11-02.txt", antworten: [], erfolg: UPLOAD_ERFOLG, fehler: UPLOAD_FEHLER, fertig: false };

describe("Upload-Erkennung", () => {
  it("feste Texte der Seite (Verlauf mit Completed/Failed) zählen weder als Erfolg noch als Fehler", () => {
    expect(uploadBewerten(basis)).toEqual({ art: "offen" });
  });
  it("neuer Erfolgstext – auch ein Hinweis, der schon wieder weg ist", () => {
    expect(uploadBewerten({ ...basis, jetzt: `${VERLAUF}\nImport erfolgreich` })).toMatchObject({ art: "ok", wie: "text" });
    expect(uploadBewerten({ ...basis, neu: "Your file has been submitted." })).toMatchObject({ art: "ok", wie: "text", grund: "Your file has been submitted." });
  });
  it("neuer Fehlertext oder abgelehnte Upload-Anfrage → Fehler (vor Erfolg)", () => {
    expect(uploadBewerten({ ...basis, jetzt: `${VERLAUF}\nImport fehlgeschlagen: Datei ungültig` })).toMatchObject({ art: "fehler" });
    expect(uploadBewerten({ ...basis, antworten: [{ methode: "POST", status: 500, mitDatei: true }] })).toMatchObject({ art: "fehler", grund: "vom Server abgelehnt (HTTP 500)" });
    expect(uploadBewerten({ ...basis, antworten: [{ methode: "POST", status: 200, mitDatei: true, fehlerText: "Invalid header line" }], neu: "submitted" })).toMatchObject({ art: "fehler", grund: "vom Server abgelehnt: Invalid header line" });
  });
  it("Dateiname neu in der Upload-Liste → ok", () => {
    expect(uploadBewerten({ ...basis, jetzt: `${VERLAUF}\nBQool_DE_2026-11-02.txt Pending` })).toMatchObject({ art: "ok", wie: "liste" });
  });
  it("Server hat angenommen: erst am Ende ok („vom Server angenommen“), vorher noch warten", () => {
    const a = { ...basis, antworten: [{ methode: "POST", status: 200, mitDatei: true }] };
    expect(uploadBewerten(a)).toEqual({ art: "offen" });
    expect(uploadBewerten({ ...a, fertig: true })).toMatchObject({ art: "ok", wie: "server" });
    // Anfragen ohne Datei (z. B. Statistik) zählen nicht
    expect(uploadBewerten({ ...basis, fertig: true, antworten: [{ methode: "POST", status: 200, mitDatei: false }] })).toMatchObject({ art: "offen", grund: "keine Upload-Anfrage gesehen" });
  });
  it("JSON-Antwort mit success:false bzw. error", () => {
    expect(jsonFehler('{"success":false,"message":"Bad file"}')).toBe("Bad file");
    expect(jsonFehler('{"success":true,"code":0}')).toBeNull();
    expect(jsonFehler('{"error":"quota"}')).toBe("quota");
    expect(jsonFehler("<html>")).toBeNull();
  });
  it("„nicht erfolgreich“ ist ein Fehler, kein Erfolg", () => {
    expect(uploadBewerten({ ...basis, neu: "Upload nicht erfolgreich" })).toMatchObject({ art: "fehler" });
  });
});

describe("BQool: Status und Text je Land", () => {
  it("unklar = bitte prüfen, kein Fehler; von Hand bestätigt → fertig", () => {
    const p = [
      { zeit: "2026-11-02T10:00:00Z", land: "DE", ok: false, unklar: true },
      { zeit: "2026-11-02T10:01:00Z", land: "FR", ok: true },
    ];
    expect(bqoolStatusAusProtokoll(p)).toBe("pruefen");
    expect(bqoolStatusAusProtokoll([{ ...p[0], ok: true, unklar: undefined }, p[1]])).toBe("fertig");
    expect(bqoolStatusAusProtokoll([{ zeit: "2026-11-02T10:00:00Z", land: "DE", ok: false }, p[1]])).toBe("teilweise");
    // Neuerer Lauf für dasselbe Land zählt
    expect(bqoolStatusAusProtokoll([{ zeit: "2026-11-02T09:00:00Z", land: "DE", ok: false }, { zeit: "2026-11-02T11:00:00Z", land: "DE", ok: true }])).toBe("fertig");
    expect(bqoolErgebnisText([{ land: "DE", datei: "x.txt", zeilen: 137, ok: false, unklar: true }])).toBe("DE: 137 Zeilen hochgeladen, Bestätigung nicht erkannt – bitte in BQool prüfen");
  });
});
