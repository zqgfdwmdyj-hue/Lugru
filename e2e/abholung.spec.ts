// Bauauftrag Abholung DHL/UPS – Abnahmen 1, 4 und 5 gegen die nachgebildeten Schnittstellen (DHL Parcel DE Pickup,
// UPS Pickup mit OAuth). Alle Daten erfunden (Testlager, Musterstadt, example.invalid).
import { berlinHeute, berlinUhrzeit, istAbholtag, naechsterAbholtag, ortSchluessel, tagPlus } from "../src/lib/abholung/logic";
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

type Empfangen = { dienst: "dhl" | "ups"; body?: Record<string, any>; storno?: string };
const empfangen = async (): Promise<Empfangen[]> => (await fetch(`${TD}/__abholung`)).json();
const tenant = async () => (await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1"))[0].tenant_id;
const zeile = (page: import("@playwright/test").Page, nr: string) => page.getByTestId("abholung-zeile").filter({ hasText: nr });

test.describe("Abholung DHL/UPS", () => {
  test("Abnahme 1: Stammdaten einmal, Claude fragt nach, bucht nach Bestätigung, Protokoll, Storno über denselben Weg", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    const T = await tenant();
    const name = `Testlager ${m} GmbH`;
    const key = ortSchluessel(name);
    await anmelden(page, "inhaber");
    // Stammdaten einmal hinterlegen (Einstellungen → Abholung, nur Inhaber)
    await page.goto("/einstellungen/abholung");
    const neu = page.getByTestId("abholort-neu");
    for (const [f, v] of Object.entries({ name, strasse: "Lagerweg", hausnr: "7", plz: "12345", ort: "Musterstadt", kontakt: "Erika Test", telefon: "0123 4567890", email: "abholung@example.invalid", dhlKundennummer: "3333333333", von: "10:00", bis: "12:00", hinweis: "Rampe 2 (Test)" })) await neu.locator(`input[name="${f}"]`).fill(v);
    await Promise.all([page.waitForURL(/meldung=/), neu.getByRole("button", { name: "Abholort anlegen" }).click()]);
    await expect(page.getByTestId("abholort-meldung")).toContainText(`Abholort „${name}“ gespeichert`);

    // „DHL-Abholung morgen 10–12 Uhr, 12 Pakete, Testlager …“ – ist morgen kein Abholtag, der nächste
    const morgen = tagPlus(berlinHeute(), 1);
    const sprachDatum = istAbholtag("dhl", morgen) && berlinUhrzeit() < "22:00" ? "morgen" : naechsterAbholtag("dhl");
    const tag = sprachDatum === "morgen" ? morgen : sprachDatum;
    const c = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(await c.tools()).toEqual(expect.arrayContaining(["abholung_anlegen", "abholung_stornieren", "abholungen"]));
    const wunsch = { dienst: "dhl", datum: sprachDatum, zeitfenster: "10-12", pakete: 12, abholort: `Testlager ${m}` };
    const vorher = (await empfangen()).length;

    // 1) ohne Bestätigung: nur Rückfrage mit Zusammenfassung, nichts gebucht
    const r1 = JSON.parse(await c.call("abholung_anlegen", wunsch));
    expect(r1.gebucht).toBe(false);
    expect(r1.rueckfrage).toContain("Soll ich das so buchen?");
    expect(r1.zusammenfassung).toContain("10:00–12:00 Uhr, 12 Pakete");
    expect(r1.zusammenfassung).toContain(`${name}, Lagerweg 7, 12345 Musterstadt`);
    expect(r1.hinweise.join(" ")).toContain("keine feste Uhrzeit");
    expect(r1.hinweise.join(" ")).toContain("Mehr als 10 Pakete");
    expect((await empfangen()).length).toBe(vorher);
    expect((await sql("select 1 from abholungen where tenant_id = $1 and ort = $2", [T, key])).length).toBe(0);

    // 2) nach „Ja“: Buchung mit Bestätigungsnummer (über 10 Pakete = DHL-Anfrage, Bestätigung per Mail)
    const r2 = JSON.parse(await c.call("abholung_anlegen", { ...wunsch, bestaetigt: true }));
    expect(r2.gebucht).toBe(true);
    expect(r2.status).toBe("angefragt");
    expect(r2.bestaetigungsnummer).toMatch(/^[0-9a-f]{32}$/);
    const auftrag = (await empfangen()).filter((x) => x.dienst === "dhl" && x.body).at(-1)!.body!;
    expect(auftrag.customerDetails).toEqual({ accountNumber: "3333333333" });
    expect(auftrag.pickupLocation.pickupAddress).toMatchObject({ name1: name, addressStreet: "Lagerweg", addressHouse: "7", postalCode: "12345", city: "Musterstadt" });
    expect(auftrag.pickupLocation.businessHours).toEqual([{ timeFrom: "10:00", timeUntil: "12:00" }]);
    expect(auftrag.pickupDetails.pickupDate).toEqual({ type: "Date", value: tag });
    expect(auftrag.pickupDetails.comment).toBe("Rampe 2 (Test)");
    expect(auftrag.shipmentDetails.shipments).toHaveLength(12);

    // Protokoll: Dienst, Datum, Fenster, Pakete, Bestätigungsnummer, wer (über Claude)
    await page.goto("/versand/abholung");
    const z = zeile(page, r2.bestaetigungsnummer);
    await expect(z).toHaveAttribute("data-status", "angefragt");
    await expect(z).toContainText("10:00–12:00");
    await expect(z).toContainText(name);
    await expect(z).toContainText("Ina Inhaber (über Claude)");
    await expect(z).toContainText("einmalige Abholung");

    // nicht doppelt buchen; Sonntag wird abgelehnt
    const doppelt = await c.call("abholung_anlegen", { ...wunsch, bestaetigt: true });
    expect(doppelt).toContain("schon eine Abholung gebucht");
    expect(await c.call("abholung_anlegen", { ...wunsch, datum: "Sonntag" })).toContain("Sonntag holt DHL nicht ab");

    // Stornieren über denselben Weg
    const liste = JSON.parse(await c.call("abholungen", { nur_offen: true }));
    const eintrag = liste.abholungen.find((a: { bestaetigungsnummer?: string }) => a.bestaetigungsnummer === r2.bestaetigungsnummer);
    expect(eintrag).toMatchObject({ dienst: "DHL", datum: tag, pakete: 12, abholort: name, fenster: "10:00–12:00" });
    expect(liste.abholorte.map((o: { schluessel: string }) => o.schluessel)).toContain(key);
    expect(JSON.parse(await c.call("abholung_stornieren", { id: eintrag.id })).meldung).toContain("storniert");
    expect((await empfangen()).at(-1)).toEqual({ dienst: "dhl", storno: r2.bestaetigungsnummer });
    const [st] = await sql<{ status: string; storniert_von_name: string; quelle: string }>("select status, storniert_von_name, quelle from abholungen where id = $1", [eintrag.id]);
    expect(st).toEqual({ status: "storniert", storniert_von_name: "Ina Inhaber (über Claude)", quelle: "claude" });
    await page.reload();
    await expect(zeile(page, r2.bestaetigungsnummer)).toHaveAttribute("data-status", "storniert");
    await expect(zeile(page, r2.bestaetigungsnummer).getByTestId("abholung-stornieren")).toHaveCount(0);
  });

  test("Abnahme 4: UPS-Abholung in drei Klicks, PRN gespeichert, Stornierung; VA bucht, aber keine Stammdaten", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const m = marke();
    const T = await tenant();
    // UPS-Sendung eines Palettenkunden (3 Kartons) wartet auf Abholung → Paketzahl vorbelegt
    await sql("update pallet_shipments set status = 'zugestellt' where tenant_id = $1 and carrier = 'ups' and direction = 'aus' and status = 'geplant'", [T]);
    const [ps] = await sql<{ id: string }>("insert into pallet_shipments (tenant_id, direction, title, carrier, carton_count, status) values ($1, 'aus', $2, 'ups', 3, 'geplant') returning id", [T, `UPS-Test ${m}`]);
    const [{ buero_areas }] = await sql<{ buero_areas: string[] | null }>("select m.areas as buero_areas from memberships m join users u on u.id = m.user_id where u.email = 'buero'");
    try {
      await anmelden(page, "inhaber");
      await page.goto("/versand/abholung");
      // Klick 1: UPS, Klick 2: Abholung buchen – Ort, Fenster und Paketzahl stehen schon drin
      await Promise.all([page.waitForURL(/dienst=ups/), page.getByTestId("abholung-dienst-ups").click()]);
      await expect(page.getByTestId("abholung-pakete")).toHaveValue("3");
      await expect(page.getByTestId("abholung-datum")).toHaveValue(naechsterAbholtag("ups"));
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("abholung-buchen").click()]);
      await expect(page.getByTestId("abholung-meldung")).toContainText("gebucht – Bestätigungsnummer 2929TEST");
      const prn = (await page.getByTestId("abholung-meldung").textContent())!.match(/2929TEST\d{3}/)![0];
      const req = (await empfangen()).filter((x) => x.dienst === "ups" && x.body).at(-1)!.body!.PickupCreationRequest;
      expect(req.Shipper.Account).toEqual({ AccountNumber: "T3ST01", AccountCountryCode: "DE" });
      expect(req.PickupDateInfo).toEqual({ ReadyTime: "0900", CloseTime: "1600", PickupDate: naechsterAbholtag("ups").replace(/-/g, "") });
      expect(req.PickupPiece[0].Quantity).toBe("3");
      expect(req.PickupAddress).toMatchObject({ CompanyName: "Testfirma GmbH", PostalCode: "12345", City: "Musterstadt" });
      const z = zeile(page, prn);
      await expect(z).toHaveAttribute("data-status", "gebucht");
      await expect(z.getByTestId("abholung-bestaetigung")).toHaveText(prn);
      // Klick 3 (Storno, mit Rückfrage)
      page.once("dialog", (d) => d.accept());
      await Promise.all([page.waitForURL(/meldung=/), z.getByTestId("abholung-stornieren").click()]);
      await expect(page.getByTestId("abholung-meldung")).toContainText(`storniert (Nr. ${prn})`);
      expect((await empfangen()).at(-1)).toEqual({ dienst: "ups", storno: prn });
      await expect(zeile(page, prn)).toHaveAttribute("data-status", "storniert");

      // VA (Bereich Service): bucht und sieht das Protokoll, aber keine Stammdaten
      await sql("update memberships set areas = '[\"start\",\"service\"]'::jsonb where user_id = (select id from users where email = 'buero')");
      const va = await browser.newContext();
      const vp = await va.newPage();
      await anmelden(vp, "buero");
      await vp.goto("/versand/abholung");
      await expect(vp.getByTestId("abholung-formular")).toBeVisible();
      await expect(vp.locator('a[href="/einstellungen/abholung"]')).toHaveCount(0);
      await vp.getByTestId("abholung-pakete").fill("2");
      await Promise.all([vp.waitForURL(/meldung=|fehler=/), vp.getByTestId("abholung-buchen").click()]);
      await expect(vp.getByTestId("abholung-meldung")).toContainText("gebucht – Bestätigungsnummer");
      const [vaZeile] = await sql<{ gebucht_von_name: string; status: string }>("select gebucht_von_name, status from abholungen where tenant_id = $1 order by created_at desc limit 1", [T]);
      expect(vaZeile).toEqual({ gebucht_von_name: "Bea Büro", status: "gebucht" });
      await vp.goto("/einstellungen/abholung");
      await expect(vp).toHaveURL(/gesperrt=inhaber/);
      await va.close();
    } finally {
      await sql("update memberships set areas = $1::jsonb where user_id = (select id from users where email = 'buero')", [JSON.stringify(buero_areas)]);
      await sql("delete from pallet_shipments where id = $1", [ps.id]);
    }
  });

  test("Abnahme 5: mehr als n fertige Labels ohne Abholung → Aufgabe mit Ein-Klick-Knopf und Push, nie automatisch gebucht", async ({ page }) => {
    test.setTimeout(120_000);
    const m = marke();
    const T = await tenant();
    const tag = naechsterAbholtag("dhl");
    // Ausgangslage: für den nächsten Abholtag nichts gebucht, kein alter Vorschlag; Push-Grenze je Stunde frei
    await sql("update abholungen set status = 'storniert' where tenant_id = $1 and dienst = 'dhl' and datum = $2 and status in ('gebucht', 'angefragt')", [T, tag]);
    await sql("delete from tasks where tenant_id = $1 and system_key like 'abholung:vorschlag:%'", [T]);
    await sql("update meldungen set created_at = created_at - interval '2 hours' where tenant_id = $1 and bezug->>'art' = 'aufgabe' and created_at > now() - interval '1 hour'", [T]);
    // Schwelle so, dass genau die 6 neuen Labels sie überschreiten (andere Prüfungen erstellen heute evtl. auch Labels)
    const [{ heute0 }] = await sql<{ heute0: number }>("select count(*)::int heute0 from parcels where tenant_id = $1 and upper(carrier) = 'DHL' and status = 'created' and is_return_label = 0 and created_at >= (date_trunc('day', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')", [T]);
    await sql("update tenants set settings = jsonb_set(settings, '{abholung,vorschlagAb}', to_jsonb($2::int)) where id = $1", [T, heute0 + 5]);
    const label = (i: number) => sql("insert into parcels (tenant_id, carrier, product, weight_kg, tracking_number, status) values ($1, 'DHL', 'V01PAK', 1, $2, 'created')", [T, `00340434TEST${m}${i}`]);
    try {
      for (let i = 1; i <= 5; i++) await label(i);
      await anmelden(page, "inhaber");
      await page.goto("/versand/abholung");
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("abholung-vorschlag-pruefen").click()]);
      await expect(page.getByTestId("abholung-meldung")).toContainText("Kein Vorschlag nötig");
      expect((await sql("select 1 from tasks where tenant_id = $1 and system_key like 'abholung:vorschlag:%'", [T])).length).toBe(0);

      await label(6);
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("abholung-vorschlag-pruefen").click()]);
      await expect(page.getByTestId("abholung-meldung")).toContainText(`Vorschlag: ${heute0 + 6} DHL-Labels`);
      const [task] = await sql<{ id: string; title: string; link: string; status: string; category: string }>("select id, title, link, status, category from tasks where tenant_id = $1 and system_key = $2", [T, `abholung:vorschlag:dhl:${tag}`]);
      expect(task.title).toContain(`Abholung buchen? ${heute0 + 6} DHL-Labels fertig`);
      expect(task).toMatchObject({ status: "open", category: "versand" });
      expect(task.link).toContain("vorschlag=1");
      await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int n from meldungen where tenant_id = $1 and bezug->>'id' = $2", [T, task.id]))[0].n).toBeGreaterThan(0);
      // Nicht automatisch gebucht
      expect((await sql("select 1 from abholungen where tenant_id = $1 and dienst = 'dhl' and datum = $2 and status in ('gebucht', 'angefragt')", [T, tag])).length).toBe(0);

      // Ein Klick aus der Aufgabe bucht genau den Vorschlag und schließt die Aufgabe
      await page.goto(task.link);
      await expect(page.getByTestId("abholung-vorschlag")).toContainText(`${heute0 + 6} Pakete`);
      await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("abholung-vorschlag-buchen").click()]);
      await expect(page.getByTestId("abholung-meldung")).toContainText(/gebucht – Bestätigungsnummer|bei DHL angefragt/);
      const [ab] = await sql<{ quelle: string; pakete: number }>("select quelle, pakete from abholungen where tenant_id = $1 and dienst = 'dhl' and datum = $2 and status in ('gebucht', 'angefragt')", [T, tag]);
      expect(ab).toEqual({ quelle: "vorschlag", pakete: heute0 + 6 });
      expect((await sql<{ status: string }>("select status from tasks where id = $1", [task.id]))[0].status).toBe("done");
    } finally {
      await sql("update tenants set settings = jsonb_set(settings, '{abholung,vorschlagAb}', '5'::jsonb) where id = $1", [T]);
      await sql("delete from parcels where tenant_id = $1 and tracking_number like $2", [T, `00340434TEST${m}%`]);
    }
  });
});
