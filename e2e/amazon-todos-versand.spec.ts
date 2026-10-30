// B10: Amazon-ToDos mit dem Versand abgleichen – Bestell-Mails sind keine ToDos, versendete Aufträge archivieren
// die Mail, Altbestand wird geschlossen, überfällige FBM-Aufträge und fehlende Bestellungen stehen in je EINEM
// Sammel-ToDo; Compliance vor Logistik; Claude-Werkzeug mit Bestellnummer und Link. Erfundene Daten.
import { aktion, anmelden, expect, marke, mcpVerbinden, sql, test } from "./helfer";

const eml = (o: { betreff: string; text: string; id: string; stundenZurueck?: number }) =>
  Buffer.from(
    ["From: Amazon <seller-notification@amazon.de>", "To: info@test-firma.example", `Subject: ${o.betreff}`, `Message-ID: <${o.id}@example.invalid>`, `Date: ${new Date(Date.now() - (o.stundenZurueck ?? 0) * 3_600_000).toUTCString()}`, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"),
  );

test.describe("Amazon-ToDos mit dem Versand abgleichen", () => {
  test("Bestell-Mails folgen dem Auftrag, Sammel-ToDos, Altbestand, Sortierung, Claude", async ({ page, browser, baseURL }) => {
    test.setTimeout(120_000);
    const m = marke();
    const z = String(Date.now()).slice(-7);
    const nr = (n: number) => `30${n}-${z}-000000${n}`;
    const [{ tenant_id: T }] = await sql<{ tenant_id: string }>("select tenant_id from lots where sku = 'TEST-SOCKEN' limit 1");
    // Aufträge: 1 versendet (selbst – nicht Prep Center, damit die Prep-Center-Monatszahlen anderer Prüfungen stimmen),
    // 2 mit Label, 3 offen und Versandfrist gestern abgelaufen
    const auftrag = (n: number, status: string, shipByStd: number, shippedBy: string | null = null, bestaetigt = false) =>
      sql("insert into orders (tenant_id, channel, external_id, order_date, fulfillment, status, ship_by, shipped_by, buyer_name, total, tracking_uploaded_at) values ($1, 'amazon', $2, now() - interval '2 days', 'FBM', $3, now() + ($4 || ' hours')::interval, $5, 'Testkunde (erfunden)', 19.9, $6)", [T, nr(n), status, String(shipByStd), shippedBy, bestaetigt ? new Date() : null]);
    await auftrag(1, "shipped", -20, "self", true);
    await auftrag(2, "label_created", 10);
    await auftrag(3, "open", -24);
    // Altbestand: ein offenes ToDo aus einer Bestell-Mail (vor der Umstellung entstanden)
    await sql("insert into amazon_todos (tenant_id, message_key, received_at, subject, category, priority, deadline, status, source, body_short) values ($1, $2, now() - interval '1 day', $3, 'logistik_info', 'high', current_date, 'open', 'ai', $4)", [T, `alt-${m}`, `Verkauft, Jetzt liefern: TEST-ALT NIKE (erfunden) ${m}`, `Bestellnummer: ${nr(1)}`]);
    // Ein Compliance-ToDo, das vor der Logistik stehen muss
    await sql("insert into amazon_todos (tenant_id, message_key, received_at, subject, summary, category, priority, status, source) values ($1, $2, now(), $3, $3, 'compliance_epr', 'medium', 'open', 'rules')", [T, `epr-${m}`, `Batterie-Registrierungsnummer fehlt ${m}`]);

    await anmelden(page, "inhaber");
    await page.goto("/posteingang");
    const form = page.getByTestId("eml-upload").first();
    await form.locator("input[type=file]").setInputFiles([
      { name: `a-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Verkauft, Jetzt liefern: TEST-1 Testschuh ${m}`, text: `Bestellnummer: ${nr(1)}`, id: `v1-${m}`, stundenZurueck: 30 }) },
      { name: `b-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Sold, ship now: TEST-2 Test mug ${m}`, text: `Order ID: ${nr(2)}`, id: `v2-${m}`, stundenZurueck: 20 }) },
      { name: `c-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Venduto, spedisci ora: TEST-3 Batterie AA ${m}`, text: `Numero ordine: ${nr(3)}`, id: `v3-${m}`, stundenZurueck: 40 }) },
      { name: `d-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Vendido, envíe ahora: TEST-9 ${m}`, text: `Pedido: ${nr(9)}`, id: `v9-${m}`, stundenZurueck: 12 }) },
      { name: `e-${m}.eml`, mimeType: "message/rfc822", buffer: eml({ betreff: `Amazon hat Ihre Artikel versandt ${m}`, text: "Sendung unterwegs (erfunden).", id: `fba-${m}`, stundenZurueck: 2 }) },
    ]);
    await form.getByRole("button", { name: "Hochladen", exact: true }).click();
    await expect(form).toContainText(/neu/);

    await page.goto("/amazon-todos");
    await Promise.all([aktion(page), page.getByRole("button", { name: "↻ Mails prüfen" }).click()]);
    const mailArchiviert = async (id: string) => (await sql<{ archived: boolean }>("select archived from emails where tenant_id = $1 and message_key = $2", [T, `<${id}@example.invalid>`]))[0]?.archived;
    await expect.poll(() => mailArchiviert(`v1-${m}`), { timeout: 30_000 }).toBe(true);

    // 1) Bestell-Mails sind keine ToDos (auch nicht die mit „Batterie“ im Titel)
    const [keine] = await sql<{ c: string }>("select count(*) c from amazon_todos where tenant_id = $1 and message_key like $2", [T, `<v_-${m}@%`]);
    expect(keine.c).toBe("0");
    // 2) Status folgt dem Auftrag: versendet + an Amazon bestätigt → archiviert; Label/offen → bleibt (B15); FBA-Info → archiviert
    expect(await mailArchiviert(`v1-${m}`)).toBe(true);
    expect(await mailArchiviert(`v2-${m}`)).toBe(false);
    expect(await mailArchiviert(`v3-${m}`)).toBe(false);
    expect(await mailArchiviert(`fba-${m}`)).toBe(true);
    // 3) EIN Sammel-ToDo für überfällige FBM-Aufträge und eins für fehlende Bestellungen
    const sammel = await sql<{ message_key: string; status: string; bestellnummern: string[]; priority: string }>("select message_key, status, bestellnummern, priority from amazon_todos where tenant_id = $1 and message_key like 'sammel:%'", [T]);
    const ueber = sammel.find((s) => s.message_key === "sammel:fbm-ueberfaellig")!;
    expect(ueber).toMatchObject({ status: "open", priority: "high" });
    expect(ueber.bestellnummern).toContain(nr(3));
    expect(ueber.bestellnummern).not.toContain(nr(1));
    expect(sammel.find((s) => s.message_key === "sammel:bestellung-fehlt")!.bestellnummern).toContain(nr(9));
    // 4) Altbestand geschlossen, mit Grund
    const [alt] = await sql<{ status: string; closed_by: string }>("select status, closed_by from amazon_todos where tenant_id = $1 and message_key = $2", [T, `alt-${m}`]);
    expect(alt.status).toBe("done");
    expect(alt.closed_by).toContain("versendet");

    // 5) Liste: Compliance vor dem Versand-Sammel-ToDo; Bestellnummer verlinkt den Auftrag
    await page.reload();
    const titel = await page.locator("article").allTextContents();
    const iEpr = titel.findIndex((t) => t.includes(`Batterie-Registrierungsnummer fehlt ${m}`));
    const iUeber = titel.findIndex((t) => t.includes("nach Versandfrist noch offen"));
    expect(iEpr).toBeGreaterThanOrEqual(0);
    expect(iEpr).toBeLessThan(iUeber);
    await expect(page.getByTestId("todo-bestellungen").filter({ hasText: nr(3) }).getByRole("link", { name: new RegExp(nr(3)) })).toHaveAttribute("href", /\/auftraege\//);

    // 6) B15: Auftrag 3 wird versendet (Prep Center, ohne Sendungsnummer), Amazon weiß es nicht → Mail bleibt, Alarm auf
    //    der Startseite, Sammel-ToDo; Datei laden → „in Seller Central hochgeladen“ → nächster Lauf: Mail archiviert
    await sql("update orders set status = 'shipped', shipped_at = now() - interval '3 hours' where tenant_id = $1 and external_id = $2", [T, nr(3)]);
    await Promise.all([aktion(page), page.getByRole("button", { name: "↻ Mails prüfen" }).click()]);
    expect(await mailArchiviert(`v3-${m}`)).toBe(false);
    const [unb] = await sql<{ bestellnummern: string[]; status: string }>("select bestellnummern, status from amazon_todos where tenant_id = $1 and message_key = 'sammel:fbm-unbestaetigt'", [T]);
    expect(unb.status).toBe("open");
    expect(unb.bestellnummern).toContain(nr(3));
    await page.goto("/");
    await expect(page.locator("body")).toContainText("versendet, aber bei Amazon nicht bestätigt");
    await page.goto("/auftraege?ansicht=fehler");
    const datei = await page.request.get("/auftraege/versandbestaetigung");
    expect(await datei.text()).toContain(`${nr(3)}\t\t\t`);
    await Promise.all([aktion(page), page.getByTestId("bestaetigung-hochgeladen").click()]);
    await expect(page.getByTestId("orders-msg")).toContainText("als an Amazon gemeldet markiert");
    expect((await sql<{ t: string | null }>("select tracking_uploaded_at t from orders where tenant_id = $1 and external_id = $2", [T, nr(3)]))[0].t).not.toBeNull();
    await page.goto("/amazon-todos");
    await Promise.all([aktion(page), page.getByRole("button", { name: "↻ Mails prüfen" }).click()]);
    await expect.poll(() => mailArchiviert(`v3-${m}`), { timeout: 30_000 }).toBe(true);
    const [nach] = await sql<{ bestellnummern: string[] }>("select bestellnummern from amazon_todos where tenant_id = $1 and message_key = 'sammel:fbm-ueberfaellig'", [T]);
    expect(nach?.bestellnummern ?? []).not.toContain(nr(3));

    // 7) Claude: amazon_todos ohne Logistik, Bestellnummer mit Status und Link
    const mcp = await mcpVerbinden(browser, baseURL!, "inhaber");
    const r = JSON.parse(await mcp.call("amazon_todos", {}));
    expect(r.todos.some((t: { kategorie: string }) => t.kategorie === "logistik_info")).toBe(false);
    const f = r.todos.find((t: { kategorie: string }) => t.kategorie === "import_luecke");
    expect(f.bestellungen.find((b: { bestellnummer: string }) => b.bestellnummer === nr(9)).status).toBe("fehlt im Tool");
  });
});
