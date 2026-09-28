import { describe, expect, it } from "vitest";
import { explainMailError, parseAutoconfig, presetForDomain, presetForMx } from "@/lib/mail/servers";

const ISPDB = `<?xml version="1.0"?><clientConfig version="1.1"><emailProvider id="example.de"><domain>example.de</domain><displayName>Beispiel Mail</displayName>
<incomingServer type="pop3"><hostname>pop.example.de</hostname><port>995</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
<incomingServer type="imap"><hostname>imap.example.de</hostname><port>143</port><socketType>STARTTLS</socketType><username>%EMAILLOCALPART%</username></incomingServer>
<incomingServer type="imap"><hostname>imap.example.de</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username></incomingServer>
<outgoingServer type="smtp"><hostname>smtp.example.de</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer>
</emailProvider></clientConfig>`;

describe("Mailserver ermitteln", () => {
  it("kennt die großen Anbieter", () => {
    expect(presetForDomain("gmx.de")).toMatchObject({ imapHost: "imap.gmx.net", smtpHost: "mail.gmx.net", smtpPort: 465 });
    expect(presetForDomain("icloud.com")).toMatchObject({ imapHost: "imap.mail.me.com", smtpPort: 587, smtpSecure: false });
    expect(presetForDomain("firma-xy.de")).toBeNull();
  });

  it("erkennt Google Workspace und IONOS am MX-Eintrag eigener Domains", () => {
    expect(presetForMx(["smtp.google.com"])).toMatchObject({ imapHost: "imap.gmail.com", provider: expect.stringContaining("Google") });
    expect(presetForMx(["aspmx.l.google.com."])).toMatchObject({ imapHost: "imap.gmail.com" });
    expect(presetForMx(["mx00.ionos.de"])).toMatchObject({ imapHost: "imap.ionos.de" });
    expect(presetForMx(["firma-de.mail.protection.outlook.com"])).toMatchObject({ imapHost: "outlook.office365.com" });
    expect(presetForMx(["mx.firma.de"])).toBeNull();
  });

  it("liest Thunderbird-Autoconfig und bevorzugt SSL", () => {
    expect(parseAutoconfig(ISPDB, "max@example.de")).toEqual({
      imapHost: "imap.example.de", imapPort: 993, imapSecure: true,
      smtpHost: "smtp.example.de", smtpPort: 587, smtpSecure: false,
      user: "max", provider: "Beispiel Mail",
    });
    expect(parseAutoconfig("<clientConfig/>", "a@b.de")).toBeNull();
  });

  it("übersetzt Fehlermeldungen", () => {
    expect(explainMailError({ authenticationFailed: true, message: "Command failed" }, "IMAP")).toMatch(/App-Passwort/);
    expect(explainMailError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND imap.x.de" }, "IMAP")).toMatch(/nicht gefunden/);
    expect(explainMailError({ responseText: "535 5.7.8 Username and Password not accepted" }, "SMTP")).toMatch(/^SMTP: Anmeldung abgelehnt/);
  });
});

describe("Anmeldung per Link einfügen", () => {
  it("liest code und state aus der localhost-Adresse", async () => {
    const { parsePastedRedirect } = await import("@/lib/oauth/paste");
    expect(parsePastedRedirect("http://localhost/?state=abc.def&code=4/0Ab-xyz&scope=email")).toEqual({ code: "4/0Ab-xyz", state: "abc.def", error: null });
    expect(parsePastedRedirect(" http://localhost/?error=access_denied&state=x ")).toMatchObject({ error: "access_denied" });
    expect(parsePastedRedirect("")).toEqual({ code: null, state: null, error: null });
  });
});
