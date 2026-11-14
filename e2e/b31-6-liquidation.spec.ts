// Nachtrag B31.6 (08.11.), seit der BQool-Ablösung mit ProfitGuard: Min unter Mindestmarge nur mit Strategie
// „Liquidation“. Abnahme 6: gewünschter Min unter dem effektiven Min (Buy Box darunter) → Strategiewechsel auf
// „Liquidation“ mit festem Min, nie unter Break-even ohne Freigabe; Importdatei nur mit „Freigabe geprüft“; aktiv, sobald
// der ProfitGuard-Export Liquidation + Min zeigt (Verlust-Stopp-Ausnahme automatisch). Abnahme 7: Buy Box 14 Tage über
// effektivem Min + 3 % → Vorschlag „zurück auf …“. Dazu Repricer-Filter „Liquidation“ und Kapital-Ampel.
// Alle SKUs und Werte erfunden.
import type { Page } from "@playwright/test";
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const f2 = (n: number) => n.toFixed(2);
const de = (n: number) => f2(n).replace(".", ",");
const KOPF = "SKU,Marketplace,Your Price,Min Price,Max Price,Strategy,Repricing,Buy Box Price";

type Zeile = { sku: string; strategie_ist?: string; strategie_soll: string; min_ist: number | null; min_soll: number; break_even: number | null; buybox: number | null; warnungen?: string[] };

/** ProfitGuard-Export DE hochladen (ersetzt den DE-Stand des Mandanten). */
async function pgHochladen(page: Page, name: string, z: { sku: string; strategie: string; min: string; max?: string; bb: string }) {
  const datei = [KOPF, `${z.sku},DE,99.00,${z.min},${z.max ?? "150.00"},${z.strategie},Yes,${z.bb}`, ""].join("\r\n");
  await page.goto("/uploads");
  await page.getByTestId("upload-dateien").setInputFiles([{ name, mimeType: "text/csv", buffer: Buffer.from(datei, "utf8") }]);
  await page.getByTestId("upload-los").click();
  await expect(page.getByTestId("upload-ergebnis")).toHaveAttribute("data-art", "profitguard", { timeout: 60_000 });
  await expect(page.getByTestId("upload-ergebnis")).toContainText("1 SKU aus ProfitGuard eingelesen (DE 1)");
}

test.describe("B31.6 – Min unter Marge nur mit Liquidation", () => {
  test("Abnahme 6/7: Strategiewechsel auf Liquidation mit festem Min (nie unter Break-even), Datei nur mit Freigabe, aktiv nach dem ProfitGuard-Export; Rückkehr-Vorschlag", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const A = `TEST-LQ-${m}`;
    const [{ tenant_id: T, product_id: P }] = await sql<{ tenant_id: string; product_id: string }>("select tenant_id, product_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql("insert into lots (tenant_id, product_id, sku, kind, sku_schema, purchase_date, quantity, unit_cost_net) values ($1, $2, $3, 'purchase', 'test', current_date, 10, '20.00')", [T, P, A]);
    await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, null, $3, 4, current_date)", [T, A, `Testartikel ${A} (erfunden)`]);
    await sql("insert into amazon_lageralter (tenant_id, land, sku, verfuegbar, \"alter\", abgerufen_am) values ($1, 'DE', $2, 4, '{\"0-90\": 4}', now())", [T, A]);
    const bbSetzen = (preis: string) => sql("update profitguard_listings set buybox_preis = $3 where tenant_id = $1 and marktplatz = 'DE' and sku = $2", [T, A, preis]);
    const zuweisen = async (untergrenze: string) => {
      await page.goto("/repricer/profitguard");
      const f = page.getByTestId("pg-zuweisung-form");
      await f.locator('input[name="sku"]').fill(A);
      await f.locator('select[name="regel"]').selectOption("Standard");
      await f.locator('input[name="untergrenze"]').fill(untergrenze);
      for (const l of ["FR", "IT", "ES"]) await f.locator(`input[name="land"][value="${l}"]`).uncheck();
      await Promise.all([aktion(page), f.getByRole("button", { name: "speichern" }).click()]);
      await expect(page.getByRole("status")).toContainText(`${A}: Standard in DE gespeichert.`);
    };
    try {
      await anmelden(page, "inhaber");
      const c = await mcpVerbinden(browser, baseURL!, "inhaber");
      const zeile = async () => (JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE", limit: 100 })).laender[0].groesste_aenderungen as Zeile[]).find((z) => z.sku === A);
      const rp = async () => JSON.parse(await c.call("repricer", { ansicht: "alle", suche: A, marktplatz: "DE" })).zeilen[0];

      // ProfitGuard-Ist vorher: Standard, Min 80; Buy Box über dem effektiven Min → kein Wechsel (Min = effektiver Min)
      await pgHochladen(page, `ProfitGuard_${m}_1.csv`, { sku: A, strategie: "Standard", min: "80.00", bb: "500.00" });
      await zuweisen("1,00");
      const ohne = (await zeile())!;
      expect(ohne.strategie_soll).toBe("Standard");
      expect((ohne.warnungen ?? []).some((w) => w.includes("kein Wechsel, die Buy Box 500.00 liegt darüber"))).toBe(true);
      const effMin = ohne.min_soll; // ohne Wechsel = effektiver Min der Strategie (Marge der Altersstufe)
      await bbSetzen("2.00");

      // ---- Untergrenze Break-even: gewünschter Min weit darunter → Liquidation, Min auf Break-even angehoben ------------
      const w0 = (await zeile())!;
      expect(w0).toMatchObject({ strategie_ist: "Standard", strategie_soll: "Liquidation", min_ist: 80 });
      expect(w0.break_even).not.toBeNull();
      expect(w0.min_soll).toBe(w0.break_even);
      expect(effMin).toBeGreaterThan(w0.break_even!);
      expect((w0.warnungen ?? []).some((w) => w.includes("– auf Break-even angehoben (Abverkauf mit Verlust nicht freigegeben)"))).toBe(true);
      await page.goto("/repricer/profitguard#liquidation");
      await expect(page.locator(`[data-testid="pg-liq-zeile"][data-sku="${A}"]`)).toContainText("gewünscht 1,00");

      // ---- Abnahme 6: gewünschter Min zwischen Break-even und effektivem Min → „Liquidation“ mit festem Min ------------
      const ziel = Math.round(((w0.break_even! + effMin) / 2) * 100) / 100;
      await zuweisen(de(ziel));
      const w1 = (await zeile())!;
      expect(w1).toMatchObject({ strategie_soll: "Liquidation", min_soll: ziel });
      expect((w1.warnungen ?? []).some((w) => w.startsWith("Wechsel auf Liquidation (gewünschter Min unter Marge)"))).toBe(true);
      await page.goto("/repricer/profitguard#liquidation");
      const lz = page.locator(`[data-testid="pg-liq-zeile"][data-sku="${A}"]`);
      await expect(lz).toContainText("Standard → Liquidation");
      await expect(lz).toContainText(`80,00 → ${de(ziel)}`);
      await expect(lz).toContainText(de(w1.break_even!));

      // Importdatei: ohne „Freigabe geprüft“ nichts, mit Häkchen Strategie „Liquidation“ + fester Min
      const exportForm = async (freigabe: boolean) => {
        const e = page.getByTestId("pg-export-form");
        for (const l of ["FR", "IT", "ES"]) await e.locator(`input[name="land"][value="${l}"]`).uncheck();
        await e.locator('input[name="nur_aenderungen"]').uncheck();
        if (freigabe) await e.getByTestId("pg-freigabe").check();
        await Promise.all([aktion(page), page.getByTestId("pg-export-los").click()]);
      };
      await exportForm(false);
      await expect(page.getByRole("status")).toContainText("Freigabe nötig:");
      await expect(page.getByRole("status")).toContainText("1 neu auf Liquidation");
      expect(await sql("select 1 from repricing_liquidationen where tenant_id = $1 and sku = $2", [T, A])).toHaveLength(0);
      await exportForm(true);
      await expect(page.getByRole("status")).toContainText("Datei erzeugt:");
      const datei = await (await page.request.get((await page.getByTestId("pg-datei-DE").getAttribute("href"))!)).text();
      const kopf = datei.split("\r\n")[0].split(",");
      expect(kopf).toEqual(KOPF.split(","));
      const zz = datei.split("\r\n").find((z) => z.startsWith(`${A},`))!.split(",");
      expect([zz[0], zz[1], zz[3], zz[5], zz[6]]).toEqual([A, "DE", f2(ziel), "Liquidation", "Yes"]);
      const [lq0] = await sql<{ status: string; regel_vorher: string; min_gesetzt: number }>("select status, regel_vorher, min_gesetzt::float as min_gesetzt from repricing_liquidationen where tenant_id = $1 and land = 'DE' and sku = $2", [T, A]);
      expect(lq0).toMatchObject({ status: "vorgeschlagen", regel_vorher: "Standard", min_gesetzt: ziel });

      // ProfitGuard-Export danach: Liquidation mit dem gesetzten Min → aktiv, Verlust-Stopp-Ausnahme automatisch
      await pgHochladen(page, `ProfitGuard_${m}_2.csv`, { sku: A, strategie: "Liquidation", min: f2(ziel), bb: "2.00" });
      const [lq] = await sql<{ status: string; bis: string | null }>("select status, bis::text from repricing_liquidationen where tenant_id = $1 and land = 'DE' and sku = $2", [T, A]);
      expect(lq.status).toBe("aktiv");
      expect(lq.bis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const [ausn] = await sql<{ grund: string }>("select grund from verlust_ausnahmen where tenant_id = $1 and sku = $2", [T, A]);
      expect(ausn.grund).toMatch(/^Repricing-Liquidation DE \(Min unter Marge, vorher „Standard“\) seit .* – nur bis Break-even$/);
      await page.goto("/repricer/profitguard#liquidation");
      await expect(page.locator(`[data-testid="pg-liq-aktiv-zeile"][data-sku="${A}"]`)).toHaveAttribute("data-status", "aktiv");
      await expect(page.locator(`[data-testid="pg-liq-zeile"][data-sku="${A}"]`)).toHaveCount(0);
      const r1 = await rp();
      expect(r1).toMatchObject({ soll: { strategie: "Liquidation", min: ziel }, ist_profitguard: { strategie: "Liquidation", min: ziel }, liquidation_bis: { bis: lq.bis } });
      // freigegebene Liquidation: Min unter dem Soll-Min der Marge ist keine Auffälligkeit
      expect(r1.pruefen ?? []).not.toContain("ProfitGuard-Min unter dem Soll-Min des Seller-Systems (Marge je Altersstufe)");

      // Repricer: Filter „Liquidation“, Spalte „Liquidation bis“
      await page.goto(`/repricer?q=${A}&leiter=liquidation#abgleich`);
      await expect(page.getByTestId("abgleich-filter-leiter")).toHaveValue("liquidation");
      const az = page.locator(`[data-testid="abgleich-zeile"][data-sku="${A}"][data-land="DE"]`);
      await expect(az.getByTestId("abgleich-soll")).toContainText("Liquidation");
      await expect(az).toContainText(/noch \d+ T/);
      // Kapital-Ampel: „n SKUs auf Liquidation (Min unter Marge), davon m unter Break-even“
      await page.goto("/kapital");
      await expect(page.getByTestId("kapital-liquidation")).toContainText(/\d+ SKUs? auf Liquidation \(Min unter Marge\), davon \d+ unter Break-even/);

      // ---- Abnahme 7: Buy Box 14 Tage über effektivem Min + 3 % → Vorschlag „zurück auf …“ ----------------------------
      const [{ eff }] = await sql<{ eff: number }>("select eff_min_vorher::float as eff from repricing_liquidationen where tenant_id = $1 and sku = $2", [T, A]);
      const schwelle = Math.round(eff * 1.03 * 100) / 100;
      await bbSetzen(f2(schwelle + 5));
      // Tag 13: noch kein Vorschlag
      await sql("update repricing_liquidationen set ueber_seit = current_date - 13 where tenant_id = $1 and sku = $2", [T, A]);
      await page.goto("/repricer/profitguard#liquidation");
      await Promise.all([aktion(page), page.getByTestId("pg-liq-pruefen").click()]);
      await expect(page.getByRole("status")).toContainText("Geprüft: 0 Liquidation(en) neu aktiv, 0 neue Rückkehr-Vorschläge");
      await expect(page.locator(`[data-testid="pg-liq-aktiv-zeile"][data-sku="${A}"]`)).toHaveAttribute("data-status", "aktiv");
      // Tag 14: Vorschlag + Aufgabe
      await sql("update repricing_liquidationen set ueber_seit = current_date - 14 where tenant_id = $1 and sku = $2", [T, A]);
      await Promise.all([aktion(page), page.getByTestId("pg-liq-pruefen").click()]);
      await expect(page.getByRole("status")).toContainText("1 neue Rückkehr-Vorschläge");
      const aktivZeile = page.locator(`[data-testid="pg-liq-aktiv-zeile"][data-sku="${A}"]`);
      await expect(aktivZeile).toHaveAttribute("data-status", "zurueck_vorgeschlagen");
      await expect(aktivZeile).toContainText(`${de(schwelle + 5)} / ${de(schwelle)}`);
      const zurueckAuf = (await aktivZeile.getByTestId("pg-liq-zurueck").textContent())!.replace("zurück auf ", "").trim();
      expect(["Standard", "Abverkauf"]).toContain(zurueckAuf);
      const [aufgabe] = await sql<{ title: string; notes: string }>("select title, notes from tasks where tenant_id = $1 and system_key = 'repricing-rueckkehr' and status = 'open'", [T]);
      expect(aufgabe.title).toMatch(/^Repricing: \d+ SKUs? zurück von Liquidation\?$/);
      expect(aufgabe.notes).toContain(`• DE ${A} → ${zurueckAuf}`);
      const v = JSON.parse(await c.call("profitguard_export_vorschau", { land: "DE" }));
      expect(v.liquidation.rueckkehr_vorgeschlagen).toBeGreaterThanOrEqual(1);

      // Freigabe „zurück auf …“ → Soll ohne Wunsch-Min, Liquidation beendet, Ausnahme weg
      await Promise.all([aktion(page), aktivZeile.getByTestId("pg-liq-zurueck").click()]);
      await expect(page.getByRole("status")).toContainText(`${A} (DE): zurück auf „${zurueckAuf}“ – steht in der nächsten ProfitGuard-Datei.`);
      const [zw] = await sql<{ regel: string; untergrenze: string | null }>("select regel, untergrenze from repricing_zuweisungen where tenant_id = $1 and land = 'DE' and sku = $2", [T, A]);
      expect(zw).toEqual({ regel: zurueckAuf, untergrenze: null });
      expect((await sql<{ status: string }>("select status from repricing_liquidationen where tenant_id = $1 and sku = $2", [T, A]))[0].status).toBe("beendet");
      expect(await sql("select 1 from verlust_ausnahmen where tenant_id = $1 and sku = $2", [T, A])).toHaveLength(0);
      expect((await zeile())!).toMatchObject({ strategie_ist: "Liquidation", strategie_soll: zurueckAuf });
    } finally {
      await sql("update tasks set status = 'done' where tenant_id = $1 and system_key in ('repricing-rueckkehr', 'repricing-liquidation-ablauf') and status = 'open'", [T]);
      await sql("delete from verlust_ausnahmen where tenant_id = $1 and sku = $2", [T, A]);
      for (const t of ["repricing_liquidationen", "repricing_zuweisungen", "repricing_sku_pflege", "repricing_vorschlaege", "repricing_gebuehren", "profitguard_listings", "amazon_inventory", "amazon_lageralter", "lots"]) await sql(`delete from ${t} where tenant_id = $1 and sku = $2`, [T, A]);
      await sql("update tenants set settings = settings #- '{repricing,profitguard,format}' where id = $1", [T]);
    }
  });
});
