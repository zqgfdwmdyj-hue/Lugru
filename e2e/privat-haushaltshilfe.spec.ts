// Babysitter & Putzhilfe mit erfundenen Familienkalender-Terminen: Babysitterin 17–22 Uhr → 3 Std. wach à 20 € +
// 2 Std. schlafend à 17 € = 94 €; Putzfrau ohne Stundenlohn → Hinweis, mit 15 €/Std. → 45 €; Korrektur von Hand,
// Einsatz von Hand, CSV-Export, Hinweis in „Geld“ und bei Claude; „nur Familie“ kommt nicht an die Seite.
import { aktion, alsPerson, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const MONAT = "2026-07"; // Sommerzeit (UTC+2) – fester, vergangener Monat
const berlin = (tag: string, zeit: string) => new Date(`${tag}T${zeit}:00+02:00`);

test.describe("Privat – Babysitter & Putzhilfe", () => {
  test("Kalender → Kosten wach/schlafend, Stundenlohn, Korrektur, von Hand, Export; nur voller Zugang", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const termin = (uid: string, titel: string, tag: string, von: string, bis: string) =>
      sql("insert into calendar_events (tenant_id, calendar_name, uid, title, starts_at, ends_at, all_day, day) values ($1, 'Familie (privat)', $2, $3, $4, $5, false, $6)", [T, uid, titel, berlin(tag, von), berlin(tag, bis), tag]);
    await termin(`hh-b-${m}`, `Babysitterin ${m}`, `${MONAT}-10`, "17:00", "22:00");
    await termin(`hh-p-${m}`, `Putzfrau ${m}`, `${MONAT}-14`, "09:00", "12:00");

    await anmelden(page, "inhaber");
    await page.goto(`/privat/haushaltshilfe?monat=${MONAT}`);
    const zeile = (text: string) => page.getByTestId("hh-einsatz").filter({ hasText: text });
    const sitter = zeile(`Babysitterin ${m}`);
    await expect(sitter).toContainText("17:00–22:00");
    await expect(sitter).toContainText("3 Std. wach");
    await expect(sitter).toContainText("2 Std. schlafend");
    await expect(sitter.getByTestId("hh-betrag")).toContainText("94,00");

    // Putzfrau: Stundenlohn fehlt → eintragen → 3 Std. × 15 € = 45 €
    const putzFeld = page.getByTestId("hh-helfer").filter({ hasText: "Putzfrau" }).locator('input[name="satz"]');
    // Beim ersten Lauf ist noch kein Stundenlohn hinterlegt (in späteren Läufen steht er schon da)
    if (!(await putzFeld.inputValue())) await expect(zeile(`Putzfrau ${m}`)).toContainText("Stundenlohn fehlt");
    await putzFeld.fill("15");
    await Promise.all([aktion(page), page.getByTestId("hh-saetze-speichern").click()]);
    await expect(page.getByTestId("hh-meldung")).toContainText("Stundensätze gespeichert");
    await expect(zeile(`Putzfrau ${m}`).getByTestId("hh-betrag")).toContainText("45,00");

    // Korrektur von Hand: Babysitterin hat bis 23 Uhr gemacht → 3 Std. wach + 3 Std. schlafend = 111 €, bezahlt
    await sitter.getByText("korrigieren").click();
    const f = sitter.getByTestId("hh-korrigieren");
    await f.locator('input[name="to"]').fill("23:00");
    await f.locator('input[name="bezahlt"]').check();
    await Promise.all([aktion(page), f.getByRole("button", { name: "Speichern" }).click()]);
    await expect(page.getByTestId("hh-meldung")).toContainText("Einsatz gespeichert");
    await expect(zeile(`Babysitterin ${m}`).getByTestId("hh-betrag")).toContainText("111,00");
    await expect(zeile(`Babysitterin ${m}`).getByTestId("hh-betrag")).toContainText("von Hand");
    await expect(zeile(`Babysitterin ${m}`).getByTestId("hh-betrag")).toContainText("bezahlt");

    // Einsatz von Hand (nicht im Kalender) mit festem Betrag
    await page.getByTestId("hh-hand-oeffnen").click();
    const hand = page.getByTestId("hh-hand");
    await hand.locator('select[name="helferId"]').selectOption("babysitter");
    await hand.locator('input[name="day"]').fill(`${MONAT}-20`);
    await hand.locator('input[name="betrag"]').fill("50");
    await hand.locator('input[name="notiz"]').fill(`Nachmittag ${m}`);
    await Promise.all([aktion(page), hand.getByRole("button", { name: "Eintragen" }).click()]);
    await expect(zeile(`Nachmittag ${m}`).getByTestId("hh-betrag")).toContainText("50,00");

    // CSV-Export des Monats
    const csv = await (await page.request.get(`/privat/haushaltshilfe/export?monat=${MONAT}`)).text();
    expect(csv).toContain("Datum;Wochentag;Hilfe;von;bis;Std. wach;Std. schlafend");
    expect(csv).toContain("10.07.2026;Fr;Babysitterin;17:00;23:00;3,00;3,00;6,00;111,00;von Hand;stattgefunden;ja");
    expect(csv).toContain("14.07.2026;Di;Putzfrau;09:00;12:00;3,00;0,00;3,00;45,00;berechnet;stattgefunden;nein");
    expect(csv).toContain(`Nachmittag ${m}`);
    expect(csv).toContain("Summe 2026-07 (nur stattgefunden)");

    // „Geld“ zeigt die Monatssumme, Claude (privat_finanzen) ebenso
    await page.goto(`/privat/geld?monat=${MONAT}`);
    await expect(page.getByTestId("geld-haushaltshilfe")).toContainText("Babysitter & Putzhilfe");
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { privat: true });
    const g = JSON.parse(await mcp.call("privat_finanzen", { monat: MONAT })) as { babysitter_putzhilfe?: { einsaetze: number; kosten: number; je_hilfe: { name: string }[] } };
    expect(g.babysitter_putzhilfe?.einsaetze).toBeGreaterThanOrEqual(3);
    expect(g.babysitter_putzhilfe?.kosten).toBeGreaterThanOrEqual(206);

    // Korrektur zurücknehmen → wieder aus dem Kalender gerechnet (94 €)
    await page.goto(`/privat/haushaltshilfe?monat=${MONAT}`);
    await zeile(`Babysitterin ${m}`).getByText("korrigieren").click();
    await Promise.all([aktion(page), zeile(`Babysitterin ${m}`).getByTestId("hh-zuruecksetzen").click()]);
    await expect(zeile(`Babysitterin ${m}`).getByTestId("hh-betrag")).toContainText("94,00");

    // „Nur Familie“: keine Kosten – die Seite leitet um, der Export ebenso
    const fp = await alsPerson(browser, "familie");
    await fp.goto(`/privat/haushaltshilfe?monat=${MONAT}`);
    await expect(fp).toHaveURL(/nurfamilie=1/);
    await expect(fp.getByTestId("hh-einsaetze")).toHaveCount(0);
    const fx = await fp.request.get(`/privat/haushaltshilfe/export?monat=${MONAT}`, { maxRedirects: 0 });
    expect(fx.status()).toBeGreaterThanOrEqual(300);
    expect(await fx.text()).not.toContain(m);
    await fp.context().close();

    // Aufräumen: nur die Testtermine dieses Laufs (Einträge von Hand bleiben als erfundene Testdaten)
    await sql("delete from calendar_events where tenant_id = $1 and uid in ($2, $3)", [T, `hh-b-${m}`, `hh-p-${m}`]);
  });
});
