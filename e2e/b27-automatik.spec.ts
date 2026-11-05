// Nachtrag B27 (03.11.): nächtliche Automatik. ArbitrageOne-Exporte mit Titelzeilen (PurchaseOrders als HTML-.xls,
// Lagerbestand als .xlsx mit Spalte „Menge“) werden ohne Typerkennung verarbeitet; „Export wird erstellt“ → Export-Liste
// abfragen; Dialog mit Pflichtfeldern wird ausgefüllt; Knopf ohne Reaktion → Fehler mit Bildschirmfoto und Seite;
// sellerboard-Weitergabe ohne Anmeldung = „übersprungen“; Lauf-Ergebnis je Export eine Zeile; „Erneut verarbeiten“;
// sellerboard-Zeitplan fest eingetragen; altes Call-Archiv „abgelöst“. Alle Daten erfunden (Test-Nachbau).
import * as XLSX from "xlsx";
import { TD } from "./env";
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const tt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ao = (body: unknown) => fetch(`${TD}/__ao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test.describe("B27 – nächtliche Automatik", () => {
  test("ArbitrageOne: PurchaseOrders .xls + Lagerbestand .xlsx verarbeitet, „wird erstellt“/Dialog geschafft, Fehler mit Bildschirmfoto; Erneut verarbeiten", async ({ page, browser, baseURL }) => {
    test.setTimeout(300_000);
    const m = marke();
    const A1 = `B0B27${m}`.slice(0, 10).padEnd(10, "X");
    const S1 = `B27-${m}`;
    const heute = new Date();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const [{ config: aoVorher }] = await sql<{ config: Record<string, string> }>("select config from integrations where tenant_id = $1 and provider = 'arbitrageone_web'", [T]);
    const [{ config: sbVorher }] = await sql<{ config: Record<string, string> }>("select config from integrations where tenant_id = $1 and provider = 'sellerboard_web'", [T]);
    // PurchaseOrders: HTML-Tabelle als .xls mit Titel- und Leerzeile; Lagerbestand: echte .xlsx mit Titelzeile und „Menge“
    const po = `<html><body><table><tr><td>Bestellungen Export ${tt(heute)}</td></tr><tr><td></td></tr><tr><th>Bestellnummer</th><th>Bestelldatum</th><th>Lieferant</th><th>ASIN</th><th>SKU</th><th>Titel</th><th>Bestellmenge</th><th>Einzelpreis netto</th></tr><tr><td>PO-${m}</td><td>${tt(heute)}</td><td>Testshop B27</td><td>${A1}</td><td>${S1}</td><td>Testartikel B27</td><td>3</td><td>12,50</td></tr></table></body></html>`;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Lagerbestand Stichtag ${tt(heute)}`], [], ["ASIN", "SKU", "Titel", "Menge", "EK netto"], [A1, S1, "Testartikel B27", 4, 12.5]]), "Lager");
    const xlsx = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64");
    await ao({
      zuruecksetzen: true,
      dateien: { einkaeufe: po },
      binaer: { lagerbestand: xlsx },
      namen: { einkaeufe: `ArbitrageOne_PurchaseOrders_Export_${iso(heute)}.xls`, lagerbestand: `Lagerbestand_${iso(heute)}.xlsx` },
      modus: { bqool: "async", reimbursement: "dialogfelder", accountone: "nichts" },
    });
    // B27.3: sellerboard-Weitergabe gewünscht, aber sellerboard-Anmeldung nicht eingerichtet
    await sql("update integrations set config = $2::jsonb where tenant_id = $1 and provider = 'arbitrageone_web'", [T, JSON.stringify({ ...aoVorher, sellerboardWeiterreichen: "ja" })]);
    await sql("update integrations set config = config - 'importUrl' where tenant_id = $1 and provider = 'sellerboard_web'", [T]);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    try {
      await anmelden(page, "inhaber");
      await page.goto("/anbindungen?p=arbitrageone_web#arbitrageone_web");
      await Promise.all([page.waitForURL(/ao=/, { timeout: 240_000 }), page.getByTestId("ao-jetzt").click()]);
      await expect(page.getByTestId("ao-meldung")).toContainText("nicht alle Exporte");

      // B27.1: Einkäufe (PurchaseOrders .xls) und Lagerbestand (.xlsx) verarbeitet – keine „Falsche Art“
      const zeilen = page.getByTestId("ao-import");
      await expect(zeilen.and(page.locator('[data-export="einkaeufe"]')).first()).toContainText("Einkäufe: 1 neu");
      await expect(zeilen.and(page.locator('[data-export="lagerbestand"]')).first()).toContainText("4 Stück");
      expect((await sql("select menge from ao_einkaeufe where tenant_id = $1 and asin = $2", [T, A1]))[0]).toMatchObject({ menge: 3 });
      expect((await sql("select menge from ao_lagerbestand where tenant_id = $1 and sku = $2", [T, S1]))[0]).toMatchObject({ menge: 4 });
      // B27.2: BQool kam über „Meine Exporte“, Reimbursement über den ausgefüllten Dialog; AccountOne ohne Reaktion
      const geladen = (await (await fetch(`${TD}/__ao`)).json()).downloads.map((d: { key: string }) => d.key);
      expect(geladen).toEqual(expect.arrayContaining(["einkaeufe", "lagerbestand", "sellerboard", "bqool", "reimbursement"]));
      expect(geladen).not.toContain("accountone");

      // B27.6: je Export eine Zeile; Fehler mit Bildschirmfoto und Seite, ohne Browser-Protokoll
      const lauf = page.getByTestId("ao-lauf").first();
      const acc = lauf.getByTestId("ao-lauf-export").filter({ hasText: "AccountOne COG (NEU)" });
      await expect(acc).toContainText("Fehler");
      await expect(acc).toContainText("weder eine Datei noch ein Dialog");
      await expect(acc).not.toContainText("logs");
      const bild = await acc.getByTestId("ao-lauf-bild").getAttribute("href");
      expect(bild).toMatch(/^\/import\/debug\/.+\.png$/);
      const png = await page.request.get(bild!);
      expect(png.status()).toBe(200);
      expect(png.headers()["content-type"]).toContain("image/png");
      // B27.3: sellerboard-Weitergabe ohne Anmeldung = übersprungen, kein Fehler
      const sb = lauf.getByTestId("ao-lauf-export").filter({ hasText: "Sellerboard" });
      await expect(sb).toContainText("ok");
      await expect(sb).toContainText("übersprungen (nicht eingerichtet)");

      // Claude: anbindungen_status – Zeilen je Export, Details mit Rohmeldung, Bildschirmfoto und Seite
      const st = JSON.parse(await mcp.call("anbindungen_status", {}));
      expect(st.arbitrageone.letzter_lauf.ergebnis).toEqual(expect.arrayContaining([expect.stringMatching(/^AccountOne COG \(NEU\) · Fehler · .*Bildschirmfoto http/), expect.stringMatching(/^Einkäufe · ok · /)]));
      const det = st.arbitrageone.letzter_lauf.fehler_details.find((d: { export: string }) => d.export === "AccountOne COG (NEU)");
      expect(det.seite).toContain("/web-arbitrageone/export");
      expect(det.bildschirmfoto).toMatch(/\/import\/debug\/.+\.png$/);

      // B27.1: „Erneut verarbeiten“ – ein (alter) fehlgeschlagener Import mit derselben Datei wird jetzt verarbeitet
      const [quelle] = await sql<{ ablage: string; user_id: string }>("select ablage, user_id from datei_importe where tenant_id = $1 and herkunft = 'arbitrageone' and quelle_export = 'lagerbestand' and status = 'fertig' order by created_at desc limit 1", [T]);
      const altName = `Lagerbestand_alt_${m}.xlsx`;
      const [alt] = await sql<{ id: string }>(
        "insert into datei_importe (tenant_id, user_id, art, dateiname, token_hash, gueltig_bis, benutzt_am, status, fehler_text, herkunft, quelle_export, ablage, hochgeladen_am, fertig_am) values ($1, $2, 'ao_lagerbestand', $3, $4, now(), now(), 'fehler', 'Falsche Art: erwartet ArbitrageOne – Lagerbestand (Stichtag), erkannt wurde „Bericht/Tabelle“ (alt)', 'arbitrageone', 'lagerbestand', $5, now(), now()) returning id",
        [T, quelle.user_id, altName, `ao:b27-${m}`, quelle.ablage],
      );
      const vorher = JSON.parse(await mcp.call("import_status", { import_id: alt.id }));
      expect(vorher).toMatchObject({ status: "fehler", erneut_verarbeitbar: true });
      await page.goto("/anbindungen?p=arbitrageone_web#arbitrageone_web");
      const altZeile = page.getByTestId("ao-import").filter({ hasText: altName });
      await Promise.all([page.waitForURL(/erneut=/), altZeile.getByTestId("ao-import-erneut").click()]);
      await expect(page.getByTestId("ao-erneut-meldung")).toContainText("Erneut verarbeitet: Lagerbestand");
      await expect(page.getByTestId("ao-import").filter({ hasText: altName })).toContainText("erneut verarbeitet");
      const nachher = JSON.parse(await mcp.call("import_status", { import_id: alt.id }));
      expect(nachher.status).toBe("fertig");
      expect(nachher.nachverarbeitet_am).toBeTruthy();
      expect(nachher.ergebnis.erneut_verarbeitet.vorheriger_fehler).toContain("Falsche Art");
    } finally {
      await sql("update integrations set config = $2::jsonb where tenant_id = $1 and provider = 'arbitrageone_web'", [T, JSON.stringify(aoVorher)]);
      await sql("update integrations set config = $2::jsonb where tenant_id = $1 and provider = 'sellerboard_web'", [T, JSON.stringify(sbVorher)]);
      await ao({ zuruecksetzen: true });
    }
  });

  test("anbindungen_status: sellerboard-Abrufe mit festem Zeitplan; altes Call-Archiv „abgelöst“ statt Problem", async ({ page, browser, baseURL }) => {
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    await sql("insert into job_runs (tenant_id, name, last_ok_at, updated_at) values ($1, 'sellerboard: Gewinn je Produkt und Tag', now(), now()) on conflict (tenant_id, name) do update set last_ok_at = now(), last_error_at = null, last_error = null", [T]);
    await sql("insert into job_runs (tenant_id, name, last_ok_at, updated_at) values ($1, 'Call-Archiv (Discord)', now() - interval '5 days', now()) on conflict (tenant_id, name) do update set last_ok_at = now() - interval '5 days'", [T]);
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const alle = JSON.parse(await mcp.call("anbindungen_status", {}));
    const tage = alle.abrufe.find((a: { abruf: string }) => a.abruf === "sellerboard: Gewinn je Produkt und Tag");
    expect(tage.ausloeser).toBe("Zeitplan: 04:00 und 13:00");
    expect(tage.naechster_lauf).not.toMatch(/nach dem ersten Lauf/);
    const call = alle.abrufe.find((a: { abruf: string }) => a.abruf === "Call-Archiv (Discord)");
    expect(call.abgeloest).toContain("abgelöst");
    expect(call.ueber_2_tage_alt).toBeUndefined();
    const probleme = JSON.parse(await mcp.call("anbindungen_status", { nur_probleme: true }));
    expect(probleme.abrufe.map((a: { abruf: string }) => a.abruf)).not.toContain("Call-Archiv (Discord)");
    // Anbindungen-Seite: abgelöst statt Zeitplan
    await anmelden(page, "inhaber");
    await page.goto("/anbindungen");
    await expect(page.getByTestId("abruf-zeile").filter({ hasText: "Call-Archiv (Discord)" }).getByTestId("abruf-abgeloest")).toBeVisible();
  });
});
