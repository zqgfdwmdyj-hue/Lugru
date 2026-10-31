// Herzstück (Bauaufträge Modul 1, 2, 4, 5, 7, 10) – Abnahmen mit erfundenen Daten: Tagesplan mit Kinderzeit und
// Auszeit, Delegieren an die Assistenz, Deal-Ampel, Fristen & Verträge, Buchhaltung (Sparkasse + Amex → Abgleich
// ≥ 80 %, Festschreibung, DATEV), Feierabend.
import type { Page } from "@playwright/test";
import { alsPerson, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const berlin = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const HEUTE = berlin(new Date());
/** Ein Mittwoch weit weg von anderen Prüfungen (≥ 40 Tage), Donnerstag danach. */
const MITTWOCH = (() => {
  let d = plus(HEUTE, 40);
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 3) d = plus(d, 1);
  return d;
})();
const DONNERSTAG = plus(MITTWOCH, 1);
/** Nächster Werktag frühestens übermorgen (Arbeitszeit Mo–Fr). */
const WERKTAG = (() => {
  let d = plus(HEUTE, 2);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = plus(d, 1);
  return d;
})();
const tenant = async () => (await sql<{ id: string }>("select id from tenants order by created_at limit 1"))[0].id;
const nutzer = async (login: string) => (await sql<{ id: string }>("select id from users where email = $1", [login]))[0].id;
const chip = (p: Page, name: string, value: string) => p.locator(`label:has(input[name="${name}"][value="${value}"])`).click();
async function aufgabe(titel: string, o: { faellig?: string; aufwand?: string; prioritaet?: string; schluessel?: string } = {}) {
  const [r] = await sql<{ id: string }>("insert into tasks (tenant_id, title, due_date, aufwand, priority, system_key, category) values ($1, $2, $3, $4, $5, $6, 'eigene') returning id", [await tenant(), titel, o.faellig ?? null, o.aufwand ?? null, o.prioritaet ?? "normal", o.schluessel ?? null]);
  return r.id;
}

test.describe("Herzstück", () => {
  test("Tagesplan (Abnahme): 3 Std. Kinderzeit → nur 5 Std. eingeplant, Rest verschoben; Frist in Auszeit → Konflikt; Privates nur „belegt“", async ({ page }) => {
    const m = marke();
    await anmelden(page, "inhaber");
    // Kinderzeit 9–12 Uhr am Mittwoch (Ina = Inhaberin), Auszeit ganztägig am Donnerstag
    await page.goto(`/privat/eintragen?art=kinder&tag=${MITTWOCH}`);
    await chip(page, "person", "a");
    await page.fill("#f-from", "09:00");
    await page.fill("#f-to", "12:00");
    await page.fill("#f-what", `Zoo ${m}`);
    await Promise.all([page.waitForURL(/\/privat\/kalender/), page.click('[data-testid="entry-form"] button[type=submit]')]);
    await page.goto(`/privat/eintragen?art=auszeit&tag=${DONNERSTAG}`);
    await chip(page, "person", "a");
    await page.fill("#f-from", "08:00");
    await page.fill("#f-to", "18:00");
    await Promise.all([page.waitForURL(/\/privat\/kalender/), page.click('[data-testid="entry-form"] button[type=submit]')]);
    // Zwei große Aufgaben (je halber Tag) am Mittwoch, eine Frist am Donnerstag
    await aufgabe(`L1 ${m}`, { faellig: MITTWOCH, aufwand: "L" });
    await aufgabe(`L2 ${m}`, { faellig: MITTWOCH, aufwand: "L" });
    await aufgabe(`Frist ${m}`, { faellig: DONNERSTAG, aufwand: "S" });

    await page.goto(`/kalender/tagesplan?tag=${MITTWOCH}`);
    await expect(page.getByTestId("tagesplan-kapazitaet")).toContainText("Kapazität 5 Std.");
    await expect(page.getByTestId("tagesplan-geplant")).toContainText(`L1 ${m}`);
    await expect(page.getByTestId("tagesplan-geplant")).not.toContainText(`L2 ${m}`);
    await expect(page.getByTestId("tagesplan-verschoben")).toContainText(`L2 ${m}`);
    // Privates nur als „Privat belegt“, ohne Details
    await expect(page.getByTestId("tagesplan-sperren")).toContainText("Privat belegt");
    await expect(page.locator("body")).not.toContainText(`Zoo ${m}`);
    // Konflikt am Donnerstag: Frist fällt in die (private) Auszeit
    await page.goto(`/kalender/tagesplan?tag=${DONNERSTAG}`);
    await expect(page.getByTestId("tagesplan-konflikte")).toContainText(`Frist ${m}`);
    await expect(page.getByTestId("tagesplan-konflikte")).toContainText("Frist fällt in");
    // Woche mit Ampel je Tag
    await expect(page.getByTestId("tagesplan-woche").locator("[data-ampel]")).toHaveCount(7);
  });

  test("Delegieren: Regel beim ersten Mal bestätigen, danach automatisch; Ludwig sieht „wartet auf“, Assistenz keine Buchhaltung", async ({ page, browser }) => {
    const m = marke();
    await anmelden(page, "inhaber");
    const a1 = await aufgabe(`Ansprüche ${m}`, { faellig: WERKTAG, schluessel: `claims-e2e-${m}` });
    await page.goto("/delegation");
    await page.getByTestId("deleg-vorlage").selectOption("schluessel:claims");
    await page.getByTestId("deleg-person").selectOption({ label: "Bea Büro" });
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("deleg-regel-speichern").click()]);
    const zeile = page.getByTestId("deleg-vorschlaege").locator("tr", { hasText: `Ansprüche ${m}` });
    await expect(zeile).toContainText("Bea Büro");
    await zeile.getByTestId("deleg-immer").click();
    await expect(page.locator('[role="status"]')).toContainText("Abgegeben");
    const bea = await nutzer("buero");
    expect((await sql<{ assignee_id: string }>("select assignee_id from tasks where id = $1", [a1]))[0].assignee_id).toBe(bea);
    await expect(page.getByTestId("deleg-regeln")).toContainText("automatisch");
    // Zweite Aufgabe derselben Art geht ohne Rückfrage an die Assistenz
    const a2 = await aufgabe(`Ansprüche 2 ${m}`, { faellig: WERKTAG, schluessel: `claims-e2e2-${m}` });
    await page.goto("/delegation");
    expect((await sql<{ assignee_id: string }>("select assignee_id from tasks where id = $1", [a2]))[0].assignee_id).toBe(bea);
    await expect(page.getByTestId("deleg-woche")).toContainText("Bea Büro");
    // Ludwig: eigene Aufgaben im Plan, die abgegebenen unter „Wartet auf …“
    await page.goto(`/kalender/tagesplan?tag=${WERKTAG}`);
    await expect(page.getByTestId("tagesplan-wartet")).toContainText("Bea Büro");
    await expect(page.getByTestId("tagesplan-tag")).not.toContainText(`Ansprüche ${m}`);
    // Assistenz: sieht ihre Aufgaben im Tagesplan, aber keine Buchhaltung/Kontodaten
    const va = await alsPerson(browser, "buero");
    await va.goto(`/kalender/tagesplan?tag=${WERKTAG}`);
    await expect(va.getByTestId("tagesplan-tag")).toContainText(`Ansprüche ${m}`);
    await va.goto("/buchhaltung");
    await expect(va.getByTestId("bh-kpi")).toHaveCount(0);
  });

  test("Deal-Ampel: ASIN + EK → Ampel mit Begründung und Länder-Tabelle", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/lieferanten/deal-ampel");
    await page.getByTestId("deal-ampel-code").fill("https://www.amazon.de/dp/B0TEST0003/ref=x");
    await page.getByTestId("deal-ampel-ek").fill("9,99");
    await page.getByTestId("deal-ampel-menge").fill("40");
    await Promise.all([page.waitForURL(/code=/), page.getByTestId("deal-ampel-pruefen").click()]);
    await expect(page.getByTestId("deal-ampel")).toHaveAttribute("data-ampel", /gruen|gelb|rot/);
    await expect(page.getByTestId("deal-ampel-begruendung")).toContainText("Bestes Land");
    await expect(page.getByTestId("deal-ampel-laender").locator("tbody tr")).toHaveCount(4);
  });

  test("Fristen & Verträge: Vorsorge „fällig in 3 Wochen – buchen?“, Vertrag mit Kündigungsfrist, Fixkosten; Claude nur mit Privat-Freigabe", async ({ page, browser, baseURL }) => {
    const m = marke();
    await anmelden(page, "inhaber");
    // Zahnarzt: zuletzt vor 6 Monaten minus 3 Wochen → fällig in 3 Wochen
    const faellig = new Date(Date.parse(`${plus(HEUTE, 21)}T12:00:00Z`));
    faellig.setUTCMonth(faellig.getUTCMonth() - 6);
    await page.goto("/privat/fristen?neu=vorsorge");
    await page.locator('[data-testid="frist-form"] input[name="was"]').fill(`Zahnarzt ${m}`);
    await page.locator('[data-testid="frist-form"] input[name="person"]').fill("Ina");
    await page.locator('[data-testid="frist-form"] input[name="intervall"]').fill("6");
    await page.locator('[data-testid="frist-form"] input[name="zuletzt"]').fill(faellig.toISOString().slice(0, 10));
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("frist-speichern").click()]);
    await expect(page.getByTestId("fristen-jetzt")).toContainText(`Zahnarzt ${m} Ina fällig in 3 Wochen – buchen?`);
    // Vertrag: Laufzeit bis in 60 Tagen, 4 Wochen Kündigungsfrist, 12 Wochen vorher erinnern
    await page.goto("/privat/fristen?neu=vertrag");
    await page.locator('[data-testid="frist-form"] input[name="anbieter"]').fill(`Testfunk ${m}`);
    await page.locator('[data-testid="frist-form"] input[name="was"]').fill("Handy");
    await page.locator('[data-testid="frist-form"] input[name="kosten"]').fill("29,99");
    await page.locator('[data-testid="frist-form"] input[name="laufzeit_bis"]').fill(plus(HEUTE, 60));
    await page.locator('[data-testid="frist-form"] input[name="verlaengerung"]').fill("1");
    await page.locator('[data-testid="frist-form"] input[name="kuendigungsfrist"]').fill("4");
    await page.locator('[data-testid="frist-form"] input[name="erinnerung"]').fill("12");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("frist-speichern").click()]);
    await expect(page.getByTestId("fristen-jetzt")).toContainText(`Testfunk ${m}: Kündigungsfrist endet`);
    await expect(page.getByTestId("fristen-fixkosten")).toContainText("29,99");
    await page.goto("/privat");
    await expect(page.getByTestId("start-fristen")).toBeVisible();
    // Claude: mit Privat-Freigabe sichtbar, ohne nicht
    const mit = await mcpVerbinden(browser, baseURL!, "inhaber", { privat: true });
    expect(await mit.call("fristen", {})).toContain(`Zahnarzt ${m}`);
    const ohne = await mcpVerbinden(browser, baseURL!, "inhaber");
    expect(await ohne.tools()).not.toContain("fristen");
  });

  test("Buchhaltung (Abnahme): Sparkasse + Amex eines Monats → ≥ 80 % automatisch, Rest als To-do; Festschreiben sperrt; DATEV-Export", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const t = await tenant();
    // Ein Monat weit zurück (keine Überschneidung mit anderen Prüfungen)
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 5);
    const monat = d.toISOString().slice(0, 7);
    const tag = (n: number) => `${monat}-${String(n).padStart(2, "0")}`;
    const de = (n: number) => `${String(n).padStart(2, "0")}.${monat.slice(5)}.${monat.slice(2, 4)}`;
    // Belege (erfunden)
    const beleg = (nr: string, datum: string, brutto: number, netto: number, vendor: string, kind: string) =>
      sql("insert into invoices (tenant_id, source, file_name, kind, status, doc_type, invoice_date, invoice_number, total_gross, total_net, vendor) values ($1, 'upload', $2, $3, 'new', 'rechnung', $4, $5, $6, $7, $8)", [t, `${nr}.pdf`, kind, datum, nr, brutto, netto, vendor]);
    await beleg("RE-T-0815", tag(1), 119, 100, "Testlieferant GmbH", "goods");
    await beleg("A-77", tag(5), 59.5, 50, "Kartonwelt Test GmbH", "expense");
    await beleg("SW-1", tag(5), 29.99, 25.2, "Testsoftware Ltd", "expense");
    await beleg("H-9", tag(12), 70.01, 65.43, "Testhotel", "expense");
    await sql("insert into amazon_settlements (tenant_id, settlement_id, deposit_date, total_amount, currency) values ($1, 'TEST-SET-1', $2, 4321.09, 'EUR')", [t, `${tag(8)}T10:00:00Z`]);
    const KOPF = '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
    const z = (n: number, text: string, zweck: string, name: string, betrag: string) => `"DE00123456780000000009";"${de(n)}";"${de(n)}";"${text}";"${zweck}";"";"";"";"";"";"";"${name}";"DE00999999990000000002";"TESTDEFFXXX";"${betrag}";"EUR";"Umsatz gebucht"`;
    const sparkasse = [
      KOPF,
      z(3, "UEBERWEISUNG", "Rechnung RE-T-0815", "Testlieferant GmbH", "-119,00"),
      z(7, "UEBERWEISUNG", "Kd 123", "Kartonwelt Test GmbH", "-59,50"),
      z(9, "GUTSCHRIFT", "Auszahlung", "AMAZON PAYMENTS EUROPE S.C.A.", "4.321,09"),
      z(16, "LASTSCHRIFT", "Kartenabrechnung", "American Express Europe S.A.", "-100,00"),
      z(20, "UEBERWEISUNG", "", "Unbekannt Test", "-77,70"),
      z(28, "ENTGELT", "Entgeltabschluss", "Sparkasse Test", "-12,90"),
    ].join("\r\n");
    const amex = ["Datum,Beschreibung,Betrag", `05/${monat.slice(5)}/${monat.slice(0, 4)},TESTSOFTWARE ABO,"29,99"`, `12/${monat.slice(5)}/${monat.slice(0, 4)},TESTHOTEL,"70,01"`, `16/${monat.slice(5)}/${monat.slice(0, 4)},ZAHLUNG ERHALTEN. VIELEN DANK,"-100,00"`].join("\n");

    await anmelden(page, "inhaber");
    await page.goto(`/buchhaltung?monat=${monat}`);
    await page.getByTestId("bh-sparkasse").setInputFiles({ name: "sparkasse-test.csv", mimeType: "text/csv", buffer: Buffer.from(sparkasse, "latin1") });
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("bh-sparkasse-hochladen").click()]);
    await expect(page.getByTestId("bh-meldung")).toContainText("6 neue Buchungen");
    await page.getByTestId("bh-amex").setInputFiles({ name: "amex-test.csv", mimeType: "text/csv", buffer: Buffer.from(amex, "utf8") });
    await Promise.all([page.waitForURL(/meldung=Amex/), page.getByTestId("bh-amex-hochladen").click()]);
    await expect(page.getByTestId("bh-meldung")).toContainText("3 neue Umsätze");
    // Erneuter Upload erzeugt keine Doppelten
    await page.getByTestId("bh-amex").setInputFiles({ name: "amex-test.csv", mimeType: "text/csv", buffer: Buffer.from(amex, "utf8") });
    await page.getByTestId("bh-amex-hochladen").click();
    await expect(page.getByTestId("bh-meldung")).toContainText("0 neue Umsätze, 3 schon vorhanden");

    await Promise.all([page.waitForURL(/meldung=Abgleich/), page.getByTestId("bh-abgleich").click()]);
    const grad = Number((await page.getByTestId("bh-grad").textContent())!.replace(/\D/g, ""));
    expect(grad).toBeGreaterThanOrEqual(80);
    await expect(page.getByTestId("bh-ohne-beleg")).toContainText("Unbekannt Test");
    await expect(page.getByTestId("bh-buchungen")).toContainText("Wareneingang 19 % Vorsteuer");

    // Rest als To-do für die Assistenz
    await page.getByTestId("bh-anfordern").click();
    await expect(page.getByTestId("bh-meldung")).toContainText("Belege anfordern");
    expect((await sql("select 1 from tasks where tenant_id = $1 and system_key like 'belege-fehlen-%' and status = 'open'", [t])).length).toBe(1);

    // Bestätigen, festschreiben – danach sperrt die Datenbank Änderungen (nur Storno)
    await page.locator("form", { hasText: "Alle Vorschläge bestätigen" }).locator("button").click();
    await expect(page.getByTestId("bh-meldung")).toContainText("Buchungen bestätigt");
    await page.getByTestId("bh-festschreiben").click();
    await expect(page.getByTestId("bh-meldung")).toContainText("festgeschrieben");
    await expect(sql("update buchungen set konto = '9999' where tenant_id = $1 and status = 'festgeschrieben'", [t])).rejects.toThrow(/GoBD/);
    await expect(sql("delete from buchhaltung_protokoll where tenant_id = $1", [t])).rejects.toThrow(/GoBD/);

    // DATEV-Buchungsstapel (EXTF, Windows-1252) und Protokoll
    const res = await page.request.get(`/buchhaltung/export?firma=LuGru&monat=${monat}&art=datev`);
    expect(res.status()).toBe(200);
    const text = Buffer.from(await res.body()).toString("latin1");
    expect(text.startsWith('"EXTF";700;21;"Buchungsstapel"')).toBe(true);
    expect(text.split("\r\n").filter(Boolean).length).toBeGreaterThanOrEqual(2 + 7);
    const zip = await page.request.get(`/buchhaltung/export?firma=LuGru&monat=${monat}&art=zip`);
    expect(zip.headers()["content-type"]).toContain("zip");
    await page.goto("/buchhaltung/protokoll");
    await expect(page.getByTestId("bh-protokoll")).toContainText("festgeschrieben");

    // Claude: Stand des Monats
    const c = await mcpVerbinden(browser, baseURL!, "inhaber");
    const s = JSON.parse(await c.call("buchhaltung_status", { monat }));
    expect(s.abstimmungsgrad_prozent).toBeGreaterThanOrEqual(80);
    expect(s.export_erstellt).toBeTruthy();
  });

  test("Feierabend: erledigt/offen, auf morgen schieben (wichtige bleiben), morgen Top 3", async ({ page }) => {
    const m = marke();
    const normal = await aufgabe(`Abend normal ${m}`, { faellig: HEUTE });
    const wichtig = await aufgabe(`Abend wichtig ${m}`, { faellig: HEUTE, prioritaet: "critical" });
    await anmelden(page, "inhaber");
    await page.goto("/kalender/feierabend");
    await expect(page.getByTestId("fa-offen")).toContainText(`Abend normal ${m}`);
    await expect(page.getByTestId("fa-morgen")).toBeVisible();
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("fa-auf-morgen").click()]);
    const due = async (id: string) => (await sql<{ d: string }>("select to_char(due_date, 'YYYY-MM-DD') as d from tasks where id = $1", [id]))[0].d;
    expect(await due(normal)).toBe(plus(HEUTE, 1));
    expect(await due(wichtig)).toBe(HEUTE);
    await page.goto("/kalender/feierabend?rueckblick=1");
    await expect(page.getByTestId("fa-rueckblick")).toContainText("Aufgaben erledigt");
  });
});
