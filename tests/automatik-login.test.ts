import { describe, expect, it } from "vitest";
import { ANMELDE_KNOPF, CAPTCHA_TITEL, COOKIE_KNOPF, DEBUG_NAME, debugAbgelaufen, debugName, mitBildschirmfoto, seiteOhneQuery } from "@/lib/automatik/login-logic";

// B24: Anmeldung der Browser-Automatik – Captcha, Cookie-Banner, Knöpfe, Bildschirmfoto-Namen und -Aufbewahrung.

describe("Erkennung", () => {
  it("Browser-Prüfung am Seitentitel", () => {
    for (const t of ["Just a moment...", "Attention Required! | Cloudflare", "Nur einen Moment …", "Checking your browser"]) expect(CAPTCHA_TITEL.test(t)).toBe(true);
    for (const t of ["BQool – Login", "Anmelden | sellerboard", "Export"]) expect(CAPTCHA_TITEL.test(t)).toBe(false);
  });
  it("Cookie-Banner-Knöpfe, aber keine anderen Knöpfe", () => {
    for (const t of ["Akzeptieren", "Alle akzeptieren", "Accept all", "Accept All Cookies", "Allow all", "Alle Cookies zulassen", "Zustimmen", "OK, verstanden", "Got it"]) expect(COOKIE_KNOPF.test(t)).toBe(true);
    for (const t of ["Ablehnen", "Einstellungen", "Log in", "Mehr erfahren"]) expect(COOKIE_KNOPF.test(t)).toBe(false);
  });
  it("Anmelde-Knopf am Text", () => {
    for (const t of ["Log in", "Login", "Anmelden", "Sign in", "Einloggen", "Weiter"]) expect(ANMELDE_KNOPF.test(t)).toBe(true);
    for (const t of ["Passwort vergessen?", "Registrieren", "Alle akzeptieren"]) expect(ANMELDE_KNOPF.test(t)).toBe(false);
  });
});

describe("Bildschirmfoto bei Fehlschlag", () => {
  it("Name aus Zeit + Dienst, nur sichere Zeichen; Route prüft das Muster", () => {
    const n = debugName(new Date("2026-11-01T12:00:05Z"), "BQool – Verbindung testen", "A1b2C3d4");
    expect(n).toBe("2026-11-01-12-00-05-bqool-verbindung-testen-a1b2c3");
    expect(DEBUG_NAME.test(n)).toBe(true);
    expect(DEBUG_NAME.test("../../etc/passwd")).toBe(false);
    expect(DEBUG_NAME.test("2026-11-01-12-00-05-x.png")).toBe(false);
  });
  it("Adresse ohne Abfrageteil (keine Tokens in Meldungen)", () => {
    expect(seiteOhneQuery("https://mc.bqool.com/login?token=geheim&x=1")).toBe("https://mc.bqool.com/login");
    expect(seiteOhneQuery("kaputt?x=1")).toBe("kaputt");
  });
  it("Meldung verweist auf Bild, Titel und Adresse", () => {
    expect(mitBildschirmfoto("Anmeldeformular nicht gefunden", { pfad: "/import/debug/x.png", titel: "BQool", url: "https://mc.bqool.com/login" })).toBe("Anmeldeformular nicht gefunden – Bildschirmfoto: /import/debug/x.png (Seite „BQool“, https://mc.bqool.com/login)");
    expect(mitBildschirmfoto("Fehler", null)).toBe("Fehler");
  });
  it("nach 7 Tagen gelöscht", () => {
    const jetzt = new Date("2026-11-08T12:00:00Z");
    expect(debugAbgelaufen(new Date("2026-11-01T11:59:00Z"), jetzt)).toBe(true);
    expect(debugAbgelaufen(new Date("2026-11-01T12:01:00Z"), jetzt)).toBe(false);
  });
});
