// B2B-Deals, Teil 2: Preisliste mit ungewöhnlichen Spalten (KI ordnet zu) → Auswertung je Land mit Ampel →
// Export → Deal aus der Zeile; Lieferanten-Mail mit Preisliste im Anhang; Claude-Werkzeuge (lesen + ändern,
// Rechte); Erfolgskontrolle 30/60 Tage und Bilanz. Alle Artikel, Firmen und Preise sind erfunden.
import { aktion, anmelden, expect, mcpVerbinden, sql, test, testdienste } from "./helfer";

const plus = (n: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(Date.now() + n * 86400_000));
const CSV = ["Code-Nr.;Barcode-Nummer;Amazon-Nr;Produkt;Netto/Stk.;Lager", "GH-1;4000000000116;B0SCAN0001;Scan-Testartikel A (erfunden);6,20;120", "GH-2;4000000000123;B0SCAN0002;Scan-Testartikel B (erfunden);19,90;40", "GH-3;4000000000130;;Ohne ASIN (erfunden);3,00;10"].join("\r\n");

test.describe("B2B-Preislisten", () => {
  test.beforeEach(({ page }) => {
    page.on("dialog", (d) => d.accept());
  });

  test("Preisliste mit unklaren Spalten: KI-Zuordnung, Auswertung je Land, Ampel, Filter, Export, Deal aus Zeile", async ({ page }) => {
    await anmelden(page, "inhaber");
    await page.goto("/b2b/preislisten");
    await page.selectOption("#pl-lieferant", { label: "Test-Großhandel (erfunden) (TESTGH)" });
    await page.fill("#pl-name", "E2E Scanner-Liste");
    await page.setInputFiles('[data-testid="pl-datei"]', { name: "liste.csv", mimeType: "text/csv", buffer: Buffer.from(CSV, "utf8") });
    await Promise.all([page.waitForURL(/\/b2b\/preislisten\/[0-9a-f-]{36}/), page.click('[data-testid="pl-hochladen"]')]);
    await expect(page.locator('[data-testid="scan-meldung"]')).toContainText("Spalten per KI erkannt");
    expect((await testdienste.ki()).some((k) => k.text.includes("Ordne die Spalten einer Großhändler-Preisliste zu"))).toBe(true);
    const [feed] = await sql<{ id: string; mapping: Record<string, string> }>("select id, mapping from supplier_feeds where name = 'E2E Scanner-Liste'");
    expect(feed.mapping).toMatchObject({ supplierSku: "Code-Nr.", asin: "Amazon-Nr", title: "Produkt", price: "Netto/Stk." });
    await expect(page.locator('[data-testid="scan-stand"]')).toContainText("3 Angebote · 2 mit ASIN");
    // Marktdaten je Land laufen im Hintergrund (Keepa-Nachbau) – Seite neu laden, bis da
    await expect(async () => {
      await page.reload();
      await expect(page.locator('[data-testid="scan-zeile"][data-asin="B0SCAN0001"]')).not.toContainText("Marktdaten fehlen");
    }).toPass({ timeout: 45_000 });
    const a = page.locator('[data-testid="scan-zeile"][data-asin="B0SCAN0001"]');
    await expect(a).toContainText("gelb"); // Amazon hält die Buy Box meist → gelb trotz Marge
    await expect(page.locator('[data-testid="scan-zeile"][data-asin="B0SCAN0002"]')).toContainText("rot");
    await expect(page.locator('[data-testid="scan-zeile"][data-asin=""]')).toContainText("keine ASIN");
    // Filter Ampel gelb
    await page.selectOption("#ampel", "gelb");
    await page.click('button:has-text("Filtern")');
    await expect(page.locator('[data-testid="scan-zeile"]')).toHaveCount(1);
    // Export (CSV)
    const csv = await (await page.request.get(`/b2b/preislisten/${feed.id}/export?ampel=gelb`)).text();
    expect(csv).toContain("Ampel;Artikelnr.;EAN;ASIN");
    expect(csv).toContain("gelb;GH-1;4000000000116;B0SCAN0001");
    // Deal aus der Zeile: ASIN, EK und Lieferant vorbefüllt
    await page.locator('[data-testid="scan-zeile"][data-asin="B0SCAN0001"] [data-testid="scan-deal"]').click();
    await expect(page.locator('[data-testid="deal-asin"]')).toHaveValue("B0SCAN0001");
    await expect(page.locator('[data-testid="deal-ek"]')).toHaveValue("6,2");
    await expect(page.locator("#f-supplierId option:checked")).toHaveText("Test-Großhandel (erfunden) (TESTGH)");
  });

  test("Lieferanten-Antwort mit Preisliste im Anhang wird übernommen (Aufgabe mit Link)", async ({ page }) => {
    await anmelden(page, "inhaber");
    const csv = Buffer.from(["Artikelnummer;EAN;Bezeichnung;Preis;Bestand", "M-1;4000000000147;Mail-Testartikel (erfunden);4,50;30", "M-2;4000000000154;Mail-Testartikel 2 (erfunden);5,10;0"].join("\r\n"), "utf8").toString("base64");
    const eml = [
      "From: Test-Großhandel <bestellung@example.invalid>",
      "To: einkauf@example.invalid",
      "Subject: Aktuelle Preisliste (Test)",
      `Message-ID: <preisliste-${Date.now()}@example.invalid>`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="GRENZE"',
      "",
      "--GRENZE",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Anbei unsere aktuelle Preisliste. (Test)",
      "--GRENZE",
      'Content-Type: text/csv; name="preisliste.csv"',
      'Content-Disposition: attachment; filename="preisliste.csv"',
      "Content-Transfer-Encoding: base64",
      "",
      csv,
      "--GRENZE--",
      "",
    ].join("\r\n");
    await page.goto("/posteingang");
    await page.setInputFiles("#eml", { name: "antwort.eml", mimeType: "message/rfc822", buffer: Buffer.from(eml, "utf8") });
    await Promise.all([aktion(page), page.locator('[data-testid="eml-upload"] button[type="submit"]').click()]);
    await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int as n from supplier_offers o join supplier_feeds f on f.id = o.feed_id where f.name = 'Test-Großhandel (erfunden) – Preisliste per Mail'"))[0].n).toBe(2);
    const [task] = await sql<{ title: string; link: string }>("select title, link from tasks where system_key like 'preisliste-mail:%' order by created_at desc limit 1");
    expect(task.title).toBe("Neue Preisliste von Test-Großhandel (erfunden) übernommen");
    await page.goto(task.link);
    await expect(page.locator('[data-testid="scan-stand"]')).toContainText("2 Angebote");
  });

  test("Claude-Werkzeuge: lesen und ändern (anlegen, Preis, freischalten), ohne Kontaktdaten, protokolliert", async ({ browser, baseURL }) => {
    const c = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const tools = await c.tools();
    for (const n of ["preislisten", "preisliste_auswerten", "deals", "deal", "deal_bilanz", "b2b_kunden", "deal_anlegen", "deal_preis_setzen", "deal_freischalten"]) expect(tools).toContain(n);
    const neu = JSON.parse(await c.call("deal_anlegen", { asin: "B0TOOL0001", ek_netto: 5.5, lieferant: "TESTGH", moq_lieferant: 20, kundenpreis_netto: 8, frist: plus(5), max_gesamt: 40 }));
    expect(neu.ok).toBe(true);
    expect(neu.link).toMatch(/\/b2b\/[0-9a-f-]{36}$/);
    const preis = JSON.parse(await c.call("deal_preis_setzen", { deal: String(neu.nr), kundenpreis_netto: 5 }));
    expect(preis.warnungen.join(" ")).toContain("Unser Verdienst ist negativ");
    await c.call("deal_preis_setzen", { deal: String(neu.nr), kundenpreis_netto: 8.5 });
    const frei = JSON.parse(await c.call("deal_freischalten", { deal: String(neu.nr) }));
    expect(frei).toMatchObject({ ok: true, status: "offen", abo_mails: 0 });
    const detail = JSON.parse(await c.call("deal", { deal: String(neu.nr) }));
    expect(detail.status).toBe("offen");
    expect(detail.kundenpreis_netto).toBe(8.5);
    expect(detail.prognose.map((p: { land: string }) => p.land)).toContain("DE");
    expect(JSON.parse(await c.call("deals", {})).deals.some((d: { nr: number }) => d.nr === neu.nr)).toBe(true);
    const kunden = await c.call("b2b_kunden", {});
    expect(kunden).toContain("Testhandel Paris SARL");
    expect(kunden).not.toContain("@example.invalid");
    expect(kunden).not.toContain("Pierre");
    const ausw = JSON.parse(await c.call("preisliste_auswerten", {}));
    expect(ausw.datenstand?.quelle ?? ausw.preisliste).toBeTruthy();
    // Rechte: Werkzeuge mit Bereich „b2b“ – Mitarbeiter ohne diesen Bereich sehen sie nicht (Unit-Test assistant.test.ts).
    expect(await sql("select 1 from assistant_log where tool = 'deal_freischalten' and write and ok")).toHaveLength(1);
  });

  test("Erfolgskontrolle 30/60 Tage nach Wareneingang und Bilanz", async ({ page }) => {
    await anmelden(page, "inhaber");
    // Ein angekommener Deal mit Prognose: Wareneingang 61 Tage zurück (Zeit vorspulen in der Test-Datenbank)
    const [d] = await sql<{ id: string; nr: number }>("select id, nr from deals where asin = 'B0TOOL0001'");
    expect(d, "Deal aus dem Werkzeug-Test").toBeTruthy();
    await sql("update deals set status = 'angekommen', angekommen_am = now() - interval '61 days' where id = $1", [d.id]);
    await page.goto("/b2b/bilanz");
    await Promise.all([page.waitForURL(/meldung=/), page.click('[data-testid="kontrolle-jetzt"]')]);
    await expect(page.locator('[data-testid="bilanz-meldung"]')).toContainText("Kontrolle(n) neu erfasst");
    const k = await sql<{ tag: number; land: string; bewertung: string }>("select tag, land, bewertung from deal_kontrollen where deal_id = $1 order by tag, land", [d.id]);
    expect(k.filter((x) => x.tag === 30).map((x) => x.land)).toEqual(["DE", "ES", "FR", "IT"]);
    expect(k.filter((x) => x.tag === 60)).toHaveLength(4);
    expect(k.every((x) => ["wie_prognostiziert", "besser", "schlechter"].includes(x.bewertung))).toBe(true);
    await expect(page.locator('[data-testid="bilanz-liste"]')).toContainText("30 T. DE");
    await expect(page.locator('[data-testid="bilanz-summe"]')).toContainText("8 Kontrollen");
    // Zweiter Lauf erfasst nichts doppelt
    await Promise.all([page.waitForURL(/meldung=Nichts/), page.click('[data-testid="kontrolle-jetzt"]')]);
  });
});
