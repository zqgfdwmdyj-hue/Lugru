// Nachtrag B30 (06.11.): Der ArbitrageOne-Export „Einkäufe“ (PurchaseOrders .xls) ist eine Bestellliste – eigener
// Parser (Art ao_einkaeufe) → Einkauf → Bestellungen statt EK-Liste. Fehlimport mit gespeicherter Art ek_liste →
// „Erneut verarbeiten“ nimmt die neue Art; fehlgeschlagene Importe werden beim nächsten Abruf automatisch
// nachverarbeitet; manueller Upload wird als „ArbitrageOne – Bestellungen“ erkannt; EK je SKU aus Lieferungen nur als
// Vorschlag mit Warnung gegen den sellerboard-COG; fehlende Spalten → „gefunden: …; fehlt: …“. Alle Daten erfunden.
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

type Link = { import_id: string; upload_url: string; content_type: string };
const tag = (n: number) => new Date(Date.now() - n * 86400_000);
const tt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ao = (body: unknown) => fetch(`${TD}/__ao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Aufbau wie der echte Export: HTML-Tabelle als .xls mit Titel- und Leerzeile vor der Kopfzeile.
const KOPF = ["Bestellnummer", "Bestelldatum", "Lieferant", "ASIN", "SKU", "Produktname", "Menge", "EK netto", "Status"];
const poDatei = (zeilen: string[][], kopf = KOPF) =>
  `<html><body><table><tr><td>PurchaseOrders Export</td></tr><tr><td></td></tr><tr>${kopf.map((h) => `<th>${h}</th>`).join("")}</tr>${zeilen.map((z) => `<tr>${z.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</table></body></html>`;

test.describe("B30 – ArbitrageOne-Einkäufe als Bestellungen", () => {
  test("Fehlimport (ek_liste) → Erneut verarbeiten mit neuer Art → Einkauf → Bestellungen; manueller Upload erkannt; EK-Vorschlag mit sellerboard-Warnung", async ({ page, browser, baseURL }) => {
    test.setTimeout(240_000);
    const m = marke();
    const [{ tenant_id: T, asin: PA }] = await sql<{ tenant_id: string; asin: string }>("select l.tenant_id, p.asin from lots l join products p on p.id = l.product_id where l.sku = 'TEST-SOCKEN' limit 1");
    const S1 = `TEST-SKU-B30-${m}-1`;
    const S2 = `TEST-SKU-B30-${m}-2`;
    const A2 = `B0B3Y${m}`;
    const A3 = `B0B3Z${m}`;
    const datei = poDatei([
      [`B30-${m}-1`, tt(tag(5)), "Testshop B30", PA, S1, "Testartikel B30 eins (erfunden)", "2", "10,00", "Geliefert"],
      [`B30-${m}-1`, tt(tag(5)), "Testshop B30", A2, S2, "Testartikel B30 zwei (erfunden)", "1", "5,00", "Bestellt"],
      [`B30-${m}-2`, tt(tag(4)), "Testshop B30 Zwei", A3, "", "Testartikel B30 drei (erfunden)", "4", "3,00", "Storniert"],
    ]);
    const name = `ArbitrageOne_PurchaseOrders_Export_${iso(tag(1))}.xls`;
    const altName = `ArbitrageOne_PurchaseOrders_Export_${iso(tag(1))}_${m}.xls`;
    // sellerboard-COG 8,00 € – der EK aus den Lieferungen (10,00 €) weicht um 25 % ab
    await sql("insert into sellerboard_products (tenant_id, sb_id, sku, asin, name, cost, synced_at) values ($1, $2, $3, $4, 'Testartikel B30 eins (erfunden)', 8, now())", [T, `b30-${m}`, S1, PA]);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    try {
      // Datei ablegen (wie der Abruf) und daraus einen Fehlimport wie vom 02.–06.11. bauen: Art ek_liste, schon einmal
      // erfolglos „erneut verarbeitet“ (06.11., 08:05)
      const l = JSON.parse(await mcp.call("import_link", { art: "sonstiges", dateiname: name })) as Link;
      expect((await fetch(l.upload_url, { method: "PUT", body: datei, headers: { "Content-Type": l.content_type } })).status).toBe(202);
      await expect.poll(async () => JSON.parse(await mcp.call("import_status", { import_id: l.import_id })).status, { timeout: 60_000 }).toBe("fertig");
      const [quelle] = await sql<{ ablage: string; user_id: string }>("select ablage, user_id from datei_importe where id = $1", [l.import_id]);
      const [alt] = await sql<{ id: string }>(
        "insert into datei_importe (tenant_id, user_id, art, dateiname, token_hash, gueltig_bis, benutzt_am, status, fehler_text, herkunft, quelle_export, ablage, hochgeladen_am, fertig_am, nachverarbeitet_am) values ($1, $2, 'ek_liste', $3, $4, now(), now(), 'fehler', 'Pflichtspalten fehlen (ASIN, SKU und EK).', 'arbitrageone', 'einkaeufe', $5, now() - interval '1 day', now() - interval '1 day', now() - interval '3 hours') returning id",
        [T, quelle.user_id, altName, `ao:b30-${m}`, quelle.ablage],
      );

      // Abnahme 1: „Erneut verarbeiten“ nimmt die neue Art, Status „fertig“ mit „n Bestellungen, m Positionen, k ohne Zuordnung“
      await anmelden(page, "inhaber");
      await page.goto("/anbindungen?p=arbitrageone_web#arbitrageone_web");
      const zeile = page.getByTestId("ao-import").filter({ hasText: altName });
      await expect(zeile).toContainText("Pflichtspalten fehlen");
      await Promise.all([page.waitForURL(/erneut=/), zeile.getByTestId("ao-import-erneut").click()]);
      await expect(page.getByTestId("ao-erneut-meldung")).toContainText("Erneut verarbeitet: 2 Bestellungen, 3 Positionen, 2 ohne Zuordnung");
      await expect(page.getByTestId("ao-import").filter({ hasText: altName })).toContainText("2 Bestellungen, 3 Positionen, 2 ohne Zuordnung · neu: 2 Bestellungen mit 3 Positionen");
      const st = JSON.parse(await mcp.call("import_status", { import_id: alt.id }));
      expect(st).toMatchObject({ status: "fertig", art: "ao_einkaeufe" });
      expect(st.ergebnis.erneut_verarbeitet).toMatchObject({ art_vorher: "ek_liste", vorheriger_fehler: "Pflichtspalten fehlen (ASIN, SKU und EK)." });
      expect(st.ergebnis.bestellungen).toMatchObject({ bestellungen: 2, positionen: 3, ohne_zuordnung: 2, preis: "netto" });
      expect(st.ergebnis.bestellungen.spalten).toMatchObject({ bestellnummer: "Bestellnummer", datum: "Bestelldatum", lieferant: "Lieferant", asin: "ASIN", menge: "Menge", ekNetto: "EK netto", status: "Status" });

      // Abnahme 2: Einkauf → Bestellungen mit Lieferant, Datum, Menge, EK, Status
      const pos = await sql<{ number: string; status: string; order_date: string; supplier: string; asin: string; quantity: number; received: number; unit_cost_gross: string; product_id: string | null; externer_status: string }>(
        "select po.number, po.status, po.order_date::text, s.name as supplier, i.asin, i.quantity, i.received, i.unit_cost_gross::text, i.product_id, i.externer_status from purchase_orders po join purchase_order_items i on i.po_id = po.id left join suppliers s on s.id = po.supplier_id where po.tenant_id = $1 and po.quelle = 'arbitrageone' and po.number like $2 order by po.number, i.quantity desc",
        [T, `AO-B30-${m}-%`],
      );
      expect(pos.map((p) => [p.number, p.status, p.supplier, p.asin, p.quantity, p.received, p.externer_status])).toEqual([
        [`AO-B30-${m}-1`, "partial", "Testshop B30", PA, 2, 2, "geliefert"],
        [`AO-B30-${m}-1`, "partial", "Testshop B30", A2, 1, 0, "bestellt"],
        [`AO-B30-${m}-2`, "cancelled", "Testshop B30 Zwei", A3, 4, 0, "storniert"],
      ]);
      expect(pos[0].order_date).toBe(iso(tag(5)));
      expect(pos[0].product_id).toBeTruthy();
      expect(pos[1].product_id).toBeNull();
      expect(Number(pos[0].unit_cost_gross)).toBeCloseTo(11.9, 4); // 10,00 netto + 19 % USt
      await page.goto("/einkauf?ansicht=arbitrageone");
      const z1 = page.locator(`[data-testid="po-zeile"][data-nummer="AO-B30-${m}-1"]`);
      await expect(z1.getByTestId("po-quelle-ao")).toBeVisible();
      await expect(z1).toContainText("Testshop B30");
      await expect(z1).toContainText(tt(tag(5)));
      await expect(z1.getByTestId("po-ohne-zuordnung")).toContainText("1 ohne Zuordnung");
      await expect(page.locator(`[data-testid="po-zeile"][data-nummer="AO-B30-${m}-2"]`)).toContainText("Testshop B30 Zwei");
      await z1.getByRole("link", { name: `AO-B30-${m}-1` }).click();
      await expect(page.getByTestId("po-ao-hinweis")).toContainText("Schon bezahlt");
      await expect(page.getByTestId("poi-ohne-zuordnung")).toHaveCount(1);
      await expect(page.locator("body")).toContainText(S1);
      await expect(page.locator("body")).toContainText("11,90");

      // B30.1.3: EK je SKU aus den Lieferungen als Vorschlag (nichts übernommen), Warnung > 10 % gegen sellerboard-COG
      const [vorschlag] = await sql<{ id: string; dateiname: string; status: string }>("select id, dateiname, status from ek_importe where tenant_id = $1 and quelle = 'ao_bestellungen' and zeilen @> $2::jsonb", [T, JSON.stringify([{ sku: S1 }])]);
      expect(vorschlag).toMatchObject({ status: "vorschau" });
      expect(vorschlag.dateiname).toContain("aus ArbitrageOne-Bestellungen");
      await page.goto(`/einkauf/ek-import?id=${vorschlag.id}`);
      const ekZeile = page.locator(`[data-testid="ek-zeile"][data-sku="${S1}"]`);
      await expect(ekZeile).toContainText("10,00");
      await expect(ekZeile).toContainText("weicht +25 % vom sellerboard-COG (8,00 €) ab");
      await expect(page.locator(`[data-testid="ek-zeile"][data-sku="${S2}"]`)).toHaveCount(0); // noch nicht geliefert
      expect((await sql("select 1 from lots where tenant_id = $1 and sku = $2", [T, S1])).length).toBe(0);

      // Liquidität: online schon bezahlt → keine offene Zahlung „Einkauf AO-…“
      expect(await mcp.call("liquiditaet", {})).not.toContain(`AO-B30-${m}`);

      // Abnahme 4: manueller Upload derselben Datei → „ArbitrageOne – Bestellungen“, nichts doppelt, kein zweiter Vorschlag
      await page.goto("/uploads");
      await page.getByTestId("upload-dateien").setInputFiles([{ name, mimeType: "application/vnd.ms-excel", buffer: Buffer.from(datei) }]);
      await page.getByTestId("upload-los").click();
      const e = page.getByTestId("upload-ergebnis");
      await expect(e).toHaveAttribute("data-art", "ao_einkaeufe", { timeout: 60_000 });
      await expect(e).toContainText("ArbitrageOne – Bestellungen: 2 Bestellungen, 3 Positionen, 2 ohne Zuordnung · neu: 0 Bestellungen mit 0 Positionen · schon bekannt: 3 Positionen");
      expect((await sql("select 1 from purchase_order_items i join purchase_orders po on po.id = i.po_id where po.tenant_id = $1 and po.number like $2", [T, `AO-B30-${m}-%`])).length).toBe(3);
      expect((await sql("select 1 from ek_importe where tenant_id = $1 and quelle = 'ao_bestellungen' and zeilen @> $2::jsonb", [T, JSON.stringify([{ sku: S1 }])])).length).toBe(1);
    } finally {
      await sql("delete from purchase_orders where tenant_id = $1 and quelle = 'arbitrageone' and number like $2", [T, `AO-B30-${m}-%`]);
      await sql("delete from ek_importe where tenant_id = $1 and quelle = 'ao_bestellungen' and zeilen @> $2::jsonb", [T, JSON.stringify([{ sku: S1 }])]);
      await sql("delete from ao_einkaeufe where tenant_id = $1 and (asin in ($2, $3) or sku = $4)", [T, A2, A3, S1]);
      await sql("delete from sellerboard_products where tenant_id = $1 and sb_id = $2", [T, `b30-${m}`]);
    }
  });

  test("Fehlimporte beim nächsten Abruf automatisch nachverarbeitet; Einkäufe · ok; fehlende Spalten → gefunden/fehlt", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const A1 = `B0B3N${m}`;
    const datei = poDatei([[`B30N-${m}`, tt(tag(4)), "Testshop B30 Nacht", A1, `TEST-SKU-B30N-${m}`, "Testartikel B30 Nacht (erfunden)", "3", "7,50", "Bestellt"]]);
    const name = `ArbitrageOne_PurchaseOrders_Export_${iso(tag(4))}_${m}.xls`;
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    try {
      // Fehlimport wie vom 02.11. (Art ek_liste), am 06.11. schon einmal erfolglos erneut verarbeitet
      const l = JSON.parse(await mcp.call("import_link", { art: "sonstiges", dateiname: name })) as Link;
      expect((await fetch(l.upload_url, { method: "PUT", body: datei, headers: { "Content-Type": l.content_type } })).status).toBe(202);
      await expect.poll(async () => JSON.parse(await mcp.call("import_status", { import_id: l.import_id })).status, { timeout: 60_000 }).toBe("fertig");
      const [quelle] = await sql<{ ablage: string; user_id: string }>("select ablage, user_id from datei_importe where id = $1", [l.import_id]);
      const [alt] = await sql<{ id: string }>(
        "insert into datei_importe (tenant_id, user_id, art, dateiname, token_hash, gueltig_bis, benutzt_am, status, fehler_text, herkunft, quelle_export, ablage, hochgeladen_am, fertig_am, nachverarbeitet_am) values ($1, $2, 'ek_liste', $3, $4, now(), now(), 'fehler', 'Pflichtspalten fehlen (ASIN, SKU und EK).', 'arbitrageone', 'einkaeufe', $5, now() - interval '4 days', now() - interval '4 days', now() - interval '3 hours') returning id",
        [T, quelle.user_id, `nacht-${name}`, `ao:b30n-${m}`, quelle.ablage],
      );

      // B30.3 + Abnahme 3: nächster Abruf (hier „Jetzt abholen“ – gleicher Ablauf wie 05:30) holt den Fehlimport nach;
      // die neue Tagesdatei „Einkäufe“ läuft mit Art ao_einkaeufe durch
      const AT = `B0B3T${m}`;
      const tagesdatei = poDatei([[`B30T-${m}`, tt(tag(0)), "Testshop B30 Tag", AT, `TEST-SKU-B30T-${m}`, "Testartikel B30 Tag (erfunden)", "1", "4,00", "Bestellt"]]);
      await ao({ zuruecksetzen: true, dateien: { einkaeufe: tagesdatei }, namen: { einkaeufe: `ArbitrageOne_PurchaseOrders_Export_${iso(tag(0))}.xls` } });
      await anmelden(page, "inhaber");
      await page.goto("/anbindungen?p=arbitrageone_web#arbitrageone_web");
      await Promise.all([page.waitForURL(/ao=/, { timeout: 240_000 }), page.getByTestId("ao-jetzt").click()]);
      const st = JSON.parse(await mcp.call("import_status", { import_id: alt.id }));
      expect(st, st.fehler_text).toMatchObject({ status: "fertig", art: "ao_einkaeufe" });
      expect(st.ergebnis.text).toContain("1 Bestellung, 1 Position, 1 ohne Zuordnung");
      expect(st.ergebnis.erneut_verarbeitet.art_vorher).toBe("ek_liste");
      expect((await sql("select 1 from purchase_orders where tenant_id = $1 and quelle = 'arbitrageone' and number in ($2, $3)", [T, `AO-B30N-${m}`, `AO-B30T-${m}`])).length).toBe(2);
      const lauf = page.getByTestId("ao-lauf").first().getByTestId("ao-lauf-export").filter({ hasText: "Einkäufe" });
      await expect(lauf).toContainText("ok");
      await expect(lauf).toContainText("1 Bestellung, 1 Position");
      const [neu] = await sql<{ art: string; status: string }>("select art, status from datei_importe where tenant_id = $1 and herkunft = 'arbitrageone' and quelle_export = 'einkaeufe' order by created_at desc limit 1", [T]);
      expect(neu).toMatchObject({ art: "ao_einkaeufe", status: "fertig" });
      const status = JSON.parse(await mcp.call("anbindungen_status", {}));
      expect(status.arbitrageone.letzter_lauf.ergebnis).toEqual(expect.arrayContaining([expect.stringMatching(/^Einkäufe · ok · 1 Bestellung, 1 Position/)]));
      expect(JSON.stringify(status.arbitrageone.letzter_lauf.fehler_details ?? [])).not.toContain("Einkäufe");

      // B30.2: fehlen Spalten, nennt der Fehler die gefundenen und die fehlenden
      const kaputt = poDatei([[`B30K-${m}`, "Testshop B30", A1, "Testartikel"]], ["Bestellnummer", "Lieferant", "ASIN", "Produktname"]);
      const k = JSON.parse(await mcp.call("import_link", { art: "ao_einkaeufe", dateiname: `ArbitrageOne_PurchaseOrders_Export_kaputt_${m}.xls` })) as Link;
      expect((await fetch(k.upload_url, { method: "PUT", body: kaputt, headers: { "Content-Type": k.content_type } })).status).toBe(202);
      await expect.poll(async () => JSON.parse(await mcp.call("import_status", { import_id: k.import_id })).status, { timeout: 60_000 }).toBe("fehler");
      const ks = JSON.parse(await mcp.call("import_status", { import_id: k.import_id }));
      expect(ks.fehler_text).toContain("gefunden: Bestellnummer, Lieferant, ASIN, Produktname; fehlt: Menge, Bestelldatum, EK (Einzelpreis oder Gesamtpreis)");
      expect(ks.fehler_text).not.toContain("Pflichtspalten fehlen");
    } finally {
      await ao({ zuruecksetzen: true });
      await sql("update tasks set status = 'done' where tenant_id = $1 and system_key like 'automatik-arbitrageone%' and status = 'open'", [T]);
      await sql("delete from purchase_orders where tenant_id = $1 and quelle = 'arbitrageone' and number in ($2, $3)", [T, `AO-B30N-${m}`, `AO-B30T-${m}`]);
      await sql("delete from ao_einkaeufe where tenant_id = $1 and asin in ($2, $3)", [T, A1, `B0B3T${m}`]);
    }
  });
});
