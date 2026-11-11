// Bauauftrag B34.3c Lead-Beschaffung Stufe 1 – Abnahme: CSV-Import eines Apify-Exports → Leads mit Quelle und Datum
// (automatisch eingetragen), E-Mail-Adresse gespeichert, aber im Versandweg „Mail“ gesperrt (auch mit „Rechtlich
// geprüft“), Brief nur nach Freigabe. Dazu: E-Mail aus dem Impressum von Hand, Vorschlag „Zielgruppe AdelPrep“ aus
// der Stückzahl, LUCID-Leads gesperrt bis zur Klärung. Alle Firmen und Adressen erfunden (Test…, example.invalid).
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

test.describe("B34.3c Lead-Beschaffung Stufe 1", () => {
  const m = marke();
  const salon = (i: number) => `Testsalon ${m} ${i} GmbH`;
  const gross = `Testgrosshandel ${m} GmbH`;
  const klein = `Testkleinhandel ${m} GmbH`;
  const hersteller = `Testhersteller ${m} GmbH`;
  const mail = (i: number) => `info${i}-${m.toLowerCase()}@example.invalid`;
  let T = "";

  test.afterAll(async () => {
    if (!T) return;
    const muster = `Test% ${m} %`;
    await sql("delete from abverkauf_briefe where tenant_id = $1 and anschreiben_id in (select a.id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma like $2)", [T, muster]);
    await sql("delete from abverkauf_chargen where tenant_id = $1 and id in (select charge_id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma like $2)", [T, muster]);
    await sql("delete from abverkauf_anschreiben where tenant_id = $1 and lead_id in (select id from abverkauf_leads where firma like $2)", [T, muster]);
    await sql("delete from abverkauf_leads where tenant_id = $1 and firma like $2", [T, muster]);
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
  });

  test("Abnahme Stufe 1: Apify-CSV → Quelle/Datum, E-Mail gespeichert aber Mail gesperrt, Brief nur nach Freigabe; Impressum-Mail, AdelPrep-Vorschlag, LUCID-Sperre", async ({ page }) => {
    test.setTimeout(180_000);
    [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
    await anmelden(page, "inhaber");
    await page.goto("/b2b/abverkauf");
    const meldung = page.getByTestId("av-meldung");
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = (kopf: string[], zeilen: string[][]) => [kopf.join(","), ...zeilen.map((z) => z.map(q).join(","))].join("\n");
    const importieren = async (name: string, inhalt: string) => {
      const imp = page.getByTestId("av-import");
      await imp.locator('input[name="datei"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(inhalt, "utf8") });
      await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    };
    const lead = (f: string) => page.locator(`[data-testid="av-lead"][data-firma="${f}"]`);

    // Briefanbieter: angezeigt, welcher aktuell gilt (Zugang, Preis, Modus)
    await expect(page.getByTestId("av-bv-stand")).toContainText("Aktuell:");
    await expect(page.getByTestId("av-bv-stand")).toContainText("Testmodus");

    // 1. Apify-Export (Google Maps) – Quelle und Datum leer lassen: das System trägt sie ein
    const kopf = ["title", "categoryName", "address", "street", "city", "postalCode", "countryCode", "website", "phone", "emails/0", "location/lat", "location/lng", "placeId", "scrapedAt"];
    const zeile = (i: number) => [salon(i), "Friseur", `Testweg ${i}, 12345 Musterstadt`, `Testweg ${i}`, "Musterstadt", "12345", "DE", `https://testsalon${i}.example.invalid`, "+49 000 000", mail(i), "48.1", "11.5", `ChIJtest${m}${i}`, "2026-11-08T10:15:00.000Z"];
    const datei = `dataset_google-maps_${m}.csv`;
    await importieren(datei, csv(kopf, [zeile(1), zeile(2)]));
    await expect(meldung).toContainText("2 Leads neu, 0 schon vorhanden, 0 auf der Sperrliste");
    await expect(meldung).toContainText(`Quelle: Apify-Export (${datei}), Stand 08.11.2026`);
    await expect(meldung).toContainText("2 E-Mail(s) gespeichert – nur für Antworten, keine Werbe-E-Mail");
    await expect(lead(salon(1)).getByTestId("av-lead-quelle")).toHaveAttribute("data-typ", "apify");
    await expect(lead(salon(1)).getByTestId("av-lead-quelle")).toContainText("08.11.2026");
    const mailZelle = lead(salon(1)).getByTestId("av-lead-email");
    await expect(mailZelle).toHaveAttribute("data-email", "1");
    await expect(mailZelle).toHaveAttribute("data-mail", "gesperrt");
    await expect(mailZelle).toContainText("Impressum (Website, Apify-Export)");
    await expect(mailZelle).toContainText("nur für Antworten – keine Werbe-E-Mail");
    const [roh] = await sql<{ email: string; email_quelle: string; quelle_datum: string; quelle_typ: string }>("select email, email_quelle, quelle_datum, quelle_typ from abverkauf_leads where tenant_id = $1 and firma = $2", [T, salon(1)]);
    expect(roh.email).not.toContain("@"); // verschlüsselt gespeichert
    expect(roh).toMatchObject({ email_quelle: "Impressum (Website, Apify-Export)", quelle_datum: "2026-11-08", quelle_typ: "apify" });

    // 2. Auch mit „Rechtlich geprüft“: Versandweg „Mail“ für die gefundene Adresse gesperrt
    await page.getByTestId("av-rechtlich").check();
    await Promise.all([aktion(page), page.getByTestId("av-einstellungen").getByRole("button", { name: "Speichern" }).click()]);
    await expect(meldung).toContainText("Einstellungen gespeichert");
    await lead(salon(1)).locator('select[name="kontaktweg"]').selectOption("email");
    await Promise.all([aktion(page), lead(salon(1)).getByRole("button", { name: "✓" }).click()]);
    await expect(meldung).toContainText("Lead gespeichert");
    await expect(lead(salon(1)).getByTestId("av-mail-status")).toContainText("E-Mail gesperrt: Adresse aus dem Impressum – nur für Antworten");

    // 3. Entwürfe (Salon 1 per Mail, Salon 2 per Brief) – vorher nichts in Charge oder Brief
    for (const i of [1, 2]) await lead(salon(i)).locator('input[name="lead"]').check();
    await Promise.all([aktion(page), page.getByTestId("av-entwuerfe").click()]);
    await expect(meldung).toContainText("2 Entwürfe angelegt – nichts verschickt");
    const unsere = page.locator('[data-testid="av-anschreiben-zeile"]').filter({ hasText: `Testsalon ${m} ` });
    await expect(unsere.and(page.locator('[data-status="entwurf"]'))).toHaveCount(2);
    const vorFreigabe = await sql<{ n: number }>("select count(*)::int n from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where a.tenant_id = $1 and l.firma like $2 and (a.charge_id is not null or a.status <> 'entwurf')", [T, `Testsalon ${m} %`]);
    expect(vorFreigabe[0].n).toBe(0);
    expect((await sql<{ n: number }>("select count(*)::int n from abverkauf_briefe b join abverkauf_anschreiben a on a.id = b.anschreiben_id join abverkauf_leads l on l.id = a.lead_id where b.tenant_id = $1 and l.firma like $2", [T, `Testsalon ${m} %`]))[0].n).toBe(0);

    // Freigabe: Brief frei (Charge), Mail gesperrt – keine Mail raus
    for (const z of await page.locator('[data-testid="av-anschreiben-zeile"][data-status="entwurf"]').all()) if (!(await z.innerText()).includes(`Testsalon ${m} `)) await z.locator('input[name="anschreiben"]').uncheck();
    await Promise.all([aktion(page), page.getByTestId("av-freigeben").click()]);
    await expect(meldung).toContainText("1 freigegeben");
    await expect(meldung).toContainText(`${salon(1)}: Adresse aus dem Impressum – nur für Antworten`);
    await expect(unsere.and(page.locator('[data-kanal="email"]'))).toHaveAttribute("data-status", "entwurf");
    await expect(unsere.and(page.locator('[data-kanal="brief"]'))).toHaveAttribute("data-status", "freigegeben");
    expect((await sql<{ n: number }>(`select count(*)::int n from test_mails where tenant_id = $1 and "to" like $2`, [T, `%-${m.toLowerCase()}@example.invalid`]))[0].n).toBe(0);

    // Meldet sich der Händler (Status „geantwortet“), ist eine Antwort an die Adresse erlaubt
    await sql("update abverkauf_leads set status = 'geantwortet' where tenant_id = $1 and firma = $2", [T, salon(1)]);
    await page.goto("/b2b/abverkauf");
    await expect(lead(salon(1)).getByTestId("av-lead-email")).toHaveAttribute("data-mail", "erlaubt");
    await expect(lead(salon(1)).getByTestId("av-lead-email")).toContainText("Antwort erlaubt");

    // 4. Keepa-Export mit Stückzahl → Vorschlag „Zielgruppe AdelPrep“ (ab 80), Übernahme nur von Hand
    await importieren(`Keepa_Seller_${m}.csv`, csv(["Seller Name", "Business Address", "Units"], [[gross, "Lagerweg 1, 12345 Musterstadt", "150"], [klein, "Lagerweg 2, 12345 Musterstadt", "20"]]));
    await expect(meldung).toContainText("2 Leads neu");
    await expect(meldung).toContainText(`Quelle: Keepa-Export (Keepa_Seller_${m}.csv)`);
    await expect(lead(gross).getByTestId("av-lead-stueck")).toContainText("ca. 150 Stück je Artikel");
    const vorschlag = (f: string) => page.locator(`[data-testid="av-ap-vorschlag"][data-firma="${f}"]`);
    await expect(vorschlag(gross)).toContainText("ca. 150 Stück je Artikel (ab 80)");
    await expect(vorschlag(klein)).toHaveCount(0);
    await expect(lead(gross).getByTestId("av-lead-adelprep")).toHaveAttribute("data-an", "0");
    for (const v of await page.getByTestId("av-ap-vorschlag").all()) if ((await v.getAttribute("data-firma")) !== gross) await v.locator('input[name="lead"]').uncheck();
    await Promise.all([aktion(page), page.getByTestId("av-ap-uebernehmen").click()]);
    await expect(meldung).toContainText("1 Lead als Zielgruppe AdelPrep markiert");
    await expect(lead(gross).getByTestId("av-lead-adelprep")).toHaveAttribute("data-an", "1");
    await expect(vorschlag(gross)).toHaveCount(0);

    // E-Mail aus dem Impressum von Hand: gespeichert mit Quelle, Mail-Weg gesperrt
    const mailFeld = lead(klein).getByTestId("av-lead-mail-feld");
    await mailFeld.fill(`impressum-${m.toLowerCase()}@example.invalid`);
    await Promise.all([aktion(page), lead(klein).getByTestId("av-lead-mail-speichern").click()]);
    await expect(meldung).toContainText("E-Mail aus dem Impressum gespeichert – nur für Antworten");
    await expect(lead(klein).getByTestId("av-lead-email")).toContainText("Impressum (von Hand)");
    await expect(lead(klein).getByTestId("av-lead-email")).toHaveAttribute("data-mail", "gesperrt");

    // 5. LUCID-Export: gesperrt (kein Entwurf), bis „LUCID geklärt“ gesetzt ist
    await importieren(`lucid_${m}.csv`, csv(["Registrierungsnummer", "Name", "Straße", "PLZ", "Ort"], [["DE0000000000000", hersteller, "Werkweg 1", "12345", "Musterstadt"]]));
    await expect(meldung).toContainText("1 Leads neu");
    await expect(lead(hersteller).getByTestId("av-lead-quelle")).toHaveAttribute("data-typ", "lucid");
    await expect(lead(hersteller).getByTestId("av-lead-quelle-sperre")).toContainText("Quelle LUCID: Nutzung für Werbung noch nicht geklärt");
    await lead(hersteller).locator('input[name="lead"]').check();
    await Promise.all([aktion(page), page.getByTestId("av-entwuerfe").click()]);
    await expect(meldung).toContainText("0 Entwürfe angelegt");
    await expect(meldung).toContainText("1 ohne Entwurf (Quelle LUCID – Nutzung für Werbung noch nicht geklärt)");
    await page.getByTestId("av-lucid").check();
    await Promise.all([aktion(page), page.getByTestId("av-lead-quellen-speichern").click()]);
    await expect(meldung).toContainText("Lead-Quellen gespeichert");
    await expect(lead(hersteller).getByTestId("av-lead-quelle-sperre")).toHaveCount(0);
    await lead(hersteller).locator('input[name="lead"]').check();
    await Promise.all([aktion(page), page.getByTestId("av-entwuerfe").click()]);
    await expect(meldung).toContainText("1 Entwurf angelegt – nichts verschickt");
  });
});
