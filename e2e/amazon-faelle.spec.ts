// Amazon-Fall-Zentrale (B8) mit erfundenen Amazon-Mails: Freischaltung abgelehnt (Rechnung zu alt) → Paket mit
// passender Rechnung + VA-Thread; Fall „Antwort nötig“ (POD für FBA-Sendung) → Antwort DE/EN, zwei Mails ein Vorgang;
// Freischaltung entzogen → rot, Meldung an Ludwig, betroffener Bestand in €; unsichere Mail → von Hand einordnen
// (lernt); Claude-Werkzeuge. Keine echten Daten.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const eml = (o: { von?: string; betreff: string; text: string; id: string; tageZurueck?: number }) =>
  Buffer.from(
    [`From: Amazon <${o.von ?? "seller-notification@amazon.de"}>`, "To: info@test-firma.example", `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date(Date.now() - (o.tageZurueck ?? 0) * 86_400_000).toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"),
  );

test.describe("Amazon-Fall-Zentrale", () => {
  test("Freischaltung abgelehnt, Fall Antwort nötig, Entzug, Einordnung lernen, VA, Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(150_000);
    const m = marke();
    const fall = `7${String(Date.now()).slice(-10)}`;
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    // Rechnung (30 Tage alt) über die Charge TEST-SOCKEN (30 Stück) – passt zu den Kriterien von Amazon.
    const [inv] = await sql<{ id: string }>(
      "insert into invoices (tenant_id, source, file_name, kind, status, doc_type, invoice_date, invoice_number, vendor, text_excerpt, total_gross) values ($1, 'upload', $2, 'goods', 'matched', 'rechnung', current_date - 30, $3, 'Testgroßhandel (erfunden)', 'B0TEST0001 Testsocken 30 Stk', 74.97) returning id",
      [T, `fz-${m}.pdf`, `RE-FZ-${m}`],
    );
    const [lot] = await sql<{ id: string }>("select id from lots where tenant_id = $1 and sku = 'TEST-SOCKEN' limit 1", [T]);
    await sql("insert into invoice_lots (tenant_id, invoice_id, lot_id, matched_by) values ($1, $2, $3, 'manual') on conflict do nothing", [T, inv.id, lot.id]);
    // Bestand für die entzogene Marke (erfundene ASIN)
    await sql("insert into sellerboard_products (tenant_id, sb_id, sku, asin, name, cost, price, synced_at) values ($1, $2, $3, 'B0TESTFZ09', 'Testmarke Entzugsdose (erfunden)', 5, 20, now())", [T, `FZ-${m}`, `TEST-FZ-${m}`]);
    await sql("insert into sellerboard_inventory (tenant_id, sb_id, sku, asin, name, fba_stock, sales_velocity, synced_at) values ($1, $2, $3, 'B0TESTFZ09', 'Testmarke Entzugsdose (erfunden)', 40, 1, now())", [T, `FZ-INV-${m}`, `TEST-FZ-${m}`]);

    await anmelden(page, "inhaber");
    await page.goto("/posteingang");
    const form = page.getByTestId("eml-upload").first();
    await form.locator("input[type=file]").setInputFiles([
      { name: `a-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Ihr Antrag auf Verkaufsgenehmigung wurde abgelehnt ${m}`, text: "Die eingereichte Rechnung ist älter als 180 Tage. ASIN: B0TEST0001", id: `fz-a-${m}`, tageZurueck: 2 }) },
      { name: `b-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "sellersupport@amazon.de", betreff: `Ihre Fall-ID: ${fall} ${m}`, text: "Bitte stellen Sie den Zustellnachweis (POD) für die Sendung FBA15TESTFZ1 bereit.", id: `fz-b-${m}`, tageZurueck: 2 }) },
      { name: `c-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "sellersupport@amazon.de", betreff: `Re: Ihre Fall-ID: ${fall}`, text: "Wir benötigen weiterhin den Zustellnachweis (POD).", id: `fz-c-${m}`, tageZurueck: 1 }) },
      { name: `d-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Wichtig: Ihre Verkaufsberechtigung wurde entzogen ${m}`, text: "Wir haben Ihre Freischaltung widerrufen. Betroffene ASIN: B0TESTFZ09", id: `fz-d-${m}` }) },
      { name: `e-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Hinweis zu Ihrem Verkäuferprofil Nummer ${m}`, text: "Bitte beachten Sie die Änderung.", id: `fz-e-${m}` }) },
    ]);
    await form.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect(form).toContainText(/neu/);

    await page.goto("/amazon-faelle");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("faelle-abgleich").click()]);
    await expect(page.getByTestId("faelle-meldung")).toContainText("neue Vorgänge");
    const vorgang = async (titel: string) => (await sql<{ id: string; bereich: string; phase: string; dringlichkeit: string; unsicher: boolean }>("select id, bereich, phase, dringlichkeit, unsicher from amazon_vorgaenge where tenant_id = $1 and titel like $2", [T, `%${titel}%`]))[0];

    // Freischaltung abgelehnt → Paket mit der Rechnung (≤ 180 Tage, ≥ 10 Stück), nichts fehlt; an die VA
    const fs = await vorgang(`abgelehnt ${m}`);
    expect(fs).toMatchObject({ bereich: "freischaltung", phase: "abgelehnt", dringlichkeit: "gelb" });
    await page.goto(`/amazon-faelle/${fs.id}`);
    await expect(page.getByTestId("fall-belege")).toContainText(`RE-FZ-${m}`);
    await expect(page.getByTestId("fall-fehlt")).toHaveCount(0);
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("fall-an-va").click()]);
    await expect(page.getByTestId("fall-meldung")).toContainText("An die VA übergeben");
    const [vt] = await sql<{ n: string }>("select count(*) n from va_threads t join amazon_vorgaenge v on v.task_id = t.task_id where v.id = $1", [fs.id]);
    expect(vt.n).toBe("1");

    // Fall „Antwort nötig“: beide Mails in einem Vorgang, Antwort mit Sendung, POD fehlt ausdrücklich
    const faelle = await sql<{ id: string; phase: string; n: string }>("select v.id, v.phase, (select count(*) from amazon_vorgang_eintraege e where e.vorgang_id = v.id and e.art = 'mail') n from amazon_vorgaenge v where v.tenant_id = $1 and v.fallnummer = $2", [T, fall]);
    expect(faelle).toHaveLength(1);
    expect(faelle[0]).toMatchObject({ phase: "antwort_noetig", n: "2" });
    await page.goto(`/amazon-faelle/${faelle[0].id}`);
    await expect(page.getByTestId("fall-text-de")).toHaveValue(/FBA15TESTFZ1/);
    await expect(page.getByTestId("fall-text-en")).toHaveValue(new RegExp(`case ${fall}`));
    await expect(page.getByTestId("fall-fehlt")).toContainText("Zustellnachweis");

    // Entzug: rot, Meldung an Ludwig, betroffener Bestand 40 Stück · EK 200 €
    const ent = await vorgang(`entzogen ${m}`);
    expect(ent).toMatchObject({ bereich: "freischaltung", phase: "entzogen", dringlichkeit: "rot" });
    const meld = await sql<{ titel: string; text: string }>("select titel, text from meldungen where tenant_id = $1 and link = $2", [T, `/amazon-faelle/${ent.id}`]);
    expect(meld[0].titel).toContain("entzogen");
    expect(meld[0].text).toContain("40 Stück");
    await page.goto(`/amazon-faelle/${ent.id}`);
    await expect(page.getByTestId("fall-bestand")).toContainText("40 Stück");
    await expect(page.getByTestId("fall-bestand")).toContainText("200,00");

    // Unsichere Mail → von Hand einordnen; gleicher Betreff wird künftig so eingeordnet
    const un = await vorgang(`Verkäuferprofil Nummer ${m}`);
    expect(un.unsicher).toBe(true);
    await page.goto(`/amazon-faelle/${un.id}`);
    await page.getByTestId("fall-einordnung").locator('select[name="bereich"]').selectOption("kontozustand");
    await page.getByTestId("fall-einordnung").locator('select[name="phase"]').selectOption("offen");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("fall-einordnung-speichern").click()]);
    await expect(page.getByTestId("fall-meldung")).toContainText("künftig");
    expect((await sql<{ c: string }>("select count(*) c from amazon_einordnung_regeln where tenant_id = $1 and bereich = 'kontozustand'", [T]))[0].c).not.toBe("0");

    // Übersicht: Kacheln und Liste
    await page.goto("/amazon-faelle");
    await expect(page.getByTestId("kachel-antwort")).not.toHaveText("0");
    await expect(page.getByTestId("faelle-rot")).toBeVisible();

    // Claude: Liste, Einzelheiten per Fallnummer, Status „eingereicht“ mit Fallnummer
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber", { write: true });
    expect(await mcp.tools()).toEqual(expect.arrayContaining(["amazon_faelle", "amazon_fall", "freischaltungen", "erstattungen_abgleich", "amazon_fall_status", "amazon_fall_an_va"]));
    const liste = JSON.parse(await mcp.call("amazon_faelle", { kategorie: "freischaltung" }));
    expect(liste.vorgaenge.some((v: { id: string }) => v.id === ent.id)).toBe(true);
    const detail = JSON.parse(await mcp.call("amazon_fall", { id_oder_fallnummer: fall }));
    expect(detail.verlauf.filter((x: { art: string }) => x.art === "mail")).toHaveLength(2);
    expect(detail.paket.fehlt.join(" ")).toContain("Zustellnachweis");
    const st = JSON.parse(await mcp.call("amazon_fall_status", { id: faelle[0].id, status: "eingereicht", notiz: "Antwort mit Lieferschein geschickt" }));
    expect(st.phase).toContain("eingereicht");
    const fr = JSON.parse(await mcp.call("freischaltungen", {}));
    expect(fr.quote_je_marke.length).toBeGreaterThan(0);
    const er = JSON.parse(await mcp.call("erstattungen_abgleich", {}));
    expect(er.link).toContain("/retouren");
  });

  test("B17: Bestell-/Versand-/Zahlungsmails nie als Fall, Marktplatz aus dem Inhalt, alte Fehlzuordnung neu eingestuft", async ({ page }) => {
    test.setTimeout(90_000);
    const m = marke();
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    const fuss = "\n\n© 2026 Amazon.com, Inc. Copyright, Marken und Patente siehe Nutzungsbedingungen.";
    await anmelden(page, "inhaber");
    await page.goto("/posteingang");
    const form = page.getByTestId("eml-upload").first();
    await form.locator("input[type=file]").setInputFiles([
      { name: `r1-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "donotreply@amazon.com", betreff: `Verkauft, Jetzt liefern: Testartikel ${m}`, text: `Bestellnummer 302-1234567-${String(Date.now()).slice(-7)}. Bitte versenden Sie den Artikel.${fuss}`, id: `fz-r1-${m}` }) },
      { name: `r2-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "donotreply@amazon.com", betreff: `Tu pago está en camino ${m}`, text: `Hemos enviado tu pago.${fuss}`, id: `fz-r2-${m}` }) },
      { name: `r3-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ von: "donotreply@amazon.com", betreff: `Amazon a expédié vos articles ${m}`, text: `Votre commande a été expédiée.${fuss}`, id: `fz-r3-${m}`, tageZurueck: 3 }) },
    ]);
    await form.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect(form).toContainText(/neu/);
    // Altlast nachstellen: r3 wurde früher als „Markenbeschwerde“, rot, Marktplatz US eingeordnet.
    const [r3] = await sql<{ id: string }>("select id from emails where tenant_id = $1 and subject = $2", [T, `Amazon a expédié vos articles ${m}`]);
    const [alt] = await sql<{ id: string }>(
      "insert into amazon_vorgaenge (tenant_id, bereich, phase, status, dringlichkeit, titel, marktplatz, zustaendig, frist, erste_mail_am, letzte_mail_am) values ($1, 'marke', 'offen', 'offen', 'rot', $2, 'US', 'va', current_date + 2, now() - interval '3 days', now() - interval '3 days') returning id",
      [T, `Amazon a expédié vos articles ${m}`],
    );
    await sql("insert into amazon_vorgang_eintraege (tenant_id, vorgang_id, email_id, art, phase, text, am) values ($1, $2, $3, 'mail', 'offen', 'alt', now() - interval '3 days')", [T, alt.id, r3.id]);

    await page.goto("/amazon-faelle");
    await Promise.all([page.waitForURL(/meldung=/), page.getByTestId("faelle-abgleich").click()]);
    await expect(page.getByTestId("faelle-meldung")).toContainText("Routine-Mails");
    await expect(page.getByTestId("faelle-meldung")).toContainText("neu eingestuft");
    // Keine Vorgänge aus Bestell-/Zahlungsmails; beim nächsten Lauf werden sie nicht erneut gelesen.
    expect((await sql<{ n: string }>("select count(*) n from amazon_vorgaenge where tenant_id = $1 and (titel like $2 or titel like $3)", [T, `Verkauft, Jetzt liefern%${m}`, `Tu pago%${m}`]))[0].n).toBe("0");
    expect((await sql<{ n: string }>("select count(*) n from amazon_mail_uebersprungen u join emails e on e.id = u.email_id where u.tenant_id = $1 and e.subject like $2 and u.grund = 'routine'", [T, `%${m}`]))[0].n).toBe("2");
    // Altlast: kein Fall mehr, grau, Marktplatz FR, Verlauf nennt den Grund
    const [neu] = await sql<{ bereich: string; status: string; dringlichkeit: string; marktplatz: string | null; frist: string | null }>("select bereich, status, dringlichkeit, marktplatz, frist from amazon_vorgaenge where id = $1", [alt.id]);
    expect(neu).toMatchObject({ bereich: "info", status: "info", dringlichkeit: "grau", marktplatz: "FR", frist: null });
    await page.goto(`/amazon-faelle/${alt.id}`);
    await expect(page.locator("body")).toContainText("Routine-Mail (Bestellung/Versand/Zahlung) – kein Fall");
  });
});
