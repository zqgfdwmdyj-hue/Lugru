// Nachtrag B31.6 (08.11.): Min unter Mindestmarge nur mit Regel „Liquidation“. Abnahme 6: Export mit Min unter dem
// effektiven Min enthält Rule Name „Liquidation“ und den festen Min; nach dem BQool-Lauf bleibt der Min stehen (Test mit
// einer SKU, dann Regelwechsel für alle). Abnahme 7: Buy Box 14 Tage über effektivem Min + 3 % → Vorschlag „zurück auf
// ia“. Dazu: Untergrenze Break-even, Verlust-Stopp-Ausnahme automatisch, Repricer „Regel seit“ + Filter, Kapital-Ampel.
// Alle SKUs und Werte erfunden.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const ERSTE = "FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)";
const KOPF = "Channel\tSellerSKU\tCost\tAdditional Cost\tRule Name\tMin Price\tMax Price\tShipping\tadd-delete\tGroup\tEnable Repricing";
const f2 = (n: number) => n.toFixed(2);
const ohneZeit = () => new Date().toISOString().slice(0, 10);

type Wechsel = { land: string; sku: string; regel_alt: string | null; regel_vorher: string | null; regel_neu: string; min_alt: number | null; min_gewuenscht: number | null; min_neu: number; effektiver_min: number | null; break_even: number | null; marge_neu_prozent: number | null; wartet_auf_test?: boolean };

test.describe("B31.6 – Min unter Marge nur mit Liquidation", () => {
  test("Abnahme 6/7: Regelwechsel auf Liquidation mit festem Min (nie unter Break-even), Test mit einer SKU, Min bleibt nach dem BQool-Lauf; Rückkehr-Vorschlag „zurück auf ia“", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const A = `TEST-LQ-${m}`;
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const heute = ohneZeit();
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', $4, 10, '20.00')", [T, P, A, heute]);
    await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, 4, $4)", [T, A, `Testartikel ${A} (erfunden)`, heute]);
    await sql("update tenants set settings = settings #- '{bqool,liquidationTest}' where id = $1", [T]);
    const istHochladen = async (regel: string, min: string, max = "150.00") => {
      const datei = [ERSTE, KOPF, `Amazon DE\t${A}\t23.80\t\t${regel}\t${min}\t${max}\t0.00\t\t\t1`, ""].join("\r\n");
      await page.goto("/uploads");
      await page.getByTestId("upload-dateien").setInputFiles([{ name: `Listings_${m}_${regel}.txt`, mimeType: "text/plain", buffer: Buffer.from(datei, "utf8") }]);
      await page.getByTestId("upload-los").click();
      await expect(page.getByTestId("upload-ergebnis")).toHaveAttribute("data-art", "bqool_datei", { timeout: 60_000 });
      await expect(page.getByTestId("upload-ergebnis")).toContainText(`BQool DE: 1 SKUs als Ist-Stand übernommen (${regel} 1)`);
    };
    const zuweisen = async (untergrenze: string) => {
      await page.goto("/repricer/bqool");
      const f = page.getByTestId("bq-zuweisung-form");
      await f.locator('input[name="sku"]').fill(A);
      await f.locator('select[name="regel"]').selectOption("ia");
      await f.locator('input[name="untergrenze"]').fill(untergrenze);
      for (const l of ["FR", "IT", "ES"]) await f.locator(`input[name="land"][value="${l}"]`).uncheck();
      await Promise.all([aktion(page), f.getByRole("button", { name: "Regel setzen" }).click()]);
      await expect(page.getByRole("status")).toContainText(`${A}: ia in DE gespeichert`);
    };
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const wechsel = async () => (JSON.parse(await c.call("bqool_export_vorschau", { land: "DE", limit: 100 })).liquidation.regelwechsel as Wechsel[]).find((w) => w.sku === A);

      // BQool-Ist vorher: Regel ia, Min 80
      await istHochladen("ia", "80.00");

      // ---- Untergrenze Break-even: gewünschter Min weit darunter → Liquidation, Min auf Break-even angehoben ----------
      await zuweisen("1,00");
      const w0 = (await wechsel())!;
      expect(w0).toMatchObject({ regel_alt: "ia", regel_vorher: "ia", regel_neu: "Liquidation", min_alt: 80, min_gewuenscht: 1, wartet_auf_test: true });
      expect(w0.break_even).not.toBeNull();
      expect(w0.min_neu).toBe(w0.break_even);
      expect(w0.effektiver_min!).toBeGreaterThan(w0.break_even!);
      const warn0 = (JSON.parse(await c.call("bqool_export_vorschau", { land: "DE", limit: 100 })).laender[0].groesste_aenderungen as { sku: string; warnungen?: string[] }[]).find((z) => z.sku === A)!.warnungen ?? [];
      expect(warn0.some((w) => w.includes("– auf Break-even angehoben (Abverkauf mit Verlust nicht freigegeben)"))).toBe(true);
      await page.goto("/repricer/bqool#liquidation");
      await expect(page.locator(`[data-testid="bq-liq-zeile"][data-sku="${A}"]`)).toContainText("gewünscht 1.00");

      // ---- Abnahme 6: gewünschter Min zwischen Break-even und effektivem Min → Rule Name „Liquidation“, fester Min -------
      const ziel = Math.round(((w0.break_even! + w0.effektiver_min!) / 2) * 100) / 100;
      await zuweisen(f2(ziel).replace(".", ","));
      const w1 = (await wechsel())!;
      expect(w1).toMatchObject({ regel_neu: "Liquidation", min_neu: ziel, min_gewuenscht: ziel, wartet_auf_test: true });
      expect(w1.marge_neu_prozent!).toBeGreaterThan(0);
      await page.goto("/repricer/bqool#liquidation");
      const zeile = page.locator(`[data-testid="bq-liq-zeile"][data-sku="${A}"]`);
      await expect(zeile).toContainText("ia → Liquidation");
      await expect(zeile).toContainText(`80.00 → ${f2(ziel)}`);
      await expect(zeile).toContainText(f2(w1.break_even!));
      await expect(zeile).toContainText("wartet auf Test");
      await expect(page.getByTestId("bq-liq-test")).toHaveAttribute("data-bestanden", "0");

      // Voller Export vor dem Test: Regelwechsel nicht in der Datei (nie Min unter effektivem Min ohne Regelwechsel)
      const e = page.getByTestId("bq-export-form");
      for (const l of ["FR", "IT", "ES"]) await e.locator(`input[name="land"][value="${l}"]`).uncheck();
      await e.locator('input[name="nur_aenderungen"]').uncheck();
      await Promise.all([aktion(page), page.getByTestId("bq-export-los").click()]);
      await expect(page.getByRole("status")).toContainText("Export erzeugt");
      const vorTest = await (await page.request.get((await page.getByTestId("bq-datei-DE").getAttribute("href"))!)).text();
      expect(vorTest).not.toContain(A);

      // Test-Export nur mit dieser SKU: Rule Name „Liquidation“ + fester Min
      await page.goto("/repricer/bqool#liquidation");
      await page.getByTestId("bq-liq-test-wahl").selectOption(`DE|${A}`);
      await Promise.all([aktion(page), page.getByTestId("bq-liq-test-export").click()]);
      await expect(page.getByRole("status")).toContainText(`Test-Export: nur ${A} (DE) mit Liquidation`);
      const testDatei = await (await page.request.get((await page.getByTestId("bq-datei-DE").getAttribute("href"))!)).text();
      const testZeilen = testDatei.split("\n").filter((z) => z.startsWith("Amazon DE\t"));
      expect(testZeilen).toHaveLength(1);
      const [, sku, cost, , regel, min] = testZeilen[0].split("\t");
      expect([sku, cost, regel, min]).toEqual([A, "23.80", "Liquidation", f2(ziel)]);

      // BQool-Lauf 1: Ist zeigt Liquidation mit dem gesetzten Min → aktiv, Verlust-Stopp-Ausnahme automatisch
      await istHochladen("Liquidation", f2(ziel));
      const [lq] = await sql<{ status: string; regel_vorher: string; min_gesetzt: string; break_even: string }>("select status, regel_vorher, min_gesetzt, break_even from bqool_liquidationen where tenant_id = $1 and land = 'DE' and sku = $2", [T, A]);
      expect(lq).toMatchObject({ status: "aktiv", regel_vorher: "ia" });
      expect(Number(lq.min_gesetzt)).toBe(ziel);
      const [ausn] = await sql<{ grund: string }>("select grund from verlust_ausnahmen where tenant_id = $1 and sku = $2", [T, A]);
      expect(ausn.grund).toMatch(/^BQool-Liquidation DE \(Min unter Marge, vorher „ia“\) seit .* – nur bis Break-even$/);
      await page.goto("/repricer/bqool#liquidation");
      await expect(page.getByTestId("bq-liq-test")).toHaveAttribute("data-bestanden", "0");
      await expect(page.locator(`[data-testid="bq-liq-aktiv-zeile"][data-sku="${A}"]`)).toHaveAttribute("data-status", "aktiv");
      await expect(page.locator(`[data-testid="bq-liq-zeile"][data-sku="${A}"]`)).toHaveCount(0);

      // BQool-Lauf 2 (≥ 12 Std. später): Min und Regel stehen noch → Test bestanden
      await sql("update bqool_liquidationen set aktiv_seit = aktiv_seit - interval '13 hours' where tenant_id = $1 and sku = $2", [T, A]);
      await istHochladen("Liquidation", f2(ziel));
      await page.goto("/repricer/bqool#liquidation");
      await expect(page.getByTestId("bq-liq-test")).toHaveAttribute("data-bestanden", "1");
      await expect(page.getByTestId("bq-liq-test")).toContainText(`Test bestanden`);
      await expect(page.getByTestId("bq-liq-test")).toContainText(`(DE ${A}) – BQool-Ist zeigte Liquidation und Min nach dem nächsten Lauf noch`);
      const rp = JSON.parse(await c.call("repricer", { ansicht: "alle", suche: A, marktplatz: "DE" })).zeilen[0];
      expect(rp).toMatchObject({ regel: "Liquidation", min_bqool: ziel, regel_seit: ohneZeit(), liquidation_wegen_min_unter_marge: { regel_vorher: "ia" } });
      // Nach bestandenem Test: voller Export enthält den Regelwechsel (Liquidation + fester Min)
      const e2 = page.getByTestId("bq-export-form");
      for (const l of ["FR", "IT", "ES"]) await e2.locator(`input[name="land"][value="${l}"]`).uncheck();
      await e2.locator('input[name="nur_aenderungen"]').uncheck();
      await Promise.all([aktion(page), page.getByTestId("bq-export-los").click()]);
      const nachTest = await (await page.request.get((await page.getByTestId("bq-datei-DE").getAttribute("href"))!)).text();
      expect(nachTest.split("\n").find((z) => z.startsWith(`Amazon DE\t${A}\t`))!.split("\t").slice(4, 6)).toEqual(["Liquidation", f2(ziel)]);

      // Repricer: Spalte „Regel seit“ + Filter „Liquidation wegen Min unter Marge“; kein Hinweis „Min unter System-Min“
      await page.goto(`/repricer?liq=1&bq=alle&q=${A}#bqool-liste`);
      await expect(page.getByTestId("bqool-filter-liq")).toHaveValue("1");
      await expect(page.getByTestId("bqool-liq-marge").first()).toContainText("wegen Min unter Marge (vorher ia)");
      await expect(page.getByTestId("bqool-regel-seit").first()).not.toHaveText("–");
      // Kapital-Ampel: „1 SKU auf Liquidation (Min unter Marge), davon 0 unter Break-even“ (Zahl hängt von anderen Testdaten ab)
      await page.goto("/kapital");
      await expect(page.getByTestId("kapital-liquidation")).toContainText(/\d+ SKUs? auf Liquidation \(Min unter Marge\), davon \d+ unter Break-even/);

      // ---- Abnahme 7: Buy Box 14 Tage über effektivem Min + 3 % → Vorschlag „zurück auf ia“ ----------------------------
      const schwelle = Math.round(w1.effektiver_min! * 1.03 * 100) / 100;
      await sql("update bqool_listings set buybox_preis = $3 where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, A, f2(schwelle + 5)]);
      // Tag 13: noch kein Vorschlag
      await sql("update bqool_liquidationen set ueber_seit = current_date - 13 where tenant_id = $1 and sku = $2", [T, A]);
      await page.goto("/repricer/bqool#liquidation");
      await Promise.all([aktion(page), page.getByTestId("bq-liq-pruefen").click()]);
      await expect(page.getByRole("status")).toContainText("Liquidation geprüft: 0 neu aktiv, 0 neue Rückkehr-Vorschläge");
      await expect(page.locator(`[data-testid="bq-liq-aktiv-zeile"][data-sku="${A}"]`)).toHaveAttribute("data-status", "aktiv");
      // Tag 14: Vorschlag + Aufgabe
      await sql("update bqool_liquidationen set ueber_seit = current_date - 14 where tenant_id = $1 and sku = $2", [T, A]);
      await Promise.all([aktion(page), page.getByTestId("bq-liq-pruefen").click()]);
      await expect(page.getByRole("status")).toContainText("1 neue Rückkehr-Vorschläge");
      const aktivZeile = page.locator(`[data-testid="bq-liq-aktiv-zeile"][data-sku="${A}"]`);
      await expect(aktivZeile).toHaveAttribute("data-status", "zurueck_vorgeschlagen");
      await expect(aktivZeile).toContainText(`${f2(schwelle + 5)} / ${f2(schwelle)}`);
      await expect(aktivZeile.getByTestId("bq-liq-zurueck")).toHaveText("zurück auf ia");
      const [aufgabe] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'bqool-rueckkehr' and status = 'open'", [T]);
      expect(aufgabe.title).toMatch(/^BQool: \d+ SKUs? zurück von Liquidation auf die ursprüngliche Regel\?$/);
      expect(aufgabe.notes).toContain(`• DE ${A} → ia`);
      const v = JSON.parse(await c.call("bqool_export_vorschau", { land: "DE" }));
      expect(v.liquidation.rueckkehr_vorgeschlagen).toContainEqual(expect.objectContaining({ land: "DE", sku: A, zurueck_auf: "ia" }));
      const rp2 = JSON.parse(await c.call("repricer", { ansicht: "alle", suche: A, marktplatz: "DE" })).zeilen[0];
      expect(rp2.liquidation_wegen_min_unter_marge).toEqual({ regel_vorher: "ia", rueckkehr_vorgeschlagen: true });

      // Freigabe „zurück auf ia“ → Soll ia ohne Wunsch-Min (Min = effektiver Min), Liquidation beendet, Ausnahme weg
      await Promise.all([aktion(page), aktivZeile.getByTestId("bq-liq-zurueck").click()]);
      await expect(page.getByRole("status")).toContainText(`${A} (DE): zurück auf „ia“ – kommt mit der nächsten Datei`);
      const [zw] = await sql<{ regel: string; untergrenze: string | null }>("select regel, untergrenze from bqool_zuweisungen where tenant_id = $1 and land = 'DE' and sku = $2", [T, A]);
      expect(zw).toEqual({ regel: "ia", untergrenze: null });
      expect((await sql<{ status: string }>("select status from bqool_liquidationen where tenant_id = $1 and sku = $2", [T, A]))[0].status).toBe("beendet");
      expect(await sql("select 1 from verlust_ausnahmen where tenant_id = $1 and sku = $2", [T, A])).toHaveLength(0);
      const soll = (JSON.parse(await c.call("bqool_export_vorschau", { land: "DE", limit: 100 })).laender[0].groesste_aenderungen as { sku: string; regel_ist: string; regel_soll: string; min_datei: number; effektiver_min: number }[]).find((z) => z.sku === A)!;
      expect(soll).toMatchObject({ regel_ist: "Liquidation", regel_soll: "ia", min_datei: soll.effektiver_min });
    } finally {
      await sql("update tenants set settings = settings #- '{bqool,liquidationTest}' where id = $1", [T]);
      await sql("update tasks set status = 'done' where tenant_id = $1 and system_key = 'bqool-rueckkehr' and status = 'open'", [T]);
      await sql("delete from verlust_ausnahmen where tenant_id = $1 and sku = $2", [T, A]);
      await sql("delete from bqool_liquidationen where tenant_id = $1 and sku = $2", [T, A]);
      await sql("delete from bqool_zuweisungen where tenant_id = $1 and sku = $2", [T, A]);
      await sql("delete from bqool_listings where tenant_id = $1 and sku = $2", [T, A]);
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = $2", [T, A]);
      await sql("delete from lots where tenant_id = $1 and sku = $2", [T, A]);
    }
  });
});
