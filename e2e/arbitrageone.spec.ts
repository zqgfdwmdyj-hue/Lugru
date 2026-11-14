// ArbitrageOne-Anbindung (Bauauftrag Datei-Import, Ergänzung 01.11.): „Verbindung testen“ grün → Abruf (gleicher
// Ablauf wie der Nachtlauf 05:30) holt Einkäufe, Lagerbestand, sellerboard-COG, Inventory
// Reimbursement und AccountOne COG (NEU) (B31.1: BQool entfällt) → Lugru „gekauft“ erkannt, EK fehlt verschwindet, Liquidität zeigt den
// Wareneinkauf des Monats. Zweiter Abruf: gleiche Dateien übersprungen. Fehlender Export → Aufgabe; Zwei-Faktor →
// Abbruch mit Aufgabe. Alle Daten erfunden (Test-Nachbau der Export-Seite).
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const tt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ao = (body: unknown) => fetch(`${TD}/__ao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test.describe("ArbitrageOne – Exporte automatisch abholen", () => {
  test("Verbindung testen → Abruf → verarbeitet; zweiter Abruf ohne Doppelung; fehlender Export und Zwei-Faktor → Aufgabe", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const A1 = `B0AOX${m}`;
    const A2 = `B0AOY${m}`;
    const S1 = `AOT-${m}-1`;
    const heute = new Date();
    const vormonat = (() => {
      const d = new Date(heute.getFullYear(), heute.getMonth() - 1, 15);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    // Lugru-Deal vor 2 Tagen gepostet, SKU mit Bestand bei Amazon, aber ohne EK
    const [deal] = await sql<{ id: string }>("insert into lugru_deals_historie (tenant_id, quelle, asin, titel, kanal, gepostet_am) values ($1, 'app', $2, $3, 'lugru-ao', now() - interval '2 days') returning id", [T, A1, `Testmarke AO ${m}`]);
    await sql("insert into amazon_inventory (tenant_id, sku, asin, title, fulfillable, snapshot_date) values ($1, $2, $3, $4, 4, current_date)", [T, S1, A1, `Testartikel AO ${m} (erfunden)`]);
    await ao({
      zuruecksetzen: true,
      dateien: {
        einkaeufe: `ASIN;SKU;Kaufdatum;Menge;EK netto;Lieferant;Rechnungsnummer\n${A1};${S1};${tt(heute)};3;12,50;Testshop AO;RE-${m}\n${A2};;${tt(heute)};1;5,00;Testshop AO;RE-${m}-2\n`,
        lagerbestand: `ASIN;SKU;Bestand;EK netto;Lagerwert\n${A1};${S1};3;12,50;37,50\n`,
        sellerboard: `ASIN;SKU;Cost\n${A1};${S1};12,50\n`,
        bqool: `FileType = repricing,  Version = 1.2.5 (Please do not edit this line or this will result in error when uploading)\t\t\t\t\t\t\t\t\t\t\nChannel\tSellerSKU\tCost\tAdditional Cost\tRule Name\tMin Price\tMax Price\tShipping\tadd-delete\tGroup\tEnable Repricing\nAmazon DE\t${S1}\t14.88\t\tia\t19.99\t39.98\t0.00\t\t\t1\n`,
        reimbursement: `approval-date\treimbursement-id\tcase-id\tamazon-order-id\treason\tsku\tfnsku\tasin\tproduct-name\tcondition\tcurrency-unit\tamount-per-unit\tamount-total\tquantity-reimbursed-cash\tquantity-reimbursed-inventory\tquantity-reimbursed-total\n${iso(heute)}\tAOTR${m}\t\t\tLost_Warehouse\t${S1}\tX00AO${m}\t${A1}\tTestartikel AO\tNew\tEUR\t9.00\t9.00\t1\t0\t1\n`,
        accountone: `marketplace_article_nr;article_nr;ek_netto_euro\n${A1};${S1};12,50\n`,
      },
    });
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    try {
      // Vorher: EK fehlt für die SKU
      expect(JSON.parse(await mcp.call("fehlende_einkaufspreise", { limit: 200 })).skus.map((x: { sku: string }) => x.sku)).toContain(S1);

      await anmelden(page, "inhaber");
      // Verbindung testen: anmelden + jede Karte auf der Export-Seite finden (nichts herunterladen)
      await page.goto("/anbindungen?p=arbitrageone_web#arbitrageone_web");
      await page.locator("#arbitrageone_web").getByRole("button", { name: "Verbindung testen" }).click();
      const t = page.locator("#arbitrageone_web .notice");
      await expect(t).toContainText("Anmeldung ok", { timeout: 90_000 });
      for (const k of ["Einkäufe: gefunden", "Lagerbestand: gefunden", "Sellerboard: gefunden", "Inventory Reimbursement: gefunden", "AccountOne COG (NEU): gefunden"]) await expect(t).toContainText(k);
      expect((await (await fetch(`${TD}/__ao`)).json()).downloads).toEqual([]);

      // Abruf wie der Nachtlauf (Knopf „Jetzt abholen“ unter Einstellungen → Hintergrund & Importe)
      await page.goto("/einstellungen/hintergrund#importe-arbitrageone");
      await expect(page.getByTestId("ao-plan")).toContainText("täglich 05:30");
      await Promise.all([page.waitForURL(/ao=/, { timeout: 180_000 }), page.getByTestId("ao-jetzt").click()]);
      await expect(page.getByTestId("ao-meldung")).toContainText("alle Exporte abgeholt");
      const zeilen = page.getByTestId("ao-import");
      for (const k of ["einkaeufe", "lagerbestand", "sellerboard", "reimbursement", "accountone"]) await expect(zeilen.and(page.locator(`[data-export="${k}"]`)).first()).toBeVisible();
      // B31.1 / BQool-Ablösung: den ArbitrageOne-Export „BQool“ holt das System nicht mehr – keine Zeile, kein Fehler, kein Import
      await expect(page.getByTestId("ao-lauf").first().getByTestId("ao-lauf-export").filter({ hasText: "BQool" })).toHaveCount(0);
      await expect(zeilen.and(page.locator('[data-export="bqool"]'))).toHaveCount(0);
      // B30: Einkäufe = Bestellliste (Lieferant + Datum, ohne Bestellnummer-Spalte → eine Bestellung)
      await expect(zeilen.and(page.locator('[data-export="einkaeufe"]')).first()).toContainText("1 Bestellung, 2 Positionen, 2 ohne Zuordnung");
      await expect(zeilen.and(page.locator('[data-export="lagerbestand"]')).first()).toContainText("Stück");
      // Einkaufs-Karte über den Zeitraum-Dialog, AccountOne NEU (nicht alt), keine Datei doppelt geholt
      expect((await (await fetch(`${TD}/__ao`)).json()).downloads.map((d: { key: string }) => d.key)).toEqual(["einkaeufe", "lagerbestand", "sellerboard", "reimbursement", "accountone"]);

      // Ergebnis im System
      expect((await sql("select 1 from ao_einkaeufe where tenant_id = $1 and asin in ($2, $3)", [T, A1, A2])).length).toBe(2);
      // B30: Bestellung in Einkauf → Bestellungen (Lieferant, Datum, Menge, EK); der EK je SKU kommt nur als Vorschlag,
      // gültig wird er hier über den sellerboard-Export (unten über fehlende_einkaufspreise geprüft)
      const pos = await sql<{ status: string; order_date: string; quantity: number; unit_cost_gross: string; supplier: string; quelle: string }>(
        "select po.status, po.order_date::text, i.quantity, i.unit_cost_gross::text, s.name as supplier, po.quelle from purchase_orders po join purchase_order_items i on i.po_id = po.id left join suppliers s on s.id = po.supplier_id where po.tenant_id = $1 and i.asin in ($2, $3) order by i.quantity desc",
        [T, A1, A2],
      );
      expect(pos).toHaveLength(2);
      expect(pos[0]).toMatchObject({ status: "ordered", order_date: iso(heute), quantity: 3, supplier: "Testshop AO", quelle: "arbitrageone" });
      expect(Number(pos[0].unit_cost_gross)).toBeCloseTo(14.875, 3); // 12,50 netto + 19 % USt
      expect((await sql("select 1 from lots where tenant_id = $1 and sku = $2 and quantity = 3", [T, S1])).length).toBe(0);
      expect((await sql("select menge from ao_lagerbestand where tenant_id = $1 and sku = $2", [T, S1]))[0]).toMatchObject({ menge: 3 });
      expect((await sql<{ monat: string }>("select monat from ao_accountone_cog where tenant_id = $1 and zeilen @> $2::jsonb", [T, JSON.stringify([{ sku: S1 }])]))[0].monat).toBe(vormonat);
      expect((await sql("select 1 from amazon_reimbursements where tenant_id = $1 and reimbursement_id = $2", [T, `AOTR${m}`])).length).toBe(1);
      // Lugru „gekauft“ aus dem ArbitrageOne-Einkauf (gleich nach dem Abruf abgeglichen)
      const [d] = await sql<{ gekauft_erkannt: boolean; gekauft_erkannt_ref: string }>("select gekauft_erkannt, gekauft_erkannt_ref from lugru_deals_historie where id = $1", [deal.id]);
      expect(d.gekauft_erkannt).toBe(true);
      expect(d.gekauft_erkannt_ref).toContain("ArbitrageOne-Einkauf");
      // EK fehlt nicht mehr (dieselbe EK-Quelle wie Bestellvorschläge)
      expect(JSON.parse(await mcp.call("fehlende_einkaufspreise", { limit: 200 })).skus.map((x: { sku: string }) => x.sku)).not.toContain(S1);
      // Liquidität: Wareneinkauf des Monats und Lagerwert; Monatsrahmen aus den Einkäufen
      await page.goto("/cashflow");
      await expect(page.locator("body")).toContainText("Wareneinkauf im Monat (ArbitrageOne)");
      await expect(page.locator("body")).toContainText("Lagerwert (ArbitrageOne)");
      await page.goto("/deal-eingang");
      await expect(page.getByTestId("de-monatsrahmen")).toContainText("ArbitrageOne-Einkäufen");
      // B31.1: kein BQool-Vergleich mehr aus ArbitrageOne, nichts als Repricer-Ist (ProfitGuard) übernommen
      expect((await sql("select 1 from datei_importe where tenant_id = $1 and herkunft = 'arbitrageone' and quelle_export = 'bqool'", [T])).length).toBe(0);
      expect((await sql("select 1 from profitguard_listings where tenant_id = $1 and sku = $2", [T, S1])).length).toBe(0);
      // Werkzeuge: importe (Herkunft), buchhaltung_status (AccountOne COG), anbindungen_status (Auslöser)
      expect(await mcp.call("importe", { limit: 10 })).toContain("ArbitrageOne-Abruf (einkaeufe)");
      expect(JSON.parse(await mcp.call("buchhaltung_status", { monat: vormonat })).accountone_cog.vorhanden).toBe(true);
      expect(JSON.parse(await mcp.call("anbindungen_status", {})).arbitrageone.ausloeser).toContain("täglich 05:30");

      // Zweiter Abruf: dieselben Dateien → „bereits importiert“, nichts doppelt
      await page.goto("/einstellungen/hintergrund#importe-arbitrageone");
      await Promise.all([page.waitForURL(/ao=/, { timeout: 180_000 }), page.getByTestId("ao-jetzt").click()]);
      await expect(page.getByTestId("ao-lauf").first()).toContainText("bereits importiert");
      expect((await sql("select 1 from ao_einkaeufe where tenant_id = $1 and asin in ($2, $3)", [T, A1, A2])).length).toBe(2);
      expect((await sql("select 1 from amazon_reimbursements where tenant_id = $1 and reimbursement_id = $2", [T, `AOTR${m}`])).length).toBe(1);

      // Ein Export fehlt auf der Seite → übrige verarbeitet, Aufgabe für den fehlenden
      await ao({ ohne: ["lagerbestand"], dateien: { einkaeufe: `ASIN;SKU;Kaufdatum;Menge;EK netto\n${A1};${S1};${tt(heute)};1;12,50\n` } });
      await Promise.all([page.waitForURL(/ao=teilweise/, { timeout: 180_000 }), page.getByTestId("ao-jetzt").click()]);
      await expect(page.getByTestId("ao-meldung")).toContainText("nicht alle Exporte");
      // B27.6: je Export eine Zeile „Name · Status · Kurztext“
      await expect(page.getByTestId("ao-lauf").first().getByTestId("ao-lauf-export").filter({ hasText: "Lagerbestand" })).toContainText("Fehler");
      const [aufgabe] = await sql<{ title: string }>("select title from tasks where tenant_id = $1 and system_key = 'automatik-arbitrageone-exporte' and status = 'open'", [T]);
      expect(aufgabe.title).toContain("Lagerbestand");

      // Zwei-Faktor → Abbruch mit Aufgabe, kein Wiederholen
      await sql("update integrations set config = config || '{\"email\":\"2fa-ao@example.invalid\"}'::jsonb where tenant_id = $1 and provider = 'arbitrageone_web'", [T]);
      await Promise.all([page.waitForURL(/ao=fehler/, { timeout: 180_000 }), page.getByTestId("ao-jetzt").click()]);
      await expect(page.getByTestId("ao-lauf").first()).toContainText("Zwei-Faktor");
      const [abbruch] = await sql<{ title: string; priority: string }>("select title, priority from tasks where tenant_id = $1 and system_key = 'automatik-arbitrageone' and status = 'open'", [T]);
      expect(abbruch).toMatchObject({ title: "ArbitrageOne-Abruf: abgebrochen", priority: "critical" });
    } finally {
      await sql("update integrations set config = config || '{\"email\":\"einkauf-ao@example.invalid\"}'::jsonb where tenant_id = $1 and provider = 'arbitrageone_web'", [T]);
      await ao({ zuruecksetzen: true });
      await sql("update tasks set status = 'done' where tenant_id = $1 and system_key like 'automatik-arbitrageone%' and status = 'open'", [T]);
      await sql("delete from ao_einkaeufe where tenant_id = $1 and asin in ($2, $3)", [T, A1, A2]);
      await sql("delete from purchase_orders where tenant_id = $1 and quelle = 'arbitrageone' and id in (select po_id from purchase_order_items where tenant_id = $1 and asin in ($2, $3))", [T, A1, A2]);
      await sql("delete from ao_lagerbestand where tenant_id = $1 and sku = $2", [T, S1]);
      await sql("delete from ao_accountone_cog where tenant_id = $1 and zeilen @> $2::jsonb", [T, JSON.stringify([{ sku: S1 }])]);
      await sql("delete from amazon_reimbursements where tenant_id = $1 and reimbursement_id = $2", [T, `AOTR${m}`]);
      await sql("delete from lugru_deals_historie where id = $1", [deal.id]);
      await sql("delete from amazon_inventory where tenant_id = $1 and sku = $2", [T, S1]);
    }
  });
});
