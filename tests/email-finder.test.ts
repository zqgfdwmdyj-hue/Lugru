import { describe, expect, it } from "vitest";
import { bestEmail, contactLinks, decodeCfEmail, domainFromName, extractEmails, rankEmail } from "@/lib/leads/email-finder";

const cf = (email: string, key = 0x2a) => key.toString(16).padStart(2, "0") + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");

describe("E-Mail-Adressen finden", () => {
  it("normale, verlinkte und verschleierte Adressen", () => {
    const html = `<p>Kontakt: <a href="mailto:Info@Firma-Test.example?subject=Hallo">schreiben</a></p>
      <p>Einkauf: einkauf [at] firma-test [dot] example</p>
      <p>Vertrieb: vertrieb(at)firma-test.example</p>
      <p>B2B: b2b &#64; firma-test&#46;example</p>
      <p>Händler: haendler {at} firma-test {dot} example</p>
      <p>Datenschutz: datenschutz@firma-test.example</p>
      <img src="/img/logo@2x.png">`;
    const mails = extractEmails(html, "https://www.firma-test.example/impressum").map((f) => f.email).sort();
    expect(mails).toEqual(["b2b@firma-test.example", "datenschutz@firma-test.example", "einkauf@firma-test.example", "haendler@firma-test.example", "info@firma-test.example", "vertrieb@firma-test.example"]);
  });
  it("Cloudflare-Schutz", () => {
    expect(decodeCfEmail(cf("shop@cf-test.example"))).toBe("shop@cf-test.example");
    const html = `<a href="/cdn-cgi/l/email-protection#${cf("kontakt@cf-test.example")}">[email&#160;protected]</a><span class="__cf_email__" data-cfemail="${cf("info@cf-test.example", 0x51)}">[email protected]</span>`;
    expect(extractEmails(html, "https://cf-test.example/").map((f) => f.email).sort()).toEqual(["info@cf-test.example", "kontakt@cf-test.example"]);
  });
  it("die beste Adresse für eine Einkaufsanfrage", () => {
    const site = "https://www.firma-test.example/";
    const f = (email: string, page = "https://www.firma-test.example/impressum") => ({ email, how: "Text", page });
    expect(bestEmail([f("datenschutz@firma-test.example"), f("info@firma-test.example"), f("einkauf@firma-test.example")], site)?.email).toBe("einkauf@firma-test.example");
    expect(bestEmail([f("info@firma-test.example"), f("info@agentur-webdesign.example")], site)?.email).toBe("info@firma-test.example");
    expect(bestEmail([f("noreply@firma-test.example"), f("jobs@firma-test.example")], site)).toBeNull();
    expect(rankEmail(f("sales@shop.firma-test.example"), site)).toBeGreaterThan(rankEmail(f("sales@andere.example"), site));
  });
  it("Domain im Firmennamen, Impressum-/Kontakt-Links", () => {
    expect(domainFromName("AllesfurHaare.DE Dresden GmbH")).toBe("allesfurhaare.de");
    expect(domainFromName("Muster Beauty GmbH")).toBeNull();
    const links = contactLinks(`<a href="/ueber-uns">Über uns</a><a href="https://www.firma-test.example/impressum">Impressum</a><a href="/kontakt/">Kontakt</a><a href="https://facebook.com/x">FB</a><a href="/produkte">Produkte</a>`, "https://www.firma-test.example/");
    expect(links).toEqual(["https://www.firma-test.example/impressum", "https://www.firma-test.example/kontakt/", "https://www.firma-test.example/ueber-uns"]);
  });
});
