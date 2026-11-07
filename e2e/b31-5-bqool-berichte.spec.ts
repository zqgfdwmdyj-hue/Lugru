// Nachtrag B31.5 (07.11.): BQool-Berichte „Listing Performance“ (je Land) und „Daily Sales“ – Erkennung beim Upload
// (Typ und Land), Reiter „Leistung“ mit drei Listen und Buy-Box-Anteil, Gewinn-Vergleich, Verlust-Stopp zweite Quelle,
// Rückfrage „Welches Land?“, täglicher Lauf holt die Berichte selbst. Alle SKUs und Zahlen erfunden.
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const KOPF = ["Products", "Rules", "Sales", "Sales %", "Orders", "Units Ordered", "Est. Profit", "Buy Box Wins", "Lowest Price Win %", "At Min %", "At Max %", "Below Min %", "Avg Offers", "Avg Position", "Reprice", "Price Up", "Price Down", "Price Changes", "Compete Amazon %", "Buy Box Lost Amazon %", "Buy Box Lost FBA %", "Buy Box Lost FBM %"];
const eur = (n: number) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (n: number) => `${String(n).replace(".", ",")}%`;
type Z = { sales: number; units: number; profit: number; bb: number; below: number; chg?: number };
const zeile = (produkt: string, regel: string, z: Z) => [`"${produkt}"`, regel, eur(z.sales), "10%", String(z.units), String(z.units), eur(z.profit), pct(z.bb), "0%", "0%", "0%", pct(z.below), "3", "2", "10", "5", "5", eur(z.chg ?? 12), "0%", "0%", "0%", "0%"].join("\t");
const lp = (zeilen: string[]) => Buffer.from(`﻿${[KOPF.join("\t"), ...zeilen].join("\r\n")}\r\n`, "utf8");
const sku = (s: string) => `Testartikel ${s} (erfunden)\nSKU: ${s}`;
const tagMinus = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const bqool = (body: unknown) => fetch(`${TD}/__bqool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test.describe("B31.5 – BQool-Berichte", () => {
  test.describe.configure({ mode: "serial" });

  test("Abnahme 5: fünf Dateien hochladen → Typ und Land erkannt, Reiter „Leistung“ mit drei Listen und Buy-Box-Anteil, Gewinn, Verlust-Stopp, Rückfrage Land", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const [A, B, C, D, X] = ["A", "B", "C", "D", "X"].map((x) => `TEST-B5-${m}-${x}`);
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const heute = new Date().toISOString().slice(0, 10);
    // Ist je Land (letzter „Manage Listings“) – Grundlage für die Land-Erkennung über SKUs und Regeln
    const ist: [string, string, string, number][] = [["DE", A, "ia", 99], ["DE", B, "Abverkauf DE", 40], ["DE", C, "ia", 50], ["FR", A, "ia", 99], ["FR", B, "Abverkauf", 40], ["IT", A, "Abverkauf", 40], ["IT", C, "ia", 50], ["ES", B, "ia", 50], ["ES", D, "ia", 50]];
    for (const [land, s, regel, min] of ist) await sql("insert into bqool_listings (tenant_id, marktplatz, sku, regel, min, max, eingelesen_am) values ($1, $2, $3, $4, $5, 300, now()) on conflict (tenant_id, marktplatz, sku) do update set regel = excluded.regel, min = excluded.min", [T, land, s, regel, min]);
    for (const s of [A, B, C, D]) {
      await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', $4, 10, '10.00')", [T, P, s, heute]);
      await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, 4, $4)", [T, s, `Testartikel ${s} (erfunden)`, heute]);
    }
    const dateien = [
      { name: "Listing_Performance_1001.txt", buffer: lp([zeile(sku(A), "ia", { sales: 100, units: 2, profit: 10, bb: 5, below: 80 }), zeile(sku(B), "Abverkauf DE", { sales: 50, units: 1, profit: -30, bb: 40, below: 0 }), zeile(sku(C), "ia", { sales: 200, units: 4, profit: 20, bb: 60, below: 0, chg: -800 }), zeile("Total", "-", { sales: 350, units: 7, profit: 0, bb: 30, below: 0 })]) },
      { name: "Listing_Performance_1002.txt", buffer: lp([zeile(sku(A), "ia", { sales: 600, units: 6, profit: 60, bb: 40, below: 0 }), zeile(sku(B), "Abverkauf", { sales: 400, units: 4, profit: 5, bb: 40, below: 0 })]) },
      { name: "Listing_Performance_1003.txt", buffer: lp([zeile(sku(A), "Abverkauf", { sales: 300, units: 3, profit: 3, bb: 30, below: 0 }), zeile(sku(C), "ia", { sales: 300, units: 3, profit: 30, bb: 40, below: 0 })]) },
      { name: "Listing_Performance_1004.txt", buffer: lp([zeile(sku(B), "ia", { sales: 100, units: 1, profit: 10, bb: 50, below: 0 }), zeile(sku(D), "ia", { sales: 50, units: 1, profit: 5, bb: 50, below: 0 })]) },
      { name: "Daily_Sales_1005.txt", buffer: Buffer.from(`﻿${["Date\tSales\tSales (FBA)\tSales (FBM)\tOrders\tUnits Ordered\tEst. Profit\tBuy Box Wins", ...[7, 6, 5, 4, 3, 2, 1].map((n) => `${tagMinus(n)}\t50,00 €\t50,00 €\t-\t1\t1\t5,00 €\t30,00%`)].join("\r\n")}\r\n`, "utf8") },
    ];
    try {
      await anmelden(page, "inhaber");
      await page.goto("/uploads");
      await page.getByTestId("upload-dateien").setInputFiles(dateien.map((d) => ({ ...d, mimeType: "text/plain" })));
      await page.getByTestId("upload-los").click();
      const erg = page.getByTestId("upload-ergebnis");
      await expect(erg).toHaveCount(5, { timeout: 120_000 });
      await expect(page.locator('[data-testid="upload-ergebnis"][data-art="bqool_listing_performance"]')).toHaveCount(4);
      await expect(page.locator('[data-testid="upload-ergebnis"][data-art="bqool_daily_sales"]')).toHaveCount(1);
      for (const l of ["DE", "FR", "IT", "ES"]) await expect(erg.filter({ hasText: `BQool Listing Performance ${l} (7 Tage bis` })).toHaveCount(1);
      await expect(erg.filter({ hasText: "BQool Daily Sales DE: 7 Tage" })).toHaveCount(1);
      await expect(erg.filter({ hasText: "BQool Listing Performance DE (" })).toContainText("Buy Box 30 %");
      await expect(erg.filter({ hasText: "BQool Daily Sales DE" })).toContainText("Umsatz passt zur Listing Performance DE");

      // Reiter „Leistung“: Stand je Land, Buy-Box-Anteil wie in den Dateien, drei Listen mit Vorschlag
      await page.goto("/repricer/leistung");
      await expect(page.getByTestId("sub-tabs")).toContainText("Leistung");
      for (const [l, bb] of [["DE", "30 %"], ["FR", "40 %"], ["IT", "35 %"], ["ES", "50 %"]]) await expect(page.getByTestId(`leistung-bb-${l}`)).toHaveText(bb);
      await expect(page.getByTestId("leistung-buybox")).toContainText("30 %");
      await expect(page.getByTestId("leistung-unter-min").locator(`tr[data-sku="${A}"]`)).toContainText("Min senken auf effektiven Min");
      await expect(page.getByTestId("leistung-verlust").locator(`tr[data-sku="${B}"]`)).toContainText("Liquidation");
      await expect(page.getByTestId("leistung-preisbewegung").locator(`tr[data-sku="${C}"]`)).toContainText("BQool-Regel prüfen");
      const [aufgabe] = await sql<{ title: string }>("select title from tasks where tenant_id = $1 and system_key = 'bqool-regel-pruefen-DE' and status = 'open'", [T]);
      expect(aufgabe?.title).toContain("auffälliger Preisbewegung (DE)");

      // Gewinn-Seite: Vergleichsspalte BQool je Tag; Verlust-Stopp: zweite Quelle
      await page.goto("/gewinn?zeitraum=30");
      await expect(page.getByTestId("bqool-vergleich").getByTestId("bqool-tag")).toHaveCount(7);
      await page.goto("/verlust");
      await expect(page.getByTestId("verlust-bqool").locator(`tr[data-sku="${B}"]`)).toContainText("Abverkauf DE");

      // Claude: repricer (Buy-Box-Anteil je Land/Woche), umsatz (BQool-Vergleich), verlust_stopp (zweite Quelle)
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const rp = JSON.parse(await c.call("repricer", {}));
      expect(rp.buybox_anteil.je_land.find((x: { land: string }) => x.land === "DE").prozent).toBe(30);
      expect(rp.buybox_anteil.je_woche.length).toBeGreaterThan(0);
      const um = JSON.parse(await c.call("umsatz", { zeitraum: "30_tage" }));
      expect(um.bqool.je_land.find((x: { land: string }) => x.land === "DE")).toMatchObject({ umsatz_brutto: 350, tage: 7, buybox_anteil_mittel: 30 });
      const vs = JSON.parse(await c.call("verlust_stopp", {}));
      expect(vs.bqool_zweite_quelle.artikel.some((x: { sku: string }) => x.sku === B)).toBe(true);

      // Land nicht erkennbar → Rückfrage mit Knöpfen; Zeitraum 30 Tage beim Upload gewählt
      await page.goto("/uploads");
      await page.locator("summary", { hasText: "Angaben für BQool-Berichte" }).click();
      await page.getByTestId("upload-bqool-tage").selectOption("30");
      await page.getByTestId("upload-dateien").setInputFiles([{ name: "Listing_Performance_1006.txt", mimeType: "text/plain", buffer: lp([zeile(sku(X), "ia", { sales: 10, units: 1, profit: 1, bb: 10, below: 0 })]) }]);
      await page.getByTestId("upload-los").click();
      await expect(page.getByTestId("upload-ergebnis")).toContainText("Welches Land?", { timeout: 60_000 });
      await page.getByTestId("land-rueckfrage").getByTestId("land-FR").click();
      await expect(page.getByTestId("land-ergebnis")).toContainText("BQool Listing Performance FR (30 Tage bis");
    } finally {
      await sql("delete from bqool_leistung where tenant_id = $1", [T]);
      await sql("delete from bqool_berichte where tenant_id = $1", [T]);
      await sql("delete from bqool_tageswerte where tenant_id = $1", [T]);
      await sql("delete from bqool_berichte_offen where tenant_id = $1", [T]);
      await sql("delete from bqool_listings where tenant_id = $1 and sku = any($2)", [T, [A, B, C, D, X]]);
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = any($2)", [T, [A, B, C, D]]);
      await sql("delete from lots where tenant_id = $1 and sku = any($2)", [T, [A, B, C, D]]);
      await sql("update tasks set status = 'done' where tenant_id = $1 and system_key like 'bqool-regel-pruefen-%' and status = 'open'", [T]);
    }
  });

  test("Automatik: täglicher Lauf holt „Listing Performance (7 Tage)“ je Land und „Daily Sales“ – Land ohne Rückfrage", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const A = `TEST-B5A-${m}-A`;
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await bqool({ zuruecksetzen: true, ist: Object.fromEntries(["DE", "FR", "IT", "ES"].map((l) => [l, [{ sku: A, regel: "ia", min: 80, max: 150, cost: 11.9 }]])) });
    await sql("update integrations set config = config || jsonb_build_object('leistungUrl', replace(config->>'exportUrl', '/export/', '/leistung/'), 'tagesUrl', replace(config->>'exportUrl', '/export/', '/tages/')) where tenant_id = $1 and provider = 'bqool_web'", [T]);
    await sql("delete from bqool_laeufe where tenant_id = $1", [T]);
    try {
      await anmelden(page, "inhaber");
      await page.goto("/repricer/bqool#freigabe");
      await Promise.all([page.waitForURL(/meldung=/, { timeout: 240_000 }), page.getByTestId("bq-kreislauf-starten").click()]);
      const stand = (await (await fetch(`${TD}/__bqool`)).json()) as { berichtAbrufe: { art: string; land: string; tage: string }[] };
      expect(stand.berichtAbrufe.filter((x) => x.art === "leistung").map((x) => `${x.land} ${x.tage}`).sort()).toEqual(["DE 7", "ES 7", "FR 7", "IT 7"]);
      expect(stand.berichtAbrufe.filter((x) => x.art === "tages").map((x) => x.land).sort()).toEqual(["DE", "ES", "FR", "IT"]);
      const ber = await sql<{ art: string; land: string; zeitraum_tage: number; via: string }>("select art, land, zeitraum_tage, via from bqool_berichte where tenant_id = $1 and eingelesen_am > now() - interval '10 minutes' order by art, land", [T]);
      expect(ber.filter((b) => b.art === "listing_performance" && b.zeitraum_tage === 7 && b.via === "automatik").map((b) => b.land)).toEqual(["DE", "ES", "FR", "IT"]);
      expect(ber.filter((b) => b.art === "daily_sales" && b.via === "automatik").map((b) => b.land)).toEqual(["DE", "ES", "FR", "IT"]);
      expect((await sql("select 1 from bqool_berichte_offen where tenant_id = $1", [T])).length).toBe(0);
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const st = JSON.parse(await c.call("anbindungen_status", {}));
      expect(st.abrufe.find((x: { abruf: string }) => x.abruf === "BQool: Berichte").letzter_erfolg).not.toBe("nie");
      await page.goto("/repricer/leistung");
      await expect(page.getByTestId("leistung-bb-DE")).toHaveText("50 %");
    } finally {
      await sql("update integrations set config = config - 'leistungUrl' - 'tagesUrl' where tenant_id = $1 and provider = 'bqool_web'", [T]);
      await sql("delete from bqool_laeufe where tenant_id = $1", [T]);
      await sql("delete from bqool_leistung where tenant_id = $1", [T]);
      await sql("delete from bqool_berichte where tenant_id = $1", [T]);
      await sql("delete from bqool_tageswerte where tenant_id = $1", [T]);
      await sql("delete from bqool_listings where tenant_id = $1 and sku = $2", [T, A]);
      await sql("update tasks set status = 'done' where tenant_id = $1 and (system_key like 'bqool-%' or system_key like 'automatik-bqool-%') and status = 'open'", [T]);
      await bqool({ zuruecksetzen: true });
    }
  });
});
