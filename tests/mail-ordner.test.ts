import { describe, expect, it } from "vitest";
import { AMAZON_ABSENDER, amazonMailWarnung, empfaengerAus, gueltigeOrdner, mailFehlerArt, mailFehlerText, ordnerName, smtpAusweich, standardOrdner, type ImapOrdner } from "@/lib/mail/ordner";
import { explainMailError, presetForDomain, presetForMx } from "@/lib/mail/servers";

// B9.7/8: Postfach per IMAP mit App-Passwort – Ordner, Fehlerarten, Empfänger, Warnung ohne Amazon-Mails.
const gmail: ImapOrdner[] = [
  { path: "INBOX", name: "INBOX" },
  { path: "[Gmail]", name: "[Gmail]" },
  { path: "[Gmail]/Alle Nachrichten", name: "Alle Nachrichten", specialUse: "\\All" },
  { path: "[Gmail]/Gesendet", name: "Gesendet", specialUse: "\\Sent" },
  { path: "[Gmail]/Entwürfe", name: "Entwürfe", specialUse: "\\Drafts" },
  { path: "Amazon", name: "Amazon" },
];
const ionos: ImapOrdner[] = [
  { path: "INBOX", name: "INBOX" },
  { path: "Archiv", name: "Archiv", specialUse: "\\Archive" },
  { path: "Gesendete Objekte", name: "Gesendete Objekte", specialUse: "\\Sent" },
];

describe("Ordner", () => {
  it("Vorgabe: Gmail „Alle Nachrichten“, sonst Posteingang + Archiv", () => {
    expect(standardOrdner(gmail, "imap.gmail.com")).toEqual(["[Gmail]/Alle Nachrichten"]);
    expect(standardOrdner(ionos, "imap.ionos.de")).toEqual(["INBOX", "Archiv"]);
    expect(standardOrdner([{ path: "INBOX", name: "INBOX" }], "imap.example.invalid")).toEqual(["INBOX"]);
    // Englischsprachiges Gmail ohne SPECIAL-USE
    expect(standardOrdner([{ path: "INBOX", name: "INBOX" }, { path: "[Gmail]/All Mail", name: "All Mail" }], "imap.gmail.com")).toEqual(["[Gmail]/All Mail"]);
  });

  it("Auswahl: nur vorhandene, wählbare Ordner (keine Entwürfe/Gesendet), ohne Doppelte", () => {
    expect(gueltigeOrdner(["Amazon", "Amazon", "[Gmail]/Gesendet", "Gibt es nicht", "INBOX"], gmail)).toEqual(["Amazon", "INBOX"]);
    expect(gueltigeOrdner(["[Gmail]"], gmail)).toEqual([]);
  });

  it("Anzeigenamen", () => {
    expect(ordnerName("INBOX")).toBe("Posteingang");
    expect(ordnerName("[Gmail]/Alle Nachrichten")).toBe("Alle Nachrichten");
    expect(ordnerName("INBOX.Amazon")).toBe("Posteingang/Amazon");
  });
});

describe("Fehlerarten", () => {
  it.each([
    [{ authenticationFailed: true, message: "Command failed" }, "anmeldung"],
    [{ responseText: "Invalid credentials (Failure)" }, "anmeldung"],
    [{ response: "535 5.7.8 Username and Password not accepted" }, "anmeldung"],
    [{ responseText: "[ALERT] Your account is not enabled for IMAP use." }, "imap_aus"],
    [{ message: "IMAP access is disabled for this account" }, "imap_aus"],
    [{ code: "ETIMEDOUT", message: "connect ETIMEDOUT 192.0.2.1:465" }, "port"],
    [{ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }, "port"],
    [{ message: "Greeting never received" }, "port"],
    [{ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND imap.example.invalid" }, "server"],
    [{ message: "wrong version number" }, "tls"],
    [{ message: "Irgendwas anderes" }, "sonst"],
  ])("%o → %s", (e, art) => {
    expect(mailFehlerArt(e)).toBe(art);
  });

  it("Texte nennen Ursache und Abhilfe", () => {
    expect(mailFehlerText({ authenticationFailed: true }, "IMAP")).toMatch(/^IMAP: Anmeldung abgelehnt.*App-Passwort/);
    expect(mailFehlerText({ code: "ETIMEDOUT" }, "SMTP", 465)).toMatch(/Port 465 .*gesperrt/);
    expect(mailFehlerText({ message: "not enabled for IMAP use" }, "IMAP")).toMatch(/IMAP ist beim Anbieter ausgeschaltet/);
    expect(explainMailError({ code: "ENOTFOUND" }, "IMAP")).toBe("IMAP: Server nicht gefunden – Servername prüfen.");
  });

  it("SMTP weicht von 465 auf 587 (STARTTLS) aus und umgekehrt", () => {
    expect(smtpAusweich(465, true)).toEqual({ smtpPort: 587, smtpSecure: false });
    expect(smtpAusweich(587, false)).toEqual({ smtpPort: 465, smtpSecure: true });
    expect(smtpAusweich(25, false)).toBeNull();
  });
});

describe("Server-Erkennung", () => {
  it("bekannte Anbieter und eigene Domains über MX", () => {
    expect(presetForDomain("gmail.com")?.imapHost).toBe("imap.gmail.com");
    expect(presetForDomain("outlook.de")?.imapHost).toBe("outlook.office365.com");
    expect(presetForDomain("gmx.at")?.imapHost).toBe("imap.gmx.net");
    expect(presetForDomain("web.de")?.smtpPort).toBe(587);
    expect(presetForMx(["mx00.ionos.de."])?.provider).toBe("IONOS");
    expect(presetForMx(["smtpin.rzone.de", "mx.strato.de"])?.provider).toBe("STRATO");
    expect(presetForMx(["example-com.mail.protection.outlook.com"])?.provider).toMatch(/Microsoft/);
    expect(presetForMx(["aspmx.l.google.com"])?.provider).toMatch(/Google/);
  });
});

describe("Empfänger und Amazon-Warnung", () => {
  it("Empfangsadresse: Delivered-To vor „An“", () => {
    expect(empfaengerAus(["<Amazon@Test-Firma.example>"], ["info@test-firma.example"])).toBe("amazon@test-firma.example");
    expect(empfaengerAus([undefined, ""], ["Info@test-firma.example", "info@test-firma.example", "b@test-firma.example"])).toBe("info@test-firma.example, b@test-firma.example");
    expect(empfaengerAus([], [])).toBeNull();
  });

  it("Absender *@amazon.* erkennen", () => {
    expect(AMAZON_ABSENDER.test("seller-notification@amazon.de")).toBe(true);
    expect(AMAZON_ABSENDER.test("donotreply@marketplace.amazon.co.uk")).toBe(true);
    expect(AMAZON_ABSENDER.test("news@amazonfake.example")).toBe(false);
  });

  it("Warnung: kein Postfach, nie eine Amazon-Mail, seit über 7 Tagen keine", () => {
    const jetzt = new Date("2026-10-30T12:00:00Z");
    expect(amazonMailWarnung({ postfaecher: 0, letzte: null, jetzt })).toMatch(/Kein Postfach/);
    expect(amazonMailWarnung({ postfaecher: 1, letzte: null, jetzt })).toMatch(/^Noch keine Mail von \*@amazon\.\*/);
    expect(amazonMailWarnung({ postfaecher: 1, letzte: new Date("2026-10-20T12:00:00Z"), jetzt })).toMatch(/^Seit über 7 Tagen keine Mail/);
    expect(amazonMailWarnung({ postfaecher: 2, letzte: new Date("2026-10-29T08:00:00Z"), jetzt })).toBeNull();
  });
});
