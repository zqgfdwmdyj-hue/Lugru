// Amazon-Berichte 1–4 und Kleinanzeigen-Entwurf mit erfundenen Daten (Testdienste statt Amazon):
// Anbindungen „Konto-Berichte anfordern“ → „Fertige Berichte abholen“ → Fall-Zentrale (Kontozustand, gestrandet/gesperrt,
// weitere Gebühren), Aufgaben + Push, USt-Bericht in der Buchhaltung (Quelle Schnittstelle), Kapital-Hinweis,
// Claude-Werkzeuge, Upload per Datei-Import; Kleinanzeigen-Block am eBay-Angebot mit Bilder-ZIP.
import { anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";
import { TD } from "./env";

test.describe("Amazon-Berichte 1–4", () => {
  test("Kontozustand, gestrandet/gesperrt, USt per Schnittstelle, weitere Gebühren → Fall-Zentrale, Aufgaben, Kapital, Claude, Datei-Import", async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const pushVorher = (await sql<{ n: number }>("select count(distinct bezug->>'id')::int n from meldungen where tenant_id = $1 and bezug->>'art' = 'aufgabe' and created_at > now() - interval '1 hour'", [T]))[0].n;
    // Wiederholbar: Stand aus einem früheren Lauf weg (nur Test-Datenbank), Push nur bei neu angelegter Aufgabe
    for (const tab of ["amazon_kontozustand", "amazon_gestrandet", "amazon_zusatzgebuehren"]) await sql(`delete from ${tab} where tenant_id = $1`, [T]);
    const schonDa = (await sql<{ n: number }>("select count(*)::int n from tasks where tenant_id = $1 and system_key in ('amazon-kontozustand', 'amazon-gestrandet')", [T]))[0].n;
    const TYPEN = ["GET_V2_SELLER_PERFORMANCE_REPORT", "GET_VAT_TRANSACTION_DATA", "GET_STRANDED_INVENTORY_UI_DATA", "GET_MERCHANTS_LISTINGS_FYP_REPORT", "GET_FBA_FBA_LONGTERM_STORAGE_FEE_CHARGES_DATA", "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA"];

    await anmelden(page, "inhaber");
    await page.goto("/anbindungen");
    const box = page.locator('[data-testid="amazon-berichte"]');
    await Promise.all([page.waitForURL(/amz=konto/), box.locator('[data-testid="konto-berichte-anfordern"]').click()]);
    await expect(page.locator('[data-testid="amazon-berichte-msg"]')).toContainText("6 Berichte angefordert (Kontozustand, gestrandet/gesperrt, Langzeitlager, Inbound-Mängel, Umsatzsteuer)");
    await Promise.all([page.waitForURL(/amz=abgeholt/), page.getByRole("button", { name: "Fertige Berichte abholen" }).click()]);
    for (const name of ["Kontozustand (Leistung des Verkäufers)", "Gestrandeter Bestand", "Gesperrte Angebote", "Langzeit-Lagergebühren", "Inbound-Mängel (Gebühren)", "Umsatzsteuer-Transaktionsbericht"])
      await expect(page.locator("table").getByText(name, { exact: true }).first()).toBeVisible();
    await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int n from api_report_requests where tenant_id = $1 and status = 'pending' and report_type = any($2)", [T, TYPEN]))[0].n).toBe(0);

    // 1. Kontozustand: DE gefährdet (neue Markenbeschwerde), FR gut
    await page.goto("/amazon-faelle");
    const kz = page.locator('[data-testid="kontozustand"]');
    await expect(kz.locator('[data-testid="kontozustand-stufe"]')).toHaveText("gefährdet");
    await expect(kz.locator('[data-testid="kontozustand-markt"]').filter({ hasText: "DE" })).toContainText("Kontozustand 230");
    await expect(kz.locator('[data-testid="kontozustand-markt"]').filter({ hasText: "DE" })).toContainText("Beschwerden wegen geistigen Eigentums");
    await expect(kz.locator('[data-testid="kontozustand-markt"]').filter({ hasText: "FR" })).toContainText("gut");

    // 2. Gestrandet: 2 SKUs, 8 Stück, 10,50 € gebunden (Socken 5 × 2,10 €), 1 ohne EK, 1 bald entfernt; gesperrt: Tasse
    const gs = page.locator('[data-testid="gestrandet"]');
    await expect(gs.locator('[data-testid="gestrandet-summe"]')).toContainText("2 SKUs gestrandet, 8 Stück, 10,50 € gebunden");
    await expect(gs.locator('[data-testid="gestrandet-summe"]')).toContainText("1 ohne EK nicht gerechnet");
    await expect(gs.locator('[data-testid="gestrandet-summe"]')).toContainText("1 bald automatisch entfernt");
    await expect(gs.locator('[data-testid="gestrandet-zeile"]').filter({ hasText: "TEST-SOCKEN" })).toContainText("No listing exists");
    await expect(gs.locator('[data-testid="gesperrt-zeile"]')).toContainText("TEST-TASSE");
    await expect(gs.locator('[data-testid="gesperrt-zeile"]')).toContainText("Missing information – Hauptbild fehlt");

    // 4. Weitere Gebühren: Langzeitlager 3,40 €, Inbound-Mängel 1,20 €
    const wg = page.locator('[data-testid="weitere-gebuehren"]');
    await expect(wg.locator('[data-testid="gebuehr-langzeitlager"]')).toContainText("3,40");
    await expect(wg.locator('[data-testid="gebuehr-inbound_mangel"]')).toContainText("1,20");

    // Aufgaben: Kontozustand + gestrandet (beide wichtig), gesperrt (normal); Push für neue wichtige Aufgaben
    const aufgaben = await sql<{ system_key: string; priority: string; title: string; link: string; status: string; id: string }>("select id, system_key, priority, title, link, status from tasks where tenant_id = $1 and system_key in ('amazon-kontozustand', 'amazon-gestrandet', 'amazon-gesperrt') order by system_key", [T]);
    expect(aufgaben.map((a) => `${a.system_key}:${a.priority}:${a.status}`)).toEqual(["amazon-gesperrt:normal:open", "amazon-gestrandet:critical:open", "amazon-kontozustand:critical:open"]);
    expect(aufgaben.find((a) => a.system_key === "amazon-kontozustand")!.title).toMatch(/^Amazon-Kontozustand gefährdet: DE: .*geistigen Eigentums/);
    expect(aufgaben.find((a) => a.system_key === "amazon-gestrandet")!.title).toBe("Gestrandeter Bestand bei Amazon: 2 SKUs, 8 Stück, 10,50 € gebunden – 1 bald automatisch entfernt");
    expect(aufgaben.find((a) => a.system_key === "amazon-kontozustand")!.link).toBe("/amazon-faelle#kontozustand");
    if (pushVorher <= 4 && schonDa === 0) {
      for (const key of ["amazon-kontozustand", "amazon-gestrandet"]) {
        const id = aufgaben.find((a) => a.system_key === key)!.id;
        await expect.poll(async () => (await sql<{ n: number }>("select count(*)::int n from meldungen where tenant_id = $1 and bezug->>'id' = $2", [T, id]))[0].n).toBeGreaterThan(0);
      }
    }

    // 3. USt-Bericht direkt von Amazon → Buchhaltung, Quelle Schnittstelle (ersetzt Dateien desselben Monats)
    const [ust] = await sql<{ monat: string; dateiname: string; daten: { teile: Record<string, unknown>; zeilen: { land: string }[] } }>("select monat, dateiname, daten from ust_auswertungen where tenant_id = $1 and dateiname = 'SP-API GET_VAT_TRANSACTION_DATA' order by created_at desc limit 1", [T]);
    expect(ust).toBeTruthy();
    expect(Object.keys(ust.daten.teile)).toEqual(["api"]);
    expect(new Set(ust.daten.zeilen.map((z) => z.land))).toEqual(new Set(["DE", "FR"]));
    const [prot] = await sql<{ nachher: { quelle: string } }>("select nachher from buchhaltung_protokoll where tenant_id = $1 and objekt = 'ust_bericht' order by created_at desc limit 1", [T]);
    expect(prot.nachher.quelle).toBe("api");

    // Kapital-Ampel: Hinweis auf gebundenes Kapital und weitere Gebühren
    await page.goto("/kapital");
    const kap = page.locator('[data-testid="kapital-amazon-berichte"]');
    await expect(kap).toContainText("8 Stück");
    await expect(kap).toContainText("10,50 €");
    await expect(kap).toContainText("Langzeit-Lagergebühr");

    // Claude: amazon_faelle mit Kontozustand/gestrandet/gesperrt, amazon_lagergebuehren mit weiteren Gebühren
    const c = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    const af = JSON.parse(await c.call("amazon_faelle", {}));
    expect(af.kontozustand.stufe).toBe("kritisch");
    expect(af.kontozustand.maerkte.find((m: { land: string }) => m.land === "DE")).toMatchObject({ wert: 230, stufe: "kritisch" });
    expect(af.kontozustand.link).toBe(`${baseURL}/amazon-faelle#kontozustand`);
    expect(af.gestrandet).toMatchObject({ anzahl: 2, stueck: 8, gebunden_eur: 10.5, ohne_ek: 1, entfernung_bald: 1 });
    expect(af.gesperrt).toMatchObject({ anzahl: 1, top: [{ sku: "TEST-TASSE", asin: "B0TEST0002", grund: "Missing information – Hauptbild fehlt" }] });
    const lg = JSON.parse(await c.call("amazon_lagergebuehren", {}));
    const weitere = lg.weitere_gebuehren as { je_art: { art: string; summe: number }[]; gesamt: number };
    expect(weitere.je_art.find((x) => x.art === "langzeitlager")!.summe).toBe(3.4);
    expect(weitere.je_art.find((x) => x.art === "inbound_mangel")!.summe).toBe(1.2);

    // Upload statt Schnittstelle: gestrandeter Bestand per Datei-Import ersetzt den Stand (nur noch die Socken, 3 Stück)
    const l = JSON.parse(await c.call("import_link", { art: "amazon_gestrandet", dateiname: "stranded.txt" })) as { import_id: string; upload_url: string; content_type: string };
    const datei = ["primary-action\tdate-stranded\tDate-to-take-auto-removal\tstranded-reason\tasin\tsku\tfnsku\tproduct-name\tfulfillable-qty\tunfulfillable-qty\treserved-quantity\tyour-price", "Relist\t2026-10-20\t\tNo listing exists\tB0TEST0001\tTEST-SOCKEN\tX00TEST0001\tTestsocken (erfunden)\t3\t0\t0\t9.99"].join("\n");
    expect((await fetch(l.upload_url, { method: "PUT", body: datei, headers: { "Content-Type": l.content_type } })).status).toBe(202);
    await expect.poll(async () => JSON.parse(await c.call("import_status", { import_id: l.import_id })).status, { timeout: 60_000 }).toBe("fertig");
    const nach = JSON.parse(await c.call("amazon_faelle", {}));
    expect(nach.gestrandet).toMatchObject({ anzahl: 1, stueck: 3, gebunden_eur: 6.3, ohne_ek: 0, entfernung_bald: 0 });
    const [t2] = await sql<{ priority: string; title: string }>("select priority, title from tasks where tenant_id = $1 and system_key = 'amazon-gestrandet'", [T]);
    expect(t2).toMatchObject({ priority: "normal", title: "Gestrandeter Bestand bei Amazon: 1 SKU, 3 Stück, 6,30 € gebunden" });
  });
});

test.describe("Kleinanzeigen-Entwurf", () => {
  test("eBay-Angebot → Titel ≤ 65, Kategorie, Zustand, Preis in Euro, Text ohne eBay-Sätze, Bilder + ZIP, kein Einstellen", async ({ page }) => {
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const itemId = `99${Date.now().toString().slice(-10)}`;
    const facts = {
      itemId,
      title: `Testmarke Bratpfanne 28 cm Edelstahl induktionsgeeignet NEU OVP Blitzversand Rechnung mit MwSt ${m}`,
      sku: null,
      categoryId: null,
      categoryName: "Haushalt > Kochen & Genießen > Töpfe & Pfannen",
      conditionId: "1000",
      conditionName: "Neu",
      listingType: "FixedPriceItem",
      price: 24.9,
      quantity: 3,
      sold: 0,
      watchers: null,
      startTime: null,
      images: [`${TD}/amazon-bild/ka-${m}-1.jpg`, `${TD}/amazon-bild/ka-${m}-2.jpg`],
      descriptionText: "Hochwertige Pfanne aus Edelstahl (erfunden).\nZahlung per PayPal innerhalb von 7 Tagen.\nBitte beachten Sie unsere eBay-Bewertungen.",
      descriptionHtml: "<p>Hochwertige Pfanne aus Edelstahl (erfunden).</p>",
      descriptionLength: 60,
      activeContent: false,
      fixedWidth: false,
      aspects: { Marke: ["Testmarke"], Durchmesser: ["28 cm"], EAN: ["4006381333931"] },
      ean: "4006381333931",
      brand: "Testmarke",
      variations: 0,
      bestOffer: false,
      shippingCost: 0,
      dispatchDays: 1,
      returnsAccepted: true,
      returnDays: 30,
    };
    await sql("insert into ebay_listing_checks (tenant_id, item_id, source, title, price, status, score, issues, facts, checked_at) values ($1, $2, 'ebay', $3, 24.9, 'fertig', 80, '[]', $4, now())", [T, itemId, facts.title, JSON.stringify(facts)]);

    await anmelden(page, "inhaber");
    await page.goto(`/ebay/pruefen/${itemId}`);
    const ka = page.locator('[data-testid="ka-entwurf"]');
    await ka.locator("summary").click();
    const titel = (await ka.locator('[data-testid="ka-titel"]').textContent())!;
    expect(titel.length).toBeLessThanOrEqual(65);
    expect(titel).toMatch(/^Testmarke Bratpfanne 28 cm Edelstahl/);
    expect(titel).not.toMatch(/Blitzversand|Rechnung mit MwSt/);
    await expect(ka.locator('[data-testid="ka-kategorie"]')).toHaveText("Haus & Garten > Küche & Esszimmer");
    await expect(ka.locator('[data-testid="ka-zustand"]')).toHaveText("Neu");
    await expect(ka.locator('[data-testid="ka-preis"]')).toHaveText("25 €");
    const text = await ka.locator('[data-testid="ka-text"]').inputValue();
    expect(text).toContain("Hochwertige Pfanne aus Edelstahl (erfunden).");
    expect(text).toContain("• Durchmesser: 28 cm");
    expect(text).not.toMatch(/PayPal|eBay|4006381333931/);
    await expect(ka.locator('[data-testid="ka-bild"]')).toHaveCount(2);
    await expect(ka.locator('[data-testid="ka-hinweise"]')).toContainText("gewerblicher Anbieter");
    await expect(ka.locator('[data-testid="ka-oeffnen"]')).toHaveAttribute("href", "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html");
    await expect(ka.getByRole("button", { name: "Titel kopieren" })).toBeVisible();
    await expect(ka.getByRole("button", { name: "Text kopieren" })).toBeVisible();

    // Bilder als ZIP (2 Dateien), ohne eBay-Zugang kein ZIP
    const zip = await page.request.get(`/ebay/pruefen/${itemId}/kleinanzeigen-bilder`);
    expect(zip.status()).toBe(200);
    expect(zip.headers()["content-type"]).toBe("application/zip");
    const daten = await zip.body();
    expect(daten.subarray(0, 2).toString()).toBe("PK");
    expect(daten.includes(Buffer.from("01.jpg"))).toBe(true);
    expect(daten.includes(Buffer.from("02.jpg"))).toBe(true);
    const fremd = await page.context().browser()!.newContext();
    const ohne = await fremd.request.get(`${page.url().split("/ebay/")[0]}/ebay/pruefen/${itemId}/kleinanzeigen-bilder`, { maxRedirects: 0 });
    // Ohne Anmeldung: Weiterleitung zur Anmeldung (bzw. 403), nie das ZIP
    expect([302, 303, 307, 403]).toContain(ohne.status());
    expect(ohne.headers()["content-type"] ?? "").not.toContain("zip");
    await fremd.close();
    await sql("delete from ebay_listing_checks where tenant_id = $1 and item_id = $2", [T, itemId]);
  });
});
