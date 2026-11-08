// Nachtrag B33 (08.11.): BQool-Formel, Regel-Katalog je Land, Min-Reset, Export per „Download listings“, Nachkontrolle
// Min vorher/nachher, Processing Report der Uploads. Gegen den BQool-Nachbau – alle SKUs, Preise und Gebühren erfunden
// (die 20 Eichzeilen aus dem Auftrag stehen nicht im Repo; die Formel prüfen die Unit-Tests).
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const bqool = (body: unknown) => fetch(`${TD}/__bqool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** BQool-Zeit (UTC+02:00) eines Tages als „MM/DD/YYYY h:mm PM“ und die deutsche Uhrzeit dazu. */
function bqZeit(tag: Date, stunde: number, minute: number) {
  const mm = String(tag.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tag.getUTCDate()).padStart(2, "0");
  const roh = `${mm}/${dd}/${tag.getUTCFullYear()} ${stunde > 12 ? stunde - 12 : stunde}:${String(minute).padStart(2, "0")} ${stunde >= 12 ? "PM" : "AM"}`;
  const utc = new Date(Date.UTC(tag.getUTCFullYear(), tag.getUTCMonth(), tag.getUTCDate(), stunde, minute) - 120 * 60_000);
  const berlin = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(utc).replace(/^(\d\d)\.(\d\d)\.?,? /, "$1.$2., ");
  return { roh, berlin };
}

test.describe("B33 – BQool-Formel, Katalog je Land, Min-Reset, Download listings, Processing Report", () => {
  test("Abnahme 1–5: effektiver Min je Land, Katalog mit Stufentyp, Markierung Min-Reset, Nachkontrolle Min vorher/nachher, Upload-Fehler sichtbar", async ({ page, browser, baseURL }) => {
    test.setTimeout(420_000);
    const m = marke();
    const A = `TEST-BQ33-${m}-A`;
    const L = `TEST-BQ33-${m}-L`;
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const heute = new Date().toISOString().slice(0, 10);
    const [vorher] = await sql<{ katalog: unknown; laender: unknown; export_url: string | null }>("select t.settings->'bqool'->'katalog' as katalog, t.settings->'bqool'->'laender' as laender, i.config->>'exportUrl' as export_url from tenants t left join integrations i on i.tenant_id = t.id and i.provider = 'bqool_web' where t.id = $1", [T]);
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', $4, 10, '10.00'), ($1, $2, $5, 'purchase', 'test', $4, 10, '10.00')", [T, P, A, heute, L]);
    for (const sku of [A, L]) {
      await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, 4, $4)", [T, sku, `Testartikel ${sku} (erfunden)`, heute]);
      // frischer Bestand: Altersstufe 0–30 Tage
      await sql(`insert into amazon_lageralter (tenant_id, land, sku, verfuegbar, "alter", abgerufen_am) values ($1, 'DE', $2, 4, '{"0-30": 4}', now())`, [T, sku]);
    }
    // Nur DE und FR, Katalog = Standard (Stand BQool 08.11.), Listen-Seite statt Export-Seite (B33.6)
    await sql(`update tenants set settings = jsonb_set(settings, '{bqool}', (coalesce(settings->'bqool', '{}'::jsonb) - 'katalog' - 'uploadFehler') || '{"laender": ["DE", "FR"]}'::jsonb, true) where id = $1`, [T]);
    await sql("update integrations set config = config || jsonb_build_object('exportUrl', replace(config->>'uploadUrl', '/upload/', '/repricing/')) where tenant_id = $1 and provider = 'bqool_web'", [T]);
    // BQool-Ist im Nachbau: A mit „ia“ in DE/FR (Min 30 über Buy Box 26), L mit Liquidation (fester Min 25) in FR;
    // Gebühren je Land in der Liste: DE FBA 3,00 / FR FBA 5,00, Referral 15 % von 28,00
    const gestern = new Date(Date.now() - 86_400_000);
    const z1 = bqZeit(gestern, 15, 32);
    const z2 = bqZeit(gestern, 21, 23);
    await bqool({
      zuruecksetzen: true,
      ist: {
        DE: [{ sku: A, regel: "ia", min: 30, max: 60, cost: 11.9, preis: 28, buybox: 26 }],
        FR: [{ sku: A, regel: "ia", min: 30, max: 60, cost: 11.9, preis: 28, buybox: 26 }, { sku: L, regel: "Liquidation", min: 25, max: 60, cost: 11.9, preis: 28, buybox: 27 }],
      },
      gebuehren: { DE: { [A]: { fba: 3, referral: 4.2 } }, FR: { [A]: { fba: 5, referral: 4.2 }, [L]: { fba: 5, referral: 4.2 } } },
      verlauf: {
        DE: [{ zeit: z1.roh, datei: "BQool_DE_test.txt", fehler: [{ zeile: 3, sku: "TEST-SKU-B33-ALT", text: "Invalid Min Price" }] }],
        FR: [{ zeit: z2.roh, datei: "BQool_FR_test.txt", fehler: [{ zeile: 5, sku: "TEST-SKU-B33-ALT2", text: "Rule Name not found" }] }],
      },
    });
    await sql("delete from bqool_laeufe where tenant_id = $1", [T]);
    try {
      await anmelden(page, "inhaber");
      // Lauf starten: Ist per Listen-Seite + „Download listings“ (DE, FR), Processing Reports lesen, Soll erzeugen
      await page.goto("/repricer/bqool#freigabe");
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 180_000 }), page.getByTestId("bq-kreislauf-starten").click()]);
      await expect(page.getByRole("status")).toContainText("Freigabe angefragt");
      await expect(page.getByTestId("bq-lauf-ist")).toContainText("DE");
      const geb = await sql<{ land: string; fba: number; satz: number }>("select land, fba::float as fba, provision_satz::float as satz from bqool_gebuehren where tenant_id = $1 and sku = $2 and quelle = 'bqool' order by land", [T, A]);
      expect(geb).toEqual([{ land: "DE", fba: 3, satz: 0.15 }, { land: "FR", fba: 5, satz: 0.15 }]);

      // ---- Abnahme 1: effektiver Min = P(m) mit den Gebühren des Landes (FR nicht aus DE) -------------------------
      // DE 0–30 T 10 %: (3 + 11,90/1,19) / (1/1,19 − 0,15 − 0,10) = 22,02 · FR 0–30 T 11 %: (5 + 11,90/1,20) / (1/1,20 − 0,15 − 0,11) = 26,02
      await page.goto("/repricer/bqool?land=FR#vorschau-FR");
      const fr = page.locator(`[data-testid="bq-tabelle"][data-land="FR"] tr[data-sku="${A}"]`);
      await expect(fr.getByTestId("bq-effmin")).toContainText("26.02 (11 %)");
      await expect(fr.getByTestId("bq-gebuehren")).toContainText("F 5.00 · r 15,0 % · BQool");
      await page.goto("/repricer/bqool?land=DE#vorschau-DE");
      const de = page.locator(`[data-testid="bq-tabelle"][data-land="DE"] tr[data-sku="${A}"]`);
      await expect(de.getByTestId("bq-effmin")).toContainText("22.02 (10 %)");
      await expect(de.getByTestId("bq-effmin")).toContainText("10 % (Available ≥ 1)");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const v = JSON.parse(await c.call("bqool_export_vorschau", { land: "FR" }));
      const zeileFr = v.laender[0].groesste_aenderungen.find((x: { sku: string }) => x.sku === A);
      expect(zeileFr).toMatchObject({ effektiver_min: 26.02, marge_prozent: 11, min_reset: true, gebuehren: { fba: 5, provision: 0.15, quelle: "bqool" } });

      // ---- Abnahme 3: Export-Vorschau markiert ia/Abverkauf „Min wird von BQool täglich überschrieben“ -----------
      await expect(de.getByTestId("bq-min-reset")).toHaveText("Min wird von BQool täglich überschrieben");
      await page.goto("/repricer/bqool?land=FR#vorschau-FR");
      await expect(page.locator(`[data-testid="bq-tabelle"][data-land="FR"] tr[data-sku="${L}"]`).getByTestId("bq-min-reset")).toHaveCount(0);

      // ---- Abnahme 2: Katalog je Land und Stufe mit Typ, Marge, Bedingung; ohne feste Marge keine Prozentzahl ----
      const kat = page.getByTestId("bq-katalog-je-land");
      const iaDe = kat.locator('tr[data-regel="ia"][data-land="DE"]');
      await expect(iaDe.getByTestId("bq-stufe").first()).toContainText("10 %");
      await expect(iaDe.getByTestId("bq-stufe").first()).toContainText("Available ≥ 1");
      await expect(iaDe).toContainText("37");
      const iaFr = kat.locator('tr[data-regel="ia"][data-land="FR"]');
      await expect(iaFr.locator('[data-testid="bq-stufe"][data-bis="90"]')).toHaveAttribute("data-typ", "lowest_price");
      await expect(iaFr.locator('[data-testid="bq-stufe"][data-bis="90"]')).toContainText("Lowest Price + 6 %");
      await expect(iaFr.locator('[data-testid="bq-stufe"][data-bis="30"]')).toContainText("Inbound ≥ 0");
      const smIt = kat.locator('tr[data-regel="Abverkauf"][data-land="IT"] [data-testid="bq-stufe"][data-bis="270"]');
      await expect(smIt).toContainText("Sales Maximizer");
      expect(await smIt.innerText()).not.toContain("%");
      await expect(kat.locator('tr[data-regel="Abverkauf DE"][data-land="DE"]').getByTestId("bq-stufe")).toHaveText([/^5 %/, /^4 %/, /^3 %/, /^1 %/, /^0 %/, /^1 %/, /^0 %/]);

      // ---- Abnahme 5: Upload-Fehler (Processing Report) ausgelesen und sichtbar, deutsche Zeit + BQool-Zeit -------
      const uf = page.getByTestId("bq-upload-fehler");
      await expect(uf.locator('[data-testid="bq-upload-fehler-zeile"][data-land="DE"]')).toContainText(`DE ${z1.berlin} (BQool ${z1.roh}) BQool_DE_test.txt: 1 Fehler – TEST-SKU-B33-ALT: Error · Invalid Min Price`);
      await expect(uf.locator('[data-testid="bq-upload-fehler-zeile"][data-land="FR"]')).toContainText(`FR ${z2.berlin} (BQool ${z2.roh})`);
      await expect(uf.locator('[data-testid="bq-upload-fehler-zeile"][data-land="FR"]')).toContainText("TEST-SKU-B33-ALT2: Error · Rule Name not found");
      const [aufgabe] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'bqool-upload-fehler' and status = 'open'", [T]);
      expect(aufgabe.title).toContain("BQool-Upload-Fehler laut Processing Report");
      expect(aufgabe.notes).toContain("Invalid Min Price");
      // Knopf „Processing Reports lesen“ (nur lesen) liefert dasselbe
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 120_000 }), page.getByTestId("bq-upload-fehler-lesen").click()]);
      await expect(page.getByRole("status")).toContainText("Processing Reports: 2 Uploads mit Fehlern");

      // ---- Abnahme 4: Freigeben → Upload → Nachkontrolle per „Download listings“ mit Min vorher/nachher -----------
      await page.goto("/repricer/bqool#freigabe");
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 180_000 }), page.getByTestId("bq-freigeben").click()]);
      await expect(page.getByRole("status")).toContainText("Freigegeben und hochgeladen");
      // BQool setzt den Min bei „ia“ täglich zurück (hier: anderer Wert in DE) – bei Liquidation darf er sich nicht ändern
      const stand = (await (await fetch(`${TD}/__bqool`)).json()) as { ist: Record<string, { sku: string; regel: string; min: number; max: number; cost: number }[]> };
      const neu = (land: string, sku: string, min: number) => ({ ...stand.ist[land].find((x) => x.sku === sku)!, min });
      const datei = { de: stand.ist.DE.find((x) => x.sku === A)!.min, frA: stand.ist.FR.find((x) => x.sku === A)!.min, frL: stand.ist.FR.find((x) => x.sku === L)!.min };
      await bqool({ ist: { DE: [neu("DE", A, 23.1)], FR: [neu("FR", A, datei.frA), neu("FR", L, 24)] } });
      await page.goto("/repricer/bqool#freigabe");
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 180_000 }), page.getByTestId("bq-kontrolle-jetzt").click()]);
      await expect(page.getByRole("status")).toContainText("Nachkontrolle: 1 Abweichung bei 3 SKUs");
      await expect(page.getByRole("status")).toContainText("1 SKU mit anderem Min bei Regel mit täglichem Reset – kein Fehler");
      const kz = page.getByTestId("bq-kontrolle");
      await expect(kz).toContainText(`${L}: Min vorher 25,00 / Datei ${datei.frL.toFixed(2).replace(".", ",")} / nachher 24,00 – Min hätte stehen bleiben müssen`);
      await kz.getByTestId("bq-kontrolle-min").locator("summary").click();
      const zeile = (sku: string, land: string) => kz.locator(`[data-testid="bq-kontrolle-min-zeile"][data-sku="${sku}"][data-land="${land}"]`);
      await expect(zeile(A, "DE")).toHaveAttribute("data-status", "reset");
      await expect(zeile(A, "DE").locator("td").nth(3)).toHaveText("30.00");
      await expect(zeile(A, "DE").locator("td").nth(4)).toHaveText(datei.de.toFixed(2));
      await expect(zeile(A, "DE").locator("td").nth(5)).toHaveText("23.10");
      await expect(zeile(A, "DE")).toContainText("Min wird täglich zurückgesetzt – kein Fehler");
      await expect(zeile(A, "FR")).toHaveAttribute("data-status", "gleich");
      await expect(zeile(L, "FR")).toHaveAttribute("data-status", "fehler");
      const [nk] = await sql<{ notes: string }>("select notes from tasks where tenant_id = $1 and system_key = 'bqool-nachkontrolle' and status = 'open'", [T]);
      expect(nk.notes).toContain(`FR ${L}:`);
      expect(nk.notes).not.toContain(`DE ${A}:`);
    } finally {
      await sql("update tenants set settings = jsonb_set(settings, '{bqool}', (coalesce(settings->'bqool', '{}'::jsonb) - 'laender' - 'uploadFehler') || jsonb_strip_nulls(jsonb_build_object('laender', $2::jsonb, 'katalog', $3::jsonb)), true) where id = $1", [T, vorher.laender ? JSON.stringify(vorher.laender) : null, vorher.katalog ? JSON.stringify(vorher.katalog) : null]);
      await sql("delete from bqool_liquidationen where tenant_id = $1 and sku = any($2)", [T, [A, L]]);
      await sql("update integrations set config = config || jsonb_build_object('exportUrl', $2::text) where tenant_id = $1 and provider = 'bqool_web'", [T, vorher.export_url ?? `${TD}/web-bqool/export/amazonde`]);
      await sql("delete from bqool_laeufe where tenant_id = $1", [T]);
      await sql("update tasks set status = 'done' where tenant_id = $1 and (system_key like 'bqool-%' or system_key like 'automatik-bqool-%') and status = 'open'", [T]);
      await bqool({ zuruecksetzen: true });
      await sql("delete from bqool_gebuehren where tenant_id = $1 and sku = any($2)", [T, [A, L]]);
      await sql("delete from bqool_listings where tenant_id = $1 and sku = any($2)", [T, [A, L]]);
      await sql("delete from amazon_lageralter where tenant_id = $1 and sku = any($2)", [T, [A, L]]);
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = any($2)", [T, [A, L]]);
      await sql("delete from lots where tenant_id = $1 and sku = any($2)", [T, [A, L]]);
    }
  });
});
