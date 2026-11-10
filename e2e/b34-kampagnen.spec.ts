// Bauauftrag B34.3b Kampagnen – Abnahme: Kampagne „Friseure“ mit 2 Testprodukten, MHD-Filter greift, Umkreisfilter
// 50 km zeigt nur Leads im Radius, Brief-PDF mit QR-Code und Kampagnen-ID, Anfrage über die Anfrageseite landet als
// Aufgabe im Posteingang. Dazu Lagerkostenrechner der Lager-Kampagne. Alle Firmen, Produkte, Koordinaten erfunden.
import { extractText } from "unpdf";
import { aktion, anmelden, expect, marke, sql, test } from "./helfer";

test.describe.serial("B34.3b Kampagnen", () => {
  const m = marke();
  const sku = (i: number) => `TEST-KS-${m}-${i}`;
  const firma = (b: string) => `Testsalon ${m} ${b}`;
  let T = "";

  test.beforeAll(async () => {
    const [{ tenant_id, product_id }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    T = tenant_id;
    for (const [i, ek, name] of [[1, "3.00", `Testshampoo Salonpflege ${m} 250 ml (erfunden)`], [2, "5.00", `Testkur Salonpflege ${m} 500 ml (erfunden)`]] as const) {
      await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date - 100, 24, $4)", [T, product_id, sku(i), ek]);
      await sql("insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, synced_at) values ($1, $2, $2, null, $3, 24, now())", [T, sku(i), name]);
    }
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
  });
  test.afterAll(async () => {
    const muster = `Testsalon ${m} %`;
    await sql("delete from tasks where tenant_id = $1 and (title like $2 or title like $3)", [T, `%Testsalon ${m}%`, `%Friseure ${m}%`]);
    await sql("delete from emails where tenant_id = $1 and subject like $2", [T, `%Friseure ${m}%`]);
    await sql("delete from abverkauf_anfragen where tenant_id = $1 and firma like $2", [T, muster]);
    await sql("delete from abverkauf_chargen where tenant_id = $1 and id in (select charge_id from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma like $2)", [T, muster]);
    await sql("delete from abverkauf_anschreiben where tenant_id = $1 and lead_id in (select id from abverkauf_leads where firma like $2)", [T, muster]);
    await sql("delete from abverkauf_leads where tenant_id = $1 and firma like $2", [T, muster]);
    await sql("delete from abverkauf_kampagnen where tenant_id = $1 and name like $2", [T, `%${m}%`]);
    await sql("delete from sellerboard_inventory where tenant_id = $1 and sku like $2", [T, `TEST-KS-${m}-%`]);
    await sql("delete from lots where tenant_id = $1 and sku like $2", [T, `TEST-KS-${m}-%`]);
    await sql("update tenants set settings = settings - 'abverkauf' where id = $1", [T]);
  });

  test("Abnahme: Friseure mit 2 Testprodukten, MHD-Filter, Umkreis 50 km, Brief-PDF mit QR + Kampagnen-ID, Anfrage → Aufgabe im Posteingang", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await anmelden(page, "inhaber");
    await page.goto("/b2b/abverkauf#lager");
    // Lager-Standort (erfundene Koordinaten) und Preis je Palette für den Lagerkostenrechner
    await page.getByTestId("av-lager-lat").fill("50,0");
    await page.getByTestId("av-lager-lng").fill("8,0");
    await page.getByTestId("av-lager-form").locator('input[name="preis"]').fill("7,20");
    await Promise.all([aktion(page), page.getByTestId("av-lager-speichern").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("Lager-Standort gespeichert.");

    // Leads per CSV mit Koordinaten: A ≈ 22 km, B ≈ 40 km, C ≈ 111 km, D ohne Koordinaten, E andere Branche
    const csv = ["Firma,Straße,PLZ,Ort,Kategorie,Latitude,Longitude", `${firma("A")},Salonweg 1,12345,Musterstadt,Friseursalon,50.2,8.0`, `${firma("B")},Salonweg 2,12346,Musterstadt,Friseursalon,50.35,8.1`, `${firma("C")},Salonweg 3,12347,Fernstadt,Friseursalon,51.0,8.0`, `${firma("D")},Salonweg 4,12348,Musterstadt,Friseursalon,,`, `${firma("E")},Spielweg 5,12349,Musterstadt,Spielwaren,50.1,8.0`].join("\n");
    const imp = page.getByTestId("av-import");
    await imp.locator('input[name="datei"]').setInputFiles({ name: `salons-${m}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await imp.locator('input[name="quelle"]').fill(`Testverzeichnis ${m} (erfunden)`);
    await Promise.all([aktion(page), page.getByTestId("av-import-los").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("5 Leads neu");

    // Kampagne „Friseure“ anlegen
    await page.goto("/b2b/abverkauf/kampagnen");
    await page.getByTestId("km-zielgruppe").selectOption("friseure");
    await page.getByTestId("km-name").fill(`Friseure ${m}`);
    await Promise.all([page.waitForURL(/\/b2b\/abverkauf\/kampagnen\/[0-9a-f-]{36}/), page.getByTestId("km-anlegen").click()]);
    const code = await page.getByTestId("kampagne").getAttribute("data-code");
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    await expect(page.getByTestId("km-umkreis")).toHaveValue("50");
    await expect(page.getByTestId("km-hinweise")).toContainText("MHD bzw. PAO und Chargennummer");

    // Umkreisfilter 50 km: nur A und B
    const lead = (b: string) => page.locator(`[data-testid="km-lead"][data-firma="${firma(b)}"]`);
    await expect(lead("A")).toHaveAttribute("data-ok", "1");
    await expect(lead("B")).toHaveAttribute("data-ok", "1");
    await expect(lead("C")).toHaveAttribute("data-ok", "0");
    await expect(lead("C")).toContainText("km entfernt");
    await expect(lead("D")).toContainText("ohne Koordinaten");
    await expect(lead("E")).toContainText("andere Branche");

    // 2 Testprodukte aus dem Bestand: MHD 06/2028 (angeboten), MHD 01/2027 (unter 6 Monaten → nicht angeboten)
    await page.getByTestId("km-suche-text").fill(`KS-${m}`);
    await Promise.all([page.waitForURL(/suche=/), page.getByTestId("km-suchen").click()]);
    for (const [i, mhd, ch] of [[1, "2028-06", "L-TEST-1"], [2, "2027-01", "L-TEST-2"]] as const) {
      const z = page.locator(`[data-testid="km-bestand"][data-sku="${sku(i)}"]`);
      await z.locator('input[name="sku"]').check();
      await z.locator(`input[name="mhd_${sku(i)}"]`).fill(mhd);
      await z.locator(`input[name="charge_${sku(i)}"]`).fill(ch);
    }
    await Promise.all([aktion(page), page.getByTestId("km-positionen-los").click()]);
    await expect(page.getByTestId("km-meldung")).toContainText("1 Positionen angeboten, 1 nicht angeboten");
    await expect(page.locator(`[data-testid="km-position"][data-sku="${sku(1)}"]`)).toHaveAttribute("data-angeboten", "1");
    const p2 = page.locator(`[data-testid="km-position"][data-sku="${sku(2)}"]`);
    await expect(p2).toHaveAttribute("data-angeboten", "0");
    await expect(p2.getByTestId("km-grund")).toContainText("unter Mindestrestlaufzeit 6 Monate");
    // Preis = Einstand 3,00 € + 10 % = 3,30 € netto
    await expect(page.locator(`[data-testid="km-position"][data-sku="${sku(1)}"]`)).toContainText("3,30 €");

    // Entwürfe für A und B (Brief mit QR-Code), dann Freigabe als Charge
    await Promise.all([aktion(page), page.getByTestId("km-entwuerfe").click()]);
    await expect(page.getByTestId("km-meldung")).toContainText("2 Entwürfe angelegt");
    await page.goto("/b2b/abverkauf#anschreiben");
    for (const z of await page.locator('[data-testid="av-anschreiben-zeile"][data-status="entwurf"]').all()) if (!(await z.innerText()).includes(`Testsalon ${m} `)) await z.locator('input[name="anschreiben"]').uncheck();
    await Promise.all([aktion(page), page.getByTestId("av-freigeben").click()]);
    await expect(page.getByTestId("av-meldung")).toContainText("2 freigegeben");
    const [{ charge_id: C, code: bezug }] = await sql<{ charge_id: string; code: string }>("select a.charge_id, a.code from abverkauf_anschreiben a join abverkauf_leads l on l.id = a.lead_id where l.firma = $1", [firma("A")]);

    // Brief-PDF: Kampagnen-ID, Kurzlink und QR-Code (Bild) je Brief; nur die angebotene Position
    const r = await page.request.get(`/b2b/abverkauf/datei?art=serienbrief&id=${C}`);
    const roh = Buffer.from(await r.body());
    const text = ((await extractText(new Uint8Array(roh), { mergePages: true })).text as string).replace(/\s+/g, " ");
    expect(text).toContain(`Kampagne ${code}`);
    expect(text).toContain(`/anfrage/${code}?b=${bezug}`);
    expect(text).toContain(`Testshampoo Salonpflege ${m} 250 ml (erfunden): 24 Stück, 3,30 € netto je Stück`);
    expect(text).not.toContain(`Testkur Salonpflege ${m}`);
    expect(roh.toString("latin1").match(/\/Subtype\s*\/Image/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

    // Öffentliche Anfrageseite (ohne Anmeldung): falsche USt-ID abgelehnt, dann Anfrage gespeichert
    const gast = await browser.newContext();
    const g = await gast.newPage();
    await g.goto(`/anfrage/${code}?b=${bezug}`);
    await expect(g.getByTestId("anfrage")).toHaveAttribute("data-kampagne", code!);
    await expect(g.getByTestId("anfrage-position")).toHaveCount(1);
    await expect(g.getByTestId("anfrage-form")).not.toContainText("3,00");
    const f = g.getByTestId("anfrage-form");
    await f.getByRole("checkbox").first().check();
    await f.locator('input[name="menge"]').fill("24 Stück");
    await f.locator('input[name="firma"]').fill(firma("A"));
    await f.locator('input[name="ust"]').fill("DE123");
    await f.locator('input[name="name"]').fill("Testperson");
    await f.locator('input[name="email"]').fill(`salon-a-${m.toLowerCase()}@example.invalid`);
    await f.locator('input[name="einwilligung"]').check();
    await Promise.all([g.waitForURL(/fehler=/), g.getByTestId("anfrage-senden").click()]);
    await expect(g.getByTestId("anfrage-fehler")).toContainText("USt-ID (Gewerbenachweis): Format für DE passt nicht.");
    const f2 = g.getByTestId("anfrage-form");
    await f2.getByRole("checkbox").first().check();
    await f2.locator('input[name="firma"]').fill(firma("A"));
    await f2.locator('input[name="ust"]').fill("DE000000000");
    await f2.locator('input[name="email"]').fill(`salon-a-${m.toLowerCase()}@example.invalid`);
    await f2.locator('input[name="einwilligung"]').check();
    await Promise.all([g.waitForURL(/danke=1/), g.getByTestId("anfrage-senden").click()]);
    await expect(g.getByTestId("anfrage-danke")).toContainText("Vielen Dank");
    await gast.close();

    // Aufgabe + Eintrag im Posteingang, Anschreiben „beantwortet“
    const [aufgabe] = await sql<{ id: string; title: string; priority: string; link: string }>("select id, title, priority, link from tasks where tenant_id = $1 and title like $2", [T, `%Testsalon ${m} A%`]);
    expect(aufgabe.title).toBe(`Anfrage aus Kampagne „Friseure ${m}“: ${firma("A")}`);
    expect(aufgabe.link).toMatch(/\/b2b\/abverkauf\/kampagnen\/[0-9a-f-]{36}#anfragen$/);
    const [mail] = await sql<{ ordner: string; category: string; task_id: string; body_text: string }>("select ordner, category, task_id, body_text from emails where tenant_id = $1 and subject like $2", [T, `%Friseure ${m}%`]);
    expect(mail).toMatchObject({ ordner: "Anfrageseite", category: "action", task_id: aufgabe.id });
    expect(mail.body_text).toContain("USt-ID: DE000000000");
    expect(mail.body_text).toContain(`Testshampoo Salonpflege ${m} 250 ml (erfunden)`);
    expect((await sql<{ status: string }>("select status from abverkauf_anschreiben where tenant_id = $1 and code = $2", [T, bezug]))[0].status).toBe("beantwortet");
    await page.goto(page.url().split("#")[0].replace(/\/b2b\/abverkauf.*$/, "/b2b/abverkauf/kampagnen"));
    await page.locator('[data-testid="km-zeile"]', { hasText: `Friseure ${m}` }).getByRole("link").click();
    await expect(page.getByTestId("km-anfrage")).toHaveCount(1);
    await expect(page.getByTestId("km-anfragen")).toContainText("DE000000000 ✓");
  });

  test("Lager & Logistik: eigener Brief der Logistik-Firma nötig, Lagerkostenrechner (Europalette 1,44 m³)", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/b2b/abverkauf/kampagnen");
    await page.getByTestId("km-zielgruppe").selectOption("adelprep_lager");
    await page.getByTestId("km-name").fill(`Lager ${m}`);
    await Promise.all([page.waitForURL(/\/b2b\/abverkauf\/kampagnen\/[0-9a-f-]{36}/), page.getByTestId("km-anlegen").click()]);
    await expect(page.getByTestId("km-umkreis")).toHaveValue("100");
    await expect(page.getByTestId("km-lager")).toContainText("Kapazität");
    await page.getByTestId("km-paletten").fill("10");
    await Promise.all([page.waitForURL(/paletten=10/), page.getByRole("button", { name: "Rechnen" }).click()]);
    await expect(page.getByTestId("km-lagerkosten")).toContainText("10 Paletten = 14,4 m³");
    await expect(page.getByTestId("km-lagerkosten")).toContainText("7,20 € je Palette/Monat = 5,00 € je m³ · 72,00 € im Monat");
  });
});
