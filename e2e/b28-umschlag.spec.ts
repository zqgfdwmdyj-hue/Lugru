// Nachtrag B28.6–B28.8 gegen die Testdienste – nur erfundene Daten: Testpfanne B0PFANNE01 (wie deal-b28), erfundener
// Testlieferant mit drei erhaltenen Einkäufen, FBA-Sendungen und Monatswerten (TEST-DL-…), ein erfundenes
// Verlustprodukt (TEST-LS-…). Abnahmen 6–8 aus dem Nachtrag.
import { aktion, alsPerson, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

type Zeile = { nr: number; asin: string | null; umschlag?: { text: string; roiPa: number | null; warnung: string | null; tage: { mitte: number } } | null; merkmale?: { roiPa?: number | null } | null };
const fertig = (id: string) => expect.poll(async () => (await sql<{ p: string }>("select pruefung p from deal_eingaenge where id = $1", [id]))[0]?.p, { timeout: 60_000 }).toMatch(/fertig|fehler/);
const tag = (d: Date) => d.toISOString().slice(0, 10);
const minus = (n: number) => tag(new Date(Date.now() - n * 86_400_000));
const vormonat = () => {
  const d = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

test.describe("B28.6–B28.8 Umschlag, Cash-to-Cash, Lernschleife", () => {
  test.afterAll(async () => {
    await sql("delete from deal_eingaenge where zeilen::text like '%B0PFANNE%' and rohtext is not null and quelle like 'Umschlag-Test %'");
  });

  test("Abnahme 6: Umschlagszeit und ROI p. a. im Deal (84 Stück → Reichweiten-Warnung)", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    await anmelden(page, "inhaber");
    // Mindest-ROI p. a. in den Deal-Einstellungen (Standard 100 %)
    await page.goto("/deal-eingang");
    await expect(page.getByTestId("de-minroipa-feld")).toHaveValue("100");

    const r = await page.request.post("/api/deal-eingang", { multipart: { text: `B0PFANNE01 Testpfanne 24 cm (erfunden) 25,00 netto ab 84 Stk ${m}`, quelle: `Umschlag-Test ${m}` }, maxRedirects: 0 });
    expect(r.status()).toBe(303);
    const id = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r.headers().location ?? "")![1];
    await fertig(id);
    const [{ zeilen }] = await sql<{ zeilen: Zeile[] }>("select zeilen from deal_eingaenge where id = $1", [id]);
    const u = zeilen[0].umschlag!;
    expect(u.text).toMatch(/^ca\. \d+–\d+ Tage$/);
    expect(u.roiPa).not.toBeNull();
    expect(zeilen[0].merkmale?.roiPa).toBe(u.roiPa);

    await page.goto(`/deal-eingang/${id}`);
    const de = page.locator('[data-testid="de-land"][data-land="DE"]').first();
    await expect(de.getByTestId("de-umschlag")).toContainText(/\d+–\d+ Tage \(geschätzt\)/);
    await expect(de.getByTestId("de-roipa")).toContainText(/\d+ %/);
    await expect(page.getByTestId("de-umschlag-info").first()).toContainText(/Umschlag [A-Z]{2}: ca\. \d+–\d+ Tage \(geschätzt, 84 Stk\) · ROI p\. a\. \d+ % \(Ziel ≥ 100 %\)/);
    // 84 Stück reichen bei den Testdaten deutlich länger als 60 Tage → Warnung mit Menge für 45 Tage
    expect(u.warnung).toMatch(/^Menge reicht ca\. \d+ Tage – kleinere Menge \(\d+ Stk für 45 Tage\) oder höherer Abschlag\?$/);
    await expect(page.getByTestId("de-umschlag-warnung").first()).toHaveText(u.warnung!);

    // Claude: deal_wert und deal_eingang_detail nennen Umschlag und ROI p. a.
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const w = JSON.parse(await mcp.call("deal_wert", { deal_id: id })) as { angebote: { roi_pa_prozent?: number; umschlag?: string; umschlag_warnung?: string }[] };
    expect(w.angebote[0].roi_pa_prozent).toBe(u.roiPa);
    expect(w.angebote[0].umschlag).toBe(`${u.text} (geschätzt)`);
    expect(w.angebote[0].umschlag_warnung).toBe(u.warnung);
    const d = await mcp.call("deal_eingang_detail", { id });
    expect(d).toMatch(new RegExp(`"roi_pa_prozent":\\s*${u.roiPa}`));
  });

  test("Abnahme 7: Kapital-Ampel zeigt Cash-to-Cash-Zyklus und Kapital ÷ Monatsumsatz", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const lieferant = `Testlieferant Durchlauf ${m}`;
    const [{ id: sup }] = await sql<{ id: string }>("insert into suppliers (tenant_id, name, code) values ($1, $2, $3) returning id", [T, lieferant, `TD${m}`]);
    // Drei erhaltene Einkäufe: Wareneingang 4/6/3 Tage, Prep 3/2/3 Tage, Amazon-Eingang 8/9/8 Tage → Mediane 4, 3, 8
    const faelle = [
      { b: 80, e: 76, v: 73, a: 65 },
      { b: 70, e: 64, v: 62, a: 53 },
      { b: 60, e: 57, v: 54, a: 46 },
    ];
    const pos: string[] = [];
    try {
      for (const [i, f] of faelle.entries()) {
        const sku = `TEST-DL-${m}-${i + 1}`;
        const [{ id: po }] = await sql<{ id: string }>("insert into purchase_orders (tenant_id, number, supplier_id, status, order_date, received_at) values ($1, $2, $3, 'received', $4, $5) returning id", [T, `DL-${m}-${i + 1}`, sup, minus(f.b), `${minus(f.e)}T10:00:00Z`]);
        pos.push(po);
        await sql("insert into purchase_order_items (tenant_id, po_id, sku, asin, quantity, received, unit_cost_gross) values ($1, $2, $3, $4, 10, 10, 11.9)", [T, po, sku, `B0TD${m}${i}`]);
        await sql("insert into sellerboard_shipments (tenant_id, sb_id, status, created_on, last_update, lines, synced_at) values ($1, $2, 'CLOSED', $3, $4, $5::jsonb, now())", [T, `DL-${m}-${i}`, minus(f.v), minus(f.a), JSON.stringify([{ sku, shipped: 10, received: 10 }])]);
        await sql("insert into sellerboard_sku_months (tenant_id, month, sku, asin, name, units, sales, net_profit, synced_at) values ($1, $2, $3, $4, 'Testartikel Durchlauf', 10, 200, 30, now()) on conflict do nothing", [T, minus(f.a).slice(0, 7), sku, `B0TD${m}${i}`]);
      }
      // Einkauf seit über 45 Tagen weder erhalten noch storniert → „Einkäufe bereinigen“
      const [{ id: offen }] = await sql<{ id: string }>("insert into purchase_orders (tenant_id, number, supplier_id, status, order_date) values ($1, $2, $3, 'ordered', $4) returning id", [T, `DL-${m}-OFFEN`, sup, minus(60)]);
      pos.push(offen);
      // Umsatz der letzten 30 Tage (sellerboard-Kachel für genau diesen Zeitraum)
      await sql("insert into sellerboard_kpis (tenant_id, channel, from_day, to_day, sales, synced_at) values ($1, 'amazon', $2, $3, 1000, now()) on conflict do nothing", [T, minus(29), minus(0)]);

      await anmelden(page, "inhaber");
      await page.goto("/kapital");
      const c = page.getByTestId("kapital-c2c");
      await expect(c).toContainText("Cash-to-Cash-Zyklus");
      await expect(c.getByTestId("kapital-c2c-tage")).toContainText(/^\d+ Tage$/);
      const phasen = c.getByTestId("kapital-c2c-phasen");
      await expect(phasen.locator("tr", { hasText: "Bestellung → Wareneingang" })).toContainText(/4 T \(\d+ Einkäufe/);
      await expect(phasen.locator("tr", { hasText: "Versand an Amazon" })).toContainText(/3 T \(\d+ Einkäufe/);
      await expect(phasen.locator("tr", { hasText: "Empfang abgeschlossen" })).toContainText(/8 T \(\d+ Einkäufe/);
      await expect(phasen.locator("tr", { hasText: "Auszahlung" })).toContainText("14 T");
      await expect(c.getByTestId("kapital-monate")).toContainText(/Monatsumsätze|–/);
      await c.locator("summary", { hasText: "Je Lieferant" }).click();
      await expect(c.getByTestId("kapital-c2c-gruppen").locator("tr", { hasText: lieferant })).toContainText("3");
      await expect(c.getByTestId("kapital-bereinigen")).toContainText("seit über 45 Tagen weder erhalten noch storniert");

      // Claude: kapital_ampel liefert den Block cash_to_cash
      const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
      const k = JSON.parse(await mcp.call("kapital_ampel", { limit: 1 })) as { cash_to_cash?: { tage: number | null; phasen: { bestellung_bis_wareneingang: { median_tage: number } }; je_lieferant: { lieferant_quelle: string; einkaeufe: number }[]; einkaeufe_bereinigen?: number } };
      expect(k.cash_to_cash?.tage).toBeGreaterThan(0);
      expect(k.cash_to_cash?.phasen.bestellung_bis_wareneingang.median_tage).toBe(4);
      expect(k.cash_to_cash?.je_lieferant.find((g) => g.lieferant_quelle === lieferant)?.einkaeufe).toBe(3);
      expect(k.cash_to_cash?.einkaeufe_bereinigen).toBeGreaterThanOrEqual(1);

      // Der Deal-Eingang nimmt den eigenen Vorlauf (ab 3 Einkäufen) statt der Standardwerte
      const r = await page.request.post("/api/deal-eingang", { multipart: { text: `B0PFANNE01 Testpfanne 24 cm (erfunden) 25,00 netto ab 20 Stk ${m}`, quelle: `Umschlag-Test ${m}` }, maxRedirects: 0 });
      const id = /\/deal-eingang\/([0-9a-f-]{36})/.exec(r.headers().location ?? "")![1];
      await fertig(id);
      await page.goto(`/deal-eingang/${id}`);
      await expect(page.getByTestId("de-umschlag-info").first()).toContainText(/Vorlauf aus eigenen Daten \(\d+ Einkäufe\)/);
    } finally {
      await sql("delete from sellerboard_kpis where tenant_id = $1 and from_day = $2 and to_day = $3 and sales = 1000", [T, minus(29), minus(0)]);
      await sql("delete from sellerboard_sku_months where tenant_id = $1 and sku like $2", [T, `TEST-DL-${m}-%`]);
      await sql("delete from sellerboard_shipments where tenant_id = $1 and sb_id like $2", [T, `DL-${m}-%`]);
      if (pos.length) await sql("delete from purchase_orders where id = any($1::uuid[])", [pos]);
      await sql("delete from suppliers where id = $1", [sup]);
    }
  });

  test("Abnahme 8: Lernschleife Verlustprodukte – Liste, Antwort nur durch den Inhaber, Lernbericht", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const monat = vormonat();
    const asin1 = `B0TL${m}1`;
    const asin2 = `B0TL${m}2`;
    let po: string | null = null;
    try {
      // Zwei erfundene Verlustprodukte im Vormonat, eingekauft vor 30 Tagen; ein Gewinner bleibt draußen
      const [{ id }] = await sql<{ id: string }>("insert into purchase_orders (tenant_id, number, status, order_date) values ($1, $2, 'ordered', $3) returning id", [T, `LS-${m}`, minus(30)]);
      po = id;
      for (const [i, x] of [
        { asin: asin1, sales: 120, profit: -30 },
        { asin: asin2, sales: 200, profit: 4 },
        { asin: `B0TL${m}3`, sales: 200, profit: 40 },
      ].entries()) {
        await sql("insert into purchase_order_items (tenant_id, po_id, sku, asin, quantity, unit_cost_gross) values ($1, $2, $3, $4, 5, 11.9)", [T, po, `TEST-LS-${m}-${i + 1}`, x.asin]);
        await sql("insert into sellerboard_sku_months (tenant_id, month, sku, asin, name, units, sales, net_profit, synced_at) values ($1, $2, $3, $4, $5, 4, $6, $7, now())", [T, monat, `TEST-LS-${m}-${i + 1}`, x.asin, `Testartikel Verlust ${m} ${i + 1}`, x.sales, x.profit]);
      }
      await anmelden(page, "inhaber");
      await page.goto("/deal-eingang/lernen");
      await Promise.all([aktion(page), page.getByTestId("dl-ls-erstellen").click()]);
      await expect(page.getByRole("status")).toContainText(`Lernschleife ${monat}:`);
      const ls = page.getByTestId("dl-lernschleife");
      const f1 = ls.locator(`[data-testid="dl-ls-frage"][data-asin="${asin1}"]`);
      const f2 = ls.locator(`[data-testid="dl-ls-frage"][data-asin="${asin2}"]`);
      await expect(f1).toHaveAttribute("data-beantwortet", "0");
      await expect(f1).toContainText("−30,00");
      await expect(f2).toContainText("Marge 2 %");
      await expect(ls.locator(`[data-testid="dl-ls-frage"][data-asin="B0TL${m}3"]`)).toHaveCount(0);
      // Größter Verlust zuerst
      const reihenfolge = await ls.getByTestId("dl-ls-liste").locator('[data-testid="dl-ls-frage"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-asin")));
      expect(reihenfolge.indexOf(asin1)).toBeLessThan(reihenfolge.indexOf(asin2));

      // Antwort: „Nie wieder kaufen“ mit Grund und Freitext
      await f1.locator("summary", { hasText: "Grund" }).click();
      await f1.getByLabel("zu große Menge").check();
      await f1.locator('input[name="freitext"]').fill(`Testnotiz ${m}`);
      await Promise.all([aktion(page), f1.getByTestId("dl-ls-nie").click()]);
      await expect(page.getByRole("status")).toContainText("Gespeichert");
      await expect(f1).toHaveAttribute("data-beantwortet", "1");
      await expect(f1.getByTestId("dl-ls-antwort")).toContainText(`Nie wieder kaufen · zu große Menge · „Testnotiz ${m}“`);
      await expect(ls.getByTestId("dl-ls-stand")).toContainText("„Nie wieder“");

      // Nur der Inhaber beantwortet: eine Büro-Kraft mit Zugriff auf den Deal-Eingang sieht keine Knöpfe
      await sql("update memberships set areas = areas || '[\"dealeingang\"]'::jsonb where tenant_id = $1 and user_id = (select id from users where email = 'buero' limit 1)", [T]).catch(() => undefined);
      const buero = await alsPerson(browser, "buero");
      await buero.goto("/deal-eingang/lernen");
      const fb = buero.locator(`[data-testid="dl-ls-frage"][data-asin="${asin2}"]`);
      if (await fb.count()) {
        await expect(fb).toContainText("beantwortet nur der Inhaber");
        await expect(fb.getByTestId("dl-ls-nie")).toHaveCount(0);
      }
      await buero.context().close();

      // Claude: deal_lernen_bericht enthält die Lernschleife mit der Antwort
      const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
      const b = JSON.parse(await mcp.call("deal_lernen_bericht", {})) as { lernschleife?: { monat: string; produkte: { asin?: string; antwort: string; gruende?: string[] }[]; treffer_ziel_prozent: number } };
      expect(b.lernschleife?.monat).toBe(monat);
      expect(b.lernschleife?.produkte.find((p) => p.asin === asin1)).toMatchObject({ antwort: "Nie wieder kaufen", gruende: ["zu große Menge"] });
      expect(b.lernschleife?.treffer_ziel_prozent).toBe(80);
    } finally {
      await sql("update memberships set areas = areas - 'dealeingang' where tenant_id = $1 and areas ? 'dealeingang' and role = 'staff'", [T]).catch(() => undefined);
      await sql("delete from lernschleife_fragen where tenant_id = $1 and asin like $2", [T, `B0TL${m}%`]);
      await sql("delete from sellerboard_sku_months where tenant_id = $1 and sku like $2", [T, `TEST-LS-${m}-%`]);
      if (po) await sql("delete from purchase_orders where id = $1", [po]);
    }
  });
});
